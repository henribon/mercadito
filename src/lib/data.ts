import type { SupabaseClient } from "@supabase/supabase-js";

import { normalizeName, toTitleCase } from "./normalize";
import type {
  Household,
  ListItem,
  ListItemWithProduct,
  Product,
  ProductStats,
  ProductWithStats,
  Purchase,
  PurchaseItem,
  Suggestion,
} from "./types";
import type { NfceReceipt } from "./nfce/parse";

const DAY_MS = 86_400_000;

/* ---------------------------------------------------------------------------
 * Leitura
 * ------------------------------------------------------------------------- */

export async function fetchHousehold(
  supabase: SupabaseClient,
): Promise<Household | null> {
  const { data, error } = await supabase
    .from("household_members")
    .select("household:households(*)")
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  if (!data?.household) return null;

  // O join volta como objeto quando a FK e unica.
  return data.household as unknown as Household;
}

export async function fetchProducts(
  supabase: SupabaseClient,
  householdId: string,
): Promise<ProductWithStats[]> {
  const [{ data: products, error: pErr }, { data: stats, error: sErr }] =
    await Promise.all([
      supabase
        .from("products")
        .select("*")
        .eq("household_id", householdId)
        .order("name"),
      supabase.from("product_stats").select("*").eq("household_id", householdId),
    ]);

  if (pErr) throw pErr;
  if (sErr) throw sErr;

  const byProduct = new Map<string, ProductStats>(
    (stats ?? []).map((row) => [row.product_id as string, row as ProductStats]),
  );

  return (products ?? []).map((product) => ({
    ...(product as Product),
    stats: byProduct.get(product.id as string) ?? null,
  }));
}

export async function fetchPendingItems(
  supabase: SupabaseClient,
  householdId: string,
  products: ProductWithStats[],
): Promise<ListItemWithProduct[]> {
  const { data, error } = await supabase
    .from("list_items")
    .select("*")
    .eq("household_id", householdId)
    .eq("status", "pending")
    .order("created_at", { ascending: true });

  if (error) throw error;

  const byId = new Map(products.map((product) => [product.id, product]));

  return (data ?? []).map((item) => ({
    ...(item as ListItem),
    product: byId.get((item as ListItem).product_id) ?? null,
  }));
}

