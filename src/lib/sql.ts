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

/** $1 = email (comparado sem diferenciar maiusculas) */
export const USER_BY_EMAIL = `
  select id from "user" where lower(email) = lower($1) limit 1
`;

/** Quantas casas existem — zero significa que o app ainda nao foi usado. */
export const HOUSEHOLD_COUNT = `
  select count(*)::int as n from households
`;

/* ---------------------------------------------------------------------------
 * Codigo de 4 digitos e aparelhos confiaveis
 * ------------------------------------------------------------------------- */

/** $1 = user_id, $2 = pin_hash. Trocar o codigo e o mesmo que criar. */
export const UPSERT_USER_PIN = `
  insert into user_pins (user_id, pin_hash)
  values ($1, $2)
  on conflict (user_id) do update
    set pin_hash = excluded.pin_hash, updated_at = now()
`;

/** $1 = user_id */
export const USER_PIN = `
  select pin_hash from user_pins where user_id = $1
`;

/** $1 = user_id */
export const DELETE_USER_PIN = `
  delete from user_pins where user_id = $1
`;

/**
 * $1 = user_id, $2 = token_hash
 * O conflito acontece quando o mesmo aparelho e reconfiado: zera as tentativas
 * em vez de deixar uma linha orfa para tras.
 */
export const INSERT_TRUSTED_DEVICE = `
  insert into trusted_devices (user_id, token_hash)
  values ($1, $2)
  on conflict (token_hash) do update
    set user_id = excluded.user_id, failed_count = 0, last_used_at = now()
`;

/**
 * $1 = token_hash. Traz o dono e o codigo dele na mesma ida ao banco — o login
 * precisa dos dois para decidir.
 */
export const DEVICE_BY_TOKEN = `
  select d.id, d.user_id, d.failed_count,
         u.name as user_name, u.email as user_email,
         p.pin_hash
    from trusted_devices d
    join "user" u on u.id = d.user_id
    left join user_pins p on p.user_id = d.user_id
   where d.token_hash = $1
`;

/** $1 = token_hash, $2 = user_id. Este navegador ja e confiavel para o dono? */
export const DEVICE_IS_TRUSTED = `
  select 1 as ok from trusted_devices where token_hash = $1 and user_id = $2
`;

/** $1 = device_id. Devolve o total ja incrementado. */
export const DEVICE_FAILED = `
  update trusted_devices set failed_count = failed_count + 1
   where id = $1
  returning failed_count
`;

/** $1 = device_id */
export const DEVICE_USED = `
  update trusted_devices set failed_count = 0, last_used_at = now()
   where id = $1
`;

/** $1 = device_id */
export const DELETE_DEVICE = `
  delete from trusted_devices where id = $1
`;

/** $1 = token_hash */
export const DELETE_DEVICE_BY_TOKEN = `
  delete from trusted_devices where token_hash = $1
`;

/** $1 = user_id */
export const DELETE_DEVICES_FOR_USER = `
  delete from trusted_devices where user_id = $1
`;

/* ---------------------------------------------------------------------------
 * Senha (e-mail + senha, em qualquer aparelho)
 * ------------------------------------------------------------------------- */

/**
 * $1 = user_id, $2 = password_hash
 * Trocar a senha e o mesmo que criar — e quem troca ja provou quem e, entao as
 * tentativas erradas acumuladas e a tranca saem junto.
 */
export const UPSERT_USER_PASSWORD = `
  insert into user_passwords (user_id, password_hash)
  values ($1, $2)
  on conflict (user_id) do update
    set password_hash = excluded.password_hash,
        failed_count = 0, locked_until = null, updated_at = now()
`;

/** $1 = user_id */
export const USER_HAS_PASSWORD = `
  select 1 as ok from user_passwords where user_id = $1
`;

/** $1 = user_id */
export const DELETE_USER_PASSWORD = `
  delete from user_passwords where user_id = $1
`;

/** $1 = email, ja em minusculas. So devolve quem criou senha. */
export const PASSWORD_BY_EMAIL = `
  select p.user_id, p.password_hash, p.locked_until
    from user_passwords p
    join "user" u on u.id = p.user_id
   where lower(u.email) = $1
`;

/**
 * $1 = user_id, $2 = limite de erros, $3 = minutos de tranca
 *
 * O contador nao zera quando a tranca vence: depois do primeiro bloqueio, cada
 * erro novo tranca de novo na hora. So acertar a senha (ou troca-la) zera.
 */
