# Fail-closed paid-provider budget

Status: implemented for Azure Foundry token calls, Azure Speech fast
transcription and the approval-gated Azure Personal Voice adapter on `voice-cloning`,
2026-08-24. Migration 028 is not deployed and no live Azure charge has been
made.

## Product law

The application must never treat an Azure alert as a hard spending control.
Every metered request reserves against one database-serialized ceiling before
provider network I/O. The response settles measured usage. An unknown provider
outcome keeps the reservation locked for operator reconciliation instead of
guessing that the call was free and retrying it.

```text
immutable request id + conservative maximum units
  -> atomic budget reservation
  -> one-way in-flight marker
  -> Azure request
  -> measured provider usage
  -> atomic release of reserve + actual charge
```

No prompt, transcript, reply, replica id, owner id, source id or storage path
enters `vy_provider_budget` or `vy_provider_spend`. The ledger contains only a
keyed request commitment, provider/model metadata, unit counts, money amounts
and lifecycle state.

## Configuration

All values are server-only. The budget identity and ceiling are shared by
every paid Azure adapter:

```text
AZURE_REPLICA_BUDGET_ID=azure-replica-grant-v1
AZURE_REPLICA_APP_BUDGET_USD=1500
AZURE_FOUNDRY_INPUT_USD_PER_MTOKENS=<current deployed-model rate>
AZURE_FOUNDRY_OUTPUT_USD_PER_MTOKENS=<current deployed-model rate>
AZURE_SPEECH_FAST_TRANSCRIPTION_USD_PER_HOUR=<current resource/SKU rate>
AZURE_PERSONAL_VOICE_USD_PER_PROFILE=<current approved-resource rate>
AZURE_PERSONAL_VOICE_SYNTHESIS_USD_PER_MCHARACTERS=<current approved-resource rate>
```

The application cap cannot exceed `$2,000`. `$1,500` is the recommended
initial cap, leaving `$500` outside this paid-request ledger for storage,
controlled GPU evaluation and pricing variance. Rates are deliberately not
hardcoded: deployment must copy the effective subscription/model rates from
Azure immediately before activation. Missing, zero or malformed values fail
closed.

Input reservation uses one token per UTF-8 request byte, including JSON
framing, which is intentionally more conservative than normal tokenizer
behavior. Output reservation uses the adapter's actual enforced
`max_tokens`. Settlement requires nonzero provider-reported input/output usage
and refuses an actual charge above the reservation.

Speech reservation binds the retry identity, immutable input artifact IDs,
SHA-256 digests and exact declared durations. Azure documents Speech-to-text as
per-second billing, so the meter rounds each separately submitted input upward
to a whole second before reserving. It reserves all billable candidate audio
milliseconds before the worker can start a provider request. The adapter
rechecks private bytes against their immutable digests, then invokes the
one-way in-flight hook immediately before `fetch`. Settlement uses the same
per-input rounded duration for successfully processed requests. Azure's fast-transcription response
does not report a billing receipt, so this is a deterministic application
meter, not a substitute for Azure Cost Management invoice reconciliation.

Personal Voice training reserves one native profile request. Synthesis counts
UTF-8 bytes as a conservative upper bound on multilingual billable characters.
Both bind an opaque retry key, immutable input commitment, exact adapter
version and pinned base model. A completed training reservation may be reused
only to recover the exact existing provider profile; a completed synthesis is
never replayed as if it were free.

## Failure semantics

- duplicate request commitments cannot allocate twice;
- the budget row serializes concurrent allocations and the database also
  checks `spent + reserved <= limit`;
- a failed pre-network begin is released atomically, including a lost database
  acknowledgement where provider I/O has not started;
- a timeout, crash or persistence failure after provider I/O becomes
  `reconcile_required` and retains its full reserve;
- a completed response whose usage cannot be settled is returned once with a
  reconciliation marker, preventing a user retry from silently double
  spending;
- a changed budget ceiling does not mutate an existing ledger implicitly;
- exhausted, paused and unreconciled budgets deny paid work.

Reconciliation is intentionally not exposed through an owner API. Before any
live call, the lab needs an authenticated operator-only procedure that compares
the Azure usage record with the request commitment, then settles or releases
the reservation with a tamper-evident audit entry.

## Coverage and remaining gate

Covered now:

- Azure Foundry cited-claim extraction;
- Azure Foundry private replica dialogue;
- Azure Speech fast transcription, conservatively metered by per-request audio
  seconds represented as milliseconds.
- Azure Personal Voice profile creation and synthesis, with configured
  request/character rates and Limited Access approval required by the adapter.

Not yet covered:

- the owner-facing Personal Voice consent/enrollment orchestrator and live
  provider qualification;
- liveness/identity vendors;
- watermark, signing and C2PA infrastructure;
- GPU and batch-evaluation jobs.

Those paths stay disabled in a live environment until they implement the same
reserve, begin, settle and reconcile contract using their native billing unit.
The Azure subscription budget and alerts remain a second, independent backstop.
The Speech adapter and worker integration are protocol-tested against mocked
HTTP/database boundaries only; no resource, key or live paid call has been
created.

Offline gate:

```bash
node evals/run.mjs providerbudget
```
