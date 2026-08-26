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
// The shared subprocess contract. `services/replica-processing-worker/native.js`
// used to be read alongside it and is gone: it was a second copy of the logic
// that decides whether a file may be called clean, which is the one place in
// this system where two copies must not exist. WS-AH had already moved the
// spawn and the verdict into api/_replica-processing/native-tools.js, and the
// container now uses that seam through `composeProcessingAdapters`.
const nativeSource = readFileSync(join(ROOT, "api/_replica-processing/native-tools.js"), "utf8");
const clamav = readFileSync(join(ROOT, "services/replica-processing-worker/clamav.js"), "utf8");
const composition = readFileSync(join(ROOT, "api/_replica-processing/composition.js"), "utf8");
const docker = readFileSync(join(ROOT, "services/replica-processing-worker/Dockerfile"), "utf8");
const workerInfra = readFileSync(join(ROOT, "services/replica-processing-worker/infra/main.bicep"), "utf8");
const evidenceInfra = readFileSync(join(ROOT, "services/voice-evidence/infra/main.bicep"), "utf8");
// The job used to name the three adapter factories itself. It now composes
// through `composeProcessingAdapters`, which names them, and that is not a
// cosmetic move: called directly, the Azure evidence and ASR factories THROW
// in their constructors when unconfigured, so the process died building its
// adapters before it leased anything and the two steps this container exists
// to serve never ran. The property is unchanged - the production job gets
// native, evidence and ASR families and no fixtures - so it is asserted where
// the composition now happens. ASR is Sarvam, not Azure, as of WS-AN
// (2026-08-26, owner directive): this subscription has zero Cognitive
// Services accounts, so `transcribe` runs through the Sarvam adapters that
// already exist and are proven on Hinglish instead.
ok("production job composes native safety, real evidence and Sarvam ASR adapters", /composeProcessingAdapters/.test(runOnce) && /createNativeMediaAdapters/.test(composition) && /createAzureVoiceEvidenceAdapters/.test(composition) && /createSarvamTranscriptionAdapter/.test(composition));
ok("production job has no fixture adapter path", !/fake|fixture/i.test(runOnce));
ok("worker is a scale-to-zero run-once process, not a public HTTP server", !/createServer|listen\(|EXPOSE/i.test(runOnce + docker));
// The shell entrypoint is gone, so `set -euo pipefail` is no longer where this
// property lives. It is now the same property in JavaScript: the refresh is
// awaited before the daemon starts, and a refresh that did not happen throws
// rather than being rounded up to one.
ok("current malware signatures are a fail-closed startup dependency", /freshclam/.test(clamav) && /throw toolError\("clamav_signature_refresh_failed"/.test(clamav) && /await refreshSignatures\(\)/.test(runOnce) && /clamdscan/.test(nativeSource));
// This used to read "streamed to tools and never written to a temporary file",
// asserting `pipe:0` and banning `mkdtemp` outright. That is not achievable for
// media_probe and the ban was hiding it: a pipe is not seekable, an MP3's
// duration needs a seek, and measured in the worker image the same ffprobe
// invocation returns `"format": {}` on `pipe:0` and `"duration": "822.720000"`
// on a file. The step was failing `media_probe_output_invalid` on a recording
// that plays fine.
//
// The REAL property behind the old assertion is that source bytes must not be
// left lying on disk, and that is what is asserted now: the scan still streams,
// and any materialised file must be in a private temporary directory that is
// removed in a `finally`. A materialisation with no removal fails this.
// Scoped to the scanBytes body, because the module's header comment names both
// seams and a whole-file regex matches prose rather than code.
const scanBody = nativeSource.slice(nativeSource.indexOf("async scanBytes"), nativeSource.indexOf("async probeBytes"));
ok("malware scanning streams bytes and never materialises them", scanBody.length > 100 && /"--stream"/.test(scanBody) && !/mkdtemp|writeFile/.test(scanBody));
ok("any materialised media bytes live in a private temp dir and are always removed", !/mkdtemp/.test(nativeSource) || (/mkdtemp\(join\(options\.tmpDir \|\| tmpdir\(\)/.test(nativeSource) && /finally \{[\s\S]{0,300}rm\(dir, \{ recursive: true, force: true \}\)/.test(nativeSource)));
ok("worker container is non-root", /USER 10003:10003/.test(docker));
ok("worker log deliberately excludes tenant, path, transcript and vector fields", /Content-free operational signal only/.test(runOnce) && !/console\.log/.test(runOnce));
ok("both Azure deployments require immutable image digests", [workerInfra, evidenceInfra].every((value) => /contains\(image, '@sha256:'\)/.test(value)));
ok("evidence ingress is private, scale-to-zero and single-concurrency on T4", /external: false/.test(evidenceInfra) && /minReplicas: 0/.test(evidenceInfra) && /maxReplicas: 1/.test(evidenceInfra) && /gpu: 1/.test(evidenceInfra) && /concurrentRequests: '1'/.test(evidenceInfra));
ok("scheduled consumer is one-way and cannot fan out concurrent database leases", /parallelism: 1/.test(workerInfra) && /replicaCompletionCount: 1/.test(workerInfra) && /replicaRetryLimit: 0/.test(workerInfra));
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
