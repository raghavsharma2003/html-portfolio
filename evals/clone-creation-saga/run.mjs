import { readReconciledMigration } from "../lib/reconciled-migration.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { splitSql } from "../../db/migrations/apply.mjs";
import { createSelfReplicaWithIntent } from "../../api/_replica.js";
import {
  clientSource,
  createPendingSource,
  sourceUploadInput,
} from "../../api/_replica-source.js";
import {
  loadAcceptedVoiceGenomeInput,
} from "../../api/_replica-review.js";
import {
  reconcileVoiceBuildIntents,
  requestOwnedVoiceGenomeBuild,
} from "../../api/_replica-build-intent.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const OWNER = "10000000-0000-4000-8000-000000000001";
const REPLICA = "20000000-0000-4000-8000-000000000002";
const REPLICA_2 = "20000000-0000-4000-8000-000000000003";
const CREATE_INTENT = "30000000-0000-4000-8000-000000000003";
const CREATE_INTENT_2 = "30000000-0000-4000-8000-000000000004";
const UPLOAD_INTENT = "40000000-0000-4000-8000-000000000004";
const BUILD_INTENT = "50000000-0000-4000-8000-000000000005";
const BUILD_INTENT_2 = "50000000-0000-4000-8000-000000000007";
const BUILD = "60000000-0000-4000-8000-000000000006";
const SOURCE = "70000000-0000-4000-8000-000000000007";
const OLD_SOURCE = "80000000-0000-4000-8000-000000000008";
const HASH = "a".repeat(64);
let checks = 0;

function ok(name, value) {
  assert.ok(value, name);
  console.log(`ok ${++checks} - ${name}`);
}

function replicaRow(replicaId, intentId, created) {
  return {
    replica_id: replicaId,
    display_name: "Me",
    subject_mode: "self",
    lifecycle: "consent_pending",
    policy_version: "replica-self-v1",
    creation_intent_id: intentId,
    age_verified_at: null,
    identity_verified_at: null,
    liveness_verified_at: null,
    identity_expires_at: null,
    created_at: "2026-09-02T00:00:00.000Z",
    updated_at: "2026-09-02T00:00:00.000Z",
    created,
  };
}

const replicaIntents = new Map();
let replicaCreates = 0;
const replicaSql = [];
const replicaDb = async (sql, params) => {
  replicaSql.push(sql);
  const intentId = params[5];
  if (replicaIntents.has(intentId)) return [{ ...replicaIntents.get(intentId), created: false }];
  const row = replicaRow(replicaCreates++ ? REPLICA_2 : REPLICA, intentId, true);
  replicaIntents.set(intentId, row);
  return [row];
};

const firstReplica = await createSelfReplicaWithIntent(replicaDb, OWNER, "Me", CREATE_INTENT);
const replayedReplica = await createSelfReplicaWithIntent(replicaDb, OWNER, "A different retry label", CREATE_INTENT);
const secondReplica = await createSelfReplicaWithIntent(replicaDb, OWNER, "Me 2", CREATE_INTENT_2);
ok("one client creation intent returns one replica across response-loss retries",
  firstReplica.replica.replica_id === replayedReplica.replica.replica_id
  && !firstReplica.replayed && replayedReplica.replayed && replicaIntents.size === 2);
ok("a deliberate new creation intent creates a distinct replica",
  secondReplica.replica.replica_id !== firstReplica.replica.replica_id);
ok("replica idempotency is enforced by an owner-scoped partial unique arbiter",
  /on conflict \(owner_user_id, creation_intent_id\)[\s\S]*where creation_intent_id is not null do nothing/i.test(replicaSql[0])
  && /existing\.owner_user_id=\$1::uuid[\s\S]*existing\.creation_intent_id=\$6::uuid/i.test(replicaSql[0])
  && !/select\s+existing\.\*/i.test(replicaSql[0])
  && /existing\.replica_id[\s\S]*existing\.updated_at,false created/i.test(replicaSql[0]));
