import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  completeSourceErasure,
  leaseNextSourceErasure,
  normalizeSourceErasureFailure,
  retrySourceErasure,
  runSourceErasureSweep,
  sourceErasureLeaseTokenHash,
} from "../../api/_replica-source-erasure.js";
import { deleteReplicaObjects } from "../../api/_replica-storage.js";
import { splitSql } from "../../db/migrations/apply.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const SOURCE = "10000000-0000-4000-8000-000000000001";
const RID = "20000000-0000-4000-8000-000000000002";
const OWNER = "30000000-0000-4000-8000-000000000003";
const TOKEN = "source-lease-token-with-at-least-thirty-two-bytes";
const PREFIX = `${OWNER}/${RID}/${SOURCE}/`;
let checks = 0;

function ok(name, condition) {
  assert.ok(condition, name);
  console.log(`ok ${++checks} - ${name}`);
}

const hash = sourceErasureLeaseTokenHash(TOKEN);
ok("source erasure leases persist only a domain-separated hash", /^[0-9a-f]{64}$/.test(hash));

let leaseSql = "";
const claimed = await leaseNextSourceErasure(async (sql, params) => {
  leaseSql = sql;
  assert.equal(params[0], hash);
  return [{
    source_id: SOURCE, replica_id: RID, owner_user_id: OWNER,
    storage_bucket: "vyakti-replica-private", object_path: `${PREFIX}original`,
    erasure_attempts: 1, erasure_lease_expires_at: new Date(Date.now() + 200_000).toISOString(),
    artifacts: [
      { bucket: "vyakti-replica-private", path: `${PREFIX}derived/enhance/a.wav` },
      { bucket: "vyakti-replica-private", path: `${PREFIX}derived/diarize/a.json` },
    ],
  }];
}, { token: TOKEN, leaseMs: 240_000 });
ok("one atomic lease snapshots the original plus every exact derived artifact before manifests can disappear",
  /for update skip locked limit 1/.test(leaseSql) && /vy_replica_processing_artifact/.test(leaseSql) && claimed.source.paths.length === 3);
ok("deletion paths remain inside the exact owner replica source namespace",
  claimed.source.paths.every((path) => path.startsWith(PREFIX)) && claimed.source.paths.includes(`${PREFIX}original`));

let unsafeRetry = "";
const unsafe = await leaseNextSourceErasure(async (sql) => {
  if (sql.includes("with candidate as")) return [{
    source_id: SOURCE, replica_id: RID, owner_user_id: OWNER,
    storage_bucket: "vyakti-replica-private", object_path: `${PREFIX}original`,
    erasure_attempts: 2, artifacts: [{ bucket: "vyakti-replica-private", path: `${OWNER}/another-replica/stolen` }],
  }];
  unsafeRetry = sql;
  return [{ source_id: SOURCE }];
}, { token: TOKEN });
ok("a corrupt cross-namespace artifact is not deleted and is durably quarantined for operator repair",
  unsafe === null && /erasure_last_error_code=\$6/.test(unsafeRetry));

process.env.SUPABASE_URL = "https://private.example";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-private-service-role";
const storageCalls = [];
await deleteReplicaObjects(Array.from({ length: 205 }, (_, index) => `${PREFIX}derived/test/${index}`), async (url, init) => {
  storageCalls.push({ url, init, body: JSON.parse(init.body) });
  return Response.json({ message: "ok" });
});
ok("large derivative sets are removed as bounded exact-name batches",
  storageCalls.length === 3 && storageCalls[0].body.prefixes.length === 100 && storageCalls[2].body.prefixes.length === 5);
ok("storage erasure uses the private bucket service path and never a public URL",
  storageCalls.every((call) => call.url === "https://private.example/storage/v1/object/vyakti-replica-private"));

