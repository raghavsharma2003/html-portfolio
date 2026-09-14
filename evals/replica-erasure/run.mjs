import { readReconciledMigration } from "../lib/reconciled-migration.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  completeReplicaErasure,
  confirmReplicaChannelStorageErasure,
  createReplicaErasureReceipt,
  getReplicaErasureStatus,
  leaseNextReplicaErasure,
  prepareReplicaErasures,
  replicaErasureLeaseTokenHash,
  replicaErasureRequestHash,
  renewReplicaErasureLease,
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
  receipt.deletedClasses.includes("agent_relational_memory") && receipt.deletedClasses.includes("replica_persona_sheet") &&
  receipt.deletedClasses.includes("agent_push_credentials") &&
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
ok("preparation revokes channel work and resets its storage proof before any final purge",
  /update vy_channel_watch w set status='revoked'/.test(prepareSql) &&
  /'channel','pending'/.test(prepareSql));

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
ok("final purge waits out channel and one-link upload authority before leasing",
  leaseSql.includes("vy_channel_extraction_object") && leaseSql.includes("vy_ingest_run") &&
  leaseSql.includes("vy_video_enrollment") &&
  (leaseSql.match(/upload_authorization_expires_at/g) || []).length >= 3 &&
  /'infinity'::timestamptz/.test(leaseSql));
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
ok("final completion requires the provider prefix proof before deleting the exact channel ledger",
  /storage_status->>'channel'='confirmed'/.test(completeSql) &&
  /delete from vy_channel_extraction_object x using target t/.test(completeSql));
ok("full purge covers raw logs traces graph relationship self and group memory for only the replica agent",
  ["meera_log", "meera_turn", "meera_nodes", "vy_episode", "vy_fact", "vy_rel_event", "vy_rel_state", "vy_pattern", "vy_phrase",
    "vy_kin", "vy_rel_texture", "vy_observation", "vy_self_arc", "vy_agent_life", "vy_group"].every((table) =>
    completeSql.includes(`delete from ${table}`)));
ok("replica-local audit operational rows and the synthetic agent identity are removed",
  /delete from vy_replica_audit/.test(completeSql) && /delete from vy_replica r/.test(completeSql) && /delete from vy_agent/.test(completeSql));
ok("full purge deletes the exact replica agent TeacherSheet before its non-FK identity can orphan",
  completeSql.includes("teacher_sheets as (delete from vy_teacher_sheet x using target t") &&
  completeSql.includes("where t.agent_id is not null and x.agent_id=t.agent_id") &&
  completeSql.indexOf("delete from vy_teacher_sheet") < completeSql.indexOf("delete from vy_agent a") &&
  completeSql.includes("(select count(*) from teacher_sheets)>=0"));
ok("full purge has no owner-wide or unscoped TeacherSheet deletion",
  !/delete from vy_teacher_sheet x(?! using target t)/.test(completeSql) &&
  !/delete from vy_teacher_sheet[\s\S]{0,160}owner_user_id/.test(completeSql));
ok("full purge deletes exact replica-agent push credentials before agent removal",
  completeSql.includes("push_tokens as (delete from vy_push_token x using target t") &&
  completeSql.includes("where t.agent_id is not null and x.agent_id=t.agent_id") &&
  completeSql.indexOf("delete from vy_push_token") < completeSql.indexOf("delete from vy_agent a") &&
  completeSql.includes("(select count(*) from push_tokens)>=0"));
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
const finalizedStages = [];
const summary = await runReplicaErasureFinalizer({
  db: async () => [], maxJobs: 4,
  lease: async () => work.shift() || null,
  receiptFactory: (claimed) => {
    if (claimed.jobId.startsWith("6")) throw Object.assign(new Error("missing config detail"), { code: "erasure_receipt_key_required" });
    return receipt;
  },
  complete: async (_db, claimed) => completed.push(claimed.jobId),
  retry: async (_db, claimed, input) => retried.push({ id: claimed.jobId, code: input.error.code }),
  cleanupChannelStorage: async (_db, claimed) => finalizedStages.push(`cleanup:${claimed.jobId}`),
  confirmChannelStorage: async (_db, claimed) => finalizedStages.push(`confirm:${claimed.jobId}`),
});
ok("one failed final purge remains retryable without rolling back another completed replica",
  summary.completed === 1 && summary.retried === 1 && completed.length === 1 && retried[0].code === "erasure_receipt_key_required");
ok("the finalizer proves and acknowledges channel storage before it can issue a receipt",
  finalizedStages[0] === `cleanup:${JOB}` && finalizedStages[1] === `confirm:${JOB}`);

let channelConfirmSql = "";
await confirmReplicaChannelStorageErasure(async (sql) => {
  channelConfirmSql = sql;
  return [{ job_id: JOB }];
}, lease);
ok("channel storage acknowledgement is lease-bound and rechecks every authorization horizon",
  /lease_token_hash=\$4/.test(channelConfirmSql) && /lease_expires_at>now\(\)/.test(channelConfirmSql) &&
  (channelConfirmSql.match(/upload_authorization_expires_at/g) || []).length >= 3 &&
  /jsonb_build_object\('channel','confirmed'\)/.test(channelConfirmSql));

let renewSql = "";
await renewReplicaErasureLease(async (sql, params) => {
  renewSql = sql;
  assert.equal(params[3], replicaErasureLeaseTokenHash(TOKEN));
  return [{ job_id: JOB }];
}, lease, { leaseMs: 240_000 });
ok("long prefix cleanup renews only the same still-live finalization lease",
  /j\.job_id=\$1::uuid/.test(renewSql) && /j\.replica_id=\$2::uuid/.test(renewSql) &&
  /j\.owner_user_id=\$3::uuid/.test(renewSql) && /j\.state='running'/.test(renewSql) &&
  /j\.lease_expires_at>now\(\)/.test(renewSql));

