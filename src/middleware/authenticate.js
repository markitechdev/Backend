import { supabaseAdmin } from '../config/supabase.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { isTokenRevoked } from '../utils/tokenBlacklist.js';
import { profileCache } from '../utils/cache.js';

/**
 * Verifies the Supabase access token, then loads the user's profile,
 * role and flattened permission list onto req.user with memory caching (TTL 60s).
 */
export const authenticate = asyncHandler(async (req, _res, next) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) throw ApiError.unauthorized('Missing bearer token');

  if (isTokenRevoked(token)) {
    throw ApiError.unauthorized('Session has been revoked or signed out');
  }

  const { data: authData, error: authError } = await supabaseAdmin.auth.getUser(token);
  if (authError || !authData?.user) throw ApiError.unauthorized('Invalid or expired session');

  const cacheKey = `user_${authData.user.id}`;
  const cachedUser = profileCache.get(cacheKey);
  if (cachedUser) {
    req.user = cachedUser;
    req.accessToken = token;
    return next();
  }

  const { data: profile, error: profileError } = await supabaseAdmin
    .from('users')
    .select(`
      user_id, full_name, username, email, is_active, position, contact_number,
      role:roles ( role_id, role_code, role_name )
    `)
    .eq('user_id', authData.user.id)
    .single();

  if (profileError || !profile) {
    throw ApiError.forbidden('No profile is linked to this account. Contact the Super Admin.');
  }
  if (!profile.is_active) {
    throw ApiError.forbidden('This account has been deactivated.');
  }

  const { data: perms, error: permError } = await supabaseAdmin
    .from('role_permissions')
    .select('permissions ( permission_code )')
    .eq('role_id', profile.role.role_id);

  if (permError) throw new ApiError(500, 'Could not load role permissions');

  const userPayload = {
    id: profile.user_id,
    fullName: profile.full_name,
    username: profile.username,
    email: profile.email,
    position: profile.position,
    contactNumber: profile.contact_number,
    role: profile.role,
    permissions: (perms || []).map((p) => p.permissions.permission_code),
  };

  profileCache.set(cacheKey, userPayload);
  req.user = userPayload;
  req.accessToken = token;
  next();
});
