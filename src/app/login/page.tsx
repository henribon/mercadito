"use client";

import { useEffect, useState } from "react";

import { authClient } from "@/lib/auth-client";
import {
  ACCESS_CODE_HEADER,
  DEVICE_REJECTED,
  PENDING_CODE_KEY,
  PIN_LENGTH,
} from "@/lib/auth-shared";
import { aparelhoDoCodigo, entrarComCodigo, PinError } from "@/lib/pin-client";
import { IconSpinner } from "@/components/Icons";
import { PinInput } from "@/components/PinInput";

/**
 * Para onde ir depois de entrar.
 *
 * Só caminho interno: o `?next=` vem da URL, e jogá-lo direto no
 * `location.href` deixaria qualquer link `/login?next=https://…` mandar a
 * pessoa para fora logo depois do login. `//` fica de fora porque o navegador
 * lê `//outro.site` como URL absoluta.
 */
function safeNext(): string {
  const next = new URLSearchParams(window.location.search).get("next") ?? "/";
  return next.startsWith("/") && !next.startsWith("//") ? next : "/";
}

/**
 * Duas portas para o mesmo app.
 *
 * Se este navegador ja tem um codigo de 4 digitos cadastrado, e ele que
 * aparece — entrar deixa de passar pelo e-mail. O formulario de e-mail fica
 * como o caminho da primeira vez e a saida de emergencia de quem esqueceu o
 * codigo.
 */
export default function LoginPage() {
  /** null enquanto o servidor nao respondeu se conhece este aparelho. */
  const [device, setDevice] = useState<{ nome: string | null } | null>(null);
  const [checking, setChecking] = useState(true);

  /** Sobrevive a troca do teclado pelo e-mail: e o motivo dessa troca. */
  const [aviso, setAviso] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    aparelhoDoCodigo()
      .then((resposta) => {
        if (cancelled) return;
        if (resposta.reconhecido) setDevice({ nome: resposta.nome });
      })
      // Sem resposta, o e-mail continua funcionando: e o caminho seguro.
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setChecking(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="flex min-h-[70dvh] flex-col justify-center">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Mercadito</h1>
        <p className="mt-1 text-sm text-muted">
          A lista de mercado de vocês dois, com o histórico de tudo que já foi comprado.
        </p>
      </header>

      {checking ? (
        <div className="flex justify-center py-10 text-muted">
          <IconSpinner size={22} />
        </div>
      ) : device ? (
        <FormularioCodigo
          nome={device.nome}
          onDesistir={() => setDevice(null)}
          onAparelhoRecusado={(motivo) => {
            setAviso(motivo);
            setDevice(null);
          }}
        />
      ) : (
        <FormularioEmail aviso={aviso} />
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

/** Entrada normal de quem ja usou o app neste aparelho. */
function FormularioCodigo({
  nome,
  onDesistir,
  onAparelhoRecusado,
}: {
  nome: string | null;
  onDesistir: () => void;
  onAparelhoRecusado: (motivo: string) => void;
}) {
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function entrar(codigo: string) {
    setBusy(true);
    setError(null);

    try {
      await entrarComCodigo(codigo);

      // Recarga inteira em vez de router.push: a sessao acabou de nascer e o
      // provider precisa buscar tudo de novo com o cookie novo.
      window.location.href = safeNext();
    } catch (cause) {
      const message =
        cause instanceof Error ? cause.message : "Não consegui entrar.";

      // O servidor derrubou a confianca deste aparelho: nao adianta insistir no
      // codigo, so o e-mail resolve — e o motivo vai junto para a outra tela.
      if (cause instanceof PinError && cause.code === DEVICE_REJECTED) {
        onAparelhoRecusado(message);
        return;
      }

      setPin("");
      setBusy(false);
      setError(message);
    }
  }

  return (
    <div className="card p-5">
      <h2 className="text-base font-medium">
        {nome ? `Oi, ${nome}` : "Bem-vindo de volta"}
      </h2>
      <p className="mb-5 mt-1 text-sm text-muted">
        Digite seu código de {PIN_LENGTH} dígitos para entrar.
      </p>

      <PinInput
        label="Seu código"
        value={pin}
        onChange={setPin}
        onComplete={entrar}
        disabled={busy}
        autoFocus
      />

      <div className="mt-5 flex h-5 items-center justify-center">
        {busy && <IconSpinner size={18} />}
        {!busy && error && <p className="text-sm text-danger">{error}</p>}
      </div>

      <button type="button" onClick={onDesistir} className="btn-quiet mt-2 w-full">
        Esqueci o código — entrar com e-mail
      </button>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

/** Primeiro acesso, aparelho novo, ou codigo esquecido. */
function FormularioEmail({ aviso }: { aviso: string | null }) {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">(
    aviso ? "error" : "idle",
  );
  const [message, setMessage] = useState(aviso ?? "");

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

    const cleanCode = code.trim().toUpperCase().replace(/\s+/g, "");

    const { error } = await authClient.signIn.magicLink({
      email: email.trim(),
      callbackURL: safeNext(),
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

  if (status === "sent") {
    return (
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
    );
  }

  return (
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
        Código de convite
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
        Sem senha. Você recebe um link por e-mail e entra com um toque. Depois dá para
        criar um código de {PIN_LENGTH} dígitos e não precisar mais do e-mail.
      </p>

      {status === "error" && <p className="mt-3 text-sm text-danger">{message}</p>}
    </form>
  );
}
