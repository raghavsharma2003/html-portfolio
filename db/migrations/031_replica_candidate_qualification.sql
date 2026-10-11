-- Migration 031 - immutable candidate artifacts and paired qualification.
--
-- Qualified means eligible for explicit promotion review, never automatically
-- active. Raw prompts, replies, audio and judge notes stay outside this ledger.

create unique index if not exists vy_replica_runtime_candidate_identity_ix
  on vy_replica_runtime_capability
    (capability_id,replica_id,owner_user_id,profile_version,calibration_version);

create unique index if not exists vy_replica_feedback_dataset_candidate_identity_ix
  on vy_replica_feedback_dataset
    (dataset_id,replica_id,owner_user_id,profile_version,calibration_version);

create table if not exists vy_replica_candidate (
  candidate_id         uuid primary key,
  dataset_id           uuid not null,
  replica_id           uuid not null,
  owner_user_id        uuid not null,
  base_capability_id   uuid not null,
  profile_version      integer not null check (profile_version > 0),
  calibration_version  integer not null check (calibration_version > 0),
  kind                 text not null check (kind in ('dialogue_adapter','voice_adapter','joint_adapter','prompt_policy')),
  target_layers        text[] not null,
  artifact_sha256      text not null,
  base_model_commitment text not null,
  build_manifest_hash  text not null,
  status               text not null default 'draft'
                       check (status in ('draft','evaluating','qualified','rejected','retired')),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint vy_replica_candidate_artifact_hash check (artifact_sha256 ~ '^[0-9a-f]{64}$'),
  constraint vy_replica_candidate_base_hash check (base_model_commitment ~ '^[0-9a-f]{64}$'),
  constraint vy_replica_candidate_manifest_hash check (build_manifest_hash ~ '^[0-9a-f]{64}$'),
  constraint vy_replica_candidate_layers check (
    cardinality(target_layers) between 1 and 7 and
    target_layers <@ array['overall','wording','behavior','relationship','memory','delivery','voice_identity']::text[]
  ),
  constraint vy_replica_candidate_owner_identity unique (candidate_id,replica_id,owner_user_id),
  constraint vy_replica_candidate_artifact_unique unique (replica_id,dataset_id,artifact_sha256),
  constraint vy_replica_candidate_dataset_fk
    foreign key (dataset_id,replica_id,owner_user_id,profile_version,calibration_version)
    references vy_replica_feedback_dataset(dataset_id,replica_id,owner_user_id,profile_version,calibration_version) on delete cascade,
  constraint vy_replica_candidate_capability_fk
    foreign key (base_capability_id,replica_id,owner_user_id,profile_version,calibration_version)
    references vy_replica_runtime_capability(capability_id,replica_id,owner_user_id,profile_version,calibration_version)
);

create index if not exists vy_replica_candidate_owner_ix
  on vy_replica_candidate (owner_user_id,replica_id,created_at desc);

create table if not exists vy_replica_candidate_qualification (
  qualification_id  uuid primary key,
  candidate_id      uuid not null,
  replica_id        uuid not null,
  owner_user_id     uuid not null,
  protocol_version  text not null,
  test_set_hash     text not null,
  observation_hash  text not null,
  observation_count integer not null check (observation_count > 0),
  metrics           jsonb not null,
  verdict           text not null check (verdict in ('pass','fail','inconclusive')),
  created_at        timestamptz not null default now(),
  constraint vy_replica_candidate_qualification_test_hash check (test_set_hash ~ '^[0-9a-f]{64}$'),
  constraint vy_replica_candidate_qualification_observation_hash check (observation_hash ~ '^[0-9a-f]{64}$'),
  constraint vy_replica_candidate_qualification_unique unique (candidate_id,protocol_version,test_set_hash,observation_hash),
  constraint vy_replica_candidate_qualification_candidate_fk
    foreign key (candidate_id,replica_id,owner_user_id)
    references vy_replica_candidate(candidate_id,replica_id,owner_user_id) on delete cascade
);

create index if not exists vy_replica_candidate_qualification_owner_ix
  on vy_replica_candidate_qualification (owner_user_id,replica_id,created_at desc);
