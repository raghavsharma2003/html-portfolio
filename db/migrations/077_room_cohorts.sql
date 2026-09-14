-- Migration 077 - the Room's cohort day table: the instrument behind the
-- number that decides the company (WS-R12).
--
-- The Rooms plan, verbatim: "Not signups, not messages, not MAU. Week-six
-- retention of followers who arrived in week one. Below 25% this product does
-- not work and no amount of feature building fixes it. Above 40% it is a
-- category." Phase 0's gate is >=25% on that number; Phase 2's is >=35% plus
-- paid conversion >=12% of signups. Nothing in this schema measures either one
-- today - 071 records WHO joined and WHEN (`joined_at`) and WHAT MONTH they
-- last spent an allowance in (`month_key`/`month_message_count`), but neither
-- answers "did this follower say anything in week six of their own
-- membership", because 071's month bucket resets every calendar month and
-- carries no history once it rolls over. This table is that history, and
-- nothing more than that history.
--
-- ── content-free, restated a fourth time on this migration (012, 016, 071) ──
--
-- `turns` is a COUNT, never a message, never a topic, never a byte of what was
-- said. The row this migration adds each day a follower sends at least one
-- turn is indistinguishable, by design, from a row for a follower who talked
-- about nothing at all - it is the same shape `trace-references-not-copies`
-- (context/decisions.md, 2026-08-20) already committed this repo to: an id, a
-- date, a count, and nothing a regulator or a curious creator could read as
-- content. There is no column this migration could add later that would make
-- it more useful to a re-engagement nudge, because `proactive-reason-
-- contingent` (context/decisions.md, 2026-08-21) already forbids deriving one
-- from anything short of a real event, and "he has not talked in six days" is
-- exactly the silence-triggered shape that decision names and refuses.
--
-- ── one row per (room, follower, day), incremented, never inserted-fresh ────
--
-- `primary key (room_id, person_id, day)` is the whole mechanism: the say lane
-- (api/_room-surface.js's `roomSay`) upserts this row on every turn with
-- `turns = turns + 1`, so a follower who sends five messages in one day is one
-- row with `turns = 5`, not five rows. Retention only ever asks "did they say
-- anything", so the day table is a bit deeper than it needs to be for that one
-- question - `turns` is kept as an integer rather than a boolean because the
-- diagnostics the plan explicitly permits (messages per user, session length)
-- read this same table without a second one, and the plan is explicit that
-- those are diagnostics, never a success metric on their own
-- (context/decisions.md, the Rooms plan's banned-success-metrics list).
--
-- ── no FKs beyond what 071 already does for room_id ──────────────────────
--
-- `room_id` carries the identical `references vy_room(room_id) on delete
-- cascade` every table in 071 carries, for 071's own reason: a room is not an
-- agent binding, it is this migration's own parent row, and a day of turns for
-- a room that no longer exists is not a day of turns for anything.
-- `person_id` carries no FK, matching 009's convention restated by every
-- migration since: the binding is enforced by the WHERE clause, before rank,
-- and a single table whose binding were enforced in the database would read
-- as a stricter rule while actually being an inconsistent one.
--
-- ── the erasure lanes, decided here rather than discovered later ──────────
--
-- Same split 071 drew for `vy_room_follower`/`vy_room_thread`: this table is
-- the PERSON lane (person_id, no owner_user_id), so it goes in PERSON_TABLES
-- (api/memory.js) with an explicit FATE verdict (evals/recall/run.mjs's §8
-- walk), lane "relational", `agent: true`. The creator's own erasure job
-- reaches it by room_id -> agent_id the same way it reaches the other two -
-- a day-count row for a room that is being fully erased is erased with it.
-- Gated in `activePersonTables()`/`REPLICA_PERSON_TABLES` on this migration
-- having landed, exactly as `vy_room_follower`/`vy_room_thread` are gated on
-- 071: the manifest loop's delete is not catch-wrapped on purpose, so a
-- manifest ahead of its migration must never turn "make it forget me" into a
-- 500 for a deploy-ordering reason.
--
-- ── one statement per request, idempotent, no DO blocks ───────────────────
-- 009's law, restated by every migration since and binding here for the same
-- reason: Neon's SQL-over-HTTP endpoint accepts exactly one statement per
-- body, so every statement below is independently re-runnable.
create table if not exists vy_room_follower_day (
  room_id   uuid not null references vy_room(room_id) on delete cascade,
  person_id uuid not null,
  day       date not null,
  turns     integer not null default 0 check (turns >= 0),
  primary key (room_id, person_id, day)
);

-- The read WS-R12's cohort report runs, over and over, per cohort week: "did
-- this follower have at least one turn between two dates". Leading on
-- room_id/person_id keeps it aligned with the primary key, and the day column
-- last keeps a single cohort's window a short, sequential range scan rather
-- than a full-table scan of every room's history.
create index if not exists vy_room_follower_day_scope_ix
  on vy_room_follower_day (room_id, person_id, day);
