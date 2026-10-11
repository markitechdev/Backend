import { Router } from 'express';
import { authenticate } from '../middleware/authenticate.js';
import { enforceTenantIsolation } from '../middleware/tenantIsolation.js';
import { getDashboard } from '../controllers/dashboard.controller.js';

const router = Router();
router.get('/', authenticate, enforceTenantIsolation, getDashboard);
export default router;
