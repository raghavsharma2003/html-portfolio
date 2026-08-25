import { ProcessingAdapterError, sha256Hex } from "./contracts.js";

// The first shipped worker is deliberately audio-first. Other source kinds stay
// quarantined until their own reviewed DAG exists; silently treating them as
// audio would manufacture evidence.
export const AUDIO_PROCESSING_DAG = Object.freeze({
  integrity: Object.freeze([]),
  malware_scan: Object.freeze(["integrity"]),
  media_probe: Object.freeze(["malware_scan"]),
  diarize: Object.freeze(["media_probe"]),
  separate: Object.freeze(["diarize"]),
  enhance: Object.freeze(["separate"]),
  transcribe: Object.freeze(["enhance"]),
  voice_quality: Object.freeze(["transcribe"]),
});

const NEXT = Object.freeze({
  integrity: "malware_scan",
  malware_scan: "media_probe",
  media_probe: "diarize",
  diarize: "separate",
  separate: "enhance",
  enhance: "transcribe",
  transcribe: "voice_quality",
  voice_quality: null,
});

export function initialProcessingSteps(source) {
  if (!source || source.state !== "quarantined") throw new Error("initial jobs require a quarantined source");
  if (!["audio", "video"].includes(source.kind)) return [];
  return ["integrity"];
}

export function nextProcessingSteps(step, completedSteps = []) {
  if (!(step in NEXT)) throw new Error(`unsupported audio pipeline step: ${step}`);
  const complete = new Set(completedSteps);
  complete.add(step);
  const next = NEXT[step];
  if (!next) return [];
  if (!AUDIO_PROCESSING_DAG[next].every((dependency) => complete.has(dependency))) return [];
  return [next];
}

export function assertDependencies(step, completedSteps = []) {
  const dependencies = AUDIO_PROCESSING_DAG[step];
  if (!dependencies) throw new Error(`unsupported audio pipeline step: ${step}`);
  const complete = new Set(completedSteps);
  const missing = dependencies.filter((dependency) => !complete.has(dependency));
  if (missing.length) {
    throw Object.assign(new Error(`processing dependencies missing: ${missing.join(",")}`), {
      code: "processing_dependency_missing",
      retryable: false,
    });
  }
  return true;
}

export function retryDelayMs(attempt, failureCode = "processing_adapter_error") {
  const normalizedAttempt = Math.max(1, Math.min(10, Number(attempt) || 1));
  const exponential = Math.min(3_600_000, 2_000 * 2 ** (normalizedAttempt - 1));
  // Stable jitter avoids worker herds without making offline replay nondeterministic.
  const jitter = Number.parseInt(sha256Hex(`${failureCode}:${normalizedAttempt}`).slice(0, 4), 16) % 751;
  return exponential + jitter;
}

export function classifyProcessingFailure(error, attempt, options = {}) {
  const maxAttempts = Number(options.maxAttempts || 5);
  const code = String(error?.code || "processing_worker_error").slice(0, 96);
  const retryable = error instanceof ProcessingAdapterError ? error.retryable : error?.retryable === true;
  if (retryable && Number(attempt) < maxAttempts) {
    return Object.freeze({
      outcome: "retry",
      failure_code: code,
      retry_after_ms: retryDelayMs(attempt, code),
    });
  }
  return Object.freeze({
    outcome: error?.code === "integrity_mismatch" || error?.code === "malware_detected" ? "blocked" : "failed",
    failure_code: code,
    retry_after_ms: null,
  });
}
