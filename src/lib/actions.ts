"use server";

import { pgErrorCode, query, queryOne, transaction } from "./db";
import { normalizeName, toTitleCase } from "./normalize";
import {
  ADD_ITEM_BY_PRODUCT,
  ADD_PRODUCT_TO_LIST,
  ALIASES_FOR_HOUSEHOLD,
  CLEAR_BOUGHT_ITEMS,
  HOUSEHOLD_BY_INVITE_CODE,
  HOUSEHOLD_COUNT,
  INSERT_HOUSEHOLD,
  INSERT_MEMBER,
  PENDING_ITEMS,
  PRODUCTS_WITH_STATS,
  PRODUCT_BY_ID_IN_HOUSEHOLD,
  PRODUCT_BY_NORM,
  PURCHASE_BY_ACCESS_KEY,
  PURCHASE_BY_ID,
  PURCHASE_ITEMS,
  PURCHASE_SUMMARIES,
  UPSERT_PRODUCT,
} from "./sql";
import { getMembership, requireMembership, requireUser } from "./session";
import type { ItemResolution } from "./data";
import type { NfceReceipt } from "./nfce/parse";
import type {
  AppSnapshot,
  Household,
  ListItem,
  ListItemWithProduct,
  Product,
  ProductWithStats,
  Purchase,
  PurchaseItem,
  PurchaseSummary,
} from "./types";

/**
 * Toda a camada de dados.
 *
 * Cada acao resolve a casa a partir da sessao (`requireMembership`) e usa esse
 * id para filtrar — o cliente nunca informa em qual casa esta mexendo. E isso
 * que substitui o RLS que o Supabase aplicava dentro do banco.
 */

/* ---------------------------------------------------------------------------
 * Leitura
 * ------------------------------------------------------------------------- */

/** Estado inteiro da tela em uma ida ao banco. Usado na carga e no polling. */
export async function loadSnapshot(): Promise<AppSnapshot> {
  const membership = await getMembership();

  if (!membership) {
    const user = await requireUser().catch(() => null);
    return { user, household: null, products: [], pending: [] };
  }

  const { user, household } = membership;

  // A view devolve uma linha por produto mesmo sem compras (purchase_count 0),
  // entao as colunas de estatistica entram achatadas junto do produto.
  type ProductRow = Product & {
    last_purchased_at: string | null;
    first_purchased_at: string | null;
    purchase_count: number | null;
    avg_unit_price: number | null;
    last_unit_price: number | null;
    avg_interval_days: number | null;
  };

  const [products, pendingRows] = await Promise.all([
    query<ProductRow>(PRODUCTS_WITH_STATS, [household.id]),
    query<ListItem>(PENDING_ITEMS, [household.id]),
  ]);

  const withStats: ProductWithStats[] = products.map((row) => ({
    id: row.id,
    household_id: row.household_id,
    name: row.name,
    norm_name: row.norm_name,
    unit: row.unit,
    category: row.category,
    is_recurring: row.is_recurring,
    recurrence_days: row.recurrence_days,
    created_at: row.created_at,
    updated_at: row.updated_at,
    stats: row.purchase_count === null
      ? null
      : {
          product_id: row.id,
          household_id: row.household_id,
          last_purchased_at: row.last_purchased_at,
          first_purchased_at: row.first_purchased_at,
          purchase_count: row.purchase_count,
          avg_unit_price: row.avg_unit_price,
          last_unit_price: row.last_unit_price,
          avg_interval_days: row.avg_interval_days,
        },
  }));

  const byId = new Map(withStats.map((product) => [product.id, product]));

  const pending: ListItemWithProduct[] = pendingRows.map((item) => ({
    ...item,
    product: byId.get(item.product_id) ?? null,
  }));

  return { user, household, products: withStats, pending };
}

export async function listPurchases(limit = 100): Promise<PurchaseSummary[]> {
  const { household } = await requireMembership();

  return query<PurchaseSummary>(PURCHASE_SUMMARIES, [household.id, limit]);
}

export async function getPurchase(
  purchaseId: string,
): Promise<{ purchase: Purchase; items: PurchaseItem[] } | null> {
  const { household } = await requireMembership();

  const purchase = await queryOne<Purchase>(PURCHASE_BY_ID, [
    purchaseId,
    household.id,
  ]);
  if (!purchase) return null;

  const items = await query<PurchaseItem>(PURCHASE_ITEMS, [purchaseId]);

  return { purchase, items };
}

