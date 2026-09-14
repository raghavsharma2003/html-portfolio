-- Migration 081 - the paid tier's fair-use ceilings and voice minutes
-- (WS-R19). WS-R11 (078) built the ledger and the tier flip; this migration
-- is the gap its own report named: "the paid tier's fair-use ceiling (500
-- messages / 30 voice minutes a month, named in the Rooms plan's own product
-- paragraph) is not enforced anywhere in this workstream ... voice minutes
-- have no metering surface anywhere in this codebase yet."
--
-- Three changes, each a predicate surface rather than a number to remember:
--
--   1. vy_room_follower.voice_seconds_month AND voice_month_key - the paid
--      twin of 071's own month_message_count/month_key, spent by a single
--      conditional UPDATE in api/_room-surface.js's roomSpeak, never
--      read-then-written (api/_room-surface.js's own header names the law:
--      "the free cap is a PREDICATE, never a counter"; context/rejected.md
--      has no entry recanting it, and this migration extends the identical
--      discipline to the second number the plan promises).
--
--      A SEPARATE month key rather than reusing 071's `month_key` column,
--      and this is a real defect this workstream's own offline eval caught
--      rather than a stylistic choice: `roomSay` and `roomSpeak` are two
--      INDEPENDENT statements that can each run first in a new month. If both
--      shared one `month_key`, whichever op ran first would roll it forward
--      and reset ITS OWN counter; the second op, arriving after, would see
--      `month_key` already equal to the current month (because the first op
--      just wrote it) and would treat ITS counter as "already spent this
--      month" - not reset it - even though it had never actually been reset.
--      A paid follower's first voice request after month-end, once they had
--      already sent one message that month, would be refused at whatever
--      their PRIOR month's voice spend happened to be, having spent nothing
--      new voice seconds. Two independent monthly meters need two independent
--      rollover keys - `context/rejected.md#ws-r19-shared-month-key-cross-
--      counter-rollover`.
--
--   2. vy_room.paid_monthly_messages / paid_monthly_voice_seconds - the
--      creator-editable ceilings, DEFAULT-bearing per-room columns exactly as
--      071's free_monthly_messages already is, not a deployed constant: a cap
--      that lives in code moves by deploy, one this file's own sibling
--      already warns against (api/_room-surface.js's ROOM_FREE_MONTHLY_MESSAGES
--      comment). Bounds mirror the studio card's own bounds (100-2000
--      messages, 0-3600 voice seconds = 0-60 minutes) so the CHECK and the UI
--      cannot silently disagree about what "editable" means.
--
--   3. vy_room_voice_usage - the day-count sibling of 077's
--      vy_room_follower_day, one column deeper (follower_id, for the same
--      real FK 078's vy_room_subscription already carries to that table) and
--      one column wider (seconds AND clips, since a voice minutes line needs
--      both "how much" and "how many times"). Content-free on 012/016/071's
--      restated law: an id, a date, two counts, never a byte of what was
--      said or how it sounded. PERSON lane (api/memory.js's PERSON_TABLES),
--      gated in activePersonTables()/REPLICA_PERSON_TABLES on this migration
--      having landed, 077's own reasoning restated rather than re-derived:
--      the manifest loop's delete is not catch-wrapped on purpose, so naming
--      a table ahead of its own migration would turn "make it forget me"
--      into a 500 for a deploy-ordering reason.
--
-- ── one statement per request, idempotent, no DO blocks ───────────────────
-- 009's law, restated by every migration since and binding here for the same
-- reason: Neon's SQL-over-HTTP endpoint accepts exactly ONE statement per
-- body, db/migrations/apply.mjs runs them individually with no transaction,
-- and an apply interrupted halfway must be recoverable by running this same
-- file again. Constraints use the idempotent drop-then-add pair, 076/078's
-- shape.

alter table vy_room_follower
  add column if not exists voice_seconds_month integer not null default 0;

alter table vy_room_follower
  drop constraint if exists vy_room_follower_voice_seconds_nonneg;

alter table vy_room_follower
  add constraint vy_room_follower_voice_seconds_nonneg check (voice_seconds_month >= 0);

-- The voice meter's OWN rollover key, deliberately independent of
-- `month_key` (071) - see the header above for the cross-counter defect this
-- avoids. Same default shape as `month_key` itself (071's own column).
alter table vy_room_follower
  add column if not exists voice_month_key text not null default '';

alter table vy_room
  add column if not exists paid_monthly_messages integer not null default 500;

alter table vy_room
  drop constraint if exists vy_room_paid_monthly_messages_band;

alter table vy_room
  add constraint vy_room_paid_monthly_messages_band
  check (paid_monthly_messages >= 100 and paid_monthly_messages <= 2000);

alter table vy_room
  add column if not exists paid_monthly_voice_seconds integer not null default 1800;

alter table vy_room
  drop constraint if exists vy_room_paid_monthly_voice_seconds_band;

alter table vy_room
  add constraint vy_room_paid_monthly_voice_seconds_band
  check (paid_monthly_voice_seconds >= 0 and paid_monthly_voice_seconds <= 3600);

create table if not exists vy_room_voice_usage (
  room_id     uuid not null references vy_room(room_id) on delete cascade,
  person_id   uuid not null,
  follower_id uuid not null references vy_room_follower(follower_id) on delete cascade,
  day         date not null,
  seconds     integer not null default 0 check (seconds >= 0),
  clips       integer not null default 0 check (clips >= 0),
  primary key (room_id, person_id, day)
);

create index if not exists vy_room_voice_usage_scope_ix
  on vy_room_voice_usage (room_id, person_id, day);

create index if not exists vy_room_voice_usage_follower_ix
  on vy_room_voice_usage (follower_id);
