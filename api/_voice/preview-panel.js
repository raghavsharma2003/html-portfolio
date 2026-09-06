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
// The prior identity-anchor preset deliberately suppressed variation
// (0.2 exaggeration, 0.78 CFG, 0.6 temperature). The owner consistently heard
// that delivery as flat and robotic. Start from Chatterbox Multilingual's
// official neutral settings instead; the calibration lab still owns any more
// expressive choice and can reverse this per owner with matched blind trials.
const PANEL_STYLE_KEY = "balanced";

function jsonResult(status, body, headers = {}) {
  return Object.freeze({ kind: "json", status, body: Object.freeze({ ...body }), headers: Object.freeze({ ...headers }) });
}

function warmingResult(stage, extra) {
  return jsonResult(202, warmingBody(stage, extra), {
    "Retry-After": String(Math.ceil(WARMUP.retryAfterMs / 1000)),
  });
}

function intentProgress(started, stage, extra = {}) {
  const intent = started.intent;
  const state = stage === "synthesizing" ? "processing" : "warming";
  const warm = warmingBody(stage, extra);
  return jsonResult(202, {
    ...warm,
    state,
    stage,
    phase: stage,
    intent_id: intent.intentId,
    generation_id: intent.generationId || null,
    attempt: intent.attempt,
    reused: intent.role === "observe" || intent.reused,
    started_at: intent.startedAt,
    updated_at: intent.updatedAt,
    completed_at: intent.completedAt,
    next_attempt_at: intent.nextAttemptAt,
    ...extra,
  }, { "Retry-After": String(Math.ceil(WARMUP.retryAfterMs / 1000)) });
}

function previewAudioHeaders(started, textFrontend, textPlan, metadata = {}, reused = false) {
  return Object.freeze({
    "Content-Type": "audio/wav",
    "X-Vyakti-Text-Plan": textFrontend.planSha256,
    "X-Vyakti-Text-Transformations": String(textFrontend.transformationCount),
    "X-Vyakti-Spoken-Text": encodeURIComponent(textPlan.targetText),
    "X-Content-Type-Options": "nosniff",
    "X-Vyakti-Generation": started.generation.generation_id,
    "X-Vyakti-Preview-Intent": started.intent?.intentId || "",
    "X-Vyakti-Preview-Reused": reused ? "true" : "false",
    "X-Vyakti-Disclosure": "audible-prefix-v1",
    "X-Vyakti-Model-Commitment": metadata.modelCommitment || started.generation.preview_model_commitment,
    "X-Vyakti-Voice-Model-Arm": metadata.modelArm || "general",
    "X-Vyakti-Voice-Quality-State": metadata.qualityState || started.voiceConditioning.qualityState,
    "X-Vyakti-Voice-Quality-Warnings": (metadata.qualityWarnings || started.voiceConditioning.qualityWarnings).join(","),
    "X-Vyakti-Voice-Effective-Cfg": String(metadata.effectiveCfgWeight ?? started.voiceConditioning.effectiveCfgWeight),
  });
}

