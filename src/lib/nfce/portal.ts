import http from "node:http";
import https from "node:https";

/**
 * O pedido ao portal da SEFAZ.
 *
 * E um `https.get` cru, e nao `fetch`, de proposito. O WAF que passou a ficar
 * na frente da Consulta Publica recusa o pedido do jeito que o `fetch` do Node
 * o monta: responde "Request Rejected" (com HTTP 200) ou derruba a conexao. O
 * mesmo pedido, so com os cabecalhos abaixo e uma conexao por consulta, recebe
 * a pagina do portal.
 *
 * Medido em novembro/2026, um pedido por variacao: o cru passou 5 de 5 vezes;
 * acrescentar `Connection: keep-alive` ou `Accept-Encoding` com brotli — duas
 * coisas que o `fetch` manda sozinho — fez a conexao cair. Por isso nenhum dos
 * dois aparece aqui, e nao ha Accept-Encoding nenhum: a pagina vem sem
 * compressao, e e pequena.
 *
 * Nada aqui imita um navegador alem do User-Agent que a rota sempre mandou:
 * nao ha cookie, desafio nem cabecalho forjado. Se o portal recusar mesmo
 * assim, quem chama trata como bloqueio e a tela oferece a pagina copiada.
 */

export const PORTAL_HEADERS: Record<string, string> = {
  // O portal responde diferente (ou nada) sem um UA de navegador.
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/122.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml",
  "Accept-Language": "pt-BR,pt;q=0.9",
};

/** A pagina de uma nota tem dezenas de KB; muito acima disso nao e uma nota. */
const MAX_BYTES = 2_000_000;

/** `/qrcode?p=` redireciona uma vez para a ConsultaQRCode.aspx. */
const MAX_REDIRECTS = 3;

export type PortalPage = {
  status: number;
  /** Ja decodificado conforme o charset que o portal declarou. */
  html: string;
};

export class PortalTimeoutError extends Error {
  constructor() {
    super("O portal demorou demais para responder.");
    this.name = "TimeoutError";
  }
}

/** Paginas antigas da SEFAZ as vezes vem em ISO-8859-1. */
function decodeBody(body: Buffer, contentType: string | undefined): string {
  const charset = contentType?.match(/charset=([^;]+)/i)?.[1]?.trim().toLowerCase() ?? "utf-8";
  return new TextDecoder(charset === "utf-8" ? "utf-8" : "iso-8859-1").decode(body);
}

function requestOnce(
  url: URL,
  deadline: number,
): Promise<{ status: number; body: Buffer; contentType?: string; location?: string }> {
  return new Promise((resolve, reject) => {
    const client = url.protocol === "http:" ? http : https;

    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      reject(new PortalTimeoutError());
      return;
    }

    const request = client.get(
      url,
      {
        headers: PORTAL_HEADERS,
        // Uma conexao por consulta, fechada no fim: e o que faz o Node mandar
        // `Connection: close` em vez de `keep-alive`.
        agent: false,
      },
      (response) => {
        const chunks: Buffer[] = [];
        let size = 0;

        response.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_BYTES) {
            request.destroy(new Error("A resposta do portal é grande demais para ser uma nota."));
            return;
          }
          chunks.push(chunk);
        });

        response.on("end", () => {
          clearTimeout(timer);
          resolve({
            status: response.statusCode ?? 0,
            body: Buffer.concat(chunks),
            contentType: response.headers["content-type"],
            location: response.headers.location,
          });
        });

        response.on("error", (cause) => {
          clearTimeout(timer);
          reject(cause);
        });
      },
    );

    // O prazo vale para a consulta inteira (conexao, cabecalhos e corpo), e nao
    // so para o tempo ocioso do socket.
    const timer = setTimeout(() => request.destroy(new PortalTimeoutError()), remaining);

    request.on("error", (cause) => {
      clearTimeout(timer);
      reject(cause);
    });
  });
}

/**
 * Busca uma pagina do portal. Lanca `TimeoutError` se o prazo estourar e o erro
 * de rede original em qualquer outra falha de conexao.
 *
 * Redirecionamentos so sao seguidos dentro do mesmo host: a URL sai do conteudo
 * de um QR Code, e o servidor nao deve ser levado a buscar outro endereco.
 */
export async function fetchPortalPage(
  rawUrl: string,
  options: { timeoutMs?: number } = {},
): Promise<PortalPage> {
  const deadline = Date.now() + (options.timeoutMs ?? 20_000);

  let url = new URL(rawUrl);

  for (let hop = 0; ; hop += 1) {
    const response = await requestOnce(url, deadline);

    const redirected = response.status >= 300 && response.status < 400 && response.location;
    if (!redirected) {
      return {
        status: response.status,
        html: decodeBody(response.body, response.contentType),
      };
    }

    const next = new URL(response.location!, url);

    if (hop >= MAX_REDIRECTS || next.host !== url.host || next.protocol !== url.protocol) {
      throw new Error("O portal redirecionou para um endereço inesperado.");
    }

    url = next;
  }
}
