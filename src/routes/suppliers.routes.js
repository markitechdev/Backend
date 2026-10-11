import { Router } from 'express';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/authorize.js';
import { enforceTenantIsolation } from '../middleware/tenantIsolation.js';
import { validateBody, validateParams, idParamSchema } from '../middleware/validate.js';
import * as c from '../controllers/reference.controller.js';

const router = Router();
router.use(authenticate);
router.use(enforceTenantIsolation);

router.get('/',       requirePermission('suppliers.view'),   c.listSuppliers);
router.get('/:id',    requirePermission('suppliers.view'),   validateParams(idParamSchema), c.getSupplier);
router.post('/',      requirePermission('suppliers.manage'), validateBody(c.supplierSchema), c.createSupplier);
router.patch('/:id',  requirePermission('suppliers.manage'), validateParams(idParamSchema), validateBody(c.supplierSchema.partial()), c.updateSupplier);
router.delete('/:id', requirePermission('suppliers.manage'), validateParams(idParamSchema), c.deleteSupplier);

export default router;
