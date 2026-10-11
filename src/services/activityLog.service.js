import { supabaseAdmin } from '../config/supabase.js';
import { sanitizeLogData } from '../utils/sanitizeLog.js';

/**
 * Writes an audit row. Never throws - logging must not break the request.
 * Backs the Super Admin responsibility "Monitor overall system activities".
 * Automatically sanitizes any sensitive credentials, tokens, or passwords before persistence.
 */
export const logActivity = async (userId, action, entityType, entityId, details = null) => {
  try {
    const safeDetails = details != null ? sanitizeLogData(details) : null;
    await supabaseAdmin.from('activity_logs').insert({
      user_id: userId ?? null,
      action,
      entity_type: entityType ?? null,
      entity_id: entityId != null ? String(entityId) : null,
      details: safeDetails,
    });
  } catch (err) {
    console.warn('[activity-log] failed:', err?.message ? sanitizeLogData(err.message) : 'Unknown error');
  }
};

