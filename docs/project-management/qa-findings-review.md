# Project Management: Review of QA Findings

**Author:** jhnyz (Project Manager)  
**Email:** lavinajhanyz029@gmail.com  
**Source QA Reviewer:** Jaymartimpas0-prog  
**Date:** 2026-10-11  

---

## 1. Executive Summary

This document consolidates and organizes the comprehensive QA assessment conducted by QA Reviewer Jaymartimpas0-prog across the IMS Frontend (`markitechdev/Frontend`) and Backend (`markitechdev/Backend`) repositories. 

Findings have been categorized across the 11 core functional and security domains to establish a single source of truth for engineering planning and remediation.

---

## 2. Review by Domain Area

### 2.1 Super Admin Login
- **Repository:** Frontend
- **Key Issues:** Hardcoded demo credentials and passwords rendered on sign-in UI; missing client-side input length pre-validation; generic error display with no field association.
- **Responsibility:** Frontend Developer

### 2.2 Authentication and Sessions
- **Repository:** Backend
- **Key Issues:** `POST /api/auth/logout` fails to revoke Supabase JWT session server-side; lack of Multi-Factor Authentication (MFA) for Super Admin role; unauthenticated refresh token replay without device/IP fingerprinting.
- **Responsibility:** Backend Developer

### 2.3 Rendering and Caching
- **Repository:** Frontend
- **Key Issues:** Components destroy and refetch data on every route navigation without client-side cache; reports view triggers 4 simultaneous unmemoized endpoints; search inputs lack debouncing; table pagination/filter state lost on Back navigation.
- **Responsibility:** Frontend Developer

### 2.4 API Performance
- **Repository:** Backend
- **Key Issues:** `authenticate` middleware executes 3 database queries per HTTP request (150ms-350ms overhead); uncached heavy dashboard aggregations; unpaginated employee list queries (`/api/users`).
- **Responsibility:** Backend Developer

### 2.5 Loading States
- **Repository:** Frontend
- **Key Issues:** Raw text "Loading..." placeholders causing cumulative layout shift (CLS); no skeleton loaders; modal action buttons lack busy state allowing rapid duplicate clicks.
- **Responsibility:** Frontend Developer

### 2.6 Horizontal Graph
- **Repository:** Frontend
- **Key Issues:** "Alerts by Priority" and "Stock Value by Category" horizontal bars lack tooltips; linear scaling collapses low-volume categories to invisible 0.1% slivers; corrupt character encoding (`A`); single records scale to misleading 100%.
- **Responsibility:** Frontend Developer

### 2.7 Roles and Permissions
- **Repository:** Shared (Backend & Frontend)
- **Key Issues:** `GET /api/roles` is completely unauthenticated; non-super-admins holding `roles.manage` can elevate permissions of other roles; frontend permissions read from easily editable `localStorage` without server cryptographic verification.
- **Responsibility:** Backend Developer (Primary enforcement) + Frontend Developer (UI sync)

### 2.8 Client-Side Routing
- **Repository:** Frontend
- **Key Issues:** Browser Back button traps users in redirect loop on `/forbidden` page; missing breadcrumb navigation on deep routes (`/inventory/:id`); document title contains character artifacts.
- **Responsibility:** Frontend Developer

### 2.9 UI/UX Consistency
- **Repository:** Frontend
- **Key Issues:** Missing hamburger drawer navigation on mobile viewports (<1024px); mixed deletion confirmation patterns (browser `confirm()` vs styled modal); data tables overflow without sticky product identifiers on mobile.
- **Responsibility:** Frontend Developer

### 2.10 Super Admin Data Isolation (CRITICAL)
- **Repository:** Backend
- **Key Issues:** Non-super-admins with `users.manage` can dispatch `POST /api/users/:id/password` and overwrite Super Admin passwords (IDOR); non-super-admins can assign themselves `super_admin` role via `PATCH /api/users/:id`.
- **Responsibility:** Backend Developer

