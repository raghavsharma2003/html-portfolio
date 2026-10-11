# Replica processing job

A private Azure Container Apps **Job**, not a Container App and not a public
API. A scheduled execution leases a bounded number of database jobs, runs them,
settles them and exits, so idle cost is zero.

## Why a Job rather than a Container App

The worker is run-to-completion by construction: `run-once.js` drains a bounded
queue and returns. A Container App expects a long-lived server, and giving this
one an HTTP surface would mean inventing a listener, a readiness probe and an
ingress that nothing would ever call.

It also needs no inbound door at all. This is a queue *consumer*: it pulls work
from Neon and talks outward to the dedicated Azure Blob account, legacy
Supabase Storage, and, when configured, the private evidence service. New
source and artifact rows carry an `azureblob:<account>:<container>` locator;
legacy rows retain `vyakti-replica-private`, so reads and erasure never guess a
provider from current deployment settings. The HMAC admission broker pattern in
`docs/gurukul/AZURE-DEPLOY-STATE.md` exists to protect services that must accept
inbound requests. Adding ingress here purely to have something to authenticate
would create an attack surface rather than reuse a posture.

## The eight steps, and who owns them

The audio DAG is `integrity -> malware_scan -> media_probe -> diarize ->
separate -> enhance -> transcribe -> voice_quality`.

**This job owns all eight.** It is the only scheduled component that drains the
processing queue.

`api/replica-processing-sweep.js` on Vercel can serve `integrity` and nothing
else, because `malware_scan` needs `clamdscan` and `media_probe` needs `ffprobe`
and a serverless runtime has neither. Its cron entry has been removed from
`vercel.json`; the endpoint remains and still answers a `CRON_SECRET` bearer
call, so it is a manual fallback rather than a second scheduled owner.

Two schedulers draining one queue would not corrupt anything - the lease is
atomic (`for update skip locked` plus a lease token hash), so one job can never
run twice at once. The reason for a single owner is different: the Vercel sweep
terminally fails a tool-bound step with `malware_scanner_unavailable`, this job
requeues it because the capability is present here, and the pair would flap the
owner's Activity screen between blocked and progressing for as long as both are
scheduled.

To hand the queue back to Vercel, restore the cron line. To stop this job
without deleting it, disable the schedule trigger. `REPLICA_PROCESSING_KILL=1`
on Vercel remains the lever that silences the sweep endpoint itself.

## What one execution does

1. Compose adapters through `api/_replica-processing/composition.js` - the same
   function the Vercel sweep uses, so both agree on what each step's absence is
   called.
2. Assert that `integrity`, `malware_scan` and `media_probe` are all available.
   They are the reason this container exists; if the image lost one, the
   execution fails loudly instead of quietly behaving like the serverless
   runtime it was deployed to replace.
3. Ask the database whether there is any work for a step this container serves.
   **If not, exit without starting ClamAV.** `clamd` loads roughly 3.6 million
   signatures into memory before it can answer anything, and paying that on
   every scheduled execution to discover an empty queue is the dominant cost of
   the whole lane.
4. Only if a scanning step is waiting: refresh signatures, start `clamd`, and
   wait for it to answer a real `--ping` rather than merely to have forked.
5. Requeue jobs that failed only because a capability was absent and is not
   absent here any more.
6. Keep one source's sequential eight-step DAG together inside the bounded run,
   using a renewable ten-minute lease so long work stays exclusive while a
   killed worker recovers within ten minutes.
7. Run the same durable VoiceGenome build sweep used by the independent Vercel
   cron, removing an extra schedule interval after `voice_quality` completes.
8. Settle and print one content-free line.

## Signatures

The image bakes a ClamAV database at build time. Without it, every execution
would download the full set - hundreds of megabytes - because the container
starts with an empty database directory each time, and ClamAV's CDN throttles
that pattern besides.

The runtime refresh stays mandatory and stays fatal on failure. Baking the
database makes that refresh an incremental diff instead of a full download,
which is what makes keeping it mandatory affordable. The point is to make
current signatures cheap, never to make stale ones acceptable.

`clamdscan` must be named explicitly in the apt line. On Debian it is a separate
package and only a *Recommended* of `clamav-daemon`, so `--no-install-recommends`
drops it silently, leaving a daemon with no client. The first build of this image
did exactly that, and step 2 above is what caught it.

## Operational requirements

- Build the Dockerfile with the repository root as context.
- Outbound access to Neon, Supabase Storage, the private evidence service and
  ClamAV's signature CDN. When `REPLICA_STORAGE_WRITE_BUCKET` is an Azure
  locator, outbound access to that exact Blob account is also required. No
  inbound access.
