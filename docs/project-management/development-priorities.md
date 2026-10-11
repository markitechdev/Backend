# Project Management: Development Priorities Framework

**Author:** jhnyz (Project Manager)  
**Classification:** Engineering Governance & Prioritization Standard  
**Date:** 2026-10-11  

---

## 1. Priority Tiers & Categorization

To ensure effective resource allocation and immediate risk remediation, all development tasks for the IMS project are strictly classified into four priority tiers:

```
+-----------------------------------------------------------------------+
|  P0 - CRITICAL     (Data Isolation, Account Takeovers, Data Leaks)    |
|  P1 - HIGH         (Authentication, RBAC Enforcement, Route Guards)   |
|  P2 - MEDIUM       (Performance Caching, Loading States, Visuals)     |
|  P3 - IMPROVEMENT  (Design System, Responsive Polish, Microcopy)       |
+-----------------------------------------------------------------------+
```

---

## 2. Priority Definitions & Justifications

### 2.1 P0 — CRITICAL
- **Items Included:**
  - Super Admin data leaks and IDOR vulnerabilities.
  - Multi-tenant and client-level data isolation enforcement.
  - Unauthorized cross-account data access and password takeovers.
  - Vertical privilege escalation allowing users to self-promote to Super Admin.
- **Why This Priority Is Used:**  
  P0 represents an immediate existential threat to system integrity, business compliance, and data confidentiality. Any vulnerability that allows an unauthorized account to seize administrative control or view confidential cross-tenant business data must halt regular feature work and be resolved before production deployment.

---

### 2.2 P1 — HIGH
- **Items Included:**
  - Backend roles and permissions verification.
  - Frontend roles and permissions hardening against localStorage tampering.
  - Super Admin authentication security and session invalidation on logout.
  - Protected routing and server-side route authorization.
  - Elimination of hardcoded demo credentials in production bundles.
  - Prevention of duplicate action submissions on mutation buttons.
  - Responsive mobile navigation drawer for basic access.
- **Why This Priority Is Used:**  
  P1 items represent essential security and core architectural barriers. Without robust session management, verified RBAC enforcement, and functional mobile navigation, the system cannot reliably enforce user boundaries or support operational workflows.

---

### 2.3 P2 — MEDIUM
- **Items Included:**
  - Rendering optimization and client-side page caching (SWR/TTL).
  - API query performance improvements and middleware caching.
  - Elimination of triple database round-trips in authentication middleware.
  - Skeleton loaders to prevent cumulative layout shift (CLS).
  - Horizontal graph data visualization scaling, formatting, and tooltip inspection.
  - URL query synchronization for table search, filters, and pagination.
  - Prevention of browser history trapping loops on access-denied pages.
- **Why This Priority Is Used:**  
  P2 items directly impact daily system responsiveness, user satisfaction, and database scalability. While they do not introduce active security exploits, unmitigated performance bottlenecks and visual glitches severely hinder operational productivity.

---

### 2.4 P3 — IMPROVEMENT
- **Items Included:**
  - UI/UX consistency across buttons, inputs, tables, cards, and modals.
  - Replacement of native browser `confirm()` with custom modal dialogs.
  - Sticky identifier column pinning on mobile tables.
  - Spacing, typography, and visual design standardization.
  - Empty state illustrations and call-to-action buttons.
  - Toast notification timing and micro-animations.
- **Why This Priority Is Used:**  
  P3 items refine the product into an enterprise-grade experience. These tasks are scheduled once core security, functional access, and system speed standards have been verified and stabilized.

---

## 3. Enforcement Policy

- Developers **MUST NOT** pick up P2 or P3 items while P0 security vulnerabilities remain open.
- Pull requests addressing P0 and P1 tasks require priority code review and QA regression testing before merging into `main`.
