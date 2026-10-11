import { ApiError } from '../utils/ApiError.js';

/** Requires ALL of the listed permission codes. */
export const requirePermission = (...codes) => (req, _res, next) => {
  if (!req.user) return next(ApiError.unauthorized('Authentication required'));
  if (req.user.role?.role_code === 'super_admin') return next();

  const userPerms = req.user.permissions || [];
  const missing = codes.filter((c) => !userPerms.includes(c));
  if (missing.length) {
    return next(ApiError.forbidden(`Access denied: Missing required permission (${missing.join(', ')})`));
  }
  next();
};

/** Requires ANY of the listed permission codes. */
export const requireAnyPermission = (...codes) => (req, _res, next) => {
  if (!req.user) return next(ApiError.unauthorized('Authentication required'));
  if (req.user.role?.role_code === 'super_admin') return next();

  const userPerms = req.user.permissions || [];
  if (!codes.some((c) => userPerms.includes(c))) {
    return next(ApiError.forbidden(`Access denied: Requires at least one permission (${codes.join(', ')})`));
  }
  next();
};

/** Restricts a route to specific role codes. */
export const requireRole = (...roleCodes) => (req, _res, next) => {
  if (!req.user) return next(ApiError.unauthorized('Authentication required'));
  if (!roleCodes.includes(req.user.role?.role_code)) {
    return next(ApiError.forbidden(`Access denied: Restricted to role (${roleCodes.join(', ')})`));
  }
  next();
};

/** Authorizes standard CRUD and management actions on modules */
export const authorizeAction = (module, action) => {
  const code = `${module}.${action}`;
  return requirePermission(code);
};
