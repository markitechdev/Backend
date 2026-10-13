import { z } from 'zod';
import { supabaseAdmin } from '../config/supabase.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ok, created, paginated } from '../utils/respond.js';
import { logActivity } from '../services/activityLog.service.js';
import { refreshAlertsForProduct } from '../services/alert.service.js';
import { invalidateDashboardCache } from '../utils/cache.js';
import { fetchAllRows, applyDateRange, pageParams, safeSearchTerm } from '../utils/query.js';

/**
 * Sales & transaction management (finance.view / finance.manage).
 * A sale is written by the database function record_sale(), which issues the
 * stock through stock_movements in the same transaction, so inventory, alerts
 * and the movement ledger always agree with the sales records.
 */

export const PAYMENT_METHODS = ['cash', 'gcash', 'card', 'bank_transfer'];

const SELECT = `
  sale_id, reference_no, customer_name, payment_method, status,
  subtotal, discount, total, notes, sold_at, voided_at, void_reason,
  sold_by_user:users!sales_sold_by_fkey ( user_id, full_name ),
  voided_by_user:users!sales_voided_by_fkey ( user_id, full_name ),
  items:sale_items ( sale_item_id, product_id, quantity, unit_price, line_total,
    product:products ( product_id, product_name, sku ) )
`;

const num = (v) => Number(v) || 0;
const round2 = (v) => Math.round(num(v) * 100) / 100;

const shape = (row) => ({
  saleId: row.sale_id,
  referenceNo: row.reference_no,
  customerName: row.customer_name,
  paymentMethod: row.payment_method,
  status: row.status,
  subtotal: num(row.subtotal),
  discount: num(row.discount),
  total: num(row.total),
  notes: row.notes,
  soldAt: row.sold_at,
  soldBy: row.sold_by_user ? { userId: row.sold_by_user.user_id, fullName: row.sold_by_user.full_name } : null,
  voidedAt: row.voided_at,
  voidReason: row.void_reason,
  voidedBy: row.voided_by_user ? { userId: row.voided_by_user.user_id, fullName: row.voided_by_user.full_name } : null,
  itemCount: (row.items || []).reduce((s, i) => s + num(i.quantity), 0),
  items: (row.items || []).map((i) => ({
    saleItemId: i.sale_item_id,
    productId: i.product_id,
    productName: i.product?.product_name ?? null,
    sku: i.product?.sku ?? null,
    quantity: num(i.quantity),
    unitPrice: num(i.unit_price),
    lineTotal: num(i.line_total),
  })),
});

export const saleSchema = z.object({
  items: z.array(z.object({
    productId: z.coerce.number().int().positive(),
    quantity: z.coerce.number().int().positive(),
  })).min(1, 'Add at least one item'),
  customerName: z.string().trim().max(120).optional().nullable(),
  paymentMethod: z.enum(PAYMENT_METHODS).default('cash'),
  discount: z.coerce.number().min(0).default(0),
  notes: z.string().trim().max(500).optional().nullable(),
}).refine((v) => new Set(v.items.map((i) => i.productId)).size === v.items.length, {
  message: 'Each product can only appear once per sale', path: ['items'],
});

export const voidSchema = z.object({
  reason: z.string().trim().max(300).optional().nullable(),
});

const buildList = (query) => {
  const { status, paymentMethod, from, to, search } = query;
  let q = supabaseAdmin.from('sales').select(SELECT, { count: 'exact' });
  if (status && status !== 'all') q = q.eq('status', status);
  if (paymentMethod) q = q.eq('payment_method', paymentMethod);
  q = applyDateRange(q, 'sold_at', from, to);
  const term = safeSearchTerm(search);
  if (term) q = q.or(`reference_no.ilike.%${term}%,customer_name.ilike.%${term}%`);
  return q.order('sold_at', { ascending: false }).order('sale_id', { ascending: false });
};

/** GET /api/sales - sales transactions, newest first. */
export const listSales = asyncHandler(async (req, res) => {
  const paging = pageParams(req.query.page, req.query.limit, { max: 100, fallback: 20 });
  let q = buildList(req.query);
  if (paging) q = q.range(paging.from, paging.to);
  else q = q.limit(200);
  const { data, error, count } = await q;
  if (error) throw ApiError.fromDb(error);
  const rows = (data || []).map(shape);
  if (paging) return paginated(res, rows, { page: paging.page, limit: paging.limit, total: count ?? rows.length });
  return ok(res, rows, { total: count ?? rows.length });
});

/** GET /api/sales/:id */
export const getSale = asyncHandler(async (req, res) => {
  const { data, error } = await supabaseAdmin.from('sales').select(SELECT)
    .eq('sale_id', Number(req.params.id) || 0).maybeSingle();
  if (error) throw ApiError.fromDb(error);
  if (!data) throw ApiError.notFound('Sale not found');
  ok(res, shape(data));
});

