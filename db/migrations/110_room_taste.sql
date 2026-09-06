-- Migration 110 - the taste (WS-R53). A stranger asks a creator's AI three
-- questions before joining, from creator material alone, remembering
-- nothing, through the one door.
--
-- Two independent additions, both additive and idempotent, one statement per
-- request (Neon's SQL-over-HTTP endpoint accepts exactly one), no DO blocks,
-- no functions, no foreign key on any person/owner column.
--
-- ── 1. `vy_room.taste_enabled` - the creator's per-Room switch ────────────
--
-- The rate count itself needs NO migration at all: `vy_public_rate`
-- (migration 089) already carries a generic (scope, key_hash, window_start)
-- shape, and `api/_rate-limit.js`'s `consume()` already IS the race-safe
-- upsert this feature needs - `context/decisions.md#ws-r26-write-is-the-
-- check-not-read-then-write`. This workstream adds one new scope
-- (`room_taste`) to `DEFAULT_LIMITS`, a JS constant, not a schema change.
--
-- The SWITCH is the one thing with nowhere to live: read first, per the
-- workstream brief's own instruction - migration 071 (`vy_room`'s base
-- columns: no boolean toggle at all) and migration 105 (`listed_at`,
-- `one_line_bio` - the directory's opt-in and its bio, neither a fitting
-- home for "does this Room offer a taste before the sign-in wall"). No
-- existing column means this. Defaults `true` - the feature exists to give
-- every Room a free thirty seconds before the wall, not an opt-in nobody
-- finds, so a creator who never touches this switch gets it ON.
--
-- No PERSON_TABLES/erasure/relcheck change: the column is on `vy_room`,
-- already an owner-lane table deleted by name in
-- api/_replica-full-erasure.js (071's own precedent, restated by 105).
alter table vy_room
  add column if not exists taste_enabled boolean not null default true;

-- ── 2. `vy_room_taste_turn` - "taste turns this week", a count of turns ───
--
-- The ops board needs an honest answer to "how many taste turns happened
-- this week" (WS-R53's own law 5: "a count of turns, not people"), and
-- `vy_public_rate` cannot answer it - its own retention sweep
-- (`purgeStalePublicRateWindows`, called from the check-ins sweep with the
-- default 24h cutoff) purges every window row well inside a week, by
-- design: it is an abuse counter, not a growth metric, and widening its
-- retention to serve a second purpose would be the same "one column made to
-- mean two things" mistake migration 107's own header rejected for
-- `vy_creator_application.audience`.
--
-- `vy_room_arrival` (migration 102) was considered and rejected as the home
-- for this too: its `via` CHECK constraint names four ARRIVAL sources (how
-- a visitor got to the Room), and a taste turn is not a fifth arrival
-- source - a visitor who already arrived (via any of the four) may or may
-- not go on to take a taste turn, and reusing that column for a second
-- dimension (source vs. activity) would make `evals/room-share/run.mjs`'s
-- own fixed assertion ("ROOM_ARRIVAL_VIA is exactly the four values the
-- CHECK constraint names") wrong for a reason that eval was never told
-- about, and conflate two different questions in one text column for every
-- future reader. `context/rejected.md#ws-r53-taste-turn-is-not-a-fifth-
-- arrival-via` names this in full.
--
-- So: a small, dedicated, platform table, `vy_room_arrival`'s own shape one
-- column narrower (no `via` - there is only one kind of row here) - ONE
-- counter per (room, day), written by ONE upsert
-- (`recordRoomTasteTurn`, api/_room-taste.js):
--
--   insert into vy_room_taste_turn (room_id, day, count)
--   values ($1, $2, 1)
--   on conflict (room_id, day) do update
--     set count = vy_room_taste_turn.count + 1
--
-- called from `roomTaste` once per accepted turn (never on a refused one -
-- a 429 is not a turn), best-effort exactly as `recordRoomArrival` already
-- is, so a write failure here must never turn a taste reply into an error
-- for a counting reason.
--
-- No person column, no device, no message content, no timestamp finer than
-- a day - checked against scripts/relcheck.mjs's own PERSON_COLUMNS list
-- before this migration was written (`person_id`, `device_id`, `user_id`,
-- `auth_user_id`, `subject_person_id`, `speaker_person_id`, `granted_by`,
-- `granted_to`, `owner_user_id`, `redeemed_by_user_id`): none present, so
-- this table needs no api/memory.js PERSON_TABLES entry and relcheck's live
-- OWNER_LANE walk never reaches for it - `vy_room_arrival`'s own precedent
-- (migration 102), restated here rather than re-derived.
--
-- Reachability is not skipped for that reason. `room_id` carries a real FK
-- ON DELETE CASCADE from `vy_room`, and `api/_replica-full-erasure.js`
-- deletes this table by name too, in the same block that already does this
-- for `vy_room_arrival` - "relying on a cascade means relying on an FK
-- nobody re-checks" (071's own words, restated at 102 and here).
create table if not exists vy_room_taste_turn (
  room_id uuid not null references vy_room(room_id) on delete cascade,
  day     date not null,
  count   integer not null default 0 check (count >= 0),
  primary key (room_id, day)
);

-- The funnel's own read (`api/_funnel.js`'s `tasteTurnsThisWeek`) is
-- platform-wide, scoped by a rolling 7-day `day` window, never by one room -
-- `vy_room_arrival_via_day_ix`'s own reasoning, one dimension narrower.
create index if not exists vy_room_taste_turn_day_ix
  on vy_room_taste_turn (day);
