// Owner calibration as typed, versioned preference evidence.
//
// The browser chooses only a server-owned scenario and left/right/tie/neither.
// Candidate strategies, runtime directives, hashes and model definitions are
// built here; arbitrary client text never becomes behavior policy.
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
