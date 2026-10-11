import { z } from 'zod';
import { supabaseAdmin } from '../config/supabase.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ok, created, noContent, paginated } from '../utils/respond.js';
import { logActivity } from '../services/activityLog.service.js';
import { invalidateUserProfile } from '../utils/cache.js';
import { parseRoleMetadata } from './roles.controller.js';

const SELECT = `
  user_id, full_name, username, email, contact_number, position, is_active, created_at,
  role:roles ( role_id, role_code, role_name, description )
`;

/**
 * Filters and sanitizes user records to prevent exposure of sensitive personal contact info
 * to non-administrative staff. Attaches structured visual role metadata (icon, active state).
 */
const serializeUser = (user, callerRole) => {
  if (!user) return null;
  const isPrivileged = callerRole === 'super_admin' || callerRole === 'staff_admin';
  const roleMeta = user.role ? parseRoleMetadata(user.role.description, user.role.role_code) : null;
  return {
    userId: user.user_id,
    fullName: user.full_name,
    username: user.username,
    email: isPrivileged ? user.email : user.email?.replace(/(.{2})(.*)(?=@)/, (_m, a, b) => a + '*'.repeat(Math.max(b.length, 3))),
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
  const { role, search, active, page, limit } = req.query;
  let q = supabaseAdmin.from('users').select(SELECT).order('created_at', { ascending: false });

  if (active === 'true')  q = q.eq('is_active', true);
  if (active === 'false') q = q.eq('is_active', false);
  if (search) q = q.or(`full_name.ilike.%${search}%,username.ilike.%${search}%,email.ilike.%${search}%`);

  const { data, error } = await q;
  if (error) throw new ApiError(500, error.message);

  const rows = (role ? data.filter((u) => u.role?.role_code === role) : data)
    .map((u) => serializeUser(u, req.user.role?.role_code));

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
  if (error) throw new ApiError(500, error.message);
  if (!data) throw ApiError.notFound('User not found');
  ok(res, serializeUser(data, req.user.role?.role_code));
});

/**
 * POST /api/users
 * Creates the auth account and the profile row together. If the profile
 * insert fails the auth user is rolled back so no orphan account is left.
 */
export const createUser = asyncHandler(async (req, res) => {
  const { fullName, username, email, password, roleId, position, contactNumber } = req.body;

  const { data: roleRow } = await supabaseAdmin
    .from('roles').select('role_id, role_code, description').eq('role_id', roleId).single();
  if (!roleRow) throw ApiError.badRequest('That role does not exist');
  if (roleRow.description?.startsWith('[DEACTIVATED]')) {
    throw ApiError.badRequest(`Role "${roleRow.role_code}" is currently deactivated and cannot be assigned to users.`);
  }

  const callerRole = req.user?.role?.role_code;
  if (roleRow.role_code === 'super_admin' && callerRole !== 'super_admin') {
    throw ApiError.forbidden('Only Super Admins can create Super Admin accounts');
  }

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
    throw new ApiError(500, error.message);
  }

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
  created(res, serializeUser(data, req.user.role?.role_code));
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
    .select('user_id, role:roles(role_id, role_code)')
    .eq('user_id', req.params.id)
    .single();

  if (targetError || !target) throw ApiError.notFound('User not found');

  const callerRole = req.user.role?.role_code;

  // Block non-super-admins from modifying Super Admin accounts
  if (target.role?.role_code === 'super_admin' && callerRole !== 'super_admin') {
    throw ApiError.forbidden('Only Super Admins can modify Super Admin accounts');
  }

  let targetRole = null;
  // Guard role elevation: only Super Admins can assign the super_admin role
  if (patch.role_id !== undefined) {
    const { data: foundRole } = await supabaseAdmin
      .from('roles')
      .select('role_id, role_code, description')
      .eq('role_id', patch.role_id)
      .single();

    targetRole = foundRole;
    if (!targetRole) throw ApiError.badRequest('That role does not exist');
    if (targetRole.description?.startsWith('[DEACTIVATED]')) {
      throw ApiError.badRequest(`Role "${targetRole.role_code}" is currently deactivated and cannot be assigned to users.`);
    }

    if (targetRole.role_code === 'super_admin' && callerRole !== 'super_admin') {
      throw ApiError.forbidden('Only Super Admins can assign the Super Admin role');
    }

    // Users cannot change their own role (self-role manipulation prevented)
    if (callerRole !== 'super_admin' && req.params.id === req.user.id && patch.role_id !== target.role?.role_id) {
      throw ApiError.forbidden('Users cannot modify their own assigned role');
    }
  }

  // Guard: never let the last active Super Admin lock themselves out.
  if (target.role?.role_code === 'super_admin' && (patch.role_id !== undefined || patch.is_active === false)) {
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
  if (error) throw new ApiError(500, error.message);
  if (!data) throw ApiError.notFound('User not found');

  invalidateUserProfile(req.params.id);
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

  ok(res, serializeUser(data, req.user.role?.role_code));
});

/** DELETE /api/users/:id - removes the auth account; the profile cascades. */
export const deleteUser = asyncHandler(async (req, res) => {
  if (req.params.id === req.user.id) throw ApiError.badRequest('You cannot delete your own account');

  const { data: target } = await supabaseAdmin
    .from('users')
    .select('user_id, role:roles(role_code)')
    .eq('user_id', req.params.id)
    .single();

  if (!target) throw ApiError.notFound('User not found');

  if (target.role?.role_code === 'super_admin' && req.user.role?.role_code !== 'super_admin') {
    throw ApiError.forbidden('Only Super Admins can delete Super Admin accounts');
  }

  const { error } = await supabaseAdmin.auth.admin.deleteUser(req.params.id);
  if (error) throw new ApiError(500, error.message);

  invalidateUserProfile(req.params.id);
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
    .select('user_id, role:roles(role_code)')
    .eq('user_id', req.params.id)
    .single();

  if (targetError || !target) throw ApiError.notFound('User not found');

  const callerRole = req.user.role?.role_code;

  if (target.role?.role_code === 'super_admin' && callerRole !== 'super_admin') {
    throw ApiError.forbidden('Insufficient privileges to modify Super Admin credentials');
  }

  // Non-super-admins cannot reset credentials of other administrative tier accounts
  if (callerRole !== 'super_admin' && req.params.id !== req.user.id && target.role?.role_code !== 'staff_admin') {
    throw ApiError.forbidden('Insufficient privileges to modify credentials of this account tier');
  }

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
