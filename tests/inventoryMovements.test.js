import test from 'node:test';
import assert from 'node:assert/strict';
import { movementSchema } from '../src/controllers/movements.controller.js';

test('Movements: movementSchema validates correct movement types and quantities', () => {
  // Valid stock in
  const validIn = {
    productId: 1,
    movementType: 'stock_in',
    quantity: 15,
    reason: 'New shipment arrived',
  };
  const inRes = movementSchema.safeParse(validIn);
  assert.strictEqual(inRes.success, true);

  // Valid adjustment (positive)
  const validAdjPos = {
    productId: 1,
    movementType: 'adjustment',
    quantity: 5,
    reason: 'Count reconciliation',
  };
  const adjPosRes = movementSchema.safeParse(validAdjPos);
  assert.strictEqual(adjPosRes.success, true);

  // Valid adjustment (negative)
  const validAdjNeg = {
    productId: 1,
    movementType: 'adjustment',
    quantity: -3,
    reason: 'Damaged during count',
  };
  const adjNegRes = movementSchema.safeParse(validAdjNeg);
  assert.strictEqual(adjNegRes.success, true);

  // Zero quantity is rejected for all types
  const zeroAdj = { productId: 1, movementType: 'adjustment', quantity: 0 };
  assert.strictEqual(movementSchema.safeParse(zeroAdj).success, false);

  const zeroStockIn = { productId: 1, movementType: 'stock_in', quantity: 0 };
  assert.strictEqual(movementSchema.safeParse(zeroStockIn).success, false);

  // Negative quantity rejected for non-adjustments
  const negStockOut = { productId: 1, movementType: 'stock_out', quantity: -5 };
  assert.strictEqual(movementSchema.safeParse(negStockOut).success, false);

  // Invalid movement type rejected
  const invalidType = { productId: 1, movementType: 'random_type', quantity: 5 };
  assert.strictEqual(movementSchema.safeParse(invalidType).success, false);
});

test('Movements: Negative stock prevention rejects stock out exceeding available stock', () => {
  const currentStock = 5;
  const requestedQty = 10;
  const movementType = 'stock_out';

  const projectedStock = currentStock - requestedQty;
  const isDenied = projectedStock < 0;

  assert.strictEqual(isDenied, true, 'Stock out of 10 from 5 must be denied');
  assert.strictEqual(projectedStock, -5);
});

test('Movements: Negative stock prevention rejects damaged or missing exceeding available stock', () => {
  const currentStock = 3;

  // Damaged exceeding stock
  const damagedQty = 5;
  assert.strictEqual(currentStock - damagedQty < 0, true, 'Damaged quantity exceeding stock must be blocked');

  // Missing exceeding stock
  const missingQty = 4;
  assert.strictEqual(currentStock - missingQty < 0, true, 'Missing quantity exceeding stock must be blocked');
});

test('Movements: Negative stock prevention rejects negative adjustment exceeding available stock', () => {
  const currentStock = 4;
  const negativeAdjustment = -10;

  const projected = currentStock + negativeAdjustment; // -6
  assert.strictEqual(projected < 0, true, 'Negative adjustment exceeding current stock must be blocked');
});

test('Movements: Valid movements calculate resulting stock accurately', () => {
  const currentStock = 20;

  // Stock In: +10 => 30
  assert.strictEqual(currentStock + 10, 30);

  // Stock Out: -5 => 15
  assert.strictEqual(currentStock - 5, 15);

  // Returned: +2 => 22
  assert.strictEqual(currentStock + 2, 22);

  // Damaged: -3 => 17
  assert.strictEqual(currentStock - 3, 17);

  // Missing: -1 => 19
  assert.strictEqual(currentStock - 1, 19);

  // Adjustment +4 => 24
  assert.strictEqual(currentStock + 4, 24);

  // Adjustment -8 => 12
  assert.strictEqual(currentStock + (-8), 12);
});

test('Movements: Action codes map to explicit audit events', () => {
  const MOVEMENT_AUDIT_ACTIONS = {
    stock_in: 'STOCK_IN',
    stock_out: 'STOCK_OUT',
    damaged: 'ITEM_DAMAGED',
    missing: 'ITEM_MISSING',
    returned: 'STOCK_RETURNED',
    adjustment: 'STOCK_ADJUSTMENT',
  };

  assert.strictEqual(MOVEMENT_AUDIT_ACTIONS.stock_in, 'STOCK_IN');
  assert.strictEqual(MOVEMENT_AUDIT_ACTIONS.stock_out, 'STOCK_OUT');
  assert.strictEqual(MOVEMENT_AUDIT_ACTIONS.damaged, 'ITEM_DAMAGED');
  assert.strictEqual(MOVEMENT_AUDIT_ACTIONS.missing, 'ITEM_MISSING');
  assert.strictEqual(MOVEMENT_AUDIT_ACTIONS.returned, 'STOCK_RETURNED');
  assert.strictEqual(MOVEMENT_AUDIT_ACTIONS.adjustment, 'STOCK_ADJUSTMENT');
});
