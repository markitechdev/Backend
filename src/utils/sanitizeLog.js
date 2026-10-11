const SENSITIVE_KEYS = new Set([
  'password',
  'oldpassword',
  'newpassword',
  'confirmpassword',
  'password_hash',
  'pass',
  'token',
  'accesstoken',
  'access_token',
  'refreshtoken',
  'refresh_token',
  'session_token',
  'secret',
  'jwt_secret',
  'supabase_key',
  'service_role_key',
  'apikey',
  'api_key',
  'authorization',
  'cookie',
  'set-cookie',
  'bearer',
]);

const SENSITIVE_PATTERNS = [
  /Bearer\s+[A-Za-z0-9_\-.]+/gi,
  /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, // JWT format
];

/**
 * Redacts known sensitive strings (bearer tokens, JWTs, etc.).
 */
export const sanitizeString = (str) => {
  if (typeof str !== 'string') return str;
  let sanitized = str;
  for (const pattern of SENSITIVE_PATTERNS) {
    sanitized = sanitized.replace(pattern, '[REDACTED_TOKEN]');
  }
  return sanitized;
};

/**
 * Deeply redacts passwords, tokens, API keys, secrets, and authorization headers from objects.
 */
export const sanitizeLogData = (data, seen = new WeakSet()) => {
  if (data === null || data === undefined) return data;

  if (typeof data === 'string') {
    return sanitizeString(data);
  }

  if (typeof data !== 'object') {
    return data;
  }

  if (seen.has(data)) {
    return '[Circular]';
  }
  seen.add(data);

  if (Array.isArray(data)) {
    return data.map((item) => sanitizeLogData(item, seen));
  }

  if (data instanceof Error) {
    return {
      name: data.name,
      message: sanitizeString(data.message),
      stack: sanitizeString(data.stack),
    };
  }

  const clean = {};
  for (const [key, value] of Object.entries(data)) {
    const lowerKey = key.toLowerCase().replace(/[-_]/g, '');
    if (SENSITIVE_KEYS.has(lowerKey)) {
      clean[key] = '[REDACTED]';
    } else {
      clean[key] = sanitizeLogData(value, seen);
    }
  }

  return clean;
};
