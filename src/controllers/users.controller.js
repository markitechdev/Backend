import { z } from 'zod';
import { supabaseAdmin } from '../config/supabase.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ok, created, noContent, paginated } from '../utils/respond.js';
import { logActivity } from '../services/activityLog.service.js';
import { invalidateUserProfile } from '../utils/cache.js';
import { parseRoleMetadata } from './roles.controller.js';
import { isSuperAdminUser, userCan } from '../middleware/authorize.js';
import { safeSearchTerm } from '../utils/query.js';
import { invalidateDashboardCache } from '../utils/cache.js';

const SELECT = `
  user_id, full_name, username, email, contact_number, position, is_active, created_at,
  role:roles ( role_id, role_code, role_name, description )
`;

/**
 * Filters and sanitizes user records. Full email and contact number are only
 * returned to callers who manage accounts (users.manage) or are Super Admin;
 * view-only callers get a masked email and no phone number.
 */
const maskEmail = (email) => email?.replace(/(.{2})(.*)(?=@)/, (_m, a, b) => a + '*'.repeat(Math.max(b.length, 3)));

const serializeUser = (user, caller) => {
  if (!user) return null;
  const isPrivileged = userCan(caller, 'users.manage');
  const roleMeta = user.role ? parseRoleMetadata(user.role.description, user.role.role_code) : null;
  return {
    userId: user.user_id,
    fullName: user.full_name,
    username: user.username,
    email: isPrivileged ? user.email : maskEmail(user.email),
    position: user.position,
    isActive: user.is_active,
    createdAt: user.created_at,
    contactNumber: isPrivileged ? user.contact_number : null,
    role: user.role ? {
      roleId: user.role.role_id,
      roleCode: user.role.role_code,
      roleName: user.role.role_name,
      icon: roleMeta?.icon || '👤',
      isActive: roleMeta?.isActive ?? true,
    } : null,
  };
};

/** Super Admin accounts are invisible to everyone except other Super Admins. */
const ACCOUNT_ADMIN_PERMS = ['users.manage', 'roles.manage', 'system.manage', 'security.manage'];

/** Loads a role with its permission codes (null when it does not exist). */
const loadRole = async (roleId) => {
  const { data } = await supabaseAdmin
    .from('roles')
    .select('role_id, role_code, description, role_permissions ( permissions ( permission_code ) )')
    .eq('role_id', roleId)
    .maybeSingle();
  if (!data) return null;
  return {
    ...data,
    permissions: (data.role_permissions || []).map((rp) => rp.permissions?.permission_code).filter(Boolean),
    isActive: parseRoleMetadata(data.description, data.role_code).isActive,
  };
};

/**
 * "Administrator" roles: Super Admin, or any role that can manage accounts.
 * Only a Super Admin may grant such a role or change, reset or delete an
 * account that holds one. This closes the take-over path where a user
 * manager temporarily moves a peer into a resettable role.
 */
const isAdministratorRole = (role) =>
  role?.role_code === 'super_admin' || (role?.permissions || []).some((p) => ACCOUNT_ADMIN_PERMS.includes(p));

const assertAssignable = (role, caller) => {
  if (!role) throw ApiError.badRequest('That role does not exist');
  if (!role.isActive) {
    throw ApiError.badRequest(`Role "${role.role_code}" is currently deactivated and cannot be assigned to users.`);
  }
  if (!isSuperAdminUser(caller) && isAdministratorRole(role)) {
    throw ApiError.forbidden('Only a Super Admin can assign administrator roles (Super Admin or account-management roles).');
  }
};

const assertCanManageTarget = async (target, caller, action) => {
  if (isSuperAdminUser(caller)) return;
  if (target.role?.role_code === 'super_admin') {
    throw ApiError.forbidden('Only Super Admins can modify Super Admin accounts');
  }
  if (target.user_id === caller.id) return;
  const role = target.role?.role_id ? await loadRole(target.role.role_id) : null;
  if (isAdministratorRole(role)) {
    throw ApiError.forbidden(`Only a Super Admin can ${action} another administrator account.`);
  }
};

const visibleTo = (caller) => (u) => isSuperAdminUser(caller) || u.role?.role_code !== 'super_admin';

