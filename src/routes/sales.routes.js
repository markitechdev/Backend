import { Router } from 'express';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/authorize.js';
import { enforceTenantIsolation } from '../middleware/tenantIsolation.js';
import { validateBody } from '../middleware/validate.js';
import { preventDuplicateAction } from '../middleware/preventDuplicates.js';
import * as c from '../controllers/sales.controller.js';

const router = Router();
router.use(authenticate);
router.use(enforceTenantIsolation);

router.get('/',          requirePermission('finance.view'),   c.listSales);
router.get('/summary',   requirePermission('finance.view'),   c.salesSummary);
router.get('/:id',       requirePermission('finance.view'),   c.getSale);
router.post('/',         requirePermission('finance.manage'), preventDuplicateAction(), validateBody(c.saleSchema), c.createSale);
router.post('/:id/void', requirePermission('finance.manage'), validateBody(c.voidSchema), c.voidSale);

export default router;
