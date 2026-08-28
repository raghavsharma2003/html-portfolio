-- Migration 036 - crash-safe raw and derived source erasure.

alter table vy_replica_source
  add column if not exists erasure_attempts integer not null default 0;

alter table vy_replica_source
  add column if not exists erasure_next_attempt_at timestamptz not null default now();

alter table vy_replica_source
  add column if not exists erasure_lease_token_hash text not null default '';

alter table vy_replica_source
  add column if not exists erasure_leased_at timestamptz;

alter table vy_replica_source
  add column if not exists erasure_lease_expires_at timestamptz;

alter table vy_replica_source
  add column if not exists erasure_last_error_code text not null default '';

do $replica_source_erasure_constraints$
begin
  if not exists (
    select 1 from pg_constraint where conname='vy_replica_source_erasure_attempts_check'
      and conrelid='vy_replica_source'::regclass
  ) then
    alter table vy_replica_source add constraint vy_replica_source_erasure_attempts_check
      check (erasure_attempts >= 0);
  end if;
  if not exists (
    select 1 from pg_constraint where conname='vy_replica_source_erasure_lease_hash_check'
      and conrelid='vy_replica_source'::regclass
  ) then
    alter table vy_replica_source add constraint vy_replica_source_erasure_lease_hash_check
      check (erasure_lease_token_hash='' or erasure_lease_token_hash ~ '^[0-9a-f]{64}$');
  end if;
end;
$replica_source_erasure_constraints$;

create index if not exists vy_replica_source_erasure_ready_ix
  on vy_replica_source (erasure_next_attempt_at,updated_at)
  where state='deleting';

create table if not exists vy_replica_source_erasure_attempt (
  source_id       uuid not null,
  replica_id      uuid not null,
  owner_user_id   uuid not null,
  attempt         integer not null check (attempt > 0),
  object_count    integer not null check (object_count > 0),
  outcome         text not null check (outcome in ('running','retry','complete')),
  failure_code    text not null default '',
  started_at      timestamptz not null default now(),
  finished_at     timestamptz,
  primary key (source_id,attempt),
  constraint vy_replica_source_erasure_attempt_owner_fk
    foreign key (replica_id,owner_user_id)
    references vy_replica(replica_id,owner_user_id) on delete cascade
);

create index if not exists vy_replica_source_erasure_attempt_owner_ix
  on vy_replica_source_erasure_attempt (owner_user_id,replica_id,started_at desc);
