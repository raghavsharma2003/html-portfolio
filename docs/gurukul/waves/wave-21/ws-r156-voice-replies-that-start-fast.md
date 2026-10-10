# WS-R156: voice replies that start fast. The Room's voice reply is delivered as an ordered sequence of sentence clips synthesised and played as they arrive, under the same signed-clip contract, watermark and ceilings as today, so the first audio starts after the first sentence rather than after the whole reply; measured in Chromium against a fake synthesiser with a fixed per-sentence delay. No migration.

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

The runtime returns complete signed synthesis results under a GPU lock; it
is not streaming TTS, and the benchmark says call latency must include the
whole path. Sentence-level chunking is the part of that latency the
product controls without a new model.

Laws:
1. Read `api/_room-surface.js` (roomSpeak, the ceilings, the clip receipt),
   `api/_room-voice.js`, `api/_voice/` (preview authority, allocation
   boundary), `src/room/RoomApp.tsx` (the clip player), the push worker's
   audio handling, and `docs/gurukul/AZURE-DEPLOY-STATE.md` §8 (cold start)
   FIRST.
2. `speak` gains an ordered plan: the reply is split into sentences by a
   pure splitter (Hindi danda, Devanagari and Roman punctuation, numbers
   and abbreviations proven by a fixture of 40 sentences in three
   languages), each sentence synthesised through the EXISTING signed path
   as its own clip carrying (reply_sha256, index, count), the ceilings
   charged per clip by the same predicate, and a clip that fails stops the
   sequence honestly (the text stays readable).
3. The Room plays clips in index order as they arrive, buffering one ahead,
   with one control (pause/resume) and a visible "speaking" state; the
   watermark verification stays per clip.
4. Measure in Chromium with a fake synthesiser (fixed 400 ms per sentence):
   time to first audio for a five-sentence reply before and after, n=10,
   in measurements.md; the door battery cases the new op shape (forged
   index, out-of-range count, replay); the leak battery is untouched.

## Build

- api/_room-speak-plan.js (new: the splitter and the plan), api/_room-surface.js,
  api/room.js, src/room/RoomApp.tsx (+ copy in both files), evals/room-speak-plan
  (new), evals/room-doors, evals/room-push (only if the worker touches audio),
  evals/run.mjs.
- context/: decisions with reversal, measurements (n=10 before/after),
  rejections.
- No migration; no new env var.
