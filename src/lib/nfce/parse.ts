import * as cheerio from "cheerio";

import { isValidAccessKey } from "./qr.ts";

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

/* -------------------------------------------------------------------------- */
/* Leitura do texto colado                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Extracao dos itens a partir do TEXTO da pagina, e nao do HTML.
 *
 * Desde novembro/2026 a SEFAZ-SP recusa a consulta automatica feita pelo
 * servidor (ver detectSefazError). No navegador do usuario a mesma pagina abre
 * normalmente, entao o caminho que sobra e ele selecionar tudo, copiar e colar
 * aqui. O que chega e texto renderizado: as classes do HTML somem e so restam
 * os rotulos que o portal imprime ("(Codigo: ...)", "Qtde.:", "Vl. Unit.:").
 *
 * O parser e proposital-mente tolerante com o recorte: o navegador pode juntar
 * a linha toda ou quebrar o valor da linha em outra, e a tela de conferencia
 * deixa corrigir item por item antes de salvar.
 */

/** Rotulos que o portal imprime em cada item do cupom. */
const ITEM_SCAN =
  /\(\s*C[oó]digo:?\s*([^)]*?)\s*\)\s*Qtde?\.?\s*:?\s*([\d.,]+)\s*UN\.?\s*:?\s*(\S+)\s*Vl\.?\s*Unit\.?\s*:?\s*([\d.,]+)\s*([\d.,]+)?/gi;

/** Valor em reais no formato do cupom: 27,90 / 1.234,56 */
const MONEY = /^\d{1,3}(?:\.\d{3})*,\d{2}$/;

/** Texto limpo: sem NBSP, sem espaco repetido, sem linha vazia. */
function cleanLines(raw: string): string[] {
  return raw
    .replace(/ /g, " ")
    .split(/\r?\n/)
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter((line) => line.length > 0);
}

/**
 * A descricao do item fica ANTES do "(Codigo: ...)", no pedaco de texto entre
 * um item e o anterior. Esse pedaco pode trazer tambem o valor da linha de
 * cima, que o navegador jogou para ca.
 */
function descriptionFromGap(gap: string): string {
  const parts = gap
    .split(/[\n\t]+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && !/^[\d.,]+$/.test(part));

  const last = parts[parts.length - 1] ?? "";

  // valor da linha anterior colado no inicio da descricao
  const withoutMoney = last.replace(/^\d{1,3}(?:\.\d{3})*,\d{2}\s+/, "").trim();

  // Colagem sem quebra de linha nenhuma: nao da para saber onde a descricao
  // comeca, entao cortamos pelo fim — o usuario ajusta na conferencia.
  if (withoutMoney.length <= 70) return withoutMoney;

  return withoutMoney.slice(-70).replace(/^\S*\s/, "").trim();
}

/** Itens do cupom a partir do texto colado. */
function itemsFromText(text: string): NfceItem[] {
  const items: NfceItem[] = [];
  let cursor = 0;

  for (const match of text.matchAll(ITEM_SCAN)) {
    const [whole, rawCode, rawQty, rawUnit, rawUnitPrice, rawTotal] = match;
    const start = match.index ?? 0;

    const description = descriptionFromGap(text.slice(cursor, start));
    cursor = start + whole.length;

    if (!description) continue;

    const quantity = parseBrNumber(rawQty) ?? 1;
    const unitPrice = parseBrNumber(rawUnitPrice);

    // Quando o navegador quebra a tabela, o valor da linha cai depois do
    // trecho casado, sozinho na linha seguinte.
    const after = text.slice(cursor).match(/^\s*([\d.]*,\d{2})\b/);
    const totalPrice = parseBrNumber(rawTotal) ?? parseBrNumber(after?.[1]);

    items.push({
      description,
      code: rawCode.replace(/\D/g, "") || null,
      quantity,
      unit: rawUnit.replace(/[^A-Za-zÇç]/g, "").toUpperCase() || "UN",
      unitPrice:
        unitPrice ?? (totalPrice !== null && quantity ? totalPrice / quantity : null),
      totalPrice: totalPrice ?? (unitPrice !== null ? unitPrice * quantity : null),
      position: items.length,
    });
  }

  return items;
}

