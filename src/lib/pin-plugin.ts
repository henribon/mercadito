import type { BetterAuthOptions, BetterAuthPlugin } from "better-auth";
import { APIError, createAuthEndpoint, sessionMiddleware } from "better-auth/api";
import { createCookieGetter, setSessionCookie } from "better-auth/cookies";

import { DEVICE_REJECTED } from "./auth-shared";
import { query, queryOne } from "./db";
import {
  DELETE_DEVICE,
  DELETE_DEVICES_FOR_USER,
  DELETE_DEVICE_BY_TOKEN,
  DELETE_USER_PIN,
  DEVICE_BY_TOKEN,
  DEVICE_FAILED,
  DEVICE_IS_TRUSTED,
  DEVICE_USED,
  INSERT_TRUSTED_DEVICE,
  UPSERT_USER_PIN,
  USER_PIN,
} from "./sql";
import {
  decidePinLogin,
  hashDeviceToken,
  hashPin,
  isPin,
  newDeviceToken,
  normalizePin,
  PIN_LENGTH,
  type PinLookups,
} from "./pin";

/**
 * Os endpoints do codigo de 4 digitos, como plugin do Better Auth.
 *
 * Precisa ser um plugin, e nao uma Server Action: entrar pelo codigo cria uma
 * sessao, e criar sessao exige o contexto de um endpoint do proprio Better
 * Auth (`internalAdapter` + `setSessionCookie`). Como plugin, as rotas caem em
 * /api/auth/codigo/*, herdam a checagem de origem que o roteador aplica a todo
 * POST e saem pelo mesmo handler que ja trata os cookies no Next.
 *
 * As tabelas ficam em neon/schema.sql (aplicadas por `npm run db:setup`) e sao
 * consultadas pelo pool do app, como o resto do projeto — assim as consultas
 * ficam em sql.ts e rodam nos testes contra um Postgres de verdade.
 */

/** Nome do cookie do aparelho, ja com o prefixo seguro quando em producao. */
const DEVICE_COOKIE = "dispositivo";

/** Um ano: o aparelho e a metade estavel do par (aparelho + codigo). */
const DEVICE_MAX_AGE = 60 * 60 * 24 * 365;

function deviceCookie(options: BetterAuthOptions) {
  return createCookieGetter(options)(DEVICE_COOKIE, { maxAge: DEVICE_MAX_AGE });
}

type DeviceRow = {
  id: string;
  user_id: string;
  user_name: string | null;
  user_email: string;
  pin_hash: string | null;
};

const lookups: PinLookups = {
  async findDevice(tokenHash) {
    const row = await queryOne<DeviceRow>(DEVICE_BY_TOKEN, [tokenHash]);
    if (!row) return null;
    return { id: row.id, userId: row.user_id, pinHash: row.pin_hash };
  },
  async registerFailure(deviceId) {
    const row = await queryOne<{ failed_count: number }>(DEVICE_FAILED, [deviceId]);
    return row?.failed_count ?? 0;
  },
  async registerSuccess(deviceId) {
    await query(DEVICE_USED, [deviceId]);
  },
  async forgetDevice(deviceId) {
    await query(DELETE_DEVICE, [deviceId]);
  },
};

/** Como a pessoa aparece na tela de login: primeiro nome, nunca o e-mail inteiro. */
function shortName(row: DeviceRow): string {
  return row.user_name?.trim().split(/\s+/)[0] || row.user_email.split("@")[0];
}

/** O `body` chega cru: sem schema declarado o roteador so faz o parse do JSON. */
function pinFromBody(body: unknown): string {
  const pin = normalizePin((body as { pin?: unknown } | undefined)?.pin as string);
  if (!isPin(pin)) {
    throw new APIError("BAD_REQUEST", {
      message: `O código precisa ter ${PIN_LENGTH} dígitos.`,
    });
  }
  return pin;
}

