-- Migration 074 - durable channel extraction storage authority.
--
-- The media extractor receives a direct-to-storage upload capability. 053's
-- ingest row records the video, but it did not record where the bytes were
-- authorized to land or how long that authority remained usable. A replica
-- erasure could therefore delete the SQL rows and issue a receipt while the
-- extractor still held a capability able to recreate an unregistered object.
--
-- Existing rows receive the same 210-minute fence as new app-issued upload
-- authorities: a two-hour capability, 80 minutes for a legitimate final
-- 8 MiB Azure request, and ten minutes of margin. The
-- extraction route stays disabled during rollout and is enabled only after
-- that horizon; this covers a capability minted by the pre-074 release. The
-- defaults also fence rows inserted by an old web instance during rollout.

alter table vy_ingest_run
  add column if not exists upload_authorization_expires_at timestamptz
  default (now()+interval '210 minutes');

update vy_ingest_run
   set upload_authorization_expires_at=now()+interval '210 minutes'
 where upload_authorization_expires_at is null;

alter table vy_video_enrollment
  add column if not exists upload_authorization_expires_at timestamptz
  default (now()+interval '210 minutes');

update vy_video_enrollment
   set upload_authorization_expires_at=now()+interval '210 minutes'
 where upload_authorization_expires_at is null;

-- This ledger is written before a capability is minted. The logical storage
-- bucket is the durable provider descriptor used by replica storage (Azure
-- locators include account and container); object_path is the exact object,
-- never a prefix. scope_id is a channel watch id in the recurring lane and a
-- video enrollment id in the one-link lane. Both use the same bounded object
-- namespace and the same erasure proof.

create table if not exists vy_channel_extraction_object (
  extraction_object_id uuid primary key,
  replica_id           uuid not null,
  owner_user_id        uuid not null,
  scope_kind           text not null
                       check (scope_kind in ('channel_watch','video_enrollment')),
  scope_id             uuid not null,
  video_id             text not null
                       check (video_id ~ '^[A-Za-z0-9_-]{11}$'),
  storage_bucket       text not null
                       check (
                         storage_bucket ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$'
                         or storage_bucket ~ '^azureblob:[a-z0-9]{3,24}:[a-z0-9]([a-z0-9-]{1,61}[a-z0-9])?$'
                       ),
  object_path          text not null
                       check (length(object_path) between 1 and 1024),
  upload_authorization_expires_at timestamptz not null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint vy_channel_extraction_object_scope_path check (
    object_path = owner_user_id::text || '/' || replica_id::text || '/' ||
      scope_id::text || '/' || video_id || '/original'
  ),
  constraint vy_channel_extraction_object_locator_unique
    unique (replica_id, storage_bucket, object_path),
  constraint vy_channel_extraction_object_owner_fk
    foreign key (replica_id, owner_user_id)
    references vy_replica(replica_id, owner_user_id) on delete cascade
);

create index if not exists vy_channel_extraction_object_owner_ix
  on vy_channel_extraction_object (owner_user_id, replica_id, created_at desc);

create index if not exists vy_channel_extraction_object_authority_ix
  on vy_channel_extraction_object (replica_id, upload_authorization_expires_at);
