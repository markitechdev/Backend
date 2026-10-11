# Project Management: Enterprise Risk Register & Mitigation Strategy

**Author:** jhnyz (Project Manager)  
**Classification:** Information Security & Operational Risk Matrix  
**Date:** 2026-10-11  

---

## 1. Risk Register

### Risk 1: Cross-Client and Multi-Tenant Data Exposure
- **Risk:** Unpartitioned Database Schema Allows Cross-Organization Data Access
- **Impact:** Critical business confidentiality breach, regulatory non-compliance, and exposure of commercial catalog and unit costs between competitors.
- **Likelihood:** High
- **Priority:** P0 (Critical)
- **Affected Repository:** Backend
- **Mitigation:** Introduce mandatory `tenant_id` foreign key columns on all database tables; enforce tenant query filters in all service handlers.
- **Status:** Active / Unmitigated

---

### Risk 2: Subordinate Account Overwrite of Super Admin Passwords (IDOR)
- **Risk:** Insecure Direct Object Reference on Password Modification API
- **Impact:** Full administrative takeover of the platform by lower-tiered staff or compromised credentials.
- **Likelihood:** High
- **Priority:** P0 (Critical)
- **Affected Repository:** Backend
- **Mitigation:** Implement strict role hierarchy validation in `users.controller.js`; reject password modification targeting Super Admin unless caller is confirmed Super Admin.
- **Status:** Active / Unmitigated

---

### Risk 3: Frontend Permissions Enforcement Without Backend Gatekeeping
- **Risk:** Tampering with LocalStorage Unlocks Administrative UI Features
- **Impact:** Low-privilege users can view administrative screens and attempt operations.
- **Likelihood:** High
- **Priority:** P1 (High)
- **Affected Repository:** Both (Frontend & Backend)
- **Mitigation:** All backend routes must independently enforce `requirePermission`; frontend must re-verify user claims with `GET /api/auth/me` on launch.
- **Status:** Active / Unmitigated

---

### Risk 4: Authentication and Session Invalidation Bypass
- **Risk:** Logout API Leaves Supabase JWT Tokens Active and Usable
- **Impact:** Hijacked or retained access tokens can be used to query APIs after employee departure or logout.
- **Likelihood:** High
- **Priority:** P1 (High)
- **Affected Repository:** Backend
- **Mitigation:** Call Supabase auth admin signOut API or maintain token revocation blacklist on the Express server.
- **Status:** Active / Unmitigated

---

### Risk 5: Unauthorized Vertical Role Elevation
- **Risk:** Users Can Self-Assign Super Admin Role via Profile Update Endpoint
- **Impact:** Arbitrary users gain full unchecked administrative privileges.
- **Likelihood:** High
- **Priority:** P1 (High)
- **Affected Repository:** Backend
- **Mitigation:** Require `super_admin` role for modifying `role_id` on user accounts; prohibit non-super-admins from assigning any role equal to or higher than their own.
- **Status:** Active / Unmitigated

---

### Risk 6: Repeated API Requests and Uncached Middleware Causing Server DoS
- **Risk:** 3 Database Round-trips Per Request and Quadruple Report Calls Cause Server Latency Spikes
- **Impact:** Severe database CPU exhaustion, high latency for end users, potential outage under concurrent load.
- **Likelihood:** High
- **Priority:** P2 (Medium)
- **Affected Repository:** Both (Frontend & Backend)
- **Mitigation:** Implement in-memory TTL caching for decoded profiles in `authenticate.js`; add client-side SWR caching in Pinia store for dashboard and reports.
- **Status:** Active / Unmitigated

---

### Risk 7: Missing Action Loading States Causing Duplicate Database Mutations
- **Risk:** Unblocked Submit Buttons Permit Double-Clicking Stock Movements and Account Creation
- **Impact:** Duplicate inventory transactions, ledger corruption, and redundant account creations.
- **Likelihood:** Medium
- **Priority:** P2 (Medium)
- **Affected Repository:** Frontend
- **Mitigation:** Disable submit buttons immediately upon click, display visual spinner, and debounce form handlers.
- **Status:** Active / Unmitigated

---

### Risk 8: Client Routing History Trapping on Access Denied Pages
- **Risk:** Infinite Redirect Loop When Users Hit Browser Back on `/forbidden`
- **Impact:** Degraded user experience, browser freeze, inability to return to safe dashboard views.
- **Likelihood:** Medium
- **Priority:** P2 (Medium)
- **Affected Repository:** Frontend
- **Mitigation:** Change navigation guard redirect from `router.push` to `router.replace({ name: 'forbidden' })`.
- **Status:** Active / Unmitigated

---

### Risk 9: User Interface and Responsive Design Inconsistency
- **Risk:** Missing Mobile Navigation and Unstyled Deletion Prompts
- **Impact:** Inability to use platform on smartphones or tablets, fragmented visual perception.
- **Likelihood:** Low
- **Priority:** P3 (Improvement)
- **Affected Repository:** Frontend
- **Mitigation:** Add responsive mobile drawer with hamburger toggle; standardize all deletions to use `ModalDialog.vue`.
- **Status:** Active / Unmitigated
