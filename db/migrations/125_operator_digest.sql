-- Migration 125 - the operator's morning digest (WS-R88).
--
-- WS-R62 (migration 114) built a subscription store and a once-a-day "a new
-- door started failing" push. WS-R76 (migration 120) taught the deployment
-- to check on itself every morning at 02:30 UTC. Neither answers the ops
-- board's own everyday questions unless someone opens the board: is the
-- product alive, did anything break, did anyone show up. This table is the
-- send ledger for the ONE push a day that answers all of that, at once, on
-- the operator's own phone.
--
-- ── one row per DAY, never per subscription ────────────────────────────────
--
-- `day` is UNIQUE - the whole idempotency mechanism, `vy_creator_weekly_push`
-- (migration 118)'s own `(room_id, week_start)` unique index restated for a
-- platform-wide digest instead of a per-Room one: `api/_operator-digest.js`'s
-- `sendOperatorDigest` claims TODAY's row with a single
-- `insert ... on conflict (day) do nothing returning digest_id`, and only a
-- WINNING claim ever attempts a push. A second sweep tick the same day (a
-- retried cron invocation, an overlapping run past `maxDuration`) gets zero
-- rows back and sends nothing more - decided by the unique index itself,
-- never a JS `if` a future caller could route around
-- (`context/decisions.md#ws-r58-notify-claim-only-marks-notified-with-a-
-- configured-recipient`'s own "the WHERE decides, not a JS if" discipline,
-- restated a fourth time for this table).
--
-- ── content-free BY SCHEMA, not by convention ──────────────────────────────
--
-- No person_id, no owner_user_id, no replica_id, no room_id, no follower id
-- of any shape, and no free-text column at all - `vy_sweep_run` (084) and
-- `vy_incident` (109)'s own precedent restated a third time: `counts` is a
-- small jsonb digest of `api/_operator-digest.js#digestCounts`'s own return
-- value, run through `api/_sweep-run.js`'s `sanitizeCounts()` before it ever
-- reaches this table (workstream law 1) - only numbers and booleans survive.
-- The two CHECKs below are redundant with that sanitizer BY DESIGN, the same
-- two-independent-reasons argument `vy_sweep_run`'s own header makes: a
-- schema constraint and a JS sanitizer are two different things that would
-- both have to fail together for a stray string to land here.
--
-- ── not a person table ──────────────────────────────────────────────────
--
-- This table cannot name who anything happened to, only how many Rooms were
-- live, how many followers joined (itself floored at n>=5 by
-- `api/_operator-digest.js#digestCounts` before it is even computed - "one
-- follower joined one Room" is a person, workstream law 2's own words),
-- how many messages moved, how much money moved, and whether the self-check
-- and incidents cards were clean - `vy_sweep_run`/`vy_incident`'s own "no
-- person/owner column by construction, so it needs no PERSON_TABLES entry,
-- no erasure wiring and no scripts/relcheck.mjs exemption" restated
-- verbatim, because the shape is the same shape.
--
-- ── one statement per request, idempotent, no DO blocks ────────────────────
-- 009's law, restated by every migration since.
create table if not exists vy_operator_digest (
  digest_id  uuid primary key,
  day        date not null,
  sent_at    timestamptz not null default now(),
  counts     jsonb not null default '{}'::jsonb
);

-- THE dedupe. See this migration's own header: an
-- `insert ... on conflict (day) do nothing` against this index is the whole
-- "one digest per day, never per subscription" guarantee.
create unique index if not exists vy_operator_digest_day_ix
  on vy_operator_digest (day);

-- `counts` must stay a JSON OBJECT (never an array or a scalar) and must
-- clear the same byte cap `vy_sweep_run_counts_size` (084) already argues
-- for - restated here rather than re-derived.
alter table vy_operator_digest drop constraint if exists vy_operator_digest_counts_object;
alter table vy_operator_digest add constraint vy_operator_digest_counts_object
  check (jsonb_typeof(counts) = 'object');
alter table vy_operator_digest drop constraint if exists vy_operator_digest_counts_size;
alter table vy_operator_digest add constraint vy_operator_digest_counts_size
  check (octet_length(counts::text) <= 4096);

-- The board's own read ("Last digest", its sent time) and the sweep's own
-- claim - both want the single most recent row, so a plain index on `day`
-- descending serves either without needing to know anything else ahead of
-- time.
create index if not exists vy_operator_digest_day_desc_ix
  on vy_operator_digest (day desc);
