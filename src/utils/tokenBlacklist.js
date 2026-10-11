/**
 * In-memory Token Revocation / Blacklist Manager
 * Tracks revoked access tokens until their natural expiration.
 */

const revokedTokens = new Map(); // token -> expiryTimestamp

// Periodic cleanup every 15 minutes
setInterval(() => {
  const now = Date.now();
  for (const [token, expiry] of revokedTokens.entries()) {
    if (expiry < now) {
      revokedTokens.delete(token);
    }
  }
}, 15 * 60 * 1000).unref();

/**
 * Revokes a token by adding it to the blacklist
 * @param {string} token 
 * @param {number} ttlMs Time to live in ms (default: 2 hours)
 */
export const revokeToken = (token, ttlMs = 2 * 60 * 60 * 1000) => {
  if (!token) return;
  revokedTokens.set(token, Date.now() + ttlMs);
};

/**
 * Checks if a token has been revoked
 * @param {string} token 
 * @returns {boolean}
 */
export const isTokenRevoked = (token) => {
  if (!token) return false;
  const expiry = revokedTokens.get(token);
  if (!expiry) return false;
  if (expiry < Date.now()) {
    revokedTokens.delete(token);
    return false;
  }
  return true;
};
