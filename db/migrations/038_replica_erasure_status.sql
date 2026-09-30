-- Migration 038 - capability-based owner erasure status after unlinking.

alter table vy_replica_deletion_receipt
  add column if not exists erasure_request_hash text not null default '';

do $replica_deletion_request_hash_check$
begin
  if not exists (
    select 1 from pg_constraint where conname='vy_replica_deletion_request_hash_check'
      and conrelid='vy_replica_deletion_receipt'::regclass
  ) then
    alter table vy_replica_deletion_receipt add constraint vy_replica_deletion_request_hash_check
      check (erasure_request_hash='' or erasure_request_hash ~ '^[0-9a-f]{64}$');
  end if;
end;
$replica_deletion_request_hash_check$;

create unique index if not exists vy_replica_deletion_request_hash_ix
  on vy_replica_deletion_receipt (erasure_request_hash)
  where erasure_request_hash<>'';
