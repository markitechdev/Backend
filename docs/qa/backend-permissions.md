# QA Review: Backend API Route Authorization & Permission Enforcement

**Repository:** Backend (`markitechdev/Backend`)  
**Target:** `src/routes/roles.routes.js`, `src/routes/users.routes.js`, `src/controllers/roles.controller.js`  
**QA Reviewer:** Jaymartimpas0-prog  
**Review Date:** 2026-10-11  

---

### Finding 1: Roles Catalog Route Completely Unprotected by Permission Middleware

**Issue:**  
Any Signed-in User Can Query Complete System Role Hierarchy and Counts

**Repository:**  
Backend

**Area:**  
`src/routes/roles.routes.js` (Line 11)

**Priority:**  
P1

**Severity:**  
High

**Steps to Reproduce:**
1. Authenticate with a basic account holding zero administrative permissions.
2. Send `GET /api/roles` with the bearer token.
3. Observe HTTP 200 response returning all roles, descriptions, system role flags, and active user counts.

**Expected Result:**  
Access to the role listing and metadata should require an explicit permission such as `roles.view` or `roles.manage`.

**Actual Result:**  
`router.get('/', c.listRoles)` lacks `requirePermission(...)`, allowing any authenticated caller to map out internal access tiers.

**Developer Task:**  
Add `requirePermission('roles.view')` or `requirePermission('roles.manage')` to the `GET /api/roles` route definition.

**Status:**  
Open

**QA Reviewer:**  
Jaymartimpas0-prog

---

### Finding 2: Lateral and Vertical Privilege Escalation via Role Permission Modification

**Issue:**  
Non-Super-Admin with `roles.manage` Can Grant All Privileges to Subordinate Roles

**Repository:**  
Backend

**Area:**  
`src/controllers/roles.controller.js` (Lines 80-98)

**Priority:**  
P0

**Severity:**  
Critical

**Steps to Reproduce:**
1. Assign `roles.manage` permission to a custom role or Staff Admin.
2. Sign in as that user and send `PUT /api/roles/:id/permissions` targeting their own role ID.
3. Pass an array of all `permission_id` values including `roles.manage`, `users.manage`, `inventory.update`.
4. Refresh token and observe caller now holds full administrator powers.

**Expected Result:**  
Only verified `super_admin` accounts should be permitted to assign or reconfigure administrative and management permissions. A user should never be able to grant permissions they do not themselves hold.

**Actual Result:**  
The backend only prevents reducing Super Admin permissions (`if (role.role_code === 'super_admin')`), but does not verify whether the caller is a Super Admin before modifying other roles.

**Developer Task:**  
Enforce `requireRole('super_admin')` on all role and permission modification routes, or ensure users cannot grant permissions greater than their own.

**Status:**  
Open

**QA Reviewer:**  
Jaymartimpas0-prog

---

### Finding 3: Lack of Attribute-Based Access Control (ABAC) for Multi-Warehouse Environments

**Issue:**  
Inventory and Movements Permissions Apply Globally Across All Warehouse Locations

**Repository:**  
Backend

**Area:**  
`src/controllers/inventory.controller.js`, `src/controllers/movements.controller.js`

**Priority:**  
P2

**Severity:**  
Medium

**Steps to Reproduce:**
1. Create inventory records with different `location` strings ('Main Warehouse', 'Branch North').
2. Authorize a user with `inventory.view`.
3. Send `GET /api/inventory`.
4. Notice caller receives all items regardless of assigned warehouse location.

**Expected Result:**  
Enterprise systems should support location-based scoping so branch staff can only view and adjust inventory for their assigned location.

**Actual Result:**  
Permissions are purely global boolean checks without location or departmental filtering.

**Developer Task:**  
Introduce warehouse location scoping in the user profile model and apply location filtering in query handlers.

**Status:**  
Open

**QA Reviewer:**  
Jaymartimpas0-prog
