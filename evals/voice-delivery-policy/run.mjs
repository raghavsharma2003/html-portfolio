import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildOwnedVoiceDeliveryPolicy,
  buildVoiceDeliveryPolicyDraft,
  ownedVoiceDeliveryPolicyStatus,
  VOICE_DELIVERY_POLICY_BUILDER,
  VOICE_DELIVERY_POLICY_SCHEMA,
} from "../../api/_replica-voice-delivery-policy.js";
import { VOICE_CALIBRATION_PROMPTS, VOICE_TRIAL_STYLE_KEYS } from "../../api/_replica-voice-curriculum.js";
import { splitSql } from "../../db/migrations/apply.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const IDS = {
  owner: "11111111-1111-4111-8111-111111111111",
  replica: "22222222-2222-4222-8222-222222222222",
  artifact: "33333333-3333-4333-8333-333333333333",
  policy: "44444444-4444-4444-8444-444444444444",
};
let passed = 0;
function ok(name, condition) { assert.ok(condition, name); passed++; console.log(`  PASS ${name}`); }
function uuid(index) { return `aaaaaaaa-aaaa-4aaa-8aaa-${String(index).padStart(12, "0")}`; }

const history = [];
let sequence = 1;
for (const [opponentIndex, opponent] of VOICE_TRIAL_STYLE_KEYS.filter((key) => key !== "balanced").entries()) {
  for (let repeat = 0; repeat < 5; repeat++) {
    history.push({
      preference_id: uuid(sequence), trial_id: uuid(100 + sequence), pair_hash: String(sequence).padStart(64, "a").slice(-64),
      left_style_key: "balanced", right_style_key: opponent, choice: "left", confidence: 1,
      prompt_key: VOICE_CALIBRATION_PROMPTS.en[(opponentIndex + repeat) % VOICE_CALIBRATION_PROMPTS.en.length].key,
    });
    sequence++;
  }
}
const context = { replicaId: IDS.replica, genomeVersion: 7, artifactId: IDS.artifact, languageId: "en" };
const draft = buildVoiceDeliveryPolicyDraft(history, context);
ok("a converged exact-evidence set freezes a delivery candidate", draft.definition.schema === VOICE_DELIVERY_POLICY_SCHEMA && draft.definition.builder === VOICE_DELIVERY_POLICY_BUILDER);
ok("the candidate preserves acoustic identity separation and only freezes bounded delivery", draft.definition.champion.key === "balanced" && draft.definition.champion.schema === "vyakti.voice-preview-style.v1");
ok("the evidence commitment is deterministic and content-free", /^[0-9a-f]{64}$/.test(draft.sourceSetHash) && draft.sourceSetHash === buildVoiceDeliveryPolicyDraft(history, context).sourceSetHash && !JSON.stringify(draft.definition).includes("preference_id"));
ok("all seven condition estimates are preserved for audit", draft.definition.condition_estimates.length === 7 && new Set(draft.definition.condition_estimates.map((row) => row.key)).size === 7);
ok("language, renderer, curriculum and prompt deck are immutable inputs", draft.definition.language_id === "en" && /^[0-9a-f]{64}$/.test(draft.definition.model_commitment) && /bt-active-v2/.test(draft.definition.curriculum_algorithm) && /deck\/v1/.test(draft.definition.prompt_deck_version));

let notReady = "";
try { buildVoiceDeliveryPolicyDraft(history.map((row) => ({ ...row, prompt_key: "en.identity-neutral.v1" })), context); }
catch (error) { notReady = error.code; }
ok("one over-repeated prompt cannot freeze a delivery policy", notReady === "voice_delivery_policy_not_ready");
const changed = history.map((row, index) => index === 0 ? { ...row, choice: "right" } : row);
ok("changing one exact owner judgment changes the source commitment", buildVoiceDeliveryPolicyDraft(changed, context).sourceSetHash !== draft.sourceSetHash);

