# WS-R176: EmotionOS register in the reply and the voice. The register the AI reads in the other person (WS-R153) reaches the Room's reply compile and the per-sentence voice plan (WS-R168 passed register: null); proven offline with the fake model and synthesiser seams. No migration.

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

EmotionOS has two halves: the vibe the owner sets, and the register the AI
reads in the person it is talking to. WS-R153 built the reader and rendered
its hint only in the personal studio's compile; WS-R168 built prosody from
the vibe and left the register out of the Room (`decisions.md#ws-r168-register-not-threaded-into-roomspeak`).
A person's AI that hears you are rushed and answers at leisure is not human.

Laws:
1. Read `src/engine/register.ts`, `src/engine/compiler.ts`'s register hint
   gate, `api/_room-surface.js` (`roomSay`'s compile inputs and `roomSpeak`),
   `api/_voice/prosody.js`, `evals/emotionos`, `evals/prosody`,
   `evals/room-taste`'s field-set control, `evals/room-reply-language` and
   `evals/room-adversarial`'s tail invariants (WS-R153 narrowed them) FIRST.
2. `roomSay` reads the register of the follower's latest turn through the
   real reader and passes it to compile (both compile call sites keep the
   identical field set: the taste path passes a neutral read); the hint
   renders only at high confidence, never a neutral one, exactly as today.
3. `roomSpeak` builds the prosody plan with the register of the turn the
   reply answers (the reply's own `lr` binding names the turn), never a
   client-supplied read; the plan's bands are returned as today.
4. Proof: the 60 labelled turns drive the Room path end to end offline; a
   negative control shows a low-confidence read leaves both the prompt and
   the plan byte-identical to a neutral one; the door battery, leak battery
   and reply-language invariants pass.

## Build

- api/_room-surface.js, api/_engine.gen.js only if the engine changes,
  evals/emotionos (Room cases), evals/prosody, evals/room-speak-plan,
  evals/room-taste (its control untouched, both sites updated), evals/run.mjs.
- context/: decision with reversal, measurements, rejections.
