// ElevenLabs voice-clone arm — a BENCH arm, not the shipped lane.
//
// WHY THIS EXISTS
// ---------------------------------------------------------------------------
// `context/decisions.md#platform-north-star` puts the self-hosted lane first
// and names the evidence that would reverse it: the self-hosted lane's fidelity
// staying materially below the VENDOR lane after fine-tuning effort. No vendor
// arm had ever been benched, so that reversal condition was unfalsifiable. This
// module makes it measurable. It changes no lane order (`registry.js` still
// ships self-hosted first) and it does nothing at all without a key.
//
// ENDPOINTS, PINNED. Read from the public ElevenLabs API reference on
// 2026-09-03; if any of these move, the arm must fail loudly rather than adapt:
//   POST   /v1/voices/add                        Instant Voice Clone (IVC).
//                                                multipart: name, files[]
//                                                -> { voice_id, requires_verification }
//   POST   /v1/voices/pvc                        Professional Voice Clone,
//                                                metadata only -> { voice_id }
//   POST   /v1/voices/pvc/{voice_id}/samples     PVC sample upload (multipart)
//   GET    /v1/voices/{voice_id}                 -> { voice_id, category,
//                                                     fine_tuning: { state } }
//   POST   /v1/text-to-speech/{voice_id}         JSON: text, model_id,
//                                                language_code, seed,
//                                                voice_settings
//                                ?output_format=pcm_24000  -> raw PCM16 24 kHz
//   DELETE /v1/voices/{voice_id}                 -> { status: "ok" }
//
// WHICH CLONE MODE. IVC is one call and is what the genome's already-selected
// reference window fits, so it is the default. PVC needs a separate multi-step
// ceremony (create metadata, upload samples, vendor-side verification, then a
// training wait) and cannot complete inside one request; `ELEVENLABS_CLONE_MODE=
// professional` performs the create+samples half and then reports
// `elevenlabs_pvc_verification_pending` as a WAITING-ON-YOU blocker rather than
// pretending a trained voice exists. That is the honest state, not a stub.
//
// WHAT IS NOT PROVEN HERE. Nothing in this file has run against the live
// vendor: there is no key in this environment and the workstream that wrote it
// was told to spend no money. Everything below is proven against recorded
// fixtures in `evals/voice-vendor/run.mjs`, including a negative control that
// fails if an arm ever manufactures a clip without a key.
import { randomUUID } from "node:crypto";
import { canonicalJson, sha256Hex } from "../../_provenance/contracts.js";
import {
  beginProviderSpend,
  markProviderSpendUncertain,
  releaseProviderSpendBeforeCall,
  reserveVendorVoiceSpend,
  settleVendorVoiceSpend,
  vendorVoiceBudgetConfig,
} from "../../_provider-budget.js";
import { VOICE_PCM_FORMAT } from "../contracts.js";
import {
  assertReferenceBytes,
  assertVendorConsent,
  billableCharacters,
  byteStream,
  decodeVendorRef,
  encodeVendorRef,
  pinnedModelId,
  renderVendorText,
  sha256Bytes,
  toCanonicalPcm24k,
  vendorApiKey,
  vendorArmState,
  vendorFail,
  vendorOrigin,
  vendorSignal,
} from "./vendor-common.js";

export const ELEVENLABS_ARM_ID = "elevenlabs";
export const ELEVENLABS_PROVIDER_NAME = "elevenlabs_voice_clone";
const PROVIDER_VERSION = "elevenlabs-voice/2026-09-03";
const REF_PREFIX = "el1";
const CLONE_MODES = new Set(["instant", "professional"]);
const LANGUAGES = new Set(["en", "hi"]);
const MAX_REFERENCE_FILES = 5;
const MAX_RESPONSE_BYTES = 24 * 1024 * 1024;

export function elevenLabsVoiceConfig(env = process.env) {
  const key = vendorApiKey(env.ELEVENLABS_API_KEY, "elevenlabs_api_key_required");
  const origin = vendorOrigin(env.ELEVENLABS_BASE_URL, "https://api.elevenlabs.io",
    [".elevenlabs.io"], "elevenlabs_origin_invalid");
  const model = pinnedModelId(env.ELEVENLABS_MODEL_ID || "eleven_multilingual_v2", "elevenlabs_model_required");
  const cloneMode = String(env.ELEVENLABS_CLONE_MODE || "instant").toLowerCase();
  if (!CLONE_MODES.has(cloneMode)) vendorFail("elevenlabs_clone_mode_invalid");
  // Reading the budget here means a misconfigured rate card is a config error
  // at start-up rather than a surprise in the middle of a paid bench run.
  const budget = vendorVoiceBudgetConfig(ELEVENLABS_ARM_ID, env);
  return Object.freeze({ key, origin, model, cloneMode, budget });
}

