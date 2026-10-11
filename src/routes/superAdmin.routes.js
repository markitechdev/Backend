import { Router } from 'express';
import superAdminAuthRoutes from './superAdminAuth.routes.js';
import { authenticateSuperAdmin } from '../middleware/authenticateSuperAdmin.js';
import * as usersCtrl from '../controllers/users.controller.js';
import * as rolesCtrl from '../controllers/roles.controller.js';
import * as logsCtrl from '../controllers/logs.controller.js';
import * as dashCtrl from '../controllers/dashboard.controller.js';
import { validateBody, validateParams, uuidParamSchema, idParamSchema } from '../middleware/validate.js';
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
router.get('/dashboard', dashCtrl.getSuperAdminDashboard);
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

// Super Admin tenant / workspace overview.
// NOTE: the database is currently single-organization (there is no
// organizations table yet), so this returns the one real workspace with live
// counts instead of invented tenant records.
router.get('/tenants', asyncHandler(async (_req, res) => {
  const [usersRes, activeRes, productsRes, firstUserRes] = await Promise.all([
    supabaseAdmin.from('users').select('user_id', { count: 'exact', head: true }),
    supabaseAdmin.from('users').select('user_id', { count: 'exact', head: true }).eq('is_active', true),
    supabaseAdmin.from('products').select('product_id', { count: 'exact', head: true }),
    supabaseAdmin.from('users').select('created_at').order('created_at', { ascending: true }).limit(1),
  ]);
  ok(res, [
    {
      tenantId: 'default-org',
      tenantName: 'Primary Workspace',
      status: 'active',
      plan: 'single-organization',
      isolationMode: 'single-organization',
      totalUsers: usersRes.count ?? 0,
      activeUsers: activeRes.count ?? 0,
      totalProducts: productsRes.count ?? 0,
      createdAt: firstUserRes.data?.[0]?.created_at ?? null,
    },
  ], { multiTenant: false });
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
router.get('/roles/:id', validateParams(idParamSchema), rolesCtrl.getRole);
router.get('/roles/:id/users', validateParams(idParamSchema), rolesCtrl.getRoleUsers);
router.post('/roles', validateBody(rolesCtrl.createRoleSchema), rolesCtrl.createRole);
router.patch('/roles/:id', validateParams(idParamSchema), validateBody(rolesCtrl.updateRoleSchema), rolesCtrl.updateRole);
router.put('/roles/:id', validateParams(idParamSchema), validateBody(rolesCtrl.updateRoleSchema), rolesCtrl.updateRole);
router.put('/roles/:id/permissions', validateParams(idParamSchema), validateBody(rolesCtrl.updatePermissionsSchema), rolesCtrl.updateRolePermissions);
router.delete('/roles/:id', validateParams(idParamSchema), rolesCtrl.deleteRole);

// Super Admin Platform Audit Trail
router.get('/logs', logsCtrl.listLogs);

export default router;
