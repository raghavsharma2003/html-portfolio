import { randomUUID } from "node:crypto";
import { canonicalJson, sha256Hex } from "./_provenance/contracts.js";
import { decryptTurnExemplar, encryptTurnExemplar, exemplarTextHash } from "./_replica-feedback-crypto.js";
import { replicaId, REPLICA_POLICY_VERSION } from "./_replica.js";

export const TURN_FEEDBACK_SCHEMA = "vyakti.turn-feedback.v1";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIMENSIONS = new Set(["overall", "wording", "behavior", "relationship", "memory", "delivery", "voice_identity"]);
const RATINGS = new Set(["exact", "close", "off", "unsafe"]);
const REASONS = new Set([
  "too_generic", "wrong_fact", "wrong_relationship", "wrong_tone", "wrong_wording", "too_long", "too_short",
  "voice_mismatch", "emotion_mismatch", "unsafe_or_boundary", "other",
]);

function fail(code, status = 400, details) {
  const error = Object.assign(new Error(code), { code, status });
  if (details) error.details = details;
  throw error;
}

function safeUuid(value, code) {
  const id = String(value || "").trim().toLowerCase();
  if (!UUID.test(id)) fail(code);
  return id;
}

function cleanCorrection(value) {
  const original = String(value || "");
  if (Array.from(original).length > 2_000) fail("feedback_correction_too_large", 413);
  return Array.from(original)
    .filter((character) => {
      const code = character.codePointAt(0);
      return code === 10 || code === 13 || (code >= 32 && code !== 127);
    })
    .join("")
    .replace(/<\/?(?:system|assistant|developer|tool)[^>]*>/gi, "")
    .replace(/\r\n?/g, "\n")
    .trim();
}

export function validateTurnFeedback(input) {
  const supplied = input?.ratings;
  if (!supplied || typeof supplied !== "object" || Array.isArray(supplied)) fail("feedback_ratings_required");
  const entries = Object.entries(supplied);
  if (!entries.length || entries.length > DIMENSIONS.size) fail("feedback_ratings_required");
  const ratings = {};
  for (const [dimension, rating] of entries.sort(([left], [right]) => left.localeCompare(right))) {
    if (!DIMENSIONS.has(dimension) || !RATINGS.has(String(rating))) fail("feedback_rating_invalid");
    ratings[dimension] = String(rating);
  }
  const reasons = [...new Set((Array.isArray(input?.reason_codes) ? input.reason_codes : []).map(String))].sort();
  if (reasons.length > 8 || reasons.some((reason) => !REASONS.has(reason))) fail("feedback_reason_invalid");
  const correction = cleanCorrection(input?.correction);
  if (correction && !Object.values(ratings).some((rating) => rating === "close" || rating === "off" || rating === "unsafe"))
    fail("feedback_correction_requires_mismatch");
  if (correction && !["overall", "wording", "behavior", "relationship", "memory"].some((dimension) => ["close", "off", "unsafe"].includes(ratings[dimension])))
    fail("feedback_correction_dimension_invalid");
  const reasonDimensions = {
    wrong_wording: ["overall", "wording"],
    wrong_relationship: ["overall", "relationship"],
    wrong_fact: ["overall", "memory"],
    wrong_tone: ["overall", "behavior", "delivery"],
    voice_mismatch: ["voice_identity"],
    emotion_mismatch: ["behavior", "delivery", "voice_identity"],
  };
  for (const reason of reasons) {
    const allowed = reasonDimensions[reason];
    if (allowed && !allowed.some((dimension) => dimension in ratings)) fail("feedback_reason_dimension_mismatch");
  }
  return Object.freeze({ ratings: Object.freeze(ratings), reason_codes: Object.freeze(reasons), correction });
}

function clientFeedback(row) {
  return {
    feedback_id: String(row.feedback_id),
    turn_id: String(row.turn_id),
    revision: Number(row.revision),
    ratings: typeof row.ratings === "string" ? JSON.parse(row.ratings) : row.ratings,
    reason_codes: Array.isArray(row.reason_codes) ? row.reason_codes : [],
    has_correction: Boolean(row.correction_hash),
    voice_generation_bound: Boolean(row.source_generation_id),
    created_at: row.created_at,
  };
}

