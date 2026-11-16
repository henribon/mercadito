// Com a extensao explicita porque tests/report.test.ts roda este arquivo direto
// no Node, que resolve modulos sem a ajuda do bundler.
import { money, percent, quantity } from "./format.ts";
import type { BestTime, MonthlyReport, PriceBucket } from "./report.ts";

/**
 * O relatorio mensal em forma de e-mail.
 *
 * So apresentacao: recebe o relatorio pronto (report.ts) e devolve assunto,
 * texto puro e HTML. O HTML e o de e-mail mesmo — tabelas e estilo inline,
 * porque Gmail e Outlook ignoram folha de estilo e flexbox.
 */

export type ReportEmail = { subject: string; text: string; html: string };

export type ReportEmailOptions = {
  householdName: string;
  /** Primeiro nome de quem recebe; sem ele a saudacao fica generica. */
  recipientName?: string | null;
  /** URL base do app, para o link do rodape. */
  appUrl: string;
};

const MONTHS = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
];

const COLOR = {
  text: "#191918",
  muted: "#6f6f6b",
  border: "#e6e6e2",
  surface: "#f4f4f2",
  accent: "#1f7a4d",
  accentSoft: "#e8f3ec",
  warn: "#9a6414",
  warnSoft: "#fbf1e0",
};

/** Nome de produto e de mercado vem da nota fiscal: nunca direto no HTML. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** "por kg", "por un" — o preco unitario so faz sentido com a unidade. */
function perUnit(unit: string): string {
  return `por ${unit.trim().toLowerCase() || "un"}`;
}

function shortDate(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    timeZone,
  }).format(new Date(iso));
}

/** `difference` e quanto o caro cobra a mais; na frase vai o desconto. */
function savings(difference: number): number {
  return difference / (1 + difference);
}

/* ---------------------------------------------------------------------------
 * As frases de abertura: o relatorio em cinco linhas
 * ------------------------------------------------------------------------- */

export function highlights(report: MonthlyReport): string[] {
  const lines: string[] = [];
  const previousMonth = MONTHS[(report.period.month + 11) % 12];

  if (report.change !== null && report.previousTotal !== null) {
    lines.push(
      Math.abs(report.change) < 0.01
        ? `O gasto ficou praticamente igual ao de ${previousMonth} (${money(report.previousTotal)}).`
        : `Você gastou ${percent(report.change)} a ${
            report.change > 0 ? "mais" : "menos"
          } que em ${previousMonth} (${money(report.previousTotal)}).`,
    );
  }

  const store = report.stores[0];
  if (store && report.stores.length > 1) {
    lines.push(
      `${store.storeName} levou a maior parte: ${money(store.total)}, ${percent(store.share)} do mês.`,
    );
  }

  const product = report.topSpend[0];
  if (product) {
    lines.push(
      `O que mais pesou foi ${product.name}: ${money(product.total)} em ${plural(
        product.purchaseCount,
        "compra",
        "compras",
      )}.`,
    );
  }

  const increase = report.increases[0];
  if (increase) {
    lines.push(
      `${increase.name} ficou ${percent(increase.change)} mais caro que a sua média (de ${money(
        increase.before,
      )} para ${money(increase.now)}).`,
    );
  }

  if (report.potentialSavings >= 1) {
    lines.push(
      `Comprando cada item no mercado onde ele costuma sair mais barato, a conta do mês cairia cerca de ${money(
        report.potentialSavings,
      )}.`,
    );
  }

  return lines;
}

/** "cerca de 12% abaixo do fim do mês (3 compras contra 2)" */
function versus(
  best: PriceBucket,
  worst: PriceBucket,
  difference: number,
  preposition: "do" | "de",
): string {
  return `cerca de ${percent(savings(difference))} abaixo ${preposition} ${worst.label} (${plural(
    best.count,
    "compra",
    "compras",
  )} contra ${worst.count})`;
}

/**
 * Só percentuais, sem preço: a comparação é feita dentro de cada mercado
 * (report.ts), e um preço médio em reais misturaria os mercados de volta.
 */
