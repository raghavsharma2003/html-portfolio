// Offline structural gate for noisy-evidence processing. The providers and
// bytes are deterministic fixtures: this suite proves boundaries, lineage and
// retry behavior, never speech quality or human similarity.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const Contracts = await import(pathToFileURL(join(ROOT, "api/_replica-processing/contracts.js")));
const Pipeline = await import(pathToFileURL(join(ROOT, "api/_replica-processing/pipeline.js")));
const Queue = await import(pathToFileURL(join(ROOT, "api/_replica-processing/queue.js")));
const Worker = await import(pathToFileURL(join(ROOT, "api/_replica-processing/worker.js")));
const Builders = await import(pathToFileURL(join(ROOT, "api/_replica-processing/builders.js")));
const Fake = await import(pathToFileURL(join(ROOT, "api/_replica-processing/providers/fake.js")));
const AzureFast = await import(pathToFileURL(join(ROOT, "api/_replica-processing/providers/azure-fast-transcription.js")));
const Repository = await import(pathToFileURL(join(ROOT, "api/_replica-processing/repository.js")));
const { splitSql } = await import(pathToFileURL(join(ROOT, "db/migrations/apply.mjs")));
const Windows = await import(pathToFileURL(join(ROOT, "api/_video-enroll/windows.js")));
const RefWindow = await import(pathToFileURL(join(ROOT, "api/_replica-processing/reference-window.js")));

let failed = 0;
const ok = (name, condition, extra = "") => {
  if (condition) console.log(`  ok  ${name}`);
  else {
    failed++;
    console.log(`FAIL  ${name}${extra ? `\n      ${extra}` : ""}`);
  }
};
const throwsAsync = async (fn, code = "") => {
  try { await fn(); return false; } catch (error) { return code ? error.code === code : true; }
};
const captureAsync = async (fn) => { try { await fn(); return null; } catch (error) { return error; } };
const throws = (fn) => { try { fn(); return false; } catch { return true; } };

const OWNER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const REPLICA = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SOURCE = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const SHA = "d".repeat(64);
const source = Object.freeze({
  source_id: SOURCE,
  replica_id: REPLICA,
  owner_user_id: OWNER,
  kind: "audio",
  state: "quarantined",
  storage_bucket: "private-replica-evidence",
  object_path: `${OWNER}/${REPLICA}/${SOURCE}/original`,
  mime: "audio/wav",
  byte_size: 48_000,
  duration_ms: 24_000,
  sha256: SHA,
  contains_third_parties: false,
});
const job = (step, attempt = 1) => ({
  job_id: Contracts.stableUuid(`job:${step}`),
  replica_id: REPLICA,
  owner_user_id: OWNER,
  source_id: SOURCE,
  step,
  revision: 1,
  state: "leased",
  attempt,
});
const dependencies = {
  integrity: [],
  malware_scan: ["integrity"],
  media_probe: ["integrity", "malware_scan"],
  diarize: ["integrity", "malware_scan", "media_probe"],
  separate: ["integrity", "malware_scan", "media_probe", "diarize"],
  enhance: ["integrity", "malware_scan", "media_probe", "diarize", "separate"],
  transcribe: ["integrity", "malware_scan", "media_probe", "diarize", "separate", "enhance"],
  voice_quality: ["integrity", "malware_scan", "media_probe", "diarize", "separate", "enhance", "transcribe"],
};

{
  ok("only quarantined audio/video sources enter the shipped DAG",
    Pipeline.initialProcessingSteps(source).join() === "integrity" &&
    Pipeline.initialProcessingSteps({ ...source, kind: "text" }).length === 0);
  ok("the shipped DAG cannot skip target-source separation",
    Pipeline.nextProcessingSteps("diarize", dependencies.diarize).join() === "separate" &&
    Pipeline.nextProcessingSteps("separate", dependencies.separate).join() === "enhance");
  ok("derived paths are owner/replica/source scoped",
    Contracts.derivedArtifactPath({
      ownerUserId: OWNER, replicaId: REPLICA, sourceId: SOURCE,
      transformVersion: "fixture-v1", stage: "enhance",
      artifactId: Contracts.stableUuid("artifact"),
    }).startsWith(`${OWNER}/${REPLICA}/${SOURCE}/derived/fixture-v1/`));
  ok("path injection is rejected before storage", throws(() => Contracts.derivedArtifactPath({
    ownerUserId: OWNER, replicaId: REPLICA, sourceId: SOURCE,
    transformVersion: "../original", stage: "enhance", artifactId: Contracts.stableUuid("artifact"),
  })));
  ok("non-quarantined sources cannot be processed", throws(() => Contracts.assertProcessingSource({ ...source, state: "ready" })));
}

