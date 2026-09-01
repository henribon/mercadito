import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

// Com a extensao explicita porque tests/pin.test.ts roda este arquivo direto no
// Node, que resolve modulos sem a ajuda do bundler.
import { PIN_LENGTH } from "./auth-shared.ts";

/**
 * Codigo de 4 digitos: o jeito de entrar depois que o e-mail ja foi usado uma
 * vez.
 *
 * O codigo sozinho nao vale nada — 4 digitos sao 10 mil combinacoes, e ele nem
 * diz de quem e. Quem identifica a pessoa e o *aparelho*: ao criar o codigo, o
 * navegador recebe um cookie httpOnly com um token aleatorio de 32 bytes, e
 * uma linha em trusted_devices liga esse token ao dono. Sem o cookie o codigo
 * nem chega a ser conferido; com ele, erros seguidos derrubam a confianca do
 * aparelho e o e-mail volta a ser exigido.
 *
 * Este modulo e so a regra e a criptografia. O banco entra pelas funcoes
 * injetadas em `PinLookups`, para que os testes cubram todos os ramos sem
 * precisar de Postgres — como em access.ts, e pelo mesmo motivo: e a regra que
 * decide quem entra.
 */

const scryptAsync = promisify(scrypt);

export { PIN_LENGTH };

/** Erros seguidos antes de o aparelho voltar a exigir o link por e-mail. */
export const MAX_ATTEMPTS = 5;

/** So os digitos: o teclado do celular deixa passar espaco e traco. */
export function normalizePin(raw: string | null | undefined): string {
  return (raw ?? "").replace(/\D/g, "");
}

export function isPin(value: string): boolean {
  return value.length === PIN_LENGTH && /^\d+$/.test(value);
}

/**
 * scrypt com sal proprio por usuario.
 *
 * Um codigo de 4 digitos e forca bruta trivial contra um hash rapido, entao a
 * defesa real e o limite de tentativas — mas scrypt garante que um dump do
 * banco tambem nao entregue os codigos de graca.
 */
export async function hashPin(pin: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = (await scryptAsync(pin, salt, 32)) as Buffer;
  return `scrypt$${salt.toString("hex")}$${derived.toString("hex")}`;
}

export async function verifyPin(pin: string, stored: string): Promise<boolean> {
  const [scheme, saltHex, hashHex] = stored.split("$");
  if (scheme !== "scrypt" || !saltHex || !hashHex) return false;

  const expected = Buffer.from(hashHex, "hex");
  if (expected.length === 0) return false;

  const derived = (await scryptAsync(
    pin,
    Buffer.from(saltHex, "hex"),
    expected.length,
  )) as Buffer;

  return timingSafeEqual(derived, expected);
}

/** Token do cookie do aparelho. Vai inteiro para o navegador, uma vez so. */
export function newDeviceToken(): string {
  return randomBytes(32).toString("base64url");
}

/** No banco guardamos so o sha256: um dump nao entrega o aparelho de ninguem. */
export function hashDeviceToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/* -------------------------------------------------------------------------- */

export type TrustedDevice = {
  id: string;
  userId: string;
  /** Null quando o dono ainda nao criou (ou ja removeu) o codigo. */
  pinHash: string | null;
};

/** O que a decisao precisa do banco. */
export type PinLookups = {
  findDevice(tokenHash: string): Promise<TrustedDevice | null>;
  /** Uma tentativa errada a mais. Devolve o total acumulado. */
  registerFailure(deviceId: string): Promise<number>;
  /** Acertou: zera o contador e marca o uso. */
  registerSuccess(deviceId: string): Promise<void>;
  /** Aparelho perde a confianca: so volta pelo link por e-mail. */
  forgetDevice(deviceId: string): Promise<void>;
};

export type PinDecision =
  | { allowed: true; userId: string }
  /**
   * `deviceRejected` separa "errou o codigo, tente de novo" de "este aparelho
   * nao entra mais por codigo" — no segundo caso o endpoint apaga o cookie e a
   * tela volta a pedir o e-mail, em vez de insistir num codigo que nao serve.
   */
  | { allowed: false; message: string; deviceRejected: boolean };

/** Mensagem unica para "este aparelho nao entra por codigo", em qualquer motivo. */
const UNKNOWN_DEVICE =
  "Este aparelho não tem código cadastrado. Entre com o e-mail para cadastrar um.";

/**
 * Decide se um codigo de 4 digitos abre o app neste aparelho.
 *
 * A ordem importa: sem cookie valido nem chegamos a conferir o codigo, entao
 * quem nao tem o aparelho nao tem como testar as 10 mil combinacoes.
 */
export async function decidePinLogin(
  rawPin: string | null | undefined,
  rawToken: string | null | undefined,
  lookups: PinLookups,
): Promise<PinDecision> {
  const pin = normalizePin(rawPin);
  if (!isPin(pin)) {
    return {
      allowed: false,
      message: `Digite os ${PIN_LENGTH} dígitos do seu código.`,
      deviceRejected: false,
    };
  }

  const token = (rawToken ?? "").trim();
  if (!token) {
    return { allowed: false, message: UNKNOWN_DEVICE, deviceRejected: true };
  }

  const device = await lookups.findDevice(hashDeviceToken(token));

  // Cookie que sobreviveu ao aparelho ser removido do banco.
  if (!device || !device.pinHash) {
    return { allowed: false, message: UNKNOWN_DEVICE, deviceRejected: true };
  }

  if (await verifyPin(pin, device.pinHash)) {
    await lookups.registerSuccess(device.id);
    return { allowed: true, userId: device.userId };
  }

  const failed = await lookups.registerFailure(device.id);
  const left = MAX_ATTEMPTS - failed;

  if (left <= 0) {
    await lookups.forgetDevice(device.id);
    return {
      allowed: false,
      message:
        "Código errado vezes demais. Entre com o e-mail para liberar este aparelho de novo.",
      deviceRejected: true,
    };
  }

  return {
    allowed: false,
    message: `Código errado. ${
      left === 1 ? "Resta 1 tentativa" : `Restam ${left} tentativas`
    } antes de precisar do e-mail.`,
    deviceRejected: false,
  };
}
