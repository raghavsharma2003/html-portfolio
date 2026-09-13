// Owner calibration as typed, versioned preference evidence.
//
// The browser chooses only a server-owned scenario and left/right/tie/neither.
// Candidate strategies, runtime directives, hashes and model definitions are
// built here; arbitrary client text never becomes behavior policy.
import { randomUUID } from "node:crypto";
import { canonicalJson, sha256Hex } from "./_provenance/contracts.js";
import { replicaId, REPLICA_POLICY_VERSION } from "./_replica.js";

export const CALIBRATION_SCHEMA = "vyakti.calibration.v1";
export const CALIBRATION_BUILDER = "calibration-builder/v1";
export const CALIBRATION_POLICY = "replica-calibration-v1";

const CHOICES = new Set(["left", "right", "tie", "neither"]);
const CORE_LAYERS = Object.freeze(["delivery", "language", "behaviour", "memory", "relationship"]);

function option(id, label, description, directive) {
  return Object.freeze({ id, label, description, directive });
}

export const CALIBRATION_SCENARIOS = Object.freeze([
  Object.freeze({
    scenario_id: "delivery.turn_shape", revision: 1, layer: "delivery", axis: "turn_shape",
    context: "When the other person shares an ordinary update, which response shape feels more like you?",
    left: option("compact_observation", "Compact observation", "One specific observation, then a small opening.", "Prefer a compact observation followed by at most one small opening."),
    right: option("reflective_arc", "Reflective arc", "Connect the feeling, context, and one gentle question.", "Prefer a short reflective arc that connects feeling and context before one gentle question."),
  }),
  Object.freeze({
    scenario_id: "delivery.energy_match", revision: 1, layer: "delivery", axis: "energy_matching",
    context: "When someone arrives excited, how do you naturally meet their energy?",
    left: option("quick_match", "Match quickly", "Lift pace and warmth right away.", "Match clear positive energy quickly while keeping the response controlled."),
    right: option("grounded_warmth", "Grounded warmth", "Stay steady while making the excitement unmistakable.", "Keep a grounded pace while making positive warmth unmistakable."),
  }),
  Object.freeze({
    scenario_id: "language.code_switch", revision: 1, layer: "language", axis: "code_switching",
    context: "In a Hinglish conversation, what should trigger a language switch?",
    left: option("emotion_led_switch", "Emotion-led", "Move toward Hindi for emotional directness.", "Let emotional directness, not novelty, trigger a natural move toward Hindi."),
    right: option("partner_led_switch", "Partner-led", "Mirror the other person's current language first.", "Mirror the other person's current language before introducing a code-switch."),
  }),
  Object.freeze({
    scenario_id: "language.idiom_density", revision: 1, layer: "language", axis: "idiom_density",
    context: "How much characteristic slang or phrasing belongs in a normal turn?",
    left: option("light_signature", "Light signature", "One characteristic phrase only when it lands naturally.", "Use characteristic slang sparingly, normally no more than one signature phrase per turn."),
    right: option("expressive_texture", "Expressive texture", "Let familiar phrasing carry more of the rhythm.", "Allow familiar phrasing to carry the rhythm, without stacking catchphrases mechanically."),
  }),
  Object.freeze({
    scenario_id: "behaviour.support_entry", revision: 1, layer: "behaviour", axis: "support_entry",
    context: "Someone you care about says the day was rough but gives no detail. What feels most like you?",
    left: option("quiet_presence", "Quiet presence", "Name the weight and make room without pressing.", "When distress is vague, acknowledge its weight and make room before asking for detail."),
    right: option("gentle_curiosity", "Gentle curiosity", "Name the weight and ask one easy, specific question.", "When distress is vague, acknowledge it and ask one easy, specific question."),
  }),
  Object.freeze({
    scenario_id: "behaviour.disagreement", revision: 1, layer: "behaviour", axis: "disagreement",
    context: "When you disagree with someone you trust, which shape sounds more like you?",
    left: option("direct_reason", "Direct reason", "Say the disagreement early and give the key reason.", "State disagreement early, respectfully, and give the single strongest reason."),
    right: option("context_then_position", "Context first", "Show what you understood before taking a position.", "Show what was understood before stating a respectful disagreement."),
  }),
  Object.freeze({
    scenario_id: "behaviour.repair", revision: 1, layer: "behaviour", axis: "repair",
    context: "After realizing you missed what the other person needed, how do you repair?",
    left: option("brief_ownership", "Brief ownership", "Name the miss, apologize once, and change course.", "Repair by naming the miss, apologizing once, and changing course without self-defense."),
    right: option("reflective_repair", "Reflective repair", "Name the impact, check understanding, and then change course.", "Repair by naming the likely impact, checking understanding once, and changing course."),
  }),
  Object.freeze({
    scenario_id: "memory.uncertainty", revision: 1, layer: "memory", axis: "uncertainty_response",
    context: "A memory feels familiar but the evidence is incomplete. What should the replica do?",
    left: option("specific_check", "Ask a precise check", "Offer the uncertain fragment as a question.", "For incomplete memories, ask one precise check instead of completing the story."),
    right: option("mark_and_wait", "Mark and wait", "State uncertainty briefly and let the person choose whether to fill it in.", "For incomplete memories, state uncertainty briefly and wait rather than fishing for details."),
  }),
  Object.freeze({
    scenario_id: "relationship.affection", revision: 1, layer: "relationship", axis: "affection_expression",
    context: "In a close relationship, what makes warmth feel most like you?",
    left: option("subtle_callback", "Subtle callback", "Show care through a remembered detail or shared phrase.", "Express closeness mainly through relevant callbacks and shared language, never fabricated ones."),
    right: option("explicit_warmth", "Explicit warmth", "Say the caring part clearly and simply.", "Express closeness with clear, restrained warmth rather than relying only on implication."),
  }),
  Object.freeze({
    scenario_id: "relationship.tension_pacing", revision: 1, layer: "relationship", axis: "tension_pacing",
    context: "When a conversation becomes tense but not unsafe, how do you usually stay connected?",
    left: option("offer_space", "Offer space", "Lower pressure and leave a clear path back.", "In ordinary tension, lower pressure and offer space with a clear path back."),
    right: option("stay_present", "Stay present", "Slow down and remain gently engaged.", "In ordinary tension, slow down and remain gently engaged without crowding the person."),
  }),
]);

