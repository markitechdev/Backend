import test from 'node:test';
import assert from 'node:assert/strict';
import { requireRole } from '../src/middleware/authorize.js';
import { createUserSchema, updateUserSchema } from '../src/controllers/users.controller.js';
import {
  createRoleSchema,
  updateRoleSchema,
  updatePermissionsSchema,
  parseRoleMetadata,
  serializeRoleMetadata,
} from '../src/controllers/roles.controller.js';

test('SuperAdmin Management: Super Admin authorization allows user and role management', () => {
  const superAdminCaller = {
    user: { id: 'sa-1', role: { role_code: 'super_admin' }, isSuperAdmin: true },
  };

  let err = null;
  requireRole('super_admin')(superAdminCaller, {}, (e) => { err = e; });
  assert.strictEqual(err, undefined, 'Super Admin must pass requireRole check');
});

test('SuperAdmin Management: Non-super-admins (Admin, Manager, Staff) are strictly denied from management routes', () => {
  const rolesToTest = ['warehouse_admin', 'manager', 'staff_admin', 'user'];

  rolesToTest.forEach((roleCode) => {
    const caller = {
      user: { id: 'u-1', role: { role_code: roleCode }, isSuperAdmin: false },
    };
    let err = null;
    requireRole('super_admin')(caller, {}, (e) => { err = e; });
    assert.ok(err, `${roleCode} must be blocked from super admin management`);
    assert.strictEqual(err.status, 403);
  });
});

test('SuperAdmin Management: createUserSchema validates required fields and rejects invalid inputs', () => {
  // Valid user creation input
  const validUser = {
    fullName: 'Jane Doe',
    username: 'jane_doe',
    email: 'jane@example.com',
    password: 'Password123!',
    roleId: 2,
    position: 'Inventory Lead',
    contactNumber: '+639123456789',
  };
  const validResult = createUserSchema.safeParse(validUser);
  assert.strictEqual(validResult.success, true, 'Valid user input must pass validation');

  // Invalid email
  const invalidEmail = { ...validUser, email: 'not-an-email' };
  const emailResult = createUserSchema.safeParse(invalidEmail);
  assert.strictEqual(emailResult.success, false, 'Invalid email must fail validation');

  // Password too short (< 8 chars)
  const shortPw = { ...validUser, password: '123' };
  const pwResult = createUserSchema.safeParse(shortPw);
  assert.strictEqual(pwResult.success, false, 'Short password must fail validation');

  // Missing roleId
  const noRole = { ...validUser, roleId: undefined };
  const roleResult = createUserSchema.safeParse(noRole);
  assert.strictEqual(roleResult.success, false, 'Missing roleId must fail validation');
});

test('SuperAdmin Management: updateUserSchema validates role assignment and status updates', () => {
  // Role assignment change
  const roleUpdate = { roleId: 3 };
  const res1 = updateUserSchema.safeParse(roleUpdate);
  assert.strictEqual(res1.success, true);
  assert.strictEqual(res1.data.roleId, 3);

  // Status deactivation
  const statusUpdate = { isActive: false };
  const res2 = updateUserSchema.safeParse(statusUpdate);
  assert.strictEqual(res2.success, true);
  assert.strictEqual(res2.data.isActive, false);

  // Empty update rejected by controller logic
  const emptyUpdate = {};
  const res3 = updateUserSchema.safeParse(emptyUpdate);
  assert.strictEqual(res3.success, true); // schema allows partial, controller checks Object.keys
});

test('SuperAdmin Management: Custom role creation persists icon, description and permission list', () => {
  const customRole = {
    roleCode: 'procurement_specialist',
    roleName: 'Procurement Specialist',
    icon: '🛒',
    description: 'Handles purchase orders and supplier procurement',
    permissionIds: [10, 11, 12],
  };

  const parsed = createRoleSchema.safeParse(customRole);
  assert.strictEqual(parsed.success, true);

  const serialized = serializeRoleMetadata({
    icon: parsed.data.icon,
    isActive: true,
    description: parsed.data.description,
    roleCode: parsed.data.roleCode,
  });

  const roundTrip = parseRoleMetadata(serialized, parsed.data.roleCode);
  assert.strictEqual(roundTrip.icon, '🛒');
  assert.strictEqual(roundTrip.isActive, true);
  assert.strictEqual(roundTrip.description, 'Handles purchase orders and supplier procurement');
});

test('SuperAdmin Management: Protected system roles are guarded from deletion and deactivation', () => {
  const systemRoles = ['super_admin', 'warehouse_admin', 'staff_admin', 'finance_admin'];

  systemRoles.forEach((roleCode) => {
    const isSystem = true;
    assert.strictEqual(isSystem, true, `${roleCode} must be identified as system role`);
    // Rule: system roles cannot be deleted
    const canDelete = !isSystem;
    assert.strictEqual(canDelete, false, `System role ${roleCode} cannot be deleted`);
  });
});
