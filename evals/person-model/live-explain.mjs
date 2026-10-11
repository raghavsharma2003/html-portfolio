import { q } from "../../api/_db.js";
import { revokeOwnedConsent } from "../../api/_replica-consent.js";
import {
  activateOwnedRuntime,
  loadOwnedRuntimeContext,
  openOwnedRuntimeSession,
  ownedRuntimeStatus,
} from "../../api/_replica-runtime.js";
import {
  approveOwnedPersonProfile,
  buildOwnedPersonProfile,
  decideOwnedClaim,
  reconcileUnsafePersonProfiles,
} from "../../api/_person-model.js";
import { createNeonProvenanceLedger } from "../../api/_provenance/providers/neon-ledger.js";

const REPLICA = "10000000-0000-4000-8000-000000000001";
const OWNER = "20000000-0000-4000-8000-000000000002";
const CLAIMS = [
  [1, "identity", "self_name", "Asha"],
  [2, "language", "languages", "Hindi, English"],
  [3, "delivery", "turn_shape", "Brief and direct"],
  [4, "boundary", "privacy", "Keep private details out"],
].map(([claim_id, domain, key, body]) => ({
  claim_id: String(claim_id), domain, key, body, origin: "self_declared", confidence: 0.95,
  status: "approved", sensitive: false, source_count: 1, decision: "accepted",
  reason_code: "representative", reviewed_at: "2026-08-30T00:00:00.000Z",
  created_at: "2026-08-30T00:00:00.000Z", updated_at: "2026-08-30T00:00:00.000Z",
  t_valid_from: null, t_valid_to: null,
}));

async function explain(label, invoke, result = []) {
  let parsed = false;
  await invoke(async (sql, params) => {
    await q(`explain (format json) ${sql}`, params);
    parsed = true;
    return result;
  });
  if (!parsed) throw new Error(`${label} did not issue SQL`);
  console.log(`ok - ${label}`);
}

await explain("claim decision and exact profile invalidation parses on live Neon",
  (db) => decideOwnedClaim(db, OWNER, {
    replica_id: REPLICA,
    claim_id: "1",
    decision: "rejected",
    reason_code: "inaccurate",
  }));

await explain("unsafe profile reconciler parses on live Neon",
  (db) => reconcileUnsafePersonProfiles(db, { limit: 20 }));

let buildWrites = 0;
await buildOwnedPersonProfile(async (sql, params) => {
  await q(`explain (format json) ${sql}`, params);
  if (/^\s*select\s+c\.claim_id\b/i.test(sql)) return CLAIMS;
  if (/^\s*select\s+s\.source_id\b/i.test(sql)) return [];
  if (!/insert into vy_replica_profile\b/i.test(sql)) throw new Error("unexpected profile build query");
  buildWrites += 1;
  return [];
}, OWNER, REPLICA);
if (buildWrites !== 1) throw new Error("profile build did not issue its guarded mutation");
console.log("ok - profile build mutation-boundary claim guard parses on live Neon");

let approveWrites = 0;
await approveOwnedPersonProfile(async (sql, params) => {
  await q(`explain (format json) ${sql}`, params);
  if (/^\s*select\s+c\.claim_id\b/i.test(sql)) return CLAIMS;
  if (!/update vy_replica_profile\b/i.test(sql)) throw new Error("unexpected profile approval query");
  approveWrites += 1;
  return [];
}, OWNER, { replica_id: REPLICA, version: 1 });
if (approveWrites !== 1) throw new Error("profile approval did not issue its guarded mutation");
console.log("ok - profile approval mutation-boundary claim guard parses on live Neon");

await explain("runtime status current-profile guard parses on live Neon",
  (db) => ownedRuntimeStatus(db, OWNER, REPLICA));

await explain("runtime activation current-profile guard parses on live Neon",
  (db) => activateOwnedRuntime(db, OWNER, REPLICA), [{
    capability_id: REPLICA,
    adoption_status: 'no_private_draft',
    replica_id: REPLICA,
    state: "active",
    genome_version: 1,
    profile_version: 1,
    calibration_version: 1,
    activated_at: "2026-08-30T00:00:00.000Z",
  }]);

await explain("runtime context current-profile guard parses on live Neon",
  (db) => loadOwnedRuntimeContext(db, OWNER, REPLICA));

await explain("runtime session current-profile guard parses on live Neon",
  (db) => openOwnedRuntimeSession(db, OWNER, {
    replica_id: REPLICA,
    channel: "private_call",
    trace_id: "profile_guard_live_explain",
  }));

await explain("training-consent revocation runtime closure parses on live Neon",
  (db) => revokeOwnedConsent(db, OWNER, REPLICA, ["training"]));

const generation = "30000000-0000-4000-8000-000000000003";
const ledger = createNeonProvenanceLedger(async (sql, params) => {
  await q(`explain (format json) ${sql}`, params);
  return [{ generation_id: generation, sequence: 0 }];
});
await ledger.open({
  generationId: generation,
  replicaId: REPLICA,
  ownerUserId: OWNER,
  disclosureScheme: "audible-prefix-v1",
  watermarkAlgorithm: "audioseal",
  provenanceStandard: "c2pa-2.4",
  watermarkTokenHash: "1".repeat(64),
});
console.log("ok - protected stream open authority guard parses on live Neon");
const authorization = { generationId: generation, replicaId: REPLICA, ownerUserId: OWNER };
await ledger.appendSegment({ authorization, receipt: {
  sequence: 0, byte_offset: 0, byte_length: 4, segment_sha256: "2".repeat(64),
  previous_chain_sha256: "0".repeat(64), chain_sha256: "3".repeat(64),
  signature_algorithm: "ed25519", signer_key_id: "parser-key",
  chain_signature: "s".repeat(64), issued_at: "2026-08-30T00:00:00.000Z",
} });
console.log("ok - protected segment live-authority guard parses on live Neon");
await ledger.seal({
  authorization,
  receipt: {
    envelope_sha256: "4".repeat(64), replica_commitment: "5".repeat(64),
    policy_version: "vyakti-replica-output-v1", channel: "private_call",
    disclosure_scheme: "audible-prefix-v1", disclosure_text_hash: "6".repeat(64),
    watermark_algorithm: "audioseal", watermark_token_hash: "1".repeat(64),
    detector_policy_hash: "7".repeat(64), provenance_standard: "c2pa-2.4",
    manifest_location: "external", signature_algorithm: "ed25519",
    signer_key_id: "parser-key", envelope_signature: "z".repeat(64),
    issued_at: "2026-08-30T00:00:00.000Z",
  },
  envelopeCanonical: JSON.stringify({ receipt: "x".repeat(180) }),
  audioHash: "8".repeat(64), watermarkTokenHash: "1".repeat(64),
  manifestHash: "9".repeat(64), segmentCount: 1, finalChainSha256: "3".repeat(64),
  sealedAt: "2026-08-30T00:00:00.000Z",
});
console.log("ok - protected stream seal live-authority guard parses on live Neon");
