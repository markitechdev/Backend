import { z } from 'zod';
import { supabaseAdmin } from '../config/supabase.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ok, created } from '../utils/respond.js';
import { logActivity } from '../services/activityLog.service.js';
import { refreshAlertsForProduct } from '../services/alert.service.js';
import { invalidateDashboardCache } from '../utils/cache.js';
import { fetchAllRows, applyDateRange } from '../utils/query.js';

const MOVEMENT_AUDIT_ACTIONS = {
  stock_in: 'STOCK_IN',
  stock_out: 'STOCK_OUT',
  damaged: 'ITEM_DAMAGED',
  missing: 'ITEM_MISSING',
  returned: 'STOCK_RETURNED',
  adjustment: 'STOCK_ADJUSTMENT',
};

const SELECT = `
  movement_id, movement_type, quantity, reason, reference_no, date_recorded,
  product:products ( product_id, product_name, sku ),
  recorded_by_user:users!stock_movements_recorded_by_fkey ( user_id, full_name )
`;

export const movementSchema = z.object({
  productId: z.coerce.number().int().positive(),
  movementType: z.enum(['stock_in', 'stock_out', 'damaged', 'missing', 'returned', 'adjustment']),
  quantity: z.coerce.number().int(),
  reason: z.string().optional().nullable(),
  referenceNo: z.string().optional().nullable(),
}).refine(
  (v) => (v.movementType === 'adjustment' ? v.quantity !== 0 : v.quantity > 0),
  { message: 'Quantity must be greater than 0 (adjustments may be negative but not zero)', path: ['quantity'] },
);

/** GET /api/movements - the stock movement ledger. */
export const listMovements = asyncHandler(async (req, res) => {
  const { productId, type, from, to, limit = 100 } = req.query;

  let q = supabaseAdmin.from('stock_movements').select(SELECT)
    .order('date_recorded', { ascending: false })
    .limit(Math.min(Number(limit) || 100, 500));

  if (productId) q = q.eq('product_id', Number(productId) || 0);
  if (type)      q = q.eq('movement_type', type);
  q = applyDateRange(q, 'date_recorded', from, to);

  const { data, error } = await q;
  if (error) throw ApiError.fromDb(error);
  ok(res, data, { total: data.length });
});

/**
 * POST /api/movements
 * The single entry point for changing stock. The database trigger applies the
 * delta to inventory and re-evaluates alerts, so stock can never drift from
 * the ledger and every change is attributable to a user.
 */
export const createMovement = asyncHandler(async (req, res) => {
  const { productId, movementType, quantity, reason, referenceNo } = req.body;

  const { data: product } = await supabaseAdmin
    .from('products').select('product_id, product_name').eq('product_id', productId).single();
  if (!product) throw ApiError.notFound('Product not found');

  const { data: invCheck } = await supabaseAdmin
    .from('inventory').select('current_stock').eq('product_id', productId).single();
  if (!invCheck) throw ApiError.badRequest('This product has no inventory record yet.');

  const currentStock = invCheck.current_stock;
  let projectedStock = currentStock;

  if (['stock_out', 'damaged', 'missing'].includes(movementType)) {
    projectedStock = currentStock - quantity;
  } else if (movementType === 'stock_in' || movementType === 'returned') {
    projectedStock = currentStock + quantity;
  } else if (movementType === 'adjustment') {
    projectedStock = currentStock + quantity;
  }

  // Authoritative guard against negative inventory
  if (projectedStock < 0) {
    throw ApiError.badRequest(
      `Insufficient stock on hand: current stock is ${currentStock}, operation would result in negative stock (${projectedStock})`
    );
  }

  const { data, error } = await supabaseAdmin.from('stock_movements').insert({
    product_id: productId,
    movement_type: movementType,
    quantity,
    reason: reason ?? null,
    reference_no: referenceNo ?? null,
    recorded_by: req.user.id,
  }).select(SELECT).single();

  if (error) {
    // The database trigger raises this when a movement would push stock below zero
    if (/Insufficient stock/i.test(error.message)) throw ApiError.badRequest(error.message);
    if (/No inventory record/i.test(error.message)) {
      throw ApiError.badRequest('This product has no inventory record yet.');
    }
    throw ApiError.fromDb(error);
  }

  const { data: inv } = await supabaseAdmin
    .from('inventory').select('current_stock, minimum_stock, reorder_point')
    .eq('product_id', productId).single();

  // Trigger alert refresh to keep lifecycle and notifications in sync
  await refreshAlertsForProduct(productId);

  const auditAction = MOVEMENT_AUDIT_ACTIONS[movementType] || 'RECORD_MOVEMENT';
  await logActivity(req.user.id, auditAction, 'stock_movements', data.movement_id, {
    product: product.product_name,
    movementType,
    quantity,
    stockBefore: currentStock,
    stockAfter: inv?.current_stock ?? projectedStock,
    reason: reason ?? null,
    referenceNo: referenceNo ?? null,
  });

  invalidateDashboardCache(req.tenantId);
  created(res, {
    ...data,
    stockBefore: currentStock,
    stockAfter: inv?.current_stock ?? projectedStock,
    inventory: inv,
  });
});

