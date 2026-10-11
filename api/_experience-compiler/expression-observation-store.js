import { verifyExpressionObservation } from "./expression-observation.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SAFE_SCOPE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{1,127}$/;

const COLUMNS = `observation_id,replica_id,owner_user_id,source_id,source_commitment_id,
  source_record_hash,source_content_sha256,session_id,window_id,mirror_turn_id,turn_id,dyad_id,
  agent_id,person_id,span_unit,span_start,span_end,span_content_sha256,span_hash,
  feature_name,feature_value,feature_unit,epistemic_status,confidence,
  producer_kind,producer_name,producer_revision,producer_code_hash,
  calibration_status,calibration_method,calibration_revision,calibration_sample_size,
  calibration_dataset_hash,calibration_measured_at,observed_at,expires_at,
  compiler_revision,claim_target,interpretation,may_claim_inner_emotion,record_hash,
  source_consent_id,created_at`;

function fail(code, details = null) {
  const error = Object.assign(new Error(code), { code });
  if (details !== null) error.details = details;
  throw error;
}

function uuid(value, code, optional = false) {
  if (optional && (value === null || value === undefined || value === "")) return null;
  const normalized = String(value || "").toLowerCase();
  if (!UUID.test(normalized)) fail(code);
  return normalized;
}

function boundedLimit(value, fallback = 100) {
  const number = Number(value ?? fallback);
  if (!Number.isInteger(number) || number < 1 || number > 500) fail("expression_observation_limit_invalid");
  return number;
}

function instant(value, code) {
  const millis = Date.parse(String(value || ""));
  if (!Number.isFinite(millis)) fail(code);
  return new Date(millis).toISOString();
}

function optionalScopeId(value, code) {
  if (value === null || value === undefined || value === "") return null;
  const normalized = String(value);
  if (!SAFE_SCOPE_ID.test(normalized)) fail(code);
  return normalized;
}

function databaseScope(input) {
  const sessionId = uuid(input?.sessionId, "expression_session_id_invalid", true);
  const windowId = uuid(input?.windowId, "expression_window_id_invalid", true);
  const mirrorTurnId = uuid(input?.mirrorTurnId, "expression_mirror_turn_id_invalid", true);
  if (!sessionId && (windowId || mirrorTurnId)) fail("expression_mirror_scope_invalid");
  if (!windowId && mirrorTurnId) fail("expression_mirror_scope_invalid");
  return {
    ownerUserId: uuid(input?.ownerUserId, "expression_owner_id_invalid"),
    replicaId: uuid(input?.replicaId, "expression_replica_id_invalid"),
    sourceId: uuid(input?.sourceId, "expression_source_id_invalid"),
    sessionId,
    windowId,
    mirrorTurnId,
    agentId: uuid(input?.agentId, "expression_agent_id_invalid", true),
    personId: uuid(input?.personId, "expression_person_id_invalid", true),
  };
}

function paramsFor(scope, observation) {
  return [
    observation.observation_id,
    scope.replicaId,
    scope.ownerUserId,
    scope.sourceId,
    observation.source.source_id,
    observation.source.source_hash,
    observation.source.content_sha256,
    scope.sessionId,
    scope.windowId,
    scope.mirrorTurnId,
    observation.expression.turn_id,
    observation.scope.dyad_id,
    scope.agentId,
    scope.personId,
    observation.span.unit,
    observation.span.start,
    observation.span.end,
    observation.span.content_sha256,
    observation.span.span_hash,
    observation.value.feature_name,
    observation.value.feature_value,
    observation.value.feature_unit,
    observation.epistemic_status,
    observation.confidence,
    observation.producer.kind,
    observation.producer.name,
    observation.producer.revision,
    observation.producer.code_hash,
    observation.calibration.status,
    observation.calibration.method,
    observation.calibration.revision,
    observation.calibration.sample_size,
    observation.calibration.dataset_hash,
    observation.calibration.measured_at,
    observation.observed_at,
    observation.expires_at,
    observation.compiler_revision,
    observation.expression.claim_target,
    observation.expression.interpretation,
    observation.expression.may_claim_inner_emotion,
    observation.record_hash,
    uuid(observation.source.consent_receipt_id, "expression_source_consent_id_invalid"),
  ];
}

function recordFor(scope, observation) {
  const values = paramsFor(scope, observation);
  return Object.freeze({
    observation_id: values[0], replica_id: values[1], owner_user_id: values[2], source_id: values[3],
    source_commitment_id: values[4], source_record_hash: values[5], source_content_sha256: values[6],
    session_id: values[7], window_id: values[8], mirror_turn_id: values[9], turn_id: values[10],
    dyad_id: values[11], agent_id: values[12], person_id: values[13], span_unit: values[14],
    span_start: values[15], span_end: values[16], span_content_sha256: values[17], span_hash: values[18],
    feature_name: values[19], feature_value: values[20], feature_unit: values[21],
    epistemic_status: values[22], confidence: values[23], producer_kind: values[24],
    producer_name: values[25], producer_revision: values[26], producer_code_hash: values[27],
    calibration_status: values[28], calibration_method: values[29], calibration_revision: values[30],
    calibration_sample_size: values[31], calibration_dataset_hash: values[32],
    calibration_measured_at: values[33], observed_at: values[34], expires_at: values[35],
    compiler_revision: values[36], claim_target: values[37], interpretation: values[38],
    may_claim_inner_emotion: values[39], record_hash: values[40], source_consent_id: values[41],
  });
}

