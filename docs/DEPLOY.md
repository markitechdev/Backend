# Deploying (Supabase + Vercel)

## 1. Supabase (database)
In the Supabase SQL Editor run, in order, any file not yet applied:
`01_schema.sql` → `02_functions.sql` → `03_rls.sql` → `04_seed.sql` → `05_fixes.sql` → `06_hardening.sql`
(05 and 06 are safe to run again.) Then, once, from this folder: `npm run seed:users` (only for a fresh database).

## 2. Backend on Vercel (project from this repo)
- Framework preset: **Other**. Root directory: repo root. No build command needed.
- Environment variables:
  | Name | Value |
  |---|---|
  | `SUPABASE_URL` | Supabase → Project Settings → API → Project URL |
  | `SUPABASE_ANON_KEY` | Supabase → API → `anon` key |
  | `SUPABASE_SERVICE_ROLE_KEY` | Supabase → API → `service_role` key (secret!) |
  | `NODE_ENV` | `production` |
  | `CORS_ORIGIN` | your frontend URL, e.g. `https://ims-frontend.vercel.app` (comma-separate several; `https://*.vercel.app` allowed) |
- Check: `https://<backend>.vercel.app/api/health` → `{"success":true,...}`

## 3. Frontend on Vercel (project from the Frontend repo)
- Framework preset: **Vite**. Build `npm run build`, output `dist`.
- Environment variable: `VITE_API_BASE_URL` = `https://<backend>.vercel.app/api`
- Redeploy the frontend after changing it (Vite bakes it in at build time).

## 4. Before real users
- Change every demo password (`SuperAdmin123!` etc. are public in `scripts/seedUsers.js`).
- Click through each role once.

## Known limits on serverless
Token revocation, the login rate limit and the short caches live in memory per instance. A signed-out access token can stay valid on another instance until it expires (≤ 1 hour); Supabase still invalidates the refresh token immediately.
