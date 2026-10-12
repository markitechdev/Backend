# System Fixes — 2026-10-12

Debug pass across the Backend and Frontend, mapped to the 8 required improvements.
All fixes were run end-to-end against a local Postgres + PostgREST copy of the schema (01–05 SQL files), with the four seeded accounts, and in a real browser.

## Run this once in Supabase

`supabase/05_fixes.sql` (SQL Editor, after 01–04). It is safe to run more than once.

## 8 · Data leak (Super Admin)

| Problem | Fix |
|---|---|
| `GET /api/users` and `/users/:id` returned Super Admin accounts and emails to any `users.view` holder | Super Admin accounts are hidden from non-super-admins (404 on direct id) |
| `GET /api/roles/:id/users` listed Super Admin accounts | 404 for the super_admin role unless caller is Super Admin |
| Dashboard "Recent Activity" showed everyone's audit log (incl. Super Admin actions), while `/api/logs` limited users to their own | Same rule as `/api/logs`: non-super-admins see only their own activity; cache is now per user |
| Search text was pasted into a PostgREST `.or()` filter (filter injection, e.g. `x,role_id.eq.1`) | `safeSearchTerm()` strips filter syntax (users, products) |
| Email masking was hardcoded to role codes | Full email/phone only for `users.manage` or Super Admin |
| RLS `users_update_self` let a user change their own `role_id` (self-promotion) | Policy dropped; `users_read/manage` exclude Super Admin rows; audit inserts must be your own user id |
| Super Admin demo password shipped in the production JS bundle | Demo credentials exist only in dev builds |
| Frontend sent `x-tenant-id` from editable localStorage | Removed; tenant comes from the server identity |

## 5 · Roles & permissions

- Dashboard used `perms.includes()` → ignored `module.manage` and aliases. Now uses the same `userCan()` as the routes.
- Frontend `auth.can()` now mirrors backend `hasUserPermission()` (manage/alias rules).
- Deactivating a role was cosmetic → users with a deactivated role are now refused (login, refresh and every request).
- `PUT /roles/:id/permissions` deleted all permissions *then* failed on an unknown id → ids validated first, old set restored on failure. `createRole` no longer ignores insert errors.
- New `roles.view` permission (Staff Admin) → read-only permission matrix at `/roles`.

## 1 · Super Admin login / sessions

- Refresh token was never stored → sessions died after ~1 h. Now stored; one shared refresh on 401 with automatic retry, plus proactive refresh before expiry.
- Profile is verified with the server before the first route guard runs; network errors no longer log you out.
- Expired session → login page with "session expired" notice and return to the original page.
- Login, refresh and both middlewares share one identity loader (`services/identity.service.js`).

## 6 · Routing

- Any 403 (even a refused Save) redirected to Access Denied — now only page-data GETs do; actions show a toast.
- Post-login `redirect` is restricted to in-app paths.
- 404 page is public and uses the full layout only when signed in; `/inventory/abc` → 404.
- Inventory filters live in the URL (refresh, Back/Forward, top-bar search on the same page all work).
- `vercel.json` / `public/_redirects` for deep-link refresh in production. Logout uses `replace`.

## 2 · Caching  ·  3 · Loading states

- Reference data (categories, active suppliers, roles) cached 30–60 s, shared in-flight, invalidated on writes and sign-in/out.
- Server dashboard cache invalidated on product/stock/alert/user/role changes.
- Audit log is paginated in the database (was loading the whole table).
- Stale responses from fast typing/filtering are ignored (request sequence guards).
- Error + "Try again" states on Users, Activity Log, Inventory, Reports, Finance.

## 4 · Horizontal graph

New `components/ui/HorizontalBarChart.vue`: shared "nice" scale with gridlines and axis ticks, hover/keyboard tooltip (value, % of total, detail), long-label truncation, "Other (n)" folding for many categories, visible slivers for tiny values, loading/empty/error states, mobile layout. Reports adds a Value/Units toggle and a category filter that re-draws the graph.

## Broken pages fixed

