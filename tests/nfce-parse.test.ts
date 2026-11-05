import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  parseBrNumber,
  parseBrDateTime,
  parseNfceHtml,
  detectSefazError,
  parseNfceText,
  parseNfcePaste,
} from "../src/lib/nfce/parse.ts";
import { parseQrContent, isValidAccessKey } from "../src/lib/nfce/qr.ts";
import { normalizeName, similarity, rankMatches } from "../src/lib/normalize.ts";

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, "fixtures", "nfce-sp.html"), "utf8");

test("parseBrNumber entende o formato brasileiro", () => {
  assert.equal(parseBrNumber("27,90"), 27.9);
  assert.equal(parseBrNumber("1.234,56"), 1234.56);
  assert.equal(parseBrNumber("Vl. Unit.:  4,49"), 4.49);
  assert.equal(parseBrNumber("Qtde.:1,235"), 1.235);
  assert.equal(parseBrNumber("Qtde.:6"), 6);
  assert.equal(parseBrNumber(""), null);
  assert.equal(parseBrNumber("sem numero"), null);
});

test("parseBrDateTime converte para ISO no fuso de Brasilia", () => {
  const iso = parseBrDateTime("12/06/2024", "19:33:41");
  assert.equal(iso, "2024-06-12T22:33:41.000Z");
  assert.equal(parseBrDateTime("32/13/2024", "10:00:00"), null);
});

test("parseNfceHtml extrai o cabecalho da nota", () => {
  const receipt = parseNfceHtml(html);

  assert.equal(receipt.storeName, "SUPERMERCADO MODELO LTDA");
  assert.equal(receipt.storeCnpj, "12.345.678/0001-90");
  assert.equal(receipt.accessKey, "35240612345678000190650010000012341234567897");
  assert.equal(receipt.purchasedAt, "2024-06-12T22:33:41.000Z");
});

test("parseNfceHtml extrai todos os itens com quantidade e preco", () => {
  const receipt = parseNfceHtml(html);

  assert.equal(receipt.items.length, 4);

  const [arroz, leite, banana, detergente] = receipt.items;

  assert.equal(arroz.description, "ARROZ TIO JOAO T1 5KG");
  assert.equal(arroz.code, "000123");
  assert.equal(arroz.quantity, 1);
  assert.equal(arroz.unit, "UN");
  assert.equal(arroz.unitPrice, 27.9);
  assert.equal(arroz.totalPrice, 27.9);

  assert.equal(leite.quantity, 6);
  assert.equal(leite.unitPrice, 4.49);
  assert.equal(leite.totalPrice, 26.94);

  // item vendido a peso
  assert.equal(banana.quantity, 1.235);
  assert.equal(banana.unit, "KG");
  assert.equal(banana.totalPrice, 9.87);

  assert.equal(detergente.description, "DET LIQ YPE NEUTRO 500ML");
  assert.equal(detergente.totalPrice, 5.58);
});

test("parseNfceHtml extrai os totais", () => {
  const receipt = parseNfceHtml(html);

  assert.equal(receipt.totalAmount, 70.29);
  assert.equal(receipt.discount, 1.5);
  assert.equal(receipt.paidAmount, 68.79);
});

test("parseNfceHtml nao quebra com HTML vazio", () => {
  const receipt = parseNfceHtml("<html><body></body></html>");

  assert.equal(receipt.items.length, 0);
  assert.equal(receipt.storeName, null);
  assert.equal(receipt.totalAmount, null);
});

test("isValidAccessKey valida o digito verificador", () => {
  assert.equal(isValidAccessKey("35240612345678000190650010000012341234567897"), true);
  // ultimo digito trocado
  assert.equal(isValidAccessKey("35240612345678000190650010000012341234567890"), false);
  assert.equal(isValidAccessKey("123"), false);
});

