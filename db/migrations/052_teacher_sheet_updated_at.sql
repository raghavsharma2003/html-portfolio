-- Migration 052 — vy_teacher_sheet.updated_at, for the studio's draft lane.
--
-- 051 built the table for the LOADER, whose only time question is "which is
-- the newest PUBLISHED row" — `published_at` answers that completely. WS-F
-- adds the writer, and a draft screen asks a different question: "when was my
-- work last saved". `created_at` cannot answer it, because a draft is an
-- UPSERT — a studio autosaving a form must not accumulate a row per keystroke,
-- so the row's creation time stops moving on the first save and every later
-- save becomes invisible.
--
-- `src/studio/teacherSheetApi.ts` already declares the field the client will
-- render (`TeacherSheetDraftStatus.updated_at`), which is what makes this a
-- missing column rather than a new feature.
--
-- Idempotent, one statement per request — 009's law, restated by 051 and
-- binding here for the same reason: Neon's SQL-over-HTTP endpoint accepts
-- exactly ONE statement per body, db/migrations/apply.mjs runs them
-- individually with no transaction, so every statement below is independently
-- re-runnable. No DO blocks, no functions.
--
-- Backfilled from `created_at` rather than from `now()`: a row that has never
-- been saved since it was created was last saved when it was created, and
-- stamping today's date onto every historical row would state a fact about
-- when work happened that is not true of any of them.

alter table vy_teacher_sheet add column if not exists updated_at timestamptz;

update vy_teacher_sheet set updated_at = created_at where updated_at is null;

alter table vy_teacher_sheet alter column updated_at set default now();

-- The draft lane's read path: the newest row for an agent whatever its status,
-- which is the question the loader's (agent_id, status, published_at) index
-- cannot answer — that one filters to 'published' before it orders.
create index if not exists vy_teacher_sheet_agent_recent_ix
  on vy_teacher_sheet (agent_id, created_at desc);
