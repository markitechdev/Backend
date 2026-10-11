import { Router } from 'express';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/authorize.js';
import { enforceTenantIsolation } from '../middleware/tenantIsolation.js';
import { validateBody, validateParams, idParamSchema } from '../middleware/validate.js';
import * as c from '../controllers/products.controller.js';

const router = Router();
router.use(authenticate);
router.use(enforceTenantIsolation);

router.get('/',       requirePermission('products.view'),   c.listProducts);
router.get('/:id',    requirePermission('products.view'),   validateParams(idParamSchema), c.getProduct);
router.post('/',      requirePermission('products.create'), validateBody(c.productSchema), c.createProduct);
router.patch('/:id',  requirePermission('products.update'), validateParams(idParamSchema), validateBody(c.productUpdateSchema), c.updateProduct);
router.delete('/:id', requirePermission('products.delete'), validateParams(idParamSchema), c.deleteProduct);

export default router;
