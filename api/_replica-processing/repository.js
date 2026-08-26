import { leaseTokenHash, processingCompletionReceipt } from "./queue.js";

// Persistence is create-only. A retry may observe the same deterministic id,
// but it may never change the bytes, lineage or evidence behind that id.

async function persistArtifact(db, artifact) {
  const manifest = JSON.stringify(artifact);
  const rows = await db(
    `with inserted as (
       insert into vy_replica_processing_artifact
         (artifact_id, replica_id, owner_user_id, source_id, parent_artifact_id,
          created_by_job_id, stage, variant_key, storage_bucket, object_path, mime,
          byte_size, duration_ms, sha256, input_sha256, transform_name,
          transform_version, parameter_hash, adapter_family, adapter_name,
          adapter_version, manifest, manifest_hash)
       values ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::uuid,$7,$8,$9,$10,$11,$12::int8,$13::int4,$14,$15,$16,$17,$18,$19,$20,$21,$22::jsonb,$23)
       on conflict (artifact_id) do nothing
       returning artifact_id, manifest_hash
     ), identical as (
       select artifact_id, manifest_hash from vy_replica_processing_artifact
        where artifact_id = $1::uuid and source_id = $4::uuid and replica_id = $2::uuid and owner_user_id = $3::uuid
          and sha256 = $14 and input_sha256 = $15 and manifest_hash = $23
     )
     select * from inserted union all select * from identical limit 1`,
    [artifact.artifact_id, artifact.replica_id, artifact.owner_user_id, artifact.source_id,
      artifact.parent_artifact_id, artifact.created_by_job_id, artifact.stage, artifact.variant_key,
      artifact.storage_bucket, artifact.object_path, artifact.mime, artifact.byte_size,
      artifact.duration_ms, artifact.sha256, artifact.input_sha256, artifact.transform.name,
      artifact.transform.version, artifact.transform.parameter_hash, artifact.adapter.family,
      artifact.adapter.name, artifact.adapter.version, manifest, artifact.manifest_hash],
  );
  if (!rows[0]) throw Object.assign(new Error("artifact id already exists with different immutable content"), {
    code: "immutable_artifact_collision",
  });
}

async function persistEvidence(db, evidence) {
  const rows = await db(
    `with inserted as (
       insert into vy_replica_processing_evidence
         (evidence_id, replica_id, owner_user_id, source_id, artifact_id,
          created_by_job_id, evidence_type, span_start_ms, span_end_ms, confidence,
          value, input_sha256, adapter_family, adapter_name, adapter_version, record_hash)
       values ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::uuid,$7,$8::int4,$9::int4,$10::float8,$11::jsonb,$12,$13,$14,$15,$16)
       on conflict (evidence_id) do nothing
       returning evidence_id, record_hash
     ), identical as (
       select evidence_id, record_hash from vy_replica_processing_evidence
        where evidence_id = $1::uuid and source_id = $4::uuid and replica_id = $2::uuid and owner_user_id = $3::uuid
          and input_sha256 = $12 and record_hash = $16
     )
     select * from inserted union all select * from identical limit 1`,
    [evidence.evidence_id, evidence.replica_id, evidence.owner_user_id, evidence.source_id,
      evidence.artifact_id, evidence.created_by_job_id, evidence.evidence_type,
      evidence.span.start_ms, evidence.span.end_ms, evidence.confidence,
      JSON.stringify(evidence.value), evidence.input_sha256, evidence.adapter.family,
      evidence.adapter.name, evidence.adapter.version, evidence.record_hash],
  );
  if (!rows[0]) throw Object.assign(new Error("evidence id already exists with different immutable content"), {
    code: "immutable_evidence_collision",
  });
}

export async function persistProcessingOutput(db, output) {
  if (output?.outcome !== "complete") throw new Error("only validated complete output may be persisted");
  for (const artifact of output.artifacts) await persistArtifact(db, artifact);
  for (const evidence of output.evidence) await persistEvidence(db, evidence);
  return Object.freeze({
    artifact_ids: output.artifacts.map((entry) => entry.artifact_id),
    evidence_ids: output.evidence.map((entry) => entry.evidence_id),
  });
}