const adapters = Fake.createFakeProcessingAdapters();
const store = Fake.createFakeImmutableArtifactStore();
const integrity = await Worker.executeProcessingJob({
  job: job("integrity"), source, adapters, artifactStore: store, completedSteps: dependencies.integrity,
});
ok("server integrity seam completes only on the declared digest", integrity.outcome === "complete" && integrity.result.verified_input_sha256 === SHA);

const badIntegrity = await Worker.executeProcessingJob({
  job: job("integrity"), source, adapters: Fake.createFakeProcessingAdapters({ corruptIntegrity: true }),
  artifactStore: store, completedSteps: [],
});
ok("integrity mismatch blocks rather than completing", badIntegrity.outcome === "blocked" && badIntegrity.failure_code === "integrity_mismatch");

const transientAdapters = Fake.createFakeProcessingAdapters({ failOnceStage: "diarize" });
const firstDiarize = await Worker.executeProcessingJob({
  job: job("diarize", 1), source, adapters: transientAdapters, artifactStore: store,
  completedSteps: dependencies.diarize,
});
const secondDiarize = await Worker.executeProcessingJob({
  job: job("diarize", 2), source, adapters: transientAdapters, artifactStore: store,
  completedSteps: dependencies.diarize,
});
ok("transient adapter failures become bounded retries, not false completion",
  firstDiarize.outcome === "retry" && firstDiarize.retry_after_ms >= 2_000 && secondDiarize.outcome === "complete");

const diarization = await Worker.executeProcessingJob({
  job: job("diarize"), source, adapters, artifactStore: store, completedSteps: dependencies.diarize,
});
ok("speaker evidence retains offsets, confidence and adapter provenance",
  diarization.evidence.every((entry) => entry.span.end_ms > entry.span.start_ms && entry.confidence != null && entry.adapter.family === "diarization"));

// `separate` (WS-AO) windows down to the owner's own diarized speech instead
// of sending the whole recording. Offline and deterministic, same as every
// other fixture in this file: a synthetic 16 kHz mono PCM16 WAV standing in
// for the source's bytes, `diarizeSegments` built from the SAME evidence
// `diarization` above just produced (never re-derived by hand, so this test
// cannot silently drift from what `diarize` actually wrote), and a fake
// `withMaterializedAudio` that slices the in-memory fixture directly rather
// than shelling out to ffmpeg -- this suite proves boundaries and lineage,
// never a real subprocess.
const fixtureAudioMs = 24_000;
const fixtureAudio = RefWindow.wavBytesForSamples(
  Buffer.alloc((fixtureAudioMs / 1000) * 16_000 * 2, 0).map((_, index) => (index % 2 === 0 ? 120 : 0)),
);
const diarizeSegments = diarization.evidence
  .filter((entry) => entry.evidence_type === "speaker_segment")
  .map((entry) => ({ start_ms: entry.span.start_ms, end_ms: entry.span.end_ms, speaker_key: entry.value.speaker_key, confidence: entry.confidence }));
const resolveFixtureInput = async ({ input }) => {
  if (input.object_path !== source.object_path) throw new Error(`unexpected object_path ${input.object_path}`);
  return { mime: "audio/wav", byteSize: fixtureAudio.length, body: fixtureAudio };
};
// WS-AS: `extractWindow` is called TWICE now for a real window -- once at the
// fixed 16 kHz `windows.js` scores at, and once more at whatever rate the
// caller asks for (`ENROLLMENT_SAMPLE_RATE`, 24 kHz in production) to build
// the FULL-BANDWIDTH bytes that actually leave the container. This fixture
// does not resample for real (no ffmpeg here, by design -- see the file's
// header), but it must produce a WAV that honestly DECLARES the requested
// rate and the right sample count for the span, because `selectOwnerReference
// Window` cross-checks the second extraction's own duration against the
// first's before trusting it.
const withFixtureMaterializedAudio = async (input, fn) => {
  const bytes = Buffer.isBuffer(input) ? input : fixtureAudio;
  return fn({
  async extractWindow(startMs, endMs, { rate = 16_000 } = {}) {
    if (rate === 16_000) {
      const parsed = Windows.readPcm16Wav(bytes);
      const startSample = Math.round((startMs / 1000) * 16_000);
      const endSample = Math.round((endMs / 1000) * 16_000);
      return RefWindow.wavBytesForSamples(parsed.samples.subarray(startSample * 2, endSample * 2));
    }
    const sampleCount = Math.round(((endMs - startMs) / 1000) * rate);
    const samples = Buffer.alloc(sampleCount * 2, 0).map((_, index) => (index % 2 === 0 ? 120 : 0));
    return RefWindow.wavBytesForSamples(samples, rate);
  },
  });
};

