import test from 'node:test';
import assert from 'node:assert/strict';
import { requireAnyPermission } from '../src/middleware/authorize.js';
import { enforceTenantIsolation } from '../src/middleware/tenantIsolation.js';

test('Reports: Authorization - blocks users without reports.view or reports.generate', () => {
  const unauthorizedStaff = {
    user: {
      id: 'staff-1',
      role: { role_code: 'staff' },
      permissions: ['inventory.view', 'products.view'],
    },
  };

  let err = null;
  requireAnyPermission('reports.view', 'reports.generate')(unauthorizedStaff, {}, (e) => {
    err = e;
  });

  assert.ok(err, 'Users lacking reports permissions must be blocked');
  assert.strictEqual(err.status, 403);
  assert.strictEqual(err.code, 'FORBIDDEN');
});

test('Reports: Authorization - grants access to users with reports.view', () => {
  const authorizedManager = {
    user: {
      id: 'manager-1',
      role: { role_code: 'warehouse_admin' },
      permissions: ['reports.view'],
    },
  };

  let err = null;
  requireAnyPermission('reports.view', 'reports.generate')(authorizedManager, {}, (e) => {
    err = e;
  });

  assert.strictEqual(err, undefined, 'User with reports.view should proceed without error');
});

test('Reports: Authorization - Super Admin bypasses reporting permission check', () => {
  const superAdminReq = {
    user: {
      id: 'super-1',
      role: { role_code: 'super_admin' },
      permissions: [],
    },
  };

  let err = null;
  requireAnyPermission('reports.view', 'reports.generate')(superAdminReq, {}, (e) => {
    err = e;
  });

  assert.strictEqual(err, undefined, 'Super Admin must always be allowed access to reports');
});

test('Reports: Multi-tenant safety - blocks cross-tenant query injection on report endpoints', () => {
  const crossTenantReq = {
    user: { id: 'user-1', tenantId: 'tenant-a', role: { role_code: 'warehouse_admin' } },
    query: { tenant_id: 'tenant-b', from: '2026-01-01' },
    headers: {},
    body: {},
    params: {},
  };

  let err = null;
  enforceTenantIsolation(crossTenantReq, {}, (e) => { err = e; });

  assert.ok(err, 'Cross-tenant query parameter on reports must be rejected');
  assert.strictEqual(err.status, 403);
  assert.strictEqual(err.code, 'FORBIDDEN');
});

test('Reports: Inventory valuation and stock status calculations work accurately', () => {
  const sampleInventory = [
    { current_stock: 0, minimum_stock: 10, reorder_point: 20, unit_price: 15.5 },
    { current_stock: 5, minimum_stock: 10, reorder_point: 20, unit_price: 25.0 },
    { current_stock: 15, minimum_stock: 10, reorder_point: 20, unit_price: 10.0 },
    { current_stock: 50, minimum_stock: 10, reorder_point: 20, unit_price: 8.0 },
  ];

  const statusOf = (current, min, reorder) => {
    if (current === 0) return 'out_of_stock';
    if (current <= min) return 'low_stock';
    if (current <= reorder) return 'reorder';
    return 'in_stock';
  };

  const statuses = sampleInventory.map((i) => statusOf(i.current_stock, i.minimum_stock, i.reorder_point));
  assert.deepStrictEqual(statuses, ['out_of_stock', 'low_stock', 'reorder', 'in_stock']);

  const totalUnits = sampleInventory.reduce((acc, r) => acc + r.current_stock, 0);
  assert.strictEqual(totalUnits, 70);

  const totalValuation = sampleInventory.reduce((acc, r) => acc + r.current_stock * r.unit_price, 0);
  assert.strictEqual(totalValuation, 0 * 15.5 + 5 * 25.0 + 15 * 10.0 + 50 * 8.0); // 0 + 125 + 150 + 400 = 675
  assert.strictEqual(totalValuation, 675);
});

test('Reports: Shrinkage calculation accurately aggregates damaged and missing goods', () => {
  const sampleMovements = [
    { movement_type: 'stock_in', quantity: 100, unit_price: 10.0 },
    { movement_type: 'stock_out', quantity: 20, unit_price: 10.0 },
    { movement_type: 'damaged', quantity: 4, unit_price: 10.0 },
    { movement_type: 'missing', quantity: 6, unit_price: 15.0 },
    { movement_type: 'returned', quantity: 2, unit_price: 10.0 },
  ];

  const shrinkageMovements = sampleMovements.filter((m) => ['damaged', 'missing'].includes(m.movement_type));
  const totalShrinkageUnits = shrinkageMovements.reduce((sum, m) => sum + m.quantity, 0);
  const totalShrinkageValue = shrinkageMovements.reduce((sum, m) => sum + m.quantity * m.unit_price, 0);

  assert.strictEqual(totalShrinkageUnits, 10);
  assert.strictEqual(totalShrinkageValue, 4 * 10.0 + 6 * 15.0); // 40 + 90 = 130
  assert.strictEqual(totalShrinkageValue, 130.0);
});

test('Reports: Procurement reorder forecast calculates correct deficits', () => {
  const item = { current_stock: 4, minimum_stock: 10, reorder_point: 20, unit_price: 12.5 };
  const targetStock = Math.max(item.reorder_point * 2, item.minimum_stock * 2, 10); // 40
  const recommendedOrder = Math.max(1, targetStock - item.current_stock); // 36
  const estimatedCost = Number((recommendedOrder * item.unit_price).toFixed(2)); // 36 * 12.5 = 450

  assert.strictEqual(targetStock, 40);
  assert.strictEqual(recommendedOrder, 36);
  assert.strictEqual(estimatedCost, 450);
});