export const createUserSchema = z.object({
  fullName: z.string().min(2),
  username: z.string().min(3).regex(/^[a-zA-Z0-9._-]+$/, 'Letters, numbers, dot, dash and underscore only'),
  email: z.string().email(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  roleId: z.coerce.number().int().positive(),
  position: z.string().optional().nullable(),
  contactNumber: z.string().optional().nullable(),
});

export const updateUserSchema = z.object({
  fullName: z.string().min(2).optional(),
  username: z.string().min(3).optional(),
  roleId: z.coerce.number().int().positive().optional(),
  position: z.string().optional().nullable(),
  contactNumber: z.string().optional().nullable(),
  isActive: z.boolean().optional(),
});

/** GET /api/users */
export const listUsers = asyncHandler(async (req, res) => {
  const { role, active, page, limit } = req.query;
  const search = safeSearchTerm(req.query.search);
  let q = supabaseAdmin.from('users').select(SELECT).order('created_at', { ascending: false });

  if (active === 'true')  q = q.eq('is_active', true);
  if (active === 'false') q = q.eq('is_active', false);
  if (search) q = q.or(`full_name.ilike.%${search}%,username.ilike.%${search}%,email.ilike.%${search}%`);

  const { data, error } = await q;
  if (error) throw ApiError.fromDb(error);

  const rows = (data || [])
    .filter(visibleTo(req.user))
    .filter((u) => !role || u.role?.role_code === role)
    .map((u) => serializeUser(u, req.user));

  if (page || limit) {
    const pageNum = Math.max(1, Number(page) || 1);
    const limitNum = Math.max(1, Math.min(Number(limit) || 25, 100));
    const offset = (pageNum - 1) * limitNum;
    const paged = rows.slice(offset, offset + limitNum);
    return paginated(res, paged, { page: pageNum, limit: limitNum, total: rows.length });
  }

  ok(res, rows, { total: rows.length });
});

/** GET /api/users/:id */
export const getUser = asyncHandler(async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('users').select(SELECT).eq('user_id', req.params.id).maybeSingle();
  if (error) throw ApiError.fromDb(error);
  // Do not even confirm that a Super Admin account exists to non-super-admins
  if (!data || !visibleTo(req.user)(data)) throw ApiError.notFound('User not found');
  ok(res, serializeUser(data, req.user));
});

/**
 * POST /api/users
 * Creates the auth account and the profile row together. If the profile
 * insert fails the auth user is rolled back so no orphan account is left.
 */
export const createUser = asyncHandler(async (req, res) => {
  const { fullName, username, email, password, roleId, position, contactNumber } = req.body;

  const roleRow = await loadRole(roleId);
  assertAssignable(roleRow, req.user);

  const { data: authUser, error: authError } = await supabaseAdmin.auth.admin.createUser({
    email, password, email_confirm: true,
    user_metadata: { full_name: fullName, username },
  });
  if (authError) throw ApiError.badRequest(authError.message);

  const { data, error } = await supabaseAdmin.from('users').insert({
    user_id: authUser.user.id,
    full_name: fullName,
    username,
    email,
    role_id: roleId,
    position: position ?? null,
    contact_number: contactNumber ?? null,
  }).select(SELECT).single();

  if (error) {
    await supabaseAdmin.auth.admin.deleteUser(authUser.user.id);
    if (error.code === '23505') throw ApiError.conflict('That username or email is already taken');
    throw ApiError.fromDb(error);
  }

  invalidateDashboardCache();
  await logActivity(req.user.id, 'USER_CREATED', 'users', data.user_id, {
    role: roleRow.role_code,
    email: data.email,
    username: data.username,
    fullName: data.full_name,
  });
  await logActivity(req.user.id, 'ROLE_ASSIGNED', 'roles', roleId, {
    affectedUserId: data.user_id,
    roleCode: roleRow.role_code,
    user: data.full_name,
  });
  created(res, serializeUser(data, req.user));
});

