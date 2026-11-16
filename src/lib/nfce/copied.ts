/**
 * A nota copiada do navegador depois que a SEFAZ recusa a consulta.
 *
 * Quando o portal bloqueia o servidor, quem consegue abrir a nota e o aparelho
 * da pessoa. O app guarda o link do QR Code, ela abre a pagina, copia e volta —
 * e a leitura acontece sozinha, a partir da area de transferencia.
 *
 * Aqui ficam as duas decisoes dessa volta, sem navegador e sem rede, para serem
 * testadas a seco. Nada de cheerio neste arquivo: ele roda no cliente.
 */

/**
 * O texto copiado e a pagina de uma NFC-e?
 *
 * E o que decide se o conteudo da area de transferencia sai do aparelho. Ela
 * pode ter qualquer coisa — uma senha, uma conversa —, e so o que tem a cara do
 * cupom (os rotulos que o portal imprime em cada item) e enviado para leitura.
 */
export function looksLikeNfce(text: string | null | undefined): boolean {
  if (!text) return false;

  return /Qtde?\.?\s*:?\s*[\d.,]+/i.test(text) && /Vl\.?\s*Unit/i.test(text);
}

export type KeyMatch =
  /** A pagina copiada e a da nota escaneada. */
  | "same"
  /** A pagina copiada e de outra nota. */
  | "different"
  /** Um dos lados nao trouxe a chave: nao ha o que comparar. */
  | "unknown";

/**
 * A nota copiada e a mesma do QR Code que foi lido?
 *
 * Com a aba da SEFAZ aberta ao lado e facil copiar a nota errada (a de ontem,
 * ainda aberta). A chave de acesso esta nos dois lugares e resolve a duvida.
 */
export function matchScannedKey(
  copiedKey: string | null | undefined,
  scannedKey: string | null | undefined,
): KeyMatch {
  const copied = (copiedKey ?? "").replace(/\D/g, "");
  const scanned = (scannedKey ?? "").replace(/\D/g, "");

  if (copied.length !== 44 || scanned.length !== 44) return "unknown";

  return copied === scanned ? "same" : "different";
}