/** GET /api/movements/summary - totals by type, for the shrinkage report. */
export const movementSummary = asyncHandler(async (req, res) => {
  const { from, to } = req.query;

  // Paged read: Supabase returns at most 1,000 rows per request
  const build = () => {
    let q = supabaseAdmin.from('stock_movements')
      .select('movement_type, quantity, product:products ( unit_price )');
    q = applyDateRange(q, 'date_recorded', from, to);
    return q.order('movement_id', { ascending: false });
  };
  const data = await fetchAllRows(build);

  const byType = {};
  let shrinkageUnits = 0;
  let shrinkageValue = 0;

  for (const m of data) {
    byType[m.movement_type] ||= { count: 0, units: 0 };
    byType[m.movement_type].count += 1;
    byType[m.movement_type].units += Math.abs(m.quantity);
    if (m.movement_type === 'damaged' || m.movement_type === 'missing') {
      shrinkageUnits += Math.abs(m.quantity);
      shrinkageValue += Math.abs(m.quantity) * Number(m.product?.unit_price || 0);
    }
  }

  ok(res, {
    byType,
    shrinkage: { units: shrinkageUnits, value: Number(shrinkageValue.toFixed(2)) },
    totalMovements: data.length,
  });
});

export const stockCountSchema = z.object({
  productId: z.coerce.number().int().positive(),
  countedQuantity: z.coerce.number().int().min(0, 'Counted quantity cannot be negative'),
  reason: z.string().max(500).optional().nullable(),
  referenceNo: z.string().max(100).optional().nullable(),
});

/**
 * POST /api/movements/count - physical (cycle) count.
 * Staff enter what is physically on the shelf; the server compares it with the
 * system quantity and records the variance in the ledger:
 *   counted < system  -> "missing" movement (shrinkage, raises a missing-item alert)
 *   counted > system  -> positive "adjustment"
 *   counted = system  -> nothing recorded, the count is only logged
 * This is what lets shrinkage be detected instead of only being self-reported.
 */
export const recordStockCount = asyncHandler(async (req, res) => {
  const { productId, countedQuantity, reason, referenceNo } = req.body;

  const { data: product } = await supabaseAdmin
    .from('products').select('product_id, product_name').eq('product_id', productId).maybeSingle();
  if (!product) throw ApiError.notFound('Product not found');

  const { data: inv } = await supabaseAdmin
    .from('inventory').select('current_stock').eq('product_id', productId).maybeSingle();
  if (!inv) throw ApiError.badRequest('This product has no inventory record yet.');

  const systemQuantity = inv.current_stock;
  const variance = countedQuantity - systemQuantity;

  if (variance === 0) {
    await logActivity(req.user.id, 'STOCK_COUNT_MATCHED', 'inventory', productId, {
      product: product.product_name, counted: countedQuantity, system: systemQuantity,
    });
    return ok(res, { variance: 0, systemQuantity, countedQuantity, movement: null,
      message: 'Physical count matches the system quantity. No adjustment needed.' });
  }

  const movementType = variance < 0 ? 'missing' : 'adjustment';
  const note = `Cycle count: counted ${countedQuantity}, system had ${systemQuantity}`;

  const { data, error } = await supabaseAdmin.from('stock_movements').insert({
    product_id: productId,
    movement_type: movementType,
    quantity: Math.abs(variance),
    reason: reason ? `${note}. ${reason}` : note,
    reference_no: referenceNo ?? null,
    recorded_by: req.user.id,
  }).select(SELECT).single();

  if (error) {
    if (/Insufficient stock/i.test(error.message)) {
      throw ApiError.conflict('Stock changed while the count was being saved. Please count again.');
    }
    throw ApiError.fromDb(error);
  }

  await refreshAlertsForProduct(productId);
  await logActivity(req.user.id, 'STOCK_COUNT_VARIANCE', 'stock_movements', data.movement_id, {
    product: product.product_name, counted: countedQuantity, system: systemQuantity, variance, movementType,
  });
  invalidateDashboardCache(req.tenantId);

  created(res, {
    variance, systemQuantity, countedQuantity, movement: data,
    message: variance < 0
      ? `${Math.abs(variance)} unit(s) missing. Recorded as shrinkage.`
      : `${variance} unit(s) more than the system showed. Recorded as an adjustment.`,
  });
});
