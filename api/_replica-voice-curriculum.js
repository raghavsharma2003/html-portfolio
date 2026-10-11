import { randomUUID } from "node:crypto";
import { replicaId, REPLICA_POLICY_VERSION } from "./_replica.js";
import { canonicalJson, sha256Hex } from "./_provenance/contracts.js";
import {
  voicePreviewMatchedSeed,
  voicePreviewStyle,
  voicePreviewTextHash,
} from "./_replica-voice-preview.js";
import { OPEN_CHATTERBOX_MODEL_COMMITMENT } from "./_voice/providers/open-chatterbox-preview.js";

export const VOICE_CURRICULUM_ALGORITHM = "voice-curriculum/bt-active-v2";
export const VOICE_CALIBRATION_DECK_VERSION = "voice-calibration-deck/v1";
export const VOICE_CALIBRATION_REQUIRED_PROMPTS = 6;
export const VOICE_TRIAL_STYLE_KEYS = Object.freeze([
  "identity_anchor",
  "faithful",
  "steady_warm",
  "balanced",
  "warm_expressive",
  "expressive",
  "animated",
]);

export const VOICE_CALIBRATION_PROMPTS = Object.freeze({
  en: Object.freeze([
    Object.freeze({ key: "en.identity-neutral.v1", domain: "identity", text: "The morning light moved slowly across the room while I finished my tea." }),
    Object.freeze({ key: "en.question-rise.v1", domain: "prosody", text: "Did you really leave the blue notebook beside the window, or did I imagine that?" }),
    Object.freeze({ key: "en.numbers-dates.v1", domain: "precision", text: "On Friday, August twenty eighth, call me at seven forty five in the evening." }),
    Object.freeze({ key: "en.warm-memory.v1", domain: "emotion", text: "I still smile when I remember that ridiculous song we sang on the way home." }),
    Object.freeze({ key: "en.consonant-density.v1", domain: "articulation", text: "Bright copper cups clicked softly as Priya packed the picnic basket." }),
    Object.freeze({ key: "en.pause-repair.v1", domain: "rhythm", text: "I thought I knew the answer, but wait, let me say that again more carefully." }),
    Object.freeze({ key: "en.long-arc.v1", domain: "breath", text: "Even when the plan changes at the last minute, I like to pause, look at what still matters, and choose the next small step." }),
  ]),
  hi: Object.freeze([
    Object.freeze({ key: "hi.identity-neutral.v1", domain: "identity", text: "सुबह की रोशनी धीरे धीरे कमरे में आई और मैं चाय खत्म करता रहा।" }),
    Object.freeze({ key: "hi.hinglish-switch.v1", domain: "code_switch", text: "Honestly, mujhe laga plan simple hoga, lekin last moment par sab kuch change ho gaya." }),
    Object.freeze({ key: "hi.numbers-dates.v1", domain: "precision", text: "शुक्रवार, अट्ठाईस अगस्त को शाम सात बजकर पैंतालीस मिनट पर मुझे फोन करना।" }),
    Object.freeze({ key: "hi.warm-memory.v1", domain: "emotion", text: "वो पुराना गाना याद आते ही आज भी अपने आप चेहरे पर मुस्कान आ जाती है।" }),
    Object.freeze({ key: "hi.honorific-question.v1", domain: "prosody", text: "आप सच में कल इतनी दूर से सिर्फ मुझसे मिलने आए थे?" }),
    Object.freeze({ key: "hi.pause-repair.v1", domain: "rhythm", text: "मुझे लगा जवाब पता है, लेकिन रुको, मैं इसे फिर से ठीक तरह से कहता हूँ।" }),
    Object.freeze({ key: "hi.long-arc.v1", domain: "breath", text: "जब आखिरी पल में योजना बदल जाती है, तब मैं थोड़ा रुककर सोचता हूँ कि अभी सबसे ज़रूरी बात क्या है।" }),
  ]),
});

const STYLE_SET = new Set(VOICE_TRIAL_STYLE_KEYS);
const LANGUAGES = new Set(["en", "hi"]);
const SHA256 = /^[0-9a-f]{64}$/;
const SIDES = new Set(["left", "right"]);
const BOOTSTRAP = Object.freeze([
  Object.freeze(["faithful", "balanced"]),
  Object.freeze(["balanced", "expressive"]),
  Object.freeze(["identity_anchor", "steady_warm"]),
  Object.freeze(["warm_expressive", "animated"]),
  Object.freeze(["steady_warm", "warm_expressive"]),
]);

function fail(code, status = 400) {
  throw Object.assign(new Error(code), { code, status });
}

