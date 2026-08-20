"use client";

import { useMemo, useState } from "react";

import { useApp } from "./AppProvider";
import { IconPlus, IconSpinner } from "./Icons";
import { addProductToList, addToList } from "@/lib/data";
import { relativeDays, money } from "@/lib/format";
import { normalizeName, similarity } from "@/lib/normalize";

/**
 * Campo unico de adicionar. Enquanto digita, sugere produtos que ja existem no
 * catalogo com o preco e a data da ultima compra — assim o casal reaproveita o
 * mesmo produto em vez de criar "leite", "Leite" e "leite integral".
 */
export function AddItemForm() {
  const { supabase, household, user, products, pending, refresh } = useApp();

  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pendingIds = useMemo(
    () => new Set(pending.map((item) => item.product_id)),
    [pending],
  );

  const matches = useMemo(() => {
    const query = text.trim();
    if (query.length < 2) return [];

    return products
      .filter((product) => !pendingIds.has(product.id))
      .map((product) => ({ product, score: similarity(query, product.name) }))
      .filter(({ product, score }) => {
        const norm = normalizeName(product.name);
        return score >= 0.4 || norm.includes(normalizeName(query));
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);
  }, [text, products, pendingIds]);

  /** Nome digitado ja existe exatamente? Entao nao oferecemos "criar". */
  const exactMatch = useMemo(() => {
    const norm = normalizeName(text);
    if (!norm) return null;
    return products.find((product) => product.norm_name === norm) ?? null;
  }, [text, products]);

  async function submitNew(event: React.FormEvent) {
    event.preventDefault();

    const name = text.trim();
    if (!name || !household || !user) return;

    setBusy(true);
    setError(null);

    try {
      if (exactMatch) {
        await addProductToList(supabase, household.id, user.id, exactMatch.id);
      } else {
        await addToList(supabase, household.id, user.id, name);
      }
      setText("");
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não consegui adicionar.");
    } finally {
      setBusy(false);
    }
  }

  async function addExisting(productId: string) {
    if (!household || !user) return;

    setBusy(true);
    setError(null);

    try {
      await addProductToList(supabase, household.id, user.id, productId);
      setText("");
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não consegui adicionar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <form onSubmit={submitNew} className="flex gap-2">
        <input
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="O que está faltando?"
          aria-label="Item para adicionar à lista"
          enterKeyHint="done"
          className="field flex-1"
        />
        <button
          type="submit"
          disabled={busy || !text.trim()}
          aria-label="Adicionar à lista"
          className="btn-primary w-11 px-0"
        >
          {busy ? <IconSpinner size={18} /> : <IconPlus size={18} />}
        </button>
      </form>

      {matches.length > 0 && (
        <ul className="card mt-2 divide-y divide-border overflow-hidden">
          {matches.map(({ product }) => (
            <li key={product.id}>
              <button
                type="button"
                onClick={() => addExisting(product.id)}
                className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left
                           hover:bg-surface-2"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm">{product.name}</span>
                  <span className="block text-xs text-muted">
                    {product.stats?.last_purchased_at
                      ? `Última: ${relativeDays(product.stats.last_purchased_at)}`
                      : "Nunca comprado"}
                    {product.stats?.last_unit_price
                      ? ` · ${money(product.stats.last_unit_price)}`
                      : ""}
                  </span>
                </span>
                <IconPlus size={16} className="shrink-0 text-muted" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
    </div>
  );
}
