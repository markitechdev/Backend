import { z } from 'zod';
import { supabaseAdmin } from '../config/supabase.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ok } from '../utils/respond.js';
import { logActivity } from '../services/activityLog.service.js';
import { invalidateDashboardCache } from '../utils/cache.js';
import { stockStatus } from '../utils/stock.js';

const OPEN_STATUSES = ['active', 'acknowledged'];
const ALERT_STATUSES = ['active', 'acknowledged', 'resolved'];

const SELECT = `
  alert_id, alert_type, alert_message, alert_status, priority, date_created, resolved_at,
  product:products (
    product_id, product_name, sku,
    supplier:suppliers ( supplier_id, supplier_name, contact_person, contact_number, email ),
    inventory ( current_stock, minimum_stock, reorder_point )
  ),
  resolved_by_user:users!alerts_resolved_by_fkey ( full_name )
`;

/** GET /api/alerts */
export const listAlerts = asyncHandler(async (req, res) => {
  const { status = 'active', type, priority, search } = req.query;

  let q = supabaseAdmin.from('alerts').select(SELECT)
    .order('priority', { ascending: false })
    .order('date_created', { ascending: false });

  // 'open' = everything still needing attention (active + acknowledged)
  if (status === 'open') q = q.in('alert_status', OPEN_STATUSES);
  else if (ALERT_STATUSES.includes(status)) q = q.eq('alert_status', status);
  else if (status !== 'all') throw ApiError.badRequest('status must be one of: open, active, acknowledged, resolved, all');
  if (type)     q = q.eq('alert_type', type);
  if (priority) q = q.eq('priority', priority);

  const { data, error } = await q;
  if (error) throw ApiError.fromDb(error);

  let rows = data.map((a) => ({
    ...a,
    product: a.product
      ? { ...a.product, inventory: Array.isArray(a.product.inventory) ? a.product.inventory[0] : a.product.inventory }
      : null,
  }));

  if (search) {
    const s = String(search).toLowerCase();
    rows = rows.filter((a) =>
      a.product?.product_name?.toLowerCase().includes(s) ||
      a.product?.sku?.toLowerCase().includes(s) ||
      a.alert_message.toLowerCase().includes(s));
  }

  ok(res, rows, { total: rows.length });
});

/** GET /api/alerts/summary - counts for the alert dashboard cards and donut. */
export const alertSummary = asyncHandler(async (_req, res) => {
  const { data, error } = await supabaseAdmin
    .from('alerts').select('alert_type, priority, alert_status').in('alert_status', OPEN_STATUSES);
  if (error) throw ApiError.fromDb(error);

  const byType = {}, byPriority = { low: 0, medium: 0, high: 0, critical: 0 };
  const byStatus = { active: 0, acknowledged: 0 };
  for (const a of data) {
    byType[a.alert_type] = (byType[a.alert_type] || 0) + 1;
    byPriority[a.priority] = (byPriority[a.priority] || 0) + 1;
    byStatus[a.alert_status] = (byStatus[a.alert_status] || 0) + 1;
  }
  ok(res, { total: data.length, byType, byPriority, byStatus });
});

export const alertStatusSchema = z.object({
  status: z.enum(['acknowledged', 'resolved']),
  note: z.string().optional().nullable(),
});

/** PATCH /api/alerts/:id */
export const updateAlertStatus = asyncHandler(async (req, res) => {
  const { data: existing } = await supabaseAdmin
    .from('alerts')
    .select('alert_id, alert_status, alert_type, product:products ( expiration_date, inventory ( current_stock, minimum_stock, reorder_point ) )')
    .eq('alert_id', req.params.id).maybeSingle();
  if (!existing) throw ApiError.notFound('Alert not found');

  if (existing.alert_status === 'resolved' && req.body.status === 'acknowledged') {
    throw ApiError.conflict('A resolved alert cannot be moved back to acknowledged.');
  }

  // Stock-condition alerts close themselves when the condition clears. Resolving
  // one by hand while the condition still holds would only re-open it on the next
  // stock change, so tell the user to acknowledge it instead.
  if (req.body.status === 'resolved') {
    const inv = Array.isArray(existing.product?.inventory) ? existing.product.inventory[0] : existing.product?.inventory;
    const status = inv ? stockStatus(inv.current_stock, inv.minimum_stock, inv.reorder_point) : null;
    const expiry = existing.product?.expiration_date ? new Date(existing.product.expiration_date) : null;
    const stillTrue = {
      out_of_stock: status === 'out_of_stock',
      low_stock: status === 'low_stock',
      reorder: status === 'reorder',
      near_expiry: Boolean(expiry && expiry.getTime() <= Date.now() + 30 * 864e5),
    }[existing.alert_type];
    if (stillTrue) {
      throw ApiError.conflict('This condition is still true, so the alert would re-open immediately. Acknowledge it instead; it resolves automatically once stock is replenished.');
    }
  }

  if (existing.alert_status === req.body.status) {
    return ok(res, { alert_id: existing.alert_id, alert_status: existing.alert_status, message: `Alert is already ${existing.alert_status}.` });
  }

  const patch = { alert_status: req.body.status };
  if (req.body.status === 'resolved') {
    patch.resolved_at = new Date().toISOString();
    patch.resolved_by = req.user.id;
  }

  const { data, error } = await supabaseAdmin
    .from('alerts').update(patch).eq('alert_id', req.params.id).select(SELECT).single();
  if (error) throw ApiError.fromDb(error);
  if (!data) throw ApiError.notFound('Alert not found');

  invalidateDashboardCache();
  const auditAction = req.body.status === 'resolved' ? 'ALERT_RESOLVED' : 'ALERT_ACKNOWLEDGED';
  await logActivity(req.user.id, auditAction, 'alerts', req.params.id, {
    status: req.body.status,
    note: req.body.note ?? null,
  });
  ok(res, data);
});