/** Nome do emitente: vem logo acima (ou na frente) do CNPJ na pagina. */
function storeNameFromLines(lines: string[]): string | null {
  const index = lines.findIndex((line) => /CNPJ/i.test(line));
  if (index < 0) return null;

  const beforeCnpj = lines[index].split(/CNPJ/i)[0].trim();
  const candidate = beforeCnpj || lines[index - 1] || "";

  // ":" sobrando de "Emitente:" e afins
  const name = candidate.replace(/^.*?:\s*/, "").trim() || candidate.trim();

  return name.length > 1 ? name : null;
}

/**
 * Chave de acesso: o portal imprime em grupos de 4 digitos. Procuramos linha
 * por linha para nao emendar numeros de linhas diferentes numa chave falsa, e
 * conferimos o digito verificador.
 */
function accessKeyFromLines(lines: string[]): string | null {
  let fallback: string | null = null;

  for (const line of lines) {
    const match = line.replace(/\s/g, "").match(/\d{44}/);
    if (!match) continue;

    if (isValidAccessKey(match[0])) return match[0];
    fallback ??= match[0];
  }

  return fallback;
}

/** Monta a nota a partir do texto que o usuario colou da pagina da SEFAZ. */
export function parseNfceText(raw: string): NfceReceipt {
  const lines = cleanLines(raw);
  const text = lines.join("\n");

  const items = itemsFromText(text);

  const cnpjMatch = text.match(/\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/);

  const emissionMatch = text.match(
    /Emiss[ãa]o[:\s]*?(\d{2}\/\d{2}\/\d{4})(?:\s+(\d{2}:\d{2}(?::\d{2})?))?/i,
  );
  const fallbackDate = text.match(/(\d{2}\/\d{2}\/\d{4})\s+(\d{2}:\d{2}:\d{2})/);

  const totalAmount = parseBrNumber(
    text.match(/Valor\s+total\s*(?:R\$)?\s*([\d.,]+)/i)?.[1],
  );
  const discount = parseBrNumber(text.match(/Desconto\s*(?:R\$)?\s*([\d.,]+)/i)?.[1]);
  const paidAmount = parseBrNumber(
    text.match(/Valor\s+a\s+pagar\s*(?:R\$)?\s*([\d.,]+)/i)?.[1],
  );

  const itemsSum = items.reduce((acc, item) => acc + (item.totalPrice ?? 0), 0);

  return {
    storeName: storeNameFromLines(lines),
    storeCnpj: cnpjMatch ? cnpjMatch[0] : null,
    accessKey: accessKeyFromLines(lines),
    purchasedAt: emissionMatch
      ? parseBrDateTime(emissionMatch[1], emissionMatch[2])
      : fallbackDate
        ? parseBrDateTime(fallbackDate[1], fallbackDate[2])
        : null,
    totalAmount: totalAmount ?? (itemsSum > 0 ? Number(itemsSum.toFixed(2)) : null),
    discount,
    paidAmount: paidAmount ?? totalAmount ?? null,
    items,
  };
}

/**
 * Le a nota do que o usuario colou: aceita tanto o HTML da pagina quanto o
 * texto renderizado, porque "selecionar tudo e copiar" no celular traz texto e
 * no desktop pode trazer HTML.
 */
export function parseNfcePaste(raw: string): NfceReceipt {
  const looksLikeHtml = /<(?:html|body|table|div|span|tr|p)\b/i.test(raw);

  if (looksLikeHtml) {
    const fromHtml = parseNfceHtml(raw);
    if (fromHtml.items.length > 0) return fromHtml;

    // HTML sem a tabela do portal (pagina salva, copia com marcacao): vale
    // tentar como texto, mas sem as tags no meio das descricoes.
    return parseNfceText(htmlToText(raw));
  }

  return parseNfceText(raw);
}

/**
 * HTML -> texto parecido com o que o navegador poe na area de transferencia:
 * bloco vira quebra de linha e celula de tabela vira tabulacao.
 */
function htmlToText(html: string): string {
  const $ = cheerio.load(html);
  $("script, style, noscript").remove();
  $("br").replaceWith("\n");
  $("td, th").each((_, el) => {
    $(el).after("\t");
  });
  $("p, div, tr, li, h1, h2, h3, h4, section, header, footer, table").each((_, el) => {
    $(el).after("\n");
  });

  return $("body").text();
}

