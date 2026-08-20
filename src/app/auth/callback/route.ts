import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";

/**
 * Destino do magic link. Troca o `code` do PKCE por uma sessao em cookie e
 * manda o usuario para a lista.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";

  if (!code) {
    const errorDescription =
      searchParams.get("error_description") ?? "Link inválido ou expirado.";
    return NextResponse.redirect(
      `${origin}/login?erro=${encodeURIComponent(errorDescription)}`,
    );
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(
      `${origin}/login?erro=${encodeURIComponent(error.message)}`,
    );
  }

  return NextResponse.redirect(`${origin}${next}`);
}
