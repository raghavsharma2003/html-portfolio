-- Migration 069 - durable nearline claim extraction for canonical evidence.
--
-- The call request never invokes a claim model. Canonical transcript evidence
-- only appends a content-free queue item. A CRON_SECRET worker later leases one
-- replica queue, extracts cited proposals, and leaves every proposal pending
-- explicit owner review.

alter table vy_replica_claim_extraction
  add column if not exists lease_token_hash text not null default '';

alter table vy_replica_claim_extraction
  add column if not exists leased_at timestamptz;

alter table vy_replica_claim_extraction
  add column if not exists lease_expires_at timestamptz;

alter table vy_replica_claim_extraction
  drop constraint if exists vy_replica_claim_extraction_lease_shape;

alter table vy_replica_claim_extraction
  add constraint vy_replica_claim_extraction_lease_shape check (
    (state='extracting' and (
      (lease_token_hash='' and leased_at is null and lease_expires_at is null)
      or
      (lease_token_hash ~ '^[0-9a-f]{64}$' and leased_at is not null
        and lease_expires_at is not null and lease_expires_at>leased_at)
    ))
    or
    (state<>'extracting' and lease_token_hash='' and leased_at is null and lease_expires_at is null)
  );

create table if not exists vy_replica_claim_extraction_input (
  run_id          uuid not null,
  replica_id      uuid not null,
  owner_user_id   uuid not null,
  evidence_id     uuid not null,
  source_id       uuid not null,
  created_at      timestamptz not null default now(),
  primary key (run_id,evidence_id),
  constraint vy_replica_claim_extraction_input_run_fk
    foreign key (run_id,replica_id,owner_user_id)
    references vy_replica_claim_extraction(run_id,replica_id,owner_user_id) on delete cascade,
  constraint vy_replica_claim_extraction_input_evidence_fk
    foreign key (evidence_id,replica_id,owner_user_id)
    references vy_replica_processing_evidence(evidence_id,replica_id,owner_user_id) on delete cascade,
  constraint vy_replica_claim_extraction_input_source_fk
    foreign key (source_id,replica_id,owner_user_id)
    references vy_replica_source(source_id,replica_id,owner_user_id) on delete cascade
);

create index if not exists vy_replica_claim_extraction_input_evidence_ix
  on vy_replica_claim_extraction_input (owner_user_id,replica_id,evidence_id);

create table if not exists vy_replica_claim_extraction_queue (
  job_id             uuid primary key default gen_random_uuid(),
  replica_id         uuid not null,
  owner_user_id      uuid not null,
  state              text not null default 'queued'
                     check (state in ('queued','running','waiting','complete')),
  attempt            integer not null default 0 check (attempt>=0),
  next_attempt_at    timestamptz not null default now(),
  lease_token_hash   text not null default '',
  leased_at          timestamptz,
  lease_expires_at   timestamptz,
  last_error_code    text not null default '',
  created_at         timestamptz not null default now(),
  completed_at       timestamptz,
  updated_at         timestamptz not null default now(),
  constraint vy_replica_claim_extraction_queue_owner_fk
    foreign key (replica_id,owner_user_id)
    references vy_replica(replica_id,owner_user_id) on delete cascade,
  constraint vy_replica_claim_extraction_queue_owner_unique
    unique (replica_id,owner_user_id),
  constraint vy_replica_claim_extraction_queue_owner_tuple
    unique (job_id,replica_id,owner_user_id),
  constraint vy_replica_claim_extraction_queue_lease_shape check (
    (state='running' and lease_token_hash ~ '^[0-9a-f]{64}$'
      and leased_at is not null and lease_expires_at is not null
      and lease_expires_at>leased_at and completed_at is null)
    or
    (state<>'running' and lease_token_hash='' and leased_at is null and lease_expires_at is null)
  ),
  constraint vy_replica_claim_extraction_queue_waiting_reason check (
    state<>'waiting' or last_error_code<>''
  ),
  constraint vy_replica_claim_extraction_queue_complete_shape check (
    (state='complete' and completed_at is not null)
    or
    (state<>'complete' and completed_at is null)
  )
);

create index if not exists vy_replica_claim_extraction_queue_due_ix
  on vy_replica_claim_extraction_queue (next_attempt_at,created_at)
  where state in ('queued','waiting','running');

create table if not exists vy_replica_claim_extraction_queue_item (
  job_id          uuid not null,
  replica_id      uuid not null,
  owner_user_id   uuid not null,
  evidence_id     uuid not null,
  source_id       uuid not null,
  state           text not null default 'pending' check (state in ('pending','complete')),
  created_at      timestamptz not null default now(),
  completed_at    timestamptz,
  primary key (job_id,evidence_id),
  constraint vy_replica_claim_extraction_queue_item_evidence_unique unique (evidence_id),
  constraint vy_replica_claim_extraction_queue_item_job_fk
    foreign key (job_id,replica_id,owner_user_id)
    references vy_replica_claim_extraction_queue(job_id,replica_id,owner_user_id) on delete cascade,
  constraint vy_replica_claim_extraction_queue_item_evidence_fk
    foreign key (evidence_id,replica_id,owner_user_id)
    references vy_replica_processing_evidence(evidence_id,replica_id,owner_user_id) on delete cascade,
  constraint vy_replica_claim_extraction_queue_item_source_fk
    foreign key (source_id,replica_id,owner_user_id)
    references vy_replica_source(source_id,replica_id,owner_user_id) on delete cascade,
  constraint vy_replica_claim_extraction_queue_item_complete_shape check (
    (state='complete' and completed_at is not null)
    or
    (state='pending' and completed_at is null)
  )
);

create index if not exists vy_replica_claim_extraction_queue_item_pending_ix
  on vy_replica_claim_extraction_queue_item (job_id,created_at,evidence_id)
  where state='pending';
