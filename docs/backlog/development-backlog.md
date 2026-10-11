# Development Backlog

**Author:** jhnyz (Project Manager)  
**Status:** Approved for Backlog Scheduling  
**Review Date:** 2026-10-11  

---

### Backlog Item 1: Restrict Password Resets and Block Super Admin Account Takeover
- **Task:** Prevent Subordinate Password Resets on Super Admin Accounts (IDOR)
- **Source:** QA Review `docs/qa/data-isolation.md` (Finding 1)
- **Repository:** Backend
- **Priority:** P0
- **Owner:** Backend Developer
- **Status:** Backlog
- **Dependencies:** None
- **Acceptance Criteria:**
  - Non-super-admin accounts cannot invoke `POST /api/users/:id/password` targeting Super Admin accounts.
  - Attempting to reset a Super Admin's password as a non-super-admin returns HTTP 403 Forbidden.
  - Self-password reset is validated against current password.
- **QA Required:** Yes

---

### Backlog Item 2: Restrict Role Promotion to Super Admin Tier
- **Task:** Enforce Super Admin Exclusivity for Administrative Role Elevation
- **Source:** QA Review `docs/qa/data-isolation.md` (Finding 2)
- **Repository:** Backend
- **Priority:** P0
- **Owner:** Backend Developer
- **Status:** Backlog
- **Dependencies:** None
- **Acceptance Criteria:**
  - `PATCH /api/users/:id` rejects requests assigning `role_id` of Super Admin unless requesting caller is an active Super Admin.
  - Non-super-admins cannot elevate their own role or any peer user's role.
  - Returns HTTP 403 Forbidden with clear error message when non-super-admin attempts role elevation.
- **QA Required:** Yes

---

### Backlog Item 3: Implement Multi-Tenant and Organization Scoping Boundaries
- **Task:** Architect Tenant & Organization Scoping for Data Isolation
- **Source:** QA Review `docs/qa/data-isolation.md` (Finding 3)
- **Repository:** Backend
- **Priority:** P0
- **Owner:** Backend Developer
- **Status:** Backlog
- **Dependencies:** None
- **Acceptance Criteria:**
  - Data schema supports organizational or tenant boundaries (`tenant_id`/`org_id`).
  - Users from Organization A cannot view or mutate inventory, products, or suppliers of Organization B.
  - Cross-tenant requests return HTTP 404 or 403.
- **QA Required:** Yes

---

### Backlog Item 4: Implement Server-Side Token Invalidation on Logout
- **Task:** Invalidate Supabase Auth Session on User Logout
- **Source:** QA Review `docs/qa/super-admin-auth.md` (Finding 1)
- **Repository:** Backend
- **Priority:** P1
- **Owner:** Backend Developer
- **Status:** Backlog
- **Dependencies:** None
- **Acceptance Criteria:**
  - `POST /api/auth/logout` calls Supabase auth admin signOut or token revocation service.
  - Subsequent requests with the previously issued access token return HTTP 401 Unauthorized.
  - Refresh tokens belonging to the session are revoked.
- **QA Required:** Yes

---

### Backlog Item 5: Protect Roles Listing and Prevent Lateral Role Modification
- **Task:** Secure Role Endpoints and Prevent Role Privilege Escalation
- **Source:** QA Review `docs/qa/backend-permissions.md` (Findings 1, 2)
- **Repository:** Backend
- **Priority:** P1
- **Owner:** Backend Developer
- **Status:** Backlog
- **Dependencies:** None
- **Acceptance Criteria:**
  - `GET /api/roles` requires `roles.view` or `roles.manage` permission.
  - `PUT /api/roles/:id/permissions` allows modifying roles only if caller holds `super_admin` role.
  - Non-super-admins cannot grant permissions they do not possess.
- **QA Required:** Yes

---

### Backlog Item 6: Guard Demo Credentials on Production Sign-In
- **Task:** Secure Login Page and Remove Hardcoded Demo Passwords from Bundle
- **Source:** QA Review `docs/qa/super-admin-login.md` (Finding 1)
- **Repository:** Frontend
- **Priority:** P1
- **Owner:** Frontend Developer
- **Status:** Backlog
- **Dependencies:** None
- **Acceptance Criteria:**
  - Demo accounts panel is only visible when `import.meta.env.DEV` is true.
  - Production build bundle contains zero hardcoded password strings.
  - Form requires manual credential entry in production environments.
- **QA Required:** Yes

---

### Backlog Item 7: Prevent Client-Side Permission Tampering in LocalStorage
- **Task:** Cryptographically Verify Client Permissions on Session Rehydration
- **Source:** QA Review `docs/qa/frontend-permissions.md` (Finding 1)
- **Repository:** Frontend
- **Priority:** P1
- **Owner:** Frontend Developer
- **Status:** Backlog
- **Dependencies:** Backlog Item 5
- **Acceptance Criteria:**
  - Client state does not grant route access based solely on unverified `localStorage` strings.
  - Application verifies profile permissions with `GET /api/auth/me` on startup.
  - Manually edited localStorage triggers re-sync and restores true permissions.
- **QA Required:** Yes

---