function validHistoryRow(row) {
  return STYLE_SET.has(row?.left_style_key) && STYLE_SET.has(row?.right_style_key) &&
    row.left_style_key !== row.right_style_key && ["left", "right", "tie", "neither"].includes(row?.choice);
}

function pairKey(left, right) {
  return [left, right].sort().join(":");
}

function deterministicUnit(value) {
  return Number.parseInt(sha256Hex(value).slice(0, 12), 16) / 0xffffffffffff;
}

function promptBucket(row) {
  return String(row?.prompt_key || row?.text_hash || "legacy:unknown");
}

export function recommendVoiceCalibrationPrompt(history, languageId, seedMaterial = "") {
  const language = String(languageId || "").toLowerCase();
  const prompts = VOICE_CALIBRATION_PROMPTS[language];
  if (!prompts) fail("voice_trial_language_invalid");
  const exposure = new Map(prompts.map((prompt) => [prompt.key, 0]));
  for (const row of Array.isArray(history) ? history : []) {
    if (exposure.has(row?.prompt_key)) exposure.set(row.prompt_key, exposure.get(row.prompt_key) + 1);
  }
  return [...prompts].sort((one, two) =>
    exposure.get(one.key) - exposure.get(two.key) ||
    deterministicUnit(`${seedMaterial}:${one.key}`) - deterministicUnit(`${seedMaterial}:${two.key}`) ||
    one.key.localeCompare(two.key))[0];
}

export function recommendVoiceTrial(history, seedMaterial = "") {
  const rows = Array.isArray(history) ? history.filter(validHistoryRow) : [];
  const ratings = Object.fromEntries(VOICE_TRIAL_STYLE_KEYS.map((key) => [key, 0]));
  const exposures = Object.fromEntries(VOICE_TRIAL_STYLE_KEYS.map((key) => [key, 0]));
  const rejections = Object.fromEntries(VOICE_TRIAL_STYLE_KEYS.map((key) => [key, 0]));
  const pairCounts = new Map();
  const promptCounts = new Map();
  const uniquePrompts = new Set();
  for (const row of rows) {
    const bucket = promptBucket(row);
    promptCounts.set(bucket, (promptCounts.get(bucket) || 0) + 1);
    uniquePrompts.add(bucket);
  }
  for (const row of rows) {
    exposures[row.left_style_key]++;
    exposures[row.right_style_key]++;
    const key = pairKey(row.left_style_key, row.right_style_key);
    pairCounts.set(key, (pairCounts.get(key) || 0) + 1);
    if (row.choice === "neither") {
      const weight = Math.max(0, Math.min(1, Number(row.confidence ?? 1))) /
        Math.sqrt(promptCounts.get(promptBucket(row)) || 1);
      rejections[row.left_style_key] += weight;
      rejections[row.right_style_key] += weight;
    }
  }

  // Deterministic Bradley-Terry maximum-a-posteriori fit. Ties carry half a
  // win to each side; "neither" is retained as rejection evidence but cannot
  // invent a relative winner.
  for (let iteration = 0; iteration < 96; iteration++) {
    const gradient = Object.fromEntries(VOICE_TRIAL_STYLE_KEYS.map((key) => [key, -0.025 * ratings[key]]));
    for (const row of rows) {
      if (row.choice === "neither") continue;
      const weight = Math.max(0, Math.min(1, Number(row.confidence ?? 1))) /
        Math.sqrt(promptCounts.get(promptBucket(row)) || 1);
      const target = row.choice === "left" ? 1 : row.choice === "right" ? 0 : 0.5;
      const delta = Math.max(-12, Math.min(12, ratings[row.left_style_key] - ratings[row.right_style_key]));
      const probability = 1 / (1 + Math.exp(-delta));
      const error = weight * (target - probability);
      gradient[row.left_style_key] += error;
      gradient[row.right_style_key] -= error;
    }
    const step = 0.22 / Math.sqrt(iteration + 1);
    for (const key of VOICE_TRIAL_STYLE_KEYS) ratings[key] += step * gradient[key];
    const center = VOICE_TRIAL_STYLE_KEYS.reduce((sum, key) => sum + ratings[key], 0) / VOICE_TRIAL_STYLE_KEYS.length;
    for (const key of VOICE_TRIAL_STYLE_KEYS) ratings[key] -= center;
  }

  let pair;
  if (rows.length < BOOTSTRAP.length) {
    pair = [...BOOTSTRAP[rows.length]];
  } else {
    const candidates = [];
    for (let leftIndex = 0; leftIndex < VOICE_TRIAL_STYLE_KEYS.length; leftIndex++) {
      for (let rightIndex = leftIndex + 1; rightIndex < VOICE_TRIAL_STYLE_KEYS.length; rightIndex++) {
        const left = VOICE_TRIAL_STYLE_KEYS[leftIndex];
        const right = VOICE_TRIAL_STYLE_KEYS[rightIndex];
        const delta = Math.max(-12, Math.min(12, ratings[left] - ratings[right]));
        const probability = 1 / (1 + Math.exp(-delta));
        const fisherInformation = probability * (1 - probability);
        const uncertainty = 1 / Math.sqrt(exposures[left] + 1) + 1 / Math.sqrt(exposures[right] + 1);
        const repeatPenalty = 1 / (1 + (pairCounts.get(pairKey(left, right)) || 0));
        const rejectionExploration = (rejections[left] + rejections[right]) / (rows.length + 2);
        const score = 2.2 * fisherInformation + 0.7 * uncertainty + 0.55 * repeatPenalty +
          0.12 * rejectionExploration + 0.0001 * deterministicUnit(`${seedMaterial}:${left}:${right}`);
        candidates.push({ left, right, score });
      }
    }
    candidates.sort((one, two) => two.score - one.score || pairKey(one.left, one.right).localeCompare(pairKey(two.left, two.right)));
    pair = [candidates[0].left, candidates[0].right];
  }

  if (deterministicUnit(`${seedMaterial}:side-order:${rows.length}`) < 0.5) pair.reverse();
  const ranked = [...VOICE_TRIAL_STYLE_KEYS].sort((one, two) =>
    (ratings[two] - 0.18 * rejections[two] / (exposures[two] + 1)) -
    (ratings[one] - 0.18 * rejections[one] / (exposures[one] + 1)) || one.localeCompare(two));
  const margin = ratings[ranked[0]] - ratings[ranked[1]];
  const covered = VOICE_TRIAL_STYLE_KEYS.filter((key) => exposures[key] > 0).length;
  return Object.freeze({
    algorithm: VOICE_CURRICULUM_ALGORITHM,
    leftStyleKey: pair[0],
    rightStyleKey: pair[1],
    completedComparisons: rows.length,
    coveredConditions: covered,
    totalConditions: VOICE_TRIAL_STYLE_KEYS.length,
    uniquePrompts: uniquePrompts.size,
    requiredPrompts: VOICE_CALIBRATION_REQUIRED_PROMPTS,
    provisionalChampion: rows.length >= 5 ? ranked[0] : null,
    runnerUp: rows.length >= 5 ? ranked[1] : null,
    latentMargin: margin,
    conditionScores: Object.freeze(Object.fromEntries(VOICE_TRIAL_STYLE_KEYS.map((key) => [key, ratings[key]]))),
    exposures: Object.freeze({ ...exposures }),
    rejections: Object.freeze({ ...rejections }),
    converged: rows.length >= 18 && covered === VOICE_TRIAL_STYLE_KEYS.length &&
      uniquePrompts.size >= VOICE_CALIBRATION_REQUIRED_PROMPTS && exposures[ranked[0]] >= 5 && margin >= 0.42,
  });
}

