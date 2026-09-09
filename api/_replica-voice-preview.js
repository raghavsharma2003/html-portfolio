import {PREVIEW_FENCE} from './_voice/preview-authority.js';
import { createHash, randomUUID } from "node:crypto";
import { replicaId, REPLICA_POLICY_VERSION } from "./_replica.js";
import { PROVENANCE_POLICY, assertVoicePreviewAuthorization, canonicalJson } from "./_provenance/contracts.js";
import { OPEN_CHATTERBOX_MODEL_COMMITMENT } from "./_voice/providers/open-chatterbox-preview.js";
import { voiceLanguageConditioning, voiceScriptMode } from "./_voice/language-conditioning.js";

const TRACE = /^[A-Za-z0-9_-]{8,96}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const LANGUAGES = new Set(["en", "hi"]);
const PREVIEW_INTENT_LEASE_MS = 290_000;
const PREVIEW_INTENT_RETRY_MS = 30_000;
const STYLE_PRESETS = Object.freeze({
  identity_anchor: Object.freeze({ schema: "vyakti.voice-preview-style.v1", key: "identity_anchor", exaggeration: 0.2, cfg_weight: 0.78, temperature: 0.6 }),
  faithful: Object.freeze({ schema: "vyakti.voice-preview-style.v1", key: "faithful", exaggeration: 0.35, cfg_weight: 0.65, temperature: 0.65 }),
  steady_warm: Object.freeze({ schema: "vyakti.voice-preview-style.v1", key: "steady_warm", exaggeration: 0.44, cfg_weight: 0.58, temperature: 0.72 }),
  balanced: Object.freeze({ schema: "vyakti.voice-preview-style.v1", key: "balanced", exaggeration: 0.5, cfg_weight: 0.5, temperature: 0.8 }),
  warm_expressive: Object.freeze({ schema: "vyakti.voice-preview-style.v1", key: "warm_expressive", exaggeration: 0.64, cfg_weight: 0.42, temperature: 0.82 }),
  expressive: Object.freeze({ schema: "vyakti.voice-preview-style.v1", key: "expressive", exaggeration: 0.8, cfg_weight: 0.3, temperature: 0.9 }),
  animated: Object.freeze({ schema: "vyakti.voice-preview-style.v1", key: "animated", exaggeration: 0.96, cfg_weight: 0.22, temperature: 0.98 }),
});

function fail(code, status = 409) {
  throw Object.assign(new Error(code), { code, status });
}

// WHY THIS EXISTS. The `eligible` CTE below joins across fifteen distinct
// preconditions: three consent scopes, four identity checks, source readiness,
// third-party absence, a draft genome at the requested version, a selected
// artifact at the `enhance` stage, and the trial binding. When ANY one of them
// is unmet the CTE simply returns no rows, and every one of those fifteen
// causes used to surface as the single word `voice_preview_not_authorized`.
//
// That is wrong twice over. It is unactionable, because a person told "not
// authorized" cannot tell whether they skipped a consent box or whether their
// audio is still being processed. And it BLAMES THE USER for what is usually
// our own pipeline still working: `not authorized` reads like a permissions
// refusal even when the honest answer is "we have not built your voice yet".
// The blocker split ("waiting on you" versus "waiting on us") is a law here,
// and collapsing both sides into one authorization-flavoured word breaks it.
//
// So on the empty result we run ONE diagnostic query and name the first unmet
// precondition, in the order a person meets them. Ordering matters: someone
// who has done nothing yet should hear about consent, not about a genome they
// have never heard of.
//
// The diagnostic is scoped to the same (replica_id, owner_user_id) pair as the
// query it explains, so it can never describe another person's replica. It is
// a single statement because Neon's SQL-over-HTTP allows exactly one.
const PREVIEW_REFUSALS = [
  // [column, code, blocker class]. First unmet wins.
  ["has_replica", "voice_preview_replica_not_found", "you"],
  ["has_identity", "voice_preview_identity_incomplete", "you"],
  ["has_consent_inference", "voice_preview_consent_missing", "you"],
  ["has_consent_biometric", "voice_preview_consent_missing", "you"],
  ["has_consent_training", "voice_preview_consent_missing", "you"],
  ["has_any_source", "voice_preview_no_audio_yet", "you"],
  ["source_is_solo", "voice_preview_source_has_other_speakers", "you"],
  ["has_ready_source", "voice_preview_audio_still_processing", "us"],
  ["has_genome", "voice_preview_voice_not_built_yet", "us"],
  ["has_selected_audio", "voice_preview_no_selected_audio", "us"],
];

async function diagnoseVoicePreviewRefusal(db, ownerUserId, rid, genomeVersion) {
  const rows = await db(
    `select
       exists(select 1 from vy_replica r
               where r.replica_id=$1::uuid and r.owner_user_id=$2::uuid) has_replica,
       exists(select 1 from vy_replica r
               where r.replica_id=$1::uuid and r.owner_user_id=$2::uuid
                 and r.age_verified_at is not null and r.identity_verified_at is not null
                 and r.liveness_verified_at is not null and r.identity_expires_at>now()) has_identity,
       exists(select 1 from vy_replica_consent c
               where c.replica_id=$1::uuid and c.owner_user_id=$2::uuid and c.scope='inference'
                 and c.revoked_at is null
                 and (c.expires_at is null or c.expires_at>now())) has_consent_inference,
       exists(select 1 from vy_replica_consent c
               where c.replica_id=$1::uuid and c.owner_user_id=$2::uuid and c.scope='biometric'
                 and c.revoked_at is null
                 and (c.expires_at is null or c.expires_at>now())) has_consent_biometric,
       exists(select 1 from vy_replica_consent c
               where c.replica_id=$1::uuid and c.owner_user_id=$2::uuid and c.scope='training'
                 and c.revoked_at is null
                 and (c.expires_at is null or c.expires_at>now())) has_consent_training,
       exists(select 1 from vy_replica_source s
               where s.replica_id=$1::uuid and s.owner_user_id=$2::uuid) has_any_source,
       not exists(select 1 from vy_replica_source s
                   where s.replica_id=$1::uuid and s.owner_user_id=$2::uuid
                     and s.contains_third_parties=true) source_is_solo,
       exists(select 1 from vy_replica_source s
               where s.replica_id=$1::uuid and s.owner_user_id=$2::uuid
                 and s.state='ready') has_ready_source,
       exists(select 1 from vy_replica_voice_genome vg
               where vg.replica_id=$1::uuid and vg.version=$3::int4
                 and vg.status='draft') has_genome,
       exists(select 1 from vy_replica_processing_artifact a
               where a.replica_id=$1::uuid and a.owner_user_id=$2::uuid
                 and a.stage='enhance') has_selected_audio`,
    [rid, ownerUserId, genomeVersion],
  ).catch(() => []);
  const row = rows[0];
  // A diagnostic that cannot run must not invent a reason. Fall back to the
  // old opaque code rather than guessing, and say nothing we did not measure.
  if (!row) return ["voice_preview_not_authorized", "us"];
  for (const [column, code, cls] of PREVIEW_REFUSALS) {
    if (!row[column]) return [code, cls];
  }
  // Every precondition this diagnostic knows about holds, so the refusal came
  // from one it does not cover: the trial binding, the artifact-to-genome
  // reference link, or a policy_version mismatch. Say exactly that instead of
  // pretending to a reason, and keep it on our side of the blocker split.
  return ["voice_preview_preconditions_unmet", "us"];
}



// ABSENT is not INVALID. The calibration lab names a preset on every call; the
// one-button preview panel has no style control to name one with, and until now
// its omission failed the same 400 as a typo, so EVERY preview from the default
// path refused and the route reported it as a server error. A caller that says
// nothing gets the model-native balanced preset. The earlier identity anchor
// remains available to the blind calibration lab, but the owner rejected its
// deliberately suppressed variation as flat. A caller that names a preset we
// do not have is still a 400, because that is a real mistake.
export const DEFAULT_VOICE_PREVIEW_STYLE = "balanced";

