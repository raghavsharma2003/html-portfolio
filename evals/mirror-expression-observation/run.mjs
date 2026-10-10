import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createSettledMirrorExpressionRecords,
  measureMirrorAcousticExpression,
  measureSettledMirrorExpression,
} from "../../api/_experience-compiler/mirror-expression.js";
import { settleMirrorWindow } from "../../api/_mirrorcall-store.js";
import {
  authorizedExpressionObservationSweep,
  drainExpiredExpressionObservations,
} from "../../api/expression-observation-sweep.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const OWNER = "20000000-0000-4000-8000-000000000002";
const REPLICA = "10000000-0000-4000-8000-000000000001";
const SOURCE = "30000000-0000-4000-8000-000000000003";
const SESSION = "40000000-0000-4000-8000-000000000004";
const WINDOW = "50000000-0000-4000-8000-000000000005";
const AGENT = "60000000-0000-4000-8000-000000000006";
const PERSON = "70000000-0000-4000-8000-000000000007";
const CONSENT = "80000000-0000-4000-8000-000000000008";
let checks = 0;

function ok(name, condition) {
  assert.ok(condition, name);
  console.log(`ok ${++checks} - ${name}`);
}

function rows(overrides = {}) {
  return createSettledMirrorExpressionRecords({
    ownerUserId: OWNER,
    replicaId: REPLICA,
    sourceId: SOURCE,
    sourceSha256: "a".repeat(64),
    sourceByteSize: 48_000,
    sessionId: SESSION,
    windowId: WINDOW,
    agentId: AGENT,
    personId: PERSON,
    consentScopes: ["capture", "storage", "transcription"],
    consentId: CONSENT,
    consentScope: "training",
    consentGrantedAt: "2026-08-30T10:00:00.000Z",
    capturedAt: "2026-08-30T10:00:01.000Z",
    speakerVerification: "unverified",
    transcript: "mera subject विज्ञान hai today",
    transcriptConfidence: 0.82,
    durationMs: 12_000,
    asrProvider: "sarvam-sync",
    asrModel: "saarika:v2.5",
    ...overrides,
  });
}

const measured = measureSettledMirrorExpression("mera subject विज्ञान hai today", 12_000);
ok("the ruleset measures only four bounded mechanics", Object.keys(measured).sort().join(",") ===
  "code_switch_ratio,speech_rate_wpm,token_count,turn_duration_ms");
ok("Unicode token count and speech rate are deterministic", measured.token_count === 5 && measured.speech_rate_wpm === 25);
ok("code switching means adjacent Latin and Devanagari script transitions, not a language guess",
  measured.code_switch_ratio === 0.5);
ok("canonical PCM RMS becomes a direct dBFS measurement without an emotion label",
  measureMirrorAcousticExpression({ rms: 0.1 }).energy_rms_db === -20);
assert.throws(() => measureMirrorAcousticExpression({ rms: 0 }), /mirror_expression_rms_invalid/);
ok("an impossible RMS probe is refused instead of coerced", true);

const first = rows();
const replay = rows();
ok("one settled turn produces four deterministic immutable rows", first.length === 4 && JSON.stringify(first) === JSON.stringify(replay));
ok("every row is inferred by rules and cannot claim inner emotion", first.every((row) =>
  row.epistemic_status === "inferred" && row.producer_kind === "rules" &&
  row.claim_target === "delivery_cue" && row.interpretation === "observer_interpretation" &&
  row.may_claim_inner_emotion === false));
ok("rows bind exact owner replica source session window turn dyad agent and person", first.every((row) =>
  row.owner_user_id === OWNER && row.replica_id === REPLICA && row.source_id === SOURCE &&
  row.session_id === SESSION && row.window_id === WINDOW && row.turn_id === WINDOW &&
  row.mirror_turn_id === null && row.agent_id === AGENT && row.person_id === PERSON &&
  row.dyad_id === `dyad:${AGENT}:${PERSON}` && row.source_consent_id === CONSENT));
ok("all rows expire exactly 24 hours after observation", first.every((row) =>
  Date.parse(row.expires_at) - Date.parse(row.observed_at) === 86_400_000));
const acousticRows = rows({ wavProbe: { rms: 0.1 } });
const acoustic = acousticRows.find((row) => row.feature_name === "energy_rms_db");
ok("a real WAV probe adds one direct acoustic row beside the four inferred transcript mechanics",
  acousticRows.length === 5 && acoustic?.feature_value === -20 && acoustic?.feature_unit === "decibels_rms");
ok("the acoustic row is a direct observation and still cannot claim inner emotion",
  acoustic?.epistemic_status === "observed" && acoustic?.producer_kind === "direct_measurement" &&
  acoustic?.producer_name === "pcm16_wav_probe" && acoustic?.may_claim_inner_emotion === false);
