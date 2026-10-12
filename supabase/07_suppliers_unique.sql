-- =====================================================================
-- INVENTORY MANAGEMENT SYSTEM - DUPLICATE SUPPLIERS (run AFTER 01-06)
-- Safe to run more than once. Paste the whole file into the Supabase
-- SQL Editor and press Run (no text selected).
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
-- Each step is a single statement, so it works in editors that run
-- statements separately (no temporary tables).
-- =====================================================================

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

-- Check: every name should now appear once.
select supplier_name, count(*) as copies
from public.suppliers
group by supplier_name
order by copies desc, supplier_name;
