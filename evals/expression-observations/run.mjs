import { readReconciledMigration } from "../lib/reconciled-migration.mjs";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalJson, sha256Hex } from "../../api/_provenance/contracts.js";
import { createSource, EXPRESSION_MAX_TTL_MS } from "../../api/_experience-compiler/contracts.js";
import {
  createExpressionObservation,
  verifyExpressionObservation,
} from "../../api/_experience-compiler/expression-observation.js";
import {
  listActiveExpressionObservations,
  persistExpressionObservation,
  purgeExpiredExpressionObservations,
  readExpressionObservationExportPage,
} from "../../api/_experience-compiler/expression-observation-store.js";

const ROOT = join(fileURLToPath(new URL("../..", import.meta.url)));
const OWNER = "11111111-1111-4111-8111-111111111111";
const REPLICA = "22222222-2222-4222-8222-222222222222";
const SOURCE = "33333333-3333-4333-8333-333333333333";
const SESSION = "44444444-4444-4444-8444-444444444444";
const WINDOW = "55555555-5555-4555-8555-555555555555";
const TURN = "66666666-6666-4666-8666-666666666666";
const AGENT = "77777777-7777-4777-8777-777777777777";
const PERSON = "88888888-8888-4888-8888-888888888888";
const OBSERVED_AT = "2026-08-30T06:00:00.000Z";

let checks = 0;
function ok(label, condition, details = "") {
  checks++;
  assert.ok(condition, `${label}${details ? `: ${details}` : ""}`);
  console.log(`  ok  ${label}`);
}

function equal(label, actual, expected) {
  checks++;
  assert.deepEqual(actual, expected, label);
  console.log(`  ok  ${label}`);
}

function rejects(label, code, fn) {
  checks++;
  assert.throws(fn, (error) => error?.code === code, label);
  console.log(`  ok  ${label}`);
}

async function rejectsAsync(label, code, fn) {
  checks++;
  await assert.rejects(fn, (error) => error?.code === code, label);
  console.log(`  ok  ${label}`);
}

