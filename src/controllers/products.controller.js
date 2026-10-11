import { z } from 'zod';
import { supabaseAdmin } from '../config/supabase.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ok, created, noContent, paginated } from '../utils/respond.js';
import { logActivity } from '../services/activityLog.service.js';
import { refreshAlertsForProduct } from '../services/alert.service.js';
import { stockStatus, assertThresholds } from '../utils/stock.js';
import { safeSearchTerm } from '../utils/query.js';
import { invalidateDashboardCache } from '../utils/cache.js';

const SELECT = `
  product_id, product_name, sku, unit_price, unit_of_measure, expiration_date, status, created_at,
  category:categories ( category_id, category_name ),
  supplier:suppliers ( supplier_id, supplier_name ),
  inventory ( inventory_id, current_stock, minimum_stock, reorder_point, location, last_updated )
`;

export const productSchema = z.object({
  productName: z.string().min(2),
  sku: z.string().min(2),
  categoryId: z.coerce.number().int().positive().optional().nullable(),
  supplierId: z.coerce.number().int().positive().optional().nullable(),
  unitPrice: z.coerce.number().min(0).default(0),
  unitOfMeasure: z.string().default('pc'),
  expirationDate: z.string()
    .refine((v) => !v || !Number.isNaN(Date.parse(v)), 'Expiration date must be a valid date')
    .optional().nullable(),
  status: z.enum(['active', 'inactive', 'discontinued']).default('active'),
  // initial inventory, created alongside the product
  currentStock: z.coerce.number().int().min(0).default(0),
  minimumStock: z.coerce.number().int().min(0).default(0),
  reorderPoint: z.coerce.number().int().min(0).default(0),
  location: z.string().default('Main Warehouse'),
});

export const productUpdateSchema = productSchema.partial().omit({ currentStock: true });

/** Adds a derived stock_status so the UI does not recompute it in three places. */
const decorate = (row) => {
  const inv = Array.isArray(row.inventory) ? row.inventory[0] : row.inventory;
  const status = inv ? stockStatus(inv.current_stock, inv.minimum_stock, inv.reorder_point) : 'in_stock';
  return { ...row, inventory: inv ?? null, stock_status: status };
};

/** GET /api/products */
export const listProducts = asyncHandler(async (req, res) => {
  const { categoryId, supplierId, status, stockStatus: wantedStockStatus } = req.query;
  const search = safeSearchTerm(req.query.search);

  let q = supabaseAdmin.from('products').select(SELECT).order('product_name');
  if (categoryId) q = q.eq('category_id', categoryId);
  if (supplierId) q = q.eq('supplier_id', supplierId);
  if (status)     q = q.eq('status', status);
  if (search)     q = q.or(`product_name.ilike.%${search}%,sku.ilike.%${search}%`);

  const { data, error } = await q;
  if (error) throw new ApiError(500, error.message);

  let rows = data.map(decorate);
  if (wantedStockStatus) rows = rows.filter((r) => r.stock_status === wantedStockStatus);

  const { page, limit } = req.query;
  if (page || limit) {
    const pageNum = Math.max(1, Number(page) || 1);
    const limitNum = Math.max(1, Math.min(Number(limit) || 25, 100));
    const offset = (pageNum - 1) * limitNum;
    const paged = rows.slice(offset, offset + limitNum);
    return paginated(res, paged, { page: pageNum, limit: limitNum, total: rows.length });
  }

  ok(res, rows, { total: rows.length });
});

/** GET /api/products/:id */
export const getProduct = asyncHandler(async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('products').select(SELECT).eq('product_id', req.params.id).maybeSingle();
  if (error) throw new ApiError(500, error.message);
  if (!data) throw ApiError.notFound('Product not found');

  const { data: movements } = await supabaseAdmin
    .from('stock_movements')
    .select('movement_id, movement_type, quantity, reason, date_recorded, recorded_by:users ( full_name )')
    .eq('product_id', req.params.id)
    .order('date_recorded', { ascending: false })
    .limit(20);

  ok(res, { ...decorate(data), recentMovements: movements || [] });
});

/** POST /api/products - creates the product and its inventory row together. */
export const createProduct = asyncHandler(async (req, res) => {
  const b = req.body;
  assertThresholds(b.minimumStock, b.reorderPoint);

  const { data: product, error } = await supabaseAdmin.from('products').insert({
    product_name: b.productName,
    sku: b.sku,
    category_id: b.categoryId ?? null,
    supplier_id: b.supplierId ?? null,
    unit_price: b.unitPrice,
    unit_of_measure: b.unitOfMeasure,
    expiration_date: b.expirationDate || null,
    status: b.status,
  }).select().single();

  if (error) {
    if (error.code === '23505') throw ApiError.conflict(`SKU "${b.sku}" is already in use`);
    throw new ApiError(500, error.message);
  }

  const { error: invError } = await supabaseAdmin.from('inventory').insert({
    product_id: product.product_id,
    current_stock: b.currentStock,
    minimum_stock: b.minimumStock,
    reorder_point: b.reorderPoint,
    location: b.location,
    updated_by: req.user.id,
  });
  if (invError) {
    await supabaseAdmin.from('products').delete().eq('product_id', product.product_id);
    throw new ApiError(500, invError.message);
  }

  // NOTE: the opening balance is set directly on the inventory row above.
  // It is deliberately NOT written as a stock movement, because the
  // trg_apply_stock_movement trigger would then add the quantity a second time.
  // Every change after this point must go through /api/movements.

  invalidateDashboardCache();
  await logActivity(req.user.id, 'PRODUCT_CREATED', 'products', product.product_id, { sku: b.sku, name: product.product_name });
  const { data: full } = await supabaseAdmin
    .from('products').select(SELECT).eq('product_id', product.product_id).single();
  created(res, decorate(full));
});

