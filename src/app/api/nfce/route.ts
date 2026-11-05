import { NextResponse, type NextRequest } from "next/server";

import { detectSefazError, parseNfceHtml, parseNfcePaste } from "@/lib/nfce/parse";
import { parseQrContent } from "@/lib/nfce/qr";
import { currentUser } from "@/lib/session";

// cheerio precisa do runtime Node; e a consulta e sempre ao vivo.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TIMEOUT_MS = 20_000;

/** Uma pagina de nota colada tem alguns KB; acima disso e lixo. */
const MAX_PASTE = 500_000;

/**
 * Le uma NFC-e e devolve os itens ja estruturados. Dois caminhos:
 *
 * - `qr`: consulta o portal da SEFAZ-SP aqui no servidor, porque o portal nao
 *   envia CORS e o navegador nao conseguiria buscar a pagina direto.
 * - `paste`: o texto da pagina que o usuario copiou do proprio navegador. Desde
 *   novembro/2026 o portal recusa a maior parte das consultas feitas pelo
 *   servidor, e esse e o caminho que continua funcionando.
 */
export async function POST(request: NextRequest) {
  // Rota autenticada: nao queremos um proxy aberto para a internet.
  const user = await currentUser();

  if (!user) {
    return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  }

  let body: { qr?: string; paste?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Corpo inválido." }, { status: 400 });
  }

  const pasted = typeof body.paste === "string" ? body.paste.trim() : "";

  if (pasted) {
    if (pasted.length > MAX_PASTE) {
      return NextResponse.json(
        { error: "Esse texto é grande demais para ser uma nota.", reason: "paste-big" },
        { status: 413 },
      );
    }

    const receipt = parseNfcePaste(pasted);

    if (receipt.items.length === 0) {
      return NextResponse.json(
        {
          error:
            "Não achei itens nesse texto. Confira se copiou a página inteira da " +
            "nota — do nome do mercado até a chave de acesso.",
          reason: "paste-empty",
        },
        { status: 422 },
      );
    }

    // Sem sourceUrl: a nota nao veio de uma consulta nossa.
    return NextResponse.json({ receipt, sourceUrl: null });
  }

  const parsed = parseQrContent(body.qr ?? "");
  if (!parsed.ok) {
    return NextResponse.json(
      { error: parsed.message, reason: parsed.reason, uf: parsed.uf },
      { status: 422 },
    );
  }

  let html: string;
  try {
    const response = await fetch(parsed.consultaUrl, {
      headers: {
        // O portal responde diferente (ou nada) sem um UA de navegador.
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
          "(KHTML, like Gecko) Chrome/122.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "pt-BR,pt;q=0.9",
      },
      redirect: "follow",
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!response.ok) {
      return NextResponse.json(
        {
          error: `A SEFAZ respondeu ${response.status}. Tente de novo em instantes.`,
          reason: "http",
          sourceUrl: parsed.consultaUrl,
        },
        { status: 502 },
      );
    }

    // Paginas antigas da SEFAZ as vezes vem em ISO-8859-1.
    const charset =
      response.headers.get("content-type")?.match(/charset=([^;]+)/i)?.[1]?.trim() ??
      "utf-8";
    const buffer = await response.arrayBuffer();
    html = new TextDecoder(charset.toLowerCase() === "utf-8" ? "utf-8" : "iso-8859-1")
      .decode(buffer);
  } catch (cause) {
    const timedOut = cause instanceof Error && cause.name === "TimeoutError";
    return NextResponse.json(
      {
        error: timedOut
          ? "A SEFAZ demorou demais para responder. Tente novamente."
          : "Não consegui acessar o portal da SEFAZ agora.",
        reason: timedOut ? "timeout" : "network",
        sourceUrl: parsed.consultaUrl,
      },
      { status: 504 },
    );
  }

  const sefazError = detectSefazError(html);
  if (sefazError) {
    return NextResponse.json(
      {
        error: sefazError.message,
        reason: sefazError.reason,
        detail: sefazError.detail,
        // Com o link o usuario abre a nota no proprio navegador — onde o portal
        // responde normalmente — e lanca a compra na mao.
        sourceUrl: parsed.consultaUrl,
      },
      // Bloqueio e problema do portal, nao da nota lida: 502 deixa isso claro.
      { status: sefazError.reason === "blocked" ? 502 : 422 },
    );
  }

  const receipt = parseNfceHtml(html);

  if (receipt.items.length === 0) {
    return NextResponse.json(
      {
        error:
          "Abri a página da SEFAZ mas ela voltou sem itens. " +
          "Talvez o layout tenha mudado — dá para abrir a nota no navegador e " +
          "lançar a compra manualmente.",
        reason: "no-items",
        sourceUrl: parsed.consultaUrl,
      },
      { status: 422 },
    );
  }

  return NextResponse.json({
    receipt: {
      ...receipt,
      // A chave do QR e mais confiavel que a raspada do HTML.
      accessKey: parsed.accessKey ?? receipt.accessKey,
    },
    sourceUrl: parsed.consultaUrl,
  });
}
