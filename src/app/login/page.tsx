"use client";

import { useEffect, useState } from "react";

import { authClient } from "@/lib/auth-client";
import { IconSpinner } from "@/components/Icons";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [message, setMessage] = useState("");

  // O Better Auth redireciona para cá com `?error=` quando o link expira; sem
  // isso o usuário só veria o formulário de novo, sem entender o que aconteceu.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const failure = params.get("error") ?? params.get("erro");
    if (failure) {
      setStatus("error");
      setMessage(
        failure === "INVALID_TOKEN" || failure === "invalid_token"
          ? "Esse link já foi usado ou expirou. Peça um novo."
          : failure,
      );
    }
  }, []);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!email.trim()) return;

    setStatus("sending");

    // Volta para a página que o usuário tentou abrir antes de ser barrado.
    const next = new URLSearchParams(window.location.search).get("next") ?? "/";

    const { error } = await authClient.signIn.magicLink({
      email: email.trim(),
      callbackURL: next,
      errorCallbackURL: "/login",
    });

    if (error) {
      setStatus("error");
      setMessage(error.message ?? "Não consegui enviar o link. Tente de novo.");
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
            toque no link para entrar. Ele vale por 15 minutos.
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
