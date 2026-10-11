import { z } from 'zod';
import { supabaseAdmin } from '../config/supabase.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ok, created } from '../utils/respond.js';
import { logActivity } from '../services/activityLog.service.js';
import { invalidateAllUserProfiles } from '../utils/cache.js';

/** GET /api/roles - roles with their permission codes, user counts, and active status. */
export const listRoles = asyncHandler(async (_req, res) => {
  const { data: roles, error } = await supabaseAdmin
    .from('roles')
    .select('role_id, role_code, role_name, description, is_system, role_permissions ( permissions ( permission_id, permission_code, module, description ) )')
    .order('role_id');
  if (error) throw new ApiError(500, error.message);

  const { data: users } = await supabaseAdmin.from('users').select('role_id, is_active');

  ok(res, (roles || []).map((r) => {
    const isDeactivated = (r.description || '').startsWith('[DEACTIVATED]');
    const cleanDesc = (r.description || '').replace(/^\[DEACTIVATED\]\s*/, '');
    return {
      roleId: r.role_id,
      roleCode: r.role_code,
      roleName: r.role_name,
      description: cleanDesc,
      isSystem: r.is_system,
      isActive: !isDeactivated,
      userCount: (users || []).filter((u) => u.role_id === r.role_id && u.is_active).length,
      permissions: (r.role_permissions || []).map((rp) => rp.permissions).filter(Boolean),
    };
  }));
});

/** GET /api/roles/:id - retrieve a single role with effective permissions. */
export const getRole = asyncHandler(async (req, res) => {
  const roleId = Number(req.params.id);
  const { data: role, error } = await supabaseAdmin
    .from('roles')
    .select('role_id, role_code, role_name, description, is_system, role_permissions ( permissions ( permission_id, permission_code, module, description ) )')
    .eq('role_id', roleId)
    .single();

  if (error || !role) throw ApiError.notFound('Role not found');

  const { count } = await supabaseAdmin
    .from('users')
    .select('user_id', { count: 'exact', head: true })
    .eq('role_id', roleId)
    .eq('is_active', true);

  const isDeactivated = (role.description || '').startsWith('[DEACTIVATED]');
  const cleanDesc = (role.description || '').replace(/^\[DEACTIVATED\]\s*/, '');

  ok(res, {
    roleId: role.role_id,
    roleCode: role.role_code,
    roleName: role.role_name,
    description: cleanDesc,
    isSystem: role.is_system,
    isActive: !isDeactivated,
    userCount: count ?? 0,
    permissions: (role.role_permissions || []).map((rp) => rp.permissions).filter(Boolean),
  });
});

/** GET /api/roles/:id/users - retrieve all users assigned to a specific role. */
export const getRoleUsers = asyncHandler(async (req, res) => {
  const roleId = Number(req.params.id);
  const { data: role, error: roleError } = await supabaseAdmin
    .from('roles')
    .select('role_id, role_code, role_name')
    .eq('role_id', roleId)
    .single();

  if (roleError || !role) throw ApiError.notFound('Role not found');

  const { data: users, error } = await supabaseAdmin
    .from('users')
    .select('user_id, full_name, username, email, position, is_active, created_at')
    .eq('role_id', roleId)
    .order('full_name');

  if (error) throw new ApiError(500, error.message);

  ok(res, {
    role: {
      roleId: role.role_id,
      roleCode: role.role_code,
      roleName: role.role_name,
    },
    users: (users || []).map((u) => ({
      userId: u.user_id,
      fullName: u.full_name,
      username: u.username,
      email: u.email,
      position: u.position,
      isActive: u.is_active,
      createdAt: u.created_at,
    })),
    totalUsers: (users || []).length,
  });
});

