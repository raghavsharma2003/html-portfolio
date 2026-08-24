import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createNativeMediaAdapters } from "../../api/_replica-processing/providers/native-media.js";
import { createFakeImmutableArtifactStore, createFakeProcessingAdapters } from "../../api/_replica-processing/providers/fake.js";
import { runNextProcessingJob } from "../../api/_replica-processing/runtime.js";
import { sha256Hex, stableUuid } from "../../api/_replica-processing/contracts.js";

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

const runOnce = readFileSync(join(ROOT, "services/replica-processing-worker/run-once.js"), "utf8");
const nativeSource = readFileSync(join(ROOT, "services/replica-processing-worker/native.js"), "utf8");
const docker = readFileSync(join(ROOT, "services/replica-processing-worker/Dockerfile"), "utf8");
const entrypoint = readFileSync(join(ROOT, "services/replica-processing-worker/entrypoint.sh"), "utf8");
const workerInfra = readFileSync(join(ROOT, "services/replica-processing-worker/infra/main.bicep"), "utf8");
const evidenceInfra = readFileSync(join(ROOT, "services/voice-evidence/infra/main.bicep"), "utf8");
ok("production job composes native safety, real evidence and Azure ASR adapters", /createNativeMediaAdapters/.test(runOnce) && /createAzureVoiceEvidenceAdapters/.test(runOnce) && /createAzureFastTranscriptionAdapter/.test(runOnce));
ok("production job has no fixture adapter path", !/fake|fixture/i.test(runOnce));
ok("worker is a scale-to-zero run-once process, not a public HTTP server", !/createServer|listen\(|EXPOSE/i.test(runOnce + docker));
ok("current malware signatures are a fail-closed startup dependency", /set -euo pipefail/.test(entrypoint) && /freshclam/.test(entrypoint) && /clamdscan/.test(nativeSource));
ok("media bytes are streamed to tools and never written to a temporary file", /pipe:0/.test(nativeSource) && !/writeFile|mkdtemp|tmpdir/i.test(nativeSource));
ok("worker container is non-root", /USER 10003:10003/.test(docker));
ok("worker log deliberately excludes tenant, path, transcript and vector fields", /Content-free operational signal only/.test(runOnce) && !/console\.log/.test(runOnce));
ok("both Azure deployments require immutable image digests", [workerInfra, evidenceInfra].every((value) => /contains\(image, '@sha256:'\)/.test(value)));
ok("evidence ingress is private, scale-to-zero and single-concurrency on T4", /external: false/.test(evidenceInfra) && /minReplicas: 0/.test(evidenceInfra) && /maxReplicas: 1/.test(evidenceInfra) && /gpu: 1/.test(evidenceInfra) && /concurrentRequests: '1'/.test(evidenceInfra));
ok("scheduled consumer is one-way and cannot fan out concurrent database leases", /parallelism: 1/.test(workerInfra) && /replicaCompletionCount: 1/.test(workerInfra) && /replicaRetryLimit: 0/.test(workerInfra));
ok("deployment keeps credentials in Key Vault-backed secret references", !/param (neonUrl|supabaseServiceRole|azureSpeechKey) string/i.test(workerInfra) && /keyVaultUrl: neonUrlSecretUri/.test(workerInfra) && /secretRef: 'speech-key'/.test(workerInfra));
ok("the $2k grant is protected by an explicit sub-ceiling", /maxValue\(2000\)/.test(workerInfra) && /AZURE_REPLICA_APP_BUDGET_USD/.test(workerInfra));

console.log(`\n${checks} processing worker checks passed`);
