import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { setTimeout as delay } from 'node:timers/promises';
import { erasureScope } from '../../api/_replica-erasure-scope.js';
import { OWNED_REPLICA_ERASURE_JOB_SQL, progressOwnedReplicaErasure } from '../../api/_replica-owned-erasure.js';
import {
  completeReplicaErasure, createReplicaErasureReceipt, getReplicaErasureStatus,
  leaseNextReplicaErasure, prepareReplicaErasures, runReplicaErasureFinalizer,
} from '../../api/_replica-full-erasure.js';
import { leaseNextSourceErasure, runSourceErasureSweep } from '../../api/_replica-source-erasure.js';
import { leaseNextVoiceErasure, runVoiceErasureSweep } from '../../api/_replica-voice-erasure.js';
import { runFaceSessionCleanupSweep } from '../../api/_replica-face-session.js';

// Offline control-flow and captured-query contracts only. These fixtures do not
// parse PostgreSQL, emulate its locking, or establish physical storage deletion.
const JOB = '10000000-0000-4000-8000-000000000001';
const RID = '20000000-0000-4000-8000-000000000002';
const OWNER = '30000000-0000-4000-8000-000000000003';
const FOREIGN = '40000000-0000-4000-8000-000000000004';
const SOURCE = '50000000-0000-4000-8000-000000000005';
const TOKEN = 'owned-erasure-fixture-token-at-least-thirty-two-bytes';
const SCOPE = Object.freeze({ jobId: JOB, replicaId: RID, ownerUserId: OWNER });
const ENV = Object.freeze({
  REPLICA_ERASURE_RECEIPT_KEY_B64: Buffer.alloc(32, 17).toString('base64'),
  REPLICA_BACKUP_RETENTION_DAYS: '30',
});
const PENDING = Object.freeze({ state: 'pending', attempts: 0, provider_state: 'pending', storage_state: 'pending' });
const JOB_ROW = Object.freeze({ job_id: JOB, replica_id: RID, owner_user_id: OWNER, has_face: false, has_voice: false });
const FULL_LEASE = Object.freeze({ ...SCOPE, leaseToken: TOKEN, attempt: 1, agentId: null, erasureScope: SCOPE });
const SOURCE_LEASE = Object.freeze({
  erasureScope: SCOPE, leaseToken: TOKEN,
  source: Object.freeze({ sourceId: SOURCE, replicaId: RID, ownerUserId: OWNER, attempt: 1,
    paths: Object.freeze([{ storageBucket: 'fixture-private', objectPath: `${OWNER}/${RID}/${SOURCE}/original` }]) }),
});
const RECEIPT = createReplicaErasureReceipt(RID, OWNER, ENV, { nonce: 'a'.repeat(64), nowMs: 0, erasureRequestId: JOB });
const noDb = async () => { throw Error('unexpected database call'); };
let passed = 0;
let failed = 0;
async function check(name, run) {
  try { await run(); console.log(`ok ${++passed} - ${name}`); }
  catch (error) { failed += 1; console.error(`FAIL - ${name}\n${error.stack}`); }
}
function statusQuery(sql) { return /^select 'pending' state/.test(sql.trim()); }
function harness({ row = JOB_ROW, status = PENDING, prepared = [{ job_id: JOB, replica_id: RID }], env = ENV } = {}) {
  const calls = [];
  const stages = [];
  const db = async (sql, params, timeoutMs) => {
    calls.push({ sql, params, timeoutMs });
    if (statusQuery(sql)) {
      assert.deepEqual(params.slice(0, 2), [JOB, OWNER]);
      return status ? [status] : [];
    }
    assert.equal(sql, OWNED_REPLICA_ERASURE_JOB_SQL, 'only exact job discovery is admitted by this fixture');
    assert.deepEqual(params, [JOB, OWNER]);
    return row ? [row] : [];
  };
  const options = {
    env,
    prepare: async (_db, input) => { stages.push(['prepare', input]); return prepared; },
    source: async (input) => { stages.push(['source', input]); },
    finalize: async (input) => { stages.push(['finalize', input]); },
    faceBroker: () => ({ fixture: true }),
    face: async (input) => { stages.push(['face', input]); },
    voice: async (input) => { stages.push(['voice', input]); },
  };
  return { calls, stages, db, options, run: () => progressOwnedReplicaErasure(db, OWNER, JOB, options) };
}
// Catalog absence is an explicit fixture branch, not a catch-all DB response.
function beforePrivateVoiceSchema(next) {
  return async (sql, params) => sql === "select to_regclass('public.vy_private_voice_run') is not null private_voice_present"
    ? [{ private_voice_present: false }] : next(sql, params);
}
function scopeQuery(sql, params, alias, offset) {
  assert.deepEqual(params.slice(offset), [JOB, RID, OWNER]);
  assert.match(sql, new RegExp(`${alias}\\.replica_id=\\$${offset + 2}::uuid`));
  assert.match(sql, new RegExp(`${alias}\\.owner_user_id=\\$${offset + 3}::uuid`));
  assert.match(sql, new RegExp(`owned_erasure\\.job_id=\\$${offset + 1}::uuid`));
  assert.match(sql, /owned_erasure\.state<>'complete'/);
}

