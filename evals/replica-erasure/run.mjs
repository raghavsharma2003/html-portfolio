import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  completeReplicaErasure,
  createReplicaErasureReceipt,
  getReplicaErasureStatus,
  leaseNextReplicaErasure,
  prepareReplicaErasures,
  replicaErasureLeaseTokenHash,
  replicaErasureRequestHash,
  retryReplicaErasure,
  runReplicaErasureFinalizer,
} from "../../api/_replica-full-erasure.js";
import { splitSql } from "../../db/migrations/apply.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const JOB = "10000000-0000-4000-8000-000000000001";
const RID = "20000000-0000-4000-8000-000000000002";
const OWNER = "30000000-0000-4000-8000-000000000003";
const AGENT = "40000000-0000-4000-8000-000000000004";
const TOKEN = "full-replica-erasure-token-more-than-thirty-two-bytes";
const env = {
  REPLICA_ERASURE_RECEIPT_KEY_B64: Buffer.alloc(32, 91).toString("base64"),
  REPLICA_BACKUP_RETENTION_DAYS: "30",
};
let checks = 0;

function ok(name, condition) {
  assert.ok(condition, name);
  console.log(`ok ${++checks} - ${name}`);
}

const receipt = createReplicaErasureReceipt(RID, OWNER, env, {
  nonce: "a".repeat(64), nowMs: 0, erasureRequestId: JOB,
});
ok("deletion receipt carries unlinkable HMAC commitments rather than raw owner or replica ids",
  /^[0-9a-f]{64}$/.test(receipt.replicaIdHash) && /^[0-9a-f]{64}$/.test(receipt.ownerUserHash) &&
  !JSON.stringify(receipt).includes(RID) && !JSON.stringify(receipt).includes(OWNER));
ok("receipt records every private data class and the configured backup expiry",
  receipt.deletedClasses.includes("provider_voice") && receipt.deletedClasses.includes("provider_face_session") &&
  receipt.deletedClasses.includes("agent_relational_memory") &&
  receipt.backupExpiresAt === "1970-01-31T00:00:00.000Z" && receipt.erasureRequestHash === replicaErasureRequestHash(JOB));
assert.throws(() => createReplicaErasureReceipt(RID, OWNER, { ...env, REPLICA_ERASURE_RECEIPT_KEY_B64: "short" }), /receipt key required/);
assert.throws(() => createReplicaErasureReceipt(RID, OWNER, { ...env, REPLICA_BACKUP_RETENTION_DAYS: "0" }), /retention policy required/);
ok("full erasure cannot issue an unverifiable receipt or invent backup retention", true);

let prepareSql = "";
const prepared = await prepareReplicaErasures(async (sql) => {
  prepareSql = sql;
  return [{ job_id: JOB, replica_id: RID }];
});
ok("preparation atomically moves the replica to purging and revokes every live execution surface",
  prepared.length === 1 && /lifecycle='purging'/.test(prepareSql) && /runtime_capability/.test(prepareSql) &&
  /runtime_session/.test(prepareSql) && /generation/.test(prepareSql) &&
  /verification_lease_token_hash=''/.test(prepareSql) && /vy_replica_liveness_verification_attempt/.test(prepareSql));
ok("preparation enqueues every source and provider voice before any database purge",
  /update vy_replica_source s set state='deleting'/.test(prepareSql) &&
  /update vy_replica_voice_profile v set status='deleting'/.test(prepareSql) &&
  /face_session_state=case/.test(prepareSql) && /biometric_verification_grant/.test(prepareSql));