export function bestTimeSentence(row: BestTime): string {
  const parts: string[] = [];

  if (row.bestPeriod && row.worstPeriod && row.periodDifference !== null) {
    parts.push(
      `Mais em conta no ${row.bestPeriod.label}: ${versus(
        row.bestPeriod,
        row.worstPeriod,
        row.periodDifference,
        "do",
      )}.`,
    );
  }

  if (row.bestWeekday && row.worstWeekday && row.weekdayDifference !== null) {
    parts.push(
      `Melhor dia da semana: ${row.bestWeekday.label}, ${versus(
        row.bestWeekday,
        row.worstWeekday,
        row.weekdayDifference,
        "de",
      )}.`,
    );
  }

  if (row.cheapestStore) {
    parts.push(
      `Menor preço médio no ${row.cheapestStore.name} (${money(row.cheapestStore.price)}).`,
    );
  }

  return parts.join(" ");
}

/* ---------------------------------------------------------------------------
 * Pecas do HTML
 * ------------------------------------------------------------------------- */

function section(title: string, note: string, body: string): string {
  return `
    <tr><td style="padding:28px 24px 0">
      <h2 style="margin:0;font-size:15px;font-weight:600;color:${COLOR.text}">${escapeHtml(title)}</h2>
      <p style="margin:2px 0 12px;font-size:12px;color:${COLOR.muted}">${escapeHtml(note)}</p>
      ${body}
    </td></tr>`;
}

function table(rows: string[]): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"
    style="border:1px solid ${COLOR.border};border-radius:10px;border-collapse:separate">${rows.join("")}</table>`;
}

/** Linha com titulo, detalhe embaixo e valor a direita. */
function row(title: string, detail: string, value: string, first: boolean): string {
  const border = first ? "" : `border-top:1px solid ${COLOR.border};`;
  return `
    <tr>
      <td style="${border}padding:10px 12px;font-size:14px;color:${COLOR.text}">
        ${escapeHtml(title)}
        ${detail ? `<div style="font-size:12px;color:${COLOR.muted};margin-top:2px">${escapeHtml(detail)}</div>` : ""}
      </td>
      <td align="right" valign="top"
          style="${border}padding:10px 12px;font-size:14px;font-weight:600;color:${COLOR.text};white-space:nowrap">
        ${value}
      </td>
    </tr>`;
}

/** Barra horizontal: uma tabela de duas celulas, a unica coisa que todo cliente de e-mail desenha igual. */
function bar(ratio: number): string {
  const filled = Math.max(3, Math.min(100, Math.round(ratio * 100)));
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:6px">
      <tr>
        <td width="${filled}%" style="height:6px;background:${COLOR.accent};border-radius:3px;font-size:0;line-height:0">&nbsp;</td>
        <td width="${100 - filled}%" style="height:6px;font-size:0;line-height:0">&nbsp;</td>
      </tr>
    </table>`;
}

function chip(text: string, tone: "good" | "warn"): string {
  const background = tone === "good" ? COLOR.accentSoft : COLOR.warnSoft;
  const color = tone === "good" ? COLOR.accent : COLOR.warn;
  return `<span style="display:inline-block;background:${background};color:${color};border-radius:999px;padding:2px 8px;font-size:12px;font-weight:600">${escapeHtml(text)}</span>`;
}

function empty(text: string): string {
  return `<p style="margin:0;padding:14px 12px;border:1px solid ${COLOR.border};border-radius:10px;font-size:13px;color:${COLOR.muted}">${escapeHtml(text)}</p>`;
}

/* ---------------------------------------------------------------------------
 * O e-mail
 * ------------------------------------------------------------------------- */

