import { createNativeMediaAdapters } from "../../api/_replica-processing/providers/native-media.js";
import { createAzureFastTranscriptionAdapter } from "../../api/_replica-processing/providers/azure-fast-transcription.js";
import { createAzureVoiceEvidenceAdapters } from "../../api/_replica-processing/providers/azure-voice-evidence.js";
import { runNextProcessingJob } from "../../api/_replica-processing/runtime.js";
import { createReplicaProcessingStorage } from "../../api/_replica-processing/storage.js";
import { createNeonDb } from "./db.js";
import { probeWithFfprobe, scanWithClamAv } from "./native.js";

function boundedInteger(value, fallback, min, max, code) {
  const number = value == null ? fallback : Number(value);
  if (!Number.isInteger(number) || number < min || number > max) throw new Error(code);
  return number;
}

function createAdapters(storage, env = process.env) {
  const native = createNativeMediaAdapters({
    resolveInput: storage.resolveInput,
    scanBytes: scanWithClamAv,
    probeBytes: probeWithFfprobe,
    clamavVersion: String(env.CLAMAV_ADAPTER_VERSION || "clamav-debian12"),
    ffprobeVersion: String(env.FFPROBE_ADAPTER_VERSION || "ffprobe-debian12"),
  });
  const evidence = createAzureVoiceEvidenceAdapters({ env, resolveInput: storage.resolveInput });
  const transcription = createAzureFastTranscriptionAdapter({
    endpoint: env.AZURE_SPEECH_ENDPOINT,
    apiKey: env.AZURE_SPEECH_KEY,
    locales: String(env.AZURE_SPEECH_LOCALES || "en-IN,hi-IN").split(",").map((entry) => entry.trim()).filter(Boolean),
    diarizationMaxSpeakers: boundedInteger(env.AZURE_SPEECH_MAX_SPEAKERS, 4, 2, 8, "azure_speech_max_speakers_invalid"),
    maxInputBytes: boundedInteger(env.VOICE_EVIDENCE_MAX_AUDIO_BYTES, 33_554_432, 1_048_576, 67_108_864, "worker_audio_limit_invalid"),
    timeoutMs: 180_000,
    resolveInput: storage.resolveInput,
  });
  return Object.freeze({
    integrity: native.integrity,
    malware_scan: native.malware_scan,
    media_probe: native.media_probe,
    diarize: evidence.diarize,
    separate: evidence.separate,
    enhance: evidence.enhance,
    transcribe: transcription,
    voice_quality: evidence.voice_quality,
  });
}

async function main() {
  const maxJobs = boundedInteger(process.env.PROCESSING_JOBS_PER_RUN, 4, 1, 20, "processing_jobs_per_run_invalid");
  const maxRuntimeMs = boundedInteger(process.env.PROCESSING_RUN_BUDGET_MS, 840_000, 60_000, 850_000, "processing_run_budget_invalid");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("processing-run-budget")), maxRuntimeMs);
  const db = createNeonDb();
  const storage = createReplicaProcessingStorage({ maxBytes: 67_108_864, timeoutMs: 120_000 });
  const adapters = createAdapters(storage);
  const started = Date.now();
  const outcomes = [];
  try {
    for (let count = 0; count < maxJobs && Date.now() - started < maxRuntimeMs - 15_000; count++) {
      const outcome = await runNextProcessingJob({
        db,
        adapters,
        artifactStore: storage.artifactStore,
        budgetEnv: process.env,
        leaseMs: 900_000,
        signal: controller.signal,
      });
      outcomes.push({ outcome: outcome.outcome, step: outcome.step || null, failure_code: outcome.failure_code || null });
      if (outcome.outcome === "idle") break;
    }
  } finally {
    clearTimeout(timer);
  }
  // Content-free operational signal only. Never log job, tenant, object,
  // model vector, transcript, audio, or provider request identifiers.
  process.stdout.write(`${JSON.stringify({ processed: outcomes.filter((item) => item.outcome !== "idle").length, outcomes })}\n`);
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({ error: String(error?.code || error?.message || "processing_worker_failed").slice(0, 96) })}\n`);
  process.exitCode = 1;
});

