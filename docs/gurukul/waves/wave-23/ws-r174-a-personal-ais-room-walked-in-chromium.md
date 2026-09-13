# WS-R174: a personal AI's Room walked in Chromium. From the personal studio's Deploy to a visitor's first reply: publish the Room for a text-ready person, open /r/<slug> as a follower, join, ask, get a reply that carries the person's disclosure, in English and Hindi. No migration.

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

WS-R162 proved the publish lock, the about page and the compiled boundary
at the door level and said plainly that nobody has clicked through the real
RoomStudio for a person AI. WS-R158's rehearsal walks the studio; WS-R122's
walks a teacher's Room. The gap between them is the product.

Laws:
1. Read `evals/rehearsal/personal.mjs`, `creator.mjs`, `follower.mjs`,
   `harness.mjs`, `browser.mjs`, `evals/room-doors/fixtures.mjs`, WS-R162's
   report in STATE's session log, `src/studio/DeployStudio.tsx`,
   `src/creatorStudio/RoomStudio.tsx`, `api/_room-publish.js` FIRST.
2. `evals/rehearsal/person-room.mjs` (new, registered in the rehearsal
   lane): a real Chromium signs in as the person, has a published person
   sheet and a text-ready replica in the fixture world, opens Deploy, clicks
   "Set up your Room" and publishes through the REAL RoomStudio controls,
   then a second context visits `/r/<slug>`, joins, asks one question and
   receives the fake seam's reply with the disclosure; then the same in
   Hindi. Negative controls: an unpublished sheet keeps Deploy's honest
   blocker; a signed-out visitor is refused; the visitor never sees the
   teacher wording.
3. Every break the walk finds is fixed at its cause with a regression
   control (WS-R122's pattern) and logged as a rejection; fixtures that
   answer widened doors carry the new fields.
4. Wall clocks per step, n=3, in measurements.md.

## Build

- evals/rehearsal/person-room.mjs (new), evals/rehearsal/stubs as needed,
  evals/run.mjs and evals/runner-lib.mjs (pre-pool if it writes dist),
  any component fixed by a real break, layout/accessibility targets for a
  new state.
- context/: decisions, measurements (the clocks), rejections.