export function voicePreviewStyle(value) {
  const named = String(value ?? "").trim();
  if (!named) return STYLE_PRESETS[DEFAULT_VOICE_PREVIEW_STYLE];
  const style = STYLE_PRESETS[named];
  if (!style) fail("voice_preview_style_invalid", 400);
  return style;
}

export function cleanVoicePreviewText(value) {
  const text = Array.from(String(value || ""))
    .filter((character) => {
      const code = character.codePointAt(0);
      return code === 10 || (code >= 32 && code !== 127);
    })
    .join("")
    .replace(/<\/?(?:system|assistant|developer|tool)[^>]*>/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) fail("voice_preview_text_required", 400);
  if (Array.from(text).length > 600) fail("voice_preview_text_too_large", 413);
  return text;
}

export function voicePreviewTextHash(text) {
  return createHash("sha256").update(cleanVoicePreviewText(text), "utf8").digest("hex");
}

export function voicePreviewTextMode(text) {
  return voiceScriptMode(cleanVoicePreviewText(text)).mode;
}

export function voicePreviewMatchedSeed({ replicaId: rid, genomeVersion, languageId, textHash }) {
  const replica = replicaId(rid);
  const version = Number(genomeVersion);
  const language = String(languageId || "").toLowerCase();
  const hash = String(textHash || "").toLowerCase();
  if (!Number.isInteger(version) || version < 1) fail("voice_preview_genome_version_invalid", 400);
  if (!LANGUAGES.has(language)) fail("voice_preview_language_invalid", 400);
  if (!SHA256.test(hash)) fail("voice_preview_text_hash_invalid", 400);
  return (createHash("sha256")
    .update(`vyakti:voice-preview-matched-seed:v2:${replica}:${version}:${language}:${hash}`)
    .digest()
    .readUInt32BE(0) & 0x7fffffff) || 1;
}

