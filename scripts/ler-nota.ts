/**
 * Le uma nota pelo terminal, do mesmo jeito que a rota /api/nfce faz no
 * servidor — o mesmo pedido ao portal e o mesmo parser.
 *
 * Serve para saber, sem abrir o app, se a SEFAZ esta respondendo ao servidor:
 *
 *   npm run nfce:ler -- "https://www.nfce.fazenda.sp.gov.br/qrcode?p=..."
 *
 * Aceita o link do QR Code ou a chave de 44 digitos. Faz UM pedido ao portal.
 */
import { detectSefazError, parseNfceHtml } from "../src/lib/nfce/parse.ts";
import { fetchPortalPage } from "../src/lib/nfce/portal.ts";
import { parseQrContent } from "../src/lib/nfce/qr.ts";

const input = process.argv.slice(2).join(" ").trim();

if (!input) {
  console.error('Uso: npm run nfce:ler -- "<link do QR Code ou chave de 44 dígitos>"');
  process.exit(1);
}

const parsed = parseQrContent(input);

if (!parsed.ok) {
  console.error(`✗ ${parsed.message}`);
  process.exit(1);
}

console.log(`Consultando ${parsed.consultaUrl}\n`);

let page;
try {
  page = await fetchPortalPage(parsed.consultaUrl);
} catch (cause) {
  console.error(`✗ Não consegui falar com o portal: ${cause instanceof Error ? cause.message : cause}`);
  process.exit(1);
}

console.log(`HTTP ${page.status}, ${page.html.length} caracteres`);

// Status 200 nao basta: o portal tambem responde 200 quando recusa.
const problem = detectSefazError(page.html);

if (problem) {
  console.error(`✗ ${problem.reason}: ${problem.message}`);
  if (problem.detail) console.error(`  ${problem.detail}`);
  process.exit(1);
}

const receipt = parseNfceHtml(page.html);

if (receipt.items.length === 0) {
  console.error("✗ A página veio, mas sem itens — o layout pode ter mudado.");
  process.exit(1);
}

console.log(`✓ ${receipt.storeName ?? "Estabelecimento não identificado"}`);
console.log(`  ${receipt.items.length} itens, total ${receipt.paidAmount ?? receipt.totalAmount ?? "?"}`);

for (const item of receipt.items.slice(0, 5)) {
  console.log(`  · ${item.description} — ${item.quantity} ${item.unit} × ${item.unitPrice} = ${item.totalPrice}`);
}
if (receipt.items.length > 5) console.log(`  … e mais ${receipt.items.length - 5}`);