### 2.11 Unauthorized Data Access (CRITICAL)
- **Repository:** Backend
- **Key Issues:** Complete absence of multi-tenancy or client/organization scoping (`tenant_id` missing across all tables); employee directory (`GET /api/users`) broadcasts personal phone numbers and internal UUIDs to all staff.
- **Responsibility:** Backend Developer

---

## 3. Comprehensive QA Findings Summary Matrix

| Domain Area | QA Issue Title | Repository | Severity | Priority | Affected Area | Responsibility | Recommended Next Action |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Super Admin Data Isolation** | Super Admin Password Overwrite via IDOR | Backend | Critical | P0 | `users.controller.js` | Backend | Restrict password reset to hierarchical authority; prohibit targeting Super Admin accounts. |
| **Super Admin Data Isolation** | Vertical Privilege Escalation to Super Admin | Backend | Critical | P0 | `users.controller.js` | Backend | Enforce `requireRole('super_admin')` on all administrative role assignment requests. |
| **Unauthorized Data Access** | Missing Multi-Tenant / Organization Scoping | Backend | Critical | P0 | `01_schema.sql`, controllers | Backend | Add organization/tenant foreign keys and scope all catalog and inventory queries. |
| **Unauthorized Data Access** | Excessive Employee PII in Directory API | Backend | Medium | P2 | `users.controller.js` | Backend | Separate public directory DTO from private administrative user profiles. |
| **Authentication & Sessions** | Unrevoked JWT Sessions on Server Logout | Backend | Critical | P0 | `auth.controller.js` | Backend | Invoke Supabase auth admin signOut / blacklist revoked tokens on logout. |
| **Roles & Permissions** | Privilege Escalation via Role Modification | Backend | Critical | P0 | `roles.controller.js` | Backend | Disallow non-super-admins from granting permissions higher than their own tier. |
| **Roles & Permissions** | Client-Side Permission Tampering in LocalStorage | Frontend | High | P1 | `auth.js`, `router/index.js` | Frontend | Re-sync and verify permissions via signed token claims or `GET /api/auth/me` on launch. |
| **Roles & Permissions** | Unprotected `GET /api/roles` Endpoint | Backend | High | P1 | `roles.routes.js` | Backend | Add `requirePermission('roles.view')` to the role listing route. |
| **Super Admin Login** | Exposed Hardcoded Demo Credentials | Frontend | High | P1 | `LoginView.vue` | Frontend | Strip demo accounts from production bundle using `import.meta.env.DEV` guards. |
| **Loading States** | Unprotected Actions Allow Duplicate Submissions | Frontend | High | P1 | `ModalDialog.vue`, views | Frontend | Bind busy loading states and disable submit buttons during in-flight mutations. |
| **UI/UX Consistency** | Missing Mobile Navigation Drawer | Frontend | High | P1 | `AppLayout.vue`, `AppTopbar.vue` | Frontend | Build responsive mobile slide-out navigation drawer with hamburger toggle. |
| **Client-Side Routing** | Browser Back Trapping Loop on Forbidden Page | Frontend | Medium | P2 | `router/index.js` | Frontend | Use `router.replace({ name: 'forbidden' })` instead of push. |
| **API Performance** | Triple Database Query Overhead in Auth Middleware | Backend | High | P1 | `authenticate.js` | Backend | Introduce short-lived in-memory caching for user profiles and role permissions. |
| **Rendering & Caching** | Absence of Client-side Navigation Cache | Frontend | High | P1 | `DashboardView.vue`, stores | Frontend | Implement Pinia/SWR cache to preserve dashboard and catalog data on navigation. |
| **Horizontal Graph** | Scalability, Truncation & Hover Tooltip Deficiencies | Frontend | Medium | P2 | `DashboardView.vue`, `ReportsView.vue` | Frontend | Add tooltips, enforce minimum bar width, fix encoding artifacts (`A`). |
| **Loading States** | Lack of Skeleton Loaders (Layout Shifts) | Frontend | Medium | P2 | Core Views | Frontend | Implement structured skeleton card and table loaders. |
