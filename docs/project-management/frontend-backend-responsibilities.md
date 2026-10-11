# Project Management: Frontend and Backend Engineering Responsibilities Matrix

**Author:** jhnyz (Project Manager)  
**Classification:** Team Assignment & Ownership Specification  
**Date:** 2026-10-11  

---

## 1. Overview

This matrix clearly defines the architectural and implementation boundaries between Frontend and Backend engineering teams to prevent overlap, eliminate security gaps, and streamline delivery.

---

## 2. Frontend Engineering Responsibilities

The Frontend Developer is exclusively responsible for the user interface presentation layer, client-side state, client caching, and local interaction handling in `markitechdev/Frontend`:

- **Super Admin Login UI & Validation:**
  - Responsive login view layout (mobile, tablet, desktop).
  - Client-side field pre-validation (email format, minimum password length).
  - Clear, accessible field-level error messages and status borders.
  - Form busy/loading states and disabling submit buttons during in-flight requests.
  - Elimination of hardcoded demo accounts in production environment builds.
- **Client-Side Routing & Navigation:**
  - Protected route navigation guards (`router.beforeEach`).
  - Role-based routing and redirection logic.
  - Redirection of authenticated users away from `/login`.
  - Fix browser Back history trapping on Access Denied (`/forbidden`) page.
  - 404 Not Found page presentation and navigation return paths.
  - Hierarchical breadcrumbs on deep product detail routes (`/inventory/:id`).
- **State Management & Caching:**
  - In-memory Pinia store caching for dashboard metrics and inventory lists to prevent redundant re-fetching.
  - Search input debouncing (350ms) across all tables.
  - Table search, filter, and pagination synchronization with URL query parameters.
- **Loading States & Feedback:**
  - Implementation of structural skeleton loaders for stat cards and data tables.
  - Disabling action buttons during mutations to prevent double-click duplicate requests.
  - In-component error and retry state triggers when APIs fail.
- **Horizontal Graph & Visualization:**
  - Interactive hover tooltips showing values, counts, and percentage shares.
  - Minimum visual bar width constraint (2% / 6px) to keep small values visible.
  - Responsive text wrapping and correction of character encoding mojibake artifacts.
  - Contextual scale indicators for single-item datasets.
- **UI/UX Consistency:**
  - Mobile slide-out navigation drawer with topbar hamburger menu toggle.
  - Unified modal confirmation dialogs for destructive actions (replacing `window.confirm`).
  - Sticky-pinned primary product columns on mobile table viewports.
  - Consistent typography, spacing, inputs, and button themes across modules.

---

## 3. Backend Engineering Responsibilities

The Backend Developer is exclusively responsible for data integrity, server-side security enforcement, API performance, and database architecture in `markitechdev/Backend`:

- **Super Admin Authentication & Session Security:**
  - Token revocation and active session invalidation in Supabase Auth on `POST /api/auth/logout`.
  - Refresh token validation, token rotation enforcement, and client anomaly handling.
  - Evaluation of Multi-Factor Authentication (MFA) requirements for privileged roles.
- **Authorization & Permission Verification:**
  - Independent server-side permission checks across all API routes (`requirePermission`, `requireRole`).
  - Restricting `GET /api/roles` to authorized administrative roles.
  - Blocking non-super-admin users from elevating roles or modifying role permissions.
- **Data Isolation & Multi-Tenancy (CRITICAL P0):**
  - Elimination of Insecure Direct Object Reference (IDOR) on password reset endpoints.
  - Blocking unauthorized password resets or role promotions targeting Super Admin accounts.
  - Architecture of multi-tenant/organization foreign keys (`tenant_id`/`org_id`) and query scoping.
  - Redaction of sensitive personal contact information in public employee directory APIs.
- **API Performance & Database Optimization:**
  - In-memory caching for decoded user profiles and permissions in `authenticate.js` middleware.
  - Optimization and caching of dashboard analytical calculations.
  - Offset or cursor pagination schema on employee and role listing endpoints.
  - Route-specific tiered rate limiting on computationally heavy endpoints.

---

## 4. Shared Cross-Functional Responsibilities

Areas requiring close collaboration and joint testing between Frontend and Backend engineers:

- **End-to-End Authentication Workflow:**
  - Contract alignment on JWT token formats, expiration codes (HTTP 401), and refresh payloads.
- **Roles & Permissions Contract Alignment:**
  - Synchronization between backend database permission codes and frontend route metadata.
- **Data Isolation Verification:**
  - Joint testing ensuring frontend UI masks and backend API 403 guards align seamlessly.
- **Error Handling Standards:**
  - Standardized JSON error response shapes (`{ error: { message, code, details } }`).
- **Security & Penetration Testing:**
  - Cross-validation with QA Reviewer using simulated attacker profiles.
