-- Migration 109 - the incident ledger (WS-R58).
--
-- The ops board (WS-R21, migration 084's `vy_sweep_run`) knows a sweep ran.
-- It has never known that a door threw, that a provider answered 5xx, or
-- that a send failed, unless someone opened Vercel's own logs. This table
-- makes failure a row: one content-free daily count per (kind, door,
-- status), never a message, a stack, or any person/Room/replica id.
--
-- ── one statement per request, idempotent, no DO blocks ───────────────────
-- 009's law, restated by every migration since (078/091/095/098's own
-- headers, verbatim rationale, binding here for the identical reason):
-- Neon's SQL-over-HTTP endpoint accepts exactly ONE statement per body, and
-- an apply interrupted halfway must be recoverable by running this same
-- file again.
--
-- ── content-free BY SCHEMA, not by convention ──────────────────────────────
-- `kind` is CHECK-bounded to a closed list - api/_incidents.js's own
-- `INCIDENT_KINDS`, mirrored here so a future INSERT cannot widen the table
-- past what a human reviewed. `door` is a file name, bounded short. Every
-- other column is a number or a timestamp. There is no column this table
-- could ever carry a sentence, a stack trace, or an id in - the CHECK is the
-- enforcement, not a comment asking nicely (`evals/incidents/run.mjs`'s own
-- static scan of api/_incidents.js's INSERT text is the second, independent
-- guarantee one file over, `vy_sweep_run`'s `sanitizeCounts`-drops-content
-- precedent restated for a table instead of a JSON blob).
--
-- ── the key IS the upsert ───────────────────────────────────────────────
-- `(day, kind, door, status)` unique: `api/_incidents.js`'s `recordIncident`
-- upserts this exact tuple, incrementing `count` on conflict - one row per
-- day per failure shape, never one row per occurrence, so a door that fails
-- a thousand times in an afternoon costs this table exactly one write's
-- worth of rows, not a thousand.
--
-- ── notified_at lives ON THE ROW, not in a second table ────────────────────
-- The check-ins sweep's own new-kind alert (workstream law #4) claims a
-- single representative row for (day, kind) with one UPDATE whose WHERE
-- clause both selects a not-yet-notified row AND asserts the kind is absent
-- from the previous 7 days - the UPDATE'S WHERE IS THE WHOLE IDEMPOTENCY
-- MECHANISM, so two overlapping sweep ticks cannot both send a push for the
-- same kind on the same day. See api/_incidents.js's `claimNewKindNotification`.
--
-- ── not a person table ──────────────────────────────────────────────────
-- No owner_user_id, no replica_id, no room_id, no follower_id, no person_id
-- - this table cannot name who anything happened to, only what kind of
-- failure happened, where, and how often today. `vy_sweep_run` (migration
-- 084)'s own header states the identical shape and the identical
-- consequence: "no person/owner column by construction, so it needs no
-- PERSON_TABLES entry, no erasure wiring and no scripts/relcheck.mjs
-- exemption (it carries none of that check's PERSON_COLUMNS, invisible to
-- the coverage scan by construction rather than by an added exception)" -
-- restated here verbatim rather than re-argued, because the shape is the
-- same shape.
--
-- ── retention ────────────────────────────────────────────────────────────
-- Rows older than 90 days are pruned inside the check-ins sweep, the same
-- posture `api/_sweep-run.js`'s `pruneOldRuns` already takes for
-- `vy_sweep_run` (best-effort, bounded, never turns a sweep that otherwise
-- succeeded into a failure) - see `api/_incidents.js`'s `pruneOldIncidents`.
create table if not exists vy_incident (
  incident_id  uuid primary key default gen_random_uuid(),
  day          date not null default current_date,
  kind         text not null,
  door         text not null check (length(door) > 0 and length(door) <= 100),
  status       integer not null check (status >= 0 and status < 1000),
  count        integer not null default 1 check (count > 0),
  notified_at  timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

alter table vy_incident drop constraint if exists vy_incident_kind_check;
alter table vy_incident add constraint vy_incident_kind_check
  check (kind in ('door_5xx', 'provider_payments', 'provider_telegram', 'provider_whatsapp', 'provider_webpush'));

-- The upsert target, `recordIncident`'s own ON CONFLICT clause.
create unique index if not exists vy_incident_day_kind_door_status_ix
  on vy_incident (day, kind, door, status);

-- The board's own read (`incidentsOverview`, "last 7 days by kind and
-- door") and the sweep's own new-kind scan - both filter on `day` first,
-- so a plain index on the leading column serves either query's WHERE
-- without needing to know `kind` ahead of time.
create index if not exists vy_incident_day_ix
  on vy_incident (day desc);
