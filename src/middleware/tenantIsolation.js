import { ApiError } from '../utils/ApiError.js';

/**
 * Tenant & Organization Isolation Middleware
 * Ensures multi-tenant / client boundaries are strictly enforced.
 * Prevents callers from manipulating tenant_id / organization_id / client_id parameters.
 */
export const enforceTenantIsolation = (req, _res, next) => {
  if (!req.user) return next(ApiError.unauthorized());

  // Determine user's authorized tenant/organization
  const userRole = req.user.role?.role_code;
  const userTenant = req.user.tenantId || req.user.organizationId || 'default-org';

  // Extract requested tenant from headers, query, or body
  const requestedTenant = req.headers['x-tenant-id'] ||
    req.headers['x-organization-id'] ||
    req.query.tenant_id ||
    req.query.tenantId ||
    req.query.org_id ||
    req.body?.tenantId ||
    req.body?.tenant_id;

  // Super Admin can inspect any tenant if specified, or operates globally
  if (userRole === 'super_admin') {
    req.tenantId = requestedTenant || userTenant;
    return next();
  }

  // Non-super-admins must not attempt to access or modify a different tenant
  if (requestedTenant && requestedTenant !== userTenant) {
    return next(ApiError.forbidden('Access denied: Cross-tenant data access is strictly prohibited'));
  }

  req.tenantId = userTenant;
  next();
};

/**
 * Validates that an entity belongs to the user's authorized scope
 */
export const validateEntityOwnership = (entity, user) => {
  if (!entity) return true;
  if (user.role?.role_code === 'super_admin') return true;

  const userTenant = user.tenantId || user.organizationId || 'default-org';
  const entityTenant = entity.tenant_id || entity.organization_id || 'default-org';

  return userTenant === entityTenant;
};
