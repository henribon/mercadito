import { test, before, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";

import {
  CLAIM_REPORT_DELIVERY,
  DELETE_USER_PASSWORD,
  PASSWORD_BY_EMAIL,
  PASSWORD_FAILED,
  PASSWORD_USED,
  RELEASE_REPORT_DELIVERY,
  REPORT_ITEMS,
  REPORT_PREFERENCE,
  REPORT_PURCHASES,
  REPORT_RECIPIENTS,
  SET_REPORT_PREFERENCE,
  UPSERT_USER_PASSWORD,
  USER_HAS_PASSWORD,
} from "../src/lib/sql.ts";
import {
  buildMonthlyReport,
  reportPeriod,
  type ReportItem,
  type ReportPurchase,
} from "../src/lib/report.ts";
import {
  ADD_PRODUCT_TO_LIST,
  CLEAR_BOUGHT_ITEMS,
  DELETE_DEVICES_FOR_USER,
  DELETE_DEVICE,
  DELETE_DEVICE_BY_TOKEN,
  DELETE_USER_PIN,
  DEVICE_BY_TOKEN,
  DEVICE_FAILED,
  DEVICE_IS_TRUSTED,
  DEVICE_USED,
  HOUSEHOLD_BY_INVITE_CODE,
  HOUSEHOLD_COUNT,
  HOUSEHOLD_FOR_USER,
  INSERT_HOUSEHOLD,
  INSERT_MEMBER,
  PENDING_ITEMS,
  PRICE_BY_STORE,
  PRODUCTS_WITH_STATS,
  INSERT_TRUSTED_DEVICE,
  PURCHASE_SUMMARIES,
  SPEND_BY_STORE,
  SPEND_TOTAL,
  TOP_REPEAT_PRODUCTS,
  UPSERT_PRODUCT,
  UPSERT_USER_PIN,
  USER_BY_EMAIL,
  USER_PIN,
} from "../src/lib/sql.ts";
import { comparePrices, rankStoresByPrice } from "../src/lib/data.ts";

/**
 * Roda o schema e as consultas de producao contra um Postgres real (PGlite,
 * Postgres compilado para WASM). Pega erro de SQL, de constraint e de logica da
 * view sem depender de um banco remoto.
 */

const here = dirname(fileURLToPath(import.meta.url));
const schema = readFileSync(join(here, "..", "neon", "schema.sql"), "utf8");

/** Formato minimo da tabela que o `better-auth cli migrate` cria. */
const AUTH_STUB = `
  create table "user" (
    id             text primary key,
    name           text,
    email          text not null unique,
    "emailVerified" boolean not null default false,
    "createdAt"    timestamptz not null default now(),
    "updatedAt"    timestamptz not null default now()
  );
`;

let db: PGlite;

// ids fixos para as asserções
const HOUSE_A = "11111111-1111-1111-1111-111111111111";
const HOUSE_B = "22222222-2222-2222-2222-222222222222";
const ARROZ = "aaaaaaaa-0000-0000-0000-000000000001";
const LEITE = "aaaaaaaa-0000-0000-0000-000000000002";
const SABAO = "aaaaaaaa-0000-0000-0000-000000000003";
const ALHEIO = "bbbbbbbb-0000-0000-0000-000000000001";

before(async () => {
  db = await PGlite.create({ extensions: { pg_trgm } });

  await db.exec(AUTH_STUB);
  await db.exec(schema);

  await db.exec(`
    insert into "user" (id, name, email) values
      ('user-henri', 'Henri', 'henri@example.com'),
      ('user-esposa', 'Esposa', 'esposa@example.com'),
      ('user-outro', 'Outro', 'outro@example.com');

    insert into households (id, name, invite_code) values
      ('${HOUSE_A}', 'Nossa casa', 'ABC123'),
      ('${HOUSE_B}', 'Casa alheia', 'XYZ789');

    insert into household_members (household_id, user_id, display_name) values
      ('${HOUSE_A}', 'user-henri', 'Henri'),
      ('${HOUSE_A}', 'user-esposa', 'Esposa'),
      ('${HOUSE_B}', 'user-outro', 'Outro');

    insert into products (id, household_id, name, norm_name, unit, is_recurring, recurrence_days) values
      ('${ARROZ}', '${HOUSE_A}', 'Arroz',          'ARROZ',          'UN', true, 30),
      ('${LEITE}', '${HOUSE_A}', 'Leite integral', 'INTEGRAL LEITE', 'UN', true, null),
      ('${SABAO}', '${HOUSE_A}', 'Sabao em po',    'PO SABAO',       'UN', false, null),
      ('${ALHEIO}', '${HOUSE_B}', 'Cafe',          'CAFE',           'UN', false, null);

    -- Leite comprado 3 vezes, de 10 em 10 dias -> intervalo medio 10.
    insert into purchases (id, household_id, store_name, access_key, total_amount, paid_amount, purchased_at, created_by) values
      ('cccccccc-0000-0000-0000-000000000001', '${HOUSE_A}', 'Mercado Um', 'KEY1', 50.00, 50.00, now() - interval '20 days', 'user-henri'),
      ('cccccccc-0000-0000-0000-000000000002', '${HOUSE_A}', 'Mercado Um', 'KEY2', 30.00, 28.00, now() - interval '10 days', 'user-henri'),
      ('cccccccc-0000-0000-0000-000000000003', '${HOUSE_A}', 'Mercado Dois', 'KEY3', 20.00, 20.00, now(), 'user-esposa');

    insert into purchase_items (purchase_id, household_id, product_id, raw_description, quantity, unit, unit_price, total_price, position) values
      ('cccccccc-0000-0000-0000-000000000001', '${HOUSE_A}', '${LEITE}', 'LEITE INTEG 1L', 6, 'UN', 4.00, 24.00, 0),
      ('cccccccc-0000-0000-0000-000000000001', '${HOUSE_A}', '${ARROZ}', 'ARROZ TIPO 1 5KG', 1, 'UN', 26.00, 26.00, 1),
      ('cccccccc-0000-0000-0000-000000000002', '${HOUSE_A}', '${LEITE}', 'LEITE INTEG 1L', 6, 'UN', 5.00, 30.00, 0),
      ('cccccccc-0000-0000-0000-000000000003', '${HOUSE_A}', '${LEITE}', 'LEITE INTEG 1L', 4, 'UN', 5.00, 20.00, 0);
  `);
});

describe("schema", () => {
  test("aplica sem erro e cria as tabelas esperadas", async () => {
    const { rows } = await db.query<{ table_name: string }>(
      `select table_name from information_schema.tables
        where table_schema = 'public' order by table_name`,
    );
    const names = rows.map((row) => row.table_name);

    for (const expected of [
      "households",
      "household_members",
      "products",
      "product_aliases",
      "purchases",
      "purchase_items",
      "list_items",
      "user_pins",
      "trusted_devices",
      "user_passwords",
      "report_deliveries",
    ]) {
      assert.ok(names.includes(expected), `faltou a tabela ${expected}`);
    }
  });

  test("o indice parcial impede o mesmo produto pendente duas vezes", async () => {
    await db.query(
      `insert into list_items (household_id, product_id, added_by) values ($1, $2, $3)`,
      [HOUSE_A, SABAO, "user-henri"],
    );

    await assert.rejects(
      db.query(
        `insert into list_items (household_id, product_id, added_by) values ($1, $2, $3)`,
        [HOUSE_A, SABAO, "user-esposa"],
      ),
      /duplicate key|unique/i,
    );

    // Depois de comprado, o mesmo produto pode voltar para a lista.
    await db.query(`update list_items set status = 'bought' where product_id = $1`, [
      SABAO,
    ]);
    await db.query(
      `insert into list_items (household_id, product_id, added_by) values ($1, $2, $3)`,
      [HOUSE_A, SABAO, "user-henri"],
    );

    const { rows } = await db.query<{ count: number }>(
      `select count(*)::int as count from list_items where product_id = $1 and status = 'pending'`,
      [SABAO],
    );
    assert.equal(rows[0].count, 1);

    await db.query(`delete from list_items where product_id = $1`, [SABAO]);
  });

  test("apagar a casa leva junto produtos, compras e lista", async () => {
    await db.query(`insert into households (id, name, invite_code) values ($1,$2,$3)`, [
      "dddddddd-0000-0000-0000-000000000001",
      "Temporaria",
      "TMP001",
    ]);
    await db.query(
      `insert into products (household_id, name, norm_name) values ($1,$2,$3)`,
      ["dddddddd-0000-0000-0000-000000000001", "Teste", "TESTE"],
    );

    await db.query(`delete from households where id = $1`, [
      "dddddddd-0000-0000-0000-000000000001",
    ]);

    const { rows } = await db.query<{ count: number }>(
      `select count(*)::int as count from products where household_id = $1`,
      ["dddddddd-0000-0000-0000-000000000001"],
    );
    assert.equal(rows[0].count, 0);
  });
});

describe("product_stats", () => {
  test("calcula ultima compra, contagem, preco medio e intervalo", async () => {
    const { rows } = await db.query<{
      product_id: string;
      purchase_count: number;
      avg_unit_price: string;
      last_unit_price: string;
      avg_interval_days: number | null;
      last_purchased_at: Date | null;
    }>(`select * from product_stats where product_id = $1`, [LEITE]);

    const stats = rows[0];

    assert.equal(stats.purchase_count, 3);
    // (4 + 5 + 5) / 3 = 4.67
    assert.equal(Number(stats.avg_unit_price), 4.67);
    assert.equal(Number(stats.last_unit_price), 5);
    // 20 dias entre a primeira e a ultima, com 3 compras -> 10
    assert.equal(stats.avg_interval_days, 10);
    assert.ok(stats.last_purchased_at !== null);
  });

  test("produto nunca comprado aparece com contagem zero, nao sumido", async () => {
    const { rows } = await db.query<{
      purchase_count: number;
      last_purchased_at: Date | null;
      avg_interval_days: number | null;
    }>(`select * from product_stats where product_id = $1`, [SABAO]);

    assert.equal(rows.length, 1);
    assert.equal(rows[0].purchase_count, 0);
    assert.equal(rows[0].last_purchased_at, null);
    assert.equal(rows[0].avg_interval_days, null);
  });

  test("comprado uma unica vez nao inventa intervalo", async () => {
    const { rows } = await db.query<{
      purchase_count: number;
      avg_interval_days: number | null;
    }>(`select * from product_stats where product_id = $1`, [ARROZ]);

    assert.equal(rows[0].purchase_count, 1);
    assert.equal(rows[0].avg_interval_days, null);
  });
});

describe("consultas da aplicacao", () => {
  test("HOUSEHOLD_FOR_USER devolve a casa certa de cada usuario", async () => {
    const mine = await db.query<{ id: string; name: string }>(HOUSEHOLD_FOR_USER, [
      "user-henri",
    ]);
    assert.equal(mine.rows[0].id, HOUSE_A);

    const wife = await db.query<{ id: string }>(HOUSEHOLD_FOR_USER, ["user-esposa"]);
    assert.equal(wife.rows[0].id, HOUSE_A);

    const stranger = await db.query<{ id: string }>(HOUSEHOLD_FOR_USER, ["user-outro"]);
    assert.equal(stranger.rows[0].id, HOUSE_B);
  });

  test("PRODUCTS_WITH_STATS traz so os produtos da casa, com estatisticas", async () => {
    const { rows } = await db.query<{
      id: string;
      name: string;
      purchase_count: number;
      avg_interval_days: number | null;
    }>(PRODUCTS_WITH_STATS, [HOUSE_A]);

    assert.equal(rows.length, 3);
    assert.ok(!rows.some((row) => row.id === ALHEIO), "vazou produto de outra casa");

    // ordenado por nome
    assert.deepEqual(
      rows.map((row) => row.name),
      ["Arroz", "Leite integral", "Sabao em po"],
    );

    const leite = rows.find((row) => row.id === LEITE)!;
    assert.equal(leite.purchase_count, 3);
    assert.equal(leite.avg_interval_days, 10);
  });

  test("ADD_PRODUCT_TO_LIST recusa produto de outra casa", async () => {
    await db.query(ADD_PRODUCT_TO_LIST, [HOUSE_A, ALHEIO, 1, "user-henri"]);

    const { rows } = await db.query<{ count: number }>(
      `select count(*)::int as count from list_items where product_id = $1`,
      [ALHEIO],
    );
    assert.equal(rows[0].count, 0, "produto de outra casa entrou na lista");
  });

  test("ADD_PRODUCT_TO_LIST e idempotente para um produto ja pendente", async () => {
    await db.query(ADD_PRODUCT_TO_LIST, [HOUSE_A, ARROZ, 1, "user-henri"]);
    await db.query(ADD_PRODUCT_TO_LIST, [HOUSE_A, ARROZ, 5, "user-esposa"]);

    const { rows } = await db.query<{ count: number }>(
      `select count(*)::int as count from list_items
        where product_id = $1 and status = 'pending'`,
      [ARROZ],
    );
    assert.equal(rows[0].count, 1);
  });

  test("PENDING_ITEMS lista apenas os pendentes da casa", async () => {
    const { rows } = await db.query<{ product_id: string; status: string }>(
      PENDING_ITEMS,
      [HOUSE_A],
    );

    assert.ok(rows.length >= 1);
    assert.ok(rows.every((row) => row.status === "pending"));
    assert.ok(rows.some((row) => row.product_id === ARROZ));
  });

  test("UPSERT_PRODUCT devolve o existente em vez de duplicar", async () => {
    const first = await db.query<{ id: string; name: string }>(UPSERT_PRODUCT, [
      HOUSE_A,
      "Arroz",
      "ARROZ",
      "UN",
    ]);

    assert.equal(first.rows[0].id, ARROZ, "criou um produto novo em vez de reaproveitar");

    const { rows } = await db.query<{ count: number }>(
      `select count(*)::int as count from products where household_id = $1 and norm_name = 'ARROZ'`,
      [HOUSE_A],
    );
    assert.equal(rows[0].count, 1);
  });

  test("CLEAR_BOUGHT_ITEMS baixa da lista so os produtos da nota", async () => {
    await db.query(ADD_PRODUCT_TO_LIST, [HOUSE_A, LEITE, 1, "user-henri"]);

    const cleared = await db.query<{ id: string }>(CLEAR_BOUGHT_ITEMS, [
      new Date().toISOString(),
      "cccccccc-0000-0000-0000-000000000003",
      HOUSE_A,
      [LEITE],
    ]);

    assert.equal(cleared.rows.length, 1, "deveria baixar exatamente o leite");

    // O arroz, que nao estava na nota, continua pendente.
    const { rows } = await db.query<{ status: string }>(
      `select status from list_items where product_id = $1 order by created_at desc limit 1`,
      [ARROZ],
    );
    assert.equal(rows[0].status, "pending");
  });

  test("PURCHASE_SUMMARIES agrega a contagem de itens por compra", async () => {
    const { rows } = await db.query<{
      id: string;
      item_count: number;
      store_name: string;
      paid_amount: string;
    }>(PURCHASE_SUMMARIES, [HOUSE_A, 100]);

    assert.equal(rows.length, 3);
    // mais recente primeiro
    assert.equal(rows[0].store_name, "Mercado Dois");
    assert.equal(rows[0].item_count, 1);

    const primeira = rows.find(
      (row) => row.id === "cccccccc-0000-0000-0000-000000000001",
    )!;
    assert.equal(primeira.item_count, 2);
    assert.equal(Number(primeira.paid_amount), 50);
  });

  test("a mesma nota nao entra duas vezes na mesma casa", async () => {
    await assert.rejects(
      db.query(
        `insert into purchases (household_id, access_key, purchased_at) values ($1, $2, now())`,
        [HOUSE_A, "KEY1"],
      ),
      /duplicate key|unique/i,
    );

    // ...mas a mesma chave pode existir em outra casa.
    await db.query(
      `insert into purchases (household_id, access_key, purchased_at) values ($1, $2, now())`,
      [HOUSE_B, "KEY1"],
    );
  });
});

describe("entrar numa casa", () => {
  test("criar casa e virar membro deixa HOUSEHOLD_FOR_USER encontrar", async () => {
    const created = await db.query<{ id: string; invite_code: string }>(
      INSERT_HOUSEHOLD,
      ["Casa nova", "NOVA01"],
    );
    const houseId = created.rows[0].id;

    await db.query(INSERT_MEMBER, [houseId, "user-outro", "Outro"]);

    // user-outro já era membro da HOUSE_B; a consulta pega a mais antiga,
    // que é o comportamento esperado de "a casa dele".
    const { rows } = await db.query<{ id: string }>(HOUSEHOLD_FOR_USER, [
      "user-outro",
    ]);
    assert.equal(rows[0].id, HOUSE_B);

    await db.query(`delete from households where id = $1`, [houseId]);
  });

  test("INSERT_MEMBER é idempotente", async () => {
    await db.query(INSERT_MEMBER, [HOUSE_A, "user-henri", "Henri de novo"]);

    const { rows } = await db.query<{ count: number }>(
      `select count(*)::int as count from household_members
        where household_id = $1 and user_id = $2`,
      [HOUSE_A, "user-henri"],
    );
    assert.equal(rows[0].count, 1);
  });

  test("HOUSEHOLD_BY_INVITE_CODE acha a casa pelo código", async () => {
    const found = await db.query<{ id: string }>(HOUSEHOLD_BY_INVITE_CODE, ["ABC123"]);
    assert.equal(found.rows[0].id, HOUSE_A);

    const missing = await db.query(HOUSEHOLD_BY_INVITE_CODE, ["NAOEXISTE"]);
    assert.equal(missing.rows.length, 0);
  });

  test("dois códigos de convite iguais não coexistem", async () => {
    await assert.rejects(
      db.query(INSERT_HOUSEHOLD, ["Clone", "ABC123"]),
      /duplicate key|unique/i,
    );
  });
});

describe("portao de acesso", () => {
  test("USER_BY_EMAIL acha sem diferenciar maiusculas", async () => {
    const exato = await db.query(USER_BY_EMAIL, ["henri@example.com"]);
    assert.equal(exato.rows.length, 1);

    const trocado = await db.query(USER_BY_EMAIL, ["HENRI@Example.COM"]);
    assert.equal(trocado.rows.length, 1, "deveria achar independente da caixa");

    const inexistente = await db.query(USER_BY_EMAIL, ["ninguem@example.com"]);
    assert.equal(inexistente.rows.length, 0);
  });

  test("HOUSEHOLD_COUNT conta as casas existentes", async () => {
    const { rows } = await db.query<{ n: number }>(HOUSEHOLD_COUNT);
    assert.ok(rows[0].n >= 2, "o seed cria pelo menos duas casas");
  });
});

describe("codigo de 4 digitos", () => {
  const TOKEN = "hash-do-token-do-celular-do-henri";
  const OUTRO_TOKEN = "hash-do-token-do-notebook-do-henri";

  test("UPSERT_USER_PIN cria e depois troca o código, sem duplicar", async () => {
    await db.query(UPSERT_USER_PIN, ["user-henri", "scrypt$aa$bb"]);
    await db.query(UPSERT_USER_PIN, ["user-henri", "scrypt$cc$dd"]);

    const { rows } = await db.query<{ pin_hash: string }>(USER_PIN, ["user-henri"]);
    assert.equal(rows.length, 1, "cada pessoa tem um código só");
    assert.equal(rows[0].pin_hash, "scrypt$cc$dd");
  });

  test("DEVICE_BY_TOKEN traz o dono e o código dele de uma vez", async () => {
    await db.query(INSERT_TRUSTED_DEVICE, ["user-henri", TOKEN]);

    const { rows } = await db.query<{
      user_id: string;
      user_name: string;
      failed_count: number;
      pin_hash: string | null;
    }>(DEVICE_BY_TOKEN, [TOKEN]);

    assert.equal(rows.length, 1);
    assert.equal(rows[0].user_id, "user-henri");
    assert.equal(rows[0].user_name, "Henri");
    assert.equal(rows[0].failed_count, 0);
    assert.equal(rows[0].pin_hash, "scrypt$cc$dd");
  });

  test("aparelho de quem ainda não criou código vem com pin_hash nulo", async () => {
    await db.query(INSERT_TRUSTED_DEVICE, ["user-esposa", "token-da-esposa"]);

    const { rows } = await db.query<{ pin_hash: string | null }>(DEVICE_BY_TOKEN, [
      "token-da-esposa",
    ]);

    assert.equal(rows.length, 1, "o join com user_pins não pode sumir com a linha");
    assert.equal(rows[0].pin_hash, null);
  });

  test("DEVICE_FAILED conta os erros e DEVICE_USED zera", async () => {
    const { rows: dev } = await db.query<{ id: string }>(DEVICE_BY_TOKEN, [TOKEN]);
    const id = dev[0].id;

    const primeira = await db.query<{ failed_count: number }>(DEVICE_FAILED, [id]);
    const segunda = await db.query<{ failed_count: number }>(DEVICE_FAILED, [id]);

    assert.equal(primeira.rows[0].failed_count, 1);
    assert.equal(segunda.rows[0].failed_count, 2);

    await db.query(DEVICE_USED, [id]);
    const { rows } = await db.query<{ failed_count: number }>(DEVICE_BY_TOKEN, [TOKEN]);
    assert.equal(rows[0].failed_count, 0, "acertar tem que limpar o histórico");
  });

  test("reconfiar o mesmo token atualiza a linha em vez de duplicar", async () => {
    await db.query(DEVICE_FAILED, [
      (await db.query<{ id: string }>(DEVICE_BY_TOKEN, [TOKEN])).rows[0].id,
    ]);
    await db.query(INSERT_TRUSTED_DEVICE, ["user-henri", TOKEN]);

    const { rows } = await db.query<{ failed_count: number }>(DEVICE_BY_TOKEN, [TOKEN]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].failed_count, 0);
  });

  test("DEVICE_IS_TRUSTED só reconhece o aparelho do próprio dono", async () => {
    const doDono = await db.query(DEVICE_IS_TRUSTED, [TOKEN, "user-henri"]);
    assert.equal(doDono.rows.length, 1);

    const deOutro = await db.query(DEVICE_IS_TRUSTED, [TOKEN, "user-esposa"]);
    assert.equal(deOutro.rows.length, 0);
  });

  test("DELETE_DEVICE_BY_TOKEN apaga só aquele aparelho", async () => {
    await db.query(INSERT_TRUSTED_DEVICE, ["user-henri", OUTRO_TOKEN]);
    await db.query(DELETE_DEVICE_BY_TOKEN, [OUTRO_TOKEN]);

    assert.equal((await db.query(DEVICE_BY_TOKEN, [OUTRO_TOKEN])).rows.length, 0);
    assert.equal((await db.query(DEVICE_BY_TOKEN, [TOKEN])).rows.length, 1);
  });

  test("remover o código derruba todos os aparelhos do dono", async () => {
    await db.query(INSERT_TRUSTED_DEVICE, ["user-henri", OUTRO_TOKEN]);

    await db.query(DELETE_USER_PIN, ["user-henri"]);
    await db.query(DELETE_DEVICES_FOR_USER, ["user-henri"]);

    assert.equal((await db.query(USER_PIN, ["user-henri"])).rows.length, 0);
    assert.equal((await db.query(DEVICE_BY_TOKEN, [TOKEN])).rows.length, 0);
    assert.equal((await db.query(DEVICE_BY_TOKEN, [OUTRO_TOKEN])).rows.length, 0);

    const daEsposa = await db.query(DEVICE_BY_TOKEN, ["token-da-esposa"]);
    assert.equal(daEsposa.rows.length, 1, "não é para mexer no aparelho do outro");
  });

  test("apagar a conta leva junto o código e os aparelhos", async () => {
    await db.query(UPSERT_USER_PIN, ["user-outro", "scrypt$ee$ff"]);
    await db.query(INSERT_TRUSTED_DEVICE, ["user-outro", "token-do-outro"]);

    await db.query(`delete from "user" where id = 'user-outro'`);

    assert.equal((await db.query(USER_PIN, ["user-outro"])).rows.length, 0);
    assert.equal((await db.query(DEVICE_BY_TOKEN, ["token-do-outro"])).rows.length, 0);
  });

  test("DELETE_DEVICE remove o aparelho que errou vezes demais", async () => {
    await db.query(INSERT_TRUSTED_DEVICE, ["user-esposa", "token-passageiro"]);
    const { rows } = await db.query<{ id: string }>(DEVICE_BY_TOKEN, [
      "token-passageiro",
    ]);

    await db.query(DELETE_DEVICE, [rows[0].id]);

    assert.equal((await db.query(DEVICE_BY_TOKEN, ["token-passageiro"])).rows.length, 0);
  });
});

