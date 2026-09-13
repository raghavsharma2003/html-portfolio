import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createNativeMediaAdapters } from "../../api/_replica-processing/providers/native-media.js";
import {
  createChunkedDiarizationAdapter,
  DIARIZATION_CHUNK_MS,
  DIARIZATION_OVERLAP_MS,
  reconcileDiarizationChunks,
} from "../../api/_replica-processing/chunked-diarization.js";
import { processingUnexpectedErrorDiagnostic } from "../../api/_replica-processing/worker.js";
import { createComposedDiarizationAdapter, selectTranscriptionLane } from "../../api/_replica-processing/composition.js";
import { readClamAvVerdict } from "../../api/_replica-processing/native-tools.js";
import { createFakeImmutableArtifactStore, createFakeProcessingAdapters } from "../../api/_replica-processing/providers/fake.js";
import { runNextProcessingJob } from "../../api/_replica-processing/runtime.js";
import { assertAdapter, sha256Hex, stableUuid } from "../../api/_replica-processing/contracts.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const OWNER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const REPLICA = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SOURCE = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const JOB = stableUuid("production-processing-job");
const AUDIO = Buffer.from("bounded private audio");
let checks = 0;

function ok(name, condition) {
  assert.ok(condition, name);
  console.log(`ok ${++checks} - ${name}`);
}

const source = {
  source_id: SOURCE,
  replica_id: REPLICA,
  owner_user_id: OWNER,
  kind: "audio",
  state: "quarantined",
  storage_bucket: "vyakti-replica-private",
  object_path: `${OWNER}/${REPLICA}/${SOURCE}/original`,
  mime: "audio/wav",
  byte_size: AUDIO.length,
  duration_ms: 1800,
  sha256: sha256Hex(AUDIO),
  contains_third_parties: false,
};
const resolver = async () => ({ mime: "audio/wav", byteSize: AUDIO.length, body: AUDIO });
const native = createNativeMediaAdapters({
  resolveInput: resolver,
  scanBytes: async (bytes) => ({ safe: bytes.equals(AUDIO), signatures: [] }),
  probeBytes: async () => ({ duration_ms: 1800, sample_rate_hz: 16_000, channels: 1, codec: "pcm_s16le" }),
  clamavVersion: "clamav-test",
  ffprobeVersion: "ffprobe-test",
});
const request = { source, inputs: [{ sha256: source.sha256, mime: source.mime, object_path: source.object_path }] };
const integrity = await native.integrity.verify(request);
ok("native integrity reads and rehashes exact private bytes", integrity.sha256 === source.sha256 && integrity.byte_size === AUDIO.length);
ok("real malware seam must return an explicit scanner verdict", (await native.malware_scan.scan(request)).safe === true);
const probe = await native.media_probe.probe(request);
ok("real media probe returns bounded decodable audio facts", probe.duration_ms === 1800 && probe.sample_rate_hz === 16_000 && probe.channels === 1);
const tampered = createNativeMediaAdapters({
  resolveInput: async () => ({ mime: "audio/wav", body: Buffer.from("tampered") }),
  scanBytes: async () => ({ safe: true }),
  probeBytes: async () => probe,
});
await assert.rejects(tampered.integrity.verify(request), /native_media_input_integrity_mismatch/);
ok("native stages cannot bless bytes that differ from the upload declaration", true);

for (const [output, code] of [
  ["INSTREAM size limit exceeded", "clamav_scan_size_limit"],
  ["Can't connect to clamd through /tmp/clamd.sock", "clamav_daemon_unavailable"],
  ["fdpass failed: Permission denied", "clamav_scan_access_failed"],
]) {
  await assert.rejects(async () => readClamAvVerdict({ exitCode: 2, stdout: "", stderr: output }),
    (error) => error.code === code);
}
ok("ClamAV failures retain a content-free operational class", true);

