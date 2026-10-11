import { supabaseAdmin } from '../config/supabase.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ok, paginated } from '../utils/respond.js';
import { logActivity } from '../services/activityLog.service.js';
import { applyDateRange } from '../utils/query.js';
import { stockStatus } from '../utils/stock.js';

const statusOf = stockStatus;

/** Logs report generation once per request for page 1 only, so paging does not flood the audit trail. */
const logReport = async (req, details) => {
  if (Number(req.query.page || 1) > 1) return;
  await logActivity(req.user.id, 'generate_report', 'reports', null, details);
};

const paginateArray = (res, rows, page, limit, extra = {}) => {
  if (page || limit) {
    const pageNum = Math.max(1, Number(page) || 1);
    const limitNum = Math.max(1, Math.min(Number(limit) || 25, 100));
    const offset = (pageNum - 1) * limitNum;
    const paged = rows.slice(offset, offset + limitNum);
    return paginated(res, paged, { page: pageNum, limit: limitNum, total: rows.length, ...extra });
  }
  return ok(res, rows, { total: rows.length, ...extra });
};

/**
 * GET /api/reports/inventory-summary
 * Comprehensive inventory status report with financial valuation and threshold states.
 */
export const getInventorySummaryReport = asyncHandler(async (req, res) => {
  const { categoryId, supplierId, status, stockStatus, search, page, limit } = req.query;

  const { data, error } = await supabaseAdmin
    .from('inventory')
    .select(`
      inventory_id, current_stock, minimum_stock, reorder_point, location, last_updated,
      product:products (
        product_id, product_name, sku, unit_price, unit_of_measure, status, expiration_date,
        category:categories ( category_id, category_name ),
        supplier:suppliers ( supplier_id, supplier_name )
      ),
      updated_by_user:users!inventory_updated_by_fkey ( full_name )
    `)
    .order('inventory_id');

  if (error) throw new ApiError(500, error.message);

  let rows = (data || [])
    .filter((r) => r.product)
    .map((r) => {
      const derivedStatus = statusOf(r.current_stock, r.minimum_stock, r.reorder_point);
      const unitPrice = Number(r.product.unit_price || 0);
      const totalValue = Number((r.current_stock * unitPrice).toFixed(2));
      return {
        inventoryId: r.inventory_id,
        productId: r.product.product_id,
        productName: r.product.product_name,
        sku: r.product.sku,
        category: r.product.category?.category_name || 'Unassigned',
        categoryId: r.product.category?.category_id || null,
        supplier: r.product.supplier?.supplier_name || 'Unassigned',
        supplierId: r.product.supplier?.supplier_id || null,
        currentStock: r.current_stock,
        minimumStock: r.minimum_stock,
        reorderPoint: r.reorder_point,
        unitPrice,
        totalValue,
        unitOfMeasure: r.product.unit_of_measure,
        status: r.product.status,
        stockStatus: derivedStatus,
        location: r.location,
        lastUpdated: r.last_updated,
        updatedBy: r.updated_by_user?.full_name || null,
      };
    });

  if (categoryId) rows = rows.filter((r) => r.categoryId === Number(categoryId));
  if (supplierId) rows = rows.filter((r) => r.supplierId === Number(supplierId));
  if (status)     rows = rows.filter((r) => r.status === status);
  if (stockStatus) rows = rows.filter((r) => r.stockStatus === stockStatus);
  if (search) {
    const s = String(search).toLowerCase();
    rows = rows.filter((r) =>
      r.productName.toLowerCase().includes(s) ||
      r.sku.toLowerCase().includes(s) ||
      r.category.toLowerCase().includes(s) ||
      r.supplier.toLowerCase().includes(s)
    );
  }

  const summary = {
    totalProducts: rows.length,
    totalUnits: rows.reduce((acc, r) => acc + r.currentStock, 0),
    totalValuation: Number(rows.reduce((acc, r) => acc + r.totalValue, 0).toFixed(2)),
    inStockCount: rows.filter((r) => r.stockStatus === 'in_stock').length,
    lowStockCount: rows.filter((r) => r.stockStatus === 'low_stock').length,
    outOfStockCount: rows.filter((r) => r.stockStatus === 'out_of_stock').length,
    reorderCount: rows.filter((r) => r.stockStatus === 'reorder').length,
  };

  await logReport(req, { report: 'inventory_summary' });
  return paginateArray(res, rows, page, limit, { summary });
});

