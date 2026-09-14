-- Migration 089 - abuse limits on the public doors (WS-R26).
--
-- ── the problem this closes ────────────────────────────────────────────────
--
-- The free cap (migration 077's own predicate, api/_room-surface.js's
-- `spend UPDATE`) limits messages per FOLLOWER, month over month. Nothing
-- limits what happens BEFORE a follower exists: `open` and `join` on
-- api/room.js, `apply` on api/apply.js, the Telegram webhook, the payments
-- webhook, and the push-subscribe op all accept an unauthenticated or
-- weakly-authenticated POST, and a scripted loop against any one of them can
-- mint follower rows or burn a budget (SMS, a payment provider's own request
-- allotment) with nobody's monthly cap ever in play. `api/_ratelimit.js`'s
-- existing `allow()` already sits in front of several of these doors, but by
-- its own header it is "in-memory per warm lambda" - a fresh cold start, or a
-- deploy to a second region, resets every counter it holds. This migration
-- gives the same shape of check a persistent home in SQL, for the doors
-- where that reset is the difference between "rate limited" and "not".
--
-- ── ONE counter table, and the check is a write, never a read-then-write ───
--
-- `vy_public_rate` holds one row per (scope, hashed key, fixed window). The
-- predicate that decides whether a call is allowed is the SAME statement
-- that records the call - api/_rate-limit.js's `consume()` runs exactly one
-- upsert:
--
--   insert into vy_public_rate (scope, key_hash, window_start, count)
--   values ($1, $2, $3, 1)
--   on conflict (scope, key_hash, window_start) do update
--     set count = vy_public_rate.count + 1
--     where vy_public_rate.count < $4
--   returning count
--
-- A caller under the limit gets a row back (its NEW count). A caller AT the
-- limit gets zero rows: the `where` clause on the UPDATE arm refuses the
-- write, so the count for that window is left exactly at the limit rather
-- than incremented past it, and Postgres's own MVCC makes this safe under
-- concurrent callers hitting the same key in the same window - two racing
-- requests at the limit cannot both slip through, because the second one's
-- UPDATE sees the first one's already-committed count (or waits for it, then
-- re-evaluates the WHERE, standard upsert-under-contention behaviour). A
-- read-then-write (`select count; if count < limit then insert/update`)
-- would have exactly this race: two readers can both see "under the limit"
-- before either writes.
--
-- ── the key is a HASH, never the raw IP or contact ─────────────────────────
--
-- `key_hash` is sha256 of (scope, the caller's own key - an IP for an
-- anonymous door, a follower id for a session door, a contact string for
-- apply - a daily salt). See api/_rate-limit.js's `hashKey` for the exact
-- construction. This table is therefore NOT a record of who accessed what:
-- the hash cannot be reversed to an IP or a contact without also knowing the
-- day's salt, and even with the salt it names only "the same caller hit
-- twice", never which caller. `scope` and `window_start` are the platform's
-- own facts (which door, which minute), not a person's.
--
-- ── PLATFORM TABLE, no person/device/owner column, by construction ─────────
--
-- Checked against evals/persontables.mjs's PERSON_COLUMNS list before this
-- migration was written: `person_id`, `device_id`, `user_id`, `auth_user_id`,
-- `subject_person_id`, `speaker_person_id`, `granted_by`, `granted_to`,
-- `owner_user_id`, `redeemed_by_user_id`. This table has none of them -
-- `scope`, `key_hash`, `window_start`, `count` - so the offline scanner never
-- flags it and it needs NO entry in that file's EXEMPT map (unlike migration
-- 086's two tables, which do). The same reasoning migration 084's
-- `vy_sweep_run` gives for itself: a hash of a key salted per day is a fact
-- about THE PLATFORM's own defenses, not a record reachable back to a
-- person, so it needs no PERSON_TABLES entry (api/memory.js), no wiring into
-- the erasure cascade (api/_replica-full-erasure.js), and no entry in
-- scripts/relcheck.mjs's PERSON_COLUMNS/EXEMPT maps or its owner-lane reach
-- walk - there is no owner or person edge here for that walk to reach.
--
-- ── fixed windows keep the table bounded ────────────────────────────────────
--
-- `window_start` is always the start of the current minute or hour (computed
-- in JS - see the note on 086 about why an expression index on a mutable
-- cast is rejected at DDL time; the same reasoning applies here, so this
-- migration stores a plain, already-truncated timestamptz rather than
-- indexing an expression), never "now() minus N seconds" sliding. A caller
-- gets at most one row per scope per window rather than one row per request,
-- and `evals/room-leak`-style unbounded growth is closed by
-- `purgeStalePublicRateWindows` (api/_rate-limit.js), run inside the
-- check-ins sweep (api/checkins-sweep.js, migration 084's `vy_sweep_run`
-- heartbeat already wraps it) and deleting any window more than a day old -
-- generous headroom over this table's own longest window (one hour).
--
-- ── one statement per request, idempotent, no DO blocks, no functions ──────
-- 009's law, restated by every migration since: Neon's SQL-over-HTTP
-- endpoint accepts exactly one statement per body.
create table if not exists vy_public_rate (
  scope        text not null check (length(scope) > 0 and length(scope) <= 64),
  key_hash     text not null check (length(key_hash) = 64),
  window_start timestamptz not null,
  count        integer not null default 0 check (count >= 0),
  updated_at   timestamptz not null default now(),
  primary key (scope, key_hash, window_start)
);

-- The retention sweep's own access path: "every window older than a day",
-- across all scopes and keys at once. A plain range scan on `window_start`
-- covers it; no per-scope index is needed for that query, and the primary
-- key above already covers the upsert's own ON CONFLICT target.
create index if not exists vy_public_rate_window_ix
  on vy_public_rate (window_start);
