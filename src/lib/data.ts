import type { ProductWithStats, StorePrice, Suggestion } from "./types";

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

/* ---------------------------------------------------------------------------
 * Resumo de gastos
 * ------------------------------------------------------------------------- */

/** Quantos meses de historico alimentam preco e reincidencia. */
export const HABITS_MONTHS = 12;

/**
 * As datas que o resumo precisa, recortadas no fuso de quem esta olhando.
 *
 * O calculo e feito no cliente de proposito: o servidor roda em UTC, e um mes
 * fechado em UTC jogaria a compra das 22h do dia 31 para o mes seguinte.
 */
export type SpendWindow = {
  /** Primeiro instante do mes escolhido. */
  from: string;
  /** Primeiro instante do mes seguinte — o fim e exclusivo. */
  to: string;
  /** Primeiro instante do mes anterior, para a comparacao. */
  previousFrom: string;
  /** De onde partem os numeros de habito (preco e reincidencia). */
  habitsFrom: string;
};

export function monthWindow(reference: Date, habitsMonths = HABITS_MONTHS): SpendWindow {
  const year = reference.getFullYear();
  const month = reference.getMonth();

  // `new Date(ano, mes, 1)` e meia-noite local; o toISOString converte para o
  // instante UTC equivalente, que e o que o Postgres compara.
  const at = (offsetMonths: number) =>
    new Date(year, month + offsetMonths, 1).toISOString();

  return {
    from: at(0),
    to: at(1),
    previousFrom: at(-1),
    habitsFrom: at(-habitsMonths),
  };
}

/** Um produto que custa precos diferentes dependendo do mercado. */
export type PriceComparison = {
  productId: string;
  productName: string;
  cheapestKey: string;
  cheapestStore: string;
  cheapestPrice: number;
  priciestStore: string;
  priciestPrice: number;
  /** Quanto o mais caro cobra a mais: 0.25 = 25%. */
  difference: number;
};

/** Como cada mercado se sai na comparacao de precos. */
export type StorePriceScore = {
  storeKey: string;
  storeName: string;
  /** Produtos em que este mercado tem o menor preco medio. */
  wins: number;
  /** Produtos comparaveis em que ele aparece. */
  compared: number;
};

/**
 * Agrupa por produto e descarta quem so aparece num mercado.
 *
 * O SQL ja agrupa por (produto, mercado), entao dois registros do mesmo produto
 * sao necessariamente de mercados diferentes.
 */
function comparableGroups(rows: StorePrice[]): StorePrice[][] {
  const byProduct = new Map<string, StorePrice[]>();

  for (const row of rows) {
    if (!(row.avg_unit_price > 0)) continue;

    const group = byProduct.get(row.product_id);
    if (group) group.push(row);
    else byProduct.set(row.product_id, [row]);
  }

  return [...byProduct.values()].filter((group) => group.length > 1);
}

/**
 * Onde cada produto sai mais barato, do maior desperdicio para o menor.
 *
 * Compara a media historica de cada mercado, nao o ultimo preco: uma promocao
 * isolada nao deveria eleger o mercado mais caro como o mais barato.
 */
export function comparePrices(rows: StorePrice[]): PriceComparison[] {
  const comparisons: PriceComparison[] = [];

  for (const group of comparableGroups(rows)) {
    const sorted = [...group].sort((a, b) => a.avg_unit_price - b.avg_unit_price);
    const cheapest = sorted[0];
    const priciest = sorted[sorted.length - 1];

    // Mesmo preco nos dois: nao ha o que escolher.
    if (cheapest.avg_unit_price === priciest.avg_unit_price) continue;

    comparisons.push({
      productId: cheapest.product_id,
      productName: cheapest.product_name,
      cheapestKey: cheapest.store_key,
      cheapestStore: cheapest.store_name,
      cheapestPrice: cheapest.avg_unit_price,
      priciestStore: priciest.store_name,
      priciestPrice: priciest.avg_unit_price,
      difference: priciest.avg_unit_price / cheapest.avg_unit_price - 1,
    });
  }

  return comparisons.sort((a, b) => b.difference - a.difference);
}

/**
 * Placar dos mercados: em quantos produtos cada um ganha no preco.
 *
 * Ganhar em 7 de 10 produtos diz mais do que a soma da nota, que depende do
 * tamanho da compra e nao do preco da prateleira.
 */
export function rankStoresByPrice(rows: StorePrice[]): StorePriceScore[] {
  const scores = new Map<string, StorePriceScore>();

  for (const group of comparableGroups(rows)) {
    const best = group.reduce((a, b) => (b.avg_unit_price < a.avg_unit_price ? b : a));

    for (const row of group) {
      const score = scores.get(row.store_key) ?? {
        storeKey: row.store_key,
        storeName: row.store_name,
        wins: 0,
        compared: 0,
      };

      score.compared += 1;
      // Empate conta para os dois: nenhum dos dois esta cobrando mais caro.
      if (row.avg_unit_price === best.avg_unit_price) score.wins += 1;

      scores.set(row.store_key, score);
    }
  }

  return [...scores.values()].sort(
    (a, b) => b.wins - a.wins || b.compared - a.compared,
  );
}
