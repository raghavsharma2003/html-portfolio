-- 154: erase derived replies after the dialogue row has left the FK cascade.
-- Migration148's BEFORE trigger could re-delete a row already being removed
-- by the person-device cascade, raising PostgreSQL27000. Preserve148 history.
create or replace function vy_erase_private_continuity_reply() returns trigger language plpgsql as $$
begin
  perform 1 from vy_replica r where r.replica_id=old.replica_id and r.owner_user_id=old.owner_user_id for update;
  -- A parent cascade can remove every dialogue row before AFTER triggers run.
  -- OLD preserves the only assistant-log binding even when no derived row remains.
  delete from meera_log l
   where coalesce(old.continuity_refs,'[]'::jsonb)<>'[]'::jsonb
     and l.id=old.assistant_log_id and l.agent_id=old.agent_id and l.device_id=old.device_id;
  delete from meera_log l using vy_replica_dialogue_turn derived
   where derived.replica_id=old.replica_id and derived.owner_user_id=old.owner_user_id
     and derived.agent_id=old.agent_id and derived.person_id=old.person_id
     and derived.continuity_refs @> jsonb_build_array(jsonb_build_object('turn_id',old.turn_id))
     and l.id=derived.assistant_log_id and l.agent_id=derived.agent_id and l.device_id=derived.device_id;
  return old;
end;
$$;

create or replace trigger vy_private_continuity_source_erasure after delete on vy_replica_dialogue_turn
for each row execute function vy_erase_private_continuity_reply();
