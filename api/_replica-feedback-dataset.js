import { randomUUID } from "node:crypto";
import { canonicalJson, sha256Hex } from "./_provenance/contracts.js";
import { replicaId, REPLICA_POLICY_VERSION } from "./_replica.js";
import { TURN_FEEDBACK_SCHEMA } from "./_replica-feedback.js";

export const FEEDBACK_DATASET_SCHEMA = "vyakti.feedback-dataset.v1";
const SPLITS = ["train", "development", "test"];
const REQUIRED_DIMENSIONS = ["wording", "behavior", "relationship", "memory", "delivery"];

function fail(code, status = 409, details) {
  const error = Object.assign(new Error(code), { code, status });
  if (details) error.details = details;
  throw error;
}

function asRatings(value) {
  try {
    const ratings = typeof value === "string" ? JSON.parse(value) : value;
    if (!ratings || typeof ratings !== "object" || Array.isArray(ratings)) return null;
    return ratings;
  } catch { return null; }
}

function latestRows(rows) {
  const latest = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const turnId = String(row.turn_id || "");
    const revision = Number(row.revision || 0);
    if (!turnId || !Number.isInteger(revision) || revision < 1) continue;
    const current = latest.get(turnId);
    if (!current || revision > Number(current.revision)) latest.set(turnId, row);
  }
  return [...latest.values()];
}

function sessionCommitment(replicaIdValue, sessionId) {
  return sha256Hex(canonicalJson({ schema: FEEDBACK_DATASET_SCHEMA, replica_id: replicaIdValue, session_id: String(sessionId) }));
}

function classify(ratings, correctionHash) {
  const values = Object.values(ratings);
  if (values.includes("unsafe")) return "safety_holdout";
  if (correctionHash && values.some((rating) => rating === "close" || rating === "off")) return "preference";
  if (values.length && values.every((rating) => rating === "exact")) return "positive_eval";
  return "negative_eval";
}

function targetCounts(total) {
  if (total < 3) return { train: total, development: 0, test: 0 };
  const test = Math.max(1, Math.round(total * 0.15));
  const development = Math.max(1, Math.round(total * 0.15));
  return { train: Math.max(0, total - test - development), development, test };
}

function assignSessions(groups, existingAssignments) {
  const assignments = new Map();
  for (const row of Array.isArray(existingAssignments) ? existingAssignments : []) {
    const commitment = String(row.session_commitment || "");
    const split = String(row.split || "");
    if (/^[0-9a-f]{64}$/.test(commitment) && SPLITS.includes(split)) assignments.set(commitment, split);
  }
  for (const [commitment, group] of groups) {
    if (!assignments.has(commitment) && group.some((example) => example.kind === "safety_holdout")) assignments.set(commitment, "test");
  }
  const desired = targetCounts(groups.size);
  const counts = { train: 0, development: 0, test: 0 };
  for (const [commitment] of groups) {
    const split = assignments.get(commitment);
    if (split) counts[split] += 1;
  }
  const unassigned = [...groups.keys()].filter((commitment) => !assignments.has(commitment)).sort((left, right) => {
    const a = sha256Hex(`${FEEDBACK_DATASET_SCHEMA}|${left}`);
    const b = sha256Hex(`${FEEDBACK_DATASET_SCHEMA}|${right}`);
    return a.localeCompare(b);
  });
  for (const commitment of unassigned) {
    const split = [...SPLITS].sort((left, right) => {
      const deficit = (desired[right] - counts[right]) - (desired[left] - counts[left]);
      return deficit || SPLITS.indexOf(left) - SPLITS.indexOf(right);
    })[0];
    assignments.set(commitment, split);
    counts[split] += 1;
  }
  return assignments;
}

