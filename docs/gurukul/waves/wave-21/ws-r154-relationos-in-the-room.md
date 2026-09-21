# WS-R154: RelationOS in the Room. Every follower's private relationship with a person's AI gets the engine's relationship state (honorific, trust, rupture and repair, code-switch, stage) computed from that dyad's own Room episodes, rendered into the Room reply through the same relBundle the compiler already composes, visible to the follower as 'how we are' on their account page, and to the owner only as stage counts under the floor. Migration 165.

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

The engine's relationship state (`src/engine/relstate.ts`, `vy_rel_state`,
`vy_rel_event`) makes Meera feel like a person who knows you. The Room
reply today carries the follower's remembered facts but no relationship
state, so a paying follower's AI never changes register with them. The
agent-scope law already makes a dyad's state private.

Laws:
1. Read `src/engine/relstate.ts` and `india.ts`, `api/_relstate.js` (or the
   writer Meera uses; grep for the CALLER of `vy_rel_event`), `api/_room-surface.js`
   (roomSay, the compile call and its relBundle absence), `api/_agentscope.js`,
   `evals/room-leak/world.mjs`'s TABLE_ROLES, and rejected.md's
   `rupture-never-closes` FIRST.
2. Migration 165: only what the dyad needs that the existing tables lack;
   if `vy_rel_state`/`vy_rel_event` already scope by (agent_id, person_id),
   add nothing and say so; otherwise a `vy_room_dyad_state` keyed by
   (room_id, follower_id) with the same dims, no FK on person/agent
   columns, PERSON_TABLES entry with its lane, erasure through
   roomForgetCore, export manifest with a readable sentence in both locales.
3. The Room reply composes a `relBundle` from the dyad's state and its last
   moves (honorific move, rupture move, warm episodes since), through the
   SAME `compile()` path, with `nowMs` from the request clock; the moment
   gate and deixis rules apply unchanged; a follower who has memory OFF gets
   no relationship state (their choice is the predicate).
4. The follower's account page shows "How we are" (the stage in their own
   words, the honorific, whether a rupture is open, in both locales) with
   one action: reset to a fresh start (writes a rel event, never deletes
   history). The owner's studio shows stage counts under the n>=5 floor
   only.
5. The leak battery's layer 19: two followers in one Room never see each
   other's state, byte-checked; the door battery cases the reset op; evals/
   room-relstate (new) proves the bundle composition and the memory-off
   predicate with negative controls; the whole registry runs after the merge.

## Build

- db/migrations/165_*.sql (if needed), db/schema.sql, api/_room-relstate.js
  (new), api/_room-surface.js (compose and the account read/reset), api/room.js
  (ops), api/memory.js PERSON_TABLES, roomForgetCore, ROOM_EXPORT manifest,
  src/room/AccountPage.tsx + copy.ts + hiCopy.ts, src/creatorStudio (stage
  counts card, copy tables), evals/room-relstate (new), evals/room-leak,
  evals/room-doors, evals/room-export, evals/run.mjs.
- context/: decisions with reversal, measurements, rejections.
- Migration 165 only if needed. No new env var.
