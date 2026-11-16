import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  DISPLAY_NAME_MAX_LENGTH,
  EMAIL_MAX_LENGTH,
  parseDisplayName,
  parseReportEmail,
} from "../src/lib/account.ts";

/**
 * As regras da aba Conta: o que vira destino do relatorio e o que vira nome.
 *
 * O e-mail e o ponto sensivel — o que passar daqui e o `to` de um e-mail que o
 * servidor manda sozinho todo mes.
 */

const LOGIN = "henri@example.com";

describe("e-mail do relatorio", () => {
  test("em branco significa o e-mail de login", () => {
    for (const blank of ["", "   ", null, undefined]) {
      assert.deepEqual(parseReportEmail(blank, LOGIN), { ok: true, value: null });
    }
  });

  test("digitar o proprio e-mail de login tambem grava em branco", () => {
    // Assim o relatorio acompanha o e-mail da conta em vez de congelar o atual.
    assert.deepEqual(parseReportEmail("  Henri@Example.COM ", LOGIN), {
      ok: true,
      value: null,
    });
  });

  test("outro endereco e aceito, sem espacos e em minusculas", () => {
    assert.deepEqual(parseReportEmail("  Casa.Contas+mercado@Exemplo.com.br ", LOGIN), {
      ok: true,
      value: "casa.contas+mercado@exemplo.com.br",
    });
  });

  test("recusa o que nao e um endereco", () => {
    for (const invalid of [
      "henri",
      "henri@",
      "@exemplo.com",
      "henri@exemplo",
      "henri@exemplo.c",
      "henri@@exemplo.com",
      "henri silva@exemplo.com",
      "henri@exemplo.com.",
    ]) {
      const parsed = parseReportEmail(invalid, LOGIN);
      assert.equal(parsed.ok, false, `aceitou "${invalid}"`);
    }
  });

  test("recusa mais de um destinatario e nome na frente do endereco", () => {
    // O campo e para um endereco. Lista ou cabecalho aqui viraria um jeito de
    // mandar o relatorio da casa para quem a pessoa nao pretendia.
    for (const invalid of [
      "a@exemplo.com,b@exemplo.com",
      "a@exemplo.com; b@exemplo.com",
      "a@exemplo.com b@exemplo.com",
      "Henri <a@exemplo.com>",
      '"a@exemplo.com"',
      "a@exemplo.com\nBcc: b@exemplo.com",
      "a@exemplo.com\r\nbcc:b@exemplo.com",
    ]) {
      const parsed = parseReportEmail(invalid, LOGIN);
      assert.equal(parsed.ok, false, `aceitou ${JSON.stringify(invalid)}`);
    }
  });

  test("recusa endereco maior que o limite do padrao", () => {
    const longo = `${"a".repeat(EMAIL_MAX_LENGTH)}@exemplo.com`;
    assert.equal(parseReportEmail(longo, LOGIN).ok, false);
  });

  test("a recusa vem com uma mensagem para a tela", () => {
    const parsed = parseReportEmail("nao-e-email", LOGIN);
    assert.ok(!parsed.ok && parsed.message.length > 0);
  });
});

describe("nome", () => {
  test("apara e junta os espacos sobrando", () => {
    assert.deepEqual(parseDisplayName("  Henri   Bon  "), { ok: true, value: "Henri Bon" });
  });

  test("em branco volta a valer o nome da conta", () => {
    for (const blank of ["", "   ", null, undefined]) {
      assert.deepEqual(parseDisplayName(blank), { ok: true, value: null });
    }
  });

  test("quebra de linha nao sobrevive: o nome vai para o texto de um e-mail", () => {
    assert.deepEqual(parseDisplayName("Henri\r\nBcc: x@exemplo.com"), {
      ok: true,
      value: "Henri Bcc: x@exemplo.com",
    });
  });

  test("respeita o tamanho maximo", () => {
    assert.equal(parseDisplayName("a".repeat(DISPLAY_NAME_MAX_LENGTH)).ok, true);
    assert.equal(parseDisplayName("a".repeat(DISPLAY_NAME_MAX_LENGTH + 1)).ok, false);
  });
});
