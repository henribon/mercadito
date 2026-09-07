import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  HABITS_MONTHS,
  comparePrices,
  monthWindow,
  rankStoresByPrice,
} from "../src/lib/data.ts";
import { centerSquare } from "../src/lib/qr-camera.ts";
import type { StorePrice } from "../src/lib/types.ts";

/**
 * A matematica do resumo de gastos e do recorte da camera, sem banco e sem DOM.
 */

function price(
  product: string,
  store: string,
  avg: number,
  purchases = 1,
): StorePrice {
  return {
    product_id: `id-${product}`,
    product_name: product,
    store_key: store,
    store_name: store,
    avg_unit_price: avg,
    purchase_count: purchases,
  };
}

describe("janela do mes", () => {
  test("recorta do primeiro dia do mes ao primeiro do seguinte", () => {
    const window = monthWindow(new Date(2026, 8, 17, 22, 30));

    assert.equal(window.from, new Date(2026, 8, 1).toISOString());
    assert.equal(window.to, new Date(2026, 9, 1).toISOString());
    assert.equal(window.previousFrom, new Date(2026, 7, 1).toISOString());
  });

  test("o inicio e meia-noite local, nao meia-noite UTC", () => {
    const window = monthWindow(new Date(2026, 8, 17));
    const start = new Date(window.from);

    // A compra das 22h do dia 31 pertence ao mes que a pessoa viu no relogio.
    assert.equal(start.getDate(), 1);
    assert.equal(start.getHours(), 0);
    assert.equal(start.getMonth(), 8);
  });

  test("a virada do ano nao quebra o mes anterior", () => {
    const window = monthWindow(new Date(2026, 0, 10));

    assert.equal(window.previousFrom, new Date(2025, 11, 1).toISOString());
    assert.equal(window.to, new Date(2026, 1, 1).toISOString());
  });

  test("a janela de habitos recua os meses combinados", () => {
    const window = monthWindow(new Date(2026, 8, 1));

    assert.equal(window.habitsFrom, new Date(2026, 8 - HABITS_MONTHS, 1).toISOString());
    assert.ok(window.habitsFrom < window.from);
  });
});

describe("comparacao de precos entre mercados", () => {
  test("aponta o mais barato e o quanto o outro cobra a mais", () => {
    const [leite] = comparePrices([
      price("Leite", "Mercado Um", 5),
      price("Leite", "Mercado Dois", 4),
    ]);

    assert.equal(leite.cheapestStore, "Mercado Dois");
    assert.equal(leite.cheapestPrice, 4);
    assert.equal(leite.priciestStore, "Mercado Um");
    // 5 / 4 - 1 = 25% mais caro
    assert.equal(leite.difference, 0.25);
  });

  test("ignora produto que so foi comprado num mercado", () => {
    const comparisons = comparePrices([
      price("Cafe", "Mercado Um", 20),
      price("Leite", "Mercado Um", 5),
      price("Leite", "Mercado Dois", 4),
    ]);

    assert.deepEqual(
      comparisons.map((row) => row.productName),
      ["Leite"],
    );
  });

  test("ignora preco igual nos dois: nao ha escolha a fazer", () => {
    const comparisons = comparePrices([
      price("Arroz", "Mercado Um", 26),
      price("Arroz", "Mercado Dois", 26),
    ]);

    assert.equal(comparisons.length, 0);
  });

  test("descarta preco zerado, que viraria uma diferenca infinita", () => {
    const comparisons = comparePrices([
      price("Brinde", "Mercado Um", 0),
      price("Brinde", "Mercado Dois", 10),
    ]);

    assert.equal(comparisons.length, 0);
  });

  test("a maior diferenca vem primeiro", () => {
    const comparisons = comparePrices([
      price("Leite", "Mercado Um", 5),
      price("Leite", "Mercado Dois", 4),
      price("Cafe", "Mercado Um", 30),
      price("Cafe", "Mercado Dois", 15),
    ]);

    assert.deepEqual(
      comparisons.map((row) => row.productName),
      ["Cafe", "Leite"],
    );
  });

  test("com tres mercados compara o extremo mais barato com o mais caro", () => {
    const [row] = comparePrices([
      price("Leite", "Mercado Um", 5),
      price("Leite", "Mercado Dois", 4),
      price("Leite", "Mercado Tres", 6),
    ]);

    assert.equal(row.cheapestPrice, 4);
    assert.equal(row.priciestPrice, 6);
    assert.equal(row.priciestStore, "Mercado Tres");
  });
});

describe("placar dos mercados", () => {
  test("conta em quantos produtos cada mercado tem o menor preco", () => {
    const ranking = rankStoresByPrice([
      price("Leite", "Barato", 4),
      price("Leite", "Caro", 5),
      price("Cafe", "Barato", 15),
      price("Cafe", "Caro", 30),
      price("Arroz", "Barato", 30),
      price("Arroz", "Caro", 26),
    ]);

    assert.equal(ranking[0].storeName, "Barato");
    assert.equal(ranking[0].wins, 2);
    assert.equal(ranking[0].compared, 3);

    const caro = ranking.find((row) => row.storeName === "Caro")!;
    assert.equal(caro.wins, 1);
    assert.equal(caro.compared, 3);
  });

  test("produto de um mercado so nao entra no placar de ninguem", () => {
    const ranking = rankStoresByPrice([
      price("Cafe", "Mercado Um", 20),
      price("Leite", "Mercado Um", 5),
      price("Leite", "Mercado Dois", 4),
    ]);

    const um = ranking.find((row) => row.storeName === "Mercado Um")!;
    assert.equal(um.compared, 1, "o cafe nao tem com o que ser comparado");
  });

  test("empate conta como vitoria para os dois", () => {
    const ranking = rankStoresByPrice([
      price("Arroz", "Mercado Um", 26),
      price("Arroz", "Mercado Dois", 26),
    ]);

    assert.equal(ranking.length, 2);
    assert.ok(ranking.every((row) => row.wins === 1));
  });

  test("sem nada comparavel o placar fica vazio", () => {
    assert.deepEqual(rankStoresByPrice([price("Cafe", "Mercado Um", 20)]), []);
    assert.deepEqual(rankStoresByPrice([]), []);
  });
});

describe("recorte da camera", () => {
  test("pega o quadrado central de um quadro deitado", () => {
    assert.deepEqual(centerSquare(1920, 1080), { x: 420, y: 0, size: 1080 });
  });

  test("pega o quadrado central de um quadro em pe", () => {
    assert.deepEqual(centerSquare(1080, 1920), { x: 0, y: 420, size: 1080 });
  });

  test("quadro ja quadrado nao perde nada", () => {
    assert.deepEqual(centerSquare(720, 720), { x: 0, y: 0, size: 720 });
  });

  test("video ainda sem medidas nao vira um recorte invalido", () => {
    // Acontece entre o play() e o primeiro quadro: videoWidth ainda e 0.
    assert.equal(centerSquare(0, 0), null);
    assert.equal(centerSquare(640, 0), null);
    assert.equal(centerSquare(Number.NaN, 480), null);
  });
});
