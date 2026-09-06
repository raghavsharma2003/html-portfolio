import { canonicalJson, sha256Hex } from "../_provenance/contracts.js";
import { createSource, EXPRESSION_MAX_TTL_MS } from "./contracts.js";
import { createExpressionObservation } from "./expression-observation.js";
import { prepareExpressionObservationPersistence } from "./expression-observation-store.js";

const REQUIRED_SCOPES = Object.freeze(["capture", "storage", "transcription"]);
const RULESET_REVISION = "mirror_settled_turn_rules_v2";
const RULESET_HASH = sha256Hex(canonicalJson({
  revision: RULESET_REVISION,
  tokenization: "unicode_letter_or_number_tokens_v1",
  code_switch: "adjacent_exclusive_latin_devanagari_script_transition_ratio_v1",
  duration: "settled_mirror_window_duration_ms_v1",
}));
const ACOUSTIC_PROBE_REVISION = "pcm16_wav_energy_v1";
const ACOUSTIC_PROBE_HASH = sha256Hex(canonicalJson({
  revision: ACOUSTIC_PROBE_REVISION,
  input: "canonical_24khz_mono_pcm16_wav",
  energy: "20_log10_normalized_pcm_rms_v1",
}));

function fail(code) {
  throw Object.assign(new Error(code), { code });
}

function finiteConfidence(value, fallback) {
  if (value === null || value === undefined) return fallback;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 1) fail("mirror_expression_confidence_invalid");
  return number;
}

