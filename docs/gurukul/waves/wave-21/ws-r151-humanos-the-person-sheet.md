# WS-R151: HumanOS, the person sheet. Any person, not only a teacher, gets the compiled sheet that makes their AI THEM: identity, the five material fields (who, life, texture, taste, curiosity), values, never-say rules, how they talk, knowledge sources, and a voice reference; edited in the personal studio under a screen called HumanOS, published through the existing sheet publish gate, and accepted by the Room publish gate so a personal AI can open a Room. Migration 163.

Read scratchpad w21/ws-common.md FIRST (the file the launcher names); every
rule there binds. Your worktree is checked out at the wave-twenty-one base
482e54b (verify with `git log --oneline -1`). The gate is 24 checks without
NEON_URL; run touched suites while you build and the full gate ONCE at the
end. Ten siblings build beside you on this machine: R151 HumanOS (the person
sheet, migration 163), R152 Deploy for a personal AI, R153 EmotionOS (vibe and
register, migration 164), R154 RelationOS in the Room (migration 165), R155
"Sounds like you" and the listening test (migration 166), R156 voice replies
that start fast, R157 the Vyakti mobile app, R158 the personal journey
rehearsed, R159 the personal studio in Hindi, R160 the Room and the landing
for any person. Migration numbers are ASSIGNED; never take another. Keep your
edits inside the files your brief names and append-only in shared files so
the main loop can merge mechanically. Do not spend money, do not touch the
live database, never print or commit a secret, never kill a process by
pattern, never `git stash`, never end a turn waiting on a monitor: gate in
the foreground with a timeout, commit, `git status` clean, full report in the
same turn.

## Product

Today `vy_teacher_sheet` is the only compiled persona and its validator and
editor assume a teacher (subject strands, doubt ladder, board verbalisms).
A person who is not a teacher can record a voice and talk to a draft, but
cannot publish, because `api/_room-publish.js` requires a PUBLISHED TEACHER
SHEET and `TeacherSheetStudio` refuses a sheet with empty teacher arrays.

Laws:
1. Read `api/_teachersheet.js` (the publish gate and the compile of a sheet
   into the reply's material block), `api/_teacher-sheet-draft.js` (private
   drafts keyed by replica and owner, migration 139), `src/engine/compiler.ts`
   (MATERIAL_BLOCK_OPEN/CLOSE, the platform-owned boundary and stage shapes,
   WS-R111/R121), `docs/gurukul/teacher-sheet-spec.md`, `src/studio/
   PrivateTextRehearsal.tsx` (the three-field private editor), and
   `context/rejected.md` entries on the material block and on "never seed an
   identity" FIRST.
2. Migration 163: `alter table vy_teacher_sheet add column if not exists
   sheet_kind text not null default 'teacher'` with a CHECK in ('teacher',
   'person') (drop-if-exists then add, the repo's idempotent shape), plus
   an index only if a caller needs one. No new table. A person sheet keeps
   the same row shape; teacher-only arrays may be empty for `sheet_kind =
   'person'` and the validator says which fields a person sheet REQUIRES:
   display name, one line (140 chars, copy-gated), the five material fields
   (each a short paragraph of shapes and notes, never lines the AI could
   say), at least three never-say rules or an explicit "none", how they
   talk (register: formal/mixed/casual; script baseline: Roman Hinglish /
   Devanagari / English; code-switch note), and values (three to seven
   short items). The publish floor stays Readiness's.
3. The compiler renders a person sheet through the SAME material block
   (data, never instructions), with the platform-owned boundary and stage
   unchanged; a teacher sheet compiles byte-identically to today (a frozen
   fixture proves it). `MATERIAL_BLOCK` scanners and the honesty gate are
   untouched.
4. The personal studio gets a HumanOS screen (`src/studio/HumanOsStudio.tsx`,
   reached from CloneExperience's "enrich" menu as "Who you are" and from
   Meet's review) that edits and saves the person sheet through the existing
   draft door and publishes it through the existing publish operation
   (the caller the wave-eighteen gap audit found missing), with the honest
   blocker split ("waiting on you" / "waiting on us"), both locales through
   a copy registry, DESIGN-LAW motion and copy; 390 and 1280; a layout and
   accessibility fixture (`studio:humanos`).
5. `api/_room-publish.js` accepts a published sheet of either kind; the
   Room's disclosure card reads the person sheet's one line. The door
   battery cases any new op; evals/teacher-sheet and a new evals/person-sheet
   prove the validator (negative controls: a teacher sheet with empty
   strands still refuses; a person sheet with a line the AI could say is
   refused by the shape rule; the compiled prompt of a person sheet never
   carries a teacher field).

## Build

- db/migrations/163_person_sheet_kind.sql, db/schema.sql, api/_teachersheet.js,
  api/_teacher-sheet-draft.js, api/_room-publish.js, src/engine/compiler.ts
  (only if a render needs a person branch; rebuild api/_engine.gen.js),
  src/studio/HumanOsStudio.tsx (+ css, copy), CloneExperience.tsx (the menu
  entry only), evals/person-sheet (new), evals/teacher-sheet, evals/room-doors,
  evals/run.mjs.
- context/: decisions with reversal, measurements, rejections; STATE log.
- Migration 163 only. No new env var.
