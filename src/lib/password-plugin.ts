import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthEndpoint, sessionMiddleware } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";

import { PASSWORD_LOCKED } from "./auth-shared";
import { query, queryOne } from "./db";
import {
  decidePasswordLogin,
  hashPassword,
  LOCK_MINUTES,
  MAX_PASSWORD_ATTEMPTS,
  passwordProblem,
  type PasswordLookups,
} from "./password";
import {
  DELETE_USER_PASSWORD,
  PASSWORD_BY_EMAIL,
  PASSWORD_FAILED,
  PASSWORD_USED,
  UPSERT_USER_PASSWORD,
  USER_HAS_PASSWORD,
} from "./sql";

/**
 * Os endpoints da senha, como plugin do Better Auth — pelo mesmo motivo do
 * codigo de 4 digitos (pin-plugin.ts): entrar cria uma sessao, e isso exige o
 * contexto de um endpoint do proprio Better Auth. As rotas caem em
 * /api/auth/senha/*.
 *
 * Nao usamos o `emailAndPassword` embutido do Better Auth de proposito: aqui a
 * conta nasce pelo link por e-mail (com o codigo de convite) e a senha e so
 * mais uma chave para a mesma porta. Com a regra em password.ts e o SQL em
 * sql.ts, tudo que decide quem entra fica coberto pelos testes.
 */

type PasswordRow = {
  user_id: string;
  password_hash: string;
  locked_until: string | null;
};

const lookups: PasswordLookups = {
  async findByEmail(email) {
    const row = await queryOne<PasswordRow>(PASSWORD_BY_EMAIL, [email]);
    if (!row) return null;
    return {
      userId: row.user_id,
      passwordHash: row.password_hash,
      lockedUntil: row.locked_until,
    };
  },
  async registerFailure(userId) {
    const row = await queryOne<{ failed_count: number; locked_until: string | null }>(
      PASSWORD_FAILED,
      [userId, MAX_PASSWORD_ATTEMPTS, LOCK_MINUTES],
    );
    return {
      failedCount: row?.failed_count ?? 0,
      lockedUntil: row?.locked_until ?? null,
    };
  },
  async registerSuccess(userId) {
    await query(PASSWORD_USED, [userId]);
  },
};

export const senhaDeAcesso = () =>
  ({
    id: "senha-de-acesso",

    endpoints: {
      /**
       * POST /senha/definir — cria ou troca a senha de quem esta logado.
       *
       * Nao pede a senha atual: e por aqui que passa quem esqueceu a senha e
       * entrou pelo link do e-mail justamente para criar outra. A confirmacao
       * ("repita a senha") e conferida no formulario.
       */
      definirSenha: createAuthEndpoint(
        "/senha/definir",
        { method: "POST", use: [sessionMiddleware] },
        async (ctx) => {
          const senha = (ctx.body as { senha?: unknown } | undefined)?.senha;

          const problema = passwordProblem(senha);
          if (problema) throw new APIError("BAD_REQUEST", { message: problema });

          await query(UPSERT_USER_PASSWORD, [
            ctx.context.session.user.id,
            await hashPassword(senha as string),
          ]);

          return ctx.json({ status: true });
        },
      ),

      /** POST /senha/remover — volta a entrar so por link (e codigo). */
      removerSenha: createAuthEndpoint(
        "/senha/remover",
        { method: "POST", use: [sessionMiddleware] },
        async (ctx) => {
          await query(DELETE_USER_PASSWORD, [ctx.context.session.user.id]);
          return ctx.json({ status: true });
        },
      ),

      /** GET /senha/status — o que a aba Produtos precisa mostrar. */
      statusSenha: createAuthEndpoint(
        "/senha/status",
        { method: "GET", use: [sessionMiddleware] },
        async (ctx) => {
          const row = await queryOne<{ ok: number }>(USER_HAS_PASSWORD, [
            ctx.context.session.user.id,
          ]);
          return ctx.json({ configurada: Boolean(row) });
        },
      ),

      /** POST /senha/entrar — o login por e-mail + senha. */
      entrarComSenha: createAuthEndpoint(
        "/senha/entrar",
        { method: "POST" },
        async (ctx) => {
          const body = ctx.body as { email?: string; senha?: string } | undefined;

          const decision = await decidePasswordLogin(body?.email, body?.senha, lookups);

          if (!decision.allowed) {
            throw new APIError("UNAUTHORIZED", {
              message: decision.message,
              code: decision.locked ? PASSWORD_LOCKED : "SENHA_ERRADA",
            });
          }

          const user = await ctx.context.internalAdapter.findUserById(decision.userId);
          if (!user) {
            throw new APIError("UNAUTHORIZED", {
              message: "Não encontrei essa conta. Entre pelo link por e-mail.",
            });
          }

          const session = await ctx.context.internalAdapter.createSession(user.id);
          if (!session) {
            throw new APIError("INTERNAL_SERVER_ERROR", {
              message: "Não consegui abrir a sessão. Tente de novo.",
            });
          }

          await setSessionCookie(ctx, { session, user });

          return ctx.json({ status: true });
        },
      ),
    },

    /**
     * Teto por IP alem da tranca por conta: a tranca so existe para e-mail que
     * tem senha, entao ela nao cobre quem fica testando e-mails ao acaso.
     */
    rateLimit: [
      {
        pathMatcher: (path: string) => path.startsWith("/senha/"),
        window: 60,
        max: 10,
      },
    ],
  }) satisfies BetterAuthPlugin;
