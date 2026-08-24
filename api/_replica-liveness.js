import { createHash, randomInt, randomUUID } from "node:crypto";
import { replicaId, REPLICA_POLICY_VERSION } from "./_replica.js";
import {
  sourceUploadInput,
  privateObjectPath,
  clientSource,
  verifyStoredObject,
} from "./_replica-source.js";
import { REPLICA_STORAGE_BUCKET } from "./_replica-storage.js";

const COLORS = ["neela", "kesari", "hara", "jamuni", "silver", "cobalt"];
const OBJECTS = ["sitara", "nadi", "patang", "badal", "diya", "compass"];
const ACTIONS = ["crosses", "meets", "follows", "circles", "greets", "remembers"];

export function livenessPhrase(pick = randomInt) {
  const choose = (values) => values[pick(values.length)];
  const code = String(100_000 + pick(900_000));
  return `Aaj ka live code ${choose(COLORS)} ${choose(OBJECTS)} ${code} hai. The ${choose(OBJECTS)} ${choose(ACTIONS)} the quiet river. This recording is mine and was made now. I consent to Vyakti using its biometric signals only for private identity and liveness verification.`;
}

export function clientChallenge(row) {
  if (!row) return null;
  return {
    challenge_id: row.challenge_id,
    replica_id: row.replica_id,
    phrase: row.phrase,
    state: row.state,
    attempt: Number(row.attempt),
    source_id: row.source_id || null,
    failure_code: row.failure_code || "",
    issued_at: row.issued_at,
    expires_at: row.expires_at,
    updated_at: row.updated_at,
  };
}

const CHALLENGE_RETURNING = `challenge_id, replica_id, phrase, state, attempt,
  source_id, failure_code, issued_at, expires_at, updated_at`;

export async function issueOwnedChallenge(db, ownerUserId, id, options = {}) {
  const rid = replicaId(id);
  const phrase = options.phrase || livenessPhrase(options.pick);
  const hash = createHash("sha256").update(phrase).digest("hex");
  const challengeId = options.challengeId || randomUUID();
  const rows = await db(
    `with owned as (
       select r.replica_id, r.policy_version from vy_replica r
        where r.replica_id = $1 and r.owner_user_id = $2
          and r.subject_mode = 'self' and r.policy_version = $6
          and r.lifecycle not in ('revoked','purging')
          and not exists (
            select 1 from unnest(array['capture','storage']::text[]) required(scope)
             where not exists (
               select 1 from vy_replica_consent c
                where c.replica_id = r.replica_id and c.owner_user_id = r.owner_user_id
                  and c.scope = required.scope and c.policy_version = r.policy_version
                  and c.revoked_at is null and (c.expires_at is null or c.expires_at > now())
             )
          )
     ), attempts as (
       select count(*)::integer as n from vy_replica_liveness_challenge
        where replica_id = $1 and owner_user_id = $2 and issued_at > now() - interval '24 hours'
     ), expired as (
       update vy_replica_liveness_challenge set state = 'expired', updated_at = now()
        where replica_id = $1 and owner_user_id = $2
          and state in ('issued','uploaded','verifying') and exists (select 1 from owned)
       returning challenge_id
     ), issued as (
       insert into vy_replica_liveness_challenge
         (challenge_id, replica_id, owner_user_id, phrase, phrase_hash,
          policy_version, attempt, expires_at)
       select $3, owned.replica_id, $2, $4, $5, owned.policy_version,
              attempts.n + 1, now() + interval '5 minutes'
         from owned cross join attempts
         cross join (select count(*) from expired) cleared
        where attempts.n < 10
       returning ${CHALLENGE_RETURNING}
     ), audit as (
       insert into vy_replica_audit
         (replica_id, owner_user_id, action, object_kind, object_id, policy, outcome, facts)
       select $1, $2, 'liveness.challenge.issue', 'liveness_challenge',
              challenge_id::text, $6, 'allowed', jsonb_build_object('attempt', attempt)
         from issued
     )
     select * from issued`,
    [rid, ownerUserId, challengeId, phrase, hash, REPLICA_POLICY_VERSION],
  );
  return clientChallenge(rows[0]);
}

