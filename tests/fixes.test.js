import test from 'node:test';
import assert from 'node:assert/strict';
import { supabaseAdmin } from '../src/config/supabase.js';
import { safeSearchTerm, applyDateRange, pageParams } from '../src/utils/query.js';
import { stockStatus, assertThresholds } from '../src/utils/stock.js';
import { paginated } from '../src/utils/respond.js';
import { userCan } from '../src/middleware/authorize.js';
import { listUsers, getUser } from '../src/controllers/users.controller.js';
import { getRoleUsers, listRoles } from '../src/controllers/roles.controller.js';

/* ------------------------------------------------------------ test doubles */
const fakeRes = () => {
  const res = { statusCode: 200, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  res.send = () => res;
  return res;
};

/** Minimal thenable stand-in for a Supabase query builder. */
const fakeQuery = (result, calls = []) => {
  const q = {};
  for (const m of ['select', 'eq', 'neq', 'in', 'or', 'order', 'gte', 'lte', 'lt', 'limit', 'range', 'ilike']) {
    q[m] = (...args) => { calls.push([m, ...args]); return q; };
  }
  q.single = () => Promise.resolve(result);
  q.maybeSingle = () => Promise.resolve(result);
  q.then = (ok, fail) => Promise.resolve(result).then(ok, fail);
  return q;
};

const run = (handler, req) => new Promise((resolve) => {
  const res = fakeRes();
  handler(req, res, (err) => resolve({ res, err }));
  setTimeout(() => resolve({ res, err: null }), 20);
});

const USERS = [
  { user_id: 'u-super', full_name: 'Root', username: 'root', email: 'root@ims.local', is_active: true,
    role: { role_id: 1, role_code: 'super_admin', role_name: 'Super Admin' } },
  { user_id: 'u-staff', full_name: 'Staff Person', username: 'staff', email: 'staff@ims.local', is_active: true,
    contact_number: '0917', role: { role_id: 3, role_code: 'staff_admin', role_name: 'Staff Admin' } },
];

const staffAdmin = { id: 'u-staff', role: { role_code: 'staff_admin' }, permissions: ['users.view', 'users.manage'] };
const viewer = { id: 'u-view', role: { role_code: 'auditor' }, permissions: ['users.view'] };
const superAdmin = { id: 'u-super', role: { role_code: 'super_admin' }, permissions: [] };

/* ------------------------------------------------------------- data leaks */
test('Leak fix: non-super-admins never receive Super Admin accounts from GET /users', async (t) => {
  t.mock.method(supabaseAdmin, 'from', () => fakeQuery({ data: USERS, error: null }));
  const { res } = await run(listUsers, { query: {}, user: staffAdmin });
  assert.deepEqual(res.body.data.map((u) => u.username), ['staff']);
});

test('Leak fix: Super Admin still sees every account', async (t) => {
  t.mock.method(supabaseAdmin, 'from', () => fakeQuery({ data: USERS, error: null }));
  const { res } = await run(listUsers, { query: {}, user: superAdmin });
  assert.equal(res.body.data.length, 2);
});

test('Leak fix: GET /users/:id of a Super Admin returns 404 to non-super-admins', async (t) => {
  t.mock.method(supabaseAdmin, 'from', () => fakeQuery({ data: USERS[0], error: null }));
  const { err } = await run(getUser, { params: { id: 'u-super' }, user: staffAdmin });
  assert.equal(err?.status, 404);
});

test('Leak fix: view-only callers get masked email and no phone number', async (t) => {
  t.mock.method(supabaseAdmin, 'from', () => fakeQuery({ data: [USERS[1]], error: null }));
  const { res } = await run(listUsers, { query: {}, user: viewer });
  assert.equal(res.body.data[0].contactNumber, null);
  assert.match(res.body.data[0].email, /^st\*+@ims\.local$/);
});

test('Leak fix: search text cannot inject extra PostgREST filters', async (t) => {
  const calls = [];
  t.mock.method(supabaseAdmin, 'from', () => fakeQuery({ data: [], error: null }, calls));
  await run(listUsers, { query: { search: 'x,role_id.eq.1)' }, user: staffAdmin });
  const orCall = calls.find((c) => c[0] === 'or');
  assert.ok(orCall);
  assert.ok(!/role_id\.eq\.1\)/.test(orCall[1].replace(/ilike\.%[^%]*%/g, '')), orCall[1]);
  assert.equal(orCall[1].split(',').length, 3, 'exactly the three intended clauses');
});

