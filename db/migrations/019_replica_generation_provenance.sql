-- Migration 019 - protected replica generation and public verification.
--
-- The operational row is tenant-bound and is erased with the replica. The
-- public receipt deliberately survives erasure, but contains only random ids,
-- commitments, hashes, algorithms and signatures. It contains no owner id,
-- replica id, prompt, transcript, memory, audio bytes, provider reference or
-- private object path.

create unique index if not exists vy_replica_voice_profile_replica_ix
  on vy_replica_voice_profile (voice_profile_id, replica_id, genome_version);

create table if not exists vy_replica_generation (
  generation_id         uuid primary key default gen_random_uuid(),
  replica_id            uuid not null,
  owner_user_id         uuid not null,
  voice_profile_id      uuid not null,
  genome_version        integer not null check (genome_version > 0),
  profile_version       integer not null check (profile_version > 0),
  channel               text not null
                        check (channel in ('studio_preview','private_chat','private_call')),
  purpose               text not null
                        check (purpose in ('calibration','private_conversation')),
  policy_version        text not null,
  trace_id              text not null,
  state                 text not null default 'authorized'
                        check (state in ('authorized','streaming','sealed','aborted','failed')),
  disclosure_scheme     text not null,
  watermark_algorithm   text not null,
  provenance_standard   text not null,
  audio_sha256          text,
  watermark_token_hash  text,
  manifest_sha256       text,
  ledger_envelope_hash  text,
  segment_count         integer not null default 0 check (segment_count >= 0),
  final_chain_sha256    text,
  failure_code          text not null default '',
  authorized_at         timestamptz not null default now(),
  streaming_at          timestamptz,
  sealed_at             timestamptz,
  updated_at            timestamptz not null default now(),
  constraint vy_replica_generation_owner_fk
    foreign key (replica_id, owner_user_id)
    references vy_replica(replica_id, owner_user_id) on delete cascade,
  constraint vy_replica_generation_voice_fk
    foreign key (voice_profile_id, replica_id, genome_version)
    references vy_replica_voice_profile(voice_profile_id, replica_id, genome_version),
  constraint vy_replica_generation_genome_fk
    foreign key (replica_id, genome_version)
    references vy_replica_voice_genome(replica_id, version),
  constraint vy_replica_generation_profile_fk
    foreign key (replica_id, profile_version)
    references vy_replica_profile(replica_id, version),
  constraint vy_replica_generation_audio_hash
    check (audio_sha256 is null or audio_sha256 ~ '^[0-9a-f]{64}$'),
  constraint vy_replica_generation_watermark_hash
    check (watermark_token_hash is null or watermark_token_hash ~ '^[0-9a-f]{64}$'),
  constraint vy_replica_generation_manifest_hash
    check (manifest_sha256 is null or manifest_sha256 ~ '^[0-9a-f]{64}$'),
  constraint vy_replica_generation_envelope_hash
    check (ledger_envelope_hash is null or ledger_envelope_hash ~ '^[0-9a-f]{64}$'),
  constraint vy_replica_generation_chain_hash
    check (final_chain_sha256 is null or final_chain_sha256 ~ '^[0-9a-f]{64}$')
);

create index if not exists vy_replica_generation_owner_ix
  on vy_replica_generation (owner_user_id, replica_id, authorized_at desc);

create index if not exists vy_replica_generation_open_ix
  on vy_replica_generation (state, authorized_at)
  where state in ('authorized','streaming');

-- An immutable, content-free public verification receipt. There is no FK to
-- vy_replica_generation so replica erasure cannot destroy authenticity proof
-- for media that already left the service.
create table if not exists vy_replica_generation_receipt (
  generation_id          uuid primary key,
  replica_commitment     text not null,
  policy_version         text not null,
  channel                text not null
                         check (channel in ('studio_preview','private_chat','private_call')),
  disclosure_scheme      text not null,
  disclosure_text_hash   text not null,
  watermark_algorithm    text not null,
  watermark_token_hash   text not null,
  detector_policy_hash   text not null,
  provenance_standard    text not null,
  manifest_location      text not null check (manifest_location in ('embedded','external')),
  manifest_sha256        text not null,
  audio_sha256           text not null,
  segment_count          integer not null check (segment_count > 0),
  final_chain_sha256     text not null,
  envelope_sha256        text not null,
  signature_algorithm    text not null,
  signer_key_id          text not null,
  envelope_signature     text not null,
  issued_at              timestamptz not null default now(),
  constraint vy_replica_receipt_replica_hash check (replica_commitment ~ '^[0-9a-f]{64}$'),
  constraint vy_replica_receipt_disclosure_hash check (disclosure_text_hash ~ '^[0-9a-f]{64}$'),
  constraint vy_replica_receipt_watermark_hash check (watermark_token_hash ~ '^[0-9a-f]{64}$'),
  constraint vy_replica_receipt_detector_hash check (detector_policy_hash ~ '^[0-9a-f]{64}$'),
  constraint vy_replica_receipt_manifest_hash check (manifest_sha256 ~ '^[0-9a-f]{64}$'),
  constraint vy_replica_receipt_audio_hash check (audio_sha256 ~ '^[0-9a-f]{64}$'),
  constraint vy_replica_receipt_chain_hash check (final_chain_sha256 ~ '^[0-9a-f]{64}$'),
  constraint vy_replica_receipt_envelope_hash check (envelope_sha256 ~ '^[0-9a-f]{64}$'),
  constraint vy_replica_receipt_signature check (length(envelope_signature) >= 32)
);

create index if not exists vy_replica_generation_receipt_issued_ix
  on vy_replica_generation_receipt (issued_at desc);

-- Each protected PCM segment is committed and signed before that segment is
-- released to a real-time consumer. These receipts remain verifiable after an
-- abort or final-manifest failure and deliberately carry no replica/owner FK.
create table if not exists vy_replica_generation_segment_receipt (
  generation_id       uuid not null,
  sequence            integer not null check (sequence >= 0),
  byte_offset         bigint not null check (byte_offset >= 0),
  byte_length         integer not null check (byte_length > 0),
  segment_sha256      text not null,
  previous_chain_sha256 text not null,
  chain_sha256        text not null,
  signature_algorithm text not null,
  signer_key_id       text not null,
  chain_signature     text not null,
  issued_at           timestamptz not null default now(),
  primary key (generation_id, sequence),
  constraint vy_replica_segment_hash check (segment_sha256 ~ '^[0-9a-f]{64}$'),
  constraint vy_replica_segment_previous_hash check (previous_chain_sha256 ~ '^[0-9a-f]{64}$'),
  constraint vy_replica_segment_chain_hash check (chain_sha256 ~ '^[0-9a-f]{64}$'),
  constraint vy_replica_segment_signature check (length(chain_signature) >= 32)
);

create index if not exists vy_replica_generation_segment_issued_ix
  on vy_replica_generation_segment_receipt (issued_at desc);
