import { ApiError } from '../utils/ApiError.js';

/**
 * In-memory idempotency / duplicate action protection
 * Guards mutation endpoints against rapid duplicate clicks and repeated submissions.
 */
const recentSubmissions = new Map();

// Periodic cleanup of expired idempotency keys
setInterval(() => {
  const now = Date.now();
  for (const [key, expiresAt] of recentSubmissions.entries()) {
    if (expiresAt < now) {
      recentSubmissions.delete(key);
    }
  }
}, 60 * 1000).unref();

/**
 * Middleware that prevents duplicate submissions within a short window (default 3 seconds).
 * Uses explicit Idempotency-Key header if provided, otherwise hashes user ID + route + payload.
 */
export const preventDuplicateAction = (windowMs = 3000) => (req, _res, next) => {
  const userId = req.user?.id || req.ip || 'anonymous';
  const customKey = req.headers['idempotency-key'];

  const signature = customKey
    ? `idemp_${userId}_${customKey}`
    : `dup_${userId}_${req.method}_${req.originalUrl}_${JSON.stringify(req.body || {})}`;

  const now = Date.now();
  const existing = recentSubmissions.get(signature);

  if (existing && existing > now) {
    return next(ApiError.conflict('Duplicate submission detected. Please wait a moment before trying again.'));
  }

  recentSubmissions.set(signature, now + windowMs);
  next();
};
