-- Migration 127 - the recall run (WS-R101). Readiness's `knows_your_material`
-- part has never had a writer (`api/_readiness.js` §4, `readRecallRun` a
-- committed stub returning null): no replica could cross the publish floor
-- through a real computation, only through a fixture seed
-- (`evals/rehearsal/creator.mjs`'s own finding, wave fifteen). This table is
-- the instrument: one row per scored run over a held-out question set built
-- from the replica's OWN sources (`api/_recall-run.js::generateRecallSet`),
-- answered by the real compiled agent and scored 0-100
-- (`api/_recall-run.js::scoreAnswer`).
--
-- ── one statement, idempotent, no DO blocks, explicit ::uuid casts ────────
-- 009's law, restated by every migration since. No foreign key on
-- `replica_id`/`owner_user_id` — 009's own convention for an owner-keyed
-- table this product's WHERE-clause binding already protects, and the same
-- convention `vy_replica_readiness` (073) and `vy_replica_funnel_mark` (088)
-- already follow one table over.
--
-- ── what the columns hold, and what they deliberately do not ──────────────
--
--   score        0-100, the run's OVERALL score: the mean of every
--                per-question score, rounded. `api/_readiness.js`'s
--                `knowsYourMaterial` reads this directly — it is the
--                measurement, not raw counts a reader would have to
--                re-aggregate.
--   n            how many questions the run scored. Below
--                `RECALL_SET_MIN` (20, api/_recall-run.js) a run is refused
--                by name (`recall_set_too_small`) before it ever reaches
--                this table, so every row here describes a real sample.
--   method       a versioned, internal label for HOW the score was produced
--                (`RECALL_RUN_METHOD_VERSION`, "recall-run/v1"). The
--                creator-facing sentence ("measured on N questions from
--                your own material") is built in `api/_readiness.js` at
--                READ time, from `n`, never taken from this column verbatim
--                — measurements.md's own n/method/date house rule kept
--                separate from the copy a person actually reads.
--   set_hash     sha256 over the exact question set scored, so two runs
--                over unchanged sources are provably the same test —
--                `evals/recall-run/run.mjs` asserts this hash is stable for
--                a fixed set of sources and changes when a source is added.
--                NOT a uniqueness key: an owner may re-run the identical set
--                (the rate predicate below is the only limiter on that).
--   superseded_at  set on every row but the newest for (replica_id,
--                owner_user_id) the moment a new run lands, in the SAME
--                statement as the insert (`api/_recall-run.js`'s own
--                `RECALL_RUN_INSERT_SQL`, `vy_voice_fidelity`'s (058)
--                superseding-CTE shape one table over) — so
--                `superseded_at is null` can never resolve to two rows and
--                `readRecallRun` never has to pick between them.
--
-- ── the rate limit lives IN the write, not beside it ───────────────────────
-- The reply seam `api/_recall-run.js::scoreRecallRun` drives costs money per
-- question in production. One run per replica per hour is enforced as a
-- predicate on the INSERT itself (a `not exists` over the last hour, shared
-- with the supersede so a refused call disturbs nothing) rather than as a
-- separate check a caller could race — `009`'s "one statement cannot half
-- apply" applied to a rate limit instead of a schema change.
--
-- ── the erasure lane ────────────────────────────────────────────────────
-- Deleted by name in api/_replica-full-erasure.js (no FK to cascade through,
-- so this is the ONLY layer, not a second one) and reachable by
-- scripts/relcheck.mjs's owner-lane walk. A recall run is a dated, scored
-- record of how well we thought a named person's AI knew their own material
-- — exactly the kind of row an erasure that skipped it would leave behind
-- while reporting success, `vy_replica_readiness`'s own reasoning (073)
-- restated for this table.
create table if not exists vy_recall_run (
  run_id         uuid primary key default gen_random_uuid(),
  replica_id     uuid not null,
  owner_user_id  uuid not null,
  score          int not null check (score >= 0 and score <= 100),
  n              int not null check (n > 0),
  method         text not null default '',
  set_hash       text not null check (set_hash ~ '^[0-9a-f]{64}$'),
  created_at     timestamptz not null default now(),
  superseded_at  timestamptz
);

create index if not exists vy_recall_run_owner_ix
  on vy_recall_run (replica_id, owner_user_id, created_at desc);
