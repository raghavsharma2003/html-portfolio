-- Migration 070 - Context Locker sources and canonical text/image evidence.
--
-- Existing locker rows remain valid with source_id null. New privately retained
-- files may link to the existing source authority and emit immutable evidence.
-- No OCR, visual assertion or claim is introduced by this migration.

alter table vy_replica_processing_evidence
  drop constraint if exists vy_replica_processing_evidence_evidence_type_check;

alter table vy_replica_processing_evidence
  add constraint vy_replica_processing_evidence_evidence_type_check check (
    evidence_type in (
      'media_probe','speaker_segment','transcript_span','language_span',
      'voice_embedding','voice_measurement','quality_measurement',
      'text_span','image_region'
    )
  );

alter table vy_context_item
  add column if not exists source_id uuid;

create unique index if not exists vy_context_item_owner_tuple_ix
  on vy_context_item (item_id, replica_id, owner_user_id);

create unique index if not exists vy_context_item_source_ix
  on vy_context_item (source_id)
  where source_id is not null;

alter table vy_context_item
  drop constraint if exists vy_context_item_source_fk;

alter table vy_context_item
  add constraint vy_context_item_source_fk
    foreign key (source_id, replica_id, owner_user_id)
    references vy_replica_source(source_id, replica_id, owner_user_id)
    on delete cascade;

alter table vy_context_item_text
  drop constraint if exists vy_context_item_text_item_fk;

alter table vy_context_item_text
  add constraint vy_context_item_text_item_fk
    foreign key (item_id, replica_id, owner_user_id)
    references vy_context_item(item_id, replica_id, owner_user_id)
    on delete cascade;
