import { ApiError } from './ApiError.js';

/**
 * Single source of truth for a product's stock status. It mirrors the alert
 * rules in supabase/05_fixes.sql:
 *   out_of_stock : stock = 0
 *   low_stock    : 0 < stock <= minimum_stock
 *   reorder      : minimum_stock < stock <= reorder_point
 *   in_stock     : stock > reorder_point
 */
export const stockStatus = (currentStock, minimumStock, reorderPoint) => {
  const stock = Number(currentStock) || 0;
  if (stock <= 0) return 'out_of_stock';
  if (stock <= Number(minimumStock || 0)) return 'low_stock';
  if (stock <= Number(reorderPoint || 0)) return 'reorder';
  return 'in_stock';
};

/** Row helper for inventory rows shaped { current_stock, minimum_stock, reorder_point }. */
export const statusOfRow = (r) => stockStatus(r?.current_stock, r?.minimum_stock, r?.reorder_point);

/**
 * The reorder point is the early warning and must sit at or above the minimum
 * stock level, otherwise "reorder" could never fire before "low stock".
 */
export const assertThresholds = (minimumStock, reorderPoint) => {
  if (minimumStock === undefined || reorderPoint === undefined) return;
  if (Number(reorderPoint) < Number(minimumStock)) {
    throw ApiError.badRequest('Reorder point must be greater than or equal to the minimum stock level', [
      { field: 'reorderPoint', message: 'Must be greater than or equal to minimum stock' },
    ]);
  }
};
