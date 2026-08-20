/**
 * Resolucao da URL base do app.
 *
 * Isolado do auth.ts para poder ser testado sem subir banco nem Better Auth —
 * foi um erro aqui (`localhost` numa implantacao da Vercel) que derrubou o
 * login em producao com um `INVALID_ORIGIN` que nao explicava nada.
 */

/**
 * A assinatura de indice deixa o tipo compativel com `process.env` — sem ela o
 * TypeScript recusa a chamada por serem todas as propriedades opcionais.
 */
export type Env = {
  BETTER_AUTH_URL?: string;
  NEXT_PUBLIC_SITE_URL?: string;
  VERCEL_URL?: string;
  VERCEL_PROJECT_PRODUCTION_URL?: string;
  [key: string]: string | undefined;
};

/** Sem barra no fim, para comparar origens sem falso negativo. */
export function trimSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

export function isLocalUrl(url: string): boolean {
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(url);
}

/**
 * URL usada para validar a origem das requisicoes e montar o link do e-mail.
 *
 * A Vercel expoe o dominio no proprio ambiente, entao derivamos dele quando
 * possivel — isso cobre os deploys de preview, que ganham uma URL diferente a
 * cada branch e quebrariam com um valor fixo.
 *
 * `localhost` durante um deploy da Vercel e sempre erro de configuracao: o
 * link do e-mail apontaria para a maquina de quem clicou. Nesse caso ignoramos
 * o valor explicito e devolvemos tambem um aviso para quem chamou registrar.
 */
export function resolveBaseUrl(env: Env): { url: string; warning: string | null } {
  const vercelHost = env.VERCEL_PROJECT_PRODUCTION_URL ?? env.VERCEL_URL;
  const explicit = env.BETTER_AUTH_URL ?? env.NEXT_PUBLIC_SITE_URL;

  if (explicit) {
    const url = trimSlash(explicit);

    if (!(vercelHost && isLocalUrl(url))) return { url, warning: null };

    return {
      url: `https://${vercelHost}`,
      warning:
        `BETTER_AUTH_URL está como "${url}" numa implantação da Vercel. ` +
        `Usando https://${vercelHost} no lugar — corrija a variável de ambiente.`,
    };
  }

  if (vercelHost) return { url: `https://${vercelHost}`, warning: null };

  return { url: "http://localhost:3000", warning: null };
}

/** Origens aceitas: a base resolvida, os domínios da Vercel e o dev local. */
export function trustedOrigins(env: Env): string[] {
  const candidates = [
    resolveBaseUrl(env).url,
    env.VERCEL_PROJECT_PRODUCTION_URL && `https://${env.VERCEL_PROJECT_PRODUCTION_URL}`,
    env.VERCEL_URL && `https://${env.VERCEL_URL}`,
    env.NEXT_PUBLIC_SITE_URL,
    "http://localhost:3000",
  ];

  return [
    ...new Set(
      candidates.filter((value): value is string => Boolean(value)).map(trimSlash),
    ),
  ];
}
