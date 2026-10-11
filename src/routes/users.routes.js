import { Router } from 'express';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/authorize.js';
import { validateBody, validateParams, uuidParamSchema } from '../middleware/validate.js';
import { enforceTenantIsolation } from '../middleware/tenantIsolation.js';
import * as c from '../controllers/users.controller.js';

const router = Router();
router.use(authenticate);
router.use(enforceTenantIsolation);

router.get('/',        requirePermission('users.view'),   c.listUsers);
router.get('/:id',     requirePermission('users.view'),   validateParams(uuidParamSchema), c.getUser);
router.post('/',       requirePermission('users.manage'), validateBody(c.createUserSchema), c.createUser);
router.patch('/:id',   requirePermission('users.manage'), validateParams(uuidParamSchema), validateBody(c.updateUserSchema), c.updateUser);
router.delete('/:id',  requirePermission('users.manage'), validateParams(uuidParamSchema), c.deleteUser);
router.post('/:id/password', requirePermission('users.manage'), validateParams(uuidParamSchema), validateBody(c.resetPasswordSchema), c.resetPassword);

export default router;
