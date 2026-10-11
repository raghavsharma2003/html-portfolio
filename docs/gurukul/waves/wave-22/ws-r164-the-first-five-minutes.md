# WS-R164: the first five minutes. From the landing to a person's first reply from their own AI, on a phone, measured: every step honest, every wait explained, nothing a person can do wrong. No migration.

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

The owner asked for an amazing product flow. The pieces exist (the landing,
sign-in by OTP, the source-use agreement, Describe me, the recording, the
wait, Meet) and WS-R158 proved they connect, but nobody has designed the
first five minutes as ONE flow with a clock on it. This workstream owns the
flow end to end on 390 px first.

Laws:
1. Read `site/vyakti.html` (WS-R160), `src/studio/PersonalAuthGate.tsx`,
   `src/studio/PersonalStudioEntry.tsx`, `StudioApp.tsx`, `CloneExperience.tsx`
   (the shell, the beacon, the record and describe paths), `docs/gurukul/
   DESIGN-LAW.md`, `docs/gurukul/PRODUCT-JOURNEY.md`, WS-R158's rehearsal and
   its measurements FIRST.
2. Define the flow as steps with a time budget each (landing to sign-in,
   sign-in to first source, first source to Meet) and measure them in the
   rehearsal (n=3, wall clocks in measurements.md). Remove every step that
   is not required for a first text reply (WS-R161 is making text-ready
   real; build against its seam and state honestly what waits on it).
3. Every wait screen says what is happening and what the person can do now
   (Describe me while the voice builds); every error is a sentence a person
   can act on; no step depends on a desktop. Both locales through the
   personal studio's registry.
4. The landing's primary action goes straight to sign-in with the intent
   carried through (a person who came to build their own AI lands in the
   personal studio, never the teacher one).
5. A new layout and accessibility target per new screen state; the
   performance budgets on `/studio` still pass; `evals/rehearsal/personal.mjs`
   gains the clock and a negative control (a wrong OTP is refused with a
   sentence, never a stack).

## Build

- site/vyakti.html (the primary action only), src/studio/PersonalAuthGate.tsx,
  PersonalStudioEntry.tsx, StudioApp.tsx, CloneExperience.tsx (shell and wait
  states), src/studio/copy.ts and hiCopy.ts (one closed block), scripts/
  check-layout.mjs and check-accessibility.mjs targets, evals/rehearsal/
  personal.mjs, a new suite evals/first-five-minutes/run.mjs, evals/run.mjs.
- context/: decisions with reversal, measurements (the clocks), rejections.
