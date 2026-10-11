-- Migration 067 - durable, owner-scoped ordinary voice-preview intents.
--
-- A browser retry is an observation of one semantic request, not permission to
-- synthesize again.  The exact semantic columns are the concurrency arbiter;
-- intent_key is a compact audit handle, not a substitute for those columns.
-- Explicit regeneration is a separate caller-held key so its own retries are
-- idempotent too. Protected output stays in the private replica bucket. Only
-- its locator and commitment live here; raw or unprotected audio never does.

create table if not exists vy_replica_voice_preview_intent (
  intent_id             uuid primary key,
  replica_id            uuid not null,
  owner_user_id         uuid not null,
  genome_version        integer not null check (genome_version > 0),
  preview_artifact_id   uuid not null,
  language_id           text not null check (language_id in ('en','hi')),
  text_hash              text not null check (text_hash ~ '^[0-9a-f]{64}$'),
  text_plan_sha256       text not null check (text_plan_sha256 ~ '^[0-9a-f]{64}$'),
  model_commitment       text not null check (model_commitment ~ '^[0-9a-f]{64}$'),
  style                  jsonb not null,
  preview_seed           integer not null check (preview_seed between 1 and 2147483647),
  regeneration_key       text not null default '',
  intent_key             text not null check (intent_key ~ '^[0-9a-f]{64}$'),
  state                  text not null check (state in ('warming','synthesizing','sealed','retryable','failed')),
  attempt                integer not null default 1 check (attempt > 0),
  generation_id          uuid,
  lease_token_hash       text not null default '',
  leased_at              timestamptz,
  lease_expires_at       timestamptz,
  next_attempt_at        timestamptz not null default now(),
  failure_code           text not null default '',
  failure_count          integer not null default 0 check (failure_count between 0 and 3),
  result_storage_bucket  text,
  result_object_path     text,
  result_mime            text,
  result_byte_size       bigint,
  result_sha256          text,
  result_object_id       text,
  result_metadata        jsonb not null default '{}'::jsonb,
  result_expires_at      timestamptz,
  started_at             timestamptz not null default now(),
  completed_at           timestamptz,
  updated_at             timestamptz not null default now(),
  constraint vy_replica_voice_preview_intent_owner_fk
    foreign key (replica_id, owner_user_id)
    references vy_replica(replica_id, owner_user_id) on delete cascade,
  constraint vy_replica_voice_preview_intent_artifact_fk
    foreign key (preview_artifact_id, replica_id, owner_user_id)
    references vy_replica_processing_artifact(artifact_id, replica_id, owner_user_id) on delete cascade,
  constraint vy_replica_voice_preview_intent_style_shape
    check (jsonb_typeof(style)='object' and octet_length(style::text) between 2 and 2048),
  constraint vy_replica_voice_preview_intent_regeneration_key_shape
    check (regeneration_key='' or regeneration_key ~ '^[A-Za-z0-9_-]{8,96}$'),
  constraint vy_replica_voice_preview_intent_lease_shape check (
    (state<>'synthesizing' and lease_token_hash='' and leased_at is null and lease_expires_at is null)
    or
    (state='synthesizing' and lease_token_hash ~ '^[0-9a-f]{64}$'
      and leased_at is not null and lease_expires_at>leased_at)
  ),
  constraint vy_replica_voice_preview_intent_result_shape check (
    (
      state='sealed' and generation_id is not null and completed_at is not null
      and result_expires_at>completed_at
      and lease_token_hash='' and failure_code=''
      and result_storage_bucket is not null and result_object_path is not null
      and result_mime='audio/wav' and result_byte_size between 45 and 67108864
      and result_sha256 ~ '^[0-9a-f]{64}$'
      and jsonb_typeof(result_metadata)='object' and octet_length(result_metadata::text)<=2048
    ) or (
      state<>'sealed' and completed_at is null
      and result_expires_at is null
      and result_storage_bucket is null and result_object_path is null
      and result_mime is null and result_byte_size is null and result_sha256 is null
      and result_object_id is null
    )
  ),
  constraint vy_replica_voice_preview_intent_exact_identity unique
    (owner_user_id, replica_id, genome_version, preview_artifact_id, language_id,
     text_hash, text_plan_sha256, model_commitment, style, preview_seed, regeneration_key),
  constraint vy_replica_voice_preview_intent_key_identity unique
    (owner_user_id, intent_key, regeneration_key),
  constraint vy_replica_voice_preview_intent_owner_identity unique
    (intent_id, replica_id, owner_user_id)
);

create index if not exists vy_replica_voice_preview_intent_observe_ix
  on vy_replica_voice_preview_intent
    (owner_user_id, replica_id, updated_at desc);

create index if not exists vy_replica_voice_preview_intent_recovery_ix
  on vy_replica_voice_preview_intent
    (state, next_attempt_at, lease_expires_at)
  where state in ('warming','synthesizing','retryable');

alter table vy_replica_generation
  add column if not exists preview_intent_id uuid;

alter table vy_replica_generation
  add column if not exists preview_intent_attempt integer;

alter table vy_replica_generation
  add column if not exists preview_regeneration_key text not null default '';

alter table vy_replica_generation
  add column if not exists preview_result_storage_bucket text not null default '';

alter table vy_replica_generation
  add column if not exists preview_result_object_path text not null default '';

alter table vy_replica_generation
  add column if not exists preview_result_deleted_at timestamptz;

alter table vy_replica_generation
  add column if not exists preview_result_cleanup_claimed_at timestamptz;

alter table vy_replica_generation
  drop constraint if exists vy_replica_generation_preview_intent_shape;

alter table vy_replica_generation
  add constraint vy_replica_generation_preview_intent_shape check (
    (preview_intent_id is null and preview_intent_attempt is null and preview_regeneration_key=''
      and preview_result_storage_bucket='' and preview_result_object_path=''
      and preview_result_deleted_at is null and preview_result_cleanup_claimed_at is null)
    or
    (purpose='voice_preview' and preview_trial_id is null and preview_intent_id is not null
      and preview_intent_attempt>0
      and (preview_regeneration_key='' or preview_regeneration_key ~ '^[A-Za-z0-9_-]{8,96}$')
      and preview_result_storage_bucket<>''
      and preview_result_object_path like '%/derived/voice-preview/%.wav')
  );

alter table vy_replica_generation
  drop constraint if exists vy_replica_generation_preview_intent_fk;

alter table vy_replica_generation
  add constraint vy_replica_generation_preview_intent_fk
    foreign key (preview_intent_id, replica_id, owner_user_id)
    references vy_replica_voice_preview_intent(intent_id, replica_id, owner_user_id) on delete cascade;

create unique index if not exists vy_replica_generation_preview_intent_attempt_ix
  on vy_replica_generation (preview_intent_id, preview_intent_attempt)
  where preview_intent_id is not null;
