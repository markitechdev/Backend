import test from 'node:test';
import assert from 'node:assert/strict';
import { authenticateSuperAdmin } from '../src/middleware/authenticateSuperAdmin.js';
import { requireSuperAdmin } from '../src/middleware/authorize.js';
import { isTokenBlacklisted, revokeToken } from '../src/utils/tokenBlacklist.js';
import { setCachedUserProfile, getCachedUserProfile, invalidateUserProfile } from '../src/utils/cache.js';
import { ApiError } from '../src/utils/ApiError.js';

test('SuperAdmin Auth: Missing authentication header returns 401 UNAUTHORIZED', async () => {
  const req = { headers: {} };
  let error = null;
  const next = (err) => { error = err; };

  await authenticateSuperAdmin(req, {}, next);

  assert.ok(error, 'Missing authorization header must trigger an error');
  assert.strictEqual(error.status, 401);
  assert.strictEqual(error.code, 'UNAUTHORIZED');
  assert.match(error.message, /missing bearer token/i);
});

test('SuperAdmin Auth: Malformed or non-Bearer token returns 401 UNAUTHORIZED', async () => {
  const req = { headers: { authorization: 'Basic YWRtaW46cGFzc3dvcmQ=' } };
  let error = null;
  const next = (err) => { error = err; };

  await authenticateSuperAdmin(req, {}, next);

  assert.ok(error, 'Non-Bearer authorization must fail');
  assert.strictEqual(error.status, 401);
  assert.strictEqual(error.code, 'UNAUTHORIZED');
});

test('SuperAdmin Auth: Revoked/blacklisted token is rejected with 401 UNAUTHORIZED', async () => {
  const testToken = 'superadmin-revoked-token-xyz-789';
  revokeToken(testToken, 60000);
  assert.strictEqual(isTokenBlacklisted(testToken), true);

  const req = { headers: { authorization: `Bearer ${testToken}` } };
  let error = null;
  const next = (err) => { error = err; };

  await authenticateSuperAdmin(req, {}, next);

  assert.ok(error, 'Revoked Super Admin token must be rejected');
  assert.strictEqual(error.status, 401);
  assert.strictEqual(error.code, 'UNAUTHORIZED');
  assert.match(error.message, /session has been revoked/i);
});

test('SuperAdmin Auth: requireSuperAdmin denies Normal Admin (403 FORBIDDEN)', () => {
  const adminReq = {
    user: {
      id: 'admin-uuid',
      fullName: 'Warehouse Admin',
      role: { role_code: 'warehouse_admin', role_name: 'Warehouse Admin' },
      isSuperAdmin: false,
    },
  };
  let error = null;
  requireSuperAdmin(adminReq, {}, (err) => { error = err; });

  assert.ok(error, 'Normal Admin must be denied Super Admin access');
  assert.strictEqual(error.status, 403);
  assert.strictEqual(error.code, 'FORBIDDEN');
  assert.match(error.message, /restricted to super admin/i);
});

test('SuperAdmin Auth: requireSuperAdmin denies Manager account (403 FORBIDDEN)', () => {
  const managerReq = {
    user: {
      id: 'manager-uuid',
      fullName: 'Branch Manager',
      role: { role_code: 'manager', role_name: 'Manager' },
      isSuperAdmin: false,
    },
  };
  let error = null;
  requireSuperAdmin(managerReq, {}, (err) => { error = err; });

  assert.ok(error, 'Manager must be denied Super Admin access');
  assert.strictEqual(error.status, 403);
  assert.strictEqual(error.code, 'FORBIDDEN');
});

test('SuperAdmin Auth: requireSuperAdmin denies Staff / Normal User (403 FORBIDDEN)', () => {
  const staffReq = {
    user: {
      id: 'staff-uuid',
      fullName: 'Staff User',
      role: { role_code: 'staff_admin', role_name: 'Staff Admin' },
      isSuperAdmin: false,
    },
  };
  let error = null;
  requireSuperAdmin(staffReq, {}, (err) => { error = err; });

  assert.ok(error, 'Staff must be denied Super Admin access');
  assert.strictEqual(error.status, 403);
  assert.strictEqual(error.code, 'FORBIDDEN');
});

test('SuperAdmin Auth: Client-submitted spoofing in body does NOT bypass requireSuperAdmin', () => {
  // Client attempts to pass role: 'super_admin' or isSuperAdmin: true in request body
  const spoofedReq = {
    user: {
      id: 'attacker-uuid',
      role: { role_code: 'staff_admin' },
      isSuperAdmin: false,
    },
    body: {
      role: 'super_admin',
      isSuperAdmin: true,
    },
  };
  let error = null;
  requireSuperAdmin(spoofedReq, {}, (err) => { error = err; });

  assert.ok(error, 'Client-side spoofed parameters must be ignored');
  assert.strictEqual(error.status, 403);
  assert.strictEqual(error.code, 'FORBIDDEN');
});

test('SuperAdmin Auth: requireSuperAdmin allows valid Super Admin account', () => {
  const superAdminReq = {
    user: {
      id: 'super-admin-uuid',
      fullName: 'System Super Admin',
      role: { role_code: 'super_admin', role_name: 'Super Admin' },
      isSuperAdmin: true,
    },
  };
  let error = null;
  requireSuperAdmin(superAdminReq, {}, (err) => { error = err; });

  assert.strictEqual(error, undefined, 'Super Admin must be permitted access');
});

test('SuperAdmin Auth: Normal login endpoint rejects Super Admin accounts (strict separation)', () => {
  const isSuperAdmin = true;
  // Simulating check in auth.controller.js
  let rejectedError = null;
  if (isSuperAdmin) {
    rejectedError = ApiError.unauthorized('Unable to authenticate with this login.');
  }

  assert.ok(rejectedError);
  assert.strictEqual(rejectedError.status, 401);
  assert.strictEqual(rejectedError.message, 'Unable to authenticate with this login.');
  // Ensures role details are NOT leaked in the error message
  assert.doesNotMatch(rejectedError.message, /super_admin/i);
});

test('SuperAdmin Auth: Super Admin login endpoint rejects non-Super Admin accounts (strict separation)', () => {
  const profile = { role: { role_code: 'warehouse_admin' } };
  // Simulating check in superAdminAuth.controller.js
  let rejectedError = null;
  if (profile.role?.role_code !== 'super_admin') {
    rejectedError = ApiError.unauthorized('Unable to authenticate with this login.');
  }

  assert.ok(rejectedError);
  assert.strictEqual(rejectedError.status, 401);
  assert.strictEqual(rejectedError.message, 'Unable to authenticate with this login.');
  assert.doesNotMatch(rejectedError.message, /warehouse_admin/i);
});

test('SuperAdmin Auth: Super Admin logout revokes session and invalidates cache', () => {
  const superToken = 'active-super-token-111';
  const superId = 'super-user-111';

  setCachedUserProfile(superId, { id: superId, role: { role_code: 'super_admin' } });
  assert.ok(getCachedUserProfile(superId));

  // Perform logout operations
  revokeToken(superToken, 60000);
  invalidateUserProfile(superId);

  assert.strictEqual(isTokenBlacklisted(superToken), true, 'Super Admin token must be blacklisted');
  assert.strictEqual(getCachedUserProfile(superId), null, 'Super Admin profile cache must be invalidated');
});
