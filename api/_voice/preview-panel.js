// "Preview my voice" — the studio panel's server logic.
//
// This is the first surface where an owner interacts with their OWN clone, so
// it is deliberately the same authorization path as the calibration lab rather
// than a lighter one: `beginOwnedVoicePreview` is the fence, and it is the
// fence for a reason worth restating. It refuses unless the caller owns the
// replica, the replica is a `self` subject with age/identity/liveness verified
// and unexpired, inference + biometric + training consent are all live and
// unrevoked, the reference artifact is a SELECTED enhance-stage artifact of a
// ready source that contains no third parties, and that artifact is one the
// draft VoiceGenome actually references. Every clause of that is SQL. Nothing
// here re-decides any of it, and nothing here accepts an identity, a replica
// id, or an artifact id as proof of anything — the owner id comes from the
// verified session and is passed as a bound parameter.
//
// Everything with an edge is injected, so `evals/voicepanel.mjs` can drive the
// whole state machine offline against a fake db, a fake bucket and a fake
// broker without a single credential. The route file (`api/voice-preview.js`)
// is the only place the real ones are wired.
import { createHash } from "node:crypto";
import { assertSynthesisResult } from "./contracts.js";
import { buildVoiceTextPlan, voiceTextPlanAudit } from "./hindi-text-frontend.js";
import { voiceScriptMode } from "./language-conditioning.js";
import {
  WARMUP,
  capPanelText,
  classifyPreviewFailure,
  dispatchWake,
  probeAdmissionHealth,
  warmingBody,
} from "./warmup.js";

const LANGUAGES = new Set(["en", "hi"]);
const PANEL_STYLE_KEY = "balanced";

function jsonResult(status, body, headers = {}) {
  return Object.freeze({ kind: "json", status, body: Object.freeze({ ...body }), headers: Object.freeze({ ...headers }) });
}

function warmingResult(stage, extra) {
  return jsonResult(202, warmingBody(stage, extra), {
    "Retry-After": String(Math.ceil(WARMUP.retryAfterMs / 1000)),
  });
}

export function wavHeader(pcmBytes, format) {
  const rate = format.sampleRate;
  const channels = format.channels;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0); header.writeUInt32LE(36 + pcmBytes, 4); header.write("WAVE", 8);
  header.write("fmt ", 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22); header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * channels * 2, 28);
  header.writeUInt16LE(channels * 2, 32); header.writeUInt16LE(16, 34);
  header.write("data", 36); header.writeUInt32LE(pcmBytes, 40);
  return header;
}

/**
 * @param body   parsed request JSON — NEVER a source of identity.
 * @param deps   { ownerUserId, db, authorize, readObject, provider, protect,
 *                 warmth, origin, now, fetchImpl, sleep, markFailed,
 *                 textHash, traceId, signal, flushMs, healthBudgetMs }
 */
