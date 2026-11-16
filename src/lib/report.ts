// Com a extensao explicita porque tests/report.test.ts roda este arquivo direto
// no Node, que resolve modulos sem a ajuda do bundler.
import {
  comparePrices,
  rankStoresByPrice,
  type PriceComparison,
  type StorePriceScore,
} from "./data.ts";
import type { StorePrice } from "./types.ts";

/**
 * O relatorio mensal de gastos — a regra, sem banco e sem e-mail.
 *
 * Entram as compras e os itens crus de um ano (sql.ts: REPORT_PURCHASES e
 * REPORT_ITEMS) e sai tudo que o e-mail mostra. Fazer a conta aqui, e nao em
 * SQL, tem um motivo: metade das perguntas depende do *dia local* da compra
 * (em que parte do mes, em que dia da semana), e o servidor roda em UTC. O
 * fuso entra como parametro e os testes cobrem a virada do dia.
 */

/** Quantos meses de historico alimentam preco, comparacao e melhor epoca. */
export const HISTORY_MONTHS = 12;

/** Quantos meses aparecem na evolucao do gasto (contando o do relatorio). */
export const TREND_MONTHS = 6;

/** Compras de um produto antes de arriscar dizer qual e a melhor epoca. */
export const MIN_TIMING_PURCHASES = 4;

/** Compras em cada parte do mes (inicio, meio, fim) para ela entrar na comparacao. */
export const MIN_BUCKET_PURCHASES = 2;

/** Dia da semana sao sete recortes em vez de tres: precisa de mais compras em cada um. */
export const MIN_WEEKDAY_PURCHASES = 3;

/** Diferenca de preco abaixo disto e ruido, nao informacao. */
const MIN_DIFFERENCE = 0.02;

/**
 * Para a melhor epoca a regua e mais alta: sao poucas compras por recorte, e
 * 2 ou 3% de diferenca entre dois sabados e duas quartas e so o acaso.
 */
const MIN_TIMING_DIFFERENCE = 0.05;

const TOP_SPEND = 10;
const TOP_PRICIEST = 8;
const TOP_CHANGES = 5;
const TOP_CHEAPER = 8;
const TOP_TIMING = 8;

/* ---------------------------------------------------------------------------
 * Datas no fuso de quem compra
 * ------------------------------------------------------------------------- */

const formatters = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

