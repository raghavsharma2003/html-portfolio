// WS-J. The fidelity guarantee: score math, verdict tiers as DATA, the
// activation gate's fail-closed negative controls, and the recompute-on-update
// invalidation law.
//
// Offline, deterministic, $0, no GPU, no model, no network. Every embedding
// here is a fixture vector, which is exactly what the seam in api/_fidelity.js
// buys: the math that decides whether a clone may go live is testable without
// synthesising a single sample.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_FIDELITY_POLICY,
  FIDELITY_BLOCKER,
  FIDELITY_POLICY_VERSION,
  clientFidelity,
  embeddingVectors,
  fidelityScore,
  fidelityVerdict,
  recordOwnedFidelity,
  supersedeStandingFidelity,
} from "../../api/_fidelity.js";
import {
  RUNTIME_QUALIFICATION_SUITES,
  activateOwnedRuntime,
  clientRuntimeStatus,
  runtimeBlockers,
} from "../../api/_replica-runtime.js";
import {
  VOICE_LANE_ORDER,
  SELF_HOSTED_VOICE_LANE,
  VENDOR_VOICE_LANE,
  configuredVoiceLanes,
  createVoiceProvider,
  createVoiceSynthesisProvider,
  primaryVoiceLane,
} from "../../api/_voice/registry.js";
import { splitSql } from "../../db/migrations/apply.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const RID = "10000000-0000-4000-8000-000000000001";
const OWNER = "20000000-0000-4000-8000-000000000002";
const VOICE = "50000000-0000-4000-8000-000000000005";
let checks = 0;

function ok(name, value) {
  assert.ok(value, name);
  console.log(`ok ${++checks} - ${name}`);
}

// ── fixture vectors ───────────────────────────────────────────────────────
// Unit vectors in a small space. `blend(a, b, t)` walks from one to the other,
// which is what lets a fixture name its own similarity: cos(unit(a + t·b), a)
// is monotone in t for orthogonal a and b, so a tier fixture is a dial rather
// than a magic array of decimals.
const DIM = 8;
function basis(index) {
  return Array.from({ length: DIM }, (_, i) => (i === index ? 1 : 0));
}
function unit(vector) {
  const norm = Math.sqrt(vector.reduce((sum, n) => sum + n * n, 0));
  return vector.map((n) => n / norm);
}
function blend(target, offAxis, weight) {
  return unit(target.map((n, i) => n + weight * offAxis[i]));
}
// A vector at exactly cosine `c` from `target`, along an orthogonal axis.
function atSimilarity(target, offAxis, c) {
  return unit(target.map((n, i) => c * n + Math.sqrt(1 - c * c) * offAxis[i]));
}

const SPEAKER = basis(0);
const OFF = basis(1);
const OFF2 = basis(2);
const REFERENCE = [SPEAKER, blend(SPEAKER, OFF, 0.05), blend(SPEAKER, OFF2, 0.05)];

// ── 1. score math ─────────────────────────────────────────────────────────
const identical = fidelityScore([SPEAKER, SPEAKER], [SPEAKER, SPEAKER, SPEAKER]);
ok("identical vectors score ~1.0 on every statistic",
  Math.abs(identical.mean - 1) < 1e-6 && Math.abs(identical.p10 - 1) < 1e-6 && Math.abs(identical.worst - 1) < 1e-6);

const orthogonal = fidelityScore([SPEAKER, SPEAKER], [OFF, OFF, OFF2]);
ok("orthogonal vectors score ~0", Math.abs(orthogonal.mean) < 1e-6 && Math.abs(orthogonal.worst) < 1e-6);

const opposite = fidelityScore([SPEAKER], [SPEAKER.map((n) => -n)]);
ok("anti-parallel vectors score -1 rather than clamping to 0", Math.abs(opposite.mean + 1) < 1e-6);

// Non-unit input must score the same as its normalised twin: the module
// normalises rather than trusting the caller, and this is what proves it.
const scaled = fidelityScore([SPEAKER.map((n) => n * 7)], [SPEAKER.map((n) => n * 0.001)]);
ok("un-normalised vectors are normalised, not mis-scored", Math.abs(scaled.mean - 1) < 1e-6);

