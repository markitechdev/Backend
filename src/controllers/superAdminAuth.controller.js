import { z } from 'zod';
import { supabaseAnon, supabaseAdmin } from '../config/supabase.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ok } from '../utils/respond.js';
import { logActivity } from '../services/activityLog.service.js';
import { revokeToken, isTokenRevoked } from '../utils/tokenBlacklist.js';
import { invalidateUserProfile } from '../utils/cache.js';
import { loadUserIdentity } from '../services/identity.service.js';

export const superAdminLoginSchema = z.object({
  email: z.string().email('A valid email is required'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
});

/**
 * POST /api/super-admin/auth/login
 * Strictly restricted to accounts holding the verified `super_admin` role.
 * Non-super-admins (admin, manager, staff, regular users) are strictly denied.
 */
export const superAdminLogin = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  const { data, error } = await supabaseAnon.auth.signInWithPassword({ email, password });
  if (error || !data?.session) {
    throw ApiError.unauthorized('Invalid email or password');
  }

  const discardSession = async () => {
    revokeToken(data.session.access_token);
    revokeToken(data.session.refresh_token);
    try { await supabaseAdmin.auth.admin.signOut(data.session.access_token); } catch { /* blacklist covers it */ }
  };

  let identity;
  try {
    identity = await loadUserIdentity(data.user.id, { useCache: false });
  } catch (err) {
    await discardSession();
    // A missing profile is reported generically; deactivation is reported as-is.
    if (err.status === 403 && /no profile/i.test(err.message)) {
      throw ApiError.unauthorized('Unable to authenticate with this login.');
    }
    throw err;
  }

  // Strict role check: MUST be super_admin
  if (!identity.isSuperAdmin) {
    await discardSession();
    await logActivity(identity.id, 'super_admin_login_denied', 'auth', identity.id,
      { attemptedRole: identity.role?.role_code, endpoint: '/api/super-admin/auth/login' });
    // Safe error message to avoid role leaking
    throw ApiError.unauthorized('Unable to authenticate with this login.');
  }

  await logActivity(identity.id, 'SUPER_ADMIN_LOGIN', 'auth', identity.id,
    { role: 'super_admin', endpoint: '/api/super-admin/auth/login' });

  ok(res, {
    session: {
      accessToken: data.session.access_token,
      refreshToken: data.session.refresh_token,
      expiresAt: data.session.expires_at,
    },
    user: { ...identity, isSuperAdmin: true },
  });
});

/** GET /api/super-admin/auth/me - returns Super Admin profile */
export const superAdminMe = asyncHandler(async (req, res) => {
  if (req.user?.role?.role_code !== 'super_admin') {
    throw ApiError.forbidden('Access denied: Restricted to Super Admin');
  }
  ok(res, {
    ...req.user,
    isSuperAdmin: true,
  });
});

/** POST /api/super-admin/auth/logout - revokes Super Admin session, invalidates tokens & cookies & purges cache */
export const superAdminLogout = asyncHandler(async (req, res) => {
  const refreshToken = req.body?.refreshToken;
  if (req.accessToken) {
    revokeToken(req.accessToken);
    try {
      await supabaseAdmin.auth.admin.signOut(req.accessToken);
    } catch {
      // In-memory blacklist ensures revocation
    }
  }
  if (refreshToken) {
    revokeToken(refreshToken);
  }
  if (req.user?.id) {
    invalidateUserProfile(req.user.id);
  }

  // Clear HTTP-only authentication cookies if present
  res.clearCookie('accessToken', { path: '/', httpOnly: true, sameSite: 'lax' });
  res.clearCookie('refreshToken', { path: '/', httpOnly: true, sameSite: 'lax' });
  res.clearCookie('sb-access-token', { path: '/' });
  res.clearCookie('sb-refresh-token', { path: '/' });

  await logActivity(req.user?.id ?? null, 'SUPER_ADMIN_LOGOUT', 'auth', req.user?.id || null, {
    endpoint: '/api/super-admin/auth/logout',
    revoked: true,
  });
  ok(res, { message: 'Super Admin signed out successfully' });
});

export const superAdminRefreshSchema = z.object({ refreshToken: z.string().min(10) });

/** POST /api/super-admin/auth/refresh */
export const superAdminRefresh = asyncHandler(async (req, res) => {
  const { refreshToken } = req.body;
  if (isTokenRevoked(refreshToken)) {
    throw ApiError.unauthorized('Refresh token has been revoked or signed out');
  }

  const { data, error } = await supabaseAnon.auth.refreshSession({
    refresh_token: refreshToken,
  });
  if (error || !data?.session) {
    throw ApiError.unauthorized('Session could not be refreshed');
  }

  // Verify caller is still an active Super Admin
  let identity = null;
  try {
    identity = await loadUserIdentity(data.session.user.id, { useCache: false });
  } catch {
    identity = null;
  }

  if (!identity?.isSuperAdmin) {
    revokeToken(data.session.access_token);
    revokeToken(data.session.refresh_token);
    throw ApiError.forbidden('Access denied: Restricted to active Super Admin');
  }

  ok(res, {
    accessToken: data.session.access_token,
    refreshToken: data.session.refresh_token,
    expiresAt: data.session.expires_at,
  });
});