let cleanupAborted = false;
let confirmAfterLoss = false;
const lostSummary = await runReplicaErasureFinalizer({
  db: async () => [],
  maxJobs: 1,
  heartbeatMs: 100,
  lease: (() => { let once = true; return async () => once ? (once = false, lease) : null; })(),
  cleanupChannelStorage: async (_db, _claimed, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener("abort", () => {
      cleanupAborted = true;
      reject(signal.reason);
    }, { once: true });
  }),
  renew: async () => { throw Object.assign(new Error("lost_replica_erasure_lease"), { code: "lost_replica_erasure_lease" }); },
  confirmChannelStorage: async () => { confirmAfterLoss = true; },
  complete: async () => { throw new Error("completion must not run after lease loss"); },
  retry: async () => null,
});
ok("lease loss aborts provider enumeration and cannot acknowledge or complete the purge",
  cleanupAborted && !confirmAfterLoss && lostSummary.completed === 0 && lostSummary.retried === 1);

const migration = readFileSync(join(ROOT, "db/migrations/037_replica_full_erasure.sql"), "utf8");
const statusMigration = readFileSync(join(ROOT, "db/migrations/038_replica_erasure_status.sql"), "utf8");
const channelStorageMigration = readReconciledMigration("db/migrations/074_channel_extraction_storage_fence.sql");
const ownedWriteFenceMigration = readReconciledMigration("db/migrations/076_replica_owned_write_fence.sql");
const schema = readFileSync(join(ROOT, "db/schema.sql"), "utf8");
const endpoint = readFileSync(join(ROOT, "api/replica-erasure-sweep.js"), "utf8");
ok("full-erasure migration is splitter-safe and canonical schema mirrored",
  splitSql(migration).length >= 10 && splitSql(statusMigration).length >= 3 &&
  schema.includes("vy_replica_deletion_receipt_replica_hash_ix") && schema.includes("vy_replica_deletion_request_hash_ix"));
ok("channel extraction authority is splitter-safe owner-cascaded and mirrored in canonical schema",
  splitSql(channelStorageMigration).length >= 7 &&
  /foreign key \(replica_id, owner_user_id\)[\s\S]*references vy_replica\(replica_id, owner_user_id\) on delete cascade/.test(channelStorageMigration) &&
  schema.includes("vy_channel_extraction_object_scope_path") &&
  schema.includes("vy_channel_extraction_object_authority_ix"));
const validatedOwnedTables = [
  "vy_clone_channel", "vy_channel_attestation", "vy_channel_watch", "vy_ingest_run",
  "vy_context_item", "vy_context_item_text", "vy_video_enrollment", "vy_video_enrollment_window",
];
ok("late non-FK writes gain composite parent cascades and every zero-orphan table is validated",
  splitSql(ownedWriteFenceMigration).length === 25 &&
  ["vy_replica_audit", ...validatedOwnedTables].every((table) =>
    ownedWriteFenceMigration.includes(`alter table ${table}`) &&
    ownedWriteFenceMigration.includes(`constraint ${table}_replica_owner_fk`) &&
    schema.includes(`constraint ${table}_replica_owner_fk`)) &&
  validatedOwnedTables.every((table) =>
    ownedWriteFenceMigration.includes(`alter table ${table} validate constraint ${table}_replica_owner_fk`)));
const agentPayloadTables = ["meera_log", "vy_episode", "vy_fact", "vy_teacher_sheet"];
ok("long clone writers gain validated cascade backstops on the exact erased agent",
  agentPayloadTables.every((table) =>
    ownedWriteFenceMigration.includes(`constraint ${table}_agent_fk`) &&
    ownedWriteFenceMigration.includes(`alter table ${table} validate constraint ${table}_agent_fk`) &&
    schema.includes(`constraint ${table}_agent_fk`)));
ok("historical audit orphans are enforced prospectively but never falsely validated",
  /vy_replica_audit_replica_owner_fk[\s\S]*on delete cascade not valid/.test(ownedWriteFenceMigration) &&
  !/validate constraint vy_replica_audit_replica_owner_fk/.test(ownedWriteFenceMigration));
ok("canonical schema declares the video enrollment table before its mirrored columns and indexes",
  schema.indexOf("create table if not exists vy_video_enrollment (") >= 0 &&
  schema.indexOf("create table if not exists vy_video_enrollment (") < schema.indexOf("vy_video_enrollment_daily_ix"));
ok("the scheduled endpoint prepares children then erases voice source and replica in dependency order",
  endpoint.lastIndexOf("prepareReplicaErasures") < endpoint.lastIndexOf("runVoiceErasureSweep") &&
  endpoint.lastIndexOf("runVoiceErasureSweep") < endpoint.lastIndexOf("runSourceErasureSweep") &&
  endpoint.lastIndexOf("runSourceErasureSweep") < endpoint.lastIndexOf("runReplicaErasureFinalizer"));
ok("Face broker construction is isolated inside the settled lane so configuration failure cannot starve erasure",
  /const faceWork = Promise\.resolve\(\)\.then\(\(\) => \{\s*const faceBroker = configuredFaceSessionErasureBroker\(\)/s.test(endpoint) &&
  /Promise\.allSettled\(\[\s*faceWork,\s*runVoiceErasureSweep/s.test(endpoint));

console.log(`\n${checks} full replica erasure checks passed`);
