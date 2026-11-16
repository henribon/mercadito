import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  decidePasswordLogin,
  hashPassword,
  LOCK_MINUTES,
  MAX_PASSWORD_ATTEMPTS,
  normalizeEmail,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  passwordProblem,
  verifyPassword,
  type PasswordAccount,
  type PasswordLookups,
} from "../src/lib/password.ts";

/**
 * Senha: entrar com e-mail + senha em qualquer aparelho.
 *
 * Sem o cookie do aparelho para segurar a porta, quem segura e o limite de
 * tentativas por conta. Estes testes fixam essa regra.
 */

const EMAIL = "henri@example.com";
const SENHA = "feijao-preto";
const AGORA = new Date("2026-11-16T12:00:00Z");

type Spy = PasswordLookups & { failures: number; successes: number; asked: string[] };

/** Banco de mentira: uma conta conhecida, com a senha acima. */
function lookups(account: PasswordAccount | null): Spy {
  const spy: Spy = {
    failures: 0,
    successes: 0,
    asked: [],
    findByEmail: async (email: string) => {
      spy.asked.push(email);
      return email === EMAIL ? account : null;
    },
    registerFailure: async () => {
      spy.failures += 1;
      const locked = spy.failures >= MAX_PASSWORD_ATTEMPTS;
      return {
        failedCount: spy.failures,
        lockedUntil: locked
          ? new Date(AGORA.getTime() + LOCK_MINUTES * 60_000).toISOString()
          : null,
      };
    },
    registerSuccess: async () => {
      spy.successes += 1;
    },
  };
  return spy;
}

async function conta(lockedUntil: string | null = null): Promise<PasswordAccount> {
  return { userId: "user-1", passwordHash: await hashPassword(SENHA), lockedUntil };
}

describe("hash da senha", () => {
  test("confere a senha certa e recusa a errada", async () => {
    const stored = await hashPassword(SENHA);

    assert.equal(await verifyPassword(SENHA, stored), true);
    assert.equal(await verifyPassword("feijao-branco", stored), false);
  });

  test("a mesma senha nunca gera o mesmo hash", async () => {
    assert.notEqual(await hashPassword(SENHA), await hashPassword(SENHA));
  });

  test("o hash nao carrega a senha", async () => {
    assert.ok(!(await hashPassword(SENHA)).includes(SENHA));
  });
});

describe("senha que pode ser cadastrada", () => {
  test("aceita a partir do tamanho minimo", () => {
    assert.equal(passwordProblem("a".repeat(PASSWORD_MIN_LENGTH)), null);
    assert.equal(passwordProblem(SENHA), null);
  });

  test("recusa curta demais, longa demais e o que nao e texto", () => {
    assert.match(passwordProblem("a".repeat(PASSWORD_MIN_LENGTH - 1))!, /pelo menos/);
    assert.match(passwordProblem("a".repeat(PASSWORD_MAX_LENGTH + 1))!, /no máximo/);
    assert.match(passwordProblem(undefined)!, /pelo menos/);
    assert.match(passwordProblem(123456)!, /pelo menos/);
  });

  test("recusa senha so de espacos", () => {
    assert.match(passwordProblem(" ".repeat(PASSWORD_MIN_LENGTH))!, /espaços/);
  });
});

