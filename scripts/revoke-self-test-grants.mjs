// revoke-self-test-grants — undo every auto-grant REPLICA_SELF_TEST_MODE has
// ever made, for every replica, in one statement.
//
//   node scripts/revoke-self-test-grants.mjs            → run it for real
//   node scripts/revoke-self-test-grants.mjs --dry-run   → count only, write nothing
//
// Why one statement and not "delete the flag's rows": nothing this flag wrote
// is deletable -- `vy_replica_consent`, `vy_replica_processing_evidence_decision`
// and `vy_replica_processing_artifact_decision` are all append-only ledgers
// (SPEC-REPLICA-PLATFORM.md), the same way a human reviewer's own decisions
// are never deleted, only superseded. So revocation here means exactly what it
// means for a human reviewer: revoke the consent (`revoked_at`), and insert a
// new decision that reverses the old one -- 'rejected' over an 'accepted'
// evidence row, 'rejected' over a 'selected' artifact -- through the SAME
// tables and the SAME reviewer_user_id=owner_user_id constraint real reviews
// use. `vy_replica`'s four identity timestamps are the one exception: they
// are plain columns, not a ledger, and self-test only ever set them from
// NULL, so nulling them back out is the correct undo.
//
// Every row this statement touches is found the same way self-test tagged it:
// `metadata->>'self_test_mode'='true'` (migration 063). A row a human granted
// through the real ceremony never carries that key and is never touched.
//
// Owner note: this is the thing to run before this product has ANY user who
// is not the owner (context/decisions.md#replica-self-test-mode). It is safe
// to run at any time, including with the flag still on -- the next source
// that reaches 'ready' on a self-mode replica will simply re-grant, which is
// the intended behaviour for ongoing internal testing.
import { q } from "../api/_db.js";

const dryRun = process.argv.includes("--dry-run");

const COUNT_SQL = `select
  (select count(*)::int from vy_replica_consent where metadata->>'self_test_mode'='true' and revoked_at is null) active_consent,
  (select count(*)::int from vy_replica where metadata->>'self_test_mode'='true' and liveness_verified_at is not null) verified_replicas,
  (select count(*)::int from (
     select distinct on (evidence_id) evidence_id, decision from vy_replica_processing_evidence_decision
      order by evidence_id, created_at desc, decision_id desc
   ) latest where latest.decision='accepted' and exists (
     select 1 from vy_replica_processing_evidence_decision o
      where o.evidence_id=latest.evidence_id and o.metadata->>'self_test_mode'='true'
   )) accepted_evidence,
  (select count(*)::int from (
     select distinct on (artifact_id) artifact_id, decision from vy_replica_processing_artifact_decision
      order by artifact_id, created_at desc, decision_id desc
   ) latest where latest.decision='selected' and exists (
     select 1 from vy_replica_processing_artifact_decision o
      where o.artifact_id=latest.artifact_id and o.metadata->>'self_test_mode'='true'
   )) selected_artifacts`;

// THE ONE QUERY. Every clause is idempotent (rerunning it after it has
// already revoked everything finds nothing left to touch and returns zeros).
export const REVOKE_SELF_TEST_GRANTS_SQL = `with revoke_consent as (
  update vy_replica_consent set revoked_at=now()
   where metadata->>'self_test_mode'='true' and revoked_at is null
  returning replica_id
), revoke_replica as (
  update vy_replica set age_verified_at=null,identity_verified_at=null,liveness_verified_at=null,
         identity_expires_at=null,updated_at=now()
   where metadata->>'self_test_mode'='true'
     and (liveness_verified_at is not null or identity_verified_at is not null or age_verified_at is not null)
  returning replica_id
), latest_evidence as (
  select distinct on (d.evidence_id) d.evidence_id,d.replica_id,d.owner_user_id,d.decision
    from vy_replica_processing_evidence_decision d
   order by d.evidence_id,d.created_at desc,d.decision_id desc
), revoke_evidence as (
  insert into vy_replica_processing_evidence_decision
    (evidence_id,replica_id,owner_user_id,decision,reason_code,reviewer_user_id,metadata)
  select d.evidence_id,d.replica_id,d.owner_user_id,'rejected','privacy_risk',d.owner_user_id,
         jsonb_build_object('self_test_mode',true,'granted_by','REPLICA_SELF_TEST_MODE','revoked',true)
    from latest_evidence d
   where d.decision='accepted'
     and exists (select 1 from vy_replica_processing_evidence_decision o
                  where o.evidence_id=d.evidence_id and o.metadata->>'self_test_mode'='true')
  returning evidence_id
), latest_artifact as (
  select distinct on (d.artifact_id) d.artifact_id,d.replica_id,d.owner_user_id,d.decision
    from vy_replica_processing_artifact_decision d
   order by d.artifact_id,d.created_at desc,d.decision_id desc
), revoke_artifacts as (
  insert into vy_replica_processing_artifact_decision
    (artifact_id,replica_id,owner_user_id,decision,reason_code,reviewer_user_id,metadata)
  select d.artifact_id,d.replica_id,d.owner_user_id,'rejected','identity_changed',d.owner_user_id,
         jsonb_build_object('self_test_mode',true,'granted_by','REPLICA_SELF_TEST_MODE','revoked',true)
    from latest_artifact d
   where d.decision='selected'
     and exists (select 1 from vy_replica_processing_artifact_decision o
                  where o.artifact_id=d.artifact_id and o.metadata->>'self_test_mode'='true')
  returning artifact_id
)
select (select count(*) from revoke_consent)::int consent_revoked,
       (select count(*) from revoke_replica)::int replicas_reset,
       (select count(*) from revoke_evidence)::int evidence_reversed,
       (select count(*) from revoke_artifacts)::int artifacts_reversed`;

const [before] = await q(COUNT_SQL);
console.log("before:", before);

if (dryRun) {
  console.log("--dry-run: nothing written");
  process.exit(0);
}

const [result] = await q(REVOKE_SELF_TEST_GRANTS_SQL);
console.log("revoked:", result);

const [after] = await q(COUNT_SQL);
console.log("after:", after);
