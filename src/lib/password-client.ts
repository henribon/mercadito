"use client";

/**
 * Chamadas aos endpoints da senha (src/lib/password-plugin.ts).
 *
 * Fetch cru, como em pin-client.ts e pelo mesmo motivo: as rotas sao nossas, e
 * por serem da mesma origem o cookie de sessao vai junto sozinho.
 */

const BASE = "/api/auth/senha";

async function call<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${BASE}/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const data = (await response.json().catch(() => null)) as
    | (T & { message?: string })
    | null;

  if (!response.ok) {
    throw new Error(
      response.status === 429
        ? "Muitas tentativas seguidas. Espere um minuto e tente de novo."
        : (data?.message ?? "Não consegui falar com o servidor."),
    );
  }

  return data as T;
}

/** O login por e-mail + senha. Em caso de erro, a mensagem ja vem pronta. */
export function entrarComSenha(email: string, senha: string) {
  return call<{ status: boolean }>("entrar", { email, senha });
}

/** Quem esta logado ja criou uma senha? */
export function statusDaSenha() {
  return call<{ configurada: boolean }>("status");
}

/** Cria ou troca a senha de quem esta logado. */
export function definirSenha(senha: string) {
  return call<{ status: boolean }>("definir", { senha });
}

/** Apaga a senha: o app volta a abrir so por link (e codigo). */
export function removerSenha() {
  return call<{ status: boolean }>("remover", {});
}
