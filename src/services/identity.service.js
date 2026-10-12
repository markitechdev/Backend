import { supabaseAdmin } from '../config/supabase.js';
import { ApiError } from '../utils/ApiError.js';
import { profileCache } from '../utils/cache.js';

import { parseRoleMetadata } from '../controllers/roles.controller.js';

// Same parser the role screens use. The Super Admin role can never be treated
// as deactivated, so a bad description can never lock every Super Admin out.
const isRoleDeactivated = (role) =>
  role?.role_code !== 'super_admin' && !parseRoleMetadata(role?.description, role?.role_code).isActive;

/**
 * Loads (and caches for 60s) the caller's profile, role and permission list.
 * Shared by the normal and the Super Admin authentication middleware so both
 * enforce exactly the same account rules:
 *   - a profile row must exist
 *   - the account must be active
 *   - the account's role must exist and must not be deactivated
 */
export const loadUserIdentity = async (userId, { useCache = true } = {}) => {
  const cacheKey = `user_${userId}`;
  if (useCache) {
    const cached = profileCache.get(cacheKey);
    if (cached) return cached;
  }

  const { data: profile, error: profileError } = await supabaseAdmin
    .from('users')
    .select(`
      user_id, full_name, username, email, is_active, position, contact_number,
      role:roles ( role_id, role_code, role_name, description )
    `)
    .eq('user_id', userId)
    .maybeSingle();

  if (profileError) throw new ApiError(500, 'Could not load the account profile');
  if (!profile) throw ApiError.forbidden('No profile is linked to this account. Contact the Super Admin.');
  if (!profile.is_active) throw ApiError.forbidden('This account has been deactivated.');
  if (!profile.role) throw ApiError.forbidden('This account has no role assigned. Contact the Super Admin.');
  if (isRoleDeactivated(profile.role)) {
    throw ApiError.forbidden('Your role has been deactivated. Contact the Super Admin.');
  }

  const { data: perms, error: permError } = await supabaseAdmin
    .from('role_permissions')
    .select('permissions ( permission_code )')
    .eq('role_id', profile.role.role_id);
  if (permError) throw new ApiError(500, 'Could not load role permissions');

  const { description: _omit, ...role } = profile.role;
  const identity = {
    id: profile.user_id,
    fullName: profile.full_name,
    username: profile.username,
    email: profile.email,
    position: profile.position,
    contactNumber: profile.contact_number,
    role,
    isSuperAdmin: role.role_code === 'super_admin',
    permissions: (perms || []).map((p) => p.permissions?.permission_code).filter(Boolean),
  };

  profileCache.set(cacheKey, identity);
  return identity;
};