export async function latestOwnedChallenge(db, ownerUserId, id) {
  const rows = await db(
    `update vy_replica_liveness_challenge
        set state = 'expired', updated_at = now()
      where replica_id = $1 and owner_user_id = $2 and state = 'issued' and expires_at <= now()
      returning challenge_id`,
    [replicaId(id), ownerUserId],
  );
  void rows;
  const current = await db(
    `select ${CHALLENGE_RETURNING} from vy_replica_liveness_challenge
      where replica_id = $1 and owner_user_id = $2 order by issued_at desc limit 1`,
    [replicaId(id), ownerUserId],
  );
  return clientChallenge(current[0]);
}

const LIVE_SOURCE_RETURNING = `source_id, replica_id, owner_user_id, kind,
  capture_mode, storage_bucket, object_path, mime, byte_size, sha256, state,
  contains_third_parties, rejection_code, created_at, updated_at`;

export async function createChallengeSource(db, ownerUserId, id, challenge, value, options = {}) {
  const rid = replicaId(id);
  const cid = replicaId(challenge);
  const input = sourceUploadInput(value);
  if (input.kind !== "audio" && input.kind !== "video") {
    throw Object.assign(new Error("live challenge evidence must be audio or video"), { status: 400 });
  }
  if (input.kind !== "video") {
    throw Object.assign(new Error("voice and video are both required for independent liveness verification"), { status: 409 });
  }
  if (input.byteSize > 52_428_800) {
    throw Object.assign(new Error("live challenge video must be 50 MiB or less"), { status: 413 });
  }
  if (input.containsThirdParties) {
    throw Object.assign(new Error("live challenge must contain only the verified subject"), { status: 409 });
  }
  const sourceId = options.sourceId || randomUUID();
  const path = privateObjectPath(ownerUserId, rid, sourceId);
  const provenance = JSON.stringify({
    declaration: "client_sha256",
    sha256_status: "pending_server_verification",
    live_challenge_id: cid,
    filename_retained: false,
  });
  const rows = await db(
    `with challenge as (
       select ch.challenge_id, ch.replica_id, r.policy_version
         from vy_replica_liveness_challenge ch
         join vy_replica r on r.replica_id = ch.replica_id and r.owner_user_id = ch.owner_user_id
        where ch.challenge_id = $3 and ch.replica_id = $1 and ch.owner_user_id = $2
          and ch.state = 'issued' and ch.expires_at > now() and ch.source_id is null
          and r.subject_mode = 'self' and r.lifecycle not in ('revoked','purging')
     ), capture as (
       select c.consent_id from vy_replica_consent c join challenge ch on ch.replica_id = c.replica_id
        where c.owner_user_id = $2 and c.scope = 'capture'
          and c.policy_version = ch.policy_version and c.revoked_at is null
          and (c.expires_at is null or c.expires_at > now())
        order by c.granted_at desc limit 1
     ), storage_ok as (
       select 1 from vy_replica_consent c join challenge ch on ch.replica_id = c.replica_id
        where c.owner_user_id = $2 and c.scope = 'storage'
          and c.policy_version = ch.policy_version and c.revoked_at is null
          and (c.expires_at is null or c.expires_at > now()) limit 1
     ), inserted as (
       insert into vy_replica_source
         (source_id, replica_id, owner_user_id, consent_id, kind, capture_mode,
          storage_bucket, object_path, mime, byte_size, sha256,
          contains_third_parties, provenance)
       select $4, challenge.replica_id, $2, capture.consent_id, $5, 'live_challenge',
              $6, $7, $8, $9, $10, false, $11::jsonb
         from challenge cross join capture cross join storage_ok
       returning ${LIVE_SOURCE_RETURNING}
     ), attached as (
       update vy_replica_liveness_challenge ch set source_id = inserted.source_id, updated_at = now()
         from inserted where ch.challenge_id = $3
     ), audit as (
       insert into vy_replica_audit
         (replica_id, owner_user_id, action, object_kind, object_id, policy, outcome, facts)
       select $1, $2, 'liveness.challenge.upload.create', 'source', source_id::text,
              (select policy_version from challenge), 'allowed',
              jsonb_build_object('kind', kind, 'byte_size', byte_size) from inserted
     )
     select * from inserted`,
    [rid, ownerUserId, cid, sourceId, input.kind, REPLICA_STORAGE_BUCKET, path,
      input.mime, input.byteSize, input.sha256, provenance],
  );
  return rows[0] || null;
}

