// Database operations for the owner-only self-replica control plane.
// Every read and mutation includes owner_user_id in SQL. Callers must pass the
// id returned by requireUser(), never any identifier from request JSON.
export const REPLICA_POLICY_VERSION = "replica-self-v1";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function replicaId(value) {
  const id = String(value || "").trim();
  if (!UUID.test(id)) throw Object.assign(new Error("valid replica_id required"), { status: 400 });
  return id;
}

export function replicaDisplayName(value) {
  const name = Array.from(String(value || ""))
    .filter((character) => {
      const code = character.codePointAt(0);
      return code >= 32 && code !== 127;
    })
    .join("")
    .trim();
  if (!name || name.length > 80) throw Object.assign(new Error("display_name must be 1-80 characters"), { status: 400 });
  return name;
}

export function clientReplica(row) {
  if (!row) return null;
  const identityCurrent = row.identity_expires_at === undefined ||
    (Boolean(row.identity_expires_at) && new Date(row.identity_expires_at).getTime() > Date.now());
  // Whitelist by construction. Ownership ids, provider handles, raw evidence,
  // verification internals and erasure processor state never enter a response.
  return {
    replica_id: row.replica_id,
    display_name: row.display_name,
    subject_mode: row.subject_mode,
    lifecycle: row.lifecycle,
    policy_version: row.policy_version,
    age_verified: Boolean(row.age_verified_at) && identityCurrent,
    identity_verified: Boolean(row.identity_verified_at) && identityCurrent,
    liveness_verified: Boolean(row.liveness_verified_at) && identityCurrent,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

const RETURNING = `replica_id, display_name, subject_mode, lifecycle, policy_version,
  age_verified_at, identity_verified_at, liveness_verified_at, identity_expires_at, created_at, updated_at`;

export async function createSelfReplica(db, ownerUserId, displayName) {
  const name = replicaDisplayName(displayName);
  const rows = await db(
    `with owner_lock as (
       select pg_advisory_xact_lock(hashtextextended($1::text, 0))
     ), existing_person as (
       select ap.person_id
         from vy_account_person ap, owner_lock
        where ap.auth_user_id = $1::uuid
     ), created_person as (
       insert into vy_person (age_tier)
       select 'unverified' from owner_lock
        where not exists (select 1 from existing_person)
       returning person_id
     ), owner_person as (
       select person_id from existing_person
       union all
       select person_id from created_person
       limit 1
     ), account_bridge as (
       insert into vy_account_person (auth_user_id, person_id)
       select $1::uuid, person_id from owner_person
       on conflict (auth_user_id) do update
         set auth_user_id = excluded.auth_user_id
       returning person_id
     ), replica as (
       insert into vy_replica
         (owner_user_id, subject_person_id, display_name, subject_mode, lifecycle, policy_version)
       select $1::uuid, person_id, $2, 'self', 'consent_pending', $3
         from account_bridge
       returning ${RETURNING}
     ), audit as (
       insert into vy_replica_audit
         (replica_id, owner_user_id, action, object_kind, object_id, policy, outcome, facts)
       select replica_id, $1::uuid, 'replica.create', 'replica', replica_id::text, $3, 'allowed', '{}'::jsonb
         from replica
     )
     select * from replica`,
    [ownerUserId, name, REPLICA_POLICY_VERSION],
  );
  return clientReplica(rows[0]);
}

export async function listOwnedReplicas(db, ownerUserId) {
  const rows = await db(
    `select ${RETURNING} from vy_replica
      where owner_user_id = $1::uuid
      order by created_at desc limit 50`,
    [ownerUserId],
  );
  return rows.map(clientReplica);
}

export async function getOwnedReplica(db, ownerUserId, id) {
  const rows = await db(
    `select ${RETURNING} from vy_replica
      where replica_id = $1::uuid and owner_user_id = $2::uuid limit 1`,
    [replicaId(id), ownerUserId],
  );
  return clientReplica(rows[0]);
}

export async function requestOwnedReplicaErasure(db, ownerUserId, id) {
  const rid = replicaId(id);
  let rows = await db(
    `with revoked as (
       update vy_replica
          set lifecycle = 'revoked', revoked_at = coalesce(revoked_at, now()), updated_at = now()
        where replica_id = $1::uuid and owner_user_id = $2::uuid and lifecycle <> 'purging'
        returning ${RETURNING}
     ), audit as (
       insert into vy_replica_audit
         (replica_id, owner_user_id, action, object_kind, object_id, policy, outcome, facts)
       select replica_id, $2, 'replica.revoke', 'replica', replica_id::text,
              policy_version, 'allowed', '{}'::jsonb
         from revoked
     ), runtime_capabilities as (
       update vy_replica_runtime_capability c
          set state = 'revoked', revoked_at = coalesce(revoked_at, now())
         from revoked r
        where c.replica_id = r.replica_id and c.owner_user_id = $2::uuid and c.state = 'active'
     ), runtime_sessions as (
       update vy_replica_runtime_session s
          set state = 'revoked', ended_at = coalesce(ended_at, now()), updated_at = now()
         from revoked r
        where s.replica_id = r.replica_id and s.owner_user_id = $2::uuid and s.state = 'active'
     ), open_generations as (
       update vy_replica_generation g
          set state = 'aborted', failure_code = 'replica_revoked', updated_at = now()
         from revoked r
        where g.replica_id = r.replica_id and g.owner_user_id = $2::uuid
          and g.state in ('authorized','streaming')
     ), voice_profiles as (
       update vy_replica_voice_profile vp set status = 'deleting', updated_at = now()
        from revoked r where vp.replica_id = r.replica_id and vp.owner_user_id = $2::uuid
          and vp.status <> 'deleting'
     ), provider_consents as (
       update vy_replica_provider_consent pc set state = 'revoked',
              revoked_at = coalesce(revoked_at, now()), updated_at = now()
        from revoked r where pc.replica_id = r.replica_id and pc.owner_user_id = $2::uuid
           and pc.state <> 'revoked'
     ), face_sessions as (
       update vy_replica_liveness_challenge ch set state='failed',failure_code='replica_revoked',
              face_session_state=case
                when ch.face_session_handle<>'' and ch.face_session_state not in
                  ('passed_deleted','failed_deleted','expired_deleted') then 'expired_deleting'
                else ch.face_session_state end,
              verification_lease_token_hash='',verification_leased_at=null,
              verification_lease_expires_at=null,updated_at=now()
        from revoked r where ch.replica_id=r.replica_id and ch.owner_user_id= $2::uuid
       returning ch.challenge_id,ch.verification_attempt
     ), liveness_attempts as (
       update vy_replica_liveness_verification_attempt a set outcome='failed',
              failure_code='replica_revoked',finished_at=now()
        from face_sessions ch where a.challenge_id=ch.challenge_id
          and a.attempt=ch.verification_attempt and a.outcome='running'
     ), biometric_verification_grants as (
       update vy_replica_biometric_verification_grant g set state='revoked',revoked_at=now()
        from revoked r where g.replica_id=r.replica_id and g.owner_user_id= $2::uuid and g.state='active'
     ), erasure as (
       insert into vy_replica_erasure_job (replica_id, owner_user_id, state)
       select replica_id, $2, 'pending' from revoked
       on conflict (replica_id) do update
         set updated_at = now(),
             state = case when vy_replica_erasure_job.state = 'complete'
                          then vy_replica_erasure_job.state else 'pending' end
       returning job_id,replica_id
     )
     select revoked.*,erasure.job_id as erasure_request_id
       from revoked join erasure on erasure.replica_id=revoked.replica_id`,
    [rid, ownerUserId],
  );
  if (!rows[0]) {
    rows = await db(
      `select r.replica_id,r.display_name,r.subject_mode,r.lifecycle,r.policy_version,
              r.age_verified_at,r.identity_verified_at,r.liveness_verified_at,r.identity_expires_at,r.created_at,r.updated_at,
              j.job_id as erasure_request_id from vy_replica r
        join vy_replica_erasure_job j on j.replica_id=r.replica_id and j.owner_user_id=r.owner_user_id
        where r.replica_id = $1::uuid and r.owner_user_id = $2::uuid and r.lifecycle = 'purging' limit 1`,
      [rid, ownerUserId],
    );
  }
  if (!rows[0]) return null;
  return { replica: clientReplica(rows[0]), erasure_request_id: rows[0].erasure_request_id };
}

export async function revokeOwnedReplica(db, ownerUserId, id) {
  const result = await requestOwnedReplicaErasure(db, ownerUserId, id);
  return result?.replica || null;
}
