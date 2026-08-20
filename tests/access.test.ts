import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  decideAccess,
  normalizeCode,
  normalizeEmail,
  type AccessLookups,
} from "../src/lib/access.ts";

/**
 * Portao de entrada: quem consegue pedir um link de acesso.
 *
 * Antes disso qualquer pessoa que descobrisse a URL criava uma conta. Nao veria
 * a lista de ninguem, mas a porta ficava aberta — estes testes fixam a regra.
 */

/** Banco de mentira: uma casa com o codigo LSM53K e um usuario ja cadastrado. */
function lookups(overrides: Partial<AccessLookups> = {}): AccessLookups {
  return {
    userExists: async (email) => email === "henri@exemplo.com",
    householdCount: async () => 1,
    codeExists: async (code) => code === "LSM53K",
    ...overrides,
  };
}

describe("decideAccess", () => {
  test("quem já tem conta entra sem informar código", async () => {
    const d = await decideAccess("henri@exemplo.com", null, lookups());

    assert.equal(d.allowed, true);
    if (!d.allowed) return;
    assert.equal(d.reason, "usuario-conhecido");
  });

  test("reconhece o usuário mesmo com caixa e espaços diferentes", async () => {
    const d = await decideAccess("  HENRI@Exemplo.COM ", null, lookups());
    assert.equal(d.allowed, true);
  });

  test("estranho sem código é recusado", async () => {
    const d = await decideAccess("intruso@exemplo.com", null, lookups());

    assert.equal(d.allowed, false);
    if (d.allowed) return;
    assert.match(d.message, /privada/i);
  });

  test("estranho com código errado é recusado", async () => {
    const d = await decideAccess("intruso@exemplo.com", "XXXXXX", lookups());

    assert.equal(d.allowed, false);
    if (d.allowed) return;
    assert.match(d.message, /inválido/i);
  });

  test("estranho com o código certo entra", async () => {
    const d = await decideAccess("esposa@exemplo.com", "LSM53K", lookups());

    assert.equal(d.allowed, true);
    if (!d.allowed) return;
    assert.equal(d.reason, "codigo-valido");
  });

  test("aceita o código digitado torto: minúsculas e espaços", async () => {
    const d = await decideAccess("esposa@exemplo.com", " lsm 53k ", lookups());
    assert.equal(d.allowed, true);
  });

  test("primeiro acesso de todos é liberado sem código", async () => {
    // Nenhuma casa criada ainda: é quem vai criar a primeira e gerar o código.
    const d = await decideAccess(
      "henri@exemplo.com",
      null,
      lookups({ userExists: async () => false, householdCount: async () => 0 }),
    );

    assert.equal(d.allowed, true);
    if (!d.allowed) return;
    assert.equal(d.reason, "primeiro-acesso");
  });

  test("depois que existe uma casa, o portão fecha", async () => {
    const d = await decideAccess(
      "outro@exemplo.com",
      null,
      lookups({ userExists: async () => false, householdCount: async () => 1 }),
    );
    assert.equal(d.allowed, false);
  });

  test("e-mail vazio é recusado antes de tocar no banco", async () => {
    let tocou = false;
    const d = await decideAccess("   ", "LSM53K", {
      userExists: async () => {
        tocou = true;
        return false;
      },
      householdCount: async () => {
        tocou = true;
        return 1;
      },
      codeExists: async () => {
        tocou = true;
        return true;
      },
    });

    assert.equal(d.allowed, false);
    assert.equal(tocou, false, "consultou o banco à toa");
  });

  test("não vaza se o código existe quando o usuário já é conhecido", async () => {
    // Usuario conhecido nao deve nem chegar a consultar o codigo.
    let consultouCodigo = false;
    await decideAccess(
      "henri@exemplo.com",
      "QUALQUER",
      lookups({
        codeExists: async () => {
          consultouCodigo = true;
          return false;
        },
      }),
    );
    assert.equal(consultouCodigo, false);
  });
});

describe("normalizacao", () => {
  test("normalizeCode deixa em maiúsculas e sem espaços", () => {
    assert.equal(normalizeCode(" lsm 53 k "), "LSM53K");
    assert.equal(normalizeCode(null), "");
    assert.equal(normalizeCode(undefined), "");
  });

  test("normalizeEmail deixa em minúsculas e sem espaços nas pontas", () => {
    assert.equal(normalizeEmail("  Henri@Exemplo.COM "), "henri@exemplo.com");
    assert.equal(normalizeEmail(null), "");
  });
});
