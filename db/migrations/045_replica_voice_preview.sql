-- Migration 045 - protected owner-only VoiceGenome preview corridor.
-- Draft previews deliberately share the immutable public generation receipt
-- ledger, but they do not mint a runtime capability or masquerade as an
-- approved provider voice/person/calibration tuple.

alter table vy_replica_generation alter column voice_profile_id drop not null;
alter table vy_replica_generation alter column profile_version drop not null;
alter table vy_replica_generation alter column calibration_version drop not null;
alter table vy_replica_generation add column if not exists preview_artifact_id uuid;
alter table vy_replica_generation add column if not exists preview_model text not null default '';
alter table vy_replica_generation add column if not exists preview_model_commitment text not null default '';

alter table vy_replica_generation drop constraint if exists vy_replica_generation_purpose_check;
alter table vy_replica_generation add constraint vy_replica_generation_purpose_check
  check (purpose in ('voice_preview','calibration','private_conversation'));

do $replica_voice_preview_constraints$
begin
  if not exists (
    select 1 from pg_constraint where conname='vy_replica_generation_preview_artifact_fk'
      and conrelid='vy_replica_generation'::regclass
  ) then
    alter table vy_replica_generation add constraint vy_replica_generation_preview_artifact_fk
      foreign key (preview_artifact_id,replica_id,owner_user_id)
      references vy_replica_processing_artifact(artifact_id,replica_id,owner_user_id) on delete restrict;
  end if;
  if not exists (
    select 1 from pg_constraint where conname='vy_replica_generation_preview_shape'
      and conrelid='vy_replica_generation'::regclass
  ) then
    alter table vy_replica_generation add constraint vy_replica_generation_preview_shape check (
      (
        purpose='voice_preview' and channel='studio_preview' and dialogue_turn_id is null
        and voice_profile_id is null and profile_version is null and calibration_version is null
        and preview_artifact_id is not null and preview_model<>''
        and preview_model_commitment~'^[0-9a-f]{64}$'
      ) or (
        purpose in ('calibration','private_conversation')
        and voice_profile_id is not null and profile_version is not null and calibration_version is not null
        and preview_artifact_id is null and preview_model='' and preview_model_commitment=''
      )
    );
  end if;
end;
$replica_voice_preview_constraints$;

create index if not exists vy_replica_generation_preview_open_ix
  on vy_replica_generation (owner_user_id,replica_id,authorized_at)
  where purpose='voice_preview' and state in ('authorized','streaming');
