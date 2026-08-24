import { createHash } from "node:crypto";
import { SYNTHETIC_AUDIO_DISCLOSURE, VOICE_PCM_FORMAT } from "../_voice/contracts.js";
import { REPLICA_POLICY_VERSION } from "../_replica.js";

export const PROVENANCE_POLICY = "vyakti-replica-output-v1";
export const C2PA_STANDARD = "c2pa-2.4";
export const DISCLOSURE_SCHEME = "audible-prefix-v1";
export const PROVENANCE_SEGMENT_BYTES = 11_520; // 240 ms of PCM s16le/24 kHz/mono
export const EMPTY_CHAIN_SHA256 = "0".repeat(64);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/;
const CHANNELS = new Set(["studio_preview", "private_chat", "private_call"]);
const PURPOSES = new Set(["calibration", "private_conversation"]);
const REQUIRED_QUALIFICATION_SUITES = Object.freeze([
  "identity_fidelity",
  "noisy_robustness",
  "behavior",
  "relationship",
  "privacy",
  "abuse",
  "provenance",
]);

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function canonical(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && Object.getPrototypeOf(value) === Object.prototype) {
    const keys = Object.keys(value).sort();
    if (keys.some((key) => value[key] === undefined)) fail("undefined_canonical_value");
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  fail("unsupported_canonical_value");
}

export function canonicalJson(value) {
  return canonical(value);
}

export function sha256Hex(value) {
  const bytes = typeof value === "string" || ArrayBuffer.isView(value) ? value : canonicalJson(value);
  return createHash("sha256").update(bytes).digest("hex");
}

function sameUuid(left, right, code) {
  if (String(left).toLowerCase() !== String(right).toLowerCase()) fail(code);
}

function validDate(value) {
  const millis = Date.parse(String(value || ""));
  return Number.isFinite(millis) ? millis : null;
}

function assertHash(value, code) {
  if (!SHA256.test(String(value || ""))) fail(code);
}

export function assertGenerationAuthorization(input, now = new Date()) {
  const request = input?.request;
  const replica = input?.replica;
  const consent = input?.inferenceConsent;
  const voice = input?.voiceProfile;
  const genome = input?.voiceGenome;
  const profile = input?.personProfile;
  const calibration = input?.calibration;
  const qualification = input?.qualification;
  const nowMs = now instanceof Date ? now.getTime() : validDate(now);

  if (!request || !UUID.test(String(request.generationId || ""))) fail("invalid_generation_id");
  if (!UUID.test(String(request.replicaId || "")) || !UUID.test(String(request.ownerUserId || "")))
    fail("invalid_generation_owner");
  if (!CHANNELS.has(request.channel)) fail("channel_not_allowed");
  if (!PURPOSES.has(request.purpose)) fail("purpose_not_allowed");
  if (request.policyVersion !== PROVENANCE_POLICY) fail("generation_policy_mismatch");
  if (!request.traceId || String(request.traceId).length < 8) fail("trace_id_required");
  if (!Number.isFinite(nowMs)) fail("invalid_authorization_time");

  sameUuid(replica?.replica_id, request.replicaId, "replica_binding_mismatch");
  sameUuid(replica?.owner_user_id, request.ownerUserId, "owner_binding_mismatch");
  if (replica?.subject_mode !== "self") fail("self_replica_only");
  if (replica?.lifecycle !== "active") fail("replica_not_active");
  // The replica control policy and the output-protection policy govern
  // different receipts. Conflating them made activation impossible: replica
  // rows are created under replica-self-v1 while generation requests are
  // intentionally signed under vyakti-replica-output-v1.
  if (replica?.policy_version !== REPLICA_POLICY_VERSION) fail("replica_policy_mismatch");
  if (!validDate(replica?.age_verified_at) || !validDate(replica?.identity_verified_at) || !validDate(replica?.liveness_verified_at))
    fail("identity_verification_incomplete");
  if (!validDate(replica?.identity_expires_at) || new Date(replica.identity_expires_at).getTime() <= Date.now())
    fail("identity_evidence_expired");

  sameUuid(consent?.replica_id, request.replicaId, "consent_binding_mismatch");
  sameUuid(consent?.owner_user_id, request.ownerUserId, "consent_owner_mismatch");
  if (consent?.scope !== "inference" || consent?.revoked_at) fail("inference_consent_inactive");
  if (consent?.policy_version !== REPLICA_POLICY_VERSION) fail("consent_policy_mismatch");
  const expiresAt = consent?.expires_at ? validDate(consent.expires_at) : null;
  if (consent?.expires_at && (!expiresAt || expiresAt <= nowMs)) fail("inference_consent_expired");

  if (!UUID.test(String(voice?.voice_profile_id || ""))) fail("invalid_voice_profile");
  sameUuid(voice?.replica_id, request.replicaId, "voice_binding_mismatch");
  if (voice?.status !== "ready") fail("voice_not_ready");
  sameUuid(genome?.replica_id, request.replicaId, "genome_binding_mismatch");
  if (!Number.isInteger(genome?.version) || genome.version !== voice?.genome_version || genome.status !== "approved")
    fail("voice_genome_not_approved");
  sameUuid(profile?.replica_id, request.replicaId, "profile_binding_mismatch");
  if (!Number.isInteger(profile?.version) || profile.status !== "approved") fail("person_profile_not_approved");
  sameUuid(calibration?.replica_id, request.replicaId, "calibration_binding_mismatch");
  if (!Number.isInteger(calibration?.version) || calibration.status !== "approved" || calibration.profile_version !== profile.version)
    fail("calibration_not_approved");

  const passed = new Set(qualification?.passedSuites || []);
  if (qualification?.verdict !== "pass" || REQUIRED_QUALIFICATION_SUITES.some((suite) => !passed.has(suite)))
    fail("qualification_incomplete");

  return {
    generationId: request.generationId.toLowerCase(),
    replicaId: request.replicaId.toLowerCase(),
    ownerUserId: request.ownerUserId.toLowerCase(),
    voiceProfileId: voice.voice_profile_id.toLowerCase(),
    genomeVersion: genome.version,
    profileVersion: profile.version,
    calibrationVersion: calibration.version,
    channel: request.channel,
    purpose: request.purpose,
    policyVersion: request.policyVersion,
    traceId: String(request.traceId),
  };
}