/** Honest state for the panel and the bench: available, or a named reason. */
export function elevenLabsArmState(env = process.env) {
  return vendorArmState(ELEVENLABS_ARM_ID, env, elevenLabsVoiceConfig);
}

// Erasure is deliberately configurable with less than synthesis. Losing a model
// pin or a rate card must never stand between an owner and the deletion of a
// biometric voice held at a vendor.
export function elevenLabsErasureConfig(env = process.env) {
  return Object.freeze({
    key: vendorApiKey(env.ELEVENLABS_API_KEY, "elevenlabs_api_key_required"),
    origin: vendorOrigin(env.ELEVENLABS_BASE_URL, "https://api.elevenlabs.io",
      [".elevenlabs.io"], "elevenlabs_origin_invalid"),
  });
}

export function parseElevenLabsRef(value) {
  const parsed = decodeVendorRef(REF_PREFIX, value, "elevenlabs_ref_invalid");
  const voiceId = String(parsed?.voiceId || "").trim();
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(voiceId)) vendorFail("elevenlabs_ref_invalid", 400);
  return Object.freeze({ voiceId, cloneMode: CLONE_MODES.has(parsed?.cloneMode) ? parsed.cloneMode : "instant" });
}

function providerState(row) {
  const category = String(row?.category || "").toLowerCase();
  const fineTuning = String(row?.fine_tuning?.state || "").toLowerCase();
  if (category === "professional" || category === "high_quality") {
    if (fineTuning === "fine_tuned") return "ready";
    if (["not_started", "queued", "fine_tuning", "delayed"].includes(fineTuning)) return "creating";
    return "failed";
  }
  // An instant clone is usable the moment the vendor returns its id. There is
  // no training state to wait on, so reporting "creating" would be a wait that
  // never ends.
  return category === "cloned" || category === "generated" ? "ready" : "creating";
}

