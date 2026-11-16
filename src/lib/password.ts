// Com a extensao explicita porque tests/password.test.ts roda este arquivo
// direto no Node, que resolve modulos sem a ajuda do bundler.
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "./auth-shared.ts";
import { hashPin, verifyPin } from "./pin.ts";

/**
 * Senha: o jeito de entrar em qualquer aparelho sem depender do e-mail.
 *
 * O codigo de 4 digitos (pin.ts) so vale num aparelho que ja entrou uma vez. A
 * senha cobre o que ele nao cobre: o app instalado na tela inicial do celular —
 * onde o link do e-mail abre no navegador, e nao no app — e qualquer aparelho
 * novo. A pessoa cria a senha dentro do app, ja logada, e a partir dai entra
 * com e-mail + senha.
 *
 * Como aqui nao existe o cookie do aparelho para segurar a porta, quem segura
 * e o limite de tentativas *por conta*: erros seguidos trancam a senha por um
 * tempo, de qualquer IP. O link por e-mail continua funcionando durante a
 * tranca, entao o dono nunca fica do lado de fora.
 *
 * Este modulo e so a regra. O banco entra pelas funcoes injetadas em
 * `PasswordLookups`, como em pin.ts e access.ts, para os testes cobrirem todos
 * os ramos sem Postgres.
 */

export { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH };

/** Erros seguidos antes de a senha ficar trancada. */
export const MAX_PASSWORD_ATTEMPTS = 5;

/** Quanto tempo a senha fica trancada depois de estourar o limite. */
export const LOCK_MINUTES = 15;

/**
 * O scrypt de pin.ts nao sabe que e um codigo: e o mesmo hash com sal por
 * usuario, e serve igual para a senha.
 */
export const hashPassword = hashPin;
export const verifyPassword = verifyPin;

export function normalizeEmail(raw: string | null | undefined): string {
  return (raw ?? "").trim().toLowerCase();
}

/** Mensagem de erro para uma senha que nao pode ser cadastrada, ou null. */
export function passwordProblem(password: unknown): string | null {
  if (typeof password !== "string" || password.length < PASSWORD_MIN_LENGTH) {
    return `A senha precisa ter pelo menos ${PASSWORD_MIN_LENGTH} caracteres.`;
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    return `A senha pode ter no máximo ${PASSWORD_MAX_LENGTH} caracteres.`;
  }
  if (password.trim().length === 0) {
    return "A senha não pode ser só espaços.";
  }
  return null;
}

/* -------------------------------------------------------------------------- */

export type PasswordAccount = {
  userId: string;
  passwordHash: string;
  /** ISO. Enquanto estiver no futuro, a senha nao e nem conferida. */
  lockedUntil: string | null;
};

/** O que a decisao precisa do banco. */
export type PasswordLookups = {
  /** Null quando o e-mail nao existe ou o dono ainda nao criou senha. */
  findByEmail(email: string): Promise<PasswordAccount | null>;
  /**
   * Uma tentativa errada a mais. Devolve o total acumulado e ate quando a
   * senha ficou trancada (null se ainda nao estourou o limite).
   */
  registerFailure(
    userId: string,
  ): Promise<{ failedCount: number; lockedUntil: string | null }>;
  /** Acertou: zera o contador e destranca. */
  registerSuccess(userId: string): Promise<void>;
};

export type PasswordDecision =
  | { allowed: true; userId: string }
  | { allowed: false; message: string; locked: boolean };

/**
 * A mesma frase para e-mail desconhecido, conta sem senha e senha errada: a
 * resposta nao pode contar a quem esta de fora quais e-mails tem conta.
 */
const WRONG =
  "E-mail ou senha incorretos. Se você ainda não criou uma senha, peça o link por e-mail.";

function lockedMessage(until: string, now: Date): string {
  const minutes = Math.max(
    1,
    Math.ceil((new Date(until).getTime() - now.getTime()) / 60_000),
  );
  return `Senha errada vezes demais. Tente de novo em ${minutes} ${
    minutes === 1 ? "minuto" : "minutos"
  } ou entre pelo link por e-mail.`;
}

/**
 * Hash de mentira, conferido quando o e-mail nao tem senha: sem isso a
 * resposta para e-mail desconhecido voltaria bem mais rapido que a de senha
 * errada, e o tempo entregaria quais contas existem.
 */
let dummyHash: Promise<string> | undefined;

/**
 * Decide se e-mail + senha abrem o app.
 *
 * A ordem importa: com a senha trancada nem conferimos o que foi digitado —
 * senao a tranca nao seguraria nada, e o acerto no meio dela passaria.
 */
export async function decidePasswordLogin(
  rawEmail: string | null | undefined,
  rawPassword: string | null | undefined,
  lookups: PasswordLookups,
  now: Date = new Date(),
): Promise<PasswordDecision> {
  const email = normalizeEmail(rawEmail);
  const password = typeof rawPassword === "string" ? rawPassword : "";

  if (!email || !password) {
    return { allowed: false, message: "Informe o e-mail e a senha.", locked: false };
  }

  // Senha gigante so serviria para fazer o servidor gastar scrypt a toa.
  if (password.length > PASSWORD_MAX_LENGTH) {
    return { allowed: false, message: WRONG, locked: false };
  }

  const account = await lookups.findByEmail(email);

  if (!account) {
    dummyHash ??= hashPassword("senha-que-ninguem-tem");
    await verifyPassword(password, await dummyHash);
    return { allowed: false, message: WRONG, locked: false };
  }

  if (account.lockedUntil && new Date(account.lockedUntil).getTime() > now.getTime()) {
    return {
      allowed: false,
      message: lockedMessage(account.lockedUntil, now),
      locked: true,
    };
  }

  if (await verifyPassword(password, account.passwordHash)) {
    await lookups.registerSuccess(account.userId);
    return { allowed: true, userId: account.userId };
  }

  const { failedCount, lockedUntil } = await lookups.registerFailure(account.userId);

  if (lockedUntil && new Date(lockedUntil).getTime() > now.getTime()) {
    return { allowed: false, message: lockedMessage(lockedUntil, now), locked: true };
  }

  const left = MAX_PASSWORD_ATTEMPTS - failedCount;

  return {
    allowed: false,
    message:
      left > 0 && left <= 2
        ? `${WRONG} ${left === 1 ? "Resta 1 tentativa" : `Restam ${left} tentativas`} antes de a senha ficar bloqueada por ${LOCK_MINUTES} minutos.`
        : WRONG,
    locked: false,
  };
}
