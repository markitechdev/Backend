# QA Review: Backend API Performance & Database Query Efficiency

**Repository:** Backend (`markitechdev/Backend`)  
**Target:** `src/middleware/authenticate.js`, `src/controllers/dashboard.controller.js`, `src/controllers/inventory.controller.js`  
**QA Reviewer:** Jaymartimpas0-prog  
**Review Date:** 2026-10-11  

---

### Finding 1: Redundant Multi-Query Overhead Inside Authentication Middleware

**Issue:**  
Authentication Middleware Dispatches Three Database Queries on Every Single HTTP Request

**Repository:**  
Backend

**Area:**  
`src/middleware/authenticate.js` (Lines 14-38)

**Priority:**  
P1

**Severity:**  
High

**Steps to Reproduce:**
1. Send 10 consecutive requests to `GET /api/products` with a valid bearer token.
2. Monitor database query traffic in Supabase Studio.
3. Observe that for every individual request:
   - Request 1: `auth.getUser(token)`
   - Request 2: `SELECT * FROM users WHERE user_id = ...`
   - Request 3: `SELECT * FROM role_permissions WHERE role_id = ...`
4. Calculate added latency: 150ms - 350ms of database round-trip overhead on every single endpoint hit.

**Expected Result:**  
Decoded JWT payload or short-lived memory cache (e.g. 60-second TTL cache keyed by user ID) should provide user profile and permissions without querying the database 3 times per request.

**Actual Result:**  
Every request incurs triple remote database round-trips before the target controller is invoked, bottlenecking overall API throughput.

**Developer Task:**  
Implement memory caching (e.g., Node-Cache or Redis with 1-2 minute TTL) for authenticated user profiles and permission arrays, invalidated upon role or profile update.

**Status:**  
Open

**QA Reviewer:**  
Jaymartimpas0-prog

---

### Finding 2: Uncached Heavyweight Dashboard Aggregations

**Issue:**  
Dashboard Endpoint Executes Uncached Full-Table Scans and Real-time Calculations

**Repository:**  
Backend

**Area:**  
`src/controllers/dashboard.controller.js` (Lines 12-85)

**Priority:**  
P2

**Severity:**  
Medium

**Steps to Reproduce:**
1. Populate database with 10,000 products and 50,000 stock movements.
2. Send concurrent `GET /api/dashboard` requests.
3. Monitor query response time and database CPU usage.
4. Observe multi-table joins, shrinkage calculations, and alert counts calculated on-the-fly.

**Expected Result:**  
Dashboard summary metrics should be cached with a 30s to 60s TTL or updated asynchronously via triggers/materialized views.

**Actual Result:**  
Every request forces real-time aggregation across `inventory`, `products`, `stock_movements`, and `alerts` tables simultaneously.

**Developer Task:**  
Introduce response caching with stale-while-revalidate for `/api/dashboard`, or maintain pre-calculated summary tables updated via database triggers.

**Status:**  
Open

**QA Reviewer:**  
Jaymartimpas0-prog

---

### Finding 3: Missing Pagination on Administrative List Endpoints

**Issue:**  
Users and Roles Endpoints Return Unbounded Result Sets Without Pagination

**Repository:**  
Backend

**Area:**  
`src/controllers/users.controller.js` (Line 35), `src/controllers/roles.controller.js` (Line 10)

**Priority:**  
P2

**Severity:**  
Medium

**Steps to Reproduce:**
1. Query `GET /api/users`.
2. Inspect response payload and query structure.
3. Note absence of `page`, `limit`, `offset`, or cursor parameters.

**Expected Result:**  
All list endpoints should enforce default page size (e.g., `limit=25`, max 100) and return standard pagination metadata (`page`, `totalPages`, `totalCount`).

**Actual Result:**  
Entire `users` table is returned in a single array. As employee records grow, payload sizes and memory consumption will degrade server responsiveness.

**Developer Task:**  
Add standard offset or keyset pagination schema to `GET /api/users` with maximum limit enforcement.

**Status:**  
Open

**QA Reviewer:**  
Jaymartimpas0-prog

---

### Finding 4: Lack of Route-Specific Rate Limiting on Resource-Intensive APIs

**Issue:**  
Global Rate Limiter Does Not Restrict Expensive Analytics and Export Endpoints

**Repository:**  
Backend

**Area:**  
`src/app.js` (Lines 22-26)

**Priority:**  
P3

**Severity:**  
Low

**Steps to Reproduce:**
1. Send high-frequency requests to `/api/reports` or `/api/movements/summary`.
2. Observe only generic global rate limiter (100 req/min) is applied across all routes equally.

**Expected Result:**  
Heavy computational endpoints (summaries, reports, aggregations) should have stricter rate limits than standard CRUD operations to prevent denial-of-service via resource exhaustion.

**Actual Result:**  
Uniform rate limit applied globally without tiering for computationally expensive database endpoints.

**Developer Task:**  
Apply tiered rate limit middleware for analytical/export endpoints (e.g., maximum 20 requests per minute).

**Status:**  
Open

**QA Reviewer:**  
Jaymartimpas0-prog