ok("provider confidence is not invented and stored duration remains explicitly inferred by rules",
  rows({ transcriptConfidence: null }).every((row) =>
    row.epistemic_status === "inferred" && row.producer_kind === "rules" &&
    (row.feature_name === "turn_duration_ms" ? row.confidence === 1 : row.confidence === 0)));
ok("the call-audio span hash is the exact source audio SHA, not a transcript composite",
  first.every((row) => row.span_content_sha256 === "a".repeat(64)) &&
  rows({ transcript: "mera subject गणित hai today" }).every((row) =>
    row.span_content_sha256 === "a".repeat(64)));
ok("ASR provider and model lineage changes the derivation code commitment, not the audio span hash",
  rows({ asrModel: "saarika:v3" }).every((row, index) =>
    row.producer_code_hash !== first[index].producer_code_hash &&
    row.span_content_sha256 === first[index].span_content_sha256));
assert.throws(() => measureSettledMirrorExpression("", 12_000), /mirror_expression_transcript_required/);
ok("empty ASR text is a negative control", true);
assert.throws(() => rows({ consentScopes: ["capture", "storage"] }), /mirror_expression_consent_scope_missing/);
ok("missing transcription consent is a negative control", true);
assert.throws(() => rows({ consentScope: "inference" }), /mirror_expression_consent_scope_missing/);
ok("a non-training derivation receipt is a negative control", true);
assert.throws(() => rows({ durationMs: 0 }), /mirror_expression_duration_invalid/);
ok("an invalid settled duration is a negative control", true);

