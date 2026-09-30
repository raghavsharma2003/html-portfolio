-- Purpose-limited preparation; never enrollment, training or serving authority.
create table if not exists vy_comparison_preparation_id (
  preparation_id uuid primary key,
  retired_at timestamptz not null default now()
);

create table if not exists vy_replica_comparison_preparation (
  preparation_id uuid primary key references vy_comparison_preparation_id(preparation_id),
  replica_id uuid not null references vy_replica(replica_id) on delete cascade,
  owner_user_id uuid not null,
  source_id uuid references vy_replica_source(source_id) on delete cascade,
  policy_version text not null,
  statement_set text not null check (statement_set='private-comparison-preparation/v1'),
  receipt jsonb,
  receipt_sha256 text,
  state text not null check (state in ('authorized','queued','running','prepared','revoked','expired','failed','reconciliation_required')),
  max_duration_ms integer not null default 60000 check (max_duration_ms=60000),
  max_evidence_dispatches integer not null default 4 check (max_evidence_dispatches=4),
  completed_receipt jsonb,
  completed_receipt_sha256 text,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((state='revoked' and source_id is null and receipt is null and receipt_sha256 is null)
    or (source_id is not null and receipt is not null and receipt_sha256 is not null and jsonb_typeof(receipt)='object' and receipt_sha256 ~ '^[0-9a-f]{64}$')),
  check (state<>'prepared' or (completed_receipt is not null and completed_receipt_sha256 is not null and jsonb_typeof(completed_receipt)='object' and completed_receipt_sha256 ~ '^[0-9a-f]{64}$')),
  unique (source_id),
  foreign key(replica_id,owner_user_id) references vy_replica(replica_id,owner_user_id) on delete cascade,
  foreign key(source_id,replica_id,owner_user_id) references vy_replica_source(source_id,replica_id,owner_user_id) on delete cascade,
  unique (preparation_id,source_id,replica_id,owner_user_id)
);

alter table vy_replica_processing_job add column if not exists comparison_preparation_id uuid
  references vy_replica_comparison_preparation(preparation_id) on delete cascade;

alter table vy_replica_processing_job drop constraint if exists vy_comparison_job_preparation_owner_fk;

alter table vy_replica_processing_job add constraint vy_comparison_job_preparation_owner_fk
  foreign key(comparison_preparation_id,source_id,replica_id,owner_user_id)
  references vy_replica_comparison_preparation(preparation_id,source_id,replica_id,owner_user_id) on delete cascade;

create table if not exists vy_replica_comparison_dispatch (
  preparation_id uuid not null,
  replica_id uuid not null,
  owner_user_id uuid not null,
  source_id uuid not null,
  job_id uuid not null references vy_replica_processing_job(job_id) on delete cascade,
  step text not null check (step in ('diarize','separate','enhance','voice_quality')),
  request_sha256 text not null check (request_sha256 ~ '^[0-9a-f]{64}$'),
  meter_receipt_sha256 text not null check (meter_receipt_sha256 ~ '^[0-9a-f]{64}$'),
  state text not null check (state in ('started','settled','reconciliation_required')),
  result_sha256 text,
  created_at timestamptz not null default now(),
  settled_at timestamptz,
  primary key(preparation_id,step),
  foreign key(preparation_id,source_id,replica_id,owner_user_id)
    references vy_replica_comparison_preparation(preparation_id,source_id,replica_id,owner_user_id) on delete cascade,
  foreign key(job_id,source_id,replica_id,owner_user_id)
    references vy_replica_processing_job(job_id,source_id,replica_id,owner_user_id) on delete cascade,
  check (state<>'settled' or (result_sha256 is not null and result_sha256 ~ '^[0-9a-f]{64}$' and settled_at is not null))
);

alter table vy_replica_source drop constraint if exists vy_replica_source_purpose_check;

alter table vy_replica_source add constraint vy_replica_source_purpose_check
  check (purpose in ('memory','identity_document','identity_challenge','correction','interview','mirror_window','context_item','comparison_reference'));
