import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { probeEnrollmentWav } from "../../api/_audio/wav.js";
import { canonicalJson, sha256Hex } from "../../api/_provenance/contracts.js";
import { renderTextWithDisclosure, VOICE_PCM_FORMAT } from "../../api/_voice/contracts.js";
import { voiceScriptMode } from "../../api/_voice/language-conditioning.js";
import {
  createOpenChatterboxPreviewProvider,
  openChatterboxConfig,
} from "../../api/_voice/providers/open-chatterbox-preview.js";

export const CFG_BENCHMARK_VERSION = "vyakti-hindi-cfg-benchmark/v1";
export const CONDITIONING_CONTRACT = "vyakti-voice-language-conditioning/v1";

const PROTOCOL = "vyakti-open-voice/v1";
const MODES = new Set(["devanagari", "mixed", "latin_only", "unknown"]);
const SCOPES = new Set(["source_transcript", "exact_reference", "unverified"]);
const MAX_RESPONSE_BYTES = 24 * 1024 * 1024;

function fail(code, status = 409) {
  throw Object.assign(new Error(code), { code, status });
}

function exactNumber(value, expected, code) {
  if (!Number.isFinite(Number(value)) || Number(value) !== Number(expected)) fail(code);
}

export function explicitReferenceLanguageEvidence({ mode, scope }) {
  const normalizedMode = String(mode || "").toLowerCase();
  const normalizedScope = String(scope || "").toLowerCase();
  if (!MODES.has(normalizedMode) || !SCOPES.has(normalizedScope)) {
    fail("cfg_benchmark_reference_language_evidence_required", 400);
  }
  return Object.freeze({ mode: normalizedMode, scope: normalizedScope });
}

// The incumbent arm deliberately uses the runtime's rolling-deploy compatibility
// path. That is the only benchmark-only route which can preserve the historical
// requested CFG while still recording the reference evidence truthfully. The
// production provider remains unchanged and continues to apply cfg=0 whenever
// its language-conditioning contract requires it.
export function buildHindiCfgBenchmarkPlan({
  incumbentCfgWeight = 0.5,
  referenceLanguageMode,
  referenceLanguageEvidenceScope,
  modelArm,
  modelCommitment,
  modelPack = null,
}) {
  const evidence = explicitReferenceLanguageEvidence({
    mode: referenceLanguageMode,
    scope: referenceLanguageEvidenceScope,
  });
  const incumbent = Number(incumbentCfgWeight);
  if (!Number.isFinite(incumbent) || incumbent <= 0 || incumbent > 1) {
    fail("cfg_benchmark_incumbent_cfg_invalid", 400);
  }
  if (!String(modelArm || "").trim() || !/^[0-9a-f]{64}$/i.test(String(modelCommitment || ""))) {
    fail("cfg_benchmark_model_binding_required", 400);
  }
  const common = {
    benchmarkVersion: CFG_BENCHMARK_VERSION,
    languageId: "hi",
    referenceLanguageMode: evidence.mode,
    referenceLanguageEvidenceScope: evidence.scope,
    modelArm: String(modelArm),
    modelPack: String(modelPack || modelArm),
    modelCommitment: String(modelCommitment).toLowerCase(),
  };
  const arms = [
    Object.freeze({
      ...common,
      id: "clone-cfg-incumbent",
      role: "incumbent_requested_cfg_control",
      requestedCfgWeight: incumbent,
      effectiveCfgWeight: incumbent,
      conditioningContract: "legacy_runtime",
      requestMode: "benchmark_legacy_cfg_control",
    }),
    Object.freeze({
      ...common,
      id: "clone-cfg-zero",
      role: "official_cfg_zero_mitigation",
      requestedCfgWeight: 0,
      effectiveCfgWeight: 0,
      conditioningContract: CONDITIONING_CONTRACT,
      requestMode: "current_conditioning_contract",
    }),
  ];
  assertMatchedCfgPlan(arms);
  return Object.freeze(arms);
}

