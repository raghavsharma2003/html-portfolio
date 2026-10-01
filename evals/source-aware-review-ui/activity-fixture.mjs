import assert from 'node:assert/strict';
import { RID, OTHER_RID } from './fixtures.mjs';

// A fixture for the actual read-only ActivityPanel caller, not a wildcard API
// stub. The test runner supplies the immutable admitted auth/replica pair.
// Returning null preserves its unknown-request failure for other paths/methods.
export function activityFixture({ method, url, authorization, raw = '' }, scope) {
  if (url.pathname !== '/api/replica-activity' || method !== 'GET') return null;
  assert(['synthetic-review-a', 'synthetic-review-b'].includes(scope.token), 'known synthetic activity token');
  assert([RID, OTHER_RID].includes(scope.replicaId), 'known synthetic activity replica');
  assert.equal(authorization, `Bearer ${scope.token}`, 'activity authorization matches current fixture scope');
  assert.equal(raw, '', 'activity read has no request body');
  assert.deepEqual([...url.searchParams.keys()].sort(), ['replica_id', 'unchanged'], 'exact activity read query');
  assert.equal(url.searchParams.get('replica_id'), scope.replicaId, 'activity replica matches current fixture scope');
  const unchanged = url.searchParams.get('unchanged');
  assert(/^(0|[1-9][0-9]*)$/.test(unchanged) && Number.isSafeInteger(Number(unchanged)), 'activity unchanged count is a nonnegative integer');
  // activityApi returns ActivityView directly. No jobs, no actions, no polling.
  return { replica_id: scope.replicaId, generated_at: '2026-09-29T00:00:00Z', jobs: [], lanes: [], in_flight: false, next_poll_ms: null };
}

// The expected authority comes from the runner's active document/scope, never
// from the request's claimed token or replica. Capture it before reading the
// body: a legitimate admitted request can finish after the UI moves on.
export function captureActivityScope(request, expected) {
  if (request.url.pathname !== '/api/replica-activity' || request.method !== 'GET') return null;
  assert.equal(typeof request.referer, 'string', 'activity request has its fixture document referrer');
  const document = new URL(request.referer);
  assert.equal(document.origin, expected.origin, 'activity document origin matches fixture');
  assert.equal(document.pathname, '/', 'activity document is the actual fixture host');
  assert.deepEqual(document.searchParams.getAll('fixture_document'), [expected.documentId], 'activity request belongs to the active fixture document');
  const scope = Object.freeze({ token: expected.token, replicaId: expected.replicaId });
  activityFixture({ ...request, raw: '' }, scope);
  return scope;
}
