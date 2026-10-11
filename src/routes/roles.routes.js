import { Router } from 'express';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission, requireAnyPermission, requireRole } from '../middleware/authorize.js';
import { enforceTenantIsolation } from '../middleware/tenantIsolation.js';
import { validateBody } from '../middleware/validate.js';
import * as c from '../controllers/roles.controller.js';

const router = Router();
router.use(authenticate);
router.use(enforceTenantIsolation);

// Secured: only users with role/user management or view rights can read the role catalogue
router.get('/', requireAnyPermission('roles.manage', 'roles.view', 'users.manage', 'users.view'), c.listRoles);
router.get('/permissions', requireAnyPermission('roles.manage', 'roles.view'), c.listPermissions);
router.get('/:id', requireAnyPermission('roles.manage', 'roles.view'), c.getRole);
router.get('/:id/users', requireAnyPermission('roles.manage', 'roles.view', 'users.manage', 'users.view'), c.getRoleUsers);

// Super Admin platform role governance
router.post('/', requireRole('super_admin'), validateBody(c.createRoleSchema), c.createRole);
router.patch('/:id', requireRole('super_admin'), validateBody(c.updateRoleSchema), c.updateRole);
router.put('/:id', requireRole('super_admin'), validateBody(c.updateRoleSchema), c.updateRole);
router.put('/:id/permissions', requireRole('super_admin'), validateBody(c.updatePermissionsSchema), c.updateRolePermissions);
router.delete('/:id', requireRole('super_admin'), c.deleteRole);

export default router;
