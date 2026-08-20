/**
 * Interpretacao do conteudo do QR Code da NFC-e.
 *
 * O QR impresso no cupom carrega uma URL para o portal da SEFAZ da UF emissora.
 * Em SP o formato e:
 *   https://www.nfce.fazenda.sp.gov.br/qrcode?p=<chave>|<versao>|<ambiente>|<idToken>|<hash>
 *
 * A pagina que realmente lista os itens e a ConsultaQRCode.aspx, entao
 * normalizamos tudo para ela.
 */

export const SP_CONSULTA_URL =
  "https://www.nfce.fazenda.sp.gov.br/NFCeConsultaPublica/Paginas/ConsultaQRCode.aspx";

/** Codigo de UF (2 primeiros digitos da chave) -> sigla. */
const UF_BY_CODE: Record<string, string> = {
  "11": "RO", "12": "AC", "13": "AM", "14": "RR", "15": "PA", "16": "AP",
  "17": "TO", "21": "MA", "22": "PI", "23": "CE", "24": "RN", "25": "PB",
  "26": "PE", "27": "AL", "28": "SE", "29": "BA", "31": "MG", "32": "ES",
  "33": "RJ", "35": "SP", "41": "PR", "42": "SC", "43": "RS", "50": "MS",
  "51": "MT", "52": "GO", "53": "DF",
};

export type QrParseOk = {
  ok: true;
  accessKey: string;
  uf: string;
  consultaUrl: string;
  /** Conteudo do parametro p, repassado inteiro para a SEFAZ. */
  payload: string;
};

export type QrParseError = {
  ok: false;
  reason: "empty" | "no-key" | "bad-key" | "unsupported-uf";
  message: string;
  uf?: string;
};

export type QrParseResult = QrParseOk | QrParseError;

/**
 * Valida o digito verificador (modulo 11) da chave de acesso de 44 digitos.
 * Pega QR borrado ou digitacao errada antes de bater na SEFAZ.
 */
export function isValidAccessKey(key: string): boolean {
  if (!/^\d{44}$/.test(key)) return false;

  const weights = [2, 3, 4, 5, 6, 7, 8, 9];
  let sum = 0;
  for (let i = 42; i >= 0; i -= 1) {
    sum += Number(key[i]) * weights[(42 - i) % 8];
  }
  const remainder = sum % 11;
  const check = remainder < 2 ? 0 : 11 - remainder;

  return check === Number(key[43]);
}

/** Extrai o valor do parametro `p` de uma URL, ou o texto cru se nao houver. */
function extractPayload(raw: string): string {
  const text = raw.trim();

  try {
    const url = new URL(text);
    const p = url.searchParams.get("p");
    if (p) return p;
  } catch {
    // nao e URL absoluta; segue para os fallbacks
  }

  const match = text.match(/[?&]p=([^&\s]+)/i);
  if (match) return decodeURIComponent(match[1]);

  return text;
}

/**
 * Le o texto lido do QR (ou colado pelo usuario) e devolve a URL de consulta.
 * Aceita a URL completa, so o parametro `p`, ou a chave de 44 digitos sozinha.
 */
export function parseQrContent(raw: string): QrParseResult {
  if (!raw || !raw.trim()) {
    return { ok: false, reason: "empty", message: "Nada foi lido do QR Code." };
  }

  const payload = extractPayload(raw);
  const digitsOnly = payload.replace(/\D/g, "");

  // A chave e sempre o primeiro segmento do payload; se vier so a chave, e ela mesma.
  const firstSegment = payload.split("|")[0].replace(/\D/g, "");
  const accessKey =
    firstSegment.length === 44
      ? firstSegment
      : (digitsOnly.match(/\d{44}/)?.[0] ?? "");

  if (!accessKey) {
    return {
      ok: false,
      reason: "no-key",
      message: "Nao encontrei a chave de 44 digitos nesse QR Code.",
    };
  }

  if (!isValidAccessKey(accessKey)) {
    return {
      ok: false,
      reason: "bad-key",
      message: "A chave lida esta incompleta ou corrompida. Tente escanear de novo.",
    };
  }

  const uf = UF_BY_CODE[accessKey.slice(0, 2)] ?? "??";
  if (uf !== "SP") {
    return {
      ok: false,
      reason: "unsupported-uf",
      uf,
      message:
        `Essa nota e de ${uf}. Por enquanto o app le automaticamente so notas de SP — ` +
        "da para lancar a compra manualmente.",
    };
  }

  // Se so temos a chave (sem os demais campos do QR), a consulta por chave
  // ainda funciona no portal paulista.
  const p = payload.includes("|") ? payload : accessKey;

  return {
    ok: true,
    accessKey,
    uf,
    payload: p,
    consultaUrl: `${SP_CONSULTA_URL}?p=${encodeURIComponent(p)}`,
  };
}
