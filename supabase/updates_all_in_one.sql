-- =====================================================================
-- INVENTORY MANAGEMENT SYSTEM - ALL DATABASE UPDATES IN ONE SCRIPT
--
-- For a database that already has 01_schema, 02_functions, 03_rls and
-- 04_seed. Contains, in order:
--   PART 1  05_fixes.sql            alert rules, RLS holes, roles.view
--   PART 2  06_hardening.sql        lock down direct stock edits
--   PART 3  07_suppliers_unique.sql merge duplicate suppliers, unique name
--   CHECK   one row - every column should be TRUE
--
-- Safe to run more than once. In the Supabase SQL Editor: paste the whole
-- file, make sure no text is highlighted, then press Run.
-- =====================================================================

-- #####################################################################
-- PART 1 - 05_fixes.sql
-- #####################################################################
-- ---------------------------------------------------------------- 1. open-alert index
-- Collapse duplicates first: keep the newest open alert per product/type.
with ranked as (
  select alert_id,
         row_number() over (partition by product_id, alert_type
                            order by (alert_status = 'active') desc, date_created desc, alert_id desc) as rn
  from public.alerts
  where alert_status in ('active', 'acknowledged')
)
update public.alerts a
   set alert_status = 'resolved', resolved_at = coalesce(a.resolved_at, now())
  from ranked r
 where a.alert_id = r.alert_id and r.rn > 1;

drop index if exists public.uq_alert_active;
create unique index if not exists uq_alert_open on public.alerts (product_id, alert_type)
  where alert_status in ('active', 'acknowledged');

-- ------------------------------------------------- 2. alert rules (single source of truth)
create or replace function public.refresh_product_alerts(p_product_id int)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_stock   int;
  v_min     int;
  v_reorder int;
  v_name    text;
  v_expiry  date;
  v_status  text;
begin
  select i.current_stock, i.minimum_stock, i.reorder_point, p.product_name, p.expiration_date
    into v_stock, v_min, v_reorder, v_name, v_expiry
  from inventory i
  join products p on p.product_id = i.product_id
  where i.product_id = p_product_id;

  if not found then return; end if;

  v_status := case
    when v_stock <= 0          then 'out_of_stock'
    when v_stock <= v_min      then 'low_stock'
    when v_stock <= v_reorder  then 'reorder'
    else 'in_stock'
  end;

  ----------------------------------------------------------------- OUT OF STOCK
  if v_status = 'out_of_stock' then
    insert into alerts (product_id, alert_type, alert_message, priority)
    values (p_product_id, 'out_of_stock', v_name || ' is out of stock.', 'critical')
    on conflict (product_id, alert_type) where alert_status in ('active', 'acknowledged')
    do update set alert_message = excluded.alert_message, priority = excluded.priority;
  else
    update alerts set alert_status = 'resolved', resolved_at = now()
    where product_id = p_product_id and alert_type = 'out_of_stock'
      and alert_status in ('active', 'acknowledged');
  end if;

  ----------------------------------------------------------------- LOW STOCK
  if v_status = 'low_stock' then
    insert into alerts (product_id, alert_type, alert_message, priority)
    values (p_product_id, 'low_stock',
            v_name || ' is low on stock (' || v_stock || ' left, minimum ' || v_min || ').', 'high')
    on conflict (product_id, alert_type) where alert_status in ('active', 'acknowledged')
    do update set alert_message = excluded.alert_message, priority = excluded.priority;
  else
    update alerts set alert_status = 'resolved', resolved_at = now()
    where product_id = p_product_id and alert_type = 'low_stock'
      and alert_status in ('active', 'acknowledged');
  end if;

  ----------------------------------------------------------------- REORDER
  if v_status = 'reorder' then
    insert into alerts (product_id, alert_type, alert_message, priority)
    values (p_product_id, 'reorder',
            v_name || ' reached its reorder point (' || v_stock || ' of ' || v_reorder || ').', 'medium')
    on conflict (product_id, alert_type) where alert_status in ('active', 'acknowledged')
    do update set alert_message = excluded.alert_message, priority = excluded.priority;
  else
    update alerts set alert_status = 'resolved', resolved_at = now()
    where product_id = p_product_id and alert_type = 'reorder'
      and alert_status in ('active', 'acknowledged');
  end if;

  ----------------------------------------------------------------- NEAR EXPIRY
  if v_expiry is not null and v_expiry <= current_date + interval '30 days' then
    insert into alerts (product_id, alert_type, alert_message, priority)
    values (p_product_id, 'near_expiry',
            v_name || ' expires on ' || to_char(v_expiry, 'Mon DD, YYYY') || '.',
            case when v_expiry < current_date then 'high'::priority_enum else 'medium'::priority_enum end)
    on conflict (product_id, alert_type) where alert_status in ('active', 'acknowledged')
    do update set alert_message = excluded.alert_message, priority = excluded.priority;
  else
    update alerts set alert_status = 'resolved', resolved_at = now()
    where product_id = p_product_id and alert_type = 'near_expiry'
      and alert_status in ('active', 'acknowledged');
  end if;
