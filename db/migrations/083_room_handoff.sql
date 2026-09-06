-- Migration 083 - Handoff v0 (WS-R20): a follower asks for the human.
--
-- The GroupAI kernel's plan names Handoff as Phase 3. This is v0 inside
-- Rooms: the kernel's one law ported as a predicate rather than the kernel
-- itself -- NOTHING a follower said reaches the creator unless the follower
-- chose that exact payload, saw it verbatim, and said yes; and the
-- creator's reply reaches only that follower, in that follower's private
-- thread, marked as the human creator and never as their AI.
--
-- ── the two switches, on vy_room, off by default ───────────────────────────
--
-- `handoff_enabled` is the creator's own choice per Room, default false --
-- Handoff is not something a follower can ever trigger on a Room whose
-- creator never turned it on, the same shape 071's `free_monthly_messages`
-- and 081's two ceilings already use: a live column a creator edits, never a
-- deployed constant. `handoff_monthly_cap` bounds how many requests ONE
-- follower may send in one month, default 5, band 0-50 -- 081's own
-- `paid_monthly_messages`/`paid_monthly_voice_seconds` precedent for a
-- creator-editable ceiling with a CHECK band so the UI and the database
-- cannot silently disagree about what "editable" means.
--
-- ── vy_room_handoff: the one PERSON-lane exception to "never a word" ───────
--
-- 071's own header states the law for `vy_room`/`vy_room_follower`/
-- `vy_room_thread`: "no column in any of the three can hold anything anybody
-- said, and none ever may." Handoff is a deliberate, narrow exception to
-- that law rather than a violation of it -- storing the exact verbatim
-- payload and the creator's exact verbatim reply is the WHOLE MECHANISM this
-- migration exists to build: a follower must be able to see, byte for byte,
-- what will cross the boundary before it does, and the creator's read is
-- gated on a SQL predicate that recomputes the hash of the stored text and
-- refuses to return anything that does not match it -- "a predicate, not a
-- promise" (api/_disclosure.js's own words, restated here for a consent
-- boundary rather than a group-membership one). No other Room table may
-- follow this table's shape; this one exists precisely so no other one has
-- to.
--
-- `payload_sha256` is a real predicate, not a hint the app trusts: the
-- creator-facing queue read (api/_handoff.js) requires
-- `payload_sha256 = encode(digest(payload_text,'sha256'),'hex')` in its own
-- WHERE clause, Postgres computing the hash fresh on every read rather than
-- the application asserting it once at write time and never checking again.
-- `pgcrypto` (for `digest()`) is already `create extension if not exists`
-- in db/schema.sql from migration 001 onward.
--
-- The disclosure act (WS-common's brief, point 2: "a disclosure act is
-- recorded per request") is NOT a new row in `meera_consent` -- that
-- ledger's own header states "NO CONTENT COLUMN and there must never be
-- one," and Handoff's whole point is that the exact content is what was
-- consented to, so a ledger that cannot hold it cannot record the act that
-- matters here. The act is recorded INLINE instead: `sent_at` is the
-- timestamp the follower said yes to exactly `payload_text`, and
-- `policy_version` is which wording of "what happens when you do this" they
-- saw when they said it -- the row IS the disclosure act, not a pointer to
-- one recorded somewhere else (context/decisions.md
-- `ws-r20-handoff-act-is-inline-not-in-meera-consent`).
--
-- No unique constraint enforces the monthly cap. 079's WS-R16 header states
-- the reason this migration follows: "your sweep must be structurally
-- unable to..." restated for a write rather than a read -- the cap is a
-- COUNT PREDICATE inside the INSERT's own SELECT (api/_handoff.js's
-- `sendHandoffRequest`), not a unique index, because a follower is allowed
-- MULTIPLE requests per month up to the cap, not exactly one.
--
-- `thread_id` is nullable and FK CASCADE to `vy_room_thread` -- a request
-- may be asked from a specific thread (so a creator's reply lands back in
-- it) or with no thread at all (a fresh note with nowhere it came from). No
-- FK on `room_id`'s owner side and no `agent_id` column at all -- 009's
-- convention restated by every Room migration since: agent context is
-- joined from `vy_room` exactly as 079/080's siblings already do, so this
-- table is deliberately absent from `roomScopedTables()`'s generic
-- per-agent loop and reached instead by an explicit `room_id`+`person_id`
-- delete in `roomForget` (added in the same change as this migration) and
-- by the account-level whole wipe (api/memory.js's PERSON_TABLES, lane
-- "relational").
--
-- `follower_id` DOES carry a real FK CASCADE to `vy_room_follower` -- 078's
-- own precedent (`vy_room_subscription.follower_id`) and 081's
-- (`vy_room_voice_usage.follower_id`): a handoff request for a follower who
-- no longer has a membership row is not a request for anything.
--
-- ── one statement per request, idempotent, no DO blocks ───────────────────
-- 009's law, restated by every migration since and binding here for the
-- same reason: Neon's SQL-over-HTTP endpoint accepts exactly ONE statement
-- per body, db/migrations/apply.mjs runs them individually with no
-- transaction, and an apply interrupted halfway must be recoverable by
-- running this same file again. Constraints use the idempotent
-- drop-then-add pair, 076/078/081's shape.

alter table vy_room
  add column if not exists handoff_enabled boolean not null default false;

alter table vy_room
  add column if not exists handoff_monthly_cap integer not null default 5;

alter table vy_room
  drop constraint if exists vy_room_handoff_monthly_cap_band;

alter table vy_room
  add constraint vy_room_handoff_monthly_cap_band
  check (handoff_monthly_cap >= 0 and handoff_monthly_cap <= 50);

create table if not exists vy_room_handoff (
  handoff_id      uuid primary key,
  room_id         uuid not null references vy_room(room_id) on delete cascade,
  person_id       uuid not null,
  follower_id     uuid not null references vy_room_follower(follower_id) on delete cascade,
  thread_id       uuid references vy_room_thread(thread_id) on delete cascade,
  payload_text    text not null check (length(payload_text) between 1 and 4000),
  payload_sha256  text not null check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  policy_version  integer not null default 1,
  state           text not null default 'drafted'
    check (state in ('drafted','sent','answered','withdrawn')),
  reply_text      text not null default '' check (length(reply_text) <= 4000),
  month_key       text not null default '',
  sent_at         timestamptz,
  answered_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint vy_room_handoff_sent_shape check (
    (state in ('sent','answered','withdrawn')) = (sent_at is not null)
  ),
  constraint vy_room_handoff_answered_shape check (
    (state = 'answered') = (answered_at is not null)
  )
);

create index if not exists vy_room_handoff_queue_ix
  on vy_room_handoff (room_id, state, sent_at);
create index if not exists vy_room_handoff_person_ix
  on vy_room_handoff (person_id, room_id);
create index if not exists vy_room_handoff_cap_ix
  on vy_room_handoff (follower_id, month_key, state);
