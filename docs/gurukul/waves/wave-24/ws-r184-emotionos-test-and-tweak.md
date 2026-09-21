# WS-R184: EmotionOS test-and-tweak. In Meet, after any reply: "Tweak this": the five vibe dials open beside the reply, the same turn replays through the real door with the new vibe (never persisted, never remembered), old and new read side by side, and "Keep this vibe" saves through the existing vibe door. No migration.

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

The owner's directive is "test it, tweak it". Today the person sets vibe dials
in EmotionOsStudio (WS-R153), then goes to Meet and talks, and has to
remember what changed. The loop that makes an AI feel like yours is: read a
reply, feel that it is off, turn one dial, hear the same moment again, keep
the one you prefer. That loop must be one screen and under ten seconds.

Laws:
1. Read `src/studio/EmotionOsStudio.tsx`, `src/studio/replicaVibeApi.ts`,
   `api/_replica-vibe.js` (or the file owning the vibe door; grep
   `vibe` in api/), `api/_replica-dialogue.js`
   (`generateOwnedTextDialogue`, how `vibe` reaches the compile; WS-R172's and
   WS-R180's tails), `src/studio/ExpertConversation.tsx`, `evals/emotionos/`,
   `evals/text-ready/`, `evals/meet-continuity/`, `evals/dialogue-history*`
   FIRST.
2. A replay op on the owner's dialogue door: the same message as the turn it
   replays (by turn id, never client-supplied text), an explicit vibe override
   (the five dials, validated by the vibe door's own validator), the same
   compile path as a real turn including the memory and language tails, and
   NOTHING persisted: no dialogue-history row, no consolidation scheduled, no
   fact, no turn id minted for the replay. The response carries the replayed
   reply and the vibe it used. Negative controls: a replay never appears in
   history; a replay with memory on never writes a fact; a stranger's bearer
   is refused; a turn id from another owner's replica is refused.
3. The Tweak panel in Meet: opens beside the reply (390px: below it), five
   dials with the same copy EmotionOsStudio uses (reuse its component, never a
   second dial), "Replay" runs the op and shows old and new side by side with
   the dials' delta stated in words ("warmer, more direct"); "Keep this vibe"
   calls the existing vibe save; "Discard" closes. Both locales through
   `src/studio/copy.ts` and `hiCopy.ts` as one closed block; joins the layout
   and accessibility gates as its own target.
4. The rehearsal (`evals/rehearsal/personal.mjs`) gains a step: tweak one dial
   on the last reply, replay, see two replies, keep, and the next real turn
   uses the kept vibe (proven through the compiled prompt in the fake seam).
5. Nothing here touches the Room's follower-facing doors or the voice.

## Build

- api/_replica-dialogue.js (one new exported op, smallest closed hunk),
  the owner dialogue HTTP door only if the op needs its own case,
  src/studio/TweakReply.tsx (new) + its css, src/studio/ExpertConversation.tsx
  (mount), src/studio/copy.ts and hiCopy.ts, scripts/check-layout.mjs and
  check-accessibility.mjs (one target each), evals/tweak-reply/run.mjs (new,
  registered), evals/emotionos, evals/text-ready, evals/room-doors
  (OP_COVERAGE, OP_INVOKE), evals/rehearsal/personal.mjs, evals/run.mjs.
- context/: decision with reversal, measurements (the loop's wall clock in
  the rehearsal, n and date), rejections.