test('Leak fix: users of the super_admin role cannot be listed by non-super-admins', async (t) => {
  t.mock.method(supabaseAdmin, 'from', () => fakeQuery({
    data: { role_id: 1, role_code: 'super_admin', role_name: 'Super Admin', description: null }, error: null }));
  const { err } = await run(getRoleUsers, { params: { id: 1 }, user: staffAdmin });
  assert.equal(err?.status, 404);
});

test('Leak fix: role catalogue hides super_admin from non-super-admins', async (t) => {
  t.mock.method(supabaseAdmin, 'from', (table) => fakeQuery(table === 'roles'
    ? { data: [{ role_id: 1, role_code: 'super_admin', role_name: 'Super Admin' }, { role_id: 2, role_code: 'warehouse_admin', role_name: 'Warehouse' }], error: null }
    : { data: [], error: null }));
  const { res } = await run(listRoles, { user: staffAdmin });
  assert.deepEqual(res.body.data.map((r) => r.roleCode), ['warehouse_admin']);
});

/* ----------------------------------------------------------------- RBAC */
test('RBAC: userCan honours module.manage and the Super Admin bypass', () => {
  assert.equal(userCan({ role: { role_code: 'x' }, permissions: ['inventory.manage'] }, 'inventory.view'), true);
  assert.equal(userCan({ role: { role_code: 'x' }, permissions: ['products.view'] }, 'inventory.view'), false);
  assert.equal(userCan(superAdmin, 'anything.at.all'), true);
});

/* --------------------------------------------------------- stock & alerts */
test('Stock status: low stock and reorder never overlap', () => {
  assert.equal(stockStatus(0, 5, 10), 'out_of_stock');
  assert.equal(stockStatus(5, 5, 10), 'low_stock');
  assert.equal(stockStatus(6, 5, 10), 'reorder');
  assert.equal(stockStatus(10, 5, 10), 'reorder');
  assert.equal(stockStatus(11, 5, 10), 'in_stock');
});

test('Thresholds: reorder point below minimum stock is rejected', () => {
  assert.throws(() => assertThresholds(10, 5), /Reorder point/);
  assert.doesNotThrow(() => assertThresholds(5, 10));
  assert.doesNotThrow(() => assertThresholds(5, 5));
});

/* ------------------------------------------------------------ query utils */
test('Query: date-only "to" includes the whole end day', () => {
  const calls = [];
  applyDateRange(fakeQuery({}, calls), 'date_recorded', '2026-10-01', '2026-10-12');
  assert.deepEqual(calls[0], ['gte', 'date_recorded', '2026-10-01T00:00:00.000Z']);
  assert.deepEqual(calls[1], ['lt', 'date_recorded', '2026-10-13T00:00:00.000Z']);
});

test('Query: invalid or reversed dates are rejected with 400', () => {
  assert.throws(() => applyDateRange(fakeQuery({}), 'c', 'not-a-date'), (e) => e.status === 400);
  assert.throws(() => applyDateRange(fakeQuery({}), 'c', '2026-10-12', '2026-10-01'), (e) => e.status === 400);
});

test('Query: safeSearchTerm strips filter syntax', () => {
  assert.equal(safeSearchTerm('a,b(c)"d'), 'a b c d');
  assert.equal(safeSearchTerm(undefined), '');
});

test('Query: pageParams clamps page and limit', () => {
  assert.equal(pageParams(undefined, undefined), null);
  assert.deepEqual(pageParams('2', '500', { max: 100 }), { page: 2, limit: 100, from: 100, to: 199 });
});

test('Reports: paginated responses keep the report summary', () => {
  const res = fakeRes();
  paginated(res, [1, 2], { page: 1, limit: 2, total: 5, summary: { totalUnits: 9 } });
  assert.equal(res.body.meta.summary.totalUnits, 9);
  assert.equal(res.body.pagination.totalPages, 3);
});