describe("entrar com e-mail e senha", () => {
  test("senha certa entra e zera as tentativas", async () => {
    const db = lookups(await conta());

    const decision = await decidePasswordLogin(EMAIL, SENHA, db, AGORA);

    assert.deepEqual(decision, { allowed: true, userId: "user-1" });
    assert.equal(db.successes, 1);
    assert.equal(db.failures, 0);
  });

  test("o e-mail e comparado sem espacos nem maiusculas", async () => {
    const db = lookups(await conta());

    const decision = await decidePasswordLogin("  Henri@Example.COM ", SENHA, db, AGORA);

    assert.equal(decision.allowed, true);
    assert.deepEqual(db.asked, [EMAIL]);
    assert.equal(normalizeEmail(null), "");
  });

  test("a senha nao e aparada: espaco faz parte dela", async () => {
    const db = lookups(await conta());

    const decision = await decidePasswordLogin(EMAIL, ` ${SENHA}`, db, AGORA);

    assert.equal(decision.allowed, false);
  });

  test("sem e-mail ou sem senha nem consulta o banco", async () => {
    const db = lookups(await conta());

    for (const [email, senha] of [
      ["", SENHA],
      [EMAIL, ""],
      [null, null],
    ] as const) {
      const decision = await decidePasswordLogin(email, senha, db, AGORA);
      assert.equal(decision.allowed, false);
    }

    assert.deepEqual(db.asked, []);
  });

  test("senha errada conta uma tentativa", async () => {
    const db = lookups(await conta());

    const decision = await decidePasswordLogin(EMAIL, "errada", db, AGORA);

    assert.equal(decision.allowed, false);
    assert.equal(db.failures, 1);
    assert.equal(db.successes, 0);
  });

  test("e-mail desconhecido e senha errada dao a mesma resposta", async () => {
    const errada = await decidePasswordLogin(EMAIL, "errada", lookups(await conta()), AGORA);
    const desconhecido = await decidePasswordLogin(
      "ninguem@example.com",
      "errada",
      lookups(await conta()),
      AGORA,
    );
    const semSenha = await decidePasswordLogin(EMAIL, "errada", lookups(null), AGORA);

    // Quem esta de fora nao pode descobrir quais e-mails tem conta.
    assert.deepEqual(desconhecido, errada);
    assert.deepEqual(semSenha, errada);
  });

  test("e-mail desconhecido nao registra tentativa em conta nenhuma", async () => {
    const db = lookups(await conta());

    await decidePasswordLogin("ninguem@example.com", SENHA, db, AGORA);

    assert.equal(db.failures, 0);
    assert.equal(db.successes, 0);
  });

  test("avisa quando faltam poucas tentativas", async () => {
    const db = lookups(await conta());
    const mensagens: string[] = [];

    for (let i = 0; i < MAX_PASSWORD_ATTEMPTS - 1; i += 1) {
      const decision = await decidePasswordLogin(EMAIL, "errada", db, AGORA);
      assert.equal(decision.allowed, false);
      if (!decision.allowed) mensagens.push(decision.message);
    }

    assert.doesNotMatch(mensagens[0], /Resta/);
    assert.match(mensagens[MAX_PASSWORD_ATTEMPTS - 3], /Restam 2 tentativas/);
    assert.match(mensagens[MAX_PASSWORD_ATTEMPTS - 2], /Resta 1 tentativa/);
  });

  test("o ultimo erro tranca a senha", async () => {
    const db = lookups(await conta());

    let last = await decidePasswordLogin(EMAIL, "errada", db, AGORA);
    for (let i = 1; i < MAX_PASSWORD_ATTEMPTS; i += 1) {
      last = await decidePasswordLogin(EMAIL, "errada", db, AGORA);
    }

    assert.equal(last.allowed, false);
    if (!last.allowed) {
      assert.equal(last.locked, true);
      assert.match(last.message, new RegExp(`${LOCK_MINUTES} minutos`));
    }
  });

  test("com a senha trancada nem a senha certa entra", async () => {
    const ate = new Date(AGORA.getTime() + 7 * 60_000).toISOString();
    const db = lookups(await conta(ate));

    const decision = await decidePasswordLogin(EMAIL, SENHA, db, AGORA);

    assert.equal(decision.allowed, false);
    if (!decision.allowed) {
      assert.equal(decision.locked, true);
      assert.match(decision.message, /7 minutos/);
      assert.match(decision.message, /link por e-mail/);
    }
    // Trancada, a tentativa nem e conferida — nao conta erro nem acerto.
    assert.equal(db.failures, 0);
    assert.equal(db.successes, 0);
  });

  test("tranca vencida deixa de valer", async () => {
    const ontem = new Date(AGORA.getTime() - 60_000).toISOString();
    const db = lookups(await conta(ontem));

    const decision = await decidePasswordLogin(EMAIL, SENHA, db, AGORA);

    assert.equal(decision.allowed, true);
    assert.equal(db.successes, 1);
  });

  test("senha gigante e recusada sem gastar scrypt nem consultar o banco", async () => {
    const db = lookups(await conta());

    const decision = await decidePasswordLogin(
      EMAIL,
      "a".repeat(PASSWORD_MAX_LENGTH + 1),
      db,
      AGORA,
    );

    assert.equal(decision.allowed, false);
    assert.deepEqual(db.asked, []);
    assert.equal(db.failures, 0);
  });
});