// worst-window: nine good windows and one bad one. Mean stays high; `worst`
// is the statistic that sees it, which is the whole reason it exists.
const mostlyGood = [
  ...Array.from({ length: 9 }, () => atSimilarity(SPEAKER, OFF, 0.95)),
  atSimilarity(SPEAKER, OFF, 0.2),
];
const skewed = fidelityScore(REFERENCE, mostlyGood);
ok("one bad window is invisible in the mean and visible in worst/p10",
  skewed.mean > 0.85 && skewed.worst < 0.25 && skewed.p10 < 0.25);

ok("score reports its own sample counts and dimension",
  skewed.windows === 10 && skewed.references === 3 && skewed.dimension === DIM);

assert.throws(() => fidelityScore([], [SPEAKER]), /fidelity/);
assert.throws(() => fidelityScore([SPEAKER], [[1, 2, 3]]), /fidelity_dimension_mismatch/);
assert.throws(() => fidelityScore([SPEAKER], [[Number.NaN, 0, 0, 0, 0, 0, 0, 0]]), /fidelity/);
assert.throws(() => fidelityScore([SPEAKER], [[0, 0, 0, 0, 0, 0, 0, 0]]), /fidelity/);
ok("score rejects empty, mismatched, non-finite and zero-norm input", true);

// ── 2. the voice-evidence embedding shape ─────────────────────────────────
// The composition contract: reference embeddings arrive in the shape
// services/voice-evidence emits, family-tagged, two families per input. We
// score ECAPA and must not silently mix in x-vector, whose vectors live in a
// different space entirely.
const evidence = [
  { input_key: "src_a", family: "speechbrain-ecapa-voxceleb", vector: SPEAKER, confidence: 1 },
  { input_key: "src_a", family: "speechbrain-xvector-voxceleb", vector: OFF, confidence: 1 },
  { input_key: "src_b", family: "speechbrain-ecapa-voxceleb", vector: blend(SPEAKER, OFF2, 0.05), confidence: 1 },
  { input_key: "src_b", family: "speechbrain-xvector-voxceleb", vector: OFF2, confidence: 1 },
];
ok("only the ECAPA family is scored, x-vector is left in the evidence",
  embeddingVectors(evidence).length === 2 && fidelityScore(evidence, [SPEAKER]).mean > 0.99);
assert.throws(() => embeddingVectors([{ family: "speechbrain-xvector-voxceleb", vector: OFF }]),
  /fidelity_embedding_family_missing/);
ok("evidence carrying no ECAPA family fails rather than falling back to whatever is present", true);

const serviceSource = readFileSync(join(ROOT, "services/voice-evidence/app.py"), "utf8");
ok("the family strings this module scores on are the ones the service emits",
  serviceSource.includes('"family": "speechbrain-ecapa-voxceleb"') &&
  serviceSource.includes('"family": "speechbrain-xvector-voxceleb"'));
ok("the service emits L2-normalised vectors, which is why cosine is a dot product",
  /vector \/ norm/.test(serviceSource));

// ── 3. verdict tiers, and thresholds as DATA ──────────────────────────────
function scoreAt(c) {
  return fidelityScore(REFERENCE, Array.from({ length: 5 }, () => atSimilarity(SPEAKER, OFF, c)));
}
ok("a high-similarity clone passes", fidelityVerdict(scoreAt(0.93)).status === "pass");
ok("a clone in the warn band activates and is flagged",
  fidelityVerdict(scoreAt(0.74)).status === "warn" &&
  fidelityVerdict(scoreAt(0.74)).reasons.includes("below_warn_band"));
ok("a clone below the activation floor fails",
  fidelityVerdict(scoreAt(0.5)).status === "fail" &&
  fidelityVerdict(scoreAt(0.5)).reasons.includes("below_activation_floor"));
