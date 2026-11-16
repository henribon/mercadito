"use client";

import { useEffect, useState } from "react";

import { IconSpinner } from "@/components/Icons";
import { PinInput } from "@/components/PinInput";
import { PIN_LENGTH } from "@/lib/auth-shared";
import {
  ativarCodigoAqui,
  definirCodigo,
  removerCodigo,
  statusDoCodigo,
} from "@/lib/pin-client";

/**
 * O codigo de 4 digitos, do ponto de vista de quem ja esta dentro.
 *
 * Tres estados, porque sao tres coisas diferentes: nao ter codigo, ter um que
 * este navegador ainda nao aceita (segundo aparelho) e ter tudo pronto.
 */
export function CodigoCard() {
  const [status, setStatus] = useState<{
    configurado: boolean;
    aparelhoAtivo: boolean;
  } | null>(null);

  const [editando, setEditando] = useState(false);
  const [pin, setPin] = useState("");
  const [repetido, setRepetido] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    statusDoCodigo()
      .then((atual) => {
        if (!cancelled) setStatus(atual);
      })
      .catch(() => {
        if (!cancelled) setStatus({ configurado: false, aparelhoAtivo: false });
      });

    return () => {
      cancelled = true;
    };
  }, []);

  function limpar() {
    setPin("");
    setRepetido("");
    setError(null);
  }

  /** Toda acao termina relendo o status: e ele que decide o que a tela mostra. */
  async function executar(acao: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await acao();
      setStatus(await statusDoCodigo());
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

    if (pin !== repetido) {
      setError("Os dois códigos não são iguais.");
      setRepetido("");
      return;
    }

    await executar(() => definirCodigo(pin));
  }

  if (!status) return null;

  const titulo = (
    <>
      <p className="text-sm">Código de {PIN_LENGTH} dígitos</p>
      <p className="text-xs text-muted">
        Atalho só deste aparelho: quatro dígitos no lugar do e-mail e da senha.
      </p>
    </>
  );

  if (editando || !status.configurado) {
    return (
      <>
        <form onSubmit={salvar} className="card p-4">
          {titulo}

          <div className="mt-4 space-y-4">
            <PinInput
              label={status.configurado ? "Novo código" : "Escolha um código"}
              value={pin}
              onChange={(value) => {
                setPin(value);
                setError(null);
              }}
              disabled={busy}
              autoFocus={editando}
            />
            <PinInput
              label="Repita para confirmar"
              value={repetido}
              onChange={(value) => {
                setRepetido(value);
                setError(null);
              }}
              disabled={busy}
            />
          </div>

          <button
            type="submit"
            disabled={busy || pin.length < PIN_LENGTH || repetido.length < PIN_LENGTH}
            className="btn-primary mt-5 w-full"
          >
            {busy && <IconSpinner size={16} />}
            {status.configurado ? "Trocar código" : "Criar código"}
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

          {error && <p className="mt-3 text-sm text-danger">{error}</p>}
        </form>
      </>
    );
  }

  return (
    <>
      <div className="card p-4">
        {titulo}

        <p className="mt-3 text-sm">
          {status.aparelhoAtivo
            ? "Ativo neste aparelho."
            : "Criado, mas este aparelho ainda pede o e-mail."}
        </p>

        <div className="mt-4 flex flex-wrap gap-2 border-t border-border pt-4">
          {!status.aparelhoAtivo && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void executar(ativarCodigoAqui)}
              className="btn-primary flex-1"
            >
              {busy && <IconSpinner size={16} />}
              Usar neste aparelho
            </button>
          )}

          <button
            type="button"
            disabled={busy}
            onClick={() => setEditando(true)}
            className="btn-ghost flex-1"
          >
            Trocar
          </button>

          <button
            type="button"
            disabled={busy}
            onClick={() => void executar(removerCodigo)}
            className="btn-quiet flex-1"
          >
            Remover
          </button>
        </div>

        {error && <p className="mt-3 text-sm text-danger">{error}</p>}
      </div>
    </>
  );
}
