-- Migration 027 - private, version-bound replica dialogue.
--
-- Conversation text continues to live in the erasable raw RelationalOS log.
-- Dialogue rows bind exact runtime/model versions to those log ids and hashes;
-- they do not duplicate prompts or replies.

create unique index if not exists vy_person_device_pair_ix
  on vy_person_device (device_id,person_id);

create unique index if not exists meera_log_agent_device_tuple_ix
  on meera_log (id,agent_id,device_id);

create unique index if not exists vy_replica_runtime_session_identity_ix
  on vy_replica_runtime_session
    (session_id,capability_id,replica_id,owner_user_id,agent_id,person_id);

alter table vy_replica_runtime_session
  add column if not exists next_turn_ordinal integer not null default 1;

create table if not exists vy_replica_dialogue_turn (
  turn_id             uuid primary key default gen_random_uuid(),
  session_id          uuid not null,
  capability_id       uuid not null,
  replica_id          uuid not null,
  owner_user_id       uuid not null,
  agent_id            uuid not null,
  person_id           uuid not null,
  device_id           uuid not null,
  ordinal             integer not null check (ordinal > 0),
  profile_version     integer not null check (profile_version > 0),
  calibration_version integer not null check (calibration_version > 0),
  schema_version      text not null,
  provider_family     text not null,
  provider_name       text not null,
  provider_version    text not null,
  model               text not null,
  trace_id            text not null,
  user_log_id         bigint not null,
  assistant_log_id    bigint,
  prompt_hash         text not null,
  response_hash       text,
  delivery_plan       jsonb,
  state               text not null default 'generating'
                      check (state in ('generating','complete','failed','blocked')),
  failure_code        text not null default '',
  created_at          timestamptz not null default now(),
  completed_at        timestamptz,
  updated_at          timestamptz not null default now(),
  constraint vy_replica_dialogue_prompt_hash check (prompt_hash ~ '^[0-9a-f]{64}$'),
  constraint vy_replica_dialogue_response_hash check (response_hash is null or response_hash ~ '^[0-9a-f]{64}$'),
  constraint vy_replica_dialogue_trace check (length(trace_id) between 8 and 96),
  constraint vy_replica_dialogue_owner_tuple unique (turn_id,replica_id,owner_user_id),
  constraint vy_replica_dialogue_session_ordinal unique (session_id,ordinal),
  constraint vy_replica_dialogue_session_fk
    foreign key (session_id,capability_id,replica_id,owner_user_id,agent_id,person_id)
    references vy_replica_runtime_session(
      session_id,capability_id,replica_id,owner_user_id,agent_id,person_id
    ) on delete cascade,
  constraint vy_replica_dialogue_device_fk
    foreign key (device_id,person_id)
    references vy_person_device(device_id,person_id) on delete cascade,
  constraint vy_replica_dialogue_user_log_fk
    foreign key (user_log_id,agent_id,device_id)
    references meera_log(id,agent_id,device_id) on delete cascade,
  constraint vy_replica_dialogue_assistant_log_fk
    foreign key (assistant_log_id,agent_id,device_id)
    references meera_log(id,agent_id,device_id) on delete cascade
);

create index if not exists vy_replica_dialogue_owner_ix
  on vy_replica_dialogue_turn (owner_user_id,replica_id,created_at desc);

create index if not exists vy_replica_dialogue_session_ix
  on vy_replica_dialogue_turn (session_id,ordinal desc);

alter table vy_replica_generation add column if not exists dialogue_turn_id uuid;

do $replica_generation_dialogue_fk$
begin
  if not exists (select 1 from pg_constraint where conname='vy_replica_generation_dialogue_fk') then
    alter table vy_replica_generation add constraint vy_replica_generation_dialogue_fk
      foreign key (dialogue_turn_id,replica_id,owner_user_id)
      references vy_replica_dialogue_turn(turn_id,replica_id,owner_user_id) on delete cascade;
  end if;
end;
$replica_generation_dialogue_fk$;

create index if not exists vy_replica_generation_dialogue_ix
  on vy_replica_generation (dialogue_turn_id)
  where dialogue_turn_id is not null;
