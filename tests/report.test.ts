import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  buildMonthlyReport,
  isValidTimeZone,
  MIN_BUCKET_PURCHASES,
  MIN_TIMING_PURCHASES,
  MIN_WEEKDAY_PURCHASES,
  previousMonthPeriod,
  reportPeriod,
  TREND_MONTHS,
  zonedDate,
  zonedMidnight,
  type ReportItem,
  type ReportPurchase,
} from "../src/lib/report.ts";
import {
  bestTimeSentence,
  escapeHtml,
  highlights,
  renderMonthlyReport,
} from "../src/lib/report-email.ts";

/**
 * O relatorio mensal: as datas no fuso de quem compra, a conta e o e-mail.
 * Tudo sem banco — as consultas que alimentam isto estao em tests/sql.test.ts.
 */

const SP = "America/Sao_Paulo";

describe("datas no fuso", () => {
  test("o mes comeca a meia-noite de Sao Paulo, nao a do servidor", () => {
    const period = reportPeriod(2026, 9, SP);

    assert.equal(period.from, "2026-10-01T03:00:00.000Z");
    assert.equal(period.to, "2026-11-01T03:00:00.000Z");
    assert.equal(period.previousFrom, "2026-09-01T03:00:00.000Z");
    assert.equal(period.historyFrom, "2025-10-01T03:00:00.000Z");
  });

  test("janeiro compara com dezembro do ano anterior", () => {
    const period = reportPeriod(2026, 0, SP);

    assert.equal(period.previousFrom, "2025-12-01T03:00:00.000Z");
    assert.equal(period.to, "2026-02-01T03:00:00.000Z");
  });

  test("mes fora da faixa e normalizado, como no construtor de Date", () => {
    const period = reportPeriod(2026, -1, SP);

    assert.equal(period.year, 2025);
    assert.equal(period.month, 11);
  });

  test("o envio do dia 1 fecha o mes que acabou de terminar", () => {
    // 08h do dia 1 de novembro em Sao Paulo: e o horario do agendador.
    const period = previousMonthPeriod(new Date("2026-11-01T11:00:00Z"), SP);

    assert.equal(period.year, 2026);
    assert.equal(period.month, 9);
  });

  test("perto da meia-noite UTC o mes ainda e o de Sao Paulo", () => {
    // 02h UTC do dia 1 = 23h do dia 31 em Sao Paulo: outubro nao fechou.
    const period = previousMonthPeriod(new Date("2026-11-01T02:00:00Z"), SP);

    assert.equal(period.month, 8, "ainda e outubro la; o mes fechado e setembro");
  });

  test("o envio de janeiro fecha dezembro do ano anterior", () => {
    const period = previousMonthPeriod(new Date("2027-01-01T11:00:00Z"), SP);

    assert.equal(period.year, 2026);
    assert.equal(period.month, 11);
  });

  test("meia-noite acompanha a virada do horario de verao", () => {
    // Nova York adianta o relogio as 2h de 8 de marco de 2026.
    const NY = "America/New_York";

    assert.equal(zonedMidnight(2026, 2, 8, NY).toISOString(), "2026-03-08T05:00:00.000Z");
    assert.equal(zonedMidnight(2026, 2, 9, NY).toISOString(), "2026-03-09T04:00:00.000Z");
  });

  test("o dia da compra e o do relogio local", () => {
    // 01h30 UTC do dia 11 ainda e sabado, dia 10, em Sao Paulo.
    const day = zonedDate("2026-10-11T01:30:00Z", SP);

    assert.deepEqual(day, { year: 2026, month: 9, day: 10, weekday: 6 });
  });

  test("reconhece fuso valido e recusa o resto", () => {
    assert.equal(isValidTimeZone(SP), true);
    assert.equal(isValidTimeZone("Marte/Olympus"), false);
    assert.equal(isValidTimeZone(""), false);
    assert.equal(isValidTimeZone(undefined), false);
  });
});

/* -------------------------------------------------------------------------- */

/** Meio-dia de um dia local de Sao Paulo (UTC-3), como instante. */
function local(year: number, month: number, day: number, hour = 12): string {
  return new Date(Date.UTC(year, month - 1, day, hour + 3)).toISOString();
}

const STORES = {
  barato: { store_key: "111", store_name: "Mercado Barato" },
  caro: { store_key: "222", store_name: "Mercado Caro" },
};