export async function beginOwnedVoicePreview(db, ownerUserId, input) {
  const rid = replicaId(input?.replica_id);
  const genomeVersion = Number(input?.genome_version);
  const traceId = String(input?.trace_id || "");
  const languageId = String(input?.language_id || "").toLowerCase();
  const textHash = String(input?.text_hash || "").toLowerCase();
  const textLanguageMode = String(input?.text_language_mode || "unknown").toLowerCase();
  const textFrontend = input?.text_frontend;
  const previewStyle = voicePreviewStyle(input?.style_key);
  const trialId = input?.trial_id ? replicaId(input.trial_id) : null;
  const trialSide = input?.trial_side == null ? null : String(input.trial_side);
  if (!Number.isInteger(genomeVersion) || genomeVersion < 1) fail("voice_preview_genome_version_invalid", 400);
  if (!TRACE.test(traceId)) fail("voice_preview_trace_id_invalid", 400);
  if (!LANGUAGES.has(languageId)) fail("voice_preview_language_invalid", 400);
  if (!SHA256.test(textHash)) fail("voice_preview_text_hash_invalid", 400);
  if (!new Set(["devanagari", "mixed", "latin_only", "unknown"]).has(textLanguageMode))
    fail("voice_preview_text_language_mode_invalid", 400);
  if (textFrontend?.contract !== "vyakti-hindi-text-frontend/v1" ||
      !SHA256.test(String(textFrontend?.planSha256 || "")) ||
      !SHA256.test(String(textFrontend?.inputSha256 || "")) ||
      textFrontend.inputSha256 !== textHash ||
      !SHA256.test(String(textFrontend?.targetSha256 || "")) ||
      !Number.isInteger(textFrontend?.synthesisSegmentCount) || textFrontend.synthesisSegmentCount < 1 ||
      textFrontend.synthesisSegmentCount > 16 || !Number.isInteger(textFrontend?.transformationCount) ||
      textFrontend.transformationCount < 0 || textFrontend.transformationCount > 256) {
    fail("voice_preview_text_frontend_invalid", 400);
  }
  if ((trialId === null) !== (trialSide === null) || (trialSide !== null && !["left", "right"].includes(trialSide)))
    fail("voice_preview_trial_binding_invalid", 400);
  const previewSeed = input?.preview_seed == null
    ? voicePreviewMatchedSeed({ replicaId: rid, genomeVersion, languageId, textHash })
    : Number(input.preview_seed);
  if (!Number.isInteger(previewSeed) || previewSeed < 1 || previewSeed > 0x7fffffff)
    fail("voice_preview_seed_invalid", 400);
  const regenerationKey = previewRegenerationKey(input?.regeneration_key);
  if (trialId === null) {
    const outputStorageBucket = String(input?.output_storage_bucket || "").trim();
    if (!outputStorageBucket || outputStorageBucket.length > 128 || /[\s/]/.test(outputStorageBucket))
      fail("voice_preview_output_storage_invalid", 500);
    const begun = await beginDurableOwnedVoicePreview(db, ownerUserId, {
      rid, genomeVersion, traceId, languageId, textHash, textLanguageMode, textFrontend,
      previewStyle, previewSeed, regenerationKey, outputStorageBucket,
    });
    return startedVoicePreview(
      begun.row, previewStyle, previewSeed, languageId, textLanguageMode, textFrontend, begun.intent,
    );
  }
  if (regenerationKey) fail("voice_preview_trial_regeneration_invalid", 400);
  const rows = await db(
    `with inference_consent as materialized (
       select c.* from vy_replica_consent c
        where c.replica_id=$1 and c.owner_user_id=$2 and c.scope='inference'
          and c.policy_version=$7 and c.revoked_at is null
          and (c.expires_at is null or c.expires_at>now())
        order by c.granted_at desc limit 1
     ), latest_selection as materialized (
       select distinct on (d.artifact_id) d.artifact_id,d.decision,d.created_at,d.decision_id
         from vy_replica_processing_artifact_decision d
        where d.replica_id=$1::uuid and d.owner_user_id=$2::uuid
        order by d.artifact_id,d.created_at desc,d.decision_id desc
     ), eligible_pool as materialized (
       select r.*,vg.version genome_version,vg.status genome_status,
              a.artifact_id,a.source_id,a.storage_bucket,a.object_path,a.mime,a.byte_size,a.duration_ms,a.sha256,
              a.stage,'selected'::text selection_decision,
              selected.created_at selection_created_at,selected.decision_id selection_decision_id,
              s.state source_state,s.contains_third_parties,
              case when vr.source_id is not null then 'primary' else 'supporting' end voice_role,
              case when script.devanagari_chars>0 and script.latin_chars>0 then 'mixed'
                   when script.devanagari_chars>0 then 'devanagari'
                   when script.latin_chars>0 then 'latin_only' else 'unknown' end reference_language_mode,
              script.transcript_span_count,script.devanagari_chars,script.latin_chars,
              c.consent_id,c.scope consent_scope,c.policy_version consent_policy_version,
              c.granted_at consent_granted_at,c.expires_at consent_expires_at,c.revoked_at consent_revoked_at
         from vy_replica r
         join vy_replica_voice_genome vg on vg.replica_id=r.replica_id and vg.version=$3::int4 and vg.status='draft'
         join vy_replica_processing_artifact a on a.replica_id=r.replica_id and a.owner_user_id=r.owner_user_id
         join latest_selection selected on selected.artifact_id=a.artifact_id and selected.decision='selected'
         join vy_replica_source s on s.source_id=a.source_id and s.replica_id=a.replica_id
          and s.owner_user_id=a.owner_user_id
         left join vy_replica_voice_reference vr on vr.replica_id=s.replica_id
          and vr.owner_user_id=s.owner_user_id and vr.source_id=s.source_id
         left join lateral (
           select count(*)::int transcript_span_count,
                  coalesce(sum(length(regexp_replace(coalesce(e.value->>'text',''), '[^ऀ-ॿ]', '', 'g'))),0)::int devanagari_chars,
                  coalesce(sum(length(regexp_replace(coalesce(e.value->>'text',''), '[^A-Za-z]', '', 'g'))),0)::int latin_chars
             from vy_replica_processing_evidence e
            where e.replica_id=a.replica_id and e.owner_user_id=a.owner_user_id
              and e.source_id=a.source_id
              and e.evidence_type='transcript_span'
         ) script on true
         cross join inference_consent c
        where r.replica_id=$1::uuid and r.owner_user_id=$2::uuid and r.subject_mode='self'
          and r.lifecycle in ('enrolling','calibrating','ready','active','paused')
          and r.policy_version=$7 and r.age_verified_at is not null and r.identity_verified_at is not null
          and r.liveness_verified_at is not null and r.identity_expires_at>now()
          and a.stage='enhance' and a.mime in ('audio/wav','audio/x-wav')
          and s.state='ready' and s.contains_third_parties=false
          and (vg.definition#>'{references,enrollment_artifact_ids}') ? a.artifact_id::text
          and exists(select 1 from vy_replica_consent x where x.replica_id=r.replica_id
            and x.owner_user_id=r.owner_user_id and x.scope='biometric' and x.policy_version=r.policy_version
            and x.revoked_at is null
            and (x.expires_at is null or x.expires_at>now()))
          and exists(select 1 from vy_replica_consent x where x.replica_id=r.replica_id
            and x.owner_user_id=r.owner_user_id and x.scope='training' and x.policy_version=r.policy_version
            and x.revoked_at is null
            and (x.expires_at is null or x.expires_at>now()))
          and (($13::uuid is null and $14::text is null) or exists (
            select 1 from vy_replica_voice_trial t where t.trial_id=$13::uuid and t.replica_id=r.replica_id
              and t.owner_user_id=r.owner_user_id and t.genome_version=vg.version
              and t.preview_artifact_id=a.artifact_id and t.language_id=$9 and t.text_hash=$10
              and t.preview_seed=$12::int4 and t.model_commitment=$8 and t.state='issued' and t.expires_at>now()
              and (($14='left' and t.left_style_key=($11::jsonb->>'key'))
                or ($14='right' and t.right_style_key=($11::jsonb->>'key')))
          ))
     ), eligible as materialized (
       select * from eligible_pool
        order by case when voice_role='primary' then 0 else 1 end,
                 case when $9='hi' then
                 case when $13 in ('mixed','latin_only') then
                     case reference_language_mode when 'mixed' then 0 when 'devanagari' then 1 when 'latin_only' then 2 else 3 end
                   else
                     case reference_language_mode when 'devanagari' then 0 when 'mixed' then 1 when 'latin_only' then 2 else 3 end
                   end
                 else 0 end,
                 selection_created_at desc,selection_decision_id desc limit 1
     ), inserted as (
       insert into vy_replica_generation
         (replica_id,owner_user_id,voice_profile_id,genome_version,profile_version,calibration_version,
          dialogue_turn_id,channel,purpose,policy_version,trace_id,state,disclosure_scheme,
          watermark_algorithm,provenance_standard,preview_artifact_id,preview_model,preview_model_commitment,
          preview_language_id,preview_text_hash,preview_style,preview_seed,preview_trial_id,preview_trial_side)
       select replica_id,owner_user_id,null,genome_version,null,null,null,'studio_preview','voice_preview',
              $4,$5,'authorized','audible-prefix-v1','pending','c2pa-2.4',artifact_id,$6,$8,$9,$10,
              $11::jsonb || jsonb_build_object(
                'text_language_mode',$15::text,
                'text_frontend',$16::jsonb,
                'reference_language_mode',reference_language_mode,
                'reference_language_evidence_scope',case when transcript_span_count>0 then 'source_transcript' else 'unverified' end,
                'conditioning_contract','vyakti-voice-language-conditioning/v1',
                'effective_cfg_weight',case when $9='hi' and reference_language_mode in ('latin_only','unknown')
                                            then 0 else ($11::jsonb->>'cfg_weight')::double precision end),
              $12::int4,$13::uuid,$14
         from eligible
       on conflict (preview_trial_id,preview_trial_side)
         where preview_trial_id is not null and state in ('authorized','streaming','sealed') do nothing
       returning *
     ) select i.*,e.subject_mode,e.lifecycle,e.policy_version replica_policy_version,
              e.age_verified_at,e.identity_verified_at,e.liveness_verified_at,e.identity_expires_at,
              e.artifact_id,e.source_id,e.storage_bucket,e.object_path,e.mime,e.byte_size,e.duration_ms,e.sha256,e.stage,
              e.reference_language_mode,e.transcript_span_count,e.devanagari_chars,e.latin_chars,
              e.selection_decision,e.source_state,e.contains_third_parties,e.voice_role,e.genome_status,
              e.consent_id,e.consent_scope,e.consent_policy_version,e.consent_granted_at,
              e.consent_expires_at,e.consent_revoked_at
         from inserted i join eligible e on e.replica_id=i.replica_id`,
    [rid, ownerUserId, genomeVersion, PROVENANCE_POLICY, traceId,
      "open_chatterbox_multilingual_v3", REPLICA_POLICY_VERSION, OPEN_CHATTERBOX_MODEL_COMMITMENT,
      languageId, textHash, JSON.stringify(previewStyle), previewSeed, trialId, trialSide, textLanguageMode,
      JSON.stringify(textFrontend)],
  );
  const row = rows[0];
  if (!row) {
    const [code, cls] = await diagnoseVoicePreviewRefusal(db, ownerUserId, rid, genomeVersion);
    throw Object.assign(new Error(code), { code, status: 409, blockerClass: cls });
  }
  const authorizationInput = {
    request: {
      generationId: row.generation_id,
      replicaId: row.replica_id,
      ownerUserId: row.owner_user_id,
      channel: row.channel,
      purpose: row.purpose,
      policyVersion: row.policy_version,
      traceId: row.trace_id,
    },
    replica: {
      replica_id: row.replica_id,
      owner_user_id: row.owner_user_id,
      subject_mode: row.subject_mode,
      lifecycle: row.lifecycle,
      policy_version: row.replica_policy_version,
      age_verified_at: row.age_verified_at,
      identity_verified_at: row.identity_verified_at,
      liveness_verified_at: row.liveness_verified_at,
      identity_expires_at: row.identity_expires_at,
    },
    inferenceConsent: {
      consent_id: row.consent_id,
      replica_id: row.replica_id,
      owner_user_id: row.owner_user_id,
      scope: row.consent_scope,
      policy_version: row.consent_policy_version,
      granted_at: row.consent_granted_at,
      expires_at: row.consent_expires_at,
      revoked_at: row.consent_revoked_at,
    },
    voiceGenome: { replica_id: row.replica_id, version: Number(row.genome_version), status: row.genome_status },
    previewArtifact: {
      artifact_id: row.artifact_id,
      replica_id: row.replica_id,
      owner_user_id: row.owner_user_id,
      source_id: row.source_id,
      stage: row.stage,
      selection_decision: row.selection_decision,
      source_state: row.source_state,
      contains_third_parties: row.contains_third_parties,
      sha256: row.sha256,
    },
  };
  const authorization = assertVoicePreviewAuthorization(authorizationInput);
  const transcriptSpanCount = Number(row.transcript_span_count || 0);
  const referenceLanguageEvidenceScope = transcriptSpanCount > 0 ? "source_transcript" : "unverified";
  const voiceConditioning = voiceLanguageConditioning({
    languageId,
    referenceLanguageMode: row.reference_language_mode || "unknown",
    referenceLanguageEvidenceScope,
    textLanguageMode,
    requestedCfgWeight: previewStyle.cfg_weight,
    disclosureLanguageId: textFrontend.disclosureLanguage,
  });
  return Object.freeze({
    generation: row,
    authorizationInput,
    authorization,
    previewStyle,
    previewSeed,
    voiceConditioning,
    reference: Object.freeze({
      artifactId: row.artifact_id,
      sourceId: row.source_id,
      storageBucket: row.storage_bucket,
      objectPath: row.object_path,
      mime: row.mime,
      byteSize: Number(row.byte_size),
      durationMs: Number(row.duration_ms),
      sha256: row.sha256,
      languageMode: voiceConditioning.referenceLanguageMode,
      languageEvidenceScope: referenceLanguageEvidenceScope,
      transcriptSpanCount,
      devanagariChars: Number(row.devanagari_chars || 0),
      latinChars: Number(row.latin_chars || 0),
    }),
  });
}