export function createElevenLabsVoiceProvider(options = {}) {
  const env = options.env || process.env;
  const config = elevenLabsVoiceConfig(env);
  const fetchImpl = options.fetchImpl || fetch;
  const nativeTools = options.nativeTools;
  const now = options.now || (() => new Date());
  const db = options.db;
  if (typeof db !== "function") vendorFail("provider_budget_db_required");
  const budget = options.budget || {
    reserve: reserveVendorVoiceSpend,
    begin: beginProviderSpend,
    settle: settleVendorVoiceSpend,
    release: releaseProviderSpendBeforeCall,
    uncertain: markProviderSpendUncertain,
  };
  const descriptor = Object.freeze({
    family: "elevenlabs",
    name: ELEVENLABS_PROVIDER_NAME,
    version: PROVIDER_VERSION,
    model: config.model,
    billing: Object.freeze({
      voice_training: Object.freeze({ meter: "elevenlabs_voice_clones" }),
      synthesis: Object.freeze({ meter: "elevenlabs_characters" }),
    }),
  });

  async function call(path, init = {}, allow = []) {
    let response;
    try {
      response = await fetchImpl(`${config.origin}${path}`, {
        ...init,
        headers: { "xi-api-key": config.key, ...(init.headers || {}) },
        signal: vendorSignal(init.signal, init.timeoutMs || 60_000),
      });
    } catch { vendorFail("elevenlabs_unreachable"); }
    if (!response.ok && !allow.includes(response.status)) {
      // 402 is the shape the owner has already met on another vendor key
      // (`measurements.md`, Sarvam Payment Required). It is a WAITING-ON-YOU
      // blocker, not a platform fault, and it is named rather than folded into
      // a generic HTTP code.
      if (response.status === 402) vendorFail("elevenlabs_payment_required", 402);
      if (response.status === 401 || response.status === 403) vendorFail("elevenlabs_key_rejected", 402);
      vendorFail(`elevenlabs_http_${response.status}`, response.status >= 500 ? 503 : 409);
    }
    return response;
  }

  async function json(response) {
    const text = await response.text();
    if (!text) return {};
    try { return JSON.parse(text); } catch { vendorFail("elevenlabs_response_invalid"); }
    return {};
  }

  function references(input) {
    const rows = Array.isArray(input?.references) ? input.references : [];
    if (!rows.length || rows.length > MAX_REFERENCE_FILES) vendorFail("elevenlabs_reference_count_invalid", 400);
    const materialized = rows.map((row) => assertReferenceBytes(row));
    const total = materialized.reduce((sum, row) => sum + row.durationMs, 0);
    if (total < 10_000 || total > 300_000) vendorFail("elevenlabs_reference_duration_invalid", 400);
    return Object.freeze(materialized);
  }

  async function createClone(voiceName, refs, signal) {
    const form = new FormData();
    form.append("name", voiceName);
    // `remove_background_noise` stays OFF. The genome's reference window is
    // already the output of this platform's own enhancement chain, and letting
    // a second denoiser run on it would change the very timbre being measured
    // without either side recording that it happened.
    form.append("remove_background_noise", "false");
    for (const [index, reference] of refs.entries()) {
      form.append("files", new Blob([reference.bytes], { type: "audio/wav" }), `reference-${index + 1}.wav`);
    }
    if (config.cloneMode === "instant") {
      const created = await json(await call("/v1/voices/add", { method: "POST", body: form, signal, timeoutMs: 120_000 }));
      const voiceId = String(created?.voice_id || "").trim();
      if (!/^[A-Za-z0-9_-]{8,64}$/.test(voiceId)) vendorFail("elevenlabs_clone_response_invalid");
      return Object.freeze({ voiceId, requiresVerification: created?.requires_verification === true });
    }
    const created = await json(await call("/v1/voices/pvc", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: voiceName, language: "hi" }),
      signal,
    }));
    const voiceId = String(created?.voice_id || "").trim();
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(voiceId)) vendorFail("elevenlabs_clone_response_invalid");
    await call(`/v1/voices/pvc/${encodeURIComponent(voiceId)}/samples`, {
      method: "POST", body: form, signal, timeoutMs: 180_000,
    });
    return Object.freeze({ voiceId, requiresVerification: true });
  }

  async function synthesize({ voiceId, renderedText, languageId, seed, signal, requestKey, commitment }) {
    const characters = billableCharacters(renderedText);
    const reservation = await budget.reserve(db, {
      vendor: ELEVENLABS_ARM_ID,
      operation: "synthesis",
      requestKey,
      inputCommitment: commitment,
      adapter: descriptor,
      text: renderedText,
      env,
      now: now(),
    });
    let began = false;
    try {
      await budget.begin(db, reservation);
      began = true;
      const response = await call(
        `/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=pcm_24000`,
        {
          method: "POST",
          headers: { "content-type": "application/json", accept: "audio/*" },
          body: JSON.stringify({
            text: renderedText,
            model_id: config.model,
            language_code: languageId,
            seed,
            voice_settings: { stability: 0.5, similarity_boost: 0.85, style: 0, use_speaker_boost: true },
            apply_text_normalization: "auto",
          }),
          signal,
          timeoutMs: 180_000,
        },
      );
      const raw = Buffer.from(await response.arrayBuffer());
      if (!raw.length || raw.length > MAX_RESPONSE_BYTES) vendorFail("elevenlabs_response_size_invalid");
      // `pcm_24000` is documented to be exactly the platform format, so the
      // normal path resamples nothing. The header is still read rather than
      // assumed: a vendor that starts answering 44.1 kHz to the same request
      // must cost a resample, not a wrong-speed clip.
      const contentType = String(response.headers.get("content-type") || "").toLowerCase();
      const canonical = await toCanonicalPcm24k(raw, {
        encoding: contentType.includes("pcm") || contentType.includes("audio/l16") || !contentType
          ? "pcm_s16le_24000_mono"
          : "vendor_container",
        env,
        nativeTools,
        signal,
      });
      await budget.settle(db, reservation, { units: characters });
      return Object.freeze({ pcm: canonical.pcm, resampled: canonical.resampled, characters });
    } catch (error) {
      if (!began) await budget.release(db, reservation, error);
      else await budget.uncertain(db, reservation, error);
      throw error;
    }
  }

  function receiptFor({ voiceId, commitment, renderedText, disclosureText, languageId, seed, pcm, resampled, characters, requestId, referenceSha256, startedAt }) {
    const durationMs = pcm.length / 2 / VOICE_PCM_FORMAT.sampleRate * 1000;
    const elapsedMs = Date.now() - startedAt;
    return Object.freeze({
      requestId,
      arm: ELEVENLABS_ARM_ID,
      model: ELEVENLABS_PROVIDER_NAME,
      vendorModelId: config.model,
      cloneMode: config.cloneMode,
      // Symmetric with the base arm's receipt so a bench never has to infer a
      // category from an arm name it is trying not to look at.
      armCategory: "voice_clone",
      clonesTheOwner: true,
      // The vendor voice id is a disposable server-only mapping
      // (`decisions.md#replica-provider-portable`); only its hash is recorded so
      // a receipt can be shown without handing the mapping to anyone.
      vendorVoiceIdSha256: sha256Hex(voiceId),
      modelCommitment: commitment,
      synthesisCommitment: commitment,
      referenceSha256,
      languageId,
      seed,
      renderedText,
      disclosureText,
      outputSha256: sha256Bytes(pcm),
      durationMs,
      elapsedMs,
      realTimeFactor: durationMs > 0 ? elapsedMs / durationMs : null,
      billedCharacters: characters,
      resampledTo24k: resampled,
      // TRUTH, not a green light. A vendor does not embed PerTh, so this arm's
      // clips carry the platform watermark only when they pass through
      // `_provenance/delivery.js`. Saying `true` here would be the fabricated
      // evidence AGENTS.md forbids, and the bench's own verifier refuses a
      // vendor result that claims it.
      perthWatermarkVerified: false,
      protectionPath: "delivery_audioseal",
      transportProof: "tls_vendor_api",
    });
  }

  return Object.freeze({
    ...descriptor,
    armId: ELEVENLABS_ARM_ID,
    modelCommitment: sha256Hex(`${PROVIDER_VERSION}:${config.model}:${config.cloneMode}`),
    modelArm: config.cloneMode,
    state: () => elevenLabsArmState(env),

    async createVoice(input) {
      const consent = assertVendorConsent(input?.consent);
      const refs = references(input);
      const idempotencyKey = String(input?.idempotencyKey || "");
      if (idempotencyKey.length < 16) vendorFail("elevenlabs_idempotency_key_required", 400);
      const commitment = sha256Hex(canonicalJson({
        protocol: PROVIDER_VERSION,
        replica_id: String(input?.replicaId || ""),
        genome_version: Number(input?.genomeVersion || 0),
        clone_mode: config.cloneMode,
        model: config.model,
        consent,
        references: refs.map((row) => ({ sha256: row.sha256, duration_ms: row.durationMs }))
          .sort((left, right) => left.sha256.localeCompare(right.sha256)),
      }));
      const reservation = await budget.reserve(db, {
        vendor: ELEVENLABS_ARM_ID,
        operation: "voice_training",
        requestKey: idempotencyKey,
        inputCommitment: commitment,
        adapter: descriptor,
        env,
        now: now(),
      });
      let began = false;
      try {
        await budget.begin(db, reservation);
        began = true;
        // The vendor-side voice NAME carries no owner identity. It is the
        // enrollment commitment, which is meaningless off this platform.
        const created = await createClone(`vy-${commitment.slice(0, 24)}`, refs, input?.signal);
        await budget.settle(db, reservation, { units: 1 });
        const pendingVerification = config.cloneMode === "professional" || created.requiresVerification;
        return Object.freeze({
          providerRef: encodeVendorRef(REF_PREFIX, { voiceId: created.voiceId, cloneMode: config.cloneMode }),
          enrollmentCommitment: commitment,
          state: pendingVerification && config.cloneMode === "professional" ? "creating" : "ready",
          blocker: pendingVerification
            ? Object.freeze({
              kind: "waiting_on_you",
              code: config.cloneMode === "professional"
                ? "elevenlabs_pvc_verification_pending"
                : "elevenlabs_voice_verification_pending",
            })
            : null,
        });
      } catch (error) {
        if (!began) await budget.release(db, reservation, error);
        else await budget.uncertain(db, reservation, error);
        throw error;
      }
    },

    async getVoiceStatus(providerRef, statusOptions = {}) {
      const { voiceId } = parseElevenLabsRef(providerRef);
      const response = await call(`/v1/voices/${encodeURIComponent(voiceId)}`, {
        method: "GET", signal: statusOptions.signal,
      }, [404]);
      if (response.status === 404) return "missing";
      return providerState(await json(response));
    },

    async synthesizeStream({ providerRef, text, languageId = "en", seed = 0, signal, requestKey }) {
      const { voiceId } = parseElevenLabsRef(providerRef);
      if (typeof requestKey !== "string" || requestKey.length < 16) vendorFail("elevenlabs_synthesis_request_key_required", 400);
      if (!LANGUAGES.has(String(languageId).toLowerCase())) vendorFail("elevenlabs_language_not_supported", 400);
      const { renderedText, disclosureText } = renderVendorText(text, languageId);
      const commitment = sha256Hex(canonicalJson({
        protocol: PROVIDER_VERSION, provider_ref: providerRef, model: config.model,
        language_id: languageId, seed, text_sha256: sha256Hex(renderedText),
      }));
      const startedAt = Date.now();
      const result = await synthesize({
        voiceId, renderedText, languageId: String(languageId).toLowerCase(), seed, signal, requestKey, commitment,
      });
      return Object.freeze({
        format: VOICE_PCM_FORMAT,
        renderedText,
        disclosureText,
        stream: byteStream(result.pcm),
        pcm: result.pcm,
        receipt: receiptFor({
          voiceId, commitment, renderedText, disclosureText, languageId, seed,
          pcm: result.pcm, resampled: result.resampled, characters: result.characters,
          requestId: requestKey, referenceSha256: null, startedAt,
        }),
      });
    },

    /**
     * The bench-facing shape. Deliberately the same result contract as
     * `open-chatterbox-preview.js::synthesizePreview` so a matched-pack cell
     * can hold a vendor clip and a self-hosted clip without either side
     * learning which is which.
     */
    async synthesizePreview(raw) {
      const reference = assertReferenceBytes(raw?.reference);
      const languageId = String(raw?.languageId || "en").toLowerCase();
      if (!LANGUAGES.has(languageId)) vendorFail("elevenlabs_language_not_supported", 400);
      const seed = Number(raw?.seed);
      if (!Number.isSafeInteger(seed) || seed < 0 || seed > 2_147_483_647) vendorFail("elevenlabs_seed_invalid", 400);
      const requestId = String(raw?.requestId || randomUUID());
      const providerRef = String(raw?.providerRef || "");
      const { voiceId } = parseElevenLabsRef(providerRef);
      const { renderedText, disclosureText } = renderVendorText(raw?.text, languageId);
      const commitment = sha256Hex(canonicalJson({
        protocol: PROVIDER_VERSION, provider_ref: providerRef, model: config.model,
        language_id: languageId, seed, reference_sha256: reference.sha256,
        text_sha256: sha256Hex(renderedText),
      }));
      const startedAt = Date.now();
      const result = await synthesize({
        voiceId, renderedText, languageId, seed, signal: raw?.signal,
        requestKey: `elevenlabs-preview:${requestId}`, commitment,
      });
      return Object.freeze({
        renderedText,
        disclosureText,
        format: VOICE_PCM_FORMAT,
        stream: byteStream(result.pcm),
        pcm: result.pcm,
        receipt: receiptFor({
          voiceId, commitment, renderedText, disclosureText, languageId, seed,
          pcm: result.pcm, resampled: result.resampled, characters: result.characters,
          requestId, referenceSha256: reference.sha256, startedAt,
        }),
      });
    },

    async deleteVoice(providerRef, deleteOptions = {}) {
      const { voiceId } = parseElevenLabsRef(providerRef);
      await call(`/v1/voices/${encodeURIComponent(voiceId)}`, {
        method: "DELETE", signal: deleteOptions.signal,
      }, [404]);
      return Object.freeze({ deleted: true });
    },
  });
}