const PURCHASES: ReportPurchase[] = [
  { id: "p1", ...STORES.barato, purchased_at: local(2026, 10, 3), total: 100, discount: 5 },
  { id: "p2", ...STORES.caro, purchased_at: local(2026, 10, 15), total: 200, discount: 0 },
  { id: "p3", ...STORES.barato, purchased_at: local(2026, 10, 25), total: 50, discount: 0 },
  // 23h do dia 31 em Sao Paulo: em UTC ja e novembro, mas a compra e de outubro.
  { id: "p4", ...STORES.caro, purchased_at: "2026-11-01T02:00:00.000Z", total: 10, discount: 0 },
  { id: "p0", ...STORES.barato, purchased_at: local(2026, 9, 9), total: 150, discount: 0 },
  { id: "pA", ...STORES.caro, purchased_at: local(2026, 8, 22), total: 80, discount: 0 },
  // Mais velha que o historico: nao pode entrar em conta nenhuma.
  { id: "pVelha", ...STORES.caro, purchased_at: local(2025, 9, 15), total: 999, discount: 0 },
];

const WHEN = new Map(PURCHASES.map((row) => [row.id, row]));

function item(
  purchaseId: string,
  product: { id: string | null; name: string; unit?: string },
  quantity: number,
  unitPrice: number | null,
): ReportItem {
  const purchase = WHEN.get(purchaseId)!;
  return {
    purchase_id: purchaseId,
    product_id: product.id,
    name: product.name,
    unit: product.unit ?? "UN",
    quantity,
    unit_price: unitPrice,
    total_price: unitPrice === null ? null : Math.round(quantity * unitPrice * 100) / 100,
    purchased_at: purchase.purchased_at,
    store_key: purchase.store_key,
    store_name: purchase.store_name,
  };
}

const LEITE = { id: "leite", name: "Leite integral" };
const PICANHA = { id: "picanha", name: "Picanha", unit: "KG" };
const CAFE = { id: "cafe", name: "Café" };
const SACOLA = { id: null, name: "SACOLA PLASTICA" };

const ITEMS: ReportItem[] = [
  item("pVelha", LEITE, 1, 1.0),
  item("pA", LEITE, 2, 6.0),
  item("p0", LEITE, 6, 4.0),
  item("p0", PICANHA, 1, 60),
  item("p0", CAFE, 1, 16),
  item("p1", LEITE, 6, 4.0),
  item("p1", CAFE, 1, 20),
  item("p2", LEITE, 2, 5.0),
  item("p2", PICANHA, 1.2, 80),
  item("p3", LEITE, 6, 4.5),
  item("p3", SACOLA, 2, 0.1),
];

const OUTUBRO = reportPeriod(2026, 9, SP);

