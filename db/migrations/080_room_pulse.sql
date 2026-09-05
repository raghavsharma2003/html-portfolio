-- Migration 080 - Pulse v0: counts over the opt-in shared subgraph (WS-R17).
--
-- The plan's own warning, verbatim: "Pulse is the write-path leak in a
-- dashboard costume." This migration's whole argument is that the costume is
-- structurally impossible to wear: every row below is either (a) a consent
-- record with no content column at all, (b) a creator-typed label, or (c) a
-- count with a CHECK that refuses to exist below the n>=5 floor. Nothing here
-- can ever hold a follower's own words, a thread title, or a message.
--
-- ── three tables, three different lanes ────────────────────────────────────
--
--   vy_room_pulse_optin     PERSON lane. A follower's own toggle: did they let
--                            one conversation (or, before this Room has any
--                            threads, their whole relationship) count toward
--                            their creator's counts. Revocable, and revoking it
--                            is a normal UPDATE (revoked_at set), never a
--                            delete - the row is itself content-free (no
--                            column here could ever hold what they said), so
--                            keeping it is not a privacy cost, and keeping it
--                            is what lets a re-opt-in reuse the same row rather
--                            than minting a new consent artifact for the same
--                            decision made twice.
--   vy_room_pulse_topic      OWNER lane. A short list of labels the CREATOR
--                            typed, never a follower's words - the bucket
--                            label law from the plan's own text, restated as a
--                            column that structurally cannot hold anything
--                            else, because nothing ever writes a follower's
--                            text into it.
--   vy_room_pulse_snapshot   Content-free and derived. Room, week, topic,
--                            count, and a CHECK that refuses to let a row
--                            exist at all below five distinct followers. This
--                            is the "impossible to wear" part: there is no
--                            SQL statement that can INSERT a bucket of four
--                            into this table, not a buggy one, not a rushed
--                            one under a launch date - the database itself
--                            refuses it.
--
-- ── no FK on person_id/owner_user_id (009's convention, restated by 051/053/
--    055/064/071/077/078) ──────────────────────────────────────────────────
--
-- The binding is enforced by the WHERE clause, before rank, exactly as every
-- other person/owner column in this schema. `room_id` DOES carry a real FK
-- with ON DELETE CASCADE (071's own convention: a room is this migration's
-- parent row, not an agent binding), and so does `vy_room_pulse_optin.thread_id`
-- (a follower's own thread, not a person/owner binding either) and
-- `vy_room_pulse_snapshot.topic_id` (a room-scoped catalog row, same class as
-- room_id). All three cascades exist so a deleted room, thread or topic cannot
-- outlive itself in this migration's own tables; every one of them is ALSO
-- deleted explicitly by name in api/_replica-full-erasure.js and
-- api/_room-surface.js's `roomForget`, on 071's own stated reason: "relying on
-- a cascade means relying on an FK nobody re-checks."
--
-- ── one statement per request, idempotent, no DO blocks (009's law) ────────

-- ── the follower's own toggle ────────────────────────────────────────────
--
-- `thread_id` NULL means "this whole relationship, room-wide" - the Room has
-- no threads yet, or the follower opted in before naming one. NOT NULL means
-- one specific conversation. Either way this row can never be found by a
-- creator asking "which follower" - `readPulse` never selects `person_id`,
-- and this table's own row is the only place that column lives.
--
-- `policy_version` is the opt-in copy's own version, mirrored the way every
-- other consent artifact in this schema stamps the words a person actually
-- read (016's `meera_consent`, migration 026's claim-extraction consent_ids).
-- A later version does not retroactively reinterpret an earlier grant; it
-- only changes what a FUTURE toggle records.
create table if not exists vy_room_pulse_optin (
  optin_id       uuid primary key,
  room_id        uuid not null references vy_room(room_id) on delete cascade,
  person_id      uuid not null,
  thread_id      uuid references vy_room_thread(thread_id) on delete cascade,
  policy_version integer not null default 1 check (policy_version > 0),
  granted_at     timestamptz not null default now(),
  revoked_at     timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- ONE row per (room, person, scope). `coalesce` folds the two nullable-thread
-- rows onto a fixed sentinel so a room-wide opt-in cannot be minted twice for
-- the same person - postgres treats two NULLs as distinct in a plain unique
-- index, which would silently let "toggle it on" write a second row every
-- time instead of reactivating the first.
create unique index if not exists vy_room_pulse_optin_scope_ix
  on vy_room_pulse_optin (room_id, person_id, coalesce(thread_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- What `computeSnapshot`'s room-total predicate reads: this room's currently
-- active (not revoked) opt-ins, whatever their scope.
create index if not exists vy_room_pulse_optin_active_ix
  on vy_room_pulse_optin (room_id, person_id)
  where revoked_at is null;

-- What `computeSnapshot`'s per-topic predicate reads: is THIS thread actively
-- opted in. Partial and thread-only, because a room-scoped row (thread_id
-- null) is invisible to per-topic matching by construction (v0 has no text to
-- match a room-wide opt-in against) - see api/_pulse.js's header.
create index if not exists vy_room_pulse_optin_thread_ix
  on vy_room_pulse_optin (thread_id)
  where revoked_at is null and thread_id is not null;

-- What `roomForget`/the whole-account wipe read: every opt-in row this person
-- ever granted, across every scope, in this room.
create index if not exists vy_room_pulse_optin_person_ix
  on vy_room_pulse_optin (person_id, room_id);

-- ── the creator's own topic list ─────────────────────────────────────────
--
-- `label` is the ONLY text in this table and it is CREATOR-typed, never
-- derived from a follower's thread title or message - the plan's bucket-label
-- law as a schema fact rather than a hope. Capped to 60 characters, the same
-- ceiling `vy_room_thread.title` uses, for the same reason: a label is a
-- short name, not a paragraph.
create table if not exists vy_room_pulse_topic (
  topic_id      uuid primary key,
  room_id       uuid not null references vy_room(room_id) on delete cascade,
  owner_user_id uuid not null,
  label         text not null check (length(label) between 1 and 60),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- A creator cannot declare the same topic twice under two spellings that
-- differ only by case - `setTopics`'s upsert relies on this to know "same
-- topic, renamed casing" from "a genuinely new one."
create unique index if not exists vy_room_pulse_topic_label_ix
  on vy_room_pulse_topic (room_id, lower(label));

-- The owner's own studio read: this replica's Room's topic list.
create index if not exists vy_room_pulse_topic_owner_ix
  on vy_room_pulse_topic (owner_user_id, room_id);

-- ── the content-free result ──────────────────────────────────────────────
--
-- THE FLOOR IS A DATABASE CONSTRAINT, not an application check. Law 3's
-- "n>=5 distinct followers per bucket" is enforced by this CHECK whether the
-- row was about to be inserted by `computeSnapshot`, by a future rewrite of
-- it, or by a bug: there is no value of `follower_count` under 5 this table
-- will ever hold, which is the "impossible to wear" property this migration's
-- header promises rather than merely intends.
--
-- No `person_id` column exists here and none may ever be added - the schema
-- itself is the proof that a bucket cannot be traced back to a follower, one
-- layer below `evals/room-leak`'s runtime proof of the same claim.
create table if not exists vy_room_pulse_snapshot (
  snapshot_id    uuid primary key,
  room_id        uuid not null references vy_room(room_id) on delete cascade,
  week_start     date not null,
  topic_id       uuid not null references vy_room_pulse_topic(topic_id) on delete cascade,
  follower_count integer not null check (follower_count >= 5),
  computed_at    timestamptz not null default now()
);

-- ONE row per (room, week, topic) - `computeSnapshot` deletes the week's rows
-- before it re-inserts (recomputed, never patched, law 1), so this index is a
-- correctness backstop rather than the mechanism itself: two concurrent
-- sweeps for the same room and week cannot both leave a bucket standing.
create unique index if not exists vy_room_pulse_snapshot_week_ix
  on vy_room_pulse_snapshot (room_id, week_start, topic_id);

-- The owner's own studio read: this room's most recent computed week, newest
-- first.
create index if not exists vy_room_pulse_snapshot_owner_read_ix
  on vy_room_pulse_snapshot (room_id, week_start desc);
