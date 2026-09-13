# WS-R159: the personal studio in Hindi. Every user-visible string of the personal studio (CloneExperience, the verification journey, the voice panels, Meet, Evolve, Talk, Share) moves into a copy registry with a Hindi table loaded as its own chunk, a language switch on the auth screen and in the shell, the locale remembered and carried by the URL, under the copy gate, the layout gate and the accessibility gate in both locales. No migration.

Read scratchpad w21/ws-common.md FIRST (the file the launcher names); every
rule there binds. Your worktree is checked out at the wave-twenty-one base
482e54b (verify with `git log --oneline -1`). The gate is 24 checks without
NEON_URL; run touched suites while you build and the full gate ONCE at the
end. Ten siblings build beside you on this machine: R151 HumanOS (the person
sheet, migration 163), R152 Deploy for a personal AI, R153 EmotionOS (vibe and
register, migration 164), R154 RelationOS in the Room (migration 165), R155
"Sounds like you" and the listening test (migration 166), R156 voice replies
that start fast, R157 the Vyakti mobile app, R158 the personal journey
rehearsed, R159 the personal studio in Hindi, R160 the Room and the landing
for any person. Migration numbers are ASSIGNED; never take another. Keep your
edits inside the files your brief names and append-only in shared files so
the main loop can merge mechanically. Do not spend money, do not touch the
live database, never print or commit a secret, never kill a process by
pattern, never `git stash`, never end a turn waiting on a monitor: gate in
the foreground with a timeout, commit, `git status` clean, full report in the
same turn.

## Product

The creator studio and the Room are fully bilingual through copy tables.
The personal studio, the product's front door, is inline English. India
first means the first screen a person sees speaks their language.

Laws:
1. Read `src/creatorStudio/copy.ts`, `hiCopy.ts`, `hiAuthCopy.ts`,
   `localeContext.tsx` (or its equivalent), `src/studio/personalAuthCopy.ts`,
   `personalAuthCopyRegistry.ts`, `personalAuthLocale.tsx` (the personal
   auth screen's existing registry pattern), `scripts/check-copy.mjs`,
   `evals/studio-locale`, WS-R71's and WS-R113's chunk decisions in
   context/decisions.md FIRST.
2. Extend the personal auth registry pattern to the whole personal studio:
   `src/studio/copy.ts` (English, typed sections per screen) and
   `src/studio/hiCopy.ts` (Hindi, lazily loaded as its own chunk, throwing
   by section until installed, the WS-R71 shape); a provider that renders
   nothing until ready; every inline string in the files named below moves
   into it (count them; the number goes in measurements). The auth screen's
   registry merges into the same provider without changing its strings.
3. Locale: `?lang=` first, then the replica's own locale, then the
   remembered choice, then English; the switch lives in the studio shell
   and on the auth screen; the URL carries it across reload and history.
4. Hindi copy: plain, functional, Devanagari through the bundled face,
   product names (Vyakti, HumanOS, RelationOS, EmotionOS) untranslated; no
   dash characters; the vocabulary rule holds in both languages.
5. Gates: the copy gate scans the new table; `evals/studio-locale` gains the
   personal studio's parity check (every English key has Hindi, no empty
   string, no English fallback rendered in Hindi mode, proven by mounting);
   layout and accessibility fixtures `studio-hi:personal-*` for the main
   screens; the performance gate's studio-hi target still meets its budget
   (report the chunk size).

## Build

- src/studio/copy.ts (new), hiCopy.ts (new), localeContext.tsx (new or the
  existing one generalized), CloneExperience.tsx, CloneVerificationJourney.tsx,
  VoicePreviewPanel.tsx, VoiceField.tsx, QuickVoiceCapture.tsx, ExpertConversation.tsx,
  PersonModelStudio.tsx, MirrorCallStudio.tsx, ExpertSharePanel.tsx,
  PrivateTextRehearsal.tsx, ContextLockerPanel.tsx, VideoEnrollPanel.tsx,
  StudioApp.tsx, PersonalStudioEntry.tsx; scripts/check-copy.mjs (scope);
  evals/studio-locale; fixtures.
- context/: decisions with reversal, measurements (string count, chunk
  size), rejections.
- No migration; no new env var.
