"use client";

import { useEffect, useState } from "react";

import { authClient } from "@/lib/auth-client";
import { ACCESS_CODE_HEADER, PENDING_CODE_KEY } from "@/lib/auth-shared";
import { IconSpinner } from "@/components/Icons";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
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
        /INVALID_TOKEN/i.test(failure)
          ? "Esse link já foi usado ou expirou. Peça um novo."
          : failure,
      );
    }
  }, []);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!email.trim()) return;

    setStatus("sending");

    const next = new URLSearchParams(window.location.search).get("next") ?? "/";
    const cleanCode = code.trim().toUpperCase().replace(/\s+/g, "");

    const { error } = await authClient.signIn.magicLink({
      email: email.trim(),
      callbackURL: next,
      errorCallbackURL: "/login",
      fetchOptions: cleanCode
        ? { headers: { [ACCESS_CODE_HEADER]: cleanCode } }
        : undefined,
    });

    if (error) {
      setStatus("error");
      setMessage(error.message ?? "Não consegui enviar o link. Tente de novo.");
      return;
    }

    // Guardado para o próximo passo: assim quem entra pela primeira vez não
    // precisa digitar o mesmo código de novo para entrar na casa.
    if (cleanCode) {
      try {
        sessionStorage.setItem(PENDING_CODE_KEY, cleanCode);
      } catch {
        // navegador sem sessionStorage: a tela seguinte pede o código
      }
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

          <label htmlFor="code" className="label mt-4">
            Código de acesso
          </label>
          <input
            id="code"
            value={code}
            onChange={(event) => setCode(event.target.value.toUpperCase())}
            placeholder="A1B2C3"
            autoCapitalize="characters"
            autoComplete="off"
            className="field font-mono tracking-widest"
          />
          <p className="mt-1.5 text-xs text-muted">
            Só na primeira vez. Quem já entrou uma vez pode deixar em branco.
          </p>

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

          {status === "error" && <p className="mt-3 text-sm text-danger">{message}</p>}
        </form>
      )}
    </div>
  );
}
