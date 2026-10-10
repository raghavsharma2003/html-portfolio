-- Migration 029 - exact-version owner feedback and encrypted correction exemplars.
--
-- Ratings remain typed and content-free. Optional owner wording is encrypted
-- before persistence and is never copied into the feedback ledger.

create unique index if not exists vy_replica_dialogue_feedback_identity_ix
  on vy_replica_dialogue_turn
    (turn_id,replica_id,owner_user_id,capability_id,profile_version,calibration_version,response_hash);

create unique index if not exists vy_replica_generation_feedback_identity_ix
  on vy_replica_generation (generation_id,replica_id,owner_user_id,dialogue_turn_id);

create table if not exists vy_replica_turn_feedback (
  feedback_id          uuid primary key,
  turn_id              uuid not null,
  replica_id           uuid not null,
  owner_user_id        uuid not null,
  capability_id        uuid not null,
  profile_version      integer not null check (profile_version > 0),
  calibration_version  integer not null check (calibration_version > 0),
  response_hash        text not null,
  source_generation_id uuid,
  revision             integer not null check (revision > 0),
  supersedes_id        uuid,
  ratings              jsonb not null check (jsonb_typeof(ratings)='object'),
  ratings_hash         text not null,
  reason_codes         text[] not null default '{}',
  correction_hash      text,
  policy_version       text not null,
  created_at           timestamptz not null default now(),
  constraint vy_replica_turn_feedback_hash check (response_hash ~ '^[0-9a-f]{64}$'),
  constraint vy_replica_turn_feedback_ratings_hash check (ratings_hash ~ '^[0-9a-f]{64}$'),
  constraint vy_replica_turn_feedback_correction_hash check (correction_hash is null or correction_hash ~ '^[0-9a-f]{64}$'),
  constraint vy_replica_turn_feedback_reason_count check (cardinality(reason_codes) <= 8),
  constraint vy_replica_turn_feedback_revision unique (turn_id,revision),
  constraint vy_replica_turn_feedback_owner_identity unique (feedback_id,replica_id,owner_user_id),
  constraint vy_replica_turn_feedback_supersedes_fk
    foreign key (supersedes_id,replica_id,owner_user_id)
    references vy_replica_turn_feedback(feedback_id,replica_id,owner_user_id),
  constraint vy_replica_turn_feedback_turn_fk
    foreign key (turn_id,replica_id,owner_user_id,capability_id,profile_version,calibration_version,response_hash)
    references vy_replica_dialogue_turn(
      turn_id,replica_id,owner_user_id,capability_id,profile_version,calibration_version,response_hash
    ) on delete cascade,
  constraint vy_replica_turn_feedback_generation_fk
    foreign key (source_generation_id,replica_id,owner_user_id,turn_id)
    references vy_replica_generation(generation_id,replica_id,owner_user_id,dialogue_turn_id)
);

create index if not exists vy_replica_turn_feedback_owner_ix
  on vy_replica_turn_feedback (owner_user_id,replica_id,created_at desc);

create table if not exists vy_replica_turn_exemplar (
  feedback_id       uuid primary key,
  replica_id        uuid not null,
  owner_user_id     uuid not null,
  algorithm         text not null check (algorithm='AES-256-GCM'),
  key_id            text not null,
  nonce             bytea not null,
  ciphertext        bytea not null,
  auth_tag          bytea not null,
  wrapped_dek       bytea not null,
  wrap_nonce        bytea not null,
  wrap_auth_tag     bytea not null,
  aad_sha256        text not null,
  text_sha256       text not null,
  created_at        timestamptz not null default now(),
  constraint vy_replica_turn_exemplar_aad_hash check (aad_sha256 ~ '^[0-9a-f]{64}$'),
  constraint vy_replica_turn_exemplar_text_hash check (text_sha256 ~ '^[0-9a-f]{64}$'),
  constraint vy_replica_turn_exemplar_crypto_shape check (
    octet_length(nonce)=12 and octet_length(auth_tag)=16 and octet_length(ciphertext)>0
    and octet_length(wrapped_dek)=32 and octet_length(wrap_nonce)=12 and octet_length(wrap_auth_tag)=16
  ),
  constraint vy_replica_turn_exemplar_feedback_fk
    foreign key (feedback_id,replica_id,owner_user_id)
    references vy_replica_turn_feedback(feedback_id,replica_id,owner_user_id) on delete cascade
);

create index if not exists vy_replica_turn_exemplar_owner_ix
  on vy_replica_turn_exemplar (owner_user_id,replica_id,created_at desc);
