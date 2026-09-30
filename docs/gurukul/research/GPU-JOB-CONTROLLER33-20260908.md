# A controlled GPU job, without an invented invoice guarantee

The current shared HTTP evidence app cannot provide a per-request allocation deadline. A request timeout does not kill its replica. Its zero minimum also does not establish a maximum startup or shutdown tail. The existing processing worker uses a scheduled CPU Consumption Job and calls the shared evidence origin; copying that worker into a GPU Job would still spend outside the job's own allocation.

The defensible next experiment is one dedicated manual GPU Job running a fixed, non-personal Torch tensor probe. The new source generates its ARM deployment, checks its actual configuration and execution template, reserves before one durable start, persists the execution identity, and provides restartable status/cancellation commands. It does not yet run an expert's voice or the comparison preparation pipeline.

## What Azure actually provides

Jobs support a replica runtime timeout, zero retries, and one replica per execution. Manual starts can nevertheless overlap; `parallelism=1` is not a global execution lock. Use a dedicated job, one approved controller principal and the durable resource exclusion in migration147. There is still an operator/configuration trust boundary around external Azure starts and changes. [Jobs](https://learn.microsoft.com/en-us/azure/container-apps/jobs), [manual execution concurrency](https://learn.microsoft.com/en-us/azure/container-apps/jobs-get-started-cli).

The start API permits both a named 200 response and an asynchronous 202. This implementation treats a 202, timeout, malformed identity or lost acknowledgement as unknown, holds the reservation and never retries the start. It does not guess an execution name or claim that the client request ID is an idempotency key. [Start API](https://learn.microsoft.com/en-us/rest/api/resource-manager/containerapps/jobs/start?view=rest-resource-manager-containerapps-2025-07-01).

Cancellation targets one exact execution. A 202 stop is pending; a 200 is followed by a separate execution observation. Missing or paginated results refuse certainty. Terminal status is monotonic in durable storage and is still not an invoice receipt. [Stop execution](https://learn.microsoft.com/en-us/rest/api/resource-manager/containerapps/jobs/stop-execution?view=rest-resource-manager-containerapps-2025-07-01), [execution history contract](https://learn.microsoft.com/en-us/rest/api/resource-manager/containerapps/jobs-executions/list?view=rest-resource-manager-containerapps-2025-07-01).

Azure enforces the configured replica runtime timeout even if the CLI exits. A separate supervisor call requests stop after its persisted operational deadline and checks status. This bounds the intended work and provides recoverable cancellation; the reviewed documentation does not prove an absolute bound for every billable provisioning or shutdown second. Resources are billed while allocated; jobs use active rates and stop consuming resources after completion. [Billing](https://learn.microsoft.com/en-us/azure/container-apps/billing).

## Concrete first experiment proposal

| Setting | Proposed value |
|---|---|
| Work | Fixed small GPU tensor calculation, no private data or models |
| Region/profile | Central India, Consumption GPU T4 |
| Image | Existing evidence image, exact ACR SHA256 digest, reviewed before use |
| Runtime timeout | 120 seconds |
| Retry limit / parallelism | 0 / 1 |
| Planning headroom | 180 seconds, explicitly an estimate |
| Retail planning rate | 462 microUSD per allocated second, GPU + 8 CPU + 56 GiB |
| Reservation | 300 × 462 = 138,600 microUSD ($0.1386) |
| Separate proposed experiment budget | 250,000 microUSD ($0.25); no automatic budget creation |

The rate comes from the retained September8 cost31 receipt, not a new live billing query. The headroom is a planning choice, not measured Azure overhead. A slow start can consume the runtime window or exceed the estimate. This proposal does not spend from the separate $1 text experiment ledger. The root operator must approve and create the dedicated `gpu-*` budget, pin the configuration and policy digest, and complete source/SQL review before execution. Central India T4 support is documented, but quota and actual image compatibility still need checking. [Serverless GPU availability](https://learn.microsoft.com/en-us/azure/container-apps/gpu-serverless-overview).

Actual usage remains pending after terminal execution. A verified larger invoice must be recorded, not rejected because it exceeded an estimate. Migration149 allows a paused/exhausted ledger to show overrun, and GPU reconciliation records actual cost then pauses further admission. Normal active admission remains constrained by the existing limit. The source does not implement the Azure usage attribution verifier yet. No automatic credit release or usage estimate is substituted for it.

## Reviewable implementation

- `services/azure-gpu-job/controller.mjs`: fixed probe plan, ARM template with secure registry-password parameter, exact snapshot inspection, scoped GET/stop transport, template-bound observations. It emits no credential values. The inspector alone cannot start a job.
- `services/azure-gpu-job/supervisor.mjs`: the operational experiment caller. It requires explicit `gpu-*` policy and existing budget, preflights the exact job and idle history, reserves estimated allocation, claims once, starts the exact pinned template, and persists supervision observations.
- `scripts/gpu-job-control.mjs`: generate plan/deployment JSON and perform operator inspection. The generated deployment requires registry credentials through ARM's secure parameter; no credential is committed.
- `scripts/gpu-job-experiment.mjs`: operator `start`, `supervise` and `cancel`, scoped to an explicitly named database, plan, policy and target. It uses Azure API credentials through environment only, not CLI login.
- Migration149: content-free job/execution/control fields, accounting basis, and honest overrun recording. Unapplied. Migration148 belongs to private continuity and is untouched.

No general-purpose command, private audio, prompt or tenant source is accepted by this probe plan. There is no polling sleep loop that hides a running job. `supervise` is restartable from the database; integrate it with an independent operational scheduler before running long work. For this short proposed experiment Azure's own configured timeout remains the independent runtime limit.

## What remains for useful voice processing

The next worker must execute all bounded preparation model stages inside one allocation, consume a single persisted preparation capability, preserve each existing evidence signature/authority check and avoid the shared HTTP evidence origin. The present per-stage HTTP adapter is not repointed by this change. Resource termination should eventually release dispatch exclusivity separately from delayed cost settlement while keeping funds held; for this first one-shot probe both remain held until reconciliation. Unknown starts now use the bounded migration150 recovery below and never authorize another start.

Do not expose the operator CLI as an owner-facing endpoint. The policy digest is a reviewed operator input, not proof of end-user authorization. No production meter is installed automatically by these files.

## Evidence

September8:13 synthetic ARM/DB control groups passed, covering deployment shape, drift, exact start, unknown start, deadline stop, pending stop, terminal monotonicity, missing executions, pagination and forged templates. Seventeen budget controls passed and additionally cover accounting-basis mismatch and verified-overrun recording. These tests use actual functions with synthetic transport and DB state; they do not parse PostgreSQL or establish Azure behavior. Incumbent provider-budget41 passed.

Independent review identified overrun suppression, stale terminal regression and mixed accounting-basis ambiguity. All were repaired with bounded controls. Actual schema migration, PostgreSQL contention, ARM template validation/deployment, GPU execution, usage attribution, whole-product release and voice likeness remain unverified. No cloud call, GPU wake or database mutation ran during this implementation.


## Follow-up150: recover an asynchronous start

Original ce81b115 and migration149 are preserved. Migration150 adds a durable idle execution inventory, DB request timestamp, expected execution-template hash and recovery commitment. The POST template is the approved fixed probe plus one deterministic `VYAKTI_GPU_WINDOW_ID` environment marker. Its exact hash is persisted before POST. PostgreSQL reads project the request timestamp as text so microseconds survive a later CAS.

After202 or a lost acknowledgement, supervision verifies the approved job again and requires exactly one execution absent from the pre-start inventory. Its entire execution template, including the per-window marker, must match. Its start time must be within the original persisted allocation planning interval; a changed current policy cannot expand that interval. The lower edge is the same UTC second as the stored request, for second-precision ARM timestamps. No arbitrary clock-skew grace is used. Multiple candidates, missing or paginated history, old/future timestamps, wrong markers/templates or missing legacy evidence refuse attribution.

Recovery conditionally persists identity and its commitment before any stop. Repeated recovery can reuse only the same identity. Both start_claimed and start_unknown can recover after process loss. Terminal observations remain monotonic; accounting stays pending and the whole reservation remains held. A start arriving after the planning interval refuses automatic attribution, even with a plausible candidate, and requires operator review; the Azure replica timeout still bounds the intended running work.

This remains a dedicated-job operational trust boundary. A principal able to read and deliberately replay this exact per-window marker can also issue Azure control actions. Restrict external starts/configuration writers during the experiment. We no longer attribute an ordinary external start merely because its shared base template and timestamp look similar.

Twenty synthetic ARM/DB groups passed before the root host-reservation window:202 recovery, process replacement, persisted-before-stop ordering, repeated supervision, multiple/stale/future/missing/old candidates, another actor's unmarked shared-template execution, changed-policy interval expansion and legacy refusal. Independent source review found the initial shared-template attribution weakness and policy-window drift; both are fixed with negative controls. No real SQL or cloud action ran.

Root's retained read-only metadata `azure-gpu-control33-1788848221256.json` confirms an immutable evidence image, an existing Central India T4 profile and absence of the proposed new job. It records existing CPU-job keys/null-key names, but not all actual default values needed for template normalization. Configuration/template hashing therefore stays strict. Secret values remain omitted as before, while secret names and registry targets remain bound. Root must capture candidate metadata and add exact positive/negative fixtures before any new normalization; unobserved defaults still refuse.
