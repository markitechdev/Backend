import { Router } from 'express';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission, requireAnyPermission, requireRole } from '../middleware/authorize.js';
import { enforceTenantIsolation } from '../middleware/tenantIsolation.js';
import { validateBody, validateParams, idParamSchema } from '../middleware/validate.js';
import * as c from '../controllers/roles.controller.js';

const router = Router();
router.use(authenticate);
router.use(enforceTenantIsolation);

// Secured: only users with role/user management or view rights can read the role catalogue
router.get('/', requireAnyPermission('roles.manage', 'roles.view', 'users.manage', 'users.view'), c.listRoles);
router.get('/permissions', requireAnyPermission('roles.manage', 'roles.view'), c.listPermissions);
router.get('/:id', validateParams(idParamSchema), requireAnyPermission('roles.manage', 'roles.view'), c.getRole);
router.get('/:id/users', validateParams(idParamSchema), requireAnyPermission('roles.manage', 'roles.view', 'users.manage', 'users.view'), c.getRoleUsers);

// Super Admin platform role governance
router.post('/', requireRole('super_admin'), validateBody(c.createRoleSchema), c.createRole);
router.patch('/:id', requireRole('super_admin'), validateParams(idParamSchema), validateBody(c.updateRoleSchema), c.updateRole);
router.put('/:id', requireRole('super_admin'), validateParams(idParamSchema), validateBody(c.updateRoleSchema), c.updateRole);
router.put('/:id/permissions', requireRole('super_admin'), validateParams(idParamSchema), validateBody(c.updatePermissionsSchema), c.updateRolePermissions);
router.delete('/:id', requireRole('super_admin'), validateParams(idParamSchema), c.deleteRole);

export default router;
