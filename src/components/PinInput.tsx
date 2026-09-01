"use client";

import { useId, useRef, useState } from "react";

import { PIN_LENGTH } from "@/lib/auth-shared";

/**
 * Campo do codigo de 4 digitos.
 *
 * Sao quatro caixinhas desenhadas, com um unico <input> de verdade invisivel
 * por cima: e ele que abre o teclado numerico do celular e faz colar, apagar e
 * autopreenchimento funcionarem sem reimplementar nada. Quatro inputs
 * separados dariam a mesma aparencia e uma pilha de bugs de foco.
 */
export function PinInput({
  value,
  onChange,
  onComplete,
  label,
  hint,
  disabled = false,
  autoFocus = false,
}: {
  value: string;
  onChange: (value: string) => void;
  /** Chamado quando o quarto digito entra — evita um botao a mais no login. */
  onComplete?: (value: string) => void;
  label: string;
  hint?: string;
  disabled?: boolean;
  autoFocus?: boolean;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);

  function handleChange(raw: string) {
    const digits = raw.replace(/\D/g, "").slice(0, PIN_LENGTH);
    if (digits === value) return;

    onChange(digits);
    if (digits.length === PIN_LENGTH) onComplete?.(digits);
  }

  return (
    <div>
      <label htmlFor={id} className="label">
        {label}
      </label>

      <div className="relative" onPointerDown={() => input.current?.focus()}>
        <div className="flex justify-center gap-3" aria-hidden>
          {Array.from({ length: PIN_LENGTH }, (_, index) => {
            // A caixa "atual" e a primeira vazia; com tudo preenchido, a ultima.
            const active =
              focused && index === Math.min(value.length, PIN_LENGTH - 1);

            return (
              <div
                key={index}
                className={`flex h-14 w-12 items-center justify-center rounded-xl border
                            text-2xl transition-colors
                            ${
                              active
                                ? "border-accent bg-surface"
                                : "border-border bg-surface-2"
                            }
                            ${disabled ? "opacity-40" : ""}`}
              >
                {value[index] ? "•" : ""}
              </div>
            );
          })}
        </div>

        <input
          id={id}
          ref={input}
          value={value}
          onChange={(event) => handleChange(event.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          disabled={disabled}
          autoFocus={autoFocus}
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={PIN_LENGTH}
          aria-label={label}
          // Invisivel, mas cobrindo as caixinhas: e nele que o toque cai.
          className="absolute inset-0 h-full w-full cursor-default opacity-0"
        />
      </div>

      {hint && <p className="mt-2 text-center text-xs text-muted">{hint}</p>}
    </div>
  );
}
