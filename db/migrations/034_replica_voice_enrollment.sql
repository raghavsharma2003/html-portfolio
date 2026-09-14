-- Migration 034 - tenant-bound, commitment-bound provider voice enrollment.

alter table vy_replica_voice_profile add column if not exists owner_user_id uuid;

update vy_replica_voice_profile vp set owner_user_id = r.owner_user_id
  from vy_replica r where r.replica_id = vp.replica_id and vp.owner_user_id is null;

alter table vy_replica_voice_profile alter column owner_user_id set not null;

alter table vy_replica_voice_profile add column if not exists provider_consent_id uuid;

alter table vy_replica_voice_profile
  add column if not exists enrollment_commitment text not null default '';

do $replica_voice_profile_owner_fk$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'vy_replica_voice_profile_owner_fk'
      and conrelid = 'vy_replica_voice_profile'::regclass
  ) then
    alter table vy_replica_voice_profile add constraint vy_replica_voice_profile_owner_fk
      foreign key (replica_id, owner_user_id)
      references vy_replica(replica_id, owner_user_id) on delete cascade;
  end if;
end;
$replica_voice_profile_owner_fk$;

do $replica_voice_profile_genome_fk$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'vy_replica_voice_profile_genome_fk'
      and conrelid = 'vy_replica_voice_profile'::regclass
  ) then
    alter table vy_replica_voice_profile add constraint vy_replica_voice_profile_genome_fk
      foreign key (replica_id, genome_version)
      references vy_replica_voice_genome(replica_id, version) on delete restrict;
  end if;
end;
$replica_voice_profile_genome_fk$;

do $replica_voice_profile_consent_fk$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'vy_replica_voice_profile_consent_fk'
      and conrelid = 'vy_replica_voice_profile'::regclass
  ) then
    alter table vy_replica_voice_profile add constraint vy_replica_voice_profile_consent_fk
      foreign key (provider_consent_id, replica_id, owner_user_id)
      references vy_replica_provider_consent(provider_consent_id, replica_id, owner_user_id)
      on delete restrict;
  end if;
end;
$replica_voice_profile_consent_fk$;

do $replica_voice_profile_commitment_check$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'vy_replica_voice_profile_commitment_check'
      and conrelid = 'vy_replica_voice_profile'::regclass
  ) then
    alter table vy_replica_voice_profile add constraint vy_replica_voice_profile_commitment_check
      check (enrollment_commitment = '' or enrollment_commitment ~ '^[0-9a-f]{64}$');
  end if;
end;
$replica_voice_profile_commitment_check$;

create unique index if not exists vy_replica_voice_profile_owner_tuple_ix
  on vy_replica_voice_profile (voice_profile_id, replica_id, owner_user_id);

create unique index if not exists vy_replica_voice_enrollment_commitment_ix
  on vy_replica_voice_profile (replica_id, provider, enrollment_commitment)
  where enrollment_commitment <> '';

create unique index if not exists vy_replica_voice_one_live_ix
  on vy_replica_voice_profile (replica_id, genome_version, provider)
  where status in ('creating','ready');
