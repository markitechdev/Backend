# Super Admin Authentication Flow & API Integration Guide

**Author:** markitechdev (Main Backend Developer)  
**Target Repository:** Frontend (`markitechdev/Frontend`)  
**Status:** FOR QA  
**Date:** 2026-10-11  

---

## 1. Overview & Architectural Isolation

To enforce strict SaaS platform security, the Backend implements two completely isolated authentication and session flows:

1. **Normal Authentication Flow (`/api/auth/*`)**
   - Intended for tenant-scoped users: `warehouse_admin`, `staff_admin`, `finance_admin`, regular staff, managers.
   - **Super Admin accounts are strictly rejected** with HTTP 401 (`"Unable to authenticate with this login."`).

2. **Super Admin Authentication Flow (`/api/super-admin/auth/*`)**
   - Exclusively reserved for verified platform administrators holding the `super_admin` role.
   - **All non-super_admin accounts are rejected** with HTTP 401 (`"Unable to authenticate with this login."`).
   - All platform management APIs under `/api/super-admin/*` strictly require valid Super Admin authentication (`authenticateSuperAdmin` middleware). Non-super_admins receive HTTP 403 Forbidden.

---

## 2. Super Admin API Contract

### 2.1 Super Admin Login
- **Endpoint:** `POST /api/super-admin/auth/login`
- **Rate Limit:** 10 requests per 15 minutes per IP.
- **Request Body:**
  ```json
  {
    "email": "superadmin@ims.local",
    "password": "<your-super-admin-password>"
  }
  ```
- **Success Response (`200 OK`):**
  ```json
  {
    "success": true,
    "data": {
      "session": {
        "accessToken": "eyJhbGciOi...",
        "refreshToken": "v1.mr_...",
        "expiresAt": 1791720000
      },
      "user": {
        "id": "e3048995-1779-4d37-...",
        "fullName": "Jhanyz Laviña",
        "username": "superadmin",
        "email": "superadmin@ims.local",
        "position": "System Administrator",
        "role": {
          "role_id": 1,
          "role_code": "super_admin",
          "role_name": "Super Admin"
        },
        "isSuperAdmin": true,
        "permissions": ["users.view", "users.manage", "roles.manage", "..."]
      }
    }
  }
  ```
- **Failure Responses:**
  - `401 Unauthorized`: Bad credentials OR non-super_admin account attempting login (`"Unable to authenticate with this login."` or `"Invalid email or password"`).
  - `403 Forbidden`: Account is deactivated (`"This account has been deactivated."`).

---

### 2.2 Super Admin Session Profile Verification
- **Endpoint:** `GET /api/super-admin/auth/me`
- **Headers:** `Authorization: Bearer <accessToken>`
- **Success Response (`200 OK`):**
  ```json
  {
    "success": true,
    "data": {
      "id": "e3048995-1779-4d37-...",
      "fullName": "Jhanyz Laviña",
      "username": "superadmin",
      "email": "superadmin@ims.local",
      "role": { "role_code": "super_admin", "role_name": "Super Admin" },
      "isSuperAdmin": true,
      "permissions": [...]
    }
  }
  ```
- **Failure:** Returns `401` if token is invalid or expired, or `403` if user is not Super Admin.

---

### 2.3 Super Admin Logout
- **Endpoint:** `POST /api/super-admin/auth/logout`
- **Headers:** `Authorization: Bearer <accessToken>`
- **Behavior:** Revokes session on Supabase Auth, adds token to backend in-memory revocation blacklist, and invalidates profile memory cache.
- **Success Response (`200 OK`):**
  ```json
  {
    "success": true,
    "data": {
      "message": "Super Admin signed out successfully"
    }
  }
  ```

---

### 2.4 Super Admin Protected Platform APIs
All endpoints mounted under `/api/super-admin/*` require Super Admin authorization:
- `GET /api/super-admin/dashboard` — Platform telemetry overview
- `GET /api/super-admin/stats` — Global platform metrics (total users, total roles, audit logs)
- `GET /api/super-admin/tenants` — Platform tenant/organization catalog
- `GET /api/super-admin/users` — Comprehensive user account list across workspaces
- `POST /api/super-admin/users` — Provision new user accounts
- `PATCH /api/super-admin/users/:id` — Update user details / role assignment
- `DELETE /api/super-admin/users/:id` — Remove user account
- `POST /api/super-admin/users/:id/password` — Reset account password
- `GET /api/super-admin/roles` — Role matrix catalog
- `POST /api/super-admin/roles` — Create platform role
- `PUT /api/super-admin/roles/:id/permissions` — Update role permissions
- `DELETE /api/super-admin/roles/:id` — Delete platform role
- `GET /api/super-admin/logs` — Global security audit trail

---

## 3. Frontend Implementation Requirements

The Frontend developer must implement the following architectural routing and UI behavior:

1. **Dedicated Super Admin Routing:**
   - Dedicated login view: `/super-admin/login`
   - Dedicated dashboard view: `/super-admin/dashboard`
   - Normal login view: `/login`
   - Normal dashboard view: `/dashboard`

2. **Redirect & Navigation Rules:**
   - Normal user login -> Redirects to `/dashboard`.
   - Super Admin login -> Redirects to `/super-admin/dashboard`.
   - If a normal user navigates to `/super-admin/*` -> Route guard renders **Access Denied (`/forbidden`)**.
   - If an unauthenticated user navigates to `/super-admin/*` -> Redirects to `/super-admin/login`.

3. **Session Context Isolation:**
   - Separate access tokens / claims in client store memory.
   - Logging out of the Super Admin console clears all Super Admin store state and invokes `POST /api/super-admin/auth/logout`.