- **User Management / Staff / Activity Log**: read `full_name`/`user_id`/`is_active` while the API returns `fullName`/`userId`/`isActive` → blank names, everyone "Deactivated", every action hit `/users/undefined`.
- **Reports**: crashed on first render (`summary.totalValue` while null); now uses `/api/reports/*` so Staff/Finance Admin are no longer sent to Access Denied.
- **Finance**: called `/movements/summary` (no permission for Finance Admin) → Access Denied.
- **Inventory edit** silently reset unit of measure to `pc`; negative adjustments were impossible.

## Inventory & alert logic

- Acknowledged alerts never auto-resolved and were duplicated on the next stock change (unique index only covered `active`).
- Low Stock and Reorder fired together. Now: out (0) · low (≤ min) · reorder (min < stock ≤ reorder point).
- Reorder point must be ≥ minimum stock (API + form).
- Resolving a stock alert whose condition still holds → 409 "acknowledge instead".
- Deleting a product cascade-deleted its movement ledger (shrinkage history) → products with history are archived (`discontinued`); FK is now `RESTRICT`.
- **New: physical (cycle) count** — `POST /api/movements/count`; the variance is recorded as `missing` (shrinkage) or `adjustment`.
- Date filters: `to=YYYY-MM-DD` now includes the whole day; invalid/reversed dates → 400.
- Paginated reports kept dropping `summary`; now returned in `meta.summary`.

## Not done (needs a decision)

True multi-tenancy (separate client workspaces). The schema is single-organization; `/super-admin/tenants` now reports that honestly. Adding it means an `organizations` table, `organization_id` on every business table, and scoping every query.

## Review round 2 (independent review)

| Problem | Fix |
|---|---|
| A user manager could move a peer admin into a resettable role, reset the password and move them back (account take-over) | Only a Super Admin may assign administrator roles (Super Admin or any role with `users/roles/system/security.manage`) or change, reset or delete an account holding one |
| Upper-case copy of your own user id bypassed "cannot change own role / delete self" | UUID route params are lower-cased |
| "Deactivated role" check never matched (`[ICON:..]` prefix), and typing `[DEACTIVATED]` into the Super Admin description locked every Super Admin out | One parser everywhere; markers stripped from typed text; the Super Admin role can never count as deactivated |
| Client mistakes (duplicate username, bad reference, bad filter value) returned 500 | `ApiError.fromDb()` maps Postgres codes to 400/404/409 |
| Movement summary and stock-movement/shrinkage reports stopped at 1,000 rows | Paged reads (`fetchAllRows`) |
| Logout signed the user out on every device | `signOut(..., 'local')` |
| Alert counts differed between pages | All "active alerts" counts include acknowledged (open) alerts |
| Super Admin dashboard: blank KPI numbers (white on white), Reorder Due copied Low Stock, fake priority split, fake movements | Dark-mode cards; real `reorderDueCount`, `alertsByPriority`, `recentMovements`, `activeSuppliers` |
| Super Admin role edit always failed | Role name is not sent for the protected Super Admin role |
| Not deployable on Vercel | `api/index.js` + `vercel.json`; `trust proxy` for per-user rate limits; clear 500 when env vars are missing; wildcard CORS origins |
| `refresh_product_alerts()` callable by anonymous clients; direct `current_stock` writes possible with a user JWT | `supabase/06_hardening.sql` |

## Round 3 (suppliers, Super Admin pages, sign-in pages)

| Problem | Fix |
|---|---|
| Suppliers listed several times (e.g. CablePro Ltd. ×7) | `04_seed.sql` re-inserted the sample suppliers on every run because supplier names had no unique rule. `supabase/07_suppliers_unique.sql` merges the copies (products move to the kept row) and adds a unique index on the name; the seed now skips existing names and looks products' category/supplier up by name |
| A duplicate supplier could be created through the app | `POST/PATCH /api/suppliers` return 409 "A supplier named … already exists." (case and outer spaces ignored) |
| Super Admin "Attention Items" showed only out-of-stock products, with "—" as reorder point | API returns `itemsNeedingAttention.stockItems` (out of stock, low stock, reorder due) with real stock and reorder points; matches the cards |

Run once in Supabase: `supabase/07_suppliers_unique.sql` (after 01–06).
