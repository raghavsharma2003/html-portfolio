# WS-R181: the gate honest under load. The eval pool's browser budget and every bounded wait scale with the machine's load, the port-lane suites wait for their port instead of dying on it, the checks that measure time refuse to judge above a load ceiling and say so, and a quiet-gate runner waits for a quiet machine. No migration.

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

Two waves of ten agents each ran ten full gates at once and every report
carried the same paragraph: port collisions, TBT overages, click timeouts,
"environmental, reran alone". The gate is the product's proof; a proof that
must be interpreted is not one. WS-R165 fixed the one real race; the rest
is the gate's own honesty.

Laws:
1. Read `evals/run.mjs` (the pool, the browser budget, the port lane),
   `evals/runner-lib.mjs`, `evals/suite-resources.mjs`, `scripts/verify-release.mjs`,
   `scripts/check-performance.mjs`, `scripts/check-layout.mjs`'s port,
   `scripts/merge-tools/gate-retry.sh`, `evals/browser-resource/run.mjs`,
   `evals/first-use-private-flow/*.mjs`, `evals/day-one`, `evals/probe-live`,
   `evals/room-push` (their fixed ports), WS-R165's measurements, and every
   wave-22 measurement entry that names load FIRST.
2. Load-aware waits: one exported `boundedWaitMs(base)` in evals/lib that
   scales a bounded barrier by the one-minute load average over the core
   count (never below base, capped), used by the browser suites that have
   a fixed 12 to 30 s barrier today; measured n=10 at load 2 and at load 12
   (a synthetic busy loop in sibling processes) before and after.
3. Ports: a fixed-port suite waits for its port with a bounded loop before
   binding and fails by name only when the wait expires; the pool serialises
   the port lane as today.
4. Time-measuring checks (performance budgets, the paint budgets) read the
   load average, record it in their output, and above a ceiling report
   "not measurable at load N" as a FAILURE that names the load rather than
   a budget miss, so a busy run is never mistaken for a regression and never
   passes silently.
5. `scripts/merge-tools/quiet-gate.sh`: waits for load under a threshold and
   for the gate's ports to be free, then runs the gate once; documented in
   ws-common for wave twenty-four.

## Build

- evals/lib/bounded-wait.mjs (new), the browser suites' barriers, evals/
  run.mjs and runner-lib.mjs (the budget), the fixed-port suites,
  scripts/check-performance.mjs, scripts/check-layout.mjs, scripts/
  merge-tools/quiet-gate.sh (new), evals/gate-load/run.mjs (new: the wait
  function's scaling and the ceiling refusal with negative controls).
- context/: decisions with reversal, measurements (the two-load table),
  rejections.