function hex(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function recommit(record, mutate) {
  const changed = JSON.parse(JSON.stringify(record));
  mutate(changed);
  delete changed.observation_id;
  delete changed.record_hash;
  const recordHash = sha256Hex(canonicalJson(changed));
  return { ...changed, observation_id: `obs_${recordHash}`, record_hash: recordHash };
}

const source = createSource({
  scope: { owner_id: OWNER, dyad_id: "dyad_owner_listener" },
  modality: "call_audio",
  content_sha256: hex("private-mirror-window"),
  byte_length: 48_000,
  captured_at: OBSERVED_AT,
  speaker_scope: "owner",
  consent: {
    receipt_id: "80000000-0000-4000-8000-000000000008",
    subject: "owner",
    purposes: ["experience_observation"],
    granted_at: "2026-08-30T05:59:00.000Z",
  },
});

function validObservation(overrides = {}) {
  return createExpressionObservation({
    source,
    scope: source.scope,
    turn_id: TURN,
    feature_name: "speech_rate_wpm",
    feature_value: 142.5,
    epistemic_status: "observed",
    confidence: 0.98,
    producer: {
      kind: "direct_measurement",
      name: "turn_timing",
      revision: "turn_timing_v1",
      code_hash: hex("turn-timing-code"),
    },
    calibration: {
      status: "uncalibrated",
      method: "direct_units",
      revision: "direct_units_v1",
      sample_size: 0,
    },
    observed_at: OBSERVED_AT,
    expires_at: new Date(Date.parse(OBSERVED_AT) + EXPRESSION_MAX_TTL_MS).toISOString(),
    span: {
      unit: "audio_ms",
      start: 1_000,
      end: 9_000,
      content_sha256: hex("exact-audio-span"),
    },
    ...overrides,
  });
}

console.log("\n-- closed expression contract --");

const observation = validObservation();
equal("one row carries one numeric feature and its unit", observation.value, {
  feature_name: "speech_rate_wpm",
  feature_unit: "words_per_minute",
  feature_value: 142.5,
});
equal("expression is turn and dyad scoped", [observation.expression.turn_id, observation.scope.dyad_id], [TURN, "dyad_owner_listener"]);
equal("maximum retention is exactly 24 hours", Date.parse(observation.expires_at) - Date.parse(observation.observed_at), EXPRESSION_MAX_TTL_MS);
equal("inner emotion is structurally false", [observation.expression.claim_target, observation.expression.interpretation, observation.expression.may_claim_inner_emotion], ["delivery_cue", "observer_interpretation", false]);
equal("the committed observation verifies", verifyExpressionObservation(observation), observation);

rejects("an inner-emotion label is not a feature", "expression_feature_not_allowed", () => validObservation({ feature_name: "inner_emotion", feature_value: 1 }));
rejects("a mood label is not a feature", "expression_feature_not_allowed", () => validObservation({ feature_name: "mood", feature_value: 1 }));
rejects("a feature cannot change units", "expression_feature_unit_invalid", () => validObservation({ feature_unit: "ratio" }));
rejects("a ratio cannot exceed its measured range", "expression_feature_value_invalid", () => validObservation({ feature_name: "pause_ratio", feature_value: 1.01 }));
rejects("observed evidence cannot claim a model producer", "expression_epistemic_producer_mismatch", () => validObservation({
  producer: { kind: "model", name: "observer", revision: "observer_v1", code_hash: hex("observer") },
}));

const smuggled = recommit(observation, (changed) => { changed.value.inner_emotion = "sad"; });
rejects("even a correctly re-hashed free-form emotion field is rejected", "expression_feature_shape_invalid", () => verifyExpressionObservation(smuggled));

console.log("\n-- owner-scoped repository --");

let persistedSql = "";
let persistedParams = [];
const stored = await persistExpressionObservation(async (sql, params) => {
  persistedSql = sql;
  persistedParams = params;
  return [{ observation_id: params[0], record_hash: params[40], expires_at: params[35] }];
}, {
  ownerUserId: OWNER,
  replicaId: REPLICA,
  sourceId: SOURCE,
  sessionId: SESSION,
  windowId: WINDOW,
  mirrorTurnId: TURN,
  agentId: AGENT,
  personId: PERSON,
}, observation);

equal("persist returns the committed observation id", stored.observation_id, observation.observation_id);
ok("persist authorizes the exact source hash", /s\.sha256=\$7/.test(persistedSql));
ok("persist binds a real current training consent receipt", persistedParams[41] === "80000000-0000-4000-8000-000000000008" &&
  /c\.consent_id=\$42::uuid/.test(persistedSql) && /c\.scope='training'/.test(persistedSql) &&
  /c\.policy_version=r\.policy_version/.test(persistedSql) && /c\.revoked_at is null/.test(persistedSql) &&
  /c\.expires_at is null or c\.expires_at>now\(\)/.test(persistedSql));
ok("persist resolves owner, replica, source, session, window, turn, agent and person", [OWNER, REPLICA, SOURCE, SESSION, WINDOW, TURN, AGENT, PERSON].every((value) => persistedParams.includes(value)));
ok("persist SQL checks every Mirror scope against owner and replica", /vy_mirror_session[\s\S]*vy_mirror_window[\s\S]*vy_mirror_turn/.test(persistedSql) && (persistedSql.match(/owner_user_id=\$3::uuid/g) || []).length >= 4);

await rejectsAsync("another owner cannot attach the same committed observation", "expression_owner_scope_mismatch", () => persistExpressionObservation(async () => [], {
  ownerUserId: "99999999-9999-4999-8999-999999999999",
  replicaId: REPLICA,
  sourceId: SOURCE,
}, observation));
await rejectsAsync("a generic turn cannot be relabelled as another Mirror turn", "expression_turn_scope_mismatch", () => persistExpressionObservation(async () => [], {
  ownerUserId: OWNER,
  replicaId: REPLICA,
  sourceId: SOURCE,
  sessionId: SESSION,
  windowId: WINDOW,
  mirrorTurnId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
}, observation));

let liveSql = "";
await listActiveExpressionObservations(async (sql) => { liveSql = sql; return []; }, OWNER, REPLICA, {
  at: OBSERVED_AT,
  sessionId: SESSION,
  dyadId: "dyad_owner_listener",
  agentId: AGENT,
  personId: PERSON,
});
ok("live reads exclude expired observations in SQL", /o\.expires_at>\$3::timestamptz/.test(liveSql));
ok("live reads fail closed after lifecycle change or exact training-consent revocation",
  /r\.lifecycle not in \('revoked','purging'\)/.test(liveSql)
  && /c\.consent_id=o\.source_consent_id/.test(liveSql)
  && /c\.scope='training'/.test(liveSql)
  && /c\.policy_version=r\.policy_version/.test(liveSql)
  && /c\.revoked_at is null/.test(liveSql));
ok("Mirror expression reads require the latest owner-speaker decision to remain accepted",
  /speaker\.source_id=o\.source_id/.test(liveSql)
  && /decision\.decision='accepted'/.test(liveSql)
  && /newer\.created_at,newer\.decision_id/.test(liveSql)
  && /target_likelihood/.test(liveSql));
ok("live reads retain dyad, session, agent and person filters", /o\.session_id=\$4/.test(liveSql) && /o\.dyad_id=\$5/.test(liveSql) && /o\.agent_id=\$6/.test(liveSql) && /o\.person_id=\$7/.test(liveSql));

let exportSql = "";
await readExpressionObservationExportPage(async (sql) => { exportSql = sql; return []; }, OWNER, REPLICA);
ok("owner export includes held expired rows", !/o\.expires_at>/.test(exportSql));

let purgeSql = "";
await purgeExpiredExpressionObservations(async (sql) => { purgeSql = sql; return [{ observation_id: observation.observation_id }]; }, { before: observation.expires_at });
ok("retention has an explicit physical purge seam", /delete from vy_replica_expression_observation/.test(purgeSql) && /for update skip locked/.test(purgeSql));

console.log("\n-- schema, erasure and reach --");

const migration = readReconciledMigration("db/migrations/068_replica_expression_observation.sql");
const schema = readFileSync(join(ROOT, "db/schema.sql"), "utf8");
const erasure = readFileSync(join(ROOT, "api/_replica-full-erasure.js"), "utf8");
const relcheck = readFileSync(join(ROOT, "scripts/relcheck.mjs"), "utf8");

for (const sql of [migration, schema]) {
  ok("schema has the expression observation table", /create table if not exists vy_replica_expression_observation/.test(sql));
  ok("schema caps expiry at 24 hours", /expires_at<=observed_at\+interval '24 hours'/.test(sql));
  ok("schema has no free-form feature payload", /feature_name[\s\S]*feature_value[\s\S]*feature_unit/.test(sql) && !/\bvalue\s+jsonb/.test(sql.slice(sql.indexOf("create table if not exists vy_replica_expression_observation"))));
  ok("schema makes inner-emotion claims false", /may_claim_inner_emotion=false/.test(sql));
  ok("schema binds exact source hash by composite FK", /source_id, replica_id, owner_user_id, source_content_sha256[\s\S]*source_id, replica_id, owner_user_id, sha256/.test(sql));
  ok("schema binds the actual consent row", /source_consent_id\s+uuid not null/.test(sql) &&
    /source_consent_id, replica_id, owner_user_id[\s\S]*consent_id, replica_id, owner_user_id/.test(sql));
  ok("schema binds Mirror session, window and turn tuples", /vy_replica_expression_observation_session_fk/.test(sql) && /vy_replica_expression_observation_window_fk/.test(sql) && /vy_replica_expression_observation_turn_fk/.test(sql));
}
ok("full replica erasure explicitly deletes observations", /delete from vy_replica_expression_observation/.test(erasure));
ok("the deletion receipt names the observation class", /transient_expression_observations/.test(erasure));
ok("relcheck discovers owner-keyed tables and walks cascade or explicit erasure", /column_name = any\(\$1::text\[\]\)/.test(relcheck) && relcheck.includes("new RegExp(`delete from ${t}\\\\b`)"));

console.log(`\nexpression-observations: ok (${checks} checks)`);
