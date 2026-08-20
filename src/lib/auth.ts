import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { magicLink } from "better-auth/plugins";

import { resolveBaseUrl, trustedOrigins } from "./base-url";
import { pool } from "./db";
import { sendMagicLinkEmail } from "./email";

/**
 * Autenticacao sem senha, com as tabelas no mesmo Postgres do app.
 *
 * As tabelas de auth ("user", session, account, verification) sao criadas pelo
 * `npx auth@latest migrate` — veja o README. O schema da aplicacao em
 * neon/schema.sql referencia "user" e depende disso ter rodado antes.
 */
const base = resolveBaseUrl(process.env);
if (base.warning) console.warn(`[Mercadito] ${base.warning}`);

export const auth = betterAuth({
  database: pool,
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: base.url,
  trustedOrigins: trustedOrigins(process.env),

  // Uso pessoal: so magic link, nada de senha para lembrar.
  emailAndPassword: { enabled: false },

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
