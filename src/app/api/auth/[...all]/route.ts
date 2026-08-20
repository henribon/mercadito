import { toNextJsHandler } from "better-auth/next-js";

import { auth } from "@/lib/auth";

// Todas as rotas do Better Auth (/api/auth/*) passam por aqui.
export const { GET, POST } = toNextJsHandler(auth);
