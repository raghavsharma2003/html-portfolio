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
6. Drain, settle, and print one content-free line.

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
- 60-minute replica timeout with a 55-minute work budget and matching lease,
  `parallelism: 1`, and a hard Azure budget alert. The longer bound is needed
  for two-hour batch ASR and deterministic chunked diarization; it is still a
  run-to-completion job, not a resident service.
- `transcribe` runs through Sarvam (`SARVAM_API_KEY`), not Azure Speech, as of
  WS-AN (2026-08-26): this subscription has zero Cognitive Services accounts,
  and the owner's directive was to use the Sarvam adapters that already exist
  rather than stand one up. See `api/_replica-processing/providers/
  sarvam-transcription.js`'s header for the full reasoning.

The worker emits only content-free outcome codes. It never logs tenant IDs,
paths, transcripts, vectors, audio, or provider request IDs.
