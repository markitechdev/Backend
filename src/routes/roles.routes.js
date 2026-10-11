import { Router } from 'express';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission, requireAnyPermission, requireRole } from '../middleware/authorize.js';
import { validateBody } from '../middleware/validate.js';
import * as c from '../controllers/roles.controller.js';

const router = Router();
router.use(authenticate);

// Secured: only users with role/user management or view rights can read the role catalogue
router.get('/', requireAnyPermission('roles.manage', 'roles.view', 'users.manage', 'users.view'), c.listRoles);
router.get('/permissions', requireAnyPermission('roles.manage', 'roles.view'), c.listPermissions);
router.post('/', requireRole('super_admin'), validateBody(c.createRoleSchema), c.createRole);
router.put('/:id/permissions', requireRole('super_admin'), validateBody(c.updatePermissionsSchema), c.updateRolePermissions);
router.delete('/:id', requireRole('super_admin'), c.deleteRole);

export default router;
