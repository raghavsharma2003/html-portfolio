import { randomInt, randomUUID } from "node:crypto";
import { canonicalJson, sha256Hex } from "./_provenance/contracts.js";
import {
  CANDIDATE_QUALIFICATION_PROTOCOL,
  blindAssignmentHash,
  candidateRequiredLayers,
} from "./_replica-candidate-qualification.js";
import {
  decryptEvaluationText,
  encryptEvaluationText,
  evaluationTextHash,
} from "./_replica-candidate-eval-crypto.js";
import { FEEDBACK_DATASET_SCHEMA } from "./_replica-feedback-dataset.js";
import { stableUuid } from "./_replica-processing/contracts.js";
import { replicaId } from "./_replica.js";

export const CANDIDATE_OWNER_EVAL_PROTOCOL = "vyakti.candidate-owner-eval.v1";
const SHA256 = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const POSITION_WINNERS = new Set(["a", "b", "tie"]);
const TEXT_KINDS = new Set(["dialogue_adapter", "prompt_policy"]);

function fail(code, status = 409) {
  throw Object.assign(new Error(code), { code, status });
}

function safeUuid(value, code) {
  const id = String(value || "").trim().toLowerCase();
  if (!UUID.test(id)) fail(code, 400);
  return id;
}

function safeHash(value, code) {
  const hash = String(value || "").trim().toLowerCase();
  if (!SHA256.test(hash)) fail(code, 400);
  return hash;
}

function displayText(value, code) {
  const text = String(value || "").replace(/\r\n?/g, "\n").trim();
  const length = Array.from(text).length;
  if (!text || length > 4_000) fail(code, length > 4_000 ? 413 : 400);
  if (Array.from(text).some((character) => {
    const point = character.codePointAt(0);
    return point !== 10 && point < 32;
  })) fail(code, 400);
  return text;
}

