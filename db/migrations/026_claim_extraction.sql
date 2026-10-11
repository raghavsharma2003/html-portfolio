-- Migration 026 - cited, privacy-bounded claim extraction.
--
-- Extraction runs are content-free operational records. Proposed claims cite
-- immutable transcript evidence through exact character spans and quote
-- hashes; raw quotes remain in the private evidence row and never enter this
-- lineage table.

create table if not exists vy_replica_claim_extraction (
  run_id             uuid primary key default gen_random_uuid(),
  replica_id         uuid not null,
  owner_user_id      uuid not null,
  schema_version     text not null,
  provider_family    text not null,
  provider_name      text not null,
  provider_version   text not null,
  model              text not null,
  input_set_hash     text not null,
  consent_ids        uuid[] not null,
  state              text not null default 'extracting'
                     check (state in ('extracting','complete','failed','superseded')),
  proposed_count     integer not null default 0 check (proposed_count >= 0),
  rejected_count     integer not null default 0 check (rejected_count >= 0),
  attempt            integer not null default 1 check (attempt > 0),
  failure_code       text not null default '',
  created_at         timestamptz not null default now(),
  completed_at       timestamptz,
  updated_at         timestamptz not null default now(),
  constraint vy_replica_claim_extraction_owner_fk
    foreign key (replica_id,owner_user_id)
    references vy_replica(replica_id,owner_user_id) on delete cascade,
  constraint vy_replica_claim_extraction_input_hash
    check (input_set_hash ~ '^[0-9a-f]{64}$'),
  constraint vy_replica_claim_extraction_consent_check
    check (cardinality(consent_ids) >= 2),
  constraint vy_replica_claim_extraction_owner_tuple
    unique (run_id,replica_id,owner_user_id)
);

create unique index if not exists vy_replica_claim_extraction_input_ix
  on vy_replica_claim_extraction (replica_id,owner_user_id,schema_version,provider_name,provider_version,model,input_set_hash);

create index if not exists vy_replica_claim_extraction_owner_ix
  on vy_replica_claim_extraction (owner_user_id,replica_id,created_at desc);

alter table vy_replica_claim add column if not exists proposal_hash text;
alter table vy_replica_claim add column if not exists extractor_run_id uuid;

create unique index if not exists vy_replica_claim_proposal_ix
  on vy_replica_claim (replica_id,owner_user_id,proposal_hash)
  where proposal_hash is not null;

do $replica_claim_extractor_constraints$
begin
  if not exists (select 1 from pg_constraint where conname='vy_replica_claim_proposal_hash_check') then
    alter table vy_replica_claim add constraint vy_replica_claim_proposal_hash_check
      check (proposal_hash is null or proposal_hash ~ '^[0-9a-f]{64}$');
  end if;
  if not exists (select 1 from pg_constraint where conname='vy_replica_claim_extractor_run_fk') then
    alter table vy_replica_claim add constraint vy_replica_claim_extractor_run_fk
      foreign key (extractor_run_id,replica_id,owner_user_id)
      references vy_replica_claim_extraction(run_id,replica_id,owner_user_id) on delete restrict;
  end if;
end;
$replica_claim_extractor_constraints$;

create table if not exists vy_replica_claim_citation (
  claim_id          bigint not null,
  replica_id        uuid not null,
  owner_user_id     uuid not null,
  evidence_id       uuid not null,
  source_id         uuid not null,
  start_char        integer not null check (start_char >= 0),
  end_char          integer not null check (end_char > start_char),
  quote_hash        text not null,
  entailment        double precision not null check (entailment >= 0 and entailment <= 1),
  created_at        timestamptz not null default now(),
  primary key (claim_id,evidence_id,start_char,end_char),
  constraint vy_replica_claim_citation_quote_hash check (quote_hash ~ '^[0-9a-f]{64}$'),
  constraint vy_replica_claim_citation_claim_fk
    foreign key (claim_id,replica_id,owner_user_id)
    references vy_replica_claim(claim_id,replica_id,owner_user_id) on delete cascade,
  constraint vy_replica_claim_citation_evidence_fk
    foreign key (evidence_id,replica_id,owner_user_id)
    references vy_replica_processing_evidence(evidence_id,replica_id,owner_user_id) on delete cascade,
  constraint vy_replica_claim_citation_source_fk
    foreign key (source_id,replica_id,owner_user_id)
    references vy_replica_source(source_id,replica_id,owner_user_id) on delete cascade
);

create index if not exists vy_replica_claim_citation_source_ix
  on vy_replica_claim_citation (owner_user_id,replica_id,source_id,evidence_id);
