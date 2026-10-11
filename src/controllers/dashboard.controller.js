import { supabaseAdmin } from '../config/supabase.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ok } from '../utils/respond.js';
import { dashboardCache } from '../utils/cache.js';
import { statusOfRow } from '../utils/stock.js';
import { parseRoleMetadata } from './roles.controller.js';
import { userCan, isSuperAdminUser } from '../middleware/authorize.js';

const statusOf = statusOfRow;

/**
 * GET /api/dashboard
 * Returns a payload shaped to the caller's role, so each admin area sees the
 * cards its own responsibilities need rather than one generic dashboard.
 * Caches payload in memory with a 30s TTL scoped by tenant and role.
 */
export const getDashboard = asyncHandler(async (req, res) => {
  const roleCode = req.user.role.role_code;
  const isSuper = isSuperAdminUser(req.user);
  // Same permission rules as the routes (aliases, module.manage, Super Admin bypass)
  const can = (code) => userCan(req.user, code);
  const tenantId = req.tenantId || 'default-org';
  // Keyed per user: the activity panel is user-specific for non-super-admins
  const cacheKey = `dash_${tenantId}_${roleCode}_${req.user.id}`;

  const cached = dashboardCache.get(cacheKey);
  if (cached) {
    return ok(res, cached);
  }

  const payload = { role: roleCode, generatedAt: new Date().toISOString(), cards: {}, panels: {} };

  /* ---------------------------------------------------- inventory-side data */
  if (can('inventory.view')) {
    const { data: inv, error } = await supabaseAdmin
      .from('inventory')
      .select('current_stock, minimum_stock, reorder_point, product:products ( product_id, product_name, sku, unit_price )');
    if (error) throw new ApiError(500, error.message);

    const rows = inv.filter((r) => r.product).map((r) => ({ ...r, stock_status: statusOf(r) }));

    payload.cards.totalProducts = rows.length;
    payload.cards.totalQuantity = rows.reduce((s, r) => s + r.current_stock, 0);
    payload.cards.totalValue = Number(
      rows.reduce((s, r) => s + r.current_stock * Number(r.product.unit_price || 0), 0).toFixed(2));
    payload.cards.lowStock   = rows.filter((r) => r.stock_status === 'low_stock').length;
    payload.cards.outOfStock = rows.filter((r) => r.stock_status === 'out_of_stock').length;
    payload.cards.reorderDue = rows.filter((r) => r.stock_status === 'reorder').length;

    payload.panels.lowStockItems = rows
      .filter((r) => r.stock_status === 'low_stock' || r.stock_status === 'out_of_stock')
      .sort((a, b) => a.current_stock - b.current_stock)
      .slice(0, 8)
      .map((r) => ({
        productId: r.product.product_id,
        productName: r.product.product_name,
        sku: r.product.sku,
        currentStock: r.current_stock,
        reorderPoint: r.reorder_point,
        status: r.stock_status,
      }));
  }

  /* ------------------------------------------------------------------ alerts */
  if (can('alerts.view')) {
    const { data: alerts } = await supabaseAdmin
      .from('alerts')
      .select('alert_id, alert_type, alert_message, priority, date_created, product:products ( product_name, sku )')
      .eq('alert_status', 'active')
      .order('priority', { ascending: false })
      .order('date_created', { ascending: false });

    const list = alerts || [];
    payload.cards.activeAlerts = list.length;
    payload.panels.alertsByPriority = list.reduce(
      (acc, a) => { acc[a.priority] = (acc[a.priority] || 0) + 1; return acc; },
      { critical: 0, high: 0, medium: 0, low: 0 });
    payload.panels.recentAlerts = list.slice(0, 6);
  }

  /* -------------------------------------------------------- stock movements */
  if (can('movements.view')) {
    const { data: movements } = await supabaseAdmin
      .from('stock_movements')
      .select('movement_id, movement_type, quantity, date_recorded, product:products ( product_name, sku ), recorded_by_user:users!stock_movements_recorded_by_fkey ( full_name )')
      .order('date_recorded', { ascending: false })
      .limit(8);
    payload.panels.recentMovements = movements || [];

    const since = new Date(Date.now() - 30 * 864e5).toISOString();
    const { data: shrink } = await supabaseAdmin
      .from('stock_movements')
      .select('quantity, movement_type, product:products ( unit_price )')
      .in('movement_type', ['damaged', 'missing'])
      .gte('date_recorded', since);

    payload.cards.shrinkageUnits30d = (shrink || []).reduce((s, m) => s + Math.abs(m.quantity), 0);
    payload.cards.shrinkageValue30d = Number((shrink || [])
      .reduce((s, m) => s + Math.abs(m.quantity) * Number(m.product?.unit_price || 0), 0).toFixed(2));
  }

  /* ----------------------------------------------------------- system / users */
  if (can('users.view')) {
    const { data: rolesAll } = await supabaseAdmin.from('roles').select('role_id, role_code, role_name');
    const { data: users } = await supabaseAdmin.from('users').select('role_id').eq('is_active', true);
    // Super Admin accounts are not disclosed to tenant-level users
    const roles = (rolesAll || []).filter((r) => isSuper || r.role_code !== 'super_admin');
    const visibleRoleIds = new Set(roles.map((r) => r.role_id));
    payload.cards.totalUsers = (users || []).filter((u) => visibleRoleIds.has(u.role_id)).length;
    payload.panels.usersByRole = roles.map((r) => ({
      roleCode: r.role_code,
      roleName: r.role_name,
      count: (users || []).filter((u) => u.role_id === r.role_id).length,
    }));
  }

  if (can('logs.view')) {
    // Same scope as GET /api/logs: only Super Admin sees everyone's activity.
    let logQuery = supabaseAdmin
      .from('activity_logs')
      .select('log_id, action, entity_type, entity_id, created_at, user:users ( full_name )')
      .order('created_at', { ascending: false })
      .limit(8);
    if (!isSuper) logQuery = logQuery.eq('user_id', req.user.id);
    const { data: logs } = await logQuery;
    payload.panels.recentActivity = logs || [];
  }

  if (can('suppliers.view')) {
    const { count } = await supabaseAdmin
      .from('suppliers').select('supplier_id', { count: 'exact', head: true }).eq('is_active', true);
    payload.cards.activeSuppliers = count ?? 0;
  }

  /* ------------------------------------------------------------------ finance */
  if (can('finance.view')) {
    // Sales and transactions are scheduled for the finals phase. The card is
    // returned as a declared placeholder so the Finance dashboard is honest
    // about what is not built yet rather than showing invented numbers.
    payload.panels.financeNotice = {
      status: 'planned',
      message: 'Sales and transaction management is scheduled for the finals phase. Inventory valuation below is live.',
    };
  }

  dashboardCache.set(cacheKey, payload);
  ok(res, payload);
});