/** POST /api/sales - record a sale; stock is issued in the same transaction. */
export const createSale = asyncHandler(async (req, res) => {
  const { items, customerName, paymentMethod, discount, notes } = req.body;

  const { data: saleId, error } = await supabaseAdmin.rpc('record_sale', {
    p_user: req.user.id,
    p_items: items,
    p_customer_name: customerName ?? null,
    p_payment_method: paymentMethod,
    p_discount: round2(discount),
    p_notes: notes ?? null,
  });
  if (error) {
    if (/Insufficient stock|not found or inactive|No inventory record|at least one item|Discount|Quantity/i.test(error.message)) {
      throw ApiError.badRequest(error.message.replace(/^.*?:\s*(?=[A-Z])/, ''));
    }
    throw ApiError.fromDb(error);
  }

  const { data } = await supabaseAdmin.from('sales').select(SELECT).eq('sale_id', saleId).single();
  const sale = shape(data);

  await Promise.all(sale.items.map((i) => refreshAlertsForProduct(i.productId)));
  await logActivity(req.user.id, 'SALE_RECORDED', 'sales', sale.saleId, {
    referenceNo: sale.referenceNo,
    customer: sale.customerName,
    paymentMethod: sale.paymentMethod,
    items: sale.items.map((i) => `${i.productName} × ${i.quantity}`),
    total: sale.total,
  });
  invalidateDashboardCache(req.tenantId);
  created(res, sale);
});

/** POST /api/sales/:id/void - cancel a sale and return its stock. */
export const voidSale = asyncHandler(async (req, res) => {
  const id = Number(req.params.id) || 0;
  const { error } = await supabaseAdmin.rpc('void_sale', { p_sale_id: id, p_user: req.user.id, p_reason: req.body?.reason ?? null });
  if (error) {
    if (/not found or already voided/i.test(error.message)) throw ApiError.notFound('Sale not found or already voided');
    throw ApiError.fromDb(error);
  }
  const { data } = await supabaseAdmin.from('sales').select(SELECT).eq('sale_id', id).single();
  const sale = shape(data);

  await Promise.all(sale.items.map((i) => refreshAlertsForProduct(i.productId)));
  await logActivity(req.user.id, 'SALE_VOIDED', 'sales', id, {
    referenceNo: sale.referenceNo, total: sale.total, reason: sale.voidReason,
  });
  invalidateDashboardCache(req.tenantId);
  ok(res, sale);
});

/**
 * GET /api/sales/summary?from&to
 * Financial report: totals, revenue by day, by payment method and top products.
 * Only completed sales count; voided sales are reported separately.
 */
export const salesSummary = asyncHandler(async (req, res) => {
  const { from, to } = req.query;
  const build = () => {
    let q = supabaseAdmin.from('sales').select(`
      sale_id, status, payment_method, subtotal, discount, total, sold_at,
      items:sale_items ( product_id, quantity, line_total, product:products ( product_name, sku ) )
    `).order('sale_id');
    return applyDateRange(q, 'sold_at', from, to);
  };
  const rows = await fetchAllRows(build);

  const completed = rows.filter((r) => r.status === 'completed');
  const voided = rows.filter((r) => r.status === 'voided');

  const byDay = new Map();
  const byMethod = new Map();
  const byProduct = new Map();
  let itemsSold = 0;

  for (const s of completed) {
    const day = String(s.sold_at).slice(0, 10);
    const d = byDay.get(day) || { date: day, revenue: 0, transactions: 0, items: 0 };
    d.revenue = round2(d.revenue + num(s.total)); d.transactions += 1;
    const m = byMethod.get(s.payment_method) || { paymentMethod: s.payment_method, revenue: 0, transactions: 0 };
    m.revenue = round2(m.revenue + num(s.total)); m.transactions += 1;
    byMethod.set(s.payment_method, m);
    for (const i of s.items || []) {
      itemsSold += num(i.quantity); d.items += num(i.quantity);
      const p = byProduct.get(i.product_id) || { productId: i.product_id, productName: i.product?.product_name, sku: i.product?.sku, units: 0, revenue: 0 };
      p.units += num(i.quantity); p.revenue = round2(p.revenue + num(i.line_total));
      byProduct.set(i.product_id, p);
    }
    byDay.set(day, d);
  }

  const revenue = round2(completed.reduce((s, r) => s + num(r.total), 0));
  const grossSales = round2(completed.reduce((s, r) => s + num(r.subtotal), 0));
  const discounts = round2(completed.reduce((s, r) => s + num(r.discount), 0));

  ok(res, {
    summary: {
      revenue,
      grossSales,
      discounts,
      transactions: completed.length,
      itemsSold,
      averageSale: completed.length ? round2(revenue / completed.length) : 0,
      voidedCount: voided.length,
      voidedValue: round2(voided.reduce((s, r) => s + num(r.total), 0)),
    },
    byDay: [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date)),
    byPaymentMethod: [...byMethod.values()].sort((a, b) => b.revenue - a.revenue),
    topProducts: [...byProduct.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 10),
  }, { from: from ?? null, to: to ?? null });
});
