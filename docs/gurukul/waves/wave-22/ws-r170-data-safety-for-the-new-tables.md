# WS-R170: data safety for the new tables. Rate limits on every door wave twenty-one added, erasure and export completeness for 163, 164 and 166 proven by the batteries, relcheck entries, a schema-mirror parity check as a gate, and the reconciliation-076 decision prepared with evidence. Migration 171 only if needed.

Read scratchpad w22/ws-common.md FIRST (the file the launcher names); every
rule there binds, including the merge lessons at its end. Your worktree is
checked out at the wave-twenty-two base d2b3f6d (verify with `git log
--oneline -1`). The gate is 24 checks without NEON_URL; run touched suites
while you build and the full gate ONCE at the end, in the foreground, with a
timeout. Ten siblings build beside you on this machine: R161 Meet opens for any person (text first, migration 167), R162 a personal AI's Room publishes (migration 168 only if needed), R163 the voice activation guard wired and sealed audio served (169 only if needed), R164 the first five minutes, R165 the evals made durable, R166 the personal studio in Hindi, tier two, R167 the owner's own continuity in Meet (170 only if needed), R168 EmotionOS in the voice, R169 the mobile app proven, R170 data safety for the new tables (171 only if needed). Migration numbers are ASSIGNED; never take another. Keep your
edits inside the files your brief names and append-only in shared files so the
main loop can merge mechanically. Do not spend money, do not touch the live
database, never print or commit a secret, never kill a process by pattern,
never `git stash`, never end a turn waiting on a monitor: gate in the
foreground with a timeout, commit, `git status` clean, full report in the same
turn.

## Product

Wave twenty-one added doors (replica-vibe, listening submit, relstate reset,
the person sheet's kind) and tables. The wave era's laws say every public
door sits behind the rate table, every person-lane table is reached by
erasure and named by export, every FK-free relation has a relcheck, and
db/schema.sql mirrors the migrations exactly. Nobody has proven all four for
the new work at once, and reconciliation 076 (composite FKs on owner and
agent columns, never applied) still waits on evidence.

Laws:
1. Read `api/_rate.js` (or the rate table's module), `api/_replica-full-erasure.js`,
   `api/memory.js` PERSON_TABLES, `api/_creator-export.js`, `scripts/relcheck.mjs`,
   `evals/room-leak/world.mjs`, `evals/room-export/run.mjs`, `db/migrations/
   076_*` and the STATE block's paragraph on it, and `db/migrations/apply.mjs` FIRST.
2. Rate: every op on `api/replica-vibe.js`, the listening submit, `relstate`
   and `relstate_reset`, and the person-sheet publish path is a predicate in
   the rate table with an honest 429; the door battery proves it by name.
3. Erasure and export: `vy_replica_vibe`, the listening columns on
   `vy_replica_calibration` and `sheet_kind` are reached by erasure and named
   in the export manifest (the batteries fail by name otherwise); relcheck
   entries for every FK-free relation the wave added, run against a fake db.
4. Schema parity: a new gate check `scripts/check-schema-mirror.mjs` proves
   `db/schema.sql` contains every statement of every migration in numeric
   order (comments stripped), with a negative control; wired into
   `scripts/verify-release.mjs` as the 25th check and into AGENTS.md and
   CLAUDE.md's count; the wave-era gap WS-R155 found (046's unique index
   missing from the mirror) is fixed by appending, never editing.
5. Reconciliation 076: a written decision in decisions.md with the evidence
   for and against (which code reads the FKs, what erasure order they force,
   what the wave-era law protects) and a recommendation; NOT applied.

## Build

- the rate table module, api/replica-vibe.js, api/replica-calibration.js,
  api/room.js (the two ops), api/_replica-full-erasure.js, api/memory.js,
  api/_creator-export.js, scripts/relcheck.mjs, scripts/check-schema-mirror.mjs
  (new), scripts/verify-release.mjs, AGENTS.md and CLAUDE.md (the count),
  db/schema.sql (append only), evals/room-doors, room-leak, room-export,
  evals/schema-mirror/run.mjs (new), evals/run.mjs; db/migrations/171 only
  if a rate predicate needs a column.
- context/: the 076 decision, measurements, rejections.
