-- Migration 084 - the sweep heartbeat: one row per cron invocation, so the
-- ops board (WS-R21) can answer "is the Room alive" without a database
-- client and without ever reading a follower's words.
--
-- ── the problem this closes ────────────────────────────────────────────────
--
-- Phase 0 is one creator and 100 followers watched by one person, and that
-- person has no screen today: drift watch fires every 6 hours, check-ins
-- every 15 minutes, Pulse weekly, and every one of those crons (`vercel.json`)
-- can silently stop firing, silently start erroring, or silently do nothing
-- because a feature flag is off - and nothing anywhere writes that down. A
-- cron that used to answer `{ok:true}` on a 500 is `never-scheduled`'s twin:
-- invisible the moment it stops, not because it was never wired but because
-- wired-and-silent looks identical to working from the outside.
--
-- ── one row per run, written at start AND finish ───────────────────────────
--
-- `api/_sweep-run.js`'s `withSweepRun()` INSERTs this row the moment a sweep
-- begins (`outcome = 'running'`, `finished_at` null) and UPDATEs the SAME row
-- when it ends. That is deliberate, not merely convenient: a sweep that hangs
-- past its own `maxDuration` (Vercel kills the invocation, no code of ours
-- runs again) leaves a row stuck at `outcome = 'running'` forever, which is
-- itself the honest signal - the alternative (write once, at the end, from a
-- `finally` block) would leave NO row at all for a hard-killed invocation,
-- the exact `sound-gate-proved-by-silence` shape this table exists to avoid.
--
-- `outcome` is a CHECK, not a comment: 'running' while in flight, then one of
-- 'ok' / 'partial' / 'failed' at finish. 'partial' is for a sweep that
-- completed but reported some rows failed inside it (WS-R21's own summaries
-- already carry an `errors`/`errored` count for exactly this); 'failed' is
-- for a sweep whose invocation itself threw, caught by `withSweepRun`'s own
-- try/catch so the row is written before the error is rethrown to the
-- handler's existing error path - nothing here swallows an error, it only
-- makes sure one gets recorded before it propagates (proved by
-- evals/ops/run.mjs's negative control (d)).
--
-- ── content-free by construction, stated once here rather than argued later ─
--
-- No person_id, no device_id, no owner_user_id, no follower id of any shape -
-- a sweep run is a fact about THE PLATFORM's own clockwork, not about any one
-- person, so it needs no PERSON_TABLES entry (api/memory.js) and no wiring
-- into the erasure cascade (api/_replica-full-erasure.js): there is nothing
-- here forget or export could ever need to reach. `scripts/relcheck.mjs`'s
-- manifest-coverage sweep enumerates every `vy_%`/`meera_%` table carrying a
-- person/device/owner-shaped column (`PERSON_COLUMNS`, that script's own
-- list) - this table carries none of them, so it is invisible to that check
-- by construction and needs no entry in its `EXEMPT` map. If a future edit
-- ever adds one of those columns here, `relcheck` will start failing on it
-- immediately, which is the point: the exemption is earned by having nothing
-- to exempt, not by being told about later.
--
-- `counts` is a small jsonb digest of a sweep's OWN return value, and
-- `api/_sweep-run.js`'s `sanitizeCounts()` is what keeps it that way: only
-- numbers and booleans survive, one level deep, and an array collapses to its
-- length. A sweep summary carrying `error_details: [{room_id, message}]`
-- (several of this repo's sweeps do, e.g. api/_pulse.js's `runPulseSweep`)
-- writes `error_details: 1` here, never the room id or the message text. The
-- `check (...) <= 4096` below is redundant with that sanitizer by design -
-- two independent reasons a stray text field can never land in this table,
-- because a JSON size limit alone would still let through 4096 bytes of
-- somebody's name if the sanitizer regressed.
--
-- ── one statement per request, idempotent, no DO blocks ────────────────────
-- 009's law, restated by every migration since: Neon's SQL-over-HTTP endpoint
-- accepts exactly one statement per body, so every statement below is
-- independently re-runnable.
create table if not exists vy_sweep_run (
  run_id       uuid primary key,
  sweep        text not null check (length(sweep) > 0 and length(sweep) <= 80),
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  outcome      text not null default 'running',
  counts       jsonb not null default '{}'::jsonb,
  error_code   text not null default ''
);

alter table vy_sweep_run drop constraint if exists vy_sweep_run_outcome_check;
alter table vy_sweep_run add constraint vy_sweep_run_outcome_check
  check (outcome in ('running', 'ok', 'partial', 'failed'));

-- `counts` must stay a JSON OBJECT (never an array or a scalar - the board
-- reads named fields off it) and must clear the byte cap the header argues
-- for, restated here as a real constraint rather than a hope.
alter table vy_sweep_run drop constraint if exists vy_sweep_run_counts_object;
alter table vy_sweep_run add constraint vy_sweep_run_counts_object
  check (jsonb_typeof(counts) = 'object');
alter table vy_sweep_run drop constraint if exists vy_sweep_run_counts_size;
alter table vy_sweep_run add constraint vy_sweep_run_counts_size
  check (octet_length(counts::text) <= 4096);

-- A 'failed'/'ok'/'partial' row with no finished_at, or a 'running' row WITH
-- one, is a state this table's own writer (`withSweepRun`) never produces -
-- made unrepresentable rather than merely avoided, the same discipline 076's
-- `vy_replica_drift_report` uses for its own state/score pairing.
alter table vy_sweep_run drop constraint if exists vy_sweep_run_finished_matches_outcome;
alter table vy_sweep_run add constraint vy_sweep_run_finished_matches_outcome
  check (
    (outcome = 'running' and finished_at is null)
    or (outcome <> 'running' and finished_at is not null)
  );

-- The board's own read: "the latest run per sweep", `distinct on (sweep)`
-- ordered by `started_at desc` - this index carries that access path exactly
-- and doubles as the staleness scan (evals/ops's own read pattern).
create index if not exists vy_sweep_run_sweep_started_ix
  on vy_sweep_run (sweep, started_at desc);
