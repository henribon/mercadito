"use client";

import { useEffect, useMemo, useState } from "react";

import { useApp } from "@/components/AppProvider";
import {
  IconArrowDown,
  IconArrowUp,
  IconChevronLeft,
  IconChevronRight,
  IconRepeat,
  IconSpinner,
  IconStore,
} from "@/components/Icons";
import { getSpendInsights, type SpendInsights } from "@/lib/actions";
import { HABITS_MONTHS, monthWindow } from "@/lib/data";
import { money, monthLabel, monthName, percent, quantity } from "@/lib/format";
import type { RepeatProduct, StoreSpend } from "@/lib/types";

/** Quantas linhas cada lista longa mostra antes de precisar do "mostrar mais". */
const VISIBLE_ROWS = 6;

/**
 * Para onde o dinheiro da casa foi.
 *
 * A tela mistura duas janelas de tempo de proposito, e cada secao diz qual usa:
 * o gasto e do mes escolhido, enquanto preco e reincidencia olham doze meses —
 * um mes sozinho quase nunca tem o mesmo produto em dois mercados, e sem isso
 * nao da para dizer onde ele sai mais barato.
 */
export default function ResumoPage() {
  const { household } = useApp();

  // 0 = mes corrente, -1 = mes passado, e assim por diante.
  const [offset, setOffset] = useState(0);
  const [insights, setInsights] = useState<SpendInsights | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reference = useMemo(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth() + offset, 1);
  }, [offset]);

  const previousMonth = useMemo(
    () => new Date(reference.getFullYear(), reference.getMonth() - 1, 1),
    [reference],
  );

  useEffect(() => {
    if (!household) return;

    let cancelled = false;
    setInsights(null);

    getSpendInsights(monthWindow(reference))
      .then((result) => {
        if (cancelled) return;
        setInsights(result);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setError(cause instanceof Error ? cause.message : "Falha ao carregar.");
      });

    return () => {
      cancelled = true;
    };
  }, [household, reference]);

  if (!household) {
    return <p className="py-10 text-sm text-muted">Crie ou entre numa casa primeiro.</p>;
  }

  return (
    <div>
      <header className="mb-4">
        <h1 className="text-xl font-semibold tracking-tight">Resumo</h1>
        <p className="text-sm text-muted">Onde o dinheiro da casa está indo.</p>
      </header>

      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setOffset((value) => value - 1)}
          aria-label="Mês anterior"
          className="btn-quiet h-9 w-9 px-0"
        >
          <IconChevronLeft size={18} />
        </button>

        <span className="text-sm font-medium">{monthLabel(reference)}</span>

        <button
          type="button"
          onClick={() => setOffset((value) => value + 1)}
          disabled={offset >= 0}
          aria-label="Próximo mês"
          className="btn-quiet h-9 w-9 px-0"
        >
          <IconChevronRight size={18} />
        </button>
      </div>

      {error && <p className="mt-4 text-sm text-danger">{error}</p>}

      {insights === null ? (
        <div className="flex justify-center py-20 text-muted">
          <IconSpinner size={22} />
        </div>
      ) : (
        <div className="mt-3 space-y-6">
          <TotalCard insights={insights} previousMonth={previousMonth} />
          <StoresSection stores={insights.stores} />
          <PriceSection insights={insights} />
          <RepeatSection repeats={insights.repeats} />
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function TotalCard({
  insights,
  previousMonth,
}: {
  insights: SpendInsights;
  previousMonth: Date;
}) {
  const { total, purchaseCount, previousTotal, stores } = insights;

  // Sem base de comparacao — ou com base zero, que faria a variacao explodir.
  const change =
    previousTotal !== null && previousTotal > 0 ? total / previousTotal - 1 : null;

  return (
    <section className="card px-5 py-5">
      <p className="text-xs text-muted">Total gasto</p>
      <p className="mt-1 text-3xl font-semibold tracking-tight">{money(total)}</p>

      {change !== null && (
        <p className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs">
          <span
            className={`chip ${
              change > 0 ? "bg-warn-soft text-warn" : "bg-accent-soft text-accent"
            }`}
          >
            {change > 0 ? <IconArrowUp size={12} /> : <IconArrowDown size={12} />}
            {percent(change)}
          </span>
          <span className="text-muted">
            que em {monthName(previousMonth)} ({money(previousTotal)})
          </span>
        </p>
      )}

      <p className="mt-3 text-sm text-muted">
        {purchaseCount === 0
          ? "Nenhuma compra registrada neste mês."
          : `${purchaseCount} ${purchaseCount === 1 ? "compra" : "compras"} em ${
              stores.length
            } ${stores.length === 1 ? "mercado" : "mercados"}`}
      </p>
    </section>
  );
}

/* -------------------------------------------------------------------------- */

function StoresSection({ stores }: { stores: StoreSpend[] }) {
  if (stores.length === 0) return null;

  // Mais visitado e mais caro nem sempre sao o mesmo mercado: a lista vem
  // ordenada por valor, entao quem mais recebeu visitas precisa ser procurado.
  const mostVisited = stores.reduce((a, b) =>
    b.purchase_count > a.purchase_count ? b : a,
  );
  const biggest = stores[0].total || 1;

  return (
    <section>
      <SectionTitle icon={<IconStore size={15} />} title="Mercados" note="neste mês" />

      <ul className="card divide-y divide-border overflow-hidden">
        {stores.map((store) => (
          <li key={store.store_key} className="px-4 py-3">
            <div className="flex items-baseline gap-2">
              <p className="min-w-0 flex-1 truncate text-sm">{store.store_name}</p>
              <span className="shrink-0 text-sm font-medium">{money(store.total)}</span>
            </div>

            <div className="mt-1.5 flex items-center gap-2">
              <div className="h-1 flex-1 overflow-hidden rounded-full bg-surface-2">
                <div
                  className="h-full rounded-full bg-accent"
                  style={{ width: `${Math.max(4, (store.total / biggest) * 100)}%` }}
                />
              </div>
              <span className="shrink-0 text-xs text-muted">
                {store.purchase_count}{" "}
                {store.purchase_count === 1 ? "compra" : "compras"}
              </span>
            </div>
          </li>
        ))}
      </ul>

      {stores.length > 1 && (
        <p className="mt-2 px-1 text-xs text-muted">
          Você foi mais vezes ao{" "}
          <strong className="font-medium text-text">{mostVisited.store_name}</strong>:{" "}
          {mostVisited.purchase_count}{" "}
          {mostVisited.purchase_count === 1 ? "compra" : "compras"} no mês.
        </p>
      )}
    </section>
  );
}

/* -------------------------------------------------------------------------- */

function PriceSection({ insights }: { insights: SpendInsights }) {
  const [expanded, setExpanded] = useState(false);

  const { cheaper, storeRanking } = insights;
  const winner = storeRanking[0];
  const shown = expanded ? cheaper : cheaper.slice(0, VISIBLE_ROWS);

  return (
    <section>
      <SectionTitle
        icon={<IconArrowDown size={15} />}
        title="Onde sai mais barato"
        note={`últimos ${HABITS_MONTHS} meses`}
      />

      {cheaper.length === 0 ? (
        <EmptyCard>
          Ainda não dá para comparar. Quando o mesmo produto aparecer em notas de dois
          mercados diferentes, a diferença de preço aparece aqui.
        </EmptyCard>
      ) : (
        <>
          {winner && storeRanking.length > 1 && (
            <p className="card mb-2 px-4 py-3 text-sm">
              <strong className="font-medium">{winner.storeName}</strong> tem o menor
              preço em {winner.wins} de {winner.compared} produtos comparados.
            </p>
          )}

          <ul className="card divide-y divide-border overflow-hidden">
            {shown.map((row) => (
              <li key={row.productId} className="px-4 py-3">
                <div className="flex items-baseline gap-2">
                  <p className="min-w-0 flex-1 truncate text-sm">{row.productName}</p>
                  <span className="chip shrink-0 bg-accent-soft text-accent">
                    {percent(savings(row.difference))} mais barato
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-muted">
                  {money(row.cheapestPrice)} no {row.cheapestStore} ·{" "}
                  {money(row.priciestPrice)} no {row.priciestStore}
                </p>
              </li>
            ))}
          </ul>

          {cheaper.length > VISIBLE_ROWS && (
            <MoreButton
              expanded={expanded}
              hidden={cheaper.length - VISIBLE_ROWS}
              onClick={() => setExpanded((value) => !value)}
            />
          )}
        </>
      )}
    </section>
  );
}

/**
 * `difference` diz quanto o caro cobra a mais sobre o barato; na tela o que
 * interessa e o desconto sobre o caro — 100% a mais vira 50% mais barato.
 */
function savings(difference: number): number {
  return difference / (1 + difference);
}

/* -------------------------------------------------------------------------- */

function RepeatSection({ repeats }: { repeats: RepeatProduct[] }) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? repeats : repeats.slice(0, VISIBLE_ROWS);

  return (
    <section>
      <SectionTitle
        icon={<IconRepeat size={15} />}
        title="O que mais se repete"
        note={`últimos ${HABITS_MONTHS} meses`}
      />

      {repeats.length === 0 ? (
        <EmptyCard>
          Nenhum produto foi comprado duas vezes ainda. Escaneie mais notas e o padrão
          aparece sozinho.
        </EmptyCard>
      ) : (
        <>
          <ul className="card divide-y divide-border overflow-hidden">
            {shown.map((product) => (
              <li
                key={product.product_id}
                className="flex items-center gap-3 px-4 py-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">{product.product_name}</p>
                  <p className="truncate text-xs text-muted">
                    {product.purchase_count} compras ·{" "}
                    {quantity(product.total_quantity)} {product.unit.toLowerCase()} no
                    total
                  </p>
                </div>
                <span className="shrink-0 text-sm font-medium">
                  {money(product.total_spent)}
                </span>
              </li>
            ))}
          </ul>

          {repeats.length > VISIBLE_ROWS && (
            <MoreButton
              expanded={expanded}
              hidden={repeats.length - VISIBLE_ROWS}
              onClick={() => setExpanded((value) => !value)}
            />
          )}
        </>
      )}
    </section>
  );
}

/* -------------------------------------------------------------------------- */

function SectionTitle({
  icon,
  title,
  note,
}: {
  icon: React.ReactNode;
  title: string;
  note: string;
}) {
  return (
    <div className="mb-2 flex items-center gap-2 px-1">
      <span className="text-muted">{icon}</span>
      <h2 className="text-sm font-medium">{title}</h2>
      <span className="text-xs text-muted">· {note}</span>
    </div>
  );
}

function EmptyCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="card px-5 py-6 text-center">
      <p className="text-sm text-muted">{children}</p>
    </div>
  );
}

function MoreButton({
  expanded,
  hidden,
  onClick,
}: {
  expanded: boolean;
  hidden: number;
  onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick} className="btn-quiet mt-1 w-full text-xs">
      {expanded ? "Mostrar menos" : `Mostrar mais ${hidden}`}
    </button>
  );
}