export function buildFeedbackDatasetDefinition(rows, existingAssignments, options) {
  const rid = String(options?.replica_id || "");
  const profileVersion = Number(options?.profile_version || 0);
  const calibrationVersion = Number(options?.calibration_version || 0);
  if (!rid || !Number.isInteger(profileVersion) || profileVersion < 1 || !Number.isInteger(calibrationVersion) || calibrationVersion < 1)
    fail("feedback_dataset_version_binding_required", 400);
  const examples = [];
  for (const row of latestRows(rows)) {
    const ratings = asRatings(row.ratings);
    if (!ratings || (row.profile_version && Number(row.profile_version) !== profileVersion) || (row.calibration_version && Number(row.calibration_version) !== calibrationVersion)) continue;
    const feedbackId = String(row.feedback_id || "");
    const turnId = String(row.turn_id || "");
    const sessionId = String(row.session_id || "");
    const promptHash = String(row.prompt_hash || "");
    const learnerInputHash = String(row.learner_input_sha256 || "");
    const responseHash = String(row.response_hash || "");
    const ratingsHash = String(row.ratings_hash || "");
    const correctionHash = row.correction_hash ? String(row.correction_hash) : null;
    if (!feedbackId || !turnId || !sessionId || !/^[0-9a-f]{64}$/.test(promptHash) || !/^[0-9a-f]{64}$/.test(learnerInputHash) || !/^[0-9a-f]{64}$/.test(responseHash) || !/^[0-9a-f]{64}$/.test(ratingsHash) || (correctionHash && !/^[0-9a-f]{64}$/.test(correctionHash))) continue;
    const commitment = sessionCommitment(rid, sessionId);
    examples.push({
      feedback_id: feedbackId,
      turn_id: turnId,
      revision: Number(row.revision),
      session_commitment: commitment,
      kind: classify(ratings, correctionHash),
      dimensions: Object.keys(ratings).sort(),
      ratings_hash: ratingsHash,
      prompt_hash: promptHash,
      learner_input_sha256: learnerInputHash,
      response_hash: responseHash,
      correction_hash: correctionHash,
      voice_generation_bound: Boolean(row.source_generation_id),
      generation_commitment: row.source_generation_id ? sha256Hex(`${FEEDBACK_DATASET_SCHEMA}|generation|${row.source_generation_id}`) : null,
    });
  }
  examples.sort((left, right) => left.feedback_id.localeCompare(right.feedback_id));
  const groups = new Map();
  for (const example of examples) {
    const group = groups.get(example.session_commitment) || [];
    group.push(example);
    groups.set(example.session_commitment, group);
  }
  const assignments = assignSessions(groups, existingAssignments);
  for (const example of examples) example.split = assignments.get(example.session_commitment);
  const splitCounts = Object.fromEntries(SPLITS.map((split) => [split, examples.filter((example) => example.split === split).length]));
  // The registry intentionally retains historical assignments to prevent
  // session leakage across rebuilds. Only sessions present in this version's
  // eligible examples can satisfy its evidence requirements.
  const sessionCounts = Object.fromEntries(SPLITS.map((split) => [split, [...groups.keys()].filter((commitment) => assignments.get(commitment) === split).length]));
  const kindCounts = Object.fromEntries(["preference", "positive_eval", "negative_eval", "safety_holdout"].map((kind) => [kind, examples.filter((example) => example.kind === kind).length]));
  const dimensionCounts = Object.fromEntries(REQUIRED_DIMENSIONS.map((dimension) => [dimension, examples.filter((example) => example.dimensions.includes(dimension)).length]));
  const blockers = [];
  const trainPreferences = examples.filter((example) => example.split === "train" && example.kind === "preference").length;
  const holdoutPositives = examples.filter((example) => example.split !== "train" && example.kind === "positive_eval").length;
  if (groups.size < 12) blockers.push("twelve_independent_sessions_required");
  if (trainPreferences < 30) blockers.push("thirty_train_owner_preference_pairs_required");
  if (holdoutPositives < 10) blockers.push("ten_positive_holdout_judgments_required");
  if (sessionCounts.train < 6) blockers.push("six_train_sessions_required");
  if (sessionCounts.development < 2) blockers.push("two_development_sessions_required");
  if (sessionCounts.test < 2) blockers.push("two_test_sessions_required");
  if (splitCounts.development < 20) blockers.push("twenty_development_examples_required");
  if (splitCounts.test < 30) blockers.push("thirty_test_examples_required");
  for (const dimension of REQUIRED_DIMENSIONS) if (dimensionCounts[dimension] < 3) blockers.push(`${dimension}_coverage_required`);
  if (examples.some((example) => example.kind === "safety_holdout" && example.split !== "test")) blockers.push("unsafe_session_was_previously_frozen_outside_test");
  const definition = {
    schema: FEEDBACK_DATASET_SCHEMA,
    feedback_schema: TURN_FEEDBACK_SCHEMA,
    split_policy: "session-locked-70-15-15/v1",
    capability_id: options?.capability_id || null,
    profile_version: profileVersion,
    calibration_version: calibrationVersion,
    examples,
    stats: { examples: examples.length, sessions: groups.size, split_counts: splitCounts, session_counts: sessionCounts, kind_counts: kindCounts, dimension_counts: dimensionCounts, train_preferences: trainPreferences, holdout_positives: holdoutPositives },
  };
  const sourceSetHash = sha256Hex(canonicalJson(definition));
  return {
    definition,
    source_set_hash: sourceSetHash,
    readiness: { ready_for_candidate_dataset: blockers.length === 0, blockers },
    assignments: [...assignments].sort(([left], [right]) => left.localeCompare(right)).map(([session_commitment, split]) => ({ session_commitment, split })),
  };
}