- Credentials are Container Apps secrets. Never in job arguments or logs.
- `AZURE_REPLICA_STORAGE_ACCOUNT`, `AZURE_REPLICA_STORAGE_CONTAINER`, and
  `AZURE_REPLICA_STORAGE_ACCOUNT_KEY` must be supplied together. The account
  key is a temporary release bridge: the browser receives only an exact-blob,
  HTTPS-only, create-only service SAS. Replace it with managed-identity user
  delegation after an Azure Owner grants the data-plane roles, then disable
  Shared Key on the account.
- 60-minute replica timeout with a 55-minute work budget, a renewable ten-minute
  job lease, `parallelism: 1`, and a hard Azure budget alert. The heartbeat lets
  long batch ASR and deterministic chunked diarization keep ownership, while a
  killed execution no longer strands work behind a full-hour lease.
- `transcribe` prefers Azure Speech when `AZURE_SPEECH_ENDPOINT` and
  `AZURE_SPEECH_KEY` are both present. Set
  `AZURE_SPEECH_FAST_TRANSCRIPTION_USD_PER_HOUR` to the current official retail
  meter for the resource region so the spend guard can reserve the request.
  Sarvam remains the fallback only when Azure is absent. The earlier
  Sarvam-only decision reversed when an Azure AI Services resource became
  available; the live Sarvam account now returns HTTP 402.

The worker emits only content-free outcome codes. It never logs tenant IDs,
paths, transcripts, vectors, audio, or provider request IDs.

The production image starts through `standalone25-entry.mjs`. Before any
processing module loads, that entry requires
`REPLICA_EXPECTED_DATABASE=neondb`, requires
`VYAKTI_MODEL_SERVING=azure_only`, refuses `REPLICA_SELF_TEST_MODE=true`, and
executes a database identity check through `createNeonDb`. Only after that
check passes does it generate the ignored `api/_config.js` from the process
environment and import `run-once.js`. The Dockerfile copies the root ESM
package boundary, the config writer and the one service module in the
worker's transitive import closure; it does not depend on an untracked build
overlay.

## Explicit isolated-development invocation

`dev-once.js` is a separate opt-in local entry. It requires the exact
`VYAKTI_DEV_DATABASE=vyakti_expert_integration_20260906` (or another explicitly
created date-suffixed integration database), the matching database path in
`NEON_URL`, and a successful server `current_database()` check. The connection
is captured once. A failed identity read never admits a worker call.
`REPLICA_SELF_TEST_MODE=true` is refused. Credentials must be supplied privately
through the process environment, never command arguments or committed files.

With the development database and development storage credentials already
loaded in that environment:

```powershell
$env:VYAKTI_DEV_DATABASE = 'vyakti_expert_integration_20260906'
node services/replica-processing-worker/dev-once.js check
# Only when a bounded development mutation is intended:
$env:VYAKTI_DEV_WORKER = '1'
node services/replica-processing-worker/dev-once.js processing
# Alternatively, reconcile one source erasure:
node services/replica-processing-worker/dev-once.js erasure
```

`processing` invokes one existing processing job with a 60-second abort signal
and the normal renewable lease. Native integrity/scanner/probe capabilities
must exist; ClamAV must already be running and configured. This command does
not install tools, refresh signatures, start cloud jobs, requeue failures, run
model-building sweeps, or generate voice. Configured analysis adapters may be
called by that one job. Missing capabilities fail explicitly; this is not a
replacement for the fully provisioned scheduled processing container.

`erasure` considers at most one abandoned pending upload and leases at most one
eligible source using the existing reconciler. Its 10-second scheduling budget
is not a guarantee that a provider request finishes in 10 seconds. Upload SAS
expiry, processing grace, storage-writer authority and erasure leases remain
unchanged. It may return idle while authorization is still valid. It does not
complete the separate full-replica erasure workflow or prove physical deletion
unless the reconciler reports completion. Both commands apply to the isolated
queue, not a caller-selected source.

The existing scheduled worker also supports the optional
`REPLICA_EXPECTED_DATABASE` guard through `createNeonDb`; omitting it retains
existing deployment behavior. Setting it never rewrites a connection string.
The new development entry always supplies a required expected database.

Verification: `node evals/processing-worker/database-guard.mjs` exercises URL
mismatch, server mismatch, connection failure, concurrent first queries,
explicit opt-in, no-mutation check mode, and forbidden self-test grants using
mocked HTTP and worker callbacks. These tests do not prove live SQL, native
tools, provider processing, or completed erasure.