const separated = await Worker.executeProcessingJob({
  job: job("separate"), source, adapters, artifactStore: store, completedSteps: dependencies.separate,
  diarizeSegments, resolveInput: resolveFixtureInput, withMaterializedAudio: withFixtureMaterializedAudio,
});
ok("separation creates an immutable foreground candidate before enhancement",
  separated.outcome === "complete" && separated.artifacts.length === 1 && separated.artifacts[0].stage === "separate");
// WS-AS: this fixture's diarize (contains_third_parties: false) reports ONE
// cluster, so dominantShare is 1.0 -- well above the 0.90 skip threshold. The
// GPU `separate` adapter must NEVER be called for it: the output should be
// the honest pass-through, named as such, and it must carry the full-
// bandwidth sample rate rather than the 16 kHz scoring one.
ok("a single-cluster recording skips GPU separation and says so on the artifact",
  separated.artifacts[0].transform.name === "reference-window-passthrough" &&
  separated.artifacts[0].quality.bandwidth_preserved === true &&
  separated.artifacts[0].quality.subject_selection_required === false);

// A recording where a second speaker holds a MEANINGFUL share of the diarized
// speech (here 300s/700s = 42.9%, far below the 0.90 threshold) must still go
// through the real GPU separator -- the fake adapter's own "fixture-
// enhancement" transform name is the tell, since the pass-through path would
// never produce that name.
const multiSpeakerSegments = [
  { start_ms: 0, end_ms: 400_000, speaker_key: "owner", confidence: 0.9 },
  { start_ms: 400_000, end_ms: 700_000, speaker_key: "other-speaker", confidence: 0.85 },
];
const multiSpeakerSeparated = await Worker.executeProcessingJob({
  job: job("separate"), source: { ...source, duration_ms: 700_000 }, adapters, artifactStore: Fake.createFakeImmutableArtifactStore(),
  completedSteps: dependencies.separate, diarizeSegments: multiSpeakerSegments,
  resolveInput: resolveFixtureInput, withMaterializedAudio: withFixtureMaterializedAudio,
});
ok("a genuinely multi-speaker recording still runs the real GPU separator",
  multiSpeakerSeparated.outcome === "complete" &&
  multiSpeakerSeparated.artifacts[0].transform.name === "fixture-enhancement");

// Exercises `ownerClusterSegments`/`shouldSkipSeparation` directly at the
// threshold boundary named in reference-window.js's own header.
ok("shouldSkipSeparation reads dominant share against the documented 0.90 threshold",
  RefWindow.shouldSkipSeparation({ dominantShare: 0.9624 }) === true &&
  RefWindow.shouldSkipSeparation({ dominantShare: 0.899 }) === false &&
  RefWindow.SEPARATION_DOMINANT_SHARE_THRESHOLD === 0.90);

const missingWindowCapability = await Worker.executeProcessingJob({
  job: job("separate"), source, adapters, artifactStore: store, completedSteps: dependencies.separate, diarizeSegments,
});
ok("separate refuses by name when the window tool/storage capability is absent, rather than falling back to the whole file",
  missingWindowCapability.outcome === "failed" && missingWindowCapability.failure_code === "reference_window_capability_missing");

const noOwnerRun = await Worker.executeProcessingJob({
  job: job("separate"), source, adapters, artifactStore: store, completedSteps: dependencies.separate,
  diarizeSegments: [{ start_ms: 0, end_ms: 4_000, speaker_key: "subject-candidate", confidence: 0.9 }],
  resolveInput: resolveFixtureInput, withMaterializedAudio: withFixtureMaterializedAudio,
});
ok("separate refuses rather than pad or splice when no owner run reaches one full window",
  noOwnerRun.outcome === "failed" && noOwnerRun.failure_code === "reference_window_no_candidate");

const enhanced = await Worker.executeProcessingJob({
  job: job("enhance"), source, adapters, artifactStore: store, completedSteps: dependencies.enhance,
  inputArtifacts: separated.artifacts,
});
const repeatedEnhancement = await Worker.executeProcessingJob({
  job: job("enhance"), source, adapters, artifactStore: store, completedSteps: dependencies.enhance,
  inputArtifacts: separated.artifacts,
});
ok("enhancement emits multiple immutable candidates beside the raw object",
  enhanced.outcome === "complete" && enhanced.artifacts.length === 2 &&
  enhanced.artifacts.every((entry) => entry.object_path.includes("/derived/") && entry.object_path !== source.object_path &&
    entry.parent_artifact_id === separated.artifacts[0].artifact_id && entry.input_sha256 === separated.artifacts[0].sha256));