function parseJson(value, fallback) {
  if (value == null) return fallback;
  if (typeof value === "object") return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

function shuffled(rows, pick) {
  const result = [...rows];
  for (let index = result.length - 1; index > 0; index--) {
    const swap = pick(index + 1);
    [result[index], result[swap]] = [result[swap], result[index]];
  }
  return result;
}

function encryptedAsset({ runId, assignmentId, candidate, exampleId, role, text }, env) {
  const assetId = stableUuid(`candidate-owner-eval-asset/v1:${assignmentId}:${role}`);
  const outputHash = evaluationTextHash(text);
  const binding = {
    run_id: runId,
    assignment_id: assignmentId,
    asset_id: assetId,
    replica_id: candidate.replica_id,
    owner_user_id: candidate.owner_user_id,
    example_id: exampleId,
    role,
    output_sha256: outputHash,
  };
  return Object.freeze({
    asset_id: assetId,
    assignment_id: assignmentId,
    eval_run_id: runId,
    candidate_id: candidate.candidate_id,
    replica_id: candidate.replica_id,
    owner_user_id: candidate.owner_user_id,
    example_id: exampleId,
    role,
    output_sha256: outputHash,
    ...encryptEvaluationText(text, binding, env),
  });
}

export function buildCandidateEvaluationPackage(input, env = process.env, options = {}) {
  const candidate = input?.candidate || {};
  const dataset = input?.dataset || {};
  const candidateId = safeUuid(candidate.candidate_id, "candidate_id_invalid");
  const datasetId = safeUuid(candidate.dataset_id, "candidate_dataset_id_invalid");
  const replica = replicaId(candidate.replica_id);
  const owner = safeUuid(candidate.owner_user_id, "candidate_owner_id_invalid");
  if (dataset.schema !== FEEDBACK_DATASET_SCHEMA || safeUuid(dataset.dataset_id, "candidate_dataset_id_invalid") !== datasetId)
    fail("candidate_eval_dataset_invalid", 400);
  const sourceSetHash = safeHash(dataset.source_set_hash, "candidate_eval_dataset_hash_invalid");
  if (sourceSetHash !== safeHash(candidate.dataset_source_set_hash, "candidate_eval_dataset_hash_invalid"))
    fail("candidate_eval_dataset_changed");
  const kind = String(candidate.kind || "");
  const dimensions = candidateRequiredLayers(kind);
  if (!dimensions || !TEXT_KINDS.has(kind)) fail("candidate_eval_asset_kind_not_supported", 400);
  if (!["draft", "evaluating"].includes(String(candidate.status || ""))) fail("candidate_eval_candidate_unavailable");
  const artifactHash = safeHash(candidate.artifact_sha256, "candidate_eval_artifact_hash_invalid");
  const baseHash = safeHash(candidate.base_model_commitment, "candidate_eval_base_hash_invalid");
  const manifestHash = safeHash(candidate.build_manifest_hash, "candidate_eval_manifest_hash_invalid");
  const rows = Array.isArray(input.examples) ? input.examples : [];
  if (rows.length < 30 || rows.length > 100) fail("candidate_eval_example_count_invalid", 400);
  const seen = new Set();
  const examples = rows.map((row) => {
    const exampleId = safeUuid(row?.feedback_id, "candidate_eval_example_id_invalid");
    if (seen.has(exampleId) || row?.split !== "test") fail("candidate_eval_example_invalid", 400);
    seen.add(exampleId);
    return Object.freeze({
      example_id: exampleId,
      session_commitment: safeHash(row.session_commitment, "candidate_eval_session_invalid"),
      context: displayText(row.context, "candidate_eval_context_invalid"),
      baseline: displayText(row.baseline, "candidate_eval_baseline_invalid"),
      candidate: displayText(row.candidate, "candidate_eval_candidate_output_invalid"),
    });
  });
  if (new Set(examples.map((row) => row.session_commitment)).size < 2) fail("candidate_eval_sessions_insufficient", 400);
  const pick = typeof options.pick === "function" ? options.pick : randomInt;
  const ordered = shuffled(examples, pick);
  const firstOrder = pick(2) === 0 ? "ab" : "ba";
  const planned = ordered.map((example, index) => ({
    ...example,
    sequence: index + 1,
    order: index % 2 === 0 ? firstOrder : firstOrder === "ab" ? "ba" : "ab",
    context_sha256: evaluationTextHash(example.context),
    baseline_sha256: evaluationTextHash(example.baseline),
    candidate_sha256: evaluationTextHash(example.candidate),
  }));
  const runCommitment = sha256Hex(canonicalJson({
    protocol: CANDIDATE_OWNER_EVAL_PROTOCOL,
    qualification_protocol: CANDIDATE_QUALIFICATION_PROTOCOL,
    candidate_id: candidateId,
    dataset_id: datasetId,
    dataset_source_set_hash: sourceSetHash,
    candidate_kind: kind,
    artifact_sha256: artifactHash,
    base_model_commitment: baseHash,
    build_manifest_hash: manifestHash,
    dimensions,
    assignments: planned.map((row) => ({
      example_id: row.example_id,
      session_commitment: row.session_commitment,
      sequence: row.sequence,
      order: row.order,
      context_sha256: row.context_sha256,
      baseline_sha256: row.baseline_sha256,
      candidate_sha256: row.candidate_sha256,
    })),
  }));
  const runId = stableUuid(`candidate-owner-eval-run/v1:${runCommitment}`);
  const assets = [];
  const assignments = planned.map((example) => {
    const assignmentId = stableUuid(`candidate-owner-eval-assignment/v1:${runId}:${example.example_id}`);
    const assignmentHash = blindAssignmentHash(runCommitment, example.example_id, example.order);
    const shownA = example.order === "ab" ? example.baseline : example.candidate;
    const shownB = example.order === "ab" ? example.candidate : example.baseline;
    assets.push(
      encryptedAsset({ runId, assignmentId, candidate: { ...candidate, candidate_id: candidateId, replica_id: replica, owner_user_id: owner }, exampleId: example.example_id, role: "context", text: example.context }, env),
      encryptedAsset({ runId, assignmentId, candidate: { ...candidate, candidate_id: candidateId, replica_id: replica, owner_user_id: owner }, exampleId: example.example_id, role: "a", text: shownA }, env),
      encryptedAsset({ runId, assignmentId, candidate: { ...candidate, candidate_id: candidateId, replica_id: replica, owner_user_id: owner }, exampleId: example.example_id, role: "b", text: shownB }, env),
    );
    return Object.freeze({
      assignment_id: assignmentId,
      eval_run_id: runId,
      candidate_id: candidateId,
      replica_id: replica,
      owner_user_id: owner,
      example_id: example.example_id,
      session_commitment: example.session_commitment,
      sequence: example.sequence,
      presentation_order: example.order,
      assignment_hash: assignmentHash,
    });
  });
  return Object.freeze({
    eval_run_id: runId,
    candidate_id: candidateId,
    dataset_id: datasetId,
    replica_id: replica,
    owner_user_id: owner,
    protocol_version: CANDIDATE_OWNER_EVAL_PROTOCOL,
    run_commitment: runCommitment,
    dataset_source_set_hash: sourceSetHash,
    required_dimensions: Object.freeze([...dimensions]),
    assignment_count: assignments.length,
    assignments: Object.freeze(assignments),
    assets: Object.freeze(assets),
  });
}

export async function persistCandidateEvaluationPackage(db, ownerUserId, pack) {
  if (typeof db !== "function") fail("candidate_eval_db_required", 503);
  if (safeUuid(pack?.owner_user_id, "candidate_owner_id_invalid") !== String(ownerUserId).toLowerCase())
    fail("candidate_eval_owner_mismatch", 403);
  const assignments = pack.assignments.map((row) => ({
    assignment_id: row.assignment_id,
    example_id: row.example_id,
    session_commitment: row.session_commitment,
    sequence: row.sequence,
    presentation_order: row.presentation_order,
    assignment_hash: row.assignment_hash,
  }));
  const assets = pack.assets.map((row) => ({
    asset_id: row.asset_id,
    assignment_id: row.assignment_id,
    example_id: row.example_id,
    role: row.role,
    output_sha256: row.output_sha256,
    algorithm: row.algorithm,
    key_id: row.key_id,
    nonce_b64: row.nonce_b64,
    ciphertext_b64: row.ciphertext_b64,
    auth_tag_b64: row.auth_tag_b64,
    wrapped_dek_b64: row.wrapped_dek_b64,
    wrap_nonce_b64: row.wrap_nonce_b64,
    wrap_auth_tag_b64: row.wrap_auth_tag_b64,
    aad_sha256: row.aad_sha256,
  }));
  const rows = await db(
    `with eligible as (
       select c.candidate_id,c.dataset_id,c.replica_id,c.owner_user_id
         from vy_replica_candidate c join vy_replica_feedback_dataset d
           on d.dataset_id=c.dataset_id and d.replica_id=c.replica_id and d.owner_user_id=c.owner_user_id
        where c.candidate_id=$2 and c.dataset_id=$3 and c.replica_id=$4 and c.owner_user_id=$1
          and c.status in ('draft','evaluating') and d.status='draft' and d.source_set_hash=$7
     ), inserted_run as (
       insert into vy_replica_candidate_eval_run
         (eval_run_id,candidate_id,dataset_id,replica_id,owner_user_id,protocol_version,run_commitment,
          dataset_source_set_hash,required_dimensions,assignment_count,state)
       select $5,e.candidate_id,e.dataset_id,e.replica_id,e.owner_user_id,$6,$8,$7,$9::text[],$10,'collecting'
         from eligible e
       on conflict (candidate_id,run_commitment) do nothing returning *
     ), active_run as (
       select * from inserted_run union all
       select r.* from vy_replica_candidate_eval_run r
        where r.eval_run_id=$5 and r.candidate_id=$2 and r.dataset_id=$3 and r.replica_id=$4
          and r.owner_user_id=$1 and r.protocol_version=$6 and r.run_commitment=$8
          and r.dataset_source_set_hash=$7 and r.required_dimensions=$9::text[] and r.assignment_count=$10
       limit 1
     ), wanted_assignments as (
       select * from jsonb_to_recordset($11::jsonb) as x(
         assignment_id uuid,example_id uuid,session_commitment text,sequence integer,
         presentation_order text,assignment_hash text)
     ), inserted_assignments as (
       insert into vy_replica_candidate_eval_assignment
         (assignment_id,eval_run_id,candidate_id,replica_id,owner_user_id,example_id,session_commitment,
          sequence,presentation_order,assignment_hash)
       select w.assignment_id,r.eval_run_id,r.candidate_id,r.replica_id,r.owner_user_id,w.example_id,
              w.session_commitment,w.sequence,w.presentation_order,w.assignment_hash
         from active_run r cross join wanted_assignments w
       on conflict (assignment_id) do nothing
       returning assignment_id,eval_run_id,candidate_id,replica_id,owner_user_id,example_id,
                 session_commitment,sequence,presentation_order,assignment_hash
     ), active_assignments as (
       select * from inserted_assignments union all
       select a.assignment_id,a.eval_run_id,a.candidate_id,a.replica_id,a.owner_user_id,a.example_id,
              a.session_commitment,a.sequence,a.presentation_order,a.assignment_hash
         from vy_replica_candidate_eval_assignment a join active_run r on r.eval_run_id=a.eval_run_id
         join wanted_assignments w on w.assignment_id=a.assignment_id and w.example_id=a.example_id
          and w.session_commitment=a.session_commitment and w.sequence=a.sequence
          and w.presentation_order=a.presentation_order and w.assignment_hash=a.assignment_hash
     ), wanted_assets as (
       select * from jsonb_to_recordset($12::jsonb) as x(
         asset_id uuid,assignment_id uuid,example_id uuid,role text,output_sha256 text,algorithm text,key_id text,
         nonce_b64 text,ciphertext_b64 text,auth_tag_b64 text,wrapped_dek_b64 text,wrap_nonce_b64 text,
         wrap_auth_tag_b64 text,aad_sha256 text)
     ), inserted_assets as (
       insert into vy_replica_candidate_eval_asset
         (asset_id,assignment_id,eval_run_id,candidate_id,replica_id,owner_user_id,example_id,role,
          output_sha256,algorithm,key_id,nonce,ciphertext,auth_tag,wrapped_dek,wrap_nonce,wrap_auth_tag,aad_sha256)
       select w.asset_id,w.assignment_id,r.eval_run_id,r.candidate_id,r.replica_id,r.owner_user_id,w.example_id,w.role,
              w.output_sha256,w.algorithm,w.key_id,decode(w.nonce_b64,'base64'),decode(w.ciphertext_b64,'base64'),
              decode(w.auth_tag_b64,'base64'),decode(w.wrapped_dek_b64,'base64'),decode(w.wrap_nonce_b64,'base64'),
              decode(w.wrap_auth_tag_b64,'base64'),w.aad_sha256
         from active_run r join wanted_assets w on true
         join active_assignments a
           on a.assignment_id=w.assignment_id and a.eval_run_id=r.eval_run_id and a.example_id=w.example_id
          and a.candidate_id=r.candidate_id and a.replica_id=r.replica_id and a.owner_user_id=r.owner_user_id
       on conflict (asset_id) do nothing
       returning asset_id,assignment_id,eval_run_id,example_id,role,output_sha256,aad_sha256
     ), active_assets as (
       select * from inserted_assets union all
       select x.asset_id,x.assignment_id,x.eval_run_id,x.example_id,x.role,x.output_sha256,x.aad_sha256
         from vy_replica_candidate_eval_asset x join active_run r on r.eval_run_id=x.eval_run_id
         join wanted_assets w on w.asset_id=x.asset_id and w.assignment_id=x.assignment_id
          and w.example_id=x.example_id and w.role=x.role and w.output_sha256=x.output_sha256
          and w.aad_sha256=x.aad_sha256
     ) select eval_run_id,replica_id,protocol_version,assignment_count,state,created_at from active_run
        where (select count(*) from active_assignments)=$10
          and (select count(*) from active_assets)=$10*3`,
    [ownerUserId, pack.candidate_id, pack.dataset_id, pack.replica_id, pack.eval_run_id,
      pack.protocol_version, pack.dataset_source_set_hash, pack.run_commitment,
      pack.required_dimensions, pack.assignment_count, JSON.stringify(assignments), JSON.stringify(assets)],
  );
  if (!rows[0]) fail("candidate_eval_package_not_persisted");
  return rows[0];
}

function assetBinding(row, role) {
  const asset = row.assets?.[role];
  if (!asset) fail("candidate_eval_asset_missing");
  return {
    record: asset,
    binding: {
      run_id: row.eval_run_id,
      assignment_id: row.assignment_id,
      asset_id: asset.asset_id,
      replica_id: row.replica_id,
      owner_user_id: row.owner_user_id,
      example_id: row.example_id,
      role,
      output_sha256: asset.output_sha256,
    },
  };
}

function decryptAsset(row, role, env) {
  const { record, binding } = assetBinding(row, role);
  const text = decryptEvaluationText(record, binding, env);
  if (evaluationTextHash(text) !== record.output_sha256) fail("candidate_eval_asset_hash_mismatch");
  return text;
}

export async function loadOwnedCandidateEvaluation(db, ownerUserId, replica, env = process.env) {
  if (typeof db !== "function") fail("candidate_eval_db_required", 503);
  const rid = replicaId(replica);
  const rows = await db(
    `with active as (
       select r.* from vy_replica_candidate_eval_run r join vy_replica_candidate c
         on c.candidate_id=r.candidate_id and c.replica_id=r.replica_id and c.owner_user_id=r.owner_user_id
        where r.replica_id=$1 and r.owner_user_id=$2 and r.state in ('collecting','complete')
          and c.status in ('draft','evaluating','qualified')
        order by case r.state when 'collecting' then 0 else 1 end,r.created_at desc limit 1
     ), next_assignment as (
       select a.* from vy_replica_candidate_eval_assignment a join active r on r.eval_run_id=a.eval_run_id
        where a.state='pending' order by a.sequence limit 1
     ), progress as (
       select count(*)::integer as total,
              count(*) filter (where a.state='submitted')::integer as completed
         from vy_replica_candidate_eval_assignment a join active r on r.eval_run_id=a.eval_run_id
     ), packed_assets as (
       select x.assignment_id,jsonb_object_agg(x.role,jsonb_build_object(
         'asset_id',x.asset_id,'output_sha256',x.output_sha256,'algorithm',x.algorithm,'key_id',x.key_id,
         'nonce_b64',encode(x.nonce,'base64'),'ciphertext_b64',encode(x.ciphertext,'base64'),
         'auth_tag_b64',encode(x.auth_tag,'base64'),'wrapped_dek_b64',encode(x.wrapped_dek,'base64'),
         'wrap_nonce_b64',encode(x.wrap_nonce,'base64'),'wrap_auth_tag_b64',encode(x.wrap_auth_tag,'base64'),
         'aad_sha256',x.aad_sha256)) as assets
         from vy_replica_candidate_eval_asset x join next_assignment a on a.assignment_id=x.assignment_id
        group by x.assignment_id
     )
     select r.eval_run_id,r.replica_id,r.owner_user_id,r.required_dimensions,r.state,
            p.total,p.completed,a.assignment_id,a.example_id,a.sequence,a.assignment_hash,x.assets
       from active r cross join progress p
       left join next_assignment a on true left join packed_assets x on x.assignment_id=a.assignment_id`,
    [rid, ownerUserId],
  );
  const row = rows[0];
  if (!row) return { available: false, replica_id: rid };
  const dimensions = Array.isArray(row.required_dimensions) ? row.required_dimensions : parseJson(row.required_dimensions, []);
  const total = Number(row.total);
  const completed = Number(row.completed);
  if (!row.assignment_id) return {
    available: true,
    replica_id: rid,
    state: "complete",
    progress: { completed, total },
    dimensions,
    assignment: null,
  };
  row.assets = parseJson(row.assets, {});
  return {
    available: true,
    replica_id: rid,
    state: "collecting",
    progress: { completed, total },
    dimensions,
    assignment: {
      assignment_id: row.assignment_id,
      assignment_hash: row.assignment_hash,
      sequence: Number(row.sequence),
      context: decryptAsset(row, "context", env),
      option_a: decryptAsset(row, "a", env),
      option_b: decryptAsset(row, "b", env),
    },
  };
}

export function validatePositionRatings(raw, dimensions) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail("candidate_eval_ratings_required", 400);
  const expected = [...dimensions].sort();
  const entries = Object.entries(raw).sort(([left], [right]) => left.localeCompare(right));
  if (entries.length !== expected.length || entries.some(([dimension], index) => dimension !== expected[index]))
    fail("candidate_eval_ratings_incomplete", 400);
  const ratings = {};
  for (const [dimension, winner] of entries) {
    if (!POSITION_WINNERS.has(String(winner))) fail("candidate_eval_rating_invalid", 400);
    ratings[dimension] = String(winner);
  }
  return Object.freeze(ratings);
}

