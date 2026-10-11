# WS-R167: the owner's own continuity in Meet. When a person talks to their own AI in Meet, it remembers what they said and how they are, exactly as a Room does for a follower: the owner is a private relationship too. Migration 170 only if needed.

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

Testing feels like a demo when every Meet conversation starts from nothing.
A person tweaking their AI should feel continuity: yesterday's test, the
fact they corrected, the register they used. The Room already has memory
per relationship (migrations 159, 162) and relationship state (WS-R154);
Meet has neither. Everything the Room proved about scopes applies: the
owner's own words are the owner's private scope, never creator material
that flows down.

Laws:
1. Read `api/_room-memory-authority.js`, `_room-memory-consolidation.js`,
   `_room-memory-reclassification.js`, `api/_room-relstate.js` (WS-R154),
   the dialogue decision module and `api/replica-dialogue.js`, `api/_agentscope.js`,
   `evals/room-leak/world.mjs` (TABLE_ROLES) and WS-R154's decisions FIRST.
2. The owner's Meet conversation is a relationship keyed by (agent, owner
   person) in the same tables (no new memory table unless the scope law
   needs one; 170 reserved); the same authority, consolidation and
   reclassification paths; the same controls (memory facts, correct, forget,
   classify) exposed on the dialogue door; relstate compiles into the
   owner's reply exactly as a follower's does.
3. The owner's Meet memory is private to the owner: it never enters the
   person sheet, the profile claims, the Room's creator material, the
   export's owner lane as verbatim, or any follower's compile. The leak
   battery gains a layer proving it (the owner's Meet facts absent from a
   follower's compile and from the owner's aggregate counts), with a
   negative control that the struck scope leaks.
4. Meet shows "It remembers" with the same honest controls as the Room's
   account page, in both locales through the personal studio's registry.
5. Erasure and export cover the new rows (existing cascade if the tables
   are the same; named in the manifest).

## Build

- the dialogue decision module and api/replica-dialogue.js, api/_room-memory-*.js
  (a caller, not a fork), api/_room-relstate.js (the owner key), evals/room-leak
  (a layer), evals/room-doors (ops), evals/room-export, src/studio/
  ExpertConversation.tsx (the controls), src/studio/copy.ts and hiCopy.ts,
  a new suite evals/meet-continuity/run.mjs, evals/run.mjs; db/migrations/170
  only if the scope law needs a column.
- context/: decision with reversal, measurements, rejections.