export const PASSWORD_FAILED = `
  update user_passwords
     set failed_count = failed_count + 1,
         locked_until = case
           when failed_count + 1 >= $2::int then now() + make_interval(mins => $3::int)
           else locked_until
         end
   where user_id = $1
  returning failed_count, locked_until
`;

/** $1 = user_id */
export const PASSWORD_USED = `
  update user_passwords set failed_count = 0, locked_until = null
   where user_id = $1
`;

/* ---------------------------------------------------------------------------
 * Resumo de gastos
 *
 * As janelas de tempo chegam prontas do cliente ($2 e $3, ISO). O servidor roda
 * em UTC e o celular nao: se o mes fosse recortado aqui, uma compra das 22h do
 * dia 31 cairia no mes seguinte. Quem sabe onde o mes comeca e o aparelho de
 * quem esta olhando.
 * ------------------------------------------------------------------------- */

/** $1 = household_id, $2 = inicio, $3 = fim (exclusivo) */
export const SPEND_TOTAL = `
  select count(*)::int as purchase_count,
         coalesce(sum(coalesce(p.paid_amount, p.total_amount, 0)), 0) as total
    from purchases p
   where p.household_id = $1
     and p.purchased_at >= $2 and p.purchased_at < $3
`;

/**
 * $1 = household_id, $2 = inicio, $3 = fim (exclusivo)
 *
 * A chave do mercado e o CNPJ; o nome so entra quando a nota veio sem ele. Duas
 * lojas da mesma rede tem CNPJs diferentes e sao mercados diferentes de
 * proposito — o preco e a distancia sao de cada loja, nao da bandeira.
 */
export const SPEND_BY_STORE = `
  select coalesce(p.store_cnpj, upper(coalesce(btrim(p.store_name), ''))) as store_key,
         min(coalesce(nullif(btrim(p.store_name), ''), 'Sem identificação')) as store_name,
         count(*)::int as purchase_count,
         coalesce(sum(coalesce(p.paid_amount, p.total_amount, 0)), 0) as total
    from purchases p
   where p.household_id = $1
     and p.purchased_at >= $2 and p.purchased_at < $3
   group by 1
   order by total desc, purchase_count desc
`;

/**
 * $1 = household_id, $2 = desde, $3 = limite
 *
 * `having > 1` porque a pergunta e sobre reincidencia: um produto comprado uma
 * vez so nao diz nada sobre habito. Conta compras distintas, nao linhas — duas
 * caixas de leite na mesma nota continuam sendo uma ida ao mercado.
 */
export const TOP_REPEAT_PRODUCTS = `
  select pr.id   as product_id,
         pr.name as product_name,
         pr.unit as unit,
         count(distinct pu.id)::int as purchase_count,
         coalesce(sum(i.quantity), 0)    as total_quantity,
         coalesce(sum(i.total_price), 0) as total_spent,
         round(avg(i.unit_price)::numeric, 2) as avg_unit_price,
         max(pu.purchased_at) as last_purchased_at
    from purchase_items i
    join purchases pu on pu.id = i.purchase_id
    join products  pr on pr.id = i.product_id
   where pu.household_id = $1
     and pu.purchased_at >= $2
   group by pr.id, pr.name, pr.unit
  having count(distinct pu.id) > 1
   order by purchase_count desc, total_spent desc
   limit $3
`;

/**
 * $1 = household_id, $2 = desde
 *
 * Preco medio de cada produto em cada mercado. A comparacao em si (quem e mais
 * barato, em quantos produtos) fica em `data.ts`, para ser testada sem banco.
 */
export const PRICE_BY_STORE = `
  select pr.id   as product_id,
         pr.name as product_name,
         coalesce(pu.store_cnpj, upper(coalesce(btrim(pu.store_name), ''))) as store_key,
         min(coalesce(nullif(btrim(pu.store_name), ''), 'Sem identificação')) as store_name,
         round(avg(i.unit_price)::numeric, 4) as avg_unit_price,
         count(distinct pu.id)::int as purchase_count
    from purchase_items i
    join purchases pu on pu.id = i.purchase_id
    join products  pr on pr.id = i.product_id
   where pu.household_id = $1
     and pu.purchased_at >= $2
     and i.unit_price is not null
     and i.unit_price > 0
   group by pr.id, pr.name, 3
   order by pr.name, avg_unit_price
`;

/* ---------------------------------------------------------------------------
 * Relatorio mensal por e-mail
 *
 * As duas consultas trazem as linhas cruas de um ano e a conta e feita em
 * report.ts: metade do relatorio depende do dia *local* da compra, e isso e
 * mais facil de acertar (e de testar) fora do SQL.
 * ------------------------------------------------------------------------- */

