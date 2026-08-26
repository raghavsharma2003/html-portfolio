import { CAPABILITY_ABSENCE_CODES } from "./capability-codes.js";
import { ProcessingAdapterError } from "./contracts.js";
import { createNativeToolRunners, nativeToolStatus } from "./native-tools.js";
import { createAzureFastTranscriptionAdapter } from "./providers/azure-fast-transcription.js";
import { createAzureVoiceEvidenceAdapters } from "./providers/azure-voice-evidence.js";
import { createNativeMediaAdapters } from "./providers/native-media.js";
import { createReplicaProcessingStorage } from "./storage.js";

// COMPOSING THE REAL PIPELINE, INCLUDING THE PARTS THAT ARE NOT THERE
// ---------------------------------------------------------------------------
// The eight-step audio DAG is served by three adapter families, and every one
// of them needs something this process may not have: two need binaries on the
// PATH, two need a private GPU service and an HMAC secret, one needs an Azure
// Speech endpoint and key, and all eight need private storage credentials to
// read the bytes at all.
//
// The tempting shape is to build what we can and leave the rest out. That is
// the shape this module refuses, for a mechanical reason: `assertAdapter` turns
// a missing adapter into `missing_processing_adapter`, one generic code for
// five very different absences. The owner reading their Activity screen would
// see the same sentence whether the malware scanner is undeployed, the Azure
// key is unset, or the storage role key expired, and those have three
// different next actions.
//
// So every step ALWAYS has an adapter. A step whose capability is genuinely
// absent gets a stub that carries that capability's OWN named code and throws
// it on first call, terminally. The job then stops at that step with a code
// that says which thing is missing, which is the difference between a dead end
// and a state.
//
// The stub never returns a value. There is no "degraded verdict" path, and
// there must not be: see the header of native-tools.js.

const STEP_METHOD = Object.freeze({
  integrity: "verify",
  malware_scan: "scan",
  media_probe: "probe",
  diarize: "diarize",
  separate: "separate",
  enhance: "enhance",
  transcribe: "transcribe",
  voice_quality: "measure",
});

/** Every step the audio DAG can reach, in DAG order. */
export const COMPOSED_STEPS = Object.freeze(Object.keys(STEP_METHOD));

// Re-exported so a caller composing adapters does not need to know that the
// set lives in a leaf module for the activity surface's benefit. Only codes in
// this set are ever requeued automatically.
export { CAPABILITY_ABSENCE_CODES };

function boundedInteger(value, fallback, min, max) {
  const number = value == null || value === "" ? fallback : Number(value);
  if (!Number.isInteger(number) || number < min || number > max) return fallback;
  return number;
}

/** An adapter that exists so the failure has a name, and does nothing else. */
export function unavailableAdapter(step, code) {
  const method = STEP_METHOD[step];
  if (!method) throw new Error(`no adapter contract for ${step}`);
  const thrower = async () => {
    throw new ProcessingAdapterError(code, { code, retryable: false });
  };
  return Object.freeze({
    family: "unavailable",
    name: "capability-not-deployed",
    version: "v1",
    unavailable: true,
    unavailable_code: code,
    [method]: thrower,
  });
}

/** Is the private storage role key actually present?
 *
 *  Read the same two names `api/_replica-storage.js` reads, and in the same
 *  order, so this check cannot disagree with the code it is predicting. It
 *  deliberately looks only at presence: a key that is present but wrong fails
 *  later with a storage code of its own, which is the honest place for it.
 */
