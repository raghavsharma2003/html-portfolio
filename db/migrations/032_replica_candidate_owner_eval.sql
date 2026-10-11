-- Migration 032 - private blinded owner evaluation assignments.
--
-- Run and judgment ledgers are content-free. Context and both outputs are
-- envelope-encrypted in a separately erasable asset table. The owner sees A/B
-- positions only; candidate identity is resolved server-side after judgment.

create unique index if not exists vy_replica_candidate_eval_identity_ix
  on vy_replica_candidate (candidate_id,dataset_id,replica_id,owner_user_id);

create table if not exists vy_replica_candidate_eval_run (
  eval_run_id          uuid primary key,
  candidate_id         uuid not null,
  dataset_id           uuid not null,
  replica_id           uuid not null,
  owner_user_id        uuid not null,
  protocol_version     text not null,
  run_commitment       text not null,
  dataset_source_set_hash text not null,
  required_dimensions text[] not null,
  assignment_count     integer not null check (assignment_count >= 30),
  state                text not null default 'preparing'
                       check (state in ('preparing','collecting','complete','aborted')),
  created_at           timestamptz not null default now(),
  completed_at         timestamptz,
  constraint vy_replica_candidate_eval_run_hash check (run_commitment ~ '^[0-9a-f]{64}$'),
  constraint vy_replica_candidate_eval_dataset_hash check (dataset_source_set_hash ~ '^[0-9a-f]{64}$'),
  constraint vy_replica_candidate_eval_dimensions check (
    cardinality(required_dimensions) between 1 and 7 and
    required_dimensions <@ array['overall','wording','behavior','relationship','memory','delivery','voice_identity']::text[]
  ),
  constraint vy_replica_candidate_eval_run_owner_identity
    unique (eval_run_id,candidate_id,replica_id,owner_user_id),
  constraint vy_replica_candidate_eval_run_commitment
    unique (candidate_id,run_commitment),
  constraint vy_replica_candidate_eval_candidate_fk
    foreign key (candidate_id,dataset_id,replica_id,owner_user_id)
    references vy_replica_candidate(candidate_id,dataset_id,replica_id,owner_user_id) on delete cascade
);

create index if not exists vy_replica_candidate_eval_run_owner_ix
  on vy_replica_candidate_eval_run (owner_user_id,replica_id,state,created_at desc);

create table if not exists vy_replica_candidate_eval_assignment (
  assignment_id       uuid primary key,
  eval_run_id         uuid not null,
  candidate_id        uuid not null,
  replica_id          uuid not null,
  owner_user_id       uuid not null,
  example_id          uuid not null,
  session_commitment  text not null,
  sequence            integer not null check (sequence > 0),
  presentation_order  text not null check (presentation_order in ('ab','ba')),
  assignment_hash     text not null,
  state               text not null default 'pending' check (state in ('pending','submitted','void')),
  created_at          timestamptz not null default now(),
  submitted_at        timestamptz,
  constraint vy_replica_candidate_eval_assignment_session check (session_commitment ~ '^[0-9a-f]{64}$'),
  constraint vy_replica_candidate_eval_assignment_hash check (assignment_hash ~ '^[0-9a-f]{64}$'),
  constraint vy_replica_candidate_eval_assignment_owner_identity
    unique (assignment_id,eval_run_id,candidate_id,replica_id,owner_user_id),
  constraint vy_replica_candidate_eval_assignment_asset_binding
    unique (assignment_id,eval_run_id,candidate_id,replica_id,owner_user_id,example_id),
  constraint vy_replica_candidate_eval_assignment_judgment_binding
    unique (assignment_id,eval_run_id,candidate_id,replica_id,owner_user_id,assignment_hash),
  constraint vy_replica_candidate_eval_assignment_sequence unique (eval_run_id,sequence),
  constraint vy_replica_candidate_eval_assignment_example unique (eval_run_id,example_id),
  constraint vy_replica_candidate_eval_assignment_hash_unique unique (eval_run_id,assignment_hash),
  constraint vy_replica_candidate_eval_assignment_run_fk
    foreign key (eval_run_id,candidate_id,replica_id,owner_user_id)
    references vy_replica_candidate_eval_run(eval_run_id,candidate_id,replica_id,owner_user_id) on delete cascade,
  constraint vy_replica_candidate_eval_assignment_feedback_fk
    foreign key (example_id,replica_id,owner_user_id)
    references vy_replica_turn_feedback(feedback_id,replica_id,owner_user_id) on delete cascade
);

