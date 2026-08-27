// REPLICA_SELF_TEST_MODE — the owner's directive, said three times, verbatim:
// no identity or liveness check for internal, self-only testing, for weeks,
// with the whole review flow granted once. "I uploaded a video, my clone
// should start being made."
//
// DEFAULT OFF. Absent or unset is today's behaviour, bit for bit. The mode is
// enabled only when three independent guards agree: the explicit flag, the
// internal-testing environment marker, and the exact owner UUID allowlist.
// The replica must also be `subject_mode='self'`. Ownership and subject mode
// are re-checked at the SQL level inside the functions this module calls
// (`api/_replica-review.js`), not only here, so a caller mistake cannot widen
// the blast radius.
//
// WHAT THIS DOES NOT DO: it never hand-writes a `vy_replica_model_build` row
// or invents a `source_set_hash`. `queueOwnedVoiceGenome` computes that hash
// from the accepted evidence/artifact set exactly as it does for a human
// reviewer, and refuses (`model_build_source_set_changed`) if it does not
// match a prior build — which is the real gate a hand-written row bypassed
// the night this flag was written (see context/rejected.md).
//
// WHAT EVERY WRITE CARRIES: `metadata.self_test_mode = true`,
// `metadata.granted_by = 'REPLICA_SELF_TEST_MODE'`, and the versioned
// `owner-only-internal-testing/v1` guard contract, so
// `docs/gurukul/REPLICA-SELF-TEST-MODE.md`'s one revocation query can find
// and undo everything this module has ever written, for every replica, in
// one statement. See context/decisions.md#replica-self-test-mode for the
// reversal condition.

import { acceptAllOwnedEvidenceForSelfTest, queueOwnedVoiceGenome, selectOwnedVoiceArtifact } from "../_replica-review.js";
import { replicaId as parseReplicaId } from "../_replica.js";

export const SELF_TEST_GRANT_METADATA = Object.freeze({
  self_test_mode: true,
  granted_by: "REPLICA_SELF_TEST_MODE",
  guard_contract: "owner-only-internal-testing/v1",
});

export const SELF_TEST_ENVIRONMENT = "internal-owner-testing";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * This consequential bypass deliberately has no truthy-string heuristics and
 * no environment-only form. All three values must be present and exact, and
 * the caller must supply the owner UUID for the row it is about to touch.
 * `REPLICA_SELF_TEST_MODE=true` on its own is therefore inert.
 */
export function selfTestModeEnabled(env = process.env, ownerUserId) {
  if (env.REPLICA_SELF_TEST_MODE !== "true") return false;
  if (env.REPLICA_SELF_TEST_ENVIRONMENT !== SELF_TEST_ENVIRONMENT) return false;
  const configuredOwner = String(env.REPLICA_SELF_TEST_OWNER_USER_ID || "");
  const requestedOwner = String(ownerUserId || "");
  return UUID.test(configuredOwner) && UUID.test(requestedOwner)
    && configuredOwner.toLowerCase() === requestedOwner.toLowerCase();
}

// Step 1 of 3 — identity + all six scopes needed for private ingestion and
// model testing (capture/transcription/storage/biometric/training/inference).
// Every column and every consent row is filled with `coalesce`/`not exists`, so a real
// verification a person already did is never shortened, overwritten, or
// re-dated.
async function grantSelfTestIdentityAndConsent(db, ownerUserId, replicaId, metadataJson) {
  const rows = await db(
    `with target as (
       select r.replica_id, r.owner_user_id, r.policy_version from vy_replica r
        where r.replica_id=$1::uuid and r.owner_user_id=$2::uuid and r.subject_mode='self'
          and r.lifecycle not in ('revoked','purging')
     ), replica_update as (
       update vy_replica r set
         age_verified_at=coalesce(r.age_verified_at, now()),
         identity_verified_at=coalesce(r.identity_verified_at, now()),
         liveness_verified_at=coalesce(r.liveness_verified_at, now()),
         identity_expires_at=case when r.identity_expires_at is null or r.identity_expires_at<=now()
           then now() + interval '365 days' else r.identity_expires_at end,
         metadata=r.metadata || $3::jsonb,
         updated_at=now()
        from target t where r.replica_id=t.replica_id and r.owner_user_id=t.owner_user_id
       returning r.replica_id
     ), wanted as (
       select scope from unnest(array['capture','transcription','storage','biometric','training','inference']::text[]) scope
     ), missing as (
       select t.replica_id, t.owner_user_id, t.policy_version, w.scope
         from target t cross join wanted w
        where not exists (
          select 1 from vy_replica_consent c
           where c.replica_id=t.replica_id and c.owner_user_id=t.owner_user_id and c.scope=w.scope
             and c.revoked_at is null and (c.expires_at is null or c.expires_at>now())
        )
     ), granted as (
       insert into vy_replica_consent
         (replica_id,owner_user_id,scope,method,policy_version,receipt_hash,evidence_source_id,
          granted_at,expires_at,metadata)
       select replica_id,owner_user_id,scope,'account_attestation',policy_version,
              encode(sha256(convert_to(replica_id::text||':'||scope||':'||clock_timestamp()::text,'utf8')),'hex'),
              null,now(),now()+interval '365 days',$3::jsonb
         from missing
       returning consent_id, scope
     ), audit as (
       insert into vy_replica_audit(replica_id,owner_user_id,action,object_kind,object_id,policy,outcome,facts)
       select t.replica_id,t.owner_user_id,'self_test.identity_consent_grant','replica',t.replica_id::text,
              'replica-self-test/v1','allowed',$3::jsonb from target t
     )
     select (select replica_id from replica_update) replica_id,
            (select coalesce(array_agg(scope order by scope),'{}') from granted) granted_scopes`,
    [replicaId, ownerUserId, metadataJson],
  );
  return rows[0] || null;
}