export async function recordOwnedCandidateJudgment(db, ownerUserId, input) {
  if (typeof db !== "function") fail("candidate_eval_db_required", 503);
  const rid = replicaId(input?.replica_id);
  const assignmentId = safeUuid(input?.assignment_id, "candidate_eval_assignment_id_invalid");
  const assignmentHash = safeHash(input?.assignment_hash, "candidate_eval_assignment_hash_invalid");
  const dimensionsRows = await db(
    `select r.required_dimensions from vy_replica_candidate_eval_assignment a
       join vy_replica_candidate_eval_run r
         on r.eval_run_id=a.eval_run_id and r.candidate_id=a.candidate_id
        and r.replica_id=a.replica_id and r.owner_user_id=a.owner_user_id
      where a.assignment_id=$1 and a.replica_id=$2 and a.owner_user_id=$3
        and a.assignment_hash=$4 and a.state in ('pending','submitted') and r.state='collecting' limit 1`,
    [assignmentId, rid, ownerUserId, assignmentHash],
  );
  const dimensionRow = dimensionsRows[0];
  if (!dimensionRow) fail("candidate_eval_assignment_unavailable", 404);
  const dimensions = Array.isArray(dimensionRow.required_dimensions)
    ? dimensionRow.required_dimensions
    : parseJson(dimensionRow.required_dimensions, []);
  const ratings = validatePositionRatings(input.ratings, dimensions);
  const wanted = Object.entries(ratings).map(([dimension, position_winner]) => ({
    judgment_id: randomUUID(), dimension, position_winner,
  }));
  const rows = await db(
    `with eligible as (
       select a.*,r.required_dimensions from vy_replica_candidate_eval_assignment a
         join vy_replica_candidate_eval_run r
           on r.eval_run_id=a.eval_run_id and r.candidate_id=a.candidate_id
          and r.replica_id=a.replica_id and r.owner_user_id=a.owner_user_id
        where a.assignment_id=$1 and a.replica_id=$2 and a.owner_user_id=$3
          and a.assignment_hash=$4 and a.state in ('pending','submitted') and r.state='collecting'
     ), wanted as (
       select * from jsonb_to_recordset($5::jsonb) as x(judgment_id uuid,dimension text,position_winner text)
     ), inserted as (
       insert into vy_replica_candidate_eval_judgment
         (judgment_id,assignment_id,eval_run_id,candidate_id,replica_id,owner_user_id,
          dimension,position_winner,assignment_hash)
       select w.judgment_id,e.assignment_id,e.eval_run_id,e.candidate_id,e.replica_id,e.owner_user_id,
              w.dimension,w.position_winner,e.assignment_hash from eligible e cross join wanted w
        where w.dimension=any(e.required_dimensions)
       on conflict (assignment_id,dimension) do nothing
       returning assignment_id,dimension,position_winner,assignment_hash
     ), active_judgments as (
       select * from inserted
       union all
       select j.assignment_id,j.dimension,j.position_winner,j.assignment_hash
         from vy_replica_candidate_eval_judgment j join eligible e on e.assignment_id=j.assignment_id
         join wanted w on w.dimension=j.dimension and w.position_winner=j.position_winner
        where j.assignment_hash=e.assignment_hash
     ), exact as (
       select e.assignment_id from eligible e
        where not exists (
          select 1 from wanted w where not exists (
            select 1 from active_judgments j
             where j.assignment_id=e.assignment_id and j.dimension=w.dimension
               and j.position_winner=w.position_winner and j.assignment_hash=e.assignment_hash
          )
        ) and (select count(*) from wanted)=cardinality(e.required_dimensions)
          and (select count(*) from active_judgments)=cardinality(e.required_dimensions)
     ), submitted as (
       update vy_replica_candidate_eval_assignment a set state='submitted',submitted_at=coalesce(submitted_at,now())
         from exact e where a.assignment_id=e.assignment_id returning a.eval_run_id
     ), finished as (
       update vy_replica_candidate_eval_run r set state='complete',completed_at=now()
         from submitted s where r.eval_run_id=s.eval_run_id and r.state='collecting'
          and not exists(select 1 from vy_replica_candidate_eval_assignment a where a.eval_run_id=r.eval_run_id and a.state='pending')
       returning r.eval_run_id
     )
     select count(*) filter (where a.state='submitted')::integer as completed,count(*)::integer as total,
            exists(select 1 from finished) as complete
       from vy_replica_candidate_eval_assignment a join submitted s on s.eval_run_id=a.eval_run_id
      group by s.eval_run_id`,
    [assignmentId, rid, ownerUserId, assignmentHash, JSON.stringify(wanted)],
  );
  if (!rows[0]) fail("candidate_eval_judgment_conflict");
  return {
    accepted: true,
    progress: { completed: Number(rows[0].completed), total: Number(rows[0].total) },
    complete: Boolean(rows[0].complete),
  };
}

