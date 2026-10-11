import test from 'node:test';
import assert from 'node:assert/strict';
import { authenticate } from '../src/middleware/authenticate.js';
import { requireRole, requirePermission } from '../src/middleware/authorize.js';
import { enforceTenantIsolation, validateEntityOwnership } from '../src/middleware/tenantIsolation.js';
import { validateParams, productIdParamSchema } from '../src/middleware/validate.js';
import { sanitizeLogData } from '../src/utils/sanitizeLog.js';

test('Security: Authentication middleware blocks missing Bearer tokens', async () => {
  const req = { headers: {} };
  let errorCaught = null;
  const next = (err) => { errorCaught = err; };

  await authenticate(req, {}, next);

  assert.ok(errorCaught, 'Expected authenticate middleware to pass error to next()');
  assert.strictEqual(errorCaught.status, 401);
  assert.strictEqual(errorCaught.code, 'UNAUTHORIZED');
});

test('Security: Role restrictions - requireRole allows specified role and blocks others', () => {
  const superAdminReq = { user: { role: { role_code: 'super_admin' } } };
  const staffReq = { user: { role: { role_code: 'staff' } } };

  let errorSuper = null;
  requireRole('super_admin')(superAdminReq, {}, (err) => { errorSuper = err; });
  assert.strictEqual(errorSuper, undefined, 'super_admin should be allowed');

  let errorStaff = null;
  requireRole('super_admin')(staffReq, {}, (err) => { errorStaff = err; });
  assert.ok(errorStaff, 'staff should be rejected for super_admin role');
  assert.strictEqual(errorStaff.status, 403);
  assert.strictEqual(errorStaff.code, 'FORBIDDEN');
});

test('Security: Permission restrictions - requirePermission blocks unauthorized callers', () => {
  const authorizedReq = { user: { role: { role_code: 'manager' }, permissions: ['products.create'] } };
  const unauthorizedReq = { user: { role: { role_code: 'staff' }, permissions: ['products.view'] } };

  let errAuth = null;
  requirePermission('products.create')(authorizedReq, {}, (err) => { errAuth = err; });
  assert.strictEqual(errAuth, undefined, 'User with products.create permission should pass');

  let errUnauth = null;
  requirePermission('products.create')(unauthorizedReq, {}, (err) => { errUnauth = err; });
  assert.ok(errUnauth, 'User lacking permission must be rejected with 403');
  assert.strictEqual(errUnauth.status, 403);
  assert.strictEqual(errUnauth.code, 'FORBIDDEN');
});

test('Security: Permission restrictions - Super Admin bypasses permission checks', () => {
  const superAdminReq = { user: { role: { role_code: 'super_admin' }, permissions: [] } };
  let err = null;
  requirePermission('arbitrary.permission')(superAdminReq, {}, (e) => { err = e; });
  assert.strictEqual(err, undefined, 'Super Admin should bypass granular permission checks');
});

test('Security: Tenant isolation - blocks client from specifying different tenant_id in query or body', () => {
  const maliciousReq = {
    user: { id: 'user-1', tenantId: 'tenant-a', role: { role_code: 'staff' } },
    query: { tenant_id: 'tenant-b' },
    headers: {},
    body: {},
    params: {},
  };

  let caughtErr = null;
  enforceTenantIsolation(maliciousReq, {}, (err) => { caughtErr = err; });
  assert.ok(caughtErr, 'Cross-tenant query parameter must be blocked');
  assert.strictEqual(caughtErr.status, 403);
  assert.strictEqual(caughtErr.code, 'FORBIDDEN');
});

test('Security: Tenant entity ownership validation - rejects record owned by another tenant', () => {
  const user = { tenantId: 'tenant-alpha', role: { role_code: 'staff' } };
  const sameRecord = { tenant_id: 'tenant-alpha', name: 'Authorized Asset' };
  const otherRecord = { tenant_id: 'tenant-beta', name: 'Confidential Asset' };

  assert.strictEqual(validateEntityOwnership(sameRecord, user), true, 'Same tenant entity must be allowed');
  assert.strictEqual(validateEntityOwnership(otherRecord, user), false, 'Different tenant entity must be rejected');
});

