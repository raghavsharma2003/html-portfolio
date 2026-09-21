-- Migration 017 -- immutable preprocessing manifests, append-only evidence and
-- versioned model builds. One statement per apply call; every statement is
-- independently idempotent. Raw objects remain in vy_replica_source and are
-- never represented as preprocessing artifacts.

create table if not exists vy_replica_processing_attempt (
  job_id               uuid not null references vy_replica_processing_job(job_id) on delete cascade,
  attempt              integer not null check (attempt > 0),
  outcome              text not null
                       check (outcome in ('running','retry','blocked','complete','failed')),
  adapter_family       text not null default '',
  adapter_name         text not null default '',
  adapter_version      text not null default '',
  result_manifest_hash text not null default '',
  failure_code         text not null default '',
  facts                jsonb not null default '{}'::jsonb,
  started_at           timestamptz not null default now(),
  finished_at          timestamptz,
  primary key (job_id, attempt),
  constraint vy_replica_attempt_result_hash
    check (result_manifest_hash = '' or result_manifest_hash ~ '^[0-9a-f]{64}$')
);

create index if not exists vy_replica_processing_attempt_outcome_ix
  on vy_replica_processing_attempt (outcome, started_at);

-- Composite parent keys make tenant/source ownership part of every child FK;
-- UUID equality alone is not an ownership boundary.
create unique index if not exists vy_replica_source_owner_tuple_ix
  on vy_replica_source (source_id, replica_id, owner_user_id);

do $replica_job_source_fk$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'vy_replica_processing_source_owner_fk'
       and conrelid = 'vy_replica_processing_job'::regclass
  ) then
    alter table vy_replica_processing_job
      add constraint vy_replica_processing_source_owner_fk
      foreign key (source_id, replica_id, owner_user_id)
      references vy_replica_source(source_id, replica_id, owner_user_id) on delete cascade;
  end if;
end;
$replica_job_source_fk$;

create unique index if not exists vy_replica_processing_job_owner_tuple_ix
  on vy_replica_processing_job (job_id, source_id, replica_id, owner_user_id);

create table if not exists vy_replica_processing_artifact (
  artifact_id          uuid primary key,
  replica_id           uuid not null,
  owner_user_id        uuid not null,
  source_id            uuid not null references vy_replica_source(source_id) on delete cascade,
  parent_artifact_id   uuid references vy_replica_processing_artifact(artifact_id) on delete restrict,
  created_by_job_id    uuid references vy_replica_processing_job(job_id) on delete set null,
  stage                text not null
                       check (stage in ('separate','enhance','transcribe','voice_quality')),
  variant_key          text not null,
  storage_bucket       text not null,
  object_path          text not null,
  mime                 text not null,
  byte_size            bigint not null check (byte_size > 0),
  duration_ms          integer check (duration_ms is null or duration_ms >= 0),
  sha256               text not null,
  input_sha256         text not null,
  transform_name       text not null,
  transform_version    text not null,
  parameter_hash       text not null,
  adapter_family       text not null,
  adapter_name         text not null,
  adapter_version      text not null,
  manifest             jsonb not null,
  manifest_hash        text not null,
  created_at           timestamptz not null default now(),
  constraint vy_replica_artifact_owner_fk
    foreign key (replica_id, owner_user_id)
    references vy_replica(replica_id, owner_user_id) on delete cascade,
  constraint vy_replica_artifact_source_owner_fk
    foreign key (source_id, replica_id, owner_user_id)
    references vy_replica_source(source_id, replica_id, owner_user_id) on delete cascade,
  constraint vy_replica_artifact_job_owner_fk
    foreign key (created_by_job_id, source_id, replica_id, owner_user_id)
    references vy_replica_processing_job(job_id, source_id, replica_id, owner_user_id),
  constraint vy_replica_artifact_sha check (sha256 ~ '^[0-9a-f]{64}$'),
  constraint vy_replica_artifact_input_sha check (input_sha256 ~ '^[0-9a-f]{64}$'),
  constraint vy_replica_artifact_parameter_hash check (parameter_hash ~ '^[0-9a-f]{64}$'),
  constraint vy_replica_artifact_manifest_hash check (manifest_hash ~ '^[0-9a-f]{64}$'),
  constraint vy_replica_artifact_derived_path
    check (object_path like owner_user_id::text || '/' || replica_id::text || '/' || source_id::text || '/derived/%'
           and object_path !~ '://'),
  constraint vy_replica_artifact_owner_tuple
    unique (artifact_id, source_id, replica_id, owner_user_id),
  constraint vy_replica_artifact_parent_owner_fk
    foreign key (parent_artifact_id, source_id, replica_id, owner_user_id)
    references vy_replica_processing_artifact(artifact_id, source_id, replica_id, owner_user_id) on delete restrict,
  constraint vy_replica_artifact_variant_unique
    unique (source_id, stage, transform_version, variant_key, input_sha256)
);

