import { randomUUID } from "node:crypto";
import { canonicalJson, sha256Hex } from "./_provenance/contracts.js";
import {
  loadOwnedVoiceCurriculumContext,
  recommendVoiceTrial,
  VOICE_CALIBRATION_DECK_VERSION,
  VOICE_CURRICULUM_ALGORITHM,
  VOICE_TRIAL_STYLE_KEYS,
} from "./_replica-voice-curriculum.js";
import { voicePreviewStyle } from "./_replica-voice-preview.js";
import { OPEN_CHATTERBOX_MODEL_COMMITMENT } from "./_voice/providers/open-chatterbox-preview.js";

export const VOICE_DELIVERY_POLICY_SCHEMA = "vyakti.voice-delivery-policy.v1";
export const VOICE_DELIVERY_POLICY_BUILDER = "voice-delivery-policy/bt-map-v1";

function fail(code, status = 409, details) {
  const error = Object.assign(new Error(code), { code, status });
  if (details) error.details = details;
  throw error;
}

function rounded(value) {
  return Number(Number(value || 0).toFixed(6));
}

function evidenceCommitment(history) {
  return history.map((row) => ({
    preference_id: String(row.preference_id),
    trial_id: String(row.trial_id),
    pair_hash: String(row.pair_hash),
    choice: String(row.choice),
    confidence: rounded(row.confidence),
  })).sort((one, two) => one.preference_id.localeCompare(two.preference_id));
}

export function buildVoiceDeliveryPolicyDraft(history, context) {
  const schedule = recommendVoiceTrial(history, `${context.replicaId}:${context.genomeVersion}:${context.artifactId}:${context.languageId}:freeze`);
  if (!schedule.converged || !schedule.provisionalChampion || !schedule.runnerUp) {
    fail("voice_delivery_policy_not_ready", 409, {
      completed: schedule.completedComparisons,
      covered_conditions: schedule.coveredConditions,
      unique_prompts: schedule.uniquePrompts,
      required_prompts: schedule.requiredPrompts,
    });
  }
  const evidence = evidenceCommitment(history);
  const sourceSetHash = sha256Hex(canonicalJson({
    schema: "vyakti.voice-delivery-evidence.v1",
    curriculum_algorithm: VOICE_CURRICULUM_ALGORITHM,
    prompt_deck_version: VOICE_CALIBRATION_DECK_VERSION,
    replica_id: context.replicaId,
    genome_version: context.genomeVersion,
    artifact_id: context.artifactId,
    language_id: context.languageId,
    model_commitment: OPEN_CHATTERBOX_MODEL_COMMITMENT,
    evidence,
  }));
  const conditionEstimates = VOICE_TRIAL_STYLE_KEYS.map((key) => ({
    key,
    score: rounded(schedule.conditionScores[key]),
    exposures: Number(schedule.exposures[key] || 0),
    rejection_weight: rounded(schedule.rejections[key]),
  }));
  const definition = Object.freeze({
    schema: VOICE_DELIVERY_POLICY_SCHEMA,
    builder: VOICE_DELIVERY_POLICY_BUILDER,
    curriculum_algorithm: VOICE_CURRICULUM_ALGORITHM,
    prompt_deck_version: VOICE_CALIBRATION_DECK_VERSION,
    language_id: context.languageId,
    model_commitment: OPEN_CHATTERBOX_MODEL_COMMITMENT,
    champion: voicePreviewStyle(schedule.provisionalChampion),
    runner_up_key: schedule.runnerUp,
    latent_margin: rounded(schedule.latentMargin),
    condition_estimates: conditionEstimates,
    evidence_summary: Object.freeze({
      comparisons: schedule.completedComparisons,
      prompt_families: schedule.uniquePrompts,
      condition_coverage: schedule.coveredConditions,
      source_set_hash: sourceSetHash,
    }),
  });
  return Object.freeze({ sourceSetHash, definition, schedule, evidence });
}

function clientPolicy(row) {
  const definition = typeof row.definition === "string" ? JSON.parse(row.definition) : row.definition || {};
  return Object.freeze({
    policy_id: row.policy_id,
    version: Number(row.version),
    language_id: row.language_id,
    status: row.status,
    champion_key: String(definition?.champion?.key || ""),
    comparisons: Number(row.evidence_count),
    prompt_families: Number(row.unique_prompt_count),
    latent_margin: Number(row.latent_margin),
    source_set_hash: row.source_set_hash,
    created_at: row.created_at,
  });
}