export function assertMatchedCfgPlan(arms) {
  if (!Array.isArray(arms) || arms.length !== 2) fail("cfg_benchmark_pair_invalid", 400);
  const [left, right] = arms;
  for (const field of [
    "languageId", "referenceLanguageMode", "referenceLanguageEvidenceScope",
    "modelArm", "modelPack", "modelCommitment",
  ]) {
    if (left[field] !== right[field]) fail(`cfg_benchmark_pair_${field}_mismatch`, 400);
  }
  if (left.effectiveCfgWeight === right.effectiveCfgWeight || right.effectiveCfgWeight !== 0) {
    fail("cfg_benchmark_pair_effective_cfg_invalid", 400);
  }
  const wording = JSON.stringify(arms).toLowerCase();
  if (/improved|better|winner|best/.test(wording)) fail("cfg_benchmark_arm_claim_invalid", 400);
  return arms;
}

export function bindCfgBenchmarkReceipt({ arm, receipt, itemId, seed, referenceSha256, textSha256 }) {
  if (!arm || !receipt) fail("cfg_benchmark_receipt_required");
  if (!Number.isSafeInteger(seed) || seed < 0) fail("cfg_benchmark_seed_invalid", 400);
  if (receipt.modelArm !== arm.modelArm || receipt.modelCommitment !== arm.modelCommitment ||
      receipt.modelPackCommitment !== arm.modelCommitment) fail("cfg_benchmark_model_binding_invalid");
  if (receipt.referenceLanguageMode !== arm.referenceLanguageMode ||
      receipt.referenceLanguageEvidenceScope !== arm.referenceLanguageEvidenceScope) {
    fail("cfg_benchmark_reference_evidence_binding_invalid");
  }
  exactNumber(receipt.requestedCfgWeight, arm.requestedCfgWeight, "cfg_benchmark_requested_cfg_binding_invalid");
  exactNumber(receipt.effectiveCfgWeight, arm.effectiveCfgWeight, "cfg_benchmark_effective_cfg_binding_invalid");
  if (receipt.conditioningContract !== arm.conditioningContract) fail("cfg_benchmark_contract_binding_invalid");
  if (receipt.referenceSha256 !== referenceSha256) fail("cfg_benchmark_reference_binding_invalid");
  return Object.freeze({
    benchmarkVersion: CFG_BENCHMARK_VERSION,
    arm: arm.id,
    role: arm.role,
    itemId,
    seed,
    textSha256,
    referenceSha256,
    requestedCfgWeight: Number(receipt.requestedCfgWeight),
    effectiveCfgWeight: Number(receipt.effectiveCfgWeight),
    referenceLanguageMode: receipt.referenceLanguageMode,
    referenceLanguageEvidenceScope: receipt.referenceLanguageEvidenceScope,
    textLanguageMode: receipt.textLanguageMode,
    conditioningContract: receipt.conditioningContract,
    modelArm: receipt.modelArm,
    modelPack: receipt.modelPack,
    modelCommitment: receipt.modelCommitment,
    synthesisCommitment: receipt.synthesisCommitment,
    outputSha256: receipt.outputSha256,
    qualityState: receipt.qualityState,
    qualityWarnings: receipt.qualityWarnings,
  });
}

function signature(secret, values) {
  return createHmac("sha256", secret).update(values.join("\n")).digest("base64url");
}

function equal(left, right) {
  const one = Buffer.from(String(left || ""));
  const two = Buffer.from(String(right || ""));
  return one.length === two.length && one.length >= 32 && timingSafeEqual(one, two);
}

function byteStream(bytes, size = 11_520) {
  return (async function* () {
    for (let offset = 0; offset < bytes.length; offset += size) {
      yield new Uint8Array(bytes.subarray(offset, Math.min(bytes.length, offset + size)));
    }
  })();
}

