import { z } from 'zod';
import { supabaseAdmin } from '../config/supabase.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ok, created, noContent } from '../utils/respond.js';
import { logActivity } from '../services/activityLog.service.js';

/* ------------------------------------------------------------------ CATEGORIES */

export const categorySchema = z.object({
  categoryName: z.string().min(2),
  description: z.string().optional().nullable(),
});

export const listCategories = asyncHandler(async (_req, res) => {
  const { data, error } = await supabaseAdmin
    .from('categories').select('category_id, category_name, description, products(count)')
    .order('category_name');
  if (error) throw ApiError.fromDb(error);
  ok(res, data.map((c) => ({ ...c, productCount: c.products?.[0]?.count ?? 0 })));
});

export const createCategory = asyncHandler(async (req, res) => {
  const { data, error } = await supabaseAdmin.from('categories')
    .insert({ category_name: req.body.categoryName, description: req.body.description ?? null })
    .select().single();
  if (error) {
    if (error.code === '23505') throw ApiError.conflict('That category already exists');
    throw ApiError.fromDb(error);
  }
  await logActivity(req.user.id, 'CATEGORY_CREATED', 'categories', data.category_id, { name: data.category_name });
  created(res, data);
});

export const updateCategory = asyncHandler(async (req, res) => {
  const patch = {};
  if (req.body.categoryName !== undefined) patch.category_name = req.body.categoryName;
  if (req.body.description  !== undefined) patch.description   = req.body.description;

  const { data, error } = await supabaseAdmin
    .from('categories').update(patch).eq('category_id', req.params.id).select().maybeSingle();
  if (error) throw ApiError.fromDb(error);
  if (!data) throw ApiError.notFound('Category not found');
  await logActivity(req.user.id, 'CATEGORY_UPDATED', 'categories', req.params.id, patch);
  ok(res, data);
});

export const deleteCategory = asyncHandler(async (req, res) => {
  const { data: existing, error: findError } = await supabaseAdmin
    .from('categories').select('category_id').eq('category_id', req.params.id).maybeSingle();
  if (findError) throw ApiError.fromDb(findError);
  if (!existing) throw ApiError.notFound('Category not found');

  const { error } = await supabaseAdmin.from('categories').delete().eq('category_id', req.params.id);
  if (error) throw ApiError.fromDb(error);
  await logActivity(req.user.id, 'CATEGORY_DELETED', 'categories', req.params.id);
  noContent(res);
});

/* ------------------------------------------------------------------- SUPPLIERS */

export const supplierSchema = z.object({
  supplierName: z.string().trim().min(2, 'Supplier name must be at least 2 characters'),
  contactPerson: z.string().optional().nullable(),
  contactNumber: z.string().optional().nullable(),
  email: z.string().email().optional().nullable().or(z.literal('')),
  address: z.string().optional().nullable(),
  isActive: z.boolean().default(true),
});

/** Escapes LIKE wildcards so a name is matched literally. */
const likeLiteral = (v) => String(v).replace(/[\\%_]/g, (c) => `\\${c}`);

/** 409 when another supplier already uses this name (case and outer spaces ignored). */
const assertSupplierNameFree = async (name, exceptId = null) => {
  const clean = String(name).trim().replace(/\s+/g, ' ');
  let q = supabaseAdmin.from('suppliers').select('supplier_id, supplier_name').ilike('supplier_name', likeLiteral(clean));
  if (exceptId !== null) q = q.neq('supplier_id', exceptId);
  const { data, error } = await q.limit(1);
  if (error) throw ApiError.fromDb(error);
  if (data?.length) throw ApiError.conflict(`A supplier named "${data[0].supplier_name}" already exists.`);
};

const supplierDbError = (error) => (error?.code === '23505'
  ? ApiError.conflict('A supplier with this name already exists.')
  : ApiError.fromDb(error));

export const listSuppliers = asyncHandler(async (req, res) => {
  let q = supabaseAdmin.from('suppliers')
    .select('supplier_id, supplier_name, contact_person, contact_number, email, address, is_active, products(count)')
    .order('supplier_name');
  if (req.query.active === 'true')  q = q.eq('is_active', true);
  if (req.query.active === 'false') q = q.eq('is_active', false);
  if (req.query.search) q = q.ilike('supplier_name', `%${likeLiteral(String(req.query.search).trim())}%`);

  const { data, error } = await q;
  if (error) throw ApiError.fromDb(error);
  ok(res, data.map((s) => ({ ...s, productCount: s.products?.[0]?.count ?? 0 })));
});

export const getSupplier = asyncHandler(async (req, res) => {
  const { data, error } = await supabaseAdmin.from('suppliers')
    .select('*, products ( product_id, product_name, sku, unit_price, inventory ( current_stock ) )')
    .eq('supplier_id', req.params.id).single();
  if (error || !data) throw ApiError.notFound('Supplier not found');
  ok(res, data);
});

export const createSupplier = asyncHandler(async (req, res) => {
  const b = req.body;
  await assertSupplierNameFree(b.supplierName);
  const { data, error } = await supabaseAdmin.from('suppliers').insert({
    supplier_name: b.supplierName,
    contact_person: b.contactPerson ?? null,
    contact_number: b.contactNumber ?? null,
    email: b.email || null,
    address: b.address ?? null,
    is_active: b.isActive,
  }).select().single();
  if (error) throw supplierDbError(error);
  await logActivity(req.user.id, 'SUPPLIER_CREATED', 'suppliers', data.supplier_id, { name: data.supplier_name });
  created(res, data);
});

export const updateSupplier = asyncHandler(async (req, res) => {
  const b = req.body;
  const patch = {};
  if (b.supplierName  !== undefined) patch.supplier_name  = b.supplierName;
  if (b.contactPerson !== undefined) patch.contact_person = b.contactPerson;
  if (b.contactNumber !== undefined) patch.contact_number = b.contactNumber;
  if (b.email         !== undefined) patch.email          = b.email || null;
  if (b.address       !== undefined) patch.address        = b.address;
  if (b.isActive      !== undefined) patch.is_active      = b.isActive;
  if (patch.supplier_name !== undefined) await assertSupplierNameFree(patch.supplier_name, Number(req.params.id));

  const { data, error } = await supabaseAdmin
    .from('suppliers').update(patch).eq('supplier_id', req.params.id).select().maybeSingle();
  if (error) throw supplierDbError(error);
  if (!data) throw ApiError.notFound('Supplier not found');
  await logActivity(req.user.id, 'SUPPLIER_UPDATED', 'suppliers', req.params.id, patch);
  ok(res, data);
});

export const deleteSupplier = asyncHandler(async (req, res) => {
  const { data: existing, error: findError } = await supabaseAdmin
    .from('suppliers').select('supplier_id').eq('supplier_id', req.params.id).maybeSingle();
  if (findError) throw ApiError.fromDb(findError);
  if (!existing) throw ApiError.notFound('Supplier not found');

  const { error } = await supabaseAdmin.from('suppliers').delete().eq('supplier_id', req.params.id);
  if (error) throw ApiError.fromDb(error);
  await logActivity(req.user.id, 'SUPPLIER_DELETED', 'suppliers', req.params.id);
  noContent(res);
});
