"use client";

import { useEffect, useState } from "react";

import { CodigoCard } from "@/components/account/CodigoCard";
import { SenhaCard } from "@/components/account/SenhaCard";
import { useApp } from "@/components/AppProvider";
import { IconLogout, IconSpinner } from "@/components/Icons";
import { DISPLAY_NAME_MAX_LENGTH, EMAIL_MAX_LENGTH } from "@/lib/account";
import {
  getAccountSettings,
  setReportEnabled,
  updateDisplayName,
  updateReportEmail,
  type AccountResult,
  type AccountSettings,
} from "@/lib/actions";
import { authClient } from "@/lib/auth-client";

/**
 * Tudo que e da pessoa, e nao da lista: como ela e chamada, para onde vai o
 * relatorio, com que chaves entra no app e de que casa faz parte.
 *
 * As tres primeiras secoes dependem das configuracoes gravadas no banco; as de
 * entrada e da casa nao — por isso continuam na tela mesmo que a carga falhe, e
 * "Sair" nunca fica fora de alcance.
 */
export default function ContaPage() {
  const { loading, household, user } = useApp();

  const [settings, setSettings] = useState<AccountSettings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const householdId = household?.id ?? null;

  useEffect(() => {
    if (!householdId) return;

    let cancelled = false;

    getAccountSettings()
      .then((result) => {
        if (cancelled) return;
        if (result.ok) {
          setSettings(result.settings);
          setLoadError(null);
        } else {
          setLoadError(result.message);
        }
      })
      .catch(() => {
        if (!cancelled) setLoadError("Não consegui carregar as configurações.");
      });

    return () => {
      cancelled = true;
    };
    // Pelo id, e nao pelo objeto: o provider troca o objeto `household` a cada
    // sincronizacao (15s), e recarregar junto apagaria o que esta sendo digitado.
  }, [householdId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-muted">
        <IconSpinner size={22} />
      </div>
    );
  }

  return (
    <div>
      <header className="mb-4">
        <h1 className="text-xl font-semibold tracking-tight">Conta</h1>
        <p className="truncate text-sm text-muted">{user?.email ?? "Suas configurações"}</p>
      </header>

      {!household ? (
        <p className="py-6 text-sm text-muted">Crie ou entre numa casa primeiro.</p>
      ) : (
        <>
          {loadError && (
            <div className="card p-4">
              <p role="alert" className="text-sm text-danger">
                {loadError}
              </p>
            </div>
          )}

          {!settings && !loadError && (
            <div className="flex justify-center py-10 text-muted">
              <IconSpinner size={22} />
            </div>
          )}

          {settings && (
            <>
              <Section title="Perfil" first>
                <PerfilCard settings={settings} onSaved={setSettings} />
              </Section>

              <Section title="Relatório por e-mail">
                <RelatorioCard settings={settings} onSaved={setSettings} />
              </Section>
            </>
          )}

          <Section title="Entrar no app" first={!settings}>
            <div className="space-y-3">
              <SenhaCard />
              <CodigoCard />
            </div>
          </Section>

          <Section title={household.name}>
            <ConviteCard code={household.invite_code} />
          </Section>
        </>
      )}

      <button
        type="button"
        onClick={async () => {
          await authClient.signOut();
          window.location.href = "/login";
        }}
        className="btn-ghost mt-8 w-full"
      >
        <IconLogout size={16} />
        Sair
      </button>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function Section({
  title,
  first = false,
  children,
}: {
  title: string;
  first?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className={first ? "mt-5" : "mt-8"}>
      <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">
        {title}
      </h2>
      {children}
    </section>
  );
}

/* -------------------------------------------------------------------------- */

function PerfilCard({
  settings,
  onSaved,
}: {
  settings: AccountSettings;
  onSaved: (settings: AccountSettings) => void;
}) {
  return (
    <div className="card p-4">
      <TextSetting
        id="conta-nome"
        label="Nome"
        value={settings.displayName}
        read={(saved) => saved.displayName}
        maxLength={DISPLAY_NAME_MAX_LENGTH}
        autoComplete="name"
        hint="É como o relatório mensal chama você."
        save={updateDisplayName}
        onSaved={onSaved}
      />

      <div className="mt-4 border-t border-border pt-4">
        <p className="text-xs font-medium text-muted">E-mail de login</p>
        <p className="mt-1 break-all text-sm">{settings.loginEmail}</p>
        <p className="mt-1 text-xs text-muted">
          É com ele que você entra no app, e não dá para trocar por aqui. O relatório
          pode ir para outro endereço — escolha logo abaixo.
        </p>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * O relatorio mensal: se chega sozinho todo comeco de mes, e em que endereco.
 *
 * O endereco vale tambem para o "Enviar agora" da aba Resumo — por isso o campo
 * continua editavel com o envio automatico desligado.
 */
function RelatorioCard({
  settings,
  onSaved,
}: {
  settings: AccountSettings;
  onSaved: (settings: AccountSettings) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const destination = settings.reportEmail ?? settings.loginEmail;

  async function toggle() {
    const reportEnabled = !settings.reportEnabled;

    setBusy(true);
    setError(null);
    try {
      await setReportEnabled(reportEnabled);
      onSaved({ ...settings, reportEnabled });
    } catch {
      setError("Não consegui salvar. Tente de novo.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card p-4">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm">Receber todo começo de mês</p>
          <p className="mt-0.5 text-xs text-muted">
            O fechamento do mês anterior: itens mais caros, no que você mais gastou,
            onde saiu mais barato e a melhor época para comprar o que se repete.
          </p>
        </div>

        <button
          type="button"
          role="switch"
          aria-checked={settings.reportEnabled}
          aria-label="Receber o relatório todo começo de mês"
          disabled={busy}
          onClick={() => void toggle()}
          className={`relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors
                      disabled:opacity-40 ${
                        settings.reportEnabled ? "bg-accent" : "bg-border"
                      }`}
        >
          <span
            className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-sm
                        transition-transform ${
                          settings.reportEnabled ? "translate-x-5" : "translate-x-0"
                        }`}
          />
        </button>
      </div>

      {error && (
        <p role="alert" className="mt-3 text-sm text-danger">
          {error}
        </p>
      )}

      <div className="mt-4 border-t border-border pt-4">
        <TextSetting
          id="conta-email-relatorio"
          label="Enviar para"
          type="email"
          value={settings.reportEmail ?? ""}
          read={(saved) => saved.reportEmail ?? ""}
          placeholder={settings.loginEmail}
          maxLength={EMAIL_MAX_LENGTH}
          autoComplete="email"
          hint={
            <>
              Hoje vai para <span className="break-all text-text">{destination}</span>
              {settings.reportEmail
                ? ". Apague o campo para voltar ao e-mail de login."
                : ", o seu e-mail de login. Preencha para mandar a outro endereço."}{" "}
              Vale também para o “Enviar agora” da aba Resumo.
            </>
          }
          save={updateReportEmail}
          onSaved={onSaved}
        />
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * Um campo de texto com o proprio "Salvar".
 *
 * Salvar e explicito (e nao ao sair do campo) porque o valor tem consequencia
 * fora da tela: um e-mail digitado pela metade nao pode virar o destino do
 * relatorio so porque o dedo tocou em outro lugar.
 */
function TextSetting({
  id,
  label,
  value,
  read,
  hint,
  save,
  onSaved,
  type = "text",
  placeholder,
  maxLength,
  autoComplete,
}: {
  id: string;
  label: string;
  /** O valor gravado. */
  value: string;
  /** O mesmo valor, lido do que o servidor devolve depois de salvar. */
  read: (settings: AccountSettings) => string;
  hint: React.ReactNode;
  save: (value: string) => Promise<AccountResult>;
  onSaved: (settings: AccountSettings) => void;
  type?: "text" | "email";
  placeholder?: string;
  maxLength?: number;
  autoComplete?: string;
}) {
  const [draft, setDraft] = useState(value);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  // O servidor pode devolver o valor normalizado (espacos, caixa do e-mail).
  useEffect(() => setDraft(value), [value]);

  const dirty = draft.trim() !== value;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!dirty) return;

    setBusy(true);
    setFeedback(null);
    try {
      const result = await save(draft);
      if (result.ok) {
        // Direto, sem esperar o efeito acima: quem digita o proprio e-mail de
        // login grava "em branco", e o valor gravado nem chega a mudar.
        setDraft(read(result.settings));
        onSaved(result.settings);
        setFeedback({ ok: true, text: "Salvo." });
      } else {
        setFeedback({ ok: false, text: result.message });
      }
    } catch {
      setFeedback({ ok: false, text: "Não consegui salvar. Tente de novo." });
    } finally {
      setBusy(false);
    }
  }

  return (
    // noValidate: a validacao e a do servidor, com a mensagem em portugues, em
    // vez do balao do navegador.
    <form onSubmit={submit} noValidate>
      <label htmlFor={id} className="label">
        {label}
      </label>

      <div className="flex gap-2">
        <input
          id={id}
          name={id}
          type={type}
          inputMode={type === "email" ? "email" : undefined}
          autoCapitalize={type === "email" ? "none" : undefined}
          autoCorrect={type === "email" ? "off" : undefined}
          spellCheck={false}
          autoComplete={autoComplete}
          placeholder={placeholder}
          maxLength={maxLength}
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            setFeedback(null);
          }}
          disabled={busy}
          aria-describedby={`${id}-hint`}
          className="field min-w-0 flex-1"
        />

        <button type="submit" disabled={busy || !dirty} className="btn-primary shrink-0">
          {busy ? <IconSpinner size={16} /> : "Salvar"}
        </button>
      </div>

      {feedback ? (
        <p
          id={`${id}-hint`}
          role={feedback.ok ? "status" : "alert"}
          className={`mt-1.5 text-xs ${feedback.ok ? "text-accent" : "text-danger"}`}
        >
          {feedback.text}
        </p>
      ) : (
        <p id={`${id}-hint`} className="mt-1.5 text-xs text-muted">
          {hint}
        </p>
      )}
    </form>
  );
}

/* -------------------------------------------------------------------------- */

function ConviteCard({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="card p-4">
      <p className="text-sm">Código de convite</p>
      <p className="text-xs text-muted">Quem tiver este código entra na mesma lista.</p>

      <button
        type="button"
        onClick={copy}
        className="mt-3 w-full rounded-lg border border-border bg-surface-2 py-3
                   font-mono text-lg tracking-[0.3em]"
      >
        {code}
      </button>
      <p className="mt-1.5 h-4 text-center text-xs text-muted">
        {copied ? "Copiado" : "Toque para copiar"}
      </p>
    </div>
  );
}
