-- Comparison USE only. This table grants no processing, training or inference.
create table if not exists vy_replica_comparison_reference (
  reference_id uuid primary key,
  replica_id uuid not null,
  owner_user_id uuid not null,
  source_id uuid,
  artifact_id uuid,
  state text not null check (state in ('review','selected','revoked')),
  receipt_payload jsonb,
  receipt_hash text,
  observed_epoch bigint,
  selected_epoch bigint,
  audition_response_at timestamptz,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  confirmed_at timestamptz,
  revoked_at timestamptz,
  active_replica_id uuid generated always as
    (case when state='selected' then replica_id else null end) stored,
  unique (active_replica_id),
  constraint vy_comparison_reference_owner_fk foreign key (replica_id,owner_user_id)
    references vy_replica(replica_id,owner_user_id) on delete cascade,
  constraint vy_comparison_reference_source_fk foreign key (source_id,replica_id,owner_user_id)
    references vy_replica_source(source_id,replica_id,owner_user_id) on delete cascade,
  constraint vy_comparison_reference_artifact_fk foreign key (artifact_id,source_id,replica_id,owner_user_id)
    references vy_replica_processing_artifact(artifact_id,source_id,replica_id,owner_user_id) on delete cascade,
  constraint vy_comparison_reference_payload_check check (
    state='revoked' or (source_id is not null and artifact_id is not null
      and jsonb_typeof(receipt_payload)='object' and receipt_payload is not null
      and receipt_hash is not null and length(receipt_hash)=64 and receipt_hash ~ '^[0-9a-f]{64}$'
      and observed_epoch is not null and observed_epoch>=0
      and expires_at is not null and expires_at>created_at
      and expires_at<=created_at+interval '24 hours')),
  constraint vy_comparison_reference_selected_check check (
    state<>'selected' or (selected_epoch is not null and selected_epoch>observed_epoch
      and audition_response_at is not null and confirmed_at is not null)),
  constraint vy_comparison_reference_revoked_check check (
    state<>'revoked' or (revoked_at is not null and receipt_payload is null and receipt_hash is null))
);
