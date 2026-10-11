-- Migration 025 - typed, versioned behavioral calibration.
--
-- Preferences are append-only answers to server-owned contrast pairs. A
-- calibration policy is a deterministic projection of the latest answers,
-- not a growing collection of prose appended to a prompt.

alter table vy_replica_preference add column if not exists profile_version integer;
alter table vy_replica_preference add column if not exists scenario_revision integer not null default 1;
alter table vy_replica_preference add column if not exists pair_hash text;
alter table vy_replica_preference add column if not exists revision integer not null default 1;
alter table vy_replica_preference add column if not exists supersedes_id uuid;
alter table vy_replica_preference add column if not exists confidence numeric(4,3) not null default 1.000;
alter table vy_replica_preference add column if not exists policy_version text;

create unique index if not exists vy_replica_preference_owner_identity_ix
  on vy_replica_preference (preference_id,replica_id,owner_user_id);

create unique index if not exists vy_replica_preference_pair_revision_ix
  on vy_replica_preference (replica_id,owner_user_id,pair_hash,revision)
  where pair_hash is not null;

do $replica_preference_constraints$
begin
  if not exists (select 1 from pg_constraint where conname='vy_replica_preference_profile_fk') then
    alter table vy_replica_preference add constraint vy_replica_preference_profile_fk
      foreign key (replica_id,profile_version)
      references vy_replica_profile(replica_id,version);
  end if;
  if not exists (select 1 from pg_constraint where conname='vy_replica_preference_supersedes_fk') then
    alter table vy_replica_preference add constraint vy_replica_preference_supersedes_fk
      foreign key (supersedes_id,replica_id,owner_user_id)
      references vy_replica_preference(preference_id,replica_id,owner_user_id);
  end if;
  if not exists (select 1 from pg_constraint where conname='vy_replica_preference_pair_hash_check') then
    alter table vy_replica_preference add constraint vy_replica_preference_pair_hash_check
      check (pair_hash is null or pair_hash ~ '^[0-9a-f]{64}$');
  end if;
  if not exists (select 1 from pg_constraint where conname='vy_replica_preference_revision_check') then
    alter table vy_replica_preference add constraint vy_replica_preference_revision_check
      check (revision > 0 and scenario_revision > 0 and confidence between 0 and 1 and length(note) <= 280);
  end if;
end;
$replica_preference_constraints$;

create table if not exists vy_replica_calibration (
  replica_id       uuid not null,
  owner_user_id    uuid not null,
  version          integer not null check (version > 0),
  profile_version  integer not null check (profile_version > 0),
  source_set_hash  text not null,
  definition       jsonb not null,
  status           text not null default 'draft'
                   check (status in ('draft','approved','retired')),
  created_at       timestamptz not null default now(),
  primary key (replica_id,version),
  constraint vy_replica_calibration_owner_fk
    foreign key (replica_id,owner_user_id)
    references vy_replica(replica_id,owner_user_id) on delete cascade,
  constraint vy_replica_calibration_profile_fk
    foreign key (replica_id,profile_version)
    references vy_replica_profile(replica_id,version),
  constraint vy_replica_calibration_source_hash
    check (source_set_hash ~ '^[0-9a-f]{64}$')
);

create unique index if not exists vy_replica_calibration_source_set_ix
  on vy_replica_calibration (replica_id,owner_user_id,profile_version,source_set_hash);

create index if not exists vy_replica_calibration_owner_ix
  on vy_replica_calibration (owner_user_id,replica_id,created_at desc);

alter table vy_replica_runtime_capability add column if not exists calibration_version integer;
alter table vy_replica_eval_run add column if not exists calibration_version integer;
alter table vy_replica_generation add column if not exists calibration_version integer;

do $replica_calibration_runtime_constraints$
begin
  if not exists (select 1 from pg_constraint where conname='vy_replica_runtime_calibration_fk') then
    alter table vy_replica_runtime_capability add constraint vy_replica_runtime_calibration_fk
      foreign key (replica_id,calibration_version)
      references vy_replica_calibration(replica_id,version);
  end if;
  if not exists (select 1 from pg_constraint where conname='vy_replica_eval_calibration_fk') then
    alter table vy_replica_eval_run add constraint vy_replica_eval_calibration_fk
      foreign key (replica_id,calibration_version)
      references vy_replica_calibration(replica_id,version);
  end if;
  if not exists (select 1 from pg_constraint where conname='vy_replica_generation_calibration_fk') then
    alter table vy_replica_generation add constraint vy_replica_generation_calibration_fk
      foreign key (replica_id,calibration_version)
      references vy_replica_calibration(replica_id,version);
  end if;
end;
$replica_calibration_runtime_constraints$;