describe("relatorio do mes", () => {
  const report = buildMonthlyReport(OUTUBRO, PURCHASES, ITEMS);

  test("soma o mes pelo relogio local, incluindo a compra das 23h do dia 31", () => {
    assert.equal(report.total, 360);
    assert.equal(report.purchaseCount, 4);
    assert.equal(report.averageTicket, 90);
    assert.equal(report.discount, 5);
  });

  test("conta linhas de nota e produtos diferentes", () => {
    assert.equal(report.itemCount, 6);
    assert.equal(report.productCount, 4);
  });

  test("compara com o mes anterior", () => {
    assert.equal(report.previousTotal, 150);
    assert.equal(report.change, 360 / 150 - 1);
  });

  test("aponta a maior compra do mes", () => {
    assert.equal(report.biggestPurchase?.storeName, "Mercado Caro");
    assert.equal(report.biggestPurchase?.total, 200);
  });

  test("a evolucao cobre os ultimos meses, do mais antigo para o atual", () => {
    assert.equal(report.trend.length, TREND_MONTHS);
    assert.deepEqual(
      report.trend.map((entry) => [entry.month, entry.total]),
      [
        [4, 0],
        [5, 0],
        [6, 0],
        [7, 80],
        [8, 150],
        [9, 360],
      ],
    );
  });

  test("divide o gasto por mercado, com a fatia de cada um", () => {
    assert.deepEqual(
      report.stores.map((store) => [store.storeName, store.total, store.purchaseCount]),
      [
        ["Mercado Caro", 210, 2],
        ["Mercado Barato", 150, 2],
      ],
    );
    assert.equal(report.stores[0].share, 210 / 360);
  });

  test("no que mais gastou: soma o produto ao longo das compras do mes", () => {
    assert.deepEqual(
      report.topSpend.map((row) => [row.name, row.total]),
      [
        ["Picanha", 96],
        ["Leite integral", 61],
        ["Café", 20],
        ["SACOLA PLASTICA", 0.2],
      ],
    );

    const leite = report.topSpend[1];
    assert.equal(leite.quantity, 14);
    assert.equal(leite.purchaseCount, 3);
    assert.ok(Math.abs(leite.share - 61 / 177.2) < 1e-9);
  });

  test("itens mais caros: um lugar por produto, no maior preco pago", () => {
    assert.deepEqual(
      report.priciest.map((row) => [row.name, row.unitPrice, row.storeName]),
      [
        ["Picanha", 80, "Mercado Caro"],
        ["Café", 20, "Mercado Barato"],
        ["Leite integral", 5, "Mercado Caro"],
        ["SACOLA PLASTICA", 0.1, "Mercado Barato"],
      ],
    );
    assert.equal(report.priciest[0].unit, "KG");
  });

  test("o que subiu e o que caiu contra a media dos meses anteriores", () => {
    assert.deepEqual(
      report.increases.map((row) => row.name),
      ["Picanha", "Café"],
    );
    assert.equal(report.increases[0].before, 60);
    assert.equal(report.increases[0].now, 80);

    // Leite: media anterior (4 + 6) / 2 = 5; no mes (4 + 5 + 4,5) / 3 = 4,5.
    assert.deepEqual(
      report.drops.map((row) => [row.name, row.before, row.now]),
      [["Leite integral", 5, 4.5]],
    );
    assert.ok(Math.abs(report.drops[0].change + 0.1) < 1e-9);
  });

  test("compra mais velha que o historico nao entra na media", () => {
    // Se o leite a R$ 1,00 de 2025 contasse, a media anterior seria menor que 5.
    assert.equal(report.drops[0].before, 5);
  });

  test("onde sai mais barato, e o placar dos mercados", () => {
    assert.deepEqual(
      report.cheaper.map((row) => [row.productName, row.cheapestStore]),
      [
        ["Picanha", "Mercado Barato"],
        ["Leite integral", "Mercado Barato"],
      ],
    );

    assert.equal(report.storeRanking[0].storeName, "Mercado Barato");
    assert.equal(report.storeRanking[0].wins, 2);
    assert.equal(report.storeRanking[0].compared, 2);
  });

  test("quanto dava para economizar comprando cada item no mercado mais barato", () => {
    // Picanha: 1,2 kg x (80 - 60) = 24. Leite no Caro: 2 x (5 - 4,1667) = 1,67.
    assert.equal(report.potentialSavings, 25.67);
  });

  test("melhor epoca: so para produto com compras suficientes", () => {
    assert.ok(MIN_TIMING_PURCHASES > 2);
    assert.deepEqual(
      report.bestTimes.map((row) => row.name),
      ["Leite integral"],
      "picanha e cafe tem so duas compras",
    );
  });

  test("melhor epoca: compara cada compra com a media do mesmo mercado", () => {
    const leite = report.bestTimes[0];

    assert.equal(leite.purchaseCount, 5);

    // Media do leite: Barato (4 + 4 + 4,5) / 3; Caro (5 + 6) / 2 = 5,5.
    const barato = 12.5 / 3;
    const inicio = 4 / barato; // as duas compras do inicio, ambas no Barato
    const fim = (4.5 / barato + 6 / 5.5) / 2;

    assert.equal(leite.bestPeriod?.label, "início do mês");
    assert.equal(leite.bestPeriod?.count, 2);
    assert.ok(Math.abs(leite.bestPeriod!.index - inicio) < 1e-9);

    assert.equal(leite.worstPeriod?.label, "fim do mês");
    assert.equal(leite.worstPeriod?.count, 2);
    assert.ok(Math.abs(leite.periodDifference! - (fim / inicio - 1)) < 1e-9);

    assert.deepEqual(leite.cheapestStore, { name: "Mercado Barato", price: 4.17 });
  });

  test("recorte com uma compra so nao entra na comparacao", () => {
    const leite = report.bestTimes[0];

    // O meio do mes teve uma compra so (dia 15), a mais barata em relacao ao
    // mercado dela — mas um preco isolado nao e padrao.
    assert.notEqual(leite.bestPeriod?.label, "meio do mês");
    assert.equal(MIN_BUCKET_PURCHASES, 2);

    // So o sabado teve duas compras: nao ha outro dia com que comparar.
    assert.equal(leite.bestWeekday, null);
    assert.equal(leite.weekdayDifference, null);
  });

  test("melhor dia da semana aparece quando ha compras repetidas em dois dias", () => {
    // Outubro de 2026: dias 3, 10 e 24 sao sabados; 7, 14 e 28, quartas.
    const sabados: ReportPurchase[] = [
      { id: "s1", ...STORES.barato, purchased_at: local(2026, 10, 3), total: 1, discount: 0 },
      { id: "s2", ...STORES.barato, purchased_at: local(2026, 10, 10), total: 1, discount: 0 },
      { id: "s3", ...STORES.barato, purchased_at: local(2026, 10, 24), total: 1, discount: 0 },
      { id: "q1", ...STORES.barato, purchased_at: local(2026, 10, 7), total: 1, discount: 0 },
      { id: "q2", ...STORES.barato, purchased_at: local(2026, 10, 14), total: 1, discount: 0 },
      { id: "q3", ...STORES.barato, purchased_at: local(2026, 10, 28), total: 1, discount: 0 },
    ];
    const linha = (id: string, price: number): ReportItem => ({
      purchase_id: id,
      product_id: LEITE.id,
      name: LEITE.name,
      unit: "UN",
      quantity: 1,
      unit_price: price,
      total_price: price,
      purchased_at: sabados.find((row) => row.id === id)!.purchased_at,
      ...STORES.barato,
    });

    const semanal = buildMonthlyReport(OUTUBRO, sabados, [
      linha("s1", 4),
      linha("s2", 4),
      linha("s3", 4),
      linha("q1", 5),
      linha("q2", 5),
      linha("q3", 5),
    ]);

    const leite = semanal.bestTimes[0];
    assert.equal(leite.bestWeekday?.label, "sábado");
    assert.equal(leite.bestWeekday?.count, MIN_WEEKDAY_PURCHASES);
    assert.equal(leite.worstWeekday?.label, "quarta-feira");
    assert.ok(Math.abs(leite.weekdayDifference! - 0.25) < 1e-9);

    // Com uma quarta a menos, o dia deixa de ter compras suficientes.
    const curto = buildMonthlyReport(OUTUBRO, sabados, [
      linha("s1", 4),
      linha("s2", 4),
      linha("s3", 4),
      linha("q1", 5),
      linha("q2", 5),
    ]);
    assert.equal(curto.bestTimes[0]?.bestWeekday ?? null, null);
  });

  test("diferenca de mercado nao se disfarca de diferenca de data", () => {
    // Sempre R$ 4 no Barato (comeco do mes) e sempre R$ 5 no Caro (fim do mes):
    // o preco cru diria que o comeco do mes e 20% mais barato.
    const compras: ReportPurchase[] = [
      { id: "a", ...STORES.barato, purchased_at: local(2026, 9, 3), total: 1, discount: 0 },
      { id: "b", ...STORES.barato, purchased_at: local(2026, 10, 5), total: 1, discount: 0 },
      { id: "c", ...STORES.caro, purchased_at: local(2026, 9, 25), total: 1, discount: 0 },
      { id: "d", ...STORES.caro, purchased_at: local(2026, 10, 27), total: 1, discount: 0 },
    ];
    const linha = (id: string, price: number): ReportItem => {
      const compra = compras.find((row) => row.id === id)!;
      return {
        purchase_id: id,
        product_id: LEITE.id,
        name: LEITE.name,
        unit: "UN",
        quantity: 1,
        unit_price: price,
        total_price: price,
        purchased_at: compra.purchased_at,
        store_key: compra.store_key,
        store_name: compra.store_name,
      };
    };

    const enviesado = buildMonthlyReport(OUTUBRO, compras, [
      linha("a", 4),
      linha("b", 4),
      linha("c", 5),
      linha("d", 5),
    ]);

    assert.deepEqual(enviesado.bestTimes, [], "a data nao mudou o preco em nenhum mercado");
    assert.equal(enviesado.cheaper[0].cheapestStore, "Mercado Barato", "essa e a secao certa");
  });

  test("duas linhas do mesmo produto na mesma nota contam como uma ida", () => {
    const dobrado = buildMonthlyReport(OUTUBRO, PURCHASES, [
      ...ITEMS,
      item("p1", LEITE, 1, 4.0),
    ]);

    assert.equal(dobrado.bestTimes[0].purchaseCount, 5);
  });

  test("preco estavel nao vira 'melhor epoca'", () => {
    const estavel = buildMonthlyReport(OUTUBRO, PURCHASES, [
      item("p0", LEITE, 1, 4.0),
      item("p1", LEITE, 1, 4.0),
      item("p2", LEITE, 1, 4.0),
      item("p3", LEITE, 1, 4.0),
    ]);

    assert.deepEqual(estavel.bestTimes, []);
    assert.deepEqual(estavel.cheaper, []);
    assert.equal(estavel.potentialSavings, 0);
  });

  test("mes sem compra devolve um relatorio vazio, sem dividir por zero", () => {
    const vazio = buildMonthlyReport(reportPeriod(2026, 3, SP), PURCHASES, ITEMS);

    assert.equal(vazio.total, 0);
    assert.equal(vazio.purchaseCount, 0);
    assert.equal(vazio.averageTicket, 0);
    assert.equal(vazio.previousTotal, null);
    assert.equal(vazio.change, null);
    assert.equal(vazio.biggestPurchase, null);
    assert.deepEqual(vazio.stores, []);
    assert.deepEqual(vazio.topSpend, []);
  });

  test("mes anterior sem compra nao gera variacao", () => {
    const agosto = buildMonthlyReport(reportPeriod(2026, 7, SP), PURCHASES, ITEMS);

    assert.equal(agosto.total, 80);
    assert.equal(agosto.previousTotal, null);
    assert.equal(agosto.change, null);
  });
});