export async function fetchPurchases(
  supabase: SupabaseClient,
  householdId: string,
  limit = 50,
): Promise<Purchase[]> {
  const { data, error } = await supabase
    .from("purchases")
    .select("*")
    .eq("household_id", householdId)
    .order("purchased_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return (data ?? []) as Purchase[];
}

export async function fetchPurchaseItems(
  supabase: SupabaseClient,
  purchaseId: string,
): Promise<PurchaseItem[]> {
  const { data, error } = await supabase
    .from("purchase_items")
    .select("*")
    .eq("purchase_id", purchaseId)
    .order("position");

  if (error) throw error;
  return (data ?? []) as PurchaseItem[];
}

/* ---------------------------------------------------------------------------
 * Recorrencia: o lembrete de "faz X dias que nao compramos"
 * ------------------------------------------------------------------------- */

/** Intervalo esperado entre compras: override manual, senao a media real. */
export function expectedInterval(product: ProductWithStats): number | null {
  if (product.recurrence_days && product.recurrence_days > 0) {
    return product.recurrence_days;
  }
  const avg = product.stats?.avg_interval_days;
  return avg && avg > 0 ? avg : null;
}

export function daysSinceLastPurchase(product: ProductWithStats): number | null {
  const last = product.stats?.last_purchased_at;
  if (!last) return null;

  return Math.floor((Date.now() - new Date(last).getTime()) / DAY_MS);
}

/**
 * Produtos marcados como recorrentes cuja hora de recomprar chegou (ou passou),
 * ignorando os que ja estao na lista.
 *
 * "due-soon" comeca a 80% do intervalo: da tempo de incluir na proxima ida ao
 * mercado em vez de avisar so quando ja acabou.
 */
export function buildSuggestions(
  products: ProductWithStats[],
  pendingProductIds: Set<string>,
): Suggestion[] {
  const suggestions: Suggestion[] = [];

  for (const product of products) {
    if (!product.is_recurring) continue;
    if (pendingProductIds.has(product.id)) continue;

    const intervalDays = expectedInterval(product);
    const daysSince = daysSinceLastPurchase(product);
    if (intervalDays === null || daysSince === null) continue;

    if (daysSince >= intervalDays) {
      suggestions.push({ product, reason: "overdue", daysSince, intervalDays });
    } else if (daysSince >= intervalDays * 0.8) {
      suggestions.push({ product, reason: "due-soon", daysSince, intervalDays });
    }
  }

  // Mais atrasado primeiro.
  return suggestions.sort(
    (a, b) => b.daysSince / b.intervalDays - a.daysSince / a.intervalDays,
  );
}

/** Sugestao de periodicidade ao marcar um produto como recorrente. */
export function suggestedRecurrenceDays(product: ProductWithStats): number {
  const avg = product.stats?.avg_interval_days;
  if (avg && avg > 0) return Math.max(1, Math.round(avg));
  return 30;
}

/* ---------------------------------------------------------------------------
 * Escrita
 * ------------------------------------------------------------------------- */

/** Acha o produto pelo nome normalizado ou cria um novo. */
export async function findOrCreateProduct(
  supabase: SupabaseClient,
  householdId: string,
  rawName: string,
  unit = "UN",
): Promise<Product> {
  const norm = normalizeName(rawName);
  if (!norm) throw new Error("Nome de produto vazio.");

  const { data: existing, error: findError } = await supabase
    .from("products")
    .select("*")
    .eq("household_id", householdId)
    .eq("norm_name", norm)
    .maybeSingle();

  if (findError) throw findError;
  if (existing) return existing as Product;

  const { data: created, error: insertError } = await supabase
    .from("products")
    .insert({
      household_id: householdId,
      name: toTitleCase(rawName),
      norm_name: norm,
      unit,
    })
    .select()
    .single();

  // Corrida entre os dois celulares: se o outro criou primeiro, busca de novo.
  if (insertError?.code === "23505") {
    const { data: raced } = await supabase
      .from("products")
      .select("*")
      .eq("household_id", householdId)
      .eq("norm_name", norm)
      .single();
    if (raced) return raced as Product;
  }
  if (insertError) throw insertError;

  return created as Product;
}

export async function addToList(
  supabase: SupabaseClient,
  householdId: string,
  userId: string,
  rawName: string,
  quantity = 1,
  note?: string,
): Promise<void> {
  const product = await findOrCreateProduct(supabase, householdId, rawName);

  const { error } = await supabase.from("list_items").insert({
    household_id: householdId,
    product_id: product.id,
    quantity,
    note: note?.trim() || null,
    added_by: userId,
  });

  // Ja estava pendente: o indice unico barra a duplicata, e tudo bem.
  if (error && error.code !== "23505") throw error;
}

export async function addProductToList(
  supabase: SupabaseClient,
  householdId: string,
  userId: string,
  productId: string,
  quantity = 1,
): Promise<void> {
  const { error } = await supabase.from("list_items").insert({
    household_id: householdId,
    product_id: productId,
    quantity,
    added_by: userId,
  });

  if (error && error.code !== "23505") throw error;
}

export async function markBought(
  supabase: SupabaseClient,
  itemId: string,
  purchaseId: string | null = null,
): Promise<void> {
  const { error } = await supabase
    .from("list_items")
    .update({
      status: "bought",
      bought_at: new Date().toISOString(),
      purchase_id: purchaseId,
    })
    .eq("id", itemId);

  if (error) throw error;
}

export async function undoBought(
  supabase: SupabaseClient,
  itemId: string,
): Promise<void> {
  const { error } = await supabase
    .from("list_items")
    .update({ status: "pending", bought_at: null, purchase_id: null })
    .eq("id", itemId);

  if (error) throw error;
}

export async function removeListItem(
  supabase: SupabaseClient,
  itemId: string,
): Promise<void> {
  const { error } = await supabase.from("list_items").delete().eq("id", itemId);
  if (error) throw error;
}

export async function updateProduct(
  supabase: SupabaseClient,
  productId: string,
  patch: Partial<Pick<Product, "name" | "is_recurring" | "recurrence_days" | "category" | "unit">>,
): Promise<void> {
  const payload: Record<string, unknown> = {
    ...patch,
    updated_at: new Date().toISOString(),
  };
  if (typeof patch.name === "string") {
    payload.norm_name = normalizeName(patch.name);
  }

  const { error } = await supabase.from("products").update(payload).eq("id", productId);
  if (error) throw error;
}

export async function deleteProduct(
  supabase: SupabaseClient,
  productId: string,
): Promise<void> {
  const { error } = await supabase.from("products").delete().eq("id", productId);
  if (error) throw error;
}

/* ---------------------------------------------------------------------------
 * Importacao de uma nota fiscal
 * ------------------------------------------------------------------------- */

/** O que fazer com cada linha da nota, decidido na tela de conferencia. */
export type ItemResolution =
  | { action: "link"; productId: string }
  | { action: "create"; name: string }
  | { action: "skip" };

export type ImportResult = {
  purchaseId: string;
  itemsSaved: number;
  listItemsCleared: number;
};

/**
 * Grava a compra, liga cada item a um produto do catalogo, memoriza o apelido
 * (para a proxima nota casar sozinha) e baixa da lista o que foi comprado.
 */
export async function importPurchase(
  supabase: SupabaseClient,
  householdId: string,
  userId: string,
  receipt: NfceReceipt,
  resolutions: ItemResolution[],
  sourceUrl: string | null,
): Promise<ImportResult> {
  const { data: purchase, error: purchaseError } = await supabase
    .from("purchases")
    .insert({
      household_id: householdId,
      store_name: receipt.storeName,
      store_cnpj: receipt.storeCnpj,
      access_key: receipt.accessKey,
      total_amount: receipt.totalAmount,
      discount: receipt.discount,
      paid_amount: receipt.paidAmount,
      purchased_at: receipt.purchasedAt ?? new Date().toISOString(),
      source: "nfce",
      source_url: sourceUrl,
      created_by: userId,
    })
    .select()
    .single();

  if (purchaseError?.code === "23505") {
    throw new Error("Essa nota ja foi importada antes.");
  }
  if (purchaseError) throw purchaseError;

  const purchaseId = (purchase as Purchase).id;
  const rows: Record<string, unknown>[] = [];
  const touchedProductIds = new Set<string>();

  for (let index = 0; index < receipt.items.length; index += 1) {
    const item = receipt.items[index];
    const resolution = resolutions[index] ?? { action: "skip" as const };
    if (resolution.action === "skip") continue;

    const product =
      resolution.action === "link"
        ? { id: resolution.productId }
        : await findOrCreateProduct(supabase, householdId, resolution.name, item.unit);

    touchedProductIds.add(product.id);

    // Memoriza a traducao "descricao da nota" -> produto.
    await supabase.from("product_aliases").upsert(
      {
        household_id: householdId,
        product_id: product.id,
        raw_norm: normalizeName(item.description),
        sefaz_code: item.code,
      },
      { onConflict: "household_id,raw_norm" },
    );

    rows.push({
      purchase_id: purchaseId,
      household_id: householdId,
      product_id: product.id,
      raw_description: item.description,
      raw_code: item.code,
      quantity: item.quantity,
      unit: item.unit,
      unit_price: item.unitPrice,
      total_price: item.totalPrice,
      position: item.position,
    });
  }

  if (rows.length > 0) {
    const { error } = await supabase.from("purchase_items").insert(rows);
    if (error) throw error;
  }

  // Tudo que estava na lista e apareceu na nota sai da lista automaticamente.
  let listItemsCleared = 0;
  if (touchedProductIds.size > 0) {
    const { data: cleared, error } = await supabase
      .from("list_items")
      .update({
        status: "bought",
        bought_at: receipt.purchasedAt ?? new Date().toISOString(),
        purchase_id: purchaseId,
      })
      .eq("household_id", householdId)
      .eq("status", "pending")
      .in("product_id", [...touchedProductIds])
      .select("id");

    if (error) throw error;
    listItemsCleared = cleared?.length ?? 0;
  }

  return { purchaseId, itemsSaved: rows.length, listItemsCleared };
}

/** Apelidos ja conhecidos, para casar itens da nota sem perguntar nada. */
export async function fetchAliases(
  supabase: SupabaseClient,
  householdId: string,
): Promise<Map<string, string>> {
  const { data, error } = await supabase
    .from("product_aliases")
    .select("raw_norm, product_id")
    .eq("household_id", householdId);

  if (error) throw error;

  return new Map((data ?? []).map((row) => [row.raw_norm as string, row.product_id as string]));
}