const reconciled = reconcileDiarizationChunks([
  { startMs: 0, endMs: 60_000, segments: [
    { start_ms: 0, end_ms: 20_000, speaker_key: "local-owner", confidence: 0.9, target_likelihood: 0.5, overlap: false },
    { start_ms: 50_000, end_ms: 60_000, speaker_key: "local-owner", confidence: 0.9, target_likelihood: 0.5, overlap: false },
  ] },
  { startMs: 50_000, endMs: 110_000, segments: [
    { start_ms: 0, end_ms: 10_000, speaker_key: "labels-swapped", confidence: 0.9, target_likelihood: 0.5, overlap: false },
    { start_ms: 10_000, end_ms: 30_000, speaker_key: "labels-swapped", confidence: 0.9, target_likelihood: 0.5, overlap: false },
    { start_ms: 35_000, end_ms: 45_000, speaker_key: "new-guest", confidence: 0.8, target_likelihood: 0.5, overlap: false },
  ] },
]);
ok("overlap reconciliation preserves one owner label when local cluster names change",
  reconciled.filter((segment) => segment.start_ms < 80_000).every((segment) => segment.speaker_key === "cluster-1"));
ok("a speaker with no overlap evidence is never guessed to be the owner",
  reconciled.find((segment) => segment.start_ms === 85_000)?.speaker_key === "cluster-2");

const chunkCalls = [];

const safeDiagnostic = processingUnexpectedErrorDiagnostic(Object.assign(
  new TypeError("Cannot read properties of undefined"),
  { stack: "TypeError: Cannot read properties of undefined\n    at x (file:///app/api/_replica-processing/chunked-diarization.js:133:28)" },
));
ok("unexpected worker diagnostics retain only a safe type, message, and repository frame",
  safeDiagnostic.type === "TypeError" &&
  safeDiagnostic.message === "Cannot read properties of undefined" &&
  safeDiagnostic.frame === "api/_replica-processing/chunked-diarization.js:133:28");
const redactedDiagnostic = processingUnexpectedErrorDiagnostic(new Error("failed for https://secret.example/path?token=value"));
ok("unexpected worker diagnostics redact URL-bearing messages", redactedDiagnostic.message === "redacted");
const chunked = createChunkedDiarizationAdapter({
  delegate: { family: "diarization", name: "fixture", version: "v1", diarize: async () => { throw new Error("whole input must not run"); } },
  chunkMs: 60_000,
  overlapMs: 10_000,
  withMaterializedAudio: async (input, fn) => {
    assert.equal(input.source.source_id, SOURCE);
    return fn({ extractWindow: async (startMs, endMs) => Buffer.from(`${startMs}:${endMs}`) });
  },
  analyzeChunk: async ({ input }) => {
    chunkCalls.push(input.duration_ms);
    return { segments: [{
      start_ms: 0, end_ms: input.duration_ms, speaker_key: "owner",
      confidence: 0.9, target_likelihood: 0.5, overlap: false,
    }] };
  },
});
ok("chunked diarization keeps its composed adapter facts valid for the production contract",
  assertAdapter(chunked, "diarize") === chunked
  && chunked.version.endsWith("-normalized-overlap-chunks-v2")
  && !chunked.version.includes("+"));
const chunkedResult = await chunked.diarize({
  source: { ...source, duration_ms: 130_000 },
  inputs: [{ object_path: source.object_path, sha256: source.sha256, mime: source.mime, duration_ms: 130_000 }],
});
ok("long diarization fans out deterministically into bounded overlapping chunks",
  chunkCalls.join() === "60000,60000,30000" && chunkedResult.segments.at(-1).end_ms === 130_000
  && DIARIZATION_CHUNK_MS === 14 * 60 * 1000 && DIARIZATION_OVERLAP_MS === 60 * 1000);
const shortResult = await chunked.diarize({
  source: { ...source, duration_ms: 30_000 },
  inputs: [{ object_path: source.object_path, sha256: source.sha256, mime: "audio/x-ms-wma", duration_ms: 30_000 }],
});
ok("short container formats are normalized to bounded WAV before diarization",
  chunkCalls.at(-1) === 30_000 && shortResult.segments.length === 1 && shortResult.segments[0].end_ms === 30_000);

