/**
 * In-memory Scope-Aware Caching Utility
 * Provides TTL caching for authenticated user profiles and dashboard metrics.
 * Ensures cache keys are strictly scoped by tenant, role, and user ID to prevent cross-tenant leaks.
 */

class MemoryCache {
  constructor(defaultTtlMs = 60000) {
    this.defaultTtlMs = defaultTtlMs;
    this.store = new Map();
  }

  get(key) {
    const item = this.store.get(key);
    if (!item) return null;
    if (Date.now() > item.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return item.value;
  }

  set(key, value, ttlMs = this.defaultTtlMs) {
    this.store.set(key, {
      value,
      expiresAt: Date.now() + ttlMs,
    });
  }

  delete(key) {
    this.store.delete(key);
  }

  clearPrefix(prefix) {
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) {
        this.store.delete(key);
      }
    }
  }

  clear() {
    this.store.clear();
  }
}

// 60-second profile cache for authentication middleware
export const profileCache = new MemoryCache(60 * 1000);

// 30-second dashboard metrics cache scoped by role and tenant
export const dashboardCache = new MemoryCache(30 * 1000);

/** Retrieves a cached user profile by user ID */
export const getCachedUserProfile = (userId) => {
  return userId ? profileCache.get(`user_${userId}`) : null;
};

/** Caches a user profile by user ID */
export const setCachedUserProfile = (userId, profile, ttlMs) => {
  if (userId) profileCache.set(`user_${userId}`, profile, ttlMs);
};

/** Invalidates a specific user profile cache */
export const invalidateUserProfile = (userId) => {
  if (userId) profileCache.delete(`user_${userId}`);
};

/** Invalidates all profiles associated with a role */
export const invalidateAllUserProfiles = () => {
  profileCache.clear();
};

/** Invalidates dashboard cache for a specific tenant */
export const invalidateDashboardCache = (tenantId = 'default-org') => {
  dashboardCache.clearPrefix(`dash_${tenantId}`);
};
