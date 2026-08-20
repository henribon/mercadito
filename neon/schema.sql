-- ============================================================================
-- Mercadito - schema da aplicacao (Neon / Postgres puro)
--
-- IMPORTANTE: rode PRIMEIRO o `npx @better-auth/cli migrate`, que cria as
-- tabelas de autenticacao ("user", session, account, verification). Este
-- arquivo referencia a tabela "user" e falha se ela ainda nao existir.
--
-- Depois cole este arquivo inteiro no SQL Editor do Neon (uma vez so).
-- ============================================================================

create extension if not exists "pg_trgm";

-- ---------------------------------------------------------------------------
-- Casa (household): agrupa a lista, o catalogo e o historico de um casal.
-- ---------------------------------------------------------------------------
create table if not exists households (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  invite_code  text not null unique,
  created_at   timestamptz not null default now()
);

-- "user" e palavra reservada no Postgres; o Better Auth cria a tabela com esse
-- nome, entao ela precisa vir sempre entre aspas.
create table if not exists household_members (
  household_id uuid not null references households(id) on delete cascade,
  user_id      text not null references "user"(id) on delete cascade,
  display_name text,
  joined_at    timestamptz not null default now(),
  primary key (household_id, user_id)
);

create index if not exists household_members_user_idx on household_members (user_id);

-- ---------------------------------------------------------------------------
-- Catalogo de produtos: a entidade estavel a que tudo se liga.
-- norm_name e o nome normalizado (sem acento, maiusculo), usado para casar
-- as descricoes que vem da nota fiscal.
-- ---------------------------------------------------------------------------
create table if not exists products (
  id              uuid primary key default gen_random_uuid(),
  household_id    uuid not null references households(id) on delete cascade,
  name            text not null,
  norm_name       text not null,
  unit            text not null default 'UN',
  category        text,
  is_recurring    boolean not null default false,
  recurrence_days integer,               -- override manual; null = usa a media do historico
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (household_id, norm_name)
);

create index if not exists products_household_idx on products (household_id);
create index if not exists products_norm_trgm_idx on products using gin (norm_name gin_trgm_ops);

-- Apelidos: "LEITE INTEG ITALAC 1L" (nota) -> produto "Leite integral".
-- Uma vez confirmado pelo usuario, o casamento vira automatico.
create table if not exists product_aliases (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  product_id   uuid not null references products(id) on delete cascade,
  raw_norm     text not null,
  sefaz_code   text,
  created_at   timestamptz not null default now(),
  unique (household_id, raw_norm)
);

create index if not exists product_aliases_product_idx on product_aliases (product_id);

-- ---------------------------------------------------------------------------
-- Compras (uma nota fiscal = uma compra) e seus itens.
-- ---------------------------------------------------------------------------
create table if not exists purchases (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  store_name   text,
  store_cnpj   text,
  access_key   text,                     -- chave de 44 digitos da NFC-e
  total_amount numeric(12,2),
  discount     numeric(12,2),
  paid_amount  numeric(12,2),
  purchased_at timestamptz not null default now(),
  source       text not null default 'nfce' check (source in ('nfce','manual')),
  source_url   text,
  created_by   text references "user"(id) on delete set null,
  created_at   timestamptz not null default now(),
  unique (household_id, access_key)
);

create index if not exists purchases_household_date_idx
  on purchases (household_id, purchased_at desc);

create table if not exists purchase_items (
  id              uuid primary key default gen_random_uuid(),
  purchase_id     uuid not null references purchases(id) on delete cascade,
  household_id    uuid not null references households(id) on delete cascade,
  product_id      uuid references products(id) on delete set null,
  raw_description text not null,
  raw_code        text,
  quantity        numeric(12,4) not null default 1,
  unit            text default 'UN',
  unit_price      numeric(12,4),
  total_price     numeric(12,2),
  position        integer not null default 0
);

create index if not exists purchase_items_purchase_idx on purchase_items (purchase_id);
create index if not exists purchase_items_product_idx on purchase_items (product_id);

-- ---------------------------------------------------------------------------
-- A lista: o que esta faltando agora.
-- ---------------------------------------------------------------------------
create table if not exists list_items (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  product_id   uuid not null references products(id) on delete cascade,
  quantity     numeric(12,2) not null default 1,
  note         text,
  status       text not null default 'pending' check (status in ('pending','bought','archived')),
  added_by     text references "user"(id) on delete set null,
  created_at   timestamptz not null default now(),
  bought_at    timestamptz,
  purchase_id  uuid references purchases(id) on delete set null
);

create index if not exists list_items_household_status_idx
  on list_items (household_id, status, created_at desc);

-- Um produto so pode estar pendente uma vez na lista.
create unique index if not exists list_items_one_pending_per_product
  on list_items (household_id, product_id) where status = 'pending';

-- ---------------------------------------------------------------------------
-- Estatisticas por produto: ultima compra, frequencia media, preco.
-- ---------------------------------------------------------------------------
create or replace view product_stats as
select
  p.id                                        as product_id,
  p.household_id,
  max(pu.purchased_at)                        as last_purchased_at,
  min(pu.purchased_at)                        as first_purchased_at,
  count(distinct pu.id)::int                  as purchase_count,
  round(avg(pi.unit_price)::numeric, 2)       as avg_unit_price,
  (array_agg(pi.unit_price order by pu.purchased_at desc))[1] as last_unit_price,
  case
    when count(distinct pu.id) > 1
    then round(
      extract(epoch from (max(pu.purchased_at) - min(pu.purchased_at)))
      / 86400.0 / (count(distinct pu.id) - 1)
    )::int
  end                                         as avg_interval_days
from products p
left join purchase_items pi on pi.product_id = p.id
left join purchases pu on pu.id = pi.purchase_id
group by p.id, p.household_id;
