# Project Management: Approved Engineering Scope & Boundary Agreement

**Author:** jhnyz (Project Manager)  
**Classification:** Scope Governance & Anti-Scope-Creep Boundary  
**Date:** 2026-10-11  

---

## 1. Scope Governance Policy

To prevent uncontrolled scope creep, prevent unintended regression risks, and protect delivery milestones, engineering teams must adhere strictly to the boundaries established below. Any modifications beyond the approved scope will be rejected at code review.

---

## 2. In-Scope Work Items

The following areas are explicitly authorized for developer implementation:

1. **All QA-Identified Defects:**
   - Remediation of all 24 findings documented by QA Reviewer Jaymartimpas0-prog across the 12 QA reports.
2. **Security & Data Isolation Fixes (P0):**
   - Remediation of IDOR vulnerability on password reset endpoint.
   - Guarding role assignments against unauthorized elevation to Super Admin.
   - Architectural scoping for multi-tenant and organization boundaries.
   - Stripping hardcoded demo credentials and passwords from production bundles.
3. **Authentication & Session Security (P1):**
   - Invalidation of Supabase sessions and refresh tokens on logout.
   - Mitigation of client-side permission tampering in localStorage.
4. **Authorization & Route Guards (P1):**
   - Protecting `GET /api/roles` and restricting role permission updates to Super Admins.
   - Client navigation guard fixes (eliminating browser Back trapping on `/forbidden`).
5. **System Performance & Caching (P2):**
   - In-memory profile caching in `authenticate.js` middleware to reduce database latency.
   - Pinia client-side SWR caching for dashboard and inventory lists.
   - Search input debouncing (350ms) and URL query synchronization.
6. **Loading States & Skeletons (P2):**
   - Structural skeleton card and table loaders replacing plaintext "Loading..." placeholders.
   - Disabling buttons and displaying spinners during mutation execution.
7. **Data Visualization Polish (P2):**
   - Interactive hover tooltips, minimum width thresholds, and UTF-8 encoding corrections on horizontal progress bars.
8. **UI/UX & Mobile Responsiveness (P3):**
   - Responsive mobile navigation drawer with hamburger toggle.
   - Standardizing deletion confirmation dialogs to use `ModalDialog.vue`.
   - Mobile sticky column pinning for primary product identifiers.

---

## 3. Out-of-Scope Work Items

Developers are **STRICTLY PROHIBITED** from undertaking the following activities during this remediation cycle:

1. **Unrelated Features & Additions:**
   - Implementing unrequested modules (e.g., full e-commerce storefront, third-party payment gateways, customer portals).
2. **Unnecessary Visual Redesigns:**
   - Changing overall color palettes, visual themes, or framework stylesheets outside of bug corrections.
3. **Unrequested Architectural Rewrites:**
   - Replacing Express with NestJS/Fastify, or replacing Vue 3 with React/Next.js.
   - Swapping Supabase for another database provider.
4. **Unrelated Database Migrations:**
   - Modifying unrelated database columns, triggers, or seed scripts not directly required for tenant isolation or security fixes.
5. **Unnecessary Dependency / Package Additions:**
   - Introducing heavy third-party charting libraries (Chart.js/D3) when lightweight CSS progress bars with tooltips satisfy the requirement.
   - Upgrading major versions of framework dependencies without prior Project Manager sign-off.