end;
$$;

-- ------------------------------------------- 3. movement trigger (open-alert aware)
create or replace function public.apply_stock_movement()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_delta int;
  v_new   int;
begin
  v_delta := movement_delta(new.movement_type, new.quantity);

  select current_stock + v_delta into v_new
  from inventory where product_id = new.product_id for update;

  if v_new is null then
    raise exception 'No inventory record exists for product %', new.product_id;
  end if;

  if v_new < 0 then
    raise exception 'Insufficient stock: movement would leave % units for product %', v_new, new.product_id;
  end if;

  update inventory
     set current_stock = v_new,
         last_updated  = now(),
         updated_by    = coalesce(new.recorded_by, updated_by)
   where product_id = new.product_id;

  -- A new damage / loss event is a new incident, so it re-activates an acknowledged alert.
  if new.movement_type = 'damaged' then
    insert into alerts (product_id, alert_type, alert_message, priority)
    select new.product_id, 'damaged_item',
           p.product_name || ': ' || new.quantity || ' unit(s) recorded as damaged.', 'high'
    from products p where p.product_id = new.product_id
    on conflict (product_id, alert_type) where alert_status in ('active', 'acknowledged')
    do update set alert_message = excluded.alert_message, priority = excluded.priority,
                  alert_status = 'active', date_created = now();
  elsif new.movement_type = 'missing' then
    insert into alerts (product_id, alert_type, alert_message, priority)
    select new.product_id, 'missing_item',
           p.product_name || ': ' || new.quantity || ' unit(s) recorded as missing.', 'critical'
    from products p where p.product_id = new.product_id
    on conflict (product_id, alert_type) where alert_status in ('active', 'acknowledged')
    do update set alert_message = excluded.alert_message, priority = excluded.priority,
                  alert_status = 'active', date_created = now();
  end if;

  -- inventory_after_change() also runs refresh_product_alerts via its trigger
  return new;
end;
$$;

-- re-evaluate alerts when the expiry date changes
create or replace function public.products_after_expiry_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform refresh_product_alerts(new.product_id);
  return new;
end;
$$;

drop trigger if exists trg_products_expiry_change on public.products;
create trigger trg_products_expiry_change
after update of expiration_date, product_name on public.products
for each row execute function public.products_after_expiry_change();

-- --------------------------------------- 4. keep the movement ledger on product delete
alter table public.stock_movements drop constraint if exists stock_movements_product_id_fkey;
alter table public.stock_movements
  add constraint stock_movements_product_id_fkey
  foreign key (product_id) references public.products(product_id) on delete restrict;

-- ------------------------------------------------------------------ 5. RLS holes
-- Users could update their OWN row, including role_id -> self-promotion to super_admin.
drop policy if exists users_update_self on public.users;

-- Audit rows may only be written for the caller themselves.
drop policy if exists logs_insert on public.activity_logs;
create policy logs_insert on public.activity_logs
  for insert to authenticated with check (user_id = auth.uid());

