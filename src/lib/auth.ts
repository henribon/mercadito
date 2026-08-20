import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { magicLink } from "better-auth/plugins";

import { decideAccess, type AccessLookups } from "./access";
import { ACCESS_CODE_HEADER } from "./auth-shared";
import { resolveBaseUrl, trustedOrigins } from "./base-url";
import { pool, queryOne } from "./db";
import { sendMagicLinkEmail } from "./email";
import { HOUSEHOLD_BY_INVITE_CODE, HOUSEHOLD_COUNT, USER_BY_EMAIL } from "./sql";

/**
 * Autenticacao sem senha, com as tabelas no mesmo Postgres do app.
 *
 * As tabelas de auth ("user", session, account, verification) sao criadas pelo
 * `npx auth@latest migrate` — veja o README. O schema da aplicacao em
 * neon/schema.sql referencia "user" e depende disso ter rodado antes.
 */
/** As consultas que o portao de acesso faz ao banco. */
const accessLookups: AccessLookups = {
  async userExists(email) {
    return Boolean(await queryOne<{ id: string }>(USER_BY_EMAIL, [email]));
  },
  async householdCount() {
    const counted = await queryOne<{ n: number }>(HOUSEHOLD_COUNT);
    return counted?.n ?? 0;
  },
  async codeExists(code) {
    return Boolean(await queryOne<{ id: string }>(HOUSEHOLD_BY_INVITE_CODE, [code]));
  },
};

const base = resolveBaseUrl(process.env);
if (base.warning) console.warn(`[Mercadito] ${base.warning}`);

export const auth = betterAuth({
  database: pool,
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: base.url,
  trustedOrigins: trustedOrigins(process.env),

  // Uso pessoal: so magic link, nada de senha para lembrar.
  emailAndPassword: { enabled: false },

  hooks: {
    /**
     * Portao de entrada. Roda antes do endpoint, entao um pedido recusado nem
     * chega a gerar token nem a mandar e-mail.
     *
     * O codigo vem por cabecalho, e nao no corpo, porque o corpo e validado
     * pelo schema do proprio endpoint e campos extras nao sobreviveriam.
     */
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== "/sign-in/magic-link") return;

      const body = ctx.body as { email?: string; accessCode?: string } | undefined;
      const code = ctx.headers?.get(ACCESS_CODE_HEADER) ?? body?.accessCode ?? null;

      const decision = await decideAccess(body?.email, code, accessLookups);

      if (!decision.allowed) {
        throw new APIError("FORBIDDEN", { message: decision.message });
      }
    }),
  },

  session: {
    expiresIn: 60 * 60 * 24 * 60, // 60 dias — nao queremos relogar toda semana
    updateAge: 60 * 60 * 24,
  },

  plugins: [
    magicLink({
      expiresIn: 60 * 15,
      sendMagicLink: async ({ email, url }) => {
        await sendMagicLinkEmail(email, url);
      },
    }),
    // nextCookies precisa ser o ultimo plugin da lista.
    nextCookies(),
  ],
});
