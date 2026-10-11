# WS-R182: memory that grows on its own. The owner's own memory consolidation runs after a text-ready Meet turn through the metered wrapper the Room's sweep already has, so turn two remembers turn one without a voice and without a human pressing anything; offline behind the fake model seam, never a real spend without the env opt-in. Migration 172 only if needed.

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

WS-R172 made a text-ready Meet remember: the doors accept the text floor, the
agent is minted at text-ready, and turn two's compile carries a fact from
turn one WHEN a fact exists. But turn one honestly reports `has_memory:false`
because nothing consolidates the turn into facts: `runOwnerMemoryConsolidation`
(`api/_room-memory-authority.js`) is offline-proven and callable and wired to
nothing (`decisions.md#ws-r167-owner-memory-consolidation-left-unmetered`),
and the Room's own sweep is dev-gated behind `CONSOLIDATE_ROOM_DEV=1`. A
person's AI that forgets what they said five minutes ago is not their AI.

Laws:
1. Read `api/_room-memory-authority.js` (`runOwnerMemoryConsolidation`,
   `OWNER_MEMORY_BATCH_SQL`, `OWNER_MEMORY_COMMIT_SQL`),
   `api/_room-memory-consolidation.js` (`runMeteredRoomMemoryConsolidation`,
   the lease and budget), `api/_consolidation-config.js`, `api/consolidate.js`,
   `api/consolidate-sweep.js`, `api/_replica-dialogue.js`
   (`generateOwnedTextDialogue`, the WS-R172 tails), `evals/meet-continuity/`,
   `evals/text-ready/`, `evals/consolidation/`, and the two decisions named
   above FIRST. The reversal condition of the WS-R167 decision is your spec:
   wire the owner's sweep and the Room's through the SAME metered wrapper,
   never a second one.
2. After a text-ready turn completes, the owner's consolidation is scheduled
   for that `(agent_id, person_id)` through the metered wrapper: the lease
   table `meera_consolidate_lease` (already keyed generically), the budget
   config, the same admission the Room's sweep uses. The turn's response never
   waits on it (fire after respond, or the sweep door picks it up on its next
   tick; choose, and say why). A second turn arriving before consolidation
   finishes never double-consolidates (the lease proves it).
3. Offline: the consolidator runs against the fake model seam
   (`evals/rehearsal/stubs/`, the same fake `generateOwnedTextDialogue`'s
   rehearsal uses) and produces real rows in `vy_fact` for the owner's dyad;
   `evals/rehearsal/personal.mjs`'s text-ready continuity walk then shows turn
   two carrying a fact from turn one WITHOUT the seeded fixture fact (a new
   step, and the old seeded step stays as its own control), and "It
   remembers" in the studio refreshes to show it.
4. Spend: with no `CONSOLIDATE_ROOM_DEV=1` and no metered budget configured
   the sweep admits nothing and says so in its own receipt; no vendor call
   ever runs from this workstream's tests. `provider-budget` and
   `consolidation-config` suites stay green; if you add an env var it is a
   NAME in `docs/gurukul/ENV-MANIFEST.md`, never a value.
5. Scope: the owner's facts stay in the owner's dyad (the leak battery's layer
   19 grows a case: a follower's turn never consolidates into the owner's
   facts and the owner's never into a follower's); memory off (WS-R167's
   toggle) means no consolidation is scheduled at all, proven with a negative
   control.
6. No new table unless the lease or budget genuinely cannot express the
   owner's dyad (172 reserved; say why if you use it).

## Build

- api/_room-memory-authority.js, api/_room-memory-consolidation.js,
  api/_replica-dialogue.js (the smallest closed hunk after the turn commits),
  api/consolidate-sweep.js if the sweep must learn the owner lane,
  src/studio/ExpertConversation.tsx (refresh "It remembers" after a turn),
  evals/meet-continuity, evals/text-ready, evals/consolidation, evals/room-leak
  (layer 19), evals/rehearsal/personal.mjs, evals/run.mjs if a suite is added.
- context/: decision with reversal (supersede the WS-R167 decision by name),
  measurements (n, method, date), rejections.