/** GET /api/roles/permissions - the full permission catalogue, grouped by module. */
export const listPermissions = asyncHandler(async (_req, res) => {
  const { data, error } = await supabaseAdmin
    .from('permissions')
    .select('permission_id, permission_code, module, description')
    .order('module').order('permission_code');
  if (error) throw new ApiError(500, error.message);

  const grouped = data.reduce((acc, p) => {
    (acc[p.module] ||= []).push(p);
    return acc;
  }, {});
  ok(res, { permissions: data, grouped });
});

export const createRoleSchema = z.object({
  roleCode: z.string().min(3).regex(/^[a-z_]+$/, 'Lowercase letters and underscores only'),
  roleName: z.string().min(3),
  description: z.string().optional().nullable(),
  permissionIds: z.array(z.coerce.number().int().positive()).default([]),
});

/** POST /api/roles */
export const createRole = asyncHandler(async (req, res) => {
  const callerRole = req.user.role?.role_code;
  if (callerRole !== 'super_admin') {
    throw ApiError.forbidden('Only Super Admins can create new system roles');
  }

  const { roleCode, roleName, description, permissionIds } = req.body;
  if (roleCode === 'super_admin') {
    throw ApiError.badRequest('Cannot create duplicate super_admin role');
  }

  const { data: role, error } = await supabaseAdmin
    .from('roles')
    .insert({ role_code: roleCode, role_name: roleName, description: description ?? null, is_system: false })
    .select().single();
  if (error) {
    if (error.code === '23505') throw ApiError.conflict('A role with that code already exists');
    throw new ApiError(500, error.message);
  }

  if (permissionIds.length) {
    await supabaseAdmin.from('role_permissions')
      .insert(permissionIds.map((id) => ({ role_id: role.role_id, permission_id: id })));
  }

  await logActivity(req.user.id, 'ROLE_CREATED', 'roles', role.role_id, {
    roleCode,
    roleName,
    permissionsCount: permissionIds.length,
  });
  created(res, {
    roleId: role.role_id,
    roleCode: role.role_code,
    roleName: role.role_name,
    description: role.description,
    isSystem: false,
    isActive: true,
  });
});

export const updateRoleSchema = z.object({
  roleName: z.string().min(3).optional(),
  description: z.string().optional().nullable(),
  isActive: z.boolean().optional(),
});

/** PATCH/PUT /api/roles/:id - edits role name, description, or active status. */
export const updateRole = asyncHandler(async (req, res) => {
  const callerRole = req.user.role?.role_code;
  if (callerRole !== 'super_admin') {
    throw ApiError.forbidden('Only Super Admins can modify roles');
  }

  const roleId = Number(req.params.id);
  const { data: existing, error: findError } = await supabaseAdmin
    .from('roles')
    .select('role_id, role_code, role_name, description, is_system')
    .eq('role_id', roleId)
    .single();

  if (findError || !existing) throw ApiError.notFound('Role not found');

  const { roleName, description, isActive } = req.body;
  const wasDeactivated = (existing.description || '').startsWith('[DEACTIVATED]');
  let cleanDesc = description !== undefined
    ? (description || '')
    : (existing.description || '').replace(/^\[DEACTIVATED\]\s*/, '');

  if (isActive === false && existing.is_system) {
    throw ApiError.badRequest('Protected system roles cannot be deactivated');
  }

  let newIsActive = !wasDeactivated;
  if (isActive !== undefined) {
    newIsActive = isActive;
  }

  const finalDescription = newIsActive ? cleanDesc : `[DEACTIVATED] ${cleanDesc}`.trim();

  const patch = {};
  if (roleName !== undefined) {
    if (existing.role_code === 'super_admin') {
      throw ApiError.forbidden('Super Admin role name cannot be modified');
    }
    patch.role_name = roleName;
  }
  if (finalDescription !== existing.description) {
    patch.description = finalDescription;
  }

  if (Object.keys(patch).length > 0) {
    const { error: updateError } = await supabaseAdmin
      .from('roles')
      .update(patch)
      .eq('role_id', roleId);
    if (updateError) throw new ApiError(500, updateError.message);
  }

  invalidateAllUserProfiles();

  if (isActive !== undefined && isActive !== !wasDeactivated) {
    const action = isActive ? 'ROLE_ACTIVATED' : 'ROLE_DEACTIVATED';
    await logActivity(req.user.id, action, 'roles', roleId, {
      roleCode: existing.role_code,
      roleName: patch.role_name || existing.role_name,
    });
  } else {
    await logActivity(req.user.id, 'ROLE_UPDATED', 'roles', roleId, {
      roleCode: existing.role_code,
      changes: patch,
    });
  }

  const { data: updated } = await supabaseAdmin
    .from('roles')
    .select('role_id, role_code, role_name, description, is_system, role_permissions ( permissions ( permission_id, permission_code, module, description ) )')
    .eq('role_id', roleId)
    .single();

  ok(res, {
    roleId: updated.role_id,
    roleCode: updated.role_code,
    roleName: updated.role_name,
    description: cleanDesc,
    isSystem: updated.is_system,
    isActive: newIsActive,
    permissions: (updated.role_permissions || []).map((rp) => rp.permissions).filter(Boolean),
  });
});

