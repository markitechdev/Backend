import { ApiError } from '../utils/ApiError.js';

const PERMISSION_ALIASES = {
  'movements.view': ['stock_movements.view'],
  'stock_movements.view': ['movements.view'],
  'movements.create': ['stock_movements.create'],
  'stock_movements.create': ['movements.create'],
  'movements.manage': ['stock_movements.manage'],
  'stock_movements.manage': ['movements.manage'],
  'inventory.edit': ['inventory.update'],
  'inventory.update': ['inventory.edit'],
  'inventory.manage': ['inventory.update', 'inventory.create', 'inventory.delete'],
  'audit_logs.view': ['logs.view'],
  'logs.view': ['audit_logs.view'],
  'users.edit': ['users.manage'],
  'users.create': ['users.manage'],
  'suppliers.edit': ['suppliers.manage'],
  'suppliers.create': ['suppliers.manage'],
  'reports.generate': ['reports.view'],
};

/** Checks whether a permission code or any of its approved aliases is satisfied */
export const hasUserPermission = (userPerms = [], code) => {
  if (userPerms.includes(code)) return true;
  const [module] = code.split('.');
  if (userPerms.includes(`${module}.manage`) || userPerms.includes('system.manage')) return true;
  const aliases = PERMISSION_ALIASES[code] || [];
  return aliases.some((alias) => userPerms.includes(alias));
};

/** Requires ALL of the listed permission codes. */
export const requirePermission = (...codes) => (req, _res, next) => {
  if (!req.user) return next(ApiError.unauthorized('Authentication required'));
  if (req.user.role?.role_code === 'super_admin') return next();

  const userPerms = req.user.permissions || [];
  const missing = codes.filter((c) => !hasUserPermission(userPerms, c));
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
  if (!codes.some((c) => hasUserPermission(userPerms, c))) {
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

/** Strictly restricts route execution exclusively to the verified Super Admin role. */
export const requireSuperAdmin = (req, _res, next) => {
  if (!req.user) return next(ApiError.unauthorized('Authentication required'));
  if (req.user.role?.role_code !== 'super_admin') {
    return next(ApiError.forbidden('Access denied: Restricted to Super Admin'));
  }
  next();
};

/** Authorizes standard CRUD and management actions on modules */
export const authorizeAction = (module, action) => {
  const code = `${module}.${action}`;
  return requirePermission(code);
};
