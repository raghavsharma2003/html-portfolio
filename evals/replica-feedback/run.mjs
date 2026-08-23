import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { decryptTurnExemplar, encryptTurnExemplar, exemplarTextHash } from "../../api/_replica-feedback-crypto.js";
import { loadOwnedFeedbackLearningExample, recordOwnedTurnFeedback, TURN_FEEDBACK_SCHEMA, validateTurnFeedback } from "../../api/_replica-feedback.js";
import { splitSql } from "../../db/migrations/apply.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const RID = "10000000-0000-4000-8000-000000000001";
const OWNER = "20000000-0000-4000-8000-000000000002";
const TURN = "30000000-0000-4000-8000-000000000003";
const FEEDBACK = "40000000-0000-4000-8000-000000000004";
const CAPABILITY = "50000000-0000-4000-8000-000000000005";
const GENERATION = "60000000-0000-4000-8000-000000000006";
const KEY = Buffer.from("0123456789abcdef0123456789abcdef", "utf8").toString("base64");
const ENV = { REPLICA_FEEDBACK_KEK_ID: "test-feedback-kek-v1", REPLICA_FEEDBACK_KEK_B64: KEY };
let checks = 0;

function ok(name, value) {
  assert.ok(value, name);
  console.log(`ok ${++checks} - ${name}`);
}

const valid = validateTurnFeedback({ ratings: { relationship: "off", wording: "close" }, reason_codes: ["wrong_wording", "wrong_relationship", "wrong_wording"], correction: "Main actually yeh bolta." });
ok("feedback preserves separate fidelity dimensions", valid.ratings.relationship === "off" && valid.ratings.wording === "close");
ok("reason codes are controlled deduplicated evidence", valid.reason_codes.join(",") === "wrong_relationship,wrong_wording");
ok("owner correction remains an exemplar rather than a policy directive", valid.correction === "Main actually yeh bolta.");
assert.throws(() => validateTurnFeedback({ ratings: { hidden: "exact" } }), /feedback_rating_invalid/);
assert.throws(() => validateTurnFeedback({ ratings: { wording: "maybe" } }), /feedback_rating_invalid/);
assert.throws(() => validateTurnFeedback({ ratings: { overall: "exact" }, correction: "Different" }), /feedback_correction_requires_mismatch/);
assert.throws(() => validateTurnFeedback({ ratings: { voice_identity: "off" }, correction: "Different" }), /feedback_correction_dimension_invalid/);
assert.throws(() => validateTurnFeedback({ ratings: { wording: "off" }, reason_codes: ["voice_mismatch"] }), /feedback_reason_dimension_mismatch/);
ok("unknown dimensions ratings and incoherent corrections fail closed", true);

const correction = "Haan but main itna formal kabhi nahi bolta.";
const textHash = exemplarTextHash(correction);
const binding = { feedback_id: FEEDBACK, replica_id: RID, turn_id: TURN, text_sha256: textHash };
const encrypted = encryptTurnExemplar(correction, binding, ENV);
ok("correction exemplars use randomized authenticated envelope encryption", encrypted.algorithm === "AES-256-GCM" && encrypted.ciphertext_b64 !== Buffer.from(correction).toString("base64") && Buffer.from(encrypted.nonce_b64, "base64").length === 12 && Buffer.from(encrypted.wrapped_dek_b64, "base64").length === 32);
const encryptedAgain = encryptTurnExemplar(correction, binding, ENV);
ok("identical exemplars never reuse data keys nonces or ciphertext", encrypted.wrapped_dek_b64 !== encryptedAgain.wrapped_dek_b64 && encrypted.nonce_b64 !== encryptedAgain.nonce_b64 && encrypted.ciphertext_b64 !== encryptedAgain.ciphertext_b64);
ok("encrypted exemplar round-trips only under its exact evidence binding", decryptTurnExemplar(encrypted, binding, ENV) === correction);
assert.throws(() => decryptTurnExemplar(encrypted, { ...binding, turn_id: RID }, ENV), /feedback_exemplar_binding_invalid/);
assert.throws(() => decryptTurnExemplar(encrypted, binding, { ...ENV, REPLICA_FEEDBACK_KEK_B64: Buffer.alloc(32, 7).toString("base64") }), /feedback_exemplar_decryption_failed/);
ok("AAD tampering and wrong keys are detected", true);
assert.throws(() => encryptTurnExemplar(correction, binding, {}), /feedback_encryption_key_id_required/);
ok("missing production encryption material fails closed", true);

