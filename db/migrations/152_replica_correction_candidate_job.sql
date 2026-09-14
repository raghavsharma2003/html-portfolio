-- Owner-requested private correction candidate work. No active persona writes.
create table if not exists vy_replica_correction_candidate_job (
  job_id uuid primary key,
  dataset_id uuid not null,
  replica_id uuid not null,
  owner_user_id uuid not null,
  source_set_hash text not null check (source_set_hash ~ '^[0-9a-f]{64}$'),
  protocol text not null,
  model_commitment text not null check (model_commitment ~ '^[0-9a-f]{64}$'),
  request_hash text check (request_hash ~ '^[0-9a-f]{64}$'),
  state text not null check (state in ('preparing','running','response_recorded','accounting_pending','draft','abstained','failed','unknown','retired')),
  proposal jsonb,
  artifact jsonb,
  artifact_sha256 text check (artifact_sha256 ~ '^[0-9a-f]{64}$'),
  build_manifest jsonb,
  build_manifest_hash text check (build_manifest_hash ~ '^[0-9a-f]{64}$'),
  usage jsonb,
  reservation_id uuid,
  candidate_id uuid,
  failure_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vy_replica_correction_candidate_job_once unique (dataset_id,model_commitment,protocol),
  constraint vy_replica_correction_candidate_job_dataset_fk foreign key (dataset_id,replica_id,owner_user_id)
    references vy_replica_feedback_dataset(dataset_id,replica_id,owner_user_id) on delete cascade,
  constraint vy_replica_correction_candidate_job_candidate_fk foreign key (candidate_id,dataset_id,replica_id,owner_user_id)
    references vy_replica_candidate(candidate_id,dataset_id,replica_id,owner_user_id) on delete cascade,
  constraint vy_replica_correction_candidate_job_draft_shape check
    (state <> 'draft' or (candidate_id is not null and artifact is not null and artifact_sha256 is not null and build_manifest_hash is not null)),
  constraint vy_replica_correction_candidate_job_running_shape check
    (state <> 'running' or (request_hash is not null and reservation_id is not null))
);

create index if not exists vy_replica_correction_candidate_job_owner_ix
  on vy_replica_correction_candidate_job(replica_id,owner_user_id,created_at desc);