/**
 * The erasure-only face of this arm, for `runVoiceErasureSweep`.
 *
 * Separate from the full provider for the reason the Azure eraser already
 * states: deletion must survive a configuration that can no longer clone or
 * synthesise. It needs a key and an origin and nothing else, and it takes no
 * database because erasure spends no money.
 */
export function createElevenLabsVoiceEraser(options = {}) {
  const env = options.env || process.env;
  const config = elevenLabsErasureConfig(env);
  const fetchImpl = options.fetchImpl || fetch;
  return Object.freeze({
    name: ELEVENLABS_PROVIDER_NAME,
    async deleteVoice(providerRef, deleteOptions = {}) {
      const { voiceId } = parseElevenLabsRef(providerRef);
      let response;
      try {
        response = await fetchImpl(`${config.origin}/v1/voices/${encodeURIComponent(voiceId)}`, {
          method: "DELETE",
          headers: { "xi-api-key": config.key },
          signal: vendorSignal(deleteOptions.signal, 30_000),
        });
      } catch { vendorFail("elevenlabs_unreachable"); }
      // A 404 is a successful idempotent observation: the biometric object is
      // absent, which is the outcome erasure exists to reach.
      if (!response.ok && response.status !== 404) {
        vendorFail(`elevenlabs_http_${response.status}`, response.status >= 500 ? 503 : 409);
      }
      return Object.freeze({ deleted: true });
    },
  });
}