export async function markVoicePreviewFailed(db, ownerUserId, generationId, error) {
  const code = String(error?.code || error?.message || "voice_preview_failed").replace(/[^a-z0-9_.:-]/gi, "_").slice(0, 120);
  await db(
    `update vy_replica_generation set state=case when state='sealed' then state else 'failed' end,
            failure_code=case when state='sealed' then failure_code else $3 end,updated_at=now()
      where generation_id=$1::uuid and owner_user_id=$2::uuid and purpose='voice_preview'`,
    [generationId, ownerUserId, code],
  ).catch(() => []);
}

function previewRegenerationKey(value) {
  const key = String(value || "").trim();
  if (key && !TRACE.test(key)) fail("voice_preview_regeneration_key_invalid", 400);
  return key;
}

function previewIntentRow(row, requestedIntentId, leaseTokenHash) {
  const role = row.intent_state === "failed"
    ? "failed"
    : row.intent_state === "sealed"
      ? "sealed"
    : row.intent_state === "synthesizing" && row.intent_lease_token_hash === leaseTokenHash
      ? "execute"
      : "observe";
  return Object.freeze({
    intentId: row.intent_id,
    intentKey: row.intent_key,
    regenerationKey: row.regeneration_key,
    state: row.intent_state,
    role,
    reused: row.intent_id !== requestedIntentId,
    attempt: Number(row.intent_attempt),
    generationId: row.generation_id,
    leaseTokenHash: role === "execute" ? leaseTokenHash : "",
    startedAt: row.intent_started_at,
    updatedAt: row.intent_updated_at,
    completedAt: row.intent_completed_at || null,
    nextAttemptAt: row.intent_next_attempt_at,
    failureCode: row.intent_failure_code || "",
    failureCount: Number(row.intent_failure_count || 0),
    result: row.intent_state === "sealed" ? Object.freeze({
      storageBucket: row.result_storage_bucket,
      objectPath: row.result_object_path,
      mime: row.result_mime,
      byteSize: Number(row.result_byte_size),
      sha256: row.result_sha256,
      objectId: row.result_object_id || "",
      metadata: row.result_metadata || {},
      expiresAt: row.result_expires_at,
    }) : null,
  });
}

