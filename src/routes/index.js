import { Router } from 'express';
import authRoutes from './auth.routes.js';
import superAdminRoutes from './superAdmin.routes.js';
import userRoutes from './users.routes.js';
import roleRoutes from './roles.routes.js';
import productRoutes from './products.routes.js';
import inventoryRoutes from './inventory.routes.js';
import movementRoutes from './movements.routes.js';
import alertRoutes from './alerts.routes.js';
import categoryRoutes from './categories.routes.js';
import supplierRoutes from './suppliers.routes.js';
import dashboardRoutes from './dashboard.routes.js';
import logRoutes from './logs.routes.js';

const router = Router();

router.get('/health', (_req, res) =>
  res.json({ success: true, data: { status: 'ok', time: new Date().toISOString() } }));

// Authentication & Identity flows
router.use('/auth', authRoutes);

// Dedicated Super Admin Platform APIs (all /api/super-admin/* routes)
router.use('/super-admin', superAdminRoutes);

// Standard Tenant Business & Operational modules
router.use('/users', userRoutes);
router.use('/roles', roleRoutes);
router.use('/products', productRoutes);
router.use('/inventory', inventoryRoutes);
router.use('/movements', movementRoutes);
router.use('/alerts', alertRoutes);
router.use('/dashboard', dashboardRoutes);
router.use('/logs', logRoutes);
router.use('/categories', categoryRoutes);
router.use('/suppliers', supplierRoutes);

export default router;
