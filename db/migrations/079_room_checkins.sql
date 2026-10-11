-- Migration 079 - check-ins: follower-scheduled, task-bound (WS-R16).
--
-- "Check-ins" are the paid follower's second reason to pay: the creator's AI
-- follows up on a task the FOLLOWER chose and scheduled. Three tables:
--
--   vy_room_checkin_design  the creator's template ("Did you finish today's
--                            revision block?"), OWNER lane like vy_room_price
--                            (078) - deleted by name in
--                            api/_replica-full-erasure.js, not in PERSON_TABLES.
--   vy_room_checkin         one follower's opted-in schedule against a design.
--                            PERSON lane (PERSON_TABLES, gated on this
--                            migration having landed), agent: true like
--                            vy_room_follower/vy_room_thread (071) - it carries
--                            no agent_id column of its own (joined from
--                            vy_room the way the sweep needs it), so it is
--                            NOT routed through roomScopedTables()'s generic
--                            "and agent_id = ..." delete; reached instead by
--                            an explicit room_id+person_id statement in
--                            roomForget, 077's own precedent for
--                            vy_room_follower_day one migration over.
--   vy_room_checkin_delivery the content-free ledger: an id, a due date, a
--                            channel, a state, never a message. PERSON lane,
--                            same shape as vy_room_checkin.
--
-- `days_of_week` is `integer[]`, ISO weekday numbers (1=Monday..7=Sunday,
-- api/_room-cohorts.js's own `isoWeekStart` convention, restated here so the
-- two modules never disagree about what "day 1" means). `next_due_at` is the
-- ONLY column the sweep's WHERE clause reads to decide "is this due" - law 1
-- of the workstream brief: "Your sweep must be structurally unable to select
-- a row that has no schedule." A row with `next_due_at` null can never satisfy
-- `next_due_at <= now()`, in SQL or in any index built on the column, so
-- there is no code path - correct or buggy - that can select an unscheduled
-- row by accident. `prompt_shape` is the creator's note, a shape rather than
-- a sentence the AI could recite - `recited-prompt` (context/rejected.md) and
-- CLAUDE.md's "write shapes, never lines" bind here exactly as they bind
-- persona.ts.
--
-- No FK on person_id/owner_user_id (009's convention, restated by every
-- migration since); `room_id` and `follower_id` carry real FK CASCADE, 071's
-- and 078's own precedent (`vy_room_subscription.follower_id references
-- vy_room_follower(follower_id) on delete cascade`) - a child row for a
-- follower or a room that no longer exists is not a child row for anything.
-- Idempotent, one statement per request, no DO blocks - Neon's SQL-over-HTTP
-- endpoint accepts exactly one statement per body.
create table if not exists vy_room_checkin_design (
  design_id     uuid primary key,
  room_id       uuid not null references vy_room(room_id) on delete cascade,
  owner_user_id uuid not null,
  title         text not null default '' check (length(title) <= 120),
  prompt_shape  text not null default '' check (length(prompt_shape) <= 2000),
  cadence_hint  text not null default '' check (length(cadence_hint) <= 200),
  state         text not null default 'active' check (state in ('active','paused')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists vy_room_checkin_design_owner_ix
  on vy_room_checkin_design (owner_user_id, room_id, created_at desc);

create table if not exists vy_room_checkin (
  checkin_id    uuid primary key,
  room_id       uuid not null references vy_room(room_id) on delete cascade,
  person_id     uuid not null,
  follower_id   uuid not null references vy_room_follower(follower_id) on delete cascade,
  design_id     uuid not null references vy_room_checkin_design(design_id) on delete cascade,
  days_of_week  integer[] not null default '{}',
  local_time    time not null,
  timezone      text not null,
  next_due_at   timestamptz,
  state         text not null default 'active' check (state in ('active','stopped')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint vy_room_checkin_days_shape check (
    array_length(days_of_week, 1) is not null
    and array_length(days_of_week, 1) between 1 and 7
    and days_of_week <@ array[1,2,3,4,5,6,7]
  )
);
-- The one index the sweep's WHERE clause runs against, leading on the exact
-- predicate it filters by (state = 'active') so a stopped check-in's stale
-- next_due_at never costs the sweep a row it will only discard.
create index if not exists vy_room_checkin_due_ix
  on vy_room_checkin (next_due_at)
  where state = 'active';
create index if not exists vy_room_checkin_scope_ix
  on vy_room_checkin (person_id, room_id);
create unique index if not exists vy_room_checkin_follower_design_ix
  on vy_room_checkin (follower_id, design_id)
  where state = 'active';

create table if not exists vy_room_checkin_delivery (
  delivery_id  uuid primary key,
  checkin_id   uuid not null references vy_room_checkin(checkin_id) on delete cascade,
  room_id      uuid not null references vy_room(room_id) on delete cascade,
  person_id    uuid not null,
  due_at       timestamptz not null,
  delivered_at timestamptz,
  channel      text not null default 'in_app' check (channel in ('in_app','whatsapp_template')),
  state        text not null
    check (state in ('delivered','skipped_free_tier','skipped_stopped','not_configured','failed')),
  reason       text not null default '',
  created_at   timestamptz not null default now(),
  -- ONE delivery per (checkin, due date, channel): the sweep's own idempotency
  -- guarantee, so a cron tick that overlaps the previous one (Vercel's own
  -- documented possibility for a slow invocation) writes at most one row per
  -- occurrence rather than delivering the same check-in twice.
  constraint vy_room_checkin_delivery_once unique (checkin_id, due_at, channel)
);
create index if not exists vy_room_checkin_delivery_scope_ix
  on vy_room_checkin_delivery (person_id, room_id, due_at desc);
create index if not exists vy_room_checkin_delivery_checkin_ix
  on vy_room_checkin_delivery (checkin_id, due_at desc);