let statement;
await settleMirrorWindow(async (sql, params) => {
  statement = { sql, params };
  return [{ window_id: WINDOW, asr_state: "transcribed" }];
}, OWNER, REPLICA, WINDOW, {
  transcript: "mera subject विज्ञान hai today",
  provider: "sarvam-sync",
  model: "saarika:v2.5",
  evidence: [],
  expressionObservations: first,
});
ok("expression insertion is atomic with successful window settlement", /\bsettled as\s*\(/i.test(statement.sql) &&
  /insert into vy_replica_expression_observation/i.test(statement.sql) && JSON.parse(statement.params[9]).length === 4);
ok("atomic authorization binds consent, source hash, agent, person, dyad, session, window and owner",
  /consent_scopes @> array\['capture','storage','transcription'\]/i.test(statement.sql) &&
  /src\.sha256=d\.item->>'source_content_sha256'/i.test(statement.sql) &&
  /r\.agent_id=.*agent_id/i.test(statement.sql) && /r\.subject_person_id=.*person_id/i.test(statement.sql) &&
  /d\.item->>'dyad_id'='dyad:'/i.test(statement.sql) && /w\.session_id=.*session_id/i.test(statement.sql) &&
  /w\.window_id=.*window_id/i.test(statement.sql) && /w\.owner_user_id=.*owner_user_id/i.test(statement.sql) &&
  /c\.consent_id=.*source_consent_id/i.test(statement.sql));
ok("current training consent is rechecked for policy, revocation and expiry at atomic persistence",
  /c\.scope='training'/.test(statement.sql) && /c\.policy_version=r\.policy_version/.test(statement.sql) &&
  /c\.granted_at<=w\.created_at/.test(statement.sql) &&
  /c\.revoked_at is null/.test(statement.sql) && /c\.expires_at is null or c\.expires_at>now\(\)/.test(statement.sql));
ok("a replaced or revoked exact expression receipt is filtered before the collision guard",
  /exact_consent\.consent_id=\(value->>'source_consent_id'\)::uuid/.test(statement.sql) &&
  /exact_consent\.granted_at<=w\.created_at/.test(statement.sql) &&
  /exact_consent\.revoked_at is null/.test(statement.sql));
ok("current capture storage and transcription grants are rechecked rather than trusted from the frozen session",
  /unnest\(array\['capture','storage','transcription'\]/.test(statement.sql) &&
  /live\.policy_version=r\.policy_version/.test(statement.sql) && /live\.revoked_at is null/.test(statement.sql) &&
  /live\.expires_at is null or live\.expires_at>now\(\)/.test(statement.sql));
ok("the SQL allowlist persists only the four transcript mechanics plus direct RMS energy", /feature_name' in \('turn_duration_ms','token_count','speech_rate_wpm','code_switch_ratio','energy_rms_db'\)/i.test(statement.sql) &&
  /feature_name'='energy_rms_db'[\s\S]*epistemic_status'='observed'[\s\S]*producer_kind'='direct_measurement'/i.test(statement.sql) &&
  !/mood|emotion_label|personality/i.test(statement.sql));
ok("collision validation makes retries idempotent and conflicting commitments fail the statement",
  /valid_expression/i.test(statement.sql) && /o\.record_hash=d\.item->>'record_hash'/i.test(statement.sql) &&
  /count\(\*\) from desired_expression.*total from valid_expression/is.test(statement.sql));

let droppedParams;
await settleMirrorWindow(async (_sql, params) => {
  droppedParams = params;
  return [{ window_id: WINDOW, asr_state: "dropped" }];
}, OWNER, REPLICA, WINDOW, { failureCode: "asr_empty_transcript", expressionObservations: first });
ok("a dropped or empty-ASR window carries zero expression rows", JSON.parse(droppedParams[9]).length === 0);

const route = readFileSync(join(ROOT, "api/mirror-call.js"), "utf8");
const store = readFileSync(join(ROOT, "api/_mirrorcall-store.js"), "utf8");
const sweep = readFileSync(join(ROOT, "api/expression-observation-sweep.js"), "utf8");
const vercel = JSON.parse(readFileSync(join(ROOT, "vercel.json"), "utf8"));
ok("the producer is downstream of byte integrity and successful ASR in the real caller",
  route.indexOf("source_integrity_mismatch") < route.lastIndexOf("createSettledMirrorExpressionRecords") &&
  route.indexOf("const text = result.turns") < route.lastIndexOf("createSettledMirrorExpressionRecords"));
ok("the caller derives acoustics only from the verified private bytes and passes the server probe",
  route.indexOf("source_integrity_mismatch") < route.indexOf("wavProbe = probeEnrollmentWav") &&
  /createSettledMirrorExpressionRecords\([\s\S]*wavProbe,[\s\S]*asrProvider/.test(route));
ok("collect-only expression preparation cannot relabel successful ASR as a dropped window",
  /let expressionObservations = \[\];[\s\S]*try \{[\s\S]*createSettledMirrorExpressionRecords[\s\S]*catch \{[\s\S]*expressionObservations = \[\];[\s\S]*asr = \{/.test(route));
ok("agent and person are resolved by an owner-scoped server query rather than request JSON",
  /export async function mirrorExpressionScope/.test(store) &&
  /r\.agent_id is not null and r\.subject_person_id is not null/.test(store) &&
  !/body\.agent_id|body\.person_id/.test(route));
ok("the scope query resolves a real current training consent and rejects revoked expired or wrong-policy receipts",
  /grant_row\.scope='training'/.test(store) && /grant_row\.policy_version=r\.policy_version/.test(store) &&
  /grant_row\.granted_at<=w\.created_at/.test(store) &&
  /grant_row\.revoked_at is null/.test(store) && /grant_row\.expires_at is null or grant_row\.expires_at>now\(\)/.test(store) &&
  /grant_row\.consent_id/.test(store));
ok("the collect-only lane has no response or persona consumer", !/listActiveExpressionObservations|persistExpressionObservation/.test(route));
const secret = "s".repeat(32);
ok("the purge route fails closed when CRON_SECRET is missing, short, or wrong",
  !authorizedExpressionObservationSweep({ headers: {} }, {}) &&
  !authorizedExpressionObservationSweep({ headers: { authorization: "Bearer short" } }, { CRON_SECRET: "short" }) &&
  !authorizedExpressionObservationSweep({ headers: { authorization: `Bearer ${"x".repeat(32)}` } }, { CRON_SECRET: secret }));
ok("the purge route accepts only the exact timing-safe CRON_SECRET bearer",
  authorizedExpressionObservationSweep({ headers: { authorization: `Bearer ${secret}` } }, { CRON_SECRET: secret }));
let drainCalls = 0;
const drained = await drainExpiredExpressionObservations(async () => [], {
  purge: async () => {
    drainCalls += 1;
    return drainCalls < 3 ? Array.from({ length: 500 }, (_, index) => `row-${index}`) : [];
  },
  clock: () => 0,
});
ok("the purge drains repeated full pages and returns counts rather than observation content",
  drained.deleted === 1_000 && drained.batches === 3 && drained.more_possible === false
  && /return res\.status\(503\)/.test(sweep) && !/return res.*observation_id/.test(sweep));
let cappedCalls = 0;
const capped = await drainExpiredExpressionObservations(async () => [], {
  purge: async () => {
    cappedCalls += 1;
    return Array.from({ length: 500 }, (_, index) => `row-${index}`);
  },
  maxBatches: 2,
  clock: () => 0,
});
ok("a still-full final page becomes a named alertable backlog instead of a false retention success",
  capped.deleted === 1_000 && cappedCalls === 2 && capped.more_possible === true
  && sweep.includes("expression_observation_retention_backlog"));
ok("the purge reuses CRON_SECRET and is scheduled every ten minutes",
  /env\.CRON_SECRET/.test(sweep) && !/EXPRESSION.*SECRET|REPLICA_ERASURE_SECRET/.test(sweep) &&
  vercel.crons.some((entry) => entry.path === "/api/expression-observation-sweep" && entry.schedule === "*/10 * * * *"));

console.log(`\n${checks} Mirror expression observation checks passed`);
