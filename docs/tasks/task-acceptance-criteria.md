# Task Acceptance Criteria & Verification Standards

**Author:** jhnyz (Project Manager)  
**Classification:** Quality Assurance & Developer Delivery Contracts  
**Date:** 2026-10-11  

---

## 1. Overview

Each task in the engineering pipeline must satisfy all stated acceptance criteria before being advanced from `IN PROGRESS` to `FOR QA`. QA Reviewer Jaymartimpas0-prog will test against these exact criteria.

---

## 2. Major Task Acceptance Criteria

### Task 1: Fix Super Admin Data Isolation & IDOR Password Reset
- **Task ID:** TASK-SEC-01 (Backend)
- **Priority:** P0 (Critical)
- **Acceptance Criteria:**
  1. User from Client/Organization A cannot query, view, or mutate Client B data.
  2. Subordinate accounts holding `users.manage` cannot reset passwords for Super Admin accounts via `POST /api/users/:id/password`.
  3. Attempting to target a Super Admin account returns HTTP 403 Forbidden with `{ "error": "Insufficient privileges to modify Super Admin credentials" }`.
  4. Non-super-admin users cannot promote any user account to `super_admin` role via `PATCH /api/users/:id`.
  5. Super Admin role modifications strictly require the caller to hold `super_admin` role (`requireRole('super_admin')`).
  6. QA can verify isolation and blocked privilege escalations using authorized test profiles.

---

### Task 2: Improve Super Admin Login & UI Security
- **Task ID:** TASK-AUTH-01 (Frontend)
- **Priority:** P1 (High)
- **Acceptance Criteria:**
  1. Demo accounts panel is strictly hidden and excluded from production builds (`import.meta.env.DEV`).
  2. Input fields enforce pre-validation: email must match standard email regex; password must be >= 6 characters.
  3. Empty fields trigger accessible, highlighted inline error labels below the input.
  4. Invalid credentials display a clear, accessible error alert without clearing the email field.
  5. Submit button is disabled and displays a loading spinner during authentication request processing.
  6. Rapid multiple clicks do not trigger redundant network requests.
  7. Successful login smoothly redirects to `/dashboard` or the prior attempted URL.
  8. Authenticated users navigating to `/login` are automatically bounced to `/dashboard`.
  9. Layout renders without horizontal overflow or clipping across mobile, tablet, and desktop viewports.

---

### Task 3: Fix Backend Roles and Permissions Enforcement
- **Task ID:** TASK-RBAC-01 (Backend)
- **Priority:** P1 (High)
- **Acceptance Criteria:**
  1. `GET /api/roles` is secured behind `requirePermission('roles.view')` or `requirePermission('roles.manage')`.
  2. `PUT /api/roles/:id/permissions` allows permission reassignment only when caller is a Super Admin.
  3. Subordinate roles cannot grant permissions beyond their own assigned permission set.
  4. Restricted API endpoints consistently return HTTP 403 Forbidden with structured error payloads when callers lack required permissions.
  5. QA can independently test View, Create, Edit, Delete, and Manage endpoints with custom test roles.

---

### Task 4: Invalidate Server-Side Session on Logout
- **Task ID:** TASK-AUTH-02 (Backend)
- **Priority:** P1 (High)
- **Acceptance Criteria:**
  1. `POST /api/auth/logout` calls Supabase auth admin signOut to revoke the active session.
  2. Any subsequent HTTP request utilizing the revoked access token returns HTTP 401 Unauthorized.
  3. Associated refresh token is immediately invalidated and rejected on `POST /api/auth/refresh`.

---

### Task 5: Add System Loading States and Skeletons
- **Task ID:** TASK-UI-01 (Frontend)
- **Priority:** P2 (Medium)
- **Acceptance Criteria:**
  1. Data-driven views (`/dashboard`, `/inventory`, `/reports`) render pulsing skeleton cards and tables during loading.
  2. Plain text centered "Loading..." placeholders are completely eliminated, preventing cumulative layout shift (CLS).
  3. Modal and form action buttons enter disabled state with spinner immediately upon submission click.
  4. Duplicate mutation requests are blocked.
  5. When an API call fails, the container displays an in-component error banner with an actionable "Retry" button.
  6. Blank screens are completely prevented.

---

### Task 6: Optimize API and Middleware Performance
- **Task ID:** TASK-PERF-01 (Backend)
- **Priority:** P2 (Medium)
- **Acceptance Criteria:**
  1. `authenticate.js` middleware caches user profiles and permission arrays in memory (TTL 60s).
  2. Reduces database round-trips from 3 queries per HTTP request to 0 queries on warm cache hits.
  3. Profile updates or role reassignments immediately invalidate the cached user record.
  4. Average authentication middleware processing latency drops below 15ms.

---

### Task 7: Client-Side Data Caching & Filter Persistence
- **Task ID:** TASK-PERF-02 (Frontend)
- **Priority:** P2 (Medium)
- **Acceptance Criteria:**
  1. Navigating from `/dashboard` to other routes and returning renders data instantly from store cache.
  2. Background revalidation silently checks for updated metrics.
  3. Table search inputs enforce 350ms debouncing before triggering API requests.
  4. Search query, status filter, and current page number are synchronized with URL query parameters (`route.query`).
  5. Navigating back from `/inventory/:id` restores exact previous search filter and table pagination page.

---

### Task 8: Improve Horizontal Graph Visualization
- **Task ID:** TASK-UI-02 (Frontend)
- **Priority:** P2 (Medium)
- **Acceptance Criteria:**
  1. Hovering on any horizontal bar displays a tooltip showing exact value, unit count, and percentage share.
  2. Low-volume categories enforce a minimum rendered bar width (2% / 6px) to remain visually identifiable.
  3. Mojibake character artifact (`A`) in `ReportsView.vue` is replaced with standard bullet separator (`•`).
  4. Bar labels wrap responsively on mobile devices without overlapping right-aligned monetary values.
  5. Single-record datasets display scale indicators rather than stretching to misleading 100% capacity.

---

### Task 9: Fix Client-Side Routing Trapping & History Integrity
- **Task ID:** TASK-NAV-01 (Frontend)
- **Priority:** P2 (Medium)
- **Acceptance Criteria:**
  1. Access Denied redirects execute via `router.replace({ name: 'forbidden' })`.
  2. Clicking browser "Back" on `/forbidden` cleanly returns to the previous accessible view without redirect looping.
  3. Document titles render clean separators (`Dashboard | IMS`) without character artifacts.
  4. Breadcrumbs on `/inventory/:id` provide a one-click return path to `/inventory`.

---

### Task 10: Mobile Navigation Drawer & UI Standardization
- **Task ID:** TASK-UI-03 (Frontend)
- **Priority:** P3 (Improvement)
- **Acceptance Criteria:**
  1. Topbar renders a hamburger toggle button on viewports narrower than 1024px.
  2. Tapping the hamburger opens a slide-over mobile drawer containing all accessible navigation links.
  3. All item deletions use `ModalDialog.vue` with danger styling, eliminating native `window.confirm()`.
  4. Primary SKU/Name column on mobile tables is sticky-pinned on horizontal scroll.