async function pickUnselectedEnhanceCandidate(db, ownerUserId, replicaId) {
  const rows = await db(
    `select a.artifact_id
       from vy_replica_processing_artifact a
       join vy_replica_source s on s.source_id=a.source_id and s.replica_id=a.replica_id
        and s.owner_user_id=a.owner_user_id
      where a.replica_id=$1::uuid and a.owner_user_id=$2::uuid and a.stage='enhance'
        and a.mime in ('audio/wav','audio/x-wav') and s.state='ready' and s.contains_third_parties=false
        and lower(a.adapter_family||' '||a.adapter_name||' '||a.adapter_version) !~ '(fake|fixture|test|mock)'
        and not exists (
          select 1 from (
            select distinct on (d.artifact_id) d.artifact_id, d.decision
              from vy_replica_processing_artifact_decision d
             where d.replica_id=a.replica_id and d.owner_user_id=a.owner_user_id
             order by d.artifact_id, d.created_at desc, d.decision_id desc
          ) latest where latest.artifact_id=a.artifact_id and latest.decision='selected'
        )
      order by a.created_at desc limit 1`,
    [replicaId, ownerUserId],
  );
  return rows[0]?.artifact_id || null;
}

/**
 * Satisfies only the enrollment ceremony gates needed before source creation.
 * The authenticated API caller supplies ownerUserId; the environment allowlist
 * must match it, and the SQL independently requires that owner plus a self-mode
 * replica. Technical upload, scanning, evidence and model-build gates remain.
 */
export async function bootstrapSelfTestReplica(db, { ownerUserId, replicaId, env = process.env } = {}) {
  if (!selfTestModeEnabled(env, ownerUserId)) return { applied: false, reason: "flag_off" };
  const rid = parseReplicaId(replicaId);
  const metadataJson = JSON.stringify(SELF_TEST_GRANT_METADATA);
  const identity = await grantSelfTestIdentityAndConsent(db, ownerUserId, rid, metadataJson);
  if (!identity) return { applied: false, reason: "not_a_self_replica" };
  return {
    applied: true,
    granted_scopes: Array.isArray(identity.granted_scopes) ? identity.granted_scopes : [],
  };
}

/**
 * The whole loop, run once a source under a self-mode replica reaches
 * `state='ready'` (today: the moment `voice_quality` commits). No-op unless
 * the flag is on. Returns a plain summary safe to log (counts and ids only,
 * never bytes); never throws for "nothing to do yet" states — a genome
 * that is not buildable this pass (e.g. no enhance/wav candidate landed) is
 * reported, not raised, because the next source to reach 'ready' tries again.
 */
export async function applySelfTestAutoGrant(db, { ownerUserId, replicaId, env = process.env } = {}) {
  const bootstrap = await bootstrapSelfTestReplica(db, { ownerUserId, replicaId, env });
  if (!bootstrap.applied) return bootstrap;

  const acceptedEvidenceCount = await acceptAllOwnedEvidenceForSelfTest(
    db, ownerUserId, replicaId, SELF_TEST_GRANT_METADATA,
  );

  let selectedArtifactId = null;
  const candidateId = await pickUnselectedEnhanceCandidate(db, ownerUserId, replicaId);
  if (candidateId) {
    const selection = await selectOwnedVoiceArtifact(
      db, ownerUserId, { replica_id: replicaId, artifact_id: candidateId }, SELF_TEST_GRANT_METADATA,
    );
    selectedArtifactId = selection?.artifact_id || null;
  }

  let build = null;
  try {
    build = await queueOwnedVoiceGenome(db, ownerUserId, replicaId);
  } catch (error) {
    // "not ready yet" (409 voice_genome_not_ready) is the ordinary state on
    // every pass before the last gate clears; anything else is a real error
    // and must not be swallowed silently.
    if (error?.status !== 409) throw error;
    return {
      applied: true,
      accepted_evidence: acceptedEvidenceCount,
      selected_artifact_id: selectedArtifactId,
      build: null,
      build_blockers: error?.details?.blockers || [],
    };
  }
  return {
    applied: true,
    accepted_evidence: acceptedEvidenceCount,
    selected_artifact_id: selectedArtifactId,
    build: build ? { build_id: build.build_id, target_version: build.target_version, state: build.state } : null,
    build_blockers: [],
  };
}