const SCENARIOS = new Map(CALIBRATION_SCENARIOS.map((scenario) => [scenario.scenario_id, scenario]));
const STRATEGIES = new Map(CALIBRATION_SCENARIOS.flatMap((scenario) => [scenario.left, scenario.right].map((item) => [item.id, { ...item, layer: scenario.layer, axis: scenario.axis }])));

function fail(code, status = 400, details) {
  const error = Object.assign(new Error(code), { code, status });
  if (details) error.details = details;
  throw error;
}

function clean(value, max = 280) {
  return Array.from(String(value || ""))
    .filter((character) => {
      const code = character.codePointAt(0);
      return code === 10 || (code >= 32 && code !== 127);
    })
    .join("")
    .replace(/<\/?(?:system|assistant|developer|tool)[^>]*>/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function number(value, fallback = 0) {
  const result = Number(value);
  return Number.isFinite(result) ? result : fallback;
}

function scenarioRef(scenario, side) {
  const selected = scenario[side];
  return {
    schema: "vyakti.calibration-strategy.v1",
    scenario_id: scenario.scenario_id,
    scenario_revision: scenario.revision,
    layer: scenario.layer,
    axis: scenario.axis,
    strategy_id: selected.id,
    label: selected.label,
    directive: selected.directive,
  };
}

export function calibrationPairHash(scenario) {
  return sha256Hex(canonicalJson({
    schema: CALIBRATION_SCHEMA,
    scenario_id: scenario.scenario_id,
    revision: scenario.revision,
    layer: scenario.layer,
    axis: scenario.axis,
    left: scenarioRef(scenario, "left"),
    right: scenarioRef(scenario, "right"),
  }));
}

function currentPreferences(rows) {
  const latest = new Map();
  for (const row of rows) {
    const scenario = SCENARIOS.get(String(row.scenario_id));
    if (!scenario || !CHOICES.has(row.choice) || number(row.scenario_revision, 1) !== scenario.revision || row.pair_hash !== calibrationPairHash(scenario)) continue;
    const previous = latest.get(row.pair_hash);
    if (!previous || number(row.revision) > number(previous.revision)) latest.set(row.pair_hash, row);
  }
  return [...latest.values()].sort((left, right) => String(left.scenario_id).localeCompare(String(right.scenario_id)));
}

export function calibrationReadiness(rows, profileVersion) {
  const preferences = currentPreferences(rows);
  const resolved = preferences.filter((row) => row.choice !== "neither");
  const layers = new Set(resolved.map((row) => row.layer));
  const blockers = [];
  if (!Number.isInteger(number(profileVersion)) || number(profileVersion) < 1) blockers.push("approved_person_profile_required");
  for (const layer of CORE_LAYERS) if (!layers.has(layer)) blockers.push(`${layer}_calibration_required`);
  if (resolved.length < 7) blockers.push("calibration_depth_required");
  return {
    ready: blockers.length === 0,
    blockers,
    reviewed: preferences.length,
    resolved: resolved.length,
    required: 7,
    covered_layers: [...layers].sort(),
  };
}

export function calibrationSourceHash(rows, profileVersion) {
  const preferences = currentPreferences(rows).map((row) => ({
    preference_id: String(row.preference_id),
    pair_hash: row.pair_hash,
    revision: number(row.revision),
    choice: row.choice,
    confidence: number(row.confidence, 1),
  }));
  return sha256Hex(canonicalJson({ schema: CALIBRATION_SCHEMA, profile_version: number(profileVersion), preferences }));
}

export function buildCalibrationDefinition(rows, profileVersion) {
  const readiness = calibrationReadiness(rows, profileVersion);
  if (!readiness.ready) fail("calibration_not_ready", 409, readiness);
  const preferences = currentPreferences(rows);
  const strategies = [];
  const equivalences = [];
  const unresolved = [];
  for (const row of preferences) {
    const scenario = SCENARIOS.get(row.scenario_id);
    if (row.choice === "left" || row.choice === "right") {
      const candidate = scenario[row.choice];
      strategies.push({
        layer: scenario.layer,
        axis: scenario.axis,
        strategy_id: candidate.id,
        confidence: number(row.confidence, 1),
        preference_id: String(row.preference_id),
      });
    } else if (row.choice === "tie") {
      equivalences.push({ layer: scenario.layer, axis: scenario.axis, strategy_ids: [scenario.left.id, scenario.right.id], preference_id: String(row.preference_id) });
    } else {
      unresolved.push({ layer: scenario.layer, axis: scenario.axis, preference_id: String(row.preference_id) });
    }
  }
  return {
    schema: CALIBRATION_SCHEMA,
    builder: CALIBRATION_BUILDER,
    profile_version: number(profileVersion),
    strategies,
    equivalences,
    unresolved,
    provenance: {
      preferences: preferences.map((row) => ({ preference_id: String(row.preference_id), pair_hash: row.pair_hash, revision: number(row.revision) })),
    },
  };
}

export function calibrationDirectives(definition) {
  if (definition?.schema !== CALIBRATION_SCHEMA || definition?.builder !== CALIBRATION_BUILDER) return [];
  const values = Array.isArray(definition?.strategies) ? definition.strategies : [];
  return values.flatMap((row) => {
    const known = STRATEGIES.get(String(row?.strategy_id || ""));
    if (!known || known.layer !== row.layer || known.axis !== row.axis) return [];
    return [{ layer: known.layer, axis: known.axis, strategy_id: String(row.strategy_id), directive: known.directive }];
  }).slice(0, CALIBRATION_SCENARIOS.length);
}

function clientPreference(row) {
  return {
    preference_id: String(row.preference_id),
    scenario_id: row.scenario_id,
    scenario_revision: number(row.scenario_revision, 1),
    layer: row.layer,
    choice: row.choice,
    confidence: number(row.confidence, 1),
    revision: number(row.revision, 1),
    created_at: row.created_at,
  };
}

function clientScenario(scenario, preference) {
  return {
    scenario_id: scenario.scenario_id,
    revision: scenario.revision,
    layer: scenario.layer,
    axis: scenario.axis,
    context: scenario.context,
    left: { id: scenario.left.id, label: scenario.left.label, description: scenario.left.description },
    right: { id: scenario.right.id, label: scenario.right.label, description: scenario.right.description },
    preference: preference ? clientPreference(preference) : null,
  };
}

const PREFERENCES_SQL = `select p.preference_id,p.scenario_id,p.scenario_revision,p.layer,p.choice,p.confidence,
  p.pair_hash,p.revision,p.profile_version,p.created_at
from vy_replica_preference p
join vy_replica r on r.replica_id=p.replica_id and r.owner_user_id=p.owner_user_id
where p.replica_id=$1::uuid and p.owner_user_id=$2::uuid and p.pair_hash is not null
order by p.pair_hash,p.revision desc,p.created_at desc`;

async function calibrationState(db, ownerUserId, id) {
  const rid = replicaId(id);
  const [owned, profiles, rows, calibrations] = await Promise.all([
    db(`select replica_id from vy_replica where replica_id=$1::uuid and owner_user_id=$2::uuid
         and subject_mode='self' and policy_version=$3 limit 1`, [rid, ownerUserId, REPLICA_POLICY_VERSION]),
    db(`select p.version from vy_replica_profile p
         join vy_replica r on r.replica_id=p.replica_id and r.owner_user_id=$2::uuid
        where p.replica_id=$1::uuid and p.status='approved' order by p.version desc limit 1`, [rid, ownerUserId]),
    db(PREFERENCES_SQL, [rid, ownerUserId]),
    db(`select c.version,c.profile_version,c.status,c.created_at from vy_replica_calibration c
         join vy_replica r on r.replica_id=c.replica_id and r.owner_user_id=$2::uuid
        where c.replica_id=$1::uuid and c.owner_user_id=$2::uuid order by c.version desc limit 20`, [rid, ownerUserId]),
  ]);
  if (!owned[0]) return null;
  return { rid, profileVersion: number(profiles[0]?.version) || null, preferences: currentPreferences(rows), calibrations };
}

export async function ownedCalibrationStatus(db, ownerUserId, id) {
  const state = await calibrationState(db, ownerUserId, id);
  if (!state) return null;
  const byScenario = new Map(state.preferences.map((row) => [row.scenario_id, row]));
  return {
    replica_id: state.rid,
    profile_version: state.profileVersion,
    scenarios: CALIBRATION_SCENARIOS.map((scenario) => clientScenario(scenario, byScenario.get(scenario.scenario_id))),
    readiness: calibrationReadiness(state.preferences, state.profileVersion),
    versions: state.calibrations.map((row) => ({ version: number(row.version), profile_version: number(row.profile_version), status: row.status, created_at: row.created_at })),
  };
}

export async function recordOwnedPreference(db, ownerUserId, input) {
  const rid = replicaId(input?.replica_id);
  const scenario = SCENARIOS.get(String(input?.scenario_id || ""));
  const choice = String(input?.choice || "");
  const confidence = number(input?.confidence, 1);
  if (!scenario) fail("unknown_calibration_scenario");
  if (!CHOICES.has(choice)) fail("invalid_calibration_choice");
  if (confidence < 0 || confidence > 1) fail("invalid_calibration_confidence");
  const note = clean(input?.note, 280);
  const pairHash = calibrationPairHash(scenario);
  const rows = await db(
    `with owned as (
       select r.replica_id,r.owner_user_id,p.version as profile_version,
              pg_advisory_xact_lock(hashtextextended(r.replica_id::text||':calibration:'||$3,0))
         from vy_replica r join lateral (
           select version from vy_replica_profile x where x.replica_id=r.replica_id and x.status='approved'
            order by version desc limit 1
         ) p on true
        where r.replica_id=$1::uuid and r.owner_user_id=$2::uuid and r.subject_mode='self'
          and r.policy_version=$13 and r.lifecycle not in ('revoked','purging')
     ), previous as (
       select p.preference_id,p.revision from vy_replica_preference p join owned o
         on o.replica_id=p.replica_id and o.owner_user_id=p.owner_user_id
        where p.pair_hash=$3 order by p.revision desc limit 1
     ), inserted as (
       insert into vy_replica_preference
         (replica_id,owner_user_id,profile_version,layer,scenario_id,scenario_revision,
          left_ref,right_ref,pair_hash,revision,supersedes_id,choice,confidence,note,policy_version)
       select o.replica_id,o.owner_user_id,o.profile_version,$4,$5,$6::int4,$7::jsonb,$8::jsonb,$3,
              coalesce((select revision+1 from previous),1),(select preference_id from previous),$9,$10::numeric,$11,$12
         from owned o
       returning preference_id,scenario_id,scenario_revision,layer,choice,confidence,pair_hash,revision,profile_version,created_at
     ) select * from inserted`,
    [rid, ownerUserId, pairHash, scenario.layer, scenario.scenario_id, scenario.revision,
      JSON.stringify(scenarioRef(scenario, "left")), JSON.stringify(scenarioRef(scenario, "right")),
      choice, confidence, note, CALIBRATION_POLICY, REPLICA_POLICY_VERSION],
  );
  return rows[0] ? clientPreference(rows[0]) : null;
}

export async function buildOwnedCalibration(db, ownerUserId, id) {
  const state = await calibrationState(db, ownerUserId, id);
  if (!state) return null;
  const definition = buildCalibrationDefinition(state.preferences, state.profileVersion);
  const sourceSetHash = calibrationSourceHash(state.preferences, state.profileVersion);
  const rows = await db(
    `with owned as (
       select r.replica_id,r.owner_user_id,pg_advisory_xact_lock(hashtextextended(r.replica_id::text||':calibration_build',0))
         from vy_replica r where r.replica_id=$1::uuid and r.owner_user_id=$2::uuid and r.lifecycle not in ('revoked','purging')
     ), candidate as (
       select o.replica_id,o.owner_user_id,coalesce(
         (select version from vy_replica_calibration where replica_id=$1::uuid and owner_user_id=$2::uuid and profile_version=$3::int4 and source_set_hash=$4 limit 1),
         (select coalesce(max(version)+1,1) from vy_replica_calibration where replica_id=$1::uuid)
       ) as version from owned o
     )
     insert into vy_replica_calibration(replica_id,owner_user_id,version,profile_version,source_set_hash,definition,status)
     select replica_id,owner_user_id,version,$3::int4,$4,$5::jsonb,'draft' from candidate
     on conflict (replica_id,owner_user_id,profile_version,source_set_hash)
       do update set source_set_hash=excluded.source_set_hash
     returning replica_id,version,profile_version,status,created_at`,
    [state.rid, ownerUserId, state.profileVersion, sourceSetHash, JSON.stringify(definition)],
  );
  return rows[0] ? { ...rows[0], version: number(rows[0].version), profile_version: number(rows[0].profile_version) } : null;
}

export async function approveOwnedCalibration(db, ownerUserId, input) {
  const state = await calibrationState(db, ownerUserId, input?.replica_id);
  if (!state) return null;
  const version = number(input?.version);
  if (!Number.isInteger(version) || version < 1) fail("valid_calibration_version_required");
  const readiness = calibrationReadiness(state.preferences, state.profileVersion);
  if (!readiness.ready) fail("calibration_not_ready", 409, readiness);
  const sourceSetHash = calibrationSourceHash(state.preferences, state.profileVersion);
  const rows = await db(
    `with owned as (
       select c.replica_id,c.version from vy_replica_calibration c
       join vy_replica r on r.replica_id=c.replica_id and r.owner_user_id=$2::uuid
       where c.replica_id=$1::uuid and c.owner_user_id=$2::uuid and c.version=$3::int4 and c.profile_version=$4::int4
         and c.source_set_hash=$5 and c.status='draft' for update
     ), retired as (
       update vy_replica_calibration c set status='retired' from owned o
        where c.replica_id=o.replica_id and c.status='approved'
          and not exists(select 1 from vy_replica_runtime_capability cap
            where cap.replica_id=c.replica_id and cap.calibration_version=c.version and cap.state='active')
     ), approved as (
       update vy_replica_calibration c set status='approved' from owned o
        where c.replica_id=o.replica_id and c.version=o.version
       returning c.replica_id,c.version,c.profile_version,c.status,c.created_at
     ) select * from approved`,
    [state.rid, ownerUserId, version, state.profileVersion, sourceSetHash],
  );
  return rows[0] ? { ...rows[0], version: number(rows[0].version), profile_version: number(rows[0].profile_version) } : null;
}

export { CORE_LAYERS as CALIBRATION_CORE_LAYERS };

// ── WS-R155: "Sounds like you" and the listening test ─────────────────────
//
// A voice listening verdict is a paired blind comparison of two candidate
// generations of the OWNER'S OWN voice (never a stranger's, never a
// cross-provider claim -- `evals/voice-listening-benchmark`'s own law), rated
// on the same sealed four-axis form that listening harness already uses:
// owner likeness, naturalness, Indian accent fit, pronunciation. These axis
// ids MUST stay identical to evals/voice-listening-benchmark/lib.mjs#AXES --
// evals/listening-test/run.mjs asserts the two lists match by id on every
// run, so a drift here fails loudly rather than quietly building a second
// scorer (the brief's own words: "never a second scorer").
//
// The verdict lands as a NEW schema value in the SAME vy_replica_calibration
// table a personality preference lands in (migration 166's own header
// explains why: a row's kind is read from definition->>'schema', and
// ownedCalibrationStatus/calibrationDirectives above already ignore any
// schema they do not recognise, so this is additive by construction).
//
// context/rejected.md's law that a speaker-embedding cosine score does not
// by itself settle likeness applies here in its human form too: two
// candidates can legitimately tie a blind listener, and a tie is a stored,
// honest outcome (winner_artifact_id null), never a forced pick.
export const LISTENING_VERDICT_SCHEMA = "vyakti.voice-listening-verdict.v1";
export const LISTENING_AXES = Object.freeze(["owner_likeness", "naturalness", "indian_accent", "pronunciation"]);
const SORTED_LISTENING_AXES = Object.freeze([...LISTENING_AXES].sort());
const SHA256_SHAPE = /^[0-9a-f]{64}$/;

function listeningFail(code, status = 400, details) {
  const error = Object.assign(new Error(code), { code, status });
  if (details) error.details = details;
  throw error;
}

/** All four axes present, each an integer 1..5, nothing extra. Pure. */
export function validateListeningRating(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) listeningFail("listening_rating_invalid");
  const keys = Object.keys(value).sort();
  if (keys.length !== SORTED_LISTENING_AXES.length || keys.some((key, index) => key !== SORTED_LISTENING_AXES[index]))
    listeningFail("listening_rating_axes_invalid");
  const rating = {};
  for (const axis of LISTENING_AXES) {
    const score = Number(value[axis]);
    if (!Number.isInteger(score) || score < 1 || score > 5) listeningFail("listening_rating_axes_invalid");
    rating[axis] = score;
  }
  return Object.freeze(rating);
}

export function listeningRatingMean(rating) {
  return LISTENING_AXES.reduce((total, axis) => total + rating[axis], 0) / LISTENING_AXES.length;
}

/**
 * The pair's stable identity: content hashes only, never generation ids, so
 * "the latest verdict for this exact pair" is a lookup and a redo of the
 * same pair is found rather than guessed. Order-independent in the two
 * candidates (sorted) so left/right on a redo does not mint a new pair.
 */
export function listeningPairSha256({ leftSha256, rightSha256, referenceSha256 }) {
  const left = String(leftSha256 || "").toLowerCase();
  const right = String(rightSha256 || "").toLowerCase();
  const reference = String(referenceSha256 || "").toLowerCase();
  if (!SHA256_SHAPE.test(left) || !SHA256_SHAPE.test(right) || !SHA256_SHAPE.test(reference)) listeningFail("listening_hash_invalid");
  if (left === right) listeningFail("listening_distinct_candidates_required");
  return sha256Hex({ schema: LISTENING_VERDICT_SCHEMA, candidates: [left, right].sort(), reference_sha256: reference });
}

/** Pure verdict math: higher mean across the four axes wins; equal means tie. */
export function listeningVerdictFromRatings(leftRating, rightRating) {
  const leftMean = listeningRatingMean(leftRating);
  const rightMean = listeningRatingMean(rightRating);
  const winner = leftMean > rightMean ? "left" : rightMean > leftMean ? "right" : "tie";
  return Object.freeze({ leftMean, rightMean, winner });
}

export function buildListeningVerdictDefinition(input) {
  const order = input?.order === "ba" ? "ba" : "ab";
  const { leftMean, rightMean, winner } = listeningVerdictFromRatings(input.left.ratings, input.right.ratings);
  return Object.freeze({
    schema: LISTENING_VERDICT_SCHEMA,
    order,
    left: Object.freeze({ generation_id: input.left.generationId, audio_sha256: input.left.audioSha256, ratings: input.left.ratings, mean: leftMean }),
    right: Object.freeze({ generation_id: input.right.generationId, audio_sha256: input.right.audioSha256, ratings: input.right.ratings, mean: rightMean }),
    reference_sha256: input.referenceSha256,
    winner,
    note: input.note || "",
  });
}

// No FK on winner_artifact_id (migration 166's own comment: vy_replica_
// generation carries no unique constraint on the exact tuple this would
// need). Eligibility is proved here instead, by the same WHERE-clause-join
// pattern recordOwnedVoicePreference (api/_replica-voice-preference.js)
// already uses for the identical left/right-generation relationship. The
// advisory lock key is deliberately the SAME one buildOwnedCalibration uses
// ('<replica_id>:calibration_build'): both writers mint the next `version`
// for this table, so they must serialize against each other or a listening
// verdict and a personality-calibration build could race onto one version.
const LISTENING_INSERT_SQL = `with owned as (
   select r.replica_id,r.owner_user_id,p.version as profile_version,
          pg_advisory_xact_lock(hashtextextended(r.replica_id::text||':calibration_build',0))
     from vy_replica r join lateral (
       select version from vy_replica_profile x where x.replica_id=r.replica_id and x.status='approved'
        order by version desc limit 1
     ) p on true
    where r.replica_id=$1::uuid and r.owner_user_id=$2::uuid and r.subject_mode='self'
      and r.policy_version=$3 and r.lifecycle not in ('revoked','purging')
 ), candidates as (
   select l.generation_id as left_id,rgen.generation_id as right_id
     from vy_replica_generation l
     join vy_replica_generation rgen on rgen.generation_id=$5::uuid and rgen.replica_id=l.replica_id
       and rgen.owner_user_id=l.owner_user_id
     join owned o on o.replica_id=l.replica_id and o.owner_user_id=l.owner_user_id
    where l.generation_id=$4::uuid and l.replica_id=$1::uuid and l.owner_user_id=$2::uuid
      and l.state='sealed' and rgen.state='sealed'
      and l.purpose='voice_preview' and rgen.purpose='voice_preview'
      and l.audio_sha256=$6 and rgen.audio_sha256=$7
      and l.generation_id<>rgen.generation_id
 ), inserted as (
   insert into vy_replica_calibration
     (replica_id,owner_user_id,version,profile_version,source_set_hash,definition,status,pair_sha256,winner_artifact_id)
   select o.replica_id,o.owner_user_id,
          coalesce((select max(version)+1 from vy_replica_calibration where replica_id=o.replica_id),1),
          o.profile_version,$8,$9::jsonb,'approved',$10,$11::uuid
     from owned o join candidates c on true
   returning replica_id,version,profile_version,status,pair_sha256,winner_artifact_id,created_at
 ) select * from inserted`;

/**
 * Record one completed blind listening trial as an approved calibration row.
 * Atomic and idempotent-by-content: a genuine redo of the same pair mints a
 * new version (source_set_hash includes a fresh attempt id so it never
 * collides with an earlier attempt at the same pair), while pair_sha256
 * groups every attempt at that pair for the "latest verdict" reader below.
 */
export async function recordVoiceListeningVerdict(db, ownerUserId, input) {
  const rid = replicaId(input?.replica_id);
  const leftId = replicaId(input?.left?.generation_id);
  const rightId = replicaId(input?.right?.generation_id);
  if (leftId === rightId) listeningFail("listening_distinct_candidates_required");
  const leftSha = String(input?.left?.audio_sha256 || "").toLowerCase();
  const rightSha = String(input?.right?.audio_sha256 || "").toLowerCase();
  const referenceSha = String(input?.reference_sha256 || "").toLowerCase();
  const pairSha = listeningPairSha256({ leftSha256: leftSha, rightSha256: rightSha, referenceSha256: referenceSha });
  const leftRatings = validateListeningRating(input?.left?.ratings);
  const rightRatings = validateListeningRating(input?.right?.ratings);
  const definition = buildListeningVerdictDefinition({
    order: input?.order,
    left: { generationId: leftId, audioSha256: leftSha, ratings: leftRatings },
    right: { generationId: rightId, audioSha256: rightSha, ratings: rightRatings },
    referenceSha256: referenceSha,
    note: clean(input?.note, 280),
  });
  const winnerId = definition.winner === "left" ? leftId : definition.winner === "right" ? rightId : null;
  const sourceSetHash = sha256Hex({ schema: LISTENING_VERDICT_SCHEMA, pair_sha256: pairSha, attempt: randomUUID() });
  const rows = await db(LISTENING_INSERT_SQL, [
    rid, ownerUserId, REPLICA_POLICY_VERSION, leftId, rightId, leftSha, rightSha,
    sourceSetHash, JSON.stringify(definition), pairSha, winnerId,
  ]);
  if (!rows[0]) listeningFail("listening_candidates_ineligible_or_profile_unapproved", 409);
  const row = rows[0];
  return Object.freeze({
    replica_id: row.replica_id,
    version: number(row.version),
    profile_version: number(row.profile_version),
    status: row.status,
    pair_sha256: row.pair_sha256,
    winner: definition.winner,
    winner_generation_id: row.winner_artifact_id,
    left_mean: definition.left.mean,
    right_mean: definition.right.mean,
    created_at: row.created_at,
  });
}

/** The latest approved verdict for one specific content pair, or null if the
 *  owner has never blind-tested that exact pair. Used both by the studio's
 *  "sounds like you" read and by the activation guard below. */
export async function latestVoiceListeningVerdict(db, ownerUserId, id, pairSha256) {
  const rid = replicaId(id);
  const rows = await db(
    `select version,winner_artifact_id,definition,pair_sha256,created_at from vy_replica_calibration
      where replica_id=$1::uuid and owner_user_id=$2::uuid and pair_sha256=$3 and status='approved'
      order by version desc limit 1`,
    [rid, ownerUserId, pairSha256],
  );
  return rows[0] || null;
}

/** The owner's most recent listening verdicts of any pair, newest first --
 *  "the owner's own last blind preference" on the Meet voice sample view. */
export async function ownedVoiceListeningHistory(db, ownerUserId, id, limit = 10) {
  const rid = replicaId(id);
  const rows = await db(
    `select version,definition,winner_artifact_id,pair_sha256,created_at from vy_replica_calibration
      where replica_id=$1::uuid and owner_user_id=$2::uuid and status='approved'
        and definition#>>'{schema}'=$3
      order by version desc limit $4`,
    [rid, ownerUserId, LISTENING_VERDICT_SCHEMA, Math.max(1, Math.min(50, Number(limit) || 10))],
  );
  return rows.map((row) => {
    const definition = typeof row.definition === "string" ? JSON.parse(row.definition) : row.definition;
    return {
      version: number(row.version),
      winner_generation_id: row.winner_artifact_id,
      winner: definition?.winner || null,
      order: definition?.order || null,
      left_mean: definition?.left?.mean ?? null,
      right_mean: definition?.right?.mean ?? null,
      created_at: row.created_at,
    };
  });
}

// ── Law 4: "a losing candidate cannot become primary without an explicit
// override that is logged" ─────────────────────────────────────────────────
// Pure decision, so every branch is a fixture test with no database. The
// three "allowed" reasons and the one "blocked" reason are the whole surface
// a caller needs to reason about; `override` is a caller-declared intent,
// never inferred from anything the client sends implicitly.
export function decideVoiceActivation({ verdict, candidateGenerationId, override = false }) {
  if (!verdict) return Object.freeze({ allowed: true, reason: "no_verdict_on_record" });
  if (!verdict.winner_artifact_id) return Object.freeze({ allowed: true, reason: "verdict_was_a_tie" });
  if (String(verdict.winner_artifact_id) === String(candidateGenerationId))
    return Object.freeze({ allowed: true, reason: "candidate_won_latest_verdict" });
  if (override) return Object.freeze({ allowed: true, reason: "override", overridden: true, blockedBy: String(verdict.winner_artifact_id) });
  return Object.freeze({ allowed: false, reason: "candidate_lost_latest_verdict", blockedBy: String(verdict.winner_artifact_id) });
}

/**
 * The DB-backed guard a runtime-activation caller runs before letting a
 * candidate generation become the primary voice. Deliberately NOT wired into
 * api/_replica-runtime.js's own activation query in this workstream: that
 * query is a 100+ line qualification path this brief does not name, and
 * bolting a new precondition onto it without walking that whole path first
 * is exactly the kind of change that is riskier for being small. This guard
 * is the self-contained, offline-testable half; wiring it into that call
 * site is named as an open item in this workstream's report.
 *
 * Never throws for "not allowed" -- it returns the same decision shape
 * decideVoiceActivation does, so a caller (a future HTTP door, or a test)
 * chooses its own status code rather than parsing an error.
 */
export async function guardOwnedVoiceActivation(db, ownerUserId, input) {
  const rid = replicaId(input?.replica_id);
  const candidateId = replicaId(input?.candidate_generation_id);
  if (!input?.current_generation_id) return decideVoiceActivation({ verdict: null, candidateGenerationId: candidateId });
  const currentId = replicaId(input.current_generation_id);
  if (candidateId === currentId) return Object.freeze({ allowed: true, reason: "candidate_is_current_primary" });
  const rows = await db(
    `select generation_id,audio_sha256 from vy_replica_generation
      where replica_id=$1::uuid and owner_user_id=$2::uuid and generation_id=any($3::uuid[])
        and state='sealed' and audio_sha256 is not null`,
    [rid, ownerUserId, [candidateId, currentId]],
  );
  const bySha = new Map(rows.map((row) => [String(row.generation_id), row.audio_sha256]));
  const candidateSha = bySha.get(candidateId);
  const currentSha = bySha.get(currentId);
  const referenceSha = String(input?.reference_sha256 || "").toLowerCase();
  if (!candidateSha || !currentSha || !SHA256_SHAPE.test(referenceSha))
    return Object.freeze({ allowed: true, reason: "candidate_or_current_unresolved" });
  const pairSha = listeningPairSha256({ leftSha256: candidateSha, rightSha256: currentSha, referenceSha256: referenceSha });
  const verdict = await latestVoiceListeningVerdict(db, ownerUserId, rid, pairSha);
  const decision = decideVoiceActivation({ verdict, candidateGenerationId: candidateId, override: Boolean(input?.override) });
  if (decision.overridden) {
    await db(
      `insert into vy_replica_audit(replica_id,owner_user_id,action,object_kind,object_id,policy,outcome,facts)
        values ($1::uuid,$2::uuid,'voice.activation.override','voice_listening_verdict',$3,$4,'allowed',$5::jsonb)`,
      [rid, ownerUserId, String(verdict?.version || ""), CALIBRATION_POLICY,
        JSON.stringify({ candidate_generation_id: candidateId, current_generation_id: currentId, pair_sha256: pairSha, blocked_by: decision.blockedBy })],
    );
  }
  return decision;
}