async function policyRows(db, ownerUserId, context) {
  return db(
    `select p.policy_id,p.version,p.language_id,p.status,p.definition,p.evidence_count,
            p.unique_prompt_count,p.latent_margin,p.source_set_hash,p.created_at
       from vy_replica_voice_delivery_policy p
       join vy_replica r on r.replica_id=p.replica_id and r.owner_user_id=p.owner_user_id
      where p.replica_id=$1 and p.owner_user_id=$2 and p.genome_version=$3
        and p.preview_artifact_id=$4 and p.language_id=$5 and p.model_commitment=$6
      order by p.version desc limit 20`,
    [context.rid, ownerUserId, context.genomeVersion, context.context.artifact_id,
      context.languageId, OPEN_CHATTERBOX_MODEL_COMMITMENT],
  );
}

export async function ownedVoiceDeliveryPolicyStatus(db, ownerUserId, input) {
  const context = await loadOwnedVoiceCurriculumContext(db, ownerUserId, input);
  const [rows, schedule] = await Promise.all([
    policyRows(db, ownerUserId, context),
    Promise.resolve(recommendVoiceTrial(context.history,
      `${context.rid}:${context.genomeVersion}:${context.context.artifact_id}:${context.languageId}:status`)),
  ]);
  return Object.freeze({
    replica_id: context.rid,
    genome_version: context.genomeVersion,
    language_id: context.languageId,
    readiness: Object.freeze({
      ready: schedule.converged,
      completed: schedule.completedComparisons,
      covered_conditions: schedule.coveredConditions,
      total_conditions: VOICE_TRIAL_STYLE_KEYS.length,
      unique_prompts: schedule.uniquePrompts,
      required_prompts: schedule.requiredPrompts,
    }),
    policies: Object.freeze(rows.map(clientPolicy)),
  });
}

