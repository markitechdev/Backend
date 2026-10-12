-- =====================================================================
-- INVENTORY MANAGEMENT SYSTEM - DUPLICATE SUPPLIERS (run AFTER 01-06)
-- Safe to run more than once. Run it in the Supabase SQL Editor.
--
-- Problem: suppliers had no unique rule on the name, so every re-run of
-- 04_seed.sql added another copy of the five sample suppliers
-- ("on conflict do nothing" never fired).
--
-- This script:
--   1. keeps one row per supplier name (ignoring case and spaces) - the one
--      that already has products, otherwise the oldest;
--   2. moves any products from the copies to that row;
--   3. deletes the copies;
--   4. adds a unique index so the same name cannot be added twice again.
-- =====================================================================

begin;

create temporary table supplier_merge on commit drop as
with ranked as (
  select s.supplier_id,
         lower(btrim(s.supplier_name)) as name_key,
         row_number() over (
           partition by lower(btrim(s.supplier_name))
           order by (select count(*) from public.products p where p.supplier_id = s.supplier_id) desc,
                    s.is_active desc,
                    s.supplier_id
         ) as rn
  from public.suppliers s
)
select d.supplier_id as duplicate_id, k.supplier_id as keep_id
from ranked d
join ranked k on k.name_key = d.name_key and k.rn = 1
where d.rn > 1;

-- 2. re-point products to the row that is kept
update public.products p
   set supplier_id = m.keep_id
  from supplier_merge m
 where p.supplier_id = m.duplicate_id;

-- 3. remove the copies
delete from public.suppliers s
 using supplier_merge m
 where s.supplier_id = m.duplicate_id;

-- 4. one supplier per name from now on
create unique index if not exists uq_suppliers_name
  on public.suppliers (lower(btrim(supplier_name)));

commit;

-- Check: every name should now appear once.
select supplier_name, count(*) as copies
from public.suppliers
group by supplier_name
order by copies desc, supplier_name;
