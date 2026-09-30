-- Migration 072 - durable, owner-scoped creation intents for the public clone
-- journey.
--
-- Browser retries are observations of one action, not permission to create a
-- second replica, source or model build. The client supplies an opaque UUID
-- for each action and keeps it until that action reaches a durable state.
-- Language is attached to the immutable source manifest rather than being a
-- tab-local preference. A model-build intent records only technical readiness
-- codes and points at the ordinary reviewed VoiceGenome build; it cannot
-- accept evidence, select an artifact or materialize person/relationship data.
-- Its candidate source remains staged while that exact build is incomplete;
-- the active primary pointer is changed only with the matching draft.

alter table vy_replica
  add column if not exists creation_intent_id uuid;

create unique index if not exists vy_replica_owner_creation_intent_ix
  on vy_replica (owner_user_id, creation_intent_id)
  where creation_intent_id is not null;

alter table vy_replica_source
  add column if not exists upload_intent_id uuid;

alter table vy_replica_source
  add column if not exists language_hint text;

alter table vy_replica_source
  drop constraint if exists vy_replica_source_language_hint_check;

alter table vy_replica_source
  add constraint vy_replica_source_language_hint_check
    check (language_hint is null or language_hint in ('en','hi','hi-latn'));

create unique index if not exists vy_replica_source_owner_upload_intent_ix
  on vy_replica_source (owner_user_id, replica_id, upload_intent_id)
  where upload_intent_id is not null;

create table if not exists vy_replica_voice_build_intent (
  intent_id        uuid primary key,
  replica_id       uuid not null,
  owner_user_id    uuid not null,
  candidate_source_id uuid not null,
  state            text not null default 'waiting'
                   check (state in ('waiting','queued','review','failed')),
  build_id         uuid,
  blockers         text[] not null default '{}'::text[],
  last_error_code  text not null default '',
  promoted_at      timestamptz,
  next_check_at    timestamptz not null default now(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint vy_replica_voice_build_intent_owner_fk
    foreign key (replica_id, owner_user_id)
    references vy_replica(replica_id, owner_user_id) on delete cascade,
  constraint vy_replica_voice_build_intent_candidate_fk
    foreign key (candidate_source_id, replica_id, owner_user_id)
    references vy_replica_source(source_id, replica_id, owner_user_id) on delete cascade,
  constraint vy_replica_voice_build_intent_build_fk
    foreign key (build_id) references vy_replica_model_build(build_id) on delete cascade,
  constraint vy_replica_voice_build_intent_owner_tuple
    unique (intent_id, replica_id, owner_user_id),
  constraint vy_replica_voice_build_intent_shape check (
    (state='waiting' and build_id is null and promoted_at is null)
    or
    (state='queued' and build_id is not null and promoted_at is null)
    or
    (state='review' and build_id is not null and promoted_at is not null)
    or
    (state='failed' and promoted_at is null)
  ),
  constraint vy_replica_voice_build_intent_blocker_shape check (
    cardinality(blockers)<=16 and (
      cardinality(blockers)=0
      or array_to_string(blockers,',') ~ '^[a-z0-9_]{1,96}(,[a-z0-9_]{1,96}){0,15}$'
    )
  ),
  constraint vy_replica_voice_build_intent_error_shape check (
    last_error_code='' or last_error_code ~ '^[a-z0-9_]{1,96}$'
  )
);

create index if not exists vy_replica_voice_build_intent_due_ix
  on vy_replica_voice_build_intent (next_check_at, created_at)
  where state in ('waiting','queued');

create index if not exists vy_replica_voice_build_intent_owner_ix
  on vy_replica_voice_build_intent (owner_user_id, replica_id, created_at desc);
