# Project Management: Development Roadmap & Phasing Plan

**Author:** jhnyz (Project Manager)  
**Classification:** Sprint Execution & Staging Plan  
**Date:** 2026-10-11  

---

## 1. Overview

Development is structured into four sequential, milestone-driven phases. Each phase establishes a stable, verified foundation for subsequent work. Progression between phases requires sign-off from the Project Manager and QA Reviewer.

---

## 2. Phase Breakdown

### Phase 1: Security and Access Control (P0 Priority)
- **Primary Goal:** Protect sensitive data, eliminate account takeover vulnerabilities, and establish bulletproof backend access control.
- **Key Tasks:**
  1. Investigate and eliminate Super Admin password takeover vulnerability (IDOR).
  2. Implement role-hierarchy guards preventing non-super-admins from assigning the Super Admin role.
  3. Architect multi-tenant/organization foreign key columns (`tenant_id`) and query scoping.
  4. Restrict `GET /api/roles` endpoint with authorization middleware.
  5. Harden role permission mutation APIs to prevent privilege elevation.
  6. Implement server-side Supabase token revocation upon user logout.
  7. Conduct comprehensive unauthorized API penetration testing.
- **Primary Lead:** Backend Developer
- **Support Team:** Frontend Developer + QA Reviewer

---

### Phase 2: Authentication and Routing (P1 Priority)
- **Primary Goal:** Solidify the authentication flow, session persistence, and client-side route protection.
- **Key Tasks:**
  1. Remove hardcoded demo credentials and passwords from production sign-in view.
  2. Implement client-side input length pre-validation and field error styling on login.
  3. Ensure authenticated users cannot reopen the login page (automatic dashboard redirect).
  4. Implement robust 401 interceptor for invalid/expired sessions with seamless login redirection.
  5. Fix browser Back button history trapping on Access Denied (`/forbidden`) view using `router.replace`.
  6. Re-verify permissions cryptographically on application startup (block localStorage manipulation).
  7. Standardize 404 Not Found navigation and return paths.
- **Primary Lead:** Frontend Developer & Backend Developer
- **Support Team:** QA Reviewer

---

### Phase 3: Performance and Loading (P2 Priority)
- **Primary Goal:** Eliminate performance bottlenecks, add responsive caching, and provide smooth visual feedback.
- **Key Tasks:**
  1. Implement in-memory profile caching in backend `authenticate.js` to eliminate 3 queries per HTTP request.
  2. Implement client-side data caching in Pinia store with configurable TTL for dashboard and catalog views.
  3. Add 350ms debouncing on search and filter inputs across all data tables.
  4. Replace raw text "Loading..." placeholders with structural skeleton card and table loaders.
  5. Disable action buttons and display loading spinners during mutation submissions to block duplicate actions.
  6. Sync table search, filter, and pagination states to URL query parameters.
- **Primary Lead:** Frontend Developer & Backend Developer
- **Support Team:** QA Reviewer

---

### Phase 4: Dashboard, Graphs and UI Consistency (P2/P3 Priority)
- **Primary Goal:** Elevate usability, responsiveness, and enterprise visual consistency.
- **Key Tasks:**
  1. Add interactive hover tooltips with values and percentage shares to horizontal progress bars.
  2. Implement minimum bar width threshold (2% / 6px) to keep low-volume category bars visible.
  3. Fix character encoding mojibake artifacts (`A` -> bullet separator) and label text wrapping.
  4. Build a responsive mobile navigation drawer with hamburger toggle in the topbar.
  5. Replace native browser `window.confirm()` calls with custom `ModalDialog.vue` danger modals.
  6. Sticky-pin primary product columns on mobile table viewports.
  7. Polish design system typography, spacing, cards, and empty state illustrations.
- **Primary Lead:** Frontend Developer
- **Support Team:** QA Reviewer
