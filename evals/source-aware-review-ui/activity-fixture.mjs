import assert from 'node:assert/strict';
import { RID, OTHER_RID } from './fixtures.mjs';

// A fixture for the actual read-only ActivityPanel caller, not a wildcard API
// stub. The test runner supplies the current synthetic auth/replica pair.
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
