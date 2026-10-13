-- =====================================================================
-- 08_sales.sql - Sales & transaction management (finals phase)
--
-- Adds the `sales` and `sale_items` tables plus two functions:
--   record_sale(...)  writes a sale and its items in ONE transaction and
--                     issues the stock through stock_movements, so the
--                     existing trigger keeps inventory and alerts in sync.
--   void_sale(...)    cancels a sale and returns its stock the same way.
-- Safe to run more than once.
-- =====================================================================

-- ------------------------------------------------------------ enums
do $$ begin
  create type payment_method_enum as enum ('cash', 'gcash', 'card', 'bank_transfer');
exception when duplicate_object then null; end $$;

do $$ begin
  create type sale_status_enum as enum ('completed', 'voided');
exception when duplicate_object then null; end $$;

-- ------------------------------------------------------------ tables
create table if not exists public.sales (
  sale_id        serial primary key,
  reference_no   text not null unique,
  customer_name  text,
  payment_method payment_method_enum not null default 'cash',
  status         sale_status_enum not null default 'completed',
  subtotal       numeric(12, 2) not null default 0 check (subtotal >= 0),
  discount       numeric(12, 2) not null default 0 check (discount >= 0),
  total          numeric(12, 2) not null default 0 check (total >= 0),
  notes          text,
  sold_by        uuid references public.users(user_id) on delete set null,
  sold_at        timestamptz not null default now(),
  voided_by      uuid references public.users(user_id) on delete set null,
  voided_at      timestamptz,
  void_reason    text
);

create table if not exists public.sale_items (
  sale_item_id serial primary key,
  sale_id      int not null references public.sales(sale_id) on delete cascade,
  product_id   int not null references public.products(product_id) on delete restrict,
  quantity     int not null check (quantity > 0),
  unit_price   numeric(12, 2) not null check (unit_price >= 0),
  line_total   numeric(12, 2) not null check (line_total >= 0),
  movement_id  int references public.stock_movements(movement_id) on delete set null
);

create index if not exists idx_sales_sold_at     on public.sales(sold_at desc);
create index if not exists idx_sales_status      on public.sales(status);
create index if not exists idx_sale_items_sale   on public.sale_items(sale_id);
create index if not exists idx_sale_items_product on public.sale_items(product_id);

comment on table public.sales is 'Sales transactions (header). Stock is issued through stock_movements.';
comment on table public.sale_items is 'Line items of a sale, each linked to the stock movement that issued it.';

-- ------------------------------------------------------------ reference numbers
-- S-20261014-0001, numbered per day
create or replace function public.next_sale_reference()
returns text language plpgsql as $$
declare
  v_prefix text := 'S-' || to_char(now() at time zone 'Asia/Manila', 'YYYYMMDD') || '-';
  v_seq int;
begin
  select coalesce(max(substring(reference_no from length(v_prefix) + 1)::int), 0) + 1
    into v_seq
    from public.sales
   where reference_no like v_prefix || '%'
     and substring(reference_no from length(v_prefix) + 1) ~ '^[0-9]+$';
  return v_prefix || lpad(v_seq::text, 4, '0');
end $$;

