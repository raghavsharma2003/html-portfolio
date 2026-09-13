# WS-R179: the listening test against the person's own voice. The blind test plays the person's own reference recording beside each candidate, the verdict feeds the likeness score with its method stated, and "Sounds like you" explains its number in the person's words. No migration.

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

WS-R155 built the blind paired test and WS-R163 made its clips play. A
person judging two candidates without hearing themselves is guessing; the
score card shows a number nobody can explain. Voice quality is the most
important single thing, and a measured likeness is a product feature only
if the person can see how it was measured.

Laws:
1. Read `src/studio/ListeningTest.tsx`, `VoicePreviewPanel.tsx`'s likeness
   card, `api/_replica-calibration.js` (the verdict, `listeningVerdictFromRatings`),
   `api/_replica-voice-preview.js` (`ownedVoiceLikenessSummary`),
   `api/_replica-generation-audio.js` (WS-R163), the primary recording's
   storage path (`api/_replica-source.js`, `voice_role: primary`),
   `evals/voice-listening-benchmark/lib.mjs` (the axes), and WS-R155's
   decisions FIRST.
2. The reference: the person's primary recording plays through an
   owner-only door of the same shape as WS-R163's (sealed, owned, rate
   limited, watermark policy untouched); the test screen offers it beside
   each candidate; the order of candidates stays hidden until submit.
3. The score: `ownedVoiceLikenessSummary` states the method behind its
   number (which verdicts, which axes, n) and the card renders it in plain
   words in both locales; never a likeness claim from a fixture; an honest
   "not measured" when there is no verdict.
4. Proof: the listening-test suite gains the reference door's cases with
   negative controls (another owner's recording, a non-primary source, a
   signed-out read) and the card's method text; the door battery and
   incidents inventory name the new door.

## Build

- api/replica-source-audio.js and api/_replica-source-audio.js (new) or an
  op on the existing source door, api/_replica-voice-preview.js,
  src/studio/ListeningTest.tsx, VoicePreviewPanel.tsx, src/studio/copy.ts
  and hiCopy.ts (one closed block), evals/listening-test, evals/room-doors,
  evals/incidents, evals/run.mjs.
- context/: decision with reversal, measurements, rejections.