ok("a clone with one unrecognisable window fails on the per-window rails even with a strong mean",
  fidelityVerdict(skewed).status === "fail" &&
  fidelityVerdict(skewed).reasons.includes("worst_window_below_floor") &&
  !fidelityVerdict(skewed).reasons.includes("below_activation_floor"));
ok("too few candidate windows is a fail, not a pass on an anecdote",
  fidelityVerdict(fidelityScore(REFERENCE, [SPEAKER])).reasons.includes("insufficient_candidate_windows"));
ok("too little reference evidence is a fail",
  fidelityVerdict(fidelityScore([SPEAKER], [SPEAKER, SPEAKER, SPEAKER])).reasons.includes("insufficient_reference_evidence"));

// POLICY AS DATA. The same score, two policies, two verdicts — with no edit to
// api/_fidelity.js. This is what makes a re-bench a config change; if this
// check ever needs a code edit to pass, the thresholds have crept back into
// the logic and the bench can no longer move them.
const borderline = scoreAt(0.74);
const strictFloor = { ...DEFAULT_FIDELITY_POLICY, version: "voice-fidelity/test-strict", activationFloor: 0.8 };
const looseWarn = { ...DEFAULT_FIDELITY_POLICY, version: "voice-fidelity/test-loose", warnBelow: 0.7 };
ok("raising the activation floor turns the same score from warn into fail",
  fidelityVerdict(borderline).status === "warn" && fidelityVerdict(borderline, strictFloor).status === "fail");
ok("lowering the warn band turns the same score from warn into pass",
  fidelityVerdict(borderline, looseWarn).status === "pass");
ok("the verdict carries the policy version that produced it",
  fidelityVerdict(borderline).policy_version === FIDELITY_POLICY_VERSION &&
  fidelityVerdict(borderline, strictFloor).policy_version === "voice-fidelity/test-strict");
ok("the default policy documents itself as provisional-until-benched",
  /provisional/i.test(readFileSync(join(ROOT, "api/_fidelity.js"), "utf8")));

// ── 4. the activation gate — negative controls both ways ──────────────────
function statusRow(extra = {}) {
  return {
    replica_id: RID, subject_mode: "self", lifecycle: "ready",
    subject_person_id: "30000000-0000-4000-8000-000000000003",
    age_verified_at: "2026-08-24T00:00:00.000Z", identity_verified_at: "2026-08-24T00:00:00.000Z",
    liveness_verified_at: "2026-08-24T00:00:00.000Z", identity_expires_at: "2031-08-24T00:00:00.000Z",
    person_age_tier: "adult_verified", account_person_matches: true, inference_consent: true,
    profile_version: 7, profile_approved: true, calibration_version: 2, calibration_approved: true,
    genome_version: 3, genome_approved: true, voice_profile_id: VOICE, voice_ready: true, test_voice: false,
    qualification_passed: RUNTIME_QUALIFICATION_SUITES.length,
    fidelity_qualified: true, fidelity_status: "pass",
    fidelity_score: { mean: 0.91, p10: 0.88, worst: 0.86, windows: 10, references: 3 },
    fidelity_computed_at: "2026-08-26T00:00:00.000Z",
    capability_state: null, capability_activated_at: null,
    ...extra,
  };
}
ok("a fully qualified clone with a passing fidelity row has no blockers",
  runtimeBlockers(statusRow()).length === 0);
ok("NEGATIVE CONTROL - no fidelity row at all blocks activation",
  runtimeBlockers(statusRow({ fidelity_qualified: undefined, fidelity_status: null })).includes(FIDELITY_BLOCKER));
ok("NEGATIVE CONTROL - a 'fail' fidelity row blocks activation",
  runtimeBlockers(statusRow({ fidelity_qualified: false, fidelity_status: "fail" })).includes(FIDELITY_BLOCKER));
ok("a 'warn' row that the SQL scored as not-pass still blocks - the DB decides, not the JS",
  runtimeBlockers(statusRow({ fidelity_qualified: false, fidelity_status: "warn" })).includes(FIDELITY_BLOCKER));
