# WS-R180: how a person talks. The person sheet's "how you talk" (WS-R151's personTalk) drives the reply language policy the compiler already carries: Hindi, Hinglish or English, the mix and the script, per person, proven byte-exact on the reply-language suite in all three. No migration.

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

India first means a person's AI speaks the way they do: Hindi, Hinglish or
English, in the script they use. The compiler carries `replyLanguagePolicy`
(the Room's reply-language suite proves it for a teacher); the person sheet
records how the person talks (`personTalk`, WS-R151); nothing connects them,
so every person's AI answers in the platform default.

Laws:
1. Read `src/engine/agents/teacherTypes.ts` (`personTalk`), `fromSheet.ts`,
   `src/engine/compiler.ts` (`replyLanguagePolicy` and where it renders),
   `api/_room-surface.js` (how the policy is chosen today), `evals/room-reply-language.mjs`,
   `src/engine/relstate.ts`'s code-switch dims, and the Hindi text frontend
   under `api/_voice/` FIRST.
2. `replyLanguagePolicyFor(sheet, followerLocale)`: a pure function from the
   person's declared talk (language, mix, script) and the follower's own
   locale to the closed policy the compiler accepts; a teacher sheet keeps
   today's policy byte-exact (the 83 fixtures); the Room's reply path calls
   it; the text-ready Meet path (WS-R161) calls it too.
3. The voice path: the per-sentence plan's language id (WS-R156, R168)
   follows the same policy so the synthesiser's language conditioning
   matches the text.
4. Proof: `evals/room-reply-language` gains person cases in all three
   languages with the script asserted; negative controls: a follower's
   locale never overrides an explicit person policy; a missing talk field
   falls back to today's default, byte-identical.

## Build

- src/engine/agents/fromSheet.ts, src/engine/compiler.ts (only if the policy
  shape must widen), api/_engine.gen.js (rebuilt), api/_room-surface.js,
  api/_replica-dialogue.js, evals/room-reply-language.mjs, evals/person-sheet,
  evals/room-speak-plan (the language id), evals/run.mjs.
- context/: decision with reversal, measurements, rejections.
