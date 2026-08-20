import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PATHS = ["/login"];

/**
 * Portao otimista.
 *
 * O middleware roda no Edge, onde nao ha conexao com o Postgres — entao aqui so
 * conferimos a presenca do cookie de sessao, sem validar a assinatura. A
 * verificacao de verdade acontece em cada Server Action, via
 * `requireMembership()`, que e onde os dados realmente saem do banco.
 *
 * O helper getSessionCookie do Better Auth tem bugs conhecidos no Edge, por
 * isso lemos o cookie direto.
 */
function hasSessionCookie(request: NextRequest): boolean {
  return (
    request.cookies.has("better-auth.session_token") ||
    request.cookies.has("__Secure-better-auth.session_token")
  );
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.some((path) => pathname.startsWith(path));
  const signedIn = hasSessionCookie(request);

  if (!signedIn && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  if (signedIn && pathname === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Tudo, menos as rotas de API e qualquer arquivo com extensao.
    // Os icones e o manifest precisam ficar de fora: se caissem no redirect
    // para /login, a instalacao da PWA quebraria.
    "/((?!api/|_next/static|_next/image|.*\\.(?:png|jpg|jpeg|svg|ico|webp|webmanifest|txt|xml)$).*)",
  ],
};
