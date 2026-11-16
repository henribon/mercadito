"use client";

import { useEffect, useState } from "react";

import { useApp } from "@/components/AppProvider";
import { IconSpinner } from "@/components/Icons";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "@/lib/auth-shared";
import { definirSenha, removerSenha, statusDaSenha } from "@/lib/password-client";

/**
 * A senha, do ponto de vista de quem ja esta dentro.
 *
 * E aqui que ela nasce: a conta e criada pelo link do e-mail, e a senha e uma
 * chave a mais, escolhida depois. Vale em qualquer aparelho — e o que permite
 * entrar no app instalado, onde o link do e-mail abriria no navegador.
 */
export function SenhaCard() {
  const { user } = useApp();

  const [configurada, setConfigurada] = useState<boolean | null>(null);
  const [editando, setEditando] = useState(false);
  const [senha, setSenha] = useState("");
  const [repetida, setRepetida] = useState("");
  const [mostrar, setMostrar] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [salva, setSalva] = useState(false);

  useEffect(() => {
    let cancelled = false;

    statusDaSenha()
      .then((atual) => {
        if (!cancelled) setConfigurada(atual.configurada);
      })
      .catch(() => {
        if (!cancelled) setConfigurada(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  function limpar() {
    setSenha("");
    setRepetida("");
    setMostrar(false);
    setError(null);
  }

  async function executar(acao: () => Promise<unknown>, depois: boolean) {
    setBusy(true);
    setError(null);
    try {
      await acao();
      setConfigurada(depois);
      setSalva(depois);
      setEditando(false);
      limpar();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não consegui salvar.");
    } finally {
      setBusy(false);
    }
  }

  async function salvar(event: React.FormEvent) {
    event.preventDefault();

    if (senha.length < PASSWORD_MIN_LENGTH) {
      setError(`A senha precisa ter pelo menos ${PASSWORD_MIN_LENGTH} caracteres.`);
      return;
    }
    if (senha !== repetida) {
      setError("As duas senhas não são iguais.");
      setRepetida("");
      return;
    }

    await executar(() => definirSenha(senha), true);
  }

  if (configurada === null) return null;

  const titulo = (
    <>
      <p className="text-sm">Senha</p>
      <p className="text-xs text-muted">
        Com e-mail e senha você entra em qualquer aparelho, sem esperar o link. Depois
        de entrar, o aparelho fica conectado.
      </p>
    </>
  );

  if (editando || !configurada) {
    return (
      <form onSubmit={salvar} className="card p-4">
        {titulo}

        {/* Invisivel, mas e o que deixa o gerenciador de senhas do celular
            guardar a senha junto do e-mail certo. */}
        <input
          type="email"
          name="email"
          autoComplete="username"
          value={user?.email ?? ""}
          readOnly
          hidden
        />

        <label htmlFor="nova-senha" className="label mt-4">
          {configurada ? "Nova senha" : "Escolha uma senha"}
        </label>
        <input
          id="nova-senha"
          name="nova-senha"
          type={mostrar ? "text" : "password"}
          autoComplete="new-password"
          minLength={PASSWORD_MIN_LENGTH}
          maxLength={PASSWORD_MAX_LENGTH}
          value={senha}
          onChange={(event) => {
            setSenha(event.target.value);
            setError(null);
          }}
          disabled={busy}
          autoFocus={editando}
          className="field"
        />
        <p className="mt-1.5 text-xs text-muted">
          Pelo menos {PASSWORD_MIN_LENGTH} caracteres.
        </p>

        <label htmlFor="repetir-senha" className="label mt-4">
          Repita para confirmar
        </label>
        <input
          id="repetir-senha"
          name="repetir-senha"
          type={mostrar ? "text" : "password"}
          autoComplete="new-password"
          maxLength={PASSWORD_MAX_LENGTH}
          value={repetida}
          onChange={(event) => {
            setRepetida(event.target.value);
            setError(null);
          }}
          disabled={busy}
          className="field"
        />

        <label className="mt-3 flex items-center gap-2 text-xs text-muted">
          <input
            type="checkbox"
            checked={mostrar}
            onChange={(event) => setMostrar(event.target.checked)}
            className="h-4 w-4 accent-[var(--accent)]"
          />
          Mostrar a senha
        </label>

        <button
          type="submit"
          disabled={busy || !senha || !repetida}
          className="btn-primary mt-4 w-full"
        >
          {busy && <IconSpinner size={16} />}
          {configurada ? "Trocar senha" : "Criar senha"}
        </button>

        {editando && (
          <button
            type="button"
            onClick={() => {
              setEditando(false);
              limpar();
            }}
            className="btn-quiet mt-1 w-full"
          >
            Cancelar
          </button>
        )}

        {error && (
          <p role="alert" className="mt-3 text-sm text-danger">
            {error}
          </p>
        )}
      </form>
    );
  }

  return (
    <div className="card p-4">
      {titulo}

      <p className="mt-3 text-sm">
        {salva ? "Senha salva. " : "Senha criada. "}
        <span className="text-muted">Entre com {user?.email} e ela.</span>
      </p>

      <div className="mt-4 flex flex-wrap gap-2 border-t border-border pt-4">
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setSalva(false);
            setEditando(true);
          }}
          className="btn-ghost flex-1"
        >
          Trocar
        </button>

        <button
          type="button"
          disabled={busy}
          onClick={() => void executar(removerSenha, false)}
          className="btn-quiet flex-1"
        >
          {busy && <IconSpinner size={16} />}
          Remover
        </button>
      </div>

      {error && (
        <p role="alert" className="mt-3 text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