/** Texto visivel da pagina: sem <script>/<style>, que o cheerio devolve junto. */
function visibleText(html: string): string {
  const $ = cheerio.load(html);
  $("script, style, noscript").remove();

  return $("body").text().replace(/\s+/g, " ").trim();
}

/** Tira escapes de string JS, tags e entidades de um pedaco de markup. */
function stripMarkup(raw: string): string {
  const unescaped = raw.replace(/\\(['"\\/])/g, "$1");
  // <br>, <li> e afins separam frases: viram espaco para nao colar palavras.
  const spaced = unescaped.replace(/<\/?(?:br|li|ul|ol|p|div|span)[^>]*>/gi, " ");

  return cheerio.load(`<body>${spaced}</body>`)("body").text().replace(/\s+/g, " ").trim();
}

/**
 * Mensagem que a pagina injeta por JavaScript inline.
 *
 * A Consulta por QR Code nao escreve o erro no HTML: os divs de mensagem vem
 * vazios e no fim do documento vem um
 *   $('#spnErroProsseguirMaster').html('<ul><li>...</li></ul>');
 * Sem ler isso, o motivo da recusa fica invisivel para o app.
 */
function portalMessage(html: string): string | null {
  const pattern =
    /#spn(?:Erro|Alerta)[A-Za-z]*['"]\s*\)\s*\.html\(\s*(?:'((?:\\.|[^'\\])*)'|"((?:\\.|[^"\\])*)")/g;

  for (const match of html.matchAll(pattern)) {
    const text = stripMarkup(match[1] ?? match[2] ?? "");
    if (text) return text;
  }

  return null;
}

/**
 * Pagina de rejeicao do WAF do portal (F5 BIG-IP): vem com HTTP 200 e ~250
 * bytes, entao sem reconhecer pelo texto ela passaria por "nota sem itens".
 */
function isBlockedPage(html: string): boolean {
  if (/<title>\s*Request Rejected\s*<\/title>/i.test(html)) return true;

  return /requested\s+URL\s+was\s+rejected/i.test(html) && /support\s+ID/i.test(html);
}

export type SefazProblem = {
  reason: "blocked" | "not-found" | "captcha" | "portal";
  message: string;
  /** Texto cru da SEFAZ, para mostrar junto e para depurar. */
  detail?: string;
};

/** A SEFAZ responde 200 com pagina de erro; detectamos pelo texto. */
export function detectSefazError(html: string): SefazProblem | null {
  if (isBlockedPage(html)) {
    return {
      reason: "blocked",
      message:
        "O portal da SEFAZ bloqueou a consulta automática desta nota — ele passou " +
        "a recusar acesso que não vem de um navegador. Abrindo a nota no navegador " +
        "do celular a página carrega normalmente.",
    };
  }

  const portal = portalMessage(html);
  if (portal) {
    const notFound = /n[ãa]o\s+(foi\s+)?(localizad|encontrad)/i.test(portal);

    return {
      reason: notFound ? "not-found" : "portal",
      message: notFound
        ? "A SEFAZ não encontrou essa nota. Ela pode levar alguns minutos para ser publicada."
        : `A SEFAZ recusou a consulta: ${portal}`,
      detail: portal,
    };
  }

  const text = visibleText(html);

  if (/n[ãa]o\s+(foi\s+)?(localizad|encontrad)/i.test(text)) {
    return {
      reason: "not-found",
      message:
        "A SEFAZ não encontrou essa nota. Ela pode levar alguns minutos para ser publicada.",
    };
  }
  if (/captcha|verifica[çc][ãa]o de seguran[çc]a/i.test(text)) {
    return {
      reason: "captcha",
      message:
        "A SEFAZ pediu verificação de robô. Abra a nota no navegador e lance a compra manualmente.",
    };
  }
  if (/\berro\b/i.test(text) && text.length < 600) {
    return {
      reason: "portal",
      message: "A SEFAZ retornou um erro ao consultar essa nota.",
      detail: text,
    };
  }

  return null;
}
