-- Migration 073 — vy_replica_readiness: the snapshot behind the one screen.
--
-- Contract: Vyakti Rooms v1. The creator sees one number, five parts, one
-- suggested action, and a publish lock. WS-R3.
--
-- Idempotent, ONE STATEMENT PER REQUEST — 001's law, restated by
-- 009/051/054/056/058/059/062 and binding here for the same reason: Neon's
-- SQL-over-HTTP endpoint takes exactly one statement per request, there is no
-- transaction across statements, and an apply interrupted halfway must be
-- recoverable by running this file again. NO DO blocks and no functions:
-- db/migrations/apply.mjs's splitter is deliberately small and does not handle
-- them. Constraints therefore use the drop-then-add idempotent pair.
--
-- ── WHY A SNAPSHOT TABLE AND NOT A COMPUTED-ON-READ NUMBER ───────────────
-- Two reasons, and only the second one is about performance.
--
-- 1. THE PUBLISH LOCK HAS TO BE A SQL PREDICATE. `gate0-structural`, quoted by
--    migration 051: "prompt instructions leaked 57-98%; the SQL predicate
--    leaked 0 of 31,122 ... A sentence in a brief is a preference; a predicate
--    on the output is a guarantee." The same argument holds one axis over: a
--    readiness check evaluated in the browser, or in JS beside the activation
--    write, is a preference. A row the activation statement JOINS against is a
--    guarantee. That join needs something to join to, and this is it.
--
-- 2. A number nobody can compare to a previous one answers nothing. The house
--    rule for `context/measurements.md` is that a number without n, method and
--    date cannot be compared against a future one, "which is the only thing
--    numbers are for". `parts` carries n and method PER PART, `computed_at` is
--    the date, and history is kept rather than overwritten so a creator can be
--    told their clone got worse.
--
-- ── THE THREE DERIVED SCALARS, AND WHY THEY ARE COLUMNS ─────────────────
-- `parts` is the truth and `overall` / `min_part` / `unmeasured_count` are
-- projections of it. They are columns rather than jsonb reads because the lock
-- predicate is `unmeasured_count = 0 and overall >= 70 and min_part >= 55`,
-- and that predicate lives inside two much larger statements (the runtime
-- activation CTE, the channel connect write) where a jsonb path expression is
-- the kind of thing a later edit gets subtly wrong. A wrong lock opens.
--
-- ── THE LAW THE CHECK CONSTRAINTS ENCODE ────────────────────────────────
-- DESIGN-LAW §1, no fake numbers. A part with no instrument renders as "not
-- measured yet"; it never renders as 0 and never as a placeholder. The overall
-- is UNDEFINED until every part has a value. Two constraints make the second
-- half of that unrepresentable rather than merely observed:
--
--   vy_replica_readiness_overall_undefined  overall IS NULL whenever any part
--                                           is unmeasured, and NOT NULL when
--                                           none is. Both directions, because
--                                           a row with five measured parts and
--                                           a null overall would lock a clone
--                                           that had earned its way out.
--   vy_replica_readiness_min_part_pairs     min_part travels with overall. A
--                                           min without an overall (or the
--                                           reverse) is a half-written row and
--                                           the lock predicate would read it
--                                           as a pass on one of the two.
--
-- `unmeasured_count` is capped at the number of parts the policy defines (5).
-- A sixth part is a policy-version bump, not a wider check.
--
-- ── NO FOREIGN KEY, DELETED BY NAME ─────────────────────────────────────
-- 009's convention for owner/replica-keyed tables: the binding is a WHERE
-- clause, not a constraint. `scripts/relcheck.mjs`'s owner-lane reach walk
-- accepts either a cascade from vy_replica or an explicit delete by name, and
-- api/_replica-full-erasure.js deletes this table by name in the same CTE as
-- vy_replica_activity. That is the layer that is actually re-checked.

create table if not exists vy_replica_readiness (
  readiness_id     uuid primary key default gen_random_uuid(),
  replica_id       uuid not null,
  owner_user_id    uuid not null,
  computed_at      timestamptz not null default now(),
  policy_version   text not null default '',
  overall          integer,
  min_part         integer,
  unmeasured_count integer not null,
  parts            jsonb not null default '{}'::jsonb,
  blockers         jsonb not null default '[]'::jsonb,
  suggested_action jsonb not null default '{}'::jsonb,
  inputs_hash      text not null
);

alter table vy_replica_readiness
  drop constraint if exists vy_replica_readiness_unmeasured_range;

alter table vy_replica_readiness
  add constraint vy_replica_readiness_unmeasured_range
  check (unmeasured_count >= 0 and unmeasured_count <= 5);

alter table vy_replica_readiness
  drop constraint if exists vy_replica_readiness_overall_range;

alter table vy_replica_readiness
  add constraint vy_replica_readiness_overall_range
  check (overall is null or (overall >= 0 and overall <= 100));

alter table vy_replica_readiness
  drop constraint if exists vy_replica_readiness_min_part_range;

alter table vy_replica_readiness
  add constraint vy_replica_readiness_min_part_range
  check (min_part is null or (min_part >= 0 and min_part <= 100));

-- The no-fake-numbers law, as a constraint rather than a branch.
alter table vy_replica_readiness
  drop constraint if exists vy_replica_readiness_overall_undefined;

alter table vy_replica_readiness
  add constraint vy_replica_readiness_overall_undefined
  check ((unmeasured_count > 0 and overall is null) or (unmeasured_count = 0 and overall is not null));

alter table vy_replica_readiness
  drop constraint if exists vy_replica_readiness_min_part_pairs;

alter table vy_replica_readiness
  add constraint vy_replica_readiness_min_part_pairs
  check ((overall is null and min_part is null) or (overall is not null and min_part is not null));

alter table vy_replica_readiness
  drop constraint if exists vy_replica_readiness_inputs_hash;

alter table vy_replica_readiness
  add constraint vy_replica_readiness_inputs_hash
  check (inputs_hash ~ '^[0-9a-f]{64}$');

alter table vy_replica_readiness
  drop constraint if exists vy_replica_readiness_parts_object;

alter table vy_replica_readiness
  add constraint vy_replica_readiness_parts_object
  check (jsonb_typeof(parts) = 'object' and jsonb_typeof(suggested_action) = 'object'
         and jsonb_typeof(blockers) = 'array');

-- THE LOCK'S INDEX. Every gate that consults readiness asks the same question:
-- what is the newest snapshot for this owner's replica. Descending on
-- computed_at makes that a one-row lookup rather than a sort over the history
-- this table exists to keep.
create index if not exists vy_replica_readiness_latest_ix
  on vy_replica_readiness (replica_id, owner_user_id, computed_at desc);

-- At-most-once per distinct input set. `inputs_hash` covers every number the
-- screen model was computed from, so a re-compute that changes nothing writes
-- nothing and the history stays a record of CHANGES rather than of polls. It
-- is partial on neither column because a repeat hash after an intervening
-- different one is a real event (a part went down and came back) and must be
-- storable; the writer's own guard is "same hash as the NEWEST row", which is
-- the version of this rule that keeps that event.
create index if not exists vy_replica_readiness_inputs_ix
  on vy_replica_readiness (replica_id, inputs_hash, computed_at desc);