export const codigoDeAcesso = () =>
  ({
    id: "codigo-de-acesso",

    endpoints: {
      /**
       * POST /codigo/definir — cria ou troca o codigo e confia neste aparelho.
       *
       * A confirmacao ("repita o código") e conferida no formulario: aqui um
       * codigo so ja diz tudo o que o servidor precisa saber.
       */
      definirCodigo: createAuthEndpoint(
        "/codigo/definir",
        { method: "POST", use: [sessionMiddleware] },
        async (ctx) => {
          const pin = pinFromBody(ctx.body);
          const userId = ctx.context.session.user.id;

          await query(UPSERT_USER_PIN, [userId, await hashPin(pin)]);

          const cookie = deviceCookie(ctx.context.options);
          const token = await trustDevice(userId, ctx.getCookie(cookie.name));
          ctx.setCookie(cookie.name, token, cookie.attributes);

          return ctx.json({ status: true });
        },
      ),

      /**
       * POST /codigo/ativar — passa a aceitar o codigo tambem neste navegador.
       *
       * Nao pede o codigo: quem chega aqui ja esta logado como o dono e
       * poderia simplesmente definir um novo. Exigir o atual seria teatro.
       */
      ativarCodigo: createAuthEndpoint(
        "/codigo/ativar",
        { method: "POST", use: [sessionMiddleware] },
        async (ctx) => {
          const userId = ctx.context.session.user.id;

          const pin = await queryOne<{ pin_hash: string }>(USER_PIN, [userId]);
          if (!pin) {
            throw new APIError("BAD_REQUEST", {
              message: "Crie um código antes de ativá-lo neste aparelho.",
            });
          }

          const cookie = deviceCookie(ctx.context.options);
          const token = await trustDevice(userId, ctx.getCookie(cookie.name));
          ctx.setCookie(cookie.name, token, cookie.attributes);

          return ctx.json({ status: true });
        },
      ),

      /** POST /codigo/remover — apaga o codigo e todos os aparelhos do dono. */
      removerCodigo: createAuthEndpoint(
        "/codigo/remover",
        { method: "POST", use: [sessionMiddleware] },
        async (ctx) => {
          const userId = ctx.context.session.user.id;

          await query(DELETE_USER_PIN, [userId]);
          await query(DELETE_DEVICES_FOR_USER, [userId]);

          const cookie = deviceCookie(ctx.context.options);
          ctx.setCookie(cookie.name, "", { ...cookie.attributes, maxAge: 0 });

          return ctx.json({ status: true });
        },
      ),

      /** GET /codigo/status — o que a aba Produtos precisa mostrar. */
      statusCodigo: createAuthEndpoint(
        "/codigo/status",
        { method: "GET", use: [sessionMiddleware] },
        async (ctx) => {
          const userId = ctx.context.session.user.id;
          const cookie = deviceCookie(ctx.context.options);
          const token = ctx.getCookie(cookie.name);

          const [pin, device] = await Promise.all([
            queryOne<{ pin_hash: string }>(USER_PIN, [userId]),
            token
              ? queryOne<{ ok: number }>(DEVICE_IS_TRUSTED, [
                  hashDeviceToken(token),
                  userId,
                ])
              : null,
          ]);

          return ctx.json({
            configurado: Boolean(pin),
            aparelhoAtivo: Boolean(device),
          });
        },
      ),

      /**
       * GET /codigo/aparelho — publico, chamado pela tela de login.
       *
       * So diz se este navegador entra por codigo e o primeiro nome de quem
       * ele pertence. Quem consegue perguntar isso ja esta com o aparelho na
       * mao; o e-mail inteiro nao entra na resposta.
       */
      aparelhoDoCodigo: createAuthEndpoint(
        "/codigo/aparelho",
        { method: "GET" },
        async (ctx) => {
          const cookie = deviceCookie(ctx.context.options);
          const token = ctx.getCookie(cookie.name);
          if (!token) return ctx.json({ reconhecido: false, nome: null });

          const row = await queryOne<DeviceRow>(DEVICE_BY_TOKEN, [
            hashDeviceToken(token),
          ]);
          if (!row?.pin_hash) return ctx.json({ reconhecido: false, nome: null });

          return ctx.json({ reconhecido: true, nome: shortName(row) });
        },
      ),

      /** POST /codigo/entrar — o login sem e-mail. */
      entrarComCodigo: createAuthEndpoint(
        "/codigo/entrar",
        { method: "POST" },
        async (ctx) => {
          const cookie = deviceCookie(ctx.context.options);
          const token = ctx.getCookie(cookie.name);

          const decision = await decidePinLogin(
            (ctx.body as { pin?: string } | undefined)?.pin,
            token,
            lookups,
          );

          if (!decision.allowed) {
            if (decision.deviceRejected) {
              ctx.setCookie(cookie.name, "", { ...cookie.attributes, maxAge: 0 });
            }
            throw new APIError("UNAUTHORIZED", {
              message: decision.message,
              // A tela de login usa isto para trocar o teclado pelo e-mail em
              // vez de deixar a pessoa tentando um codigo que nao vale mais.
              code: decision.deviceRejected ? DEVICE_REJECTED : "CODIGO_ERRADO",
            });
          }

          const user = await ctx.context.internalAdapter.findUserById(decision.userId);
          if (!user) {
            throw new APIError("UNAUTHORIZED", { message: UNEXPECTED_MISSING_USER });
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
     * Teto por IP alem do contador por aparelho: o contador so existe depois de
     * achar o aparelho, entao ele nao cobre quem fica batendo sem cookie.
     */
    rateLimit: [
      {
        pathMatcher: (path: string) => path.startsWith("/codigo/"),
        window: 60,
        max: 10,
      },
    ],
  }) satisfies BetterAuthPlugin;

/** O aparelho foi apagado entre a consulta e o login — corrida improvavel. */
const UNEXPECTED_MISSING_USER =
  "Não encontrei a conta deste aparelho. Entre com o e-mail.";

/**
 * Liga este navegador ao dono e devolve o token novo — quem chama escreve o
 * cookie, que so o contexto do endpoint sabe montar.
 *
 * O token anterior, se houver, sai junto: reconfiar o mesmo aparelho nao pode
 * ir deixando linhas orfas em trusted_devices.
 */
async function trustDevice(
  userId: string,
  currentToken: string | null | undefined,
): Promise<string> {
  if (currentToken) await query(DELETE_DEVICE_BY_TOKEN, [hashDeviceToken(currentToken)]);

  const token = newDeviceToken();
  await query(INSERT_TRUSTED_DEVICE, [userId, hashDeviceToken(token)]);

  return token;
}
