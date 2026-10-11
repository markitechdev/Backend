import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { authenticate } from '../middleware/authenticate.js';
import { validateBody } from '../middleware/validate.js';
import * as c from '../controllers/superAdminAuth.controller.js';

const router = Router();

const superAdminLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10, // stricter rate limiting for super admin
  message: { success: false, error: { message: 'Too many Super Admin login attempts. Try again in 15 minutes.' } },
  standardHeaders: true,
  legacyHeaders: false,
});

router.post('/login',   superAdminLoginLimiter, validateBody(c.superAdminLoginSchema), c.superAdminLogin);
router.post('/refresh', validateBody(c.superAdminRefreshSchema), c.superAdminRefresh);
router.get('/me',       authenticate, c.superAdminMe);
router.post('/logout',  authenticate, c.superAdminLogout);

export default router;
