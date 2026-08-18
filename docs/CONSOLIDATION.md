# Consolidation — how memory actually gets written, operationally

Short reference for whoever is on call when this breaks. For the design
rationale see `docs/SPEC-AGENT-LAYER.md` §5 (Law E4) and `context/rejected.md`
(`error-marked-done`, `relstate-zero-rows`) — read those before changing any
of the bookkeeping described here.

---

## Why nothing ran until 2026-08-18

Read this before assuming the nightly pass is the mechanism, because it looks
like it should be and, as deployed, is not.

`.github/workflows/consolidate.yml` exists, is well-formed, cron `0 22 * * *`
(03:30 IST), and runs `node api/consolidate.js` directly against Neon plus the
rel-event/trust-repair/pattern/phrase derivation passes and the integrity
sweeps. **It has never fired, not once.** Verified against the GitHub API:

- The repo's default branch is `main`. All of this work — including this
  workflow file — lives on `claude/ai-companion-app-rkt1lv`, **252 commits
  ahead of `main`**.
- `git ls-tree -r origin/main` shows **no `.github/workflows` directory at
  all**.
- GitHub only registers and schedules workflows that exist **on the default
  branch**. A workflow file on any other branch is inert — it will run on
  `workflow_dispatch` or `push` to that branch, never on its own `schedule`.
- The GitHub API's workflow-run history for this repo: **`total_count = 0`**
  scheduled runs, across every workflow, ever.

Same fate for `culture.yml` (daily recognition-index refresh) and `drift.yml`
— confirmed downstream by what is still empty in the live DB: `vy_rel_event`
0 rows, `vy_taste_candidate` 0, `vy_kin` 0, `vy_visual_assertion` 0,
`vy_shared_moment` 0, `meera_culture` 5 rows (all from a manual seed, not a
cron).

**This is an owner decision, not a code bug** — merging 252 commits of
in-flight, workstream-partitioned Phase C/D/E work onto `main` is not this
workstream's call to make. Until that merge happens:

- `api/consolidate-sweep.js` (this change) is the **only** thing that will
  ever run consolidation unattended. Vercel registers `crons` from
  whichever branch/commit is actually deployed, so it works today regardless
  of what `main` looks like.
- Once `main` catches up and `consolidate.yml` starts firing nightly, **both
  mechanisms run against the same data** — this is designed for, not
  patched around: the sweep's lag query and `runConsolidation`'s own log-row
  claiming (`meera_log.episode_id`) make a sweep run and a nightly run
  overlapping a **no-op collision**, not a double-write, for any log SPAN
  either one already claimed. The one gap: two callers can both pass the
  writer-window-validation LLM call for the *same still-unclaimed* span
  before either one's claim lands (see "Known gap" below) — narrow, and not
  possible today since nothing else calls `runConsolidation` on a schedule.

**What has to happen on `main`:** the owner merges (or cherry-picks) the
branch's `.github/workflows/*.yml` onto the default branch. Nothing else —
the workflow files themselves need no changes to start working.

---

## How consolidation is triggered, today

| trigger | mechanism | cadence | reaches production today? |
|---|---|---|---|
| `api/consolidate-sweep.js` cron | Vercel `crons` (`vercel.json`) | hourly, `0 * * * *` | **yes** — the only live mechanism |
| `.github/workflows/consolidate.yml` | GitHub Actions `schedule` | nightly, 03:30 IST | no — not on `main`, see above |
| day-1 seed | `src/engine/memory.ts:seedDayOneConsolidation`, fire-and-forget `POST /api/consolidate {device}` | once, right after onboarding | yes, but scoped to exactly one person and never retried |
| manual/admin | `POST /api/consolidate {limit, dryRun, person}` | on demand | yes, human-triggered only |

The sweep **ships dry-run-by-default** (see `vercel.json`'s cron path — no
`?dryRun=0`), so simply deploying this change spends nothing. Two independent,
deliberate steps turn it on for real:

1. Set `CRON_SECRET` (or `CONSOLIDATE_SWEEP_SECRET`) in the Vercel project's
   environment variables — without one of these the endpoint 403s
   unconditionally, cron included. `CRON_SECRET` is Vercel's own convention:
   when it is set, Vercel automatically sends
   `Authorization: Bearer $CRON_SECRET` on every cron invocation.
2. Change the cron's `path` in `vercel.json` to
   `"/api/consolidate-sweep?dryRun=0"` and redeploy. Until that edit lands,
   every hourly firing returns a report (persons lagging, rows pending,
   estimated LLM calls) and calls no model.

