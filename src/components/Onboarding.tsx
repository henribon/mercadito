"use client";

import { useEffect, useRef, useState } from "react";

import { useApp } from "./AppProvider";
import { IconSpinner } from "./Icons";
import { anyHouseholdExists, createHousehold, joinHousehold } from "@/lib/actions";
import { PENDING_CODE_KEY } from "@/lib/auth-shared";

/**
 * Passo entre entrar no app e ter uma lista.
 *
 * Quem chegou com o codigo de acesso ja foi validado no login, entao entramos
 * na casa automaticamente e essa tela nem aparece. Ela so e mostrada quando o
 * codigo se perdeu (outro navegador, aba anonima) ou quando e o primeiro acesso
 * de todos, que e quem cria a casa.
 */
export function Onboarding() {
  const { user, refresh } = useApp();

  const [mode, setMode] = useState<"create" | "join">("join");
  const [houseName, setHouseName] = useState("Nossa casa");
  const [inviteCode, setInviteCode] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** null enquanto nao sabemos; decide se "criar casa" pode ser oferecido. */
  const [houseExists, setHouseExists] = useState<boolean | null>(null);
  const [autoJoining, setAutoJoining] = useState(false);

  // Uma tentativa por montagem: se o codigo guardado for invalido, cai para o
  // formulario em vez de repetir o mesmo erro em loop.
  const autoJoinTried = useRef(false);

  useEffect(() => {
    let cancelled = false;

    async function start() {
      const existe = await anyHouseholdExists().catch(() => true);
      if (cancelled) return;

      setHouseExists(existe);
      setMode(existe ? "join" : "create");

      if (autoJoinTried.current) return;
      autoJoinTried.current = true;

      let saved: string | null = null;
      try {
        saved = sessionStorage.getItem(PENDING_CODE_KEY);
      } catch {
        saved = null;
      }
      if (!saved || !existe) return;

      setAutoJoining(true);
      try {
        await joinHousehold(saved, user?.email?.split("@")[0]);
        try {
          sessionStorage.removeItem(PENDING_CODE_KEY);
        } catch {
          // sem sessionStorage: nada a limpar
        }
        await refresh();
      } catch {
        if (!cancelled) setInviteCode(saved);
      } finally {
        if (!cancelled) setAutoJoining(false);
      }
    }

    void start();
    return () => {
      cancelled = true;
    };
  }, [refresh, user]);

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

  if (houseExists === null || autoJoining) {
    return (
      <div className="flex flex-col items-center gap-3 py-24 text-muted">
        <IconSpinner size={22} />
        {autoJoining && <p className="text-sm">Entrando na casa…</p>}
      </div>
    );
  }

  return (
    <div className="py-6">
      <h1 className="text-xl font-semibold tracking-tight">Quase lá</h1>
      <p className="mt-1 text-sm text-muted">
        {houseExists
          ? "Informe o código de acesso para entrar na lista compartilhada."
          : "Crie a casa onde a lista de vocês vai ficar."}
      </p>

      <form onSubmit={handleSubmit} className="card mt-5 p-5">
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
              Código de acesso
            </label>
            <input
              id="code"
              value={inviteCode}
              onChange={(event) => setInviteCode(event.target.value.toUpperCase())}
              placeholder="A1B2C3"
              autoCapitalize="characters"
              autoComplete="off"
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