test("parseQrContent aceita a URL completa do QR de SP", () => {
  const raw =
    "https://www.nfce.fazenda.sp.gov.br/qrcode?p=35240612345678000190650010000012341234567897|2|1|1|abcdef0123456789";
  const result = parseQrContent(raw);

  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(result.accessKey, "35240612345678000190650010000012341234567897");
  assert.equal(result.uf, "SP");
  assert.match(result.consultaUrl, /ConsultaQRCode\.aspx\?p=/);
});

test("parseQrContent aceita so a chave de acesso", () => {
  const result = parseQrContent("35240612345678000190650010000012341234567897");

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.uf, "SP");
});

test("parseQrContent recusa nota de outra UF com mensagem util", () => {
  // mesma chave com prefixo de MG (31) e DV recalculado
  const mg = "31240612345678000190650010000012341234567898";
  const result = parseQrContent(mg);

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, "unsupported-uf");
  assert.equal(result.uf, "MG");
});

test("parseQrContent recusa entrada vazia ou sem chave", () => {
  assert.equal(parseQrContent("").ok, false);
  assert.equal(parseQrContent("qualquer texto").ok, false);
});

test("normalizeName ignora ordem, acento e embalagem", () => {
  assert.equal(normalizeName("Leite Integral 1L"), normalizeName("integral leite"));
  assert.equal(normalizeName("Açúcar Refinado"), normalizeName("ACUCAR REFINADO"));
  assert.equal(normalizeName("Arroz 5KG"), "ARROZ");
});

test("similarity casa descricao da nota com nome da lista", () => {
  assert.ok(similarity("LEITE INTEG ITALAC 1L", "Leite integral") > 0.6);
  assert.ok(similarity("DET LIQ YPE NEUTRO 500ML", "Detergente") > 0.5);
  assert.ok(similarity("ARROZ TIO JOAO T1 5KG", "Sabao em po") < 0.4);
});

test("rankMatches ordena e corta os candidatos fracos", () => {
  const catalogo = [
    { name: "Leite integral" },
    { name: "Leite condensado" },
    { name: "Sabao em po" },
  ];

  const ranked = rankMatches("LEITE INTEG ITALAC 1L", catalogo, (p) => p.name);

  assert.ok(ranked.length >= 1);
  assert.equal(ranked[0].item.name, "Leite integral");
  assert.ok(!ranked.some((r) => r.item.name === "Sabao em po"));
});

/* -------------------------------------------------------------------------- */
/* Respostas que a SEFAZ passou a devolver em vez da nota                      */
/* -------------------------------------------------------------------------- */

const htmlBloqueio = readFileSync(join(here, "fixtures", "nfce-sp-bloqueio.html"), "utf8");
const htmlErroQr = readFileSync(join(here, "fixtures", "nfce-sp-erro-qr.html"), "utf8");

test("detectSefazError reconhece o bloqueio do portal", () => {
  const problem = detectSefazError(htmlBloqueio);

  assert.ok(problem, "a pagina de rejeicao tem de ser detectada");
  assert.equal(problem.reason, "blocked");
  // Antes essa pagina caia em "nao encontrei itens / o layout mudou".
  assert.match(problem.message, /navegador/i);
});

