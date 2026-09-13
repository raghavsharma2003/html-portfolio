# WS-R175: the calibration erasure hazard verified and fixed. Three tables hold NO ACTION foreign keys to vy_replica_calibration and erasure never deletes them; erasure orders them first, the listening columns join the export manifest, and the whole cascade is proven against the real schema's own constraints offline. Migration 173 only if needed.

Read scratchpad w23/ws-common.md FIRST (the file the launcher names); every
rule there binds, including the merge lessons at its end. Your worktree is
checked out at the wave-twenty-three base <WAVE23_BASE> (verify with `git log
--oneline -1`). The gate is 25 checks without NEON_URL; run touched suites
while you build, EVERY suite that reads a file you change (grep evals/ for
the file name), and the full gate ONCE at the end, in the foreground, with a
timeout, when the load average is under 8. Ten siblings build beside you on this machine: R172 continuity for a text-ready AI (172 only if needed), R173 a person's stage lines and Room card, R174 a personal AI's Room walked in Chromium, R175 the calibration erasure hazard verified and fixed (173 only if needed), R176 EmotionOS register in the reply and the voice, R177 the studio fast on a bad 4G day, R178 HumanOS drafted from a person's own sources (174 only if needed), R179 the listening test against the person's own voice, R180 how a person talks: the reply language policy from the person sheet, R181 the gate honest under load. Migration numbers are
ASSIGNED; never take another. Keep your edits inside the files your brief
names and append-only in shared files so the main loop can merge
mechanically. Do not spend money, do not touch the live database, never print
or commit a secret, never kill a process by pattern, never `git stash`, never
end a turn waiting on a monitor: gate in the foreground with a timeout,
commit, `git status` clean, full report in the same turn.

## Product

WS-R170 found (rejected.md#ws-r170-calibration-generation-fk-graph-has-an-unverified-erasure-ordering-hazard)
that a person's full erasure can fail on a replica with calibration and
generation history, and deliberately did not fix it blind. A person who
asks to be forgotten and is not is the one failure this product cannot have.

Laws:
1. Read `api/_replica-full-erasure.js`, `db/schema.sql` for every FK that
   references `vy_replica_calibration` and `vy_replica_generation`,
   `scripts/relcheck.mjs`, `evals/room-export/run.mjs`, `evals/room-leak`'s
   erasure layer, `api/_creator-export.js`, and WS-R170's decisions FIRST.
2. Prove the hazard before fixing it: an offline model of the FK graph
   built by parsing `db/schema.sql` (the schema-mirror check's own parser
   is the precedent) that orders the erasure's deletes and fails by name
   when a delete would violate a NO ACTION constraint still referenced;
   registered as a suite with a negative control (a deliberately wrong order
   is caught).
3. Fix: erasure deletes the referencing rows first (or converts the
   constraint by a migration, 173, only if the code needs the FK gone);
   `vy_replica_calibration`'s listening columns are named in the creator
   export manifest and the completeness battery proves symmetry.
4. Every existing erasure and export battery passes; relcheck gains an entry
   if a new FK-free relation appears.

## Build

- api/_replica-full-erasure.js, api/_creator-export.js, scripts/relcheck.mjs,
  evals/erasure-order/run.mjs (new), evals/room-export, evals/room-leak,
  evals/run.mjs; db/migrations/173 only if needed with db/schema.sql.
- context/: decision with reversal, measurements, rejections; a list of the
  statements for the main loop's live EXPLAIN.
