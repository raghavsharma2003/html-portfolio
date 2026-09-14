# WS-R168: EmotionOS in the voice. The five vibe dials and the register read shape how a voice reply is spoken (pace, pauses, energy, warmth) through the provider seam, proven offline against the fake synthesiser and a real waveform measure; "hear the vibe" in the studio through the existing preview seam. No migration.

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

EmotionOS today shapes the words (WS-R153). The owner's intent is that a
person's AI has their vibe in the voice too: prosody. Azure serving is the
policy and no money may be spent, so this workstream builds the mapping and
its proof behind the seams the voice program already has.

Laws:
1. Read `api/_voice/` (language conditioning, the Hindi text frontend, the
   providers and their request shapes), `api/_replica-voice-preview.js`,
   `api/_room-speak-plan.js` and `roomSpeak` (WS-R156), `api/_replica-vibe.js`,
   `src/engine/register.ts`, `evals/voice-listening-benchmark/`, `evals/
   echosim/` (how a waveform is measured offline), and the Azure-only serving
   policy FIRST.
2. A pure mapper `api/_voice/prosody.js`: vibe dials plus the register read
   to a closed prosody plan (rate, pause lengths at sentence and clause
   boundaries, energy and pitch-range hints) expressed in the provider
   request's OWN fields where they exist and in the text frontend's
   punctuation and pause tokens where they do not; per language (Hindi,
   Hinglish, English); no free text ever enters a prompt from here.
3. The Room's per-sentence clips (WS-R156) carry the plan; the preview
   endpoint accepts it for "hear the vibe" in `VoicePreviewPanel.tsx` (both
   locales), behind the preview authority and its cap; never a new provider
   call in the gate.
4. Proof: with the fake synthesiser, the plan changes the produced timing
   deterministically (measured pauses and rate on the fake waveform,
   n=60 lines across the three languages); a negative control shows a
   neutral plan leaves the base output byte-identical; never a likeness
   claim.
5. The watermark and disclosure paths are untouched and proven so.

## Build

- api/_voice/prosody.js (new) and its callers in api/_voice/* and
  api/_replica-voice-preview.js, api/_room-surface.js (roomSpeak carries the
  plan), src/studio/VoicePreviewPanel.tsx, src/studio/copy.ts and hiCopy.ts,
  evals/prosody/run.mjs (new), evals/room-speak-plan (a case), evals/run.mjs.
- context/: decision with reversal, measurements (the timing table), rejections.
