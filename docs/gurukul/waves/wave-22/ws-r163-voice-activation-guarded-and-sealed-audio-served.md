# WS-R163: the voice activation guard wired, and a sealed generation's audio served to its owner. `guardOwnedVoiceActivation` sits inside the runtime's activation query; one owner-only endpoint streams a past sealed generation's bytes so the listening test plays real clips. Migration 169 only if needed.

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

WS-R155 shipped the listening test and the law that a losing candidate is
never activated without a logged override, but left two open items: the
guard is not wired into `api/_replica-runtime.js`'s activation query, and
no endpoint serves a past sealed generation's audio, so the test's players
show "not available yet". Voice quality is the most important single thing;
a listening test that cannot play is not one.

Laws:
1. Read `api/_replica-calibration.js` (`guardOwnedVoiceActivation`,
   `decideVoiceActivation`), `api/_replica-runtime.js`, `api/_replica-voice-preview.js`,
   the generation and artifact tables in db/schema.sql (migrations 025, 046
   and their sealed-generation shape), the audio protection service's
   watermark contract under `services/audio-protection`, and WS-R155's
   decisions FIRST.
2. Activation: the runtime's activation path calls the guard; a losing
   candidate activates only with a logged override in `vy_replica_audit`;
   the door battery gains the refusal case; a fake db proves both branches.
3. Audio: `api/replica-generation-audio.js` (thin, withDoor) over a decision
   module: owner bearer only, the generation must be sealed and owned by
   the replica's owner, bytes come from the existing storage seam (the same
   signed-read path uploads use), watermark policy untouched, rate table
   entry, honest 404 for anything else. No new storage, no vendor call.
4. `src/studio/ListeningTest.tsx` plays through the endpoint; the layout and
   accessibility targets still pass; the players carry an honest state when
   audio is absent.
5. Offline proof: a fake storage seam returning fixture bytes; negative
   controls: another owner's generation, an unsealed generation, a signed-out
   read, a forged replica id.

## Build

- api/_replica-runtime.js (the guard call), api/replica-generation-audio.js
  and api/_replica-generation-audio.js (new), the rate table, evals/
  room-doors OP_COVERAGE, evals/incidents (a new door), src/studio/
  ListeningTest.tsx and calibrationApi.ts, evals/listening-test/run.mjs,
  evals/run.mjs; db/migrations/169 only if a column is truly needed.
- context/: decision with reversal, measurements, rejections.
