-- Migration 050 - preregistered owner held-out voice-delivery qualification.
-- This verdict is deliberately not production qualification and cannot change
-- a delivery policy or replica lifecycle to approved/active.

alter table vy_replica_voice_trial add column if not exists phase text not null default 'calibration';
alter table vy_replica_voice_trial add column if not exists delivery_policy_id uuid;
alter table vy_replica_voice_trial add column if not exists candidate_side text;
alter table vy_replica_voice_trial add column if not exists holdout_seed_index integer;

alter table vy_replica_voice_trial drop constraint if exists vy_replica_voice_trial_algorithm_check;
alter table vy_replica_voice_trial add constraint vy_replica_voice_trial_algorithm_check
  check (algorithm in ('voice-curriculum/bt-active-v1','voice-curriculum/bt-active-v2','voice-delivery-owner-holdout/v1'));
alter table vy_replica_voice_trial drop constraint if exists vy_replica_voice_trial_prompt_deck_check;
alter table vy_replica_voice_trial add constraint vy_replica_voice_trial_prompt_deck_check
  check (prompt_deck_version in ('legacy.owner-custom/v1','voice-calibration-deck/v1','voice-delivery-holdout-deck/v1'));

do $replica_voice_delivery_holdout_constraints$
begin
  if not exists (select 1 from pg_constraint where conname='vy_replica_voice_trial_delivery_policy_fk') then
    alter table vy_replica_voice_trial add constraint vy_replica_voice_trial_delivery_policy_fk
      foreign key (delivery_policy_id,replica_id,owner_user_id)
      references vy_replica_voice_delivery_policy(policy_id,replica_id,owner_user_id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname='vy_replica_voice_trial_phase_shape') then
    alter table vy_replica_voice_trial add constraint vy_replica_voice_trial_phase_shape check (
      (phase='calibration' and delivery_policy_id is null and candidate_side is null and holdout_seed_index is null)
      or
      (phase='holdout' and delivery_policy_id is not null and candidate_side in ('left','right')
        and holdout_seed_index between 0 and 1 and algorithm='voice-delivery-owner-holdout/v1'
        and prompt_deck_version='voice-delivery-holdout-deck/v1')
    );
  end if;
end;
$replica_voice_delivery_holdout_constraints$;

create unique index if not exists vy_replica_voice_delivery_holdout_cell_ix
  on vy_replica_voice_trial(delivery_policy_id,prompt_key,holdout_seed_index)
  where phase='holdout' and state in ('issued','completed');

create table if not exists vy_replica_voice_delivery_qualification (
  qualification_id    uuid primary key,
  policy_id            uuid not null,
  replica_id           uuid not null,
  owner_user_id        uuid not null,
  protocol_version     text not null check (protocol_version='voice-delivery-owner-holdout/v1'),
  prompt_deck_version  text not null check (prompt_deck_version='voice-delivery-holdout-deck/v1'),
  source_set_hash      text not null check (source_set_hash~'^[0-9a-f]{64}$'),
  observation_count    integer not null check (observation_count=12),
  prompt_family_count  integer not null check (prompt_family_count=6),
  candidate_score      numeric(8,3) not null check (candidate_score between 0 and 12),
  candidate_rate       numeric(8,6) not null check (candidate_rate between 0 and 1),
  wilson_lower         numeric(8,6) not null check (wilson_lower between 0 and 1),
  neither_count        integer not null check (neither_count between 0 and 12),
  verdict              text not null check (verdict in ('owner_pass','owner_fail')),
  created_at           timestamptz not null default now(),
  constraint vy_replica_voice_delivery_qualification_owner_identity
    unique (qualification_id,policy_id,replica_id,owner_user_id),
  constraint vy_replica_voice_delivery_qualification_source
    unique (policy_id,protocol_version,source_set_hash),
  constraint vy_replica_voice_delivery_qualification_policy_fk
    foreign key (policy_id,replica_id,owner_user_id)
    references vy_replica_voice_delivery_policy(policy_id,replica_id,owner_user_id) on delete cascade
);

create index if not exists vy_replica_voice_delivery_qualification_owner_ix
  on vy_replica_voice_delivery_qualification(owner_user_id,replica_id,created_at desc);