ok("candidate manifests and nested provenance are frozen after hashing",
  Object.isFrozen(enhanced.artifacts) && Object.isFrozen(enhanced.artifacts[0]) &&
  Object.isFrozen(enhanced.artifacts[0].transform) && Object.isFrozen(enhanced.artifacts[0].quality));
ok("retrying the same revision is byte/manifest idempotent",
  enhanced.artifacts.map((entry) => entry.manifest_hash).join() === repeatedEnhancement.artifacts.map((entry) => entry.manifest_hash).join() &&
  // 1 separated candidate + 2 enhanced candidates + 1 owner reference window
  // (WS-AO's `separate` input, written once and reused byte-identically by
  // every retry -- see `reference_window_capability_missing` above for the
  // retry that has no window to reuse at all).
  store.snapshot().length === 4);
ok("enhancement refuses to skip the separated parent artifact", (await Worker.executeProcessingJob({
  job: job("enhance"), source, adapters, artifactStore: store, completedSteps: dependencies.enhance,
})).failure_code === "separation_artifact_missing");
ok("duplicate enhancement variants are rejected before persistence", (await Worker.executeProcessingJob({
  job: job("enhance"), source,
  adapters: Fake.createFakeProcessingAdapters({ duplicateEnhancementVariant: true }),
  artifactStore: Fake.createFakeImmutableArtifactStore(), completedSteps: dependencies.enhance,
  inputArtifacts: separated.artifacts,
})).outcome === "failed");