export async function recordOwnedTurnFeedback(db, ownerUserId, rawInput, env = process.env) {
  if (typeof db !== "function") fail("feedback_db_required", 503);
  const input = {
    replica_id: replicaId(rawInput?.replica_id),
    turn_id: safeUuid(rawInput?.turn_id, "valid_dialogue_turn_id_required"),
    ...validateTurnFeedback(rawInput),
  };
  const feedbackId = randomUUID();
  const ratingsHash = sha256Hex(canonicalJson({ schema: TURN_FEEDBACK_SCHEMA, ratings: input.ratings, reason_codes: input.reason_codes }));
  const correctionHash = input.correction ? exemplarTextHash(input.correction) : null;
  const encrypted = input.correction ? encryptTurnExemplar(input.correction, {
    feedback_id: feedbackId,
    replica_id: input.replica_id,
    turn_id: input.turn_id,
    text_sha256: correctionHash,
  }, env) : null;
  const requiresVoice = Object.hasOwn(input.ratings, "voice_identity");
  const rows = await db(
    `with authorized as (
       select t.turn_id,t.replica_id,t.owner_user_id,t.capability_id,t.profile_version,t.calibration_version,
              t.response_hash,
              (select g.generation_id from vy_replica_generation g
                where g.dialogue_turn_id=t.turn_id and g.replica_id=t.replica_id and g.owner_user_id=t.owner_user_id
                  and g.state='sealed' order by g.sealed_at desc,g.generation_id desc limit 1) as source_generation_id
         from vy_replica_dialogue_turn t
         join vy_replica r on r.replica_id=t.replica_id and r.owner_user_id=t.owner_user_id
         join vy_replica_runtime_capability c
           on c.capability_id=t.capability_id and c.replica_id=t.replica_id and c.owner_user_id=t.owner_user_id
          and c.profile_version=t.profile_version and c.calibration_version=t.calibration_version
        where t.turn_id=$3::uuid and t.replica_id=$1::uuid and t.owner_user_id=$2::uuid and t.state='complete'
          and t.response_hash is not null and r.lifecycle='active' and r.subject_mode='self'
          and r.policy_version=$10 and c.state='active'
     ), previous as (
       select f.feedback_id,f.revision from vy_replica_turn_feedback f join authorized a
         on a.turn_id=f.turn_id and a.replica_id=f.replica_id and a.owner_user_id=f.owner_user_id
        order by f.revision desc limit 1
     ), inserted as (
       insert into vy_replica_turn_feedback
         (feedback_id,turn_id,replica_id,owner_user_id,capability_id,profile_version,calibration_version,
          response_hash,source_generation_id,revision,supersedes_id,ratings,ratings_hash,reason_codes,
          correction_hash,policy_version)
       select $4::uuid,a.turn_id,a.replica_id,a.owner_user_id,a.capability_id,a.profile_version,a.calibration_version,
              a.response_hash,case when $9::boolean then a.source_generation_id else null end,
              coalesce(p.revision,0)+1,p.feedback_id,$5::jsonb,$6,$7::text[],$8,$10
         from authorized a left join previous p on true
        where not $9::boolean or a.source_generation_id is not null
       returning *
     ), exemplar as (
       insert into vy_replica_turn_exemplar
         (feedback_id,replica_id,owner_user_id,algorithm,key_id,nonce,ciphertext,auth_tag,wrapped_dek,wrap_nonce,
          wrap_auth_tag,aad_sha256,text_sha256)
       select i.feedback_id,i.replica_id,i.owner_user_id,$11,$12,decode($13,'base64'),decode($14,'base64'),
              decode($15,'base64'),decode($17,'base64'),decode($18,'base64'),decode($19,'base64'),$16,i.correction_hash
         from inserted i where i.correction_hash is not null
       returning feedback_id
     ) select i.*,exists(select 1 from exemplar e where e.feedback_id=i.feedback_id) as exemplar_written from inserted i`,
    [input.replica_id, ownerUserId, input.turn_id, feedbackId, JSON.stringify(input.ratings), ratingsHash,
      input.reason_codes, correctionHash, requiresVoice, REPLICA_POLICY_VERSION, encrypted?.algorithm || null,
      encrypted?.key_id || null, encrypted?.nonce_b64 || null, encrypted?.ciphertext_b64 || null,
      encrypted?.auth_tag_b64 || null, encrypted?.aad_sha256 || null, encrypted?.wrapped_dek_b64 || null,
      encrypted?.wrap_nonce_b64 || null, encrypted?.wrap_auth_tag_b64 || null],
  );
  if (!rows[0]) fail(requiresVoice ? "sealed_voice_generation_required" : "feedback_turn_not_available", 409);
  if (correctionHash && !rows[0].exemplar_written) fail("feedback_exemplar_persist_failed", 500);
  return clientFeedback(rows[0]);
}

