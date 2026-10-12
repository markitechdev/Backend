import { z } from 'zod';
import { supabaseAnon, supabaseAdmin } from '../config/supabase.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ok } from '../utils/respond.js';
import { logActivity } from '../services/activityLog.service.js';
import { revokeToken, isTokenRevoked } from '../utils/tokenBlacklist.js';
import { invalidateUserProfile } from '../utils/cache.js';
import { loadUserIdentity } from '../services/identity.service.js';

export const loginSchema = z.object({
  email: z.string().email('A valid email is required'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
});

/**
 * POST /api/auth/login
 * Standard authentication flow for Tenant Users (Admin, Manager, Staff, regular users).
 * Super Admin accounts are strictly rejected to enforce end-to-end authentication isolation.
 */
export const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  const { data, error } = await supabaseAnon.auth.signInWithPassword({ email, password });
  if (error || !data?.session) throw ApiError.unauthorized('Invalid email or password');

  const discardSession = async () => {
    revokeToken(data.session.access_token);
    revokeToken(data.session.refresh_token);
    try { await supabaseAdmin.auth.admin.signOut(data.session.access_token, 'local'); } catch { /* blacklist covers it */ }
  };

  let identity;
  try {
    // Never trust a cached profile at sign-in: re-read status, role and permissions.
    identity = await loadUserIdentity(data.user.id, { useCache: false });
  } catch (err) {
    await discardSession();
    throw err;
  }

  // Strict authentication separation: Super Admin accounts MUST use /api/super-admin/auth/login
  if (identity.isSuperAdmin) {
    await discardSession();
    invalidateUserProfile(identity.id);
    await logActivity(identity.id, 'normal_login_denied_super_admin', 'auth', identity.id,
      { reason: 'super_admin_attempt_on_normal_login', endpoint: '/api/auth/login' });
    // Safe message: do not disclose account privileges or role
    throw ApiError.unauthorized('Unable to authenticate with this login.');
  }

  await logActivity(identity.id, 'login', 'auth', identity.id, { role: identity.role.role_code });

  ok(res, {
    session: {
      accessToken: data.session.access_token,
      refreshToken: data.session.refresh_token,
      expiresAt: data.session.expires_at,
    },
    user: { ...identity, isSuperAdmin: false },
  });
});

/** GET /api/auth/me - returns the caller loaded by the authenticate middleware. */
export const me = asyncHandler(async (req, res) => {
  const isSuperAdmin = req.user.role?.role_code === 'super_admin';
  ok(res, {
    ...req.user,
    isSuperAdmin,
  });
});

/** POST /api/auth/logout */
export const logout = asyncHandler(async (req, res) => {
  const refreshToken = req.body?.refreshToken;
  if (req.accessToken) {
    revokeToken(req.accessToken);
    try {
      await supabaseAdmin.auth.admin.signOut(req.accessToken, 'local');
    } catch {
      // In-memory blacklist ensures immediate revocation
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

  await logActivity(req.user?.id ?? null, 'logout', 'auth', req.user?.id || null, {
    endpoint: '/api/auth/logout',
    revoked: true,
  });
  ok(res, { message: 'Signed out successfully' });
});

export const refreshSchema = z.object({ refreshToken: z.string().min(10) });

/** POST /api/auth/refresh */
export const refresh = asyncHandler(async (req, res) => {
  const { refreshToken } = req.body;
  if (isTokenRevoked(refreshToken)) {
    throw ApiError.unauthorized('Refresh token has been revoked or signed out');
  }

  const { data, error } = await supabaseAnon.auth.refreshSession({
    refresh_token: refreshToken,
  });
  if (error || !data?.session) throw ApiError.unauthorized('Session could not be refreshed');

  // Verify the account is still allowed in (active, role active) and is not a Super Admin
  let identity;
  try {
    identity = await loadUserIdentity(data.session.user.id, { useCache: false });
  } catch (err) {
    revokeToken(data.session.access_token);
    revokeToken(data.session.refresh_token);
    throw err;
  }

  if (identity.isSuperAdmin) {
    revokeToken(data.session.access_token);
    revokeToken(data.session.refresh_token);
    throw ApiError.unauthorized('Super Admin accounts must use the dedicated Super Admin refresh endpoint');
  }

  ok(res, {
    accessToken: data.session.access_token,
    refreshToken: data.session.refresh_token,
    expiresAt: data.session.expires_at,
  });
});
