-- Migration 016 — live enrollment challenges and retryable evidence jobs.
-- One statement per apply call, every statement independently idempotent.

create table if not exists vy_replica_liveness_challenge (
  challenge_id      uuid primary key default gen_random_uuid(),
  replica_id         uuid not null,
  owner_user_id      uuid not null,
  phrase             text not null,
  phrase_hash        text not null,
  policy_version     text not null,
  state              text not null default 'issued'
                     check (state in ('issued','uploaded','verifying','passed','failed','expired')),
  source_id          uuid references vy_replica_source(source_id) on delete set null,
  attempt            integer not null default 1 check (attempt > 0 and attempt <= 10),
  verifier           text not null default '',
  verifier_result    jsonb not null default '{}'::jsonb,
  failure_code       text not null default '',
  issued_at          timestamptz not null default now(),
  expires_at         timestamptz not null,
  consumed_at        timestamptz,
  updated_at         timestamptz not null default now(),
  constraint vy_replica_challenge_phrase_hash check (phrase_hash ~ '^[0-9a-f]{64}$'),
  constraint vy_replica_challenge_owner_fk
    foreign key (replica_id, owner_user_id)
    references vy_replica(replica_id, owner_user_id) on delete cascade
);

create index if not exists vy_replica_challenge_owner_ix
  on vy_replica_liveness_challenge (owner_user_id, replica_id, issued_at desc);

create unique index if not exists vy_replica_challenge_live_ix
  on vy_replica_liveness_challenge (replica_id)
  where state in ('issued','uploaded','verifying');

create table if not exists vy_replica_processing_job (
  job_id             uuid primary key default gen_random_uuid(),
  replica_id         uuid not null,
  owner_user_id      uuid not null,
  source_id          uuid not null references vy_replica_source(source_id) on delete cascade,
  step               text not null
                     check (step in (
                       'integrity','malware_scan','media_probe','diarize',
                       'separate','enhance','transcribe','pii_scan',
                       'third_party_scan','extract','voice_quality','visual_quality'
                     )),
  revision           integer not null default 1 check (revision > 0),
  state              text not null default 'queued'
                     check (state in ('queued','leased','retry','blocked','complete','failed')),
  attempt            integer not null default 0 check (attempt >= 0),
  lease_token_hash   text not null default '',
  leased_at          timestamptz,
  lease_expires_at   timestamptz,
  next_attempt_at    timestamptz not null default now(),
  result             jsonb not null default '{}'::jsonb,
  failure_code       text not null default '',
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint vy_replica_processing_owner_fk
    foreign key (replica_id, owner_user_id)
    references vy_replica(replica_id, owner_user_id) on delete cascade,
  constraint vy_replica_processing_unique unique (source_id, step, revision)
);

create index if not exists vy_replica_processing_queue_ix
  on vy_replica_processing_job (state, next_attempt_at, created_at)
  where state in ('queued','retry');

create index if not exists vy_replica_processing_source_ix
  on vy_replica_processing_job (replica_id, source_id, created_at);

