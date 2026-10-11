# QA Review: Cross-Account Data Isolation, IDOR & Multi-Tenancy Integrity

**Repository:** Backend (`markitechdev/Backend`)  
**Target:** `src/controllers/users.controller.js`, `src/controllers/roles.controller.js`, `src/controllers/inventory.controller.js`  
**QA Reviewer:** Jaymartimpas0-prog  
**Review Date:** 2026-10-11  

---

### Finding 1: Insecure Direct Object Reference (IDOR) Leading to Super Admin Password Takeover

**Issue:**  
Subordinate Accounts with `users.manage` Can Overwrite Super Admin Passwords

**Repository:**  
Backend

**Area:**  
`src/controllers/users.controller.js` (Lines 143-151), `src/routes/users.routes.js` (Line 15)

**Priority:**  
P0

**Severity:**  
Critical

**Steps to Reproduce:**
1. Authenticate with an account granted `users.manage` (e.g., Staff Admin).
2. Fetch the Super Admin's `user_id` UUID by querying `GET /api/users`.
3. Dispatch `POST /api/users/<super_admin_uuid>/password` with payload:
   `{ "password": "NewCompromisedPassword123!" }`.
4. Observe HTTP 200 `{ "message": "Password updated" }`.
5. Authenticate at `/api/auth/login` using the Super Admin email and the newly injected password.

**Expected Result:**  
Accounts should be strictly hierarchical. Only Super Admins may reset passwords for other Super Admins. Non-super-admin managers must be strictly prohibited from modifying credentials of equal or higher-tiered accounts.

**Actual Result:**  
`resetPassword` executes `supabaseAdmin.auth.admin.updateUserById(req.params.id, { password })` directly without checking the target account's role tier against the requesting user's role.

**Developer Task:**  
Add target role inspection before password modification: if target user is `super_admin`, require `req.user.role.role_code === 'super_admin'`. Prevent any self- or upward-escalation.

**Status:**  
Open

**QA Reviewer:**  
Jaymartimpas0-prog

---

### Finding 2: Vertical Privilege Escalation via User Role Reassignment

**Issue:**  
User Management API Permits Elevating Arbitrary Accounts to Super Admin Role

**Repository:**  
Backend

**Area:**  
`src/controllers/users.controller.js` (Lines 95-125)

**Priority:**  
P0

**Severity:**  
Critical

**Steps to Reproduce:**
1. Sign in as an account with `users.manage`.
2. Inspect `GET /api/roles` to determine the `role_id` integer for `super_admin`.
3. Dispatch `PATCH /api/users/<own_user_id>` with payload: `{ "roleId": <super_admin_role_id> }`.
4. Observe HTTP 200 response with updated profile reflecting role `super_admin`.
5. Caller now has full unchecked system control.

**Expected Result:**  
Assigning or modifying administrative roles must be restricted exclusively to callers who are currently active Super Admins (`requireRole('super_admin')`).

**Actual Result:**  
The controller only checks that the *last* active Super Admin is not demoted, but contains zero checks preventing any manager from promoting themselves or other users into the Super Admin role.

**Developer Task:**  
Ensure `patch.role_id` modifications require caller to hold `super_admin` role, and prohibit non-super-admins from assigning any role tier equal to or above their own.

**Status:**  
Open

**QA Reviewer:**  
Jaymartimpas0-prog

---

### Finding 3: Complete Absence of Multi-Tenant and Client Organization Boundaries

**Issue:**  
Database Schema and Controllers Co-mingle All Business Data Globally

**Repository:**  
Backend

**Area:**  
`supabase/01_schema.sql`, `src/controllers/inventory.controller.js`, `src/controllers/products.controller.js`

**Priority:**  
P0

**Severity:**  
Critical

**Steps to Reproduce:**
1. Inspect `01_schema.sql` table structures.
2. Observe absence of `tenant_id`, `organization_id`, or `client_id` foreign keys on any tables (`products`, `inventory`, `stock_movements`, `suppliers`, `alerts`).
3. Query `GET /api/products` or `GET /api/inventory`.
4. Observe all inventory records, stock valuation numbers, and supplier contacts are returned globally without partition.

**Expected Result:**  
If the IMS platform supports multiple organizations, clients, or business units, all queries must be scoped to the authenticated user's `organization_id` / `tenant_id`.

**Actual Result:**  
Single-tenant global schema exposes all company stock, purchase unit costs, supplier contact records, and shrinkage numbers to any user holding general read permissions.

**Developer Task:**  
Architect multi-tenancy columns (`tenant_id`) across all data models and enforce tenant isolation filtering in all service queries.

**Status:**  
Open

**QA Reviewer:**  
Jaymartimpas0-prog

---

### Finding 4: Excessive Personal Identifiable Information (PII) Exposure in Directory Endpoints

**Issue:**  
Staff Directory Endpoints Expose Direct Phone Numbers and Internal UUIDs Globally

**Repository:**  
Backend

**Area:**  
`src/controllers/users.controller.js` (Lines 8-11, 33-46)

**Priority:**  
P2

**Severity:**  
Medium

**Steps to Reproduce:**
1. Sign in as any user with `users.view`.
2. Dispatch `GET /api/users`.
3. Inspect JSON response.
4. Observe personal `contact_number`, full names, emails, and database UUIDs of all company executives and warehouse staff.

**Expected Result:**  
General directory listings should only expose public profile fields (`full_name`, `position`, `department`) and redact direct contact numbers, email addresses, and internal UUIDs unless accessed by HR / Super Admin.

**Actual Result:**  
All personal contact numbers and internal keys are broadcast in the standard user listing.

**Developer Task:**  
Define separate public vs administrative projection serializers for user entity representations.

**Status:**  
Open

**QA Reviewer:**  
Jaymartimpas0-prog
