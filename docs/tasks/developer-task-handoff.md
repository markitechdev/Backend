# Project Management: Developer Task Handoff & Implementation Sequence

**Author:** jhnyz (Project Manager)  
**Classification:** Engineering Handoff Package & Sprint Dispatch  
**Date:** 2026-10-11  

---

## 1. Handoff Guidelines for Engineering Team

Developers must observe the following procedural rules:
1. **No Simultaneous Full-Stack Implementation:** Work strictly on individual assigned tasks or closely coupled mini-groups.
2. **Strict Development Sequence:** Adhere strictly to the numbered sequence below. Security and isolation tasks must be completed and certified before UI enhancements begin.
3. **Branching Model:** Create a separate Git feature branch for each task (e.g. `feature/task-01-super-admin-data-isolation`). Do not push unfinished work directly to `main`.
4. **Handoff for QA:** When development is finished, change task status to `FOR QA` and submit to QA Reviewer Jaymartimpas0-prog.

---

## 2. Recommended Development Sequence & Task Specifications

### Order 1: Super Admin Data Isolation & Password Takeover Fix
- **Task:** Eliminate IDOR in Password Reset & Restrict Role Promotion
- **Repository:** Backend (`markitechdev/Backend`)
- **Priority:** P0 (Critical)
- **QA Source:** `docs/qa/data-isolation.md` (Findings 1, 2)
- **Owner:** Backend Developer
- **Current Status:** READY
- **Dependencies:** None
- **Requirements:**
  - In `users.controller.js` `resetPassword`: Check target user's role. If target is `super_admin`, require caller to also be `super_admin`.
  - In `users.controller.js` `updateUser`: If `patch.role_id` sets or changes to `super_admin`, require caller to hold `super_admin` role.
- **Acceptance Criteria:**
  - Non-super-admins cannot overwrite Super Admin passwords (returns 403).
  - Non-super-admins cannot elevate user accounts to Super Admin (returns 403).
- **Expected QA Verification:**
  - QA tests password reset and role patch using Staff Admin and Warehouse Admin accounts; confirms HTTP 403 Forbidden.

---

### Order 2: Backend Authorization & Route Protection
- **Task:** Enforce Authorization Checks on Unprotected Administrative Endpoints
- **Repository:** Backend (`markitechdev/Backend`)
- **Priority:** P1 (High)
- **QA Source:** `docs/qa/backend-permissions.md` (Finding 1)
- **Owner:** Backend Developer
- **Current Status:** READY
- **Dependencies:** Order 1
- **Requirements:**
  - Add `requirePermission('roles.view')` or `requirePermission('roles.manage')` to `GET /api/roles`.
  - Enforce permission checks on all sensitive sub-routes.
- **Acceptance Criteria:**
  - Unauthenticated or unauthorized callers receive HTTP 403 Forbidden on `/api/roles`.
- **Expected QA Verification:**
  - Direct API curl/postman calls with low-privilege tokens are rejected with 403.

---

### Order 3: Roles and Permissions Modification Hardening
- **Task:** Restrict Role Permissions Reassignment to Super Admin
- **Repository:** Backend (`markitechdev/Backend`)
- **Priority:** P1 (High)
- **QA Source:** `docs/qa/backend-permissions.md` (Finding 2)
- **Owner:** Backend Developer
- **Current Status:** READY
- **Dependencies:** Order 2
- **Requirements:**
  - In `roles.controller.js` `updateRolePermissions`: Require caller to be Super Admin (`requireRole('super_admin')`).
  - Prohibit non-super-admins from granting permissions they do not possess.
- **Acceptance Criteria:**
  - Subordinate managers cannot elevate permission sets of other roles.
- **Expected QA Verification:**
  - QA tests role permission modification with non-super-admin token; confirms 403.

---

### Order 4: Super Admin Authentication & Session Invalidation
- **Task:** Implement Active Session Revocation on User Logout
- **Repository:** Backend (`markitechdev/Backend`)
- **Priority:** P1 (High)
- **QA Source:** `docs/qa/super-admin-auth.md` (Finding 1)
- **Owner:** Backend Developer
- **Current Status:** READY
- **Dependencies:** None
- **Requirements:**
  - Call Supabase Auth admin signOut API on `POST /api/auth/logout`.
  - Invalidate access token and refresh token.
- **Acceptance Criteria:**
  - Subsequent requests with the logged-out token return HTTP 401 Unauthorized.
- **Expected QA Verification:**
  - QA logs out, copies the previous token, attempts `GET /api/users`, verifies 401 error.

---

### Order 5: Protected Routing & History Integrity
- **Task:** Fix Forbidden History Trapping & Verify Permissions on App Launch
- **Repository:** Frontend (`markitechdev/Frontend`)
- **Priority:** P1 (High)
- **QA Source:** `docs/qa/client-side-routing.md` (Finding 1), `frontend-permissions.md` (Finding 1)
- **Owner:** Frontend Developer
- **Current Status:** READY
- **Dependencies:** Order 4
- **Requirements:**
  - In `router/index.js`, use `router.replace({ name: 'forbidden' })`.
  - In `auth.js`, call `refreshProfile()` on startup to verify permissions with backend.