Manual trigger, real run, one call:

```bash
curl -X POST https://meera-silk.vercel.app/api/consolidate-sweep \
  -H 'Content-Type: application/json' \
  -H "x-sweep-secret: $CONSOLIDATE_SWEEP_SECRET" \
  -d '{"dryRun": false, "limit": 3}'
```

---

## The lag query

The one query everything here is built on — "how far behind is
consolidation" as a live read, not a guess (Law E4 point 4). Deliberately
**not** `api/consolidate.js`'s own `findEligiblePersons()`, which only looks
at `vy_episode WHERE provisional = true` — that catches people the LIVE lane
already opened a provisional episode for, and is blind to anyone who never
got one (which, measured 2026-08-18, is most of the historical backlog: the
live provisional-episode writer is newer than most of `meera_log`).

```sql
with pd as (
  select device_id, person_id from vy_person_device
),
cons as (
  select person_id, max(log_to) as log_to
  from vy_episode
  where log_to is not null
  group by person_id
)
select
  coalesce(pd.person_id, l.device_id)                          as person_id,
  max(coalesce(c.log_to, 0))                                   as consolidated_to,
  max(l.id)                                                    as max_log_id,
  count(*) filter (where l.id > coalesce(c.log_to, 0))         as pending_rows,
  min(l.at) filter (where l.id > coalesce(c.log_to, 0))        as oldest_pending_at
from meera_log l
left join pd on pd.device_id = l.device_id
left join cons c on c.person_id = coalesce(pd.person_id, l.device_id)
group by coalesce(pd.person_id, l.device_id)
having count(*) filter (where l.id > coalesce(c.log_to, 0)) > 0
order by oldest_pending_at asc;
```

`coalesce(pd.person_id, l.device_id)` matters: not every `device_id` in
`meera_log` has a `vy_person_device` row (measured 2026-08-18: 41 distinct
devices in `meera_log`, 40 `vy_person_device` rows) — the missing one falls
back to `device_id` standing in for its own `person_id`, the same fallback
`api/memory.js`'s `personIdFor` already uses.

**Checking how far behind consolidation is**, any time:

```bash
node -e "
import('./api/_db.js').then(async ({q}) => {
  const rows = await q(\`<the query above>\`);
  console.log(rows.length, 'people lagging,',
    rows.reduce((s,r)=>s+Number(r.pending_rows),0), 'rows pending');
});
"
```

Or hit the sweep endpoint's own dry-run response — it runs exactly this query
and reports the same numbers (`GET /api/consolidate-sweep`, needs the secret).

---

## What a failed run looks like

- **A single person's extraction call fails** (Azure `DeploymentNotFound`,
  timeout, unparseable JSON) → `finalizePerson` returns with `episodes: 0`,
  writes nothing, claims no log rows. That person's lag is unchanged and the
  next sweep or backfill invocation retries them automatically — no error
  surfaces anywhere unless you are looking at the sweep's own JSON response
  (`results[].error` or `episodes: 0` with no `error`).
