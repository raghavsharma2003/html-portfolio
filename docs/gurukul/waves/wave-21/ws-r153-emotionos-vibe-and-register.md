# WS-R153: EmotionOS, vibe and register. The owner sets their AI's vibe (warmth, energy, humour, directness, formality) as five shapes with reversible history; the compiler renders it as data; a deterministic, LLM-free read of the other person's turn (rushed, upset, excited, flat) yields a register hint that is pull-only and never a stored label; voice gets matching prosody hints. Migration 164.

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

The engine has the relationship dims and the moment gate, and the
experience compiler has a closed list of measurable expression features
that "cannot claim inner emotion". EmotionOS is the product layer over
those: what the AI's own vibe is, and how it responds to the register it
can measure in the other person, without ever pretending to know their
feelings.

Laws:
1. Read `src/engine/moment.ts` (the pull-only discipline, quoted), `src/engine/
   texture.ts`, `api/_experience-compiler/expression-observation.js`,
   `src/engine/compiler.ts` (tail order; SEARCH/FORGET stay dead last),
   `docs/gurukul/DESIGN-LAW.md`, and rejected.md on "sentence-shaped prompt
   text gets recited" FIRST.
2. Migration 164: `vy_replica_vibe` (vibe_id uuid, replica_id, owner_user_id,
   version int, warmth/energy/humour/directness/formality smallint 0..4
   each with CHECKs, note text <= 280, created_at, superseded_at); one live
   row per replica (a partial unique index where superseded_at is null); no
   FK on replica or owner columns; owner lane (OWNER_LANE_TABLES with a
   readable export sentence in both locales), erasure, relcheck, schema
   mirror.
3. The compiler renders the live vibe as ONE short data block of shapes
   ("warmth: high; energy: low; humour: dry, rare; directness: plain;
   formality: casual"), inside the platform-owned tail, never sentence
   lines; absent vibe renders nothing (byte-identical fixtures hold).
4. `src/engine/register.ts` (new, pure, no I/O): `readRegister(userText,
   {gapSinceLastMs, timeOfDay})` returns one of a closed set (rushed,
   upset, excited, flat, neutral) from surface features only (length,
   punctuation, repeats, caps, laughter tokens, Hindi/Hinglish markers from
   the existing tables), with confidence; it never names an emotion as a
   fact. The compiler renders a one-line register hint only when confidence
   is high and only for THIS turn ("they wrote fast and short; keep it
   short"), pull-only like the moment gate. An eval with 60 labelled turns
   in three languages, a confusion table in measurements, and a NEGATIVE
   control that a neutral turn renders nothing.
5. Voice: the same register maps to the existing prosody hints the
   synthesis request already carries (rate, pause); never a new provider
   field; proven offline.
6. The owner edits vibe on an EmotionOS screen in the personal studio
   (five segmented controls, a note, history with a one-tap revert), both
   locales, 390 and 1280, layout and accessibility fixture `studio:emotionos`;
   the follower never sees vibe; the door battery cases the new ops.

## Build

- db/migrations/164_replica_vibe.sql, db/schema.sql, api/_replica-vibe.js
  (+ api/replica-vibe.js door, withDoor), api/_creator-export.js,
  api/_replica-full-erasure.js, scripts/relcheck.mjs, src/engine/register.ts,
  src/engine/compiler.ts (+ rebuild api/_engine.gen.js), src/studio/
  EmotionOsStudio.tsx (+ css, copy), CloneExperience.tsx (menu entry),
  evals/emotionos (new), evals/room-doors, evals/run.mjs, fixtures.
- context/: decisions with reversal, measurements (the confusion table),
  rejections.
- Migration 164 only. No new env var.