await assert.rejects(
  createSelfReplicaWithIntent(async () => { throw new Error("db must not run"); }, OWNER, "Me", "not-a-uuid"),
  (error) => error?.message === "valid_creation_intent_id_required" && error?.status === 400,
);
ok("malformed creation intents fail before SQL", true);
let gatedParams;
await assert.rejects(createSelfReplicaWithIntent(async (sql, params) => {
  assert.match(sql, /from account_bridge, gate\s+where gate.ok/);
  gatedParams = params;
  return [];
}, OWNER, "Me", CREATE_INTENT, { invitesRequired: true, inviteCode: "closed-door" }),
  (error) => error.code === "invite_invalid");
ok("a creation intent cannot bypass the invite predicate or replace its SQL parameters",
  gatedParams[4] === true && gatedParams[5] === CREATE_INTENT &&
  typeof gatedParams[3] === "string" && gatedParams[3] !== "closed-door");

const accepted = sourceUploadInput({
  kind: "audio",
  mime: "audio/wav",
  byte_size: 48_000,
  sha256: HASH,
  contains_third_parties: false,
  upload_intent_id: UPLOAD_INTENT,
  language_hint: "hi-latn",
});
ok("the durable voice language vocabulary is exactly English Hindi or Roman Hinglish",
  accepted.languageHint === "hi-latn");
for (const language of ["en-US", "hinglish", "auto"] ) {
  assert.throws(() => sourceUploadInput({
    kind: "audio", mime: "audio/wav", byte_size: 48_000, sha256: HASH,
    contains_third_parties: false, upload_intent_id: UPLOAD_INTENT, language_hint: language,
  }), /source_language_hint_invalid/);
}
assert.throws(() => sourceUploadInput({
  kind: "audio", mime: "audio/wav", byte_size: 48_000, sha256: HASH,
  contains_third_parties: false, upload_intent_id: UPLOAD_INTENT,
}), /source_language_hint_required/);
ok("an idempotent voice upload cannot silently lose or invent its language", true);

const sourceIntents = new Map();
const sourceSql = [];
const sourceDb = async (sql, params) => {
  sourceSql.push({ sql, params });
  const intentId = params[15];
  const existing = sourceIntents.get(intentId);
  if (existing) return [{ ...existing, intent_replayed: true }];
  const row = {
    source_id: SOURCE,
    replica_id: REPLICA,
    owner_user_id: OWNER,
    kind: params[3],
    capture_mode: params[11],
    storage_bucket: "private",
    object_path: `${OWNER}/${REPLICA}/70000000-0000-4000-8000-000000000007/original`,
    mime: params[6],
    byte_size: params[7],
    sha256: params[8],
    state: "pending_upload",
    contains_third_parties: params[9],
    upload_intent_id: intentId,
    language_hint: params[16],
    provenance: JSON.parse(params[10]),
    rejection_code: "",
    created_at: "2026-09-02T00:00:00.000Z",
    updated_at: "2026-09-02T00:00:00.000Z",
    intent_replayed: false,
  };
  sourceIntents.set(intentId, row);
  return [row];
};
const sourceInput = {
  kind: "audio", mime: "audio/wav", byte_size: 48_000, sha256: HASH,
  contains_third_parties: false, upload_intent_id: UPLOAD_INTENT, language_hint: "hi-latn",
};
const firstSource = await createPendingSource(sourceDb, OWNER, REPLICA, sourceInput);
const replayedSource = await createPendingSource(sourceDb, OWNER, REPLICA, sourceInput);
ok("one upload intent recovers the same private source handle after reload",
  firstSource.source_id === replayedSource.source_id && replayedSource.intent_replayed === true);
ok("source creation persists language and uses one partial conflict arbiter before replay",
  sourceSql[0].params[16] === "hi-latn"
  && /on conflict \(owner_user_id, replica_id, upload_intent_id\)[\s\S]*where upload_intent_id is not null do nothing/i.test(sourceSql[0].sql)
  && /not exists \(select 1 from inserted\)/i.test(sourceSql[0].sql)
  && /recovered as[\s\S]*s\.state<>'pending_upload'/i.test(sourceSql[0].sql));
