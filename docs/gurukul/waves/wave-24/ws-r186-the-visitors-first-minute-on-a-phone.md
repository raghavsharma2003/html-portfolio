# WS-R186: the visitor's first minute on a phone. A stranger taps a person's shared link on a phone on a bad 4G day: the Room's about page, one join sheet, one question, the first reply, and the install prompt after it, wall-clocked in real Chromium at 390px under CDP throttling in both languages; every second over budget found and fixed at its cause. No migration.

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

WS-R164 measured the PERSON's first five minutes (landing to Meet). WS-R174
walked a stranger into a person's Room in Chromium at desktop width with no
clock. The visitor is where a person's AI becomes their online identity: a
friend taps a WhatsApp link on a phone, on the network India actually has.
Every screen between that tap and the first reply is a place they leave.

Laws:
1. Read `evals/rehearsal/person-room.mjs` (WS-R174's walk, reuse its
   fixture world and fake seam), `evals/first-five-minutes/run.mjs` (WS-R164's
   clock and its CDP throttling shape), `scripts/check-performance.mjs` (the
   4G profile: 4x CPU, 1.6 Mbps down, 750 Kbps up, 150 ms), `src/room/RoomApp.tsx`
   (the join sheet: age attest, memory consent, locale), `api/_room-surface.js`
   (`joinRoom`, `roomSay`), `src/room/copy.ts` and its Hindi file, the Room's
   PWA install prompt (grep `beforeinstallprompt` and `room-install`) FIRST.
2. `evals/rehearsal/visitor-first-minute.mjs` (new, registered in the
   rehearsal lane, pre-pool if it builds dist): real Chromium, 390x844, the
   performance gate's own 4G throttling, a text-ready person's published Room
   in the fixture world; the walk: open `/r/<slug>` cold (no cache), read the
   about page, join (the sheet's minimum taps), ask one question, receive
   the fake seam's reply with the disclosure, see the install prompt after
   the first reply. Wall clocks per step and total, n=3, both locales, printed
   as a table and logged in measurements with method and date.
3. Budget: tap to about page readable under 3 s; join sheet to first reply
   under 8 s with the fake seam; total under 20 s. Where the walk exceeds a
   budget, find the cause (a blocking chunk, a serial fetch, a font, a layout
   shift) and fix it at the cause with a regression control; log each as a
   rejection. Never lower a budget to pass.
4. The join sheet is ONE screen at 390px: age attestation, memory consent,
   locale as it is, nothing below the fold that must be tapped; the keyboard
   never covers the primary button (prove with the viewport's visual
   viewport after focus). Copy stays as it is unless a line fails the
   read-aloud test; a changed line goes through the copy tables.
5. Negative controls: a paused Room shows the honest paused page inside the
   same budget; a Room with no published sheet is not reachable; the install
   prompt never appears before the first reply.

## Build

- evals/rehearsal/visitor-first-minute.mjs (new), evals/runner-lib.mjs
  (PRE_POOL_SUITES only if it builds dist), evals/run.mjs, src/room/RoomApp.tsx
  and its css (only what the budget forces), src/room/copy.ts and the Hindi
  file (only if a line changes), scripts/check-performance.mjs only if a
  target's budget must be RESTATED from a measurement (never loosened).
- context/: decision with reversal, measurements (the table), rejections
  (every cause found).
