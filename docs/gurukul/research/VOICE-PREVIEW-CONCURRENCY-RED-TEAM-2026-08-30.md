# Ordinary voice preview concurrency red team

Date: 2026-08-30  
Scope: five concurrent owners or tabs, ordinary `Preview my voice` only  
Method: read-only production evidence, code and infrastructure contract review,
plus deterministic offline fixtures  
Spend: USD 0. No database write, storage write, deployment, or GPU call.

## Verdict

The current working tree closes the specific duplicate-preview contract defects
found in the overnight audit. Fifty-three deterministic red-team assertions now
pass. They cover one SQL-elected lease, five same-owner tabs, five distinct
owners, cross-owner denial, stale-attempt fencing, explicit regeneration,
model and text-plan identity, a three-failure cap, terminal failures, protected
result expiry, abort ambiguity, lease renewal, and a min-zero/max-two runtime.

That is source-level and deterministic evidence, not a production result. The
release is still blocked until migration 067 parses and its new statements are
explained by live PostgreSQL, the web/API and bounded runtime configuration are
deployed in order, and the exact production canary below measures provider
starts, stored objects, sealed outputs, owner isolation, and scale-to-zero.

The execution model remains poll-driven. The database durably saves the
request, but no background preview worker exists. Closing the page pauses
browser checks and may interrupt a synchronous synthesis request. The UI now
says that plainly. A future durable worker would remove this limitation; this
release must not claim that preview processing continues while the page is
closed.

## Production evidence boundary

The read-only overnight audit measured three user clones:

- All three completed eight of eight source jobs. There were zero source
  failures, zero stopped processing jobs, and zero model-build failure codes.
- First sealed preview latency was 3m56s, 4m24s, and 5m37s.
- The three clones accumulated thirteen normal warming aborts and eleven sealed
  outputs, with zero actual generation failures.
- One clone produced six protected outputs for the same text hash and seed,
  with six different audio hashes. That was measured duplicate synthesis.

No audio was played. Those rows do not measure speaker likeness, naturalness,
accent, or expression. The working-tree max-two Bicep default is not live state
until Azure readback proves it.

## Contract now present in the working tree

### Durable identity and arbitration

The exact database identity includes owner, replica, current draft genome,
selected reference artifact, language, text hash, text-plan commitment, model
commitment, normalized style, seed, and regeneration key. One atomic upsert
elects an executor. Concurrent callers receive the same intent and generation
as observers. A caller-supplied intent identifier is never an ownership proof.

Changing the model or text-plan commitment creates a different intent. An
explicit `regeneration_key` creates one new semantic take, and retries of that
take deduplicate against the same key.

### Lease recovery and ambiguous transport

The executor is fenced by owner, replica, intent, generation, attempt, and a
hashed lease token. An expired lease can be reclaimed exactly once by the next
atomic upsert. A stale worker cannot store or seal over the new attempt.

The synthesis provider preserves `client_aborted` and
`voice_preview_timeout`. A synthesis POST whose transport outcome is ambiguous
returns `open_voice_execution_may_continue`. The panel keeps the active lease
for all three rather than opening an early retry while CUDA may still run.
After synthesis it renews the lease before protection and private storage.

### Failure outcomes

Failures now have three durable meanings:

- `warming`: the GPU is not ready; no model result was accepted;
- `retryable`: a bounded transient failure, with `failure_count` incremented;
- `failed`: deterministic failure or retry exhaustion, returned to the browser
  as a terminal named state.

Three retryable settlements exhaust an intent. Observer polls cannot turn a
failed intent back into paid work. The owner must take the explicit new-take
action to mint a regeneration key.

### Protected result lifecycle

Only protected WAV bytes are written, to a server-selected create-only private
path. The intent seals only after the generation ledger is sealed. Replays read
that private object and verify MIME, byte count, and SHA-256 before returning
it. The result has a seven-day expiry.

Expiry is settled in SQL before object deletion, so a failed state transition
does not leave a database row pointing at already-deleted bytes. Delivery is
therefore expired deterministically. The source-erasure walk includes both
intent and generation result paths and deduplicates locators before deletion.
A failed seal attempts exact-path cleanup before the attempt can recover.

### Capacity and phone behavior

The runtime template keeps `minReplicas=0`, bounds `runtimeMaxReplicas` from one
through two, defaults to two, and retains one in-process synthesis lock per GPU
replica. The deterministic warm-queue fixture uses two replicas and five
25-second single-segment requests; completions are 25, 25, 50, 50, and 75
seconds. This is arithmetic, not measured Azure scheduling.

The phone stores an immutable request snapshot in local storage, coordinates
sibling tabs, locks the composer while an intent is active, and reports server
phase, next check, observed cold range, and useful return time. It now says
that closing the page pauses browser checks and returning resumes the saved
intent. It does not promise a nonexistent background worker.

## Remaining release blockers

### P0: new SQL is not production-parser-proved

Migration 067 adds a table, composite ownership foreign keys, several checks
and unique indexes, generation columns, and a multi-CTE claim. Offline mocks
cannot type-check any of those. Apply the migration before the API, read back
every constraint and index, and run live `EXPLAIN` for claim, warming,
retryable, failed, renew, seal, expiry, sealed replay, and source erasure.