test("detectSefazError le o erro que a pagina injeta por JavaScript", () => {
  const problem = detectSefazError(htmlErroQr);

  assert.ok(problem, "o erro do portal tem de chegar ao usuario");
  assert.equal(problem.reason, "portal");
  assert.match(problem.detail ?? "", /Hash QR Code inv[áa]lido/i);
  // sem tag nem entidade sobrando no texto mostrado
  assert.doesNotMatch(problem.message, /<\/?br|<li|&#\d+;/i);
});

test("detectSefazError nao inventa erro numa nota boa", () => {
  assert.equal(detectSefazError(html), null);
});

test("detectSefazError ignora o texto dos <script> da pagina", () => {
  // "erro" solto dentro de script nao e mensagem para o usuario
  const comScript =
    "<html><body><script>var msgErro = 'erro';</script><p>Nota normal</p></body></html>";

  assert.equal(detectSefazError(comScript), null);
});

test("parseQrContent preserva o + do payload de contingencia", () => {
  // digVal vem em base64 e pode trazer "+"; URLSearchParams viraria espaco
  const raw =
    "https://www.nfce.fazenda.sp.gov.br/qrcode?p=35240612345678000190650010000012341234567897|2|1|" +
    "20240612193341|70.29|2.13|aB+cD/efGh=|000001|abcdef0123456789";
  const result = parseQrContent(raw);

  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.ok(result.payload.includes("aB+cD/efGh="), "o + tem de sobreviver");
  assert.match(result.consultaUrl, /aB%2BcD/);
  assert.doesNotMatch(result.consultaUrl, /aB%20cD/);
});

/* -------------------------------------------------------------------------- */
/* Leitura do texto colado da pagina                                          */
/* -------------------------------------------------------------------------- */

const colado = readFileSync(join(here, "fixtures", "nfce-sp-colado.txt"), "utf8");

test("parseNfceText le a nota colada igual ao parser de HTML", () => {
  const doTexto = parseNfceText(colado);
  const doHtml = parseNfceHtml(html);

  assert.equal(doTexto.storeName, doHtml.storeName);
  assert.equal(doTexto.storeCnpj, doHtml.storeCnpj);
  assert.equal(doTexto.accessKey, doHtml.accessKey);
  assert.equal(doTexto.purchasedAt, doHtml.purchasedAt);
  assert.equal(doTexto.totalAmount, doHtml.totalAmount);
  assert.equal(doTexto.discount, doHtml.discount);
  assert.equal(doTexto.paidAmount, doHtml.paidAmount);
  assert.deepEqual(doTexto.items, doHtml.items);
});

test("parseNfceText acha os itens com o valor da linha em outra linha", () => {
  // alguns navegadores copiam cada celula da tabela numa linha
  const quebrado = colado.split("\t").join("\n");
  const receipt = parseNfceText(quebrado);

  assert.equal(receipt.items.length, 4);

  const [arroz, , banana] = receipt.items;
  assert.equal(arroz.description, "ARROZ TIO JOAO T1 5KG");
  assert.equal(arroz.totalPrice, 27.9);
  assert.equal(banana.quantity, 1.235);
  assert.equal(banana.unit, "KG");
  assert.equal(banana.totalPrice, 9.87);
});

test("parseNfceText nao confunde o menu do site com o nome do mercado", () => {
  const receipt = parseNfceText(colado);

  assert.equal(receipt.storeName, "SUPERMERCADO MODELO LTDA");
});

test("parseNfceText confere o digito verificador da chave colada", () => {
  // o cupom tras varios numeros longos; so a chave real passa no modulo 11
  const comRuido =
    "1111111111111111111111111111111111111111111\n" +
    "99999999999999999999999999999999999999999999\n" +
    colado;
  const receipt = parseNfceText(comRuido);

  assert.equal(receipt.accessKey, "35240612345678000190650010000012341234567897");
});

test("parseNfceText devolve nota vazia quando o texto nao e uma nota", () => {
  const receipt = parseNfceText("qualquer coisa colada por engano");

  assert.equal(receipt.items.length, 0);
  assert.equal(receipt.accessKey, null);
  assert.equal(receipt.totalAmount, null);
});

test("parseNfcePaste aceita tanto o HTML quanto o texto da pagina", () => {
  assert.equal(parseNfcePaste(html).items.length, 4);
  assert.equal(parseNfcePaste(colado).items.length, 4);
});

test("parseNfcePaste cai para o texto quando o HTML nao tem os itens", () => {
  // pagina copiada com a marcacao do site, mas sem a tabela do portal
  const hibrido = `<div class="pagina"><p>${colado.split("\n").join("</p><p>")}</p></div>`;
  const receipt = parseNfcePaste(hibrido);

  assert.equal(receipt.items.length, 4);
  assert.equal(receipt.storeName, "SUPERMERCADO MODELO LTDA");
});