await assert.rejects(
  createPendingSource(sourceDb, OWNER, REPLICA, { ...sourceInput, sha256: "b".repeat(64) }),
  (error) => error?.message === "upload_intent_conflict" && error?.status === 409,
);
ok("reusing an upload intent for different bytes is a named conflict", true);
const publicSource = clientSource({ ...firstSource, provenance: { secret: "no" }, voice_role: "supporting" });
ok("the source projection exposes recovery id and language but no storage digest or provenance",
  publicSource.upload_intent_id === UPLOAD_INTENT && publicSource.language_hint === "hi-latn"
  && !/(storage_bucket|object_path|sha256|provenance|owner_user_id)/.test(JSON.stringify(publicSource)));

function buildIntentHarness() {
  const state = { intent: null, build: null, queueCalls: 0, primarySourceId: OLD_SOURCE,
    candidateState: "ready", sql: [] };
  const db = async (sql, params) => {
    state.sql.push(sql);
    if (/insert into vy_replica_voice_build_intent/i.test(sql)) {
      if (state.intent) return [{ ...state.intent, intent_replayed: true }];
      state.intent = {
        intent_id: params[2], replica_id: params[0], owner_user_id: params[1], candidate_source_id: params[3],
        state: "waiting", build_id: null, blockers: [], last_error_code: "", promoted_at: null,
        expected_primary_selection_id: "90000000-0000-4000-8000-000000000009",
        next_check_at: "2026-09-02T00:00:30.000Z",
        created_at: "2026-09-02T00:00:00.000Z", updated_at: "2026-09-02T00:00:00.000Z",
      };
      return [{ ...state.intent, intent_replayed: false }];
    }
    if (/select i\.intent_id,i\.replica_id/i.test(sql) && /left join vy_replica_model_build/i.test(sql)) {
      if (!state.intent) return [];
      return [{ ...state.intent, build_state: state.build?.state || null,
        failure_code: state.build?.failure_code || "", target_version: state.build?.target_version || null,
        candidate_state: state.candidateState, candidate_kind: "audio", candidate_capture_mode: "upload",
        candidate_contains_third_parties: false }];
    }
    if (/set state='waiting',build_id=null/i.test(sql)) {
      state.intent = { ...state.intent, state: "waiting", build_id: null, blockers: params[3], last_error_code: params[4] };
      return [state.intent];
    }
    if (/with updated as/i.test(sql) && /set state='queued',build_id=\$4::uuid/i.test(sql)) {
      state.intent = { ...state.intent, state: "queued", build_id: params[3], blockers: [], last_error_code: "" };
      return [state.intent];
    }
    if (/source\.primary_voice\.promote_after_build/i.test(sql)) {
      state.primarySourceId = state.intent.candidate_source_id;
      state.intent = { ...state.intent, state: "review", blockers: [], last_error_code: "",
        promoted_at: "2026-09-02T00:01:00.000Z" };
      return [state.intent];
    }
    if (/from vy_replica_voice_build_intent i[\s\S]*order by i\.next_check_at/i.test(sql)) {
      return state.intent ? [{
        intent_id: state.intent.intent_id,
        replica_id: state.intent.replica_id,
        owner_user_id: state.intent.owner_user_id,
      }] : [];
    }
    throw new Error(`unexpected SQL: ${sql.slice(0, 120)}`);
  };
  return { state, db };
}

const processingHarness = buildIntentHarness();
processingHarness.state.candidateState = "processing";
const processing = await requestOwnedVoiceGenomeBuild(processingHarness.db, OWNER, {
  replica_id: REPLICA,
  build_intent_id: BUILD_INTENT_2,
  candidate_source_id: SOURCE,
}, { queue: async () => { throw new Error("a processing candidate must not queue"); } });
ok("a staged recording stays waiting and leaves the healthy primary active while source processing runs",
  processing.state === "waiting" && processing.blockers.includes("candidate_source_processing")
  && processingHarness.state.primarySourceId === OLD_SOURCE && processingHarness.state.queueCalls === 0);

