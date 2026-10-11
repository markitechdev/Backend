# QA Review: Super Admin Authentication & Session Management

**Repository:** Backend (`markitechdev/Backend`)  
**Target:** `src/controllers/auth.controller.js`, `src/middleware/authenticate.js`, `src/routes/auth.routes.js`  
**QA Reviewer:** Jaymartimpas0-prog  
**Review Date:** 2026-10-11  

---

### Finding 1: Logout Endpoint Fails to Invalidate Server-Side Session

**Issue:**  
Logout API Does Not Revoke Supabase JWT Session

**Repository:**  
Backend

**Area:**  
`src/controllers/auth.controller.js` (Lines 58-61)

**Priority:**  
P0

**Severity:**  
Critical

**Steps to Reproduce:**
1. Send `POST /api/auth/login` with Super Admin credentials.
2. Store the returned `accessToken`.
3. Send `POST /api/auth/logout` using the `Authorization: Bearer <accessToken>` header.
4. Verify response returns `{ "message": "Signed out" }` (HTTP 200).
5. Immediately send `GET /api/users` using the same `accessToken`.

**Expected Result:**  
The server should invalidate the session in Supabase Auth (`supabaseAdmin.auth.admin.signOut(req.accessToken)` or revoke the refresh token). Subsequent requests using the old token should receive `401 Unauthorized`.

**Actual Result:**  
`logout` only writes an activity log and returns a JSON response. The `accessToken` remains 100% active and accepted by `authenticate.js` until its standard JWT expiration.

**Developer Task:**  
Implement token revocation or server-side session termination via Supabase auth admin API (`supabaseAdmin.auth.admin.signOut` or session blacklist).

**Status:**  
Open

**QA Reviewer:**  
Jaymartimpas0-prog

---

### Finding 2: Lack of MFA or Step-up Protection for Super Admin Accounts

**Issue:**  
Super Admin Account Relies Solely on Single-Factor Password Authentication

**Repository:**  
Backend

**Area:**  
`src/controllers/auth.controller.js` (Lines 14-52)

**Priority:**  
P1

**Severity:**  
High

**Steps to Reproduce:**
1. Inspect authentication flow for `POST /api/auth/login`.
2. Notice the authentication mechanism is identical for all roles from Staff to Super Admin.
3. No TOTP, SMS, email verification, or secondary factor is enforced for accounts holding `super_admin` privilege.

**Expected Result:**  
Privileged Super Admin accounts should require Multi-Factor Authentication (MFA/TOTP) or step-up authentication challenge prior to issuing session tokens with full administrative permissions.

**Actual Result:**  
Single password challenge issues full system-level administrative access.

**Developer Task:**  
Integrate Supabase MFA/TOTP verification for roles with administrative privileges before returning active session tokens.

**Status:**  
Open

**QA Reviewer:**  
Jaymartimpas0-prog

---

### Finding 3: Refresh Token Replay Without Fingerprint Verification

**Issue:**  
Refresh Token Endpoint Lacks Client Binding or IP Validation

**Repository:**  
Backend

**Area:**  
`src/controllers/auth.controller.js` (Lines 66-76)

**Priority:**  
P2

**Severity:**  
Medium

**Steps to Reproduce:**
1. Authenticate as Super Admin and obtain `refreshToken`.
2. Send `POST /api/auth/refresh` from a completely different IP address and User-Agent using the captured `refreshToken`.
3. Observe new `accessToken` and `refreshToken` pair returned successfully without anomaly challenge.

**Expected Result:**  
Refresh token requests should validate device fingerprint, client IP consistency, or token family rotation flags to prevent session hijacking.

**Actual Result:**  
`supabaseAnon.auth.refreshSession` accepts any valid refresh string regardless of origin or client context.

**Developer Task:**  
Add IP/client fingerprint checks and enforce token rotation detection to revoke compromised session trees.

**Status:**  
Open

**QA Reviewer:**  
Jaymartimpas0-prog

---

### Finding 4: Exposure of Internal UUID and Database Primary Keys in Auth Payload

**Issue:**  
Authentication Payload Returns Raw Database Keys and Profile Fields

**Repository:**  
Backend

**Area:**  
`src/controllers/auth.controller.js` (Lines 42-50)

**Priority:**  
P3

**Severity:**  
Low

**Steps to Reproduce:**
1. Send `POST /api/auth/login`.
2. Inspect the `user` object in the HTTP response.
3. Observe internal Supabase auth UUID `user_id` and database role IDs returned directly.

**Expected Result:**  
The response should sanitize internal infrastructure identifiers or map them to public identifiers, avoiding exposure of raw database primary keys.

**Actual Result:**  
Returns raw `id: profile.user_id` which corresponds directly to the internal PostgreSQL UUID.

**Developer Task:**  
Filter authentication response models through a standardized DTO serializer.

**Status:**  
Open

**QA Reviewer:**  
Jaymartimpas0-prog