// One statement supplies authority, evidence, assignments and the saved receipt
// from one database snapshot. No source text or encrypted exemplar is selected.
export const FEEDBACK_DATASET_REVIEW_SQL = `with owned as (
  select r.replica_id,r.owner_user_id,r.lifecycle,r.subject_mode,r.policy_version
    from vy_replica r where r.replica_id=$1::uuid and r.owner_user_id=$2::uuid
), active as (
  select r.replica_id,r.owner_user_id,c.capability_id,c.profile_version,c.calibration_version
    from owned r join vy_replica_runtime_capability c
      on c.replica_id=r.replica_id and c.owner_user_id=r.owner_user_id and c.state='active'
   where r.lifecycle='active' and r.subject_mode='self' and r.policy_version=$3 limit 1
), latest as (
  select distinct on (f.turn_id) f.* from vy_replica_turn_feedback f join active a
    on a.replica_id=f.replica_id and a.owner_user_id=f.owner_user_id
   where f.profile_version=a.profile_version and f.calibration_version=a.calibration_version
   order by f.turn_id,f.revision desc
), eligible as (
  select f.*,t.session_id,t.prompt_hash,
    encode(digest(convert_to(u.content,'UTF8'),'sha256'),'hex') as learner_input_sha256
  from latest f join vy_replica_dialogue_turn t
    on t.turn_id=f.turn_id and t.replica_id=f.replica_id and t.owner_user_id=f.owner_user_id
   and t.capability_id=f.capability_id and t.profile_version=f.profile_version
   and t.calibration_version=f.calibration_version and t.response_hash=f.response_hash and t.state='complete'
   join vy_account_person p on p.auth_user_id=f.owner_user_id and p.person_id=t.person_id
   join meera_log u on u.id=t.user_log_id and u.agent_id=t.agent_id and u.device_id=t.device_id and u.role='me'
) select o.replica_id,a.capability_id,a.profile_version,a.calibration_version,now() as checked_at,
  coalesce((select jsonb_agg(to_jsonb(e)) from eligible e),'[]'::jsonb) as feedback_rows,
  coalesce((select jsonb_agg(jsonb_build_object('session_commitment',s.session_commitment,'split',s.split))
    from vy_replica_feedback_split s where s.replica_id=o.replica_id and s.owner_user_id=o.owner_user_id),'[]'::jsonb) as assignments,
  (select jsonb_build_object('dataset_id',d.dataset_id,'version',d.version,'profile_version',d.profile_version,
     'calibration_version',d.calibration_version,'capability_id',d.definition->>'capability_id',
     'source_set_hash',d.source_set_hash,'status',d.status,'created_at',d.created_at)
    from vy_replica_feedback_dataset d where d.replica_id=o.replica_id and d.owner_user_id=o.owner_user_id
      and d.profile_version=a.profile_version and d.calibration_version=a.calibration_version
    order by d.version desc limit 1) as saved_dataset
  from owned o left join active a on a.replica_id=o.replica_id`;