const waitingHarness = buildIntentHarness();
const notReady = Object.assign(new Error("voice_genome_not_ready"), {
  status: 409,
  details: { blockers: ["identity_verification_required", "owner_selected_voice_candidate_required"] },
});
const waiting = await requestOwnedVoiceGenomeBuild(waitingHarness.db, OWNER, {
  replica_id: REPLICA,
  build_intent_id: BUILD_INTENT,
  candidate_source_id: SOURCE,
}, { queue: async (_db, _owner, scope) => {
  waitingHarness.state.queueCalls++;
  assert.deepEqual(scope, { replica_id: REPLICA, candidate_source_id: SOURCE });
  throw notReady;
} });
ok("an explicit owner build intent waits durably instead of bypassing verification or review",
  waiting.state === "waiting" && waiting.blockers.includes("identity_verification_required")
  && waiting.blockers.includes("owner_selected_voice_candidate_required")
  && waitingHarness.state.primarySourceId === OLD_SOURCE);

const queued = await requestOwnedVoiceGenomeBuild(waitingHarness.db, OWNER, {
  replica_id: REPLICA,
  build_intent_id: BUILD_INTENT,
  candidate_source_id: SOURCE,
}, { queue: async () => {
  waitingHarness.state.queueCalls++;
  waitingHarness.state.build = { build_id: BUILD, state: "queued", target_version: 1 };
  return waitingHarness.state.build;
} });
ok("replaying the build intent binds one ordinary technical VoiceGenome build",
  queued.replayed && queued.state === "queued" && queued.build_id === BUILD
  && waitingHarness.state.queueCalls === 2 && waitingHarness.state.primarySourceId === OLD_SOURCE);
await requestOwnedVoiceGenomeBuild(waitingHarness.db, OWNER, {
  replica_id: REPLICA,
  build_intent_id: BUILD_INTENT,
  candidate_source_id: SOURCE,
}, { queue: async () => { throw new Error("a bound intent must not queue again"); } });
ok("a bound intent becomes observation-only on later tab retries", waitingHarness.state.queueCalls === 2);

waitingHarness.state.build.state = "review";
const sweep = await reconcileVoiceBuildIntents(waitingHarness.db, { limit: 12 });
ok("the bounded reconciler advances a queued intent to review from durable build state",
  sweep.examined === 1 && sweep.review === 1 && waitingHarness.state.intent.state === "review"
  && waitingHarness.state.primarySourceId === SOURCE && waitingHarness.state.intent.promoted_at);

const migration = readReconciledMigration("db/migrations/072_clone_creation_saga.sql");
const schema = readFileSync(join(ROOT, "db/schema.sql"), "utf8");
ok("migration 072 is ten independently repeatable SQL-over-HTTP statements without a DO block",
  splitSql(migration).length === 10 && !/\bdo\s*\$/i.test(migration));
ok("canonical schema mirrors all three durable intents and the exact language check",
  /creation_intent_id uuid/.test(schema) && /upload_intent_id uuid/.test(schema)
  && /language_hint in \('en','hi','hi-latn'\)/.test(schema)
  && /create table if not exists vy_replica_voice_build_intent/.test(schema));
ok("build intents erase through the replica and build cascades",
  /vy_replica_voice_build_intent_owner_fk[\s\S]*references vy_replica\(replica_id, owner_user_id\) on delete cascade/i.test(migration)
  && /vy_replica_voice_build_intent_candidate_fk[\s\S]*references vy_replica_source\(source_id, replica_id, owner_user_id\) on delete cascade/i.test(migration)
  && /vy_replica_voice_build_intent_build_fk[\s\S]*references vy_replica_model_build\(build_id\) on delete cascade/i.test(migration));

const buildIntentSource = readFileSync(join(ROOT, "api/_replica-build-intent.js"), "utf8");
ok("the build-intent lane calls only the reviewed technical queue and never auto-accepts human claims",
  /queueOwnedVoiceGenome/.test(buildIntentSource)
  && !/(acceptAllOwnedEvidenceForSelfTest|decideOwnedEvidence|selectOwnedVoiceArtifact|vy_replica_claim|vy_person)/.test(buildIntentSource));
