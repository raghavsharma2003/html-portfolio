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
  // Whitelist by construction. Ownership ids, provider handles, raw evidence,
  // verification internals and erasure processor state never enter a response.
  return {
    replica_id: row.replica_id,
    display_name: row.display_name,
    subject_mode: row.subject_mode,
    lifecycle: row.lifecycle,
    policy_version: row.policy_version,
    age_verified: Boolean(row.age_verified_at),
    identity_verified: Boolean(row.identity_verified_at),
    liveness_verified: Boolean(row.liveness_verified_at),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

const RETURNING = `replica_id, display_name, subject_mode, lifecycle, policy_version,
  age_verified_at, identity_verified_at, liveness_verified_at, created_at, updated_at`;

export async function createSelfReplica(db, ownerUserId, displayName) {
  const name = replicaDisplayName(displayName);
  const rows = await db(
    `with replica as (
       insert into vy_replica
         (owner_user_id, display_name, subject_mode, lifecycle, policy_version)
       values ($1, $2, 'self', 'consent_pending', $3)
       returning ${RETURNING}
     ), audit as (
       insert into vy_replica_audit
         (replica_id, owner_user_id, action, object_kind, object_id, policy, outcome, facts)
       select replica_id, $1, 'replica.create', 'replica', replica_id::text, $3, 'allowed', '{}'::jsonb
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
      where owner_user_id = $1
      order by created_at desc limit 50`,
    [ownerUserId],
  );
  return rows.map(clientReplica);
}

export async function getOwnedReplica(db, ownerUserId, id) {
  const rows = await db(
    `select ${RETURNING} from vy_replica
      where replica_id = $1 and owner_user_id = $2 limit 1`,
    [replicaId(id), ownerUserId],
  );
  return clientReplica(rows[0]);
}

export async function revokeOwnedReplica(db, ownerUserId, id) {
  const rid = replicaId(id);
  let rows = await db(
    `with revoked as (
       update vy_replica
          set lifecycle = 'revoked', revoked_at = coalesce(revoked_at, now()), updated_at = now()
        where replica_id = $1 and owner_user_id = $2 and lifecycle <> 'purging'
        returning ${RETURNING}
     ), audit as (
       insert into vy_replica_audit
         (replica_id, owner_user_id, action, object_kind, object_id, policy, outcome, facts)
       select replica_id, $2, 'replica.revoke', 'replica', replica_id::text,
              policy_version, 'allowed', '{}'::jsonb
         from revoked
     ), erasure as (
       insert into vy_replica_erasure_job (replica_id, owner_user_id, state)
       select replica_id, $2, 'pending' from revoked
       on conflict (replica_id) do update
         set updated_at = now(),
             state = case when vy_replica_erasure_job.state = 'complete'
                          then vy_replica_erasure_job.state else 'pending' end
     )
     select * from revoked`,
    [rid, ownerUserId],
  );
  if (!rows[0]) {
    rows = await db(
      `select ${RETURNING} from vy_replica
        where replica_id = $1 and owner_user_id = $2 and lifecycle = 'purging' limit 1`,
      [rid, ownerUserId],
    );
  }
  if (!rows[0]) return null;
  return clientReplica(rows[0]);
}
