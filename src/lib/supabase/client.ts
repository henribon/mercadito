"use client";

import { createBrowserClient } from "@supabase/ssr";

const MISSING_ENV =
  "Faltam as variáveis do Supabase. Copie .env.local.example para .env.local " +
  "e preencha NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY " +
  "(Supabase → Project Settings → API).";

/**
 * Cliente do navegador. O app e majoritariamente client-side para poder usar
 * realtime: a lista atualiza sozinha nos dois celulares.
 */
export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    // No navegador isso e um erro de configuracao e vale interromper com uma
    // mensagem util. Durante o prerender do build seguimos com um valor inerte,
    // porque nenhuma requisicao chega a ser feita ali.
    if (typeof window !== "undefined") throw new Error(MISSING_ENV);

    return createBrowserClient(
      "https://indisponivel.supabase.co",
      "sem-chave-no-build",
    );
  }

  return createBrowserClient(url, key);
}
