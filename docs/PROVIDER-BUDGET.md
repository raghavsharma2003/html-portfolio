# Fail-closed paid-provider budget

Status: implemented for Azure Foundry token calls on `voice-cloning`,
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

All values are server-only and required for a billable Foundry adapter:

```text
AZURE_REPLICA_BUDGET_ID=azure-replica-grant-v1
AZURE_REPLICA_APP_BUDGET_USD=1500
AZURE_FOUNDRY_INPUT_USD_PER_MTOKENS=<current deployed-model rate>
AZURE_FOUNDRY_OUTPUT_USD_PER_MTOKENS=<current deployed-model rate>
```

The application cap cannot exceed `$2,000`. `$1,500` is the recommended
initial cap, leaving `$500` outside this token ledger for storage, Speech,
controlled GPU evaluation and pricing variance. Rates are deliberately not
hardcoded: deployment must copy the effective subscription/model rates from
Azure immediately before activation. Missing, zero or malformed values fail
closed.

Input reservation uses one token per UTF-8 request byte, including JSON
framing, which is intentionally more conservative than normal tokenizer
behavior. Output reservation uses the adapter's actual enforced
`max_tokens`. Settlement requires nonzero provider-reported input/output usage
and refuses an actual charge above the reservation.

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
- Azure Foundry private replica dialogue.

Not yet covered:

- Azure Speech transcription;
- Personal Voice enrollment/training and synthesis;
- liveness/identity vendors;
- watermark, signing and C2PA infrastructure;
- GPU and batch-evaluation jobs.

Those paths stay disabled in a live environment until they implement the same
reserve, begin, settle and reconcile contract using their native billing unit.
The Azure subscription budget and alerts remain a second, independent backstop.

Offline gate:

```bash
node evals/run.mjs providerbudget
```

