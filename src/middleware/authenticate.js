import { supabaseAdmin } from '../config/supabase.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { isTokenRevoked } from '../utils/tokenBlacklist.js';
import { loadUserIdentity } from '../services/identity.service.js';

/** Extracts the bearer token from the Authorization header. */
export const readBearer = (req) => {
  const header = req.headers?.authorization || '';
  return header.startsWith('Bearer ') ? header.slice(7).trim() : null;
};

/**
 * Verifies the Supabase access token, then loads the user's profile,
 * role and flattened permission list onto req.user (cached for 60s).
 */
export const authenticate = asyncHandler(async (req, _res, next) => {
  const token = readBearer(req);
  if (!token) throw ApiError.unauthorized('Missing bearer token');

  if (isTokenRevoked(token)) {
    throw ApiError.unauthorized('Session has been revoked or signed out');
  }

  const { data: authData, error: authError } = await supabaseAdmin.auth.getUser(token);
  if (authError || !authData?.user) {
    throw ApiError.unauthorized('Invalid or expired session');
  }

  req.user = await loadUserIdentity(authData.user.id);
  req.accessToken = token;
  next();
});
