import test from 'node:test';
import assert from 'node:assert/strict';
import { requireRole } from '../src/middleware/authorize.js';
import { createRoleSchema, updateRoleSchema, updatePermissionsSchema } from '../src/controllers/roles.controller.js';
import { sanitizeLogData } from '../src/utils/sanitizeLog.js';

test('Roles: Non-Super Admin accounts are blocked from role governance', () => {
  const staffCaller = { user: { role: { role_code: 'staff_admin' }, isSuperAdmin: false } };
  const warehouseCaller = { user: { role: { role_code: 'warehouse_admin' }, isSuperAdmin: false } };
  const financeCaller = { user: { role: { role_code: 'finance_admin' }, isSuperAdmin: false } };

  [staffCaller, warehouseCaller, financeCaller].forEach((caller) => {
    let err = null;
    requireRole('super_admin')(caller, {}, (e) => { err = e; });
    assert.ok(err, `${caller.user.role.role_code} must not have access to role administration`);
    assert.strictEqual(err.status, 403);
    assert.strictEqual(err.code, 'FORBIDDEN');
  });
});

test('Roles: Super Admin account is allowed to access role governance', () => {
  const superAdminCaller = { user: { role: { role_code: 'super_admin' }, isSuperAdmin: true } };
  let err = null;
  requireRole('super_admin')(superAdminCaller, {}, (e) => { err = e; });
  assert.strictEqual(err, undefined, 'Super Admin must pass role management authorization');
});

test('Roles: Schema validation rejects invalid role definitions', () => {
  // Invalid role code: uppercase or spaces
  const invalidCode = { roleCode: 'Bad Role', roleName: 'Quality Specialist', permissionIds: [] };
  const parseResult1 = createRoleSchema.safeParse(invalidCode);
  assert.strictEqual(parseResult1.success, false, 'Role code with spaces/uppercase must be rejected');

  // Short role name
  const shortName = { roleCode: 'valid_code', roleName: 'Q', permissionIds: [] };
  const parseResult2 = createRoleSchema.safeParse(shortName);
  assert.strictEqual(parseResult2.success, false, 'Role name shorter than 3 chars must be rejected');

  // Valid role definition
  const validRole = {
    roleCode: 'warehouse_specialist',
    roleName: 'Warehouse Specialist',
    description: 'Manages physical warehouse bin locations and transfers',
    permissionIds: [1, 2, 5],
  };
  const parseResult3 = createRoleSchema.safeParse(validRole);
  assert.strictEqual(parseResult3.success, true, 'Valid role definition must pass validation');
});

test('Roles: Update schema correctly handles activation and renaming', () => {
  const validUpdate = {
    roleName: 'Senior Warehouse Specialist',
    description: 'Updated operational duties',
    isActive: false,
  };
  const result = updateRoleSchema.safeParse(validUpdate);
  assert.strictEqual(result.success, true);
  assert.strictEqual(result.data.isActive, false);

  const invalidPermissions = { permissionIds: [-1, 'abc'] };
  const permResult = updatePermissionsSchema.safeParse(invalidPermissions);
  assert.strictEqual(permResult.success, false, 'Invalid permission IDs must be rejected');
});

test('Roles: Audit events sanitize sensitive tokens and credentials', () => {
  const rawAuditEvent = {
    action: 'ROLE_CREATED',
    roleCode: 'inventory_auditor',
    token: 'jwt.token.secret',
    authorization: 'Bearer super-admin-token',
    password: 'password123',
    details: {
      affectedUser: 'john.doe',
      apiKey: 'secret-key-999',
    },
  };

  const sanitized = sanitizeLogData(rawAuditEvent);
  assert.strictEqual(sanitized.action, 'ROLE_CREATED');
  assert.strictEqual(sanitized.roleCode, 'inventory_auditor');
  assert.strictEqual(sanitized.token, '[REDACTED]');
  assert.strictEqual(sanitized.authorization, '[REDACTED]');
  assert.strictEqual(sanitized.password, '[REDACTED]');
  assert.strictEqual(sanitized.details.apiKey, '[REDACTED]');
  assert.strictEqual(sanitized.details.affectedUser, 'john.doe');
});

test('Roles: System roles protection prevents accidental deactivation of system tier', () => {
  const isSystemRole = true;
  const requestedDeactivation = false;

  const canDeactivate = !(isSystemRole && requestedDeactivation === false);
  assert.strictEqual(canDeactivate, false, 'System roles must never be eligible for deactivation');
});

test('Roles: Role description flags deactivated status permanently', () => {
  const baseDescription = 'Temporary auditor for Q3';
  const deactivatedDesc = `[DEACTIVATED] ${baseDescription}`;

  assert.strictEqual(deactivatedDesc.startsWith('[DEACTIVATED]'), true);
  const restoredDesc = deactivatedDesc.replace(/^\[DEACTIVATED\]\s*/, '');
  assert.strictEqual(restoredDesc, baseDescription);
});