export async function handleVoicePreviewPanel(body, deps) {
  const now = deps.now || (() => Date.now());
  const op = String(body?.op || "preview");
  if (op !== "preview" && op !== "status") {
    return jsonResult(400, { state: "error", error: "voice_preview_op_invalid" });
  }

  const languageId = String(body?.language_id || "en").toLowerCase();
  if (!LANGUAGES.has(languageId)) {
    return jsonResult(400, { state: "error", error: "voice_preview_language_not_supported" });
  }

  // `status` spends no GPU and touches no row: it answers "would a click wait?"
  // It still requires the verified session — the caller reached it through
  // requireUser — but it deliberately reveals nothing replica-specific.
  if (op === "status") {
    const warmth = deps.warmth.read(deps.origin, now());
    return jsonResult(200, {
      state: warmth.state,
      stage: warmth.state === "warm" ? "ready" : "runtime_cold",
      eta_seconds_low: Math.round(WARMUP.coldStartEtaLowMs / 1000),
      eta_seconds_high: Math.round(WARMUP.coldStartEtaHighMs / 1000),
      retry_after_ms: warmth.state === "warm" ? 0 : WARMUP.retryAfterMs,
    });
  }

  let text;
  try { text = capPanelText(body?.text); }
  catch (error) { return jsonResult(error.status || 400, { state: "error", error: error.code }); }
  const textHash = createHash("sha256").update(text, "utf8").digest("hex");
  const textLanguageMode = voiceScriptMode(text).mode;
  let textPlan;
  try { textPlan = buildVoiceTextPlan({ text, languageId }); }
  catch (error) { return jsonResult(error.status || 400, { state: "error", error: error.code }); }
  const textFrontend = voiceTextPlanAudit(textPlan);

  // OWNERSHIP FIRST, before a byte of storage or a second of GPU is spent. A
  // caller who does not own this replica must pay nothing and learn nothing.
  let started;
  try {
    started = await deps.authorize({
      replica_id: body?.replica_id,
      genome_version: body?.genome_version,
      trace_id: deps.traceId,
      language_id: languageId,
      text_hash: textHash,
      text_language_mode: textLanguageMode,
      text_frontend: textFrontend,
      style_key: PANEL_STYLE_KEY,
    });
  } catch (error) {
    const status = Number.isInteger(error?.status) ? error.status : 500;
    return jsonResult(status, {
      state: "error",
      error: status === 500 ? "voice_preview_failed" : String(error?.code || error?.message),
    });
  }

  try {
    // Wake the CPU broker on the UNAUTHENTICATED health route and sign nothing
    // until it answers 200 — `rejected.md#hmac-skew-shorter-than-cold-start`.
    const health = await probeAdmissionHealth({
      origin: deps.origin,
      fetchImpl: deps.fetchImpl,
      now,
      sleep: deps.sleep,
      budgetMs: deps.healthBudgetMs,
    });
    if (!health.ok) {
      await deps.markFailed(started.generation.generation_id, { code: health.code });
      if (health.code === "voice_origin_invalid") {
        return jsonResult(503, { state: "error", error: "voice_origin_invalid" });
      }
      return warmingResult("admission_cold", { probe_ms: health.elapsedMs, probe_attempts: health.attempts });
    }

    const warmth = deps.warmth.read(deps.origin, now());
    if (warmth.state === "warming") {
      // Somebody's click is already paying for this wake. Charging a second
      // GPU cold start for the same replica would be paying twice for one boot.
      await deps.markFailed(started.generation.generation_id, { code: "voice_preview_wake_in_flight" });
      return warmingResult("wake_in_flight", { wake_age_ms: warmth.ageMs });
    }

    const stored = await deps.readObject(started.reference);
    if (stored.mime !== started.reference.mime || stored.byteSize !== started.reference.byteSize ||
        createHash("sha256").update(stored.body).digest("hex") !== started.reference.sha256) {
      throw Object.assign(new Error("voice_preview_reference_binding_failed"), {
        code: "voice_preview_reference_binding_failed", status: 409,
      });
    }

    const synthesize = () => deps.provider.synthesizePreview({
      requestId: started.generation.generation_id,
      text,
      languageId,
      seed: started.previewSeed,
      reference: {
        bytes: stored.body,
        sha256: started.reference.sha256,
        durationMs: started.reference.durationMs,
        languageMode: started.reference.languageMode,
        languageEvidenceScope: started.reference.languageEvidenceScope,
      },
      style: {
        exaggeration: started.previewStyle.exaggeration,
        cfgWeight: started.previewStyle.cfg_weight,
        temperature: started.previewStyle.temperature,
      },
      signal: deps.signal,
    });

    let raw;
    if (warmth.state === "warm") {
      raw = await synthesize();
    } else {
      // Cold. This request is the wake. Dispatch it, let it run, and stop
      // waiting after the flush window rather than holding the owner's
      // connection open until Container Apps kills it at ~240 s. A provider
      // success after that flush still proves the runtime is ready. Record
      // only that runtime fact: the abandoned generation stays failed and its
      // discarded stream never enters the protection/sealing path below.
      deps.warmth.note(deps.origin, "waking", now());
      const outcome = await dispatchWake(async () => {
        const value = await synthesize();
        assertSynthesisResult(value);
        deps.warmth.note(deps.origin, "ready", now());
        return value;
      }, { flushMs: deps.flushMs, sleep: deps.sleep });
      if (outcome.kind === "flushed") {
        await deps.markFailed(started.generation.generation_id, { code: "voice_preview_wake_dispatched" });
        return warmingResult("runtime_cold", { wake_dispatched: true });
      }
      if (outcome.kind === "rejected") throw outcome.error;
      raw = outcome.value;
    }

    // The disclosure prefix and the PerTh check are the PROVIDER's invariants
    // (`assertSynthesisResult` + `verifiedResult`). They are asserted here
    // again rather than assumed, and there is deliberately no branch that
    // skips either — a preview is a generated clip like any other.
    const synthesized = assertSynthesisResult(raw);
    if (synthesized.receipt?.textFrontend?.planSha256 !== textFrontend.planSha256) {
      throw Object.assign(new Error("voice_preview_text_plan_binding_failed"), {
        code: "voice_preview_text_plan_binding_failed", status: 409,
      });
    }
    const protectedAudio = await deps.protect({
      authorization: started.authorizationInput,
      sourceStream: synthesized.stream,
      format: synthesized.format,
      disclosureEvidence: {
        renderedText: synthesized.renderedText,
        renderer: `${deps.provider.name}@${deps.provider.modelCommitment}`,
      },
      disclosureText: synthesized.disclosureText,
      signal: deps.signal,
    });
    const chunks = [];
    for await (const chunk of protectedAudio.stream) chunks.push(Buffer.from(chunk));
    const receipt = await protectedAudio.completion;
    const pcm = Buffer.concat(chunks);
    if (!pcm.length) throw Object.assign(new Error("voice_preview_audio_empty"), { code: "voice_preview_audio_empty" });
    if (receipt.generation_id !== started.generation.generation_id) {
      throw Object.assign(new Error("voice_preview_receipt_binding_failed"), { code: "voice_preview_receipt_binding_failed" });
    }

    deps.warmth.note(deps.origin, "ready", now());
    return Object.freeze({
      kind: "audio",
      status: 200,
      body: Buffer.concat([wavHeader(pcm.length, synthesized.format), pcm]),
      headers: Object.freeze({
        "Content-Type": "audio/wav",
        "X-Vyakti-Text-Plan": textFrontend.planSha256,
        "X-Vyakti-Text-Transformations": String(textFrontend.transformationCount),
        "X-Vyakti-Spoken-Text": encodeURIComponent(textPlan.targetText),
        "X-Content-Type-Options": "nosniff",
        "X-Vyakti-Generation": started.generation.generation_id,
        "X-Vyakti-Disclosure": "audible-prefix-v1",
        "X-Vyakti-Model-Commitment": deps.provider.modelCommitment,
        "X-Vyakti-Voice-Model-Arm": synthesized.receipt?.modelArm || deps.provider.modelArm || "general",
        "X-Vyakti-Voice-Quality-State": synthesized.receipt?.qualityState || started.voiceConditioning.qualityState,
        "X-Vyakti-Voice-Quality-Warnings": (synthesized.receipt?.qualityWarnings || started.voiceConditioning.qualityWarnings).join(","),
        "X-Vyakti-Voice-Effective-Cfg": String(synthesized.receipt?.effectiveCfgWeight ?? started.voiceConditioning.effectiveCfgWeight),
      }),
    });
  } catch (error) {
    await deps.markFailed(started.generation.generation_id, error);
    const verdict = classifyPreviewFailure(error);
    if (verdict.state === "warming") {
      deps.warmth.note(deps.origin, "waking", now());
      return warmingResult(verdict.stage, { failure_code: verdict.code });
    }
    const status = Number.isInteger(error?.status) ? error.status : 500;
    return jsonResult(status, {
      state: "error",
      error: status === 500 ? "voice_preview_failed" : verdict.code,
    });
  }
}
