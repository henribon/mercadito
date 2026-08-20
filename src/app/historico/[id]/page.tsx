"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import { useApp } from "@/components/AppProvider";
import { IconChevronLeft, IconSpinner } from "@/components/Icons";
import { fetchPurchaseItems } from "@/lib/data";
import { dateTime, money, quantity } from "@/lib/format";
import type { Purchase, PurchaseItem } from "@/lib/types";

export default function CompraPage() {
  const params = useParams<{ id: string }>();
  const { supabase, household, products } = useApp();

  const [purchase, setPurchase] = useState<Purchase | null>(null);
  const [items, setItems] = useState<PurchaseItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!household || !params?.id) return;

    let cancelled = false;

    async function load() {
      try {
        const { data, error: queryError } = await supabase
          .from("purchases")
          .select("*")
          .eq("id", params.id)
          .single();

        if (queryError) throw queryError;
        if (cancelled) return;
        setPurchase(data as Purchase);

        const purchaseItems = await fetchPurchaseItems(supabase, params.id);
        if (cancelled) return;
        setItems(purchaseItems);
      } catch (cause) {
        if (cancelled) return;
        setError(cause instanceof Error ? cause.message : "Compra não encontrada.");
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [supabase, household, params?.id]);

  const productNames = new Map(products.map((product) => [product.id, product.name]));

  if (error) {
    return (
      <div>
        <BackLink />
        <p className="mt-4 text-sm text-danger">{error}</p>
      </div>
    );
  }

  if (!purchase || !items) {
    return (
      <div className="flex justify-center py-24 text-muted">
        <IconSpinner size={22} />
      </div>
    );
  }

  return (
    <div>
      <BackLink />

      <header className="mb-4 mt-3">
        <h1 className="text-xl font-semibold tracking-tight">
          {purchase.store_name ?? "Compra"}
        </h1>
        <p className="text-sm text-muted">{dateTime(purchase.purchased_at)}</p>
      </header>

      <div className="card divide-y divide-border">
        <Line label="Itens" value={String(items.length)} />
        {purchase.total_amount !== null && (
          <Line label="Total" value={money(purchase.total_amount)} />
        )}
        {purchase.discount !== null && purchase.discount > 0 && (
          <Line label="Desconto" value={`− ${money(purchase.discount)}`} />
        )}
        <Line
          label="Pago"
          value={money(purchase.paid_amount ?? purchase.total_amount)}
          strong
        />
      </div>

      <ul className="card mt-4 divide-y divide-border overflow-hidden">
        {items.map((item) => {
          const mapped = item.product_id ? productNames.get(item.product_id) : null;

          return (
            <li key={item.id} className="flex items-start gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">{mapped ?? item.raw_description}</p>
                <p className="truncate text-xs text-muted">
                  {quantity(item.quantity, item.unit)} × {money(item.unit_price)}
                  {mapped && mapped !== item.raw_description && (
                    <span className="text-muted"> · {item.raw_description}</span>
                  )}
                </p>
              </div>
              <span className="shrink-0 text-sm">{money(item.total_price)}</span>
            </li>
          );
        })}
      </ul>

      {purchase.store_cnpj && (
        <p className="mt-4 text-xs text-muted">CNPJ {purchase.store_cnpj}</p>
      )}
      {purchase.access_key && (
        <p className="mt-1 break-all font-mono text-[11px] text-muted">
          {purchase.access_key}
        </p>
      )}
    </div>
  );
}

function BackLink() {
  return (
    <Link
      href="/historico"
      className="inline-flex items-center gap-1 text-sm text-muted hover:text-text"
    >
      <IconChevronLeft size={16} />
      Histórico
    </Link>
  );
}

function Line({
  label,
  value,
  strong,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div className="flex items-center justify-between px-4 py-2.5">
      <span className="text-sm text-muted">{label}</span>
      <span className={`text-sm ${strong ? "font-semibold" : ""}`}>{value}</span>
    </div>
  );
}