let leaseSql = "";
const lease = await leaseNextReplicaErasure(async (sql, params) => {
  leaseSql = sql;
  assert.equal(params[0], replicaErasureLeaseTokenHash(TOKEN));
  return [{
    job_id: JOB, replica_id: RID, owner_user_id: OWNER, attempts: 2,
    agent_id: AGENT, agent_slug: `replica-${RID.replaceAll("-", "")}`,
    agent_register: { selfReplica: true },
  }];
}, { token: TOKEN });
ok("final purge leases only after both provider voices and private source manifests are gone",
  /not exists \(select 1 from vy_replica_voice_profile/.test(leaseSql) &&
  /not exists \(select 1 from vy_replica_source/.test(leaseSql) &&
  /vy_replica_liveness_challenge/.test(leaseSql) && /face_session_state in/.test(leaseSql) && lease.agentId === AGENT);
ok("expired finalization leases are recovered without exposing the raw lease token",
  /failure_code='lease_expired'/.test(leaseSql) && /for update skip locked limit 1/.test(leaseSql) && !leaseSql.includes(TOKEN));

let unsafeRetrySql = "";
const unsafe = await leaseNextReplicaErasure(async (sql) => {
  if (sql.includes("with candidate as")) return [{
    job_id: JOB, replica_id: RID, owner_user_id: OWNER, attempts: 3,
    agent_id: "a0000000-0000-4000-8000-000000000001", agent_slug: "meera",
    agent_register: {},
  }];
  unsafeRetrySql = sql;
  return [{ job_id: JOB }];
}, { token: TOKEN });
ok("a corrupt binding can never turn replica deletion into Meera or another agent deletion",
  unsafe === null && /last_error_code=\$4/.test(unsafeRetrySql));

let completeSql = "";
await completeReplicaErasure(async (sql, params) => {
  completeSql = sql;
  assert.equal(params[3], replicaErasureLeaseTokenHash(TOKEN));
  assert.ok(!params.slice(4).some((value) => value === RID || value === OWNER));
  return [{ receipt_id: "50000000-0000-4000-8000-000000000005" }];
}, lease, receipt);
ok("final completion rechecks live lease no remaining voice/source and exact replica-agent ownership",
  /lease_expires_at>now\(\)/.test(completeSql) && /a\.register->>'selfReplica'='true'/.test(completeSql) &&
  /vy_replica_liveness_challenge/.test(completeSql));
ok("full purge covers raw logs traces graph relationship self and group memory for only the replica agent",
  ["meera_log", "meera_turn", "meera_nodes", "vy_episode", "vy_rel_state", "vy_pattern", "vy_phrase",
    "vy_kin", "vy_rel_texture", "vy_observation", "vy_self_arc", "vy_agent_life", "vy_group"].every((table) =>
    completeSql.includes(`delete from ${table}`)));
ok("replica-local audit operational rows and the synthetic agent identity are removed",
  /delete from vy_replica_audit/.test(completeSql) && /delete from vy_replica r/.test(completeSql) && /delete from vy_agent/.test(completeSql));
ok("public signed generation receipts survive private erasure for authenticity checking",
  !completeSql.includes("delete from vy_replica_generation_receipt") &&
  !completeSql.includes("delete from vy_replica_generation_segment_receipt"));
ok("completion writes a content-free receipt before cascading the operational erasure job",
  completeSql.indexOf("insert into vy_replica_deletion_receipt") < completeSql.indexOf("delete from vy_replica r") &&
  completeSql.includes("erasure_request_hash"));

let retrySql = "";
await retryReplicaErasure(async (sql, params) => {
  retrySql = sql;
  assert.equal(params[3], "backup_retention_policy_required");
  return [{ job_id: JOB }];
}, lease, { error: { code: "backup_retention_policy_required" } });
ok("a missing retention policy keeps the purge disabled and retryable rather than issuing a false receipt",
  /state='pending'/.test(retrySql) && /lease_token_hash=''/.test(retrySql));

let statusSql = "";
const completedStatus = await getReplicaErasureStatus(async (sql, params) => {
  statusSql = sql;
  assert.deepEqual(params, [JOB, OWNER, replicaErasureRequestHash(JOB)]);
  return [{ state: "complete", requested_at: "2026-08-24T00:00:00.000Z", updated_at: "2026-08-24T00:00:00.000Z",
    completed_at: "2026-08-24T00:00:00.000Z", backup_expires_at: "2026-09-23T00:00:00.000Z", attempts: 0,
    provider_state: "confirmed", storage_state: "confirmed", deleted_classes: receipt.deletedClasses }];
}, OWNER, JOB);
ok("the opaque request capability resolves completion after owner and replica links are gone",
  completedStatus.state === "complete" && completedStatus.provider === "confirmed" &&
  /erasure_request_hash=\$3/.test(statusSql));
ok("owner identity scopes the live job while only the unguessable request capability scopes the blinded receipt",
  /j\.job_id=\$1(?:::uuid)? and j\.owner_user_id=\$2(?:::uuid)?/.test(statusSql) &&
  statusSql.includes("vy_replica_voice_profile") && statusSql.includes("vy_replica_source") &&
  statusSql.includes("vy_replica_liveness_challenge"));

const work = [lease, { ...lease, jobId: "60000000-0000-4000-8000-000000000006" }];
const completed = [];
const retried = [];
const summary = await runReplicaErasureFinalizer({
  db: async () => [], maxJobs: 4,
  lease: async () => work.shift() || null,
  receiptFactory: (claimed) => {
    if (claimed.jobId.startsWith("6")) throw Object.assign(new Error("missing config detail"), { code: "erasure_receipt_key_required" });
    return receipt;
  },
  complete: async (_db, claimed) => completed.push(claimed.jobId),
  retry: async (_db, claimed, input) => retried.push({ id: claimed.jobId, code: input.error.code }),
});
ok("one failed final purge remains retryable without rolling back another completed replica",
  summary.completed === 1 && summary.retried === 1 && completed.length === 1 && retried[0].code === "erasure_receipt_key_required");

const migration = readFileSync(join(ROOT, "db/migrations/037_replica_full_erasure.sql"), "utf8");
const statusMigration = readFileSync(join(ROOT, "db/migrations/038_replica_erasure_status.sql"), "utf8");
const schema = readFileSync(join(ROOT, "db/schema.sql"), "utf8");
const endpoint = readFileSync(join(ROOT, "api/replica-erasure-sweep.js"), "utf8");
ok("full-erasure migration is splitter-safe and canonical schema mirrored",
  splitSql(migration).length >= 10 && splitSql(statusMigration).length >= 3 &&
  schema.includes("vy_replica_deletion_receipt_replica_hash_ix") && schema.includes("vy_replica_deletion_request_hash_ix"));
ok("the scheduled endpoint prepares children then erases voice source and replica in dependency order",
  endpoint.lastIndexOf("prepareReplicaErasures") < endpoint.lastIndexOf("runVoiceErasureSweep") &&
  endpoint.lastIndexOf("runVoiceErasureSweep") < endpoint.lastIndexOf("runSourceErasureSweep") &&
  endpoint.lastIndexOf("runSourceErasureSweep") < endpoint.lastIndexOf("runReplicaErasureFinalizer"));
ok("Face broker construction is isolated inside the settled lane so configuration failure cannot starve erasure",
  /const faceWork = Promise\.resolve\(\)\.then\(\(\) => \{\s*const faceBroker = configuredFaceSessionErasureBroker\(\)/s.test(endpoint) &&
  /Promise\.allSettled\(\[\s*faceWork,\s*runVoiceErasureSweep/s.test(endpoint));

console.log(`\n${checks} full replica erasure checks passed`);
