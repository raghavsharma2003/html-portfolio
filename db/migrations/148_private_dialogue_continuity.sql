-- 148: prior private rehearsal evidence IDs and content commitments only.
-- No transcript copy. The owning turn already follows owner/person/log erasure.
alter table vy_replica_dialogue_turn add column if not exists continuity_refs jsonb
  check (continuity_refs is null or (jsonb_typeof(continuity_refs)='array' and jsonb_array_length(continuity_refs)<=3));

-- Source deletion removes a derived reply's only raw-log copy. That log's
-- existing FK cascades its dialogue turn and feedback. Recall sources cannot
-- themselves carry continuity refs, and derived turns cannot produce voice.
create or replace function vy_erase_private_continuity_reply() returns trigger language plpgsql as $$
begin
  -- Serialize source erasure with dialogue admission/completion on the same parent.
  perform 1 from vy_replica r where r.replica_id=old.replica_id and r.owner_user_id=old.owner_user_id for update;
  delete from meera_log l using vy_replica_dialogue_turn derived
   where derived.replica_id=old.replica_id and derived.owner_user_id=old.owner_user_id
     and derived.agent_id=old.agent_id and derived.person_id=old.person_id
     and derived.continuity_refs @> jsonb_build_array(jsonb_build_object('turn_id',old.turn_id))
     and l.id=derived.assistant_log_id and l.agent_id=derived.agent_id and l.device_id=derived.device_id;
  return old;
end;
$$;

create or replace trigger vy_private_continuity_source_erasure before delete on vy_replica_dialogue_turn
for each row execute function vy_erase_private_continuity_reply();

create index if not exists vy_private_continuity_source_ix on vy_replica_dialogue_turn
  using gin(continuity_refs jsonb_path_ops) where continuity_refs is not null;
