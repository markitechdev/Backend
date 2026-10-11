import { Router } from 'express';
import { authenticate } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/authorize.js';
import { enforceTenantIsolation } from '../middleware/tenantIsolation.js';
import { validateBody, validateParams, idParamSchema } from '../middleware/validate.js';
import { preventDuplicateAction } from '../middleware/preventDuplicates.js';
import * as c from '../controllers/alerts.controller.js';

const router = Router();
router.use(authenticate);
router.use(enforceTenantIsolation);

router.get('/',        requirePermission('alerts.view'),   c.listAlerts);
router.get('/summary', requirePermission('alerts.view'),   c.alertSummary);
router.patch('/:id',   requirePermission('alerts.manage'), validateParams(idParamSchema), preventDuplicateAction(), validateBody(c.alertStatusSchema), c.updateAlertStatus);

export default router;