/** $1 = household_id, $2 = inicio do historico, $3 = fim (exclusivo) */
export const REPORT_PURCHASES = `
  select p.id,
         coalesce(p.store_cnpj, upper(coalesce(btrim(p.store_name), ''))) as store_key,
         coalesce(nullif(btrim(p.store_name), ''), 'Sem identificação') as store_name,
         p.purchased_at,
         coalesce(p.paid_amount, p.total_amount, 0) as total,
         coalesce(p.discount, 0) as discount
    from purchases p
   where p.household_id = $1
     and p.purchased_at >= $2 and p.purchased_at < $3
   order by p.purchased_at, p.id
`;

/**
 * $1 = household_id, $2 = inicio do historico, $3 = fim (exclusivo)
 *
 * `left join` em products de proposito: linha de nota que ninguem ligou a um
 * produto do catalogo ainda e dinheiro gasto, e entra com a descricao da nota.
 */
export const REPORT_ITEMS = `
  select i.purchase_id,
         i.product_id,
         coalesce(pr.name, i.raw_description) as name,
         coalesce(nullif(btrim(i.unit), ''), pr.unit, 'UN') as unit,
         i.quantity,
         i.unit_price,
         coalesce(i.total_price, round((i.quantity * i.unit_price)::numeric, 2)) as total_price,
         pu.purchased_at,
         coalesce(pu.store_cnpj, upper(coalesce(btrim(pu.store_name), ''))) as store_key,
         coalesce(nullif(btrim(pu.store_name), ''), 'Sem identificação') as store_name
    from purchase_items i
    join purchases pu on pu.id = i.purchase_id
    left join products pr on pr.id = i.product_id
   where pu.household_id = $1
     and pu.purchased_at >= $2 and pu.purchased_at < $3
   order by pu.purchased_at, pu.id, i.position
`;

/**
 * Todo mundo que quer o relatorio, com a casa de cada um.
 *
 * O destino e o e-mail escolhido na aba Conta; sem escolha, o de login.
 */
export const REPORT_RECIPIENTS = `
  select m.household_id,
         h.name  as household_name,
         u.id    as user_id,
         coalesce(nullif(btrim(m.report_email), ''), u.email) as email,
         coalesce(nullif(btrim(m.display_name), ''), u.name) as name
    from household_members m
    join households h on h.id = m.household_id
    join "user" u on u.id = m.user_id
   where m.monthly_report
   order by m.household_id, m.joined_at
`;

/**
 * $1 = household_id, $2 = user_id, $3 = mes (primeiro dia, yyyy-mm-dd)
 *
 * Reserva o envio *antes* de mandar o e-mail: se o agendador disparar duas
 * vezes ao mesmo tempo, so um dos dois recebe a linha de volta e envia.
 */
export const CLAIM_REPORT_DELIVERY = `
  insert into report_deliveries (household_id, user_id, month)
  values ($1, $2, $3::date)
  on conflict do nothing
  returning sent_at
`;

/** $1 = household_id, $2 = user_id, $3 = mes. O envio falhou: libera para a proxima tentativa. */
export const RELEASE_REPORT_DELIVERY = `
  delete from report_deliveries
   where household_id = $1 and user_id = $2 and month = $3::date
`;

/** $1 = household_id, $2 = user_id */
export const REPORT_PREFERENCE = `
  select monthly_report from household_members
   where household_id = $1 and user_id = $2
`;

/** $1 = household_id, $2 = user_id, $3 = recebe ou nao */
export const SET_REPORT_PREFERENCE = `
  update household_members set monthly_report = $3
   where household_id = $1 and user_id = $2
`;

/* ---------------------------------------------------------------------------
 * Configuracoes de conta
 *
 * Tudo mora em household_members: sao escolhas de uma pessoa dentro de uma
 * casa, e as tabelas de autenticacao ficam intocadas.
 * ------------------------------------------------------------------------- */

/** $1 = household_id, $2 = user_id */
export const ACCOUNT_SETTINGS = `
  select m.display_name,
         m.monthly_report,
         nullif(btrim(m.report_email), '') as report_email
    from household_members m
   where m.household_id = $1 and m.user_id = $2
`;

/** $1 = household_id, $2 = user_id, $3 = nome (null volta a usar o da conta) */
export const SET_DISPLAY_NAME = `
  update household_members set display_name = $3
   where household_id = $1 and user_id = $2
`;

/** $1 = household_id, $2 = user_id, $3 = e-mail (null volta a usar o de login) */
export const SET_REPORT_EMAIL = `
  update household_members set report_email = $3
   where household_id = $1 and user_id = $2
`;
