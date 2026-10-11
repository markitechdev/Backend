import { supabaseAdmin } from '../config/supabase.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { isTokenRevoked } from '../utils/tokenBlacklist.js';
import { profileCache } from '../utils/cache.js';

/**
 * Dedicated Super Admin authentication & authorization middleware.
 * Authoritatively verifies the Bearer token, session validity,
 * active account status, and strictly enforces the `super_admin` role.
 *
 * Client-submitted role claims are completely ignored.
 * Normal users (admin, manager, staff) are rejected with 403 Forbidden.
 * Invalid or expired tokens are rejected with 401 Unauthorized.
 */
export const authenticateSuperAdmin = asyncHandler(async (req, _res, next) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) throw ApiError.unauthorized('Missing bearer token');

  if (isTokenRevoked(token)) {
    throw ApiError.unauthorized('Session has been revoked or signed out');
  }

  const { data: authData, error: authError } = await supabaseAdmin.auth.getUser(token);
  if (authError || !authData?.user) throw ApiError.unauthorized('Invalid or expired session');

  const cacheKey = `user_${authData.user.id}`;
  let userPayload = profileCache.get(cacheKey);

  if (!userPayload) {
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('users')
      .select(`
        user_id, full_name, username, email, is_active, position, contact_number,
        role:roles ( role_id, role_code, role_name )
      `)
      .eq('user_id', authData.user.id)
      .single();

    if (profileError || !profile) {
      throw ApiError.forbidden('No profile is linked to this account.');
    }
    if (!profile.is_active) {
      throw ApiError.forbidden('This account has been deactivated.');
    }

    const { data: perms } = await supabaseAdmin
      .from('role_permissions')
      .select('permissions ( permission_code )')
      .eq('role_id', profile.role.role_id);

    userPayload = {
      id: profile.user_id,
      fullName: profile.full_name,
      username: profile.username,
      email: profile.email,
      position: profile.position,
      contactNumber: profile.contact_number,
      role: profile.role,
      isSuperAdmin: profile.role?.role_code === 'super_admin',
      permissions: (perms || []).map((p) => p.permissions.permission_code),
    };
    profileCache.set(cacheKey, userPayload);
  }

  // Authoritative database check: Caller MUST hold super_admin role
  if (userPayload.role?.role_code !== 'super_admin') {
    throw ApiError.forbidden('Access denied: Restricted to Super Admin');
  }

  req.user = userPayload;
  req.accessToken = token;
  req.isSuperAdmin = true;
  req.authContext = 'super_admin';
  next();
});