- **The entailment audit halts** (`halted: true`, refutation rate > 2% on
  ≥5 audited facts, `api/consolidate.js`'s own §4.2 layer-3 halt) → the
  sweep stops processing further people in that invocation immediately and
  returns HTTP 500 with `halted: true`. This is deliberate and must not be
  silenced or retried automatically — it is the citation law's only alarm.
  Investigate before the next hourly firing runs into the same data.
- **A lease collision** (two overlapping sweep invocations reach the same
  person) → the loser's `results[]` entry reads
  `{"skipped": "leased"}`, no LLM call made, no error. Expected under
  overlap, not a failure.
- **The whole endpoint 500s** (`{"error": "sweep failure", ...}`) → something
  broke outside the per-person loop (DB unreachable, etc.) — check the
  `message` field.

---

## Idempotency / re-entrancy

`api/consolidate-sweep.js` claims a person via a single atomic
upsert-with-conditional-`WHERE` against its own `vy_consolidate_lease` table
(created lazily, same pattern `api/taste-queue.js` already uses for a table
outside `db/schema.sql`'s ownership) before calling `runConsolidation`, and
releases it in a `finally` block. Neon's SQL-over-HTTP allows exactly one
statement per request — no session, no cross-call transaction — so the claim
has to be atomic *within* that one statement; it is: the `INSERT ... ON
CONFLICT ... DO UPDATE ... WHERE <lease stale>` only returns a row to the
caller that actually won the row lock. A 10-minute lease TTL means a crashed
invocation self-heals rather than permanently blocking a person.

**Verified read-only + read-write, not run as a live double-invocation
against production** (see the parent report for the exact commands): two
concurrent `claim()` calls against the same `person_id` — only one returns a
row; a `release()` then a second `claim()` — succeeds again. This is the
cheapest honest proof available without spending on two real LLM calls.

**Known gap, not fixed here** (file-ownership boundary — `api/consolidate.js`
internals are out of this workstream's file list): the lease only protects
against **this endpoint** double-firing on itself. It cannot protect against
a collision with the day-1 seed's direct `POST /api/consolidate {device}` or
a future working nightly GH Actions run, both of which call
`runConsolidation` without going through this lease at all — two such calls
racing on the same still-unclaimed log span could both pass extraction before
either claims the rows, producing a redundant (not corrupt) episode row and
a doubled LLM cost for that one collision. Negligible today (only three
callers exist, at low volume); the minimal fix, proposed rather than made
here, is below.

---

## Minimal export needed from `api/consolidate.js`

Nothing here required editing `api/consolidate.js` internals — `runConsolidation({ onlyPerson, limit, dryRun })` (already exported) was sufficient for both the sweep and the backfill script. Two small, non-behavior-changing exports would remove real duplication and close the gap above, if whoever owns that file wants them:

1. **Export `LOG_BATCH_CAP`.** Both new files here hardcode `220`, matching
   the private constant at `api/consolidate.js`'s line ~84, with a comment
   pointing at it. If that constant ever changes, these two copies silently
   go stale. A one-line `export` removes the duplication instead of the
   comment removing the risk.
2. **A person-scoped claim hook inside `finalizePerson`** (or a lease
   parameter `runConsolidation` threads through to it) would let the day-1
   seed handler, a future working nightly cron, and this sweep all share
   ONE claim mechanism instead of this sweep's lease only protecting against
   itself. Not attempted here — it changes `finalizePerson`'s internals,
   which this workstream may only call, not edit.

---

## Running the backfill

`scripts/backfill-consolidate.mjs` drives the exact same `runConsolidation`
pipeline, looped oldest-lag-first over every lagging person (or one, with
`--person`). **Dry run is the default** — no flag needed to see the plan, an
explicit flag needed to spend anything:

```bash
node scripts/backfill-consolidate.mjs                       # dry run (default) — arithmetic only, zero LLM calls
node scripts/backfill-consolidate.mjs --execute              # the real thing, all lagging people
node scripts/backfill-consolidate.mjs --execute --person <uuid>   # one person only
node scripts/backfill-consolidate.mjs --execute --limit 5         # cap how many people this invocation touches
```

**Important gotcha, the reason the dry run never calls `runConsolidation` at
all:** `api/consolidate.js`'s own `dryRun` flag still calls the real
extraction LLM — it only skips the DB writes and the audit call. "Dry run"
there means "derive and report, write nothing," not "spend nothing." This
script's dry run is pure arithmetic over the lag query instead, so it is safe
to run as often as anyone likes, including in CI.

**Resume state is the database, not a file.** There is no separate
resume/progress file to go stale or get out of sync — the lag query itself
*is* the outcome record (Law: resume state records outcomes, never attempts,
`context/rejected.md#error-marked-done`). A killed process, a crashed run, a
Ctrl-C — re-running the script from scratch afterward is always correct,
because it re-reads the same live lag and only ever sees rows still
genuinely unconsolidated.

### Two backfill mechanisms now exist — flagged for an owner, not resolved here

`scripts/migrate/backfill-episodes.mjs` already existed (it produced the
DB's one pre-existing consolidation output, 2026-08-15, device
`52df2d07-9eeb-4b7e-9c0b-2ec2778b5f3b` — its `vy_derivation.prompt_hash =
'backfill-enrich'` rows are its fingerprint, not `api/consolidate.js`'s real
pipeline). It takes a different, cost-bounded approach: free deterministic
boundaries for *all* history, LLM enrichment only for the top-K=200 most
salient episodes per device. `scripts/backfill-consolidate.mjs` (this
change) instead runs the full extraction pipeline for every pending row, no
salience cap — affordable at today's real scale (2,025 pending rows, ~51/
person, all but 2 people under one 220-row batch) but not designed to scale
past it the way the older script is. Nothing stops both from being run over
the same backlog; they do not conflict (both leave `meera_log.episode_id`
claimed either way) but running both is redundant. Worth an owner's eyes,
not resolved by this workstream — see the file header of
`scripts/backfill-consolidate.mjs` for the full comparison.
