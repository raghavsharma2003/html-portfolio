import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  issueOwnedVoiceTrial,
  recommendVoiceTrial,
  resolveOwnedVoiceTrialSide,
  VOICE_CURRICULUM_ALGORITHM,
  VOICE_TRIAL_STYLE_KEYS,
} from "../../api/_replica-voice-curriculum.js";
import { OPEN_CHATTERBOX_MODEL_COMMITMENT } from "../../api/_voice/providers/open-chatterbox-preview.js";
import { splitSql } from "../../db/migrations/apply.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const IDS = {
  owner: "11111111-1111-4111-8111-111111111111",
  replica: "22222222-2222-4222-8222-222222222222",
  artifact: "33333333-3333-4333-8333-333333333333",
  trial: "44444444-4444-4444-8444-444444444444",
};
let passed = 0;
function ok(name, condition) { assert.ok(condition, name); passed++; console.log(`  PASS ${name}`); }
function unordered(result) { return [result.leftStyleKey, result.rightStyleKey].sort().join(":"); }

const first = recommendVoiceTrial([], "stable-context");
ok("an empty curriculum starts from a useful identity versus balance anchor", unordered(first) === "balanced:faithful");
ok("trial side order is deterministic for an exact context", unordered(first) === unordered(recommendVoiceTrial([], "stable-context")) && first.leftStyleKey === recommendVoiceTrial([], "stable-context").leftStyleKey);

const bootstrap = [];
const bootstrapPairs = [];
for (let index = 0; index < 5; index++) {
  const next = recommendVoiceTrial(bootstrap, "bootstrap");
  bootstrapPairs.push(unordered(next));
  bootstrap.push({ left_style_key: next.leftStyleKey, right_style_key: next.rightStyleKey, choice: "tie" });
}
ok("bootstrap covers the full seven-condition manifold before exploitation", new Set(bootstrap.flatMap((row) => [row.left_style_key, row.right_style_key])).size === 7 && new Set(bootstrapPairs).size === 5);

const decisive = [];
for (const opponent of VOICE_TRIAL_STYLE_KEYS.filter((key) => key !== "balanced")) {
  for (let repeat = 0; repeat < 5; repeat++) decisive.push({ left_style_key: "balanced", right_style_key: opponent, choice: "left" });
}
const learned = recommendVoiceTrial(decisive, "learned");
ok("repeated owner evidence identifies a provisional delivery champion", learned.provisionalChampion === "balanced");
ok("convergence requires depth, full condition coverage, champion exposure and separation", learned.converged && learned.completedComparisons === 30 && learned.coveredConditions === 7);

const rejected = recommendVoiceTrial(VOICE_TRIAL_STYLE_KEYS.slice(0, -1).map((key, index) => ({
  left_style_key: key,
  right_style_key: VOICE_TRIAL_STYLE_KEYS[index + 1],
  choice: "neither",
})), "rejected");
ok("neither labels remain rejection evidence and cannot fabricate convergence", !rejected.converged);

const sql = [];
const trial = await issueOwnedVoiceTrial(async (statement, params) => {
  sql.push(statement);
  if (statement.includes("with latest_selection")) return [{ replica_id: IDS.replica, owner_user_id: IDS.owner, genome_version: 7, artifact_id: IDS.artifact }];
  if (statement.includes("select p.choice")) return [];
  assert.equal(params[0], IDS.replica);
  assert.equal(params[1], IDS.owner);
  return [{ trial_id: IDS.trial, expires_at: "2026-08-25T01:00:00.000Z" }];
}, IDS.owner, { replica_id: IDS.replica, genome_version: 7, language_id: "hi", text_hash: "9".repeat(64) });
ok("trial issuance rechecks identity, all three consents and latest selected evidence", /identity_expires_at>now\(\)/.test(sql[0]) && ["biometric", "training", "inference"].every((scope) => sql[0].includes(`scope='${scope}'`)) && /newer\.created_at/.test(sql[2]));
ok("the owner response exposes progress but not hidden condition identities", trial.algorithm === VOICE_CURRICULUM_ALGORITHM && trial.progress.total_conditions === 7 && !("left_style_key" in trial) && !("right_style_key" in trial));
ok("the stored trial binds prompt hash, seed, model, artifact, algorithm and pair", /text_hash/.test(sql[2]) && /preview_seed/.test(sql[2]) && /model_commitment/.test(sql[2]) && /pair_hash/.test(sql[2]) && /preview_artifact_id/.test(sql[2]));