ok("fidelity is a PEER of qualification, not a substitute - each blocks alone",
  runtimeBlockers(statusRow({ qualification_passed: 6 })).includes("qualification_incomplete") &&
  !runtimeBlockers(statusRow({ qualification_passed: 6 })).includes(FIDELITY_BLOCKER) &&
  runtimeBlockers(statusRow({ fidelity_qualified: false })).includes(FIDELITY_BLOCKER) &&
  !runtimeBlockers(statusRow({ fidelity_qualified: false })).includes("qualification_incomplete"));
ok("ONE blocker code for missing, failing and superseded - the states are not enumerable",
  new Set([
    runtimeBlockers(statusRow({ fidelity_qualified: false, fidelity_status: null })).filter((b) => /fidelity/.test(b)).join(),
    runtimeBlockers(statusRow({ fidelity_qualified: false, fidelity_status: "fail" })).filter((b) => /fidelity/.test(b)).join(),
    runtimeBlockers(statusRow({ fidelity_qualified: false, fidelity_status: "warn" })).filter((b) => /fidelity/.test(b)).join(),
  ]).size === 1);

const surfaced = clientRuntimeStatus(statusRow());
ok("the score is surfaced to the expert with its verdict and policy version",
  surfaced.fidelity.status === "pass" && surfaced.fidelity.score.mean === 0.91 &&
  surfaced.fidelity.score.worst === 0.86 && surfaced.fidelity.policy_version === FIDELITY_POLICY_VERSION);
ok("the surfaced status leaks no profile ref, model ref, owner or vectors",
  !/(owner|provider|voice_profile|model_ref|vector)/i.test(JSON.stringify(surfaced)));
ok("a clone with no measurement surfaces null rather than a blank pass",
  clientRuntimeStatus(statusRow({ fidelity_status: null, fidelity_qualified: false })).fidelity === null);

// The gate in SQL, not only in JS. runtimeBlockers is the reporting surface;
// the thing that actually cannot be bypassed is the join.
const activationCalls = [];
await activateOwnedRuntime(async (sql, params) => {
  activationCalls.push({ sql, params });
  return [{ capability_id: VOICE, replica_id: RID, state: "active", genome_version: 3, profile_version: 7, calibration_version: 2, activated_at: "2026-08-26T00:00:00.000Z" }];
}, OWNER, RID);
const activationSql = activationCalls[0].sql;
ok("activation joins the fidelity gate as an inner lateral - absence is exclusion",
  /join lateral \(\s*select x\.fidelity_id from vy_voice_fidelity x/i.test(activationSql));
ok("the gate binds replica, owner, the exact profile and the exact genome version",
  /x\.replica_id=r\.replica_id and x\.owner_user_id=r\.owner_user_id/i.test(activationSql) &&
  /x\.voice_profile_ref=vp\.voice_profile_id and x\.genome_version=vg\.version/i.test(activationSql));
ok("the gate requires a standing pass under the current policy version",
  /x\.policy_version=\$7 and x\.superseded_at is null and x\.status='pass'/i.test(activationSql) &&
  activationCalls[0].params[6] === FIDELITY_POLICY_VERSION);
const statusCalls = [];
const { ownedRuntimeStatus } = await import("../../api/_replica-runtime.js");
await ownedRuntimeStatus(async (sql, params) => {
  statusCalls.push({ sql, params });
  return [statusRow()];
}, OWNER, RID);
ok("the status query reads a non-superseded row under the current policy version",
  /x\.policy_version=\$5 and x\.superseded_at is null/i.test(statusCalls[0].sql) &&
  statusCalls[0].params[4] === FIDELITY_POLICY_VERSION);
ok("an already-active capability is NOT exempt from the fidelity read",
  !/case when cap\.state='active' then[^)]*fidelity/i.test(statusCalls[0].sql) &&
  /\(fid\.status='pass'\) as fidelity_qualified/i.test(statusCalls[0].sql));