function tokens(text) {
  return String(text || "").match(/[\p{L}\p{N}][\p{L}\p{N}\p{M}]*(?:['’][\p{L}\p{N}\p{M}]+)?/gu) || [];
}

function exclusiveScript(token) {
  const latin = /\p{Script=Latin}/u.test(token);
  const devanagari = /\p{Script=Devanagari}/u.test(token);
  if (latin === devanagari) return null;
  return latin ? "latin" : "devanagari";
}

export function measureSettledMirrorExpression(transcript, durationMsValue) {
  const durationMs = Number(durationMsValue);
  if (!Number.isSafeInteger(durationMs) || durationMs < 1 || durationMs > 30_000) {
    fail("mirror_expression_duration_invalid");
  }
  const words = tokens(transcript);
  if (!words.length) fail("mirror_expression_transcript_required");
  const scripts = words.map(exclusiveScript).filter(Boolean);
  let transitions = 0;
  for (let index = 1; index < scripts.length; index += 1) {
    if (scripts[index] !== scripts[index - 1]) transitions += 1;
  }
  const codeSwitchRatio = scripts.length < 2 ? 0 : transitions / (scripts.length - 1);
  return Object.freeze({
    turn_duration_ms: durationMs,
    token_count: words.length,
    speech_rate_wpm: Number(((words.length * 60_000) / durationMs).toFixed(6)),
    code_switch_ratio: Number(codeSwitchRatio.toFixed(6)),
  });
}

/** Convert the strict server-side WAV probe's normalized RMS into dBFS.
 * This is a direct signal measurement, not loudness perception, arousal,
 * confidence, mood, or any other claim about the speaker's inner state. */
export function measureMirrorAcousticExpression(wavProbe) {
  if (wavProbe == null) return Object.freeze({});
  const rms = Number(wavProbe?.rms);
  if (!Number.isFinite(rms) || rms <= 0 || rms > 1) fail("mirror_expression_rms_invalid");
  return Object.freeze({
    energy_rms_db: Number((20 * Math.log10(rms)).toFixed(6)),
  });
}

/** Build the four bounded, collect-only rows for one successfully transcribed
 * Mirror window. Script transitions are not language identification; all
 * transcript-derived values are explicitly inferred by a named ruleset. */
export function createSettledMirrorExpressionRecords(input) {
  const grantedScopes = new Set(Array.isArray(input?.consentScopes) ? input.consentScopes.map(String) : []);
  if (REQUIRED_SCOPES.some((scope) => !grantedScopes.has(scope)) || input?.consentScope !== "training") {
    fail("mirror_expression_consent_scope_missing");
  }
  const observedAt = new Date(String(input?.capturedAt || ""));
  const grantedAt = new Date(String(input?.consentGrantedAt || ""));
  if (!Number.isFinite(observedAt.getTime()) || !Number.isFinite(grantedAt.getTime())) {
    fail("mirror_expression_time_invalid");
  }
  const dyadId = `dyad:${input.agentId}:${input.personId}`;
  const source = createSource({
    scope: { owner_id: input.ownerUserId, dyad_id: dyadId },
    modality: "call_audio",
    content_sha256: input.sourceSha256,
    byte_length: Number(input.sourceByteSize),
    captured_at: observedAt.toISOString(),
    speaker_scope: input.speakerVerification === "owner_verified" ? "owner"
      : input.speakerVerification === "foreign_speaker" ? "other" : "unknown",
    consent: {
      // The repository resolves this append-only receipt from the current
      // training grant. Never synthesize a consent artifact from session ids.
      receipt_id: input.consentId,
      subject: "owner",
      purposes: ["experience_observation"],
      granted_at: grantedAt.toISOString(),
    },
  });
  const inferredValues = measureSettledMirrorExpression(input.transcript, input.durationMs);
  const observedValues = measureMirrorAcousticExpression(input.wavProbe);
  const transcriptConfidence = finiteConfidence(input.transcriptConfidence, 0);
  const derivationCodeHash = sha256Hex(canonicalJson({
    ruleset_hash: RULESET_HASH,
    asr_provider: String(input.asrProvider),
    asr_model: String(input.asrModel),
  }));
  const common = {
    source,
    scope: source.scope,
    modality: "call_audio",
    observed_at: observedAt.toISOString(),
    expires_at: new Date(observedAt.getTime() + EXPRESSION_MAX_TTL_MS).toISOString(),
    span: { unit: "audio_ms", start: 0, end: Number(input.durationMs), content_sha256: input.sourceSha256 },
    turn_id: input.windowId,
  };
  const inferred = Object.entries(inferredValues).map(([featureName, featureValue]) => {
    const observation = createExpressionObservation({
      ...common,
      epistemic_status: "inferred",
      calibration: {
        status: "uncalibrated",
        method: "deterministic_units",
        revision: RULESET_REVISION,
        sample_size: 0,
      },
      producer: {
        kind: "rules",
        name: "mirror_settled_turn_rules",
        revision: RULESET_REVISION,
        // This hash binds the ruleset plus the ASR adapter lineage. It is not an
        // audio hash: the exact raw audio span remains sourceSha256 below.
        code_hash: derivationCodeHash,
      },
      feature_name: featureName,
      feature_value: featureValue,
      confidence: featureName === "turn_duration_ms" ? 1 : transcriptConfidence,
    });
    return prepareExpressionObservationPersistence({
      ownerUserId: input.ownerUserId,
      replicaId: input.replicaId,
      sourceId: input.sourceId,
      sessionId: input.sessionId,
      windowId: input.windowId,
      mirrorTurnId: null,
      agentId: input.agentId,
      personId: input.personId,
    }, observation).record;
  });
  const observed = Object.entries(observedValues).map(([featureName, featureValue]) => {
    const observation = createExpressionObservation({
      ...common,
      epistemic_status: "observed",
      calibration: {
        status: "uncalibrated",
        method: "direct_signal_units",
        revision: ACOUSTIC_PROBE_REVISION,
        sample_size: 0,
      },
      producer: {
        kind: "direct_measurement",
        name: "pcm16_wav_probe",
        revision: ACOUSTIC_PROBE_REVISION,
        code_hash: ACOUSTIC_PROBE_HASH,
      },
      feature_name: featureName,
      feature_value: featureValue,
      confidence: 1,
    });
    return prepareExpressionObservationPersistence({
      ownerUserId: input.ownerUserId,
      replicaId: input.replicaId,
      sourceId: input.sourceId,
      sessionId: input.sessionId,
      windowId: input.windowId,
      mirrorTurnId: null,
      agentId: input.agentId,
      personId: input.personId,
    }, observation).record;
  });
  return Object.freeze([...inferred, ...observed]);
}