/** PATCH /api/products/:id */
export const updateProduct = asyncHandler(async (req, res) => {
  const b = req.body;
  const productPatch = {};
  if (b.productName    !== undefined) productPatch.product_name    = b.productName;
  if (b.sku            !== undefined) productPatch.sku             = b.sku;
  if (b.categoryId     !== undefined) productPatch.category_id     = b.categoryId;
  if (b.supplierId     !== undefined) productPatch.supplier_id     = b.supplierId;
  if (b.unitPrice      !== undefined) productPatch.unit_price      = b.unitPrice;
  if (b.unitOfMeasure  !== undefined) productPatch.unit_of_measure = b.unitOfMeasure;
  if (b.expirationDate !== undefined) productPatch.expiration_date = b.expirationDate || null;
  if (b.status         !== undefined) productPatch.status          = b.status;

  // Verify product exists before updating
  const { data: existing } = await supabaseAdmin
    .from('products').select('product_id, product_name').eq('product_id', req.params.id).single();
  if (!existing) throw ApiError.notFound('Product not found');

  if (b.minimumStock !== undefined || b.reorderPoint !== undefined) {
    const { data: inv } = await supabaseAdmin
      .from('inventory').select('minimum_stock, reorder_point').eq('product_id', req.params.id).maybeSingle();
    assertThresholds(b.minimumStock ?? inv?.minimum_stock ?? 0, b.reorderPoint ?? inv?.reorder_point ?? 0);
  }

  if (Object.keys(productPatch).length) {
    const { error } = await supabaseAdmin
      .from('products').update(productPatch).eq('product_id', req.params.id);
    if (error) {
      if (error.code === '23505') throw ApiError.conflict('That SKU is already in use');
      throw new ApiError(500, error.message);
    }
  }

  // Thresholds live on inventory. current_stock is deliberately NOT editable here -
  // stock only changes through a recorded movement, which is what makes shrinkage traceable.
  const invPatch = {};
  if (b.minimumStock !== undefined) invPatch.minimum_stock = b.minimumStock;
  if (b.reorderPoint !== undefined) invPatch.reorder_point = b.reorderPoint;
  if (b.location     !== undefined) invPatch.location      = b.location;
  if (Object.keys(invPatch).length) {
    invPatch.updated_by = req.user.id;
    invPatch.last_updated = new Date().toISOString();
    const { error: invError } = await supabaseAdmin.from('inventory').update(invPatch).eq('product_id', req.params.id);
    if (invError) throw new ApiError(500, invError.message);
  }

  await refreshAlertsForProduct(Number(req.params.id));
  invalidateDashboardCache();
  await logActivity(req.user.id, 'PRODUCT_UPDATED', 'products', req.params.id, { ...productPatch, ...invPatch });

  const { data: full } = await supabaseAdmin
    .from('products').select(SELECT).eq('product_id', req.params.id).single();
  if (!full) throw ApiError.notFound('Product not found');
  ok(res, decorate(full));
});

/**
 * DELETE /api/products/:id
 * A product with stock movement history is ARCHIVED (status = discontinued)
 * instead of deleted: deleting it would cascade-delete its movement ledger and
 * erase the shrinkage history this system exists to keep.
 */
export const deleteProduct = asyncHandler(async (req, res) => {
  const { data: existing } = await supabaseAdmin
    .from('products').select('product_id, product_name, status').eq('product_id', req.params.id).maybeSingle();
  if (!existing) throw ApiError.notFound('Product not found');

  const { count: movementCount, error: countError } = await supabaseAdmin
    .from('stock_movements').select('movement_id', { count: 'exact', head: true })
    .eq('product_id', req.params.id);
  if (countError) throw new ApiError(500, countError.message);

  if ((movementCount ?? 0) > 0) {
    const { error } = await supabaseAdmin
      .from('products').update({ status: 'discontinued' }).eq('product_id', req.params.id);
    if (error) throw new ApiError(500, error.message);
    invalidateDashboardCache();
    await logActivity(req.user.id, 'PRODUCT_ARCHIVED', 'products', req.params.id, {
      name: existing.product_name, movementCount,
    });
    return ok(res, {
      archived: true,
      productId: existing.product_id,
      message: `"${existing.product_name}" has ${movementCount} stock movement(s), so it was archived (discontinued) instead of deleted to keep its audit history.`,
    });
  }

  const { error } = await supabaseAdmin.from('products').delete().eq('product_id', req.params.id);
  if (error) throw new ApiError(500, error.message);
  invalidateDashboardCache();
  await logActivity(req.user.id, 'PRODUCT_DELETED', 'products', req.params.id, { name: existing.product_name });
  noContent(res);
});
