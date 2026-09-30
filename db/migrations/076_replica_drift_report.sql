-- Migration 076 — vy_replica_drift_report: the history behind
-- "it notices drift". WS-R9.
--
-- Contract: Vyakti Rooms plan, the creator's weekly loop — "Drift: a monthly
-- fidelity report, and an alert the day the score moves" — and the caught
-- swap the plan cites by name: "we have already caught a provider silently
-- swapping a model within four days under the same name"
-- (context/measurements.md `vision-drift-4day`).
--
-- Idempotent, ONE STATEMENT PER REQUEST — 001's law, restated by
-- 009/051/054/056/058/059/062/073 and binding here for the same reason:
-- Neon's SQL-over-HTTP endpoint takes exactly one statement per request, and
-- an apply interrupted halfway must be recoverable by running this file
-- again. NO DO blocks and no functions. Constraints use the idempotent
-- drop-then-add pair.
--
-- ── WHY A HISTORY TABLE, NOT A COMPUTED-ON-READ NUMBER ────────────────────
-- api/_drift-watch.js's report is pure and cheap to recompute, and unlike
-- migration 073's readiness snapshot, nothing here gates an activation or a
-- channel connect — drift watch is a MONITOR, not a lock, so there is no SQL
-- predicate downstream that needs one exact compute captured. This table
-- exists for the other reason 073 gives, which stands on its own: "a number
-- nobody can compare to a previous one answers nothing." `trend` inside one
-- row is 30 days; this table is what lets the row from six weeks ago still be
-- read, and it is what an alert points at.
--
-- ── WHY score/ceiling ARE NULLABLE COLUMNS AND state IS NOT ───────────────
-- DESIGN-LAW §1, restated for a monitor rather than a gate: a replica with no
-- standing fidelity row and no owner ceiling is NOT a zero and NOT "steady",
-- it is not_measured, and the constraint below makes that unrepresentable any
-- other way rather than merely observed:
--
--   vy_replica_drift_report_measured_shape   state='not_measured' only when
--                                            score or ceiling is absent; state
--                                            in ('steady','moved') only when
--                                            BOTH are present. A row that
--                                            claims "steady" with no score
--                                            behind it is exactly the fake
--                                            number this table exists to make
--                                            impossible.
--
-- ── WHY alerted_at IS PAIRED TO state='moved' ─────────────────────────────
-- "An alert is a row with alerted_at, surfaced in the studio; no email or
-- push" (this workstream's brief) — so alerted_at is set by the WRITE
-- statement itself, in the same insert that decides state, never by a second
-- statement a crashed sweep could skip. The constraint below makes "alerted
-- but not moved" unrepresentable, because an alert on a steady report would
-- be exactly the kind of noise that gets an alerting mechanism ignored.
--
-- ── NO FOREIGN KEY, DELETED BY NAME ───────────────────────────────────────
-- 009's convention for owner/replica-keyed tables, restated by 073 for
-- vy_replica_readiness: the binding is a WHERE clause, not a constraint.
-- scripts/relcheck.mjs's owner-lane reach walk requires this table reachable
-- either by cascade or by name in api/_replica-full-erasure.js; it is
-- reachable by name there, in the same CTE as vy_replica_readiness, on the
-- same reasoning: a drift history is a dated record of how closely we thought
-- a named person's clone still sounded like them, and it outliving the
-- deletion receipt would be exactly the standing claim revocation is meant to
-- end.

create table if not exists vy_replica_drift_report (
  report_id                uuid primary key default gen_random_uuid(),
  replica_id               uuid not null,
  owner_user_id            uuid not null,
  computed_at              timestamptz not null default now(),
  state                    text not null,
  score                    double precision,
  ceiling                  double precision,
  trend                    jsonb not null default '[]'::jsonb,
  last_model_change_at     timestamptz,
  last_model_commitment    text,
  prosody_anchor_stale     boolean not null,
  inputs_hash              text not null,
  alerted_at               timestamptz
);

alter table vy_replica_drift_report
  drop constraint if exists vy_replica_drift_report_state_check;
alter table vy_replica_drift_report
  add constraint vy_replica_drift_report_state_check
  check (state in ('steady','moved','not_measured'));

