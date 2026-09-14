-- Migration 023 - immutable private-replica runtime capabilities.
--
-- A runtime capability freezes the exact agent, person profile, VoiceGenome,
-- provider voice and qualification corpus that earned activation. Runtime
-- requests bind to this row instead of asking for "latest", so a later draft,
-- failed retrain or provider swap cannot silently change a live replica.

create unique index if not exists vy_replica_agent_pair_ix
  on vy_replica (replica_id, agent_id);

create table if not exists vy_replica_runtime_capability (
  capability_id       uuid primary key default gen_random_uuid(),
  replica_id          uuid not null,
  owner_user_id       uuid not null,
  agent_id            uuid not null,
  subject_person_id   uuid not null references vy_person(person_id),
  voice_profile_id    uuid not null,
  genome_version      integer not null check (genome_version > 0),
  profile_version     integer not null check (profile_version > 0),
  qualification_hash text not null,
  policy_version      text not null,
  state               text not null default 'active'
                      check (state in ('active','paused','revoked','superseded')),
  activated_at        timestamptz not null default now(),
  revoked_at          timestamptz,
  constraint vy_replica_runtime_capability_hash
    check (qualification_hash ~ '^[0-9a-f]{64}$'),
  constraint vy_replica_runtime_capability_owner_fk
    foreign key (replica_id, owner_user_id)
    references vy_replica(replica_id, owner_user_id) on delete cascade,
  constraint vy_replica_runtime_capability_agent_fk
    foreign key (replica_id, agent_id)
    references vy_replica(replica_id, agent_id) on delete cascade,
  constraint vy_replica_runtime_capability_genome_fk
    foreign key (replica_id, genome_version)
    references vy_replica_voice_genome(replica_id, version),
  constraint vy_replica_runtime_capability_voice_fk
    foreign key (voice_profile_id, replica_id, genome_version)
    references vy_replica_voice_profile(voice_profile_id, replica_id, genome_version),
  constraint vy_replica_runtime_capability_profile_fk
    foreign key (replica_id, profile_version)
    references vy_replica_profile(replica_id, version),
  constraint vy_replica_runtime_capability_identity
    unique (capability_id, replica_id, owner_user_id, agent_id, subject_person_id)
);

create unique index if not exists vy_replica_runtime_one_active_ix
  on vy_replica_runtime_capability (replica_id)
  where state = 'active';

create index if not exists vy_replica_runtime_owner_ix
  on vy_replica_runtime_capability (owner_user_id, replica_id, activated_at desc);

create table if not exists vy_replica_runtime_session (
  session_id        uuid primary key default gen_random_uuid(),
  capability_id     uuid not null,
  replica_id        uuid not null,
  owner_user_id     uuid not null,
  agent_id          uuid not null,
  person_id         uuid not null,
  channel           text not null check (channel in ('private_chat','private_call')),
  state             text not null default 'active'
                    check (state in ('active','ended','revoked','expired')),
  trace_id          text not null,
  started_at        timestamptz not null default now(),
  last_active_at    timestamptz not null default now(),
  ended_at          timestamptz,
  updated_at        timestamptz not null default now(),
  constraint vy_replica_runtime_session_trace check (length(trace_id) between 8 and 96),
  constraint vy_replica_runtime_session_capability_fk
    foreign key (capability_id, replica_id, owner_user_id, agent_id, person_id)
    references vy_replica_runtime_capability(
      capability_id, replica_id, owner_user_id, agent_id, subject_person_id
    ) on delete cascade
);

create index if not exists vy_replica_runtime_session_owner_ix
  on vy_replica_runtime_session (owner_user_id, replica_id, started_at desc);

create index if not exists vy_replica_runtime_session_active_ix
  on vy_replica_runtime_session (capability_id, last_active_at)
  where state = 'active';
