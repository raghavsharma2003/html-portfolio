-- Migration 049 - immutable Voice Delivery Genome candidates.
-- A candidate contains only bounded controls, aggregate estimates and
-- commitments to exact blinded preference evidence. It cannot activate a
-- replica until a later held-out qualification protocol promotes it.

create table if not exists vy_replica_voice_delivery_policy (
  policy_id              uuid primary key,
  replica_id             uuid not null,
  owner_user_id          uuid not null,
  genome_version         integer not null check (genome_version>0),
  preview_artifact_id    uuid not null,
  language_id            text not null check (language_id in ('en','hi')),
  version                integer not null check (version>0),
  algorithm              text not null check (algorithm='voice-delivery-policy/bt-map-v1'),
  curriculum_algorithm   text not null check (curriculum_algorithm='voice-curriculum/bt-active-v2'),
  prompt_deck_version    text not null check (prompt_deck_version='voice-calibration-deck/v1'),
  model_commitment       text not null check (model_commitment~'^[0-9a-f]{64}$'),
  source_set_hash        text not null check (source_set_hash~'^[0-9a-f]{64}$'),
  definition             jsonb not null,
  evidence_count         integer not null check (evidence_count>=18),
  unique_prompt_count    integer not null check (unique_prompt_count>=6),
  latent_margin          numeric(10,6) not null check (latent_margin>=0),
  status                 text not null default 'draft'
                         check (status in ('draft','qualifying','qualified','approved','rejected','retired')),
  retired_at             timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint vy_replica_voice_delivery_definition check (
    jsonb_typeof(definition)='object' and octet_length(definition::text)<=65536
  ),
  constraint vy_replica_voice_delivery_retired_shape check (
    (status='retired' and retired_at is not null) or (status<>'retired' and retired_at is null)
  ),
  constraint vy_replica_voice_delivery_owner_identity unique (policy_id,replica_id,owner_user_id),
  constraint vy_replica_voice_delivery_version unique (replica_id,genome_version,language_id,version),
  constraint vy_replica_voice_delivery_source unique
    (replica_id,owner_user_id,genome_version,preview_artifact_id,language_id,model_commitment,source_set_hash),
  constraint vy_replica_voice_delivery_owner_fk foreign key (replica_id,owner_user_id)
    references vy_replica(replica_id,owner_user_id) on delete cascade,
  constraint vy_replica_voice_delivery_genome_fk foreign key (replica_id,genome_version)
    references vy_replica_voice_genome(replica_id,version) on delete restrict,
  constraint vy_replica_voice_delivery_artifact_fk foreign key (preview_artifact_id,replica_id,owner_user_id)
    references vy_replica_processing_artifact(artifact_id,replica_id,owner_user_id) on delete restrict
);

create index if not exists vy_replica_voice_delivery_owner_ix
  on vy_replica_voice_delivery_policy(owner_user_id,replica_id,language_id,version desc);
create index if not exists vy_replica_voice_delivery_status_ix
  on vy_replica_voice_delivery_policy(status,updated_at);