export const FEEDBACK_DATASET_BUILD_SQL = `with authorized as (
       select r.replica_id,r.owner_user_id,c.profile_version,c.calibration_version
         from vy_replica r join vy_replica_runtime_capability c
           on c.replica_id=r.replica_id and c.owner_user_id=r.owner_user_id and c.state='active'
        where r.replica_id=$1::uuid and r.owner_user_id=$2::uuid and r.lifecycle='active' and r.subject_mode='self'
          and r.policy_version=$11 and c.profile_version=$4::int4 and c.calibration_version=$5::int4
          and c.capability_id=$13::uuid
        for update of r,c
     ), latest_feedback as (
       select distinct on (f.turn_id) f.* from vy_replica_turn_feedback f join authorized a
         on a.replica_id=f.replica_id and a.owner_user_id=f.owner_user_id
        where f.profile_version=a.profile_version and f.calibration_version=a.calibration_version
        order by f.turn_id,f.revision desc
     ), latest as (
       select f.feedback_id,f.revision,jsonb_build_object('turn_id',f.turn_id,'ratings',f.ratings,
         'ratings_hash',f.ratings_hash,'response_hash',f.response_hash,'correction_hash',f.correction_hash,
         'source_generation_id',f.source_generation_id,'session_id',t.session_id,'prompt_hash',t.prompt_hash,
         'learner_input_sha256',encode(digest(convert_to(u.content,'UTF8'),'sha256'),'hex')) as fingerprint
         from latest_feedback f join vy_replica_dialogue_turn t
           on t.turn_id=f.turn_id and t.replica_id=f.replica_id and t.owner_user_id=f.owner_user_id
          and t.capability_id=f.capability_id and t.profile_version=f.profile_version
          and t.calibration_version=f.calibration_version and t.response_hash=f.response_hash and t.state='complete'
          join vy_account_person p on p.auth_user_id=f.owner_user_id and p.person_id=t.person_id
          join meera_log u on u.id=t.user_log_id and u.agent_id=t.agent_id and u.device_id=t.device_id and u.role='me'
     ), expected as (
       select * from jsonb_to_recordset($9::jsonb) as x(feedback_id uuid,revision integer,fingerprint jsonb)
     ), unchanged as (
       select 1 where exists(select 1 from latest)
         and not exists(select 1 from latest l full join expected e using(feedback_id,revision)
                         where l.feedback_id is null or e.feedback_id is null or l.fingerprint is distinct from e.fingerprint)
     ), split_rows as (
       select * from jsonb_to_recordset($12::jsonb) as x(session_commitment text,split text)
     ), compatible as (
       select 1 where not exists(
         select 1 from split_rows s join vy_replica_feedback_split x
           on x.replica_id=$1::uuid and x.owner_user_id=$2::uuid and x.session_commitment=s.session_commitment
          where x.split<>s.split
       )
     ), numbered as (
       select coalesce(max(d.version),0)+1 as version from vy_replica_feedback_dataset d join authorized a
         on a.replica_id=d.replica_id
     ), inserted as (
       insert into vy_replica_feedback_dataset
         (dataset_id,replica_id,owner_user_id,version,profile_version,calibration_version,schema_version,
          source_set_hash,definition,readiness,status)
       select $3::uuid,a.replica_id,a.owner_user_id,n.version,a.profile_version,a.calibration_version,$6,$7,$8::jsonb,$10::jsonb,'draft'
         from authorized a,numbered n,unchanged,compatible
       on conflict (replica_id,owner_user_id,profile_version,calibration_version,source_set_hash)
       do update set source_set_hash=excluded.source_set_hash
       returning *
     ), registered as (
       insert into vy_replica_feedback_split(replica_id,owner_user_id,session_commitment,split,first_dataset_id)
       select i.replica_id,i.owner_user_id,s.session_commitment,s.split,i.dataset_id from inserted i,split_rows s
       on conflict (replica_id,owner_user_id,session_commitment) do update
         set split=vy_replica_feedback_split.split
         where vy_replica_feedback_split.split=excluded.split
       returning session_commitment
     ) select i.dataset_id,i.version,i.profile_version,i.calibration_version,i.source_set_hash,
         i.definition->>'capability_id' as capability_id,i.status,i.created_at
         from inserted i where (select count(*) from registered)=(select count(*) from split_rows)`;

function parsed(value, fallback) {
  if (value == null) return fallback;
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch { fail("feedback_dataset_state_invalid", 503); }
}

function receipt(row) {
  if (!row) return null;
  return {
    dataset_id: row.dataset_id, version: Number(row.version), capability_id: row.capability_id || null,
    profile_version: Number(row.profile_version), calibration_version: Number(row.calibration_version),
    source_set_hash: row.source_set_hash, status: row.status, created_at: row.created_at,
  };
}