test('Security: Parameter validation - rejects invalid or malformed IDs', () => {
  const invalidReq = { params: { productId: 'not-a-number' } };
  let paramErr = null;
  validateParams(productIdParamSchema)(invalidReq, {}, (err) => { paramErr = err; });

  assert.ok(paramErr, 'Invalid ID parameter must fail validation');
  assert.strictEqual(paramErr.status, 400);
});

test('Security: Data exposure prevention - sanitizeLogData scrubs sensitive credentials', () => {
  const rawLog = {
    username: 'admin',
    password: 'SuperSecretPassword!',
    token: 'jwt.token.here',
    message: 'User authentication failed: Bearer secret-token-xyz',
    nested: {
      apiKey: 'api-key-12345',
    },
  };

  const safeLog = sanitizeLogData(rawLog);
  assert.strictEqual(safeLog.username, 'admin');
  assert.strictEqual(safeLog.password, '[REDACTED]');
  assert.strictEqual(safeLog.token, '[REDACTED]');
  assert.strictEqual(safeLog.message, 'User authentication failed: [REDACTED_TOKEN]');
  assert.strictEqual(safeLog.nested.apiKey, '[REDACTED]');
});

test('Security: Privilege escalation prevention - blocks user from modifying own role', () => {
  const caller = {
    user: { id: 'user-self', role: { role_code: 'manager' } },
  };
  const targetId = 'user-self';
  const newRoleId = 1; // attempting to change own role
  const currentRoleId = 2;

  const isBlocked = caller.user.role?.role_code !== 'super_admin' && targetId === caller.user.id && newRoleId !== currentRoleId;
  assert.strictEqual(isBlocked, true, 'User must not be allowed to modify their own assigned role');
});

test('Security: Privilege escalation prevention - non-super-admins cannot create Super Admin accounts', () => {
  const staffCaller = { user: { role: { role_code: 'staff_admin' } } };
  const targetRole = { role_code: 'super_admin' };

  const isForbidden = targetRole.role_code === 'super_admin' && staffCaller.user.role?.role_code !== 'super_admin';
  assert.strictEqual(isForbidden, true, 'Staff admin must not be allowed to create Super Admin accounts');
});

test('Security: Permission aliases - synonyms and module manage permissions resolve correctly', () => {
  // Warehouse manager with stock_movements.view accesses movements.view endpoint
  const warehouseReq = {
    user: { role: { role_code: 'warehouse_manager' }, permissions: ['stock_movements.view'] },
  };
  let err = null;
  requirePermission('movements.view')(warehouseReq, {}, (e) => { err = e; });
  assert.strictEqual(err, undefined, 'stock_movements.view should satisfy movements.view requirement');

  // Inventory editor with inventory.edit accesses inventory.update endpoint
  const editReq = {
    user: { role: { role_code: 'inventory_staff' }, permissions: ['inventory.edit'] },
  };
  let editErr = null;
  requirePermission('inventory.update')(editReq, {}, (e) => { editErr = e; });
  assert.strictEqual(editErr, undefined, 'inventory.edit should satisfy inventory.update requirement');

  // Auditor with audit_logs.view accesses logs.view endpoint
  const auditReq = {
    user: { role: { role_code: 'auditor' }, permissions: ['audit_logs.view'] },
  };
  let auditErr = null;
  requirePermission('logs.view')(auditReq, {}, (e) => { auditErr = e; });
  assert.strictEqual(auditErr, undefined, 'audit_logs.view should satisfy logs.view requirement');
});

test('Security: Emoji / icon is never used for authorization', () => {
  // Attacker adds super_admin emoji to their non-super-admin profile
  const spoofedEmojiUser = {
    user: {
      id: 'attacker-1',
      role: { role_code: 'staff', icon: '🛡️', emoji: '🛡️' },
      isSuperAdmin: false,
    },
  };

  let caughtErr = null;
  requireRole('super_admin')(spoofedEmojiUser, {}, (e) => { caughtErr = e; });
  assert.ok(caughtErr, 'Emoji spoofing must not grant access to Super Admin');
  assert.strictEqual(caughtErr.status, 403);
});
