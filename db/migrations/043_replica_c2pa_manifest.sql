-- Migration 043 - content-free external C2PA sidecars survive private erasure.

create table if not exists vy_replica_c2pa_manifest (
  generation_id    uuid primary key,
  standard         text not null check (standard = 'c2pa-2.4'),
  manifest_sha256  text not null check (manifest_sha256 ~ '^[0-9a-f]{64}$'),
  manifest_bytes   bytea not null,
  signer_key_id    text not null,
  created_at       timestamptz not null default now(),
  constraint vy_replica_c2pa_manifest_size check (
    octet_length(manifest_bytes) between 64 and 1048576
  )
);

create index if not exists vy_replica_c2pa_manifest_created_ix
  on vy_replica_c2pa_manifest (created_at desc);

-- The exact canonical bytes covered by the public receipt signature. Storing
-- only envelope_sha256 would make independent signature verification
-- impossible because several signed proof fields are intentionally not
-- flattened into vy_replica_generation_receipt.
create table if not exists vy_replica_generation_receipt_envelope (
  generation_id      uuid primary key,
  envelope_sha256    text not null check (envelope_sha256 ~ '^[0-9a-f]{64}$'),
  envelope_canonical bytea not null,
  created_at         timestamptz not null default now(),
  constraint vy_replica_receipt_envelope_size check (
    octet_length(envelope_canonical) between 128 and 16384
  )
);

create index if not exists vy_replica_receipt_envelope_created_ix
  on vy_replica_generation_receipt_envelope (created_at desc);
