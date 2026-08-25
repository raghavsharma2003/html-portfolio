-- Migration 020 - make owner evidence decisions tenant-bound and VoiceGenome
-- queueing idempotent. Existing 017 rows are backfilled from immutable
-- evidence before the new columns become mandatory.

alter table vy_replica_processing_evidence_decision add column if not exists replica_id uuid;
alter table vy_replica_processing_evidence_decision add column if not exists owner_user_id uuid;

update vy_replica_processing_evidence_decision d
   set replica_id = e.replica_id,
       owner_user_id = e.owner_user_id
  from vy_replica_processing_evidence e
 where e.evidence_id = d.evidence_id
   and (d.replica_id is null or d.owner_user_id is null);

alter table vy_replica_processing_evidence_decision alter column replica_id set not null;
alter table vy_replica_processing_evidence_decision alter column owner_user_id set not null;

create unique index if not exists vy_replica_evidence_owner_tuple_ix
  on vy_replica_processing_evidence (evidence_id, replica_id, owner_user_id);

do $replica_evidence_decision_owner_fk$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'vy_replica_evidence_decision_owner_fk'
       and conrelid = 'vy_replica_processing_evidence_decision'::regclass
  ) then
    alter table vy_replica_processing_evidence_decision
      add constraint vy_replica_evidence_decision_owner_fk
      foreign key (evidence_id, replica_id, owner_user_id)
      references vy_replica_processing_evidence(evidence_id, replica_id, owner_user_id)
      on delete cascade;
  end if;
end;
$replica_evidence_decision_owner_fk$;

do $replica_evidence_decision_reviewer_check$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'vy_replica_evidence_decision_reviewer_check'
       and conrelid = 'vy_replica_processing_evidence_decision'::regclass
  ) then
    alter table vy_replica_processing_evidence_decision
      add constraint vy_replica_evidence_decision_reviewer_check
      check (reviewer_user_id = owner_user_id);
  end if;
end;
$replica_evidence_decision_reviewer_check$;

create index if not exists vy_replica_evidence_decision_owner_ix
  on vy_replica_processing_evidence_decision
    (replica_id, owner_user_id, evidence_id, created_at desc);

create unique index if not exists vy_replica_model_build_source_set_ix
  on vy_replica_model_build (replica_id, build_kind, source_set_hash);