### Backlog Item 8: Prevent Duplicate Submissions on Action Buttons
- **Task:** Add Busy/Disabled States to Action Buttons During Mutation Submissions
- **Source:** QA Review `docs/qa/system-loading-states.md` (Finding 2)
- **Repository:** Frontend
- **Priority:** P1
- **Owner:** Frontend Developer
- **Status:** Backlog
- **Dependencies:** None
- **Acceptance Criteria:**
  - Action buttons enter disabled state immediately upon click.
  - Loading spinner indicator displays inside the button during in-flight requests.
  - Rapid double-clicks produce only one network request.
- **QA Required:** Yes

---

### Backlog Item 9: Implement Responsive Mobile Navigation Drawer
- **Task:** Build Hamburger Mobile Navigation Drawer for Small Viewports
- **Source:** QA Review `docs/qa/ui-ux-consistency.md` (Finding 1)
- **Repository:** Frontend
- **Priority:** P1
- **Owner:** Frontend Developer
- **Status:** Backlog
- **Dependencies:** None
- **Acceptance Criteria:**
  - Viewports below 1024px display a hamburger menu icon in the topbar.
  - Clicking hamburger opens a sliding drawer containing all navigation links.
  - Drawer closes upon navigation link selection or backdrop click.
- **QA Required:** Yes

---

### Backlog Item 10: Optimize Authentication Middleware Query Overhead
- **Task:** Cache Decoded User Profiles in Auth Middleware
- **Source:** QA Review `docs/qa/api-performance.md` (Finding 1)
- **Repository:** Backend
- **Priority:** P2
- **Owner:** Backend Developer
- **Status:** Backlog
- **Dependencies:** Backlog Item 4
- **Acceptance Criteria:**
  - `authenticate.js` uses an in-memory cache (TTL 60 seconds) for profile and permissions.
  - Eliminates 2 redundant database queries per request.
  - Cache is invalidated when user profile or role is updated.
- **QA Required:** Yes

---

### Backlog Item 11: Add Client-Side Navigation Data Caching
- **Task:** Preserve Dashboard and Table Data Across Route Navigations
- **Source:** QA Review `docs/qa/rendering-and-caching.md` (Finding 1)
- **Repository:** Frontend
- **Priority:** P2
- **Owner:** Frontend Developer
- **Status:** Backlog
- **Dependencies:** None
- **Acceptance Criteria:**
  - Returning to `/dashboard` renders cached data instantly without full-screen loading spinner.
  - Background revalidation updates metrics silently if stale.
  - Eliminates flickering on frequent route transitions.
- **QA Required:** Yes

---

### Backlog Item 12: Add Skeleton Loaders for Data-Heavy Views
- **Task:** Replace Plaintext "Loading..." Strings with Structural Skeleton Loaders
- **Source:** QA Review `docs/qa/system-loading-states.md` (Finding 1)
- **Repository:** Frontend
- **Priority:** P2
- **Owner:** Frontend Developer
- **Status:** Backlog
- **Dependencies:** None
- **Acceptance Criteria:**
  - Dashboard renders pulsing stat card and chart container skeletons during initial fetch.
  - Inventory and reports tables render skeleton rows instead of plain text centered div.
  - Eliminates cumulative layout shift (CLS).
- **QA Required:** Yes

---

### Backlog Item 13: Improve Horizontal Graph Visualization and Responsiveness
- **Task:** Add Tooltips, Logarithmic/Minimum Width Scaling, and Fix Encoding Artifacts
- **Source:** QA Review `docs/qa/horizontal-graph.md` (Findings 1, 2, 3)
- **Repository:** Frontend
- **Priority:** P2
- **Owner:** Frontend Developer
- **Status:** Backlog
- **Dependencies:** None
- **Acceptance Criteria:**
  - Hovering on horizontal bars displays tooltip with value, count, and percentage.
  - Small non-zero values enforce a minimum visible bar width of 2% / 6px.
  - Broken UTF-8 character artifact `A` is replaced with standard bullet separator.
  - Labels wrap responsively on mobile without colliding with numeric values.
- **QA Required:** Yes

---

### Backlog Item 14: Fix Client-Side Routing Trapping and Navigation State Persistence
- **Task:** Fix Forbidden History Trapping and Sync Table Filters to URL Query
- **Source:** QA Review `docs/qa/client-side-routing.md` (Finding 1), `rendering-and-caching.md` (Finding 3)
- **Repository:** Frontend
- **Priority:** P2
- **Owner:** Frontend Developer
- **Status:** Backlog
- **Dependencies:** None
- **Acceptance Criteria:**
  - Forbidden redirects use `router.replace` so browser Back does not trap user.
  - Table search, filter, and page states are synchronized with URL query params.
  - Navigating back from `/inventory/:id` restores previous table filter and page.
- **QA Required:** Yes

---

### Backlog Item 15: Standardize Deletion Confirmations and Form UI Elements
- **Task:** Standardize UI Modals, Spacing, and Table Cell Pinning
- **Source:** QA Review `docs/qa/ui-ux-consistency.md` (Findings 2, 3)
- **Repository:** Frontend
- **Priority:** P3
- **Owner:** Frontend Developer
- **Status:** Backlog
- **Dependencies:** Backlog Item 9
- **Acceptance Criteria:**
  - Replace all native `window.confirm()` calls with `ModalDialog.vue` danger modals.
  - Primary SKU column is sticky-pinned on mobile data tables.
  - Consistent padding and input heights applied across forms.
- **QA Required:** Yes