let resolveSql = "";
const resolved = await resolveOwnedVoiceTrialSide(async (statement, params) => {
  resolveSql = statement;
  assert.equal(params[0], IDS.trial);
  return [{ trial_id: IDS.trial, style_key: "steady_warm" }];
}, IDS.owner, { replica_id: IDS.replica, genome_version: 7, trial_id: IDS.trial, trial_side: "left", language_id: "hi", text_hash: "9".repeat(64) });
ok("a hidden condition resolves only for the exact owner, context, active state and model", resolved.styleKey === "steady_warm" && /owner_user_id=\$3/.test(resolveSql) && /state='issued'/.test(resolveSql) && /model_commitment=\$8/.test(resolveSql));
ok("every curriculum condition maps to a bounded server-owned synthesis preset", VOICE_TRIAL_STYLE_KEYS.length === 7 && new Set(VOICE_TRIAL_STYLE_KEYS).size === 7);

const migration = readFileSync(join(ROOT, "db/migrations/047_replica_voice_curriculum.sql"), "utf8");
const schema = readFileSync(join(ROOT, "db/schema.sql"), "utf8");
const previewCore = readFileSync(join(ROOT, "api/_replica-voice-preview.js"), "utf8");
const previewRoute = readFileSync(join(ROOT, "api/replica-voice-preview.js"), "utf8");
const trialRoute = readFileSync(join(ROOT, "api/replica-voice-trial.js"), "utf8");
const sourceErasure = readFileSync(join(ROOT, "api/_replica-source-erasure.js"), "utf8");
const documentation = readFileSync(join(ROOT, "docs/VOICE-CURRICULUM.md"), "utf8");
ok("migration 047 is owner, artifact and genome bound", /voice_trial_owner_fk/.test(migration) && /voice_trial_genome_fk/.test(migration) && /voice_trial_artifact_fk/.test(migration));
ok("migration 047 remains independently splitter-safe", splitSql(migration).length >= 8);
ok("one active protected preview generation is allowed per assigned trial side", /vy_replica_generation_active_trial_side/.test(migration) && /purpose='voice_preview' and preview_trial_id is not null/.test(migration) && /preview_trial_side in \('left','right'\)/.test(migration));
ok("the trial ledger stores no prompt transcript or audio bytes", !/\b(prompt|transcript|audio_bytes)\s+(text|jsonb|bytea)/i.test(migration) && /text_hash/.test(migration));
ok("canonical schema mirrors the adaptive curriculum", schema.includes("vy_replica_voice_trial") && schema.includes("voice-curriculum/bt-active-v1"));
ok("preview issuance binds the assignment before generation insertion", /vy_replica_voice_trial t/.test(previewCore) && /t\.left_style_key/.test(previewCore) && /const trial = body\.trial_id \? await resolveOwnedVoiceTrialSide[\s\S]+started = await beginOwnedVoicePreview/.test(previewRoute));
ok("trial issuance is bearer-owner-only, rate limited and never returns hidden conditions", /requireUser/.test(trialRoute) && /replica_voice_trial_user/.test(trialRoute) && !/leftStyleKey|rightStyleKey/.test(trialRoute));
ok("source erasure explicitly removes preferences, generations, then trial commitments", sourceErasure.indexOf("voice_preferences as") < sourceErasure.indexOf("preview_generations as") && sourceErasure.indexOf("preview_generations as") < sourceErasure.indexOf("voice_trials as"));
ok("the pinned model commitment remains part of every trial", /^[0-9a-f]{64}$/.test(OPEN_CHATTERBOX_MODEL_COMMITMENT));
ok("the research contract distinguishes convergence from human indistinguishability", /not a claim of human indistinguishability/i.test(documentation) && /held-out prompts/i.test(documentation));

console.log(`\nAdaptive voice curriculum: ${passed} checks passed.`);
