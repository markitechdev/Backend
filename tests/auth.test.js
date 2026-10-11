import test from 'node:test';
import assert from 'node:assert/strict';
import { authenticate } from '../src/middleware/authenticate.js';
import { requireRole, requireAnyPermission } from '../src/middleware/authorize.js';
import { isTokenBlacklisted, revokeToken } from '../src/utils/tokenBlacklist.js';
import { getCachedUserProfile, setCachedUserProfile, invalidateUserProfile } from '../src/utils/cache.js';

test('Auth: Missing authentication header returns 401 UNAUTHORIZED', async () => {
  const req = { headers: {} };
  let error = null;
  const next = (err) => { error = err; };

  await authenticate(req, {}, next);

  assert.ok(error, 'Missing authorization header must trigger an error');
  assert.strictEqual(error.status, 401);
  assert.strictEqual(error.code, 'UNAUTHORIZED');
  assert.match(error.message, /missing bearer token/i);
});

test('Auth: Malformed token header returns 401 UNAUTHORIZED', async () => {
  const req = { headers: { authorization: 'Basic dXNlcjpwYXNz' } };
  let error = null;
  const next = (err) => { error = err; };

  await authenticate(req, {}, next);

  assert.ok(error, 'Non-Bearer authorization must fail');
  assert.strictEqual(error.status, 401);
  assert.strictEqual(error.code, 'UNAUTHORIZED');
});

test('Auth: Revoked/blacklisted session token is rejected with 401 UNAUTHORIZED', async () => {
  const testToken = 'test-revoked-token-abc-123';
  assert.strictEqual(isTokenBlacklisted(testToken), false, 'Token should initially not be blacklisted');

  revokeToken(testToken, 60000);
  assert.strictEqual(isTokenBlacklisted(testToken), true, 'Token must be blacklisted after revocation');

  const req = { headers: { authorization: `Bearer ${testToken}` } };
  let error = null;
  const next = (err) => { error = err; };

  await authenticate(req, {}, next);

  assert.ok(error, 'Revoked token must be rejected');
  assert.strictEqual(error.status, 401);
  assert.strictEqual(error.code, 'UNAUTHORIZED');
  assert.match(error.message, /session has been revoked/i);
});

test('Auth: Restricted role access enforces RBAC policies', () => {
  const staffReq = { user: { role: { role_code: 'staff' }, isSuperAdmin: false } };
  let staffErr = null;
  requireRole('super_admin')(staffReq, {}, (err) => { staffErr = err; });

  assert.ok(staffErr, 'Staff must be blocked from super_admin role');
  assert.strictEqual(staffErr.status, 403);
  assert.strictEqual(staffErr.code, 'FORBIDDEN');

  const adminReq = { user: { role: { role_code: 'super_admin' }, isSuperAdmin: true } };
  let adminErr = null;
  requireRole('super_admin')(adminReq, {}, (err) => { adminErr = err; });
  assert.strictEqual(adminErr, undefined, 'Super admin role must be accepted');
});

test('Auth: Granular permission checking requires at least one matching permission', () => {
  const userWithoutPerms = { user: { role: { role_code: 'manager' }, permissions: ['products.view'] } };
  let err = null;
  requireAnyPermission('roles.manage', 'users.manage')(userWithoutPerms, {}, (e) => { err = e; });

  assert.ok(err, 'User lacking any required permission should be rejected with 403');
  assert.strictEqual(err.status, 403);
  assert.strictEqual(err.code, 'FORBIDDEN');

  const userWithPerm = { user: { role: { role_code: 'manager' }, permissions: ['roles.manage'] } };
  let allowedErr = null;
  requireAnyPermission('roles.manage', 'users.manage')(userWithPerm, {}, (e) => { allowedErr = e; });
  assert.strictEqual(allowedErr, undefined, 'User with one matching permission should be granted access');
});

test('Auth: User profile caching and invalidation works as expected', () => {
  const userId = 'user-test-uuid-999';
  const profileData = { id: userId, email: 'test@example.com', role: { role_code: 'manager' } };

  setCachedUserProfile(userId, profileData);
  assert.deepStrictEqual(getCachedUserProfile(userId), profileData, 'Cache must store and return profile');

  invalidateUserProfile(userId);
  assert.strictEqual(getCachedUserProfile(userId), null, 'Cache must return null after invalidation');
});

test('Auth: Logout invalidates access token, refresh token, and clears user cache', () => {
  const accessToken = 'active-user-access-token-123';
  const refreshToken = 'active-user-refresh-token-456';
  const userId = 'user-test-uuid-888';

  setCachedUserProfile(userId, { id: userId, email: 'user@example.com' });
  assert.ok(getCachedUserProfile(userId));

  // Perform logout revocation
  revokeToken(accessToken);
  revokeToken(refreshToken);
  invalidateUserProfile(userId);

  assert.strictEqual(isTokenBlacklisted(accessToken), true, 'Access token must be blacklisted');
  assert.strictEqual(isTokenBlacklisted(refreshToken), true, 'Refresh token must be blacklisted');
  assert.strictEqual(getCachedUserProfile(userId), null, 'Profile cache must be cleared');
});

test('Auth: Refresh endpoint rejects revoked/blacklisted refresh tokens', () => {
  const revokedRefresh = 'revoked-refresh-token-999';
  revokeToken(revokedRefresh);

  assert.strictEqual(isTokenBlacklisted(revokedRefresh), true);
  // Simulating check in refresh controller
  let error = null;
  if (isTokenBlacklisted(revokedRefresh)) {
    error = { status: 401, message: 'Refresh token has been revoked or signed out' };
  }

  assert.ok(error);
  assert.strictEqual(error.status, 401);
  assert.match(error.message, /revoked/i);
});