let composedDelegateCalls = 0;
const composed = createComposedDiarizationAdapter({
  family: "diarization", name: "fixture-composed", version: "v1",
  async diarize(input) {
    composedDelegateCalls += 1;
    assert.equal(input.inputs[0].mime, "audio/wav");
    return { segments: [{
      start_ms: 0, end_ms: input.inputs[0].duration_ms, speaker_key: "owner",
      confidence: 0.9, target_likelihood: 0.5, overlap: false,
    }] };
  },
}, async (_input, fn) => fn({
  extractWindow: async () => Buffer.from("normalized chunk"),
}), new WeakMap());
const composedResult = await composed.diarize({
  source: { ...source, duration_ms: 30_000 },
  inputs: [{ object_path: source.object_path, sha256: source.sha256, mime: source.mime, duration_ms: 30_000 }],
});
ok("production composition invokes the diarization adapter method for each normalized chunk",
  composedDelegateCalls === 1 && composedResult.segments.length === 1);

const leasedJob = {
  job_id: JOB, replica_id: REPLICA, owner_user_id: OWNER, source_id: SOURCE,
  step: "integrity", revision: 1, state: "leased", attempt: 1,
  lease_expires_at: "2026-08-24T16:00:00Z",
};
const dbCalls = [];
const db = async (sql) => {
  dbCalls.push(sql);
  if (/with candidate as/i.test(sql)) return [leasedJob];
  if (/select s\.source_id/i.test(sql)) return [source];
  if (/select step from vy_replica_processing_job/i.test(sql)) return [];
  if (/eligible_job as materialized/i.test(sql) && /desired_artifacts as materialized/i.test(sql) && /collision_guard as materialized/i.test(sql) && /source_state as/i.test(sql) && /enqueued as/i.test(sql)) return [leasedJob];
  throw new Error(`unexpected worker SQL: ${sql.slice(0, 100)}`);
};
const outcome = await runNextProcessingJob({
  db,
  adapters: createFakeProcessingAdapters(),
  artifactStore: createFakeImmutableArtifactStore(),
  leaseToken: "l".repeat(40),
});
ok("deployable consumer leases, loads, executes, settles and enqueues exactly one DAG step", outcome.outcome === "complete" && outcome.step === "integrity" && outcome.next_steps.join() === "malware_scan");
ok("consumer source load is composite owner-replica-source scoped", /s\.source_id=j\.source_id[\s\S]*s\.replica_id=j\.replica_id[\s\S]*s\.owner_user_id=j\.owner_user_id/i.test(dbCalls[1]));
ok("evidence persistence, lease settlement, source state and next enqueue share one SQL transaction", dbCalls.some((sql) => /eligible_job as materialized[\s\S]*desired_artifacts as materialized[\s\S]*collision_guard as materialized[\s\S]*settled as[\s\S]*source_state as[\s\S]*enqueued as/i.test(sql)));
ok("a lost lease cannot insert partial manifests before completion", dbCalls.some((sql) => /from desired_artifacts d cross join eligible_job j[\s\S]*created_by_job_id[\s\S]*from desired_evidence d cross join eligible_job j/i.test(sql)));
ok("atomic processing settlement rechecks that the source is still writable",
  dbCalls.some((sql) => /eligible_job as materialized[\s\S]*join vy_replica_source s[\s\S]*s\.state in \('quarantined','processing'\)/i.test(sql)));

