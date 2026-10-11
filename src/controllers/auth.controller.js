import { z } from 'zod';
import { supabaseAnon, supabaseAdmin } from '../config/supabase.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ok } from '../utils/respond.js';
import { logActivity } from '../services/activityLog.service.js';
import { revokeToken, isTokenRevoked } from '../utils/tokenBlacklist.js';
import { invalidateUserProfile } from '../utils/cache.js';

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

  const { data: profile, error: profileError } = await supabaseAdmin
    .from('users')
    .select('user_id, full_name, username, email, is_active, position, role:roles ( role_id, role_code, role_name )')
    .eq('user_id', data.user.id)
    .single();

  if (profileError || !profile) throw ApiError.forbidden('No profile is linked to this account.');
  if (!profile.is_active) throw ApiError.forbidden('This account has been deactivated.');

  const isSuperAdmin = profile.role?.role_code === 'super_admin';

  // Strict authentication separation: Super Admin accounts MUST use /api/super-admin/auth/login
  if (isSuperAdmin) {
    if (data.session?.access_token) {
      revokeToken(data.session.access_token);
      try {
        await supabaseAdmin.auth.admin.signOut(data.session.access_token);
      } catch {
        // blacklist guarantees revocation
      }
    }

    await logActivity(
      profile.user_id,
      'normal_login_denied_super_admin',
      'auth',
      profile.user_id,
      { reason: 'super_admin_attempt_on_normal_login', endpoint: '/api/auth/login' }
    );

    // Safe message: do not disclose account privileges or role
    throw ApiError.unauthorized('Unable to authenticate with this login.');
  }

  const { data: perms } = await supabaseAdmin
    .from('role_permissions')
    .select('permissions ( permission_code )')
    .eq('role_id', profile.role.role_id);

  await logActivity(
    profile.user_id,
    'login',
    'auth',
    profile.user_id,
    { role: profile.role.role_code }
  );

  ok(res, {
    session: {
      accessToken: data.session.access_token,
      refreshToken: data.session.refresh_token,
      expiresAt: data.session.expires_at,
    },
    user: {
      id: profile.user_id,
      fullName: profile.full_name,
      username: profile.username,
      email: profile.email,
      position: profile.position,
      role: profile.role,
      isSuperAdmin: false,
      permissions: (perms || []).map((p) => p.permissions.permission_code),
    },
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
      await supabaseAdmin.auth.admin.signOut(req.accessToken);
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

  await logActivity(req.user?.id || 'unknown', 'logout', 'auth', req.user?.id || null, {
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

  // Verify account is active and not a Super Admin account
  const { data: profile } = await supabaseAdmin
    .from('users')
    .select('user_id, is_active, role:roles ( role_code )')
    .eq('user_id', data.session.user.id)
    .single();

  if (!profile || !profile.is_active) {
    if (data.session.access_token) revokeToken(data.session.access_token);
    if (data.session.refresh_token) revokeToken(data.session.refresh_token);
    throw ApiError.forbidden('Account is deactivated or does not exist');
  }

  if (profile.role?.role_code === 'super_admin') {
    if (data.session.access_token) revokeToken(data.session.access_token);
    if (data.session.refresh_token) revokeToken(data.session.refresh_token);
    throw ApiError.unauthorized('Super Admin accounts must use the dedicated Super Admin refresh endpoint');
  }

  ok(res, {
    accessToken: data.session.access_token,
    refreshToken: data.session.refresh_token,
    expiresAt: data.session.expires_at,
  });
});
