"use client";

/**
 * Chamadas aos endpoints do codigo de 4 digitos (src/lib/pin-plugin.ts).
 *
 * Sao fetch cru em vez do authClient: as rotas sao nossas, nao do Better Auth,
 * e nao valeria um plugin de cliente inteiro so para tipar quatro POSTs. Mesma
 * origem, entao o cookie de sessao e o do aparelho vao junto sozinhos.
 */

const BASE = "/api/auth/codigo";

/** Erro do servidor com o `code` preservado — a tela de login depende dele. */
export class PinError extends Error {
  constructor(
    message: string,
    readonly code: string | null,
  ) {
    super(message);
    this.name = "PinError";
  }
}

async function call<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${BASE}/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const data = (await response.json().catch(() => null)) as
    | (T & { message?: string; code?: string })
    | null;

  if (!response.ok) {
    throw new PinError(
      data?.message ?? "Não consegui falar com o servidor.",
      data?.code ?? null,
    );
  }

  return data as T;
}

/** Este navegador entra por codigo? Publico: roda na tela de login. */
export function aparelhoDoCodigo() {
  return call<{ reconhecido: boolean; nome: string | null }>("aparelho");
}

/** O login sem e-mail. Em caso de erro, a mensagem ja vem pronta para a tela. */
export function entrarComCodigo(pin: string) {
  return call<{ status: boolean }>("entrar", { pin });
}

/** Como esta o codigo de quem esta logado, e se este aparelho ja aceita ele. */
export function statusDoCodigo() {
  return call<{ configurado: boolean; aparelhoAtivo: boolean }>("status");
}

/** Cria ou troca o codigo, e passa a confiar neste aparelho. */
export function definirCodigo(pin: string) {
  return call<{ status: boolean }>("definir", { pin });
}

/** Aceita o codigo que ja existe tambem neste navegador. */
export function ativarCodigoAqui() {
  return call<{ status: boolean }>("ativar", {});
}

/** Apaga o codigo e desfaz a confianca de todos os aparelhos. */
export function removerCodigo() {
  return call<{ status: boolean }>("remover", {});
}