const enhanceJob = { ...leasedJob, job_id: stableUuid("erasure-race-enhance"), step: "enhance" };
const separatedInput = {
  artifact_id: stableUuid("erasure-race-separated"), replica_id: REPLICA, owner_user_id: OWNER,
  source_id: SOURCE, stage: "separate", variant_key: "foreground",
  storage_bucket: source.storage_bucket,
  object_path: `${OWNER}/${REPLICA}/${SOURCE}/derived/separate/fixture.wav`,
  mime: "audio/wav", byte_size: AUDIO.length, duration_ms: source.duration_ms,
  sha256: source.sha256, input_sha256: source.sha256, manifest_hash: "a".repeat(64),
};
const raceDeletes = [];
const raceDb = async (sql) => {
  if (/with candidate as/i.test(sql)) return [enhanceJob];
  if (/select s\.source_id/i.test(sql) && !/eligible_job as materialized/i.test(sql)) return [{ ...source, state: "processing" }];
  if (/select step from vy_replica_processing_job/i.test(sql)) return [{ step: "separate" }];
  if (/from vy_replica_processing_artifact/i.test(sql) && !/eligible_job as materialized/i.test(sql)) return [separatedInput];
  if (/eligible_job as materialized/i.test(sql)) return [];
  if (/select s\.state from vy_replica_source/i.test(sql)) return [{ state: "deleting" }];
  throw new Error(`unexpected erasure-race SQL: ${sql.slice(0, 100)}`);
};
await assert.rejects(() => runNextProcessingJob({
  db: raceDb,
  adapters: createFakeProcessingAdapters(),
  artifactStore: createFakeImmutableArtifactStore(),
  leaseToken: "r".repeat(40),
  deleteObjects: async (locators) => raceDeletes.push(...locators),
}), (error) => error?.code === "lost_processing_lease");
ok("a worker that writes before losing settlement to source erasure exact-deletes every possible output",
  raceDeletes.length === 2 && raceDeletes.every((locator) =>
    locator.storageBucket === source.storage_bucket &&
    locator.objectPath.includes(`/${SOURCE}/derived/`) && locator.objectPath.includes("/enhance-")));

let acquiredWriter = 0;
let renewedWriter = 0;
let releasedWriter = 0;
let processingLateObjectVisible = false;
let finishProcessingLateCommit = null;
const timeoutDb = async (sql) => {
  if (/with candidate as/i.test(sql)) return [enhanceJob];
  if (/select s\.source_id/i.test(sql) && !/eligible_job as materialized/i.test(sql)) return [{ ...source, state: "processing" }];
  if (/select step from vy_replica_processing_job/i.test(sql)) return [{ step: "separate" }];
  if (/from vy_replica_processing_artifact/i.test(sql) && !/eligible_job as materialized/i.test(sql)) return [separatedInput];
  if (/with settled as/i.test(sql) && /set state = 'retry'/i.test(sql)) return [enhanceJob];
  if (/select s\.state from vy_replica_source/i.test(sql)) return [{ state: "processing" }];
  throw new Error(`unexpected writer-timeout SQL: ${sql.slice(0, 100)}`);
};
const timeoutOutcome = await runNextProcessingJob({
  db: timeoutDb,
  adapters: createFakeProcessingAdapters(),
  artifactStore: {
    async writeImmutable(input) {
      await input.beforeWriteRequest();
      // Model a provider that loses the acknowledgement while retaining the
      // request and makes the exact object visible only after this worker has
      // already settled its SQL job to retry.
      finishProcessingLateCommit = () => { processingLateObjectVisible = true; };
      throw Object.assign(new Error("provider acknowledgement timeout"), {
        code: "private_storage_write_failed",
        retryable: true,
      });
    },
  },
  leaseToken: "t".repeat(40),
  acquireStorageWriter: async () => {
    acquiredWriter += 1;
    return { writerId: stableUuid("timeout-writer"), sourceId: SOURCE, replicaId: REPLICA,
      ownerUserId: OWNER, purpose: "processing_artifact", token: "w".repeat(40) };
  },
  renewStorageWriter: async (_db, writer) => { renewedWriter += 1; return writer; },
  releaseStorageWriter: async () => { releasedWriter += 1; return true; },
});
finishProcessingLateCommit?.();
ok("a provider timeout settles the job but leaves its durable writer authority active",
  timeoutOutcome.outcome === "retry" && acquiredWriter === 1 && renewedWriter === 1 && releasedWriter === 0 &&
  processingLateObjectVisible);