function wallClock(instantMs: number, timeZone: string) {
  const parts = partsFormatter(timeZone).formatToParts(new Date(instantMs));
  const get = (type: string) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);

  return {
    year: get("year"),
    month: get("month") - 1,
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

export function isValidTimeZone(timeZone: unknown): timeZone is string {
  if (typeof timeZone !== "string" || !timeZone) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

export type ZonedDate = {
  year: number;
  /** 0 = janeiro. */
  month: number;
  day: number;
  /** 0 = domingo. */
  weekday: number;
};

/** O dia do calendario em que um instante cai, visto de um fuso. */
export function zonedDate(instant: Date | string, timeZone: string): ZonedDate {
  const clock = wallClock(new Date(instant).getTime(), timeZone);
  return {
    year: clock.year,
    month: clock.month,
    day: clock.day,
    weekday: new Date(Date.UTC(clock.year, clock.month, clock.day)).getUTCDay(),
  };
}

/** Quanto o relogio do fuso esta adiantado em relacao ao UTC naquele instante. */
function offsetMs(instantMs: number, timeZone: string): number {
  const clock = wallClock(instantMs, timeZone);
  const asUtc = Date.UTC(
    clock.year,
    clock.month,
    clock.day,
    clock.hour,
    clock.minute,
    clock.second,
  );
  return asUtc - Math.floor(instantMs / 1000) * 1000;
}

/**
 * O instante em que um dia comeca num fuso. `monthIndex` pode estourar para os
 * dois lados (-1 = dezembro do ano anterior), como no construtor de Date.
 */
export function zonedMidnight(
  year: number,
  monthIndex: number,
  day: number,
  timeZone: string,
): Date {
  const wall = Date.UTC(year, monthIndex, day);

  // Duas passadas: a primeira estima com o deslocamento do instante errado, a
  // segunda corrige quando a meia-noite cai do outro lado de um horario de verao.
  let instant = wall - offsetMs(wall, timeZone);
  instant = wall - offsetMs(instant, timeZone);

  return new Date(instant);
}

/** As janelas de tempo de um relatorio, ja como instantes. */
export type ReportPeriod = {
  year: number;
  /** 0 = janeiro. */
  month: number;
  timeZone: string;
  /** Primeiro instante do mes do relatorio. */
  from: string;
  /** Primeiro instante do mes seguinte — o fim e exclusivo. */
  to: string;
  /** Primeiro instante do mes anterior, para a comparacao. */
  previousFrom: string;
  /** De onde parte o historico de precos. */
  historyFrom: string;
};

export function reportPeriod(year: number, month: number, timeZone: string): ReportPeriod {
  const base = new Date(Date.UTC(year, month, 1));
  const y = base.getUTCFullYear();
  const m = base.getUTCMonth();

  const at = (offsetMonths: number) =>
    zonedMidnight(y, m + offsetMonths, 1, timeZone).toISOString();

  return {
    year: y,
    month: m,
    timeZone,
    from: at(0),
    to: at(1),
    previousFrom: at(-1),
    historyFrom: at(-HISTORY_MONTHS),
  };
}

/** O mes que acabou de fechar, visto do fuso — e o que o envio automatico usa. */
export function previousMonthPeriod(now: Date, timeZone: string): ReportPeriod {
  const today = zonedDate(now, timeZone);
  return reportPeriod(today.year, today.month - 1, timeZone);
}

/* ---------------------------------------------------------------------------
 * Entrada: as linhas cruas do banco
 * ------------------------------------------------------------------------- */

export type ReportPurchase = {
  id: string;
  /** CNPJ quando a nota traz; senao o nome em maiusculas. */
  store_key: string;
  store_name: string;
  purchased_at: string;
  /** Valor pago; cai para o total da nota quando nao houve valor pago. */
  total: number;
  discount: number;
};

export type ReportItem = {
  purchase_id: string;
  /** Null quando a linha da nota nao foi ligada a um produto do catalogo. */
  product_id: string | null;
  /** Nome do produto, ou a descricao da nota quando nao ha produto. */
  name: string;
  unit: string;
  quantity: number;
  unit_price: number | null;
  total_price: number | null;
  purchased_at: string;
  store_key: string;
  store_name: string;
};

/* ---------------------------------------------------------------------------
 * Saida
 * ------------------------------------------------------------------------- */

export type StoreShare = {
  storeKey: string;
  storeName: string;
  purchaseCount: number;
  total: number;
  /** Fatia do gasto do mes: 0.4 = 40%. */
  share: number;
};

export type ProductSpend = {
  name: string;
  unit: string;
  quantity: number;
  total: number;
  /** Idas ao mercado em que o produto apareceu. */
  purchaseCount: number;
  /** Fatia da soma dos itens do mes. */
  share: number;
};

export type PriceyItem = {
  name: string;
  unit: string;
  unitPrice: number;
  storeName: string;
  purchasedAt: string;
};

export type PriceChange = {
  name: string;
  unit: string;
  /** Media do historico antes do mes. */
  before: number;
  /** Media do mes. */
  now: number;
  /** 0.1 = ficou 10% mais caro; negativo = mais barato. */
  change: number;
};

/** Um recorte do calendario e como o preco se comporta nele. */
export type PriceBucket = {
  label: string;
  /**
   * Preco em relacao a media do produto no mesmo mercado: 1 = o de sempre,
   * 0.9 = 10% abaixo. Veja `bestTimes` para o porque de nao ser o preco cru.
   */
  index: number;
  /** Compras que entraram na media. */
  count: number;
};

/** Quando (e onde) um produto de compra frequente costuma sair mais barato. */
export type BestTime = {
  name: string;
  unit: string;
  /** Compras com preco no historico — a base da conclusao. */
  purchaseCount: number;
  bestPeriod: PriceBucket | null;
  worstPeriod: PriceBucket | null;
  /** Quanto o pior periodo cobra a mais que o melhor. */
  periodDifference: number | null;
  bestWeekday: PriceBucket | null;
  worstWeekday: PriceBucket | null;
  weekdayDifference: number | null;
  cheapestStore: { name: string; price: number } | null;
};

export type MonthTotal = {
  year: number;
  month: number;
  total: number;
};

export type MonthlyReport = {
  period: ReportPeriod;

  total: number;
  purchaseCount: number;
  /** Linhas de nota no mes. */
  itemCount: number;
  /** Produtos diferentes no mes. */
  productCount: number;
  averageTicket: number;
  discount: number;
  /** Null quando o mes anterior nao teve compra nenhuma. */
  previousTotal: number | null;
  /** Variacao sobre o mes anterior; null sem base de comparacao. */
  change: number | null;
  biggestPurchase: { storeName: string; purchasedAt: string; total: number } | null;

  /** Do mais antigo para o mes do relatorio. */
  trend: MonthTotal[];
  stores: StoreShare[];
  topSpend: ProductSpend[];
  priciest: PriceyItem[];
  increases: PriceChange[];
  drops: PriceChange[];

  /** Onde cada produto sai mais barato; os comprados no mes vem primeiro. */
  cheaper: PriceComparison[];
  storeRanking: StorePriceScore[];
  /**
   * Quanto a conta do mes cairia se cada item tivesse sido comprado no mercado
   * onde ele costuma sair mais barato.
   */
  potentialSavings: number;

  bestTimes: BestTime[];
};

/* ---------------------------------------------------------------------------
 * A conta
 * ------------------------------------------------------------------------- */

/** Dias 1 a 10, 11 a 20 e do 21 em diante. */
const PERIODS = ["início do mês", "meio do mês", "fim do mês"];

const WEEKDAYS = [
  "domingo",
  "segunda-feira",
  "terça-feira",
  "quarta-feira",
  "quinta-feira",
  "sexta-feira",
  "sábado",
];

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function mean(values: number[]): number {
  return values.length === 0 ? 0 : sum(values) / values.length;
}

function lineTotal(item: ReportItem): number {
  if (item.total_price !== null) return item.total_price;
  return item.unit_price !== null ? item.quantity * item.unit_price : 0;
}

/** Linhas sem produto no catalogo se agrupam pela propria descricao. */
function productKey(item: ReportItem): string {
  return item.product_id ?? `nota:${item.name.trim().toUpperCase()}`;
}

function hasPrice(item: ReportItem): item is ReportItem & { unit_price: number } {
  return item.unit_price !== null && item.unit_price > 0;
}

function groupBy<T>(rows: T[], key: (row: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const id = key(row);
    const group = groups.get(id);
    if (group) group.push(row);
    else groups.set(id, [row]);
  }
  return groups;
}

/**
 * Preco medio de cada produto em cada mercado — o mesmo formato que o
 * PRICE_BY_STORE devolve, para reaproveitar a comparacao de data.ts.
 */
function storePrices(items: ReportItem[]): StorePrice[] {
  const priced = items.filter(
    (item): item is ReportItem & { unit_price: number; product_id: string } =>
      hasPrice(item) && item.product_id !== null,
  );

  const rows: StorePrice[] = [];

  for (const group of groupBy(priced, (item) => `${item.product_id}|${item.store_key}`).values()) {
    const first = group[0];
    rows.push({
      product_id: first.product_id,
      product_name: first.name,
      store_key: first.store_key,
      store_name: first.store_name,
      // Quatro casas, como no SQL: sem isso dois mercados com o mesmo preco
      // deixariam de empatar por um residuo de ponto flutuante.
      avg_unit_price: Math.round(mean(group.map((item) => item.unit_price)) * 10_000) / 10_000,
      purchase_count: new Set(group.map((item) => item.purchase_id)).size,
    });
  }

  return rows;
}

/** O melhor e o pior recorte, ou nada quando nao ha o que comparar. */
function extremes(buckets: PriceBucket[]): {
  best: PriceBucket | null;
  worst: PriceBucket | null;
  difference: number | null;
} {
  const nothing = { best: null, worst: null, difference: null };
  if (buckets.length < 2) return nothing;

  const sorted = [...buckets].sort((a, b) => a.index - b.index);
  const best = sorted[0];
  const worst = sorted[sorted.length - 1];
  const difference = worst.index / best.index - 1;

  return difference >= MIN_TIMING_DIFFERENCE ? { best, worst, difference } : nothing;
}

/** Recorte com uma compra so nao entra: um preco isolado nao e padrao. */
function bucketize(
  observations: { index: number; bucket: number }[],
  labels: string[],
  minPurchases: number,
): PriceBucket[] {
  const buckets: PriceBucket[] = [];

  for (const [bucket, group] of groupBy(observations, (row) => String(row.bucket))) {
    if (group.length < minPurchases) continue;

    buckets.push({
      label: labels[Number(bucket)],
      index: mean(group.map((row) => row.index)),
      count: group.length,
    });
  }

  return buckets;
}

/**
 * Para os produtos comprados com frequencia: em que parte do mes e em que dia
 * da semana o preco costuma ser menor.
 *
 * Cada ida ao mercado conta uma vez — duas linhas do mesmo produto na mesma
 * nota viram uma observacao so, senao uma compra grande pesaria como varias.
 *
 * O que se compara nao e o preco cru, e sim o preco em relacao a media do
 * produto *naquele mercado*. Sem isso, quem faz a compra grande do comeco do
 * mes no atacado e passa no mercado caro no fim concluiria que "o comeco do
 * mes e mais barato" — quando a diferenca e de mercado, nao de data. E essa
 * pergunta ja tem resposta em outra secao.
 */
function bestTimes(
  history: ReportItem[],
  prices: StorePrice[],
  timeZone: string,
): BestTime[] {
  const priced = history.filter(
    (item): item is ReportItem & { unit_price: number; product_id: string } =>
      hasPrice(item) && item.product_id !== null,
  );

  const results: BestTime[] = [];

  for (const [productId, lines] of groupBy(priced, (item) => item.product_id)) {
    const raw = [...groupBy(lines, (item) => item.purchase_id).values()].map((group) => {
      const day = zonedDate(group[0].purchased_at, timeZone);
      return {
        price: mean(group.map((item) => item.unit_price)),
        storeKey: group[0].store_key,
        period: day.day <= 10 ? 0 : day.day <= 20 ? 1 : 2,
        weekday: day.weekday,
      };
    });

    if (raw.length < MIN_TIMING_PURCHASES) continue;

    const storeAverage = new Map(
      [...groupBy(raw, (visit) => visit.storeKey)].map(([key, group]) => [
        key,
        mean(group.map((visit) => visit.price)),
      ]),
    );

    // 1 = o preco de sempre naquele mercado; 0.9 = 10% abaixo dele.
    const visits = raw.map((visit) => ({
      ...visit,
      index: visit.price / storeAverage.get(visit.storeKey)!,
    }));

    const period = extremes(
      bucketize(
        visits.map((visit) => ({ index: visit.index, bucket: visit.period })),
        PERIODS,
        MIN_BUCKET_PURCHASES,
      ),
    );
    const weekday = extremes(
      bucketize(
        visits.map((visit) => ({ index: visit.index, bucket: visit.weekday })),
        WEEKDAYS,
        MIN_WEEKDAY_PURCHASES,
      ),
    );

    // Sem diferenca nenhuma para apontar, o produto nao tem "melhor epoca".
    if (!period.best && !weekday.best) continue;

    const stores = prices
      .filter((row) => row.product_id === productId)
      .sort((a, b) => a.avg_unit_price - b.avg_unit_price);

    results.push({
      name: lines[lines.length - 1].name,
      unit: lines[lines.length - 1].unit,
      purchaseCount: visits.length,
      bestPeriod: period.best,
      worstPeriod: period.worst,
      periodDifference: period.difference,
      bestWeekday: weekday.best,
      worstWeekday: weekday.worst,
      weekdayDifference: weekday.difference,
      cheapestStore:
        stores.length > 1 && stores[0].avg_unit_price < stores[stores.length - 1].avg_unit_price
          ? { name: stores[0].store_name, price: round2(stores[0].avg_unit_price) }
          : null,
    });
  }

  // Quem tem mais compras tem a conclusao mais confiavel — e e o que mais pesa.
  return results
    .sort(
      (a, b) =>
        b.purchaseCount - a.purchaseCount ||
        (b.periodDifference ?? 0) - (a.periodDifference ?? 0),
    )
    .slice(0, TOP_TIMING);
}

/**
 * Monta o relatorio de um mes.
 *
 * `purchases` e `items` devem cobrir de `period.historyFrom` ate `period.to`;
 * o que cair fora disso e ignorado, entao passar linhas a mais nao distorce nada.
 */
export function buildMonthlyReport(
  period: ReportPeriod,
  purchases: ReportPurchase[],
  items: ReportItem[],
): MonthlyReport {
  const from = Date.parse(period.from);
  const to = Date.parse(period.to);
  const previousFrom = Date.parse(period.previousFrom);
  const historyFrom = Date.parse(period.historyFrom);

  const within = (iso: string, start: number, end: number) => {
    const instant = Date.parse(iso);
    return instant >= start && instant < end;
  };

  const monthPurchases = purchases.filter((row) => within(row.purchased_at, from, to));
  const previousPurchases = purchases.filter((row) =>
    within(row.purchased_at, previousFrom, from),
  );
  const history = items.filter((row) => within(row.purchased_at, historyFrom, to));
  const monthItems = history.filter((row) => within(row.purchased_at, from, to));
  const earlierItems = history.filter((row) => within(row.purchased_at, historyFrom, from));

  /* --- visao geral ------------------------------------------------------- */

  const total = round2(sum(monthPurchases.map((row) => row.total)));
  const previousTotal =
    previousPurchases.length > 0
      ? round2(sum(previousPurchases.map((row) => row.total)))
      : null;

  const biggest = monthPurchases.reduce<ReportPurchase | null>(
    (top, row) => (top === null || row.total > top.total ? row : top),
    null,
  );

  const trend: MonthTotal[] = [];
  for (let back = TREND_MONTHS - 1; back >= 0; back -= 1) {
    const start = zonedMidnight(period.year, period.month - back, 1, period.timeZone);
    const end = zonedMidnight(period.year, period.month - back + 1, 1, period.timeZone);
    const label = new Date(Date.UTC(period.year, period.month - back, 1));

    trend.push({
      year: label.getUTCFullYear(),
      month: label.getUTCMonth(),
      total: round2(
        sum(
          purchases
            .filter((row) => within(row.purchased_at, start.getTime(), end.getTime()))
            .map((row) => row.total),
        ),
      ),
    });
  }

  /* --- mercados ---------------------------------------------------------- */

  const stores: StoreShare[] = [...groupBy(monthPurchases, (row) => row.store_key).values()]
    .map((group) => {
      const storeTotal = round2(sum(group.map((row) => row.total)));
      return {
        storeKey: group[0].store_key,
        storeName: group[0].store_name,
        purchaseCount: group.length,
        total: storeTotal,
        share: total > 0 ? storeTotal / total : 0,
      };
    })
    .sort((a, b) => b.total - a.total || b.purchaseCount - a.purchaseCount);

  /* --- produtos ---------------------------------------------------------- */

  const itemsTotal = sum(monthItems.map(lineTotal));
  const monthByProduct = groupBy(monthItems, productKey);

  const topSpend: ProductSpend[] = [...monthByProduct.values()]
    .map((group) => {
      const spent = round2(sum(group.map(lineTotal)));
      return {
        name: group[0].name,
        unit: group[0].unit,
        quantity: sum(group.map((item) => item.quantity)),
        total: spent,
        purchaseCount: new Set(group.map((item) => item.purchase_id)).size,
        share: itemsTotal > 0 ? spent / itemsTotal : 0,
      };
    })
    .filter((row) => row.total > 0)
    .sort((a, b) => b.total - a.total)
    .slice(0, TOP_SPEND);

  // O mesmo produto comprado tres vezes nao ocupa tres lugares: fica a linha
  // em que ele saiu mais caro.
  const priciest: PriceyItem[] = [...monthByProduct.values()]
    .map((group) => group.filter(hasPrice))
    .filter((group) => group.length > 0)
    .map((group) => group.reduce((top, item) => (item.unit_price > top.unit_price ? item : top)))
    .sort((a, b) => b.unit_price - a.unit_price)
    .slice(0, TOP_PRICIEST)
    .map((item) => ({
      name: item.name,
      unit: item.unit,
      unitPrice: item.unit_price,
      storeName: item.store_name,
      purchasedAt: item.purchased_at,
    }));

  /* --- o que mudou de preco ---------------------------------------------- */

  const earlierByProduct = groupBy(
    earlierItems.filter((item) => hasPrice(item) && item.product_id !== null),
    productKey,
  );

  const changes: PriceChange[] = [];

  for (const [key, group] of monthByProduct) {
    const priced = group.filter(hasPrice);
    const earlier = (earlierByProduct.get(key) ?? []).filter(hasPrice);
    if (priced.length === 0 || earlier.length === 0) continue;

    const before = mean(earlier.map((item) => item.unit_price));
    const now = mean(priced.map((item) => item.unit_price));
    const change = now / before - 1;

    if (Math.abs(change) < MIN_DIFFERENCE) continue;

    changes.push({
      name: group[0].name,
      unit: group[0].unit,
      before: round2(before),
      now: round2(now),
      change,
    });
  }

  const increases = changes
    .filter((row) => row.change > 0)
    .sort((a, b) => b.change - a.change)
    .slice(0, TOP_CHANGES);

  const drops = changes
    .filter((row) => row.change < 0)
    .sort((a, b) => a.change - b.change)
    .slice(0, TOP_CHANGES);

  /* --- onde sai mais barato ---------------------------------------------- */

  const prices = storePrices(history);
  const comparisons = comparePrices(prices);
  const byProductId = new Map(comparisons.map((row) => [row.productId, row]));

  const boughtThisMonth = new Set(
    monthItems.map((item) => item.product_id).filter((id): id is string => id !== null),
  );

  // comparePrices ja ordena pela diferenca; aqui so puxamos para cima o que
  // entrou no carrinho neste mes, que e o que a pessoa reconhece.
  const cheaper = [
    ...comparisons.filter((row) => boughtThisMonth.has(row.productId)),
    ...comparisons.filter((row) => !boughtThisMonth.has(row.productId)),
  ].slice(0, TOP_CHEAPER);

  let potentialSavings = 0;
  for (const item of monthItems) {
    if (!hasPrice(item) || item.product_id === null) continue;

    const comparison = byProductId.get(item.product_id);
    if (!comparison || comparison.cheapestKey === item.store_key) continue;

    const extra = item.unit_price - comparison.cheapestPrice;
    if (extra > 0) potentialSavings += extra * item.quantity;
  }

  return {
    period,
    total,
    purchaseCount: monthPurchases.length,
    itemCount: monthItems.length,
    productCount: monthByProduct.size,
    averageTicket: monthPurchases.length > 0 ? round2(total / monthPurchases.length) : 0,
    discount: round2(sum(monthPurchases.map((row) => row.discount))),
    previousTotal,
    change: previousTotal !== null && previousTotal > 0 ? total / previousTotal - 1 : null,
    biggestPurchase: biggest
      ? {
          storeName: biggest.store_name,
          purchasedAt: biggest.purchased_at,
          total: biggest.total,
        }
      : null,
    trend,
    stores,
    topSpend,
    priciest,
    increases,
    drops,
    cheaper,
    storeRanking: rankStoresByPrice(prices),
    potentialSavings: round2(potentialSavings),
    bestTimes: bestTimes(history, prices, period.timeZone),
  };
}
