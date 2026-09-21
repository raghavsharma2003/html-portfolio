-- Migration 071 - bind an applied Mirror delta to the exact TeacherSheet row
-- it changed. Historical applied rows remain null because inferring a sheet id
-- would invent provenance; source erasure treats those rows conservatively.

alter table vy_mirror_delta
  add column if not exists applied_sheet_id uuid;

alter table vy_mirror_delta
  drop constraint if exists vy_mirror_delta_applied_sheet_shape;

alter table vy_mirror_delta
  add constraint vy_mirror_delta_applied_sheet_shape
    check (applied_sheet_id is null or applied_at is not null);

alter table vy_mirror_delta
  drop constraint if exists vy_mirror_delta_applied_sheet_fk;

alter table vy_mirror_delta
  add constraint vy_mirror_delta_applied_sheet_fk
    foreign key (applied_sheet_id) references vy_teacher_sheet(sheet_id)
    on delete set null;

create index if not exists vy_mirror_delta_applied_sheet_ix
  on vy_mirror_delta (applied_sheet_id)
  where applied_sheet_id is not null;
