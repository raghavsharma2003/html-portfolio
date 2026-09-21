-- One account-attested private attempt. No identity, genome or public authority.
create table if not exists vy_private_voice_run (
 run_id uuid primary key,
 replica_id uuid not null, owner_user_id uuid not null, source_id uuid not null, artifact_id uuid not null,
 request_hash text not null check(request_hash ~ '^[a-f0-9]{64}$'),
 snapshot_hash text not null check(snapshot_hash ~ '^[a-f0-9]{64}$'), snapshot jsonb not null,
 receipt jsonb not null, receipt_hash text not null check(receipt_hash ~ '^[a-f0-9]{64}$'),
 config jsonb not null, config_hash text not null check(config_hash ~ '^[a-f0-9]{64}$'),
 reference_sha256 text not null check(reference_sha256 ~ '^[a-f0-9]{64}$'),
 text_sha256 text not null check(text_sha256 ~ '^[a-f0-9]{64}$'),
 state text not null default 'queued' check(state in ('queued','claimed','running','ready','failed','unknown','revoked')),
 lease_token_hash text check(lease_token_hash ~ '^[a-f0-9]{64}$'), lease_expires_at timestamptz,
 window_id uuid unique references vy_voice_app_lifecycle(window_id) on delete restrict,
 children jsonb not null default '[]'::jsonb check(jsonb_typeof(children)='array' and jsonb_array_length(children)<=32),
 output_storage_bucket text not null, output_object_path text not null,
 output_sha256 text check(output_sha256 ~ '^[a-f0-9]{64}$'), output_write_not_after timestamptz,
 output_deleted_at timestamptz, output_receipt jsonb, metrics jsonb, ratings jsonb,
 error_code text check(error_code ~ '^private_voice_[a-z0-9_]+$'),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 expires_at timestamptz not null, revoked_at timestamptz,
 foreign key(replica_id,owner_user_id) references vy_replica(replica_id,owner_user_id) on delete cascade,
 foreign key(source_id,replica_id,owner_user_id) references vy_replica_source(source_id,replica_id,owner_user_id) on delete cascade,
 foreign key(artifact_id,source_id,replica_id,owner_user_id) references vy_replica_processing_artifact(artifact_id,source_id,replica_id,owner_user_id) on delete cascade,
 constraint vy_private_voice_output_path check(output_object_path=owner_user_id::text||'/'||replica_id::text||'/'||source_id::text||'/derived/private-voice/'||run_id::text||'.wav'),
 constraint vy_private_voice_scope check((receipt->>'scope'='private_voice_test' and receipt->>'statement_set'='private-own-voice/v1'
   and receipt->>'method'='account_attestation' and receipt#>>'{attestations,own_voice_private_use}'='true'
   and config->>'scope'='private_voice_test' and config->>'identity_claim_allowed'='false'
   and config->>'release_eligible'='false' and config->>'training_allowed'='false') is true),
 constraint vy_private_voice_ready check(state<>'ready' or (output_sha256 is not null and output_receipt is not null))
);

create index if not exists vy_private_voice_owner on vy_private_voice_run(owner_user_id,replica_id,created_at desc);

create index if not exists vy_private_voice_queue on vy_private_voice_run(created_at,run_id) where state='queued' and revoked_at is null;
