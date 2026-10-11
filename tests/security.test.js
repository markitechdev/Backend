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
