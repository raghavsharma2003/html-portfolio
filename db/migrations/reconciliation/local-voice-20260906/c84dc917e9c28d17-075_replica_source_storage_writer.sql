-- Migration 075 - durable, token-fenced authority for server storage writes.
--
-- A server request can lose its HTTP acknowledgement while Azure continues a
-- block operation. Job and preview leases are DB ownership fences, not proof
-- that the provider has stopped writing. Every server writer therefore owns a
-- separate durable row. Erasure waits an active row's not-after, and no writer
-- can release another writer because every transition binds writer id, exact
-- source scope, purpose and a one-way token hash.

-- Mixed-version fence. An old web or worker instance can insert a source after
-- this migration's backfill but before the new code has drained. The temporary
-- default makes that new row wait twelve hours even though the old instance
-- knows nothing about the writer table. Current insert statements explicitly
-- write NULL before acquiring their exact authority, so the conservative
-- default may remain as a permanent fail-safe for an old or future unguarded
-- writer without delaying correctly integrated current-code sources.
alter table vy_replica_source
  alter column upload_authorization_expires_at
  set default (now()+interval '12 hours');

create table if not exists vy_replica_source_storage_writer (
  writer_id              uuid primary key,
  source_id              uuid not null,
  replica_id             uuid not null,
  owner_user_id          uuid not null,
  purpose                text not null
                         check (purpose in (
                           'context_source','processing_artifact','voice_preview_result','legacy_rollout'
                         )),
  guard_id               uuid not null,
  guard_token_hash       text not null
                         check (guard_token_hash ~ '^[0-9a-f]{64}$'),
  token_hash             text not null
                         check (token_hash ~ '^[0-9a-f]{64}$'),
  state                  text not null default 'active'
                         check (state in ('active','released')),
  storage_write_not_after timestamptz not null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  released_at            timestamptz,
  constraint vy_replica_source_storage_writer_release_shape check (
    (state='active' and released_at is null)
    or (state='released' and released_at is not null)
  ),
  constraint vy_replica_source_storage_writer_source_fk
    foreign key (source_id,replica_id,owner_user_id)
    references vy_replica_source(source_id,replica_id,owner_user_id) on delete cascade
);

create index if not exists vy_replica_source_storage_writer_active_ix
  on vy_replica_source_storage_writer (source_id,storage_write_not_after)
  where state='active';

create index if not exists vy_replica_source_storage_writer_owner_ix
  on vy_replica_source_storage_writer (owner_user_id,replica_id,created_at desc);

-- The migration runner is intentionally repeatable rather than ledgered. Keep
-- the legacy-row backfill one-shot so a later routine migration run cannot add
-- a fresh twelve-hour erasure delay to sources created by current code.
create table if not exists vy_replica_storage_writer_rollout (
  rollout_key text primary key check (rollout_key='075'),
  completed_at timestamptz not null default now()
);

-- Old web/worker instances can still have a pre-075 single-PUT request in
-- flight during rollout. Give every extant source a non-releasable rollout
-- authority. Twelve hours exceeds the old 64 MiB Azure request's documented
-- 640-minute service ceiling plus acknowledgement margin. Operations still
-- keep erasure receipts paused until old instances have drained.
with first_apply as (
  insert into vy_replica_storage_writer_rollout (rollout_key)
  values ('075')
  on conflict (rollout_key) do nothing
  returning rollout_key
)
insert into vy_replica_source_storage_writer
  (writer_id,source_id,replica_id,owner_user_id,purpose,guard_id,guard_token_hash,
   token_hash,state,storage_write_not_after)
select s.source_id,s.source_id,s.replica_id,s.owner_user_id,'legacy_rollout',
       s.source_id,repeat('0',64),repeat('0',64),'active',now()+interval '12 hours'
  from vy_replica_source s
  cross join first_apply
on conflict (writer_id) do nothing;
