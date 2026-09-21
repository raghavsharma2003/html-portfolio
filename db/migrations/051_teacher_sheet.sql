-- Migration 051 — vy_teacher_sheet: the DB-backed half of the agent registry.
-- Contract: docs/gurukul/SPEC-GURUKUL.md §2 ("Registry: today compile-time
-- static (registry.ts). Gurukul needs DB-backed sheets: TeacherSheet rows
-- stored at publish time, an AgentModule constructed at runtime from the
-- stored sheet"), docs/gurukul/teacher-sheet-spec.md §4 (publish validation),
-- docs/gurukul/safety-floor-teacher.md §2 (consent gates registration).
--
-- Idempotent, one statement per request — 009's law, restated because it is
-- the thing most easily lost: Neon's SQL-over-HTTP endpoint accepts exactly
-- ONE statement per body and db/migrations/apply.mjs runs them individually
-- with no transaction, so every statement below is independently re-runnable
-- and an apply interrupted halfway is recovered by running this same file
-- again, never by manual repair. NO DO blocks and no functions: apply.mjs's
-- splitter is deliberately small and does not handle them. (Migrations 041-050
-- in the replica lab do use DO blocks; they are the exception this file does
-- not follow, because vy_teacher_sheet is read by the agent runtime and must
-- stay recoverable by the same law the agent tables were built under.)
--
-- ── no foreign key to vy_agent, on purpose ────────────────────────────────
-- `agent_id` is FK-SHAPED and carries no FK constraint, which is the
-- convention every agent-scoped table established in 009: all twenty derived
-- tables took `agent_id uuid not null` plus an index and no `references
-- vy_agent`. Adding one here would make this the only table whose agent
-- binding is enforced in the database, which reads as a stricter rule and is
-- actually an inconsistent one — the binding is enforced by
-- api/_agentscope.js's equality predicate, in the WHERE clause, before rank.
-- The index below is what makes that predicate cheap.
--
-- ── the publish gate is a CHECK, not a code path ──────────────────────────
-- safety-floor-teacher.md's governing measurement (`gate0-structural`):
-- "prompt instructions leaked 57-98%; the SQL predicate leaked 0 of 31,122 …
-- A sentence in a brief is a preference; a predicate on the output is a
-- guarantee." The rule that a published teacher clone must have a consent
-- artifact is therefore a table constraint and not merely a branch in
-- api/_teachersheet.js. Both exist; only one of them cannot be forgotten by
-- the next writer.
--
-- `consent_artifact_id` is nullable because the replica consent tables are
-- not yet the source of these rows (WS-E owns that seam). Nullable at DRAFT,
-- impossible at PUBLISHED — which is exactly the fail-closed shape
-- teacher-sheet-spec.md §4 asks for and NOT the same thing as "required".
--
-- ── revoked rows are kept ─────────────────────────────────────────────────
-- Revocation deregisters the module (safety-floor-teacher.md §2.2); it does
-- not delete the row, because a revoked slug is NEVER reused (`pk-is-an-arbiter`
-- — reusing an identity key silently attaches an old relationship history to a
-- new principal) and the row is the record of which slug is burned.

create table if not exists vy_teacher_sheet (
  sheet_id            uuid primary key,
  agent_id            uuid not null,
  version             text not null default '',
  sheet               jsonb not null,
  status              text not null default 'draft'
                      check (status in ('draft','validated','published','revoked')),
  consent_artifact_id uuid,
  created_at          timestamptz not null default now(),
  published_at        timestamptz
);

-- drop-then-add is the idempotent pair for a constraint (009's own shape for
-- its composite PKs, and 008a's for its check): re-running drops what it just
-- added and adds it back.
alter table vy_teacher_sheet drop constraint if exists vy_teacher_sheet_publish_gate;

-- THE GATE. A row may only be 'published' with a consent artifact and a
-- publish timestamp. Every other status may carry nulls.
alter table vy_teacher_sheet add constraint vy_teacher_sheet_publish_gate
  check (status <> 'published' or (consent_artifact_id is not null and published_at is not null));

-- The loader's read path: (agent, status) then newest published first.
create index if not exists vy_teacher_sheet_agent_status_ix
  on vy_teacher_sheet (agent_id, status, published_at desc);

-- At most ONE published sheet per agent. Without this the loader's "newest
-- published" is a race with any second publish, and a clone that answers from
-- whichever row won is a clone whose persona depends on write ordering.
create unique index if not exists vy_teacher_sheet_one_published_ix
  on vy_teacher_sheet (agent_id) where status = 'published';
