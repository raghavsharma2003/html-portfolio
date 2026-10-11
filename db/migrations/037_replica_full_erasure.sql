-- Migration 037 - crash-safe full replica purge and unlinkable receipt.

alter table vy_replica_erasure_job
  add column if not exists next_attempt_at timestamptz not null default now();

alter table vy_replica_erasure_job
  add column if not exists lease_token_hash text not null default '';

alter table vy_replica_erasure_job
  add column if not exists leased_at timestamptz;

alter table vy_replica_erasure_job
  add column if not exists lease_expires_at timestamptz;

do $replica_full_erasure_lease_check$
begin
  if not exists (
    select 1 from pg_constraint where conname='vy_replica_full_erasure_lease_hash_check'
      and conrelid='vy_replica_erasure_job'::regclass
  ) then
    alter table vy_replica_erasure_job add constraint vy_replica_full_erasure_lease_hash_check
      check (lease_token_hash='' or lease_token_hash ~ '^[0-9a-f]{64}$');
  end if;
end;
$replica_full_erasure_lease_check$;

drop index if exists vy_replica_erasure_pending_ix;

create index if not exists vy_replica_erasure_pending_ix
  on vy_replica_erasure_job (next_attempt_at,requested_at)
  where state in ('pending','running','blocked');

create table if not exists vy_replica_erasure_attempt (
  job_id        uuid not null references vy_replica_erasure_job(job_id) on delete cascade,
  attempt       integer not null check (attempt > 0),
  outcome       text not null check (outcome in ('running','retry','complete')),
  failure_code  text not null default '',
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  primary key (job_id,attempt)
);

alter table vy_replica_deletion_receipt
  add column if not exists receipt_version text not null default 'replica-erasure-receipt/v1';

alter table vy_replica_deletion_receipt
  add column if not exists receipt_nonce text not null default '';

do $replica_deletion_receipt_nonce_check$
begin
  if not exists (
    select 1 from pg_constraint where conname='vy_replica_deletion_receipt_nonce_check'
      and conrelid='vy_replica_deletion_receipt'::regclass
  ) then
    alter table vy_replica_deletion_receipt add constraint vy_replica_deletion_receipt_nonce_check
      check (receipt_nonce='' or receipt_nonce ~ '^[0-9a-f]{64}$');
  end if;
end;
$replica_deletion_receipt_nonce_check$;

create unique index if not exists vy_replica_deletion_receipt_replica_hash_ix
  on vy_replica_deletion_receipt (replica_id_hash);