/**
 * GET /api/reports/stock-movements
 * Historical audit report of all stock movements with date, type, user, and product filters.
 */
export const getStockMovementsReport = asyncHandler(async (req, res) => {
  const { from, to, type, productId, userId, search, page, limit } = req.query;

  let q = supabaseAdmin
    .from('stock_movements')
    .select(`
      movement_id, movement_type, quantity, reason, reference_no, date_recorded,
      product:products (
        product_id, product_name, sku, unit_price,
        category:categories ( category_id, category_name )
      ),
      recorded_by_user:users!stock_movements_recorded_by_fkey ( user_id, full_name, username )
    `)
    .order('date_recorded', { ascending: false });

  q = applyDateRange(q, 'date_recorded', from, to);
  if (type) q = q.eq('movement_type', type);
  if (productId) q = q.eq('product_id', Number(productId));
  if (userId)    q = q.eq('recorded_by', userId);

  const { data, error } = await q;
  if (error) throw new ApiError(500, error.message);

  let rows = (data || []).map((m) => {
    const unitPrice = Number(m.product?.unit_price || 0);
    const absQty = Math.abs(m.quantity);
    const totalImpact = Number((absQty * unitPrice).toFixed(2));
    return {
      movementId: m.movement_id,
      productId: m.product?.product_id || null,
      productName: m.product?.product_name || 'Deleted Product',
      sku: m.product?.sku || 'N/A',
      category: m.product?.category?.category_name || 'Unassigned',
      movementType: m.movement_type,
      quantity: m.quantity,
      unitPrice,
      totalImpact,
      reason: m.reason,
      referenceNo: m.reference_no,
      dateRecorded: m.date_recorded,
      recordedBy: m.recorded_by_user?.full_name || m.recorded_by_user?.username || 'System',
      userId: m.recorded_by_user?.user_id || null,
    };
  });

  if (search) {
    const s = String(search).toLowerCase();
    rows = rows.filter((r) =>
      r.productName.toLowerCase().includes(s) ||
      r.sku.toLowerCase().includes(s) ||
      (r.reason && r.reason.toLowerCase().includes(s)) ||
      (r.referenceNo && r.referenceNo.toLowerCase().includes(s))
    );
  }

  const summary = {
    totalMovements: rows.length,
    stockInUnits: rows.filter((r) => r.movementType === 'stock_in').reduce((s, r) => s + r.quantity, 0),
    stockOutUnits: rows.filter((r) => r.movementType === 'stock_out').reduce((s, r) => s + r.quantity, 0),
    damagedUnits: rows.filter((r) => r.movementType === 'damaged').reduce((s, r) => s + r.quantity, 0),
    missingUnits: rows.filter((r) => r.movementType === 'missing').reduce((s, r) => s + r.quantity, 0),
    returnedUnits: rows.filter((r) => r.movementType === 'returned').reduce((s, r) => s + r.quantity, 0),
  };

  await logReport(req, { report: 'stock_movements' });
  return paginateArray(res, rows, page, limit, { summary });
});

/**
 * GET /api/reports/shrinkage
 * Inventory shrinkage report tracking lost, damaged, and missing items with true financial loss.
 */
