/**
 * As consultas nao triviais do app, isoladas das Server Actions.
 *
 * Ficam aqui por dois motivos: actions.ts é "use server" e não pode ser
 * importado por um teste, e assim o teste em tests/sql.test.ts executa
 * exatamente este SQL contra um Postgres real (PGlite) — sem cópia que
 * envelhece em paralelo.
 */

/** $1 = user_id */
export const HOUSEHOLD_FOR_USER = `
  select h.*
    from households h
    join household_members m on m.household_id = h.id
   where m.user_id = $1
   order by m.joined_at
   limit 1
`;

/** $1 = household_id. Produtos com as estatisticas achatadas na mesma linha. */
export const PRODUCTS_WITH_STATS = `
  select p.*,
         s.last_purchased_at, s.first_purchased_at, s.purchase_count,
         s.avg_unit_price, s.last_unit_price, s.avg_interval_days
    from products p
    left join product_stats s on s.product_id = p.id
   where p.household_id = $1
   order by p.name
`;

/** $1 = household_id */
export const PENDING_ITEMS = `
  select * from list_items
   where household_id = $1 and status = 'pending'
   order by created_at
`;

/** $1 = household_id, $2 = limit */
export const PURCHASE_SUMMARIES = `
  select p.id, p.store_name, p.purchased_at, p.paid_amount, p.total_amount,
         count(i.id)::int as item_count
    from purchases p
    left join purchase_items i on i.purchase_id = p.id
   where p.household_id = $1
   group by p.id
   order by p.purchased_at desc
   limit $2
`;

/** $1 = purchase_id, $2 = household_id */
export const PURCHASE_BY_ID = `
  select * from purchases where id = $1 and household_id = $2
`;

/** $1 = purchase_id */
export const PURCHASE_ITEMS = `
  select * from purchase_items where purchase_id = $1 order by position
`;

/** $1 = household_id */
export const ALIASES_FOR_HOUSEHOLD = `
  select raw_norm, product_id from product_aliases where household_id = $1
`;

/** $1 = household_id, $2 = norm_name */
export const PRODUCT_BY_NORM = `
  select * from products where household_id = $1 and norm_name = $2
`;

/**
 * $1 = household_id, $2 = name, $3 = norm_name, $4 = unit
 * O do update é um no-op que serve só para o RETURNING devolver a linha
 * existente quando o outro celular criou o produto primeiro.
 */
export const UPSERT_PRODUCT = `
  insert into products (household_id, name, norm_name, unit)
  values ($1, $2, $3, $4)
  on conflict (household_id, norm_name) do update set norm_name = excluded.norm_name
  returning *
`;

/**
 * $1 = household_id, $2 = product_id, $3 = quantity, $4 = added_by
 * O `where exists` impede adicionar produto de outra casa; o índice parcial
 * impede duplicar um pendente.
 */
export const ADD_PRODUCT_TO_LIST = `
  insert into list_items (household_id, product_id, quantity, added_by)
  select $1, $2, $3, $4
   where exists (select 1 from products where id = $2 and household_id = $1)
  on conflict do nothing
`;

/** $1 = household_id, $2 = product_id, $3 = quantity, $4 = note, $5 = added_by */
export const ADD_ITEM_BY_PRODUCT = `
  insert into list_items (household_id, product_id, quantity, note, added_by)
  values ($1, $2, $3, $4, $5)
  on conflict do nothing
`;

/** $1 = bought_at, $2 = purchase_id, $3 = household_id, $4 = product_ids[] */
export const CLEAR_BOUGHT_ITEMS = `
  update list_items
     set status = 'bought', bought_at = $1, purchase_id = $2
   where household_id = $3 and status = 'pending'
     and product_id = any($4::uuid[])
  returning id
`;

/** $1 = household_id, $2 = access_key */
export const PURCHASE_BY_ACCESS_KEY = `
  select id from purchases where household_id = $1 and access_key = $2
`;

/** $1 = product_id, $2 = household_id */
export const PRODUCT_BY_ID_IN_HOUSEHOLD = `
  select * from products where id = $1 and household_id = $2
`;

/** $1 = name, $2 = invite_code */
export const INSERT_HOUSEHOLD = `
  insert into households (name, invite_code) values ($1, $2) returning *
`;

/** $1 = household_id, $2 = user_id, $3 = display_name */
export const INSERT_MEMBER = `
  insert into household_members (household_id, user_id, display_name)
  values ($1, $2, $3)
  on conflict (household_id, user_id) do nothing
`;

/** $1 = invite_code (ja em maiusculas) */
export const HOUSEHOLD_BY_INVITE_CODE = `
  select * from households where invite_code = $1
`;