async function ownedTrialContext(db, ownerUserId, rid, genomeVersion) {
  const rows = await db(
    `with latest_selection as materialized (
       select distinct on (d.artifact_id) d.artifact_id,d.decision,d.created_at,d.decision_id
         from vy_replica_processing_artifact_decision d
        where d.replica_id=$1 and d.owner_user_id=$2
        order by d.artifact_id,d.created_at desc,d.decision_id desc
     )
     select r.replica_id,r.owner_user_id,vg.version genome_version,a.artifact_id
       from vy_replica r
       join vy_replica_voice_genome vg on vg.replica_id=r.replica_id and vg.version=$3::int4 and vg.status='draft'
       join vy_replica_processing_artifact a on a.replica_id=r.replica_id and a.owner_user_id=r.owner_user_id
       join latest_selection d on d.artifact_id=a.artifact_id and d.decision='selected'
       join vy_replica_source s on s.source_id=a.source_id and s.replica_id=a.replica_id and s.owner_user_id=a.owner_user_id
      where r.replica_id=$1::uuid and r.owner_user_id=$2::uuid and r.subject_mode='self'
        and r.lifecycle in ('enrolling','calibrating','ready','active','paused') and r.policy_version=$4
        and r.age_verified_at is not null and r.identity_verified_at is not null
        and r.liveness_verified_at is not null and r.identity_expires_at>now()
        and a.stage='enhance' and a.mime in ('audio/wav','audio/x-wav')
        and s.state='ready' and s.contains_third_parties=false
        and (vg.definition#>'{references,enrollment_artifact_ids}') ? a.artifact_id::text
        and exists(select 1 from vy_replica_consent c where c.replica_id=r.replica_id
          and c.owner_user_id=r.owner_user_id and c.scope='biometric' and c.policy_version=r.policy_version
          and c.revoked_at is null and (c.expires_at is null or c.expires_at>now()))
        and exists(select 1 from vy_replica_consent c where c.replica_id=r.replica_id
          and c.owner_user_id=r.owner_user_id and c.scope='training' and c.policy_version=r.policy_version
          and c.revoked_at is null and (c.expires_at is null or c.expires_at>now()))
        and exists(select 1 from vy_replica_consent c where c.replica_id=r.replica_id
          and c.owner_user_id=r.owner_user_id and c.scope='inference' and c.policy_version=r.policy_version
          and c.revoked_at is null and (c.expires_at is null or c.expires_at>now()))
      order by d.created_at desc,d.decision_id desc limit 1`,
    [rid, ownerUserId, genomeVersion, REPLICA_POLICY_VERSION],
  );
  return rows[0] || null;
}

