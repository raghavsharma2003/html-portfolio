# WS-R166: the personal studio in Hindi, tier two. CloneExperience's shell, CloneVerificationJourney, VoicePreviewPanel, MirrorCallStudio and ContextLockerPanel converted to the registry; the creator studio's Hindi glyph probe made real again. No migration.

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

WS-R159 converted four screens and left the shell and five panels as tier
two (`decisions.md#ws-r159-tier-1-scope-and-tier-2-allowlist`), and found
that `check-layout.mjs`'s creator-studio Hindi glyph probe has been vacuous
since the handoff206 rename (`rejected.md#ws-r159-creatorstudio-hi-glyph-probe-targets-the-wrong-fixture`).
Hindi is first-class or it is not.

Laws:
1. Read `src/studio/copy.ts`, `hiCopy.ts`, `localeContext.tsx`, `LanguageSwitch.tsx`,
   `evals/studio-locale-personal/run.mjs`, WS-R159's decisions and rejections,
   `scripts/check-layout.mjs`'s glyph probe, and `scripts/copy-room-scope.mjs` FIRST.
2. Convert `CloneExperience.tsx`'s shell and menus (including WS-R151's HumanOS,
   WS-R152's Deploy banner, WS-R153's EmotionOS entry and WS-R155's listening
   copy), `CloneVerificationJourney.tsx`, `VoicePreviewPanel.tsx`,
   `MirrorCallStudio.tsx`, `ContextLockerPanel.tsx`: every user-visible string
   through the registry, one closed block per screen in BOTH tables; the
   tier-two allowlist shrinks to `VideoEnrollPanel.tsx` (the consent ceremony
   carve-out) and the suite's zero-literal-English scan covers each converted
   file.
3. The glyph probe points at the personal studio fixture AND the creator
   fixture, proves a Devanagari glyph renders with the bundled face (not a
   fallback), with a negative control that a missing face is caught.
4. Layout and accessibility targets in Hindi for each converted screen
   state; the first-Hindi-paint budget on `/studio` measured (n=5) and stated.
5. Never a "clone" or dash in a string; the copy gate passes both scopes.

## Build

- src/studio/copy.ts, hiCopy.ts, CloneExperience.tsx, CloneVerificationJourney.tsx,
  VoicePreviewPanel.tsx, MirrorCallStudio.tsx, ContextLockerPanel.tsx,
  scripts/check-layout.mjs (the probe and targets), scripts/check-accessibility.mjs,
  evals/studio-locale-personal/run.mjs, evals/run.mjs.
- context/: decisions, measurements (string counts, chunk size, paint), rejections.