export function renderMonthlyReport(
  report: MonthlyReport,
  options: ReportEmailOptions,
): ReportEmail {
  const { period } = report;
  const month = MONTHS[period.month];
  const monthYear = `${month} de ${period.year}`;
  const previousMonth = MONTHS[(period.month + 11) % 12];
  const resumoUrl = `${options.appUrl.replace(/\/+$/, "")}/resumo`;
  const summary = highlights(report);

  const subject = `Mercadito — seus gastos de ${monthYear}: ${money(report.total)}`;

  /* --- HTML -------------------------------------------------------------- */

  const overview = [
    plural(report.purchaseCount, "compra", "compras"),
    `ticket médio de ${money(report.averageTicket)}`,
    plural(report.productCount, "produto diferente", "produtos diferentes"),
    report.discount > 0 ? `${money(report.discount)} em descontos` : "",
  ]
    .filter(Boolean)
    .join(" · ");

  const changeChip =
    report.change === null || report.previousTotal === null
      ? ""
      : `<p style="margin:10px 0 0;font-size:13px;color:${COLOR.muted}">
           ${chip(
             `${report.change > 0 ? "▲" : "▼"} ${percent(report.change)}`,
             report.change > 0 ? "warn" : "good",
           )}
           &nbsp;que em ${previousMonth} (${money(report.previousTotal)})
         </p>`;

  const biggestTrend = Math.max(...report.trend.map((entry) => entry.total), 1);

  const sections: string[] = [];

  if (summary.length > 0) {
    sections.push(
      section(
        "Em resumo",
        "o mês em poucas linhas",
        `<ul style="margin:0;padding:0 0 0 18px;font-size:14px;line-height:1.55;color:${COLOR.text}">
           ${summary.map((line) => `<li style="margin:0 0 6px">${escapeHtml(line)}</li>`).join("")}
         </ul>`,
      ),
    );
  }

  sections.push(
    section(
      "Evolução",
      `últimos ${report.trend.length} meses`,
      table(
        report.trend.map((entry, index) => {
          const current = index === report.trend.length - 1;
          const border = index === 0 ? "" : `border-top:1px solid ${COLOR.border};`;
          return `
            <tr>
              <td width="56" style="${border}padding:9px 0 9px 12px;font-size:13px;color:${
                current ? COLOR.text : COLOR.muted
              };${current ? "font-weight:600" : ""}">${MONTHS[entry.month].slice(0, 3)}</td>
              <td style="${border}padding:9px 8px">${
                entry.total > 0 ? bar(entry.total / biggestTrend).replace("margin-top:6px", "margin:0") : ""
              }</td>
              <td align="right" width="96" style="${border}padding:9px 12px 9px 0;font-size:13px;white-space:nowrap;color:${
                COLOR.text
              };${current ? "font-weight:600" : ""}">${entry.total > 0 ? money(entry.total) : "—"}</td>
            </tr>`;
        }),
      ),
    ),
  );

  sections.push(
    section(
      "Onde você comprou",
      "quanto foi para cada mercado no mês",
      table(
        report.stores.map((store, index) => {
          const border = index === 0 ? "" : `border-top:1px solid ${COLOR.border};`;
          return `
            <tr><td style="${border}padding:10px 12px">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
                <td style="font-size:14px;color:${COLOR.text}">${escapeHtml(store.storeName)}</td>
                <td align="right" style="font-size:14px;font-weight:600;color:${COLOR.text};white-space:nowrap">${money(store.total)}</td>
              </tr></table>
              ${bar(store.share)}
              <div style="font-size:12px;color:${COLOR.muted};margin-top:4px">
                ${plural(store.purchaseCount, "compra", "compras")} · ${percent(store.share)} do mês
              </div>
            </td></tr>`;
        }),
      ),
    ),
  );

  sections.push(
    section(
      "No que você mais gastou",
      "os produtos que mais pesaram na conta do mês",
      report.topSpend.length === 0
        ? empty("As notas deste mês vieram sem itens detalhados.")
        : table(
            report.topSpend.map((product, index) =>
              row(
                product.name,
                `${quantity(product.quantity)} ${product.unit.toLowerCase()} · ${plural(
                  product.purchaseCount,
                  "compra",
                  "compras",
                )} · ${percent(product.share)} do mês`,
                money(product.total),
                index === 0,
              ),
            ),
          ),
    ),
  );

  if (report.priciest.length > 0) {
    sections.push(
      section(
        "Itens mais caros",
        "maior preço unitário pago no mês",
        table(
          report.priciest.map((item, index) =>
            row(
              item.name,
              `${item.storeName} · ${shortDate(item.purchasedAt, period.timeZone)}`,
              `${money(item.unitPrice)} <span style="font-weight:400;font-size:12px;color:${COLOR.muted}">${escapeHtml(
                perUnit(item.unit),
              )}</span>`,
              index === 0,
            ),
          ),
        ),
      ),
    );
  }

  if (report.increases.length > 0 || report.drops.length > 0) {
    const changeRows = [
      ...report.increases.map((item) => ({ item, tone: "warn" as const })),
      ...report.drops.map((item) => ({ item, tone: "good" as const })),
    ];

    sections.push(
      section(
        "O que mudou de preço",
        "preço médio do mês contra a sua média dos meses anteriores",
        table(
          changeRows.map(({ item, tone }, index) =>
            row(
              item.name,
              `de ${money(item.before)} para ${money(item.now)} ${perUnit(item.unit)}`,
              chip(`${tone === "warn" ? "▲" : "▼"} ${percent(item.change)}`, tone),
              index === 0,
            ),
          ),
        ),
      ),
    );
  }

  const winner = report.storeRanking[0];
  const rankingLine =
    winner && report.storeRanking.length > 1
      ? `<p style="margin:0 0 10px;font-size:14px;color:${COLOR.text}">
           <strong>${escapeHtml(winner.storeName)}</strong> tem o menor preço em ${winner.wins} de ${
             winner.compared
           } produtos comparados.
         </p>`
      : "";

  const savingsLine =
    report.potentialSavings >= 1
      ? `<p style="margin:10px 0 0;font-size:13px;color:${COLOR.muted}">
           Se cada item deste mês tivesse sido comprado no mercado onde ele costuma sair mais barato,
           a conta seria cerca de <strong style="color:${COLOR.accent}">${money(report.potentialSavings)}</strong> menor.
         </p>`
      : "";

  sections.push(
    section(
      "Onde sai mais barato",
      "preço médio de cada produto em cada mercado, últimos 12 meses",
      report.cheaper.length === 0
        ? empty(
            "Ainda não dá para comparar. Quando o mesmo produto aparecer em notas de dois mercados diferentes, a diferença de preço aparece aqui.",
          )
        : rankingLine +
            table(
              report.cheaper.map((item, index) =>
                row(
                  item.productName,
                  `${money(item.cheapestPrice)} no ${item.cheapestStore} · ${money(
                    item.priciestPrice,
                  )} no ${item.priciestStore}`,
                  chip(`${percent(savings(item.difference))} mais barato`, "good"),
                  index === 0,
                ),
              ),
            ) +
            savingsLine,
    ),
  );

  sections.push(
    section(
      "Melhor época para comprar",
      "para o que você compra com frequência — início = dias 1 a 10, meio = 11 a 20, fim = 21 em diante",
      report.bestTimes.length === 0
        ? empty(
            "Ainda falta histórico. Quando um produto tiver compras repetidas em épocas diferentes do mês, com preços diferentes no mesmo mercado, o padrão aparece aqui.",
          )
        : table(
            report.bestTimes.map((item, index) => {
              const border = index === 0 ? "" : `border-top:1px solid ${COLOR.border};`;
              return `
                <tr><td style="${border}padding:10px 12px">
                  <div style="font-size:14px;color:${COLOR.text}">
                    ${escapeHtml(item.name)}
                    <span style="font-size:12px;color:${COLOR.muted}">· ${plural(item.purchaseCount, "compra", "compras")}</span>
                  </div>
                  <div style="font-size:13px;line-height:1.5;color:${COLOR.muted};margin-top:3px">${escapeHtml(
                    bestTimeSentence(item),
                  )}</div>
                </td></tr>`;
            }),
          ) +
            `<p style="margin:10px 0 0;font-size:12px;color:${COLOR.muted}">
               A comparação é sempre do mesmo produto no mesmo mercado, para a diferença ser de data e não de loja.
               É um retrato do seu histórico, não uma previsão: quanto mais notas escaneadas, mais firme a conclusão.
             </p>`,
    ),
  );

  const greeting = options.recipientName
    ? `Oi, ${escapeHtml(options.recipientName)}. `
    : "";

  const html = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#fbfbfa">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fbfbfa">
<tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"
  style="max-width:560px;background:#ffffff;border:1px solid ${COLOR.border};border-radius:14px;
         font-family:system-ui,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">

  <tr><td style="padding:24px 24px 0">
    <p style="margin:0;font-size:13px;font-weight:600;color:${COLOR.accent}">Mercadito · ${escapeHtml(options.householdName)}</p>
    <h1 style="margin:6px 0 0;font-size:20px;font-weight:600;color:${COLOR.text}">Seus gastos de ${monthYear}</h1>
    <p style="margin:6px 0 0;font-size:13px;color:${COLOR.muted}">${greeting}Aqui está o fechamento do mercado no mês.</p>
  </td></tr>

  <tr><td style="padding:18px 24px 0">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
      style="background:${COLOR.surface};border-radius:12px"><tr><td style="padding:18px">
      <p style="margin:0;font-size:12px;color:${COLOR.muted}">Total gasto</p>
      <p style="margin:4px 0 0;font-size:30px;font-weight:700;letter-spacing:-0.5px;color:${COLOR.text}">${money(report.total)}</p>
      ${changeChip}
      <p style="margin:10px 0 0;font-size:13px;color:${COLOR.muted}">${escapeHtml(overview)}</p>
    </td></tr></table>
  </td></tr>

  ${sections.join("")}

  <tr><td style="padding:28px 24px 24px">
    <a href="${escapeHtml(resumoUrl)}"
       style="display:inline-block;background:${COLOR.accent};color:#ffffff;text-decoration:none;
              padding:12px 20px;border-radius:8px;font-size:14px;font-weight:500">Abrir o resumo no app</a>
    <p style="margin:18px 0 0;font-size:12px;line-height:1.5;color:${COLOR.muted}">
      Você recebe este relatório no começo de cada mês, com o fechamento do mês anterior.
      Para parar de receber, abra a aba Resumo no app e desligue o relatório por e-mail.
    </p>
  </td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;

  /* --- texto puro -------------------------------------------------------- */

  const text: string[] = [
    `Mercadito — ${options.householdName}`,
    `Seus gastos de ${monthYear}`,
    "",
    `Total gasto: ${money(report.total)}`,
    overview,
  ];

  if (summary.length > 0) {
    text.push("", "EM RESUMO", ...summary.map((line) => `- ${line}`));
  }

  text.push(
    "",
    "ONDE VOCÊ COMPROU",
    ...report.stores.map(
      (store) =>
        `- ${store.storeName}: ${money(store.total)} (${plural(
          store.purchaseCount,
          "compra",
          "compras",
        )}, ${percent(store.share)} do mês)`,
    ),
  );

  if (report.topSpend.length > 0) {
    text.push(
      "",
      "NO QUE VOCÊ MAIS GASTOU",
      ...report.topSpend.map(
        (product) =>
          `- ${product.name}: ${money(product.total)} (${quantity(product.quantity)} ${product.unit.toLowerCase()})`,
      ),
    );
  }

  if (report.priciest.length > 0) {
    text.push(
      "",
      "ITENS MAIS CAROS",
      ...report.priciest.map(
        (item) =>
          `- ${item.name}: ${money(item.unitPrice)} ${perUnit(item.unit)} (${item.storeName}, ${shortDate(
            item.purchasedAt,
            period.timeZone,
          )})`,
      ),
    );
  }

  if (report.increases.length > 0 || report.drops.length > 0) {
    text.push(
      "",
      "O QUE MUDOU DE PREÇO",
      ...[...report.increases, ...report.drops].map(
        (item) =>
          `- ${item.name}: de ${money(item.before)} para ${money(item.now)} (${
            item.change > 0 ? "+" : "-"
          }${percent(item.change)})`,
      ),
    );
  }

  if (report.cheaper.length > 0) {
    text.push(
      "",
      "ONDE SAI MAIS BARATO",
      ...report.cheaper.map(
        (item) =>
          `- ${item.productName}: ${money(item.cheapestPrice)} no ${item.cheapestStore}, ${money(
            item.priciestPrice,
          )} no ${item.priciestStore}`,
      ),
    );
  }

  if (report.bestTimes.length > 0) {
    text.push(
      "",
      "MELHOR ÉPOCA PARA COMPRAR",
      ...report.bestTimes.map((item) => `- ${item.name}: ${bestTimeSentence(item)}`),
    );
  }

  text.push("", `Abra o resumo no app: ${resumoUrl}`);

  return { subject, text: text.join("\n"), html };
}
