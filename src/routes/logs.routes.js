import { Router } from 'express';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/authorize.js';
import { enforceTenantIsolation } from '../middleware/tenantIsolation.js';
import { listLogs } from '../controllers/logs.controller.js';

const router = Router();
router.get('/', authenticate, enforceTenantIsolation, requirePermission('logs.view'), listLogs);
export default router;
