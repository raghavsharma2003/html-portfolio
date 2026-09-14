# WS-R165: the evals made durable. The 30 older suites that launch Chromium directly go through the shared launcher; the 25 suites that read historical blobs with `git show` read committed fixtures; the load-sensitive refresh race is found and fixed at its cause. No migration.

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

The gate is the product's proof and three things make it lie under load or
in CI: direct browser launches (rejected.md#direct-chromium-launches-crashed-the-browserless-build-job,
30 files left), `git show <commit>:<path>` at suite start
(rejected.md#ci-shallow-checkout-starved-the-history-reading-suites, 25
suites, CI now fetches full history as a stopgap), and the refresh suite's
race (rejected.md#first-use-refresh-suite-races-under-load, 4 of 10 runs
under load, a dropped focus during a readiness poll as the hypothesis).

Laws:
1. Read `evals/rehearsal/browser.mjs`, the three rejections above, `evals/
   run.mjs`'s pre-pool and browser budget, `evals/suite-resources.mjs`, and
   `src/studio/StudioApp.tsx`'s readiness effect FIRST.
2. Launchers: every `chromium.launch(` under evals/ goes through
   `launchSuiteBrowser("<registry name>")` FIRST in the file, before dist/ or
   a port; suites that need a browser SERVICE keep their channel launch
   through the launcher's extraArgs. A scanner in evals/lib (through
   source-scan) fails by name on a direct launch outside browser.mjs, with a
   negative control.
3. History: each `git show` blob moves to `evals/<suite>/fixtures/<name>` with
   the commit it was taken from in a header comment; the suite reads the
   fixture; a scanner fails by name on `git show` in a suite; CI's
   fetch-depth stays until the last suite moves, then the comment in both
   workflows is updated.
4. The race: instrument, reproduce (n>=10 under a synthetic load such as a
   busy loop in a sibling process), then fix at the cause: if a focus that
   lands mid-poll is dropped, coalesce it (a real product change in
   StudioApp.tsx, one flag) and the fixture asserts the coalesced refresh;
   measure before and after, n=10.
5. The whole registry passes; the browser-less build workflow's posture is
   preserved (skips by name).

## Build

- evals/**/*.mjs (launch and history changes only), evals/lib/launch-scan.mjs
  and evals/lib/history-scan.mjs (new, registered), evals/first-use-private-flow/
  refresh.mjs, src/studio/StudioApp.tsx (the coalesce only), .github/workflows/
  *.yml comments, evals/run.mjs.
- context/: decisions, measurements (the flake rates before and after),
  rejections.
