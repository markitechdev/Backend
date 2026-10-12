import { ApiError } from './ApiError.js';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Makes a user-supplied search term safe to embed inside a PostgREST
 * `.or()` filter string. Without this, characters such as `,` `(` `)` let a
 * caller append their own filter clauses (e.g. `x,role_id.eq.1`).
 */
export const safeSearchTerm = (value, max = 100) => String(value ?? '')
  .replace(/[,()"'\\%*:]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, max);

const parseBoundary = (value, label) => {
  if (value === undefined || value === null || value === '') return null;
  const str = String(value);
  const d = new Date(DATE_ONLY.test(str) ? `${str}T00:00:00.000Z` : str);
  if (Number.isNaN(d.getTime())) throw ApiError.badRequest(`"${label}" must be a valid date`);
  return { str, date: d, dateOnly: DATE_ONLY.test(str) };
};

/**
 * Applies an inclusive from/to date range to a Supabase query.
 * A date-only `to` (YYYY-MM-DD) covers the whole day instead of stopping at
 * midnight, which previously dropped every record made on the end date.
 */
export const applyDateRange = (q, column, from, to) => {
  const f = parseBoundary(from, 'from');
  const t = parseBoundary(to, 'to');
  if (f && t && f.date > t.date) throw ApiError.badRequest('"from" must be on or before "to"');
  let query = q;
  if (f) query = query.gte(column, f.date.toISOString());
  if (t) {
    if (t.dateOnly) {
      const next = new Date(t.date.getTime() + 864e5);
      query = query.lt(column, next.toISOString());
    } else {
      query = query.lte(column, t.date.toISOString());
    }
  }
  return query;
};

/** Normalises page/limit query params. Returns null when no pagination was requested. */
export const pageParams = (page, limit, { max = 100, fallback = 25 } = {}) => {
  if (!page && !limit) return null;
  const pageNum = Math.max(1, Number.parseInt(page, 10) || 1);
  const limitNum = Math.max(1, Math.min(Number.parseInt(limit, 10) || fallback, max));
  return { page: pageNum, limit: limitNum, from: (pageNum - 1) * limitNum, to: pageNum * limitNum - 1 };
};

/**
 * Reads every row of a query in pages of 1,000 (Supabase's default response
 * cap), so totals and summaries are not silently truncated.
 * `build` must return a fresh, fully-filtered query each time it is called and
 * should include a stable order (e.g. by primary key).
 */
export const fetchAllRows = async (build, { pageSize = 1000, maxRows = 50000 } = {}) => {
  const rows = [];
  for (let from = 0; from < maxRows; from += pageSize) {
    const { data, error } = await build().range(from, from + pageSize - 1);
    if (error) throw ApiError.fromDb(error);
    rows.push(...(data || []));
    if (!data || data.length < pageSize) break;
  }
  return rows;
};
