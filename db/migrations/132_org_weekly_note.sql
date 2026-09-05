-- Migration 132 - the Suite admin's weekly note (WS-R127).
--
-- WS-R74 (migration 118) gave a CREATOR a weekly push about their own Room.
-- The Suite admin - the one who actually bought the seats - gets nothing:
-- "a coaching institute that bought five seats has no idea whether anyone
-- used them" (this workstream's own brief, verbatim). This migration is the
-- content-free send ledger for the admin-facing equivalent, restating
-- `vy_creator_weekly_push`'s (118) own shape one lane over rather than
-- inventing a new one.
--
-- ONE table. `(org_id, week_start, channel)` unique is the WHOLE idempotency
-- mechanism - an `INSERT ... ON CONFLICT (org_id, week_start, channel) DO
-- NOTHING` is what refuses a second send on the same Suite, the same week,
-- the same channel, structurally, the same discipline `vy_creator_weekly_
-- push`'s own unique (room_id, week_start) index already carries one table
-- over. `channel` (`push`/`email`) is its own column, never folded into a
-- second table per channel, because the SAME Suite/week can legitimately
-- send on BOTH channels without either being "the second send" of the
-- other - `api/_org-weekly-note.js`'s own header names why `email` claims a
-- row today even though no sender exists yet (`api/_email-seam.js`'s own
-- header: "records a would-send incident, never a network call").
--
-- NO COUNTS COLUMN, on purpose, unlike `vy_creator_weekly_push` (which
-- stores followers_count/messages_count) and `vy_operator_digest` (which
-- stores a `counts` jsonb): this note's own numbers are recomputed fresh
-- every time (the real send, AND the admin's own "Send a test note now"),
-- through `api/_org-weekly-note.js#buildOrgWeeklyNote`, never persisted -
-- there is nothing here for a future reader to misread as a snapshot of a
-- week's truth after the underlying Rooms have since changed, and nothing
-- here a leak of THIS table alone could ever turn into a follower fact: the
-- four columns below are org_id, a date, a timestamp and a six-letter enum.
--
-- NO FK on org_id, unlike `vy_org_member`/`vy_org_subscription`/`vy_room_
-- org_attachment` (091/095/108), which all carry `references vy_org(org_id)
-- on delete cascade`: this table is deliberately NOT wired to disappear by
-- CASCADE the day an org row is ever deleted, because - like `vy_org`
-- itself (091's own header: "the org survives a creator's own erasure even
-- as its last admin") - a send LEDGER is a record of what this platform
-- did, not a possession of the org's that should vanish with it. Suites v0
-- has no org-deletion operation anywhere in this codebase (grepped, not
-- assumed - `context/decisions.md#ws-r127-org-weekly-note-no-fk-no-owner-
-- erasure-reach` names the search and the reversal condition: the day an
-- eraseOrg operation ships, add an explicit `delete from vy_org_weekly_note
-- where org_id = $1` beside it, by name, exactly as `vy_org_member`'s own
-- ON DELETE CASCADE already handles the membership half of the same event).
--
-- OWNER LANE, not PERSON_TABLES: this table carries no `owner_user_id`, no
-- `person_id`, no follower-identifying column of any kind - `org_id` alone,
-- exactly `vy_org_subscription`'s own shape (091/095). It is therefore
-- OUTSIDE both `api/memory.js`'s PERSON_TABLES manifest and `scripts/
-- relcheck.mjs`'s owner-lane erasure-reach walk (that walk scans for
-- `owner_user_id`/`redeemed_by_user_id` columns specifically - neither
-- exists here, so the walk correctly never asks this table to justify
-- itself, the identical non-finding it already reports for `vy_org` and
-- `vy_org_subscription` today). It is likewise outside `api/_creator-
-- export.js`'s OWNER_LANE_TABLES for the same reason `vy_org`/`vy_org_
-- subscription` are: that manifest names exactly the owner-lane subset of
-- what `api/_replica-full-erasure.js` reaches, and that file never reaches
-- an org-scoped-only table with no owner_user_id/replica_id column at all.
--
-- Idempotent, one statement per request (Neon SQL-over-HTTP), no DO blocks,
-- explicit ::uuid casts on every comparison in the code that reads this
-- table (api/_org-weekly-note.js, api/org-weekly-note-sweep.js, api/org.js).
create table if not exists vy_org_weekly_note (
  note_id    uuid primary key,
  org_id     uuid not null,
  week_start date not null,
  sent_at    timestamptz not null default now(),
  channel    text not null check (channel in ('push', 'email'))
);
-- THE dedupe. See this migration's own header: an INSERT ... ON CONFLICT
-- (org_id, week_start, channel) DO NOTHING against this index is the whole
-- "no second send for the same Suite, week and channel" guarantee.
create unique index if not exists vy_org_weekly_note_org_week_channel_ix
  on vy_org_weekly_note (org_id, week_start, channel);
-- The Suite board's own "Last delivered" read (api/_org.js's `listMyOrgs`,
-- `orgBoard`): most recent sends for one Suite, newest first -
-- `vy_creator_weekly_push_room_sent_ix`'s own precedent (migration 118)
-- restated for an org instead of a room.
create index if not exists vy_org_weekly_note_org_sent_ix
  on vy_org_weekly_note (org_id, sent_at desc);