export const getShrinkageReport = asyncHandler(async (req, res) => {
  const { from, to, productId, categoryId, page, limit } = req.query;

  let q = supabaseAdmin
    .from('stock_movements')
    .select(`
      movement_id, movement_type, quantity, reason, reference_no, date_recorded,
      product:products (
        product_id, product_name, sku, unit_price,
        category:categories ( category_id, category_name )
      ),
      recorded_by_user:users!stock_movements_recorded_by_fkey ( user_id, full_name )
    `)
    .in('movement_type', ['damaged', 'missing'])
    .order('date_recorded', { ascending: false });

  q = applyDateRange(q, 'date_recorded', from, to);
  if (productId) q = q.eq('product_id', Number(productId));

  const { data, error } = await q;
  if (error) throw new ApiError(500, error.message);

  let rows = (data || []).map((m) => {
    const qty = Math.abs(m.quantity);
    const unitPrice = Number(m.product?.unit_price || 0);
    const shrinkageValue = Number((qty * unitPrice).toFixed(2));
    return {
      movementId: m.movement_id,
      productId: m.product?.product_id || null,
      productName: m.product?.product_name || 'Unknown',
      sku: m.product?.sku || 'N/A',
      categoryId: m.product?.category?.category_id || null,
      category: m.product?.category?.category_name || 'Unassigned',
      movementType: m.movement_type,
      quantity: qty,
      unitPrice,
      shrinkageValue,
      reason: m.reason || 'Not specified',
      referenceNo: m.reference_no,
      dateRecorded: m.date_recorded,
      recordedBy: m.recorded_by_user?.full_name || 'System',
    };
  });

  if (categoryId) rows = rows.filter((r) => r.categoryId === Number(categoryId));

  const damagedRows = rows.filter((r) => r.movementType === 'damaged');
  const missingRows = rows.filter((r) => r.movementType === 'missing');

  const summary = {
    totalShrinkageEvents: rows.length,
    totalShrinkageUnits: rows.reduce((s, r) => s + r.quantity, 0),
    totalShrinkageValue: Number(rows.reduce((s, r) => s + r.shrinkageValue, 0).toFixed(2)),
    breakdown: {
      damaged: {
        events: damagedRows.length,
        units: damagedRows.reduce((s, r) => s + r.quantity, 0),
        value: Number(damagedRows.reduce((s, r) => s + r.shrinkageValue, 0).toFixed(2)),
      },
      missing: {
        events: missingRows.length,
        units: missingRows.reduce((s, r) => s + r.quantity, 0),
        value: Number(missingRows.reduce((s, r) => s + r.shrinkageValue, 0).toFixed(2)),
      },
    },
  };

  await logReport(req, { report: 'shrinkage' });
  return paginateArray(res, rows, page, limit, { summary });
});

/**
 * GET /api/reports/low-stock
 * Actionable report of items at or below minimum threshold.
 */
export const getLowStockReport = asyncHandler(async (req, res) => {
  const { categoryId, supplierId, search, page, limit } = req.query;

  const { data, error } = await supabaseAdmin
    .from('inventory')
    .select(`
      inventory_id, current_stock, minimum_stock, reorder_point, location, last_updated,
      product:products (
        product_id, product_name, sku, unit_price, status,
        category:categories ( category_id, category_name ),
        supplier:suppliers ( supplier_id, supplier_name, contact_person, email, contact_number )
      )
    `)
    .order('current_stock', { ascending: true });

  if (error) throw new ApiError(500, error.message);

  let rows = (data || [])
    .filter((r) => r.product && r.current_stock > 0 && r.current_stock <= r.minimum_stock)
    .map((r) => ({
      inventoryId: r.inventory_id,
      productId: r.product.product_id,
      productName: r.product.product_name,
      sku: r.product.sku,
      category: r.product.category?.category_name || 'Unassigned',
      categoryId: r.product.category?.category_id || null,
      supplier: r.product.supplier?.supplier_name || 'Unassigned',
      supplierId: r.product.supplier?.supplier_id || null,
      supplierContact: r.product.supplier?.contact_person || null,
      supplierEmail: r.product.supplier?.email || null,
      currentStock: r.current_stock,
      minimumStock: r.minimum_stock,
      reorderPoint: r.reorder_point,
      deficit: Math.max(0, r.minimum_stock - r.current_stock),
      unitPrice: Number(r.product.unit_price || 0),
      location: r.location,
      lastUpdated: r.last_updated,
    }));

  if (categoryId) rows = rows.filter((r) => r.categoryId === Number(categoryId));
  if (supplierId) rows = rows.filter((r) => r.supplierId === Number(supplierId));
  if (search) {
    const s = String(search).toLowerCase();
    rows = rows.filter((r) => r.productName.toLowerCase().includes(s) || r.sku.toLowerCase().includes(s));
  }

  const summary = {
    totalLowStockItems: rows.length,
    totalDeficitUnits: rows.reduce((s, r) => s + r.deficit, 0),
  };

  await logReport(req, { report: 'low_stock' });
  return paginateArray(res, rows, page, limit, { summary });
});

