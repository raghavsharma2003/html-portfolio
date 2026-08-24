import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  PROVENANCE_POLICY,
  REQUIRED_QUALIFICATION_SUITES,
  SYNTHETIC_AUDIO_DISCLOSURE,
  assertGenerationAuthorization,
  assertProtectionAdapters,
  canonicalJson,
  sha256Hex,
} from "../../api/_provenance/contracts.js";
import { protectReplicaStream } from "../../api/_provenance/delivery.js";
import { createFakeProtectionAdapters } from "../../api/_provenance/providers/fake.js";
import { VOICE_PCM_FORMAT } from "../../api/_voice/contracts.js";
import { REPLICA_POLICY_VERSION } from "../../api/_replica.js";
import { splitSql } from "../../db/migrations/apply.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../..");
let passed = 0;

function ok(name, condition) {
  assert.ok(condition, name);
  passed++;
  console.log(`ok ${passed} - ${name}`);
}

function throwsCode(name, fn, code) {
  assert.throws(fn, (error) => error?.code === code || error?.message === code, name);
  passed++;
  console.log(`ok ${passed} - ${name}`);
}

const ids = Object.freeze({
  generation: "10000000-0000-4000-8000-000000000001",
  replica: "20000000-0000-4000-8000-000000000002",
  owner: "30000000-0000-4000-8000-000000000003",
  voice: "40000000-0000-4000-8000-000000000004",
});

function fixture() {
  return {
    request: {
      generationId: ids.generation,
      replicaId: ids.replica,
      ownerUserId: ids.owner,
      channel: "private_call",
      purpose: "private_conversation",
      policyVersion: PROVENANCE_POLICY,
      traceId: "trace-offline-001",
    },
    replica: {
      replica_id: ids.replica,
      owner_user_id: ids.owner,
      subject_mode: "self",
      lifecycle: "active",
      policy_version: REPLICA_POLICY_VERSION,
      age_verified_at: "2026-08-23T10:00:00.000Z",
      identity_verified_at: "2026-08-23T10:01:00.000Z",
      liveness_verified_at: "2026-08-23T10:02:00.000Z",
      identity_expires_at: "2031-08-23T10:02:00.000Z",
    },
    inferenceConsent: {
      replica_id: ids.replica,
      owner_user_id: ids.owner,
      scope: "inference",
      policy_version: REPLICA_POLICY_VERSION,
      expires_at: "2027-08-23T00:00:00.000Z",
      revoked_at: null,
    },
    voiceProfile: {
      voice_profile_id: ids.voice,
      replica_id: ids.replica,
      genome_version: 3,
      status: "ready",
    },
    voiceGenome: { replica_id: ids.replica, version: 3, status: "approved" },
    personProfile: { replica_id: ids.replica, version: 7, status: "approved" },
    calibration: { replica_id: ids.replica, version: 2, profile_version: 7, status: "approved" },
    qualification: { verdict: "pass", passedSuites: [...REQUIRED_QUALIFICATION_SUITES] },
  };
}

function mutate(path, value) {
  const item = structuredClone(fixture());
  let cursor = item;
  for (const key of path.slice(0, -1)) cursor = cursor[key];
  cursor[path.at(-1)] = value;
  return item;
}

function streamOf(...chunks) {
  return (async function* () {
    for (const chunk of chunks) yield Uint8Array.from(chunk);
  })();
}

const authorized = assertGenerationAuthorization(fixture(), new Date("2026-08-24T00:00:00.000Z"));
ok("verified active self replica with current inference capability is authorized", authorized.profileVersion === 7 && authorized.calibrationVersion === 2);
ok("canonical JSON is key-order invariant", canonicalJson({ z: 1, a: { y: 2, x: 3 } }) === canonicalJson({ a: { x: 3, y: 2 }, z: 1 }));
ok("SHA-256 helper hashes canonical objects, not insertion order", sha256Hex({ b: 2, a: 1 }) === sha256Hex({ a: 1, b: 2 }));