export async function loadCandidateOwnerObservations(db, ownerUserId, runId) {
  if (typeof db !== "function") fail("candidate_eval_db_required", 503);
  const id = safeUuid(runId, "candidate_eval_run_id_invalid");
  const rows = await db(
    `select r.run_commitment,a.example_id,a.session_commitment,a.presentation_order,a.assignment_hash,
            j.dimension,j.position_winner
       from vy_replica_candidate_eval_run r join vy_replica_candidate_eval_assignment a on a.eval_run_id=r.eval_run_id
       join vy_replica_candidate_eval_judgment j
         on j.assignment_id=a.assignment_id and j.eval_run_id=a.eval_run_id and j.candidate_id=a.candidate_id
        and j.replica_id=a.replica_id and j.owner_user_id=a.owner_user_id and j.assignment_hash=a.assignment_hash
      where r.eval_run_id=$1 and r.owner_user_id=$2 and r.state='complete' and a.state='submitted'
      order by a.sequence,j.dimension`,
    [id, ownerUserId],
  );
  return rows.map((row) => {
    if (blindAssignmentHash(row.run_commitment, row.example_id, row.presentation_order) !== row.assignment_hash)
      fail("candidate_eval_assignment_tampered");
    return {
      example_id: String(row.example_id),
      session_commitment: row.session_commitment,
      dimension: row.dimension,
      winner: row.position_winner === "tie"
        ? "tie"
        : row.presentation_order === "ab"
          ? row.position_winner === "a" ? "baseline" : "candidate"
          : row.position_winner === "a" ? "candidate" : "baseline",
      order: row.presentation_order,
      judge_kind: "owner",
      assignment_hash: row.assignment_hash,
    };
  });
}
