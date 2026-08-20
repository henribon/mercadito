import { toNextJsHandler } from "better-auth/next-js";

import { auth } from "@/lib/auth";

// Todas as rotas do Better Auth (/api/auth/*) passam por aqui.
//
// O envio do link de acesso fala com o SMTP e, num cold start, pode passar do
// limite padrao de 10s da Vercel — o login falharia so em producao.
export const maxDuration = 30;

export const { GET, POST } = toNextJsHandler(auth);
