# WS-R162: a personal AI's Room publishes. The disclosure gate accepts a person sheet (sheet_kind person) with the person's own one-line disclosure, and a person's compiled prompt stops saying "you are a teacher". No migration unless a column is truly needed (168 reserved).

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

WS-R152 built Deploy for a personal AI on the real RoomStudio and found
that a personal AI's Room still cannot publish live: `api/_room-publish.js`
and the disclosure path refuse a generic-mode Room
(`rejected.md#ws-r7-room-for-generic-mode-with-no-disclosure-pathway`,
`ws-r152-personal-ai-room-still-cannot-publish-live`). WS-R151 added
`personDisclosureLine(sheet)` with no caller and left the compiler's
platform boundary saying "you are a teacher" for a person
(`decisions.md` under WS-R151). Deploy is a promise until this lands.

Laws:
1. Read `api/_room-publish.js`, `api/_disclosure.js`, `api/_agentscope.js`,
   `api/_room-about.js`, `api/_room-card.js`, `api/_room-surface.js`'s
   `loadTeacherAgent`, `src/engine/compiler.ts` (`PLATFORM_BOUNDARY`,
   `PLATFORM_STAGE_*`), `src/engine/agents/fromSheet.ts` (the person
   branch), WS-R151's and WS-R152's decisions and rejections FIRST.
2. The publish gate accepts a PUBLISHED sheet of either kind; a person sheet's
   disclosure is `personDisclosureLine`, shown on the Room's about page and
   the card in both locales, never "teacher" anywhere a person is not one.
3. The compiled prompt for a person carries a person boundary ("you are
   <Name> AI, made by <Name>" in the platform's words, never the person's
   own sentences; write shapes, never lines), and the 83 byte-identity
   fixtures stay byte-identical (they are all teachers or Meera).
4. The three scopes and the one door are untouched; the leak battery, the
   door battery and the export battery pass with any new person-kind case
   added by name.
5. `evals/rehearsal/personal.mjs`'s Deploy step reaches "Ready to open" for
   a person with a published person sheet, and the visitor link resolves to
   a Room whose about page shows the person's disclosure; negative control:
   an unpublished person sheet still shows the honest blocker.

## Build

- api/_room-publish.js, api/_disclosure.js (if the gate lives there),
  api/_room-about.js, api/_room-card.js, api/_room-surface.js (loading a
  person sheet's agent), src/engine/compiler.ts (the boundary) and
  `node scripts/build-engine-bundle.mjs`; src/room/copy.ts and hiCopy.ts
  only for a new string; evals/rehearsal/personal.mjs; evals/room-doors,
  room-leak, room-export cases; a new suite evals/person-room/run.mjs;
  evals/run.mjs.
- context/: decision with reversal, measurements, rejections.