export function assertProtectionAdapters(adapters, { allowTestAdapters = false } = {}) {
  const required = {
    disclosure: ["prepend"],
    watermark: ["embed"],
    contentCredentials: ["createManifest"],
    signer: ["sign"],
    ledger: ["open", "appendSegment", "seal", "abort"],
    tokenIssuer: ["issue"],
    replicaCommitter: ["commit"],
  };
  for (const [name, methods] of Object.entries(required)) {
    const adapter = adapters?.[name];
    if (!adapter || typeof adapter.name !== "string" || !adapter.name) fail(`${name}_adapter_required`);
    if (!allowTestAdapters && (adapter.testOnly === true || /fake|test/i.test(adapter.name))) fail("test_adapter_forbidden");
    for (const method of methods) if (typeof adapter[method] !== "function") fail(`${name}_${method}_required`);
  }
  return adapters;
}

export function assertByteStream(stream) {
  if (!stream || typeof stream[Symbol.asyncIterator] !== "function") fail("async_byte_stream_required");
  return stream;
}

export function assertPcmFormat(format) {
  if (!format || format.contentType !== VOICE_PCM_FORMAT.contentType || format.encoding !== VOICE_PCM_FORMAT.encoding ||
      format.sampleRate !== VOICE_PCM_FORMAT.sampleRate || format.channels !== VOICE_PCM_FORMAT.channels) {
    fail("unsupported_provenance_audio_format");
  }
  return format;
}

export function assertDisclosureProof(proof) {
  if (proof?.scheme !== DISCLOSURE_SCHEME) fail("audible_disclosure_missing");
  if (proof?.text !== SYNTHETIC_AUDIO_DISCLOSURE) fail("audible_disclosure_text_mismatch");
  if (proof?.textHash !== sha256Hex(SYNTHETIC_AUDIO_DISCLOSURE)) fail("audible_disclosure_hash_mismatch");
  if (!proof?.renderer || proof?.embedded !== true) fail("audible_disclosure_unproven");
  return proof;
}

export function assertWatermarkProof(proof, expectedTokenHash) {
  if (!proof?.algorithm || proof?.embedded !== true || proof?.streaming !== true) fail("streaming_watermark_missing");
  assertHash(proof.tokenHash, "invalid_watermark_token_hash");
  if (proof.tokenHash !== expectedTokenHash) fail("watermark_token_mismatch");
  assertHash(proof.detectorPolicyHash, "invalid_detector_policy_hash");
  return proof;
}

export function assertManifestProof(proof, audioHash) {
  if (proof?.standard !== C2PA_STANDARD) fail("c2pa_manifest_missing");
  if (!new Set(["embedded", "external"]).has(proof?.location)) fail("invalid_manifest_location");
  if (proof?.assetHash !== audioHash) fail("manifest_asset_binding_mismatch");
  assertHash(proof.manifestHash, "invalid_manifest_hash");
  if (!proof?.signerKeyId || !proof?.signatureAlgorithm || !proof?.signature) fail("manifest_signature_missing");
  return proof;
}

