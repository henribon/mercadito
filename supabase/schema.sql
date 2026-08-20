-- ============================================================================
-- Mercadito - schema completo
-- Rode este arquivo inteiro no SQL Editor do Supabase (uma vez so).
-- ============================================================================

create extension if not exists "pgcrypto";
create extension if not exists "pg_trgm";

-- ---------------------------------------------------------------------------
-- Casa (household): agrupa a lista, o catalogo e o historico de um casal.
-- ---------------------------------------------------------------------------
create table if not exists public.households (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  invite_code  text not null unique,
  created_at   timestamptz not null default now()
);

create table if not exists public.household_members (
  household_id uuid not null references public.households(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  display_name text,
  joined_at    timestamptz not null default now(),
  primary key (household_id, user_id)
);

-- SECURITY DEFINER para nao recursionar na policy de household_members.
create or replace function public.is_member(p_household uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $fn$
  select exists (
    select 1 from public.household_members
    where household_id = p_household and user_id = auth.uid()
  );
$fn$;

-- ---------------------------------------------------------------------------
-- Catalogo de produtos: a entidade estavel a que tudo se liga.
-- norm_name e o nome normalizado (sem acento, maiusculo), usado para casar
-- as descricoes que vem da nota fiscal.
-- ---------------------------------------------------------------------------
create table if not exists public.products (
  id              uuid primary key default gen_random_uuid(),
  household_id    uuid not null references public.households(id) on delete cascade,
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

create index if not exists products_household_idx on public.products (household_id);
create index if not exists products_norm_trgm_idx on public.products using gin (norm_name gin_trgm_ops);

-- Apelidos: "LEITE INTEG ITALAC 1L" (nota) -> produto "Leite integral".
-- Uma vez confirmado pelo usuario, o casamento vira automatico.
create table if not exists public.product_aliases (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  product_id   uuid not null references public.products(id) on delete cascade,
  raw_norm     text not null,
  sefaz_code   text,
  created_at   timestamptz not null default now(),
  unique (household_id, raw_norm)
);

create index if not exists product_aliases_product_idx on public.product_aliases (product_id);

-- ---------------------------------------------------------------------------
-- Compras (uma nota fiscal = uma compra) e seus itens.
-- ---------------------------------------------------------------------------
create table if not exists public.purchases (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  store_name   text,
  store_cnpj   text,
  access_key   text,                     -- chave de 44 digitos da NFC-e
  total_amount numeric(12,2),
  discount     numeric(12,2),
  paid_amount  numeric(12,2),
  purchased_at timestamptz not null default now(),
  source       text not null default 'nfce' check (source in ('nfce','manual')),
  source_url   text,
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  unique (household_id, access_key)
);

create index if not exists purchases_household_date_idx
  on public.purchases (household_id, purchased_at desc);

create table if not exists public.purchase_items (
  id              uuid primary key default gen_random_uuid(),
  purchase_id     uuid not null references public.purchases(id) on delete cascade,
  household_id    uuid not null references public.households(id) on delete cascade,
  product_id      uuid references public.products(id) on delete set null,
  raw_description text not null,
  raw_code        text,
  quantity        numeric(12,4) not null default 1,
  unit            text default 'UN',
  unit_price      numeric(12,4),
  total_price     numeric(12,2),
  position        integer not null default 0
);

create index if not exists purchase_items_purchase_idx on public.purchase_items (purchase_id);
create index if not exists purchase_items_product_idx on public.purchase_items (product_id);

-- ---------------------------------------------------------------------------
-- A lista: o que esta faltando agora.
-- ---------------------------------------------------------------------------
create table if not exists public.list_items (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  product_id   uuid not null references public.products(id) on delete cascade,
  quantity     numeric(12,2) not null default 1,
  note         text,
  status       text not null default 'pending' check (status in ('pending','bought','archived')),
  added_by     uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  bought_at    timestamptz,
  purchase_id  uuid references public.purchases(id) on delete set null
);

create index if not exists list_items_household_status_idx
  on public.list_items (household_id, status, created_at desc);

-- Um produto so pode estar pendente uma vez na lista.
create unique index if not exists list_items_one_pending_per_product
  on public.list_items (household_id, product_id) where status = 'pending';

-- ---------------------------------------------------------------------------
-- Estatisticas por produto: ultima compra, frequencia media, preco.
-- security_invoker faz a view respeitar o RLS de quem consulta.
-- ---------------------------------------------------------------------------
create or replace view public.product_stats
with (security_invoker = true) as
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
from public.products p
left join public.purchase_items pi on pi.product_id = p.id
left join public.purchases pu on pu.id = pi.purchase_id
group by p.id, p.household_id;

-- ---------------------------------------------------------------------------
-- RPCs de onboarding
-- ---------------------------------------------------------------------------
create or replace function public.create_household(p_name text, p_display_name text default null)
returns public.households
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_code text;
  v_row  public.households;
begin
  if auth.uid() is null then
    raise exception 'nao autenticado';
  end if;

  loop
    v_code := upper(substring(encode(gen_random_bytes(6), 'hex') from 1 for 6));
    exit when not exists (select 1 from public.households where invite_code = v_code);
  end loop;

  insert into public.households (name, invite_code)
  values (coalesce(nullif(trim(p_name), ''), 'Nossa casa'), v_code)
  returning * into v_row;

  insert into public.household_members (household_id, user_id, display_name)
  values (v_row.id, auth.uid(), p_display_name);

  return v_row;
end;
$fn$;

create or replace function public.join_household(p_code text, p_display_name text default null)
returns public.households
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_row public.households;
begin
  if auth.uid() is null then
    raise exception 'nao autenticado';
  end if;

  select * into v_row from public.households
  where invite_code = upper(trim(p_code));

  if v_row.id is null then
    raise exception 'codigo de convite invalido';
  end if;

  insert into public.household_members (household_id, user_id, display_name)
  values (v_row.id, auth.uid(), p_display_name)
  on conflict (household_id, user_id) do nothing;

  return v_row;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.households        enable row level security;
alter table public.household_members enable row level security;
alter table public.products          enable row level security;
alter table public.product_aliases   enable row level security;
alter table public.purchases         enable row level security;
alter table public.purchase_items    enable row level security;
alter table public.list_items        enable row level security;

drop policy if exists households_select on public.households;
create policy households_select on public.households
  for select using (public.is_member(id));

drop policy if exists households_update on public.households;
create policy households_update on public.households
  for update using (public.is_member(id));

drop policy if exists members_select on public.household_members;
create policy members_select on public.household_members
  for select using (public.is_member(household_id));

drop policy if exists members_delete on public.household_members;
create policy members_delete on public.household_members
  for delete using (user_id = auth.uid());

-- Tabelas de dados: mesma regra para todas -> precisa ser membro da casa.
do $blk$
declare t text;
begin
  foreach t in array array['products','product_aliases','purchases','purchase_items','list_items']
  loop
    execute format('drop policy if exists %I_all on public.%I', t, t);
    execute format(
      'create policy %I_all on public.%I for all
         using (public.is_member(household_id))
         with check (public.is_member(household_id))', t, t);
  end loop;
end;
$blk$;

-- ---------------------------------------------------------------------------
-- Realtime: a lista sincroniza entre os dois celulares.
-- ---------------------------------------------------------------------------
do $blk$
begin
  begin
    alter publication supabase_realtime add table public.list_items;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.products;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.purchases;
  exception when duplicate_object then null;
  end;
end;
$blk$;

-- ---------------------------------------------------------------------------
-- Realtime + DELETE: sem replica identity full, o evento de exclusao so carrega
-- a PK — e o filtro por household_id nao casaria no outro celular.
-- ---------------------------------------------------------------------------
alter table public.list_items replica identity full;
alter table public.products   replica identity full;

-- ---------------------------------------------------------------------------
-- Grants explicitos (o Supabase ja concede por default, mas deixamos assertivo)
-- ---------------------------------------------------------------------------
grant usage on schema public to anon, authenticated;

grant select                         on public.households        to authenticated;
grant select                         on public.household_members to authenticated;
grant select, insert, update, delete on public.products          to authenticated;
grant select, insert, update, delete on public.product_aliases   to authenticated;
grant select, insert, update, delete on public.purchases         to authenticated;
grant select, insert, update, delete on public.purchase_items    to authenticated;
grant select, insert, update, delete on public.list_items        to authenticated;
grant select                         on public.product_stats     to authenticated;

grant execute on function public.is_member(uuid)                 to authenticated;
grant execute on function public.create_household(text, text)    to authenticated;
grant execute on function public.join_household(text, text)      to authenticated;
