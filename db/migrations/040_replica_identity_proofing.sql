-- Migration 040 - consented identity evidence and non-circular liveness binding.
-- Raw identity documents enter the private source vault only for verification
-- and are erased after a successful live binding. This ledger stores only
-- bounded decisions, hashes, leases and expiry metadata.

alter table vy_replica
  add column if not exists identity_expires_at timestamptz;

alter table vy_replica_source
  drop constraint if exists vy_replica_source_capture_mode_check,
  add constraint vy_replica_source_capture_mode_check
    check (capture_mode in ('live_challenge','provider_consent','identity_document','upload','import','derived'));

create table if not exists vy_replica_identity_case (
  identity_case_id       uuid primary key default gen_random_uuid(),
  replica_id             uuid not null,
  owner_user_id          uuid not null,
  source_id              uuid,
  policy_version         text not null,
  consent_receipt_hash   text not null check (consent_receipt_hash ~ '^[0-9a-f]{64}$'),
  state                   text not null default 'submitted'
                          check (state in ('submitted','verifying','evidence_ready','verified','expired','failed','revoked')),
  attempt                 integer not null default 0 check (attempt >= 0),
  next_attempt_at         timestamptz not null default now(),
  lease_token_hash        text not null default ''
                          check (lease_token_hash='' or lease_token_hash ~ '^[0-9a-f]{64}$'),
  leased_at               timestamptz,
  lease_expires_at        timestamptz,
  verifier                text not null default '',
  verifier_version        text not null default '',
  source_sha256           text not null check (source_sha256 ~ '^[0-9a-f]{64}$'),
  adult_evidence          boolean not null default false,
  document_authentic      boolean not null default false,
  document_current        boolean not null default false,
  face_reference_ready    boolean not null default false,
  credential_expires_at   timestamptz,
  evidence_digest         text not null default ''
                          check (evidence_digest='' or evidence_digest ~ '^[0-9a-f]{64}$'),
  result                   jsonb not null default '{}'::jsonb check (jsonb_typeof(result)='object'),
  failure_code            text not null default '',
  consented_at            timestamptz not null,
  verified_at             timestamptz,
  revoked_at              timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  constraint vy_replica_identity_case_owner_identity
    unique (identity_case_id,replica_id,owner_user_id),
  constraint vy_replica_identity_case_owner_fk
    foreign key (replica_id,owner_user_id)
    references vy_replica(replica_id,owner_user_id) on delete cascade,
  constraint vy_replica_identity_case_source_fk
    foreign key (source_id,replica_id,owner_user_id)
    references vy_replica_source(source_id,replica_id,owner_user_id) on delete restrict
);

create index if not exists vy_replica_identity_case_owner_ix
  on vy_replica_identity_case (owner_user_id,replica_id,created_at desc);

create unique index if not exists vy_replica_identity_case_live_ix
  on vy_replica_identity_case (replica_id)
  where state in ('submitted','verifying','evidence_ready','verified');

create index if not exists vy_replica_identity_case_ready_ix
  on vy_replica_identity_case (next_attempt_at,updated_at)
  where state in ('submitted','verifying');

create table if not exists vy_replica_identity_verification_attempt (
  identity_case_id       uuid not null,
  replica_id             uuid not null,
  owner_user_id          uuid not null,
  attempt                 integer not null check (attempt > 0),
  verifier                text not null,
  verifier_version        text not null,
  outcome                 text not null check (outcome in ('running','retry','evidence_ready','failed')),
  failure_code            text not null default '',
  result                   jsonb not null default '{}'::jsonb check (jsonb_typeof(result)='object'),
  started_at               timestamptz not null default now(),
  finished_at              timestamptz,
  primary key (identity_case_id,attempt),
  constraint vy_replica_identity_attempt_owner_fk
    foreign key (identity_case_id,replica_id,owner_user_id)
    references vy_replica_identity_case(identity_case_id,replica_id,owner_user_id) on delete cascade
);

create index if not exists vy_replica_identity_attempt_owner_ix
  on vy_replica_identity_verification_attempt (owner_user_id,replica_id,started_at desc);

alter table vy_replica_liveness_challenge
  add column if not exists identity_case_id uuid;

do $replica_liveness_identity_fk$
begin
  if not exists (
    select 1 from pg_constraint where conname='vy_replica_liveness_identity_case_fk'
      and conrelid='vy_replica_liveness_challenge'::regclass
  ) then
    alter table vy_replica_liveness_challenge add constraint vy_replica_liveness_identity_case_fk
      foreign key (identity_case_id,replica_id,owner_user_id)
      references vy_replica_identity_case(identity_case_id,replica_id,owner_user_id) on delete cascade;
  end if;
end;
$replica_liveness_identity_fk$;

create index if not exists vy_replica_liveness_identity_case_ix
  on vy_replica_liveness_challenge (identity_case_id)
  where identity_case_id is not null;