const crossArtifact = { ...enhanced.artifacts[0], replica_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee" };
const crossResult = await Worker.executeProcessingJob({
  job: job("transcribe"), source, adapters, artifactStore: store,
  completedSteps: dependencies.transcribe, inputArtifacts: [crossArtifact],
});
ok("worker rejects a cross-replica artifact before ASR", crossResult.outcome === "failed" && crossResult.failure_code === "cross_replica_artifact");

const transcript = await Worker.executeProcessingJob({
  job: job("transcribe"), source, adapters, artifactStore: store,
  completedSteps: dependencies.transcribe, inputArtifacts: enhanced.artifacts,
});
ok("ASR keeps transcript and language spans cited to candidate artifacts",
  transcript.outcome === "complete" && transcript.evidence.length === 4 &&
  transcript.evidence.every((entry) => entry.artifact_id && entry.input_sha256 !== SHA));

{
  const azureAudio = Buffer.from("bounded mocked Azure audio bytes", "utf8");
  const azureArtifact = {
    ...enhanced.artifacts[0],
    sha256: Contracts.sha256Hex(azureAudio),
    mime: "audio/wav",
    duration_ms: 2_400,
  };
  const budgetEnv = {
    AZURE_REPLICA_APP_BUDGET_USD: "1500",
    AZURE_SPEECH_FAST_TRANSCRIPTION_USD_PER_HOUR: "0.36",
  };
  const spendCalls = [];
  const spendDb = async (sql, params) => {
    spendCalls.push({ sql, params });
    if (/insert into vy_provider_budget/i.test(sql)) return [{
      reservation_id: "11111111-1111-4111-8111-111111111111", budget_id: params[0], request_hash: params[6],
      state: "reserved", reserved_microusd: params[8],
    }];
    if (/state='in_flight'/i.test(sql)) return [{ reservation_id: params[0], state: "in_flight" }];
    if (/with settled as/i.test(sql)) return [{ budget_id: "azure-replica-grant-v1", spent_microusd: params[4], reserved_microusd: 0, limit_microusd: 1_500_000_000, state: "active" }];
    if (/state='released'|state='reconcile_required'/i.test(sql)) return [];
    throw new Error(`unexpected spend SQL ${sql.slice(0, 80)}`);
  };
  const budgetHook = Object.freeze({ beforeProviderRequest: async () => {} });
  const payload = {
    durationMilliseconds: 2_400,
    combinedPhrases: [{ text: "Hello ji, aaj milte hain." }],
    phrases: [
      {
        offsetMilliseconds: 0, durationMilliseconds: 1_000,
        text: "Hello ji.", locale: "en-IN", confidence: 0.91, speaker: 0,
        words: [
          { text: "Hello", offsetMilliseconds: 0, durationMilliseconds: 440 },
          { text: "ji.", offsetMilliseconds: 460, durationMilliseconds: 340 },
        ],
      },
      {
        offsetMilliseconds: 1_200, durationMilliseconds: 800,
        text: "Aaj milte hain.", locale: "hi-IN", confidence: 0.86, speaker: 0,
        words: [
          { text: "Aaj", offsetMilliseconds: 1_200, durationMilliseconds: 220 },
          { text: "milte", offsetMilliseconds: 1_440, durationMilliseconds: 220 },
          { text: "hain.", offsetMilliseconds: 1_680, durationMilliseconds: 260 },
        ],
      },
    ],
  };
  const requests = [];
  const azure = AzureFast.createAzureFastTranscriptionAdapter({
    endpoint: "https://fixture-speech.cognitiveservices.azure.com/",
    apiKey: "fixture-key-never-sent-to-azure",
    timeoutMs: 5_000,
    diarizationMaxSpeakers: 4,
    async resolveInput() {
      return {
        mime: "audio/wav",
        byteSize: azureAudio.length,
        body: (async function* () { yield azureAudio.subarray(0, 9); yield azureAudio.subarray(9); })(),
      };
    },
    async fetchImpl(url, init) {
      const definition = JSON.parse(init.body.get("definition"));
      const uploaded = Buffer.from(await init.body.get("audio").arrayBuffer());
      requests.push({ url, init, definition, uploaded });
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });
  const azureOutput = await Worker.executeProcessingJob({
    job: job("transcribe"), source, adapters: { ...adapters, transcribe: azure },
    artifactStore: store, completedSteps: dependencies.transcribe, inputArtifacts: [azureArtifact],
    spendDb, budgetEnv,
  });
  const azureTranscripts = azureOutput.evidence.filter((entry) => entry.evidence_type === "transcript_span");
  ok("real Azure adapter satisfies the existing ASR adapter contract",
    azureOutput.outcome === "complete" &&
    azure.family === "asr" && azure.name === "azure-speech-fast-transcription" && azureTranscripts.length === 2 &&
    azureOutput.result.billing_state === "settled");
  ok("Azure audio cost is reserved before fetch and settled from rounded billable duration",
    /insert into vy_provider_budget/i.test(spendCalls[0].sql) && /state='in_flight'/i.test(spendCalls[1].sql) &&
    /with settled as/i.test(spendCalls[2].sql) && spendCalls[2].params[3] === 3_000);
  ok("Azure phrases normalize Hinglish locale and word millisecond timestamps",
    azureTranscripts[0].value.language === "en-IN" && azureTranscripts[1].value.language === "hi-IN" &&
    azureTranscripts.every((entry) => entry.value.words.every((word) => word.end_ms > word.start_ms)) &&
    azureOutput.evidence.filter((entry) => entry.evidence_type === "language_span").every((entry) => entry.value.code_switch));
  ok("Azure request uses direct inline multipart bytes and never a storage URL",
    requests.length === 1 && requests[0].url ===
      "https://fixture-speech.cognitiveservices.azure.com/speechtotext/transcriptions:transcribe?api-version=2025-10-15" &&
    requests[0].uploaded.equals(azureAudio) && !requests[0].definition.audioUrl &&
    JSON.stringify(requests[0].definition) === JSON.stringify({
      locales: ["en-IN", "hi-IN"], diarization: { enabled: true, maxSpeakers: 4 },
    }) && !Object.keys(requests[0].init.headers).some((key) => key.toLowerCase() === "content-type"));
  ok("Azure key stays in the auth header rather than URL or multipart body",
    requests[0].init.headers["Ocp-Apim-Subscription-Key"] === "fixture-key-never-sent-to-azure" &&
    !requests[0].url.includes("fixture-key") && !requests[0].uploaded.includes("fixture-key"));

  const baseAzure = (overrides = {}) => AzureFast.createAzureFastTranscriptionAdapter({
    endpoint: "https://centralindia.api.cognitive.microsoft.com/",
    apiKey: "fixture-key-never-sent-to-azure",
    timeoutMs: 5_000,
    resolveInput: async () => ({ body: azureAudio, mime: "audio/wav", byteSize: azureAudio.length }),
    fetchImpl: async () => new Response(JSON.stringify(payload), { status: 200 }),
    ...overrides,
  });
  ok("Azure adapter fails closed without explicit endpoint and authentication",
    throws(() => AzureFast.createAzureFastTranscriptionAdapter({ resolveInput: async () => ({}) })) &&
    throws(() => AzureFast.createAzureFastTranscriptionAdapter({
      endpoint: "https://centralindia.api.cognitive.microsoft.com/", resolveInput: async () => ({}),
    })));
  ok("non-Azure and path-bearing endpoints are rejected before fetch",
    throws(() => baseAzure({ endpoint: "https://example.com/" })) &&
    throws(() => baseAzure({ endpoint: "https://fixture-speech.cognitiveservices.azure.com/proxy" })));

  const privateUrlError = await captureAsync(() => baseAzure({
    resolveInput: async () => ({ signedReadUrl: "https://private.invalid/short-lived" }),
  }).transcribe({ source, inputs: [azureArtifact], billing: budgetHook }));
  ok("short-lived storage capabilities must resolve server-side to bytes, never Azure-facing URLs",
    privateUrlError?.code === "azure_asr_private_url_forbidden" && privateUrlError.retryable === false);

  const badDigest = await captureAsync(() => baseAzure().transcribe({
    source, inputs: [{ ...azureArtifact, sha256: "f".repeat(64) }], billing: budgetHook,
  }));
  ok("Azure upload is blocked when private bytes do not match artifact lineage",
    badDigest?.code === "azure_asr_input_integrity_mismatch" && badDigest.retryable === false);

  const throttled = await captureAsync(() => baseAzure({
    fetchImpl: async () => new Response("content deliberately ignored", {
      status: 429, headers: { "retry-after": "3" },
    }),
  }).transcribe({ source, inputs: [azureArtifact], billing: budgetHook }));
  const unauthorized = await captureAsync(() => baseAzure({
    fetchImpl: async () => new Response("content deliberately ignored", { status: 401 }),
  }).transcribe({ source, inputs: [azureArtifact], billing: budgetHook }));
  ok("Azure 429 is retryable and bounded without exposing response content",
    throttled?.code === "azure_asr_http_429" && throttled.retryable === true && throttled.retryAfterMs === 3_000 &&
    !throttled.message.includes("content"));
  ok("Azure authentication failures are permanent until configuration changes",
    unauthorized?.code === "azure_asr_http_401" && unauthorized.retryable === false);

  const invalidResponse = await captureAsync(() => baseAzure({
    fetchImpl: async () => new Response(JSON.stringify({
      phrases: [{ offsetMilliseconds: 0, durationMilliseconds: 100, text: "missing words", locale: "en-IN", confidence: 0.8 }],
    }), { status: 200 }),
  }).transcribe({ source, inputs: [azureArtifact], billing: budgetHook }));
  ok("missing word timestamps fail closed instead of degrading the evidence contract",
    invalidResponse?.code === "azure_asr_response_invalid" && invalidResponse.retryable === false);

  const timeout = await captureAsync(() => baseAzure({
    timeoutMs: 20,
    fetchImpl: async (_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })), { once: true });
    }),
  }).transcribe({ source, inputs: [azureArtifact], billing: budgetHook }));
  ok("Azure calls have a bounded timeout classified for worker retry",
    timeout?.code === "azure_asr_timeout" && timeout.retryable === true);

  const controller = new AbortController();
  controller.abort();
  const cancelled = await captureAsync(() => baseAzure().transcribe({
    source, inputs: [azureArtifact], signal: controller.signal, billing: budgetHook,
  }));
  ok("caller cancellation is preserved as non-retryable cancellation",
    cancelled?.code === "azure_asr_aborted" && cancelled.retryable === false);
  const unmetered = await captureAsync(() => baseAzure().transcribe({ source, inputs: [azureArtifact] }));
  ok("Azure provider refuses a direct call without the budget start hook",
    unmetered?.code === "azure_asr_budget_hook_required" && unmetered.retryable === false);
  const uncertainStart = spendCalls.length;
  const uncertain = await Worker.executeProcessingJob({
    job: job("transcribe", 2), source,
    adapters: { ...adapters, transcribe: baseAzure({ fetchImpl: async () => new Response("ignored", { status: 429 }) }) },
    artifactStore: store, completedSteps: dependencies.transcribe, inputArtifacts: [azureArtifact], spendDb, budgetEnv,
  });
  const uncertainSpend = spendCalls.slice(uncertainStart);
  ok("a provider-visible failed request is reconciliation-blocked instead of auto-retried",
    uncertain.outcome === "failed" && uncertain.failure_code === "provider_spend_reconciliation_required" &&
    uncertainSpend.some((call) => /state='in_flight'/i.test(call.sql)) &&
    uncertainSpend.some((call) => /state='reconcile_required'/i.test(call.sql)));

  const providerSource = readFileSync(
    join(ROOT, "api/_replica-processing/providers/azure-fast-transcription.js"), "utf8",
  );
  ok("provider contains no content logging or silent fake fallback",
    !/console\.(?:log|info|warn|error)/.test(providerSource) && !/providers\/fake|deterministic-fake/.test(providerSource));
}

