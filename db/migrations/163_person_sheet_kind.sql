-- WS-R151: HumanOS, the person sheet. `vy_teacher_sheet` gets ONE new column
-- so a row can be a TEACHER's compiled sheet (today's only shape) or a
-- PERSON's (any non-teacher, migration 163's own reason to exist) — never a
-- new table, because a person sheet keeps the exact same row shape teacher-
-- sheet-spec.md already defines: one jsonb `sheet`, the same status machine,
-- the same consent-artifact gate. `sheet_kind` is a governance column in the
-- same spirit as `status` above it: the jsonb's own `sheetKind` claim is what
-- `fromSheet.ts`'s validator branches on (the column is not read by the
-- engine bundle at all), but the column exists so a future SQL-only caller
-- can filter by kind without parsing jsonb, and so a CHECK constraint — not a
-- comment — is what stops a third spelling ever landing in this column.
--
-- `not null default 'teacher'` is what makes every row ever written before
-- this migration, and every row written by a caller that has not learned
-- about `sheetKind` yet, keep meaning exactly what it always meant: teacher-
-- sheet-spec.md's full 61+31-field validator, unchanged (the frozen-fixture
-- byte-identity proof in evals/teacher-sheet is what checks this, not this
-- comment).
alter table vy_teacher_sheet add column if not exists sheet_kind text not null default 'teacher';

-- Repo idiom (context/decisions.md and db/migrations/151, 159, 162): drop the
-- named constraint before adding it, so re-running this file after a partial
-- apply is a no-op rather than a duplicate-constraint error.
alter table vy_teacher_sheet drop constraint if exists vy_teacher_sheet_sheet_kind_check;

alter table vy_teacher_sheet add constraint vy_teacher_sheet_sheet_kind_check check (sheet_kind in ('teacher','person'));

-- No index: every existing read reaches this table through `agent_id` or
-- `replica_id` (migration 139's own private-draft indexes), never through
-- `sheet_kind` alone — there is no caller in this workstream's Build list
-- that scans the table by kind, so an index here would be speculative rather
-- than earned (the same discipline `context/decisions.md` already applies to
-- every other index in this file: added when a caller needs it, not before).
