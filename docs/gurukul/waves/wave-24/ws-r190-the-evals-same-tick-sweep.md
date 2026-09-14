# WS-R190: the evals' same-tick sweep. Every browser suite that asserts a Node-side counter on the tick after a browser-side wait gets a bounded wait for that counter; every fixed first-render barrier in a rehearsal scales with load; a scanner fails by name on a new same-tick assert; and the two continuity suites that fail on the base tree are decided: registered and fixed, or retired with a rejection. No migration.

Read scratchpad w24/ws-common.md FIRST (the file the launcher names); every
rule there binds, including the merge lessons at its end. Your worktree is
checked out at the wave-twenty-four base e2da1f6 (verify with `git log
--oneline -1`). The gate is 25 checks without NEON_URL; run touched suites
while you build, EVERY suite that reads a file you change (grep evals/ for
the file name), and the full gate ONCE at the end, in the foreground, with a
timeout, when the load average is under 8. Ten siblings build beside you on
this machine: R182 memory that grows on its own (172 only if needed), R183
RelationOS for the person (174 only if needed), R184 EmotionOS test-and-tweak,
R185 sources at a glance, R186 the visitor's first minute on a phone, R187
share your AI, R188 the voice program's dry run, R189 my data in one place
(173 only if needed), R190 the evals' same-tick sweep, R191 the studio on a
phone in Hindi. Migration numbers are ASSIGNED; never take another. Keep your
edits inside the files your brief names and append-only in shared files so
the main loop can merge mechanically. Do not spend money, do not touch the
live database, never print or commit a secret, never kill a process by
pattern, never `git stash`, never end a turn waiting on a monitor: gate in
the foreground with a timeout, commit, `git status` clean, full report in the
same turn.

## Product

The gate is the product's honesty. Three suites lost a run each this week to
the same shape (rejected.md#teacher-sheet-publication-ui-asserted-the-fake-servers-pending-count-on-the-tick-the-button-disabled:
`candidate-activation-ui`, `feedback-dataset-ui`, `teacher-sheet-publication-ui`),
and the personal rehearsal lost two runs to a fixed 20 s first-render barrier
under load. Each cost the main loop a gate. The fix is known; this workstream
applies it everywhere at once and makes the next one impossible to write.

Laws:
1. Read `evals/lib/bounded-wait.mjs` (WS-R181), `evals/lib/source-scan.mjs`,
   `evals/teacher-sheet-publication/mounted.mjs` (the fixed shape:
   `awaitPending`), `evals/rehearsal/personal.mjs` line ~984 (the 20 s
   barrier), `evals/rehearsal/browser.mjs`, the two rejections named above and
   `rejected.md#ws-r173-three-eval-suites-failed-once-under-extreme-contention-unrelated-to-any-touched-file`,
   `evals/continuity/assembly.mjs` and `seam3.mjs` FIRST.
2. The sweep: find every `page.waitForFunction(` / `.waitFor(` / `.click(`
   followed within the same statement group by an `assert.*(<node
   identifier>.length` or `assert.*(<node identifier>,` on an array or
   counter a fake server or fake fetch fills (grep the fixture for the
   identifier's `push`), and replace the assertion with a bounded poll of the
   same predicate (one shared helper in `evals/lib/bounded-wait.mjs`,
   `awaitCount(getter, n, base)` or similar, never a per-suite copy). Report
   the count found per suite. Every changed suite runs green alone three
   times.
3. Fixed barriers: every `timeout: <fixed ms>` of 10 s or more on a first
   render or navigation in `evals/rehearsal/*.mjs` and the `mounted.mjs`
   suites becomes `boundedWaitMs(<same ms>)`; the personal rehearsal's 20 s
   wait first.
4. The scanner: `evals/same-tick-scan/run.mjs` (new, registered) reads every
   browser suite through source-scan and fails BY NAME on the shape in law 2
   or a fixed barrier from law 3, with a negative control (a synthetic
   offending file it detects) and a positive control (the fixed
   teacher-sheet suite passes).
5. The continuity suites: `evals/continuity/assembly.mjs` and `seam3.mjs` are
   not in the registry and fail on the base tree (the compiler-seam rule
   names `fromSheet.ts`, `teacher.ts`, `kabir.ts`; `startLiveCall` counted
   twice). Decide: if the rule they encode is still law, fix the rule's
   allowlist for the agent-module files the waves added and register them;
   if it is not, move them to `evals/archive/` with a rejection saying what
   they proved and why it no longer holds. Never delete without the entry.
6. The gate's eval suite still passes 25 of 25 on a quiet machine after all
   of it (run `scripts/merge-tools/quiet-gate.sh` once at the end).

## Build

- evals/lib/bounded-wait.mjs (the shared poll), every suite the sweep names,
  evals/rehearsal/*.mjs (barriers), evals/same-tick-scan/run.mjs (new),
  evals/continuity/ (fixed and registered, or archived), evals/run.mjs.
- context/: decision with reversal, measurements (counts per suite, the
  three-times-green tally), rejections (the continuity decision if retired).