const voice = await Worker.executeProcessingJob({
  job: job("voice_quality"), source, adapters, artifactStore: store,
  completedSteps: dependencies.voice_quality, inputArtifacts: enhanced.artifacts,
});
ok("voice analysis contract requires multiple embedding families and distributions",
  voice.outcome === "complete" && voice.evidence.filter((entry) => entry.evidence_type === "voice_embedding").length === 2 &&
  voice.evidence.filter((entry) => entry.evidence_type === "voice_embedding").every((entry) =>
    entry.artifact_id === enhanced.artifacts[0].artifact_id && entry.input_sha256 === enhanced.artifacts[0].sha256) &&
  voice.evidence.some((entry) => entry.evidence_type === "voice_measurement" && entry.value.input_set.length === 2));
ok("voice analysis rejects missing enhanced-input lineage", (await Worker.executeProcessingJob({
  job: job("voice_quality"), source,
  adapters: Fake.createFakeProcessingAdapters({ missingVoiceLineage: true }),
  artifactStore: store, completedSteps: dependencies.voice_quality, inputArtifacts: enhanced.artifacts,
})).failure_code === "voice_lineage_missing");
ok("one embedding family is rejected as insufficient identity evidence", (await Worker.executeProcessingJob({
  job: job("voice_quality"), source,
  adapters: Fake.createFakeProcessingAdapters({ singleEmbeddingFamily: true }),
  artifactStore: store, completedSteps: dependencies.voice_quality, inputArtifacts: enhanced.artifacts,
})).outcome === "failed");