// ── 5. recompute-on-update ────────────────────────────────────────────────
const writes = [];
const fakeDb = async (sql, params) => {
  writes.push({ sql, params });
  return [{ fidelity_id: "aaaaaaaa-0000-4000-8000-00000000000a" }];
};
const passing = scoreAt(0.93);
await recordOwnedFidelity(fakeDb, OWNER, {
  replica_id: RID, voice_profile_id: VOICE, genome_version: 3,
  voice_model_ref: "chatterbox-multilingual-v3", score: passing,
});
const insert = writes[0];
ok("recording a measurement supersedes any standing row for a different voice/model/policy",
  /update vy_voice_fidelity f\s+set superseded_at=now\(\)/i.test(insert.sql) &&
  /f\.voice_model_ref is distinct from \$4/i.test(insert.sql) &&
  /f\.policy_version is distinct from \$7/i.test(insert.sql) &&
  /f\.genome_version is distinct from \$5/i.test(insert.sql));
ok("supersede and insert are ONE statement - 009's law, so this cannot half-apply",
  splitSql(insert.sql).length === 1);
ok("the stored row names the voice completely: profile, model ref and genome version",
  insert.params[2] === VOICE && insert.params[3] === "chatterbox-multilingual-v3" && insert.params[4] === 3);
ok("the stored score is statistics only - no vectors are persisted",
  !/\[/.test(insert.params[5]) && JSON.parse(insert.params[5]).mean === passing.mean);
ok("the stored status is the verdict, not the caller's assertion",
  insert.params[7] === "pass" && insert.params[6] === FIDELITY_POLICY_VERSION);

const failing = scoreAt(0.4);
await recordOwnedFidelity(fakeDb, OWNER, {
  replica_id: RID, voice_profile_id: VOICE, genome_version: 3,
  voice_model_ref: "chatterbox-multilingual-v3", score: failing,
});
ok("a failing measurement is STORED as 'fail' rather than refused - the drift is the record",
  writes[1].params[7] === "fail");

writes.length = 0;
await supersedeStandingFidelity(fakeDb, OWNER, RID, VOICE);
ok("explicit invalidation exists for a voice that moved before it was re-measured",
  /update vy_voice_fidelity set superseded_at=now\(\)/i.test(writes[0].sql) &&
  /superseded_at is null/i.test(writes[0].sql));

const migration = readFileSync(join(ROOT, "db/migrations/054_voice_fidelity.sql"), "utf8");
ok("migration 054 is one-statement-per-request and DO-block free - 009's law, 051's restatement",
  !/\bdo \$/i.test(migration) && splitSql(migration).length > 1);
ok("at most one standing row per voice profile is a partial unique index, not a convention",
  /create unique index if not exists vy_voice_fidelity_standing_ix[\s\S]*where superseded_at is null/i.test(migration));
ok("the score jsonb shape is a CHECK constraint - a predicate is a guarantee",
  /jsonb_typeof\(score->'mean'\) = 'number'/i.test(migration));
ok("the fidelity row is FK-bound to the owner's own voice profile",
  /references vy_replica_voice_profile \(voice_profile_id, replica_id, owner_user_id\)/i.test(migration));
ok("migration 054 cites cache-outlives-the-voice as the reason its key names the voice",
  /cache-outlives-the-voice/.test(migration));
const schema = readFileSync(join(ROOT, "db/schema.sql"), "utf8");
ok("schema.sql mirrors the table - house law",
  /create table if not exists vy_voice_fidelity/.test(schema) &&
  /vy_voice_fidelity_standing_ix/.test(schema));

// ── 6. the priority flip ──────────────────────────────────────────────────
ok("the self-hosted lane is first in the one place the order is written down",
  VOICE_LANE_ORDER[0] === SELF_HOSTED_VOICE_LANE && VOICE_LANE_ORDER[1] === VENDOR_VOICE_LANE);
const registrySource = readFileSync(join(ROOT, "api/_voice/registry.js"), "utf8");
ok("the order cites SPEC-GURUKUL §8 and the measured reversal condition",
  /SPEC-GURUKUL\.md §8\.1/.test(registrySource) && /platform-north-star/.test(registrySource) &&
  /measured, not[\s\S]{0,12}assumed/.test(registrySource));

const BOTH = {
  AZURE_OPEN_VOICE_ORIGIN: "https://open-voice.example.com",
  OPEN_VOICE_HMAC_SECRET: "a".repeat(64),
  AZURE_PERSONAL_VOICE_ENABLED: "true",
  AZURE_PERSONAL_VOICE_LIMITED_ACCESS_APPROVED: "true",
  AZURE_PERSONAL_VOICE_ENDPOINT: "https://x.cognitiveservices.azure.com",
  AZURE_PERSONAL_VOICE_TTS_ENDPOINT: "https://x.tts.speech.microsoft.com",
  AZURE_PERSONAL_VOICE_KEY: "k".repeat(32),
  AZURE_PERSONAL_VOICE_PROJECT_ID: "vyakti-personal-voice",
  AZURE_PERSONAL_VOICE_COMPANY_NAME: "Vyakti",
  AZURE_PERSONAL_VOICE_BASE_MODEL: "DragonV2NeuralPro-2026-01-01",
  SUPABASE_URL: "https://private.supabase.co",
};
const bothLanes = configuredVoiceLanes(BOTH);
ok("with both lanes configured the primary is self-hosted - this is the flip",
  bothLanes.length === 2 && bothLanes[0] === SELF_HOSTED_VOICE_LANE &&
  primaryVoiceLane(BOTH) === SELF_HOSTED_VOICE_LANE);
const vendorOnly = { ...BOTH, AZURE_OPEN_VOICE_ORIGIN: "" };
ok("with only the vendor lane configured the vendor lane is primary - optional, not removed",
  primaryVoiceLane(vendorOnly) === VENDOR_VOICE_LANE);
assert.throws(() => primaryVoiceLane({}), /voice_provider_unavailable/);
ok("with neither lane configured selection fails closed with the unchanged error string", true);
assert.throws(() => createVoiceProvider("open_chatterbox_multilingual_v3", {}), /voice_provider_unavailable/);
ok("the zero-shot lane is not smuggled through the four-function provider contract", true);
assert.throws(() => createVoiceSynthesisProvider(VENDOR_VOICE_LANE, { env: BOTH }), /voice_provider_unavailable/);
ok("the synthesis seam refuses lanes it does not implement rather than falling back", true);
ok("the registry names the surface gap between the lanes instead of implying parity",
  /HONEST SCOPE/.test(registrySource) && /ZERO-SHOT/.test(registrySource));

const runtimeReadme = readFileSync(join(ROOT, "services/open-voice-runtime/README.md"), "utf8");
ok("the fine-tuning seam is named and its scope is stated honestly",
  /No training pipeline exists/i.test(runtimeReadme) &&
  /approved evidence set in, versioned model ref out/i.test(runtimeReadme) &&
  /voice_model_ref/.test(runtimeReadme));

// ── 7. the expert-facing shape ────────────────────────────────────────────
const row = {
  status: "warn", score: JSON.stringify({ mean: 0.74, p10: 0.71, worst: 0.68, windows: 10 }),
  policy_version: FIDELITY_POLICY_VERSION, computed_at: "2026-08-26T00:00:00.000Z",
  owner_user_id: OWNER, voice_profile_ref: VOICE, voice_model_ref: "secret-model",
};
const client = clientFidelity(row);
ok("the expert sees the number, the floor and the target - a position, not a naked decimal",
  client.score.mean === 0.74 && client.activation_floor === DEFAULT_FIDELITY_POLICY.activationFloor &&
  client.target === DEFAULT_FIDELITY_POLICY.target);
ok("the expert-facing shape is whitelist-built",
  !/(secret-model|owner_user_id|voice_profile_ref|20000000)/.test(JSON.stringify(client)));
ok("a superseded row reads as stale rather than as a current verdict",
  clientFidelity({ ...row, superseded_at: "2026-08-26T01:00:00.000Z" }).stale === true);

console.log(`\n${checks} checks passed`);
