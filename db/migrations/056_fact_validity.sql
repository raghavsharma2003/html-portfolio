-- Migration 056 — bi-temporal fact edges: EVENT time beside BELIEF time.
-- ROADMAP-100X item 4. WS-O.
--
-- Idempotent, additive only, ONE STATEMENT PER REQUEST — 001's law, restated
-- by 009/051/054 and binding here for the same reason: Neon's SQL-over-HTTP
-- endpoint takes exactly one statement per request, there is no transaction
-- across statements, and an apply interrupted halfway must be recovered by
-- running this file again. No DO blocks and no functions: db/migrations/
-- apply.mjs's splitter is deliberately small and does not handle them.
--
-- ── WHAT IS BEING ADDED, AND WHY IT IS A SECOND PAIR ──────────────────────
-- `vy_fact` already has `t_valid` / `t_invalid` (002). Those are BELIEF time:
-- every recall query in api/ reads `t_invalid is null` and means "still
-- believed", and consolidation sets `t_invalid = now()` when a newer row
-- contradicts an older one. `t_valid` has never been written by any writer in
-- this repo — grep `insert into vy_fact`, none of the seven call sites name it
-- — so it is not, today, an event-time column; it is an empty one.
--
-- The columns below are EVENT time: when the CLAIM is true of the world,
-- independent of when it was written down or stopped being believed.
--
--   valid_from  when the claim entered the world as far as we can tell. The
--               deriver anchors it on when they SAID it; it never invents an
--               earlier one.
--   valid_to    the HORIZON after which the forward-looking reading stops
--               being true. "shaadi december me hai" is true from the day it
--               is said until December; the same words in January are a wrong
--               statement about a wedding that already happened.
--
-- These are the two axes bi-temporality is named for. They are NOT folded into
-- the belief pair, and the reason is a product one rather than a modelling
-- preference: `t_invalid is not null` is read as a HARD EXCLUSION in ~a dozen
-- WHERE clauses, so making a November exam set `t_invalid` in November would
-- DELETE it from recall rather than re-tense it. A passed plan is still a fact
-- about a person. It is just no longer ahead of them.
--
-- ── THE DEFECT THIS CLOSES ────────────────────────────────────────────────
-- `stale-note-keys-on-row-age` (context/decisions.md, opened by WS-K's recall
-- benchmark on its first run): `api/memory.js`'s `staleNote` hedges a recalled
-- row as already-past when THE ROW is older than 45 days, never on the date
-- inside the fact. dyad-b's `neet pg` — a November exam recorded in June — is
-- handed to her in August pre-hedged as past, so she asks how an exam went
-- that has not happened. Row age was a proxy for "the world moved on"; these
-- two columns are the thing it was standing in for.
--
-- ── BOTH STORES, BECAUSE THE DEFECT LIVES IN THE OTHER ONE ────────────────
-- The renderer that carries the bug reads `meera_nodes`, not `vy_fact`:
-- `staleNote` is applied by `line()` to the matched + standing-background sets,
-- and both of those legs select from `meera_nodes` (api/memory.js `COLS`).
-- `vy_fact` reaches the prompt through the semantic / activity / watch legs,
-- which render through different code and never call `staleNote`.
--
-- So the columns land on BOTH tables. Adding them only to `vy_fact` would be
-- the tidy version of this migration and would fix nothing a user could see —
-- which is `dead-writers` with the polarity reversed: a column with a writer,
-- no reader, and a bug still shipping beside it. `meera_nodes` is the legacy
-- lane and is scheduled to be subsumed, and until it is, it is the lane the
-- product actually recalls from.
--
-- ── ABSENCE IS THE DEFAULT ────────────────────────────────────────────────
-- Both columns are nullable with no default and NO BACKFILL. A null pair means
-- "not derivable", and every consumer is written so null reproduces today's
-- behaviour exactly: `factStaleness` returns "unknown" and the caller keeps the
-- 45-day row-age rule; `validityOverlaps` returns true and consolidation
-- supersedes by name exactly as it does now. Every existing row is null, so
-- this migration changes zero recalled bytes on the day it is applied and
-- starts changing them only as new dated facts are written.
--
-- A backfill IS possible (the deriver is pure and would run over stored
-- `body`/`created_at`) and is deliberately NOT done here: it would re-tense
-- rows for every live person in one step with no measurement in front of it,
-- and 002's own header sets the precedent that lineage columns arrive empty
-- and fill forward. `scripts/migrate/` is where a measured backfill would go.

alter table vy_fact add column if not exists valid_from timestamptz;

alter table vy_fact add column if not exists valid_to timestamptz;

-- Order matters and is asserted, not assumed: an interval whose horizon is
-- before its start is not a fact with a strange date, it is a deriver bug, and
-- a check constraint is the only place that stays true after the deriver is
-- rewritten. NOT VALID is not used — the table's existing rows are all null,
-- so the constraint validates instantly and a future apply of this same file
-- re-adds an already-satisfied constraint.
alter table vy_fact drop constraint if exists vy_fact_validity_order;

alter table vy_fact add constraint vy_fact_validity_order
  check (valid_from is null or valid_to is null or valid_to >= valid_from);

-- The read path this exists for: "which of this person's still-believed facts
-- have a horizon, and where is it". person_id is uuid on vy_fact, so a caller
-- binding a text parameter must cast ($1::uuid) — the index is on the column,
-- and the cast belongs in the query, exactly as the existing vy_fact_person_ix
-- callers already do.
create index if not exists vy_fact_validity_ix
  on vy_fact (person_id, valid_to)
  where valid_to is not null and t_invalid is null and retracted_at is null;

-- ── the legacy graph store: the lane staleNote actually reads ─────────────

alter table meera_nodes add column if not exists valid_from timestamptz;

alter table meera_nodes add column if not exists valid_to timestamptz;

alter table meera_nodes drop constraint if exists meera_nodes_validity_order;

alter table meera_nodes add constraint meera_nodes_validity_order
  check (valid_from is null or valid_to is null or valid_to >= valid_from);

-- meera_nodes is DEVICE-keyed (that is its own defect, filed separately by
-- this workstream as `graph-recall-is-device-keyed`), so its index is too.
create index if not exists meera_nodes_validity_ix
  on meera_nodes (device_id, valid_to)
  where valid_to is not null;