{
  const acceptedArtifacts = [...separated.artifacts, ...enhanced.artifacts].map((entry) => ({ ...entry, decision: "accepted" }));
  const acceptedEvidence = [...diarization.evidence, ...voice.evidence].map((entry) => ({ ...entry, decision: "accepted" }));
  const draft = Builders.buildVoiceGenomeDraft({
    version: 1, builderVersion: "fixture-builder-v1",
    artifacts: acceptedArtifacts, evidence: acceptedEvidence,
    exclusions: ["overlap", "low-target-likelihood"],
  });
  const reordered = Builders.buildVoiceGenomeDraft({
    version: 1, builderVersion: "fixture-builder-v1",
    artifacts: [...acceptedArtifacts].reverse(), evidence: [...acceptedEvidence].reverse(),
    exclusions: ["low-target-likelihood", "overlap"],
  });
  ok("VoiceGenome source-set hash is order-independent and versioned",
    draft.source_set_hash === reordered.source_set_hash && draft.definition.schema_version === "voice-genome/v1");
  ok("VoiceGenome is portable and retains transform lineage",
    !JSON.stringify(draft.definition).includes("provider_ref") && draft.definition.references.transform_lineage.length === 3);
  ok("builder emits a draft, never an automatically approved model", draft.status === "draft" && draft.definition.calibration.status === "required");
  ok("hashed VoiceGenome definitions are deeply immutable",
    Object.isFrozen(draft.definition) && Object.isFrozen(draft.definition.references.transform_lineage));
  const fixtureOnly = Builders.voiceGenomeApprovalReadiness({
    draft, integrityVerified: true, thirdPartyCleared: true, ownerCalibrationApproved: true,
    heldOutEval: { verdict: "pass", realEvidence: true },
  });
  ok("fixture provenance can never approve a VoiceGenome", !fixtureOnly.ready && fixtureOnly.issues.includes("test_fixture_provenance"));
  let build = { build_kind: "voice_genome", state: "queued", attempt: 0, manifest_hash: "" };
  build = Builders.transitionModelBuild(build, "lease");
  build = Builders.transitionModelBuild(build, "start");
  build = Builders.transitionModelBuild(build, "submit_review", { manifest_hash: draft.manifest_hash });
  ok("versioned build state cannot approve without readiness", throws(() => Builders.transitionModelBuild(build, "approve", { readiness: fixtureOnly })));
  build = Builders.transitionModelBuild(build, "approve", { readiness: { ready: true } });
  ok("state machine can record an externally established approval verdict", build.state === "approved" && build.attempt === 1);
  ok("approved builds cannot be silently rebuilt in place", throws(() => Builders.transitionModelBuild(build, "start")));

  const profile = Builders.buildPersonProfileDraft({
    version: 1,
    builderVersion: "structured-profile-v1",
    claims: [{
      claim_id: 7, domain: "relationship", key: "friendship_origin",
      body: "Owner-reviewed fixture claim", origin: "self_declared", confidence: 0.98,
      source_ids: [SOURCE], status: "approved",
    }],
  });
  ok("person-profile builder remains structured, cited, versioned and draft-only",
    profile.status === "draft" && profile.definition.schema_version === "person-profile/v1" &&
    profile.definition.domains.relationship[0].source_ids[0] === SOURCE);
}

