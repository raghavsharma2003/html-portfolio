-- Migration 115 - the creator's public page showcase (WS-R66).
--
-- ── the problem ─────────────────────────────────────────────────────────
--
-- WS-R45 lists a creator on `/creators` and WS-R40 gives `/r/<slug>` a head
-- a crawler can read, but neither gives a search engine or a first-time
-- visitor anything to actually READ: a title and a one-line bio is a
-- listing, not a page. This table is the up-to-five Q&A pairs a creator
-- chooses to show a stranger on `/c/<slug>` before that stranger ever joins.
--
-- ── CREATOR MATERIAL ONLY, never a follower's words ────────────────────────
--
-- `question` and `answer` are the creator's own text: typed or edited by
-- them directly, or copied from a `vy_review_card` (074) the creator marked
-- "Sounds right" - and ONLY from a card whose `kind` is not
-- `follower_declined`, because that is the one kind whose `prompt_text` is a
-- real follower's own question, not creator material (`api/_review-queue.js`'s
-- own migration comment: "'follower_declined' is a real follower question the
-- AI declined or answered with low confidence"). `api/_room-publish.js`'s
-- `setRoomShowcase` enforces this with `kind <> 'follower_declined'` in the
-- WHERE clause of its own read, never applied after the row is already in
-- hand - `api/_disclosure.js`'s standing rule, restated for a write's source
-- read instead of a follower-facing recall. No PERSON column exists on this
-- table by construction: it holds nothing about anyone who ever talked to
-- this AI, only what its creator chose to say about themselves.
--
-- ── AT MOST FIVE ACTIVE PER ROOM, BY THE INDEX, NOT BY CONVENTION ──────────
--
-- `position` is CHECK-bounded to 1..5, and the partial unique index below is
-- on (room_id, position) WHERE removed_at is null - so at most one ACTIVE row
-- can ever occupy a given position for a given Room, and since only five
-- positions exist, five active rows is the database's own ceiling, not a
-- limit `api/_room-publish.js` merely promises to respect. A sixth attempt
-- (position outside 1..5) is refused by the CHECK before the index is ever
-- consulted; a second attempt at an OCCUPIED position is refused by the
-- writer retiring (`removed_at = now()`) whatever already held that position
-- first, never by a raw 23505 reaching the caller.
--
-- ── FK CASCADE from vy_room, no relcheck entry needed ──────────────────────
--
-- `room_id` carries a REAL FK ON DELETE CASCADE from `vy_room` - this table
-- names no person, no owner_user_id, no replica_id (checked against
-- scripts/relcheck.mjs's own PERSON_COLUMNS list before this migration was
-- written, `vy_room_arrival`'s own precedent, migration 102's header,
-- restated here), so it needs no entry in api/memory.js's PERSON_TABLES
-- manifest and relcheck's live OWNER_LANE walk never reaches for it on its
-- own account. It is still deleted BY NAME in api/_replica-full-erasure.js,
-- child before the `vy_room` row it belongs to, on 071's own words: "relying
-- on a cascade means relying on an FK nobody re-checks."
--
-- ── one statement per request, idempotent, no DO blocks, no functions ──────
-- 009's law, restated by every migration since: Neon's SQL-over-HTTP
-- endpoint accepts exactly one statement per body.
create table if not exists vy_room_showcase (
  id         uuid primary key default gen_random_uuid(),
  room_id    uuid not null references vy_room(room_id) on delete cascade,
  question   text not null check (question <> '' and length(question) <= 200),
  answer     text not null check (answer <> '' and length(answer) <= 1200),
  position   integer not null check (position >= 1 and position <= 5),
  created_at timestamptz not null default now(),
  removed_at timestamptz
);

-- The whole guarantee: at most one ACTIVE row per (room, position), and by
-- extension at most five active rows per Room. Also this table's own read
-- path (`api/_room-publish.js`'s `readRoomShowcase`, "every active row for
-- this Room, in position order") - a partial index that enforces the
-- constraint IS the index that answers the query, `vy_room_listed_ix`'s own
-- reasoning (105) restated: a Room with no showcase yet (the overwhelming
-- majority, always) costs this index nothing.
create unique index if not exists vy_room_showcase_position_ix
  on vy_room_showcase (room_id, position)
  where removed_at is null;

-- Added at the merge (main loop, 2026-09-05): the erasure cascade's delete by
-- room_id seq-scanned in the live EXPLAIN, because the partial unique index
-- above covers only rows with removed_at null and the erasure must reach the
-- removed ones too. A plain room index serves that delete and any read of a
-- Room's whole history.
create index if not exists vy_room_showcase_room_ix
  on vy_room_showcase (room_id);
