import { Router } from 'express';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission, requireAnyPermission } from '../middleware/authorize.js';
import { validateBody } from '../middleware/validate.js';
import * as c from '../controllers/roles.controller.js';

const router = Router();
router.use(authenticate);

// Secured: only users with role/user management or view rights can read the role catalogue
router.get('/', requireAnyPermission('roles.manage', 'roles.view', 'users.manage', 'users.view'), c.listRoles);
router.get('/permissions', requirePermission('roles.manage'), c.listPermissions);
router.post('/', requirePermission('roles.manage'), validateBody(c.createRoleSchema), c.createRole);
router.put('/:id/permissions', requirePermission('roles.manage'), validateBody(c.updatePermissionsSchema), c.updateRolePermissions);
router.delete('/:id', requirePermission('roles.manage'), c.deleteRole);

export default router;