await check('actual POST caller uses requireUser identity, refuses unauthenticated access and does not progress GET', async () => {
  const source = readFileSync(new URL('../../api/replica.js', import.meta.url), 'utf8');
  assert.match(source, /import\s*\{\s*progressOwnedReplicaErasure\s*\}\s*from\s*["']\.\/_replica-owned-erasure\.js["']/);
  const body = source.slice(source.indexOf('const cors ='), source.lastIndexOf('export default'));
  assert.ok(body.includes('async function handler(req, res)'), 'execute the actual handler body');
  class AuthError extends Error { constructor() { super('auth required'); this.status = 401; this.code = 'auth_required'; } }
  class CreatorPushError extends Error {}
  let authenticated = true;
  const calls = [];
  const dependencies = { q: noDb, allow: () => true, ipOf: () => 'fixture', bodyTooLarge: () => false,
    ROOM_DOOR_BODY_CAP_BYTES: 100_000, AuthError, CreatorPushError,
    requireUser: async () => { if (!authenticated) throw new AuthError(); return { id: OWNER }; },
    progressOwnedReplicaErasure: async (...args) => { calls.push(args); return { state: 'pending' }; },
    listOwnedReplicas: async () => [], creatorPushConfig: () => ({}),
  };
  const handler = runInNewContext(`${body}\nhandler`, { ...dependencies });
  const response = () => ({ statusCode: null, payload: null, setHeader() {},
    status(code) { this.statusCode = code; return this; }, json(value) { this.payload = value; return this; }, end() { return this; } });
  const req = { method: 'POST', body: { op: 'erasure_status', erasure_request_id: JOB, owner_user_id: FOREIGN, replica_id: FOREIGN } };
  const first = response();
  await handler(req, first);
  assert.equal(first.statusCode, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], noDb);
  assert.deepEqual(calls[0].slice(1), [OWNER, JOB]);
  authenticated = false;
  const denied = response();
  await handler(req, denied);
  assert.equal(denied.statusCode, 401);
  authenticated = true;
  const read = response();
  await handler({ method: 'GET', query: {}, body: req.body }, read);
  assert.equal(read.statusCode, 200);
  assert.equal(calls.length, 1);
  // Negative control: the same executable caller fixture detects body identity.
  const mutant = runInNewContext(`${body.replace('progressOwnedReplicaErasure(q, user.id,', 'progressOwnedReplicaErasure(q, body.owner_user_id,')}\nhandler`, { ...dependencies });
  await mutant(req, response());
  assert.throws(() => assert.equal(calls.at(-1)[1], OWNER));
});

await check('explicit malformed scope is rejected by every stage before any database call', async () => {
  const entrypoints = [
    (db, scope) => prepareReplicaErasures(db, { scope }),
    (db, scope) => leaseNextSourceErasure(db, { scope }),
    (db, scope) => runSourceErasureSweep({ db, scope }),
    (db, scope) => leaseNextReplicaErasure(db, { scope }),
    (db, scope) => runReplicaErasureFinalizer({ db, scope }),
    (db, scope) => leaseNextVoiceErasure(db, { scope }),
    (db, scope) => runVoiceErasureSweep({ db, scope }),
    (db, scope) => runFaceSessionCleanupSweep({ db, scope }),
  ];
  let reads = 0;
  const db = async () => { reads += 1; throw Error('scope widened to database'); };
  for (const invalid of [null, {}, { ...SCOPE, jobId: 'all' }, { ...SCOPE, ownerUserId: '' }]) {
    for (const entry of entrypoints) await assert.rejects(() => entry(db, invalid), { code: 'erasure_scope_invalid' });
  }
  assert.equal(reads, 0);
  assert.equal(erasureScope(undefined), null, 'only omitted scope selects the operator path');
});

await check('malformed request is rejected before the status database read', async () => {
  await assert.rejects(() => progressOwnedReplicaErasure(noDb, OWNER, 'not-a-uuid', { env: ENV }),
    { code: 'valid_erasure_request_id_required' });
});

await check('unknown or foreign request remains absent and starts no stage', async () => {
  const h = harness({ status: null });
  assert.equal(await h.run(), null);
  assert.equal(h.calls.length, 1);
  assert.match(h.calls[0].sql, /j\.job_id=\$1::uuid and j\.owner_user_id=\$2::uuid/);
  assert.deepEqual(h.stages, []);
  const disappeared = harness({ row: null });
  assert.equal((await disappeared.run()).state, 'pending');
  assert.deepEqual(disappeared.stages, []);
});

await check('completed receipt validates owner HMAC and completed replay performs only a read', async () => {
  const completeRow = { state: 'complete', owner_user_hash: RECEIPT.ownerUserHash, nonce: RECEIPT.nonce,
    provider_state: 'confirmed', storage_state: 'confirmed', deleted_classes: RECEIPT.deletedClasses };
  let calls = 0;
  const db = async (sql, params) => { calls += 1; assert.ok(statusQuery(sql)); assert.equal(params[0], JOB); return [completeRow]; };
  assert.equal((await getReplicaErasureStatus(db, OWNER, JOB, ENV)).state, 'complete');
  assert.equal(await getReplicaErasureStatus(db, FOREIGN, JOB, ENV), null, 'same returned row refuses a foreign identity cryptographically');
  assert.equal(await getReplicaErasureStatus(db, OWNER, JOB, { ...ENV, REPLICA_ERASURE_RECEIPT_KEY_B64: Buffer.alloc(32, 18).toString('base64') }), null);
  const h = harness({ status: completeRow });
  assert.equal((await h.run()).state, 'complete');
  assert.equal(h.calls.length, 1);
  assert.deepEqual(h.stages, []);
  assert.equal(calls, 3);
});

await check('kill switch reads status without job discovery or mutations', async () => {
  for (const value of ['1', 'true', 'YES']) {
    const h = harness({ env: { ...ENV, REPLICA_ERASURE_KILL: value } });
    assert.equal((await h.run()).state, 'pending');
    assert.equal(h.calls.length, 1);
    assert.deepEqual(h.stages, []);
  }
});

await check('active competing finalizer lease or backoff admits no provider, source or finalizer stage', async () => {
  const h = harness({ prepared: [] });
  h.options.prepare = (db, options) => prepareReplicaErasures(async (sql, params) => {
    scopeQuery(sql, params, 'j', 1);
    assert.match(sql, /j\.state='running' and \(j\.lease_expires_at is null or j\.lease_expires_at<=now\(\)\)/);
    assert.match(sql, /j\.next_attempt_at<=now\(\)/);
    assert.match(sql, /for update of j skip locked/);
    return []; // Explicit fixture: candidate excluded by the live-lease predicate.
  }, options);
  assert.equal((await h.run()).state, 'pending');
  assert.deepEqual(h.stages, []);
});

await check('exact scope flows through preparation and bounded stages in order', async () => {
  const h = harness({ row: { ...JOB_ROW, has_face: true, has_voice: true } });
  assert.equal((await h.run()).state, 'pending', 'stage success never manufactures a terminal receipt');
  assert.equal(h.stages[0][0], 'prepare');
  assert.deepEqual(h.stages.slice(-2).map(([name]) => name), ['source', 'finalize']);
  assert.deepEqual(new Set(h.stages.map(([name]) => name)), new Set(['prepare', 'face', 'voice', 'source', 'finalize']));
  for (const [, input] of h.stages) assert.deepEqual(input.scope, SCOPE);
  const source = h.stages.find(([name]) => name === 'source')[1];
  const finalizer = h.stages.find(([name]) => name === 'finalize')[1];
  const voice = h.stages.find(([name]) => name === 'voice')[1];
  assert.ok(source.signal instanceof AbortSignal);
  assert.equal(source.signal, finalizer.signal);
  assert.equal(source.signal, voice.signal);
  assert.equal(source.maxJobs, 1);
  assert.equal(finalizer.maxJobs, 1);
  const discovery = h.calls.find(({ sql }) => sql === OWNED_REPLICA_ERASURE_JOB_SQL);
  assert.ok(discovery.timeoutMs > 0 && discovery.timeoutMs <= 3000);
  assert.match(discovery.sql, /j\.job_id=\$1::uuid and j\.owner_user_id=\$2::uuid/);
  assert.match(discovery.sql, /r\.owner_user_id=j\.owner_user_id/);
});

await check('wrong-owner or wrong-job discovery cannot advance an authenticated request', async () => {
  for (const row of [{ ...JOB_ROW, owner_user_id: FOREIGN }, { ...JOB_ROW, job_id: FOREIGN }]) {
    const h = harness({ row });
    assert.equal((await h.run()).state, 'pending');
    assert.deepEqual(h.stages, []);
  }
});

await check('source candidate preserves exact scope and all durable writer fences; no candidate touches no objects', async () => {
  let candidateCalls = 0;
  let removed = 0;
  let broadCleanup = 0;
  const db = beforePrivateVoiceSchema(async (sql, params) => {
    candidateCalls += 1;
    assert.match(sql, /^with candidate as/);
    scopeQuery(sql, params, 's', 2);
    assert.match(sql, /coalesce\(s\.upload_authorization_expires_at,'-infinity'::timestamptz\)<=now\(\)/);
    assert.match(sql, /sw\.source_id=s\.source_id and sw\.replica_id=s\.replica_id/);
    assert.match(sql, /sw\.owner_user_id=s\.owner_user_id and sw\.state='active'/);
    assert.match(sql, /sw\.storage_write_not_after>now\(\)/);
    assert.match(sql, /pj\.lease_expires_at\+interval '60 minutes'>now\(\)/);
    assert.match(sql, /pi\.lease_expires_at>now\(\)/);
    return [];
  });
  const result = await runSourceErasureSweep({ db, scope: SCOPE,
    removeObjects: async () => { removed += 1; }, cleanup: async () => { broadCleanup += 1; return []; } });
  assert.deepEqual(result, { abandoned: 0, leased: 0, completed: 0, retried: 0 });
  assert.equal(candidateCalls, 1);
  assert.equal(removed, 0);
  assert.equal(broadCleanup, 0);
});

await check('actual source and finalizer claims retain their exact scope on the lease', async () => {
  const source = await leaseNextSourceErasure(beforePrivateVoiceSchema(async (sql, params) => {
    scopeQuery(sql, params, 's', 2);
    return [{ source_id: SOURCE, replica_id: RID, owner_user_id: OWNER, erasure_attempts: 1,
      storage_bucket: 'vyakti-replica-private', object_path: `${OWNER}/${RID}/${SOURCE}/original`, artifacts: [] }];
  }), { scope: SCOPE, token: TOKEN });
  assert.deepEqual(source.erasureScope, SCOPE);
  assert.equal(source.source.paths.length, 1);
  const finalizer = await leaseNextReplicaErasure(beforePrivateVoiceSchema(async (sql, params) => {
    scopeQuery(sql, params, 'j', 2);
    assert.match(sql, /j\.job_id=\$3::uuid/);
    assert.match(sql, /sw\.storage_write_not_after>now\(\)/);
    return [{ ...JOB_ROW, attempts: 1, agent_id: null }];
  }), { scope: SCOPE, token: TOKEN });
  assert.deepEqual(finalizer.erasureScope, SCOPE);
  assert.equal(finalizer.jobId, JOB);
});

await check('injected foreign source/finalizer lease is refused before renewal, storage or settlement', async () => {
  let sideEffects = 0;
  const forbidden = async () => { sideEffects += 1; throw Error('foreign lease reached a side effect'); };
  await assert.rejects(() => runSourceErasureSweep({ db: noDb, scope: SCOPE,
    lease: async () => ({ ...SOURCE_LEASE, source: { ...SOURCE_LEASE.source, ownerUserId: FOREIGN } }),
    renew: forbidden, removeObjects: forbidden, complete: forbidden, retry: forbidden,
  }), { code: 'erasure_scope_mismatch' });
  await assert.rejects(() => runReplicaErasureFinalizer({ db: noDb, scope: SCOPE,
    lease: async () => ({ ...FULL_LEASE, ownerUserId: FOREIGN }),
    renew: forbidden, cleanupChannelStorage: forbidden, complete: forbidden, retry: forbidden,
  }), { code: 'erasure_scope_mismatch' });
  assert.equal(sideEffects, 0);
});

await check('a storage failure cannot complete its source or issue the terminal replica receipt', async () => {
  const events = [];
  const sourceResult = await runSourceErasureSweep({ db: noDb, scope: SCOPE, maxJobs: 1,
    lease: async () => SOURCE_LEASE, renew: async () => { events.push('source-renew'); },
    removeObjects: async () => { events.push('source-storage'); throw Error('fixture storage unavailable'); },
    complete: async () => { events.push('source-complete'); }, retry: async () => { events.push('source-retry'); },
  });
  const finalizerResult = await runReplicaErasureFinalizer({ db: noDb, scope: SCOPE, maxJobs: 1, env: ENV,
    lease: async () => FULL_LEASE, renew: async () => { events.push('final-renew'); },
    cleanupChannelStorage: async () => { events.push('channel-storage'); throw Error('fixture storage unavailable'); },
    confirmChannelStorage: async () => { events.push('channel-confirm'); },
    complete: async () => { events.push('receipt'); }, retry: async () => { events.push('final-retry'); },
  });
  assert.equal(sourceResult.completed, 0);
  assert.equal(finalizerResult.completed, 0);
  assert.deepEqual(events, ['source-renew', 'source-storage', 'source-retry', 'final-renew', 'channel-storage', 'final-retry']);
});

await check('shared progress deadline aborts and awaits source teardown before returning without finalization', async () => {
  const h = harness();
  const events = [];
  h.options.timeBudgetMs = 20;
  h.options.source = async ({ signal }) => {
    events.push('source-start');
    await new Promise((resolve, reject) => {
      const watchdog = setTimeout(() => reject(Error('shared abort was not delivered')), 1000);
      signal.addEventListener('abort', () => {
        events.push('aborted');
        setTimeout(() => { clearTimeout(watchdog); events.push('storage-stopped'); reject(signal.reason); }, 15);
      }, { once: true });
    });
  };
  assert.equal((await h.run()).state, 'pending');
  events.push('returned');
  assert.deepEqual(events, ['source-start', 'aborted', 'storage-stopped', 'returned']);
  assert.equal(h.stages.some(([name]) => name === 'finalize'), false);
});

await check('actual source worker awaits cooperative abort cleanup and refuses successful settlement after abort', async () => {
  const aborter = new AbortController();
  const events = [];
  const result = await runSourceErasureSweep({ db: noDb, scope: SCOPE, maxJobs: 1, signal: aborter.signal,
    lease: async () => SOURCE_LEASE, renew: async () => {},
    removeObjects: async (_paths, _source, signal) => {
      const aborted = new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }));
      aborter.abort(Error('fixture request ended'));
      await aborted;
      await delay(15);
      events.push('storage-stopped');
      // A provider adapter can resolve after cleanup; aborted authority still
      // cannot become a durable deletion proof.
    },
    complete: async () => { events.push('complete'); }, retry: async () => { events.push('retry'); },
  });
  events.push('returned');
  assert.equal(result.completed, 0);
  assert.deepEqual(events, ['storage-stopped', 'retry', 'returned']);
});

