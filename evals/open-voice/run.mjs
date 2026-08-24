import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  OPEN_CHATTERBOX_DISCLOSURE,
  OPEN_CHATTERBOX_MODEL_COMMITMENT,
  createOpenChatterboxPreviewProvider,
  openChatterboxConfig,
} from "../../api/_voice/providers/open-chatterbox-preview.js";
import { assertVoicePreviewAuthorization } from "../../api/_provenance/contracts.js";
import {
  beginOwnedVoicePreview,
  createNeonVoicePreviewLedger,
  voicePreviewMatchedSeed,
} from "../../api/_replica-voice-preview.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SECRET = "ab".repeat(32);
const ORIGIN = "https://open-voice.internal.example";
const IDS = {
  owner: "11111111-1111-4111-8111-111111111111",
  replica: "22222222-2222-4222-8222-222222222222",
  generation: "33333333-3333-4333-8333-333333333333",
  artifact: "44444444-4444-4444-8444-444444444444",
  source: "55555555-5555-4555-8555-555555555555",
  consent: "66666666-6666-4666-8666-666666666666",
};
let passed = 0;
function ok(name, condition) {
  assert.ok(condition, name);
  passed++;
  console.log(`  PASS ${name}`);
}

function wav(seconds = 5) {
  const samples = 24_000 * seconds;
  const pcm = Buffer.alloc(samples * 2);
  for (let index = 0; index < samples; index++) {
    pcm.writeInt16LE(Math.round(Math.sin(index * 2 * Math.PI * 220 / 24_000) * 4_000), index * 2);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0); header.writeUInt32LE(36 + pcm.length, 4); header.write("WAVE", 8);
  header.write("fmt ", 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22); header.writeUInt32LE(24_000, 24); header.writeUInt32LE(48_000, 28);
  header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

const base64url = (bytes) => Buffer.from(bytes).toString("base64url");
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const sign = (secret, values) => createHmac("sha256", secret).update(values.join("\n")).digest("base64url");

function signedResponse(url, init, mutate = (value) => value) {
  const request = JSON.parse(Buffer.from(init.body).toString("utf8"));
  const pcm = Buffer.alloc(48_000, 7);
  const result = mutate({
    request_id: request.request_id,
    audio_base64: pcm.toString("base64"),
    output_sha256: digest(pcm),
    sample_rate: 24_000,
    channels: 1,
    encoding: "pcm_s16le",
    duration_ms: 1_000,
    elapsed_ms: 500,
    real_time_factor: 0.5,
    reference_sha256: request.reference_sha256,
    reference_duration_ms: 5_000,
    model: "chatterbox-multilingual-v3",
    model_commitment: OPEN_CHATTERBOX_MODEL_COMMITMENT,
    perth_watermark_verified: true,
    perth_score: 0.99,
  });
  const body = Buffer.from(JSON.stringify(result));
  const path = new URL(url).pathname;
  const responseSignature = sign(Buffer.from(SECRET, "hex"), [
    "vyakti-open-voice/v1", "response", path, init.headers["X-Vyakti-Nonce"], "200", digest(body),
  ]);
  return { request, response: new Response(body, { status: 200, headers: { "X-Vyakti-Response-Signature": responseSignature } }) };
}

assert.throws(() => openChatterboxConfig({ AZURE_OPEN_VOICE_ORIGIN: "http://unsafe", OPEN_VOICE_HMAC_SECRET: SECRET }), /open_voice_origin_invalid/);
assert.throws(() => openChatterboxConfig({ AZURE_OPEN_VOICE_ORIGIN: ORIGIN, OPEN_VOICE_HMAC_SECRET: "short" }), /open_voice_hmac_secret_required/);
ok("configuration requires HTTPS and a 256-bit transport secret", true);

const reference = wav();
let observed;
const provider = createOpenChatterboxPreviewProvider({
  env: { AZURE_OPEN_VOICE_ORIGIN: ORIGIN, OPEN_VOICE_HMAC_SECRET: SECRET },
  fetchImpl: async (url, init) => {
    const bodyHash = digest(init.body);
    const expected = sign(Buffer.from(SECRET, "hex"), [
      "vyakti-open-voice/v1", "POST", "/v1/synthesize", init.headers["X-Vyakti-Timestamp"],
      init.headers["X-Vyakti-Nonce"], bodyHash,
    ]);
    assert.equal(init.headers["X-Vyakti-Content-SHA256"], bodyHash);
    assert.equal(init.headers["X-Vyakti-Signature"], expected);
    observed = signedResponse(url, init);
    return observed.response;
  },
});
const result = await provider.synthesizePreview({
  text: "Namaste, main tumhari private calibration preview hoon.",
  languageId: "hi",
  seed: 42,
  reference: { bytes: reference, sha256: digest(reference), durationMs: 5_000 },
  style: { exaggeration: 0.6, cfgWeight: 0.4, temperature: 0.75 },
});
ok("every service request is exact-body HMAC authenticated", Boolean(observed));
ok("the private service receives no tenant or replica identifier", !Object.keys(observed.request).some((key) => /(owner|replica|email|provider_ref)/i.test(key)));
ok("the exact audible synthetic disclosure is rendered before inference", observed.request.text.startsWith(`${OPEN_CHATTERBOX_DISCLOSURE} `));
ok("reference bytes are content-addressed and bounded", observed.request.reference_sha256 === digest(reference));
ok("Hindi and deterministic evaluation controls cross the contract", observed.request.language_id === "hi" && observed.request.seed === 42);
const chunks = [];
for await (const chunk of result.stream) chunks.push(Buffer.from(chunk));
ok("verified output is normalized to 24 kHz mono PCM", Buffer.concat(chunks).length === 48_000 && result.format.sampleRate === 24_000);
ok("model, reference, output, latency and PerTh evidence remain bound", result.receipt.modelCommitment === OPEN_CHATTERBOX_MODEL_COMMITMENT && result.receipt.perthWatermarkVerified && result.receipt.realTimeFactor === 0.5);

const badSignature = createOpenChatterboxPreviewProvider({
  env: { AZURE_OPEN_VOICE_ORIGIN: ORIGIN, OPEN_VOICE_HMAC_SECRET: SECRET },
  fetchImpl: async (url, init) => {
    const { response } = signedResponse(url, init);
    return new Response(await response.arrayBuffer(), { status: 200, headers: { "X-Vyakti-Response-Signature": base64url(Buffer.alloc(32, 3)) } });
  },
});
await assert.rejects(badSignature.synthesizePreview({ text: "Private preview.", languageId: "en", seed: 1, reference: { bytes: reference } }), /open_voice_response_signature_invalid/);
ok("unsigned or tampered service responses fail closed", true);

const wrongModel = createOpenChatterboxPreviewProvider({
  env: { AZURE_OPEN_VOICE_ORIGIN: ORIGIN, OPEN_VOICE_HMAC_SECRET: SECRET },
  fetchImpl: async (url, init) => signedResponse(url, init, (value) => ({ ...value, model_commitment: "0".repeat(64) })).response,
});
await assert.rejects(wrongModel.synthesizePreview({ text: "Private preview.", languageId: "en", seed: 1, reference: { bytes: reference } }), /open_voice_response_binding_invalid/);
ok("an unpinned or swapped model response fails closed", true);

const wrongEvidence = createOpenChatterboxPreviewProvider({
  env: { AZURE_OPEN_VOICE_ORIGIN: ORIGIN, OPEN_VOICE_HMAC_SECRET: SECRET },
  fetchImpl: async (url, init) => signedResponse(url, init, (value) => ({ ...value, reference_duration_ms: 5_001, perth_score: 0.49 })).response,
});
await assert.rejects(wrongEvidence.synthesizePreview({ text: "Private preview.", languageId: "en", seed: 1, reference: { bytes: reference } }), /open_voice_response_binding_invalid/);
ok("misbound reference duration or weak watermark evidence fails closed", true);

const previewAuthorization = {
  request: { generationId: IDS.generation, replicaId: IDS.replica, ownerUserId: IDS.owner, channel: "studio_preview", purpose: "voice_preview", policyVersion: "vyakti-replica-output-v1", traceId: "preview_12345678" },
  replica: { replica_id: IDS.replica, owner_user_id: IDS.owner, subject_mode: "self", lifecycle: "calibrating", policy_version: "replica-self-v1", age_verified_at: "2026-08-01T00:00:00.000Z", identity_verified_at: "2026-08-01T00:00:00.000Z", liveness_verified_at: "2026-08-01T00:00:00.000Z", identity_expires_at: "2030-01-01T00:00:00.000Z" },
  inferenceConsent: { consent_id: IDS.consent, replica_id: IDS.replica, owner_user_id: IDS.owner, scope: "inference", policy_version: "replica-self-v1", granted_at: "2026-08-01T00:00:00.000Z", expires_at: "2030-01-01T00:00:00.000Z", revoked_at: null },
  voiceGenome: { replica_id: IDS.replica, version: 4, status: "draft" },
  previewArtifact: { artifact_id: IDS.artifact, replica_id: IDS.replica, owner_user_id: IDS.owner, source_id: IDS.source, stage: "enhance", selection_decision: "selected", source_state: "ready", contains_third_parties: false, sha256: "a".repeat(64) },
};
const authorization = assertVoicePreviewAuthorization(previewAuthorization, new Date("2026-08-25T00:00:00.000Z"));
ok("draft preview authorization is owner, identity, consent, genome and artifact bound", authorization.voiceProfileId === IDS.artifact && authorization.genomeVersion === 4 && authorization.profileVersion === 0);
assert.throws(() => assertVoicePreviewAuthorization({ ...previewAuthorization, previewArtifact: { ...previewAuthorization.previewArtifact, selection_decision: "superseded" } }, new Date("2026-08-25T00:00:00.000Z")), /preview_artifact_not_eligible/);
assert.throws(() => assertVoicePreviewAuthorization({ ...previewAuthorization, voiceGenome: { ...previewAuthorization.voiceGenome, status: "approved" } }, new Date("2026-08-25T00:00:00.000Z")), /draft_voice_genome_required/);
ok("superseded artifacts and non-draft genomes cannot enter the preview corridor", true);

const matchedSeedInput = {
  replicaId: IDS.replica,
  genomeVersion: 4,
  languageId: "hi",
  textHash: "9".repeat(64),
};
const matchedSeed = voicePreviewMatchedSeed(matchedSeedInput);
ok("matched trials derive one positive seed from identity, genome, language and prompt", matchedSeed > 0 && matchedSeed === voicePreviewMatchedSeed(matchedSeedInput));
ok("changing the committed prompt changes the deterministic trial seed", matchedSeed !== voicePreviewMatchedSeed({ ...matchedSeedInput, textHash: "8".repeat(64) }));

let beginSql = "";
const begun = await beginOwnedVoicePreview(async (sql) => {
  beginSql = sql;
  return [{
    generation_id: IDS.generation, replica_id: IDS.replica, owner_user_id: IDS.owner,
    genome_version: 4, channel: "studio_preview", purpose: "voice_preview", policy_version: "vyakti-replica-output-v1", trace_id: "preview_12345678",
    preview_model_commitment: OPEN_CHATTERBOX_MODEL_COMMITMENT,
    subject_mode: "self", lifecycle: "calibrating", replica_policy_version: "replica-self-v1",
    age_verified_at: "2026-08-01T00:00:00.000Z", identity_verified_at: "2026-08-01T00:00:00.000Z", liveness_verified_at: "2026-08-01T00:00:00.000Z", identity_expires_at: "2030-01-01T00:00:00.000Z",
    artifact_id: IDS.artifact, source_id: IDS.source, object_path: `${IDS.owner}/${IDS.replica}/${IDS.source}/derived/enhance.wav`, mime: "audio/wav", byte_size: reference.length, duration_ms: 5_000, sha256: digest(reference), stage: "enhance", selection_decision: "selected", source_state: "ready", contains_third_parties: false, genome_status: "draft",
    consent_id: IDS.consent, consent_scope: "inference", consent_policy_version: "replica-self-v1", consent_granted_at: "2026-08-01T00:00:00.000Z", consent_expires_at: "2030-01-01T00:00:00.000Z", consent_revoked_at: null,
  }];
}, IDS.owner, {
  replica_id: IDS.replica,
  genome_version: 4,
  trace_id: "preview_12345678",
  language_id: "hi",
  text_hash: "9".repeat(64),
  style_key: "balanced",
});
ok("authorization is atomically inserted from the exact current draft and selected artifact", begun.reference.artifactId === IDS.artifact && /vg\.status='draft'/.test(beginSql) && /selected\.decision='selected'/.test(beginSql));
ok("the generation records the matched-trial seed used by synthesis", begun.previewSeed === matchedSeed && /preview_seed/.test(beginSql));
ok("preview issuance rechecks current inference, biometric and training grants", /scope='inference'/.test(beginSql) && /scope='biometric'/.test(beginSql) && /scope='training'/.test(beginSql));
ok("every preview consent must match the current replica policy", (beginSql.match(/policy_version=r\.policy_version/g) || []).length >= 2 && /c\.policy_version=\$7/.test(beginSql));

const ledgerSql = [];
const ledger = createNeonVoicePreviewLedger(async (sql) => { ledgerSql.push(sql); return [{ generation_id: IDS.generation, sequence: 0 }]; });
await ledger.open({ generationId: IDS.generation, replicaId: IDS.replica, ownerUserId: IDS.owner, disclosureScheme: "audible-prefix-v1", watermarkAlgorithm: "audioseal", provenanceStandard: "c2pa-2.4", watermarkTokenHash: "b".repeat(64) });
await ledger.appendSegment({ authorization, receipt: { sequence: 0, byte_offset: 0, byte_length: 2, segment_sha256: "c".repeat(64), previous_chain_sha256: "0".repeat(64), chain_sha256: "d".repeat(64), signature_algorithm: "ES256", signer_key_id: "key", chain_signature: "signature".repeat(8), issued_at: "2026-08-25T00:00:00.000Z" } });
await ledger.seal({ authorization, receipt: { envelope_sha256: "e".repeat(64), replica_commitment: "f".repeat(64), policy_version: "vyakti-replica-output-v1", channel: "studio_preview", disclosure_scheme: "audible-prefix-v1", disclosure_text_hash: "1".repeat(64), watermark_algorithm: "audioseal", watermark_token_hash: "2".repeat(64), detector_policy_hash: "3".repeat(64), provenance_standard: "c2pa-2.4", manifest_location: "external", signature_algorithm: "ES256", signer_key_id: "key", envelope_signature: "signature".repeat(8), issued_at: "2026-08-25T00:00:00.000Z" }, envelopeCanonical: JSON.stringify({ receipt: "x".repeat(180) }), audioHash: "4".repeat(64), watermarkTokenHash: "2".repeat(64), manifestHash: "5".repeat(64), segmentCount: 1, finalChainSha256: "6".repeat(64), sealedAt: "2026-08-25T00:00:00.000Z" });
ok("every protected preview segment rechecks revocation and latest artifact selection", ledgerSql.length === 3 && ledgerSql.every((sql) => /scope='inference'/.test(sql) && /newer\.created_at/.test(sql)));
ok("draft previews never depend on or mint an active runtime capability", ledgerSql.every((sql) => !/vy_replica_runtime_capability/.test(sql)));

const app = readFileSync(join(ROOT, "services/open-voice-runtime/app.py"), "utf8");
const docker = readFileSync(join(ROOT, "services/open-voice-runtime/Dockerfile"), "utf8");
const brokerDocker = readFileSync(join(ROOT, "services/open-voice-runtime/Dockerfile.broker"), "utf8");
const broker = readFileSync(join(ROOT, "services/open-voice-runtime/broker.py"), "utf8");
const fetchModels = readFileSync(join(ROOT, "services/open-voice-runtime/fetch_models.py"), "utf8");
const infra = readFileSync(join(ROOT, "services/open-voice-runtime/infra/main.bicep"), "utf8");
const migration = readFileSync(join(ROOT, "db/migrations/045_replica_voice_preview.sql"), "utf8");
const schema = readFileSync(join(ROOT, "db/schema.sql"), "utf8");
const handler = readFileSync(join(ROOT, "api/replica-voice-preview.js"), "utf8");
const studio = readFileSync(join(ROOT, "src/studio/VoicePreviewLab.tsx"), "utf8");
ok("runtime source and checkpoint revisions are immutable", app.includes("5de7a54aa4e5e2baadb0182dde554908b48b85c2") && fetchModels.includes("5bb1f6ee58e50c3b8d408bc82a6d3740c2db6e18") && /FROM .*@sha256:[0-9a-f]{64}/.test(docker) && /FROM .*@sha256:[0-9a-f]{64}/.test(brokerDocker));
ok("runtime has no model-network dependency", docker.includes("HF_HUB_OFFLINE=1") && docker.includes("TRANSFORMERS_OFFLINE=1") && fetchModels.includes("revision=MODEL_REVISION"));
ok("the service requires CUDA and verifies PerTh before returning audio", /open_voice_cuda_required/.test(app) && /perth_watermark_verification_failed/.test(app));
ok("request logging is disabled and audio uses an auto-deleted temporary file", docker.includes("--no-access-log") && app.includes("NamedTemporaryFile"));
ok("Azure GPU deployment is private, digest-pinned, scale-to-zero and single-concurrency", /external:\s*false/.test(infra) && /contains\(image, '@sha256:'\)/.test(infra) && /minReplicas:\s*0/.test(infra) && /maxReplicas:\s*1/.test(infra) && /concurrentRequests:\s*'1'/.test(infra));
ok("a scale-to-zero CPU admission broker protects the private GPU from internet-triggered spend", /resource broker/.test(infra) && /external:\s*true/.test(infra) && /workloadProfileName:\s*'Consumption'/.test(infra) && /OPEN_VOICE_RUNTIME_ORIGIN/.test(infra) && broker.indexOf("body = await _admit(request)") < broker.indexOf("client.post"));
ok("admission and GPU responses remain end-to-end HMAC bound", /runtime_response_signature_invalid/.test(broker) && /FORWARDED_HEADERS/.test(broker) && brokerDocker.includes("--no-access-log"));
ok("preview rows are structurally distinct from qualified runtime generations", /purpose='voice_preview'/.test(migration) && /voice_profile_id is null/.test(migration) && /preview_model_commitment~/.test(migration));
ok("canonical schema carries the exact preview migration", schema.includes("vy_replica_generation_preview_shape") && schema.includes("vy_replica_generation_preview_artifact_fk"));
ok("the owner endpoint verifies private reference bytes before synthesis", /readPrivateReplicaObject/.test(handler) && /voice_preview_reference_binding_failed/.test(handler));
ok("no browser byte is returned before PerTh, AudioSeal, C2PA and ledger completion", /assertSynthesisResult/.test(handler) && /protectReplicaStream/.test(handler) && /await protectedAudio\.completion/.test(handler));
ok("Studio presents real loading, empty, error and protected-audio states", /generating/.test(studio) && /No draft can speak yet/.test(studio) && /role="alert"/.test(studio) && /<audio controls/.test(studio));
ok("new Studio copy contains no em dash or en dash", !/[—–]/.test(studio));

execFileSync("python", ["-m", "py_compile", "services/open-voice-runtime/app.py", "services/open-voice-runtime/broker.py", "services/open-voice-runtime/fetch_models.py"], { cwd: ROOT, stdio: "pipe" });
ok("Python service sources compile", true);

console.log(`\nOpen voice runtime: ${passed} checks passed.`);
