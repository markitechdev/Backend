import { supabaseAdmin } from '../config/supabase.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ok, paginated } from '../utils/respond.js';
import { parseRoleMetadata } from './roles.controller.js';
import { applyDateRange, pageParams } from '../utils/query.js';

/**
 * GET /api/logs & /api/super-admin/logs
 * The Super Admin system activity monitor and audit trail.
 * Supports filtering by action, entityType, user, date range (from, to), search keyword, and pagination.
 */
export const listLogs = asyncHandler(async (req, res) => {
  const { action, entityType, userId, from, to, search, page, limit } = req.query;

  const paging = pageParams(page, limit, { max: 200, fallback: 25 });
  // Without a free-text search the database does the paging (and the count),
  // instead of loading the whole audit table into memory on every request.
  const dbPaging = paging && !search;

  let q = supabaseAdmin.from('activity_logs')
    .select(`
      log_id, action, entity_type, entity_id, details, created_at,
      user:users (
        user_id, full_name, username, email,
        role:roles ( role_id, role_code, role_name, description )
      )
    `, dbPaging ? { count: 'exact' } : undefined)
    .order('created_at', { ascending: false });

  if (action)     q = q.eq('action', action);
  if (entityType) q = q.eq('entity_type', entityType);
  q = applyDateRange(q, 'created_at', from, to);

  // Scope enforcement: only Super Admin can inspect all logs; other roles see only their own
  const isSuperAdmin = req.user.role?.role_code === 'super_admin';
  if (!isSuperAdmin) {
    if (userId && userId !== req.user.id) {
      throw ApiError.forbidden('Access denied: You can only view your own activity logs');
    }
    q = q.eq('user_id', req.user.id);
  } else if (userId) {
    q = q.eq('user_id', userId);
  }

  if (dbPaging) q = q.range(paging.from, paging.to);
  else if (!search) q = q.limit(1000);

  const { data, error, count } = await q;
  if (error) throw new ApiError(500, error.message);

  let rows = (data || []).map((l) => {
    const actorRole = l.user?.role;
    const actorMeta = actorRole ? parseRoleMetadata(actorRole.description, actorRole.role_code) : null;
    return {
      logId: l.log_id,
      action: l.action,
      entityType: l.entity_type,
      entityId: l.entity_id,
      details: l.details,
      createdAt: l.created_at,
      actor: {
        userId: l.user?.user_id || null,
        fullName: l.user?.full_name || l.user?.username || 'System / Automated',
        username: l.user?.username || null,
        email: l.user?.email || null,
        roleCode: actorRole?.role_code || 'system',
        roleName: actorRole?.role_name || 'System',
        icon: actorMeta?.icon || '🛡️',
      },
    };
  });

  if (search) {
    const s = String(search).toLowerCase();
    rows = rows.filter((r) =>
      r.action.toLowerCase().includes(s) ||
      (r.entityType && r.entityType.toLowerCase().includes(s)) ||
      (r.actor.fullName && r.actor.fullName.toLowerCase().includes(s)) ||
      (r.actor.roleName && r.actor.roleName.toLowerCase().includes(s)) ||
      (r.details && JSON.stringify(r.details).toLowerCase().includes(s))
    );
  }

  if (dbPaging) {
    return paginated(res, rows, { page: paging.page, limit: paging.limit, total: count ?? rows.length });
  }
  if (paging) {
    const paged = rows.slice(paging.from, paging.to + 1);
    return paginated(res, paged, { page: paging.page, limit: paging.limit, total: rows.length });
  }

  ok(res, rows, { total: rows.length });
});
