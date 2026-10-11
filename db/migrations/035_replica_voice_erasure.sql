-- Migration 035 - crash-safe, retryable provider voice erasure.
--
-- A voice is made unusable before a provider call. These fields let any later
-- worker resume the physical deletion without ever exposing the provider ref
-- or relying on one serverless invocation surviving to completion.

alter table vy_replica_voice_profile
  add column if not exists erasure_attempts integer not null default 0;

alter table vy_replica_voice_profile
  add column if not exists erasure_next_attempt_at timestamptz not null default now();

alter table vy_replica_voice_profile
  add column if not exists erasure_lease_token_hash text not null default '';

alter table vy_replica_voice_profile
  add column if not exists erasure_leased_at timestamptz;

alter table vy_replica_voice_profile
  add column if not exists erasure_lease_expires_at timestamptz;

alter table vy_replica_voice_profile
  add column if not exists erasure_last_error_code text not null default '';

do $replica_voice_erasure_attempts_check$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'vy_replica_voice_erasure_attempts_check'
      and conrelid = 'vy_replica_voice_profile'::regclass
  ) then
    alter table vy_replica_voice_profile add constraint vy_replica_voice_erasure_attempts_check
      check (erasure_attempts >= 0);
  end if;
end;
$replica_voice_erasure_attempts_check$;

do $replica_voice_erasure_lease_hash_check$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'vy_replica_voice_erasure_lease_hash_check'
      and conrelid = 'vy_replica_voice_profile'::regclass
  ) then
    alter table vy_replica_voice_profile add constraint vy_replica_voice_erasure_lease_hash_check
      check (erasure_lease_token_hash = '' or erasure_lease_token_hash ~ '^[0-9a-f]{64}$');
  end if;
end;
$replica_voice_erasure_lease_hash_check$;

create index if not exists vy_replica_voice_erasure_ready_ix
  on vy_replica_voice_profile (erasure_next_attempt_at, updated_at)
  where status = 'deleting';

-- Append-only, content-free operational evidence. In particular this table
-- never stores the provider ref, voice name, legal name, transcript or audio.
create table if not exists vy_replica_voice_erasure_attempt (
  voice_profile_id uuid not null,
  replica_id       uuid not null,
  owner_user_id    uuid not null,
  attempt          integer not null check (attempt > 0),
  outcome          text not null check (outcome in ('running','retry','complete')),
  failure_code     text not null default '',
  started_at       timestamptz not null default now(),
  finished_at      timestamptz,
  primary key (voice_profile_id, attempt),
  constraint vy_replica_voice_erasure_attempt_owner_fk
    foreign key (replica_id, owner_user_id)
    references vy_replica(replica_id, owner_user_id) on delete cascade
);

create index if not exists vy_replica_voice_erasure_attempt_owner_ix
  on vy_replica_voice_erasure_attempt (owner_user_id, replica_id, started_at desc);