export function isRetryableVoicePreviewFailure(error) {
  const code = String(error?.code || error?.message || "");
  const status = Number(error?.status);
  if (/^(?:azure_replica_storage_unreachable|private_storage_unreachable|audio_protection_unreachable)$/.test(code)) {
    return true;
  }
  if (code === "open_voice_http_429" || code === "audio_protection_http_429") return true;
  if (status >= 500 && status <= 599 && /^(?:azure_replica_storage_(?:read|write)_failed|private_storage_(?:read|write)_failed|private_storage_failure|audio_protection_http_5\d\d)$/.test(code)) {
    return true;
  }
  return false;
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
 *                 warmth, origin, now, fetchImpl, sleep, markFailed, markAborted,
 *                 markWarming, markRetryable, readResult, storeResult, sealIntent,
 *                 renewIntent,
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
  let providerStarted = false;
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
      regeneration_key: body?.regeneration_key,
      output_storage_bucket: deps.outputStorageBucket,
    });
  } catch (error) {
    const status = Number.isInteger(error?.status) ? error.status : 500;
    return jsonResult(status, {
      state: "error",
      error: status === 500 ? "voice_preview_failed" : String(error?.code || error?.message),
    });
  }

  // `beginOwnedVoicePreview` is both claim and observation. Only the lease
  // holder may touch private reference bytes or the GPU. Every other tab and
  // every other Vercel instance receives the same durable intent and waits.
  if (started.intent?.role === "observe") {
    const stage = started.intent.state === "synthesizing" ? "synthesizing" : "runtime_cold";
    return intentProgress(started, stage, { failure_code: started.intent.failureCode || undefined });
  }


  if (started.intent?.role === "failed") {
    return jsonResult(409, {
      state: "error",
      error: started.intent.failureCode || "voice_preview_intent_failed",
      intent_id: started.intent.intentId,
      generation_id: started.intent.generationId || null,
      attempt: started.intent.attempt,
      started_at: started.intent.startedAt,
      updated_at: started.intent.updatedAt,
    });
  }

  if (started.intent?.role === "sealed") {
    try {
      if (!started.intent.result.expiresAt || Date.parse(started.intent.result.expiresAt) <= now()) {
        const expired = await deps.expireIntent(started);
        // Settle the durable state before deleting bytes. If the SQL statement
        // fails, the sealed row still points at an existing object. If another
        // reader won the row lock, this caller still returns non-audio progress.
        if (expired) {
          try {
            await deps.deleteResult(expired);
            await deps.markResultDeleted(started, expired);
          } catch {}
        }
        return intentProgress(started, "result_expired", { failure_code: "voice_preview_result_expired" });
      }
      const stored = await deps.readResult(started.intent.result);
      const digest = createHash("sha256").update(stored.body).digest("hex");
      if (stored.mime !== "audio/wav" || stored.byteSize !== started.intent.result.byteSize ||
          stored.byteSize !== stored.body.length || digest !== started.intent.result.sha256) {
        throw Object.assign(new Error("voice_preview_result_binding_failed"), {
          code: "voice_preview_result_binding_failed", status: 409,
        });
      }
      return Object.freeze({
        kind: "audio",
        status: 200,
        body: stored.body,
        headers: previewAudioHeaders(started, textFrontend, textPlan, started.intent.result.metadata, true),
      });
    } catch (error) {
      const status = Number.isInteger(error?.status) ? error.status : 500;
      return jsonResult(status, {
        state: "error",
        error: status === 500 ? "voice_preview_failed" : String(error?.code || error?.message),
      });
    }
  }

  const abortWarmup = async (code) => {
    if (started.intent) await deps.markWarming(started, { code });
    else await deps.markAborted(started.generation.generation_id, { code });
  };

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
      if (health.code === "voice_origin_invalid") {
        await deps.markFailed(started.generation.generation_id, { code: health.code });
        return jsonResult(503, { state: "error", error: "voice_origin_invalid" });
      }
      await abortWarmup(health.code);
      return started.intent
        ? intentProgress(started, "admission_cold", { probe_ms: health.elapsedMs, probe_attempts: health.attempts })
        : warmingResult("admission_cold", { probe_ms: health.elapsedMs, probe_attempts: health.attempts });
    }

    let warmth = deps.warmth.read(deps.origin, now());
    // A Vercel function's warmth registry is only a hint. Another invocation
    // can land on a different process, and an old `waking` record can outlive
    // the GPU app's real boot. Ask the admission broker for the private
    // runtime's current health before trusting either local `cold` or local
    // `warming`. The broker endpoint is HMAC admitted before it touches the
    // internal origin, so this neither exposes the GPU ingress nor lets public
    // traffic wake billable capacity.
    if (warmth.state !== "warm" && typeof deps.provider.probeRuntimeReadiness === "function") {
      const runtimeReady = await deps.provider.probeRuntimeReadiness({ signal: deps.signal });
      if (runtimeReady) {
        deps.warmth.note(deps.origin, "ready", now());
        warmth = deps.warmth.read(deps.origin, now());
      } else {
        deps.warmth.note(deps.origin, "waking", now());
        await abortWarmup("open_voice_runtime_warming");
        return started.intent
          ? intentProgress(started, "runtime_cold", { runtime_status_checked: true })
          : warmingResult("runtime_cold", { runtime_status_checked: true });
      }
    }
    if (warmth.state === "warming") {
      // Somebody's click is already paying for this wake. Charging a second
      // GPU cold start for the same replica would be paying twice for one boot.
      await abortWarmup("voice_preview_wake_in_flight");
      return started.intent
        ? intentProgress(started, "wake_in_flight", { wake_age_ms: warmth.ageMs })
        : warmingResult("wake_in_flight", { wake_age_ms: warmth.ageMs });
    }

    const stored = await deps.readObject(started.reference);
    if (stored.mime !== started.reference.mime || stored.byteSize !== started.reference.byteSize ||
        createHash("sha256").update(stored.body).digest("hex") !== started.reference.sha256) {
      throw Object.assign(new Error("voice_preview_reference_binding_failed"), {
        code: "voice_preview_reference_binding_failed", status: 409,
      });
    }

    const synthesize = () => {
      // Set this before entering provider code. Any transport loss after this
      // point may have left an admitted broker/GPU request running.
      providerStarted = true;
      return deps.provider.synthesizePreview({
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
    };

    let raw;
    if (warmth.state === "warm") {
      raw = await synthesize();
    } else {
      // Cold. This request is the wake. Dispatch it, let it run, and stop
      // waiting after the flush window rather than holding the owner's
      // connection open until Container Apps kills it at ~240 s. A provider
      // success after that flush still proves the runtime is ready. Record
      // only that runtime fact: the abandoned generation stays aborted and its
      // discarded stream never enters the protection/sealing path below.
      deps.warmth.note(deps.origin, "waking", now());
      const outcome = await dispatchWake(async () => {
        const value = await synthesize();
        assertSynthesisResult(value);
        deps.warmth.note(deps.origin, "ready", now());
        return value;
      }, { flushMs: deps.flushMs, sleep: deps.sleep });
      if (outcome.kind === "flushed") {
        // The remote CUDA call can outlive this HTTP response. Keep the SQL
        // lease until its 290-second expiry so a browser abort or another tab
        // cannot submit duplicate GPU work while that call is still running.
        if (!started.intent) await abortWarmup("voice_preview_wake_dispatched");
        return started.intent
          ? intentProgress(started, "runtime_cold", { wake_dispatched: true })
          : warmingResult("runtime_cold", { wake_dispatched: true });
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
    if (started.intent && !await deps.renewIntent(started)) {
      throw Object.assign(new Error("voice_preview_intent_lease_lost"), {
        code: "voice_preview_intent_lease_lost", status: 409,
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

    const bodyBytes = Buffer.concat([wavHeader(pcm.length, synthesized.format), pcm]);
    const metadata = Object.freeze({
      modelCommitment: deps.provider.modelCommitment,
      modelArm: synthesized.receipt?.modelArm || deps.provider.modelArm || "general",
      qualityState: synthesized.receipt?.qualityState || started.voiceConditioning.qualityState,
      qualityWarnings: synthesized.receipt?.qualityWarnings || started.voiceConditioning.qualityWarnings,
      effectiveCfgWeight: synthesized.receipt?.effectiveCfgWeight ?? started.voiceConditioning.effectiveCfgWeight,
    });
    if (started.intent) {
      const storedResult = await deps.storeResult(started, bodyBytes);
      try {
        await deps.sealIntent(started, { ...storedResult, metadata });
      } catch (error) {
        // Storage is create-only and generation-scoped. If the DB settlement
        // loses its lease, remove the exact object before allowing recovery so
        // a protected but unreachable WAV does not become an orphan.
        try {
          await deps.deleteResult(storedResult);
          await deps.markResultDeleted(started, storedResult);
        } catch {}
        throw error;
      }
    }
    deps.warmth.note(deps.origin, "ready", now());
    return Object.freeze({
      kind: "audio",
      status: 200,
      body: bodyBytes,
      headers: previewAudioHeaders(started, textFrontend, textPlan, metadata, false),
    });
  } catch (error) {
    const code = String(error?.code || error?.message || "");
    const readinessRetryable = !providerStarted && /^(?:client_aborted|voice_preview_timeout|open_voice_runtime_status_timeout|open_voice_unreachable)$/.test(code);
    if (started.intent && readinessRetryable) {
      // No synthesis POST was admitted. It is safe to release this attempt
      // into a delayed warming state; holding the 290-second execution fence
      // here would punish a status-probe timeout without preventing GPU work.
      await abortWarmup(code);
      deps.warmth.note(deps.origin, "waking", now());
      return intentProgress(started, "runtime_cold", { failure_code: code });
    }
    const transportMayStillBeRunning = providerStarted && (
      /^(?:client_aborted|voice_preview_timeout|open_voice_execution_may_continue|open_voice_(?:runtime_)?unreachable)$/.test(code) ||
      /^open_voice_http_5\d\d$/.test(code)
    );
    if (started.intent && (transportMayStillBeRunning || code === "voice_preview_wake_dispatched")) {
      // The provider may still be running after our socket is gone. Observers
      // keep seeing the same leased intent until the lease expires; only then
      // may one request recover it with a new generation.
      if (/^open_voice_(?:execution_may_continue|(?:runtime_)?unreachable|http_5\d\d)$/.test(code)) {
        deps.warmth.note(deps.origin, "waking", now());
      }
      return intentProgress(started, "synthesizing", { failure_code: code });
    }
    const verdict = classifyPreviewFailure(error);
    if (verdict.state === "warming") {
      await abortWarmup(verdict.code);
      deps.warmth.note(deps.origin, "waking", now());
      return started.intent
        ? intentProgress(started, verdict.stage, { failure_code: verdict.code })
        : warmingResult(verdict.stage, { failure_code: verdict.code });
    }
    if (started.intent) {
      const retryable = isRetryableVoicePreviewFailure(error);
      if (retryable) await deps.markRetryable(started, error);
      else await deps.markTerminal(started, error);
    } else await deps.markFailed(started.generation.generation_id, error);
    const status = Number.isInteger(error?.status) ? error.status : 500;
    return jsonResult(status, {
      state: "error",
      error: status === 500 ? "voice_preview_failed" : verdict.code,
    });
  }
}
