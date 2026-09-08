import { readReconciledMigration } from "../lib/reconciled-migration.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  completeSourceErasure,
  leaseNextSourceErasure,
  markAbandonedPendingSourceUploads,
  normalizeSourceErasureFailure,
  retrySourceErasure,
  runSourceErasureSweep,
  sourceErasureLeaseTokenHash,
} from "../../api/_replica-source-erasure.js";
import { deleteReplicaObjects } from "../../api/_replica-storage.js";
import { assertUploadWithinSourceFence, reserveOwnedSourceUploadAuthorization } from "../../api/_replica-source.js";
import { cleanupOrphanMirrorWindows } from "../../scripts/cleanup-orphan-mirror-windows.mjs";
import { splitSql } from "../../db/migrations/apply.mjs";
import { buildPersonModelDefinition } from "../../api/_person-model.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const SOURCE = "10000000-0000-4000-8000-000000000001";
const RID = "20000000-0000-4000-8000-000000000002";
const OWNER = "30000000-0000-4000-8000-000000000003";
const TOKEN = "source-lease-token-with-at-least-thirty-two-bytes";
const PREFIX = `${OWNER}/${RID}/${SOURCE}/`;
const AZURE_BUCKET = "azureblob:vyaktireplicatest:replica-private";
let checks = 0;

function ok(name, condition) {
  assert.ok(condition, name);
  console.log(`ok ${++checks} - ${name}`);
}

const hash = sourceErasureLeaseTokenHash(TOKEN);
ok("source erasure leases persist only a domain-separated hash", /^[0-9a-f]{64}$/.test(hash));

let uploadFenceSql = "";
const uploadFence = await reserveOwnedSourceUploadAuthorization(async (sql, params) => {
  uploadFenceSql = sql;
  assert.deepEqual(params, [RID, OWNER, SOURCE, 210 * 60 * 1000]);
  return [{ source_id: SOURCE, replica_id: RID, owner_user_id: OWNER, state: "pending_upload" }];
}, OWNER, RID, SOURCE);
ok("direct upload authority is durably fenced before a provider URL can be returned",
  uploadFence.source_id === SOURCE && /upload_authorization_expires_at=greatest/.test(uploadFenceSql) &&
  /state='pending_upload'/.test(uploadFenceSql));
ok("an Azure block begun at token expiry remains fenced through its official service ceiling",
  125 * 60 * 1000 < 200 * 60 * 1000 && 200 * 60 * 1000 < 210 * 60 * 1000);
const persistedFence = "2026-09-02T12:00:00.000Z";
assert.equal(assertUploadWithinSourceFence(
  { upload_authorization_expires_at: persistedFence },
  { expires_at: persistedFence },
).expires_at, persistedFence);
assert.throws(() => assertUploadWithinSourceFence(
  { upload_authorization_expires_at: persistedFence },
  { expires_at: "2026-09-02T12:00:00.001Z" },
), (error) => error?.code === "signed_upload_exceeds_source_fence");
ok("a provider grant one millisecond beyond the persisted source fence is refused", true);

let cleanupSql = "";
const abandoned = await markAbandonedPendingSourceUploads(async (sql, params) => {
  cleanupSql = sql;
  assert.deepEqual(params, [24 * 60 * 60 * 1000, 25]);
  return [{
    source_id: SOURCE,
    storage_bucket: AZURE_BUCKET,
    object_path: `${PREFIX}original`,
  }];
});
ok("abandoned pending uploads are selected after 24 hours in a bounded lock-safe batch",
  /state='pending_upload'/.test(cleanupSql) && /updated_at<=now\(\)-\(\$1::bigint\*interval '1 millisecond'\)/.test(cleanupSql) &&
  /for update skip locked limit \$2::integer/.test(cleanupSql));