export async function markChallengeUploaded(db, ownerUserId, id, challenge, source) {
  const rows = await db(
    `with uploaded as (
       update vy_replica_liveness_challenge set state = 'uploaded', updated_at = now()
        where challenge_id = $3 and replica_id = $1 and owner_user_id = $2
          and source_id = $4 and state = 'issued' and expires_at > now()
       returning ${CHALLENGE_RETURNING}
     ), audit as (
       insert into vy_replica_audit
         (replica_id, owner_user_id, action, object_kind, object_id, policy, outcome, facts)
       select $1, $2, 'liveness.challenge.upload.finalize', 'liveness_challenge',
              challenge_id::text, $5, 'allowed', '{}'::jsonb from uploaded
     )
     select * from uploaded`,
    [replicaId(id), ownerUserId, replicaId(challenge), replicaId(source), REPLICA_POLICY_VERSION],
  );
  return clientChallenge(rows[0]);
}

// Finalization is challenge-bound and atomic. A generic pending source lookup
// is insufficient here: the file must still be attached to this exact,
// unexpired server-issued phrase when it enters the biometric quarantine.
export async function finalizeChallengeSource(
  db,
  ownerUserId,
  id,
  challenge,
  source,
  objectInfo,
) {
  const rid = replicaId(id);
  const cid = replicaId(challenge);
  const sid = replicaId(source);
  const verdict = verifyStoredObject(
    { byte_size: objectInfo.expectedByteSize, mime: objectInfo.expectedMime },
    objectInfo,
  );
  const sourceState = verdict.ok ? "quarantined" : "rejected";
  const challengeState = verdict.ok ? "uploaded" : "failed";
  const facts = JSON.stringify({
    storage_metadata_verified: verdict.ok,
    sha256_status: "pending_server_verification",
  });
  const rows = await db(
    `with eligible as (
       select s.source_id, s.replica_id, s.owner_user_id
         from vy_replica_source s
         join vy_replica_liveness_challenge ch
           on ch.source_id = s.source_id and ch.replica_id = s.replica_id
          and ch.owner_user_id = s.owner_user_id
        where s.replica_id = $1 and s.owner_user_id = $2 and s.source_id = $4
          and s.capture_mode = 'live_challenge' and s.state = 'pending_upload'
          and ch.challenge_id = $3 and ch.state = 'issued' and ch.expires_at > now()
     ), updated_source as (
       update vy_replica_source s
          set state = $5, rejection_code = $6, updated_at = now(),
              provenance = provenance || $7::jsonb
         from eligible e where s.source_id = e.source_id
       returning s.*
     ), updated_challenge as (
       update vy_replica_liveness_challenge ch
          set state = $8, failure_code = $6, updated_at = now()
         from updated_source s
        where ch.challenge_id = $3 and ch.replica_id = $1
          and ch.owner_user_id = $2 and ch.source_id = s.source_id
       returning ch.*
     ), queued as (
       insert into vy_replica_processing_job
         (replica_id, owner_user_id, source_id, step, state)
       select replica_id, owner_user_id, source_id, 'integrity', 'queued'
         from updated_source where state = 'quarantined'
       on conflict (source_id, step, revision) do nothing
     ), audit as (
       insert into vy_replica_audit
         (replica_id, owner_user_id, action, object_kind, object_id, policy, outcome, facts)
       select $1, $2, 'liveness.challenge.upload.finalize', 'liveness_challenge',
              challenge_id::text, $9,
              case when $8 = 'uploaded' then 'allowed' else 'denied' end,
              jsonb_build_object('reason_code', $6)
         from updated_challenge
     )
     select row_to_json(s) as source, row_to_json(ch) as challenge
       from updated_source s cross join updated_challenge ch`,
    [rid, ownerUserId, cid, sid, sourceState, verdict.code, facts, challengeState, REPLICA_POLICY_VERSION],
  );
  const row = rows[0];
  if (!row) return null;
  return { source: row.source, challenge: clientChallenge(row.challenge) };
}

export { clientSource };