const buildSql = [];
const built = await buildOwnedVoiceDeliveryPolicy(async (statement) => {
  buildSql.push(statement);
  if (statement.includes("with latest_selection")) return [{ replica_id: IDS.replica, owner_user_id: IDS.owner, genome_version: 7, artifact_id: IDS.artifact }];
  if (statement.trimStart().startsWith("select p.preference_id")) return history;
  return [{ policy_id: IDS.policy, version: 1, language_id: "en", status: "draft", definition: draft.definition,
    evidence_count: 30, unique_prompt_count: 7, latent_margin: draft.schedule.latentMargin,
    source_set_hash: draft.sourceSetHash, created_at: "2026-08-25T00:00:00Z" }];
}, IDS.owner, { replica_id: IDS.replica, genome_version: 7, language_id: "en" });
ok("the production builder returns a draft and never auto-approves it", built.status === "draft" && built.policy_id === IDS.policy);
ok("settlement rechecks identity, all three consents and selected private evidence", /identity_expires_at>now\(\)/.test(buildSql[2]) && ["biometric", "training", "inference"].every((scope) => buildSql[2].includes(`scope='${scope}'`)) && /newer\.created_at/.test(buildSql[2]));
ok("settlement requires the complete exact preference snapshot", /exact_evidence as materialized/.test(buildSql[2]) && /cardinality\(\$9::uuid\[\]\)/.test(buildSql[2]) && /unnest\(\$9::uuid\[\]\)/.test(buildSql[2]));
ok("builds serialize per replica and language and retire only older drafts", /pg_advisory_xact_lock/.test(buildSql[2]) && /status='draft'/.test(buildSql[2]) && /status='retired'/.test(buildSql[2]));

const status = await ownedVoiceDeliveryPolicyStatus(async (statement) => {
  if (statement.includes("with latest_selection")) return [{ replica_id: IDS.replica, owner_user_id: IDS.owner, genome_version: 7, artifact_id: IDS.artifact }];
  if (statement.trimStart().startsWith("select p.preference_id")) return history;
  return [{ policy_id: IDS.policy, version: 1, language_id: "en", status: "draft", definition: draft.definition,
    evidence_count: 30, unique_prompt_count: 7, latent_margin: draft.schedule.latentMargin,
    source_set_hash: draft.sourceSetHash, created_at: "2026-08-25T00:00:00Z" }];
}, IDS.owner, { replica_id: IDS.replica, genome_version: 7, language_id: "en" });
ok("owner status reveals readiness and bounded candidate metadata but no model scores", status.readiness.ready && status.policies[0].champion_key === "balanced" && !("condition_estimates" in status.policies[0]));

const migration = readFileSync(join(ROOT, "db/migrations/049_replica_voice_delivery_policy.sql"), "utf8");
const schema = readFileSync(join(ROOT, "db/schema.sql"), "utf8");
const route = readFileSync(join(ROOT, "api/replica-voice-delivery-policy.js"), "utf8");
const studio = readFileSync(join(ROOT, "src/studio/VoicePreviewLab.tsx"), "utf8");
const erasure = readFileSync(join(ROOT, "api/_replica-source-erasure.js"), "utf8");
const docs = readFileSync(join(ROOT, "docs/VOICE-DELIVERY-POLICY.md"), "utf8");
ok("migration 049 is owner, VoiceGenome and artifact bound", /voice_delivery_owner_fk/.test(migration) && /voice_delivery_genome_fk/.test(migration) && /voice_delivery_artifact_fk/.test(migration));
ok("migration 049 enforces evidence depth, prompt diversity and draft-only lifecycle options", /evidence_count>=18/.test(migration) && /unique_prompt_count>=6/.test(migration) && /'draft','qualifying','qualified','approved','rejected','retired'/.test(migration));
ok("migration 049 is independently splitter-safe and mirrored in canonical schema", splitSql(migration).length >= 3 && schema.includes("vy_replica_voice_delivery_policy"));
ok("the owner HTTP boundary is bearer-only, rate limited and build-explicit", /requireUser/.test(route) && /replica_voice_delivery_policy_user/.test(route) && /input\.op === "build"/.test(route));
// WS-R10: the panel's label lost the word "genome" (Rooms vocabulary rule,
// scripts/check-copy.mjs) — it reads "Voice Delivery" now, not "Voice
// Delivery Genome". The check below moved with it; what it still proves
// (evidence depth is shown as immutable and qualification is still gated)
// is unchanged.
// WS-R71: VoicePreviewLab.tsx's own literal strings moved into
// src/studio/copy.ts (`t.voicePreviewLab`); this check now reads the
// concatenation, `evals/readiness/run.mjs`'s own `panelWithCopy` shape.
const studioWithCopy = `${studio}\n${readFileSync(join(ROOT, "src/studio/copy.ts"), "utf8")}`;
ok("Studio shows immutable evidence depth and states that qualification is still required", /Voice Delivery/.test(studioWithCopy) && /held-out qualification/.test(studioWithCopy) && /Repeating one familiar sentence cannot unlock/.test(studioWithCopy));
ok("source erasure deletes derived delivery policies before private processing lineage disappears", /voice_delivery_policies as/.test(erasure) && erasure.indexOf("voice_delivery_policies as") < erasure.indexOf("voice_preferences as"));
ok("the research contract forbids automatic promotion and requires held-out ABX", /never promotes/i.test(docs) && /held-out prompts/i.test(docs) && /owner ABX/i.test(docs));

console.log(`\nVoice Delivery Genome: ${passed} checks passed.`);
