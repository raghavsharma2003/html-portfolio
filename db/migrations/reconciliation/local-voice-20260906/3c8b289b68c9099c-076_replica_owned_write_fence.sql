-- Migration 076 - structural write-after-erasure fence for owner/replica rows.
--
-- These tables predate the replica FK convention and were deleted by name in
-- the full-erasure statement. Deleting by name covers the statement snapshot,
-- but it cannot stop an older request from inserting after that snapshot and
-- after the receipt. A composite FK takes a key-share lock on the exact parent
-- tuple for every future insert. It therefore serializes with the final parent
-- delete even when a future caller forgets the explicit FOR UPDATE gate.
--
-- Live preflight on 2026-09-02 found zero orphans in the eight replica-shaped
-- tables and four target-agent payload stores. They are validated below.
-- vy_replica_audit has 18 historical content-free
-- orphan rows across six unrelated owners, so its FK is deliberately NOT VALID:
-- new writes are enforced immediately, existing operational history is neither
-- deleted nor falsely declared valid. A later, separately reviewed retention
-- migration may remediate those rows and validate this one constraint.

alter table vy_replica_audit
  drop constraint if exists vy_replica_audit_replica_owner_fk,
  add constraint vy_replica_audit_replica_owner_fk
    foreign key (replica_id,owner_user_id)
    references vy_replica(replica_id,owner_user_id) on delete cascade not valid;

alter table vy_clone_channel
  drop constraint if exists vy_clone_channel_replica_owner_fk,
  add constraint vy_clone_channel_replica_owner_fk
    foreign key (replica_id,owner_user_id)
    references vy_replica(replica_id,owner_user_id) on delete cascade not valid;

alter table vy_channel_attestation
  drop constraint if exists vy_channel_attestation_replica_owner_fk,
  add constraint vy_channel_attestation_replica_owner_fk
    foreign key (replica_id,owner_user_id)
    references vy_replica(replica_id,owner_user_id) on delete cascade not valid;

alter table vy_channel_watch
  drop constraint if exists vy_channel_watch_replica_owner_fk,
  add constraint vy_channel_watch_replica_owner_fk
    foreign key (replica_id,owner_user_id)
    references vy_replica(replica_id,owner_user_id) on delete cascade not valid;

alter table vy_ingest_run
  drop constraint if exists vy_ingest_run_replica_owner_fk,
  add constraint vy_ingest_run_replica_owner_fk
    foreign key (replica_id,owner_user_id)
    references vy_replica(replica_id,owner_user_id) on delete cascade not valid;

alter table vy_context_item
  drop constraint if exists vy_context_item_replica_owner_fk,
  add constraint vy_context_item_replica_owner_fk
    foreign key (replica_id,owner_user_id)
    references vy_replica(replica_id,owner_user_id) on delete cascade not valid;

alter table vy_context_item_text
  drop constraint if exists vy_context_item_text_replica_owner_fk,
  add constraint vy_context_item_text_replica_owner_fk
    foreign key (replica_id,owner_user_id)
    references vy_replica(replica_id,owner_user_id) on delete cascade not valid;

alter table vy_video_enrollment
  drop constraint if exists vy_video_enrollment_replica_owner_fk,
  add constraint vy_video_enrollment_replica_owner_fk
    foreign key (replica_id,owner_user_id)
    references vy_replica(replica_id,owner_user_id) on delete cascade not valid;

alter table vy_video_enrollment_window
  drop constraint if exists vy_video_enrollment_window_replica_owner_fk,
  add constraint vy_video_enrollment_window_replica_owner_fk
    foreign key (replica_id,owner_user_id)
    references vy_replica(replica_id,owner_user_id) on delete cascade not valid;

-- Dialogue and accepted-claim generation can finish after a long provider
-- call. These payloads are keyed by the clone's agent rather than replica, so
-- their structural backstop is the exact agent row erased by the same receipt.
alter table meera_log
  drop constraint if exists meera_log_agent_fk,
  add constraint meera_log_agent_fk
    foreign key (agent_id) references vy_agent(agent_id) on delete cascade not valid;

alter table vy_episode
  drop constraint if exists vy_episode_agent_fk,
  add constraint vy_episode_agent_fk
    foreign key (agent_id) references vy_agent(agent_id) on delete cascade not valid;

alter table vy_fact
  drop constraint if exists vy_fact_agent_fk,
  add constraint vy_fact_agent_fk
    foreign key (agent_id) references vy_agent(agent_id) on delete cascade not valid;

alter table vy_teacher_sheet
  drop constraint if exists vy_teacher_sheet_agent_fk,
  add constraint vy_teacher_sheet_agent_fk
    foreign key (agent_id) references vy_agent(agent_id) on delete cascade not valid;

alter table vy_clone_channel validate constraint vy_clone_channel_replica_owner_fk;
alter table vy_channel_attestation validate constraint vy_channel_attestation_replica_owner_fk;
alter table vy_channel_watch validate constraint vy_channel_watch_replica_owner_fk;
alter table vy_ingest_run validate constraint vy_ingest_run_replica_owner_fk;
alter table vy_context_item validate constraint vy_context_item_replica_owner_fk;
alter table vy_context_item_text validate constraint vy_context_item_text_replica_owner_fk;
alter table vy_video_enrollment validate constraint vy_video_enrollment_replica_owner_fk;
alter table vy_video_enrollment_window validate constraint vy_video_enrollment_window_replica_owner_fk;
alter table meera_log validate constraint meera_log_agent_fk;
alter table vy_episode validate constraint vy_episode_agent_fk;
alter table vy_fact validate constraint vy_fact_agent_fk;
alter table vy_teacher_sheet validate constraint vy_teacher_sheet_agent_fk;
