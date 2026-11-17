import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import http, { type IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";

import { fetchPortalPage } from "../src/lib/nfce/portal.ts";
import { detectSefazError } from "../src/lib/nfce/parse.ts";

/**
 * O pedido ao portal da SEFAZ, contra um servidor local que faz o papel dele.
 *
 * O que estes testes fixam e o FORMATO do pedido: foi ele que fez o portal
 * voltar a responder. Se alguem trocar o `https.get` cru por `fetch` de novo,
 * os cabecalhos que o WAF recusa reaparecem e o primeiro teste quebra.
 */

let server: http.Server;
let base: string;
let outro: http.Server;
let outroBase: string;

/** Os cabecalhos do ultimo pedido que chegou ao servidor de mentira. */
let seen: IncomingHttpHeaders = {};

const BLOQUEIO =
  "<html><head><title>Request Rejected</title></head><body>The requested URL was " +
  "rejected. Please consult with your administrator.<br><br>Your support ID is: 123" +
  "</body></html>";

before(async () => {
  server = http.createServer((request, response) => {
    seen = request.headers;
    const path = request.url ?? "/";

    if (path.startsWith("/nota")) {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end("<html><body><span class='txtTit'>AÇÚCAR UNIÃO 1KG</span></body></html>");
    } else if (path.startsWith("/latin1")) {
      response.writeHead(200, { "content-type": "text/html; charset=ISO-8859-1" });
      response.end(Buffer.from("<p>PÃO FRANCÊS</p>", "latin1"));
    } else if (path.startsWith("/qrcode")) {
      // O link impresso no cupom redireciona para a pagina que lista os itens.
      response.writeHead(302, { location: "/nota?p=123" });
      response.end();
    } else if (path.startsWith("/para-fora")) {
      response.writeHead(302, { location: `${outroBase}/nota` });
      response.end();
    } else if (path.startsWith("/voltas")) {
      response.writeHead(302, { location: "/voltas" });
      response.end();
    } else if (path.startsWith("/bloqueio")) {
      // O WAF responde 200: so o corpo denuncia a recusa.
      response.writeHead(200, { "content-type": "text/html" });
      response.end(BLOQUEIO);
    } else if (path.startsWith("/erro")) {
      response.writeHead(503, { "content-type": "text/html" });
      response.end("fora do ar");
    } else if (path.startsWith("/lento")) {
      response.writeHead(200, { "content-type": "text/html" });
      response.write("<html>");
      // nunca termina: quem corta e o prazo de quem pediu
    } else if (path.startsWith("/enorme")) {
      response.writeHead(200, { "content-type": "text/html" });
      response.end(Buffer.alloc(2_500_000, "a"));
    } else if (path.startsWith("/derruba")) {
      request.socket.destroy();
    } else {
      response.writeHead(404);
      response.end();
    }
  });

  outro = http.createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html" });
    response.end("pagina de outro host");
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  await new Promise<void>((resolve) => outro.listen(0, "127.0.0.1", resolve));

  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  outroBase = `http://127.0.0.1:${(outro.address() as AddressInfo).port}`;
});

after(() => {
  server.closeAllConnections();
  server.close();
  outro.closeAllConnections();
  outro.close();
});

describe("formato do pedido", () => {
  test("manda so os cabecalhos que o portal aceita", async () => {
    await fetchPortalPage(`${base}/nota`);

    // `host` e `connection` sao do proprio HTTP; o resto e o que escolhemos.
    assert.deepEqual(Object.keys(seen).sort(), [
      "accept",
      "accept-language",
      "connection",
      "host",
      "user-agent",
    ]);
    assert.equal(seen.accept, "text/html,application/xhtml+xml");
    assert.equal(seen["accept-language"], "pt-BR,pt;q=0.9");
  });

  test("nao mantem a conexao aberta nem pede compressao", async () => {
    await fetchPortalPage(`${base}/nota`);

    // As duas coisas que o `fetch` manda sozinho e que fizeram o portal
    // derrubar a conexao.
    assert.equal(seen.connection, "close");
    assert.equal(seen["accept-encoding"], undefined);
    assert.equal(seen["sec-fetch-mode"], undefined);
  });
});

describe("resposta do portal", () => {
  test("devolve o status e a pagina em UTF-8", async () => {
    const page = await fetchPortalPage(`${base}/nota`);

    assert.equal(page.status, 200);
    assert.match(page.html, /AÇÚCAR UNIÃO 1KG/);
  });

  test("decodifica pagina antiga em ISO-8859-1", async () => {
    const page = await fetchPortalPage(`${base}/latin1`);
    assert.equal(page.html, "<p>PÃO FRANCÊS</p>");
  });

  test("segue o redirecionamento do link do QR Code", async () => {
    const page = await fetchPortalPage(`${base}/qrcode?p=123`);

    assert.equal(page.status, 200);
    assert.match(page.html, /AÇÚCAR/);
  });

  test("um 200 que nega continua sendo reconhecido como bloqueio", async () => {
    // O status nao diz nada: e o conteudo que a rota examina depois.
    const page = await fetchPortalPage(`${base}/bloqueio`);

    assert.equal(page.status, 200);
    assert.equal(detectSefazError(page.html)?.reason, "blocked");
  });

  test("status de erro chega a quem chamou, sem virar excecao", async () => {
    const page = await fetchPortalPage(`${base}/erro`);
    assert.equal(page.status, 503);
  });
});

describe("limites", () => {
  test("nao segue redirecionamento para outro host", async () => {
    // A URL sai do conteudo de um QR Code: o servidor nao pode ser levado a
    // buscar um endereco qualquer.
    await assert.rejects(fetchPortalPage(`${base}/para-fora`), /endereço inesperado/);
  });

  test("desiste de um redirecionamento em circulo", async () => {
    await assert.rejects(fetchPortalPage(`${base}/voltas`), /endereço inesperado/);
  });

  test("o prazo vale para a resposta inteira, nao so para o primeiro byte", async () => {
    const started = Date.now();

    await assert.rejects(
      fetchPortalPage(`${base}/lento`, { timeoutMs: 300 }),
      (cause: Error) => cause.name === "TimeoutError",
    );
    assert.ok(Date.now() - started < 2_000, "esperou muito alem do prazo");
  });

  test("recusa resposta grande demais para ser uma nota", async () => {
    await assert.rejects(fetchPortalPage(`${base}/enorme`), /grande demais/);
  });

  test("conexao derrubada vira erro de rede, nao de prazo", async () => {
    await assert.rejects(
      fetchPortalPage(`${base}/derruba`),
      (cause: Error) => cause.name !== "TimeoutError",
    );
  });
});
