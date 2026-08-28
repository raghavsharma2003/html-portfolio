-- Migration 047 - server-assigned adaptive voice calibration trials.
-- Trials contain only commitments and bounded condition identifiers. Spoken
-- text remains private and is represented only by its SHA-256 commitment.

create table if not exists vy_replica_voice_trial (
  trial_id             uuid primary key,
  replica_id           uuid not null,
  owner_user_id        uuid not null,
  genome_version       integer not null check (genome_version>0),
  preview_artifact_id  uuid not null,
  language_id          text not null check (language_id in ('en','hi')),
  text_hash             text not null check (text_hash~'^[0-9a-f]{64}$'),
  preview_seed          integer not null check (preview_seed between 1 and 2147483647),
  model_commitment      text not null check (model_commitment~'^[0-9a-f]{64}$'),
  left_style_key        text not null,
  right_style_key       text not null,
  pair_hash             text not null check (pair_hash~'^[0-9a-f]{64}$'),
  algorithm             text not null check (algorithm='voice-curriculum/bt-active-v1'),
  state                 text not null default 'issued'
                        check (state in ('issued','completed','expired','cancelled')),
  expires_at            timestamptz not null,
  completed_at          timestamptz,
  created_at            timestamptz not null default now(),
  constraint vy_replica_voice_trial_distinct check (left_style_key<>right_style_key),
  constraint vy_replica_voice_trial_left_style check (left_style_key in (
    'identity_anchor','faithful','steady_warm','balanced','warm_expressive','expressive','animated'
  )),
  constraint vy_replica_voice_trial_right_style check (right_style_key in (
    'identity_anchor','faithful','steady_warm','balanced','warm_expressive','expressive','animated'
  )),
  constraint vy_replica_voice_trial_time check (expires_at>created_at),
  constraint vy_replica_voice_trial_completion check (
    (state='completed' and completed_at is not null) or (state<>'completed' and completed_at is null)
  ),
  constraint vy_replica_voice_trial_owner_identity unique (trial_id,replica_id,owner_user_id),
  constraint vy_replica_voice_trial_owner_fk foreign key (replica_id,owner_user_id)
    references vy_replica(replica_id,owner_user_id) on delete cascade,
  constraint vy_replica_voice_trial_genome_fk foreign key (replica_id,genome_version)
    references vy_replica_voice_genome(replica_id,version) on delete restrict,
  constraint vy_replica_voice_trial_artifact_fk foreign key (preview_artifact_id,replica_id,owner_user_id)
    references vy_replica_processing_artifact(artifact_id,replica_id,owner_user_id) on delete restrict
);

create index if not exists vy_replica_voice_trial_owner_ix
  on vy_replica_voice_trial(owner_user_id,replica_id,created_at desc);
create index if not exists vy_replica_voice_trial_expiry_ix
  on vy_replica_voice_trial(expires_at) where state='issued';

alter table vy_replica_generation add column if not exists preview_trial_id uuid;
alter table vy_replica_generation add column if not exists preview_trial_side text;
alter table vy_replica_voice_preference add column if not exists trial_id uuid;

do $replica_voice_trial_constraints$
begin
  if not exists (select 1 from pg_constraint where conname='vy_replica_generation_trial_shape') then
    alter table vy_replica_generation add constraint vy_replica_generation_trial_shape check (
      (preview_trial_id is null and preview_trial_side is null)
      or (purpose='voice_preview' and preview_trial_id is not null and preview_trial_side in ('left','right'))
    );
  end if;
  if not exists (select 1 from pg_constraint where conname='vy_replica_generation_trial_fk') then
    alter table vy_replica_generation add constraint vy_replica_generation_trial_fk
      foreign key (preview_trial_id,replica_id,owner_user_id)
      references vy_replica_voice_trial(trial_id,replica_id,owner_user_id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname='vy_replica_voice_preference_trial_fk') then
    alter table vy_replica_voice_preference add constraint vy_replica_voice_preference_trial_fk
      foreign key (trial_id,replica_id,owner_user_id)
      references vy_replica_voice_trial(trial_id,replica_id,owner_user_id) on delete cascade;
  end if;
end;
$replica_voice_trial_constraints$;

create unique index if not exists vy_replica_generation_active_trial_side
  on vy_replica_generation(preview_trial_id,preview_trial_side)
  where preview_trial_id is not null and state in ('authorized','streaming','sealed');
