-- Invalidate issued private comparison authority when reviewed evidence changes.
-- Separate from text authority: voice review must not erase text answer readback.
alter table vy_replica
  add column if not exists reference_authority_epoch bigint not null default 0;
