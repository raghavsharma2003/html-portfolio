import { randomUUID } from "node:crypto";
import { replicaId, REPLICA_POLICY_VERSION } from "./_replica.js";
import { PROVENANCE_POLICY, sha256Hex } from "./_provenance/contracts.js";

const CHOICES = new Set(["left", "right", "tie", "neither"]);
const REASONS = new Set(["identity", "accent", "rhythm", "emotion", "naturalness", "pronunciation", "noise_or_artifact"]);
const STYLE_KEYS = Object.freeze(["faithful", "balanced", "expressive"]);

function fail(code, status = 400) {
  throw Object.assign(new Error(code), { code, status });
}

function reasons(value) {
  if (!Array.isArray(value)) fail("voice_preference_reasons_invalid");
  const result = [...new Set(value.map(String))];
  if (result.length > 6 || result.some((item) => !REASONS.has(item))) fail("voice_preference_reasons_invalid");
  return result.sort();
}

export function voicePreferencePairHash(leftGenerationId, rightGenerationId) {
  const pair = [replicaId(leftGenerationId), replicaId(rightGenerationId)].sort();
  if (pair[0] === pair[1]) fail("voice_preference_distinct_generations_required");
  return sha256Hex({ schema: "vyakti.voice-preference-pair.v1", generation_ids: pair });
}

export async function recordOwnedVoicePreference(db, ownerUserId, input) {
  const rid = replicaId(input?.replica_id);
  const left = replicaId(input?.left_generation_id);
  const right = replicaId(input?.right_generation_id);
  const choice = String(input?.choice || "");
  if (!CHOICES.has(choice)) fail("voice_preference_choice_invalid");
  const reasonCodes = reasons(input?.reason_codes || []);
  const confidence = Number(input?.confidence ?? 1);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) fail("voice_preference_confidence_invalid");
  const pairHash = voicePreferencePairHash(left, right);
  const preferenceId = randomUUID();
  const rows = await db(
    `with eligible as materialized (
       select l.replica_id,l.owner_user_id,l.genome_version,l.preview_artifact_id
         from vy_replica_generation l
         join vy_replica_generation r on r.generation_id=$4 and r.replica_id=l.replica_id
          and r.owner_user_id=l.owner_user_id
         join vy_replica x on x.replica_id=l.replica_id and x.owner_user_id=l.owner_user_id
        where l.generation_id=$3 and l.replica_id=$1 and l.owner_user_id=$2
          and l.state='sealed' and r.state='sealed'
          and l.purpose='voice_preview' and r.purpose='voice_preview'
          and l.channel='studio_preview' and r.channel='studio_preview'
          and l.genome_version=r.genome_version and l.preview_artifact_id=r.preview_artifact_id
          and l.preview_model_commitment=r.preview_model_commitment
           and l.preview_text_hash<>'' and l.preview_text_hash=r.preview_text_hash
           and l.preview_language_id<>'' and l.preview_language_id=r.preview_language_id
           and l.preview_seed>0 and l.preview_seed=r.preview_seed
           and l.preview_style#>>'{schema}'='vyakti.voice-preview-style.v1'
          and r.preview_style#>>'{schema}'='vyakti.voice-preview-style.v1'
          and l.preview_style->>'key'=any($11::text[]) and r.preview_style->>'key'=any($11::text[])
          and l.preview_style->>'key'<>r.preview_style->>'key'
          and l.sealed_at>now()-interval '24 hours' and r.sealed_at>now()-interval '24 hours'
          and x.subject_mode='self' and x.lifecycle not in ('revoked','purging','deleted')
          and x.policy_version=$10 and x.age_verified_at is not null
          and x.identity_verified_at is not null and x.liveness_verified_at is not null
          and x.identity_expires_at>now()
          and exists(select 1 from vy_replica_consent c where c.replica_id=x.replica_id
            and c.owner_user_id=x.owner_user_id and c.scope='biometric' and c.policy_version=x.policy_version
            and c.revoked_at is null and (c.expires_at is null or c.expires_at>now()))
          and exists(select 1 from vy_replica_consent c where c.replica_id=x.replica_id
            and c.owner_user_id=x.owner_user_id and c.scope='training' and c.policy_version=x.policy_version
            and c.revoked_at is null and (c.expires_at is null or c.expires_at>now()))
     ), inserted as (
       insert into vy_replica_voice_preference
         (preference_id,replica_id,owner_user_id,genome_version,preview_artifact_id,
          left_generation_id,right_generation_id,pair_hash,choice,reason_codes,confidence,policy_version)
       select $5,replica_id,owner_user_id,genome_version,preview_artifact_id,$3,$4,$6,$7,$8::text[],$9,$12
         from eligible
       on conflict (replica_id,owner_user_id,pair_hash) do nothing
       returning preference_id,replica_id,genome_version,left_generation_id,right_generation_id,
                 choice,reason_codes,confidence,created_at
     ), audit as (
       insert into vy_replica_audit(replica_id,owner_user_id,action,object_kind,object_id,policy,outcome,facts)
       select replica_id,$2,'voice.preference.record','voice_preference',preference_id::text,$12,'allowed',
              jsonb_build_object('choice',choice,'reason_codes',reason_codes,'confidence',confidence)
         from inserted
     ) select * from inserted`,
    [rid, ownerUserId, left, right, preferenceId, pairHash, choice, reasonCodes, confidence,
      REPLICA_POLICY_VERSION, STYLE_KEYS, PROVENANCE_POLICY],
  );
  if (!rows[0]) fail("voice_preference_pair_ineligible_or_already_recorded", 409);
  const row = rows[0];
  return Object.freeze({
    preference_id: row.preference_id,
    replica_id: row.replica_id,
    genome_version: Number(row.genome_version),
    left_generation_id: row.left_generation_id,
    right_generation_id: row.right_generation_id,
    choice: row.choice,
    reason_codes: row.reason_codes || [],
    confidence: Number(row.confidence),
    created_at: row.created_at,
  });
}
