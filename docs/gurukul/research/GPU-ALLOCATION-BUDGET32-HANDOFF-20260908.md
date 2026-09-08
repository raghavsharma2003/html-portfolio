# GPU allocation accounting, candidate 147

This is dormant accounting infrastructure, not permission to run a GPU. Migration 147 has not been applied. No cloud writes, model calls, warming or real SQL ran in this worktree.

The new content-free `vy_gpu_allocation_window` reserves against the same existing `vy_provider_budget` total as text. A partial unique index excludes concurrent reservations for the entire resource, across revisions and budgets. Reserved, in-flight, pending and uncertain rows all retain that exclusion. There is no deadline sweeper or timeout-based release. Only a never-begun reservation can release; later reconciliation requires a trusted usage verifier to attest the entire exclusive allocation has terminated and give attributable usage. Over-reservation actual cost refuses reconciliation and remains unresolved.

The controller must supply a conservative upper bound for the whole allocation, including startup, tail, maximum replicas, CPU, RAM and ancillary charges. The public retail estimate of 462 microUSD per allocated second is not imported as a billing measurement or a spending guarantee. No environment flag makes a controller available.

Comparison dispatch now records `response_recorded` with `response_recorded_at`, while the infrastructure ledger remains `accounting_pending`. A response receipt binds window, request, actual response hash and HTTP status. Neither HTTP duration nor response success settles an invoice. Existing historical `settled` dispatch rows are preserved but deliberately do not satisfy the new completion predicate. The 146 branch was never applied or enabled in this work; if integrating with a database that did run it, investigate and reconcile old jobs explicitly instead of relabeling them.

The whole-window factory accepts only trusted server dependencies. Its finite-controller contract is intentionally **not implemented**. Actual dispatch still uses the configured evidence adapter origin. Before this becomes operational, a controller-issued execution capability must bind that exact origin/resource/revision and enforce termination independently of a request timeout. The current interface alone does not prove that. The production runtime has no controller or meter installed and continues to refuse before private model inputs or provider calls. Do not wire a shape-only controller to bypass this refusal.

The ledger has no owner, replica, source, prompt or audio fields. Only opaque infrastructure/work commitments are retained, like the existing provider ledger. Existing preparation and dispatch rows remain in creator export and owner erasure; the new response timestamp is covered by their existing whole-row handling. Deleting an owner must not discard outstanding infrastructure debt or release a live allocation. The new ledger therefore has no owner erasure edge, by design.

## Validation on September 8, 2026

- Fourteen offline budget groups passed using a synthetic state-model DB adapter. They cover refused missing controller, whole reservation, shared budget exhaustion, one-shot begin, unknown outcomes, no timeout release, response binding, held pending accounting, closed-usage reconciliation and replay refusal. They do not parse SQL or establish real concurrency.
- Existing comparison preparation's 28 synthetic groups passed, including its seven-stage chain with three fixture POSTs and no network.
- Provider budget, processing worker and creator export suites passed; creator export reported 57 checks.
- Independent source review found a duplicate retry that could release the original worker's reservation and a receipt that omitted the provider response hash. Both were repaired, with dedicated new negative controls. A recovered reservation cannot claim, begin or release another worker's allocation.
- Initial full comparison suite stopped at the missing ignored `_config.js` import. A generated, wholly blank config was used for the successful offline run. No credentials were copied.

Remaining validation: real PostgreSQL EXPLAIN for every exported query, migrations and transaction/concurrency schedules involving both token and GPU reservations; full release gates; controller capability/termination integration; attributable Azure usage reconciliation. No owner likeness, latency, price accuracy or competitor quality claim follows from these tests.

## Integration

This isolate starts from frozen preparation 146 (`c5385f85`). Apply its source delta after 146. `evals/run.mjs` adds `gpu-allocation-budget`; the separate preparation suite still needs its earlier registry integration. Merge schema by appending exactly migration 147. Keep the meter's response contract and repository dispatch predicate together. The public capture readiness remains unavailable.