/* -------------------------------------------------------------------------- */

describe("e-mail do relatorio", () => {
  const report = buildMonthlyReport(OUTUBRO, PURCHASES, ITEMS);
  const options = {
    householdName: "Nossa casa",
    recipientName: "Henri",
    appUrl: "https://mercadito.example/",
  };

  test("o assunto diz o mes e o total", () => {
    const { subject } = renderMonthlyReport(report, options);

    assert.match(subject, /outubro de 2026/);
    assert.match(subject, /R\$\s360,00/);
  });

  test("as frases de abertura contam o mes em poucas linhas", () => {
    const lines = highlights(report);

    assert.match(lines[0], /140% a mais que em setembro/);
    assert.ok(lines.some((line) => /Mercado Caro levou a maior parte/.test(line)));
    assert.ok(lines.some((line) => /O que mais pesou foi Picanha/.test(line)));
    assert.ok(lines.some((line) => /Picanha ficou 33% mais caro/.test(line)));
    assert.ok(lines.some((line) => /cairia cerca de R\$\s25,67/.test(line)));
  });

  test("a frase da melhor epoca diz quando, quanto e onde", () => {
    const sentence = bestTimeSentence(report.bestTimes[0]);

    assert.equal(
      sentence.replace(/\s/g, " "),
      "Mais em conta no início do mês: cerca de 12% abaixo do fim do mês (2 compras contra 2). " +
        "Menor preço médio no Mercado Barato (R$ 4,17).",
    );
  });

  test("o HTML traz todas as secoes e o link para o app", () => {
    const { html } = renderMonthlyReport(report, options);

    for (const title of [
      "Em resumo",
      "Evolução",
      "Onde você comprou",
      "No que você mais gastou",
      "Itens mais caros",
      "O que mudou de preço",
      "Onde sai mais barato",
      "Melhor época para comprar",
    ]) {
      assert.ok(html.includes(title), `faltou a seção "${title}"`);
    }

    assert.ok(html.includes("Oi, Henri."));
    assert.ok(html.includes('href="https://mercadito.example/resumo"'));
    assert.ok(html.includes("por kg"), "preço unitário precisa da unidade");
  });

  test("a versao em texto tem o mesmo conteudo", () => {
    const { text } = renderMonthlyReport(report, options);

    assert.match(text, /Total gasto: R\$\s360,00/);
    assert.match(text, /NO QUE VOCÊ MAIS GASTOU/);
    assert.match(text, /- Picanha: R\$\s96,00/);
    assert.match(text, /MELHOR ÉPOCA PARA COMPRAR/);
    assert.ok(text.includes("https://mercadito.example/resumo"));
  });

  test("nome vindo da nota fiscal nunca entra cru no HTML", () => {
    const hostil = { id: "x", name: '<script>alert("oi")</script> & Cia' };
    const { html } = renderMonthlyReport(
      buildMonthlyReport(OUTUBRO, PURCHASES, [item("p1", hostil, 1, 9.9)]),
      { ...options, householdName: "Casa <b>da</b> Ana" },
    );

    assert.ok(!html.includes("<script>"));
    assert.ok(!html.includes("<b>da</b>"));
    assert.ok(html.includes("&lt;script&gt;"));
    assert.equal(escapeHtml(`<a href="x">'&'</a>`), "&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
  });

  test("mes com pouca coisa mostra os avisos em vez de secoes vazias", () => {
    const pouco = buildMonthlyReport(OUTUBRO, [PURCHASES[0]], []);
    const { html, text } = renderMonthlyReport(pouco, { ...options, recipientName: null });

    assert.ok(html.includes("As notas deste mês vieram sem itens detalhados."));
    assert.ok(html.includes("Ainda não dá para comparar."));
    assert.ok(html.includes("Ainda falta histórico."));
    assert.ok(!html.includes("Itens mais caros"));
    assert.ok(!html.includes("Oi, "));
    assert.match(text, /Total gasto: R\$\s100,00/);
  });
});