const runtimeSource = readFileSync(join(ROOT, "api/_replica-processing/runtime.js"), "utf8");
const processingStorageSource = readFileSync(join(ROOT, "api/_replica-processing/storage.js"), "utf8");
ok("lease cancellation reaches every private artifact PUT and is checked around provider acknowledgement",
  /trackedArtifactStore\(store, writtenObjects, signal, storageWriter\)/.test(runtimeSource) &&
  /signal\?\.throwIfAborted\(\)[\s\S]*store\.writeImmutable\([\s\S]*beforeWriteRequest: storageWriter\.beforeWriteRequest[\s\S]*signal\?\.throwIfAborted\(\)/.test(runtimeSource) &&
  /signal: input\.signal/.test(processingStorageSource) &&
  /beforeWriteRequest: input\.beforeWriteRequest/.test(processingStorageSource));

const runOnce = readFileSync(join(ROOT, "services/replica-processing-worker/run-once.js"), "utf8");
// The shared subprocess contract. `services/replica-processing-worker/native.js`
// used to be read alongside it and is gone: it was a second copy of the logic
// that decides whether a file may be called clean, which is the one place in
// this system where two copies must not exist. WS-AH had already moved the
// spawn and the verdict into api/_replica-processing/native-tools.js, and the
// container now uses that seam through `composeProcessingAdapters`.
const nativeSource = readFileSync(join(ROOT, "api/_replica-processing/native-tools.js"), "utf8");
const clamav = readFileSync(join(ROOT, "services/replica-processing-worker/clamav.js"), "utf8");
const clamdConfig = readFileSync(join(ROOT, "services/replica-processing-worker/clamd.conf"), "utf8");
const composition = readFileSync(join(ROOT, "api/_replica-processing/composition.js"), "utf8");
const docker = readFileSync(join(ROOT, "services/replica-processing-worker/Dockerfile"), "utf8");
const dockerIgnore = readFileSync(join(ROOT, ".dockerignore"), "utf8");
const workerInfra = readFileSync(join(ROOT, "services/replica-processing-worker/infra/main.bicep"), "utf8");
const evidenceInfra = readFileSync(join(ROOT, "services/voice-evidence/infra/main.bicep"), "utf8");
// The job used to name the three adapter factories itself. It now composes
// through `composeProcessingAdapters`, which names them, and that is not a
// cosmetic move: called directly, the Azure evidence and ASR factories THROW
// in their constructors when unconfigured, so the process died building its
// adapters before it leased anything and the two steps this container exists
// to serve never ran. The property is unchanged - the production job gets
// native, evidence and ASR families and no fixtures - so it is asserted where
// Azure is selected only when its env is present. A half-configured Azure lane
// remains selected so its drift cannot hide behind a silent vendor change.
const azureLane = { value: { name: "azure" } };
const sarvamLane = { value: { name: "sarvam" } };
ok("production job composes native safety, evidence and both real ASR lanes",
  /composeProcessingAdapters/.test(runOnce) && /createNativeMediaAdapters/.test(composition)
  && /createAzureVoiceEvidenceAdapters/.test(composition)
  && /createAzureFastTranscriptionAdapter/.test(composition)
  && /createSarvamTranscriptionAdapter/.test(composition)
  && /withInputFile: storage\.withResolvedInputFile/.test(composition)
  && /prepareInputFile: runners\.withAzureAsrFile/.test(composition));
ok("long Azure ASR work gets a bounded fifteen-minute deadline inside the renewable worker lease",
  /timeoutMs: 15 \* 60_000/.test(composition)
  && /maxRuntimeMs - 20_000/.test(runOnce)
  && /leaseMs: 600_000/.test(runOnce) && /heartbeatMs: 60_000/.test(runOnce));
ok("configured Azure Speech wins while absent Azure retains Sarvam",
  selectTranscriptionLane({ AZURE_SPEECH_ENDPOINT: "https://speech.example" }, azureLane, sarvamLane) === azureLane
  && selectTranscriptionLane({}, azureLane, sarvamLane) === sarvamLane);
ok("partial Azure configuration stays failed in Azure instead of changing vendor",
  selectTranscriptionLane({ AZURE_SPEECH_KEY: "present" }, azureLane, sarvamLane) === azureLane);
ok("worker infra binds Azure Speech endpoint and key as one optional pair",
  /param azureSpeechEndpoint string = ''/.test(workerInfra)
  && /@secure\(\)\s*param azureSpeechKey string = ''/.test(workerInfra)
  && /AZURE_SPEECH_KEY', secretRef: 'azure-speech-key'/.test(workerInfra)
  && /AZURE_SPEECH_FAST_TRANSCRIPTION_USD_PER_HOUR', value: azureSpeechFastTranscriptionUsdPerHour/.test(workerInfra)
  && /azureSpeechEndpoint and azureSpeechKey must be configured together/.test(workerInfra));
ok("production job has no fixture adapter path", !/fake|fixture/i.test(runOnce));
ok("worker is a scale-to-zero run-once process, not a public HTTP server", !/createServer|listen\(|EXPOSE/i.test(runOnce + docker));
// The shell entrypoint is gone, so `set -euo pipefail` is no longer where this
// property lives. It is now the same property in JavaScript: the refresh is
// awaited before the daemon starts, and a refresh that did not happen throws
// rather than being rounded up to one.
ok("current malware signatures are a fail-closed startup dependency", /freshclam/.test(clamav) && /throw toolError\("clamav_signature_refresh_failed"/.test(clamav) && /await refreshSignatures\(\)/.test(runOnce) && /clamdscan/.test(nativeSource));
const normalizeClamConfigs = docker.indexOf("RUN sed -i 's/\\r$//'");
const bakedSignatureRefresh = docker.indexOf("&& freshclam", normalizeClamConfigs);
ok("Windows checkout line endings are removed from both ClamAV configs before either tool runs",
  normalizeClamConfigs >= 0
  && docker.indexOf("freshclam.conf", normalizeClamConfigs) < bakedSignatureRefresh
  && docker.indexOf("clamd.conf", normalizeClamConfigs) < bakedSignatureRefresh);
ok("an integrity root starts ClamAV before the same run can lease its scan child",
  /SCANNER_START_STEPS = Object\.freeze\(\["integrity", "malware_scan"\]\)/.test(runOnce)
  && /needsScanner: steps\.some\(\(step\) => SCANNER_START_STEPS\.includes\(step\)\)/.test(runOnce));
ok("run-once stops its Clam child after the bounded queue drains",
  /let clamdChild = null/.test(runOnce)
  && /clamdChild = clamd\.child/.test(runOnce)
  && /finally \{[\s\S]*clamdChild\.kill\("SIGTERM"\)/.test(runOnce));
ok("ClamAV and the worker lease are bounded for one GiB and long audio",
  /MaxFileSize 1024M/.test(clamdConfig) && /MaxScanSize 1024M/.test(clamdConfig)
  && /leaseMs: 600_000/.test(runOnce) && /heartbeatMs: 60_000/.test(runOnce)
  && /replicaTimeout: 3600/.test(workerInfra));
ok("one scheduled run can finish an eight-step source and immediately build its VoiceGenome",
  /PROCESSING_JOBS_PER_RUN', value: '12'/.test(workerInfra)
  && /preferredSourceId/.test(runOnce)
  && /runVoiceGenomeBuildSweep\(\{ db, maxJobs: 4, sourceScope \}\)/.test(runOnce));
ok("new recordings are picked up within two minutes without concurrent replicas",
  /cronExpression: '\*\/2 \* \* \* \*'/.test(workerInfra)
  && /parallelism: 1/.test(workerInfra) && /replicaCompletionCount: 1/.test(workerInfra));
// This used to read "streamed to tools and never written to a temporary file",
// asserting `pipe:0` and banning `mkdtemp` outright. That is not achievable for
// media_probe and the ban was hiding it: a pipe is not seekable, an MP3's
// duration needs a seek, and measured in the worker image the same ffprobe
// invocation returns `"format": {}` on `pipe:0` and `"duration": "822.720000"`
// on a file. The step was failing `media_probe_output_invalid` on a recording
// that plays fine.
//
// Originals are materialized by the storage seam while hashing, under mode
// 0600, then passed over clamd's local socket by descriptor. This avoids both
// Node heap buffering and ClamAV's INSTREAM ceiling.
const scanBody = nativeSource.slice(nativeSource.indexOf("async scanFile"), nativeSource.indexOf("async scanBytes"));
ok("malware scanning uses local fd passing rather than ClamAV INSTREAM",
  scanBody.length > 100 && /"--fdpass"/.test(scanBody) && !/"--stream"/.test(scanBody));
ok("any materialised media bytes live in a private temp dir and are always removed", !/mkdtemp/.test(nativeSource) || (/mkdtemp\(join\(options\.tmpDir \|\| tmpdir\(\)/.test(nativeSource) && /finally \{[\s\S]{0,300}rm\(dir, \{ recursive: true, force: true \}\)/.test(nativeSource)));
ok("worker container is non-root", /USER 10003:10003/.test(docker));
ok("remote worker builds exclude local configuration and private key material",
  /^api\/_config\.js$/m.test(dockerIgnore)
  && /^api\/keyring\.json$/m.test(dockerIgnore)
  && /^\.env\.\*$/m.test(dockerIgnore)
  && /^\*\.local$/m.test(dockerIgnore)
  && /^\*\*\/\.env\.\*$/m.test(dockerIgnore)
  && /^\*\.pem$/m.test(dockerIgnore)
  && /^\*\*\/\*\.pem$/m.test(dockerIgnore)
  && /^\*\*\/\*\.key$/m.test(dockerIgnore));
ok("worker log deliberately excludes tenant, path, transcript and vector fields", /Content-free operational signal only/.test(runOnce) && !/console\.log/.test(runOnce));
ok("both Azure deployments require immutable image digests", [workerInfra, evidenceInfra].every((value) => /contains\(image, '@sha256:'\)/.test(value)));
ok("evidence ingress is private, scale-to-zero and single-concurrency on T4", /external: false/.test(evidenceInfra) && /minReplicas: 0/.test(evidenceInfra) && /maxReplicas: 1/.test(evidenceInfra) && /gpu: 1/.test(evidenceInfra) && /concurrentRequests: '1'/.test(evidenceInfra));
ok("scheduled consumer retries one pre-lease startup failure without fanning out database leases",
  /parallelism: 1/.test(workerInfra) && /replicaCompletionCount: 1/.test(workerInfra)
  && /replicaRetryLimit: 1/.test(workerInfra));
// This used to require `keyVaultUrl:` references. That was never deployable on
// this subscription and had already been deviated from once: a Key Vault
// reference needs a role assignment, and the deploying principal holds
// Contributor, which excludes `Microsoft.Authorization/roleAssignments/write`.
// See docs/gurukul/AZURE-DEPLOY-STATE.md section 6, where the same constraint
// forced ACR admin credentials instead of AcrPull.
//
// The property worth gating is the one that survives that constraint: every
// credential arrives as a `@secure()` parameter, reaches the container only
// through `secretRef`, and never appears as a plain parameter or a literal in
// the template.
ok("deployment keeps credentials out of the template and behind secretRef", /@secure\(\)\s*\nparam neonUrl string/.test(workerInfra) && /@secure\(\)\s*\nparam supabaseServiceRoleKey string/.test(workerInfra) && !/param (neonUrl|supabaseServiceRoleKey|azureSpeechKey|evidenceHmacSecret|acrPassword) string = '[^']/.test(workerInfra) && /secretRef: 'neon-url'/.test(workerInfra) && /secretRef: 'supabase-role'/.test(workerInfra));
ok("the $2k grant is protected by an explicit sub-ceiling", /maxValue\(2000\)/.test(workerInfra) && /AZURE_REPLICA_APP_BUDGET_USD/.test(workerInfra));

console.log(`\n${checks} processing worker checks passed`);
