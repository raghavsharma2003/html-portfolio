# WS-R161: Meet opens for any person. A text-first runtime capability: the moment a person has one source (Describe me, a file, or a recording still processing), their AI can talk in text as an apprentice with the disclosure prefix; voice arrives later without changing the door. Migration 167.

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

WS-R158 rehearsed the whole personal journey and found the product's biggest
gap: Meet does not open and no conversation or mirror-call turn completes,
because both require an ACTIVE runtime capability that only the full
processing and qualification pipeline (approved profile, calibration, voice
genome, ready voice profile, passing fidelity verdict) can grant, and that
pipeline needs Azure. A person who has just described themselves waits on a
GPU for something text never needed. The owner's intent is frictionless:
build, test, tweak. Testing in text must start immediately.

Laws:
1. Read `api/_replica-runtime.js` (the activation query and the capability
   states), `api/replica-dialogue.js` and its decision module, the
   experience compiler boundary `api/_experience-compiler/`, `api/_person-model.js`,
   `evals/rehearsal/personal.mjs` (WS-R158's walk and its named refusals),
   `context/rejected.md` entries on runtime capability and on fixtures
   standing in for runtime evidence, and `docs/gurukul/research/
   VOICE-CLONE-PRODUCT-UX-2026-08-30.md` FIRST.
2. Two capability levels, not one: `text_ready` (a person sheet or a
   Describe-me profile exists, no voice needed) and `voice_ready` (today's
   full pipeline). Migration 167 adds what the runtime needs to record the
   level honestly (a column or a small table; idempotent, one statement per
   request, no FK on replica or owner columns). The conversation door serves
   a `text_ready` AI with the apprentice framing and the disclosure prefix;
   the voice sample and mirror call stay refused with the honest blocker
   naming voice. Never a fabricated voice, never a claim of likeness.
3. The one door: every reply still goes through the gated reply path with
   never-rules, disclosure and the review queue; a text-ready reply is
   compiled from the person sheet (WS-R151), the vibe line (WS-R153) and the
   profile claims, through the same compiler.
4. The personal studio's Meet opens as soon as `text_ready` is true: the
   status beacon says "You can talk now; the voice is still being built"
   (both locales, through `src/studio/copy.ts` and `hiCopy.ts`).
5. `evals/rehearsal/personal.mjs` extends: Meet opens, one conversation
   turn completes with the fake reply seam and the disclosure prefix, the
   voice sample stays honestly refused; negative controls: a replica with no
   source is not text_ready; a revoked replica is refused.

## Build

- db/migrations/167_*.sql and db/schema.sql; api/_replica-runtime.js and the
  dialogue decision module; api/_experience-compiler/ only if a boundary
  needs the level; src/studio/CloneExperience.tsx (the beacon and Meet gate,
  minimal), src/studio/copy.ts and hiCopy.ts (one closed block); evals/
  rehearsal/personal.mjs; evals/room-doors (any new op); a new offline suite
  evals/text-ready/run.mjs with negative controls; evals/run.mjs.
- context/: decision with reversal (why two levels), measurements (turns,
  n=3), rejections.
