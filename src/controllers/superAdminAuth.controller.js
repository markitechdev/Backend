import { z } from 'zod';
import { supabaseAnon, supabaseAdmin } from '../config/supabase.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ok } from '../utils/respond.js';
import { logActivity } from '../services/activityLog.service.js';
import { revokeToken } from '../utils/tokenBlacklist.js';

export const superAdminLoginSchema = z.object({
  email: z.string().email('A valid email is required'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
});

/**
 * POST /api/super-admin/auth/login
 * Strictly restricted to accounts holding the `super_admin` role.
 * Any non-super_admin account is denied with a safe authentication failure.
 */
export const superAdminLogin = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  const { data, error } = await supabaseAnon.auth.signInWithPassword({ email, password });
  if (error || !data?.session) {
    throw ApiError.unauthorized('Invalid email or password');
  }

  const { data: profile, error: profileError } = await supabaseAdmin
    .from('users')
    .select('user_id, full_name, username, email, is_active, position, role:roles ( role_id, role_code, role_name )')
    .eq('user_id', data.user.id)
    .single();

  if (profileError || !profile) {
    // Revoke session if no linked profile
    if (data.session?.access_token) revokeToken(data.session.access_token);
    throw ApiError.unauthorized('Unable to authenticate with this login.');
  }

  if (!profile.is_active) {
    if (data.session?.access_token) revokeToken(data.session.access_token);
    throw ApiError.forbidden('This account has been deactivated.');
  }

  // Strict enforcement: MUST be Super Admin
  if (profile.role?.role_code !== 'super_admin') {
    // Immediately invalidate the Supabase session token so it cannot be used
    if (data.session?.access_token) {
      revokeToken(data.session.access_token);
      try {
        await supabaseAdmin.auth.admin.signOut(data.session.access_token);
      } catch {
        // blacklist guarantees revocation
      }
    }
    // Safe failure message: do not reveal role or account details
    throw ApiError.unauthorized('Unable to authenticate with this login.');
  }

  const { data: perms } = await supabaseAdmin
    .from('role_permissions')
    .select('permissions ( permission_code )')
    .eq('role_id', profile.role.role_id);

  // Distinct audit logging for Super Admin authentication
  await logActivity(
    profile.user_id,
    'super_admin_login',
    'auth',
    profile.user_id,
    { role: 'super_admin', endpoint: '/api/super-admin/auth/login' }
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
      isSuperAdmin: true,
      permissions: (perms || []).map((p) => p.permissions.permission_code),
    },
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

/** POST /api/super-admin/auth/logout - revokes Super Admin session */
export const superAdminLogout = asyncHandler(async (req, res) => {
  if (req.accessToken) {
    revokeToken(req.accessToken);
    try {
      await supabaseAdmin.auth.admin.signOut(req.accessToken);
    } catch {
      // In-memory blacklist ensures revocation
    }
  }
  await logActivity(req.user.id, 'super_admin_logout', 'auth', req.user.id);
  ok(res, { message: 'Super Admin signed out successfully' });
});

export const superAdminRefreshSchema = z.object({ refreshToken: z.string().min(10) });

/** POST /api/super-admin/auth/refresh */
export const superAdminRefresh = asyncHandler(async (req, res) => {
  const { data, error } = await supabaseAnon.auth.refreshSession({
    refresh_token: req.body.refreshToken,
  });
  if (error || !data?.session) {
    throw ApiError.unauthorized('Session could not be refreshed');
  }
  ok(res, {
    accessToken: data.session.access_token,
    refreshToken: data.session.refresh_token,
    expiresAt: data.session.expires_at,
  });
});
