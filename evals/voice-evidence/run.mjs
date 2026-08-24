import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  azureVoiceEvidenceConfig,
  createAzureVoiceEvidenceAdapters,
} from "../../api/_replica-processing/providers/azure-voice-evidence.js";
import { canonicalJson, sha256Hex } from "../../api/_replica-processing/contracts.js";
import { createReplicaProcessingStorage } from "../../api/_replica-processing/storage.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SECRET = Buffer.alloc(32, 27).toString("base64url");
const ENV = {
  AZURE_VOICE_EVIDENCE_ORIGIN: "https://voice-evidence.internal",
  AZURE_VOICE_EVIDENCE_HMAC_SECRET: SECRET,
  VOICE_EVIDENCE_MAX_AUDIO_BYTES: "1048576",
  VOICE_EVIDENCE_TIMEOUT_MS: "60000",
};
const PROTOCOL = "vyakti-voice-evidence/v1";
const RAW = Buffer.from("immutable private audio fixture");
const RAW_SHA = sha256Hex(RAW);
const ARTIFACT = "11111111-1111-4111-8111-111111111111";
let checks = 0;

function ok(name, condition) {
  assert.ok(condition, name);
  console.log(`ok ${++checks} - ${name}`);
}

function sign(...parts) {
  return createHmac("sha256", Buffer.from(SECRET, "base64url")).update(parts.join("\n")).digest("base64url");
}

function candidate(input, variant, transform = "model-revision") {
  const audio = Buffer.from(`derived-${variant}`);
  return {
    variant_key: variant,
    audio_base64: audio.toString("base64"),
    sha256: sha256Hex(audio),
    mime: "audio/wav",
    duration_ms: 1800,
    input_sha256: input.sha256,
    transform_name: "reviewed-model",
    transform_version: transform,
    parameters: { bounded: true },
    quality: { owner_review_required: true },
  };
}

const requests = [];
async function mockFetch(url, init) {
  const path = new URL(url).pathname;
  const headers = new Headers(init.headers);
  const requestBytes = Buffer.from(init.body);
  const requestHash = sha256Hex(requestBytes);
  const nonce = headers.get("x-vyakti-nonce");
  const expected = sign(PROTOCOL, "POST", path, headers.get("x-vyakti-timestamp"), nonce, requestHash);
  assert.equal(headers.get("x-vyakti-protocol"), PROTOCOL);
  assert.equal(headers.get("x-vyakti-content-sha256"), requestHash);
  assert.equal(headers.get("x-vyakti-signature"), expected);
  const request = JSON.parse(requestBytes);
  requests.push(request);
  assert.equal(JSON.stringify(request).includes("owner_user_id"), false);
  assert.equal(JSON.stringify(request).includes("replica_id"), false);
  assert.equal(JSON.stringify(request).includes("source_id"), false);
  const input = request.inputs[0];
  assert.equal(sha256Hex(Buffer.from(input.audio_base64, "base64")), input.sha256);
  let payload;
  if (request.operation === "diarize") payload = {
    segments: [{ start_ms: 0, end_ms: 1800, speaker_key: "cluster-1", confidence: 0.91, target_likelihood: 0.5, overlap: false }],
  };
  if (request.operation === "separate") payload = {
    candidates: [candidate(input, "speaker-1"), candidate(input, "speaker-2")],
  };
  if (request.operation === "enhance") payload = {
    candidates: [
      candidate(input, "input-1-identity-preserving", "deepfilternet3-pinned"),
      candidate(input, "input-1-noise-suppressing", "deepfilternet3-pinned"),
    ],
  };
  if (request.operation === "voice_quality") payload = {
    embeddings: [
      { input_key: input.input_key, family: "speechbrain-ecapa-voxceleb", vector: Array(192).fill(0.01), confidence: 0.88 },
      { input_key: input.input_key, family: "speechbrain-xvector-voxceleb", vector: Array(512).fill(0.02), confidence: 0.84 },
    ],
    confidence: 0.84,
    measurements: { behavioral_prosody_requires_transcript_alignment: true },
    quality: { held_out_cross_source_calibration_required: true },
  };
  const responseBytes = Buffer.from(canonicalJson(payload));
  return new Response(responseBytes, {
    status: 200,
    headers: { "X-Vyakti-Response-Signature": sign(PROTOCOL, "response", path, nonce, "200", sha256Hex(responseBytes)) },
  });
}