const calls = [];
const saved = await recordOwnedTurnFeedback(async (sql, params) => {
  calls.push({ sql, params });
  return [{
    feedback_id: FEEDBACK, turn_id: TURN, revision: 2, ratings: params[4], reason_codes: params[6],
    correction_hash: params[7], source_generation_id: null, created_at: "2026-08-24T00:00:00.000Z", exemplar_written: true,
  }];
}, OWNER, {
  replica_id: RID, turn_id: TURN, ratings: { behavior: "off", wording: "close" },
  reason_codes: ["wrong_wording"], correction,
}, ENV);
ok("feedback response exposes an opaque revision but no exemplar plaintext", saved.feedback_id === FEEDBACK && saved.revision === 2 && saved.has_correction && !JSON.stringify(saved).includes(correction));
const write = calls[0];
ok("feedback mutation is exact turn owner replica and active capability bound", /t\.turn_id=\$3/.test(write.sql) && /t\.replica_id=\$1/.test(write.sql) && /t\.owner_user_id=\$2/.test(write.sql) && /c\.state='active'/.test(write.sql));
ok("feedback persists response Person Model and calibration version lineage", /capability_id,profile_version,calibration_version/.test(write.sql) && /t\.response_hash is not null/.test(write.sql));
ok("optional exemplar ciphertext and wrapped DEK are written atomically with its feedback revision", /with authorized as/i.test(write.sql) && /insert into vy_replica_turn_exemplar/i.test(write.sql) && /decode\(\$14,'base64'\)/i.test(write.sql) && /decode\(\$17,'base64'\)/i.test(write.sql));
ok("database parameters never contain the correction plaintext", !write.params.includes(correction) && write.params.includes(textHash));
ok("feedback revisions append and supersede instead of mutating history", /coalesce\(p\.revision,0\)\+1,p\.feedback_id/i.test(write.sql));

let voiceSql = "";
await recordOwnedTurnFeedback(async (sql, params) => {
  voiceSql = sql;
  return [{ feedback_id: FEEDBACK, turn_id: TURN, revision: 1, ratings: params[4], reason_codes: [], correction_hash: null, source_generation_id: GENERATION, created_at: "2026-08-24T00:00:00.000Z", exemplar_written: false }];
}, OWNER, { replica_id: RID, turn_id: TURN, ratings: { voice_identity: "exact" } }, ENV);
ok("voice identity feedback requires and binds a sealed generated artifact", /g\.state='sealed'/.test(voiceSql) && /not \$9::boolean or a\.source_generation_id is not null/.test(voiceSql));
await assert.rejects(recordOwnedTurnFeedback(async () => [], OWNER, { replica_id: RID, turn_id: TURN, ratings: { voice_identity: "off" } }, ENV), /sealed_voice_generation_required/);
ok("voice feedback without heard sealed audio is refused", true);
await assert.rejects(recordOwnedTurnFeedback(async () => [], OWNER, { replica_id: RID, turn_id: TURN, ratings: { overall: "off" } }, ENV), /feedback_turn_not_available/);
ok("cross-owner stale or inactive turns resolve to the same denial", true);

const loadedEncrypted = encryptTurnExemplar(correction, binding, ENV);
const example = await loadOwnedFeedbackLearningExample(async (sql, params) => {
  assert.match(sql, /f\.owner_user_id=\$2/);
  assert.deepEqual(params, [FEEDBACK, OWNER]);
  return [{
    feedback_id: FEEDBACK, turn_id: TURN, replica_id: RID, owner_user_id: OWNER, capability_id: CAPABILITY,
    profile_version: 7, calibration_version: 3, response_hash: "a".repeat(64), source_generation_id: null,
    revision: 1, ratings: { wording: "off" }, ratings_hash: "b".repeat(64), reason_codes: ["wrong_wording"],
    correction_hash: textHash, original_reply: "Generic answer", ...loadedEncrypted,
  }];
}, OWNER, FEEDBACK, ENV);
ok("learning example reconstructs an owner-authored preference pair only on an internal owner-bound read", example.schema === TURN_FEEDBACK_SCHEMA && example.rejected_output === "Generic answer" && example.preferred_output === correction);
ok("learning pair keeps exact runtime versions and a content commitment", example.version_binding.profile_version === 7 && example.version_binding.calibration_version === 3 && /^[0-9a-f]{64}$/.test(example.pair_hash));
ok("learning example contains no provider voice or tenant routing metadata", !/(provider|model|agent_id|device_id)/i.test(JSON.stringify(example)));

const migration = readFileSync(join(ROOT, "db/migrations/029_replica_turn_feedback.sql"), "utf8");
ok("turn feedback migration remains one-statement-runner safe", splitSql(migration).length === 6);
ok("feedback foreign key binds exact turn capability profile calibration and response", /foreign key \(turn_id,replica_id,owner_user_id,capability_id,profile_version,calibration_version,response_hash\)/i.test(migration));
ok("voice feedback lineage binds the exact generation and dialogue turn", /foreign key \(source_generation_id,replica_id,owner_user_id,turn_id\)/i.test(migration));
ok("turn erasure cascades through feedback and encrypted exemplars", /vy_replica_turn_feedback_turn_fk[\s\S]*on delete cascade/i.test(migration) && /vy_replica_turn_exemplar_feedback_fk[\s\S]*on delete cascade/i.test(migration));
ok("database has no plaintext correction column", !/^\s*(correction|exemplar_text|preferred_output)\s+text/im.test(migration));
ok("exemplar envelope crypto shape is enforced in the database", /octet_length\(nonce\)=12/.test(migration) && /octet_length\(auth_tag\)=16/.test(migration) && /octet_length\(wrapped_dek\)=32/.test(migration) && /octet_length\(wrap_auth_tag\)=16/.test(migration));
const route = readFileSync(join(ROOT, "api/replica-feedback.js"), "utf8");
ok("production route derives owner from bearer auth and exposes no learning-example read", /requireUser/.test(route) && /recordOwnedTurnFeedback/.test(route) && !/loadOwnedFeedbackLearningExample/.test(route));

console.log(`\n${checks} replica turn feedback checks passed`);
