// Read-only parser gate for migration 072's production statements. EXPLAIN
// without ANALYZE plans data-modifying CTEs but executes none of them.
import { q } from "../../api/_db.js";
import { createSelfReplicaWithIntent } from "../../api/_replica.js";
import { createPendingSource } from "../../api/_replica-source.js";
import { advanceOwnedVoiceBuildIntent, requestOwnedVoiceGenomeBuild } from "../../api/_replica-build-intent.js";

const OWNER = "10000000-0000-4000-8000-000000000001";
const REPLICA = "20000000-0000-4000-8000-000000000002";
const CREATE_INTENT = "30000000-0000-4000-8000-000000000003";
const UPLOAD_INTENT = "40000000-0000-4000-8000-000000000004";
const BUILD_INTENT = "50000000-0000-4000-8000-000000000005";
const SOURCE = "60000000-0000-4000-8000-000000000006";
const HASH = "a".repeat(64);

const [shape] = await q(
  `select to_regclass('public.vy_replica_voice_build_intent') is not null build_intent_table,
          to_regclass('public.vy_replica_voice_reference') is not null voice_reference_table,
          to_regclass('public.vy_replica_model_build') is not null model_build_table,
          exists(select 1 from pg_indexes where schemaname='public'
            and indexname='vy_replica_source_owner_locator_ix') source_owner_locator,
          exists(select 1 from information_schema.columns where table_schema='public'
            and table_name='vy_replica' and column_name='creation_intent_id') creation_intent_column,
          exists(select 1 from information_schema.columns where table_schema='public'
            and table_name='vy_replica_source' and column_name='upload_intent_id') upload_intent_column,
          exists(select 1 from information_schema.columns where table_schema='public'
            and table_name='vy_replica_voice_build_intent' and column_name='candidate_source_id') candidate_source_column,
          exists(select 1 from information_schema.columns where table_schema='public'
            and table_name='vy_replica_voice_build_intent' and column_name='promoted_at') promoted_column`,
);
if (!shape?.voice_reference_table || !shape?.model_build_table || !shape?.source_owner_locator) {
  throw new Error("migration 072 prerequisite schema is not live");
}
if (!shape?.build_intent_table || !shape?.creation_intent_column || !shape?.upload_intent_column
  || !shape?.candidate_source_column || !shape?.promoted_column) {
  console.log("SKIP clone creation saga live EXPLAIN: migration 072 is not applied");
  process.exit(0);
}

async function explain(label, sql, params) {
  await q(`explain (format json) ${sql}`, params, 30_000);
  console.log(`ok - ${label}`);
}

let captured;
await createSelfReplicaWithIntent(async (sql, params) => {
  captured = { sql, params };
  return [{
    replica_id: REPLICA, display_name: "Me", subject_mode: "self", lifecycle: "consent_pending",
    policy_version: "replica-self-v1", creation_intent_id: CREATE_INTENT,
    age_verified_at: null, identity_verified_at: null, liveness_verified_at: null,
    identity_expires_at: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    created: true,
  }];
}, OWNER, "Me", CREATE_INTENT);
await explain("idempotent replica creation parses", captured.sql, captured.params);

await createPendingSource(async (sql, params) => {
  captured = { sql, params };
  return [{
    source_id: SOURCE, replica_id: REPLICA, owner_user_id: OWNER,
    kind: "audio", capture_mode: "upload", storage_bucket: "private",
    object_path: `${OWNER}/${REPLICA}/60000000-0000-4000-8000-000000000006/original`,
    mime: "audio/wav", byte_size: 48_000, sha256: HASH, state: "pending_upload",
    contains_third_parties: false, upload_intent_id: UPLOAD_INTENT, language_hint: "hi-latn",
    provenance: { purpose: "memory" }, rejection_code: "", created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(), intent_replayed: false,
  }];
}, OWNER, REPLICA, {
  kind: "audio", mime: "audio/wav", byte_size: 48_000, sha256: HASH,
  contains_third_parties: false, upload_intent_id: UPLOAD_INTENT, language_hint: "hi-latn",
});
await explain("idempotent source creation parses", captured.sql, captured.params);

let first = true;
await requestOwnedVoiceGenomeBuild(async (sql, params) => {
  if (first) {
    first = false;
    captured = { sql, params };
    return [];
  }
  return [];
}, OWNER, { replica_id: REPLICA, build_intent_id: BUILD_INTENT, candidate_source_id: SOURCE });
await explain("durable voice build intent creation parses", captured.sql, captured.params);

let promoted = false;
await advanceOwnedVoiceBuildIntent(async (sql, params) => {
  if (/source\.primary_voice\.promote_after_build/i.test(sql)) {
    captured = { sql, params };
    promoted = true;
    return [{ intent_id: BUILD_INTENT }];
  }
  if (/select i\.intent_id,i\.replica_id/i.test(sql)) {
    return [{
      intent_id: BUILD_INTENT, replica_id: REPLICA, owner_user_id: OWNER,
      candidate_source_id: SOURCE, state: promoted ? "review" : "queued", build_id: CREATE_INTENT,
      build_state: "review", target_version: 1, blockers: [], last_error_code: "",
      promoted_at: promoted ? new Date().toISOString() : null,
      next_check_at: new Date().toISOString(), created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(), candidate_state: "ready", candidate_kind: "audio",
      candidate_capture_mode: "upload", candidate_contains_third_parties: false,
    }];
  }
  return [];
}, OWNER, { replica_id: REPLICA, build_intent_id: BUILD_INTENT });
await explain("candidate draft promotion parses", captured.sql, captured.params);

console.log("clone creation saga live EXPLAIN: ok (no ANALYZE, no writes)");
