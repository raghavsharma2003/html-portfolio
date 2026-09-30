-- Migration 030 - leakage-safe, content-free feedback dataset manifests.
--
-- Conversation split assignments are immutable across dataset versions so a
-- turn from one private session can never appear in both train and evaluation.

create table if not exists vy_replica_feedback_dataset (
  dataset_id          uuid primary key,
  replica_id          uuid not null,
  owner_user_id       uuid not null,
  version             integer not null check (version > 0),
  profile_version     integer not null check (profile_version > 0),
  calibration_version integer not null check (calibration_version > 0),
  schema_version      text not null,
  source_set_hash     text not null,
  definition          jsonb not null,
  readiness           jsonb not null,
  status              text not null default 'draft' check (status in ('draft','approved','retired','rejected')),
  created_at          timestamptz not null default now(),
  constraint vy_replica_feedback_dataset_hash check (source_set_hash ~ '^[0-9a-f]{64}$'),
  constraint vy_replica_feedback_dataset_owner_identity unique (dataset_id,replica_id,owner_user_id),
  constraint vy_replica_feedback_dataset_version unique (replica_id,version),
  constraint vy_replica_feedback_dataset_source unique (replica_id,owner_user_id,profile_version,calibration_version,source_set_hash),
  constraint vy_replica_feedback_dataset_owner_fk
    foreign key (replica_id,owner_user_id) references vy_replica(replica_id,owner_user_id) on delete cascade,
  constraint vy_replica_feedback_dataset_profile_fk
    foreign key (replica_id,profile_version) references vy_replica_profile(replica_id,version),
  constraint vy_replica_feedback_dataset_calibration_fk
    foreign key (replica_id,calibration_version) references vy_replica_calibration(replica_id,version)
);

create index if not exists vy_replica_feedback_dataset_owner_ix
  on vy_replica_feedback_dataset (owner_user_id,replica_id,created_at desc);

create table if not exists vy_replica_feedback_split (
  replica_id          uuid not null,
  owner_user_id       uuid not null,
  session_commitment  text not null,
  split               text not null check (split in ('train','development','test')),
  first_dataset_id    uuid not null,
  created_at          timestamptz not null default now(),
  primary key (replica_id,owner_user_id,session_commitment),
  constraint vy_replica_feedback_split_hash check (session_commitment ~ '^[0-9a-f]{64}$'),
  constraint vy_replica_feedback_split_owner_fk
    foreign key (replica_id,owner_user_id)
    references vy_replica(replica_id,owner_user_id) on delete cascade,
  constraint vy_replica_feedback_split_dataset_fk
    foreign key (first_dataset_id,replica_id,owner_user_id)
    references vy_replica_feedback_dataset(dataset_id,replica_id,owner_user_id) on delete cascade
);

create index if not exists vy_replica_feedback_split_dataset_ix
  on vy_replica_feedback_split (first_dataset_id,split);