/**
 * GET /api/super-admin/dashboard
 * Dedicated platform oversight telemetry for Super Administrators.
 * Focuses on organization governance, role distribution, audit events, and system inventory health.
 */
export const getSuperAdminDashboard = asyncHandler(async (req, res) => {
  if (req.user?.role?.role_code !== 'super_admin') {
    throw ApiError.forbidden('Access restricted to Super Admin');
  }

  const [
    usersCountRes,
    activeUsersRes,
    rolesRes,
    allUsersRes,
    logsRes,
    logsCountRes,
    alertsRes,
    invRes,
    shrinkRes,
  ] = await Promise.all([
    supabaseAdmin.from('users').select('*', { count: 'exact', head: true }),
    supabaseAdmin.from('users').select('*', { count: 'exact', head: true }).eq('is_active', true),
    supabaseAdmin.from('roles').select('role_id, role_code, role_name, description, is_system, role_permissions(permission_id)'),
    supabaseAdmin.from('users').select('user_id, role_id, is_active'),
    supabaseAdmin.from('activity_logs')
      .select('log_id, action, entity_type, entity_id, details, created_at, user:users ( user_id, full_name, role:roles ( role_code, role_name, description ) )')
      .order('created_at', { ascending: false })
      .limit(10),
    supabaseAdmin.from('activity_logs').select('*', { count: 'exact', head: true }),
    supabaseAdmin.from('alerts')
      .select('alert_id, alert_type, alert_message, priority, date_created, product:products ( product_id, product_name, sku )')
      .eq('alert_status', 'active')
      .order('priority', { ascending: false })
      .order('date_created', { ascending: false }),
    supabaseAdmin.from('inventory')
      .select('current_stock, minimum_stock, reorder_point, product:products ( product_id, product_name, sku, unit_price )'),
    supabaseAdmin.from('stock_movements')
      .select('quantity, movement_type, product:products ( unit_price )')
      .in('movement_type', ['damaged', 'missing'])
      .gte('date_recorded', new Date(Date.now() - 30 * 864e5).toISOString()),
  ]);

  const roles = rolesRes.data || [];
  const users = allUsersRes.data || [];
  const alerts = alertsRes.data || [];
  const inventory = (invRes.data || []).filter((r) => r.product);
  const shrink = shrinkRes.data || [];

  const totalRoles = roles.length;
  const customRoles = roles.filter((r) => !r.is_system).length;
  const activeRoles = roles.filter((r) => parseRoleMetadata(r.description, r.role_code).isActive).length;
  const criticalAlerts = alerts.filter((a) => a.priority === 'critical');

  const roleDistribution = roles.map((r) => {
    const meta = parseRoleMetadata(r.description, r.role_code);
    const assignedUsers = users.filter((u) => u.role_id === r.role_id);
    return {
      roleId: r.role_id,
      roleCode: r.role_code,
      roleName: r.role_name,
      icon: meta.icon,
      isSystem: r.is_system,
      isActive: meta.isActive,
      userCount: assignedUsers.length,
      activeUserCount: assignedUsers.filter((u) => u.is_active).length,
      permissionCount: (r.role_permissions || []).length,
    };
  });

  let totalStockUnits = 0;
  let totalValuation = 0;
  let lowStockCount = 0;
  let outOfStockCount = 0;

  for (const item of inventory) {
    totalStockUnits += item.current_stock;
    totalValuation += item.current_stock * Number(item.product.unit_price || 0);
    if (item.current_stock === 0) outOfStockCount += 1;
    else if (item.current_stock <= item.minimum_stock) lowStockCount += 1;
  }

  const shrinkageUnits30d = shrink.reduce((acc, m) => acc + Math.abs(m.quantity), 0);
  const shrinkageValue30d = Number(
    shrink.reduce((acc, m) => acc + Math.abs(m.quantity) * Number(m.product?.unit_price || 0), 0).toFixed(2)
  );

  const recentAdministrativeActivity = (logsRes.data || []).map((l) => {
    const actorRole = l.user?.role;
    const actorMeta = actorRole ? parseRoleMetadata(actorRole.description, actorRole.role_code) : null;
    return {
      logId: l.log_id,
      action: l.action,
      entityType: l.entity_type,
      entityId: l.entity_id,
      details: l.details,
      createdAt: l.created_at,
      actor: {
        userId: l.user?.user_id || null,
        fullName: l.user?.full_name || 'System / Platform',
        roleCode: actorRole?.role_code || 'system',
        roleName: actorRole?.role_name || 'System',
        icon: actorMeta?.icon || '🛡️',
      },
    };
  });

  ok(res, {
    platformOverview: {
      totalOrganizations: 1,
      totalUsers: usersCountRes.count || 0,
      activeUsers: activeUsersRes.count || 0,
      totalRoles,
      customRoles,
      activeRoles,
      criticalAlertsCount: criticalAlerts.length,
      activeAlertsCount: alerts.length,
      totalAuditLogs: logsCountRes.count || 0,
      platformStatus: 'healthy',
      generatedAt: new Date().toISOString(),
    },
    accessOverview: {
      roleDistribution,
    },
    inventoryHealth: {
      totalProducts: inventory.length,
      totalStockUnits,
      totalValuation: Number(totalValuation.toFixed(2)),
      lowStockCount,
      outOfStockCount,
      shrinkageUnits30d,
      shrinkageValue30d,
    },
    itemsNeedingAttention: {
      criticalAlerts: criticalAlerts.slice(0, 5),
      outOfStockItems: inventory
        .filter((i) => i.current_stock === 0)
        .slice(0, 5)
        .map((i) => ({
          productId: i.product.product_id,
          productName: i.product.product_name,
          sku: i.product.sku,
          unitPrice: Number(i.product.unit_price || 0),
        })),
    },
    recentAdministrativeActivity,
  });
});