assert.throws(() => azureVoiceEvidenceConfig({}), /voice_evidence_origin_required/);
ok("production adapter refuses missing private service configuration", true);
assert.throws(() => azureVoiceEvidenceConfig({ ...ENV, AZURE_VOICE_EVIDENCE_ORIGIN: "http://voice-evidence.internal" }), /voice_evidence_origin_invalid/);
ok("evidence transport requires an exact HTTPS origin", true);
assert.throws(() => azureVoiceEvidenceConfig({ ...ENV, AZURE_VOICE_EVIDENCE_HMAC_SECRET: "short" }), /voice_evidence_hmac_secret_required/);
ok("evidence transport requires a 256-bit secret", true);

const resolveInput = async ({ input }) => ({
  mime: input.mime,
  byteSize: RAW.length,
  body: (async function* () { yield RAW.subarray(0, 7); yield RAW.subarray(7); })(),
});
const adapters = createAzureVoiceEvidenceAdapters({ env: ENV, resolveInput, fetchImpl: mockFetch });
const source = { mime: "audio/wav" };
const rawInput = { artifact_id: null, sha256: RAW_SHA, mime: "audio/wav", duration_ms: 1800 };
const derivedInput = { ...rawInput, artifact_id: ARTIFACT };

const diarization = await adapters.diarize.diarize({ source, inputs: [rawInput] });
ok("real diarization output remains explicitly target-unknown", diarization.segments[0].target_likelihood === 0.5);
const separated = await adapters.separate.separate({ source, inputs: [rawInput] });
ok("separation preserves both speaker candidates without guessing identity", separated.candidates.length === 2 && separated.candidates.every((item) => item.parent_artifact_id === null));
const enhanced = await adapters.enhance.enhance({ source, inputs: [derivedInput] });
ok("enhancement preserves both identity-limited and aggressive candidates", enhanced.candidates.length === 2 && enhanced.candidates.every((item) => item.parent_artifact_id === ARTIFACT));
const quality = await adapters.voice_quality.measure({ source, inputs: [derivedInput] });
ok("two independent speaker architectures cite the exact derived artifact", new Set(quality.embeddings.map((entry) => entry.family)).size === 2 && quality.embeddings.every((entry) => entry.artifact_id === ARTIFACT));
ok("the service receives no durable tenant or person identifier", requests.every((request) => !/owner|replica|source_id|person|provider/i.test(JSON.stringify(request))));

const badResolver = createAzureVoiceEvidenceAdapters({
  env: ENV,
  resolveInput: async () => ({ mime: "audio/wav", body: Buffer.from("tampered") }),
  fetchImpl: mockFetch,
});
await assert.rejects(badResolver.diarize.diarize({ source, inputs: [rawInput] }), /voice_evidence_input_integrity_mismatch/);
ok("private input bytes are rehashed before leaving the worker", true);

const forged = createAzureVoiceEvidenceAdapters({
  env: ENV,
  resolveInput,
  fetchImpl: async () => new Response("{}", { status: 200, headers: { "X-Vyakti-Response-Signature": "forged" } }),
});
await assert.rejects(forged.diarize.diarize({ source, inputs: [rawInput] }), /voice_evidence_response_signature_invalid/);
ok("forged model-service responses are rejected", true);

