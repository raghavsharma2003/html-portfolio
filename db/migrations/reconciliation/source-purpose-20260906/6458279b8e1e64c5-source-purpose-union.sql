-- Integration candidate only. Not applied or catalog-verified.
-- Preserve every known source purpose from Rooms and the local clone lineage.
-- Before execution, inspect pg_constraint and distinct purpose values on the
-- intended database; any value or CHECK beyond this set requires review.
-- One atomic statement: no window without the constraint.
alter table vy_replica_source
  drop constraint if exists vy_replica_source_purpose_check,
  add constraint vy_replica_source_purpose_check
    check (purpose in ('memory','identity_document','identity_challenge','correction','interview','mirror_window','context_item'));
