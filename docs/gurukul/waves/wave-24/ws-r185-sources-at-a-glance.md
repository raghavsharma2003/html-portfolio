# WS-R185: sources at a glance. One Sources screen in the personal studio: every source the person gave (recording, file, link, channel, call), its state in plain words, what it yielded (claims, facts, minutes of voice), and "Remove" for one source through the existing single-source erasure, with what removing it takes away stated before the tap. No migration.

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

"From their own context (a recording, files, links, a channel, calls)". The
studio takes all five (the recorder, `add_files` and `add_links` on
`api/context-items.js`, `api/clone-channel.js`, MirrorCallStudio), and each
lands in a different panel with a different word for the same thing. A person
cannot answer "what does my AI know, and where from?" or "take that one back"
without reading five screens. Frictionless means one list.

Laws:
1. Read `api/_replica-source.js`, `api/context-items.js` and
   `api/_context-locker.js`, `api/_channel-watch.js` and `api/clone-channel.js`,
   `api/_replica-source-erasure.js` (single-source erasure and its receipt),
   `api/_person-model.js` (claims per source, citations),
   `api/_replica-processing/` (what a voice source yields),
   `src/studio/CloneExperience.tsx` (the Add more panel),
   `src/studio/PersonModelStudio.tsx`, `evals/source-storage-writer/`,
   `evals/replica-erasure/`, `evals/context-*` FIRST.
2. One owner-only read op returns the person's sources as one list: kind
   (recording, file, link, channel, call), a display name the person gave or
   the file name (never a storage path), state in the existing state
   vocabulary rendered as plain words in both locales ("ready", "still
   processing", "could not be read", "quarantined: mentions other people"),
   and what it yielded as counts (claims accepted, facts, voice seconds) from
   the tables that already hold them. Count-shaped statements; never a
   claim's text in this list.
3. "Remove" calls the existing single-source erasure and shows, BEFORE the
   tap, what goes with it (the claims that cite only this source, the voice
   seconds), from a read op that answers the same question the erasure will
   act on; after the tap the receipt the erasure already returns is shown.
   Negative controls: a stranger's bearer, another owner's source id, a
   source already erased.
4. The screen replaces nothing: the recorder and Add more stay where they
   are; this is the list that ties them together, reached from Add more and
   from HumanOS ("Draft it from what I gave" links here). Both locales as one
   closed block; a layout and accessibility target with `mounted`.
5. The rehearsal gains a step: after the recording and one file, Sources
   lists two entries with the right kinds and states; removing the file
   drops it and its claims count; the recording stays.

## Build

- api/_replica-source.js (the list read), api/_replica-source-erasure.js
  (the "what goes with it" read, if not already answerable), the owner door
  the studio uses for sources (grep `add_files`), src/studio/SourcesStudio.tsx
  (new) + css, src/studio/CloneExperience.tsx (the entry, smallest hunk),
  src/studio/copy.ts and hiCopy.ts, scripts/check-layout.mjs and
  check-accessibility.mjs (one target each), evals/sources-studio/run.mjs
  (new, registered), evals/room-doors (OP_COVERAGE, OP_INVOKE),
  evals/replica-erasure, evals/rehearsal/personal.mjs, evals/run.mjs.
- context/: decision with reversal, measurements, rejections.
