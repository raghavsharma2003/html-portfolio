-- Migration 039 - crash-safe, content-free liveness verification ledger.

alter table vy_replica_liveness_challenge
  add column if not exists verification_attempt integer not null default 0;

alter table vy_replica_liveness_challenge
  add column if not exists verification_next_attempt_at timestamptz not null default now();

alter table vy_replica_liveness_challenge
  add column if not exists verification_lease_token_hash text not null default '';

alter table vy_replica_liveness_challenge
  add column if not exists verification_leased_at timestamptz;

alter table vy_replica_liveness_challenge
  add column if not exists verification_lease_expires_at timestamptz;

do $replica_liveness_verification_checks$
begin
  if not exists (
    select 1 from pg_constraint where conname='vy_replica_liveness_verification_attempt_check'
      and conrelid='vy_replica_liveness_challenge'::regclass
  ) then
    alter table vy_replica_liveness_challenge add constraint vy_replica_liveness_verification_attempt_check
      check (verification_attempt >= 0);
  end if;
  if not exists (
    select 1 from pg_constraint where conname='vy_replica_liveness_verification_lease_check'
      and conrelid='vy_replica_liveness_challenge'::regclass
  ) then
    alter table vy_replica_liveness_challenge add constraint vy_replica_liveness_verification_lease_check
      check (verification_lease_token_hash='' or verification_lease_token_hash ~ '^[0-9a-f]{64}$');
  end if;
end;
$replica_liveness_verification_checks$;

create unique index if not exists vy_replica_liveness_owner_tuple_ix
  on vy_replica_liveness_challenge (challenge_id,replica_id,owner_user_id);

create index if not exists vy_replica_liveness_verification_ready_ix
  on vy_replica_liveness_challenge (verification_next_attempt_at,updated_at)
  where state in ('uploaded','verifying');

create table if not exists vy_replica_liveness_verification_attempt (
  challenge_id     uuid not null,
  replica_id        uuid not null,
  owner_user_id     uuid not null,
  attempt           integer not null check (attempt > 0),
  verifier          text not null,
  verifier_version  text not null,
  outcome           text not null check (outcome in ('running','retry','passed','failed')),
  failure_code      text not null default '',
  result             jsonb not null default '{}'::jsonb,
  started_at         timestamptz not null default now(),
  finished_at        timestamptz,
  primary key (challenge_id,attempt),
  constraint vy_replica_liveness_attempt_owner_fk
    foreign key (challenge_id,replica_id,owner_user_id)
    references vy_replica_liveness_challenge(challenge_id,replica_id,owner_user_id) on delete cascade,
  constraint vy_replica_liveness_attempt_result_check check (jsonb_typeof(result)='object')
);

create index if not exists vy_replica_liveness_attempt_owner_ix
  on vy_replica_liveness_verification_attempt (owner_user_id,replica_id,started_at desc);
