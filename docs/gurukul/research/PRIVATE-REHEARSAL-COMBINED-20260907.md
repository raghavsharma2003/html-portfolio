# Private rehearsal combined candidate, 2026-09-07

Worktree: `scratchpad/private-rehearsal-combined`, branch
`codex/private-rehearsal-combined`, base
`c56cadfe72a20ee02781485752d8d67fcfc6fb21`. No commit, deployment, model call,
SQL execution or browser batch was performed by this combining agent.

## Frozen inputs

All 45 listed source hashes were verified before merging; four authority
context files were checked but omitted. The resulting 41 source files came
only from these ROOT `scratchpad/expert-tools` manifests:

* `PRIVATE-REHEARSAL-ENGINE-FREEZE-20260907.json`: nine files, base
  `da3ac2aeac29571ae45a4507d947b1cf603cf9c1`.
* `PRIVATE-TEXT-REHEARSAL-UI-FREEZE-20260907.json`: nine files, base
  `6fb86e92ed9615f26595d692b6b8964985ea99db`.
* `private-text-authority-handoff-20260907.json`: 23 files including four
  excluded context files, base `da3ac2aeac29571ae45a4507d947b1cf603cf9c1`,
  frozen authority head `1f8421eee994f75b8d8d148a800dbf904990c607`.
* `dialogue-unicode-hashes-20260907.json`: four files, base checkpoint21.

The active cancellation142 and successor UI work are not included. Original
source checkouts and expert-integration were not modified.

## Exact merge resolutions

`CloneExperience.tsx` merged cleanly against the UI base. Its checkpoint21
recorder and voice-saga persistence functions remain byte-identical, tested
from the actual TypeScript AST. Existing build-intent/CAS and owned capture
helper/QuickVoiceCapture/VoiceEnrollmentLab files remain identical to21.
The final Studio diff adds only rehearsal navigation and mounting.

`api/_replica-source.js` and `api/_replica-source-erasure.js` each had two
conflicts: private authority's new parent-row update versus21's source-first
NOWAIT locks, primary snapshot comparison and existing parent update.
The merged SQL keeps the checkpoint21 locks, wrapper, snapshot comparison,
stale error and single existing parent update. That update now also increments
`private_text_epoch`. Mark-deleting retains exact-source private payload
deletion. Completion removes the old identity/primary-only predicate from
its parent update, so every actual erased target advances the private epoch;
the existing source deletion still depends on those parent effects. This
avoids two writable CTEs updating the same replica row in one statement.
The private epoch only advances when the existing target gate admits work.
No SQL correctness or lock-interleaving proof follows from source merging.

`db/schema.sql` retains migration140 and appends141, in that order. The
individual migration140 file stays unchanged. Both migrations' statements are
checked against the merged schema. Checkout CRLF was preserved because the
incumbent primary CAS fixture compares literal statement text.

Root subsequently reported real database error42702 in frozen authority's
Mirror decision: `UPDATE vy_mirror_delta d FROM candidate c RETURNING` used
unqualified `delta_id` and `target_field`. Only the combined
`api/_mirrorcall-store.js` projection was changed to all19 explicit `d.`
columns. The frozen authority file was not changed. The new merge fixture
captures actual `decideMirrorDelta` SQL and rejects an unqualified-column
mutant. Root's actual private authority SQL harness imports this function and
will validate the final SQL separately.

## Checks actually run

Node v24.13.0, 2026-09-07; retained outputs in this isolate's
`scratchpad/combined-checks/`:

| Check | Result and limit |
| --- | --- |
| `tsc -b --force` | Passed; no Vite web build |
| Private compiler | 17 groups, actual frozen engine bundle |
| Private handler | 17 groups, actual compiler/output gate; injected accounting/store |
| Private store | 16 groups, real encryption and canonical producer; injected SQL rows |
| Shared Unicode | 13 groups; exact incumbent corruption and actual service/readers |
| Private UI `--source-only` | 11 response controls and2 navigation-persistence controls; mounted14 not rerun |
| Primary selection CAS | 14 controls, actual captured production SQL; no SQL execution |
| Combined merge | 7 groups, both epochs/one update, mutants, migration mirroring, capture preservation and Mirror projection |
| Owned WAV start | 33 synthetic resource-lifetime groups |
| Clone experience QA | 20 source/contract checks |
| Registry runner | 15 offline child-process controls |
| Engine bundle `--check` | Fresh, 354368 reported bytes; committed artifact not rewritten |
| Changed UI copy | Actual `scanSource` on three changed TS/TSX files: no offences |
| Separator parser | Eight incumbent parser controls |
| Context | 2283 nodes,2363 edges,4 documents |

The plain Windows invocation of `scripts/check-copy.mjs` exited without output
because its existing direct-entry URL guard does not match this invocation.
It is not counted as full copy-gate evidence; the three-file scanner call
above actually ran. No full release, mounted UI, SQL, live model, voice or
identity-quality acceptance is claimed.

## Retained failures and next checks

The first merge helper accepted only conflict exit1 and stopped when Git
returned two conflicts. It was corrected to retain conflict output, and the
merge restarted from immutable HEAD blobs, not partially merged files. The
first primary CAS run passed12 then failed literal schema mirroring after the
merge helper normalized schema line endings. Its failure remains in
`primary-cas.log`; `primary-cas-after-line-endings.log` passes14 without SQL or
test changes. The root-reported Mirror42702 is prior real SQL evidence, not a
database call by this agent.

The actual eval runner registers compiler, handler, store, Unicode and mounted
UI, plus the seven-group composition guard. CPU suites have no shared writer;
the UI uses an in-memory Vite build, loopback port0 and timestamped artifacts,
so none belongs to the fixed-port or pre-pool dist-writer lanes.

Root should run the final combined actual development SQL harness and one
mounted phone/desktop UI batch. Both are still required before integration
acceptance. Root owns any subsequent full release. Copy only the new combined
context entries into integration, not this isolate's entire old journals.

Dependencies are a junction to the existing integration node_modules. The
ignored config was created with only empty strings/arrays from the tracked
example, plus an empty research key export; it must never be deployed.
