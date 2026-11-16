import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { looksLikeNfce, matchScannedKey } from "../src/lib/nfce/copied.ts";
import { parseNfceText } from "../src/lib/nfce/parse.ts";

/**
 * A volta para o app depois que a SEFAZ recusa o QR Code: o que da area de
 * transferencia pode ser enviado para leitura, e se a pagina copiada e mesmo a
 * da nota escaneada.
 */

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) => readFileSync(join(here, "fixtures", name), "utf8");

const colado = fixture("nfce-sp-colado.txt");

const CHAVE = "35240612345678000190650010000012341234567897";
const OUTRA_CHAVE = "35240612345678000190650010000012341234567890";

describe("o que esta copiado e uma nota?", () => {
  test("reconhece a pagina da nota copiada do navegador", () => {
    assert.equal(looksLikeNfce(colado), true);
  });

  test("reconhece mesmo quando o navegador quebra a linha de cada valor", () => {
    assert.equal(looksLikeNfce(colado.split("\t").join("\n")), true);
  });

  test("reconhece o HTML da pagina, para quem copiou o codigo-fonte", () => {
    assert.equal(looksLikeNfce(fixture("nfce-sp.html")), true);
  });

  test("nao envia o que nao tem nada a ver com um cupom", () => {
    // E o caso que importa: a area de transferencia e lida sozinha quando a
    // pessoa volta ao app, e pode ter qualquer coisa dentro.
    for (const alheio of [
      "",
      "   ",
      null,
      undefined,
      "minha-senha-do-banco-123",
      "https://www.nfce.fazenda.sp.gov.br/qrcode?p=" + CHAVE + "|2|1|1|abcdef",
      "Oi, compra leite e arroz? Qtde de cada: 2",
      "Lista: arroz 5kg, leite 1L, valor unitario 4,49",
    ]) {
      assert.equal(looksLikeNfce(alheio), false, `enviaria ${JSON.stringify(alheio)}`);
    }
  });

  test("nao envia a pagina de bloqueio nem a de erro do portal", () => {
    assert.equal(looksLikeNfce(fixture("nfce-sp-bloqueio.html")), false);
    assert.equal(looksLikeNfce(fixture("nfce-sp-erro-qr.html")), false);
  });
});

describe("a pagina copiada e a da nota escaneada?", () => {
  test("a chave do texto colado bate com a do QR Code", () => {
    // O portal imprime a chave em blocos de quatro digitos.
    assert.equal(parseNfceText(colado).accessKey, CHAVE);
    assert.equal(matchScannedKey(parseNfceText(colado).accessKey, CHAVE), "same");
    assert.equal(matchScannedKey("3524 0612 3456 7800 0190 6500 1000 0012 3412 3456 7897", CHAVE), "same");
  });

  test("nota de outra compra e recusada", () => {
    assert.equal(matchScannedKey(OUTRA_CHAVE, CHAVE), "different");
  });

  test("sem chave de um dos lados nao ha o que comparar", () => {
    // Copia que cortou o rodape da pagina: a nota ainda e lida, e a chave que
    // vale e a do QR Code.
    assert.equal(matchScannedKey(null, CHAVE), "unknown");
    assert.equal(matchScannedKey(undefined, CHAVE), "unknown");
    assert.equal(matchScannedKey("", CHAVE), "unknown");
    assert.equal(matchScannedKey(CHAVE, null), "unknown");
    assert.equal(matchScannedKey("123", CHAVE), "unknown");
  });
});
