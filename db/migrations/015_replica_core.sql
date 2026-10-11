-- Migration 015 — the consented human-replica core.
-- Contract: docs/SPEC-REPLICA-PLATFORM.md.
--
-- This migration stores ownership, consent capabilities, private source
-- manifests, cited claims, versioned VoiceGenomes/person profiles, calibration
-- preferences, provider handles, eval verdicts and content-free audit/deletion
-- receipts. It stores NO audio/video/image bytes and NO durable public URLs.
--
-- Every statement is independently idempotent. Neon SQL-over-HTTP accepts one
-- statement per request and db/migrations/apply.mjs has no cross-call
-- transaction, so a half-applied run is recovered by running this file again.

-- Supabase auth identities are not rows in Neon. This is the one explicit,
-- server-written bridge to the person layer. Ownership is always derived from
-- a verified auth token; request-supplied user ids are never authoritative.
create table if not exists vy_account_person (
  auth_user_id uuid primary key,
  person_id    uuid not null unique references vy_person(person_id) on delete cascade,
  created_at   timestamptz not null default now()
);

create table if not exists vy_replica (
  replica_id            uuid primary key default gen_random_uuid(),
  owner_user_id         uuid not null,
  subject_person_id     uuid references vy_person(person_id) on delete set null,
  agent_id              uuid unique references vy_agent(agent_id) on delete set null,
  display_name          text not null,
  subject_mode          text not null default 'self'
                        check (subject_mode in ('self')),
  lifecycle             text not null default 'draft'
                        check (lifecycle in (
                          'draft','consent_pending','enrolling','calibrating',
                          'ready','active','paused','revoked','purging'
                        )),
  policy_version        text not null,
  age_verified_at       timestamptz,
  identity_verified_at  timestamptz,
  liveness_verified_at  timestamptz,
  activated_at          timestamptz,
  revoked_at            timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint vy_replica_owner_pair unique (replica_id, owner_user_id)
);

create index if not exists vy_replica_owner_ix
  on vy_replica (owner_user_id, created_at desc);

create index if not exists vy_replica_agent_ix
  on vy_replica (agent_id) where agent_id is not null;

-- Consent is an append-only capability receipt. A scope is active only when
-- the server finds an unrevoked, unexpired row under the current policy. The
-- receipt stores hashes and method metadata, never an identity document.
create table if not exists vy_replica_consent (
  consent_id         uuid primary key default gen_random_uuid(),
  replica_id         uuid not null,
  owner_user_id      uuid not null,
  scope              text not null
                     check (scope in (
                       'capture','transcription','biometric','training',
                       'inference','storage','sharing','api','telephony',
                       'model_improvement'
                     )),
  method             text not null
                     check (method in ('account_attestation','live_challenge','manual_review')),
  policy_version     text not null,
  evidence_source_id uuid,
  receipt_hash       text not null,
  granted_at         timestamptz not null default now(),
  expires_at         timestamptz,
  revoked_at         timestamptz,
  metadata           jsonb not null default '{}'::jsonb,
  constraint vy_replica_consent_receipt_hash check (length(receipt_hash) >= 32),
  constraint vy_replica_consent_owner_pair unique (consent_id, replica_id, owner_user_id),
  constraint vy_replica_consent_owner_fk
    foreign key (replica_id, owner_user_id)
    references vy_replica(replica_id, owner_user_id) on delete cascade
);

create index if not exists vy_replica_consent_active_ix
  on vy_replica_consent (replica_id, scope, granted_at desc)
  where revoked_at is null;

create index if not exists vy_replica_consent_owner_ix
  on vy_replica_consent (owner_user_id, granted_at desc);

