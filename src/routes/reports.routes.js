import { Router } from 'express';
import { authenticate } from '../middleware/authenticate.js';
import { requireAnyPermission } from '../middleware/authorize.js';
import { enforceTenantIsolation } from '../middleware/tenantIsolation.js';
import * as c from '../controllers/reports.controller.js';

const router = Router();

router.use(authenticate);
router.use(enforceTenantIsolation);
router.use(requireAnyPermission('reports.view', 'reports.generate'));

router.get('/inventory-summary', c.getInventorySummaryReport);
router.get('/stock-movements', c.getStockMovementsReport);
router.get('/shrinkage', c.getShrinkageReport);
router.get('/low-stock', c.getLowStockReport);
router.get('/out-of-stock', c.getOutOfStockReport);
router.get('/reorder', c.getReorderReport);
router.get('/suppliers', c.getSupplierSummaryReport);

export default router;