/** Apelidos ja conhecidos: descricao normalizada da nota -> produto. */
export async function getAliases(): Promise<Record<string, string>> {
  const { household } = await requireMembership();

  const rows = await query<{ raw_norm: string; product_id: string }>(
    ALIASES_FOR_HOUSEHOLD,
    [household.id],
  );

  return Object.fromEntries(rows.map((row) => [row.raw_norm, row.product_id]));
}

/* ---------------------------------------------------------------------------
 * Onboarding
 * ------------------------------------------------------------------------- */

function randomInviteCode(): string {
  // Sem 0/O/1/I: o codigo e ditado em voz alta ou digitado no celular.
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i += 1) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return code;
}

/** Ja existe alguma casa? Define se a tela inicial pode oferecer 'criar casa'. */
export async function anyHouseholdExists(): Promise<boolean> {
  await requireUser();
  const counted = await queryOne<{ n: number }>(HOUSEHOLD_COUNT);
  return (counted?.n ?? 0) > 0;
}

export async function createHousehold(
  name: string,
  displayName?: string,
): Promise<Household> {
  const user = await requireUser();

  const existing = await getMembership();
  if (existing) return existing.household;

  return transaction(async (client) => {
    let household: Household | null = null;

    // Colisao de codigo e improvavel, mas o unique index e quem decide.
    for (let attempt = 0; attempt < 5 && !household; attempt += 1) {
      try {
        const result = await client.query(INSERT_HOUSEHOLD, [
          name.trim() || "Nossa casa",
          randomInviteCode(),
        ]);
        household = result.rows[0] as Household;
      } catch (cause) {
        if (pgErrorCode(cause) !== "23505") throw cause;
      }
    }

    if (!household) throw new Error("Não consegui gerar um código de convite.");

    await client.query(INSERT_MEMBER, [
      household.id,
      user.id,
      displayName?.trim() || null,
    ]);

    return household;
  });
}

export async function joinHousehold(
  code: string,
  displayName?: string,
): Promise<Household> {
  const user = await requireUser();

  const household = await queryOne<Household>(HOUSEHOLD_BY_INVITE_CODE, [
    code.trim().toUpperCase(),
  ]);

  if (!household) throw new Error("Código de convite inválido.");

  await query(INSERT_MEMBER, [household.id, user.id, displayName?.trim() || null]);

  return household;
}

/* ---------------------------------------------------------------------------
 * Catalogo
 * ------------------------------------------------------------------------- */

/** Acha o produto pelo nome normalizado ou cria um novo. */
async function findOrCreateProduct(
  householdId: string,
  rawName: string,
  unit = "UN",
): Promise<Product> {
  const norm = normalizeName(rawName);
  if (!norm) throw new Error("Nome de produto vazio.");

  const existing = await queryOne<Product>(PRODUCT_BY_NORM, [householdId, norm]);
  if (existing) return existing;

  // on conflict resolve a corrida entre os dois celulares.
  const created = await queryOne<Product>(UPSERT_PRODUCT, [
    householdId,
    toTitleCase(rawName),
    norm,
    unit,
  ]);

  if (!created) throw new Error("Não consegui criar o produto.");
  return created;
}

export async function updateProduct(
  productId: string,
  patch: {
    name?: string;
    is_recurring?: boolean;
    recurrence_days?: number | null;
    category?: string | null;
    unit?: string;
  },
): Promise<void> {
  const { household } = await requireMembership();

  const sets: string[] = ["updated_at = now()"];
  const values: unknown[] = [];

  const push = (column: string, value: unknown) => {
    values.push(value);
    sets.push(`${column} = $${values.length}`);
  };

  if (patch.name !== undefined) {
    push("name", patch.name);
    push("norm_name", normalizeName(patch.name));
  }
  if (patch.is_recurring !== undefined) push("is_recurring", patch.is_recurring);
  if (patch.recurrence_days !== undefined) push("recurrence_days", patch.recurrence_days);
  if (patch.category !== undefined) push("category", patch.category);
  if (patch.unit !== undefined) push("unit", patch.unit);

  values.push(productId, household.id);

  await query(
    `update products set ${sets.join(", ")}
      where id = $${values.length - 1} and household_id = $${values.length}`,
    values,
  );
}

export async function deleteProduct(productId: string): Promise<void> {
  const { household } = await requireMembership();

  await query(`delete from products where id = $1 and household_id = $2`, [
    productId,
    household.id,
  ]);
}

/* ---------------------------------------------------------------------------
 * Lista
 * ------------------------------------------------------------------------- */

export async function addItemByName(
  rawName: string,
  quantity = 1,
  note?: string,
): Promise<void> {
  const { household, user } = await requireMembership();

  const product = await findOrCreateProduct(household.id, rawName);

  // O indice parcial garante um pendente por produto; conflito e no-op.
  await query(ADD_ITEM_BY_PRODUCT, [
    household.id,
    product.id,
    quantity,
    note?.trim() || null,
    user.id,
  ]);
}