process.env.SUPABASE_URL = "https://storage.fixture.example";
process.env.SUPABASE_SERVICE_ROLE_KEY = Buffer.alloc(32, 19).toString("base64url");
const storedObjects = new Map();
const originalPath = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/cccccccc-cccc-4ccc-8ccc-cccccccccccc/original";
storedObjects.set(originalPath, { bytes: RAW, mime: "audio/wav" });
async function storageFetch(url, init = {}) {
  const parsed = new URL(url);
  assert.equal(parsed.origin, "https://storage.fixture.example");
  assert.equal(init.headers.Authorization.startsWith("Bearer "), true);
  const authenticated = "/storage/v1/object/authenticated/vyakti-replica-private/";
  const upload = "/storage/v1/object/vyakti-replica-private/";
  if (parsed.pathname.startsWith(authenticated)) {
    const key = decodeURIComponent(parsed.pathname.slice(authenticated.length));
    const object = storedObjects.get(key);
    return object
      ? new Response(object.bytes, { status: 200, headers: { "Content-Type": object.mime, "Content-Length": String(object.bytes.length) } })
      : new Response("missing", { status: 404 });
  }
  if (parsed.pathname.startsWith(upload) && init.method === "POST") {
    const key = decodeURIComponent(parsed.pathname.slice(upload.length));
    if (storedObjects.has(key)) return new Response("exists", { status: 409 });
    storedObjects.set(key, { bytes: Buffer.from(init.body), mime: init.headers["Content-Type"] });
    return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
  }
  throw new Error(`unexpected storage request ${init.method || "GET"} ${parsed.pathname}`);
}
const processingStorage = createReplicaProcessingStorage({ fetchImpl: storageFetch, maxBytes: 1024 * 1024 });
const storageSource = {
  owner_user_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  replica_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  source_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  storage_bucket: "vyakti-replica-private",
};
const loaded = await processingStorage.resolveInput({ source: storageSource, input: { object_path: originalPath, sha256: RAW_SHA, mime: "audio/wav" } });
ok("production resolver rehashes authenticated private bytes", loaded.byteSize === RAW.length && sha256Hex(loaded.body) === RAW_SHA);
const derivedPath = `${storageSource.owner_user_id}/${storageSource.replica_id}/${storageSource.source_id}/derived/pinned/enhance-${ARTIFACT}`;
const derived = Buffer.from("derived immutable audio");
const firstWrite = await processingStorage.artifactStore.writeImmutable({
  bucket: "vyakti-replica-private", objectPath: derivedPath, body: derived, mime: "audio/wav",
  expectedSha256: sha256Hex(derived), ifNoneMatch: "*",
});
const retryWrite = await processingStorage.artifactStore.writeImmutable({
  bucket: "vyakti-replica-private", objectPath: derivedPath, body: derived, mime: "audio/wav",
  expectedSha256: sha256Hex(derived), ifNoneMatch: "*",
});
ok("create-only private artifact retries succeed only when bytes are identical", firstWrite.sha256 === retryWrite.sha256 && retryWrite.byteSize === derived.length);
await assert.rejects(processingStorage.artifactStore.writeImmutable({
  bucket: "vyakti-replica-private", objectPath: derivedPath, body: Buffer.from("different"), mime: "audio/wav",
  expectedSha256: sha256Hex(Buffer.from("different")), ifNoneMatch: "*",
}), /immutable_artifact_collision/);
ok("an immutable path collision cannot replace derived evidence", true);
await assert.rejects(processingStorage.resolveInput({
  source: storageSource,
  input: { object_path: `other/${storageSource.replica_id}/${storageSource.source_id}/original`, sha256: RAW_SHA, mime: "audio/wav" },
}), /processing_storage_path_out_of_scope/);
ok("private reads cannot cross the owner-replica-source path", true);

const app = readFileSync(join(ROOT, "services/voice-evidence/app.py"), "utf8");
const fetcher = readFileSync(join(ROOT, "services/voice-evidence/fetch_models.py"), "utf8");
const docker = readFileSync(join(ROOT, "services/voice-evidence/Dockerfile"), "utf8");
const requirements = readFileSync(join(ROOT, "services/voice-evidence/requirements.txt"), "utf8");
ok("both public speaker models and SepFormer are immutable commit-pinned", /0f99f2d0ebe89ac095bcc5903c4dd8f72b367286/.test(fetcher) && /56895a2df401be4150a159f3a1c653f00051d477/.test(fetcher) && /21a5b500c6f52fddc387c5d9e5fb13ffd6f039c5/.test(fetcher));
ok("DeepFilterNet3 artifact is exact-digest pinned", /49c52edc8947ae1f9bf50d81530beaf3a2c3245aeaf34b6f31ff535cd22284d2/.test(fetcher));
ok("service uses two architecturally distinct speaker embeddings", /app\.state\.ecapa/.test(app) && /app\.state\.xvector/.test(app));
ok("service refuses to infer target identity without an anchor", /target_likelihood.*0\.5/.test(app) && /target_anchor_used.*False/.test(app));
ok("raw identity is protected by dual enhancement candidates", /identity-preserving/.test(app) && /noise-suppressing/.test(app));
ok("runtime model networking is disabled and container is non-root", /HF_HUB_OFFLINE=1/.test(docker) && /USER 10002:10002/.test(docker) && /--no-access-log/.test(docker));
ok("open-model runtime packages are exact-version pinned", ["speechbrain==1.1.0", "silero-vad==6.2.1", "deepfilternet==0.5.6"].every((entry) => requirements.includes(entry)));
ok("service code has no request-body or audio logging path", !/print\(|logger\.|logging\.|access_log=True/.test(app));

console.log(`\n${checks} voice evidence checks passed`);
