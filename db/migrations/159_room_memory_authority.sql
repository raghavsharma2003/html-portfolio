-- Source-only. 157 and 158 are reserved independently. Apply each statement
-- separately through Neon. No historical logs are assigned guessed consent.
alter table vy_room_follower add column if not exists memory_epoch bigint not null default 0 check(memory_epoch>=0);

alter table meera_log add column if not exists room_memory_follower_id uuid references vy_room_follower(follower_id) on delete cascade;

alter table meera_log add column if not exists room_memory_epoch bigint check((room_memory_epoch is null)=(room_memory_follower_id is null) and (room_memory_epoch is null or room_memory_epoch>=0));

alter table vy_episode add column if not exists room_memory_follower_id uuid references vy_room_follower(follower_id) on delete cascade;

alter table vy_episode add column if not exists room_memory_epoch bigint check((room_memory_epoch is null)=(room_memory_follower_id is null) and (room_memory_epoch is null or room_memory_epoch>=0));

create index if not exists meera_log_room_memory_pending_ix on meera_log(room_memory_follower_id,room_memory_epoch,id) where role='me' and episode_id is null;

create index if not exists vy_episode_room_memory_ix on vy_episode(room_memory_follower_id,room_memory_epoch,id);

-- Epoch survives disable/re-enable on one membership. A delete/rejoin gets a
-- fresh follower UUID, so neither absence nor timestamp precision permits ABA.
create or replace function vy_room_memory_epoch_change() returns trigger language plpgsql as $fn$
begin
  new.memory_epoch := old.memory_epoch + 1;
  return new;
end
$fn$;

create or replace trigger vy_room_memory_epoch_change before update of memory_consent_at on vy_room_follower
for each row execute function vy_room_memory_epoch_change();

-- Cited tables deliberately have no episode FK. This explicit erasure backstop
-- removes this writer's two derived classes before the episode FK can cascade.
-- Room forget revokes first and counts its ordinary manifest deletes; this
-- backstop handles account deletion and direct/cascaded follower removal too.
create or replace function vy_room_memory_follower_erasure() returns trigger language plpgsql as $fn$
begin
  delete from vy_fact v using vy_episode e
    where e.room_memory_follower_id=old.follower_id and e.id=any(v.citations)
      and e.agent_id=old.agent_id and e.person_id=old.person_id
      and v.agent_id=old.agent_id and v.person_id=old.person_id;
  delete from vy_observation v using vy_episode e
    where e.room_memory_follower_id=old.follower_id and e.id=any(v.citations)
      and e.agent_id=old.agent_id and e.person_id=old.person_id
      and v.agent_id=old.agent_id and v.person_id=old.person_id;
  return old;
end
$fn$;

create or replace trigger vy_room_memory_follower_erasure before delete on vy_room_follower
for each row execute function vy_room_memory_follower_erasure();