-- Original and derived artifacts share one manifest so lineage is queryable.
-- The private bucket/path is server-chosen; no public URL is persisted.
create table if not exists vy_replica_source (
  source_id              uuid primary key default gen_random_uuid(),
  replica_id             uuid not null,
  owner_user_id          uuid not null,
  consent_id             uuid,
  parent_source_id       uuid,
  kind                   text not null
                         check (kind in ('audio','video','text','image','document','chat_archive')),
  capture_mode           text not null
                         check (capture_mode in ('live_challenge','upload','import','derived')),
  storage_bucket         text not null,
  object_path            text not null,
  mime                   text not null,
  byte_size              bigint not null default 0 check (byte_size >= 0),
  duration_ms            bigint check (duration_ms is null or duration_ms >= 0),
  sha256                 text not null,
  state                  text not null default 'pending_upload'
                         check (state in (
                           'pending_upload','uploaded','quarantined','processing',
                           'ready','rejected','deleting'
                         )),
  contains_third_parties boolean not null default false,
  transform              jsonb not null default '{}'::jsonb,
  quality                jsonb not null default '{}'::jsonb,
  provenance             jsonb not null default '{}'::jsonb,
  rejection_code         text not null default '',
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint vy_replica_source_hash check (sha256 ~ '^[0-9a-f]{64}$'),
  constraint vy_replica_source_private_path check (object_path !~* '^(https?|data):'),
  constraint vy_replica_source_owner_fk
    foreign key (replica_id, owner_user_id)
    references vy_replica(replica_id, owner_user_id) on delete cascade,
  constraint vy_replica_source_consent_fk
    foreign key (consent_id, replica_id, owner_user_id)
    references vy_replica_consent(consent_id, replica_id, owner_user_id)
);

create unique index if not exists vy_replica_source_object_ix
  on vy_replica_source (storage_bucket, object_path);

create index if not exists vy_replica_source_owner_ix
  on vy_replica_source (owner_user_id, replica_id, created_at desc);

create index if not exists vy_replica_source_parent_ix
  on vy_replica_source (parent_source_id) where parent_source_id is not null;

-- A claim is never writable without evidence. `source_ids` point to immutable
-- original/derived manifests; no FK is used because source deletion must be
-- able to invalidate/rebuild claims without FK ordering or partial failure.
create table if not exists vy_replica_claim (
  claim_id       bigint generated always as identity primary key,
  replica_id     uuid not null references vy_replica(replica_id) on delete cascade,
  domain         text not null
                 check (domain in (
                   'identity','biography','event','relationship','preference',
                   'value','boundary','habit','language','delivery','visual'
                 )),
  key            text not null,
  body           text not null,
  origin         text not null
                 check (origin in ('self_declared','observed','imported','inferred')),
  confidence     real not null check (confidence >= 0 and confidence <= 1),
  status         text not null default 'proposed'
                 check (status in ('proposed','approved','rejected','superseded')),
  source_ids     uuid[] not null,
  sensitive      boolean not null default false,
  t_valid_from   timestamptz,
  t_valid_to     timestamptz,
  superseded_by  bigint,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint vy_replica_claim_cited check (cardinality(source_ids) >= 1)
);

create index if not exists vy_replica_claim_active_ix
  on vy_replica_claim (replica_id, domain, key)
  where status in ('proposed','approved');

create index if not exists vy_replica_claim_source_ix
  on vy_replica_claim using gin (source_ids);

-- Provider-neutral voice identity. `definition` contains distributions and
-- accepted private source ids; it never contains provider credentials/ids.
create table if not exists vy_replica_voice_genome (
  replica_id       uuid not null references vy_replica(replica_id) on delete cascade,
  version          integer not null check (version > 0),
  source_set_hash  text not null,
  definition       jsonb not null,
  status           text not null default 'draft'
                   check (status in ('draft','approved','retired')),
  created_at       timestamptz not null default now(),
  primary key (replica_id, version),
  constraint vy_replica_genome_hash check (length(source_set_hash) >= 32)
);