/** Validate and flatten a committed observation for a larger atomic write.
 * This is deliberately the same serializer used by the standalone repository,
 * so Mirror settlement cannot acquire a second, looser persistence contract. */
export function prepareExpressionObservationPersistence(rawScope, rawObservation) {
  const scope = databaseScope(rawScope);
  const observation = verifyExpressionObservation(rawObservation);
  if (observation.scope.owner_id.toLowerCase() !== scope.ownerUserId) fail("expression_owner_scope_mismatch");
  if (scope.mirrorTurnId && observation.expression.turn_id.toLowerCase() !== scope.mirrorTurnId) {
    fail("expression_turn_scope_mismatch");
  }
  return Object.freeze({ scope, observation, record: recordFor(scope, observation) });
}

/** Persist one immutable feature observation after resolving every available
 * database scope. A source hash, owner, replica, Mirror id, agent or person
 * mismatch makes the authorized CTE empty; no plausible row is returned. */
export async function persistExpressionObservation(db, rawScope, rawObservation) {
  const { scope, observation } = prepareExpressionObservationPersistence(rawScope, rawObservation);
  const rows = await db(
    `with authorized as materialized (
       select s.source_id
         from vy_replica_source s
         join vy_replica r on r.replica_id=s.replica_id and r.owner_user_id=s.owner_user_id
         join vy_replica_consent c on c.consent_id=$42::uuid
          and c.replica_id=r.replica_id and c.owner_user_id=r.owner_user_id
          and c.scope='training' and c.policy_version=r.policy_version
          and c.revoked_at is null and (c.expires_at is null or c.expires_at>now())
        where s.source_id=$4::uuid and s.replica_id=$2::uuid and s.owner_user_id=$3::uuid
          and s.sha256=$7
          and ($13::uuid is null or r.agent_id=$13::uuid)
          and ($14::uuid is null or exists (
            select 1 from vy_person p where p.person_id=$14::uuid
          ))
          and ($8::uuid is null or exists (
            select 1 from vy_mirror_session ms
             where ms.session_id=$8::uuid and ms.replica_id=$2::uuid and ms.owner_user_id=$3::uuid
          ))
          and ($9::uuid is null or exists (
            select 1 from vy_mirror_window mw
             where mw.window_id=$9::uuid and mw.session_id=$8::uuid
               and mw.replica_id=$2::uuid and mw.owner_user_id=$3::uuid
          ))
          and ($10::uuid is null or exists (
            select 1 from vy_mirror_turn mt
             where mt.turn_id=$10::uuid and mt.window_id=$9::uuid and mt.session_id=$8::uuid
               and mt.replica_id=$2::uuid and mt.owner_user_id=$3::uuid
          ))
     ), inserted as (
       insert into vy_replica_expression_observation (
         observation_id,replica_id,owner_user_id,source_id,source_commitment_id,
         source_record_hash,source_content_sha256,session_id,window_id,mirror_turn_id,turn_id,dyad_id,
         agent_id,person_id,span_unit,span_start,span_end,span_content_sha256,span_hash,
         feature_name,feature_value,feature_unit,epistemic_status,confidence,
         producer_kind,producer_name,producer_revision,producer_code_hash,
         calibration_status,calibration_method,calibration_revision,calibration_sample_size,
         calibration_dataset_hash,calibration_measured_at,observed_at,expires_at,
         compiler_revision,claim_target,interpretation,may_claim_inner_emotion,record_hash,source_consent_id)
       select $1,$2::uuid,$3::uuid,a.source_id,$5,$6,$7,$8::uuid,$9::uuid,$10::uuid,$11,$12,
              $13::uuid,$14::uuid,$15,$16::int8,$17::int8,$18,$19,
              $20,$21::float8,$22,$23,$24::float8,$25,$26,$27,$28,
              $29,$30,$31,$32::int4,$33,$34::timestamptz,$35::timestamptz,$36::timestamptz,
              $37,$38,$39,$40::boolean,$41,$42::uuid
         from authorized a
       on conflict (observation_id) do nothing
       returning ${COLUMNS}
     ), identical as (
       select o.*
         from vy_replica_expression_observation o cross join authorized a
        where o.observation_id=$1 and o.record_hash=$41
          and o.replica_id=$2::uuid and o.owner_user_id=$3::uuid and o.source_id=$4::uuid
          and o.session_id is not distinct from $8::uuid
          and o.window_id is not distinct from $9::uuid
          and o.mirror_turn_id is not distinct from $10::uuid
          and o.agent_id is not distinct from $13::uuid
          and o.person_id is not distinct from $14::uuid
          and o.source_consent_id=$42::uuid
     )
     select * from inserted union all select * from identical limit 1`,
    paramsFor(scope, observation),
  );
  if (!rows[0]) fail("expression_observation_persist_denied");
  return rows[0];
}

