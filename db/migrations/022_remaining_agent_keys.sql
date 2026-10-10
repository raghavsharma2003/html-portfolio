-- Migration 022 - remove the last person-only uniqueness arbiters in the
-- derived agent layer. A client clock id and an inferred taste source are
-- relationship data, so two agents must be able to carry the same natural key.

do $replica_session_agent_key$
begin
  if exists (
    select 1 from pg_constraint
     where conname = 'vy_session_pkey'
       and conrelid = 'vy_session'::regclass
       and pg_get_constraintdef(oid) !~* 'PRIMARY KEY \(agent_id, session_id\)'
  ) then
    alter table vy_session drop constraint vy_session_pkey;
  end if;
  if not exists (
    select 1 from pg_constraint
     where conname = 'vy_session_pkey'
       and conrelid = 'vy_session'::regclass
  ) then
    alter table vy_session add constraint vy_session_pkey primary key (agent_id, session_id);
  end if;
end;
$replica_session_agent_key$;

do $replica_taste_agent_key$
begin
  if exists (
    select 1 from pg_constraint
     where conname = 'vy_taste_candidate_source_once'
       and conrelid = 'vy_taste_candidate'::regclass
       and pg_get_constraintdef(oid) !~* 'UNIQUE \(agent_id, source, source_id\)'
  ) then
    alter table vy_taste_candidate drop constraint vy_taste_candidate_source_once;
  end if;
  if not exists (
    select 1 from pg_constraint
     where conname = 'vy_taste_candidate_source_once'
       and conrelid = 'vy_taste_candidate'::regclass
  ) then
    alter table vy_taste_candidate
      add constraint vy_taste_candidate_source_once unique (agent_id, source, source_id);
  end if;
end;
$replica_taste_agent_key$;