export function createSegmentEnvelope({ authorization, sequence, byteOffset, bytes, previousChainSha256, issuedAt }) {
  if (!Number.isInteger(sequence) || sequence < 0) fail("invalid_segment_sequence");
  if (!Number.isInteger(byteOffset) || byteOffset < 0) fail("invalid_segment_offset");
  if (!(bytes instanceof Uint8Array) || !bytes.byteLength) fail("invalid_segment_bytes");
  assertHash(previousChainSha256, "invalid_previous_chain_hash");
  if (!validDate(issuedAt)) fail("invalid_segment_time");
  const segmentSha256 = sha256Hex(bytes);
  const unsigned = Object.freeze({
    schema: "vyakti.generation-segment.v1",
    generationId: authorization.generationId,
    policyVersion: authorization.policyVersion,
    sequence,
    byteOffset,
    byteLength: bytes.byteLength,
    segmentSha256,
    previousChainSha256,
    issuedAt: new Date(issuedAt).toISOString(),
  });
  return Object.freeze({ ...unsigned, chainSha256: sha256Hex(unsigned) });
}

export function publicSegmentReceipt(segment, signature) {
  if (!signature?.algorithm || !signature?.keyId || !signature?.signature || signature.signature.length < 32)
    fail("segment_signature_missing");
  return Object.freeze({
    generation_id: segment.generationId,
    sequence: segment.sequence,
    byte_offset: segment.byteOffset,
    byte_length: segment.byteLength,
    segment_sha256: segment.segmentSha256,
    previous_chain_sha256: segment.previousChainSha256,
    chain_sha256: segment.chainSha256,
    signature_algorithm: signature.algorithm,
    signer_key_id: signature.keyId,
    chain_signature: signature.signature,
    issued_at: segment.issuedAt,
  });
}

export function createUnsignedEnvelope({ authorization, replicaCommitment, audioHash, segmentCount, finalChainSha256, disclosure, watermark, manifest, issuedAt }) {
  assertHash(replicaCommitment, "invalid_replica_commitment");
  assertHash(audioHash, "invalid_audio_hash");
  assertDisclosureProof(disclosure);
  assertWatermarkProof(watermark, watermark.tokenHash);
  assertManifestProof(manifest, audioHash);
  if (!Number.isInteger(segmentCount) || segmentCount < 1) fail("invalid_segment_count");
  assertHash(finalChainSha256, "invalid_final_chain_hash");
  if (!validDate(issuedAt)) fail("invalid_receipt_time");
  return Object.freeze({
    schema: "vyakti.generation-receipt.v1",
    generationId: authorization.generationId,
    replicaCommitment,
    policyVersion: authorization.policyVersion,
    channel: authorization.channel,
    disclosure: {
      scheme: disclosure.scheme,
      textHash: disclosure.textHash,
      renderer: disclosure.renderer,
    },
    watermark: {
      algorithm: watermark.algorithm,
      version: watermark.version,
      tokenHash: watermark.tokenHash,
      detectorPolicyHash: watermark.detectorPolicyHash,
    },
    contentCredential: {
      standard: manifest.standard,
      location: manifest.location,
      manifestHash: manifest.manifestHash,
      signerKeyId: manifest.signerKeyId,
      signatureAlgorithm: manifest.signatureAlgorithm,
      signature: manifest.signature,
    },
    audioHash,
    transportChain: { segmentCount, finalChainSha256 },
    issuedAt: new Date(issuedAt).toISOString(),
  });
}

export function publicReceiptFromEnvelope(envelope, ledgerSignature) {
  const envelopeSha256 = sha256Hex(envelope);
  if (!ledgerSignature?.algorithm || !ledgerSignature?.keyId || !ledgerSignature?.signature || ledgerSignature.signature.length < 32)
    fail("ledger_signature_missing");
  return Object.freeze({
    generation_id: envelope.generationId,
    replica_commitment: envelope.replicaCommitment,
    policy_version: envelope.policyVersion,
    channel: envelope.channel,
    disclosure_scheme: envelope.disclosure.scheme,
    disclosure_text_hash: envelope.disclosure.textHash,
    watermark_algorithm: `${envelope.watermark.algorithm}@${envelope.watermark.version}`,
    watermark_token_hash: envelope.watermark.tokenHash,
    detector_policy_hash: envelope.watermark.detectorPolicyHash,
    provenance_standard: envelope.contentCredential.standard,
    manifest_location: envelope.contentCredential.location,
    manifest_sha256: envelope.contentCredential.manifestHash,
    audio_sha256: envelope.audioHash,
    segment_count: envelope.transportChain.segmentCount,
    final_chain_sha256: envelope.transportChain.finalChainSha256,
    envelope_sha256: envelopeSha256,
    signature_algorithm: ledgerSignature.algorithm,
    signer_key_id: ledgerSignature.keyId,
    envelope_signature: ledgerSignature.signature,
    issued_at: envelope.issuedAt,
  });
}

export { REQUIRED_QUALIFICATION_SUITES, SYNTHETIC_AUDIO_DISCLOSURE };