/** Active observations only. Expired rows are never eligible for a live read,
 * even if the physical retention sweep has not deleted them yet. */
export async function listActiveExpressionObservations(db, ownerUserId, replicaId, options = {}) {
  const owner = uuid(ownerUserId, "expression_owner_id_invalid");
  const replica = uuid(replicaId, "expression_replica_id_invalid");
  const at = options.at == null ? new Date().toISOString() : instant(options.at, "expression_read_time_invalid");
  const sessionId = uuid(options.sessionId, "expression_session_id_invalid", true);
  const dyadId = optionalScopeId(options.dyadId, "expression_dyad_id_invalid");
  const agentId = uuid(options.agentId, "expression_agent_id_invalid", true);
  const personId = uuid(options.personId, "expression_person_id_invalid", true);
  return db(
    `select o.* from vy_replica_expression_observation o
      join vy_replica r on r.replica_id=o.replica_id and r.owner_user_id=$1::uuid
      join vy_replica_consent c on c.consent_id=o.source_consent_id
       and c.replica_id=o.replica_id and c.owner_user_id=o.owner_user_id
       and c.scope='training' and c.policy_version=r.policy_version
       and c.revoked_at is null and (c.expires_at is null or c.expires_at>now())
     where o.owner_user_id=$1::uuid and o.replica_id=$2::uuid and o.expires_at>$3::timestamptz
       and r.lifecycle not in ('revoked','purging')
       and (o.session_id is null or exists (
         select 1 from vy_replica_processing_evidence speaker
         join vy_replica_processing_evidence_decision decision
           on decision.evidence_id=speaker.evidence_id
          and decision.replica_id=speaker.replica_id and decision.owner_user_id=speaker.owner_user_id
          and decision.decision='accepted'
          and not exists (
            select 1 from vy_replica_processing_evidence_decision newer
             where newer.evidence_id=decision.evidence_id
               and newer.replica_id=decision.replica_id and newer.owner_user_id=decision.owner_user_id
               and (newer.created_at,newer.decision_id)>(decision.created_at,decision.decision_id)
          )
          where speaker.replica_id=o.replica_id and speaker.owner_user_id=o.owner_user_id
            and speaker.source_id=o.source_id and speaker.evidence_type='speaker_segment'
            and coalesce((speaker.value->>'target_likelihood')::double precision,0)>=0.8
            and speaker.span_start_ms<o.span_end and speaker.span_end_ms>o.span_start
       ))
       and ($4::uuid is null or o.session_id=$4::uuid)
       and ($5::text is null or o.dyad_id=$5)
       and ($6::uuid is null or o.agent_id=$6::uuid)
       and ($7::uuid is null or o.person_id=$7::uuid)
     order by o.observed_at desc,o.observation_id desc limit $8::int4`,
    [owner, replica, at, sessionId, dyadId, agentId, personId, boundedLimit(options.limit)],
  );
}

/** Owner export page. Unlike the live reader, this includes expired rows that
 * have not yet been physically purged, so an export never conceals held data. */
export async function readExpressionObservationExportPage(db, ownerUserId, replicaId, options = {}) {
  const owner = uuid(ownerUserId, "expression_owner_id_invalid");
  const replica = uuid(replicaId, "expression_replica_id_invalid");
  const afterObservedAt = options.afterObservedAt == null
    ? null : instant(options.afterObservedAt, "expression_export_cursor_invalid");
  const afterId = optionalScopeId(options.afterId, "expression_export_cursor_invalid");
  if ((afterObservedAt === null) !== (afterId === null)) fail("expression_export_cursor_invalid");
  return db(
    `select o.* from vy_replica_expression_observation o
      join vy_replica r on r.replica_id=o.replica_id and r.owner_user_id=$1::uuid
     where o.owner_user_id=$1::uuid and o.replica_id=$2::uuid
       and ($3::timestamptz is null or (o.observed_at,o.observation_id)>($3::timestamptz,$4::text))
     order by o.observed_at,o.observation_id limit $5::int4`,
    [owner, replica, afterObservedAt, afterId, boundedLimit(options.limit, 250)],
  );
}

/** Retention seam for a future owner-lane sweep. It is deliberately not called
 * by response generation or UI code. */
export async function purgeExpiredExpressionObservations(db, options = {}) {
  const before = options.before == null ? new Date().toISOString() : instant(options.before, "expression_purge_time_invalid");
  const rows = await db(
    `with doomed as (
       select observation_id from vy_replica_expression_observation
        where expires_at<=$1::timestamptz
        order by expires_at,observation_id limit $2::int4 for update skip locked
     )
     delete from vy_replica_expression_observation o using doomed d
      where o.observation_id=d.observation_id
     returning o.observation_id`,
    [before, boundedLimit(options.limit, 500)],
  );
  return rows.map((row) => row.observation_id);
}