describe("resumo de gastos", () => {
  // Casa propria, com datas fixas: os numeros do resumo nao podem depender de
  // que dia o teste roda.
  const CASA = "eeeeeeee-0000-0000-0000-000000000001";
  const LEITE_R = "eeeeeeee-1111-0000-0000-000000000001";
  const CAFE_R = "eeeeeeee-1111-0000-0000-000000000002";
  const ARROZ_R = "eeeeeeee-1111-0000-0000-000000000003";

  const MARCO = ["2026-03-01T00:00:00Z", "2026-04-01T00:00:00Z"];
  const FEVEREIRO = ["2026-02-01T00:00:00Z", "2026-03-01T00:00:00Z"];
  const ANO = "2026-01-01T00:00:00Z";

  before(async () => {
    await db.exec(`
      insert into households (id, name, invite_code) values
        ('${CASA}', 'Casa do resumo', 'RES001');

      insert into products (id, household_id, name, norm_name) values
        ('${LEITE_R}', '${CASA}', 'Leite', 'LEITE'),
        ('${CAFE_R}',  '${CASA}', 'Cafe',  'CAFE'),
        ('${ARROZ_R}', '${CASA}', 'Arroz', 'ARROZ');

      insert into purchases
        (id, household_id, store_name, store_cnpj, access_key,
         total_amount, paid_amount, purchased_at)
      values
        ('eeeeeeee-2222-0000-0000-000000000001', '${CASA}', 'Mercado Barato', '111', 'R1', 100, 100, '2026-03-05T10:00:00Z'),
        ('eeeeeeee-2222-0000-0000-000000000002', '${CASA}', 'Mercado Barato', '111', 'R2',  50,  50, '2026-03-20T10:00:00Z'),
        ('eeeeeeee-2222-0000-0000-000000000003', '${CASA}', 'Mercado Caro',   '222', 'R3', 210, 200, '2026-03-25T10:00:00Z'),
        ('eeeeeeee-2222-0000-0000-000000000004', '${CASA}', 'Mercado Barato', '111', 'R4',  70,  70, '2026-02-10T10:00:00Z'),
        -- nota sem estabelecimento e sem valor pago: exercita os dois coalesce
        ('eeeeeeee-2222-0000-0000-000000000005', '${CASA}', null, null, 'R5', 5, null, '2026-03-28T10:00:00Z');

      insert into purchase_items
        (purchase_id, household_id, product_id, raw_description,
         quantity, unit, unit_price, total_price, position)
      values
        ('eeeeeeee-2222-0000-0000-000000000001', '${CASA}', '${LEITE_R}', 'LEITE 1L',  2, 'UN',  4.00,  8.00, 0),
        ('eeeeeeee-2222-0000-0000-000000000001', '${CASA}', '${CAFE_R}',  'CAFE 500G', 1, 'UN', 15.00, 15.00, 1),
        ('eeeeeeee-2222-0000-0000-000000000002', '${CASA}', '${LEITE_R}', 'LEITE 1L',  2, 'UN',  4.00,  8.00, 0),
        ('eeeeeeee-2222-0000-0000-000000000003', '${CASA}', '${LEITE_R}', 'LEITE 1L',  1, 'UN',  5.00,  5.00, 0),
        ('eeeeeeee-2222-0000-0000-000000000003', '${CASA}', '${CAFE_R}',  'CAFE 500G', 1, 'UN', 30.00, 30.00, 1),
        ('eeeeeeee-2222-0000-0000-000000000003', '${CASA}', '${ARROZ_R}', 'ARROZ 5KG', 1, 'UN', 26.00, 26.00, 2),
        ('eeeeeeee-2222-0000-0000-000000000004', '${CASA}', '${ARROZ_R}', 'ARROZ 5KG', 1, 'UN', 30.00, 30.00, 0);
    `);
  });

  test("SPEND_TOTAL soma o mes e cai para o total quando nao houve valor pago", async () => {
    const { rows } = await db.query<{ purchase_count: number; total: string }>(
      SPEND_TOTAL,
      [CASA, ...MARCO],
    );

    assert.equal(rows[0].purchase_count, 4);
    // 100 + 50 + 200 + 5 (essa ultima so tem total_amount)
    assert.equal(Number(rows[0].total), 355);
  });

  test("SPEND_TOTAL nao deixa a compra do dia 28 vazar para fevereiro", async () => {
    const { rows } = await db.query<{ purchase_count: number; total: string }>(
      SPEND_TOTAL,
      [CASA, ...FEVEREIRO],
    );

    assert.equal(rows[0].purchase_count, 1);
    assert.equal(Number(rows[0].total), 70);
  });

  test("SPEND_TOTAL de um mes sem compra devolve zero, nao linha vazia", async () => {
    const { rows } = await db.query<{ purchase_count: number; total: string }>(
      SPEND_TOTAL,
      [CASA, "2026-01-01T00:00:00Z", "2026-02-01T00:00:00Z"],
    );

    assert.equal(rows.length, 1);
    assert.equal(rows[0].purchase_count, 0);
    assert.equal(Number(rows[0].total), 0);
  });

  test("SPEND_BY_STORE separa por mercado, do maior gasto para o menor", async () => {
    const { rows } = await db.query<{
      store_key: string;
      store_name: string;
      purchase_count: number;
      total: string;
    }>(SPEND_BY_STORE, [CASA, ...MARCO]);

    assert.deepEqual(
      rows.map((row) => [row.store_name, row.purchase_count, Number(row.total)]),
      [
        ["Mercado Caro", 1, 200],
        ["Mercado Barato", 2, 150],
        ["Sem identificação", 1, 5],
      ],
    );

    // O CNPJ e quem agrupa: as duas idas ao Barato viraram uma linha so.
    assert.equal(rows[1].store_key, "111");
  });

  test("SPEND_BY_STORE nao mistura as compras de outra casa", async () => {
    const { rows } = await db.query<{ store_name: string }>(SPEND_BY_STORE, [
      HOUSE_A,
      ...MARCO,
    ]);

    assert.ok(
      !rows.some((row) => row.store_name.startsWith("Mercado Barato")),
      "vazou mercado de outra casa",
    );
  });

  test("TOP_REPEAT_PRODUCTS conta compras distintas, nao linhas de nota", async () => {
    const { rows } = await db.query<{
      product_name: string;
      purchase_count: number;
      total_quantity: string;
      total_spent: string;
      avg_unit_price: string;
    }>(TOP_REPEAT_PRODUCTS, [CASA, ANO, 10]);

    assert.deepEqual(
      rows.map((row) => [row.product_name, row.purchase_count]),
      [
        ["Leite", 3],
        // empate em duas compras: desempata pelo que custou mais
        ["Arroz", 2],
        ["Cafe", 2],
      ],
    );

    const leite = rows[0];
    assert.equal(Number(leite.total_quantity), 5);
    assert.equal(Number(leite.total_spent), 21);
    // (4 + 4 + 5) / 3
    assert.equal(Number(leite.avg_unit_price), 4.33);
  });

  test("TOP_REPEAT_PRODUCTS deixa de fora o que so foi comprado uma vez", async () => {
    // Janela de marco: o arroz de fevereiro fica de fora e o produto perde a
    // reincidencia.
    const { rows } = await db.query<{ product_name: string }>(TOP_REPEAT_PRODUCTS, [
      CASA,
      MARCO[0],
      10,
    ]);

    assert.deepEqual(
      rows.map((row) => row.product_name),
      ["Leite", "Cafe"],
    );
  });

  test("PRICE_BY_STORE devolve a media de cada produto em cada mercado", async () => {
    const { rows } = await db.query<{
      product_name: string;
      store_name: string;
      avg_unit_price: string;
      purchase_count: number;
    }>(PRICE_BY_STORE, [CASA, ANO]);

    const leiteBarato = rows.find(
      (row) => row.product_name === "Leite" && row.store_name === "Mercado Barato",
    )!;

    assert.equal(Number(leiteBarato.avg_unit_price), 4);
    assert.equal(leiteBarato.purchase_count, 2);

    const leiteCaro = rows.find(
      (row) => row.product_name === "Leite" && row.store_name === "Mercado Caro",
    )!;
    assert.equal(Number(leiteCaro.avg_unit_price), 5);
  });

  test("o resultado do PRICE_BY_STORE alimenta a comparacao de data.ts", async () => {
    const { rows } = await db.query<Record<string, unknown>>(PRICE_BY_STORE, [
      CASA,
      ANO,
    ]);

    // O driver de producao ja converte numeric para number (lib/db.ts); no
    // PGlite a conversao e feita aqui.
    const prices = rows.map((row) => ({
      product_id: String(row.product_id),
      product_name: String(row.product_name),
      store_key: String(row.store_key),
      store_name: String(row.store_name),
      avg_unit_price: Number(row.avg_unit_price),
      purchase_count: Number(row.purchase_count),
    }));

    const comparisons = comparePrices(prices);
    assert.deepEqual(
      comparisons.map((row) => row.productName),
      ["Cafe", "Leite", "Arroz"],
    );
    assert.equal(comparisons[0].cheapestStore, "Mercado Barato");
    assert.equal(comparisons[0].difference, 1, "30 e o dobro de 15");

    // O arroz e o unico em que o mercado caro ganha.
    const arroz = comparisons.find((row) => row.productName === "Arroz")!;
    assert.equal(arroz.cheapestStore, "Mercado Caro");

    const ranking = rankStoresByPrice(prices);
    assert.equal(ranking[0].storeName, "Mercado Barato");
    assert.equal(ranking[0].wins, 2);
    assert.equal(ranking[0].compared, 3);
  });
});

