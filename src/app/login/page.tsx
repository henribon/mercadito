"use client";

import { useEffect, useState } from "react";

import { createClient } from "@/lib/supabase/client";
import { IconSpinner } from "@/components/Icons";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [message, setMessage] = useState("");

  // O callback devolve `?erro=` quando o link expira; sem isso o usuario so
  // veria o formulario de novo, sem entender o que aconteceu.
  // Lido do window para nao precisar de Suspense em volta de useSearchParams.
  useEffect(() => {
    const erro = new URLSearchParams(window.location.search).get("erro");
    if (erro) {
      setStatus("error");
      setMessage(erro);
    }
  }, []);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!email.trim()) return;

    setStatus("sending");

    const supabase = createClient();
    const siteUrl =
      process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ?? window.location.origin;

    // Volta para a pagina que o usuario tentou abrir antes de ser barrado.
    const next = new URLSearchParams(window.location.search).get("next") ?? "/";
    const redirect = `${siteUrl}/auth/callback?next=${encodeURIComponent(next)}`;

    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: redirect },
    });

    if (error) {
      setStatus("error");
      setMessage(error.message);
      return;
    }

    setStatus("sent");
  }

  return (
    <div className="flex min-h-[70dvh] flex-col justify-center">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Mercadito</h1>
        <p className="mt-1 text-sm text-muted">
          A lista de mercado de vocês dois, com o histórico de tudo que já foi comprado.
        </p>
      </header>

      {status === "sent" ? (
        <div className="card p-5">
          <h2 className="text-base font-medium">Link enviado</h2>
          <p className="mt-2 text-sm text-muted">
            Abra o e-mail que mandamos para <strong className="text-text">{email}</strong> e
            toque no link para entrar. Pode fechar esta aba.
          </p>
          <button
            type="button"
            onClick={() => setStatus("idle")}
            className="btn-quiet mt-4 px-0"
          >
            Usar outro e-mail
          </button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="card p-5">
          <label htmlFor="email" className="label">
            Seu e-mail
          </label>
          <input
            id="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="voce@exemplo.com"
            className="field"
          />

          <button
            type="submit"
            disabled={status === "sending"}
            className="btn-primary mt-4 w-full"
          >
            {status === "sending" && <IconSpinner size={16} />}
            {status === "sending" ? "Enviando" : "Receber link de acesso"}
          </button>

          <p className="mt-3 text-xs text-muted">
            Sem senha. Você recebe um link por e-mail e entra com um toque.
          </p>

          {status === "error" && (
            <p className="mt-3 text-sm text-danger">{message}</p>
          )}
        </form>
      )}
    </div>
  );
}
