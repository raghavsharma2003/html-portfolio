# WS-R189: my data, in one place. A person's export: everything their AI holds about them and everything it holds for them (sheet, sources, claims, memory, the relationship counts, generations, consents, receipts) through one owner door, readable in both languages, complete by the same battery that proves the creator's export; and erasure walked in Chromium from the studio's own button to the receipt. Migration 173 only if needed.

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

A person's AI is their online identity, which means the data behind it is the
most personal data they will ever hand a product. The creator has an export
(`api/_creator-export.js`, `OWNER_LANE_TABLES`, the completeness battery
`evals/room-export`) and the follower has theirs (`api/export.js`). The
person who built their own AI has the creator's export with a teacher's
vocabulary and gaps WS-R175 was still filling. And full erasure
(`api/_replica-full-erasure.js`) has never been clicked from the studio in a
browser.

Laws:
1. Read `api/_creator-export.js` (`OWNER_LANE_TABLES`,
   `OWNER_LANE_DELIBERATE_GAPS`, WS-R175's additions), `api/export.js`,
   `api/_room-export-readable.js` (the readable rendering), `evals/room-export/`
   and `evals/creator-export/` (the completeness batteries, how they walk the
   schema), `api/_replica-full-erasure.js` and `api/replica-erasure-sweep.js`
   (the erasure job, lease, receipt), `evals/replica-erasure/`,
   `evals/erasure-order/` (WS-R175's FK model), the studio's erasure entry
   (grep `erasure` in src/studio) FIRST.
2. The person's export is the creator's export door with a person-kind
   rendering (never a second door): the sheet (HumanOS) in the person's own
   words, sources with kinds and states, accepted claims with citations, the
   owner's own Meet memory (facts, with the consent scope that allowed them),
   relationship state as COUNTS only (n>=5, never a follower's words),
   generations and listening verdicts, consents with versions and dates,
   receipts; readable in both languages through the readable renderer;
   machine-readable JSON beside it. The completeness battery walks every
   table with an owner or replica column and fails by name on one the export
   neither includes nor lists as a deliberate gap with a reason.
3. Erasure: the studio's own button (or a new one in the same place the
   account controls live) starts the existing erasure job; the rehearsal
   walks it in Chromium: request, the honest "in progress" state, the sweep
   runs in-process, the receipt shows what was deleted by class, reloading
   shows the erased state (WS-R172's revoked-state control extends to
   purged), and a second sign-in starts from nothing. Negative controls: a
   follower's session cannot start it; a stranger's bearer is refused; an
   export requested after erasure returns the receipt and nothing else.
4. Both locales through the copy tables as one closed block; a layout and
   accessibility target for the export screen with `mounted`.
5. No new table unless the export must persist a request (173 reserved; say
   why).

## Build

- api/_creator-export.js (the person-kind rendering, the manifest entries),
  api/_room-export-readable.js, src/studio/MyDataStudio.tsx (new) + css,
  src/studio/CloneExperience.tsx (entry, smallest hunk), src/studio/copy.ts
  and hiCopy.ts, scripts/check-layout.mjs and check-accessibility.mjs (one
  target each), evals/person-export/run.mjs (new, registered, the completeness
  walk for the person lane), evals/creator-export, evals/room-export,
  evals/replica-erasure, evals/rehearsal/personal.mjs (the erasure walk),
  evals/run.mjs.
- context/: decision with reversal, measurements, rejections.