describe("senha", () => {
  test("UPSERT_USER_PASSWORD cria e depois troca a senha, sem duplicar", async () => {
    await db.query(UPSERT_USER_PASSWORD, ["user-henri", "scrypt$aa$bb"]);
    await db.query(UPSERT_USER_PASSWORD, ["user-henri", "scrypt$cc$dd"]);

    const { rows } = await db.query<{ password_hash: string }>(PASSWORD_BY_EMAIL, [
      "henri@example.com",
    ]);
    assert.equal(rows.length, 1, "cada pessoa tem uma senha só");
    assert.equal(rows[0].password_hash, "scrypt$cc$dd");

    assert.equal((await db.query(USER_HAS_PASSWORD, ["user-henri"])).rows.length, 1);
  });

  test("PASSWORD_BY_EMAIL acha o e-mail gravado com maiúsculas", async () => {
    await db.query(
      `insert into "user" (id, name, email) values ('user-caixa', 'Caixa', 'Caixa.Alta@Example.com')`,
    );
    await db.query(UPSERT_USER_PASSWORD, ["user-caixa", "scrypt$11$22"]);

    // Quem chama ja manda em minusculas (normalizeEmail).
    const { rows } = await db.query<{ user_id: string }>(PASSWORD_BY_EMAIL, [
      "caixa.alta@example.com",
    ]);
    assert.equal(rows[0]?.user_id, "user-caixa");
  });

  test("quem nunca criou senha não aparece, mesmo tendo conta", async () => {
    const { rows } = await db.query(PASSWORD_BY_EMAIL, ["esposa@example.com"]);
    assert.equal(rows.length, 0);
    assert.equal((await db.query(USER_HAS_PASSWORD, ["user-esposa"])).rows.length, 0);
  });

  test("PASSWORD_FAILED só tranca quando o limite é atingido", async () => {
    type Falha = { failed_count: number; locked_until: Date | null };
    const errar = async () =>
      (await db.query<Falha>(PASSWORD_FAILED, ["user-henri", 3, 15])).rows[0];

    const primeira = await errar();
    const segunda = await errar();
    assert.equal(primeira.failed_count, 1);
    assert.equal(segunda.failed_count, 2);
    assert.equal(segunda.locked_until, null, "ainda dentro do limite");

    const terceira = await errar();
    assert.equal(terceira.failed_count, 3);
    assert.ok(terceira.locked_until, "o terceiro erro tranca");

    const minutos =
      (new Date(terceira.locked_until!).getTime() - Date.now()) / 60_000;
    assert.ok(minutos > 14 && minutos <= 15.1, `tranca de ${minutos} minutos`);

    const { rows } = await db.query<{ locked_until: Date | null }>(PASSWORD_BY_EMAIL, [
      "henri@example.com",
    ]);
    assert.ok(rows[0].locked_until, "o login precisa enxergar a tranca");
  });

  test("os erros de uma conta não trancam a de outra pessoa", async () => {
    const { rows } = await db.query<{ locked_until: Date | null }>(PASSWORD_BY_EMAIL, [
      "caixa.alta@example.com",
    ]);
    assert.equal(rows[0].locked_until, null);
  });

  test("PASSWORD_USED zera os erros e destranca", async () => {
    await db.query(PASSWORD_USED, ["user-henri"]);

    const { rows } = await db.query<{ failed_count: number; locked_until: Date | null }>(
      `select failed_count, locked_until from user_passwords where user_id = 'user-henri'`,
    );
    assert.equal(rows[0].failed_count, 0);
    assert.equal(rows[0].locked_until, null);
  });

  test("trocar a senha também destranca: quem troca já provou quem é", async () => {
    await db.query(PASSWORD_FAILED, ["user-henri", 1, 15]);
    await db.query(UPSERT_USER_PASSWORD, ["user-henri", "scrypt$ee$ff"]);

    const { rows } = await db.query<{ failed_count: number; locked_until: Date | null }>(
      `select failed_count, locked_until from user_passwords where user_id = 'user-henri'`,
    );
    assert.equal(rows[0].failed_count, 0);
    assert.equal(rows[0].locked_until, null);
  });

  test("DELETE_USER_PASSWORD apaga só a senha de quem pediu", async () => {
    await db.query(DELETE_USER_PASSWORD, ["user-henri"]);

    assert.equal((await db.query(USER_HAS_PASSWORD, ["user-henri"])).rows.length, 0);
    assert.equal((await db.query(USER_HAS_PASSWORD, ["user-caixa"])).rows.length, 1);
  });

  test("apagar a conta leva a senha junto", async () => {
    await db.query(`delete from "user" where id = 'user-caixa'`);
    assert.equal((await db.query(USER_HAS_PASSWORD, ["user-caixa"])).rows.length, 0);
  });
});

