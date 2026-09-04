-- Migration 107 - Suites sell themselves (WS-R48).
--
-- Two independent additions, both additive and idempotent, no DO blocks, one
-- statement per request (Neon's SQL-over-HTTP endpoint accepts exactly one):
--
-- 1. `vy_creator_application.intent` (WS-R23, migration 086). "Someone who
--    wants to talk first" from the Suites landing page uses the SAME apply
--    form and the SAME rate limit as a creator application always has -
--    api/_apply.js's `submitApplication` gains an `intent` argument rather
--    than a second endpoint. The existing free-text `audience` column was
--    considered and rejected as the place to carry this: it already means
--    "who is your audience", and overloading it to also mean "why are you
--    applying" would make BOTH fields lossy for every future reader of this
--    table, api/_ops.js's own applications count included. A real column,
--    not a second literal meaning stuffed into an existing one.
--
--    `not null default 'creator'` backfills every existing row (a real
--    default, not a nullable column standing in for one) - the table has
--    carried only creator applications until this migration, so 'creator' is
--    not a guess, it is what every row already is. The CHECK is added by the
--    drop-then-add pattern migration 096's own header names as "the only way
--    Postgres lets [a constraint] be widened" (here: added under a name this
--    migration owns from the start, so a second run of this file is still
--    idempotent - drop-if-exists then add is a no-op the second time).
--
--    No `vy_creator_application` erasure/PERSON_TABLES change: that table
--    carries no auth_user_id/owner_user_id/person_id column at all (migration
--    086's own header) and this column carries no more of a person's own
--    words than `status` already does.
--
-- 2. `vy_room.org_attached_at` (WS-R28's `attachRoom`, migration 091). Ops
--    needed an honest answer to "how many seats did a Suite attach THIS
--    WEEK", and `vy_room.updated_at` cannot answer it: every publish, pause,
--    price change and detach also touches `updated_at` (`api/_room-publish.js`
--    and `api/_org.js`'s own `detachRoom` all write it), so counting
--    `updated_at >= this week` would count Rooms whose Suite membership is
--    much older than the week being measured. A dedicated, nullable
--    timestamp, written ONLY by `attachRoom`'s own UPDATE and cleared ONLY by
--    `detachRoom`'s, is the honest signal - never derived from a column that
--    means several other things too.
--
--    No new PERSON_TABLES/erasure/relcheck entry: `vy_room` is already
--    reached by the owner-lane erasure cascade this column's own row already
--    goes through, and the column carries a timestamp, never a person's
--    words.
alter table vy_creator_application
  add column if not exists intent text not null default 'creator';
alter table vy_creator_application drop constraint if exists vy_creator_application_intent_check;
alter table vy_creator_application add constraint vy_creator_application_intent_check
  check (intent in ('creator','suite'));

alter table vy_room add column if not exists org_attached_at timestamptz null;
