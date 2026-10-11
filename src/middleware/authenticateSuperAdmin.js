import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { authenticate } from './authenticate.js';

/**
 * Dedicated Super Admin authentication & authorization middleware.
 * Runs the normal token + account checks, then strictly enforces the
 * `super_admin` role read from the database. Client-submitted role claims are
 * ignored. Invalid/expired tokens -> 401, any other role -> 403.
 */
export const authenticateSuperAdmin = asyncHandler(async (req, res, next) => {
  await new Promise((resolve, reject) => {
    authenticate(req, res, (err) => (err ? reject(err) : resolve()));
  });

  if (req.user?.role?.role_code !== 'super_admin') {
    throw ApiError.forbidden('Access denied: Restricted to Super Admin');
  }

  req.isSuperAdmin = true;
  req.authContext = 'super_admin';
  next();
});