async function beginDurableOwnedVoicePreview(db, ownerUserId, values) {
  const requestedIntentId = randomUUID();
  const requestedGenerationId = randomUUID();
  const leaseTokenHash = createHash("sha256")
    .update(`vyakti:voice-preview-lease:v1:${randomUUID()}`)
    .digest("hex");
  const rows = await db(
    `with inference_consent as materialized (
       select c.* from vy_replica_consent c
        where c.replica_id=$1::uuid and c.owner_user_id=$2::uuid and c.scope='inference'
          and c.policy_version=$7 and c.revoked_at is null
          and (c.expires_at is null or c.expires_at>now())
        order by c.granted_at desc limit 1
     ), latest_selection as materialized (
       select distinct on (d.artifact_id) d.artifact_id,d.decision,d.created_at,d.decision_id
         from vy_replica_processing_artifact_decision d
        where d.replica_id=$1::uuid and d.owner_user_id=$2::uuid
        order by d.artifact_id,d.created_at desc,d.decision_id desc
     ), eligible_pool as materialized (
       select r.*,vg.version genome_version,vg.status genome_status,
              a.artifact_id,a.source_id,a.storage_bucket,a.object_path,a.mime,a.byte_size,a.duration_ms,a.sha256,
              a.stage,'selected'::text selection_decision,
              selected.created_at selection_created_at,selected.decision_id selection_decision_id,
              s.state source_state,s.contains_third_parties,
              case when vr.source_id is not null then 'primary' else 'supporting' end voice_role,
              case when script.devanagari_chars>0 and script.latin_chars>0 then 'mixed'
                   when script.devanagari_chars>0 then 'devanagari'
                   when script.latin_chars>0 then 'latin_only' else 'unknown' end reference_language_mode,
              script.transcript_span_count,script.devanagari_chars,script.latin_chars,
              c.consent_id,c.scope consent_scope,c.policy_version consent_policy_version,
              c.granted_at consent_granted_at,c.expires_at consent_expires_at,c.revoked_at consent_revoked_at
         from vy_replica r
         join vy_replica_voice_genome vg on vg.replica_id=r.replica_id and vg.version=$3::int4 and vg.status='draft'
         join vy_replica_processing_artifact a on a.replica_id=r.replica_id and a.owner_user_id=r.owner_user_id
         join latest_selection selected on selected.artifact_id=a.artifact_id and selected.decision='selected'
         join vy_replica_source s on s.source_id=a.source_id and s.replica_id=a.replica_id
          and s.owner_user_id=a.owner_user_id
         left join vy_replica_voice_reference vr on vr.replica_id=s.replica_id
          and vr.owner_user_id=s.owner_user_id and vr.source_id=s.source_id
         left join lateral (
           select count(*)::int transcript_span_count,
                  coalesce(sum(length(regexp_replace(coalesce(e.value->>'text',''), '[^ऀ-ॿ]', '', 'g'))),0)::int devanagari_chars,
                  coalesce(sum(length(regexp_replace(coalesce(e.value->>'text',''), '[^A-Za-z]', '', 'g'))),0)::int latin_chars
             from vy_replica_processing_evidence e
            where e.replica_id=a.replica_id and e.owner_user_id=a.owner_user_id
              and e.source_id=a.source_id and e.evidence_type='transcript_span'
         ) script on true
         cross join inference_consent c
        where r.replica_id=$1::uuid and r.owner_user_id=$2::uuid and r.subject_mode='self'
          and r.lifecycle in ('enrolling','calibrating','ready','active','paused')
          and r.policy_version=$7 and r.age_verified_at is not null and r.identity_verified_at is not null
          and r.liveness_verified_at is not null and r.identity_expires_at>now()
          and vg.version=(select max(current_vg.version) from vy_replica_voice_genome current_vg
                           where current_vg.replica_id=r.replica_id and current_vg.status='draft')
          and a.stage='enhance' and a.mime in ('audio/wav','audio/x-wav')
          and s.state='ready' and s.contains_third_parties=false
          and (vg.definition#>'{references,enrollment_artifact_ids}') ? a.artifact_id::text
          and exists(select 1 from vy_replica_consent x where x.replica_id=r.replica_id
            and x.owner_user_id=r.owner_user_id and x.scope='biometric' and x.policy_version=r.policy_version
            and x.revoked_at is null and (x.expires_at is null or x.expires_at>now()))
          and exists(select 1 from vy_replica_consent x where x.replica_id=r.replica_id
            and x.owner_user_id=r.owner_user_id and x.scope='training' and x.policy_version=r.policy_version
            and x.revoked_at is null and (x.expires_at is null or x.expires_at>now()))
     ), eligible as materialized (
       select * from eligible_pool
        order by case when voice_role='primary' then 0 else 1 end,
                 case when $9='hi' then
                 case when $13 in ('mixed','latin_only') then
                     case reference_language_mode when 'mixed' then 0 when 'devanagari' then 1 when 'latin_only' then 2 else 3 end
                   else
                     case reference_language_mode when 'devanagari' then 0 when 'mixed' then 1 when 'latin_only' then 2 else 3 end
                   end
                 else 0 end,
                 selection_created_at desc,selection_decision_id desc limit 1
     ), desired as materialized (
       select e.*,
              md5(concat_ws(chr(31),'vyakti.voice-preview-intent.v2',$2::text,$1::text,$3::text,
                    e.artifact_id::text,$9::text,$10::text,$14::jsonb->>'planSha256',$8::text,
                    $11::jsonb::text,$12::text)) ||
              md5(concat_ws(chr(31),'vyakti.voice-preview-intent.v2.mirror',$12::text,$11::jsonb::text,
                    $8::text,$14::jsonb->>'planSha256',$10::text,$9::text,e.artifact_id::text,
                    $3::text,$1::text,$2::text)) intent_key
         from eligible e
     ), upserted as (
       insert into vy_replica_voice_preview_intent
         (intent_id,replica_id,owner_user_id,genome_version,preview_artifact_id,language_id,
          text_hash,text_plan_sha256,model_commitment,style,preview_seed,regeneration_key,intent_key,state,attempt,generation_id,
          lease_token_hash,leased_at,lease_expires_at,next_attempt_at,failure_code)
       select $15::uuid,replica_id,owner_user_id,genome_version,artifact_id,$9,$10,
              $14::jsonb->>'planSha256',$8,$11::jsonb,
              $12::int4,$18,intent_key,'synthesizing',1,$16::uuid,$17,now(),
              now()+($19::int4*interval '1 millisecond'),now(),'' from desired
       on conflict (owner_user_id,replica_id,genome_version,preview_artifact_id,language_id,
                    text_hash,text_plan_sha256,model_commitment,style,preview_seed,regeneration_key) do update set
         state=case when
           (vy_replica_voice_preview_intent.state='warming'
             and vy_replica_voice_preview_intent.next_attempt_at<=now())
           or (vy_replica_voice_preview_intent.state='retryable'
             and vy_replica_voice_preview_intent.failure_count<3
             and vy_replica_voice_preview_intent.next_attempt_at<=now())
           or (vy_replica_voice_preview_intent.state='synthesizing'
             and vy_replica_voice_preview_intent.lease_expires_at<=now())
           then 'synthesizing' else vy_replica_voice_preview_intent.state end,
         attempt=case when
           (vy_replica_voice_preview_intent.state='warming'
             and vy_replica_voice_preview_intent.next_attempt_at<=now())
           or (vy_replica_voice_preview_intent.state='retryable'
             and vy_replica_voice_preview_intent.failure_count<3
             and vy_replica_voice_preview_intent.next_attempt_at<=now())
           or (vy_replica_voice_preview_intent.state='synthesizing'
             and vy_replica_voice_preview_intent.lease_expires_at<=now())
           then vy_replica_voice_preview_intent.attempt+1 else vy_replica_voice_preview_intent.attempt end,
         generation_id=case when
           (vy_replica_voice_preview_intent.state='warming'
             and vy_replica_voice_preview_intent.next_attempt_at<=now())
           or (vy_replica_voice_preview_intent.state='retryable'
             and vy_replica_voice_preview_intent.failure_count<3
             and vy_replica_voice_preview_intent.next_attempt_at<=now())
           or (vy_replica_voice_preview_intent.state='synthesizing'
             and vy_replica_voice_preview_intent.lease_expires_at<=now())
           then $16::uuid else vy_replica_voice_preview_intent.generation_id end,
         lease_token_hash=case when
           (vy_replica_voice_preview_intent.state='warming'
             and vy_replica_voice_preview_intent.next_attempt_at<=now())
           or (vy_replica_voice_preview_intent.state='retryable'
             and vy_replica_voice_preview_intent.failure_count<3
             and vy_replica_voice_preview_intent.next_attempt_at<=now())
           or (vy_replica_voice_preview_intent.state='synthesizing'
             and vy_replica_voice_preview_intent.lease_expires_at<=now())
           then $17 else vy_replica_voice_preview_intent.lease_token_hash end,
         leased_at=case when
           (vy_replica_voice_preview_intent.state='warming'
             and vy_replica_voice_preview_intent.next_attempt_at<=now())
           or (vy_replica_voice_preview_intent.state='retryable'
             and vy_replica_voice_preview_intent.failure_count<3
             and vy_replica_voice_preview_intent.next_attempt_at<=now())
           or (vy_replica_voice_preview_intent.state='synthesizing'
             and vy_replica_voice_preview_intent.lease_expires_at<=now())
           then now() else vy_replica_voice_preview_intent.leased_at end,
         lease_expires_at=case when
           (vy_replica_voice_preview_intent.state='warming'
             and vy_replica_voice_preview_intent.next_attempt_at<=now())
           or (vy_replica_voice_preview_intent.state='retryable'
             and vy_replica_voice_preview_intent.failure_count<3
             and vy_replica_voice_preview_intent.next_attempt_at<=now())
           or (vy_replica_voice_preview_intent.state='synthesizing'
             and vy_replica_voice_preview_intent.lease_expires_at<=now())
           then now()+($19::int4*interval '1 millisecond') else vy_replica_voice_preview_intent.lease_expires_at end,
         failure_code=case when
           (vy_replica_voice_preview_intent.state='warming'
             and vy_replica_voice_preview_intent.next_attempt_at<=now())
           or (vy_replica_voice_preview_intent.state='retryable'
             and vy_replica_voice_preview_intent.failure_count<3
             and vy_replica_voice_preview_intent.next_attempt_at<=now())
           or (vy_replica_voice_preview_intent.state='synthesizing'
             and vy_replica_voice_preview_intent.lease_expires_at<=now())
           then '' else vy_replica_voice_preview_intent.failure_code end,
         updated_at=case when
           (vy_replica_voice_preview_intent.state='warming'
             and vy_replica_voice_preview_intent.next_attempt_at<=now())
           or (vy_replica_voice_preview_intent.state='retryable'
             and vy_replica_voice_preview_intent.failure_count<3
             and vy_replica_voice_preview_intent.next_attempt_at<=now())
           or (vy_replica_voice_preview_intent.state='synthesizing'
             and vy_replica_voice_preview_intent.lease_expires_at<=now())
           then now() else vy_replica_voice_preview_intent.updated_at end
       returning *
     ), expired_generation as (
       update vy_replica_generation g set state='aborted',failure_code='preview_intent_lease_expired',updated_at=now()
         from upserted i
        where g.preview_intent_id=i.intent_id and g.replica_id=i.replica_id
          and g.owner_user_id=i.owner_user_id and g.generation_id<>i.generation_id
          and g.state in ('authorized','streaming')
       returning g.generation_id
     ), inserted_generation as (
       insert into vy_replica_generation
         (generation_id,replica_id,owner_user_id,voice_profile_id,genome_version,profile_version,calibration_version,
          dialogue_turn_id,channel,purpose,policy_version,trace_id,state,disclosure_scheme,
          watermark_algorithm,provenance_standard,preview_artifact_id,preview_model,preview_model_commitment,
          preview_language_id,preview_text_hash,preview_style,preview_seed,preview_trial_id,preview_trial_side,
          preview_intent_id,preview_intent_attempt,preview_regeneration_key,
          preview_result_storage_bucket,preview_result_object_path)
       select i.generation_id,d.replica_id,d.owner_user_id,null,d.genome_version,null,null,null,
              'studio_preview','voice_preview',$4,$5,'authorized','audible-prefix-v1','pending','c2pa-2.4',
              d.artifact_id,$6,$8,$9,$10,
              $11::jsonb || jsonb_build_object(
                'text_language_mode',$13::text,'text_frontend',$14::jsonb,
                'reference_language_mode',d.reference_language_mode,
                'reference_language_evidence_scope',case when d.transcript_span_count>0 then 'source_transcript' else 'unverified' end,
                'conditioning_contract','vyakti-voice-language-conditioning/v1',
                'effective_cfg_weight',case when $9='hi' and d.reference_language_mode in ('latin_only','unknown')
                                            then 0 else ($11::jsonb->>'cfg_weight')::double precision end),
              $12::int4,null,null,i.intent_id,i.attempt,i.regeneration_key,$20,
              d.owner_user_id::text||'/'||d.replica_id::text||'/'||d.source_id::text||
                '/derived/voice-preview/'||i.generation_id::text||'.wav'
         from upserted i join desired d on d.replica_id=i.replica_id and d.artifact_id=i.preview_artifact_id
        where i.generation_id=$16::uuid and i.lease_token_hash=$17 and i.state='synthesizing'
          and (select count(*) from expired_generation)>=0
       on conflict (preview_intent_id,preview_intent_attempt) where preview_intent_id is not null do nothing
       returning generation_id
     )
     select i.generation_id,d.replica_id,d.owner_user_id,d.genome_version,
            'studio_preview'::text channel,'voice_preview'::text purpose,$4::text policy_version,
            $5::text trace_id,$8::text preview_model_commitment,
            $20::text preview_result_storage_bucket,
            d.owner_user_id::text||'/'||d.replica_id::text||'/'||d.source_id::text||
              '/derived/voice-preview/'||i.generation_id::text||'.wav' preview_result_object_path,
            d.subject_mode,d.lifecycle,d.policy_version replica_policy_version,
            d.age_verified_at,d.identity_verified_at,d.liveness_verified_at,d.identity_expires_at,
            d.artifact_id,d.source_id,d.storage_bucket,d.object_path,d.mime,d.byte_size,d.duration_ms,d.sha256,d.stage,
            d.reference_language_mode,d.transcript_span_count,d.devanagari_chars,d.latin_chars,
            d.selection_decision,d.source_state,d.contains_third_parties,d.voice_role,d.genome_status,
            d.consent_id,d.consent_scope,d.consent_policy_version,d.consent_granted_at,
            d.consent_expires_at,d.consent_revoked_at,
            i.intent_id,i.intent_key,i.regeneration_key,i.state intent_state,i.attempt intent_attempt,
            i.lease_token_hash intent_lease_token_hash,i.started_at intent_started_at,
            i.updated_at intent_updated_at,i.completed_at intent_completed_at,
            i.next_attempt_at intent_next_attempt_at,i.failure_code intent_failure_code,
            i.failure_count intent_failure_count,
            i.result_storage_bucket,i.result_object_path,i.result_mime,i.result_byte_size,
            i.result_sha256,i.result_object_id,i.result_metadata,i.result_expires_at
       from upserted i join desired d on d.replica_id=i.replica_id and d.artifact_id=i.preview_artifact_id
      where (select count(*) from inserted_generation)>=0`,
    [values.rid, ownerUserId, values.genomeVersion, PROVENANCE_POLICY, values.traceId,
      "open_chatterbox_multilingual_v3", REPLICA_POLICY_VERSION, OPEN_CHATTERBOX_MODEL_COMMITMENT,
      values.languageId, values.textHash, JSON.stringify(values.previewStyle), values.previewSeed,
      values.textLanguageMode, JSON.stringify(values.textFrontend), requestedIntentId,
      requestedGenerationId, leaseTokenHash, values.regenerationKey, PREVIEW_INTENT_LEASE_MS,
      values.outputStorageBucket],
  );
  if (!rows[0]) {
    const [code, cls] = await diagnoseVoicePreviewRefusal(db, ownerUserId, values.rid, values.genomeVersion);
    throw Object.assign(new Error(code), { code, status: 409, blockerClass: cls });
  }
  return { row: rows[0], intent: previewIntentRow(rows[0], requestedIntentId, leaseTokenHash) };
}