throwsCode("draft replica cannot generate", () => assertGenerationAuthorization(mutate(["replica", "lifecycle"], "draft")), "replica_not_active");
throwsCode("third-party subject mode cannot generate", () => assertGenerationAuthorization(mutate(["replica", "subject_mode"], "third_party")), "self_replica_only");
throwsCode("owner mismatch is an IDOR denial", () => assertGenerationAuthorization(mutate(["request", "ownerUserId"], "50000000-0000-4000-8000-000000000005")), "owner_binding_mismatch");
throwsCode("missing identity verification is denied", () => assertGenerationAuthorization(mutate(["replica", "identity_verified_at"], null)), "identity_verification_incomplete");
throwsCode("revoked inference consent is denied", () => assertGenerationAuthorization(mutate(["inferenceConsent", "revoked_at"], "2026-08-23T23:00:00.000Z")), "inference_consent_inactive");
throwsCode("expired inference consent is denied", () => assertGenerationAuthorization(mutate(["inferenceConsent", "expires_at"], "2026-08-23T23:00:00.000Z"), new Date("2026-08-24T00:00:00.000Z")), "inference_consent_expired");
throwsCode("voice profile must belong to replica", () => assertGenerationAuthorization(mutate(["voiceProfile", "replica_id"], "50000000-0000-4000-8000-000000000005")), "voice_binding_mismatch");
throwsCode("voice provider mapping must be ready", () => assertGenerationAuthorization(mutate(["voiceProfile", "status"], "creating")), "voice_not_ready");
throwsCode("VoiceGenome must be approved", () => assertGenerationAuthorization(mutate(["voiceGenome", "status"], "draft")), "voice_genome_not_approved");
throwsCode("person profile must be approved", () => assertGenerationAuthorization(mutate(["personProfile", "status"], "draft")), "person_profile_not_approved");
throwsCode("calibration must be approved", () => assertGenerationAuthorization(mutate(["calibration", "status"], "draft")), "calibration_not_approved");
throwsCode("calibration must bind the exact Person Model", () => assertGenerationAuthorization(mutate(["calibration", "profile_version"], 6)), "calibration_not_approved");
throwsCode("public delivery channel is absent", () => assertGenerationAuthorization(mutate(["request", "channel"], "public_share")), "channel_not_allowed");
throwsCode("telephony purpose is absent", () => assertGenerationAuthorization(mutate(["request", "purpose"], "outbound_call")), "purpose_not_allowed");
throwsCode("missing provenance qualification is denied", () => assertGenerationAuthorization(mutate(["qualification", "passedSuites"], REQUIRED_QUALIFICATION_SUITES.filter((item) => item !== "provenance"))), "qualification_incomplete");

const productionFake = createFakeProtectionAdapters().adapters;
throwsCode("test protection adapters are refused by the production gate", () => assertProtectionAdapters(productionFake), "test_adapter_forbidden");
ok("test adapters require an explicit offline-only override", assertProtectionAdapters(productionFake, { allowTestAdapters: true }) === productionFake);

const successHarness = createFakeProtectionAdapters();
const protectedOutput = await protectReplicaStream({
  authorization: fixture(),
  sourceStream: streamOf([1, 2], [3, 4]),
  format: VOICE_PCM_FORMAT,
  adapters: successHarness.adapters,
  allowTestAdapters: true,
  now: new Date("2026-08-24T00:00:00.000Z"),
});
const outputChunks = [];
for await (const chunk of protectedOutput.stream) outputChunks.push(chunk);
const receipt = await protectedOutput.completion;
const protectedBytes = Buffer.concat(outputChunks.map((chunk) => Buffer.from(chunk)));
ok("audible prefix is before provider PCM", protectedBytes.byteLength === 964 && protectedBytes.subarray(0, 960).every((byte) => byte === 7));
ok("one operational generation is opened and atomically sealed", successHarness.events.opened.length === 1 && successHarness.events.sealed.length === 1 && successHarness.events.aborted.length === 0);
ok("protected PCM is committed as a signed chain before final sealing", successHarness.events.segments.length === 1 && successHarness.events.segments[0].receipt.sequence === 0 && receipt.segment_count === 1);
ok("final receipt binds the exact segment-chain head", receipt.final_chain_sha256 === successHarness.events.segments.at(-1).receipt.chain_sha256);
ok("receipt audio hash binds exact protected bytes", receipt.audio_sha256 === createHash("sha256").update(protectedBytes).digest("hex"));
ok("receipt binds fixed audible disclosure", receipt.disclosure_text_hash === sha256Hex(SYNTHETIC_AUDIO_DISCLOSURE));
ok("receipt declares external C2PA 2.4 manifest", receipt.provenance_standard === "c2pa-2.4" && receipt.manifest_location === "external");
ok("receipt contains watermark and ledger signatures", receipt.watermark_algorithm.startsWith("audioseal-streaming@") && receipt.envelope_signature.length >= 32);
const changedCalibrationHarness = createFakeProtectionAdapters();
const changedCalibrationOutput = await protectReplicaStream({
  authorization: mutate(["calibration", "version"], 3),
  sourceStream: streamOf([1, 2], [3, 4]),
  format: VOICE_PCM_FORMAT,
  adapters: changedCalibrationHarness.adapters,
  allowTestAdapters: true,
  now: new Date("2026-08-24T00:00:00.000Z"),
});
for await (const _ of changedCalibrationOutput.stream) void _;
await changedCalibrationOutput.completion;
ok("replica commitment binds the exact calibration version", successHarness.events.opened[0].replicaCommitment !== changedCalibrationHarness.events.opened[0].replicaCommitment);
const publicJson = JSON.stringify(receipt);
ok("public receipt contains no owner or raw replica identifier", !publicJson.includes(ids.owner) && !publicJson.includes(ids.replica));
ok("public receipt contains no prompt transcript memory or provider reference", !/(prompt|transcript|memory|provider_ref|object_path|audio_bytes)/i.test(publicJson));

