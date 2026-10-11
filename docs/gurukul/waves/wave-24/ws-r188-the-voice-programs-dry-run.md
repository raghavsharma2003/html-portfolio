# WS-R188: the voice program's dry run. Everything from a person's recording to a Room clip in their voice runs end to end as ONE rehearsal on the deterministic fake provider (enrol, process, candidate, listening test, activation guard, "Hear the vibe", a Room reply spoken sentence by sentence), and one documented command runs the same path live the day an Azure credential exists; env var names, never values; no money. No migration.

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

Voice quality is the most important single thing, and the voice program has
been blocked on an Azure credential for a week. Every piece exists in
isolation: the processing pipeline and GPU admission (`api/_replica-processing/`,
`services/`), candidates and qualification (WS-R163's guard), the listening
test (WS-R155, R163, R179), the prosody plan (WS-R168, R176), sentence-by-
sentence Room clips (WS-R156). Nobody has run them as one path on the fake,
so nobody knows whether the day the credential arrives is a day or a week.
This workstream makes it a day.

Laws:
1. Read `docs/gurukul/VOICE-*.md` and `docs/handoff/2026-09-09/` (Codex's
   Azure notes), `api/_replica-processing/`, `services/azure-voice-app`,
   `azure-gpu-job`, `replica-processing-worker`, `api/_voice/` (allocation,
   preview authority, providers, the deterministic fake), `api/_replica-runtime.js`
   (`activateOwnedRuntime`, `guardOwnedVoiceActivation`), `evals/rehearsal/`
   stubs, `evals/listening-test/`, `evals/room-speak-plan/`,
   `docs/gurukul/ENV-MANIFEST.md`, `docs/gurukul/DAY-ONE.md` FIRST.
2. `evals/rehearsal/voice-dry-run.mjs` (new, registered, pre-pool if it builds
   dist): a real Chromium signs in as the person, records (the loopback mock
   microphone), the processing worker runs in-process against the fake
   provider (the same fake the existing suites use, never a new one), a
   candidate is produced and qualified, the person runs one paired listening
   verdict, the activation guard admits the winner, "Hear the vibe" plays a
   clip, a follower's Room reply is spoken sentence by sentence with the
   bound register (WS-R176) and the declared language (WS-R180). Every step
   is a real door; every clip is the fake's deterministic bytes; wall clocks
   per step, n=3, logged.
3. `scripts/voice-day-one.mjs` (new): the SAME path against the live
   provider, gated on the env var NAMES the manifest lists (Azure Foundry and
   Speech keys, the subscription and tenant ids), refusing by name when any
   is missing, dry-run by default (`--live` to spend), printing the exact
   spend ceiling it will honour from `api/_consolidation-config.js`'s and the
   voice budget's own numbers; `docs/gurukul/VOICE-DAY-ONE.md` (new) is the
   runbook: what to set, what the command does, what the receipts look like,
   what "likeness measured on a real voice" will mean and where the number
   will land (`vy_voice_fidelity`, the likeness card). Never a value in the
   docs.
4. Every gap the dry run finds between two pieces (a shape mismatch, a
   missing op, a state the next piece cannot read) is fixed at its cause with
   a regression control and logged as a rejection; the report lists each.
5. No vendor call, no GPU wake, no money: the live command is proven to
   refuse without the env names (a negative control in a suite), never by
   running it.

## Build

- evals/rehearsal/voice-dry-run.mjs (new), scripts/voice-day-one.mjs (new),
  docs/gurukul/VOICE-DAY-ONE.md (new), docs/gurukul/ENV-MANIFEST.md (names
  only, if any are missing), the seams the dry run repairs (smallest hunks,
  each named in the report), evals/voice-day-one/run.mjs (new: the refusal
  controls), evals/runner-lib.mjs (PRE_POOL_SUITES if it builds dist),
  evals/run.mjs.
- context/: decision with reversal, measurements (the step clocks), rejections
  (every gap).