export const updatePermissionsSchema = z.object({
  permissionIds: z.array(z.coerce.number().int().positive()),
});

/** PUT /api/roles/:id/permissions - replaces the role's permission set. */
export const updateRolePermissions = asyncHandler(async (req, res) => {
  const callerRole = req.user.role?.role_code;
  if (callerRole !== 'super_admin') {
    throw ApiError.forbidden('Only Super Admins are permitted to modify role permissions');
  }

  const roleId = Number(req.params.id);
  const { permissionIds } = req.body;

  const { data: role } = await supabaseAdmin
    .from('roles').select('role_id, role_code').eq('role_id', roleId).single();
  if (!role) throw ApiError.notFound('Role not found');
  if (role.role_code === 'super_admin') {
    throw ApiError.forbidden('Super Admin permissions cannot be reduced or modified.');
  }

  await supabaseAdmin.from('role_permissions').delete().eq('role_id', roleId);
  if (permissionIds.length) {
    const { error } = await supabaseAdmin.from('role_permissions')
      .insert(permissionIds.map((id) => ({ role_id: roleId, permission_id: id })));
    if (error) throw new ApiError(500, error.message);
  }

  invalidateAllUserProfiles();
  await logActivity(req.user.id, 'ROLE_UPDATED', 'roles', roleId, {
    action: 'permissions_updated',
    count: permissionIds.length,
    permissionIds,
  });
  await logActivity(req.user.id, 'PERMISSION_ADDED', 'roles', roleId, {
    count: permissionIds.length,
  });
  ok(res, { roleId, permissionIds });
});

/** DELETE /api/roles/:id */
export const deleteRole = asyncHandler(async (req, res) => {
  const callerRole = req.user.role?.role_code;
  if (callerRole !== 'super_admin') {
    throw ApiError.forbidden('Only Super Admins can delete roles');
  }

  const roleId = Number(req.params.id);
  const { data: role } = await supabaseAdmin
    .from('roles').select('is_system, role_code').eq('role_id', roleId).single();
  if (!role) throw ApiError.notFound('Role not found');
  if (role.is_system) throw ApiError.forbidden('System roles cannot be deleted');

  const { count } = await supabaseAdmin
    .from('users').select('user_id', { count: 'exact', head: true }).eq('role_id', roleId);
  if (count) throw ApiError.conflict(`${count} user(s) still use this role. Reassign them first.`);

  await supabaseAdmin.from('roles').delete().eq('role_id', roleId);
  invalidateAllUserProfiles();
  await logActivity(req.user.id, 'ROLE_DELETED', 'roles', roleId, {
    roleCode: role.role_code,
  });
  ok(res, { message: 'Role deleted' });
});
