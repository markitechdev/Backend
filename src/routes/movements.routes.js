import { Router } from 'express';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/authorize.js';
import { enforceTenantIsolation } from '../middleware/tenantIsolation.js';
import { validateBody } from '../middleware/validate.js';
import { preventDuplicateAction } from '../middleware/preventDuplicates.js';
import * as c from '../controllers/movements.controller.js';

const router = Router();
router.use(authenticate);
router.use(enforceTenantIsolation);

router.get('/',        requirePermission('movements.view'),   c.listMovements);
router.get('/summary', requirePermission('movements.view'),   c.movementSummary);
router.post('/',       requirePermission('movements.create'), preventDuplicateAction(), validateBody(c.movementSchema), c.createMovement);
router.post('/count',  requirePermission('movements.create'), preventDuplicateAction(), validateBody(c.stockCountSchema), c.recordStockCount);

export default router;
