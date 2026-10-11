-- Migration 102 - counting how a Room was arrived at, without a person
-- (WS-R40, share and arrival).
--
-- ── the problem ─────────────────────────────────────────────────────────
--
-- Today `/r/<slug>` is one static `room.html` for every Room, so a link a
-- follower forwards on WhatsApp unfurls as nothing - no name, no sentence -
-- and the creator's funnel (WS-R25, `api/_funnel.js`) cannot tell a follower
-- who arrived because a friend shared the link apart from any other visit.
-- This migration adds the one table growth needs an answer from: how many
-- arrivals this week came from a share, a direct visit, an embed (WS-R46's
-- own `?via=embed` link, already live and, until this migration, uncounted)
-- or a search - counted in aggregate, never by person.
--
-- ── PLATFORM TABLE, no person column, by construction ──────────────────────
--
-- Checked against scripts/relcheck.mjs's own PERSON_COLUMNS list before this
-- migration was written (`person_id`, `device_id`, `user_id`,
-- `auth_user_id`, `subject_person_id`, `speaker_person_id`, `granted_by`,
-- `granted_to`, `owner_user_id`, `redeemed_by_user_id`): this table carries
-- none of them - `room_id`, `day`, `via`, `count` - so it needs no entry in
-- api/memory.js's PERSON_TABLES manifest, and relcheck's live OWNER_LANE walk
-- (which is keyed on `owner_user_id`/`redeemed_by_user_id`, not present here
-- either) never reaches for it. That is not an oversight scoped around
-- either check; it is `vy_public_rate`'s own precedent (migration 089,
-- context/decisions.md) restated: a table with neither kind of column is
-- outside both scans' scope, not exempted from it.
--
-- Reachability is not skipped for that reason. `room_id` carries a REAL FK
-- ON DELETE CASCADE from `vy_room` below, and `api/_replica-full-erasure.js`
-- deletes this table BY NAME as well, child before parent, in the same block
-- that already does this for `vy_room_handoff`/`vy_room_checkin`/
-- `vy_room_pulse_snapshot` - "relying on a cascade means relying on an FK
-- nobody re-checks", 071's own words, restated here for the same reason.
--
-- ── ONE counter per (room, day, via), written by ONE upsert ────────────────
--
-- `api/_room-surface.js`'s `recordRoomArrival` runs exactly one statement:
--
--   insert into vy_room_arrival (room_id, day, via, count)
--   values ($1, $2, $3, 1)
--   on conflict (room_id, day, via) do update
--     set count = vy_room_arrival.count + 1
--
-- called from `openRoom`, the Room's existing first-load op, once per call,
-- for every visit whether or not the visitor ever joins. `via` is decided
-- from a closed allowlist (`resolveArrivalVia`, api/_room-surface.js) BEFORE
-- this table is ever touched - anything else, including a value shaped like
-- SQL, becomes 'direct' in JS first. The CHECK constraint below is
-- therefore a second, structural layer behind a value that was already safe
-- by the time it reached SQL, api/_disclosure.js's own standing rule (a
-- predicate belongs in the WHERE clause, never applied after) restated for
-- a write instead of a read. No timestamp finer than a day, no session, no
-- follower id: a row here can say "this Room had 4 share-arrivals on
-- 2026-09-04" and nothing else.
--
-- ── one statement per request, idempotent, no DO blocks, no functions ──────
-- 009's law, restated by every migration since: Neon's SQL-over-HTTP
-- endpoint accepts exactly one statement per body.
create table if not exists vy_room_arrival (
  room_id uuid not null references vy_room(room_id) on delete cascade,
  day     date not null,
  via     text not null check (via in ('share', 'direct', 'embed', 'search')),
  count   integer not null default 0 check (count >= 0),
  primary key (room_id, day, via)
);

-- The funnel's own read (`api/_funnel.js`'s `shareArrivalsThisWeek`) is
-- platform-wide, scoped by `via` and a rolling 7-day `day` window, never by
-- one room - this index is that query's own access path, not the upsert's
-- (the primary key above already covers the ON CONFLICT target).
create index if not exists vy_room_arrival_via_day_ix
  on vy_room_arrival (via, day);
