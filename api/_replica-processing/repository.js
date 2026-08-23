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
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22::jsonb,$23)
       on conflict (artifact_id) do nothing
       returning artifact_id, manifest_hash
     ), identical as (
       select artifact_id, manifest_hash from vy_replica_processing_artifact
        where artifact_id = $1 and source_id = $4 and replica_id = $2 and owner_user_id = $3
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
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,$14,$15,$16)
       on conflict (evidence_id) do nothing
       returning evidence_id, record_hash
     ), identical as (
       select evidence_id, record_hash from vy_replica_processing_evidence
        where evidence_id = $1 and source_id = $4 and replica_id = $2 and owner_user_id = $3
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
     select parent.replica_id, parent.owner_user_id, parent.source_id, wanted.step, $3, 'queued'
       from vy_replica_processing_job parent
       cross join unnest($2::text[]) wanted(step)
      where parent.job_id = $1 and parent.state = 'complete'
     on conflict (source_id, step, revision) do nothing
     returning job_id, step, state`,
    [input.completedJobId, steps, Number(input.revision || 1)],
  );
  return rows;
}