export async function buildOwnedVoiceDeliveryPolicy(db, ownerUserId, input) {
  const context = await loadOwnedVoiceCurriculumContext(db, ownerUserId, input);
  const draft = buildVoiceDeliveryPolicyDraft(context.history, {
    replicaId: context.rid,
    genomeVersion: context.genomeVersion,
    artifactId: context.context.artifact_id,
    languageId: context.languageId,
  });
  const policyId = randomUUID();
  const preferenceIds = draft.evidence.map((row) => row.preference_id);
  const rows = await db(
    `with owned as materialized (
       select r.replica_id,r.owner_user_id
         from vy_replica r
         join vy_replica_voice_genome vg on vg.replica_id=r.replica_id and vg.version=$3 and vg.status='draft'
         join vy_replica_processing_artifact a on a.artifact_id=$4 and a.replica_id=r.replica_id and a.owner_user_id=r.owner_user_id
         join vy_replica_source s on s.source_id=a.source_id and s.replica_id=a.replica_id and s.owner_user_id=a.owner_user_id
        where r.replica_id=$1 and r.owner_user_id=$2 and r.subject_mode='self'
          and r.lifecycle in ('enrolling','calibrating','ready','active','paused')
          and r.identity_expires_at>now() and a.stage='enhance' and s.state='ready' and s.contains_third_parties=false
          and (vg.definition#>'{references,enrollment_artifact_ids}') ? a.artifact_id::text
          and exists(select 1 from vy_replica_processing_artifact_decision d where d.artifact_id=a.artifact_id
            and d.replica_id=a.replica_id and d.owner_user_id=a.owner_user_id and d.decision='selected'
            and not exists(select 1 from vy_replica_processing_artifact_decision newer where newer.artifact_id=d.artifact_id
              and newer.replica_id=d.replica_id and newer.owner_user_id=d.owner_user_id
              and (newer.created_at,newer.decision_id)>(d.created_at,d.decision_id)))
          and exists(select 1 from vy_replica_consent c where c.replica_id=r.replica_id and c.owner_user_id=r.owner_user_id
            and c.scope='biometric' and c.policy_version=r.policy_version and c.revoked_at is null and (c.expires_at is null or c.expires_at>now()))
          and exists(select 1 from vy_replica_consent c where c.replica_id=r.replica_id and c.owner_user_id=r.owner_user_id
            and c.scope='training' and c.policy_version=r.policy_version and c.revoked_at is null and (c.expires_at is null or c.expires_at>now()))
          and exists(select 1 from vy_replica_consent c where c.replica_id=r.replica_id and c.owner_user_id=r.owner_user_id
            and c.scope='inference' and c.policy_version=r.policy_version and c.revoked_at is null and (c.expires_at is null or c.expires_at>now()))
        for update of r,vg,a,s
     ), locked as materialized (
       select o.*,pg_advisory_xact_lock(hashtextextended(o.replica_id::text||':voice_delivery:'||$5,0))
         from owned o
     ), exact_evidence as materialized (
       select p.preference_id from vy_replica_voice_preference p
       join vy_replica_voice_trial t on t.trial_id=p.trial_id and t.replica_id=p.replica_id and t.owner_user_id=p.owner_user_id
       join locked l on l.replica_id=p.replica_id and l.owner_user_id=p.owner_user_id
      where p.genome_version=$3 and p.preview_artifact_id=$4 and t.language_id=$5
        and t.model_commitment=$6 and t.algorithm=$7 and t.prompt_deck_version=$8
     ), eligible as (
       select l.replica_id,l.owner_user_id from locked l
        where cardinality($9::uuid[])>0
          and (select count(*) from exact_evidence)=cardinality($9::uuid[])
          and not exists(select 1 from unnest($9::uuid[]) expected(preference_id)
            where not exists(select 1 from exact_evidence e where e.preference_id=expected.preference_id))
     ), candidate as (
       select e.replica_id,e.owner_user_id,coalesce(
         (select p.version from vy_replica_voice_delivery_policy p where p.replica_id=e.replica_id
           and p.owner_user_id=e.owner_user_id and p.genome_version=$3 and p.preview_artifact_id=$4
           and p.language_id=$5 and p.model_commitment=$6 and p.source_set_hash=$10 limit 1),
         (select coalesce(max(p.version)+1,1) from vy_replica_voice_delivery_policy p
           where p.replica_id=e.replica_id and p.genome_version=$3 and p.language_id=$5)
       ) version from eligible e
     ), inserted as (
       insert into vy_replica_voice_delivery_policy
         (policy_id,replica_id,owner_user_id,genome_version,preview_artifact_id,language_id,version,
          algorithm,curriculum_algorithm,prompt_deck_version,model_commitment,source_set_hash,definition,
          evidence_count,unique_prompt_count,latent_margin,status)
       select $11,c.replica_id,c.owner_user_id,$3,$4,$5,c.version,$12,$7,$8,$6,$10,$13::jsonb,
              $14,$15,$16,'draft' from candidate c
       on conflict (replica_id,owner_user_id,genome_version,preview_artifact_id,language_id,model_commitment,source_set_hash)
       do update set source_set_hash=excluded.source_set_hash
       returning *
     ), retired as (
       update vy_replica_voice_delivery_policy p set status='retired',retired_at=now()
        where p.replica_id=$1 and p.owner_user_id=$2 and p.genome_version=$3 and p.language_id=$5
          and p.status='draft' and p.policy_id<>(select policy_id from inserted)
     ), audit as (
       insert into vy_replica_audit(replica_id,owner_user_id,action,object_kind,object_id,policy,outcome,facts)
       select replica_id,owner_user_id,'voice.delivery.build','voice_delivery_policy',policy_id::text,$12,'allowed',
              jsonb_build_object('version',version,'source_set_hash',source_set_hash,
                'evidence_count',evidence_count,'unique_prompt_count',unique_prompt_count)
         from inserted
     ) select * from inserted`,
    [context.rid, ownerUserId, context.genomeVersion, context.context.artifact_id, context.languageId,
      OPEN_CHATTERBOX_MODEL_COMMITMENT, VOICE_CURRICULUM_ALGORITHM, VOICE_CALIBRATION_DECK_VERSION,
      preferenceIds, draft.sourceSetHash, policyId, VOICE_DELIVERY_POLICY_BUILDER,
      JSON.stringify(draft.definition), draft.schedule.completedComparisons, draft.schedule.uniquePrompts,
      rounded(draft.schedule.latentMargin)],
  );
  if (!rows[0]) fail("voice_delivery_policy_context_changed");
  return clientPolicy(rows[0]);
}
