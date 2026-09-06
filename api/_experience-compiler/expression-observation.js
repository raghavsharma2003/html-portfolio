import { createObservation, verifyObservation } from "./contracts.js";

// Closed by design. Adding a feature is a schema change with an eval, not a
// model-written label. Every value is a directly measurable delivery or
// interaction mechanic; none names mood, intent, personality or inner state.
export const EXPRESSION_FEATURES = Object.freeze({
  speech_rate_wpm: Object.freeze({ unit: "words_per_minute", min: 0, max: 1_000 }),
  articulation_rate_sps: Object.freeze({ unit: "syllables_per_second", min: 0, max: 50 }),
  pause_ratio: Object.freeze({ unit: "ratio", min: 0, max: 1 }),
  mean_pause_ms: Object.freeze({ unit: "milliseconds", min: 0, max: 300_000 }),
  pause_count: Object.freeze({ unit: "count", min: 0, max: 10_000, integer: true }),
  turn_latency_ms: Object.freeze({ unit: "milliseconds", min: 0, max: 300_000 }),
  turn_duration_ms: Object.freeze({ unit: "milliseconds", min: 1, max: 86_400_000 }),
  overlap_ratio: Object.freeze({ unit: "ratio", min: 0, max: 1 }),
  interruption_count: Object.freeze({ unit: "count", min: 0, max: 10_000, integer: true }),
  backchannel_count: Object.freeze({ unit: "count", min: 0, max: 10_000, integer: true }),
  laughter_ratio: Object.freeze({ unit: "ratio", min: 0, max: 1 }),
  laughter_count: Object.freeze({ unit: "count", min: 0, max: 10_000, integer: true }),
  energy_rms_db: Object.freeze({ unit: "decibels_rms", min: -200, max: 50 }),
  pitch_median_hz: Object.freeze({ unit: "hertz", min: 0, max: 5_000 }),
  pitch_range_hz: Object.freeze({ unit: "hertz", min: 0, max: 5_000 }),
  voiced_ratio: Object.freeze({ unit: "ratio", min: 0, max: 1 }),
  emphasis_rate: Object.freeze({ unit: "events_per_minute", min: 0, max: 1_000 }),
  code_switch_ratio: Object.freeze({ unit: "ratio", min: 0, max: 1 }),
  token_count: Object.freeze({ unit: "count", min: 0, max: 1_000_000, integer: true }),
  syllable_count: Object.freeze({ unit: "count", min: 0, max: 1_000_000, integer: true }),
});

const VALUE_KEYS = Object.freeze(["feature_name", "feature_unit", "feature_value"]);

function fail(code) {
  throw Object.assign(new Error(code), { code });
}

function normalizedFeature(name, value, unit) {
  const featureName = String(name || "");
  const spec = EXPRESSION_FEATURES[featureName];
  if (!spec) fail("expression_feature_not_allowed");
  const featureValue = Number(value);
  if (!Number.isFinite(featureValue) || featureValue < spec.min || featureValue > spec.max ||
      (spec.integer && !Number.isInteger(featureValue))) fail("expression_feature_value_invalid");
  const featureUnit = unit == null ? spec.unit : String(unit);
  if (featureUnit !== spec.unit) fail("expression_feature_unit_invalid");
  return { feature_name: featureName, feature_unit: featureUnit, feature_value: featureValue };
}

function assertProducerEpistemicPair(observation) {
  const observed = observation.epistemic_status === "observed";
  const permitted = observed
    ? new Set(["direct_measurement", "human_annotation"])
    : new Set(["model", "rules"]);
  if (!permitted.has(observation.producer.kind)) fail("expression_epistemic_producer_mismatch");
}

/**
 * Build one committed expression feature observation through the general
 * experience-compiler contract. `value` is intentionally constructed here;
 * callers cannot pass arbitrary JSON or an observer-written emotion label.
 */
export function createExpressionObservation(input) {
  const feature = normalizedFeature(input?.feature_name, input?.feature_value, input?.feature_unit);
  const observation = createObservation({
    source: input?.source,
    scope: input?.scope,
    modality: input?.modality ?? input?.source?.modality,
    kind: "expression",
    epistemic_status: input?.epistemic_status,
    value: feature,
    confidence: input?.confidence,
    calibration: input?.calibration,
    producer: input?.producer,
    observed_at: input?.observed_at,
    expires_at: input?.expires_at,
    span: input?.span,
    expression: {
      turn_id: input?.turn_id,
      claim_target: "delivery_cue",
      interpretation: "observer_interpretation",
      may_claim_inner_emotion: false,
    },
  });
  assertProducerEpistemicPair(observation);
  return observation;
}

export function verifyExpressionObservation(input) {
  const observation = verifyObservation(input);
  if (observation.kind !== "expression") fail("expression_observation_kind_required");
  if (!observation.scope.dyad_id || !observation.expression?.turn_id) fail("expression_turn_and_dyad_scope_required");
  const keys = Object.keys(observation.value || {}).sort();
  if (keys.length !== VALUE_KEYS.length || keys.some((key, index) => key !== VALUE_KEYS[index])) {
    fail("expression_feature_shape_invalid");
  }
  const normalized = normalizedFeature(
    observation.value.feature_name,
    observation.value.feature_value,
    observation.value.feature_unit,
  );
  if (JSON.stringify(normalized) !== JSON.stringify(observation.value)) fail("expression_feature_shape_invalid");
  assertProducerEpistemicPair(observation);
  return observation;
}
