import { randomUUID } from "node:crypto";
import { canonicalJson, sha256Hex } from "./_provenance/contracts.js";
import { replicaId } from "./_replica.js";
import {
  loadOwnedVoiceCurriculumContext,
  recommendVoiceTrial,
  VOICE_CALIBRATION_DECK_VERSION,
  VOICE_CURRICULUM_ALGORITHM,
  VOICE_TRIAL_STYLE_KEYS,
} from "./_replica-voice-curriculum.js";
import { voicePreviewStyle, voicePreviewTextHash } from "./_replica-voice-preview.js";
import { OPEN_CHATTERBOX_MODEL_COMMITMENT } from "./_voice/providers/open-chatterbox-preview.js";

export const VOICE_DELIVERY_POLICY_SCHEMA = "vyakti.voice-delivery-policy.v1";
export const VOICE_DELIVERY_POLICY_BUILDER = "voice-delivery-policy/bt-map-v1";
export const VOICE_DELIVERY_HOLDOUT_PROTOCOL = "voice-delivery-owner-holdout/v1";
export const VOICE_DELIVERY_HOLDOUT_DECK_VERSION = "voice-delivery-holdout-deck/v1";
export const VOICE_DELIVERY_HOLDOUT_REQUIRED = 12;
export const VOICE_DELIVERY_HOLDOUT_PROMPTS = Object.freeze({
  en: Object.freeze([
    Object.freeze({ key: "en.holdout.soft-contrast.v1", domain: "identity", text: "The rain stopped before sunrise, leaving every narrow street unusually quiet." }),
    Object.freeze({ key: "en.holdout.quick-question.v1", domain: "prosody", text: "Wait, you bought three bright yellow umbrellas for a day with no rain?" }),
    Object.freeze({ key: "en.holdout.precise-route.v1", domain: "precision", text: "Take platform six at twelve thirty, then walk two hundred metres toward the old library." }),
    Object.freeze({ key: "en.holdout.reassurance.v1", domain: "emotion", text: "You do not have to solve everything tonight; I am here, and we can take it slowly." }),
    Object.freeze({ key: "en.holdout.self-repair.v1", domain: "rhythm", text: "No, that came out wrong; what I mean is, the idea was good even if the timing was not." }),
    Object.freeze({ key: "en.holdout.breath-arc.v1", domain: "breath", text: "After the crowded train finally left the station, we found a quiet bench, shared the last orange, and watched the city wake up." }),
  ]),
  hi: Object.freeze([
    Object.freeze({ key: "hi.holdout.soft-contrast.v1", domain: "identity", text: "सूरज निकलने से पहले बारिश रुक गई और सारी पतली गलियाँ एकदम शांत हो गईं।" }),
    Object.freeze({ key: "hi.holdout.quick-question.v1", domain: "prosody", text: "रुको, बिना बारिश वाले दिन के लिए तुम तीन पीली छतरियाँ खरीद लाए?" }),
    Object.freeze({ key: "hi.holdout.precise-route.v1", domain: "precision", text: "बारह बजकर तीस मिनट पर प्लेटफॉर्म छह से निकलना, फिर पुरानी लाइब्रेरी की तरफ दो सौ मीटर चलना।" }),
    Object.freeze({ key: "hi.holdout.reassurance.v1", domain: "emotion", text: "आज रात तुम्हें सब कुछ हल नहीं करना है; मैं यहीं हूँ, हम आराम से करेंगे।" }),
    Object.freeze({ key: "hi.holdout.self-repair.v1", domain: "rhythm", text: "नहीं, मैं ठीक से नहीं कह पाया; मेरा मतलब है idea अच्छा था, बस timing सही नहीं थी।" }),
    Object.freeze({ key: "hi.holdout.breath-arc.v1", domain: "breath", text: "भीड़ वाली ट्रेन जाने के बाद हमें एक शांत बेंच मिली, हमने आखिरी संतरा बाँटा और शहर को जागते देखा।" }),
  ]),
});

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
    holdout: Object.freeze({
      completed: Number(row.holdout_completed || 0),
      required: VOICE_DELIVERY_HOLDOUT_REQUIRED,
      prompt_families: Number(row.holdout_prompt_families || 0),
      required_prompt_families: 6,
      verdict: row.holdout_verdict || null,
      wilson_lower: row.holdout_wilson_lower == null ? null : Number(row.holdout_wilson_lower),
    }),
  });
}