The relational owner-lane and erasure-cascade gates must include the new table.
A mismatched owner and mismatched replica must both fail before storage or GPU
access.

### P0: deployed concurrency and recovery are unmeasured

No production run has yet proved one provider start for a five-tab herd, five
or fewer starts for five owners, byte-identical replay, cross-owner denial, or
max-two scaling. Do not infer those outcomes from the deterministic fixture.

### P1: execution is not independent of a browser request

Warm synthesis, protection, storage, and sealing still run inside one Vercel
request. A disconnect preserves the lease, but it can delay recovery until the
lease expires. It cannot guarantee uninterrupted work after the tab closes.
The current honest UI is acceptable for a preview lab; an always-available
agent requires a durable worker with renewable heartbeats.

### P1: seven-day delivery expiry is not durable storage deletion

The expiry transition returns the exact locator and the handler attempts to
delete it, but a storage-delete failure is swallowed after the intent locator
has been cleared. The generation row retains the path, so later source erasure
can still remove it, but no expiry sweeper retries that seven-day deletion.
Either add a durable `expired_deleting` state and sweeper, or document the
seven-day value as delivery expiry while source erasure remains the only
guaranteed object-deletion path.

### P1: replay memory is process-local

The admission broker and GPU runtime keep seen nonces in process memory. The
broker can scale to two replicas, so a captured signed request reaching two
processes inside the clock-skew window can evade that local replay set. HTTPS
and SQL intent admission reduce likelihood but do not make shared replay
protection true. Use a shared nonce fence or a downstream durable request claim
before describing replay prevention as global.

### P1: no measured fair queue or queue position

Two GPU replicas are bounded capacity, not fairness. Long multi-segment prompts
can still delay short ones, and no durable FIFO position is exposed. The UI
must keep reporting phase and observed ranges, never a fabricated percentage.

### P1: observability is not yet sufficient for the promise

Production should emit content-free counters for intent claims, observations,
reclaims, provider starts, provider completions, protection, storage, seals,
stale-seal denials, failures, expiries, and result deletion. Events need intent,
attempt, generation, owner-safe trace, phase, lease age, and elapsed time, but
must exclude text, email, object path, and audio.

Alert when provider starts exceed distinct admitted intents plus explicit
regeneration intents.

## Deterministic harness

Run:

```text
node evals/voice-preview-concurrency/run.mjs
```

Current result: 53 assertions pass. The harness makes no network, database,
storage, Azure, Vercel, or GPU calls. It includes positive controls and catches
loss of the abort mapping, lease renewal, failure cap, terminal state, result
expiry, owner isolation, exact model/text identity, max-two/min-zero bound, and
truthful pause-and-resume copy.

## Exact production canary

### Preconditions

1. Migration 067 is applied and all table, constraint, index, and foreign-key
   shapes are read back.
2. Every new query passes live PostgreSQL `EXPLAIN` and relational release
   gates.
3. The deployed web commit and Vercel deployment ID are recorded.
4. Azure readback records runtime and broker revisions, `minReplicas=0`, the
   deployed maximum, and zero starting replicas.
5. Five internal self-test owners each have one ready self replica, one selected
   ten-second reference, and current consent. Never use third-party voices.
6. Use one short, single-segment preregistered line, fixed style, and fixed seed.
7. Capture intent, attempt, generation, provider-start, protected-object, seal,
   and replica-count metrics before the first request.

### Canary A: one-owner herd

Send five simultaneous identical requests from five independent sessions for
one owner.

Expected:

- one intent, one attempt, one generation, and one provider start;
- one protected object and one seal;
- four observers;
- all sessions receive the same intent ID, generation ID, byte count, and WAV
  SHA-256;
- reload returns the same protected bytes with zero additional provider starts;
- changing model or text-plan commitment cannot reuse the result;
- one explicit new-take key creates exactly one additional intent.

Stop on a second provider start before explicit regeneration, a second object,
different replay hashes, missing disclosure or watermark evidence, or any
cross-owner-readable result.

### Canary B: five owners

Submit one request for each of five owners at the same timestamp. After the
server returns durable intent receipts, close two pages and reopen them.

Expected:

- five owner-scoped intents and no cross-owner deduplication;
- no more than five provider starts and exactly five sealed results;
- reopened pages rejoin their prior semantic intents;
- runtime replicas never exceed the deployed bound;
- each result is readable only by its owner;
- another owner receives a non-enumerating refusal before storage or GPU work;
- the UI never claims work continued while its checks were paused.

### Hard limits

- Wall clock: 15 minutes.
- Provider starts: one for Canary A before explicit regeneration, five for
  Canary B.
- Incremental spend: USD 2.00 or the provider-start ceiling, whichever comes
  first.
- No manual increase to `minReplicas`.
- Zero cross-owner leaks, unprotected audio, terminal failures disguised as
  warming, or unnamed non-warming 5xx responses.

### Stop and cleanup

On a hard-stop condition, issue no manual retry. Save only content-free IDs,
timestamps, commitments, hashes, byte counts, revisions, and cost readings.

After the canary, erase the five test replicas and verify source audio, stored
preview WAVs, generation rows, and intent rows are removed. Revoke self-test
grants and remove the test accounts. Public provenance receipts may survive
only if they contain no owner identifier, private locator, text, or audio.
Finally confirm every GPU app returns naturally to zero replicas.
