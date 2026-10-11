import { erasureScope } from './_replica-erasure-scope.js';
import { getReplicaErasureStatus, prepareReplicaErasures, runReplicaErasureFinalizer } from './_replica-full-erasure.js';
import { runSourceErasureSweep } from './_replica-source-erasure.js';
import { runVoiceErasureSweep } from './_replica-voice-erasure.js';
import { runFaceSessionCleanupSweep } from './_replica-face-session.js';
import { configuredFaceSessionErasureBroker } from './_face-session/registry.js';

export const OWNED_REPLICA_ERASURE_JOB_SQL = `select j.job_id,j.replica_id,j.owner_user_id,
  exists(select 1 from vy_replica_liveness_challenge ch
    where ch.replica_id=j.replica_id and ch.owner_user_id=j.owner_user_id
      and ch.face_session_state in ('issuing','ready','polling','passed_deleting','failed_deleting','expired_deleting')) has_face,
  exists(select 1 from vy_replica_voice_profile vp
    where vp.replica_id=j.replica_id and vp.owner_user_id=j.owner_user_id) has_voice
  from vy_replica_erasure_job j join vy_replica r
    on r.replica_id=j.replica_id and r.owner_user_id=j.owner_user_id
  where j.job_id=$1::uuid and j.owner_user_id=$2::uuid
    and r.lifecycle in ('revoked','purging') and j.state<>'complete' limit 1`;

// Only the authenticated POST status door calls this. All work is awaited;
// another poll can resume the durable exact job after a function interruption.
// The ordinary operator sweep continues to provide unattended retries.
export async function progressOwnedReplicaErasure(db, ownerUserId, requestId, options = {}) {
  const env = options.env || process.env;
  const read = options.readStatus || getReplicaErasureStatus;
  const before = await read(db, ownerUserId, requestId, env);
  if (!before || before.state === 'complete' || /^(1|true|yes)$/i.test(String(env.REPLICA_ERASURE_KILL || ''))) return before;
  const duration = Math.max(1, Math.min(20_000, Number(options.timeBudgetMs || 20_000)));
  const deadline = Date.now() + duration;
  const signal = AbortSignal.timeout(duration);
  const boundedDb = (sql, params) => {
    signal.throwIfAborted();
    return db(sql, params, Math.max(1, Math.min(3_000, deadline - Date.now())));
  };
  try {
    const rows = await boundedDb(OWNED_REPLICA_ERASURE_JOB_SQL, [requestId, ownerUserId]);
    if (!rows[0]) return before;
    const row = rows[0];
    const scope = erasureScope({ jobId: row.job_id, replicaId: row.replica_id, ownerUserId });
    if (scope.jobId !== String(requestId).toLowerCase() || row.owner_user_id !== scope.ownerUserId) throw Error('erasure_scope_mismatch');
    const prepared = await (options.prepare || prepareReplicaErasures)(boundedDb, { scope, limit: 1 });
    // An active finalizer lease or backoff is authority to wait, not to reset it.
    if (!prepared.length) return await read(db, ownerUserId, requestId, env);
    signal.throwIfAborted();
    const providers = [];
    if (row.has_face) providers.push(Promise.resolve().then(async () => {
      const broker = (options.faceBroker || configuredFaceSessionErasureBroker)();
      if (broker) await (options.face || runFaceSessionCleanupSweep)({
        db: boundedDb, scope, broker, maxJobs: 1, signal, providerTimeoutMs: Math.min(10_000, deadline - Date.now()),
      });
    }));
    if (row.has_voice) providers.push((options.voice || runVoiceErasureSweep)({
      db: boundedDb, scope, maxJobs: 1, signal,
    }));
    await Promise.allSettled(providers);
    signal.throwIfAborted();
    await (options.source || runSourceErasureSweep)({ db: boundedDb, scope, maxJobs: 1, signal });
    signal.throwIfAborted();
    await (options.finalize || runReplicaErasureFinalizer)({ db: boundedDb, scope, maxJobs: 1, signal, env });
  } catch {
    // Failed, expired or competing work remains a pending durable job. Never
    // manufacture success from a provider timeout or a partially erased source.
  }
  try { return await read(db, ownerUserId, requestId, env); }
  catch { return before; }
}