export async function loadOwnedVoiceCurriculumContext(db, ownerUserId, input) {
  const rid = replicaId(input?.replica_id);
  const genomeVersion = Number(input?.genome_version);
  const languageId = String(input?.language_id || "").toLowerCase();
  if (!Number.isInteger(genomeVersion) || genomeVersion < 1) fail("voice_trial_genome_version_invalid");
  if (!LANGUAGES.has(languageId)) fail("voice_trial_language_invalid");
  const context = await ownedTrialContext(db, ownerUserId, rid, genomeVersion);
  if (!context) fail("voice_trial_not_authorized", 409);
  const history = await db(
    `select p.preference_id,p.trial_id,p.pair_hash,p.choice,p.confidence,p.reason_codes,p.created_at,
            t.prompt_key,t.prompt_deck_version,t.text_hash,t.algorithm,
            l.preview_style->>'key' left_style_key,r.preview_style->>'key' right_style_key
       from vy_replica_voice_preference p
       join vy_replica_voice_trial t on t.trial_id=p.trial_id and t.replica_id=p.replica_id and t.owner_user_id=p.owner_user_id
       join vy_replica_generation l on l.generation_id=p.left_generation_id and l.replica_id=p.replica_id and l.owner_user_id=p.owner_user_id
       join vy_replica_generation r on r.generation_id=p.right_generation_id and r.replica_id=p.replica_id and r.owner_user_id=p.owner_user_id
      where p.replica_id=$1::uuid and p.owner_user_id=$2::uuid and p.genome_version=$3::int4 and p.preview_artifact_id=$4::uuid
        and l.preview_language_id=$5 and r.preview_language_id=$5
        and l.preview_model_commitment=$6 and r.preview_model_commitment=$6
        and t.algorithm=$7 and t.prompt_deck_version=$8
      order by p.created_at,p.preference_id limit 513`,
    [rid, ownerUserId, genomeVersion, context.artifact_id, languageId, OPEN_CHATTERBOX_MODEL_COMMITMENT,
      VOICE_CURRICULUM_ALGORITHM, VOICE_CALIBRATION_DECK_VERSION],
  );
  if (history.length > 512) fail("voice_curriculum_history_limit", 409);
  return Object.freeze({ rid, genomeVersion, languageId, context, history: Object.freeze(history) });
}

