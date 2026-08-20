import type { ProductWithStats, Suggestion } from "./types";

/**
 * Regras de dominio puras — sem banco, sem rede.
 *
 * Ficam separadas das Server Actions para poderem rodar tanto no servidor
 * quanto no cliente (a lista calcula as sugestoes localmente) e para serem
 * testaveis sem subir nada.
 */

const DAY_MS = 86_400_000;

/** Intervalo esperado entre compras: override manual, senao a media real. */
export function expectedInterval(product: ProductWithStats): number | null {
  if (product.recurrence_days && product.recurrence_days > 0) {
    return product.recurrence_days;
  }
  const avg = product.stats?.avg_interval_days;
  return avg && avg > 0 ? avg : null;
}

export function daysSinceLastPurchase(product: ProductWithStats): number | null {
  const last = product.stats?.last_purchased_at;
  if (!last) return null;

  return Math.floor((Date.now() - new Date(last).getTime()) / DAY_MS);
}

/**
 * Produtos marcados como recorrentes cuja hora de recomprar chegou (ou passou),
 * ignorando os que ja estao na lista.
 *
 * "due-soon" comeca a 80% do intervalo: da tempo de incluir na proxima ida ao
 * mercado em vez de avisar so quando ja acabou.
 */
export function buildSuggestions(
  products: ProductWithStats[],
  pendingProductIds: Set<string>,
): Suggestion[] {
  const suggestions: Suggestion[] = [];

  for (const product of products) {
    if (!product.is_recurring) continue;
    if (pendingProductIds.has(product.id)) continue;

    const intervalDays = expectedInterval(product);
    const daysSince = daysSinceLastPurchase(product);
    if (intervalDays === null || daysSince === null) continue;

    if (daysSince >= intervalDays) {
      suggestions.push({ product, reason: "overdue", daysSince, intervalDays });
    } else if (daysSince >= intervalDays * 0.8) {
      suggestions.push({ product, reason: "due-soon", daysSince, intervalDays });
    }
  }

  // Mais atrasado primeiro.
  return suggestions.sort(
    (a, b) => b.daysSince / b.intervalDays - a.daysSince / a.intervalDays,
  );
}

/** Sugestao de periodicidade ao marcar um produto como recorrente. */
export function suggestedRecurrenceDays(product: ProductWithStats): number {
  const avg = product.stats?.avg_interval_days;
  if (avg && avg > 0) return Math.max(1, Math.round(avg));
  return 30;
}

/** O que fazer com cada linha da nota, decidido na tela de conferencia. */
export type ItemResolution =
  | { action: "link"; productId: string }
  | { action: "create"; name: string }
  | { action: "skip" };
