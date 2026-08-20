"use client";

import { useMemo, useState } from "react";

import { useApp } from "@/components/AppProvider";
import {
  IconChevronRight,
  IconPlus,
  IconRepeat,
  IconSpinner,
  IconTrash,
} from "@/components/Icons";
import {
  addProductToList,
  deleteProduct,
  expectedInterval,
  suggestedRecurrenceDays,
  updateProduct,
} from "@/lib/data";
import { everyDays, money, relativeDays } from "@/lib/format";
import { normalizeName } from "@/lib/normalize";
import type { ProductWithStats } from "@/lib/types";

export default function ProdutosPage() {
  const { household, products, pending } = useApp();
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  const pendingIds = useMemo(
    () => new Set(pending.map((item) => item.product_id)),
    [pending],
  );

  const filtered = useMemo(() => {
    const norm = normalizeName(query);
    if (!norm) return products;

    const terms = norm.split(" ");
    return products.filter((product) =>
      terms.every((term) => product.norm_name.includes(term)),
    );
  }, [query, products]);

  if (!household) {
    return <p className="py-10 text-sm text-muted">Crie ou entre numa casa primeiro.</p>;
  }

  const recurring = filtered.filter((product) => product.is_recurring);
  const rest = filtered.filter((product) => !product.is_recurring);

  return (
    <div>
      <header className="mb-4">
        <h1 className="text-xl font-semibold tracking-tight">Produtos</h1>
        <p className="text-sm text-muted">
          {products.length} {products.length === 1 ? "produto" : "produtos"} no catálogo
        </p>
      </header>

      <input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Buscar produto"
        aria-label="Buscar produto"
        className="field"
      />

      {filtered.length === 0 ? (
        <div className="card mt-4 px-5 py-10 text-center">
          <p className="text-sm text-muted">
            {products.length === 0
              ? "O catálogo se preenche sozinho conforme vocês adicionam itens e escaneiam notas."
              : "Nenhum produto com esse nome."}
          </p>
        </div>
      ) : (
        <>
          {recurring.length > 0 && (
            <Group
              title="Sempre em casa"
              products={recurring}
              openId={openId}
              onToggle={setOpenId}
              pendingIds={pendingIds}
            />
          )}
          {rest.length > 0 && (
            <Group
              title={recurring.length > 0 ? "Demais produtos" : "Todos"}
              products={rest}
              openId={openId}
              onToggle={setOpenId}
              pendingIds={pendingIds}
            />
          )}
        </>
      )}

      <CasaCard />
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function Group({
  title,
  products,
  openId,
  onToggle,
  pendingIds,
}: {
  title: string;
  products: ProductWithStats[];
  openId: string | null;
  onToggle: (id: string | null) => void;
  pendingIds: Set<string>;
}) {
  return (
    <section className="mt-5">
      <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">
        {title}
      </h2>
      <ul className="card divide-y divide-border overflow-hidden">
        {products.map((product) => (
          <ProductRow
            key={product.id}
            product={product}
            open={openId === product.id}
            onToggle={() => onToggle(openId === product.id ? null : product.id)}
            inList={pendingIds.has(product.id)}
          />
        ))}
      </ul>
    </section>
  );
}

function ProductRow({
  product,
  open,
  onToggle,
  inList,
}: {
  product: ProductWithStats;
  open: boolean;
  onToggle: () => void;
  inList: boolean;
}) {
  const { supabase, household, user, refresh } = useApp();
  const [busy, setBusy] = useState(false);

  const stats = product.stats;
  const interval = expectedInterval(product);

  async function patch(changes: Parameters<typeof updateProduct>[2]) {
    setBusy(true);
    try {
      await updateProduct(supabase, product.id, changes);
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function handleAddToList() {
    if (!household || !user) return;
    setBusy(true);
    try {
      await addProductToList(supabase, household.id, user.id, product.id);
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!window.confirm(`Remover "${product.name}" do catálogo e todo o seu histórico?`)) {
      return;
    }
    setBusy(true);
    try {
      await deleteProduct(supabase, product.id);
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <li>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-surface-2"
      >
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm">
            {product.name}
            {inList && <span className="text-muted"> · na lista</span>}
          </p>
          <p className="truncate text-xs text-muted">
            {stats?.last_purchased_at
              ? `Última ${relativeDays(stats.last_purchased_at)}`
              : "Nunca comprado"}
            {stats?.last_unit_price !== null && stats?.last_unit_price !== undefined
              ? ` · ${money(stats.last_unit_price)}`
              : ""}
            {stats && stats.purchase_count > 1 ? ` · ${stats.purchase_count}×` : ""}
          </p>
        </div>

        {product.is_recurring && (
          <span className="chip shrink-0 bg-accent-soft text-accent">
            <IconRepeat size={11} />
            {everyDays(interval)}
          </span>
        )}

        <IconChevronRight
          size={16}
          className={`shrink-0 text-muted transition-transform ${open ? "rotate-90" : ""}`}
        />
      </button>

      {open && (
        <div className="border-t border-border bg-surface-2 px-4 py-4">
          <label className="label" htmlFor={`name-${product.id}`}>
            Nome
          </label>
          <input
            id={`name-${product.id}`}
            defaultValue={product.name}
            onBlur={(event) => {
              const value = event.target.value.trim();
              if (value && value !== product.name) void patch({ name: value });
            }}
            className="field bg-surface"
          />

          <div className="mt-4 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm">Compramos sempre</p>
              <p className="text-xs text-muted">
                {product.is_recurring
                  ? "Avisa na lista quando passar do intervalo."
                  : stats?.avg_interval_days
                    ? `Histórico sugere ${everyDays(stats.avg_interval_days)}.`
                    : "Marque para receber lembrete de reposição."}
              </p>
            </div>

            <button
              type="button"
              role="switch"
              aria-checked={product.is_recurring}
              aria-label="Compramos sempre"
              disabled={busy}
              onClick={() =>
                patch({
                  is_recurring: !product.is_recurring,
                  recurrence_days: product.is_recurring
                    ? product.recurrence_days
                    : suggestedRecurrenceDays(product),
                })
              }
              className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
                product.is_recurring ? "bg-accent" : "bg-border"
              }`}
            >
              <span
                className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
                  product.is_recurring ? "translate-x-[22px]" : "translate-x-0.5"
                }`}
              />
            </button>
          </div>

          {product.is_recurring && (
            <div className="mt-4">
              <label className="label" htmlFor={`days-${product.id}`}>
                Lembrar a cada quantos dias
              </label>
              <input
                id={`days-${product.id}`}
                type="number"
                inputMode="numeric"
                min={1}
                max={365}
                defaultValue={product.recurrence_days ?? suggestedRecurrenceDays(product)}
                onBlur={(event) => {
                  const days = Number(event.target.value);
                  if (days > 0 && days !== product.recurrence_days) {
                    void patch({ recurrence_days: days });
                  }
                }}
                className="field bg-surface"
              />
            </div>
          )}

          {stats && stats.purchase_count > 0 && (
            <dl className="mt-4 grid grid-cols-3 gap-3 text-xs">
              <Stat label="Vezes" value={String(stats.purchase_count)} />
              <Stat label="Preço médio" value={money(stats.avg_unit_price)} />
              <Stat
                label="Intervalo"
                value={
                  stats.avg_interval_days ? `${stats.avg_interval_days} dias` : "—"
                }
              />
            </dl>
          )}

          <div className="mt-5 flex gap-2">
            <button
              type="button"
              onClick={handleAddToList}
              disabled={busy || inList}
              className="btn-ghost h-10 flex-1 text-sm"
            >
              {busy ? <IconSpinner size={14} /> : <IconPlus size={14} />}
              {inList ? "Já está na lista" : "Adicionar à lista"}
            </button>
            <button
              type="button"
              onClick={handleDelete}
              disabled={busy}
              aria-label={`Excluir ${product.name}`}
              className="btn-ghost h-10 w-10 px-0 text-muted hover:text-danger"
            >
              <IconTrash size={16} />
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-surface px-3 py-2">
      <dt className="text-muted">{label}</dt>
      <dd className="mt-0.5 text-sm text-text">{value}</dd>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function CasaCard() {
  const { supabase, household, user } = useApp();
  const [copied, setCopied] = useState(false);

  if (!household) return null;

  async function copy() {
    if (!household) return;
    try {
      await navigator.clipboard.writeText(household.invite_code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <section className="mt-8">
      <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">
        {household.name}
      </h2>

      <div className="card p-4">
        <p className="text-sm">Código de convite</p>
        <p className="text-xs text-muted">
          Quem tiver este código entra na mesma lista.
        </p>

        <button
          type="button"
          onClick={copy}
          className="mt-3 w-full rounded-lg border border-border bg-surface-2 py-3
                     font-mono text-lg tracking-[0.3em]"
        >
          {household.invite_code}
        </button>
        <p className="mt-1.5 h-4 text-center text-xs text-muted">
          {copied ? "Copiado" : "Toque para copiar"}
        </p>

        <div className="mt-4 flex items-center justify-between border-t border-border pt-4">
          <span className="truncate text-xs text-muted">{user?.email}</span>
          <button
            type="button"
            onClick={async () => {
              await supabase.auth.signOut();
              window.location.href = "/login";
            }}
            className="shrink-0 text-xs text-muted underline underline-offset-2 hover:text-text"
          >
            Sair
          </button>
        </div>
      </div>
    </section>
  );
}
