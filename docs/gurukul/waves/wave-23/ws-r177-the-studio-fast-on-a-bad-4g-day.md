# WS-R177: the studio fast on a bad 4G day. The performance budgets measured ten times on a quiet machine, the personal studio's blocking time cut at its cause (what loads before first paint), the Hindi chunk preloaded, and the budgets re-set from measurement with their reversal conditions. No migration.

Read scratchpad w23/ws-common.md FIRST (the file the launcher names); every
rule there binds, including the merge lessons at its end. Your worktree is
checked out at the wave-twenty-three base 19a27bc (verify with `git log
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

The first market is India on a phone. The performance gate fails on total
blocking time for `/studio` and `studio-hi` whenever the machine is busy,
and nobody has measured what a person on a bad 4G day actually waits.
Every wave-22 agent reported the same TBT overages and called them noise;
some of it is the product.

Laws:
1. Read `scripts/check-performance.mjs` (the CDP throttle, targets, budgets
   and how a finding is named), `vite.config.ts` (chunks), `studio.html`,
   `src/studio/main.tsx`, `personalMain.tsx`, `StudioApp.tsx`'s lazy
   boundaries, WS-R91's and WS-R159's chunk measurements, and
   `decisions.md#first-hindi-paint-budget-set-from-measurement` FIRST.
2. Measure first: n=10 per target on a quiet machine (load under 4), the
   table in measurements.md with median and p90 for LCP, TBT and the
   first-Hindi-paint; then again after each change.
3. Cut the cause: nothing that is not needed for the first screen loads
   before it (the deploy studio, the listening test, EmotionOS, HumanOS,
   the mirror call and the context locker are lazy already; find what is
   not: the copy registry's English table, the icons, the verification
   journey, the first-five-minutes rail); the Hindi chunk gets a
   modulepreload when the locale is Hindi; the studio's critical CSS stays
   in the entry partition (evals/studio-entry-css).
4. Budgets are set from the after-measurement with a reversal condition
   each, never loosened to pass; the check records the load average it ran
   under in its JSON and its finding text, so a busy machine's result is
   legible as such.
5. The byte-identity and layout gates pass; both locales.

## Build

- vite.config.ts, studio.html, src/studio/main.tsx, personalMain.tsx,
  StudioApp.tsx, CloneExperience.tsx (lazy boundaries only), src/studio/
  localeContext.tsx (the preload), scripts/check-performance.mjs (the load
  record and the budgets), evals/studio-entry-css, evals/performance-*.
- context/: decisions with reversal, measurements (before and after tables),
  rejections.
