-- Migration 116 - flag this reply (WS-R67).
--
-- A follower who reads a wrong or hurtful reply has had no way to say so
-- except to stop talking. This gives them one tap, and routes it into the
-- SAME queue the creator already works (the review queue, WS-R4) without
-- crossing the scope line AGENTS.md's three scopes draw.
--
-- ── THE BOUNDARY LAW THIS MIGRATION IS BUILT AGAINST (absolute) ───────────
--
-- The creator never receives a follower's words or identity through a flag.
-- A flag carries the AI's OWN reply text (creator-derived output - the same
-- material `vy_review_card.answer_text` already carries to the creator) and
-- a REASON off a closed list. Never the follower's message, never their
-- thread, never who they are. That is why this migration is TWO TABLES, not
-- one:
--
--   vy_room_follower_reply_flag   the FOLLOWER's own lane. Keyed
--                                 `follower_id`, one row per follower per
--                                 reply (the unique index below), exported
--                                 and forgotten with everything else that
--                                 is theirs (`api/_room-surface.js`'s
--                                 `ROOM_EXPORT_EXTRA` / `roomForget`) and
--                                 withdrawable from their own account page.
--
--   vy_room_reply_flag            the CREATOR's lane. NO follower_id, NO
--                                 person_id, NO thread reference of any
--                                 kind - by construction, not by convention,
--                                 so a future column added to this table
--                                 cannot silently reopen the boundary the
--                                 way an FK-shaped column elsewhere in this
--                                 schema might. Content-free of follower
--                                 identity, and admitted to
--                                 `evals/room-leak/run.mjs`'s aggregate-only
--                                 class on that basis alone: what it holds
--                                 is the AI's own words and a count of how
--                                 many times this room's followers flagged
--                                 them, never who did.
--
-- Ten followers flagging the same reply write TEN rows here (no follower
-- identity survives to distinguish them, so there is nothing to deduplicate
-- against on this side) and the creator's queue counts them with a plain
-- `count(*) ... group by reply_sha256` - `api/_review-queue.js`'s
-- `readFlaggedReplies` - which is what makes "one card with n=10, never ten
-- cards" a property of the READ, not a property this table enforces itself.
--
-- ── why `reply_text` may sit on this table with no consent gate ──────────
--
-- It is the reply `api/_surface.js::gatedReply` already produced and already
-- delivered to this follower - the same one door every surface's bytes leave
-- by, the one this platform already trusts to carry an AI's own words to a
-- screen. Nothing about flagging it changes who said it. The API that writes
-- this row (`api/_room-surface.js::flagReply`) reads the text back from the
-- FOLLOWER'S OWN HISTORY by matching `reply_sha256` against a real turn already
-- delivered to them, never from the request body - a body-supplied
-- `reply_text` would let a follower put arbitrary words in the creator's
-- queue wearing the AI's name, and that predicate lives in the API, not here,
-- for the same reason `vy_review_card_fixed_gate` (074) lives in SQL where the
-- API cannot forget to check it: this table's own CHECK constraints bound the
-- SHAPE of what can be written, and the API bounds WHERE the bytes came from.
--
-- ── rate and uniqueness ───────────────────────────────────────────────────
--
-- "A follower may flag each reply once": the unique index on
-- (follower_id, reply_sha256) below, migration 089's `vy_public_rate` shape
-- one table over - the constraint IS the check, never a read-then-decide.
-- "At most 20 a day": `api/_rate-limit.js`'s existing `vy_public_rate`
-- machinery, scope `room_flag_follower` - no new table for it, migration 089
-- already built the one this needs.
--
-- ── withdrawal ─────────────────────────────────────────────────────────────
--
-- `api/_room-surface.js::unflagReply` deletes the follower's own row by
-- (follower_id, reply_sha256) and, in the SAME statement (one query, several
-- CTEs - `api/_review-queue.js::decideReviewCard`'s own precedent for "the
-- write is one statement, not two round trips that could disagree"), deletes
-- exactly one matching row from the creator's lane so the count they see
-- goes back down by the same op that took the follower's own copy away.
-- Neither table gains a `state`/`resolved` column: a flag is a fact about
-- what was said and how many times it was flagged, not a workflow item with
-- its own lifecycle - the workstream brief's own schema, verbatim.
--
-- ── PERSON lane (follower side only) ───────────────────────────────────────
--
-- `vy_room_follower_reply_flag` carries BOTH `person_id` (api/memory.js's
-- `PERSON_TABLES` key, for the whole-account wipe) and
-- `follower_id references vy_room_follower(follower_id) on delete cascade`
-- (a real FK, this Room's own "forget me" backstop) - `vy_room_upgrade_offer`
-- (093)'s exact shape, restated here for a flag instead of an offer. It has
-- NO `agent_id` column (no Room-scoped table added after the original two
-- does, 090's own header states why), so it is reached by
-- `api/_room-surface.js`'s `ROOM_EXPORT_EXTRA` / explicit `roomForget`
-- statement, never through the generic agent-scoped manifest loop.
--
-- `vy_room_reply_flag` carries NEITHER `person_id` NOR `owner_user_id`: it is
-- reached only by name, by `room_id`, in the owner-wide erasure cascade
-- (`api/_replica-full-erasure.js`) exactly as `vy_room_upgrade_offer`/
-- `vy_room_handoff` already are - never through `api/memory.js`'s manifest,
-- because it names no person at all.
--
-- Idempotent, ONE STATEMENT PER REQUEST (Neon's SQL-over-HTTP endpoint takes
-- exactly one), no DO blocks, no functions, explicit ::uuid/::text casts
-- wherever the API binds a parameter against these tables.

-- ── the follower's own lane ────────────────────────────────────────────────
create table if not exists vy_room_follower_reply_flag (
  flag_id      uuid primary key,
  room_id      uuid not null references vy_room(room_id) on delete cascade,
  person_id    uuid not null,
  follower_id  uuid not null references vy_room_follower(follower_id) on delete cascade,
  -- The exact reply, proven by the API to be a real turn this follower was
  -- really sent (read back from their own history), never trusted off the
  -- request body.
  reply_sha256 text not null check (reply_sha256 ~ '^[0-9a-f]{64}$'),
  reason       text not null
               check (reason in ('wrong', 'harmful', 'not_them', 'other')),
  created_at   timestamptz not null default now()
);

-- THE UNIQUENESS LAW AS A CONSTRAINT, not a preference the API might forget
-- to check: "a follower may flag each reply once", enforced by the database
-- itself, exactly as `vy_review_never_rule_pattern_ix` (074) enforces its own
-- one-per-phrase rule and `vy_public_rate`'s primary key (089) enforces one
-- row per scope/key/window.
create unique index if not exists vy_room_follower_reply_flag_once_ix
  on vy_room_follower_reply_flag (follower_id, reply_sha256);

-- The account page's own read: this follower's flags, this Room, newest
-- first - `api/_room-surface.js::followerFlags`'s only statement.
create index if not exists vy_room_follower_reply_flag_person_ix
  on vy_room_follower_reply_flag (room_id, person_id, created_at desc);

-- ── the creator's own lane - content-free of follower identity ────────────
create table if not exists vy_room_reply_flag (
  id           uuid primary key,
  room_id      uuid not null references vy_room(room_id) on delete cascade,
  reply_sha256 text not null check (reply_sha256 ~ '^[0-9a-f]{64}$'),
  -- The AI's own reply. Creator-derived output, never a follower's words -
  -- see this migration's own header for the argument and where the API
  -- enforces it.
  reply_text   text not null check (reply_text <> '' and length(reply_text) <= 4000),
  reason       text not null
               check (reason in ('wrong', 'harmful', 'not_them', 'other')),
  created_at   timestamptz not null default now()
);

-- `api/_review-queue.js::readFlaggedReplies`'s own statement: grouped by
-- reply, newest flag first within a group, scoped to one room.
create index if not exists vy_room_reply_flag_room_reply_ix
  on vy_room_reply_flag (room_id, reply_sha256, created_at desc);