ok("a replacement keeps the old primary until the exact candidate draft exists, then promotes in one SQL statement",
  /candidate_source_id/.test(buildIntentSource)
  && /join vy_replica_voice_genome g[\s\S]*g\.source_set_hash=b\.source_set_hash/i.test(buildIntentSource)
  && /g\.definition#>'\{references,source_ids\}'[\s\S]*candidate_source_id::text/i.test(buildIntentSource)
  && /insert into vy_replica_voice_reference[\s\S]*update vy_replica_voice_build_intent[\s\S]*state='review'/i.test(buildIntentSource)
  && /const INTENT_UPDATE_RETURNING = `i\.intent_id,i\.replica_id,i\.owner_user_id,i\.candidate_source_id/i.test(buildIntentSource)
  && /returning \$\{INTENT_UPDATE_RETURNING\}/.test(buildIntentSource)
  && !/vy_replica_runtime/.test(buildIntentSource));
ok("newer owner build intents supersede older waiting or queued replacements before either can promote",
  /superseded_by_new_build_intent/.test(buildIntentSource)
  && /newer\.state in \('waiting','queued'\)/.test(buildIntentSource));
const reviewSource = readFileSync(join(ROOT, "api/_replica-review.js"), "utf8");
const modelBuildSource = readFileSync(join(ROOT, "api/_replica-model-build.js"), "utf8");
ok("queue readiness names adult identity liveness biometric training inference and reviewed evidence gates",
  ["adult_age_verification_required", "identity_verification_required", "liveness_verification_required",
    "biometric_consent_required", "training_consent_required", "inference_consent_required",
    "owner_selected_voice_candidate_required"].every((code) => reviewSource.includes(code)));
ok("lease and settlement recheck current-policy identity and all three model consent scopes",
  /r\.age_verified_at is not null[\s\S]*r\.identity_verified_at is not null[\s\S]*r\.liveness_verified_at is not null/i.test(modelBuildSource)
  && ["biometric", "training", "inference"].every((scope) => modelBuildSource.includes(`c.scope='${scope}'`))
  && /c\.policy_version=r\.policy_version/.test(modelBuildSource));

const replicaRoute = readFileSync(join(ROOT, "api/replica.js"), "utf8");
const sourceRoute = readFileSync(join(ROOT, "api/replica-source.js"), "utf8");
const reviewRoute = readFileSync(join(ROOT, "api/replica-review.js"), "utf8");
ok("HTTP contracts derive every idempotent mutation from the authenticated owner",
  /requireUser\(req\)/.test(replicaRoute) && /creation_intent_id/.test(replicaRoute)
  && /sourceIdFromRequest\(user\.id, body\)/.test(sourceRoute)
  && /requestOwnedVoiceGenomeBuild\(q, user\.id, body\)/.test(reviewRoute));
ok("source create and finalize expose exact replay states including post-finalize recovery",
  /replayed: true, finalized: false/.test(sourceRoute)
  && /const finalizedSourceResponse[\s\S]*upload: null[\s\S]*replayed[\s\S]*finalized:/i.test(sourceRoute)
  && /\["quarantined", "processing", "ready"\]/.test(sourceRoute)
  && /concurrent finalize can win/.test(sourceRoute));
const runtimeSource = readFileSync(join(ROOT, "api/_replica-processing/runtime.js"), "utf8");
ok("the durable language hint reaches the leased processing source rather than staying browser-local",
  /s\.contains_third_parties,s\.language_hint,s\.provenance/.test(runtimeSource));
ok("a staged candidate gets only the guarded short-recording processing path before promotion",
  /vy_replica_voice_build_intent[\s\S]*candidate_source_id=s\.source_id[\s\S]*state in \('waiting','queued'\)/i.test(runtimeSource));

let scopedEvidenceSql = "";
let scopedEvidenceParams = [];
await assert.rejects(loadAcceptedVoiceGenomeInput(async (sql, params) => {
  scopedEvidenceSql = sql;
  scopedEvidenceParams = params;
  return [];
}, OWNER, { replica_id: REPLICA, candidate_source_id: SOURCE }), /voice_genome_enrollment_artifact_required/);
ok("the queued and leased build input is restricted to the staged candidate source",
  scopedEvidenceParams[3] === SOURCE
  && /\$4::uuid is null or e\.source_id=\$4::uuid/i.test(scopedEvidenceSql)
  && /candidate_source_id: lease\.candidateSourceId/.test(modelBuildSource));

console.log(`\n${checks} clone creation saga checks passed`);