async function synthesizeLegacyCfgControl(config, raw, arm, fetchImpl) {
  const reference = Buffer.from(raw?.reference?.bytes || []);
  const probe = probeEnrollmentWav(reference);
  if (probe.durationMs < 5_000 || probe.durationMs > 90_000) fail("cfg_benchmark_reference_duration_invalid", 400);
  const referenceSha256 = createHash("sha256").update(reference).digest("hex");
  const requestId = String(raw?.requestId || randomUUID()).toLowerCase();
  const renderedText = renderTextWithDisclosure(raw?.text);
  const textLanguageMode = voiceScriptMode(raw?.text).mode;
  const payload = {
    request_id: requestId,
    text: renderedText,
    language_id: "hi",
    seed: Number(raw.seed),
    reference_audio_base64: reference.toString("base64"),
    reference_sha256: referenceSha256,
    exaggeration: Number(raw?.style?.exaggeration ?? 0.45),
    cfg_weight: arm.effectiveCfgWeight,
    requested_cfg_weight: arm.requestedCfgWeight,
    reference_language_mode: arm.referenceLanguageMode,
    reference_language_evidence_scope: arm.referenceLanguageEvidenceScope,
    text_language_mode: textLanguageMode,
    model_arm: arm.modelArm,
    temperature: Number(raw?.style?.temperature ?? 0.8),
  };
  const path = "/v1/synthesize";
  const body = Buffer.from(canonicalJson(payload));
  const bodyHash = sha256Hex(body);
  const timestamp = new Date().toISOString();
  const nonce = randomBytes(18).toString("base64url");
  let response;
  try {
    response = await fetchImpl(`${config.origin}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Vyakti-Protocol": PROTOCOL,
        "X-Vyakti-Timestamp": timestamp,
        "X-Vyakti-Nonce": nonce,
        "X-Vyakti-Content-SHA256": bodyHash,
        "X-Vyakti-Signature": signature(config.transportSecret, [PROTOCOL, "POST", path, timestamp, nonce, bodyHash]),
      },
      body,
      signal: raw?.signal
        ? AbortSignal.any([raw.signal, AbortSignal.timeout(210_000)])
        : AbortSignal.timeout(210_000),
    });
  } catch {
    fail("cfg_benchmark_open_voice_unreachable", 503);
  }
  const responseBytes = Buffer.from(await response.arrayBuffer());
  if (!responseBytes.length || responseBytes.length > MAX_RESPONSE_BYTES) fail("cfg_benchmark_response_size_invalid");
  const responseHash = sha256Hex(responseBytes);
  const expectedSignature = signature(config.transportSecret, [
    PROTOCOL, "response", path, nonce, String(response.status), responseHash,
  ]);
  if (!equal(response.headers.get("x-vyakti-response-signature"), expectedSignature)) {
    fail("cfg_benchmark_response_signature_invalid");
  }
  let result;
  try { result = JSON.parse(responseBytes.toString("utf8")); }
  catch { fail("cfg_benchmark_response_invalid"); }
  if (!response.ok) fail(String(result?.error || `cfg_benchmark_http_${response.status}`), response.status >= 500 ? 503 : 409);
  if (result?.conditioning_contract != null || result?.request_id !== requestId ||
      result?.reference_sha256 !== referenceSha256 || Number(result?.reference_duration_ms) !== probe.durationMs ||
      result?.model !== arm.modelPack || result?.model_arm !== arm.modelArm || result?.model_pack !== arm.modelPack ||
      result?.model_pack_commitment !== arm.modelCommitment || result?.model_commitment !== arm.modelCommitment ||
      result?.synthesis_commitment !== arm.modelCommitment || result?.reference_language_mode !== arm.referenceLanguageMode ||
      result?.reference_language_evidence_scope !== arm.referenceLanguageEvidenceScope ||
      result?.text_language_mode !== textLanguageMode || result?.quality_state !== "legacy_app_conditioning_unverified" ||
      !Array.isArray(result?.quality_warnings) || !result.quality_warnings.includes("legacy_app_language_contract_unverified")) {
    fail("cfg_benchmark_legacy_response_binding_invalid");
  }
  exactNumber(result.requested_cfg_weight, arm.requestedCfgWeight, "cfg_benchmark_requested_cfg_binding_invalid");
  exactNumber(result.effective_cfg_weight, arm.effectiveCfgWeight, "cfg_benchmark_effective_cfg_binding_invalid");
  if (result?.sample_rate !== VOICE_PCM_FORMAT.sampleRate || result?.channels !== VOICE_PCM_FORMAT.channels ||
      result?.encoding !== VOICE_PCM_FORMAT.encoding || result?.perth_watermark_verified !== true ||
      !Number.isFinite(Number(result?.perth_score)) || Number(result.perth_score) < 0.5) {
    fail("cfg_benchmark_audio_protection_binding_invalid");
  }
  const pcm = Buffer.from(String(result.audio_base64 || ""), "base64");
  if (!pcm.length || pcm.length % 2 || pcm.length > MAX_RESPONSE_BYTES || sha256Hex(pcm) !== result.output_sha256) {
    fail("cfg_benchmark_audio_binding_invalid");
  }
  const expectedDurationMs = pcm.length / 2 / VOICE_PCM_FORMAT.sampleRate * 1000;
  if (Math.abs(Number(result.duration_ms) - expectedDurationMs) > 2 ||
      !Number.isFinite(Number(result.real_time_factor)) || Number(result.real_time_factor) <= 0) {
    fail("cfg_benchmark_metrics_invalid");
  }
  return Object.freeze({
    renderedText,
    format: VOICE_PCM_FORMAT,
    stream: byteStream(pcm),
    receipt: Object.freeze({
      requestId,
      model: "open_chatterbox_multilingual_v3",
      modelCommitment: arm.modelCommitment,
      modelArm: arm.modelArm,
      modelPack: result.model_pack,
      modelPackCommitment: arm.modelCommitment,
      adapterId: null,
      adapterSha256: null,
      synthesisCommitment: result.synthesis_commitment,
      referenceSha256,
      outputSha256: result.output_sha256,
      durationMs: Number(result.duration_ms),
      elapsedMs: Number(result.elapsed_ms),
      realTimeFactor: Number(result.real_time_factor),
      perthScore: Number(result.perth_score),
      perthWatermarkVerified: true,
      referenceLanguageMode: result.reference_language_mode,
      referenceLanguageEvidenceScope: result.reference_language_evidence_scope,
      textLanguageMode: result.text_language_mode,
      requestedCfgWeight: Number(result.requested_cfg_weight),
      effectiveCfgWeight: Number(result.effective_cfg_weight),
      qualityState: result.quality_state,
      qualityWarnings: Object.freeze([...result.quality_warnings]),
      conditioningContract: "legacy_runtime",
    }),
  });
}

export function createHindiCfgBenchmarkClient(options = {}) {
  const env = options.env || process.env;
  const fetchImpl = options.fetchImpl || fetch;
  const config = openChatterboxConfig(env);
  const provider = createOpenChatterboxPreviewProvider({ env, fetchImpl });
  const plan = buildHindiCfgBenchmarkPlan({
    incumbentCfgWeight: options.incumbentCfgWeight ?? 0.5,
    referenceLanguageMode: options.referenceLanguageMode,
    referenceLanguageEvidenceScope: options.referenceLanguageEvidenceScope,
    modelArm: config.modelArm,
    modelPack: config.modelName,
    modelCommitment: config.modelCommitment,
  });
  return Object.freeze({
    plan,
    async synthesize(arm, raw) {
      if (!plan.includes(arm)) fail("cfg_benchmark_arm_invalid", 400);
      if (arm.requestMode === "benchmark_legacy_cfg_control") {
        return synthesizeLegacyCfgControl(config, raw, arm, fetchImpl);
      }
      return provider.synthesizePreview({
        ...raw,
        languageId: "hi",
        reference: {
          ...raw.reference,
          languageMode: arm.referenceLanguageMode,
          languageEvidenceScope: arm.referenceLanguageEvidenceScope,
        },
        style: { ...raw.style, cfgWeight: arm.requestedCfgWeight },
      });
    },
  });
}