describe("relatorio mensal", () => {
  // Casa propria e datas fixas, como no resumo.
  const CASA = "ffffffff-0000-0000-0000-000000000001";
  const VIZINHA = "ffffffff-0000-0000-0000-000000000002";
  const LEITE_M = "ffffffff-1111-0000-0000-000000000001";
  const PICANHA_M = "ffffffff-1111-0000-0000-000000000002";

  const SP = "America/Sao_Paulo";
  const OUTUBRO = reportPeriod(2026, 9, SP);
  const JANELA = [OUTUBRO.historyFrom, OUTUBRO.to];

  // O driver de producao ja converte numeric e timestamptz (lib/db.ts); no
  // PGlite a conversao e feita aqui.
  const toPurchase = (row: Record<string, unknown>): ReportPurchase => ({
    id: String(row.id),
    store_key: String(row.store_key),
    store_name: String(row.store_name),
    purchased_at: new Date(row.purchased_at as string).toISOString(),
    total: Number(row.total),
    discount: Number(row.discount),
  });

  const toItem = (row: Record<string, unknown>): ReportItem => ({
    purchase_id: String(row.purchase_id),
    product_id: row.product_id === null ? null : String(row.product_id),
    name: String(row.name),
    unit: String(row.unit),
    quantity: Number(row.quantity),
    unit_price: row.unit_price === null ? null : Number(row.unit_price),
    total_price: row.total_price === null ? null : Number(row.total_price),
    purchased_at: new Date(row.purchased_at as string).toISOString(),
    store_key: String(row.store_key),
    store_name: String(row.store_name),
  });

  before(async () => {
    await db.exec(`
      insert into "user" (id, name, email) values
        ('user-rel-1', 'Henri Relatorio', 'rel1@example.com'),
        ('user-rel-2', 'Ana', 'rel2@example.com'),
        ('user-rel-3', 'Vizinho', 'rel3@example.com');

      insert into households (id, name, invite_code) values
        ('${CASA}', 'Casa do relatorio', 'REL001'),
        ('${VIZINHA}', 'Casa vizinha', 'REL002');

      insert into household_members (household_id, user_id, display_name, joined_at) values
        ('${CASA}', 'user-rel-1', null, '2026-01-01T00:00:00Z'),
        ('${CASA}', 'user-rel-2', 'Aninha', '2026-01-02T00:00:00Z'),
        ('${VIZINHA}', 'user-rel-3', 'Vizinho', '2026-01-03T00:00:00Z');

      insert into products (id, household_id, name, norm_name, unit) values
        ('${LEITE_M}',   '${CASA}', 'Leite',   'LEITE',   'UN'),
        ('${PICANHA_M}', '${CASA}', 'Picanha', 'PICANHA', 'KG');

      insert into purchases
        (id, household_id, store_name, store_cnpj, access_key,
         total_amount, discount, paid_amount, purchased_at)
      values
        ('ffffffff-2222-0000-0000-000000000001', '${CASA}', 'Mercado Barato', '111', 'M1', 105, 5, 100, '2026-10-03T15:00:00Z'),
        ('ffffffff-2222-0000-0000-000000000002', '${CASA}', 'Mercado Caro',   '222', 'M2', 200, null, 200, '2026-10-15T15:00:00Z'),
        -- 23h do dia 31 em Sao Paulo: UTC ja virou novembro
        ('ffffffff-2222-0000-0000-000000000003', '${CASA}', '  ', null, 'M3', 10, null, null, '2026-11-01T02:00:00Z'),
        -- 00h30 do dia 1 de novembro em Sao Paulo: fora do relatorio de outubro
        ('ffffffff-2222-0000-0000-000000000004', '${CASA}', 'Mercado Caro', '222', 'M4', 40, null, 40, '2026-11-01T03:30:00Z'),
        ('ffffffff-2222-0000-0000-000000000005', '${CASA}', 'Mercado Barato', '111', 'M5', 150, null, 150, '2026-09-09T15:00:00Z'),
        ('ffffffff-2222-0000-0000-000000000006', '${VIZINHA}', 'Mercado Barato', '111', 'V1', 77, null, 77, '2026-10-10T15:00:00Z');

      insert into purchase_items
        (purchase_id, household_id, product_id, raw_description,
         quantity, unit, unit_price, total_price, position)
      values
        ('ffffffff-2222-0000-0000-000000000001', '${CASA}', '${LEITE_M}',   'LEITE 1L',     6,   'UN', 4.00, 24.00, 0),
        -- sem produto ligado e sem total: exercita o left join e o coalesce
        ('ffffffff-2222-0000-0000-000000000001', '${CASA}', null,           'SACOLA PLAST', 2,   '',   0.10, null,  1),
        ('ffffffff-2222-0000-0000-000000000002', '${CASA}', '${PICANHA_M}', 'PICANHA KG',   1.2, 'KG', 80.00, 96.00, 0),
        ('ffffffff-2222-0000-0000-000000000002', '${CASA}', '${LEITE_M}',   'LEITE 1L',     2,   'UN', 5.00, 10.00, 1),
        ('ffffffff-2222-0000-0000-000000000004', '${CASA}', '${LEITE_M}',   'LEITE 1L',     1,   'UN', 9.00, 9.00, 0),
        ('ffffffff-2222-0000-0000-000000000005', '${CASA}', '${PICANHA_M}', 'PICANHA KG',   1,   'KG', 60.00, 60.00, 0),
        ('ffffffff-2222-0000-0000-000000000006', '${VIZINHA}', null,        'CAFE VIZINHO', 1,   'UN', 77.00, 77.00, 0);
    `);
  });

  test("a preferencia de receber o relatorio ja vem ligada", async () => {
    const { rows } = await db.query<{ monthly_report: boolean }>(REPORT_PREFERENCE, [
      CASA,
      "user-rel-1",
    ]);
    assert.equal(rows[0].monthly_report, true, "quem já era membro passa a receber");
  });

  test("REPORT_PURCHASES recorta pelo instante e cai para o total sem valor pago", async () => {
    const { rows } = await db.query<Record<string, unknown>>(REPORT_PURCHASES, [
      CASA,
      ...JANELA,
    ]);
    const purchases = rows.map(toPurchase);

    assert.deepEqual(
      purchases.map((row) => [row.store_name, row.total, row.discount]),
      [
        ["Mercado Barato", 150, 0],
        ["Mercado Barato", 100, 5],
        ["Mercado Caro", 200, 0],
        // nome em branco e sem CNPJ; sem valor pago, vale o total da nota
        ["Sem identificação", 10, 0],
      ],
    );
    assert.equal(purchases[1].store_key, "111", "o CNPJ é a chave do mercado");
    assert.equal(purchases[3].store_key, "");
  });

  test("REPORT_ITEMS traz linha sem produto com a descrição da nota", async () => {
    const { rows } = await db.query<Record<string, unknown>>(REPORT_ITEMS, [
      CASA,
      ...JANELA,
    ]);
    const items = rows.map(toItem);

    assert.equal(items.length, 5, "a compra de 1º de novembro fica de fora");

    const sacola = items.find((row) => row.name === "SACOLA PLAST")!;
    assert.equal(sacola.product_id, null);
    assert.equal(sacola.unit, "UN", "unidade em branco cai para UN");
    assert.equal(sacola.total_price, 0.2, "sem total, vale quantidade x preço");

    const picanha = items.find((row) => row.name === "Picanha")!;
    assert.equal(picanha.unit, "KG");
    assert.equal(picanha.store_name, "Mercado Barato", "a de setembro vem primeiro");
  });

  test("as consultas do relatorio nao enxergam a casa vizinha", async () => {
    const purchases = await db.query<{ id: string }>(REPORT_PURCHASES, [CASA, ...JANELA]);
    const items = await db.query<{ name: string }>(REPORT_ITEMS, [CASA, ...JANELA]);

    assert.ok(!purchases.rows.some((row) => row.id.endsWith("000000000006")));
    assert.ok(!items.rows.some((row) => row.name === "CAFE VIZINHO"));
  });

  test("o resultado das consultas alimenta o relatorio de report.ts", async () => {
    const purchases = await db.query<Record<string, unknown>>(REPORT_PURCHASES, [
      CASA,
      ...JANELA,
    ]);
    const items = await db.query<Record<string, unknown>>(REPORT_ITEMS, [CASA, ...JANELA]);

    const report = buildMonthlyReport(
      OUTUBRO,
      purchases.rows.map(toPurchase),
      items.rows.map(toItem),
    );

    assert.equal(report.total, 310, "100 + 200 + 10 da compra das 23h do dia 31");
    assert.equal(report.purchaseCount, 3);
    assert.equal(report.discount, 5);
    assert.equal(report.previousTotal, 150);
    assert.deepEqual(
      report.topSpend.map((row) => [row.name, row.total]),
      [
        ["Picanha", 96],
        ["Leite", 34],
        ["SACOLA PLAST", 0.2],
      ],
    );
    assert.equal(report.priciest[0].name, "Picanha");
    assert.deepEqual(
      report.increases.map((row) => row.name),
      ["Picanha"],
    );
    assert.equal(report.cheaper[0].cheapestStore, "Mercado Barato");
  });

  test("REPORT_RECIPIENTS lista quem recebe, com a casa e o nome de exibição", async () => {
    const { rows } = await db.query<{
      household_id: string;
      household_name: string;
      email: string;
      name: string;
    }>(REPORT_RECIPIENTS);

    const daCasa = rows.filter((row) => row.household_id === CASA);
    assert.deepEqual(
      daCasa.map((row) => [row.email, row.name, row.household_name]),
      [
        ["rel1@example.com", "Henri Relatorio", "Casa do relatorio"],
        ["rel2@example.com", "Aninha", "Casa do relatorio"],
      ],
    );
  });

  test("SET_REPORT_PREFERENCE desliga só para quem pediu", async () => {
    await db.query(SET_REPORT_PREFERENCE, [CASA, "user-rel-2", false]);

    const { rows } = await db.query<{ email: string }>(REPORT_RECIPIENTS);
    const emails = rows.map((row) => row.email);

    assert.ok(!emails.includes("rel2@example.com"));
    assert.ok(emails.includes("rel1@example.com"), "o outro morador continua recebendo");

    const pref = await db.query<{ monthly_report: boolean }>(REPORT_PREFERENCE, [
      CASA,
      "user-rel-2",
    ]);
    assert.equal(pref.rows[0].monthly_report, false);
  });

  test("SET_REPORT_PREFERENCE não alcança membro de outra casa", async () => {
    await db.query(SET_REPORT_PREFERENCE, [CASA, "user-rel-3", false]);

    const pref = await db.query<{ monthly_report: boolean }>(REPORT_PREFERENCE, [
      VIZINHA,
      "user-rel-3",
    ]);
    assert.equal(pref.rows[0].monthly_report, true);
  });

  test("CLAIM_REPORT_DELIVERY reserva o envio uma vez só por pessoa e mês", async () => {
    const claim = [CASA, "user-rel-1", "2026-10-01"];

    assert.equal((await db.query(CLAIM_REPORT_DELIVERY, claim)).rows.length, 1);
    assert.equal(
      (await db.query(CLAIM_REPORT_DELIVERY, claim)).rows.length,
      0,
      "a segunda rodada do agendador não pode mandar de novo",
    );

    // Outro mes e outra pessoa sao envios diferentes.
    assert.equal(
      (await db.query(CLAIM_REPORT_DELIVERY, [CASA, "user-rel-1", "2026-11-01"])).rows.length,
      1,
    );
    assert.equal(
      (await db.query(CLAIM_REPORT_DELIVERY, [CASA, "user-rel-2", "2026-10-01"])).rows.length,
      1,
    );
  });

  test("RELEASE_REPORT_DELIVERY devolve a reserva quando o envio falha", async () => {
    const claim = [CASA, "user-rel-1", "2026-10-01"];

    await db.query(RELEASE_REPORT_DELIVERY, claim);

    assert.equal(
      (await db.query(CLAIM_REPORT_DELIVERY, claim)).rows.length,
      1,
      "a próxima rodada tenta de novo",
    );
    assert.equal(
      (await db.query(CLAIM_REPORT_DELIVERY, [CASA, "user-rel-1", "2026-11-01"])).rows.length,
      0,
      "liberar outubro não mexe em novembro",
    );
  });
});