-- The no-fake-numbers law, as a constraint rather than a branch. See the
-- header: state='not_measured' cannot carry both halves of the measurement,
-- and state in ('steady','moved') cannot carry neither.
alter table vy_replica_drift_report
  drop constraint if exists vy_replica_drift_report_measured_shape;
alter table vy_replica_drift_report
  add constraint vy_replica_drift_report_measured_shape
  check (
    (state = 'not_measured' and (score is null or ceiling is null))
    or (state in ('steady','moved') and score is not null and ceiling is not null)
  );

-- Cosine similarity is bounded [-1, 1]; a self-similarity ceiling is bounded
-- (0, 1] in practice (it is a same-speaker mean, never non-positive on real
-- evidence, and never above the identical-vector cap of 1).
alter table vy_replica_drift_report
  drop constraint if exists vy_replica_drift_report_score_range;
alter table vy_replica_drift_report
  add constraint vy_replica_drift_report_score_range
  check (score is null or (score >= -1 and score <= 1));

alter table vy_replica_drift_report
  drop constraint if exists vy_replica_drift_report_ceiling_range;
alter table vy_replica_drift_report
  add constraint vy_replica_drift_report_ceiling_range
  check (ceiling is null or (ceiling > 0 and ceiling <= 1));

alter table vy_replica_drift_report
  drop constraint if exists vy_replica_drift_report_inputs_hash;
alter table vy_replica_drift_report
  add constraint vy_replica_drift_report_inputs_hash
  check (inputs_hash ~ '^[0-9a-f]{64}$');

-- A content-free commitment hash, the same shape `vy_replica_voice_trial` and
-- `vy_replica_voice_delivery_policy` already use for `model_commitment`, and
-- `preview_model_commitment` on `vy_replica_generation` itself (migration 044).
alter table vy_replica_drift_report
  drop constraint if exists vy_replica_drift_report_commitment_hash;
alter table vy_replica_drift_report
  add constraint vy_replica_drift_report_commitment_hash
  check (last_model_commitment is null or last_model_commitment ~ '^[0-9a-f]{64}$');

-- A swap date without its hash (or the reverse) is a half-written fact.
alter table vy_replica_drift_report
  drop constraint if exists vy_replica_drift_report_swap_pairs;
alter table vy_replica_drift_report
  add constraint vy_replica_drift_report_swap_pairs
  check ((last_model_change_at is null) = (last_model_commitment is null));

alter table vy_replica_drift_report
  drop constraint if exists vy_replica_drift_report_trend_array;
alter table vy_replica_drift_report
  add constraint vy_replica_drift_report_trend_array
  check (jsonb_typeof(trend) = 'array' and octet_length(trend::text) <= 8192);

-- "An alert is a row with alerted_at" — and only a 'moved' row may carry one.
-- A steady report with an alert timestamp would be exactly the false alarm
-- that trains a creator to stop reading this card.
alter table vy_replica_drift_report
  drop constraint if exists vy_replica_drift_report_alert_shape;
alter table vy_replica_drift_report
  add constraint vy_replica_drift_report_alert_shape
  check (alerted_at is null or state = 'moved');

-- THE LATEST-ROW LOOKUP. Every reader (the owner GET, the sweep's own guard,
-- a future studio alert list) asks the same question: the newest report for
-- this owner's replica.
create index if not exists vy_replica_drift_report_latest_ix
  on vy_replica_drift_report (replica_id, owner_user_id, computed_at desc);

-- The sweep's write guard: "does the NEWEST row already carry this
-- inputs_hash." Same shape as 073's vy_replica_readiness_inputs_ix, and the
-- same reason it is not partial on either column: a repeat hash after an
-- intervening different one is a real event (drifted, then recovered) and
-- must be storable.
create index if not exists vy_replica_drift_report_inputs_ix
  on vy_replica_drift_report (replica_id, inputs_hash, computed_at desc);

-- Alerts, surfaced. Partial so an owner with a long steady history never
-- makes this index bigger than the thing it is for: finding the alerts.
create index if not exists vy_replica_drift_report_alerts_ix
  on vy_replica_drift_report (owner_user_id, alerted_at desc)
  where alerted_at is not null;
