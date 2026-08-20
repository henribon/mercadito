import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { resolveBaseUrl, trustedOrigins, isLocalUrl } from "../src/lib/base-url.ts";

/**
 * Regressao do bug que derrubou o login em producao: BETTER_AUTH_URL ficou em
 * localhost numa implantacao da Vercel e o Better Auth respondeu 403
 * INVALID_ORIGIN em toda tentativa de entrar.
 */

describe("resolveBaseUrl", () => {
  test("usa o valor explicito quando ele faz sentido", () => {
    const { url, warning } = resolveBaseUrl({
      BETTER_AUTH_URL: "https://mercadito-mu.vercel.app",
    });
    assert.equal(url, "https://mercadito-mu.vercel.app");
    assert.equal(warning, null);
  });

  test("tira a barra final", () => {
    const { url } = resolveBaseUrl({ BETTER_AUTH_URL: "https://exemplo.com/" });
    assert.equal(url, "https://exemplo.com");
  });

  test("ignora localhost numa implantacao da Vercel e avisa", () => {
    const { url, warning } = resolveBaseUrl({
      BETTER_AUTH_URL: "http://localhost:3000",
      VERCEL_PROJECT_PRODUCTION_URL: "mercadito-mu.vercel.app",
    });

    assert.equal(url, "https://mercadito-mu.vercel.app");
    assert.match(warning ?? "", /corrija a variável de ambiente/);
  });

  test("aceita localhost quando nao ha Vercel no ambiente", () => {
    const { url, warning } = resolveBaseUrl({ BETTER_AUTH_URL: "http://localhost:3000" });
    assert.equal(url, "http://localhost:3000");
    assert.equal(warning, null);
  });

  test("deriva da Vercel quando nada foi configurado", () => {
    const { url } = resolveBaseUrl({ VERCEL_URL: "mercadito-abc123.vercel.app" });
    assert.equal(url, "https://mercadito-abc123.vercel.app");
  });

  test("prefere o dominio estavel de producao ao da implantacao", () => {
    const { url } = resolveBaseUrl({
      VERCEL_URL: "mercadito-git-branch.vercel.app",
      VERCEL_PROJECT_PRODUCTION_URL: "mercadito-mu.vercel.app",
    });
    assert.equal(url, "https://mercadito-mu.vercel.app");
  });

  test("cai para localhost sem nenhuma pista", () => {
    assert.equal(resolveBaseUrl({}).url, "http://localhost:3000");
  });

  test("usa NEXT_PUBLIC_SITE_URL quando BETTER_AUTH_URL falta", () => {
    const { url } = resolveBaseUrl({ NEXT_PUBLIC_SITE_URL: "https://exemplo.com" });
    assert.equal(url, "https://exemplo.com");
  });
});

describe("trustedOrigins", () => {
  test("inclui producao, preview e o dev local, sem repetir", () => {
    const origins = trustedOrigins({
      BETTER_AUTH_URL: "https://mercadito-mu.vercel.app",
      VERCEL_PROJECT_PRODUCTION_URL: "mercadito-mu.vercel.app",
      VERCEL_URL: "mercadito-git-branch.vercel.app",
    });

    assert.ok(origins.includes("https://mercadito-mu.vercel.app"));
    assert.ok(origins.includes("https://mercadito-git-branch.vercel.app"));
    assert.ok(origins.includes("http://localhost:3000"));
    assert.equal(origins.length, new Set(origins).size, "tem origem repetida");
  });

  test("nao inventa origem quando so ha localhost", () => {
    const origins = trustedOrigins({});
    assert.deepEqual(origins, ["http://localhost:3000"]);
  });
});

describe("isLocalUrl", () => {
  test("reconhece as formas de endereco local", () => {
    assert.equal(isLocalUrl("http://localhost:3000"), true);
    assert.equal(isLocalUrl("http://127.0.0.1:3000"), true);
    assert.equal(isLocalUrl("https://localhost"), true);
    assert.equal(isLocalUrl("https://mercadito-mu.vercel.app"), false);
    // nao pode confundir um dominio que apenas comeca com "localhost"
    assert.equal(isLocalUrl("https://localhost.exemplo.com"), false);
  });
});
