import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const manifestUrl = new URL("./manifest.json", import.meta.url);
const manifest = JSON.parse(readFileSync(manifestUrl, "utf8"));

function validate(candidate) {
  const failures = [];
  const fail = (message) => failures.push(message);
  const stage = (id) => candidate.stages.find((item) => item.id === id);
  const artifact = (id) => candidate.artifact_classes.find((item) => item.id === id);
  const gate = (id) => candidate.hard_gates.find((item) => item.id === id);
  const sourceIds = new Set(candidate.sources.map((item) => item.id));

  if (candidate.$schema !== "vyakti/continuous-human-clone-frontier/v1") fail("schema must be pinned to v1");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(candidate.as_of)) fail("as_of must be an ISO date");
  if (!candidate.claim_boundary.toLowerCase().includes("not evidence")) fail("manifest must state its evidence boundary");

  const orders = candidate.stages.map((item) => item.order);
  if (new Set(orders).size !== orders.length) fail("stage order must be unique");
  if (orders.some((order, index) => index > 0 && order <= orders[index - 1])) fail("stages must be strictly ordered");

  const liveMutators = candidate.stages.filter((item) => item.can_mutate_live_persona);
  if (liveMutators.length !== 1 || liveMutators[0]?.id !== "materialize") fail("only materialize may mutate a live persona");
  if (stage("materialize")?.write_policy !== "accepted_candidate_only") fail("materialize must consume accepted candidates only");
  if (!stage("materialize")?.required_receipts.includes("owner_decision_id")) fail("materialize must bind the owner decision");
  if (stage("extract_candidates")?.can_mutate_live_persona !== false) fail("candidate extraction may not mutate persona");
  if (!candidate.hot_path.forbidden_mutations.includes("model_weights")) fail("hot path must forbid model weight updates");
  if (candidate.hot_path.allowed_writes.some((id) => candidate.hot_path.forbidden_mutations.includes(id))) fail("hot-path allow and deny lists overlap");

  const expression = artifact("ephemeral_expression_observation");
  if (expression?.durability !== "ephemeral" || !(expression.ttl_hours > 0 && expression.ttl_hours <= 24)) fail("expression observations must expire within 24 hours");
  if (expression?.scope !== "dyad_session_turn") fail("expression observations must be dyad/session/turn scoped");
  if (expression?.may_claim_internal_emotion !== false) fail("expression observations may not claim internal emotion");

  const relation = artifact("relation_candidate");
  if (relation?.scope !== "agent_person_dyad") fail("relation candidate must be dyad scoped");
  if (relation?.meaning.toLowerCase().includes("diagnosis" ) === false) fail("relation candidate must explicitly refuse diagnosis semantics");

  const voice = artifact("voice_window_candidate");
  if (voice?.scope !== "verified_owner_speaker") fail("voice candidate must bind a verified owner speaker");
  if (!voice?.requires_source_provenance || !voice?.requires_consent_receipt) fail("voice candidate needs provenance and consent");
  if (stage("materialize")?.inputs.includes("pooled_reference_duration")) fail("pooled duration cannot directly materialize a voice");

  const extractedReceipts = stage("extract_candidates")?.required_receipts ?? [];
  for (const field of ["source_event_ids", "valid_from", "valid_to", "contradiction_set"]) {
    if (!extractedReceipts.includes(field)) fail(`candidate extraction missing ${field}`);
  }

  const responseReceipts = stage("respond")?.required_receipts ?? [];
  for (const field of ["persona_version", "voice_artifact_id", "model_commitment", "disclosure_receipt", "watermark_receipt"]) {
    if (!responseReceipts.includes(field)) fail(`protected response missing ${field}`);
  }

  if (candidate.status_contract.percent_allowed_for.includes("gpu_cold_start")) fail("GPU cold start cannot have a fake percent");
  if (!candidate.status_contract.percent_forbidden_for.includes("gpu_cold_start")) fail("GPU cold start must explicitly forbid percent");
  if (candidate.status_contract.eta.minimum_sample_size < 30) fail("ETA calibration needs at least 30 observations");
  for (const field of ["current_stage", "waiting_on", "next_check_at", "can_leave_page", "notification_channel"]) {
    if (!candidate.status_contract.eta.must_render.includes(field)) fail(`status contract missing ${field}`);
  }
  if (candidate.status_contract.gpu_wake.warmth_source !== "signed_remote_runtime_probe") fail("GPU state must come from signed remote readiness");

  const requiredSuites = ["call_interaction", "memory", "persona", "expression", "voice", "safety_and_provenance", "operations_and_status"];
  const suiteIds = new Set(candidate.evaluation_suites.map((item) => item.id));
  for (const id of requiredSuites) if (!suiteIds.has(id)) fail(`missing evaluation suite ${id}`);
  for (const suite of candidate.evaluation_suites) {
    if (suite.protocol?.status !== "proposed_unmeasured") fail(`evaluation suite ${suite.id} must label its protocol as proposed and unmeasured`);
    if (!suite.protocol?.promotion_targets || Object.keys(suite.protocol.promotion_targets).length === 0) fail(`evaluation suite ${suite.id} needs promotion targets`);
  }
  if (candidate.evaluation_suites.find((item) => item.id === "call_interaction")?.protocol?.minimum_runs_per_thermal_language_device_network_cell < 30) fail("latency protocol needs at least 30 runs per cell");
  const callMetrics = candidate.evaluation_suites.find((item) => item.id === "call_interaction")?.metrics ?? [];
  for (const metric of ["tool_call_accuracy", "say_do_consistency", "authentication_discipline", "escalation_discipline", "caller_outcome"]) {
    if (!callMetrics.includes(metric)) fail(`call interaction suite missing ${metric}`);
  }
  if (candidate.evaluation_suites.find((item) => item.id === "memory")?.protocol?.minimum_questions < 300) fail("memory protocol needs at least 300 questions");
  if (candidate.evaluation_suites.find((item) => item.id === "persona")?.protocol?.checkpoints?.at(-1) !== 44) fail("persona protocol must test through turn 44");
  if (candidate.evaluation_suites.find((item) => item.id === "expression")?.protocol?.minimum_speakers_per_language < 30) fail("expression protocol needs at least 30 speakers per language");
  if (candidate.evaluation_suites.find((item) => item.id === "voice")?.protocol?.minimum_blinded_raters_per_stimulus < 5) fail("voice protocol needs at least five blinded raters per stimulus");
  if (candidate.evaluation_suites.find((item) => item.id === "safety_and_provenance")?.protocol?.minimum_adversarial_probes < 1000) fail("safety protocol needs at least 1,000 probes");
  const safetyMetrics = candidate.evaluation_suites.find((item) => item.id === "safety_and_provenance")?.metrics ?? [];
  for (const metric of ["cross_owner_leakage", "cross_dyad_leakage", "unapproved_update_rate", "unconsented_voice_admission_rate", "erasure_reachability"]) {
    if (!safetyMetrics.includes(metric)) fail(`safety suite missing ${metric}`);
  }

  if (candidate.hard_gates.length < 8) fail("all eight hard gates must remain present");
  for (const item of candidate.hard_gates) {
    if (!item.invariant || !item.negative_control) fail(`hard gate ${item.id} needs an invariant and negative control`);
  }
  for (const id of ["no_silent_persona_update", "expression_is_not_inner_state", "speaker_consent_binds_voice", "relation_is_dyad_scoped", "facts_are_bitemporal", "voice_learning_is_selection", "generation_is_protected", "status_has_an_honest_denominator"]) {
    if (!gate(id)) fail(`missing hard gate ${id}`);
  }

  for (const model of candidate.candidate_matrix) {
    if (!model.license || !model.ship_state || !model.hindi) fail(`candidate ${model.id} lacks license, Hindi, or ship verdict`);
    if (!Array.isArray(model.source_ids) || model.source_ids.length === 0) fail(`candidate ${model.id} lacks primary sources`);
    for (const sourceId of model.source_ids) if (!sourceIds.has(sourceId)) fail(`candidate ${model.id} cites unknown source ${sourceId}`);
  }
  const phoneLlm = candidate.candidate_matrix.find((item) => item.id === "phonellm_alpha_1");
  if (phoneLlm?.revision !== "8e76aaa6e8ce4765ac943ba3fb339494d4d48dca") fail("PhoneLLM revision must stay exact");
  if (phoneLlm?.weights_bytes !== 63174634906) fail("PhoneLLM weight closure must stay measured");
  if (phoneLlm?.official_language !== "English" || !phoneLlm?.hindi?.includes("not_supported")) fail("PhoneLLM must remain English-only until measured otherwise");
  if (phoneLlm?.recommended_settings?.temperature !== 0 || phoneLlm?.recommended_settings?.thinking !== false) fail("PhoneLLM serving settings must match training");
  if (!phoneLlm?.ship_state?.includes("shadow_eval_only")) fail("PhoneLLM cannot enter the live call lane before the multilingual gate");
  if (phoneLlm?.vendor_benchmark?.name !== "PhoneBench Alpha 1" || phoneLlm?.vendor_benchmark?.score_percent !== 72.3) fail("PhoneLLM vendor benchmark identity must stay exact");
  if (phoneLlm?.vendor_benchmark?.p50_time_to_first_answer_token_ms !== 331 || phoneLlm?.vendor_benchmark?.p95_time_to_first_answer_token_ms !== 600) fail("PhoneLLM latency claims must stay vendor-bound and exact");
  if (phoneLlm?.vendor_benchmark?.estimated_llm_cost_per_conversation_minute_usd !== 0.0025) fail("PhoneLLM cost claim must stay vendor-bound and exact");
  for (const axis of ["tool_call_accuracy", "say_do_consistency", "authentication_discipline", "escalation_discipline", "caller_outcome"]) {
    if (!phoneLlm?.vendor_benchmark?.required_eval_axes?.includes(axis)) fail(`PhoneLLM benchmark axis ${axis} is required`);
  }
  for (const cost of candidate.cost_assumptions) {
    if (!cost.kind || !sourceIds.has(cost.source_id)) fail(`cost assumption ${cost.id} is unlabelled or uncited`);
  }
  for (const source of candidate.sources) {
    if (!source.url.startsWith("https://")) fail(`source ${source.id} must be HTTPS`);
    if (!new Set(["paper", "official_repo", "official_model_card", "official_product_docs", "official_law", "official_regulator"]).has(source.kind)) fail(`source ${source.id} is not a primary-source class`);
  }

  if (candidate.rollout.length !== 7 || candidate.rollout[0]?.stage !== 0 || candidate.rollout.at(-1)?.stage !== 6) fail("rollout must stay staged from 0 through 6");
  if (candidate.rollout.find((item) => item.stage === 1)?.writes_live_state !== false) fail("shadow observation may not write live state");
  if (candidate.rollout.find((item) => item.stage === 2)?.writes_live_state !== false) fail("candidate preview may not write live state");
  if (candidate.reversal_conditions.length < 6 || candidate.reversal_conditions.some((item) => !item.decision || !item.reverse_if)) fail("decisions need explicit reversal conditions");

  return failures;
}