async function reviewState(db, ownerUserId, rawReplicaId) {
  const rid = replicaId(rawReplicaId);
  const rows = await db(FEEDBACK_DATASET_REVIEW_SQL, [rid, ownerUserId, REPLICA_POLICY_VERSION]);
  const row = rows[0];
  if (!row) fail("replica_not_found", 404);
  if (!row.capability_id) return { rid, row, built: null, feedbackRows: [] };
  const feedbackRows = parsed(row.feedback_rows, []);
  const assignments = parsed(row.assignments, []);
  if (!Array.isArray(feedbackRows) || !Array.isArray(assignments)) fail("feedback_dataset_state_invalid", 503);
  const built = buildFeedbackDatasetDefinition(feedbackRows, assignments, { replica_id: rid,
    capability_id: row.capability_id, profile_version: row.profile_version, calibration_version: row.calibration_version });
  return { rid, row, built, feedbackRows };
}

function clientReview({ rid, row, built }, savedOverride) {
  const dataset = receipt(savedOverride === undefined ? parsed(row.saved_dataset, null) : savedOverride);
  if (!built) return { replica_id: rid, state: "inactive", can_build: false, binding: null,
    source_set_hash: null, stats: null, readiness: { ready_for_candidate_dataset: false, blockers: ["feedback_dataset_runtime_not_active"] },
    dataset: null, changed_since_saved: false, checked_at: row.checked_at };
  const changed = Boolean(dataset && dataset.source_set_hash !== built.source_set_hash);
  return {
    replica_id: rid,
    state: !built.definition.examples.length ? "empty" : changed ? "stale" : built.readiness.ready_for_candidate_dataset ? "ready" : "collecting",
    can_build: built.definition.examples.length > 0,
    binding: { capability_id: row.capability_id, profile_version: Number(row.profile_version), calibration_version: Number(row.calibration_version) },
    source_set_hash: built.source_set_hash, stats: built.definition.stats, readiness: built.readiness,
    dataset, changed_since_saved: changed, checked_at: row.checked_at,
  };
}

export async function readOwnedFeedbackDatasetReview(db, ownerUserId, rawReplicaId) {
  return clientReview(await reviewState(db, ownerUserId, rawReplicaId));
}

export async function buildOwnedFeedbackDataset(db, ownerUserId, rawReplicaId, expectedSourceSetHash) {
  // Every HTTP/default build must bind a previously reviewed source set.
  // Missing hashes are a named refusal, never a compatibility bypass.
  if (typeof expectedSourceSetHash !== "string" || expectedSourceSetHash.length !== 64 || !/^[0-9a-f]{64}$/.test(expectedSourceSetHash))
    fail("feedback_dataset_review_required", 400);
  const state = await reviewState(db, ownerUserId, rawReplicaId);
  const { rid, row, built, feedbackRows } = state;
  if (!built) fail("feedback_dataset_runtime_not_active");
  if (!built.definition.examples.length) fail("feedback_dataset_no_eligible_evidence", 409, clientReview(state));
  if (built.source_set_hash !== expectedSourceSetHash) fail("feedback_dataset_review_changed", 409);
  const datasetId = randomUUID();
  const byId = new Map(feedbackRows.map(feedback => [String(feedback.feedback_id), feedback]));
  const expected = built.definition.examples.map(example => {
    const feedback = byId.get(example.feedback_id);
    return { feedback_id: example.feedback_id, revision: example.revision, fingerprint: {
      turn_id: feedback.turn_id, ratings: asRatings(feedback.ratings), ratings_hash: feedback.ratings_hash,
      prompt_hash: feedback.prompt_hash, learner_input_sha256: feedback.learner_input_sha256,
      response_hash: feedback.response_hash, correction_hash: feedback.correction_hash || null,
      source_generation_id: feedback.source_generation_id || null, session_id: feedback.session_id,
    } };
  });
  const stored = await db(FEEDBACK_DATASET_BUILD_SQL,
    [rid, ownerUserId, datasetId, row.profile_version, row.calibration_version, FEEDBACK_DATASET_SCHEMA,
      built.source_set_hash, JSON.stringify(built.definition), JSON.stringify(expected), JSON.stringify(built.readiness),
      REPLICA_POLICY_VERSION, JSON.stringify(built.assignments), row.capability_id]);
  if (!stored[0]) fail("feedback_dataset_changed_during_build", 409);
  return { dataset: receipt(stored[0]), review: clientReview(state, stored[0]) };
}