export async function addProductToList(
  productId: string,
  quantity = 1,
): Promise<void> {
  const { household, user } = await requireMembership();

  await query(ADD_PRODUCT_TO_LIST, [household.id, productId, quantity, user.id]);
}

export async function markBought(itemId: string): Promise<void> {
  const { household } = await requireMembership();

  await query(
    `update list_items
        set status = 'bought', bought_at = now()
      where id = $1 and household_id = $2`,
    [itemId, household.id],
  );
}

export async function removeListItem(itemId: string): Promise<void> {
  const { household } = await requireMembership();

  await query(`delete from list_items where id = $1 and household_id = $2`, [
    itemId,
    household.id,
  ]);
}

/* ---------------------------------------------------------------------------
 * Importacao de uma nota fiscal
 * ------------------------------------------------------------------------- */

export type ImportResult = {
  purchaseId: string;
  itemsSaved: number;
  listItemsCleared: number;
};

/**
 * Grava a compra, liga cada item a um produto do catalogo, memoriza o apelido
 * (para a proxima nota casar sozinha) e baixa da lista o que foi comprado.
 *
 * Tudo numa transacao: uma nota entra inteira ou nao entra.
 */
export async function importPurchase(
  receipt: NfceReceipt,
  resolutions: ItemResolution[],
  sourceUrl: string | null,
): Promise<ImportResult> {
  const { household, user } = await requireMembership();

  const alreadyImported = receipt.accessKey
    ? await queryOne<{ id: string }>(PURCHASE_BY_ACCESS_KEY, [
        household.id,
        receipt.accessKey,
      ])
    : null;

  if (alreadyImported) throw new Error("Essa nota já foi importada antes.");

  // Os produtos sao resolvidos antes da transacao: findOrCreateProduct faz
  // upsert e nao precisa participar do rollback da compra.
  const resolved: { productId: string; index: number }[] = [];

  for (let index = 0; index < receipt.items.length; index += 1) {
    const resolution = resolutions[index] ?? { action: "skip" as const };
    if (resolution.action === "skip") continue;

    const product =
      resolution.action === "link"
        ? await queryOne<Product>(PRODUCT_BY_ID_IN_HOUSEHOLD, [
            resolution.productId,
            household.id,
          ])
        : await findOrCreateProduct(
            household.id,
            resolution.name,
            receipt.items[index].unit,
          );

    if (product) resolved.push({ productId: product.id, index });
  }

  return transaction(async (client) => {
    const purchaseResult = await client.query(
      `insert into purchases
         (household_id, store_name, store_cnpj, access_key, total_amount,
          discount, paid_amount, purchased_at, source, source_url, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,'nfce',$9,$10)
       returning id`,
      [
        household.id,
        receipt.storeName,
        receipt.storeCnpj,
        receipt.accessKey,
        receipt.totalAmount,
        receipt.discount,
        receipt.paidAmount,
        receipt.purchasedAt ?? new Date().toISOString(),
        sourceUrl,
        user.id,
      ],
    );

    const purchaseId = purchaseResult.rows[0].id as string;
    const touched = new Set<string>();

    for (const { productId, index } of resolved) {
      const item = receipt.items[index];
      touched.add(productId);

      await client.query(
        `insert into purchase_items
           (purchase_id, household_id, product_id, raw_description, raw_code,
            quantity, unit, unit_price, total_price, position)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          purchaseId,
          household.id,
          productId,
          item.description,
          item.code,
          item.quantity,
          item.unit,
          item.unitPrice,
          item.totalPrice,
          item.position,
        ],
      );

      // Memoriza a traducao "descricao da nota" -> produto.
      await client.query(
        `insert into product_aliases (household_id, product_id, raw_norm, sefaz_code)
         values ($1,$2,$3,$4)
         on conflict (household_id, raw_norm)
         do update set product_id = excluded.product_id`,
        [household.id, productId, normalizeName(item.description), item.code],
      );
    }

    // Tudo que estava na lista e apareceu na nota sai da lista automaticamente.
    let listItemsCleared = 0;
    if (touched.size > 0) {
      const cleared = await client.query(CLEAR_BOUGHT_ITEMS, [
          receipt.purchasedAt ?? new Date().toISOString(),
          purchaseId,
          household.id,
          [...touched],
        ],
      );
      listItemsCleared = cleared.rowCount ?? 0;
    }

    return { purchaseId, itemsSaved: resolved.length, listItemsCleared };
  });
}