/** PATCH /api/users/:id */
export const updateUser = asyncHandler(async (req, res) => {
  const patch = {};
  if (req.body.fullName      !== undefined) patch.full_name      = req.body.fullName;
  if (req.body.username      !== undefined) patch.username       = req.body.username;
  if (req.body.roleId        !== undefined) patch.role_id        = req.body.roleId;
  if (req.body.position      !== undefined) patch.position       = req.body.position;
  if (req.body.contactNumber !== undefined) patch.contact_number = req.body.contactNumber;
  if (req.body.isActive      !== undefined) patch.is_active      = req.body.isActive;

  if (!Object.keys(patch).length) throw ApiError.badRequest('No fields to update');

  // Fetch target user to inspect role tier
  const { data: target, error: targetError } = await supabaseAdmin
    .from('users')
    .select('user_id, username, is_active, role:roles(role_id, role_code)')
    .eq('user_id', req.params.id)
    .maybeSingle();

  if (targetError || !target) throw ApiError.notFound('User not found');

  const isSelf = req.params.id === req.user.id;
  await assertCanManageTarget(target, req.user, 'change');

  if (isSelf && !isSuperAdminUser(req.user)) {
    if (patch.role_id !== undefined && patch.role_id !== target.role?.role_id) {
      throw ApiError.forbidden('Users cannot modify their own assigned role');
    }
    if (patch.is_active === false) throw ApiError.forbidden('You cannot deactivate your own account');
  }

  let targetRole = null;
  if (patch.role_id !== undefined && patch.role_id !== target.role?.role_id) {
    targetRole = await loadRole(patch.role_id);
    assertAssignable(targetRole, req.user);
  }

  // Guard: never let the last active Super Admin lock themselves out.
  const demotesSuperAdmin = target.role?.role_code === 'super_admin' && target.is_active
    && ((patch.role_id !== undefined && patch.role_id !== target.role?.role_id) || patch.is_active === false);
  if (demotesSuperAdmin) {
    const { count } = await supabaseAdmin
      .from('users')
      .select('user_id, roles!inner(role_code)', { count: 'exact', head: true })
      .eq('is_active', true)
      .eq('roles.role_code', 'super_admin');

    if ((count ?? 0) <= 1) {
      throw ApiError.conflict('This is the last active Super Admin and cannot be demoted or deactivated.');
    }
  }

  const { data, error } = await supabaseAdmin
    .from('users').update(patch).eq('user_id', req.params.id).select(SELECT).single();
  if (error) throw ApiError.fromDb(error);
  if (!data) throw ApiError.notFound('User not found');

  invalidateUserProfile(req.params.id);
  invalidateDashboardCache();
  if (patch.is_active !== undefined) {
    const act = patch.is_active ? 'USER_ACTIVATED' : 'USER_DEACTIVATED';
    await logActivity(req.user.id, act, 'users', req.params.id, {
      username: data.username,
      fullName: data.full_name,
    });
  }
  await logActivity(req.user.id, 'USER_UPDATED', 'users', req.params.id, {
    updatedFields: Object.keys(patch),
    username: data.username,
  });

  if (patch.role_id !== undefined && patch.role_id !== target.role?.role_id && targetRole) {
    await logActivity(req.user.id, 'USER_ROLE_CHANGED', 'users', req.params.id, {
      previousRoleId: target.role?.role_id,
      previousRoleCode: target.role?.role_code,
      newRoleId: patch.role_id,
      newRoleCode: targetRole.role_code,
    });
    await logActivity(req.user.id, 'ROLE_ASSIGNED', 'roles', patch.role_id, {
      affectedUserId: req.params.id,
      roleCode: targetRole.role_code,
    });
  }

  ok(res, serializeUser(data, req.user));
});

/** DELETE /api/users/:id - removes the auth account; the profile cascades. */
export const deleteUser = asyncHandler(async (req, res) => {
  if (req.params.id === req.user.id) throw ApiError.badRequest('You cannot delete your own account');

  const { data: target } = await supabaseAdmin
    .from('users')
    .select('user_id, username, role:roles(role_id, role_code)')
    .eq('user_id', req.params.id)
    .maybeSingle();

  if (!target) throw ApiError.notFound('User not found');

  await assertCanManageTarget(target, req.user, 'delete');

  // Never delete the last active Super Admin
  if (target.role?.role_code === 'super_admin') {
    const { count } = await supabaseAdmin
      .from('users')
      .select('user_id, roles!inner(role_code)', { count: 'exact', head: true })
      .eq('is_active', true)
      .eq('roles.role_code', 'super_admin');
    if ((count ?? 0) <= 1) throw ApiError.conflict('This is the last active Super Admin and cannot be deleted.');
  }

  const { error } = await supabaseAdmin.auth.admin.deleteUser(req.params.id);
  if (error) throw ApiError.fromDb(error);

  invalidateUserProfile(req.params.id);
  invalidateDashboardCache();
  await logActivity(req.user.id, 'USER_DELETED', 'users', req.params.id, {
    targetUsername: target.username,
  });
  noContent(res);
});

export const resetPasswordSchema = z.object({ password: z.string().min(8) });

/** POST /api/users/:id/password */
export const resetPassword = asyncHandler(async (req, res) => {
  // Inspect target user tier to prevent IDOR against Super Admins
  const { data: target, error: targetError } = await supabaseAdmin
    .from('users')
    .select('user_id, username, role:roles(role_id, role_code)')
    .eq('user_id', req.params.id)
    .maybeSingle();

  if (targetError || !target) throw ApiError.notFound('User not found');

  await assertCanManageTarget(target, req.user, 'reset the password of');

  const { error } = await supabaseAdmin.auth.admin.updateUserById(req.params.id, {
    password: req.body.password,
  });
  if (error) throw ApiError.badRequest(error.message);

  invalidateUserProfile(req.params.id);
  await logActivity(req.user.id, 'USER_PASSWORD_RESET', 'users', req.params.id, {
    targetUsername: target.username,
  });
  ok(res, { message: 'Password updated' });
});