create index if not exists vy_replica_candidate_eval_assignment_next_ix
  on vy_replica_candidate_eval_assignment (eval_run_id,state,sequence);

create table if not exists vy_replica_candidate_eval_asset (
  asset_id            uuid primary key,
  assignment_id       uuid not null,
  eval_run_id         uuid not null,
  candidate_id        uuid not null,
  replica_id          uuid not null,
  owner_user_id       uuid not null,
  example_id          uuid not null,
  role                text not null check (role in ('context','a','b')),
  output_sha256       text not null,
  algorithm           text not null check (algorithm='AES-256-GCM'),
  key_id              text not null,
  nonce               bytea not null,
  ciphertext          bytea not null,
  auth_tag             bytea not null,
  wrapped_dek         bytea not null,
  wrap_nonce          bytea not null,
  wrap_auth_tag       bytea not null,
  aad_sha256          text not null,
  created_at          timestamptz not null default now(),
  constraint vy_replica_candidate_eval_asset_output_hash check (output_sha256 ~ '^[0-9a-f]{64}$'),
  constraint vy_replica_candidate_eval_asset_aad_hash check (aad_sha256 ~ '^[0-9a-f]{64}$'),
  constraint vy_replica_candidate_eval_asset_crypto_shape check (
    octet_length(nonce)=12 and octet_length(auth_tag)=16 and octet_length(ciphertext)>0
    and octet_length(wrapped_dek)=32 and octet_length(wrap_nonce)=12 and octet_length(wrap_auth_tag)=16
  ),
  constraint vy_replica_candidate_eval_asset_role unique (assignment_id,role),
  constraint vy_replica_candidate_eval_asset_assignment_fk
    foreign key (assignment_id,eval_run_id,candidate_id,replica_id,owner_user_id,example_id)
    references vy_replica_candidate_eval_assignment(assignment_id,eval_run_id,candidate_id,replica_id,owner_user_id,example_id) on delete cascade
);

create index if not exists vy_replica_candidate_eval_asset_owner_ix
  on vy_replica_candidate_eval_asset (owner_user_id,replica_id,eval_run_id);

create table if not exists vy_replica_candidate_eval_judgment (
  judgment_id         uuid primary key,
  assignment_id       uuid not null,
  eval_run_id         uuid not null,
  candidate_id        uuid not null,
  replica_id          uuid not null,
  owner_user_id       uuid not null,
  dimension           text not null check (dimension in ('overall','wording','behavior','relationship','memory','delivery','voice_identity')),
  position_winner     text not null check (position_winner in ('a','b','tie')),
  assignment_hash     text not null,
  created_at          timestamptz not null default now(),
  constraint vy_replica_candidate_eval_judgment_hash check (assignment_hash ~ '^[0-9a-f]{64}$'),
  constraint vy_replica_candidate_eval_judgment_once unique (assignment_id,dimension),
  constraint vy_replica_candidate_eval_judgment_assignment_fk
    foreign key (assignment_id,eval_run_id,candidate_id,replica_id,owner_user_id,assignment_hash)
    references vy_replica_candidate_eval_assignment(assignment_id,eval_run_id,candidate_id,replica_id,owner_user_id,assignment_hash) on delete cascade
);

create index if not exists vy_replica_candidate_eval_judgment_owner_ix
  on vy_replica_candidate_eval_judgment (owner_user_id,replica_id,eval_run_id,created_at);