function startedVoicePreview(row, previewStyle, previewSeed, languageId, textLanguageMode, textFrontend, intent = null) {
  const authorizationInput = {
    request: {
      generationId: row.generation_id,
      replicaId: row.replica_id,
      ownerUserId: row.owner_user_id,
      channel: row.channel,
      purpose: row.purpose,
      policyVersion: row.policy_version,
      traceId: row.trace_id,
    },
    replica: {
      replica_id: row.replica_id,
      owner_user_id: row.owner_user_id,
      subject_mode: row.subject_mode,
      lifecycle: row.lifecycle,
      policy_version: row.replica_policy_version,
      age_verified_at: row.age_verified_at,
      identity_verified_at: row.identity_verified_at,
      liveness_verified_at: row.liveness_verified_at,
      identity_expires_at: row.identity_expires_at,
    },
    inferenceConsent: {
      consent_id: row.consent_id,
      replica_id: row.replica_id,
      owner_user_id: row.owner_user_id,
      scope: row.consent_scope,
      policy_version: row.consent_policy_version,
      granted_at: row.consent_granted_at,
      expires_at: row.consent_expires_at,
      revoked_at: row.consent_revoked_at,
    },
    voiceGenome: { replica_id: row.replica_id, version: Number(row.genome_version), status: row.genome_status },
    previewArtifact: {
      artifact_id: row.artifact_id,
      replica_id: row.replica_id,
      owner_user_id: row.owner_user_id,
      source_id: row.source_id,
      stage: row.stage,
      selection_decision: row.selection_decision,
      source_state: row.source_state,
      contains_third_parties: row.contains_third_parties,
      sha256: row.sha256,
    },
  };
  const authorization = assertVoicePreviewAuthorization(authorizationInput);
  const transcriptSpanCount = Number(row.transcript_span_count || 0);
  const referenceLanguageEvidenceScope = transcriptSpanCount > 0 ? "source_transcript" : "unverified";
  const voiceConditioning = voiceLanguageConditioning({
    languageId,
    referenceLanguageMode: row.reference_language_mode || "unknown",
    referenceLanguageEvidenceScope,
    textLanguageMode,
    requestedCfgWeight: previewStyle.cfg_weight,
    disclosureLanguageId: textFrontend.disclosureLanguage,
  });
  return Object.freeze({
    generation: row,
    intent,
    authorizationInput,
    authorization,
    previewStyle,
    previewSeed,
    voiceConditioning,
    reference: Object.freeze({
      artifactId: row.artifact_id,
      sourceId: row.source_id,
      storageBucket: row.storage_bucket,
      objectPath: row.object_path,
      mime: row.mime,
      byteSize: Number(row.byte_size),
      durationMs: Number(row.duration_ms),
      sha256: row.sha256,
      languageMode: voiceConditioning.referenceLanguageMode,
      languageEvidenceScope: referenceLanguageEvidenceScope,
      transcriptSpanCount,
      devanagariChars: Number(row.devanagari_chars || 0),
      latinChars: Number(row.latin_chars || 0),
    }),
  });
}

function previewFailureCode(value, fallback) {
  return String(value?.code || value?.message || value || fallback)
    .replace(/[^a-z0-9_.:-]/gi, "_").slice(0, 120);
}

export async function markVoicePreviewIntentWarming(db, ownerUserId, started, reason) {
  if (!started?.intent || started.intent.role !== "execute") return false;
  const code = previewFailureCode(reason, "voice_preview_warming");
  const rows = await db(
    `with generation_closed as (
       update vy_replica_generation g
          set state=case when g.state='sealed' then g.state else 'aborted' end,
              failure_code=case when g.state='sealed' then g.failure_code else $6 end,updated_at=now()
        where g.generation_id=$3::uuid and g.replica_id=$4::uuid and g.owner_user_id=$2::uuid
          and g.preview_intent_id=$1::uuid and g.preview_intent_attempt=$5::int4
       returning g.generation_id
     )
     update vy_replica_voice_preview_intent i
        set state='warming',lease_token_hash='',leased_at=null,lease_expires_at=null,
            next_attempt_at=now()+($8::int4*interval '1 millisecond'),failure_code=$6,updated_at=now()
      where i.intent_id=$1::uuid and i.owner_user_id=$2::uuid and i.replica_id=$4::uuid
        and i.generation_id=$3::uuid and i.attempt=$5::int4 and i.state='synthesizing'
        and i.lease_token_hash=$7 and (select count(*) from generation_closed)>=0
      returning i.intent_id`,
    [started.intent.intentId, ownerUserId, started.generation.generation_id,
      started.generation.replica_id, started.intent.attempt, code, started.intent.leaseTokenHash,
      PREVIEW_INTENT_RETRY_MS],
  );
  return rows.length === 1;
}