-- A disposable mapping from one VoiceGenome version to an external/local
-- provider. provider_ref is server-only and never returned to clients.
create table if not exists vy_replica_voice_profile (
  voice_profile_id uuid primary key default gen_random_uuid(),
  replica_id       uuid not null references vy_replica(replica_id) on delete cascade,
  genome_version   integer not null check (genome_version > 0),
  provider         text not null,
  model            text not null,
  provider_ref     text not null,
  capabilities     jsonb not null default '{}'::jsonb,
  status           text not null default 'creating'
                   check (status in ('creating','ready','failed','deleting')),
  failure_code     text not null default '',
  deletion_receipt jsonb,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create unique index if not exists vy_replica_voice_provider_ix
  on vy_replica_voice_profile (provider, provider_ref);

create index if not exists vy_replica_voice_ready_ix
  on vy_replica_voice_profile (replica_id, genome_version, provider)
  where status = 'ready';

-- Versioned structured person model. The runtime compiler renders bounded
-- views from this record; this JSON is not itself a system prompt.
create table if not exists vy_replica_profile (
  replica_id       uuid not null references vy_replica(replica_id) on delete cascade,
  version          integer not null check (version > 0),
  source_set_hash  text not null,
  definition       jsonb not null,
  status           text not null default 'draft'
                   check (status in ('draft','approved','retired')),
  created_at       timestamptz not null default now(),
  primary key (replica_id, version),
  constraint vy_replica_profile_hash check (length(source_set_hash) >= 32)
);

-- Human calibration is stored as layer-labelled preference evidence, never as
-- another sentence appended to the persona prompt.
create table if not exists vy_replica_preference (
  preference_id uuid primary key default gen_random_uuid(),
  replica_id    uuid not null references vy_replica(replica_id) on delete cascade,
  layer         text not null
                check (layer in ('voice','delivery','language','behaviour','memory','relationship','visual')),
  scenario_id   text not null,
  left_ref      jsonb not null,
  right_ref     jsonb not null,
  choice        text not null check (choice in ('left','right','tie','neither')),
  note          text not null default '',
  created_at    timestamptz not null default now()
);

create index if not exists vy_replica_preference_layer_ix
  on vy_replica_preference (replica_id, layer, created_at desc);

create table if not exists vy_replica_eval_run (
  eval_id          uuid primary key default gen_random_uuid(),
  replica_id       uuid not null references vy_replica(replica_id) on delete cascade,
  profile_version  integer,
  genome_version   integer,
  suite            text not null,
  candidate        text not null,
  corpus_hash      text not null,
  metrics          jsonb not null,
  verdict          text not null check (verdict in ('pass','fail','inconclusive')),
  created_at       timestamptz not null default now(),
  constraint vy_replica_eval_corpus_hash check (length(corpus_hash) >= 32)
);

create index if not exists vy_replica_eval_latest_ix
  on vy_replica_eval_run (replica_id, suite, created_at desc);

-- Content-free operational ledger. Never copy prompt, memory, transcript,
-- source URL, provider secret or generated audio into this table.
create table if not exists vy_replica_audit (
  id            bigint generated always as identity primary key,
  replica_id    uuid,
  owner_user_id uuid not null,
  action        text not null,
  object_kind   text not null,
  object_id     text not null default '',
  trace_id      text not null default '',
  policy        text not null,
  outcome       text not null check (outcome in ('allowed','denied','failed')),
  facts         jsonb not null default '{}'::jsonb,
  at            timestamptz not null default now()
);

create index if not exists vy_replica_audit_owner_ix
  on vy_replica_audit (owner_user_id, at desc);

create index if not exists vy_replica_audit_replica_ix
  on vy_replica_audit (replica_id, at desc) where replica_id is not null;

-- Revocation is synchronous; physical erasure is a retryable job. The unique
-- replica key makes enqueue idempotent and lets a sweeper recover a replica
-- that was disabled just before a serverless invocation stopped.
create table if not exists vy_replica_erasure_job (
  job_id           uuid primary key default gen_random_uuid(),
  replica_id       uuid not null unique references vy_replica(replica_id) on delete cascade,
  owner_user_id    uuid not null,
  state            text not null default 'pending'
                   check (state in ('pending','running','blocked','complete')),
  attempts         integer not null default 0 check (attempts >= 0),
  provider_status  jsonb not null default '{}'::jsonb,
  storage_status   jsonb not null default '{}'::jsonb,
  last_error_code  text not null default '',
  requested_at     timestamptz not null default now(),
  started_at       timestamptz,
  completed_at     timestamptz,
  updated_at       timestamptz not null default now(),
  constraint vy_replica_erasure_owner_fk
    foreign key (replica_id, owner_user_id)
    references vy_replica(replica_id, owner_user_id) on delete cascade
);

create index if not exists vy_replica_erasure_pending_ix
  on vy_replica_erasure_job (state, requested_at)
  where state in ('pending','blocked');

-- Survives content deletion only as a non-reconstructive compliance receipt.
create table if not exists vy_replica_deletion_receipt (
  receipt_id       uuid primary key default gen_random_uuid(),
  replica_id_hash  text not null,
  owner_user_hash  text not null,
  policy_version   text not null,
  reason           text not null,
  deleted_classes  text[] not null,
  processor_status jsonb not null default '{}'::jsonb,
  backup_expires_at timestamptz,
  completed_at     timestamptz not null default now(),
  constraint vy_replica_delete_replica_hash check (length(replica_id_hash) >= 32),
  constraint vy_replica_delete_owner_hash check (length(owner_user_hash) >= 32)
);