export async function enqueueProcessingSteps(db, input) {
  const steps = [...new Set(input.steps || [])];
  if (!steps.length) return [];
  const rows = await db(
    `insert into vy_replica_processing_job
       (replica_id, owner_user_id, source_id, step, revision, state)
     select parent.replica_id, parent.owner_user_id, parent.source_id, wanted.step, $3::int4, 'queued'
       from vy_replica_processing_job parent
       cross join unnest($2::text[]) wanted(step)
      where parent.job_id = $1::uuid and parent.state = 'complete'
     on conflict (source_id, step, revision) do nothing
     returning job_id, step, state`,
    [input.completedJobId, steps, Number(input.revision || 1)],
  );
  return rows;
}

// The production worker must not persist output, settle a lease, and enqueue
// the next step in separate commits. A crash in either gap strands the DAG or
// forces nondeterministic GPU bytes to collide with an already-written path.
// This single PostgreSQL statement makes the full transition atomic. The
// arithmetic guard deliberately raises on any immutable collision, rolling
// the entire statement back instead of committing a partial evidence set.
export async function commitProcessingOutput(db, input) {
  if (input.output?.outcome !== "complete") throw new Error("only complete processing output may commit");
  const receipt = processingCompletionReceipt(input.output.result);
  const adapter = input.output.adapter;
  if (!adapter?.family || !adapter?.name || !adapter?.version) throw new Error("completion adapter provenance required");
  const rows = await db(
    `with eligible_job as materialized (
       select * from vy_replica_processing_job
        where job_id=$1::uuid and state='leased' and lease_token_hash=$2
          and lease_expires_at>now() and step=$10
     ), desired_artifacts as materialized (
       select value item from jsonb_array_elements($3::jsonb)
     ), inserted_artifacts as (
       insert into vy_replica_processing_artifact
         (artifact_id,replica_id,owner_user_id,source_id,parent_artifact_id,created_by_job_id,
          stage,variant_key,storage_bucket,object_path,mime,byte_size,duration_ms,sha256,input_sha256,
          transform_name,transform_version,parameter_hash,adapter_family,adapter_name,adapter_version,
          manifest,manifest_hash)
       select (item->>'artifact_id')::uuid,(item->>'replica_id')::uuid,(item->>'owner_user_id')::uuid,
              (item->>'source_id')::uuid,nullif(item->>'parent_artifact_id','')::uuid,
              (item->>'created_by_job_id')::uuid,item->>'stage',item->>'variant_key',item->>'storage_bucket',
              item->>'object_path',item->>'mime',(item->>'byte_size')::bigint,
              nullif(item->>'duration_ms','')::integer,item->>'sha256',item->>'input_sha256',
              item#>>'{transform,name}',item#>>'{transform,version}',item#>>'{transform,parameter_hash}',
              item#>>'{adapter,family}',item#>>'{adapter,name}',item#>>'{adapter,version}',
              item,item->>'manifest_hash'
         from desired_artifacts d cross join eligible_job j
        where (d.item->>'created_by_job_id')::uuid=j.job_id
          and (d.item->>'source_id')::uuid=j.source_id
          and (d.item->>'replica_id')::uuid=j.replica_id
          and (d.item->>'owner_user_id')::uuid=j.owner_user_id
       on conflict (artifact_id) do nothing
       returning artifact_id
     ), desired_evidence as materialized (
       select value item from jsonb_array_elements($4::jsonb)
     ), inserted_evidence as (
       insert into vy_replica_processing_evidence
         (evidence_id,replica_id,owner_user_id,source_id,artifact_id,created_by_job_id,evidence_type,
          span_start_ms,span_end_ms,confidence,value,input_sha256,adapter_family,adapter_name,
          adapter_version,record_hash)
       select (item->>'evidence_id')::uuid,(item->>'replica_id')::uuid,(item->>'owner_user_id')::uuid,
              (item->>'source_id')::uuid,nullif(item->>'artifact_id','')::uuid,
              (item->>'created_by_job_id')::uuid,item->>'evidence_type',
              nullif(item#>>'{span,start_ms}','')::integer,nullif(item#>>'{span,end_ms}','')::integer,
              nullif(item->>'confidence','')::double precision,item->'value',item->>'input_sha256',
              item#>>'{adapter,family}',item#>>'{adapter,name}',item#>>'{adapter,version}',item->>'record_hash'
         from desired_evidence d cross join eligible_job j
        where (d.item->>'created_by_job_id')::uuid=j.job_id
          and (d.item->>'source_id')::uuid=j.source_id
          and (d.item->>'replica_id')::uuid=j.replica_id
          and (d.item->>'owner_user_id')::uuid=j.owner_user_id
       on conflict (evidence_id) do nothing
       returning evidence_id
     ), valid_artifacts as materialized (
       select count(*)::integer total from desired_artifacts d
       join vy_replica_processing_artifact a on a.artifact_id=(d.item->>'artifact_id')::uuid
        and a.source_id=(d.item->>'source_id')::uuid and a.replica_id=(d.item->>'replica_id')::uuid
        and a.owner_user_id=(d.item->>'owner_user_id')::uuid
        and a.created_by_job_id=(d.item->>'created_by_job_id')::uuid and a.sha256=d.item->>'sha256'
        and a.input_sha256=d.item->>'input_sha256' and a.manifest_hash=d.item->>'manifest_hash'
     ), valid_evidence as materialized (
       select count(*)::integer total from desired_evidence d
       join vy_replica_processing_evidence e on e.evidence_id=(d.item->>'evidence_id')::uuid
        and e.source_id=(d.item->>'source_id')::uuid and e.replica_id=(d.item->>'replica_id')::uuid
        and e.owner_user_id=(d.item->>'owner_user_id')::uuid
        and e.created_by_job_id=(d.item->>'created_by_job_id')::uuid and e.input_sha256=d.item->>'input_sha256'
        and e.record_hash=d.item->>'record_hash'
     ), collision_guard as materialized (
       select 1 / case when
         (select count(*) from desired_artifacts)=(select total from valid_artifacts)
         and (select count(*) from desired_evidence)=(select total from valid_evidence)
       then 1 else 0 end ok
     ), settled as (
       update vy_replica_processing_job j
          set state='complete',result=$5::jsonb,failure_code='',lease_token_hash='',
              leased_at=null,lease_expires_at=null,updated_at=now()
         from collision_guard g cross join eligible_job eligible
        where g.ok=1 and j.job_id=eligible.job_id
       returning j.*
     ), attempt as (
       update vy_replica_processing_attempt a
          set outcome='complete',result_manifest_hash=$6,adapter_family=$7,adapter_name=$8,
              adapter_version=$9,finished_at=now()
         from settled s where a.job_id=s.job_id and a.attempt=s.attempt
     ), source_state as (
       update vy_replica_source source
          set state=case when s.step='voice_quality' then 'ready' else 'processing' end,updated_at=now()
         from settled s where source.source_id=s.source_id and source.replica_id=s.replica_id
          and source.owner_user_id=s.owner_user_id and source.state in ('quarantined','processing')
     ), enqueued as (
       insert into vy_replica_processing_job(replica_id,owner_user_id,source_id,step,revision,state)
       select s.replica_id,s.owner_user_id,s.source_id,wanted.step,s.revision,'queued'
         from settled s cross join jsonb_array_elements_text($5::jsonb->'next_steps') wanted(step)
       on conflict (source_id,step,revision) do nothing returning step
     )
     select * from settled`,
    [input.jobId, leaseTokenHash(input.leaseToken), JSON.stringify(input.output.artifacts),
      JSON.stringify(input.output.evidence), JSON.stringify(receipt), receipt.manifest_hash,
      adapter.family, adapter.name, adapter.version, receipt.step],
  );
  if (!rows[0]) throw Object.assign(new Error("processing lease expired before atomic completion"), { code: "lost_processing_lease" });
  return Object.freeze({ receipt, next_steps: Object.freeze([...receipt.next_steps]) });
}
