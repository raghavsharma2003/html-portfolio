# Private comparison result checking

The owner can explicitly check completed comparison results. The server reads sealed votes and records a qualification receipt bound to the exact comparison, artifact, rendered candidate core, baseline core, dataset, base capability, model commitment and reported provider revision. The browser cannot supply observations, safety counts or a verdict. This slice does not activate or roll back a clone.

Migration 156, owned by the activation task, must first add and populate materialization.candidate_core_hash before dispatch. Existing null rows fail qualification. Migration 155 and frozen materializer41 remain unchanged. Source starts from a4bf870fd3b8fffa5862081f03c32abba2ffaac5; UI commit b5e61951411ebe170d472738f9d3231ad828db5d is included.

Final-vote completion now uses a fresh reconciliation statement after the assignment write. The earlier CTE read the pre-update assignment snapshot, causing the final submission and progress count to lag. Exact vote replay can reconcile an interrupted request without changing a stored choice; changed choices still conflict. Offline controls exercise this behavior, but PostgreSQL concurrency is not established by mocks.

The qualification source checks exact held-out item coverage, profile/calibration versions, current source and owner authority, artifact/manifest hashes, rendered cores, reconstructed Azure model binding, consistent reported identities, and matching observation session commitments. Same-statement admission rechecks these commitments on persistence. A current owner-scoped internal receipt helper is available to activation implementers, but activation must recheck authority in its own write.

The existing qualification v1 protocol remains unchanged except strict session commitment validation. Independent safety evidence is absent, so this caller can report inconclusive or failure, never a safety pass. Isolated-question comparisons do not establish memory or relationship fidelity. A separately reviewed modality/exposure protocol and actual safety runner remain necessary; voice watermark requirements must not be fabricated for text outputs.

## Verification at this source phase

- Owner evaluation: 32 offline checks passed.
- Qualification: 28 offline checks passed.
- Qualification service and actual HTTP wrapper: 11 offline groups passed, including malformed/foreign owner, forged client evidence, exact binding drift, session substitution, missing items, interruption/replay and current authority loss.
- UI response/transport contract passed offline.
- Actual PostgreSQL baseline-versus-repair packet is authored externally as candidate-vote44-*; not prepared or executed yet. No actual concurrent transaction claim.
- Semantic TypeScript passed (exec80075) with private dependencies and unchanged inert config. Dependency copy exited1, robocopy's successful-file-copy status.
- Mounted qualification UI passed28 groups (exec65294) at390/1440, English/Hindi: explicit action, result states, lost response/status recovery, duplicate clicks, account/candidate/unmount cancellation, no activation requests. Tested application source f84b763f; harness freeze f36f7ab9792f76a64fa3e03cfc28c55d01365b0a. Receipt scratchpad/candidate-qualification-ui/1788862547058/result.json SHAe61b09ab820e5945ed7d60c3e73befee199efc87cae36de595723dfe5652b4ae. Inspected390Hindi screenshot. Minimal fixture is not whole-studio visual acceptance, and synthetic pass rendering is not safety evidence.
- Copy gate passed7 scopes with21negativecontrols. Full release and actual Azure comparisons have not run for this slice.

Initial focused service execution failed on missing inert config; known blank config was copied. A subsequent real session-mismatch negative control failed, exposing silent session substitution; the evaluator now refuses it and the suite passes. No failure was converted to a favorable evidence result.

## Additive interruption recovery

An additional audit found that interruption after committing the final assignment but before reconciliation could leave all votes saved while the run remained collecting. The existing completion UI can show Check results in this case. Status now reads the collecting run without writing and returns no qualification yet. An explicit qualify action checks current source, owner, artifact and exact run authority in the completion UPDATE, requires the exact expected count of submitted assignments, then reads a fresh complete run before evaluation. Unknown requests do not trigger automatic retries or any model call.

The service suite now passes13 offline groups, including collecting status with zero writes, one explicit repair, replay, authority loss and incomplete assignment refusal. These additive SQL statements have not yet run against PostgreSQL and depend on156.

Root's separate frozen-f84 vote packet did run against PostgreSQL: candidate-vote44-v2-aa272e89b9c4f26eeabf457e-result.json reports actual baseline29/30 stale return with run collecting, repaired immediate30/30 completion, exact/conflicting replay, owner isolation and unchanged active runtime. Rollback is confirmed, with no cleanup uncertainty or external provider calls. This validates the earlier final-vote function, not the additive qualification recovery or concurrent transactions.