const failures = validate(manifest);
assert.deepEqual(failures, [], failures.join("\n"));

function clone() {
  return structuredClone(manifest);
}

const controls = [
  ["silent persona update", (item) => { item.stages.find((stage) => stage.id === "extract_candidates").can_mutate_live_persona = true; }],
  ["inner emotion claim", (item) => { item.artifact_classes.find((artifact) => artifact.id === "ephemeral_expression_observation").may_claim_internal_emotion = true; }],
  ["unconsented voice candidate", (item) => { item.artifact_classes.find((artifact) => artifact.id === "voice_window_candidate").requires_consent_receipt = false; }],
  ["global relationship trait", (item) => { item.artifact_classes.find((artifact) => artifact.id === "relation_candidate").scope = "global_person"; }],
  ["atemporal fact", (item) => { item.stages.find((stage) => stage.id === "extract_candidates").required_receipts = item.stages.find((stage) => stage.id === "extract_candidates").required_receipts.filter((field) => field !== "valid_to"); }],
  ["duration masquerades as voice learning", (item) => { item.stages.find((stage) => stage.id === "materialize").inputs.push("pooled_reference_duration"); }],
  ["unprotected audio", (item) => { item.stages.find((stage) => stage.id === "respond").required_receipts = item.stages.find((stage) => stage.id === "respond").required_receipts.filter((field) => field !== "disclosure_receipt"); }],
  ["fake GPU percent", (item) => { item.status_contract.percent_allowed_for.push("gpu_cold_start"); }]
  , ["PhoneLLM promoted without multilingual evidence", (item) => { item.candidate_matrix.find((model) => model.id === "phonellm_alpha_1").ship_state = "production"; }]
];

for (const [name, mutate] of controls) {
  const changed = clone();
  mutate(changed);
  assert.ok(validate(changed).length > 0, `negative control did not fail: ${name}`);
}

console.log(`continuous-human-clone manifest ok (${manifest.stages.length} stages, ${manifest.hard_gates.length} gates, ${controls.length} negative controls, ${manifest.sources.length} primary sources)`);