export async function issueOwnedVoiceTrial(db, ownerUserId, input) {
  const { rid, genomeVersion, languageId, context, history } =
    await loadOwnedVoiceCurriculumContext(db, ownerUserId, input);
  const prompt = recommendVoiceCalibrationPrompt(history, languageId,
    `${rid}:${genomeVersion}:${context.artifact_id}:${languageId}:${history.length}`);
  const textHash = voicePreviewTextHash(prompt.text);
  const schedule = recommendVoiceTrial(history,
    `${rid}:${genomeVersion}:${context.artifact_id}:${prompt.key}:${languageId}`);
  const trialId = randomUUID();
  const previewSeed = voicePreviewMatchedSeed({ replicaId: rid, genomeVersion, languageId, textHash });
  const pairHash = sha256Hex(canonicalJson({
    schema: "vyakti.voice-trial-pair.v1",
    algorithm: schedule.algorithm,
    prompt_deck_version: VOICE_CALIBRATION_DECK_VERSION,
    prompt_key: prompt.key,
    replica_id: rid,
    genome_version: genomeVersion,
    artifact_id: context.artifact_id,
    language_id: languageId,
    text_hash: textHash,
    preview_seed: previewSeed,
    model_commitment: OPEN_CHATTERBOX_MODEL_COMMITMENT,
    left_style: voicePreviewStyle(schedule.leftStyleKey),
    right_style: voicePreviewStyle(schedule.rightStyleKey),
  }));
  const rows = await db(
    `with inserted as (
     insert into vy_replica_voice_trial
       (trial_id,replica_id,owner_user_id,genome_version,preview_artifact_id,language_id,prompt_key,prompt_deck_version,text_hash,
        preview_seed,model_commitment,left_style_key,right_style_key,pair_hash,algorithm,state,expires_at)
     select $5::uuid,r.replica_id,r.owner_user_id,$3::int4,$4::uuid,$6,$15,$16,$7,$8::int4,$9,$10,$11,$12,$13,'issued',now()+interval '30 minutes'
       from vy_replica r join vy_replica_voice_genome vg on vg.replica_id=r.replica_id and vg.version=$3::int4 and vg.status='draft'
       join vy_replica_processing_artifact a on a.artifact_id=$4::uuid and a.replica_id=r.replica_id and a.owner_user_id=r.owner_user_id
       join vy_replica_source s on s.source_id=a.source_id and s.replica_id=a.replica_id and s.owner_user_id=a.owner_user_id
      where r.replica_id=$1::uuid and r.owner_user_id=$2::uuid and r.subject_mode='self' and r.policy_version=$14
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
     returning trial_id,replica_id,owner_user_id,expires_at
     ), audit as (
       insert into vy_replica_audit(replica_id,owner_user_id,action,object_kind,object_id,policy,outcome,facts)
       select replica_id,owner_user_id,'voice.trial.issue','voice_trial',trial_id::text,$14,'allowed',
              jsonb_build_object('algorithm',$13,'prompt_deck_version',$16,'prompt_key',$15,
                'pair_hash',$12,'model_commitment',$9)
         from inserted
     ) select trial_id,expires_at from inserted`,
    [rid, ownerUserId, genomeVersion, context.artifact_id, trialId, languageId, textHash, previewSeed,
      OPEN_CHATTERBOX_MODEL_COMMITMENT, schedule.leftStyleKey, schedule.rightStyleKey, pairHash,
      VOICE_CURRICULUM_ALGORITHM, REPLICA_POLICY_VERSION, prompt.key, VOICE_CALIBRATION_DECK_VERSION],
  );
  if (!rows[0]) fail("voice_trial_context_changed", 409);
  return Object.freeze({
    trial_id: rows[0].trial_id,
    algorithm: schedule.algorithm,
    expires_at: rows[0].expires_at,
    prompt_deck_version: VOICE_CALIBRATION_DECK_VERSION,
    prompt: Object.freeze({ key: prompt.key, domain: prompt.domain, text: prompt.text }),
    progress: Object.freeze({
      completed: schedule.completedComparisons,
      covered_conditions: schedule.coveredConditions,
      total_conditions: schedule.totalConditions,
      unique_prompts: schedule.uniquePrompts,
      required_prompts: schedule.requiredPrompts,
      converged: schedule.converged,
    }),
  });
}

export async function resolveOwnedVoiceTrialSide(db, ownerUserId, input) {
  const rid = replicaId(input?.replica_id);
  const trialId = replicaId(input?.trial_id);
  const genomeVersion = Number(input?.genome_version);
  const side = String(input?.trial_side || "");
  const languageId = String(input?.language_id || "").toLowerCase();
  const textHash = String(input?.text_hash || "").toLowerCase();
  if (!SIDES.has(side)) fail("voice_trial_side_invalid");
  if (!Number.isInteger(genomeVersion) || genomeVersion < 1 || !LANGUAGES.has(languageId) || !SHA256.test(textHash))
    fail("voice_trial_binding_invalid");
  const rows = await db(
    `select trial_id,preview_seed,case when $7='left' then left_style_key else right_style_key end style_key
       from vy_replica_voice_trial
      where trial_id=$1::uuid and replica_id=$2::uuid and owner_user_id=$3::uuid and genome_version=$4::int4
        and language_id=$5 and text_hash=$6 and state='issued' and expires_at>now()
        and model_commitment=$8`,
    [trialId, rid, ownerUserId, genomeVersion, languageId, textHash, side, OPEN_CHATTERBOX_MODEL_COMMITMENT],
  );
  if (!rows[0]) fail("voice_trial_not_active", 409);
  voicePreviewStyle(rows[0].style_key);
  return Object.freeze({ trialId, side, styleKey: rows[0].style_key, previewSeed: Number(rows[0].preview_seed) });
}
