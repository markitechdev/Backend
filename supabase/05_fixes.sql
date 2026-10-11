-- =====================================================================
-- INVENTORY MANAGEMENT SYSTEM - FIXES (run AFTER 01-04)
-- Safe to run more than once. Run it in the Supabase SQL Editor.
--
--  1. Alert lifecycle: "acknowledged" alerts are still OPEN.
--     Before: acknowledged alerts never auto-resolved when stock was
--     replenished, and the next stock change created a duplicate ACTIVE
--     alert next to the acknowledged one.
--  2. Low Stock vs Reorder no longer fire together.
--       out_of_stock : stock = 0
--       low_stock    : 0 < stock <= minimum_stock
--       reorder      : minimum_stock < stock <= reorder_point
--  3. A new damaged/missing event re-activates an acknowledged alert.
--  4. Deleting a product can no longer cascade-delete its stock movement
--     ledger (the shrinkage history). The API archives such products instead.
--  5. RLS holes closed: users could change their own role_id through the
--     users_update_self policy, and anyone could forge audit-log rows.
--  6. New permission roles.view (read-only role matrix) for Staff Admin.
-- =====================================================================

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