-- ------------------------------------------------------------ record a sale
-- p_items: [{"productId": 1, "quantity": 2}, ...]  (unit price is read from the catalogue)
create or replace function public.record_sale(
  p_user           uuid,
  p_items          jsonb,
  p_customer_name  text default null,
  p_payment_method payment_method_enum default 'cash',
  p_discount       numeric default 0,
  p_notes          text default null
) returns int language plpgsql security definer set search_path = public as $$
declare
  v_sale_id   int;
  v_ref       text;
  v_item      jsonb;
  v_pid       int;
  v_qty       int;
  v_price     numeric(12, 2);
  v_name      text;
  v_stock     int;
  v_subtotal  numeric(12, 2) := 0;
  v_mov_id    int;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'A sale needs at least one item';
  end if;
  if coalesce(p_discount, 0) < 0 then
    raise exception 'Discount cannot be negative';
  end if;

  v_ref := public.next_sale_reference();
  insert into public.sales (reference_no, customer_name, payment_method, discount, notes, sold_by)
  values (v_ref, nullif(btrim(p_customer_name), ''), coalesce(p_payment_method, 'cash'), coalesce(p_discount, 0), nullif(btrim(p_notes), ''), p_user)
  returning sale_id into v_sale_id;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_pid := (v_item->>'productId')::int;
    v_qty := (v_item->>'quantity')::int;
    if v_qty is null or v_qty <= 0 then
      raise exception 'Quantity must be greater than 0';
    end if;

    select p.unit_price, p.product_name, i.current_stock
      into v_price, v_name, v_stock
      from public.products p
      left join public.inventory i on i.product_id = p.product_id
     where p.product_id = v_pid and p.status = 'active';
    if not found then
      raise exception 'Product % not found or inactive', v_pid;
    end if;
    if v_stock is null then
      raise exception 'No inventory record for %', v_name;
    end if;
    if v_stock < v_qty then
      raise exception 'Insufficient stock for %: % on hand, % requested', v_name, v_stock, v_qty;
    end if;

    -- issue the stock through the ledger (the trigger updates inventory and alerts)
    insert into public.stock_movements (product_id, movement_type, quantity, reason, reference_no, recorded_by)
    values (v_pid, 'stock_out', v_qty, 'Sale', v_ref, p_user)
    returning movement_id into v_mov_id;

    insert into public.sale_items (sale_id, product_id, quantity, unit_price, line_total, movement_id)
    values (v_sale_id, v_pid, v_qty, v_price, v_price * v_qty, v_mov_id);

    v_subtotal := v_subtotal + v_price * v_qty;
  end loop;

  if coalesce(p_discount, 0) > v_subtotal then
    raise exception 'Discount cannot be larger than the subtotal';
  end if;

  update public.sales
     set subtotal = v_subtotal,
         total    = v_subtotal - coalesce(p_discount, 0)
   where sale_id = v_sale_id;

  return v_sale_id;
end $$;

-- ------------------------------------------------------------ void a sale
create or replace function public.void_sale(p_sale_id int, p_user uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_ref  text;
  v_item record;
begin
  select reference_no into v_ref from public.sales where sale_id = p_sale_id and status = 'completed' for update;
  if not found then
    raise exception 'Sale not found or already voided';
  end if;

  for v_item in select product_id, quantity from public.sale_items where sale_id = p_sale_id loop
    insert into public.stock_movements (product_id, movement_type, quantity, reason, reference_no, recorded_by)
    values (v_item.product_id, 'returned', v_item.quantity, 'Sale voided', v_ref, p_user);
  end loop;

  update public.sales
     set status = 'voided', voided_by = p_user, voided_at = now(), void_reason = nullif(btrim(p_reason), '')
   where sale_id = p_sale_id;
end $$;

-- ------------------------------------------------------------ grants
-- the API (service role) owns the writes; signed-in users may only read
grant select, insert, update, delete on public.sales, public.sale_items to service_role;
grant usage, select on sequence public.sales_sale_id_seq, public.sale_items_sale_item_id_seq to service_role;
grant select on public.sales, public.sale_items to authenticated;

revoke all on function public.record_sale(uuid, jsonb, text, payment_method_enum, numeric, text) from public, anon, authenticated;
revoke all on function public.void_sale(int, uuid, text) from public, anon, authenticated;
revoke all on function public.next_sale_reference() from public, anon, authenticated;
grant execute on function public.record_sale(uuid, jsonb, text, payment_method_enum, numeric, text) to service_role;
grant execute on function public.void_sale(int, uuid, text) to service_role;

-- ------------------------------------------------------------ row level security
alter table public.sales      enable row level security;
alter table public.sale_items enable row level security;

drop policy if exists sales_read on public.sales;
create policy sales_read on public.sales
  for select to authenticated using (public.has_permission('finance.view'));

drop policy if exists sale_items_read on public.sale_items;
create policy sale_items_read on public.sale_items
  for select to authenticated using (public.has_permission('finance.view'));

-- ------------------------------------------------------------ check
select
  exists (select 1 from information_schema.tables where table_name = 'sales')      as sales_table,
  exists (select 1 from information_schema.tables where table_name = 'sale_items') as sale_items_table,
  exists (select 1 from pg_proc where proname = 'record_sale')                     as record_sale_function,
  exists (select 1 from pg_proc where proname = 'void_sale')                       as void_sale_function;