export async function markVoicePreviewIntentRetryable(db, ownerUserId, started, error) {
  if (!started?.intent || started.intent.role !== "execute") return false;
  const code = previewFailureCode(error, "voice_preview_failed");
  const rows = await db(
    `with generation_closed as (
       update vy_replica_generation g
          set state=case when g.state='sealed' then g.state else 'failed' end,
              failure_code=case when g.state='sealed' then g.failure_code else $6 end,updated_at=now()
        where g.generation_id=$3::uuid and g.replica_id=$4::uuid and g.owner_user_id=$2::uuid
          and g.preview_intent_id=$1::uuid and g.preview_intent_attempt=$5::int4
       returning g.generation_id
     )
     update vy_replica_voice_preview_intent i
        set state=case when i.failure_count>=2 then 'failed' else 'retryable' end,
            failure_count=least(3,i.failure_count+1),lease_token_hash='',leased_at=null,lease_expires_at=null,
            next_attempt_at=now()+($8::int4*interval '1 millisecond'),failure_code=$6,updated_at=now()
      where i.intent_id=$1::uuid and i.owner_user_id=$2::uuid and i.replica_id=$4::uuid
        and i.generation_id=$3::uuid and i.attempt=$5::int4 and i.state='synthesizing'
        and i.lease_token_hash=$7 and (select count(*) from generation_closed)>=0
      returning i.intent_id`,
    [started.intent.intentId, ownerUserId, started.generation.generation_id,
      started.generation.replica_id, started.intent.attempt, code, started.intent.leaseTokenHash,
      PREVIEW_INTENT_RETRY_MS],
  );
  return rows.length === 1;
}

export async function markVoicePreviewIntentFailed(db, ownerUserId, started, error) {
  if (!started?.intent || started.intent.role !== "execute") return false;
  const code = previewFailureCode(error, "voice_preview_failed");
  const rows = await db(
    `with generation_closed as (
       update vy_replica_generation g
          set state=case when g.state='sealed' then g.state else 'failed' end,
              failure_code=case when g.state='sealed' then g.failure_code else $6 end,updated_at=now()
        where g.generation_id=$3::uuid and g.replica_id=$4::uuid and g.owner_user_id=$2::uuid
          and g.preview_intent_id=$1::uuid and g.preview_intent_attempt=$5::int4
       returning g.generation_id
     )
     update vy_replica_voice_preview_intent i
        set state='failed',failure_count=3,lease_token_hash='',leased_at=null,lease_expires_at=null,
            failure_code=$6,updated_at=now()
      where i.intent_id=$1::uuid and i.owner_user_id=$2::uuid and i.replica_id=$4::uuid
        and i.generation_id=$3::uuid and i.attempt=$5::int4 and i.state='synthesizing'
        and i.lease_token_hash=$7 and (select count(*) from generation_closed)>=0
      returning i.intent_id`,
    [started.intent.intentId, ownerUserId, started.generation.generation_id,
      started.generation.replica_id, started.intent.attempt, code, started.intent.leaseTokenHash],
  );
  return rows.length === 1;
}

export async function renewVoicePreviewIntentLease(db, ownerUserId, started, leaseMs = 420_000) {
  if (!started?.intent || started.intent.role !== "execute") return false;
  // The HTTP request is bounded to 240 s and the final private write to 60 s.
  // Keep the durable writer fence beyond both bounds plus cancellation and
  // provider acknowledgement uncertainty so erasure cannot sweep first.
  const boundedMs = Math.max(360_000, Math.min(600_000, Number(leaseMs || 420_000)));
  const rows = await db(
    `update vy_replica_voice_preview_intent i
        set lease_expires_at=now()+($7::int4*interval '1 millisecond'),updated_at=now()
      where i.intent_id=$1::uuid and i.owner_user_id=$2::uuid and i.replica_id=$4::uuid
        and i.generation_id=$3::uuid and i.attempt=$5::int4 and i.state='synthesizing'
        and i.lease_token_hash=$6 and i.lease_expires_at>now()
        and exists (
          select 1 from vy_replica_processing_artifact a
          join vy_replica_source s on s.source_id=a.source_id and s.replica_id=a.replica_id
           and s.owner_user_id=a.owner_user_id
         where a.artifact_id=i.preview_artifact_id and a.replica_id=i.replica_id
           and a.owner_user_id=i.owner_user_id and s.state='ready'
        )
        and exists(select 1 from vy_replica_generation g
          where g.generation_id=$3::uuid and g.replica_id=$4::uuid and g.owner_user_id=$2::uuid
            and g.preview_intent_id=$1::uuid and g.preview_intent_attempt=$5::int4
            and g.state in ('authorized','streaming','sealed'))
      returning i.intent_id,i.lease_expires_at`,
    [started.intent.intentId, ownerUserId, started.generation.generation_id,
      started.generation.replica_id, started.intent.attempt, started.intent.leaseTokenHash,
      boundedMs],
  );
  return rows.length === 1;
}

export async function sealVoicePreviewIntent(db, ownerUserId, started, result) {
  if (!started?.intent || started.intent.role !== "execute") fail("voice_preview_intent_lease_required", 409);
  const storageBucket = String(result?.storageBucket || "");
  const objectPath = String(result?.objectPath || "");
  const mime = String(result?.mime || "").toLowerCase();
  const byteSize = Number(result?.byteSize);
  const sha256 = String(result?.sha256 || "").toLowerCase();
  const objectId = String(result?.objectId || "").slice(0, 512);
  const metadata = result?.metadata && typeof result.metadata === "object" && !Array.isArray(result.metadata)
    ? result.metadata : {};
  if (!storageBucket || !objectPath || mime !== "audio/wav" || !Number.isSafeInteger(byteSize) ||
      byteSize < 45 || byteSize > 67_108_864 || !SHA256.test(sha256) ||
      Buffer.byteLength(JSON.stringify(metadata)) > 2_048) {
    fail("voice_preview_result_invalid", 500);
  }
  return one(await db(
    `update vy_replica_voice_preview_intent i
        set state='sealed',lease_token_hash='',leased_at=null,lease_expires_at=null,
            failure_code='',result_storage_bucket=$6,result_object_path=$7,result_mime=$8,
            result_byte_size=$9::int8,result_sha256=$10,result_object_id=nullif($11,''),
            result_metadata=$12::jsonb,result_expires_at=now()+interval '7 days',completed_at=now(),updated_at=now()
      where i.intent_id=$1::uuid and i.owner_user_id=$2::uuid and i.replica_id=$4::uuid
        and i.generation_id=$3::uuid and i.attempt=$5::int4 and i.state='synthesizing'
        and i.lease_token_hash=$13 and i.lease_expires_at>now()
        and exists (
          select 1 from vy_replica_processing_artifact a
          join vy_replica_source s on s.source_id=a.source_id and s.replica_id=a.replica_id
           and s.owner_user_id=a.owner_user_id
         where a.artifact_id=i.preview_artifact_id and a.replica_id=i.replica_id
           and a.owner_user_id=i.owner_user_id and s.state='ready'
        )
        and exists(select 1 from vy_replica_generation g
          where g.generation_id=i.generation_id and g.replica_id=i.replica_id
            and g.owner_user_id=i.owner_user_id and g.state='sealed'
            and g.audio_sha256 is not null and g.ledger_envelope_hash is not null)
      returning i.intent_id,i.generation_id,i.completed_at`,
    [started.intent.intentId, ownerUserId, started.generation.generation_id,
      started.generation.replica_id, started.intent.attempt, storageBucket, objectPath, mime,
      byteSize, sha256, objectId, JSON.stringify(metadata), started.intent.leaseTokenHash],
  ), "voice_preview_intent_seal_denied");
}

