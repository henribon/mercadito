"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { useApp } from "@/components/AppProvider";
import { IconChevronRight, IconSpinner } from "@/components/Icons";
import { listPurchases } from "@/lib/actions";
import { date, money } from "@/lib/format";
import type { PurchaseSummary } from "@/lib/types";

export default function HistoricoPage() {
  const { household } = useApp();

  const [purchases, setPurchases] = useState<PurchaseSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!household) return;

    let cancelled = false;

    listPurchases()
      .then((rows) => {
        if (!cancelled) setPurchases(rows);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setError(cause instanceof Error ? cause.message : "Falha ao carregar.");
      });

    return () => {
      cancelled = true;
    };
  }, [household]);

  /** Total gasto no mês corrente: o número que interessa no dia a dia. */
  const monthTotal = useMemo(() => {
    if (!purchases) return null;

    const now = new Date();
    return purchases
      .filter((purchase) => {
        const when = new Date(purchase.purchased_at);
        return (
          when.getFullYear() === now.getFullYear() && when.getMonth() === now.getMonth()
        );
      })
      .reduce(
        (sum, purchase) => sum + (purchase.paid_amount ?? purchase.total_amount ?? 0),
        0,
      );
  }, [purchases]);

  if (!household) {
    return <p className="py-10 text-sm text-muted">Crie ou entre numa casa primeiro.</p>;
  }

  return (
    <div>
      <header className="mb-4">
        <h1 className="text-xl font-semibold tracking-tight">Histórico</h1>
        {monthTotal !== null && (
          <p className="text-sm text-muted">{money(monthTotal)} neste mês</p>
        )}
      </header>

      {error && <p className="text-sm text-danger">{error}</p>}

      {purchases === null ? (
        <div className="flex justify-center py-16 text-muted">
          <IconSpinner size={22} />
        </div>
      ) : purchases.length === 0 ? (
        <div className="card px-5 py-10 text-center">
          <p className="text-sm text-muted">
            Nenhuma compra ainda. Escaneie o QR Code de um cupom para começar.
          </p>
        </div>
      ) : (
        <ul className="card divide-y divide-border overflow-hidden">
          {purchases.map((purchase) => (
            <li key={purchase.id}>
              <Link
                href={`/historico/${purchase.id}`}
                className="flex items-center gap-3 px-4 py-3 hover:bg-surface-2"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">{purchase.store_name ?? "Compra"}</p>
                  <p className="text-xs text-muted">
                    {date(purchase.purchased_at)} · {purchase.item_count} itens
                  </p>
                </div>
                <span className="shrink-0 text-sm font-medium">
                  {money(purchase.paid_amount ?? purchase.total_amount)}
                </span>
                <IconChevronRight size={16} className="shrink-0 text-muted" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
