export type Household = {
  id: string;
  name: string;
  invite_code: string;
  created_at: string;
};

export type HouseholdMember = {
  household_id: string;
  user_id: string;
  display_name: string | null;
  joined_at: string;
};

export type Product = {
  id: string;
  household_id: string;
  name: string;
  norm_name: string;
  unit: string;
  category: string | null;
  is_recurring: boolean;
  recurrence_days: number | null;
  created_at: string;
  updated_at: string;
};

export type ProductStats = {
  product_id: string;
  household_id: string;
  last_purchased_at: string | null;
  first_purchased_at: string | null;
  purchase_count: number;
  avg_unit_price: number | null;
  last_unit_price: number | null;
  avg_interval_days: number | null;
};

/** Produto ja com o historico agregado: o que a UI realmente consome. */
export type ProductWithStats = Product & {
  stats: ProductStats | null;
};

export type ListItem = {
  id: string;
  household_id: string;
  product_id: string;
  quantity: number;
  note: string | null;
  status: "pending" | "bought" | "archived";
  added_by: string | null;
  created_at: string;
  bought_at: string | null;
  purchase_id: string | null;
};

export type ListItemWithProduct = ListItem & {
  product: ProductWithStats | null;
};

export type Purchase = {
  id: string;
  household_id: string;
  store_name: string | null;
  store_cnpj: string | null;
  access_key: string | null;
  total_amount: number | null;
  discount: number | null;
  paid_amount: number | null;
  purchased_at: string;
  source: "nfce" | "manual";
  source_url: string | null;
  created_by: string | null;
  created_at: string;
};

export type PurchaseItem = {
  id: string;
  purchase_id: string;
  household_id: string;
  product_id: string | null;
  raw_description: string;
  raw_code: string | null;
  quantity: number;
  unit: string | null;
  unit_price: number | null;
  total_price: number | null;
  position: number;
};

/**
 * Por que um produto aparece na secao de sugestoes da lista.
 * `overdue` = passou do intervalo esperado; `due-soon` = esta chegando a hora.
 */
export type SuggestionReason = "overdue" | "due-soon";

export type Suggestion = {
  product: ProductWithStats;
  reason: SuggestionReason;
  /** Dias desde a ultima compra. */
  daysSince: number;
  /** Intervalo considerado (manual ou media do historico). */
  intervalDays: number;
};

/** Usuario da sessao, na forma que a UI consome. */
export type AppUser = {
  id: string;
  email: string;
  name: string | null;
};

/** Estado completo da aplicacao, carregado numa unica ida ao banco. */
export type AppSnapshot = {
  user: AppUser | null;
  household: Household | null;
  products: ProductWithStats[];
  pending: ListItemWithProduct[];
};

/** Linha da tela de historico: compra com a contagem de itens ja agregada. */
export type PurchaseSummary = {
  id: string;
  store_name: string | null;
  purchased_at: string;
  paid_amount: number | null;
  total_amount: number | null;
  item_count: number;
};
