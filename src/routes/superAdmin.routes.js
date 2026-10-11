import { Router } from 'express';
import superAdminAuthRoutes from './superAdminAuth.routes.js';
import { authenticateSuperAdmin } from '../middleware/authenticateSuperAdmin.js';
import * as usersCtrl from '../controllers/users.controller.js';
import * as rolesCtrl from '../controllers/roles.controller.js';
import * as logsCtrl from '../controllers/logs.controller.js';
import * as dashCtrl from '../controllers/dashboard.controller.js';
import { validateBody, validateParams, uuidParamSchema } from '../middleware/validate.js';
import { ok } from '../utils/respond.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { supabaseAdmin } from '../config/supabase.js';

const router = Router();

// Public & Session Auth routes for Super Admin
router.use('/auth', superAdminAuthRoutes);

// =========================================================================
// STRICT SUPER ADMIN AUTHORIZATION BOUNDARY
// Every route registered below this middleware MUST have valid Super Admin auth.
// Normal users (Admin, Manager, Staff) receive 403 Forbidden.
// Unauthenticated requests receive 401 Unauthorized.
// =========================================================================
router.use(authenticateSuperAdmin);

// Super Admin platform telemetry & overview
router.get('/dashboard', dashCtrl.getDashboard);
router.get('/stats', asyncHandler(async (_req, res) => {
  const [usersCount, rolesCount, logsCount] = await Promise.all([
    supabaseAdmin.from('users').select('*', { count: 'exact', head: true }),
    supabaseAdmin.from('roles').select('*', { count: 'exact', head: true }),
    supabaseAdmin.from('activity_logs').select('*', { count: 'exact', head: true }),
  ]);
  ok(res, {
    totalUsers: usersCount.count || 0,
    totalRoles: rolesCount.count || 0,
    totalAuditLogs: logsCount.count || 0,
    platformStatus: 'healthy',
  });
}));

// Super Admin tenant / workspace management
router.get('/tenants', asyncHandler(async (_req, res) => {
  ok(res, [
    {
      tenantId: 'default-org',
      tenantName: 'Primary Workspace',
      status: 'active',
      plan: 'enterprise',
      createdAt: '2026-01-01T00:00:00.000Z',
    },
  ]);
}));

// Super Admin User Accounts Management
router.get('/users', usersCtrl.listUsers);
router.get('/users/:id', validateParams(uuidParamSchema), usersCtrl.getUser);
router.post('/users', validateBody(usersCtrl.createUserSchema), usersCtrl.createUser);
router.patch('/users/:id', validateParams(uuidParamSchema), validateBody(usersCtrl.updateUserSchema), usersCtrl.updateUser);
router.delete('/users/:id', validateParams(uuidParamSchema), usersCtrl.deleteUser);
router.post('/users/:id/password', validateParams(uuidParamSchema), validateBody(usersCtrl.resetPasswordSchema), usersCtrl.resetPassword);

// Super Admin Roles & Permission Matrix
router.get('/roles', rolesCtrl.listRoles);
router.get('/roles/permissions', rolesCtrl.listPermissions);
router.post('/roles', validateBody(rolesCtrl.createRoleSchema), rolesCtrl.createRole);
router.put('/roles/:id/permissions', validateBody(rolesCtrl.updatePermissionsSchema), rolesCtrl.updateRolePermissions);
router.delete('/roles/:id', rolesCtrl.deleteRole);

// Super Admin Platform Audit Trail
router.get('/logs', logsCtrl.listLogs);

export default router;
