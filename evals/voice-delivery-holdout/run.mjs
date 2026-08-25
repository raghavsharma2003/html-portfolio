import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  evaluateVoiceDeliveryHoldout,
  finalizeOwnedVoiceDeliveryHoldout,
  issueOwnedVoiceDeliveryHoldout,
  VOICE_DELIVERY_HOLDOUT_DECK_VERSION,
  VOICE_DELIVERY_HOLDOUT_PROMPTS,
  VOICE_DELIVERY_HOLDOUT_PROTOCOL,
  VOICE_DELIVERY_HOLDOUT_REQUIRED,
} from "../../api/_replica-voice-delivery-policy.js";
import { resolveOwnedVoiceTrialSide } from "../../api/_replica-voice-curriculum.js";
import { splitSql } from "../../db/migrations/apply.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const IDS = {
  owner: "11111111-1111-4111-8111-111111111111",
  replica: "22222222-2222-4222-8222-222222222222",
  artifact: "33333333-3333-4333-8333-333333333333",
  policy: "44444444-4444-4444-8444-444444444444",
  trial: "55555555-5555-4555-8555-555555555555",
  qualification: "66666666-6666-4666-8666-666666666666",
};
let passed = 0;
function ok(name, condition) { assert.ok(condition, name); passed++; console.log(`  PASS ${name}`); }
function uuid(index) { return `bbbbbbbb-bbbb-4bbb-8bbb-${String(index).padStart(12, "0")}`; }
function observations(wins = 12, neitherIndex = -1) {
  const rows = [];
  let index = 0;
  for (const prompt of VOICE_DELIVERY_HOLDOUT_PROMPTS.en) {
    for (let seed = 0; seed < 2; seed++) {
      const candidateSide = index % 2 ? "left" : "right";
      rows.push({ preference_id: uuid(index + 1), pair_hash: String(index + 1).padStart(64, "c"),
        prompt_key: prompt.key, holdout_seed_index: seed, candidate_side: candidateSide,
        choice: index === neitherIndex ? "neither" : index < wins ? candidateSide : candidateSide === "left" ? "right" : "left" });
      index++;
    }
  }
  return rows;
}

const perfect = evaluateVoiceDeliveryHoldout(observations());
ok("the preregistered matrix is exactly six unseen prompts by two seeds", perfect.complete && perfect.observationCount === 12 && perfect.promptFamilies === 6 && perfect.cells.size === 12);
ok("a consistently preferred frozen policy clears the owner gate", perfect.verdict === "owner_pass" && perfect.candidateRate === 1 && perfect.wilsonLower > 0.5);
ok("a bare nine-of-twelve result fails the confidence floor", evaluateVoiceDeliveryHoldout(observations(9)).verdict === "owner_fail");
ok("a neither judgment makes the conservative owner pass impossible", evaluateVoiceDeliveryHoldout(observations(12, 3)).verdict === "owner_fail");
ok("missing or duplicate cells remain inconclusive", evaluateVoiceDeliveryHoldout(observations().slice(0, 11)).verdict === "inconclusive");
ok("cross-language or unregistered prompt cells cannot satisfy the deck", evaluateVoiceDeliveryHoldout(observations().map((row, index) => index === 0 ? { ...row, prompt_key: "hi.holdout.soft-contrast.v1" } : row), "en").verdict === "inconclusive");

const definition = { schema: "vyakti.voice-delivery-policy.v1", builder: "voice-delivery-policy/bt-map-v1",
  champion: { schema: "vyakti.voice-preview-style.v1", key: "balanced", exaggeration: 0.5, cfg_weight: 0.5, temperature: 0.8 },
  runner_up_key: "faithful" };
function fixtureDb(statements, finalRows = null) {
  return async (statement) => {
    statements.push(statement);
    if (statement.includes("with latest_selection")) return [{ replica_id: IDS.replica, owner_user_id: IDS.owner, genome_version: 7, artifact_id: IDS.artifact }];
    if (statement.trimStart().startsWith("select p.preference_id,p.trial_id")) return [];
    if (statement.trimStart().startsWith("select p.* from vy_replica_voice_delivery_policy")) return [{ policy_id: IDS.policy,
      replica_id: IDS.replica, owner_user_id: IDS.owner, genome_version: 7, preview_artifact_id: IDS.artifact,
      language_id: "en", model_commitment: "a".repeat(64), source_set_hash: "b".repeat(64), status: "draft", definition }];
    if (statement.trimStart().startsWith("select t.prompt_key,t.holdout_seed_index")) return [];
    if (statement.trimStart().startsWith("select p.preference_id,p.pair_hash")) return observations();
    return finalRows || [{ trial_id: IDS.trial, expires_at: "2026-08-25T01:00:00Z" }];
  };
}

const issueSql = [];
const trial = await issueOwnedVoiceDeliveryHoldout(fixtureDb(issueSql), IDS.owner,
  { replica_id: IDS.replica, genome_version: 7, language_id: "en", policy_id: IDS.policy });
