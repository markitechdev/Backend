-- =====================================================================
-- INVENTORY MANAGEMENT SYSTEM - HARDENING (run AFTER 05_fixes.sql)
-- Safe to run more than once.
--
--  1. refresh_product_alerts() is SECURITY DEFINER; only the backend
--     (service_role) may call it directly, not anonymous/browser clients.
--  2. Signed-in clients talking to the database directly can no longer
--     change inventory.current_stock; stock only changes through a recorded
--     stock movement (the trigger runs as owner, so the API is unaffected).
-- =====================================================================

revoke execute on function public.refresh_product_alerts(int) from public, anon, authenticated;
grant  execute on function public.refresh_product_alerts(int) to service_role;

revoke update on public.inventory from anon, authenticated;
grant  update (minimum_stock, reorder_point, location, last_updated, updated_by)
  on public.inventory to authenticated;
