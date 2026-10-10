# WS-R183: RelationOS for the person. A Relationships screen in the personal studio: who talks to my AI, as counts only (n>=5 per bucket, never a name, never a line), by stage and by recency, with the person's own controls: pause my Room, quiet hours, and which check-ins my AI may send. Migration 174 only if needed.

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

RelationOS is "how it treats each person". The follower sees "How we are" in
the Room (WS-R154). The creator's ops board sees stage counts floored at five
(`roomRelStateStageCounts`, WS-R154 and WS-R167's owner-dyad exclusion). The
PERSON who built their own AI sees nothing: no screen in `src/studio/` reads a
relationship count. A person deploying their AI as their online identity
needs to know it is talking to people, how those relationships are going, and
to hold the leash: pause, quiet hours, what it may initiate.

Laws:
1. Read `api/_room-relstate.js` (`roomRelStateStageCounts`, the n>=5 floor,
   the owner-dyad exclusion made count-shaped in WS-R167), `api/ops.js` and
   `src/creatorStudio/OpsBoard.tsx` (what the creator already sees, and its
   copy), `api/_room-checkins.js` and `api/_room-quiet-hours.js` (or the
   files that own check-ins and quiet hours; grep for `quiet_hours` and
   `checkin`), `api/_room-publish.js` (pause), `src/studio/DeployStudio.tsx`,
   `src/studio/ExpertSharePanel.tsx`, `evals/room-relstate/`,
   `evals/room-cohorts/`, `evals/room-leak/` FIRST.
2. One owner-only read door op (on the existing owner door the personal
   studio already uses for Deploy; never a new HTTP file unless the door
   battery's rules force it) returns: stage buckets with counts (each n>=5 or
   absent), people-this-week and people-this-month as counts (n>=5 or absent),
   check-ins sent this week as a count, handoffs waiting as a count. Every
   statement is count-shaped (WS-R167's lesson: a creator-lane statement
   never reads a row). The owner's own dyad is excluded exactly as WS-R167
   excludes it.
3. Controls on the same screen: pause / resume the Room (the existing publish
   lock's pause, never a new state), quiet hours for what the AI initiates
   (reuse the Room's own quiet-hours setting if it is per-agent; if it is
   per-follower only, add the agent-level default with the smallest change
   and say so), and which check-in kinds the AI may send (the existing
   check-in kinds, as toggles). Each control is a real door op with a
   negative control (a stranger's bearer is refused; a follower's session
   cannot reach it).
4. The screen lives in the personal studio behind Deploy (`Share` tab), in
   both locales through `src/studio/copy.ts` and `hiCopy.ts` as one closed
   block, joins the layout and accessibility gates as its own target with a
   `mounted` selector, and reads honestly: fewer than five people in a bucket
   renders "fewer than five" in words, never a number under five, never a
   bar of zero height pretending to be data.
5. Leak: a new layer in `evals/room-leak/run.mjs` proves the owner's screen
   never carries a person id, a name, a message, or a count under five, and
   that owner A never sees owner B's counts.
6. No new table unless a control has nowhere to live (174 reserved; say why).

## Build

- api/_room-relstate.js (count-shaped reads), the owner door file the studio
  already uses (grep `DeployStudio.tsx` for its fetch), api/_room-publish.js
  (pause), the check-in and quiet-hours owners, src/studio/RelationsStudio.tsx
  (new) + relations-studio.css, src/studio/copy.ts and hiCopy.ts (one closed
  block each), scripts/check-layout.mjs and check-accessibility.mjs (one
  target each, appended), evals/relations-studio/run.mjs (new, registered),
  evals/room-relstate, evals/room-leak, evals/room-doors (OP_COVERAGE and
  OP_INVOKE), evals/run.mjs.
- context/: decision with reversal, measurements, rejections.
