-- Explicit owner saves can precede runtime activation. These rows are private
-- drafts, never an invented runtime agent or a publishable persona. Historical
-- agent-owned rows retain their ownership path; do not infer a replica backfill.
alter table vy_teacher_sheet
  add column if not exists replica_id uuid,
  add column if not exists owner_user_id uuid;

alter table vy_teacher_sheet alter column agent_id drop not null;

alter table vy_teacher_sheet drop constraint if exists vy_teacher_sheet_private_owner_shape;

alter table vy_teacher_sheet add constraint vy_teacher_sheet_private_owner_shape check (
  (replica_id is null) = (owner_user_id is null)
  and (agent_id is not null or
       (replica_id is not null and owner_user_id is not null and status in ('draft','revoked')))
);

alter table vy_teacher_sheet drop constraint if exists vy_teacher_sheet_private_owner_fk;

alter table vy_teacher_sheet add constraint vy_teacher_sheet_private_owner_fk
  foreign key (replica_id,owner_user_id)
  references vy_replica(replica_id,owner_user_id) on delete cascade;

-- New saves attach explicit ownership. No historical rows are rewritten or
-- discarded to satisfy this index. ON CONFLICT also arbitrates first saves
-- whose snapshots both precede the first insert.
create unique index if not exists vy_teacher_sheet_private_draft_ix
  on vy_teacher_sheet(replica_id)
  where replica_id is not null and status='draft';

create index if not exists vy_teacher_sheet_private_owner_recent_ix
  on vy_teacher_sheet(owner_user_id,replica_id,created_at desc)
  where replica_id is not null;
