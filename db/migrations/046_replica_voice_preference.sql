-- Migration 046 - content-free, exact-generation owner voice preferences.
-- The spoken prompt remains private and is represented only by a SHA-256
-- commitment. A preference binds two sealed protected previews that differ
-- only in a server-owned delivery condition.

alter table vy_replica_generation add column if not exists preview_language_id text not null default '';
alter table vy_replica_generation add column if not exists preview_text_hash text not null default '';
alter table vy_replica_generation add column if not exists preview_style jsonb not null default '{}'::jsonb;
alter table vy_replica_generation add column if not exists preview_seed integer not null default 0;

do $replica_voice_preference_generation_constraints$
begin
  if not exists (select 1 from pg_constraint where conname='vy_replica_generation_preview_language_check') then
    alter table vy_replica_generation add constraint vy_replica_generation_preview_language_check
      check (preview_language_id in ('','en','hi'));
  end if;
  if not exists (select 1 from pg_constraint where conname='vy_replica_generation_preview_text_hash_check') then
    alter table vy_replica_generation add constraint vy_replica_generation_preview_text_hash_check
      check (preview_text_hash='' or preview_text_hash~'^[0-9a-f]{64}$');
  end if;
  if not exists (select 1 from pg_constraint where conname='vy_replica_generation_preview_style_check') then
    alter table vy_replica_generation add constraint vy_replica_generation_preview_style_check
      check (jsonb_typeof(preview_style)='object' and octet_length(preview_style::text)<=512);
  end if;
  if not exists (select 1 from pg_constraint where conname='vy_replica_generation_preview_seed_check') then
    alter table vy_replica_generation add constraint vy_replica_generation_preview_seed_check
      check (preview_seed between 0 and 2147483647);
  end if;
end;
$replica_voice_preference_generation_constraints$;

create table if not exists vy_replica_voice_preference (
  preference_id          uuid primary key,
  replica_id             uuid not null,
  owner_user_id          uuid not null,
  genome_version         integer not null check (genome_version>0),
  preview_artifact_id    uuid not null,
  left_generation_id    uuid not null,
  right_generation_id   uuid not null,
  pair_hash              text not null,
  choice                 text not null check (choice in ('left','right','tie','neither')),
  reason_codes           text[] not null default '{}',
  confidence             numeric(4,3) not null default 1.000 check (confidence between 0 and 1),
  policy_version         text not null,
  created_at             timestamptz not null default now(),
  constraint vy_replica_voice_preference_distinct check (left_generation_id<>right_generation_id),
  constraint vy_replica_voice_preference_pair_hash check (pair_hash~'^[0-9a-f]{64}$'),
  constraint vy_replica_voice_preference_reasons check (
    cardinality(reason_codes)<=6 and reason_codes <@ array[
      'identity','accent','rhythm','emotion','naturalness','pronunciation','noise_or_artifact'
    ]::text[]
  ),
  constraint vy_replica_voice_preference_owner_identity unique (preference_id,replica_id,owner_user_id),
  constraint vy_replica_voice_preference_pair unique (replica_id,owner_user_id,pair_hash),
  constraint vy_replica_voice_preference_owner_fk foreign key (replica_id,owner_user_id)
    references vy_replica(replica_id,owner_user_id) on delete cascade,
  constraint vy_replica_voice_preference_artifact_fk foreign key (preview_artifact_id,replica_id,owner_user_id)
    references vy_replica_processing_artifact(artifact_id,replica_id,owner_user_id) on delete restrict,
  constraint vy_replica_voice_preference_left_fk foreign key (left_generation_id,replica_id,owner_user_id)
    references vy_replica_generation(generation_id,replica_id,owner_user_id) on delete restrict,
  constraint vy_replica_voice_preference_right_fk foreign key (right_generation_id,replica_id,owner_user_id)
    references vy_replica_generation(generation_id,replica_id,owner_user_id) on delete restrict
);

create index if not exists vy_replica_voice_preference_owner_ix
  on vy_replica_voice_preference(owner_user_id,replica_id,created_at desc);
