-- Migration 042 - crash-recoverable VoiceGenome build leases.

alter table vy_replica_model_build
  add column if not exists lease_token_hash text not null default '';

alter table vy_replica_model_build
  add column if not exists leased_at timestamptz;

alter table vy_replica_model_build
  add column if not exists lease_expires_at timestamptz;

alter table vy_replica_model_build
  add column if not exists built_at timestamptz;

update vy_replica_model_build
   set state = 'retry', failure_code = 'migration_recovered_unleased_build',
       next_attempt_at = now(), updated_at = now()
 where state in ('leased','building') and lease_expires_at is null;

do $replica_model_build_lease_shape$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'vy_replica_model_build_lease_shape'
       and conrelid = 'vy_replica_model_build'::regclass
  ) then
    alter table vy_replica_model_build
      add constraint vy_replica_model_build_lease_shape check (
        (lease_token_hash = '' and leased_at is null and lease_expires_at is null)
        or
        (lease_token_hash ~ '^[0-9a-f]{64}$' and leased_at is not null and lease_expires_at > leased_at)
      );
  end if;
end;
$replica_model_build_lease_shape$;

create index if not exists vy_replica_model_build_lease_ix
  on vy_replica_model_build (lease_expires_at)
  where state in ('leased','building');