/**
 * GET /api/reports/out-of-stock
 * Actionable critical report of items with zero stock.
 */
export const getOutOfStockReport = asyncHandler(async (req, res) => {
  const { categoryId, supplierId, search, page, limit } = req.query;

  const { data, error } = await supabaseAdmin
    .from('inventory')
    .select(`
      inventory_id, current_stock, minimum_stock, reorder_point, location, last_updated,
      product:products (
        product_id, product_name, sku, unit_price, status,
        category:categories ( category_id, category_name ),
        supplier:suppliers ( supplier_id, supplier_name, contact_person, email, contact_number )
      )
    `)
    .eq('current_stock', 0);

  if (error) throw new ApiError(500, error.message);

  let rows = (data || [])
    .filter((r) => r.product)
    .map((r) => ({
      inventoryId: r.inventory_id,
      productId: r.product.product_id,
      productName: r.product.product_name,
      sku: r.product.sku,
      category: r.product.category?.category_name || 'Unassigned',
      categoryId: r.product.category?.category_id || null,
      supplier: r.product.supplier?.supplier_name || 'Unassigned',
      supplierId: r.product.supplier?.supplier_id || null,
      supplierContact: r.product.supplier?.contact_person || null,
      supplierEmail: r.product.supplier?.email || null,
      currentStock: 0,
      minimumStock: r.minimum_stock,
      reorderPoint: r.reorder_point,
      requiredReplenishment: r.reorder_point > 0 ? r.reorder_point : r.minimum_stock,
      unitPrice: Number(r.product.unit_price || 0),
      location: r.location,
      lastUpdated: r.last_updated,
    }));

  if (categoryId) rows = rows.filter((r) => r.categoryId === Number(categoryId));
  if (supplierId) rows = rows.filter((r) => r.supplierId === Number(supplierId));
  if (search) {
    const s = String(search).toLowerCase();
    rows = rows.filter((r) => r.productName.toLowerCase().includes(s) || r.sku.toLowerCase().includes(s));
  }

  const summary = {
    totalOutOfStockItems: rows.length,
    estimatedCostToReplenish: Number(
      rows.reduce((s, r) => s + r.requiredReplenishment * r.unitPrice, 0).toFixed(2)
    ),
  };

  await logReport(req, { report: 'out_of_stock' });
  return paginateArray(res, rows, page, limit, { summary });
});

/**
 * GET /api/reports/reorder
 * Procurement forecast report identifying items requiring restocking.
 */
