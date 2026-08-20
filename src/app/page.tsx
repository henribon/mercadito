"use client";

import { useState } from "react";

import { AddItemForm } from "@/components/AddItemForm";
import { useApp } from "@/components/AppProvider";
import { Onboarding } from "@/components/Onboarding";
import {
  IconCheck,
  IconClock,
  IconRepeat,
  IconSpinner,
  IconTrash,
} from "@/components/Icons";
import { addProductToList, markBought, removeListItem } from "@/lib/data";
import { money, quantity, relativeDays } from "@/lib/format";
import type { ListItemWithProduct, Suggestion } from "@/lib/types";

export default function ListaPage() {
  const { loading, error, household, pending, suggestions } = useApp();

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-muted">
        <IconSpinner size={22} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="card mt-6 p-5">
        <p className="text-sm text-danger">{error}</p>
      </div>
    );
  }

  if (!household) return <Onboarding />;

  return (
    <div>
      <header className="mb-4">
        <h1 className="text-xl font-semibold tracking-tight">Lista</h1>
        <p className="text-sm text-muted">
          {pending.length === 0
            ? "Nada faltando"
            : `${pending.length} ${pending.length === 1 ? "item" : "itens"} para comprar`}
        </p>
      </header>

      <AddItemForm />

      {suggestions.length > 0 && <SuggestionsSection suggestions={suggestions} />}

      <section className="mt-6">
        {pending.length === 0 ? (
          <div className="card px-5 py-10 text-center">
            <p className="text-sm text-muted">
              A lista está vazia. Adicione o que estiver faltando.
            </p>
          </div>
        ) : (
          <ul className="card divide-y divide-border overflow-hidden">
            {pending.map((item) => (
              <PendingRow key={item.id} item={item} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function PendingRow({ item }: { item: ListItemWithProduct }) {
  const { supabase, refresh } = useApp();
  const [busy, setBusy] = useState<"buy" | "remove" | null>(null);

  const lastPurchase = item.product?.stats?.last_purchased_at ?? null;
  const lastPrice = item.product?.stats?.last_unit_price ?? null;

  async function handleBought() {
    setBusy("buy");
    try {
      await markBought(supabase, item.id);
      await refresh();
    } finally {
      setBusy(null);
    }
  }

  async function handleRemove() {
    setBusy("remove");
    try {
      await removeListItem(supabase, item.id);
      await refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <li className="flex items-center gap-3 px-3 py-3">
      <button
        type="button"
        onClick={handleBought}
        disabled={busy !== null}
        aria-label={`Marcar ${item.product?.name ?? "item"} como comprado`}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border
                   border-border text-transparent transition-colors
                   hover:border-accent hover:bg-accent-soft hover:text-accent"
      >
        {busy === "buy" ? (
          <IconSpinner size={16} className="text-muted" />
        ) : (
          <IconCheck size={16} />
        )}
      </button>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm">
          {item.product?.name ?? "Item"}
          {item.quantity > 1 && (
            <span className="text-muted"> · {quantity(item.quantity, item.product?.unit)}</span>
          )}
        </p>
        <p className="truncate text-xs text-muted">
          {lastPurchase ? `Última compra ${relativeDays(lastPurchase)}` : "Primeira vez"}
          {lastPrice !== null && ` · ${money(lastPrice)}`}
          {item.note && ` · ${item.note}`}
        </p>
      </div>

      <button
        type="button"
        onClick={handleRemove}
        disabled={busy !== null}
        aria-label={`Remover ${item.product?.name ?? "item"} da lista`}
        className="shrink-0 rounded-lg p-2 text-muted transition-colors hover:bg-surface-2 hover:text-danger"
      >
        {busy === "remove" ? <IconSpinner size={16} /> : <IconTrash size={16} />}
      </button>
    </li>
  );
}

/* -------------------------------------------------------------------------- */

function SuggestionsSection({ suggestions }: { suggestions: Suggestion[] }) {
  return (
    <section className="mt-6">
      <h2 className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted">
        <IconRepeat size={14} />
        Hora de repor
      </h2>

      <ul className="card divide-y divide-border overflow-hidden">
        {suggestions.map((suggestion) => (
          <SuggestionRow key={suggestion.product.id} suggestion={suggestion} />
        ))}
      </ul>
    </section>
  );
}

function SuggestionRow({ suggestion }: { suggestion: Suggestion }) {
  const { supabase, household, user, refresh } = useApp();
  const [busy, setBusy] = useState(false);

  const { product, reason, daysSince, intervalDays } = suggestion;
  const overdue = reason === "overdue";

  async function handleAdd() {
    if (!household || !user) return;
    setBusy(true);
    try {
      await addProductToList(supabase, household.id, user.id, product.id);
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm">{product.name}</p>
        <p className="flex items-center gap-1 truncate text-xs text-muted">
          <IconClock size={12} />
          {overdue
            ? `Faz ${daysSince} dias · costuma ser a cada ${intervalDays}`
            : `Faz ${daysSince} dias · perto dos ${intervalDays} de costume`}
        </p>
      </div>

      <span
        className={`chip shrink-0 ${
          overdue ? "bg-warn-soft text-warn" : "bg-surface-2 text-muted"
        }`}
      >
        {overdue ? "atrasado" : "chegando"}
      </span>

      <button
        type="button"
        onClick={handleAdd}
        disabled={busy}
        className="btn-ghost h-9 shrink-0 px-3 text-xs"
      >
        {busy ? <IconSpinner size={14} /> : "Adicionar"}
      </button>
    </li>
  );
}
