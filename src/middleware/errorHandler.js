import { ApiError } from '../utils/ApiError.js';
import { env } from '../config/env.js';

export const notFoundHandler = (req, _res, next) => {
  next(ApiError.notFound(`Route not found: ${req.method} ${req.originalUrl}`));
};

// eslint-disable-next-line no-unused-vars
export const errorHandler = (err, _req, res, _next) => {
  let status = err.status || 500;
  let message = err.message || 'An unexpected error occurred';
  let code = err.code || ApiError.defaultCode(status);
  let details = err.details || null;

  // Map known PostgreSQL / Supabase errors cleanly without leaking database internals
  if (err.code === '23505') {
    status = 409;
    code = 'CONFLICT';
    message = 'A record with that unique identifier or key already exists.';
    details = null;
  } else if (err.code === '23503') {
    status = 400;
    code = 'BAD_REQUEST';
    message = 'Invalid reference: Related entity does not exist.';
    details = null;
  } else if (err.code === '22P02') {
    status = 400;
    code = 'BAD_REQUEST';
    message = 'Invalid input syntax for parameter type.';
    details = null;
  }

  // Never leak credentials, raw queries, or stack traces in production
  if (status >= 500) {
    console.error('[server-error]', { status, message: err.message, stack: err.stack });
    if (env.nodeEnv === 'production') {
      message = 'Internal server error';
      details = null;
    }
  }

  res.status(status).json({
    success: false,
    error: {
      status,
      code,
      message,
      ...(details ? { details } : {}),
      ...(env.nodeEnv !== 'production' && status >= 500 && err.stack ? { stack: err.stack } : {}),
    },
  });
};
