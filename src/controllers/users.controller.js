import { z } from 'zod';
import { supabaseAdmin } from '../config/supabase.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ok, created, noContent, paginated } from '../utils/respond.js';
import { logActivity } from '../services/activityLog.service.js';
import { invalidateUserProfile } from '../utils/cache.js';

const SELECT = `
  user_id, full_name, username, email, contact_number, position, is_active, created_at,
  role:roles ( role_id, role_code, role_name )
`;

/**
 * Filters and sanitizes user records to prevent exposure of sensitive personal contact info
 * to non-administrative staff.
 */
const serializeUser = (user, callerRole) => {
  if (!user) return null;
  const isPrivileged = callerRole === 'super_admin' || callerRole === 'staff_admin';
  return {
    userId: user.user_id,
    fullName: user.full_name,
    username: user.username,
    email: isPrivileged ? user.email : user.email?.replace(/(.{2})(.*)(?=@)/, (_m, a, b) => a + '*'.repeat(Math.max(b.length, 3))),
    position: user.position,
    isActive: user.is_active,
    createdAt: user.created_at,
    contactNumber: isPrivileged ? user.contact_number : null,
    role: user.role,
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
    .from('users').select(SELECT).eq('user_id', req.params.id).single();
  if (error || !data) throw ApiError.notFound('User not found');
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
    .from('roles').select('role_id, role_code').eq('role_id', roleId).single();
  if (!roleRow) throw ApiError.badRequest('That role does not exist');

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

  await logActivity(req.user.id, 'create_user', 'users', data.user_id, { role: roleRow.role_code });
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

  // Guard role elevation: only Super Admins can assign the super_admin role
  if (patch.role_id !== undefined) {
    const { data: targetRole } = await supabaseAdmin
      .from('roles')
      .select('role_code')
      .eq('role_id', patch.role_id)
      .single();

    if (!targetRole) throw ApiError.badRequest('That role does not exist');

    if (targetRole.role_code === 'super_admin' && callerRole !== 'super_admin') {
      throw ApiError.forbidden('Only Super Admins can assign the Super Admin role');
    }

    // Non-super-admins cannot elevate user accounts above or equal to caller tier
    if (callerRole !== 'super_admin' && targetRole.role_code === callerRole && req.params.id === req.user.id) {
      // Self-promotion attempt prevented
      if (patch.role_id !== target.role?.role_id) {
        throw ApiError.forbidden('Users cannot modify their own administrative tier');
      }
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
  await logActivity(req.user.id, 'update_user', 'users', req.params.id, patch);
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
  await logActivity(req.user.id, 'delete_user', 'users', req.params.id);
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
  await logActivity(req.user.id, 'reset_password', 'users', req.params.id);
  ok(res, { message: 'Password updated' });
});