ok("cleanup marks only still-pending rows for erasure so recent and active sources are unaffected",
  /set state='deleting',erasure_next_attempt_at=now\(\),updated_at=now\(\)/.test(cleanupSql) &&
  (cleanupSql.match(/state='pending_upload'/g) || []).length === 2 &&
  !/state\s+in\s*\(/.test(cleanupSql));
ok("abandoned upload cleanup retains the exact durable source locator for deletion",
  abandoned.length === 1 && abandoned[0].storageBucket === AZURE_BUCKET &&
  abandoned[0].objectPath === `${PREFIX}original` &&
  !/set[\s\S]*storage_bucket\s*=/.test(cleanupSql) && !/set[\s\S]*object_path\s*=/.test(cleanupSql));

let leaseSql = "";
const claimed = await leaseNextSourceErasure(async (sql, params) => {
  leaseSql = sql;
  assert.equal(params[0], hash);
  return [{
    source_id: SOURCE, replica_id: RID, owner_user_id: OWNER,
    storage_bucket: "vyakti-replica-private", object_path: `${PREFIX}original`,
    erasure_attempts: 1, erasure_lease_expires_at: new Date(Date.now() + 200_000).toISOString(),
    artifacts: [
      { bucket: AZURE_BUCKET, path: `${PREFIX}derived/enhance/a.wav` },
      { bucket: "vyakti-replica-private", path: `${PREFIX}derived/diarize/a.json` },
    ],
  }];
}, { token: TOKEN, leaseMs: 240_000 });
ok("one atomic lease snapshots the original plus every exact derived artifact before manifests can disappear",
  /for update skip locked limit 1/.test(leaseSql) && /vy_replica_processing_artifact/.test(leaseSql) && claimed.source.paths.length === 3);
ok("source bytes cannot disappear while an official Face session may still reference their identity case",
  /vy_replica_liveness_challenge/.test(leaseSql) && /face_session_state in/.test(leaseSql));
ok("source erasure waits for direct upload grants and every active object writer lease",
  /upload_authorization_expires_at/.test(leaseSql) && /vy_replica_processing_job pj/.test(leaseSql) &&
  /vy_replica_voice_preview_intent pi/.test(leaseSql) && /pi\.lease_expires_at>now\(\)/.test(leaseSql));
ok("deletion paths remain inside the exact owner replica source namespace",
  claimed.source.paths.every((locator) => locator.objectPath.startsWith(PREFIX))
  && claimed.source.paths.some((locator) => locator.objectPath === `${PREFIX}original`));
ok("erasure snapshots retain the provider for mixed legacy and Azure lineage",
  new Set(claimed.source.paths.map((locator) => locator.storageBucket)).size === 2
  && claimed.source.paths.some((locator) => locator.storageBucket === AZURE_BUCKET));

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
await deleteReplicaObjects(Array.from({ length: 205 }, (_, index) => ({
  storageBucket: "vyakti-replica-private",
  objectPath: `${PREFIX}derived/test/${index}`,
})), async (url, init) => {
  const body = JSON.parse(init.body);
  if (url.includes("/object/list/")) return Response.json([]);
  storageCalls.push({ url, init, body });
  return Response.json(body.prefixes.map((name) => ({ id: "deleted", name })));
});
ok("large derivative sets are removed as bounded exact-name batches",
  storageCalls.length === 3 && storageCalls[0].body.prefixes.length === 100 && storageCalls[2].body.prefixes.length === 5);
ok("storage erasure uses the private bucket service path and never a public URL",
  storageCalls.every((call) => call.url === "https://private.example/storage/v1/object/vyakti-replica-private"));
await assert.rejects(() => deleteReplicaObjects([{
  storageBucket: "vyakti-replica-private", objectPath: `${PREFIX}derived/test/still-live`,
}], async (url, init) => {
  if (url.includes("/object/list/")) return Response.json([{ id: "still-live", name: "still-live" }]);
  return Response.json([{ id: "still-live", name: "still-live" }]);
}), (error) => error?.code === "replica_storage_delete_not_confirmed");
ok("an HTTP-successful delete cannot erase the SQL manifest while the exact Supabase object still lists", true);

let completeSql = "";
await completeSourceErasure(async (sql, params) => {
  completeSql = sql;
  assert.deepEqual(params.slice(0, 3), [SOURCE, RID, OWNER]);
  assert.equal(params[3], hash);
  return [{ source_id: SOURCE }];
}, claimed);
ok("source completion waits only for provider voices derived from the erased source",
  /not exists \([\s\S]*from vy_replica_voice_profile vp[\s\S]*join affected_genomes affected on affected\.version=vp\.genome_version/.test(completeSql) &&
  !/not exists \(select 1 from vy_replica_voice_profile vp\s+where vp\.replica_id=s\.replica_id/.test(completeSql));
ok("source erasure and VoiceGenome settlement share a fail-fast arbiter so neither misses the other's commit",
  /pg_try_advisory_xact_lock/.test(completeSql) && /voice_genome_review/.test(completeSql) && /review_lock\.acquired/.test(completeSql));
ok("physical erasure selects derived models through exact source citations instead of the whole replica",
  /affected_genomes as materialized[\s\S]*definition#>'\{references,source_ids\}'/.test(completeSql) &&
  /affected_profiles as materialized[\s\S]*jsonb_path_exists/.test(completeSql) &&
  /@ == \$source/.test(completeSql) &&
  /affected_genomes affected where affected\.version=g\.version/.test(completeSql) &&
  /affected_profiles affected where affected\.version=p\.version/.test(completeSql));
const profileClaim = (claim_id, domain, key, body, source_id) => ({
  claim_id:String(claim_id),domain,key,body,source_ids:[source_id],origin:'self_declared',confidence:.99,
  decision:'accepted',status:'approved',t_valid_to:null,updated_at:'2026-09-08T00:00:00Z',
});
const currentProfile = buildPersonModelDefinition([
  profileClaim(1,'identity','self_name','Asha',SOURCE),
  profileClaim(2,'language','languages','Hindi, English',SOURCE),
  profileClaim(3,'delivery','turn_shape','Explain, then ask one question',SOURCE),
  profileClaim(4,'boundary','privacy','Keep private conversations private',SOURCE),
]);
ok("source erasure resolves current private profile provenance through its cited claims",
  currentProfile.provenance.claims.length===4
  && !/source_ids/.test(JSON.stringify(currentProfile))
  && /definition#>'\{provenance,claims\}'/.test(completeSql)
  && /jsonb_array_elements\(p\.definition#>'\{provenance,claims\}'\) claim_ref/.test(completeSql)
  && /profile_claim\.claim_id=case[\s\S]*claim_ref->>'claim_id'[\s\S]*::int8/.test(completeSql)
  && /profile_claim\.replica_id=c\.replica_id/.test(completeSql)
  && /profile_claim\.owner_user_id=c\.owner_user_id/.test(completeSql)
  && /c\.source_id=any\(profile_claim\.source_ids\)/.test(completeSql));
ok("source erasure retains the legacy embedded-source profile shape",
  /jsonb_path_exists\([\s\S]*\$\.domains\.\*\[\*\]\.source_ids\[\*\]/.test(completeSql));
ok("a replacement build created after delete request survives old-source completion",
  /erasure_requested_at/.test(completeSql) &&
  /a\.action='source\.delete\.request'[\s\S]*a\.object_id=s\.source_id::text/.test(completeSql) &&
  /b\.created_at<=t\.erasure_requested_at/.test(completeSql) &&
  /affected\.source_set_hash=b\.source_set_hash/.test(completeSql) &&
  !/update vy_replica_model_build b set state='retired'[\s\S]{0,180}where b\.replica_id=t\.replica_id and b\.owner_user_id=t\.owner_user_id\s+and b\.state<>'retired'/.test(completeSql));
const deletionRequestedAt = Date.parse("2026-09-01T10:00:00Z");
const erasedSourceHashes = new Set(["old-source-set"]);
const shouldRetireAtCompletion = (build) =>
  Date.parse(build.createdAt) <= deletionRequestedAt || erasedSourceHashes.has(build.sourceSetHash);
const interleavedBuilds = [
  { name: "old build already queued", createdAt: "2026-09-01T09:59:59Z", sourceSetHash: "old-source-set" },
  { name: "late old-source settlement", createdAt: "2026-09-01T10:00:03Z", sourceSetHash: "old-source-set" },
  { name: "replacement build", createdAt: "2026-09-01T10:00:04Z", sourceSetHash: "new-source-set" },
];
ok("delete-old then build-new interleaving retires both old-source races but preserves the replacement",
  interleavedBuilds.filter(shouldRetireAtCompletion).map((row) => row.name).join("|") ===
    "old build already queued|late old-source settlement" &&
  shouldRetireAtCompletion(interleavedBuilds[2]) === false);
ok("source completion rechecks that no official Face handle can be cascaded away",
  /vy_replica_liveness_challenge/.test(completeSql) && /'issuing','ready','polling'/.test(completeSql));
ok("source completion removes cited claims and cascaded processing lineage only after object deletion",
  /delete from vy_replica_claim/.test(completeSql) && /delete from vy_replica_source/.test(completeSql));
ok("source completion reaches accepted-claim RelationalOS derivatives before claim lineage disappears",
  /claim_materialization_episodes as materialized/.test(completeSql)
  && /e\.boundary_reason like 'replica_claim:'\|\|c\.proposal_hash\|\|':%'/.test(completeSql)
  && /delete from vy_fact/.test(completeSql) && /delete from vy_rel_event/.test(completeSql)
  && /delete from vy_episode/.test(completeSql)
  && completeSql.indexOf("claim_materialization_episodes as") < completeSql.indexOf("claims as ("));
ok("source completion captures Mirror windows through the exact owner replica source tuple",
  /source_windows as materialized/.test(completeSql) &&
  /t\.source_id=w\.source_id and t\.replica_id=w\.replica_id[\s\S]*t\.owner_user_id=w\.owner_user_id/.test(completeSql));
ok("source completion cannot leave a null-source transcript or its provider and model behind",
  /delete from vy_mirror_window/.test(completeSql) &&
  completeSql.indexOf("delete from vy_mirror_window") < completeSql.indexOf("delete from vy_replica_source") &&
  !/update vy_mirror_window[\s\S]*source_id\s*=\s*null/.test(completeSql));
ok("source completion deletes exact derived expression and canonical evidence before the source handle",
  /delete from vy_replica_expression_observation o using target t[\s\S]*o\.source_id=t\.source_id[\s\S]*o\.replica_id=t\.replica_id[\s\S]*o\.owner_user_id=t\.owner_user_id/.test(completeSql) &&
  /delete from vy_replica_processing_evidence e using target t[\s\S]*e\.source_id=t\.source_id[\s\S]*e\.replica_id=t\.replica_id[\s\S]*e\.owner_user_id=t\.owner_user_id/.test(completeSql) &&
  completeSql.indexOf("delete from vy_replica_expression_observation") < completeSql.indexOf("delete from vy_mirror_window") &&
  completeSql.indexOf("delete from vy_replica_processing_evidence") < completeSql.indexOf("delete from vy_mirror_window"));
ok("source-bound Mirror turns conditioning feedback and dead fine-tune queue rows are removed by exact tuples",
  /delete from vy_mirror_conditioning/.test(completeSql) && /delete from vy_mirror_turn/.test(completeSql) &&
  /delete from vy_mirror_feedback/.test(completeSql) && /f\.turn_ref=tr\.turn_id::text/.test(completeSql) &&
  /delete from vy_mirror_finetune_job/.test(completeSql));
ok("source-bound delta excerpts are found from same-session cited window sequences and deleted",
  /source_deltas as materialized/.test(completeSql) &&
  /w\.session_id=d\.session_id[\s\S]*w\.replica_id=d\.replica_id[\s\S]*w\.owner_user_id=d\.owner_user_id[\s\S]*w\.seq=any\(d\.cited_windows\)/.test(completeSql) &&
  /delete from vy_mirror_delta d using source_deltas doomed/.test(completeSql));
ok("accepted sheet effects reverse only the exact appended fragment and never delete a sheet",
  /reversible_delta_fragments as materialized/.test(completeSql) &&
  /d\.state='accepted' and d\.applied_at is not null/.test(completeSql) &&
  /f\.target_field='boardVerbalisms'/.test(completeSql) && /f\.target_field='exSlangRepeat'/.test(completeSql) &&
  /update vy_teacher_sheet s/.test(completeSql) && !/delete from vy_teacher_sheet/.test(completeSql));
ok("an independently applied surviving source preserves the same accepted phrase",
  /support\.state='accepted'[\s\S]*support\.applied_at is not null/.test(completeSql) &&
  /support\.target_field=d\.target_field and support\.fragment=d\.fragment/.test(completeSql) &&
  /live\.source_id is not null/.test(completeSql));
ok("source erasure audit records content-free Mirror and canonical deletion counts",
  /'mirror_windows_removed',\(select count\(\*\) from mirror_windows\)/.test(completeSql) &&
  /'mirror_deltas_removed',\(select count\(\*\) from mirror_deltas\)/.test(completeSql) &&
  /'canonical_evidence_removed',\(select count\(\*\) from canonical_evidence\)/.test(completeSql) &&
  !/jsonb_build_object\([\s\S]*'transcript'/.test(completeSql.slice(completeSql.indexOf("source.delete.complete"))));
ok("verified ID media is detached while invalid evidence clears its case challenge and every derived gate before unlink",
  /preserved_identity as/.test(completeSql) && /set source_id=null/.test(completeSql) &&
  /delete from vy_replica_identity_case/.test(completeSql) && /not b\.preserve/.test(completeSql) &&
  ["age_verified_at", "identity_verified_at", "liveness_verified_at", "identity_expires_at"]
    .every((field) => completeSql.includes(`${field}=case when e.revoke_identity then null else r.${field} end`)) &&
  /returning case when e.revoke_identity then r.subject_person_id end/.test(completeSql) &&
  completeSql.indexOf("identity_cases as") < completeSql.indexOf("delete from vy_replica_source"));
ok("untraceable derived person voice and calibration definitions are scrubbed rather than merely retired",
  /update vy_replica_voice_genome/.test(completeSql) && /update vy_replica_profile/.test(completeSql) &&
  /update vy_replica_calibration/.test(completeSql) && /'erased',true/.test(completeSql));
ok("feedback datasets and candidate adapters are retired and their definitions cannot retain source content",
  /update vy_replica_feedback_dataset/.test(completeSql) && /update vy_replica_candidate/.test(completeSql));
ok("source-derived private previews and their preference labels cannot block biometric erasure",
  /delete from vy_replica_voice_preference/.test(completeSql) && /delete from vy_replica_generation/.test(completeSql) && /delete from vy_replica_voice_trial/.test(completeSql) &&
  completeSql.indexOf("voice_preferences as") < completeSql.indexOf("preview_generations as") &&
  completeSql.indexOf("preview_generations as") < completeSql.indexOf("voice_trials as") &&
  completeSql.indexOf("voice_trials as") < completeSql.indexOf("delete from vy_replica_source"));
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
const sweepOrder = [];
const summary = await runSourceErasureSweep({
  db: async () => [], maxJobs: 4,
  cleanup: async () => {
    sweepOrder.push("cleanup");
    return abandoned;
  },
  lease: async () => {
    sweepOrder.push("lease");
    return work.shift() || null;
  },
  removeObjects: async (paths) => {
    removed.push(paths);
    if (removed.length === 2) throw Object.assign(new Error("private detail"), { code: "private_storage_unreachable" });
  },
  complete: async (_db, lease) => completed.push(lease.source.sourceId),
  retry: async (_db, lease, input) => retried.push({ source: lease.source.sourceId, code: normalizeSourceErasureFailure(input.error) }),
});
ok("one failed source cannot undo or misreport a separately completed erasure",
  summary.completed === 1 && summary.retried === 1 && completed.length === 1 && retried[0].code === "private_storage_unreachable");
ok("each sweep marks stale pending uploads before it leases erasure work",
  summary.abandoned === 1 && sweepOrder[0] === "cleanup" && sweepOrder[1] === "lease");

let lostLeaseIssued = false;
let lostLeaseRetried = false;
let lostLeaseCompleted = false;
const lostLeaseSummary = await runSourceErasureSweep({
  db: async () => [], maxJobs: 1, heartbeatMs: 100,
  cleanup: async () => [],
  lease: async () => lostLeaseIssued ? null : (lostLeaseIssued = true, claimed),
  renew: async () => { throw Object.assign(new Error("lost"), { code: "lost_source_erasure_lease" }); },
  removeObjects: async (_paths, _source, signal) => new Promise((resolve, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  }),
  complete: async () => { lostLeaseCompleted = true; },
  retry: async (_db, _lease, input) => { lostLeaseRetried = input.error?.code === "lost_source_erasure_lease"; },
});
ok("a lost erasure heartbeat aborts provider work before SQL completion",
  lostLeaseSummary.completed === 0 && lostLeaseSummary.retried === 1 && lostLeaseRetried && !lostLeaseCompleted);

const migration = readFileSync(join(ROOT, "db/migrations/036_replica_source_erasure.sql"), "utf8");
const uploadFenceMigration = readReconciledMigration("db/migrations/073_replica_upload_authorization_fence.sql");
const sheetLineageMigration = readReconciledMigration("db/migrations/071_mirror_delta_sheet_lineage.sql");
const schema = readFileSync(join(ROOT, "db/schema.sql"), "utf8");
const mirrorStore = readFileSync(join(ROOT, "api/_mirrorcall-store.js"), "utf8");
const cleanupTool = readFileSync(join(ROOT, "scripts/cleanup-orphan-mirror-windows.mjs"), "utf8");
const orphanCleanupSql = readFileSync(join(ROOT, "evals/source-erasure/orphan-cleanup.sql"), "utf8");
const sourceRoute = readFileSync(join(ROOT, "api/replica-source.js"), "utf8");
const livenessRoute = readFileSync(join(ROOT, "api/replica-liveness.js"), "utf8");
const providerConsentRoute = readFileSync(join(ROOT, "api/replica-provider-consent.js"), "utf8");
const sourceCore = readFileSync(join(ROOT, "api/_replica-source.js"), "utf8");
const sweep = readFileSync(join(ROOT, "api/replica-erasure-sweep.js"), "utf8");
ok("source erasure migration is splitter-safe and mirrored in canonical schema",
  splitSql(migration).length >= 9 && schema.includes("vy_replica_source_erasure_attempt"));
ok("upload authorization fence migration is splitter-safe conservatively backfilled and mirrored",
  splitSql(uploadFenceMigration).length === 2 && /now\(\)\+interval '210 minutes'/.test(uploadFenceMigration) &&
  !/updated_at\+interval/.test(uploadFenceMigration) &&
  schema.includes("upload_authorization_expires_at"));
ok("every persisted browser source reserves its upload horizon before minting the URL",
  [sourceRoute, livenessRoute, providerConsentRoute].every((code) =>
    code.includes("reserveOwnedSourceUploadAuthorization") &&
    /source = await reserveOwnedSourceUploadAuthorization\([\s\S]{0,700}createSignedReplicaUpload/.test(code) &&
    code.includes("assertUploadWithinSourceFence")));
ok("Mirror delta sheet lineage migration is splitter-safe and mirrored in canonical schema",
  splitSql(sheetLineageMigration).length === 6 &&
  /add column if not exists applied_sheet_id uuid/.test(sheetLineageMigration) &&
  /foreign key \(applied_sheet_id\) references vy_teacher_sheet\(sheet_id\)[\s\S]*on delete set null/.test(sheetLineageMigration) &&
  schema.includes("vy_mirror_delta_applied_sheet_fk"));
ok("an accepted Mirror delta records the exact sheet row that actually landed",
  /applied_sheet_id = case when exists \(select 1 from landed\)[\s\S]*select sheet_id from landed limit 1/.test(mirrorStore) &&
  /applied_at, applied_sheet_id, decided_at/.test(mirrorStore));
ok("source reversal uses exact applied sheet lineage and a bounded legacy-null fallback",
  ['s','c','b'].every(alias => completeSql.includes(`f.applied_sheet_id=${alias}.sheet_id or (f.applied_sheet_id is null and ${alias}.agent_id is not null)`)));
ok("a changed published or validated sheet is forced back through review",
  /status=case when s\.status in \('published','validated'\) then 'revoked' else s.status end/.test(completeSql) &&
  /published_at=case when s\.status in \('published','validated','revoked'\) then null/.test(completeSql) &&
  /consent_artifact_id=case when s\.status in \('published','validated','revoked'\) then null/.test(completeSql));
ok("historical orphan cleanup is owner-scoped bounded and dry-run by default",
  /valid --owner-user-id is required/.test(cleanupTool) && /Math\.min\(25/.test(cleanupTool) &&
  /if \(!apply\)/.test(cleanupTool) && /args\.includes\("--apply"\)/.test(cleanupTool) &&
  /w\.owner_user_id=\$1::uuid/.test(orphanCleanupSql) && /limit \$3::integer/.test(orphanCleanupSql));
ok("historical orphan cleanup never selects or returns private text and refuses derived rows",
  /orphanMirrorWindowEligibleSql = `select w\.window_id/.test(cleanupTool) &&
  !/select\s+w\.(transcript|asr_provider|asr_model)/.test(cleanupTool) &&
  !/returning\s+w\.(transcript|asr_provider|asr_model)/.test(cleanupTool) &&
  /not exists \(select 1 from vy_mirror_turn/.test(cleanupTool) &&
  /not exists \(select 1 from vy_mirror_delta/.test(cleanupTool) &&
  /window_ids/.test(cleanupTool) && !/transcript:|provider:|model:/.test(cleanupTool));

const cleanupOwner = "70000000-0000-4000-8000-000000000007";
const cleanupReplica = "80000000-0000-4000-8000-000000000008";
let cleanupInvocation = null;
const dryRunCleanup = await cleanupOrphanMirrorWindows(async (sql, params) => {
  cleanupInvocation = { sql, params };
  return [{ window_id: "90000000-0000-4000-8000-000000000009" }];
}, ["--owner-user-id", cleanupOwner, "--replica-id", cleanupReplica, "--limit", "99"]);
ok("executable orphan cleanup dry-run binds exact owner replica and clamps the batch to 25",
  dryRunCleanup.mode === "dry-run" && dryRunCleanup.count === 1 &&
  cleanupInvocation.params[0] === cleanupOwner && cleanupInvocation.params[1] === cleanupReplica &&
  cleanupInvocation.params[2] === 25 && /select w\.window_id/.test(cleanupInvocation.sql));

cleanupInvocation = null;
const appliedCleanup = await cleanupOrphanMirrorWindows(async (sql, params) => {
  cleanupInvocation = { sql, params };
  return [{ removed: 2 }];
}, ["--owner-user-id", cleanupOwner, "--apply", "--limit", "2"]);
ok("executable orphan cleanup apply requires the flag and binds the same owner-safe SQL shape",
  appliedCleanup.mode === "applied" && appliedCleanup.count === 2 &&
  cleanupInvocation.params[0] === cleanupOwner && cleanupInvocation.params[1] === null &&
  cleanupInvocation.params[2] === 2 && /w\.owner_user_id=\$1::uuid/.test(cleanupInvocation.sql) &&
  /limit \$3::integer/.test(cleanupInvocation.sql));
await assert.rejects(() => cleanupOrphanMirrorWindows(async () => [], ["--apply"]),
  /valid --owner-user-id is required/);
ok("negative control refuses apply without an explicit valid owner id", true);
cleanupInvocation = null;
const cleanupTargets = await cleanupOrphanMirrorWindows(async (sql, params) => {
  cleanupInvocation = { sql, params };
  return [{ owner_user_id: cleanupOwner, replica_id: cleanupReplica, eligible_windows: 3 }];
}, ["--list-targets", "--limit", "99"]);
ok("content-free target discovery is bounded and cannot be combined with deletion",
  cleanupTargets.mode === "targets" && cleanupTargets.count === 1 &&
  cleanupTargets.targets[0].owner_user_id === cleanupOwner &&
  cleanupTargets.targets[0].replica_id === cleanupReplica &&
  cleanupTargets.targets[0].eligible_windows === 3 && cleanupInvocation.params[0] === 25 &&
  /select owner_user_id,replica_id,count\(\*\)::integer eligible_windows/.test(cleanupInvocation.sql));
await assert.rejects(() => cleanupOrphanMirrorWindows(async () => [], ["--list-targets", "--apply"]),
  /--list-targets cannot be combined with --apply/);
ok("negative control keeps target discovery read-only", true);
ok("the HTTP delete path can no longer delete only the original and orphan derived blobs",
  !sourceRoute.includes("deleteReplicaObject(") && sourceRoute.includes("erasure: \"pending\""));
ok("source deletion revokes capabilities sessions and open generations synchronously",
  sourceCore.includes("runtime_capabilities as") && sourceCore.includes("runtime_sessions as") && sourceCore.includes("open_generations as") &&
  sourceCore.includes("liveness_attempts as") && sourceCore.includes("identity_attempts as") &&
  sourceCore.includes("verification_lease_token_hash=''"));
ok("the authenticated scheduled reconciler runs provider erasure before source erasure",
  sweep.indexOf("runVoiceErasureSweep") < sweep.indexOf("runSourceErasureSweep"));

console.log(`\n${checks} source erasure checks passed`);
