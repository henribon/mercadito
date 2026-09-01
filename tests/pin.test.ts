import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  decidePinLogin,
  hashDeviceToken,
  hashPin,
  isPin,
  MAX_ATTEMPTS,
  newDeviceToken,
  normalizePin,
  verifyPin,
  type PinLookups,
  type TrustedDevice,
} from "../src/lib/pin.ts";

/**
 * Codigo de 4 digitos: entrar sem repetir o e-mail.
 *
 * Sao 10 mil combinacoes, entao o que segura a porta e o par aparelho +
 * tentativas limitadas. Estes testes fixam essa regra.
 */

const TOKEN = "token-deste-aparelho";
const CODIGO = "4071";

type Spy = PinLookups & {
  failures: number;
  successes: number;
  forgotten: string[];
};

/** Banco de mentira: um aparelho conhecido, com o codigo 4071. */
function lookups(device: TrustedDevice | null, overrides: Partial<PinLookups> = {}): Spy {
  const spy: Spy = {
    failures: 0,
    successes: 0,
    forgotten: [] as string[],
    findDevice: async (tokenHash: string) =>
      tokenHash === hashDeviceToken(TOKEN) ? device : null,
    registerFailure: async () => ++spy.failures,
    registerSuccess: async () => {
      spy.successes += 1;
    },
    forgetDevice: async (id: string) => {
      spy.forgotten.push(id);
    },
    ...overrides,
  };
  return spy;
}

async function conhecido(): Promise<TrustedDevice> {
  return { id: "dev-1", userId: "user-1", pinHash: await hashPin(CODIGO) };
}

describe("hash do codigo", () => {
  test("confere o codigo certo e recusa o errado", async () => {
    const stored = await hashPin(CODIGO);

    assert.equal(await verifyPin(CODIGO, stored), true);
    assert.equal(await verifyPin("4072", stored), false);
  });

  test("o codigo nao aparece no que é guardado", async () => {
    const stored = await hashPin(CODIGO);
    assert.equal(stored.includes(CODIGO), false);
  });

  test("dois hashes do mesmo codigo são diferentes (sal por usuário)", async () => {
    assert.notEqual(await hashPin(CODIGO), await hashPin(CODIGO));
  });

  test("hash corrompido no banco não deixa ninguém entrar", async () => {
    assert.equal(await verifyPin(CODIGO, "lixo"), false);
    assert.equal(await verifyPin(CODIGO, "scrypt$$"), false);
    assert.equal(await verifyPin(CODIGO, ""), false);
  });
});

describe("token do aparelho", () => {
  test("cada aparelho recebe um token diferente", () => {
    assert.notEqual(newDeviceToken(), newDeviceToken());
  });

  test("o que vai para o banco não é o token do cookie", () => {
    const token = newDeviceToken();
    const hash = hashDeviceToken(token);

    assert.notEqual(hash, token);
    assert.equal(hash, hashDeviceToken(token), "o hash tem que ser estável");
  });
});

describe("decidePinLogin", () => {
  test("codigo certo no aparelho conhecido entra", async () => {
    const db = lookups(await conhecido());
    const d = await decidePinLogin(CODIGO, TOKEN, db);

    assert.equal(d.allowed, true);
    if (!d.allowed) return;
    assert.equal(d.userId, "user-1");
    assert.equal(db.successes, 1, "o contador de erros tem que ser zerado");
  });

  test("codigo errado gasta uma tentativa e diz quantas sobram", async () => {
    const db = lookups(await conhecido());
    const d = await decidePinLogin("0000", TOKEN, db);

    assert.equal(d.allowed, false);
    if (d.allowed) return;
    assert.equal(db.failures, 1);
    assert.match(d.message, new RegExp(`${MAX_ATTEMPTS - 1} tentativas`));
    assert.equal(d.deviceRejected, false, "um erro só não derruba o aparelho");
  });

  test("na última tentativa o aparelho perde a confiança", async () => {
    const device = await conhecido();
    const db = lookups(device, {
      registerFailure: async () => MAX_ATTEMPTS,
    });

    const d = await decidePinLogin("0000", TOKEN, db);

    assert.equal(d.allowed, false);
    if (d.allowed) return;
    assert.deepEqual(db.forgotten, [device.id]);
    assert.equal(d.deviceRejected, true);
    assert.match(d.message, /e-mail/i);
  });

  test("sem o cookie do aparelho o código nem é conferido", async () => {
    let consultou = false;
    const db = lookups(await conhecido(), {
      findDevice: async () => {
        consultou = true;
        return null;
      },
    });

    const d = await decidePinLogin(CODIGO, null, db);

    assert.equal(d.allowed, false);
    assert.equal(consultou, false, "foi ao banco sem ter cookie");
  });

  test("cookie de outro aparelho não entra", async () => {
    const db = lookups(await conhecido());
    const d = await decidePinLogin(CODIGO, "token-inventado", db);

    assert.equal(d.allowed, false);
    if (d.allowed) return;
    assert.equal(d.deviceRejected, true, "cookie inútil tem que ser apagado");
  });

  test("aparelho confiável de quem removeu o código não entra", async () => {
    const db = lookups({ id: "dev-1", userId: "user-1", pinHash: null });
    const d = await decidePinLogin(CODIGO, TOKEN, db);

    assert.equal(d.allowed, false);
    if (d.allowed) return;
    assert.equal(db.failures, 0, "não existe código para errar");
    assert.equal(d.deviceRejected, true);
  });

  test("código incompleto é recusado antes de tocar no banco", async () => {
    let consultou = false;
    const db = lookups(await conhecido(), {
      findDevice: async () => {
        consultou = true;
        return null;
      },
    });

    for (const errado of ["", "12", "12345", "abcd"]) {
      const d = await decidePinLogin(errado, TOKEN, db);
      assert.equal(d.allowed, false, `aceitou "${errado}"`);
    }

    assert.equal(consultou, false, "consultou o banco à toa");
  });

  test("a mensagem de aparelho desconhecido não diz se o código estava certo", async () => {
    const semAparelho = await decidePinLogin(CODIGO, "token-inventado", lookups(null));
    const semCodigo = await decidePinLogin(
      "0000",
      "token-inventado",
      lookups(null),
    );

    assert.equal(semAparelho.allowed, false);
    assert.equal(semCodigo.allowed, false);
    if (semAparelho.allowed || semCodigo.allowed) return;
    assert.equal(semAparelho.message, semCodigo.message);
  });
});

describe("normalizacao", () => {
  test("normalizePin fica só com os dígitos", () => {
    assert.equal(normalizePin(" 40 71 "), "4071");
    assert.equal(normalizePin("4-0-7-1"), "4071");
    assert.equal(normalizePin(null), "");
    assert.equal(normalizePin(undefined), "");
  });

  test("isPin exige exatamente quatro dígitos", () => {
    assert.equal(isPin("4071"), true);
    assert.equal(isPin("407"), false);
    assert.equal(isPin("40711"), false);
    assert.equal(isPin("40a1"), false);
    assert.equal(isPin(""), false);
  });
});