export async function expireVoicePreviewIntent(db, ownerUserId, started) {
  if (!started?.intent || started.intent.role !== "sealed" || !started.intent.result) return null;
  const rows = await db(
    `with expired as materialized (
       select i.intent_id,i.result_storage_bucket,i.result_object_path,i.result_sha256
         from vy_replica_voice_preview_intent i
        where i.intent_id=$1::uuid and i.owner_user_id=$2::uuid and i.replica_id=$3::uuid
          and i.generation_id=$4::uuid and i.state='sealed' and i.result_object_path=$5
          and i.result_sha256=$6 and i.result_expires_at<=now()
        for update
     )
     update vy_replica_voice_preview_intent i
        set state='retryable',failure_code='voice_preview_result_expired',
            result_storage_bucket=null,result_object_path=null,result_mime=null,result_byte_size=null,
            result_sha256=null,result_object_id=null,result_metadata='{}'::jsonb,result_expires_at=null,
            completed_at=null,next_attempt_at=now(),updated_at=now()
       from expired e where i.intent_id=e.intent_id
      returning e.result_storage_bucket,e.result_object_path,e.result_sha256`,
    [started.intent.intentId, ownerUserId, started.generation.replica_id,
      started.generation.generation_id, started.intent.result.objectPath, started.intent.result.sha256],
  );
  if (!rows[0]) return null;
  return Object.freeze({
    storageBucket: rows[0].result_storage_bucket,
    objectPath: rows[0].result_object_path,
    sha256: rows[0].result_sha256,
  });
}

// A cold GPU is an expected transport state, not a broken generation. Keep the
// authorization audit row, but close it as `aborted` so reliability metrics and
// owner-facing activity never count an ordinary warm-up poll as a failed clone.
// The named reason remains available for cold-start timing and operations.
export async function markVoicePreviewAborted(db, ownerUserId, generationId, reason) {
  const code = String(reason?.code || reason?.message || "voice_preview_warming").replace(/[^a-z0-9_.:-]/gi, "_").slice(0, 120);
  await db(
    `update vy_replica_generation set state=case when state='sealed' then state else 'aborted' end,
            failure_code=case when state='sealed' then failure_code else $3 end,updated_at=now()
      where generation_id=$1::uuid and owner_user_id=$2::uuid and purpose='voice_preview'`,
    [generationId, ownerUserId, code],
  ).catch(() => []);
}

function one(rows, code) {
  if (!rows?.[0]) fail(code);
  return rows[0];
}

export function createNeonVoicePreviewLedger(db) {
  if (typeof db !== "function") fail("voice_preview_ledger_db_required", 500);
  return Object.freeze({
    name: "neon-voice-preview-ledger",
    async open(input) {
      return one(await db(
        `update vy_replica_generation g set state='streaming',streaming_at=coalesce(streaming_at,now()),
                disclosure_scheme=$4,watermark_algorithm=$5,provenance_standard=$6,
                watermark_token_hash=$7,updated_at=now()
           from vy_replica r
          where g.generation_id=$1::uuid and g.replica_id=$2::uuid and g.owner_user_id=$3::uuid
            and r.replica_id=g.replica_id and r.owner_user_id=g.owner_user_id
            and g.state='authorized' and ${PREVIEW_FENCE}
          returning g.generation_id`,
        [input.generationId,input.replicaId,input.ownerUserId,input.disclosureScheme,
          input.watermarkAlgorithm,input.provenanceStandard,input.watermarkTokenHash],
      ), "voice_preview_open_denied");
    },
    async appendSegment({ authorization, receipt }) {
      return one(await db(
        `insert into vy_replica_generation_segment_receipt
           (generation_id,sequence,byte_offset,byte_length,segment_sha256,previous_chain_sha256,
            chain_sha256,signature_algorithm,signer_key_id,chain_signature,issued_at)
         select $1::uuid,$4::int4,$5::int8,$6::int4,$7,$8,$9,$10,$11,$12,$13::timestamptz
           from vy_replica_generation g
           join vy_replica r on r.replica_id=g.replica_id and r.owner_user_id=g.owner_user_id
          where g.generation_id=$1::uuid and g.replica_id=$2::uuid and g.owner_user_id=$3::uuid
            and g.state='streaming' and ${PREVIEW_FENCE}
         on conflict (generation_id,sequence) do update
           set issued_at=vy_replica_generation_segment_receipt.issued_at
         where vy_replica_generation_segment_receipt.byte_offset=excluded.byte_offset
           and vy_replica_generation_segment_receipt.byte_length=excluded.byte_length
           and vy_replica_generation_segment_receipt.segment_sha256=excluded.segment_sha256
           and vy_replica_generation_segment_receipt.previous_chain_sha256=excluded.previous_chain_sha256
           and vy_replica_generation_segment_receipt.chain_sha256=excluded.chain_sha256
           and vy_replica_generation_segment_receipt.chain_signature=excluded.chain_signature
         returning generation_id,sequence`,
        [authorization.generationId,authorization.replicaId,authorization.ownerUserId,
          receipt.sequence,receipt.byte_offset,receipt.byte_length,receipt.segment_sha256,
          receipt.previous_chain_sha256,receipt.chain_sha256,receipt.signature_algorithm,
          receipt.signer_key_id,receipt.chain_signature,receipt.issued_at],
      ), "voice_preview_revoked_or_segment_replayed");
    },
    async seal({ authorization, receipt, envelopeCanonical, audioHash, watermarkTokenHash, manifestHash, segmentCount, finalChainSha256, sealedAt }) {
      if (typeof envelopeCanonical !== "string" || Buffer.byteLength(envelopeCanonical) < 128 || Buffer.byteLength(envelopeCanonical) > 16_384)
        fail("voice_preview_public_envelope_invalid", 500);
      return one(await db(
        `with sealed as (
           update vy_replica_generation g set state='sealed',audio_sha256=$4,watermark_token_hash=$5,
                  manifest_sha256=$6,ledger_envelope_hash=$7,segment_count=$8::int4,final_chain_sha256=$9,
                  sealed_at=$10::timestamptz,updated_at=now()
             from vy_replica r
            where g.generation_id=$1::uuid and g.replica_id=$2::uuid and g.owner_user_id=$3::uuid
              and r.replica_id=g.replica_id and r.owner_user_id=g.owner_user_id
              and g.state='streaming' and ${PREVIEW_FENCE}
           returning g.generation_id
         ), public_receipt as (
           insert into vy_replica_generation_receipt
             (generation_id,replica_commitment,policy_version,channel,disclosure_scheme,
              disclosure_text_hash,watermark_algorithm,watermark_token_hash,detector_policy_hash,
              provenance_standard,manifest_location,manifest_sha256,audio_sha256,segment_count,
              final_chain_sha256,envelope_sha256,signature_algorithm,signer_key_id,envelope_signature,issued_at)
           select $1::uuid,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$6,$4,$8::int4,$9,$7,$21,$22,$23,$24::timestamptz
             from sealed returning generation_id
         ), public_envelope as (
           insert into vy_replica_generation_receipt_envelope
             (generation_id,envelope_sha256,envelope_canonical)
           select generation_id,$7,decode($25,'base64') from public_receipt
           returning generation_id
         ) select generation_id from public_envelope`,
        [authorization.generationId,authorization.replicaId,authorization.ownerUserId,audioHash,
          watermarkTokenHash,manifestHash,receipt.envelope_sha256,segmentCount,finalChainSha256,sealedAt,
          receipt.replica_commitment,receipt.policy_version,receipt.channel,receipt.disclosure_scheme,
          receipt.disclosure_text_hash,receipt.watermark_algorithm,receipt.watermark_token_hash,
          receipt.detector_policy_hash,receipt.provenance_standard,receipt.manifest_location,
          receipt.signature_algorithm,receipt.signer_key_id,receipt.envelope_signature,receipt.issued_at,
          Buffer.from(envelopeCanonical).toString("base64")],
      ), "voice_preview_seal_denied");
    },
    async abort(input) {
      await db(
        `update vy_replica_generation set state=case when state='sealed' then state else 'aborted' end,
                failure_code=case when state='sealed' then failure_code else $4 end,updated_at=now()
          where generation_id=$1::uuid and replica_id=$2::uuid and owner_user_id=$3::uuid and purpose='voice_preview'`,
        [input.generationId,input.replicaId,input.ownerUserId,String(input.failureCode || "voice_preview_aborted").slice(0,120)],
      );
    },
  });
}

export function voicePreviewReceiptCommitment(value) {
  return canonicalJson({
    generation_id: value.generation.generation_id,
    genome_version: Number(value.generation.genome_version),
    artifact_id: value.reference.artifactId,
    reference_sha256: value.reference.sha256,
    model_commitment: value.generation.preview_model_commitment,
  });
}
