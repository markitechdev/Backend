import { z } from 'zod';
import { supabaseAdmin } from '../config/supabase.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ok, created } from '../utils/respond.js';
import { logActivity } from '../services/activityLog.service.js';
import { invalidateAllUserProfiles } from '../utils/cache.js';
import { isSuperAdminUser, userCan } from '../middleware/authorize.js';

/** Confirms every permission id exists; returns the de-duplicated id list. */
const validatePermissionIds = async (ids = []) => {
  const unique = [...new Set(ids.map(Number))];
  if (!unique.length) return unique;
  const { data, error } = await supabaseAdmin
    .from('permissions').select('permission_id').in('permission_id', unique);
  if (error) throw ApiError.fromDb(error);
  const found = new Set((data || []).map((p) => p.permission_id));
  const unknown = unique.filter((id) => !found.has(id));
  if (unknown.length) throw ApiError.badRequest(`Unknown permission id(s): ${unknown.join(', ')}`);
  return unique;
};

/**
 * Visual metadata icon mapping per job role tier.
 * Emojis are visual metadata ONLY and are NEVER used for authorization.
 */
export const getDefaultRoleIcon = (roleCode) => {
  switch (roleCode) {
    case 'super_admin':
      return '🛡️';
    case 'system_admin':
    case 'tenant_admin':
    case 'admin':
      return '⚙️';
    case 'warehouse_manager':
    case 'warehouse_admin':
      return '📦';
    case 'purchasing_officer':
    case 'buyer':
      return '🛒';
    case 'staff_manager':
    case 'staff_admin':
      return '👥';
    case 'inventory_analyst':
      return '📊';
    case 'auditor':
      return '🔍';
    case 'inventory_staff':
    case 'staff':
    case 'user':
      return '👤';
    case 'finance_admin':
      return '💰';
    case 'manager':
      return '🧭';
    default:
      return '🧩';
  }
};

/** Parses role metadata (icon, active state, clean description) encoded in description */
export const parseRoleMetadata = (description, roleCode) => {
  let raw = description || '';
  let icon = null;
  const iconMatch = raw.match(/\[ICON:([^\]]+)\]/);
  if (iconMatch) {
    icon = iconMatch[1].trim();
    raw = raw.replace(/\[ICON:[^\]]+\]\s*/g, '');
  } else {
    icon = getDefaultRoleIcon(roleCode);
  }

  const isDeactivated = raw.startsWith('[DEACTIVATED]');
  const cleanDescription = raw.replace(/^\[DEACTIVATED\]\s*/, '').trim();

  return {
    icon,
    isActive: !isDeactivated,
    description: cleanDescription,
  };
};

/** Removes the internal [ICON:..] / [DEACTIVATED] markers from user-typed text. */
const cleanUserDescription = (text) => (text || '').replace(/\[(ICON:[^\]]*|DEACTIVATED)\]/gi, '').replace(/\s+/g, ' ').trim();

/** Serializes role metadata into PostgreSQL description text permanently */
export const serializeRoleMetadata = ({ icon, isActive, description, roleCode }) => {
  const chosenIcon = (icon && icon.trim()) ? icon.trim().replace(/[[\]]/g, '') : getDefaultRoleIcon(roleCode);
  const cleanDesc = cleanUserDescription(description);
  const iconTag = `[ICON:${chosenIcon}]`;
  const deactTag = isActive === false ? '[DEACTIVATED] ' : '';
  return `${iconTag} ${deactTag}${cleanDesc}`.trim();
};

/** GET /api/roles - roles with their permission codes, user counts, icon, and active status. */
export const listRoles = asyncHandler(async (req, res) => {
  const { data: roles, error } = await supabaseAdmin
    .from('roles')
    .select('role_id, role_code, role_name, description, is_system, role_permissions ( permissions ( permission_id, permission_code, module, description ) )')
    .order('role_id');
  if (error) throw ApiError.fromDb(error);

  const { data: users } = await supabaseAdmin.from('users').select('role_id, is_active');
  const callerIsSuper = isSuperAdminUser(req.user);

  // The Super Admin tier is not part of the tenant-facing role catalogue
  ok(res, (roles || []).filter((r) => callerIsSuper || r.role_code !== 'super_admin').map((r) => {
    const meta = parseRoleMetadata(r.description, r.role_code);
    return {
      roleId: r.role_id,
      roleCode: r.role_code,
      roleName: r.role_name,
      icon: meta.icon,
      description: meta.description,
      isSystem: r.is_system,
      isActive: meta.isActive,
      userCount: (users || []).filter((u) => u.role_id === r.role_id && u.is_active).length,
      totalUserCount: (users || []).filter((u) => u.role_id === r.role_id).length,
      permissions: (r.role_permissions || []).map((rp) => rp.permissions).filter(Boolean),
    };
  }));
});