await check('actual finalizer awaits cooperative abort cleanup and never confirms storage or receipt afterward', async () => {
  const aborter = new AbortController();
  const events = [];
  const result = await runReplicaErasureFinalizer({ db: noDb, scope: SCOPE, maxJobs: 1, env: ENV, signal: aborter.signal,
    lease: async () => FULL_LEASE, renew: async () => {},
    cleanupChannelStorage: async (_db, _lease, { signal }) => {
      const aborted = new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }));
      aborter.abort(Error('fixture request ended'));
      await aborted;
      await delay(15);
      events.push('storage-stopped');
    },
    confirmChannelStorage: async () => { events.push('confirmed'); },
    complete: async () => { events.push('receipt'); }, retry: async () => { events.push('retry'); },
  });
  events.push('returned');
  assert.equal(result.completed, 0);
  assert.deepEqual(events, ['storage-stopped', 'retry', 'returned']);
});

await check('scoped and ordinary per-replica completion contain no account-wide DELETEs', async () => {
  const retained = ['vy_creator_payout', 'vy_creator_payout_account', 'vy_creator_invite',
    'vy_org_member', 'vy_operator_push_subscription', 'vy_creator_push_subscription'];
  for (const lease of [FULL_LEASE, { ...FULL_LEASE, erasureScope: undefined }]) {
    await completeReplicaErasure(async (sql, params) => {
      const executable = sql.replace(/--[^\n]*/g, '');
      for (const table of retained) assert.doesNotMatch(executable, new RegExp(`delete\\s+from\\s+${table}\\b`, 'i'));
      assert.match(executable, /j\.job_id=\$1::uuid and j\.replica_id=\$2::uuid and j\.owner_user_id=\$3::uuid/);
      assert.deepEqual(params.slice(0, 3), [JOB, RID, OWNER]);
      assert.match(executable, /j\.lease_token_hash=\$4 and j\.lease_expires_at>now\(\)/);
      assert.match(executable, /j\.storage_status->>'channel'='confirmed'/);
      return [{ receipt_id: SOURCE }];
    }, lease, RECEIPT);
  }
  assert.equal(RECEIPT.deletedClasses.includes('owner_org_membership'), false);
});

console.log(`\nowned-replica-erasure: ${passed} passed, ${failed} failed (offline controls; no SQL parser/storage proof)`);
if (failed) process.exitCode = 1;
