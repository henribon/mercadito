import { resolveBaseUrl } from "./base-url";
import { isSchemaOutdated, query, queryOne, SCHEMA_OUTDATED_MESSAGE } from "./db";
import { isEmailConfigured, sendReportEmail } from "./email";
import {
  buildMonthlyReport,
  isValidTimeZone,
  previousMonthPeriod,
  type MonthlyReport,
  type ReportItem,
  type ReportPeriod,
  type ReportPurchase,
} from "./report";
import { renderMonthlyReport } from "./report-email";
import {
  CLAIM_REPORT_DELIVERY,
  RELEASE_REPORT_DELIVERY,
  REPORT_ITEMS,
  REPORT_PURCHASES,
  REPORT_RECIPIENTS,
} from "./sql";

/**
 * Busca os dados, monta o relatorio e envia — a parte do relatorio mensal que
 * fala com o banco e com o SMTP. A conta esta em report.ts e o e-mail em
 * report-email.ts; aqui e so a orquestracao.
 */

const DEFAULT_TIME_ZONE = "America/Sao_Paulo";

/**
 * Fuso usado pelo envio automatico. Quem dispara e o agendador, nao um
 * celular, entao nao ha aparelho para dizer onde o mes comeca — vem daqui.
 */
export function reportTimeZone(): string {
  const configured = process.env.REPORT_TIMEZONE;
  return isValidTimeZone(configured) ? configured : DEFAULT_TIME_ZONE;
}

export async function loadMonthlyReport(
  householdId: string,
  period: ReportPeriod,
): Promise<MonthlyReport> {
  const [purchases, items] = await Promise.all([
    query<ReportPurchase>(REPORT_PURCHASES, [householdId, period.historyFrom, period.to]),
    query<ReportItem>(REPORT_ITEMS, [householdId, period.historyFrom, period.to]),
  ]);

  return buildMonthlyReport(period, purchases, items);
}

export type Recipient = {
  householdName: string;
  email: string;
  name: string | null;
};

function firstName(name: string | null): string | null {
  return name?.trim().split(/\s+/)[0] || null;
}

/** Envia um relatorio ja montado. `false` = sem SMTP configurado. */
export async function deliverReport(
  report: MonthlyReport,
  recipient: Recipient,
): Promise<boolean> {
  const message = renderMonthlyReport(report, {
    householdName: recipient.householdName,
    recipientName: firstName(recipient.name),
    appUrl: resolveBaseUrl(process.env).url,
  });

  return sendReportEmail(recipient.email, message);
}

/* -------------------------------------------------------------------------- */

type RecipientRow = {
  household_id: string;
  household_name: string;
  user_id: string;
  email: string;
  name: string | null;
};

export type MonthlyRunResult = {
  /** yyyy-mm do relatorio. */
  month: string;
  sent: number;
  /** Ja tinha recebido este mes. */
  alreadySent: number;
  /** Casa sem compra nenhuma no mes: nao ha o que relatar. */
  emptyHouseholds: number;
  failed: number;
};

/** O primeiro dia do mes como o Postgres espera num `date`. */
function monthKey(period: ReportPeriod): string {
  return `${period.year}-${String(period.month + 1).padStart(2, "0")}-01`;
}

/**
 * O envio automatico: o relatorio do mes que acabou de fechar, para todo mundo
 * que nao desligou o recebimento.
 *
 * Pode rodar quantas vezes for no mesmo mes — report_deliveries garante um
 * e-mail por pessoa. E por isso que o agendador dispara em mais de um dia: se
 * o SMTP falhar no dia 1, o dia 2 completa o que faltou sem repetir o resto.
 */
export async function sendMonthlyReports(
  options: { now?: Date; period?: ReportPeriod } = {},
): Promise<MonthlyRunResult> {
  const period =
    options.period ?? previousMonthPeriod(options.now ?? new Date(), reportTimeZone());
  const month = monthKey(period);

  const result: MonthlyRunResult = {
    month: month.slice(0, 7),
    sent: 0,
    alreadySent: 0,
    emptyHouseholds: 0,
    failed: 0,
  };

  if (!isEmailConfigured()) {
    throw new Error("SMTP não configurado: o relatório mensal não tem como ser enviado.");
  }

  // A consulta le a coluna report_email: num banco que ainda nao recebeu o
  // schema novo, o erro cru do Postgres nao diria o que fazer.
  const recipients = await query<RecipientRow>(REPORT_RECIPIENTS).catch((cause: unknown) => {
    throw isSchemaOutdated(cause) ? new Error(SCHEMA_OUTDATED_MESSAGE) : cause;
  });

  // Um relatorio por casa, montado na primeira vez que ela aparece.
  const reports = new Map<string, MonthlyReport>();

  for (const recipient of recipients) {
    let report = reports.get(recipient.household_id);
    if (!report) {
      report = await loadMonthlyReport(recipient.household_id, period);
      reports.set(recipient.household_id, report);
      if (report.purchaseCount === 0) result.emptyHouseholds += 1;
    }

    if (report.purchaseCount === 0) continue;

    const claim = [recipient.household_id, recipient.user_id, month];

    if (!(await queryOne(CLAIM_REPORT_DELIVERY, claim))) {
      result.alreadySent += 1;
      continue;
    }

    try {
      await deliverReport(report, {
        householdName: recipient.household_name,
        email: recipient.email,
        name: recipient.name,
      });
      result.sent += 1;
    } catch (cause) {
      // Devolve a reserva: a proxima rodada tenta de novo so para esta pessoa.
      await query(RELEASE_REPORT_DELIVERY, claim).catch(() => undefined);
      result.failed += 1;
      console.error(
        `[Mercadito] Falha ao enviar o relatório de ${result.month}:`,
        cause instanceof Error ? cause.message : cause,
      );
    }
  }

  return result;
}