{
  const calls = [];
  const token = "fixed-lease-token-that-is-long-enough-for-tests";
  const db = async (sql, params) => {
    calls.push({ sql, params });
    return [{ ...job("integrity"), state: "leased", lease_expires_at: "later" }];
  };
  const leased = await Queue.leaseNextProcessingJob(db, { token, leaseMs: 30_000 });
  ok("queue leases atomically with SKIP LOCKED and reclaims expired leases",
    /for update skip locked/.test(calls[0].sql) && /lease_expires_at <= now\(\)/.test(calls[0].sql) &&
    /failure_code = 'lease_expired'/.test(calls[0].sql) &&
    /join vy_replica_source s[\s\S]*s\.source_id = j\.source_id[\s\S]*s\.owner_user_id = j\.owner_user_id/.test(calls[0].sql));
  ok("raw lease capability is returned once and only its digest is persisted",
    leased.leaseToken === token && calls[0].params[0] === Queue.leaseTokenHash(token) && !calls[0].params.includes(token));
  const completionCalls = [];
  await Queue.completeProcessingJob(async (sql, params) => {
    completionCalls.push({ sql, params });
    return [{ ...job("integrity"), state: "complete" }];
  }, {
    jobId: job("integrity").job_id, leaseToken: token, adapter: integrity.adapter, result: integrity.result,
  });
  ok("completion SQL proves every artifact/evidence id belongs to the leased owner tuple",
    /vy_replica_processing_artifact/.test(completionCalls[0].sql) &&
    /vy_replica_processing_evidence/.test(completionCalls[0].sql) && /owner_user_id = j\.owner_user_id/.test(completionCalls[0].sql) &&
    /j\.lease_expires_at > now\(\)/.test(completionCalls[0].sql));
  ok("a lost lease cannot be marked complete", await throwsAsync(() => Queue.completeProcessingJob(async () => [], {
    jobId: job("integrity").job_id, leaseToken: token, adapter: integrity.adapter, result: integrity.result,
  }), "lost_processing_lease"));
}

{
  const persisted = [];
  const fakeDb = async (sql, params) => {
    persisted.push({ sql, params });
    if (sql.includes("processing_artifact")) return [{ artifact_id: params[0], manifest_hash: params[22] }];
    return [{ evidence_id: params[0], record_hash: params[15] }];
  };
  const receipt = await Repository.persistProcessingOutput(fakeDb, enhanced);
  ok("repository persists create-only immutable manifests", receipt.artifact_ids.length === 2 && persisted.every((call) => /on conflict .* do nothing/.test(call.sql)));
  ok("repository refuses to persist retry/failure output", await throwsAsync(() => Repository.persistProcessingOutput(fakeDb, badIntegrity)));
}

{
  const migration = readFileSync(join(ROOT, "db/migrations/017_replica_processing_manifests.sql"), "utf8");
  ok("migration remains split into independently applicable statements", splitSql(migration).length >= 12);
  ok("schema only permits private derived artifact paths",
    /vy_replica_artifact_derived_path[\s\S]*\/derived\/%/.test(migration) && /object_path !~ ':\/\/'/.test(migration));
  ok("schema has append-only attempt, artifact, evidence and model-build records",
    ["vy_replica_processing_attempt", "vy_replica_processing_artifact", "vy_replica_processing_evidence", "vy_replica_model_build"]
      .every((name) => migration.includes(`create table if not exists ${name}`)));
  ok("schema rejects cross-replica source, job and parent-artifact linkage",
    /vy_replica_processing_source_owner_fk[\s\S]*foreign key \(source_id, replica_id, owner_user_id\)[\s\S]*references vy_replica_source\(source_id, replica_id, owner_user_id\)/.test(migration) &&
    /foreign key \(source_id, replica_id, owner_user_id\)[\s\S]*references vy_replica_source\(source_id, replica_id, owner_user_id\)/.test(migration) &&
    /foreign key \(created_by_job_id, source_id, replica_id, owner_user_id\)[\s\S]*references vy_replica_processing_job\(job_id, source_id, replica_id, owner_user_id\)/.test(migration) &&
    /foreign key \(parent_artifact_id, source_id, replica_id, owner_user_id\)[\s\S]*references vy_replica_processing_artifact\(artifact_id, source_id, replica_id, owner_user_id\)/.test(migration));
}

console.log(`\n${failed ? `${failed} FAILED` : "all replica-processing checks passed"}`);
process.exit(failed ? 1 : 0);