async function policyRows(db, ownerUserId, context) {
  return db(
    `select p.policy_id,p.version,p.language_id,p.status,p.definition,p.evidence_count,
            p.unique_prompt_count,p.latent_margin,p.source_set_hash,p.created_at,
            coalesce(h.completed,0)::int holdout_completed,coalesce(h.prompt_families,0)::int holdout_prompt_families,
            q.verdict holdout_verdict,q.wilson_lower holdout_wilson_lower
       from vy_replica_voice_delivery_policy p
       join vy_replica r on r.replica_id=p.replica_id and r.owner_user_id=p.owner_user_id
       left join lateral (
         select count(*) completed,count(distinct t.prompt_key) prompt_families
           from vy_replica_voice_trial t join vy_replica_voice_preference v
             on v.trial_id=t.trial_id and v.replica_id=t.replica_id and v.owner_user_id=t.owner_user_id
          where t.delivery_policy_id=p.policy_id and t.phase='holdout' and t.state='completed'
       ) h on true
       left join lateral (
         select x.verdict,x.wilson_lower from vy_replica_voice_delivery_qualification x
          where x.policy_id=p.policy_id and x.replica_id=p.replica_id and x.owner_user_id=p.owner_user_id
          order by x.created_at desc limit 1
       ) q on true
      where p.replica_id=$1::uuid and p.owner_user_id=$2::uuid and p.genome_version=$3::int4
        and p.preview_artifact_id=$4::uuid and p.language_id=$5 and p.model_commitment=$6
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
         join vy_replica_voice_genome vg on vg.replica_id=r.replica_id and vg.version=$3::int4 and vg.status='draft'
         join vy_replica_processing_artifact a on a.artifact_id=$4::uuid and a.replica_id=r.replica_id and a.owner_user_id=r.owner_user_id
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
      where p.genome_version=$3::int4 and p.preview_artifact_id=$4::uuid and t.language_id=$5
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
           and p.owner_user_id=e.owner_user_id and p.genome_version=$3::int4 and p.preview_artifact_id=$4::uuid
           and p.language_id=$5 and p.model_commitment=$6 and p.source_set_hash=$10 limit 1),
         (select coalesce(max(p.version)+1,1) from vy_replica_voice_delivery_policy p
           where p.replica_id=e.replica_id and p.genome_version=$3::int4 and p.language_id=$5)
       ) version from eligible e
     ), inserted as (
       insert into vy_replica_voice_delivery_policy
         (policy_id,replica_id,owner_user_id,genome_version,preview_artifact_id,language_id,version,
          algorithm,curriculum_algorithm,prompt_deck_version,model_commitment,source_set_hash,definition,
          evidence_count,unique_prompt_count,latent_margin,status)
       select $11::uuid,c.replica_id,c.owner_user_id,$3::int4,$4::uuid,$5,c.version,$12,$7,$8,$6,$10,$13::jsonb,
              $14::int4,$15::int4,$16::numeric,'draft' from candidate c
       on conflict (replica_id,owner_user_id,genome_version,preview_artifact_id,language_id,model_commitment,source_set_hash)
       do update set source_set_hash=excluded.source_set_hash
       returning *
     ), retired as (
       update vy_replica_voice_delivery_policy p set status='retired',retired_at=now()
        where p.replica_id=$1::uuid and p.owner_user_id=$2::uuid and p.genome_version=$3::int4 and p.language_id=$5
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

function parsedDefinition(row) {
  const definition = typeof row?.definition === "string" ? JSON.parse(row.definition) : row?.definition;
  if (definition?.schema !== VOICE_DELIVERY_POLICY_SCHEMA || definition?.builder !== VOICE_DELIVERY_POLICY_BUILDER)
    fail("voice_delivery_policy_definition_invalid", 500);
  voicePreviewStyle(definition?.champion?.key);
  voicePreviewStyle(definition?.runner_up_key);
  return definition;
}

async function ownedPolicyContext(db, ownerUserId, input) {
  const context = await loadOwnedVoiceCurriculumContext(db, ownerUserId, input);
  const policyId = replicaId(input?.policy_id);
  const rows = await db(
    `select p.* from vy_replica_voice_delivery_policy p
       join vy_replica r on r.replica_id=p.replica_id and r.owner_user_id=p.owner_user_id
      where p.policy_id=$1::uuid and p.replica_id=$2::uuid and p.owner_user_id=$3::uuid and p.genome_version=$4::int4
        and p.preview_artifact_id=$5::uuid and p.language_id=$6 and p.model_commitment=$7
        and p.status in ('draft','qualifying') limit 1`,
    [policyId, context.rid, ownerUserId, context.genomeVersion, context.context.artifact_id,
      context.languageId, OPEN_CHATTERBOX_MODEL_COMMITMENT],
  );
  if (!rows[0]) fail("voice_delivery_policy_not_found", 404);
  return Object.freeze({ ...context, policyId, policy: rows[0], definition: parsedDefinition(rows[0]) });
}

function holdoutSeed(policyId, promptKey, index) {
  return (Number.parseInt(sha256Hex(`vyakti:voice-delivery-holdout-seed:v1:${policyId}:${promptKey}:${index}`).slice(0, 8), 16) & 0x7fffffff) || 1;
}

function holdoutPair(policy, prompt, seedIndex) {
  const candidate = policy.definition.champion.key;
  const baseline = policy.definition.runner_up_key;
  const candidateSide = Number.parseInt(sha256Hex(`${policy.policyId}:${prompt.key}:${seedIndex}:side`).slice(0, 2), 16) % 2 ? "left" : "right";
  return Object.freeze({
    candidateSide,
    leftStyleKey: candidateSide === "left" ? candidate : baseline,
    rightStyleKey: candidateSide === "right" ? candidate : baseline,
  });
}

export async function issueOwnedVoiceDeliveryHoldout(db, ownerUserId, input) {
  const context = await ownedPolicyContext(db, ownerUserId, input);
  const trials = await db(
    `select t.prompt_key,t.holdout_seed_index,t.state,(t.expires_at>now()) active
       from vy_replica_voice_trial t
      where t.delivery_policy_id=$1::uuid and t.replica_id=$2::uuid and t.owner_user_id=$3::uuid and t.phase='holdout'
      order by t.created_at,t.trial_id`,
    [context.policyId, context.rid, ownerUserId],
  );
  if (trials.some((row) => row.state === "issued" && (row.active === true || row.active === "true")))
    fail("voice_delivery_holdout_trial_active");
  const completed = trials.filter((row) => row.state === "completed");
  const prompts = VOICE_DELIVERY_HOLDOUT_PROMPTS[context.languageId];
  const counts = new Map(prompts.map((prompt) => [prompt.key, completed.filter((row) => row.prompt_key === prompt.key).length]));
  const prompt = [...prompts].sort((one, two) => counts.get(one.key) - counts.get(two.key) || one.key.localeCompare(two.key))[0];
  const seedIndex = counts.get(prompt.key);
  if (seedIndex >= 2) fail("voice_delivery_holdout_ready_to_finalize");
  const previewSeed = holdoutSeed(context.policyId, prompt.key, seedIndex);
  const textHash = voicePreviewTextHash(prompt.text);
  const pair = holdoutPair(context, prompt, seedIndex);
  const pairHash = sha256Hex(canonicalJson({
    schema: "vyakti.voice-delivery-holdout-pair.v1",
    protocol: VOICE_DELIVERY_HOLDOUT_PROTOCOL,
    deck: VOICE_DELIVERY_HOLDOUT_DECK_VERSION,
    policy_id: context.policyId,
    source_set_hash: context.policy.source_set_hash,
    prompt_key: prompt.key,
    text_hash: textHash,
    seed_index: seedIndex,
    preview_seed: previewSeed,
    model_commitment: OPEN_CHATTERBOX_MODEL_COMMITMENT,
    left_style: voicePreviewStyle(pair.leftStyleKey),
    right_style: voicePreviewStyle(pair.rightStyleKey),
  }));
  const trialId = randomUUID();
  const rows = await db(
    `with expired as (
       update vy_replica_voice_trial set state='expired'
        where delivery_policy_id=$5::uuid and replica_id=$1::uuid and owner_user_id=$2::uuid
          and phase='holdout' and state='issued' and expires_at<=now()
     ), target as materialized (
       select p.policy_id,p.replica_id,p.owner_user_id
         from vy_replica_voice_delivery_policy p
         join vy_replica r on r.replica_id=p.replica_id and r.owner_user_id=p.owner_user_id
         join vy_replica_voice_genome vg on vg.replica_id=p.replica_id and vg.version=p.genome_version and vg.status='draft'
         join vy_replica_processing_artifact a on a.artifact_id=p.preview_artifact_id and a.replica_id=p.replica_id and a.owner_user_id=p.owner_user_id
         join vy_replica_source s on s.source_id=a.source_id and s.replica_id=a.replica_id and s.owner_user_id=a.owner_user_id
        where p.policy_id=$5 and p.replica_id=$1 and p.owner_user_id=$2 and p.genome_version=$3
          and p.preview_artifact_id=$4 and p.language_id=$6 and p.model_commitment=$12
          and p.status in ('draft','qualifying')
          and r.subject_mode='self' and r.age_verified_at is not null and r.identity_verified_at is not null
          and r.liveness_verified_at is not null and r.identity_expires_at>now()
          and s.state='ready' and s.contains_third_parties=false
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
          and (select count(*) from expired)>=0
          and not exists(select 1 from vy_replica_voice_trial active where active.delivery_policy_id=p.policy_id
            and active.phase='holdout' and active.state='issued' and active.expires_at>now())
        for update of p,r,vg,a,s
     ), inserted as (
       insert into vy_replica_voice_trial
         (trial_id,replica_id,owner_user_id,genome_version,preview_artifact_id,language_id,
          prompt_key,prompt_deck_version,text_hash,preview_seed,model_commitment,left_style_key,
          right_style_key,pair_hash,algorithm,phase,delivery_policy_id,candidate_side,holdout_seed_index,state,expires_at)
       select $7::uuid,replica_id,owner_user_id,$3::int4,$4::uuid,$6,$8,$9,$10,$11::int4,$12,$13,$14,$15,$16,
              'holdout',$5::uuid,$17,$18::int4,'issued',now()+interval '30 minutes' from target
       on conflict (delivery_policy_id,prompt_key,holdout_seed_index)
         where phase='holdout' and state in ('issued','completed') do nothing
       returning trial_id,replica_id,owner_user_id,expires_at
     ), audit as (
       insert into vy_replica_audit(replica_id,owner_user_id,action,object_kind,object_id,policy,outcome,facts)
       select replica_id,owner_user_id,'voice.delivery.holdout.issue','voice_trial',trial_id::text,$16,'allowed',
              jsonb_build_object('policy_id',$5,'prompt_key',$8,'seed_index',$18,'pair_hash',$15)
         from inserted
     ) select trial_id,expires_at from inserted`,
    [context.rid, ownerUserId, context.genomeVersion, context.context.artifact_id, context.policyId,
      context.languageId, trialId, prompt.key, VOICE_DELIVERY_HOLDOUT_DECK_VERSION, textHash,
      previewSeed, OPEN_CHATTERBOX_MODEL_COMMITMENT, pair.leftStyleKey, pair.rightStyleKey, pairHash,
      VOICE_DELIVERY_HOLDOUT_PROTOCOL, pair.candidateSide, seedIndex],
  );
  if (!rows[0]) fail("voice_delivery_holdout_context_changed");
  return Object.freeze({
    trial_id: rows[0].trial_id,
    protocol: VOICE_DELIVERY_HOLDOUT_PROTOCOL,
    expires_at: rows[0].expires_at,
    prompt: Object.freeze({ key: prompt.key, domain: prompt.domain, text: prompt.text }),
    progress: Object.freeze({ completed: completed.length, required: VOICE_DELIVERY_HOLDOUT_REQUIRED,
      prompt_families: new Set(completed.map((row) => row.prompt_key)).size, required_prompt_families: 6 }),
  });
}

function wilsonLower(successes, count) {
  if (!count) return 0;
  const z = 1.96;
  const proportion = successes / count;
  const denominator = 1 + z * z / count;
  const center = proportion + z * z / (2 * count);
  const spread = z * Math.sqrt((proportion * (1 - proportion) + z * z / (4 * count)) / count);
  return (center - spread) / denominator;
}

export function evaluateVoiceDeliveryHoldout(rows, languageId = "en") {
  const expectedPrompts = new Set((VOICE_DELIVERY_HOLDOUT_PROMPTS[String(languageId || "").toLowerCase()] || []).map((prompt) => prompt.key));
  const valid = Array.isArray(rows) ? rows.filter((row) =>
    ["left", "right", "tie", "neither"].includes(row?.choice) &&
    ["left", "right"].includes(row?.candidate_side) &&
    expectedPrompts.has(row?.prompt_key) &&
    Number.isInteger(Number(row?.holdout_seed_index)) && Number(row.holdout_seed_index) >= 0 && Number(row.holdout_seed_index) <= 1) : [];
  const prompts = new Set(valid.map((row) => row.prompt_key));
  const cells = new Set(valid.map((row) => `${row.prompt_key}:${row.holdout_seed_index}`));
  let score = 0;
  let neither = 0;
  for (const row of valid) {
    if (row.choice === "tie") score += 0.5;
    else if (row.choice === "neither") neither++;
    else if (row.choice === row.candidate_side) score++;
  }
  const complete = valid.length === VOICE_DELIVERY_HOLDOUT_REQUIRED && prompts.size === 6 && cells.size === VOICE_DELIVERY_HOLDOUT_REQUIRED;
  const rate = valid.length ? score / valid.length : 0;
  const lower = wilsonLower(score, valid.length);
  const verdict = !complete ? "inconclusive" : rate >= 0.75 && lower >= 0.5 && neither === 0 ? "owner_pass" : "owner_fail";
  return Object.freeze({ complete, verdict, observationCount: valid.length, promptFamilies: prompts.size,
    candidateScore: rounded(score), candidateRate: rounded(rate), wilsonLower: rounded(lower), neitherCount: neither,
    cells, rows: valid });
}

export async function finalizeOwnedVoiceDeliveryHoldout(db, ownerUserId, input) {
  const context = await ownedPolicyContext(db, ownerUserId, input);
  const observations = await db(
    `select p.preference_id,p.pair_hash,p.choice,t.prompt_key,t.holdout_seed_index,t.candidate_side
       from vy_replica_voice_trial t join vy_replica_voice_preference p
         on p.trial_id=t.trial_id and p.replica_id=t.replica_id and p.owner_user_id=t.owner_user_id
      where t.delivery_policy_id=$1::uuid and t.replica_id=$2::uuid and t.owner_user_id=$3::uuid
        and t.phase='holdout' and t.state='completed' and t.algorithm=$4 and t.prompt_deck_version=$5
      order by t.prompt_key,t.holdout_seed_index,t.trial_id`,
    [context.policyId, context.rid, ownerUserId, VOICE_DELIVERY_HOLDOUT_PROTOCOL, VOICE_DELIVERY_HOLDOUT_DECK_VERSION],
  );
  const evaluation = evaluateVoiceDeliveryHoldout(observations, context.languageId);
  if (!evaluation.complete) fail("voice_delivery_holdout_incomplete", 409, evaluation);
  const sourceSetHash = sha256Hex(canonicalJson({ schema: "vyakti.voice-delivery-holdout-evidence.v1",
    policy_id: context.policyId, policy_source_set_hash: context.policy.source_set_hash,
    protocol: VOICE_DELIVERY_HOLDOUT_PROTOCOL, deck: VOICE_DELIVERY_HOLDOUT_DECK_VERSION,
    observations: observations.map((row) => ({ preference_id: row.preference_id, pair_hash: row.pair_hash,
      choice: row.choice, prompt_key: row.prompt_key, seed_index: Number(row.holdout_seed_index) })) }));
  const qualificationId = randomUUID();
  const preferenceIds = observations.map((row) => row.preference_id);
  const rows = await db(
    `with target as materialized (
       select p.policy_id,p.replica_id,p.owner_user_id from vy_replica_voice_delivery_policy p
       join vy_replica r on r.replica_id=p.replica_id and r.owner_user_id=p.owner_user_id
       join vy_replica_voice_genome vg on vg.replica_id=p.replica_id and vg.version=p.genome_version and vg.status='draft'
       join vy_replica_processing_artifact a on a.artifact_id=p.preview_artifact_id and a.replica_id=p.replica_id and a.owner_user_id=p.owner_user_id
       join vy_replica_source s on s.source_id=a.source_id and s.replica_id=a.replica_id and s.owner_user_id=a.owner_user_id
      where p.policy_id=$1 and p.replica_id=$2 and p.owner_user_id=$3 and p.status in ('draft','qualifying')
        and r.subject_mode='self' and r.age_verified_at is not null and r.identity_verified_at is not null
        and r.liveness_verified_at is not null and r.identity_expires_at>now()
        and s.state='ready' and s.contains_third_parties=false
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
      for update of p,r,vg,a,s
     ), exact as materialized (
       select v.preference_id from vy_replica_voice_trial t join vy_replica_voice_preference v
         on v.trial_id=t.trial_id and v.replica_id=t.replica_id and v.owner_user_id=t.owner_user_id
       join target x on x.policy_id=t.delivery_policy_id and x.replica_id=t.replica_id and x.owner_user_id=t.owner_user_id
      where t.phase='holdout' and t.state='completed' and t.algorithm=$4 and t.prompt_deck_version=$5
     ), inserted as (
       insert into vy_replica_voice_delivery_qualification
         (qualification_id,policy_id,replica_id,owner_user_id,protocol_version,prompt_deck_version,
          source_set_hash,observation_count,prompt_family_count,candidate_score,candidate_rate,
          wilson_lower,neither_count,verdict)
       select $6::uuid,policy_id,replica_id,owner_user_id,$4,$5,$7,$8::int4,$9::int4,$10::numeric,$11::numeric,$12::numeric,$13::int4,$14
         from target where (select count(*) from exact)=cardinality($15::uuid[])
          and not exists(select 1 from unnest($15::uuid[]) expected(preference_id)
            where not exists(select 1 from exact e where e.preference_id=expected.preference_id))
       on conflict (policy_id,protocol_version,source_set_hash) do update set source_set_hash=excluded.source_set_hash
       returning *
     ), audit as (
       insert into vy_replica_audit(replica_id,owner_user_id,action,object_kind,object_id,policy,outcome,facts)
       select replica_id,owner_user_id,'voice.delivery.holdout.finalize','voice_delivery_qualification',
              qualification_id::text,$4,case when verdict='owner_pass' then 'allowed' else 'denied' end,
              jsonb_build_object('policy_id',policy_id,'source_set_hash',source_set_hash,
                'observation_count',observation_count,'verdict',verdict)
         from inserted
     ) select * from inserted`,
    [context.policyId, context.rid, ownerUserId, VOICE_DELIVERY_HOLDOUT_PROTOCOL,
      VOICE_DELIVERY_HOLDOUT_DECK_VERSION, qualificationId, sourceSetHash,
      evaluation.observationCount, evaluation.promptFamilies, evaluation.candidateScore,
      evaluation.candidateRate, evaluation.wilsonLower, evaluation.neitherCount,
      evaluation.verdict, preferenceIds],
  );
  if (!rows[0]) fail("voice_delivery_holdout_context_changed");
  return Object.freeze({ qualification_id: rows[0].qualification_id, policy_id: rows[0].policy_id,
    verdict: rows[0].verdict, observation_count: Number(rows[0].observation_count),
    prompt_families: Number(rows[0].prompt_family_count), candidate_rate: Number(rows[0].candidate_rate),
    wilson_lower: Number(rows[0].wilson_lower), source_set_hash: rows[0].source_set_hash,
    production_qualified: false });
}
