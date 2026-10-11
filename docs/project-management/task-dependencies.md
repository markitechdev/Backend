# Project Management: Task Dependencies & Blocker Analysis

**Author:** jhnyz (Project Manager)  
**Classification:** Critical Path & Sequencing Map  
**Date:** 2026-10-11  

---

## 1. Critical Dependency Map

To guarantee system stability, tasks must be sequenced strictly according to architectural prerequisites. Frontend tasks that depend on backend enforcement must not be certified by QA until the underlying backend contracts are completed.

```
[TASK-SEC-01: Backend Data Isolation & Password Takeover]
       |
       v
[TASK-RBAC-01: Backend Roles & Permissions Enforcement]
       |
       +------------------------------------+
       |                                    |
       v                                    v
[TASK-AUTH-02: Backend Session Revocation]  [TASK-AUTH-01: Frontend Login UI]
       |                                    |
       +------------------+-----------------+
                          |
                          v
         [TASK-NAV-01: Protected Routing & Guards]
                          |
                          v
     [TASK-PERF-01/02: API & Frontend Data Caching]
                          |
                          v
      [TASK-UI-01/02: Skeletons, Loaders & Graphs]
                          |
                          v
      [TASK-UI-03: Responsive Navigation Drawer & Polish]
```

---

## 2. Explicit Precedence Rules

1. **Backend Authorization BEFORE Frontend Permission Certification:**
   - Frontend permission hiding (`v-if="auth.can(...)"`) is merely a visual aid. The security posture cannot be signed off by QA until backend routes enforce `requirePermission` independently.
2. **Tenant/Organization Isolation BEFORE Data Leaks Resolved:**
   - Super Admin cross-tenant data leaks cannot be marked resolved until organizational database keys and query scoping are applied at the database and controller layer.
3. **Session Invalidation on Logout BEFORE Protected Routing QA:**
   - Client-side navigation guards cannot be fully verified for session expiration until the backend `POST /api/auth/logout` endpoint actually revokes tokens in Supabase Auth.
4. **Backend Role Modification Guard BEFORE Frontend Role UI QA:**
   - The UI for managing role permissions (`RolesView.vue`) cannot be certified until the backend blocks non-super-admins from elevating permissions.
5. **API Error Response Standardization BEFORE Frontend Error State Integration:**
   - Frontend retry states and toast error handling require deterministic HTTP error status codes (401 vs 403 vs 404 vs 429) from backend endpoints.
6. **Backend Dashboard/Report Aggregation BEFORE Final Graph QA:**
   - Final visual testing of horizontal bar scaling and category valuation requires real database aggregates matching pagination schemas.

---

## 3. Identified Blockers & Technical Constraints

### Blocker 1: Service Role Key Architecture in Express Server
- **Description:** The Express backend uses `supabaseAdmin` (`service_role` key) for all queries, completely bypassing PostgreSQL Row Level Security (RLS) policies defined in `03_rls.sql`.
- **Impact:** Any omission of a middleware permission check in Express immediately grants full superuser database access.
- **Remediation Strategy:** Every Express route must have mandatory explicit middleware guards, and multi-tenant scoping must be enforced inside every controller query until scoped user JWT clients are introduced.

### Blocker 2: Supabase Session Invalidation Limitation
- **Description:** Stateless JWT access tokens remain valid until expiration unless blacklisted or revoked via Supabase Auth Admin.
- **Impact:** Calling logout currently does not revoke in-flight JWTs.
- **Remediation Strategy:** Backend must call `supabaseAdmin.auth.admin.signOut(token)` or maintain a Redis/memory token blacklist for active sessions.

### Blocker 3: LocalStorage Permission Vulnerability
- **Description:** Frontend permissions currently hydrate from editable `localStorage`.
- **Impact:** Even if route guards are written, users can unlock UI components locally by editing storage.
- **Remediation Strategy:** Task `TASK-AUTH-01` must re-verify user claims with `GET /api/auth/me` on every app launch.
