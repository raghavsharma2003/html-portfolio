-- Migration 136 - the follower's monthly note (WS-R137).
--
-- Week-six retention is the number that decides the company. A follower who
-- sees, once a month, what their own Room has been for them has a reason to
-- come back; a note built from their own rows costs nothing (no model call,
-- api/_room-month-note.js's own header) and leaks nothing (every count comes
-- from that follower's own lane alone, never another follower's).
--
-- ONE table, content-free: it never stores the note's own TEXT or counts -
-- those are recomputed fresh every time (the cron send, AND the account
-- page's own read), through api/_room-month-note.js#computeFollowerMonthNote
-- - `vy_org_weekly_note`'s own precedent (migration 132: "NO COUNTS COLUMN,
-- on purpose... this note's own numbers are recomputed fresh every time").
-- This row exists only to answer two questions: "has this follower already
-- gotten a note for this month" (the idempotency) and "which channels did it
-- reach" (the account page's own small receipt).
--
-- `unique (follower_id, room_id, month_key)` is the WHOLE idempotency
-- mechanism - an `insert ... on conflict (follower_id, room_id, month_key)
-- do nothing` is what refuses a second note for the same follower, the same
-- Room, the same month, structurally, `vy_org_weekly_note`'s own
-- `(org_id, week_start, channel)` unique index restated one lane over.
--
-- `room_id references vy_room(room_id) on delete cascade`: a note ledger row
-- is a possession of the RELATIONSHIP, not a financial or consent record
-- that must survive it - `vy_room_follower_day`'s own room_id FK (077), the
-- shape every Room-scoped day/count ledger in this schema already carries.
-- NO FK on `follower_id`/`person_id` (009's WHERE-clause-binding law,
-- restated here rather than the 082 exception repeated again): a follower's
-- own forget deletes this row by an explicit statement in `roomForgetCore`
-- (api/_room-surface.js), never by a cascade, exactly as
-- `vy_room_follower_reply_flag`/`vy_room_upgrade_offer` (093/116) already do.
--
-- `month_key` is `YYYY-MM` text, checked, rather than a `date` truncated to
-- the first of the month - `vy_room_referral_reward.year_key`'s own
-- precedent (133) for the identical reason: the unique index and every
-- WHERE clause that reads this column compare it as an opaque label, never
-- as a real calendar date needing month-arithmetic of its own.
--
-- `delivered_channels text[]` is written ONCE, after the real send attempts
-- for that occurrence finish (never at claim time, when nothing has been
-- attempted yet) - the account page's own small receipt ("delivered on
-- push, telegram"), never a second source of truth for whether the note
-- itself was ever built (the row's own EXISTENCE is that).
--
-- Idempotent, one statement per request (Neon SQL-over-HTTP), no DO blocks,
-- explicit ::uuid casts on every comparison in the code that reads this
-- table (api/_room-month-note.js, api/room-month-note-sweep.js, api/room.js).
create table if not exists vy_room_follower_month_note (
  note_id             uuid primary key,
  room_id             uuid not null references vy_room(room_id) on delete cascade,
  follower_id         uuid not null,
  person_id           uuid not null,
  month_key           text not null,
  built_at            timestamptz not null default now(),
  delivered_channels  text[] not null default '{}'::text[],
  constraint vy_room_follower_month_note_month_key_check
    check (month_key ~ '^[0-9]{4}-[0-9]{2}$')
);
-- THE dedupe. See this migration's own header: an INSERT ... ON CONFLICT
-- (follower_id, room_id, month_key) DO NOTHING against this index is the
-- whole "one note per follower per Room per month" guarantee.
create unique index if not exists vy_room_follower_month_note_follower_room_month_ix
  on vy_room_follower_month_note (follower_id, room_id, month_key);
-- The account page's own "last note" read (api/_room-month-note.js's
-- `lastFollowerMonthNote`): most recent note for one follower in one Room,
-- newest first.
create index if not exists vy_room_follower_month_note_follower_built_ix
  on vy_room_follower_month_note (follower_id, built_at desc);
-- `roomExport`'s own row-shape read and `roomForgetCore`'s own explicit
-- delete (api/_room-surface.js), both scoped by room_id+person_id -
-- `vy_room_follower_reply_flag`'s own precedent (116) for the identical
-- pair of access shapes on a table with no FK reaching either column.
create index if not exists vy_room_follower_month_note_room_person_ix
  on vy_room_follower_month_note (room_id, person_id);
