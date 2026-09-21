# WS-R191: the studio walked on a phone in Hindi under 4G. The whole personal journey (sign in, record, describe me, wait, Meet in text, HumanOS, EmotionOS, Deploy) walked in Hindi at 390px under the performance gate's 4G throttling in real Chromium, wall-clocked step by step, every glyph and touch target checked; everything that breaks or overruns fixed at its cause with a control. No migration.

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

India first, phone first. The personal studio is in Hindi (WS-R159, R166: 909
strings per locale), rehearsed at 390px in English (`evals/rehearsal/personal.mjs`,
63 checks), and measured at 4G only on its signed-out entry (WS-R177). No
one has walked the whole journey as a Hindi speaker on a phone on a bad
network. That is the first user.

Laws:
1. Read `evals/rehearsal/personal.mjs` (the walk, its `--full` and
   `REHEARSAL_FULL` shape from `person-room.mjs`), `scripts/check-performance.mjs`
   (the 4G profile and CDP throttling), `scripts/check-layout.mjs` (the Hindi
   glyph probe, `studio-hi:*` targets), `scripts/check-accessibility.mjs`
   (`studio-hi:personal`), `src/studio/localeContext.tsx`, `hiCopy.ts`,
   `evals/studio-locale-personal/`, `evals/first-five-minutes/run.mjs` FIRST.
2. The personal rehearsal gains a Hindi pass under `--full` (the same shape
   `person-room.mjs` uses): `?lang=hi`, 390x844, the performance gate's own
   CDP throttling applied to the context, every step the English pass walks,
   wall-clocked per step, n=3, a table in the report and in measurements.
   The English pass is unchanged (byte-identical checks list; a control).
3. Every screen the walk reaches is checked for: no Latin fallback glyph
   inside a Devanagari string (the layout gate's probe, run on the walk's own
   screenshots), every tappable target at least 44x44 CSS px, no horizontal
   scroll at 390px, the keyboard never covering the primary action after
   focus, and no English string where the Hindi table has one (a scan of the
   rendered text against `hiCopy.ts`'s keys for that screen).
4. Budgets: each step's wall clock under the English pass's plus 30 percent;
   the first reply in Meet under 8 s with the fake seam. Where a step
   overruns or a check fails, find the cause (a chunk, a font, a serial
   fetch, a missing key) and fix it at the cause with a regression control;
   log each as a rejection. Never widen a budget or drop a check to pass.
5. Nothing here changes a door; it is the walk, the checks, and the fixes
   the walk forces in `src/studio/`.

## Build

- evals/rehearsal/personal.mjs (the Hindi pass), evals/rehearsal/hi-checks.mjs
  (new, the glyph, target-size, scroll and keyboard checks as a shared helper
  person-room.mjs can call), src/studio/*.tsx and css (only what a check
  forces), src/studio/hiCopy.ts (only a missing key, in its block),
  scripts/check-layout.mjs (a target only if a screen the walk reaches has
  none), evals/run.mjs if a suite is added.
- context/: decision with reversal, measurements (the table), rejections
  (every cause).
