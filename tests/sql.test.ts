import { test, before, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";

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
  PRODUCTS_WITH_STATS,
  INSERT_TRUSTED_DEVICE,
  PURCHASE_SUMMARIES,
  UPSERT_PRODUCT,
  UPSERT_USER_PIN,
  USER_BY_EMAIL,
  USER_PIN,
} from "../src/lib/sql.ts";

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