export function storageConfigured(env = process.env, config = {}) {
  const baseUrl = String(env.SUPABASE_URL || config.SUPABASE_URL || "").trim();
  const key = String(env.SUPABASE_SERVICE_ROLE_KEY || config.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  return Boolean(baseUrl && key);
}

function tryBuild(build) {
  try {
    return { value: build(), code: "" };
  } catch (error) {
    return { value: null, code: String(error?.code || "").trim() };
  }
}

/**
 * Build the adapter set for THIS runtime, plus a per-step capability report.
 *
 * Returns `{ adapters, capabilities, storage }` where `capabilities[step]` is
 * `{ available, code }`. `code` is empty when the step is live and is the
 * specific absence code when it is not.
 */
export function composeProcessingAdapters(options = {}) {
  const env = options.env || process.env;
  const config = options.config || {};
  const storage = options.storage || createReplicaProcessingStorage({
    fetchImpl: options.fetchImpl,
    maxBytes: boundedInteger(env.REPLICA_PROCESSING_MAX_BYTES, 67_108_864, 1_048_576, 67_108_864),
    timeoutMs: boundedInteger(env.REPLICA_PROCESSING_READ_TIMEOUT_MS, 120_000, 10_000, 300_000),
  });

  const adapters = {};
  const capabilities = {};
  const declare = (step, code) => {
    capabilities[step] = Object.freeze({ available: !code, code });
    if (code) adapters[step] = unavailableAdapter(step, code);
  };

  // Storage gates EVERY step: none of them can read a byte without it. Checked
  // first so a missing role key reports as itself once, rather than as five
  // different downstream adapters each failing for their own reason.
  const storageOk = options.storageConfigured ?? storageConfigured(env, config);
  if (!storageOk) {
    for (const step of COMPOSED_STEPS) declare(step, "private_storage_not_configured");
    return Object.freeze({ adapters: Object.freeze(adapters), capabilities: Object.freeze(capabilities), storage });
  }

  // ── the native family: integrity, malware_scan, media_probe ──────────────
  //
  // `integrity` is pure SHA-256 over bytes this process already holds, so it is
  // live wherever storage is. The other two are subprocess calls and are live
  // only where their binaries are, which on a serverless runtime is nowhere.
  const tools = options.nativeToolStatus || nativeToolStatus(env);
  const runners = options.nativeToolRunners || createNativeToolRunners({ env, clamdConfigPath: options.clamdConfigPath });
  const native = createNativeMediaAdapters({
    resolveInput: storage.resolveInput,
    scanBytes: runners.scanBytes,
    probeBytes: runners.probeBytes,
    clamavVersion: String(env.CLAMAV_ADAPTER_VERSION || "clamav-runtime"),
    ffprobeVersion: String(env.FFPROBE_ADAPTER_VERSION || "ffprobe-runtime"),
  });
  adapters.integrity = native.integrity;
  declare("integrity", "");
  for (const step of ["malware_scan", "media_probe"]) {
    const status = tools[step] || { available: false, code: `${step}_unavailable` };
    if (status.available) {
      adapters[step] = native[step];
      declare(step, "");
    } else {
      declare(step, status.code);
    }
  }

  // ── the voice-evidence family: diarize, separate, enhance, voice_quality ──
  //
  // The factory validates its own config and throws a specific code, so the
  // stub carries THAT code rather than a generic one wherever we got one. When
  // the origin is simply unset we normalise to `voice_evidence_unconfigured`,
  // which is the code the Activity surface and the requeue both key on.
  const evidence = tryBuild(() => createAzureVoiceEvidenceAdapters({
    env, resolveInput: storage.resolveInput, fetchImpl: options.fetchImpl,
  }));
  const evidenceCode = evidence.value
    ? ""
    : (evidence.code === "voice_evidence_origin_required" || !evidence.code ? "voice_evidence_unconfigured" : evidence.code);
  for (const step of ["diarize", "separate", "enhance", "voice_quality"]) {
    if (evidence.value) {
      adapters[step] = evidence.value[step];
      declare(step, "");
    } else {
      declare(step, evidenceCode);
    }
  }

  // ── the ASR family: transcribe ───────────────────────────────────────────
  const asr = tryBuild(() => createAzureFastTranscriptionAdapter({
    endpoint: env.AZURE_SPEECH_ENDPOINT,
    apiKey: env.AZURE_SPEECH_KEY,
    locales: String(env.AZURE_SPEECH_LOCALES || "en-IN,hi-IN").split(",").map((entry) => entry.trim()).filter(Boolean),
    diarizationMaxSpeakers: boundedInteger(env.AZURE_SPEECH_MAX_SPEAKERS, 4, 2, 8),
    maxInputBytes: boundedInteger(env.VOICE_EVIDENCE_MAX_AUDIO_BYTES, 33_554_432, 1_048_576, 67_108_864),
    timeoutMs: 180_000,
    resolveInput: storage.resolveInput,
    fetchImpl: options.fetchImpl,
  }));
  //
  // The factory says `azure_asr_config_missing` when the endpoint or key is
  // unset. That is normalised to `asr_unconfigured` for the same reason the
  // evidence family is: the canonical per-capability code is what the requeue
  // and the Activity surface key on, and a second spelling for "not configured"
  // is a job that never recovers and a sentence the owner never sees. Any OTHER
  // code from the factory (a malformed endpoint, a bad bound) is a real
  // misconfiguration and is passed through unchanged, because it needs a human.
  const asrUnconfigured = new Set(["azure_asr_config_missing", "azure_asr_endpoint_required", ""]);
  if (asr.value) {
    adapters.transcribe = asr.value;
    declare("transcribe", "");
  } else {
    declare("transcribe", asrUnconfigured.has(asr.code) ? "asr_unconfigured" : asr.code);
  }

  return Object.freeze({
    adapters: Object.freeze(adapters),
    capabilities: Object.freeze(capabilities),
    storage,
  });
}

/** The one-line summary the sweep reports and the logs carry. Content-free by
 *  construction: step names and capability codes only, never a tenant, a path,
 *  or anything from inside a recording. */
export function capabilitySummary(capabilities) {
  const live = [];
  const absent = {};
  for (const step of COMPOSED_STEPS) {
    const entry = capabilities[step];
    if (entry?.available) live.push(step);
    else absent[step] = entry?.code || "unknown";
  }
  return Object.freeze({ live: Object.freeze(live), absent: Object.freeze(absent) });
}

/**
 * Put back the jobs that only stopped because we had not deployed something.
 *
 * WHY THIS EXISTS. A step that fails for capability absence is terminal, and it
 * has to be: retrying an undeployed scanner five times just burns the attempt
 * budget and lands in the same place with a worse code. But terminal plus
 * nothing else is exactly the dead end this lane is supposed to stop having.
 * The owner would deploy the worker, add the Azure key, and their recording
 * would still be sitting there failed, with no way back short of re-uploading
 * a file that was never the problem.
 *
 * So the sweep opens each run by requeuing jobs whose failure code is a
 * capability absence that is NO LONGER absent. It is fenced hard on both
 * sides: only codes in CAPABILITY_ABSENCE_CODES, and only where the step that
 * failed is live in THIS process right now. A genuine failure (a real malware
 * hit, a digest mismatch, a bad recording) can never match, because its code
 * is not in the set.
 *
 * `attempt` is reset so the recovered job gets its full retry budget against
 * the capability that has actually arrived, rather than inheriting attempts
 * spent against one that had not.
 */
export async function requeueRecoveredProcessingJobs(db, capabilities, options = {}) {
  const liveSteps = COMPOSED_STEPS.filter((step) => capabilities?.[step]?.available);
  if (!liveSteps.length) return Object.freeze({ requeued: 0, steps: Object.freeze([]) });
  const limit = boundedInteger(options.limit, 50, 1, 500);
  const rows = await db(
    `with recovered as (
       select job_id from vy_replica_processing_job
        where state = 'failed'
          and step = any($1::text[])
          and failure_code = any($2::text[])
        order by updated_at
        limit $3::int4
     )
     update vy_replica_processing_job j
        set state = 'queued', attempt = 0, failure_code = '', result = '{}'::jsonb,
            next_attempt_at = now(), lease_token_hash = '', leased_at = null,
            lease_expires_at = null, updated_at = now()
       from recovered r
      where j.job_id = r.job_id
      returning j.step`,
    [liveSteps, [...CAPABILITY_ABSENCE_CODES], limit],
  );
  return Object.freeze({
    requeued: rows.length,
    steps: Object.freeze([...new Set(rows.map((row) => row.step))].sort()),
  });
}