- **Acceptance Criteria:**
  - Browser Back from `/forbidden` exits cleanly without looping.
  - Edited localStorage permissions are overwritten by true server profile claims.
- **Expected QA Verification:**
  - QA manipulates localStorage and triggers Back button navigation; verifies no trapping.

---

### Order 6: Login UI & Demo Credential Removal
- **Task:** Strip Demo Accounts from Production & Add Field Pre-validation
- **Repository:** Frontend (`markitechdev/Frontend`)
- **Priority:** P1 (High)
- **QA Source:** `docs/qa/super-admin-login.md` (Findings 1, 2, 3)
- **Owner:** Frontend Developer
- **Current Status:** READY
- **Dependencies:** None
- **Requirements:**
  - Guard demo accounts with `import.meta.env.DEV`.
  - Add client-side validation rules for email and password.
  - Disable login submit button and show spinner during authentication.
- **Acceptance Criteria:**
  - Production build contains zero demo password strings.
  - Inline error labels appear on empty/invalid input fields.
- **Expected QA Verification:**
  - QA inspects production build bundle and verifies no credentials; tests form validation.

---

### Order 7: Rendering and Caching Optimization
- **Task:** Add Store Caching & Input Debouncing
- **Repository:** Both (`Frontend` primary, `Backend` support)
- **Priority:** P2 (Medium)
- **QA Source:** `docs/qa/rendering-and-caching.md`, `api-performance.md`
- **Owner:** Both
- **Current Status:** READY
- **Dependencies:** Order 4
- **Requirements:**
  - Frontend: Add Pinia SWR cache for dashboard; debounce search inputs (350ms); sync filters to URL query.
  - Backend: Cache decoded user profiles in `authenticate.js` memory cache (TTL 60s).
- **Acceptance Criteria:**
  - Navigating back to dashboard loads instantly without full-screen loading spinner.
  - Auth middleware latency drops under 15ms.
- **Expected QA Verification:**
  - QA monitors Network tab and verifies zero redundant calls on route re-entry.

---

### Order 8: Loading States & Skeletons
- **Task:** Build Skeleton Loaders & Block Duplicate Button Submissions
- **Repository:** Frontend (`markitechdev/Frontend`)
- **Priority:** P2 (Medium)
- **QA Source:** `docs/qa/system-loading-states.md`
- **Owner:** Frontend Developer
- **Current Status:** READY
- **Dependencies:** Order 7
- **Requirements:**
  - Create `CardSkeleton.vue` and `TableSkeleton.vue`.
  - Bind loading states to modal buttons; disable during in-flight requests.
- **Acceptance Criteria:**
  - Eliminates plaintext "Loading..." string and layout shifts.
  - Rapid double-clicks submit only one request.
- **Expected QA Verification:**
  - QA throttles network to Slow 3G and verifies skeleton rendering and disabled buttons.

---

### Order 9: Horizontal Graph Improvements
- **Task:** Implement Hover Tooltips, Minimum Width Scaling, and Fix Character Artifacts
- **Repository:** Frontend (`markitechdev/Frontend`)
- **Priority:** P2 (Medium)
- **QA Source:** `docs/qa/horizontal-graph.md`
- **Owner:** Frontend Developer
- **Current Status:** READY
- **Dependencies:** None
- **Requirements:**
  - Add tooltips to horizontal progress bars.
  - Apply `Math.max(2, percentage)` for visible bar widths on small quantities.
  - Replace `A` artifact with standard bullet separator.
- **Acceptance Criteria:**
  - Tooltips display exact value and percentage. Small categories remain visibly identifiable.
- **Expected QA Verification:**
  - QA hovers on bar elements and verifies tooltips and clean mobile wrapping.

---

### Order 10: UI/UX & Responsive Navigation Standardization
- **Task:** Build Mobile Hamburger Navigation Drawer & Standardize Modals
- **Repository:** Frontend (`markitechdev/Frontend`)
- **Priority:** P3 (Improvement)
- **QA Source:** `docs/qa/ui-ux-consistency.md`
- **Owner:** Frontend Developer
- **Current Status:** READY
- **Dependencies:** Order 8
- **Requirements:**
  - Build slide-over navigation drawer triggered by topbar hamburger toggle on mobile.
  - Replace `window.confirm()` with `ModalDialog.vue` danger dialogs.
  - Sticky-pin primary product SKU column on mobile data tables.
- **Acceptance Criteria:**
  - Mobile screens (<1024px) offer complete navigation drawer access.
  - Uniform modal styling across all delete actions.
- **Expected QA Verification:**
  - QA tests on mobile viewport (<768px) and performs deletions; verifies styling.
