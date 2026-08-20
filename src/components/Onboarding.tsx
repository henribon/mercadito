"use client";

import { useState } from "react";

import { useApp } from "./AppProvider";
import { IconSpinner } from "./Icons";
import { createHousehold, joinHousehold } from "@/lib/actions";

/**
 * Primeiro acesso: um cria a casa, o outro entra com o codigo de convite.
 * E o unico passo de configuracao do app inteiro.
 */
export function Onboarding() {
  const { user, refresh } = useApp();

  const [mode, setMode] = useState<"create" | "join">("create");
  const [houseName, setHouseName] = useState("Nossa casa");
  const [inviteCode, setInviteCode] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const name = displayName.trim() || user?.email?.split("@")[0] || undefined;

    try {
      if (mode === "create") {
        await createHousehold(houseName.trim(), name);
      } else {
        await joinHousehold(inviteCode.trim().toUpperCase(), name);
      }
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não consegui concluir.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="py-6">
      <h1 className="text-xl font-semibold tracking-tight">Quase lá</h1>
      <p className="mt-1 text-sm text-muted">
        A lista fica dentro de uma casa compartilhada. Crie a sua ou entre na que já existe.
      </p>

      <div className="mt-5 flex gap-1 rounded-lg bg-surface-2 p-1">
        <button
          type="button"
          onClick={() => setMode("create")}
          className={`flex-1 rounded-md py-2 text-sm font-medium transition-colors ${
            mode === "create" ? "bg-surface text-text shadow-sm" : "text-muted"
          }`}
        >
          Criar casa
        </button>
        <button
          type="button"
          onClick={() => setMode("join")}
          className={`flex-1 rounded-md py-2 text-sm font-medium transition-colors ${
            mode === "join" ? "bg-surface text-text shadow-sm" : "text-muted"
          }`}
        >
          Entrar com código
        </button>
      </div>

      <form onSubmit={handleSubmit} className="card mt-4 p-5">
        {mode === "create" ? (
          <>
            <label htmlFor="house" className="label">
              Nome da casa
            </label>
            <input
              id="house"
              value={houseName}
              onChange={(event) => setHouseName(event.target.value)}
              className="field"
              required
            />
          </>
        ) : (
          <>
            <label htmlFor="code" className="label">
              Código de convite
            </label>
            <input
              id="code"
              value={inviteCode}
              onChange={(event) => setInviteCode(event.target.value.toUpperCase())}
              placeholder="A1B2C3"
              autoCapitalize="characters"
              className="field font-mono tracking-widest"
              required
            />
          </>
        )}

        <label htmlFor="display" className="label mt-4">
          Como você aparece na lista
        </label>
        <input
          id="display"
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
          placeholder={user?.email?.split("@")[0] ?? "Seu nome"}
          className="field"
        />

        <button type="submit" disabled={busy} className="btn-primary mt-5 w-full">
          {busy && <IconSpinner size={16} />}
          {mode === "create" ? "Criar casa" : "Entrar na casa"}
        </button>

        {error && <p className="mt-3 text-sm text-danger">{error}</p>}
      </form>
    </div>
  );
}