/** GET /api/roles/:id - retrieve a single role with effective permissions and icon. */
export const getRole = asyncHandler(async (req, res) => {
  const roleId = Number(req.params.id);
  const { data: role, error } = await supabaseAdmin
    .from('roles')
    .select('role_id, role_code, role_name, description, is_system, role_permissions ( permissions ( permission_id, permission_code, module, description ) )')
    .eq('role_id', roleId)
    .single();

  if (error || !role) throw ApiError.notFound('Role not found');
  if (role.role_code === 'super_admin' && !isSuperAdminUser(req.user)) throw ApiError.notFound('Role not found');

  const { count } = await supabaseAdmin
    .from('users')
    .select('user_id', { count: 'exact', head: true })
    .eq('role_id', roleId)
    .eq('is_active', true);

  const meta = parseRoleMetadata(role.description, role.role_code);

  ok(res, {
    roleId: role.role_id,
    roleCode: role.role_code,
    roleName: role.role_name,
    icon: meta.icon,
    description: meta.description,
    isSystem: role.is_system,
    isActive: meta.isActive,
    userCount: count ?? 0,
    permissions: (role.role_permissions || []).map((rp) => rp.permissions).filter(Boolean),
  });
});

/** GET /api/roles/:id/users - retrieve all users assigned to a specific role. */
export const getRoleUsers = asyncHandler(async (req, res) => {
  const roleId = Number(req.params.id);
  const { data: role, error: roleError } = await supabaseAdmin
    .from('roles')
    .select('role_id, role_code, role_name, description')
    .eq('role_id', roleId)
    .single();

  if (roleError || !role) throw ApiError.notFound('Role not found');
  if (role.role_code === 'super_admin' && !isSuperAdminUser(req.user)) {
    throw ApiError.notFound('Role not found');
  }

  const { data: users, error } = await supabaseAdmin
    .from('users')
    .select('user_id, full_name, username, email, position, is_active, created_at')
    .eq('role_id', roleId)
    .order('full_name');

  if (error) throw ApiError.fromDb(error);

  const meta = parseRoleMetadata(role.description, role.role_code);

  ok(res, {
    role: {
      roleId: role.role_id,
      roleCode: role.role_code,
      roleName: role.role_name,
      icon: meta.icon,
    },
    users: (users || []).map((u) => ({
      userId: u.user_id,
      fullName: u.full_name,
      username: u.username,
      email: userCan(req.user, 'users.manage') ? u.email : u.email?.replace(/(.{2})(.*)(?=@)/, (_m, a, b) => a + '*'.repeat(Math.max(b.length, 3))),
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
  if (error) throw ApiError.fromDb(error);

  const grouped = data.reduce((acc, p) => {
    (acc[p.module] ||= []).push(p);
    return acc;
  }, {});
  ok(res, { permissions: data, grouped });
});

export const createRoleSchema = z.object({
  roleCode: z.string().min(3).regex(/^[a-z_]+$/, 'Lowercase letters and underscores only'),
  roleName: z.string().min(3),
  icon: z.string().max(8).optional().nullable(),
  emoji: z.string().max(8).optional().nullable(),
  description: z.string().optional().nullable(),
  permissionIds: z.array(z.coerce.number().int().positive()).default([]),
});

/** POST /api/roles */
export const createRole = asyncHandler(async (req, res) => {
  const callerRole = req.user.role?.role_code;
  if (callerRole !== 'super_admin') {
    throw ApiError.forbidden('Only Super Admins can create new system roles');
  }

  const { roleCode, roleName, description, icon, emoji } = req.body;
  if (roleCode === 'super_admin') {
    throw ApiError.badRequest('Cannot create duplicate super_admin role');
  }
  const permissionIds = await validatePermissionIds(req.body.permissionIds);

  const roleIcon = icon || emoji || getDefaultRoleIcon(roleCode);
  const serializedDesc = serializeRoleMetadata({
    icon: roleIcon,
    isActive: true,
    description,
    roleCode,
  });

  const { data: role, error } = await supabaseAdmin
    .from('roles')
    .insert({ role_code: roleCode, role_name: roleName, description: serializedDesc, is_system: false })
    .select().single();
  if (error) {
    if (error.code === '23505') throw ApiError.conflict('A role with that code already exists');
    throw ApiError.fromDb(error);
  }

  if (permissionIds.length) {
    const { error: permError } = await supabaseAdmin.from('role_permissions')
      .insert(permissionIds.map((id) => ({ role_id: role.role_id, permission_id: id })));
    if (permError) {
      // Do not leave a half-created role behind
      await supabaseAdmin.from('roles').delete().eq('role_id', role.role_id);
      throw ApiError.fromDb(permError);
    }
  }

  await logActivity(req.user.id, 'ROLE_CREATED', 'roles', role.role_id, {
    roleCode,
    roleName,
    icon: roleIcon,
    permissionsCount: permissionIds.length,
  });

  const meta = parseRoleMetadata(role.description, role.role_code);

  created(res, {
    roleId: role.role_id,
    roleCode: role.role_code,
    roleName: role.role_name,
    icon: meta.icon,
    description: meta.description,
    isSystem: false,
    isActive: true,
  });
});

export const updateRoleSchema = z.object({
  roleName: z.string().min(3).optional(),
  icon: z.string().max(8).optional().nullable(),
  emoji: z.string().max(8).optional().nullable(),
  description: z.string().optional().nullable(),
  isActive: z.boolean().optional(),
});

/** PATCH/PUT /api/roles/:id - edits role name, icon, description, or active status. */
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

  const { roleName, description, icon, emoji, isActive } = req.body;
  const currentMeta = parseRoleMetadata(existing.description, existing.role_code);

  if (isActive === false && existing.is_system) {
    throw ApiError.badRequest('Protected system roles cannot be deactivated');
  }

  const targetIcon = (icon !== undefined || emoji !== undefined)
    ? (icon || emoji || getDefaultRoleIcon(existing.role_code))
    : currentMeta.icon;

  const targetActive = isActive !== undefined ? isActive : currentMeta.isActive;
  const targetDesc = description !== undefined ? (description || '') : currentMeta.description;

  const finalDescription = serializeRoleMetadata({
    icon: targetIcon,
    isActive: targetActive,
    description: targetDesc,
    roleCode: existing.role_code,
  });

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
    if (updateError) throw ApiError.fromDb(updateError);
  }

  invalidateAllUserProfiles();

  if (isActive !== undefined && isActive !== currentMeta.isActive) {
    const action = isActive ? 'ROLE_ACTIVATED' : 'ROLE_DEACTIVATED';
    await logActivity(req.user.id, action, 'roles', roleId, {
      roleCode: existing.role_code,
      roleName: patch.role_name || existing.role_name,
      icon: targetIcon,
    });
  } else {
    await logActivity(req.user.id, 'ROLE_UPDATED', 'roles', roleId, {
      roleCode: existing.role_code,
      icon: targetIcon,
      changes: patch,
    });
  }

  const { data: updated } = await supabaseAdmin
    .from('roles')
    .select('role_id, role_code, role_name, description, is_system, role_permissions ( permissions ( permission_id, permission_code, module, description ) )')
    .eq('role_id', roleId)
    .single();

  const updatedMeta = parseRoleMetadata(updated.description, updated.role_code);

  ok(res, {
    roleId: updated.role_id,
    roleCode: updated.role_code,
    roleName: updated.role_name,
    icon: updatedMeta.icon,
    description: updatedMeta.description,
    isSystem: updated.is_system,
    isActive: updatedMeta.isActive,
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
  if (!Number.isInteger(roleId) || roleId <= 0) throw ApiError.badRequest('Role ID must be a positive integer');

  const { data: role } = await supabaseAdmin
    .from('roles').select('role_id, role_code').eq('role_id', roleId).maybeSingle();
  if (!role) throw ApiError.notFound('Role not found');
  if (role.role_code === 'super_admin') {
    throw ApiError.forbidden('Super Admin permissions cannot be reduced or modified.');
  }

  // Validate first: an unknown id used to wipe the role's permissions and then fail.
  const permissionIds = await validatePermissionIds(req.body.permissionIds);

  const { data: previous } = await supabaseAdmin
    .from('role_permissions').select('permission_id').eq('role_id', roleId);

  const { error: delError } = await supabaseAdmin.from('role_permissions').delete().eq('role_id', roleId);
  if (delError) throw ApiError.fromDb(delError);

  if (permissionIds.length) {
    const { error } = await supabaseAdmin.from('role_permissions')
      .insert(permissionIds.map((id) => ({ role_id: roleId, permission_id: id })));
    if (error) {
      // Restore the previous permission set so the role is never left empty by a failure
      if (previous?.length) {
        await supabaseAdmin.from('role_permissions')
          .insert(previous.map((p) => ({ role_id: roleId, permission_id: p.permission_id })));
      }
      throw ApiError.fromDb(error);
    }
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

  const { error: delError } = await supabaseAdmin.from('roles').delete().eq('role_id', roleId);
  if (delError) throw ApiError.fromDb(delError);
  invalidateAllUserProfiles();
  await logActivity(req.user.id, 'ROLE_DELETED', 'roles', roleId, {
    roleCode: role.role_code,
  });
  ok(res, { message: 'Role deleted' });
});
