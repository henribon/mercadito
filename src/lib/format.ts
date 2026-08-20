const BRL = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

const DATE = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "short",
  year: "numeric",
});

const DATE_TIME = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export function money(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return BRL.format(value);
}

export function date(value: string | null | undefined): string {
  if (!value) return "—";
  return DATE.format(new Date(value));
}

export function dateTime(value: string | null | undefined): string {
  if (!value) return "—";
  return DATE_TIME.format(new Date(value));
}

/** "hoje", "ontem", "há 12 dias", "há 3 meses" */
export function relativeDays(value: string | null | undefined): string {
  if (!value) return "nunca";

  const days = Math.floor((Date.now() - new Date(value).getTime()) / 86_400_000);

  if (days <= 0) return "hoje";
  if (days === 1) return "ontem";
  if (days < 30) return `há ${days} dias`;

  const months = Math.floor(days / 30);
  if (months === 1) return "há 1 mês";
  if (months < 12) return `há ${months} meses`;

  const years = Math.floor(months / 12);
  return years === 1 ? "há 1 ano" : `há ${years} anos`;
}

/** "a cada 7 dias", "a cada 2 semanas", "a cada mês" */
export function everyDays(days: number | null | undefined): string {
  if (!days || days <= 0) return "sem periodicidade";
  if (days === 1) return "todo dia";
  if (days === 7) return "toda semana";
  if (days % 30 === 0 && days >= 30) {
    const months = days / 30;
    return months === 1 ? "todo mês" : `a cada ${months} meses`;
  }
  if (days % 7 === 0 && days >= 14) return `a cada ${days / 7} semanas`;
  return `a cada ${days} dias`;
}

/** Quantidade sem casas decimais inuteis: 1, 1,235, 2 */
export function quantity(value: number, unit?: string | null): string {
  const formatted = Number.isInteger(value)
    ? String(value)
    : value.toFixed(3).replace(/0+$/, "").replace(/\.$/, "").replace(".", ",");

  const suffix = unit && unit !== "UN" ? ` ${unit.toLowerCase()}` : "";
  return `${formatted}${suffix}`;
}
