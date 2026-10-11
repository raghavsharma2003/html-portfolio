-- Migration 044 - append-only owner selection of private voice candidates.

create unique index if not exists vy_replica_artifact_owner_short_tuple_ix
  on vy_replica_processing_artifact (artifact_id,replica_id,owner_user_id);

create table if not exists vy_replica_processing_artifact_decision (
  decision_id       bigint generated always as identity primary key,
  artifact_id       uuid not null,
  replica_id        uuid not null,
  owner_user_id     uuid not null,
  decision          text not null check (decision in ('selected','rejected','superseded')),
  reason_code       text not null check (reason_code in (
                      'owner_voice_match','wrong_speaker','identity_changed','noisy_or_distorted','better_candidate'
                    )),
  reviewer_user_id  uuid not null,
  created_at        timestamptz not null default now(),
  constraint vy_replica_artifact_decision_owner_check check (reviewer_user_id=owner_user_id),
  constraint vy_replica_artifact_decision_artifact_owner_fk
    foreign key (artifact_id,replica_id,owner_user_id)
    references vy_replica_processing_artifact(artifact_id,replica_id,owner_user_id) on delete cascade
);

create index if not exists vy_replica_artifact_decision_latest_ix
  on vy_replica_processing_artifact_decision (artifact_id,created_at desc,decision_id desc);

create index if not exists vy_replica_artifact_decision_owner_ix
  on vy_replica_processing_artifact_decision (owner_user_id,replica_id,created_at desc);