-- Only Super Admin may read Super Admin profile rows.
drop policy if exists users_read_self on public.users;
create policy users_read_self on public.users
  for select to authenticated
  using (
    user_id = auth.uid()
    or public.is_super_admin()
    or (public.has_permission('users.view')
        and role_id <> (select role_id from public.roles where role_code = 'super_admin'))
  );

-- User managers cannot touch Super Admin rows; Super Admin can manage everyone.
drop policy if exists users_manage on public.users;
create policy users_manage on public.users
  for all to authenticated
  using (
    public.is_super_admin()
    or (public.has_permission('users.manage')
        and role_id <> (select role_id from public.roles where role_code = 'super_admin'))
  )
  with check (
    public.is_super_admin()
    or (public.has_permission('users.manage')
        and role_id <> (select role_id from public.roles where role_code = 'super_admin'))
  );

-- ------------------------------------------------------- 6. roles.view permission
insert into public.permissions (permission_code, module, description) values
  ('roles.view', 'system', 'View roles and the permission matrix (read-only)')
on conflict (permission_code) do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.role_id, p.permission_id
from public.roles r join public.permissions p on p.permission_code = 'roles.view'
where r.role_code in ('super_admin', 'staff_admin')
on conflict do nothing;

-- ----------------------------------------------- re-evaluate every product once
select public.refresh_product_alerts(product_id) from public.inventory;

-- #####################################################################
-- PART 2 - 06_hardening.sql
-- #####################################################################
revoke execute on function public.refresh_product_alerts(int) from public, anon, authenticated;
grant  execute on function public.refresh_product_alerts(int) to service_role;

revoke update on public.inventory from anon, authenticated;
grant  update (minimum_stock, reorder_point, location, last_updated, updated_by)
  on public.inventory to authenticated;

-- #####################################################################
-- PART 3 - 07_suppliers_unique.sql
-- #####################################################################
-- 1 + 2. move products from each copy to the row that is kept
with ranked as (
  select s.supplier_id,
         first_value(s.supplier_id) over (
           partition by lower(btrim(s.supplier_name))
           order by (select count(*) from public.products p where p.supplier_id = s.supplier_id) desc,
                    s.is_active desc,
                    s.supplier_id
         ) as keep_id
  from public.suppliers s
)
update public.products p
   set supplier_id = r.keep_id
  from ranked r
 where p.supplier_id = r.supplier_id
   and r.supplier_id <> r.keep_id;

-- 3. delete the copies (after step 2 they have no products, so the kept
--    row is still first in its group)
with ranked as (
  select s.supplier_id,
         first_value(s.supplier_id) over (
           partition by lower(btrim(s.supplier_name))
           order by (select count(*) from public.products p where p.supplier_id = s.supplier_id) desc,
                    s.is_active desc,
                    s.supplier_id
         ) as keep_id
  from public.suppliers s
)
delete from public.suppliers s
 using ranked r
 where s.supplier_id = r.supplier_id
   and r.supplier_id <> r.keep_id;

-- 4. one supplier per name from now on
create unique index if not exists uq_suppliers_name
  on public.suppliers (lower(btrim(supplier_name)));

-- #####################################################################
-- CHECK - every column should show TRUE
-- #####################################################################
select
  (select count(*) = count(distinct lower(btrim(supplier_name))) from public.suppliers)           as suppliers_not_duplicated,
  exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'uq_suppliers_name') as supplier_name_rule,
  exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'uq_alert_open')     as open_alert_rule,
  not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'uq_alert_active') as old_alert_rule_removed,
  exists (select 1 from pg_trigger where tgname = 'trg_products_expiry_change')                    as expiry_trigger,
  (select confdeltype = 'r' from pg_constraint where conname = 'stock_movements_product_id_fkey')  as movement_history_kept,
  not exists (select 1 from pg_policies where schemaname = 'public' and policyname = 'users_update_self') as self_promotion_blocked,
  exists (select 1 from public.permissions where permission_code = 'roles.view')                   as roles_view_permission,
  not has_function_privilege('anon', 'public.refresh_product_alerts(int)', 'execute')              as alert_function_locked,
  not has_column_privilege('authenticated', 'public.inventory', 'current_stock', 'UPDATE')         as direct_stock_edit_blocked;
