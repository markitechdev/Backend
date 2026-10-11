import { supabaseAdmin } from '../config/supabase.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ok, paginated } from '../utils/respond.js';
import { parseRoleMetadata } from './roles.controller.js';

/**
 * GET /api/logs & /api/super-admin/logs
 * The Super Admin system activity monitor and audit trail.
 * Supports filtering by action, entityType, user, date range (from, to), search keyword, and pagination.
 */
export const listLogs = asyncHandler(async (req, res) => {
  const { action, entityType, userId, from, to, search, page, limit } = req.query;

  let q = supabaseAdmin.from('activity_logs')
    .select(`
      log_id, action, entity_type, entity_id, details, created_at,
      user:users (
        user_id, full_name, username, email,
        role:roles ( role_id, role_code, role_name, description )
      )
    `)
    .order('created_at', { ascending: false });

  if (action)     q = q.eq('action', action);
  if (entityType) q = q.eq('entity_type', entityType);
  if (from)       q = q.gte('created_at', from);
  if (to)         q = q.lte('created_at', to);

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

  const { data, error } = await q;
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

  if (page || limit) {
    const pageNum = Math.max(1, Number(page) || 1);
    const limitNum = Math.max(1, Math.min(Number(limit) || 25, 200));
    const offset = (pageNum - 1) * limitNum;
    const paged = rows.slice(offset, offset + limitNum);
    return paginated(res, paged, { page: pageNum, limit: limitNum, total: rows.length });
  }

  ok(res, rows, { total: rows.length });
});