export const getReorderReport = asyncHandler(async (req, res) => {
  const { categoryId, supplierId, search, page, limit } = req.query;

  const { data, error } = await supabaseAdmin
    .from('inventory')
    .select(`
      inventory_id, current_stock, minimum_stock, reorder_point, location,
      product:products (
        product_id, product_name, sku, unit_price,
        category:categories ( category_id, category_name ),
        supplier:suppliers ( supplier_id, supplier_name, contact_person, email )
      )
    `)
    .order('current_stock', { ascending: true });

  if (error) throw new ApiError(500, error.message);

  let rows = (data || [])
    .filter((r) => r.product && r.current_stock <= r.reorder_point)
    .map((r) => {
      const unitPrice = Number(r.product.unit_price || 0);
      // Recommended quantity brings stock to 2x reorder point or at least minimum stock cushion
      const targetStock = Math.max(r.reorder_point * 2, r.minimum_stock * 2, 10);
      const recommendedOrder = Math.max(1, targetStock - r.current_stock);
      const estimatedCost = Number((recommendedOrder * unitPrice).toFixed(2));

      return {
        inventoryId: r.inventory_id,
        productId: r.product.product_id,
        productName: r.product.product_name,
        sku: r.product.sku,
        category: r.product.category?.category_name || 'Unassigned',
        categoryId: r.product.category?.category_id || null,
        supplier: r.product.supplier?.supplier_name || 'Unassigned',
        supplierId: r.product.supplier?.supplier_id || null,
        supplierContact: r.product.supplier?.contact_person || null,
        supplierEmail: r.product.supplier?.email || null,
        currentStock: r.current_stock,
        reorderPoint: r.reorder_point,
        recommendedOrderQty: recommendedOrder,
        unitPrice,
        estimatedCost,
      };
    });

  if (categoryId) rows = rows.filter((r) => r.categoryId === Number(categoryId));
  if (supplierId) rows = rows.filter((r) => r.supplierId === Number(supplierId));
  if (search) {
    const s = String(search).toLowerCase();
    rows = rows.filter((r) => r.productName.toLowerCase().includes(s) || r.sku.toLowerCase().includes(s));
  }

  const summary = {
    totalItemsNeedingReorder: rows.length,
    totalRecommendedUnits: rows.reduce((s, r) => s + r.recommendedOrderQty, 0),
    totalEstimatedProcurementCost: Number(
      rows.reduce((s, r) => s + r.estimatedCost, 0).toFixed(2)
    ),
  };

  await logReport(req, { report: 'reorder' });
  return paginateArray(res, rows, page, limit, { summary });
});

/**
 * GET /api/reports/suppliers
 * Aggregated inventory summary grouped by supplier directory.
 */
export const getSupplierSummaryReport = asyncHandler(async (req, res) => {
  const { search, page, limit } = req.query;

  const { data: suppliers, error } = await supabaseAdmin
    .from('suppliers')
    .select(`
      supplier_id, supplier_name, contact_person, contact_number, email, is_active,
      products (
        product_id, product_name, sku, unit_price,
        inventory ( current_stock, minimum_stock, reorder_point )
      )
    `)
    .order('supplier_name');

  if (error) throw new ApiError(500, error.message);

  let rows = (suppliers || []).map((s) => {
    const prods = s.products || [];
    let totalUnits = 0;
    let totalValuation = 0;
    let lowStockCount = 0;
    let outOfStockCount = 0;

    for (const p of prods) {
      const inv = Array.isArray(p.inventory) ? p.inventory[0] : p.inventory;
      if (inv) {
        totalUnits += inv.current_stock;
        totalValuation += inv.current_stock * Number(p.unit_price || 0);
        if (inv.current_stock === 0) outOfStockCount += 1;
        else if (inv.current_stock <= inv.minimum_stock) lowStockCount += 1;
      }
    }

    return {
      supplierId: s.supplier_id,
      supplierName: s.supplier_name,
      contactPerson: s.contact_person,
      contactNumber: s.contact_number,
      email: s.email,
      isActive: s.is_active,
      productCount: prods.length,
      totalUnitsOnHand: totalUnits,
      totalValuation: Number(totalValuation.toFixed(2)),
      lowStockItemsCount: lowStockCount,
      outOfStockItemsCount: outOfStockCount,
    };
  });

  if (search) {
    const term = String(search).toLowerCase();
    rows = rows.filter((r) =>
      r.supplierName.toLowerCase().includes(term) ||
      (r.contactPerson && r.contactPerson.toLowerCase().includes(term))
    );
  }

  const summary = {
    totalSuppliers: rows.length,
    activeSuppliers: rows.filter((r) => r.isActive).length,
    totalPortfolioValuation: Number(
      rows.reduce((s, r) => s + r.totalValuation, 0).toFixed(2)
    ),
  };

  await logReport(req, { report: 'suppliers' });
  return paginateArray(res, rows, page, limit, { summary });
});