create index if not exists vy_replica_processing_artifact_source_ix
  on vy_replica_processing_artifact (replica_id, source_id, stage, created_at);

create table if not exists vy_replica_processing_evidence (
  evidence_id          uuid primary key,
  replica_id           uuid not null,
  owner_user_id        uuid not null,
  source_id            uuid not null references vy_replica_source(source_id) on delete cascade,
  artifact_id          uuid references vy_replica_processing_artifact(artifact_id) on delete cascade,
  created_by_job_id    uuid references vy_replica_processing_job(job_id) on delete set null,
  evidence_type        text not null
                       check (evidence_type in (
                         'media_probe','speaker_segment','transcript_span','language_span',
                         'voice_embedding','voice_measurement','quality_measurement'
                       )),
  span_start_ms        integer check (span_start_ms is null or span_start_ms >= 0),
  span_end_ms          integer check (span_end_ms is null or span_end_ms >= 0),
  confidence           double precision check (confidence is null or (confidence >= 0 and confidence <= 1)),
  value                jsonb not null,
  input_sha256         text not null,
  adapter_family       text not null,
  adapter_name         text not null,
  adapter_version      text not null,
  record_hash          text not null unique,
  created_at           timestamptz not null default now(),
  constraint vy_replica_evidence_owner_fk
    foreign key (replica_id, owner_user_id)
    references vy_replica(replica_id, owner_user_id) on delete cascade,
  constraint vy_replica_evidence_source_owner_fk
    foreign key (source_id, replica_id, owner_user_id)
    references vy_replica_source(source_id, replica_id, owner_user_id) on delete cascade,
  constraint vy_replica_evidence_artifact_owner_fk
    foreign key (artifact_id, source_id, replica_id, owner_user_id)
    references vy_replica_processing_artifact(artifact_id, source_id, replica_id, owner_user_id) on delete cascade,
  constraint vy_replica_evidence_job_owner_fk
    foreign key (created_by_job_id, source_id, replica_id, owner_user_id)
    references vy_replica_processing_job(job_id, source_id, replica_id, owner_user_id),
  constraint vy_replica_evidence_span
    check (span_end_ms is null or span_start_ms is not null and span_end_ms > span_start_ms),
  constraint vy_replica_evidence_input_sha check (input_sha256 ~ '^[0-9a-f]{64}$'),
  constraint vy_replica_evidence_record_hash check (record_hash ~ '^[0-9a-f]{64}$')
);

create index if not exists vy_replica_processing_evidence_source_ix
  on vy_replica_processing_evidence (replica_id, source_id, evidence_type, created_at);

create table if not exists vy_replica_processing_evidence_decision (
  decision_id          uuid primary key default gen_random_uuid(),
  evidence_id          uuid not null references vy_replica_processing_evidence(evidence_id) on delete cascade,
  decision             text not null check (decision in ('accepted','rejected','superseded')),
  reason_code          text not null,
  reviewer_user_id     uuid not null,
  created_at           timestamptz not null default now()
);

create index if not exists vy_replica_evidence_decision_ix
  on vy_replica_processing_evidence_decision (evidence_id, created_at desc);

create table if not exists vy_replica_model_build (
  build_id             uuid primary key default gen_random_uuid(),
  replica_id           uuid not null,
  owner_user_id        uuid not null,
  build_kind           text not null check (build_kind in ('voice_genome','person_profile')),
  target_version       integer not null check (target_version > 0),
  builder_version      text not null,
  source_set_hash      text not null,
  state                text not null default 'queued'
                       check (state in ('queued','leased','building','retry','review','approved','failed','retired')),
  attempt              integer not null default 0 check (attempt >= 0),
  manifest_hash        text not null default '',
  failure_code         text not null default '',
  next_attempt_at      timestamptz not null default now(),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint vy_replica_model_build_owner_fk
    foreign key (replica_id, owner_user_id)
    references vy_replica(replica_id, owner_user_id) on delete cascade,
  constraint vy_replica_model_build_source_hash check (source_set_hash ~ '^[0-9a-f]{64}$'),
  constraint vy_replica_model_build_manifest_hash
    check (manifest_hash = '' or manifest_hash ~ '^[0-9a-f]{64}$'),
  constraint vy_replica_model_build_unique unique (replica_id, build_kind, target_version)
);

create index if not exists vy_replica_model_build_queue_ix
  on vy_replica_model_build (state, next_attempt_at, created_at)
  where state in ('queued','retry');