const abortHarness = createFakeProtectionAdapters();
const controller = new AbortController();
const abortedOutput = await protectReplicaStream({
  authorization: fixture(),
  sourceStream: streamOf([1, 2]),
  format: VOICE_PCM_FORMAT,
  adapters: abortHarness.adapters,
  signal: controller.signal,
  allowTestAdapters: true,
});
controller.abort(new Error("caller_hung_up"));
await assert.rejects(async () => {
  for await (const _ of abortedOutput.stream) void _;
}, /caller_hung_up/);
await assert.rejects(abortedOutput.completion, /caller_hung_up/);
ok("aborted stream is logged and never sealed", abortHarness.events.aborted.length === 1 && abortHarness.events.sealed.length === 0);

const badWatermark = createFakeProtectionAdapters();
const originalEmbed = badWatermark.adapters.watermark.embed;
badWatermark.adapters.watermark.embed = async (input) => {
  const result = await originalEmbed(input);
  return { ...result, proof: { ...result.proof, embedded: false } };
};
await assert.rejects(
  protectReplicaStream({ authorization: fixture(), sourceStream: streamOf([1, 2]), format: VOICE_PCM_FORMAT, adapters: badWatermark.adapters, allowTestAdapters: true }),
  /streaming_watermark_missing/,
);
ok("missing watermark fails before delivery and records abort", badWatermark.events.aborted.length === 1 && badWatermark.events.sealed.length === 0);

const badManifest = createFakeProtectionAdapters();
badManifest.adapters.contentCredentials.createManifest = async ({ assetHash }) => ({
  standard: "c2pa-2.4",
  location: "external",
  assetHash: `0${assetHash.slice(1)}`,
  manifestHash: sha256Hex("manifest"),
  signerKeyId: "test-key",
  signatureAlgorithm: "test",
  signature: sha256Hex("signature"),
});
const badManifestOutput = await protectReplicaStream({ authorization: fixture(), sourceStream: streamOf([1, 2]), format: VOICE_PCM_FORMAT, adapters: badManifest.adapters, allowTestAdapters: true });
await assert.rejects(async () => {
  for await (const _ of badManifestOutput.stream) void _;
}, /manifest_asset_binding_mismatch/);
await assert.rejects(badManifestOutput.completion, /manifest_asset_binding_mismatch/);
ok("misbound Content Credential aborts and cannot seal", badManifest.events.aborted.length === 1 && badManifest.events.sealed.length === 0);

const migration = readFileSync(join(ROOT, "db/migrations/019_replica_generation_provenance.sql"), "utf8");
const statements = splitSql(migration);
ok("migration 019 is split-safe and independently idempotent", statements.length >= 5 && statements.every((statement) => /if not exists/i.test(statement)));
const receiptSql = migration.slice(migration.indexOf("create table if not exists vy_replica_generation_receipt"));
ok("public receipt intentionally has no replica foreign key", !/references\s+vy_replica/i.test(receiptSql));
ok("public receipt schema forbids content-bearing fields", !/\b(prompt|transcript|memory|text_body|audio_bytes|owner_user_id|replica_id\s+uuid)\b/i.test(receiptSql));
ok("segment receipts survive abort without carrying identity foreign keys", /create table if not exists vy_replica_generation_segment_receipt/i.test(migration) && !/vy_replica_generation_segment_receipt[\s\S]*references\s+vy_replica/i.test(migration));
ok("operational generation is composite owner-bound", /foreign key \(replica_id, owner_user_id\)[\s\S]*references vy_replica\(replica_id, owner_user_id\)/i.test(migration));
ok("operational generation is voice and version bound", /foreign key \(voice_profile_id, replica_id, genome_version\)/i.test(migration) && /foreign key \(replica_id, profile_version\)/i.test(migration));

console.log(`\n${passed} replica provenance checks passed`);