export async function loadOwnedFeedbackLearningExample(db, ownerUserId, feedbackId, env = process.env) {
  const id = safeUuid(feedbackId, "valid_feedback_id_required");
  const rows = await db(
    `select f.feedback_id,f.turn_id,f.replica_id,f.owner_user_id,f.capability_id,f.profile_version,
            f.calibration_version,f.response_hash,f.source_generation_id,f.revision,f.ratings,f.ratings_hash,
            f.reason_codes,f.correction_hash,f.created_at,a.content as original_reply,
            e.algorithm,e.key_id,encode(e.nonce,'base64') as nonce_b64,
            encode(e.ciphertext,'base64') as ciphertext_b64,encode(e.auth_tag,'base64') as auth_tag_b64,
            encode(e.wrapped_dek,'base64') as wrapped_dek_b64,encode(e.wrap_nonce,'base64') as wrap_nonce_b64,
            encode(e.wrap_auth_tag,'base64') as wrap_auth_tag_b64,e.aad_sha256,e.text_sha256
       from vy_replica_turn_feedback f
       join vy_replica_dialogue_turn t
         on t.turn_id=f.turn_id and t.replica_id=f.replica_id and t.owner_user_id=f.owner_user_id
        and t.capability_id=f.capability_id and t.profile_version=f.profile_version
        and t.calibration_version=f.calibration_version and t.response_hash=f.response_hash
       join meera_log a on a.id=t.assistant_log_id and a.agent_id=t.agent_id and a.device_id=t.device_id and a.role='her'
       left join vy_replica_turn_exemplar e
         on e.feedback_id=f.feedback_id and e.replica_id=f.replica_id and e.owner_user_id=f.owner_user_id
      where f.feedback_id=$1::uuid and f.owner_user_id=$2::uuid limit 1`,
    [id, ownerUserId],
  );
  const row = rows[0];
  if (!row) return null;
  const correction = row.correction_hash ? decryptTurnExemplar(row, {
    feedback_id: row.feedback_id,
    replica_id: row.replica_id,
    turn_id: row.turn_id,
    text_sha256: row.correction_hash,
  }, env) : "";
  if (correction && exemplarTextHash(correction) !== row.correction_hash) fail("feedback_exemplar_hash_mismatch", 409);
  return {
    schema: TURN_FEEDBACK_SCHEMA,
    feedback_id: String(row.feedback_id),
    turn_id: String(row.turn_id),
    version_binding: {
      capability_id: String(row.capability_id),
      profile_version: Number(row.profile_version),
      calibration_version: Number(row.calibration_version),
      response_hash: row.response_hash,
      source_generation_id: row.source_generation_id ? String(row.source_generation_id) : null,
    },
    ratings: typeof row.ratings === "string" ? JSON.parse(row.ratings) : row.ratings,
    reason_codes: row.reason_codes,
    rejected_output: row.original_reply,
    preferred_output: correction || null,
    pair_hash: correction ? sha256Hex(canonicalJson({ response_hash: row.response_hash, correction_hash: row.correction_hash })) : null,
  };
}