let completeSql = "";
await completeSourceErasure(async (sql, params) => {
  completeSql = sql;
  assert.equal(params[3], hash);
  return [{ source_id: SOURCE }];
}, claimed);
ok("source completion is fenced until every external provider voice mapping is gone",
  /not exists \(select 1 from vy_replica_voice_profile/.test(completeSql));
ok("source completion removes cited claims and cascaded processing lineage only after object deletion",
  /delete from vy_replica_claim/.test(completeSql) && /delete from vy_replica_source/.test(completeSql));
ok("untraceable derived person voice and calibration definitions are scrubbed rather than merely retired",
  /update vy_replica_voice_genome/.test(completeSql) && /update vy_replica_profile/.test(completeSql) &&
  /update vy_replica_calibration/.test(completeSql) && /'erased',true/.test(completeSql));
ok("feedback datasets and candidate adapters are retired and their definitions cannot retain source content",
  /update vy_replica_feedback_dataset/.test(completeSql) && /update vy_replica_candidate/.test(completeSql));
ok("content-free public generation receipts are not destroyed by private-source erasure",
  !completeSql.includes("vy_replica_generation_receipt") && !completeSql.includes("vy_replica_generation_segment_receipt"));

let retrySql = "";
await retrySourceErasure(async (sql, params) => {
  retrySql = sql;
  assert.equal(params[5], "provider_voice_erasure_pending");
  return [{ source_id: SOURCE }];
}, claimed, { error: { code: "source_erasure_waiting_for_provider" }, retryAfterMs: 60_000 });
ok("provider deletion races return the disabled source to retry instead of dropping its manifest",
  /state='deleting'/.test(retrySql) && /erasure_lease_token_hash=''/.test(retrySql));
ok("raw storage failures are reduced to finite content-free reason codes",
  normalizeSourceErasureFailure({ code: "private_storage_unreachable" }) === "private_storage_unreachable" &&
  normalizeSourceErasureFailure(new Error("raw secret payload")) === "source_erasure_failed");

const work = [claimed, { ...claimed, source: { ...claimed.source, sourceId: "40000000-0000-4000-8000-000000000004", attempt: 2 } }];
const removed = [];
const completed = [];
const retried = [];
const summary = await runSourceErasureSweep({
  db: async () => [], maxJobs: 4,
  lease: async () => work.shift() || null,
  removeObjects: async (paths) => {
    removed.push(paths);
    if (removed.length === 2) throw Object.assign(new Error("private detail"), { code: "private_storage_unreachable" });
  },
  complete: async (_db, lease) => completed.push(lease.source.sourceId),
  retry: async (_db, lease, input) => retried.push({ source: lease.source.sourceId, code: normalizeSourceErasureFailure(input.error) }),
});
ok("one failed source cannot undo or misreport a separately completed erasure",
  summary.completed === 1 && summary.retried === 1 && completed.length === 1 && retried[0].code === "private_storage_unreachable");

const migration = readFileSync(join(ROOT, "db/migrations/036_replica_source_erasure.sql"), "utf8");
const schema = readFileSync(join(ROOT, "db/schema.sql"), "utf8");
const sourceRoute = readFileSync(join(ROOT, "api/replica-source.js"), "utf8");
const sourceCore = readFileSync(join(ROOT, "api/_replica-source.js"), "utf8");
const sweep = readFileSync(join(ROOT, "api/replica-erasure-sweep.js"), "utf8");
ok("source erasure migration is splitter-safe and mirrored in canonical schema",
  splitSql(migration).length >= 9 && schema.includes("vy_replica_source_erasure_attempt"));
ok("the HTTP delete path can no longer delete only the original and orphan derived blobs",
  !sourceRoute.includes("deleteReplicaObject(") && sourceRoute.includes("erasure: \"pending\""));
ok("source deletion revokes capabilities sessions and open generations synchronously",
  sourceCore.includes("runtime_capabilities as") && sourceCore.includes("runtime_sessions as") && sourceCore.includes("open_generations as"));
ok("the authenticated scheduled reconciler runs provider erasure before source erasure",
  sweep.indexOf("runVoiceErasureSweep") < sweep.indexOf("runSourceErasureSweep"));

console.log(`\n${checks} source erasure checks passed`);
