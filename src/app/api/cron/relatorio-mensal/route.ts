import { createHash, timingSafeEqual } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { reportPeriod } from "@/lib/report";
import { reportTimeZone, sendMonthlyReports } from "@/lib/report-run";

/**
 * O gatilho do relatorio mensal.
 *
 * Quem chama e o agendador da Vercel (vercel.json), nos primeiros dias de cada
 * mes. Ele manda `Authorization: Bearer <CRON_SECRET>` sozinho quando essa
 * variavel existe no projeto — e sem ela a rota recusa tudo, porque uma URL
 * publica que dispara e-mails nao pode ficar aberta.
 *
 * `?mes=2026-10` reenvia um mes especifico (para quem ainda nao recebeu).
 */

// Le o banco e manda e-mail: nada aqui pode ser gerado no build nem cacheado.
export const dynamic = "force-dynamic";

// SMTP do Gmail leva alguns segundos por mensagem.
export const maxDuration = 60;

function sameSecret(given: string, expected: string): boolean {
  // Comparar os hashes deixa os dois lados do mesmo tamanho, que e o que o
  // timingSafeEqual exige, sem revelar o comprimento do segredo.
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(given), digest(expected));
}

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;

  if (!secret) {
    return NextResponse.json(
      { error: "CRON_SECRET não configurado: o envio automático está desligado." },
      { status: 503 },
    );
  }

  const given = request.headers.get("authorization") ?? "";
  if (!sameSecret(given, `Bearer ${secret}`)) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  const requested = request.nextUrl.searchParams.get("mes");
  const match = requested?.match(/^(\d{4})-(0[1-9]|1[0-2])$/);

  if (requested && !match) {
    return NextResponse.json(
      { error: "Use ?mes=AAAA-MM, por exemplo ?mes=2026-10." },
      { status: 400 },
    );
  }

  try {
    const result = await sendMonthlyReports(
      match
        ? { period: reportPeriod(Number(match[1]), Number(match[2]) - 1, reportTimeZone()) }
        : {},
    );
    return NextResponse.json(result);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Falha ao enviar.";
    console.error(`[Mercadito] Relatório mensal: ${message}`);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