ok("holdout issuance returns public challenge text but hides candidate identity and side", trial.protocol === VOICE_DELIVERY_HOLDOUT_PROTOCOL && trial.prompt.key.startsWith("en.holdout.") && !("candidate_side" in trial) && !("left_style_key" in trial));
ok("holdout issuance rechecks all three grants and the private source", ["biometric", "training", "inference"].every((scope) => issueSql[4].includes(`scope='${scope}'`)) && /s\.state='ready'/.test(issueSql[4]));
ok("one active holdout is enforced transactionally", /not exists\(select 1 from vy_replica_voice_trial active/.test(issueSql[4]) && /voice_delivery_holdout_cell_ix|on conflict \(delivery_policy_id,prompt_key,holdout_seed_index\)/.test(issueSql[4]));
ok("the trial commits policy, deck, prompt, seed, renderer and both bounded styles", /delivery_policy_id/.test(issueSql[4]) && /prompt_deck_version/.test(issueSql[4]) && /holdout_seed_index/.test(issueSql[4]) && /model_commitment/.test(issueSql[4]));

const resolved = await resolveOwnedVoiceTrialSide(async () => [{ trial_id: IDS.trial, preview_seed: 17001, style_key: "balanced" }], IDS.owner,
  { replica_id: IDS.replica, genome_version: 7, trial_id: IDS.trial, trial_side: "right", language_id: "en", text_hash: "d".repeat(64) });
ok("preview resolution carries the server-assigned multi-seed value into protected synthesis", resolved.previewSeed === 17001 && resolved.styleKey === "balanced");

const finalizeSql = [];
const qualification = await finalizeOwnedVoiceDeliveryHoldout(fixtureDb(finalizeSql, [{ qualification_id: IDS.qualification,
  policy_id: IDS.policy, verdict: "owner_pass", observation_count: 12, prompt_family_count: 6,
  candidate_rate: 1, wilson_lower: perfect.wilsonLower, source_set_hash: "e".repeat(64) }]), IDS.owner,
  { replica_id: IDS.replica, genome_version: 7, language_id: "en", policy_id: IDS.policy });
ok("finalization persists an exact owner verdict and explicitly denies production qualification", qualification.verdict === "owner_pass" && qualification.production_qualified === false);
ok("finalization rechecks the complete exact preference snapshot", /exact as materialized/.test(finalizeSql[4]) && /cardinality\(\$15::uuid\[\]\)/.test(finalizeSql[4]) && /unnest\(\$15::uuid\[\]\)/.test(finalizeSql[4]));

const migration = readFileSync(join(ROOT, "db/migrations/050_replica_voice_delivery_holdout.sql"), "utf8");
const schema = readFileSync(join(ROOT, "db/schema.sql"), "utf8");
const route = readFileSync(join(ROOT, "api/replica-voice-delivery-policy.js"), "utf8");
const previewRoute = readFileSync(join(ROOT, "api/replica-voice-preview.js"), "utf8");
const previewCore = readFileSync(join(ROOT, "api/_replica-voice-preview.js"), "utf8");
const studio = readFileSync(join(ROOT, "src/studio/VoicePreviewLab.tsx"), "utf8");
const docs = readFileSync(join(ROOT, "docs/VOICE-DELIVERY-HOLDOUT.md"), "utf8");
ok("migration 050 makes calibration and holdout structurally disjoint", /phase='calibration' and delivery_policy_id is null/.test(migration) && /phase='holdout' and delivery_policy_id is not null/.test(migration));
ok("migration 050 binds every holdout to one policy and cascades erasure", /voice_trial_delivery_policy_fk/.test(migration) && /on delete cascade/.test(migration));
ok("the qualification ledger fixes twelve observations, six prompts and content-free hashes", /observation_count=12/.test(migration) && /prompt_family_count=6/.test(migration) && /source_set_hash/.test(migration));
ok("migration 050 is independently splitter-safe and mirrored in canonical schema", splitSql(migration).length >= 12 && schema.includes("vy_replica_voice_delivery_qualification"));
ok("the API exposes explicit issue and finalize operations behind owner authentication", /issue_holdout/.test(route) && /finalize_holdout/.test(route) && /requireUser/.test(route));
ok("only a resolved trial can override the default preview seed", /preview_seed: trial\?\.previewSeed/.test(previewRoute) && /input\?\.preview_seed == null/.test(previewCore));
ok("Studio keeps candidate identity blind and labels an owner pass as non-production", /Held-out candidate/.test(studio) && /This is not production qualification/.test(studio));
ok("the documented firewall names every remaining automated gate", ["speaker identity", "intelligibility", "artifacts", "latency", "watermark", "provenance", "privacy"].every((term) => docs.includes(term)));
ok("protocol and deck versions are pinned", VOICE_DELIVERY_HOLDOUT_REQUIRED === 12 && VOICE_DELIVERY_HOLDOUT_DECK_VERSION === "voice-delivery-holdout-deck/v1");

console.log(`\nVoice delivery owner holdout: ${passed} checks passed.`);
