import * as cheerio from "cheerio";

/**
 * Extracao dos itens de uma NFC-e a partir do HTML da Consulta Publica da
 * SEFAZ-SP (aplicacao "NFCeConsultaPublica").
 *
 * O HTML e gerado por um ASP.NET WebForms antigo e usa classes proprias em vez
 * de estrutura semantica. As classes abaixo sao estaveis ha anos, mas o parser
 * e deliberadamente tolerante: se um seletor falhar, cai para regex sobre o
 * texto, e o app sempre oferece revisao manual antes de salvar.
 */

export type NfceItem = {
  description: string;
  code: string | null;
  quantity: number;
  unit: string;
  unitPrice: number | null;
  totalPrice: number | null;
  position: number;
};

export type NfceReceipt = {
  storeName: string | null;
  storeCnpj: string | null;
  accessKey: string | null;
  purchasedAt: string | null; // ISO 8601
  totalAmount: number | null;
  discount: number | null;
  paidAmount: number | null;
  items: NfceItem[];
};

/** "1.234,56" -> 1234.56 ; "" / lixo -> null */
export function parseBrNumber(raw: string | null | undefined): number | null {
  if (!raw) return null;

  const match = raw.replace(/\s/g, "").match(/-?[\d.]*,?\d+/);
  if (!match) return null;

  const normalized = match[0].replace(/\./g, "").replace(",", ".");
  const value = Number(normalized);

  return Number.isFinite(value) ? value : null;
}

/**
 * "12/06/2024 19:33:41" -> ISO em horario de Brasilia.
 * O Brasil nao tem mais horario de verao, entao -03:00 vale o ano inteiro.
 */
export function parseBrDateTime(date: string, time?: string): string | null {
  const [day, month, year] = date.split("/");
  if (!day || !month || !year) return null;

  const clock = time && /^\d{2}:\d{2}(:\d{2})?$/.test(time)
    ? time.length === 5 ? `${time}:00` : time
    : "12:00:00";

  const iso = `${year}-${month}-${day}T${clock}-03:00`;
  const parsed = new Date(iso);

  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/** Texto do primeiro seletor que existir e nao estiver vazio. */
function firstText($: cheerio.CheerioAPI, selectors: string[]): string | null {
  for (const selector of selectors) {
    const text = $(selector).first().text().trim();
    if (text) return text;
  }
  return null;
}

/** Valor de uma linha do bloco de totais, casando pelo texto do rotulo. */
function totalByLabel($: cheerio.CheerioAPI, pattern: RegExp): number | null {
  const labels = $("#totalNota label, #totalNota span").toArray();

  for (const el of labels) {
    const label = $(el).text().trim();
    if (!pattern.test(label)) continue;

    // O numero fica no irmao seguinte, ou no .totalNumb da mesma linha.
    const value =
      parseBrNumber($(el).next().text()) ??
      parseBrNumber($(el).parent().find(".totalNumb").first().text());

    if (value !== null) return value;
  }

  return null;
}

export function parseNfceHtml(html: string): NfceReceipt {
  const $ = cheerio.load(html);
  const pageText = $("body").text().replace(/\s+/g, " ");

  // ---- Emitente -----------------------------------------------------------
  const storeName = firstText($, [".txtTopo", "#u20 .txtTopo", "#conteudo .txtTopo"]);
  const cnpjMatch = pageText.match(/\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/);
  const storeCnpj = cnpjMatch ? cnpjMatch[0] : null;

  // ---- Chave de acesso ----------------------------------------------------
  const keyText = $("#chaveAcesso, .chave, .chave-acesso").text() || pageText;
  const keyMatch = keyText.replace(/\s/g, "").match(/\d{44}/);
  const accessKey = keyMatch ? keyMatch[0] : null;

  // ---- Data de emissao ----------------------------------------------------
  const emissionMatch = pageText.match(
    /Emiss[ãa]o[:\s]*?(\d{2}\/\d{2}\/\d{4})(?:\s+(\d{2}:\d{2}(?::\d{2})?))?/i,
  );
  const fallbackDate = pageText.match(/(\d{2}\/\d{2}\/\d{4})\s+(\d{2}:\d{2}:\d{2})/);
  const purchasedAt = emissionMatch
    ? parseBrDateTime(emissionMatch[1], emissionMatch[2])
    : fallbackDate
      ? parseBrDateTime(fallbackDate[1], fallbackDate[2])
      : null;

  // ---- Itens --------------------------------------------------------------
  const rows = $("#tabResult tr").length
    ? $("#tabResult tr")
    : $("tr").filter((_, el) => $(el).find(".txtTit").length > 0);

  const items: NfceItem[] = [];

  rows.each((index, el) => {
    const row = $(el);
    const description = row.find(".txtTit").first().text().trim();
    if (!description) return;

    const code = row.find(".RCod").first().text().replace(/\D/g, "") || null;
    const quantity = parseBrNumber(row.find(".Rqtd").first().text()) ?? 1;
    const unit =
      row.find(".RUN").first().text().split(":").pop()?.trim().toUpperCase() || "UN";
    const unitPrice = parseBrNumber(row.find(".RvlUnit").first().text());
    const totalPrice = parseBrNumber(row.find(".valor").first().text());

    items.push({
      description,
      code,
      quantity,
      unit,
      unitPrice: unitPrice ?? (totalPrice !== null && quantity ? totalPrice / quantity : null),
      totalPrice: totalPrice ?? (unitPrice !== null ? unitPrice * quantity : null),
      position: index,
    });
  });

  // ---- Totais -------------------------------------------------------------
  const totalAmount =
    totalByLabel($, /valor\s+total/i) ??
    parseBrNumber(pageText.match(/Valor\s+total\s+R\$\s*([\d.,]+)/i)?.[1]);
  const discount =
    totalByLabel($, /desconto/i) ??
    parseBrNumber(pageText.match(/Desconto\s+R\$\s*([\d.,]+)/i)?.[1]);
  const paidAmount =
    totalByLabel($, /valor\s+a\s+pagar/i) ??
    parseBrNumber(pageText.match(/Valor\s+a\s+pagar\s+R\$\s*([\d.,]+)/i)?.[1]);

  const itemsSum = items.reduce((acc, item) => acc + (item.totalPrice ?? 0), 0);

  return {
    storeName,
    storeCnpj,
    accessKey,
    purchasedAt,
    totalAmount: totalAmount ?? (itemsSum > 0 ? Number(itemsSum.toFixed(2)) : null),
    discount,
    paidAmount: paidAmount ?? totalAmount ?? null,
    items,
  };
}

/** A SEFAZ responde 200 com pagina de erro; detectamos pelo texto. */
export function detectSefazError(html: string): string | null {
  const text = cheerio.load(html)("body").text().replace(/\s+/g, " ");

  if (/n[ãa]o\s+(foi\s+)?encontrad/i.test(text)) {
    return "A SEFAZ nao encontrou essa nota. Ela pode levar alguns minutos para ser publicada.";
  }
  if (/captcha/i.test(text)) {
    return "A SEFAZ pediu verificacao de robo. Abra a nota no navegador e cole os dados manualmente.";
  }
  if (/erro/i.test(text) && text.length < 600) {
    return "A SEFAZ retornou um erro ao consultar essa nota.";
  }
  return null;
}
