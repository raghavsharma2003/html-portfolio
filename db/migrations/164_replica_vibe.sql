-- Migration 164 (WS-R153). EmotionOS's own vibe: the owner's five-dial
-- description of their AI's baseline warmth/energy/humour/directness/
-- formality, versioned and reversible (a revert never destroys a row, it
-- adds a new one that happens to copy an old one's dims) so the owner's
-- own history is a real, inspectable ledger rather than a single mutable
-- row. `009`'s law restated: no foreign key on `replica_id`/`owner_user_id`
-- — an owner-keyed table this product's WHERE-clause binding already
-- protects, the same convention `vy_recall_run` (127) and every owner-lane
-- table since already follows. One statement, idempotent, explicit ::uuid
-- casts, no DO blocks.
create table if not exists vy_replica_vibe (
  vibe_id        uuid primary key default gen_random_uuid(),
  replica_id     uuid not null,
  owner_user_id  uuid not null,
  version        int not null check (version > 0),
  warmth         smallint not null check (warmth between 0 and 4),
  energy         smallint not null check (energy between 0 and 4),
  humour         smallint not null check (humour between 0 and 4),
  directness     smallint not null check (directness between 0 and 4),
  formality      smallint not null check (formality between 0 and 4),
  note           text not null default '' check (char_length(note) <= 280),
  created_at     timestamptz not null default now(),
  superseded_at  timestamptz
);

-- One LIVE row per replica — `superseded_at is null` can never resolve to
-- two rows, so a reader never has to pick between them (`vy_recall_run`'s
-- own `superseded_at` doc, restated for a partial UNIQUE index rather than
-- a supersede-on-every-write convention, since this table has no rate
-- limit forcing every write through one CTE the way a recall run's cost
-- does).
create unique index if not exists vy_replica_vibe_live_ix
  on vy_replica_vibe(replica_id)
  where superseded_at is null;

-- The owner's own history, newest first, and the ownership-scoped lookup
-- every decision-module query in api/_replica-vibe.js actually issues.
create index if not exists vy_replica_vibe_owner_history_ix
  on vy_replica_vibe(replica_id, owner_user_id, version desc);
