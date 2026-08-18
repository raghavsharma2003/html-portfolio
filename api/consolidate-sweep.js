// Hourly consolidation sweep — Law E4 (docs/SPEC-AGENT-LAYER.md §5): "memory
// that is not consolidated does not exist." Measured 2026-08-18: 40 of 41
// people have log rows past what vy_episode has consolidated (2,025 pending
// rows), and the ONLY existing scheduler for api/consolidate.js —
// `.github/workflows/consolidate.yml`, cron 03:30 IST — has never actually
// fired: GitHub only registers/schedules workflows from the repo's DEFAULT
// branch, this work lives on `claude/ai-companion-app-rkt1lv` (252 commits
// ahead of `main`), and `git ls-tree origin/main` shows no `.github/workflows`
// at all. Confirmed against the GitHub API: 0 scheduled runs, ever, for any
// workflow in this repo. See docs/CONSOLIDATION.md "why nothing ran until
// 2026-08-18" for the full account.
//
// So until an owner merges those workflows to `main`, THIS endpoint — fired
// by the `crons` entry this same change adds to vercel.json — is the only
// thing that will ever run consolidation unattended. It is written to also
// be the right long-term shape once the GH Actions nightly pass IS reachable:
// small, frequent, resumable batches instead of one big nightly one, so a
// missed hour is late, never lost (same posture consolidate.yml's own
// comments already commit to), and safe to run concurrently with that nightly
// pass rather than assuming it is the only writer (see the claim/lease
// section below).
//
//   GET  /api/consolidate-sweep      → what Vercel Cron calls (Authorization:
//                                       Bearer $CRON_SECRET, set by Vercel
//                                       itself when CRON_SECRET is configured
//                                       — https://vercel.com/docs/cron-jobs)
//   POST /api/consolidate-sweep      → manual/admin trigger, same auth options
//        {secret, limit, dryRun}
//
// THE LAG QUERY — the one this file exists to get right, per SPEC §5:
//   meera_log.id > coalesce(max(vy_episode.log_to), 0)   -- per person
// This is DELIBERATELY NOT api/consolidate.js's own findEligiblePersons(),
// which only looks at vy_episode WHERE provisional = true — i.e. people who
// already got a live provisional episode opened for them (src/engine/
// memory.ts's opRemember path, added after most of the 2,358 historical log
// rows already existed). That definition is correct for the NIGHTLY pass
// (finalizing what the live lane already opened) but structurally blind to
// anyone who never got a provisional episode at all, which measured 2026-08-
// 18 is most of the backlog. The raw-log-vs-episode-span comparison below
// catches both cases identically and needs no provisional-episode bookkeeping
// to have gone right first.
//
// COST DISCIPLINE, the trap this file's own dryRun almost fell into:
// api/consolidate.js's runConsolidation({dryRun:true}) still calls the real
// extraction LLM (grok-4-1-fast-reasoning / its OpenRouter fallback) — dryRun
// there means "derive and report, write nothing to the DB," NOT "spend
// nothing." So this file's OWN dryRun (below) never calls runConsolidation at
// all: it is pure arithmetic over the lag query (persons, pending rows, calls
// implied by LOG_BATCH_CAP), zero LLM spend, safe to hit as often as anyone
// likes. Only an explicit non-dry invocation calls the real pipeline.
//
// AUTH — copies api/taste-queue.js's/api/culture.js's own pattern (env-var
// secret, no secret configured = capability off, never open by accident)
// rather than inventing a new one, PLUS Vercel's documented native cron auth
// (Authorization: Bearer $CRON_SECRET) since that is what actually invokes
// this on schedule. Either one alone is sufficient; neither is optional if
// this is reachable — there is no unauthenticated path, unlike culture.js's
// idempotent-and-therefore-cheap refresh (this endpoint is neither: it can
// call a paid model 40 times in a bad request).
import { q } from "./_db.js";
import { runConsolidation } from "./consolidate.js";
import { allow, ipOf } from "./_ratelimit.js";

const CRON_SECRET = process.env.CRON_SECRET || "";
const SWEEP_SECRET = process.env.CONSOLIDATE_SWEEP_SECRET || "";

// api/consolidate.js's own LOG_BATCH_CAP (line ~84), duplicated rather than
// imported — it is not exported, and it is a private cost ceiling, not a
// public contract. Same rationale this repo already states for WE_TOKEN_RE /
// WE_TOKEN_SQL and telegraphic(): a three-line constant is safer duplicated
// than reached into across a file boundary this workstream does not own.
// PROPOSAL (see docs/CONSOLIDATION.md "minimal export"): export it so this
// number can never silently drift from the real one.
const LOG_BATCH_CAP = 220;

// Per-invocation budget — "so a serverless invocation cannot run away or
// blow its timeout" (brief). Measured data point for sizing this: the one
// real LLM-backed run in this DB (scripts/migrate/backfill-episodes.mjs,
// 2026-08-15, device 52df2d07) shows two sequential extraction calls 07:47:
// 06.432 → 07:47:14.361 apart — ~8s/call against Azure when Azure is up.
// grok-4-1-fast-reasoning's measured Azure failure rate is 7.5% (context/
// decisions.md #extract-model); a fallen-back call can run up to the full
// 45s+45s = 90s worst case (api/consolidate.js's own two AbortSignal.timeout
// (45_000) calls, tried in sequence). Sized so a run of all-worst-case calls
// still finishes inside a Pro-plan-reachable maxDuration, with slack: 3
// persons x 90s = 270s << the 300s below, and the typical case (8s/call) does
// all 3 in under 30s.
const DEFAULT_PERSON_BUDGET = 3;
const MAX_PERSON_BUDGET = 10; // hard ceiling regardless of what a caller asks for
const TIME_BUDGET_MS = 200_000; // stop STARTING a new person past this elapsed
const CANDIDATE_FETCH = 30; // oldest-lag candidates fetched per invocation

// How long an unreleased claim is honored before a later invocation may take
// it over — must exceed the worst realistic single-person processing time
// (see the 90s worst case above) with real margin for a Vercel cold start.
const LEASE_TTL = "10 minutes";

export const config = { maxDuration: 300 };

let schemaEnsured = false;
// Same convention api/taste-queue.js already uses for a table outside
// WS-AGENT-SCHEMA/db/*'s ownership (SPEC §13): an idempotent, this-file-only
// `create table if not exists`, disclosed here rather than folded quietly
// into db/schema.sql. INTERFACE TICKET to WS-AGENT-SCHEMA, same shape as
// taste-queue.js's: fold this into a real migration when convenient — until
// then it is lazily created, not reviewed, and PERSON_TABLES-exempt (a
// person's lease row is bookkeeping, not memory, so the forget cascade
// skipping it is correct, not a gap — a stale lease self-expires via
// LEASE_TTL regardless).
async function ensureSchema() {
  if (schemaEnsured) return;
  await q(`
    create table if not exists vy_consolidate_lease (
      person_id uuid primary key,
      leased_at timestamptz not null default now(),
      leased_by text not null default '',
      run_id    text
    )
  `).catch(() => {});
  schemaEnsured = true;
}

/** The lag query itself — the one thing this file most needs to get right.
 *  One statement (Neon SQL-HTTP allows exactly one per request), oldest-
 *  pending-first so a person who has been waiting longest is never starved
 *  by newer, smaller lag jumping the queue every hour. */
async function findLaggingPersons(limit) {
  return q(
    `with pd as (
       select device_id, person_id from vy_person_device
     ),
     cons as (
       select person_id, max(log_to) as log_to
       from vy_episode
       where log_to is not null
       group by person_id
     )
     select
       coalesce(pd.person_id, l.device_id)                              as person_id,
       max(coalesce(c.log_to, 0))                                       as consolidated_to,
       max(l.id)                                                        as max_log_id,
       count(*) filter (where l.id > coalesce(c.log_to, 0))             as pending_rows,
       min(l.at) filter (where l.id > coalesce(c.log_to, 0))            as oldest_pending_at
     from meera_log l
     left join pd on pd.device_id = l.device_id
     left join cons c on c.person_id = coalesce(pd.person_id, l.device_id)
     group by coalesce(pd.person_id, l.device_id)
     having count(*) filter (where l.id > coalesce(c.log_to, 0)) > 0
     order by oldest_pending_at asc
     limit $1`,
    [limit],
  );
}

/** Atomic claim: a single upsert whose WHERE clause only matches a lease
 *  that does not exist yet or has expired. Postgres row-locking during the
 *  UPDATE serializes two concurrent claims on the same person_id — at most
 *  one RETURNs a row, which is the whole guarantee this file needs given
 *  Neon SQL-HTTP's one-statement-per-request rule (no session/xact advisory
 *  lock survives across two separate q() calls, so the claim MUST be atomic
 *  within one statement, not coordinated across several). */
async function claim(personId, runId) {
  const rows = await q(
    `insert into vy_consolidate_lease (person_id, leased_at, leased_by, run_id)
     values ($1, now(), 'sweep', $2)
     on conflict (person_id) do update
       set leased_at = now(), leased_by = 'sweep', run_id = $2
       where vy_consolidate_lease.leased_at < now() - interval '${LEASE_TTL}'
     returning person_id`,
    [personId, runId],
  ).catch(() => []);
  return rows.length > 0;
}

/** Release only the lease THIS run holds — guarded by run_id so a slow
 *  invocation whose lease already expired and was taken over by a newer one
 *  can never release the newer one's claim out from under it. */
async function release(personId, runId) {
  await q(`delete from vy_consolidate_lease where person_id = $1 and run_id = $2`, [personId, runId]).catch(
    () => {},
  );
}

function authorized(req) {
  const auth = req.headers.authorization || "";
  if (CRON_SECRET && auth === `Bearer ${CRON_SECRET}`) return true;
  const provided =
    req.headers["x-sweep-secret"] ||
    (req.method === "GET" ? req.query?.secret : req.body?.secret) ||
    "";
  if (SWEEP_SECRET && provided === SWEEP_SECRET) return true;
  return false;
}

export default async function handler(req, res) {
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "GET or POST only" });
  }
  // Defense in depth only — the real gate is authorized() below. A cron/
  // admin endpoint being rate-limited per IP is not the interesting case,
  // but a rejected-but-unauthenticated flood should not get to touch the DB
  // at all, so this runs first and cheaply.
  if (!allow(ipOf(req), "consolidate_sweep", 30)) return res.status(429).json({ error: "slow down" });
  if (!authorized(req)) return res.status(403).json({ error: "not authorized" });

  const body = req.method === "POST" ? req.body || {} : {};
  // Default TRUE either way: an unauthenticated-but-misconfigured cron
  // firing hourly must never be the thing that turns "off by default" real
  // spend into a silent habit. Real runs are opt-in — POST {dryRun:false}
  // or GET ?dryRun=0/false explicitly turns the LLM calls on.
  const dryRun =
    req.method === "GET" ? !["0", "false"].includes(String(req.query?.dryRun ?? "1")) : body.dryRun !== false;
  const personBudget = Math.max(1, Math.min(MAX_PERSON_BUDGET, Number(body.limit) || DEFAULT_PERSON_BUDGET));

  try {
    await ensureSchema();
    const t0 = Date.now();
    const candidates = await findLaggingPersons(CANDIDATE_FETCH);

    if (dryRun) {
      // Pure arithmetic — zero LLM calls, safe to hit as often as anyone
      // likes. See the file header: consolidate.js's OWN dryRun still calls
      // the extraction model, so it is never used for cost projection here.
      let calls = 0;
      let rows = 0;
      for (const c of candidates) {
        const pending = Number(c.pending_rows);
        rows += pending;
        calls += Math.ceil(pending / LOG_BATCH_CAP);
      }
      return res.status(200).json({
        ok: true,
        dryRun: true,
        lagging_persons_sampled: candidates.length,
        // "sampled" because this reads only the oldest CANDIDATE_FETCH —
        // exactly what one real invocation would also see and act on.
        pending_rows: rows,
        estimated_extraction_calls: calls,
        note: "arithmetic only — no LLM call made, no lease taken",
        oldest_pending_at: candidates[0]?.oldest_pending_at ?? null,
        candidates: candidates.slice(0, personBudget).map((c) => ({
          person_id: c.person_id,
          pending_rows: Number(c.pending_rows),
          oldest_pending_at: c.oldest_pending_at,
        })),
      });
    }

    const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const results = [];
    let halted = false;
    for (const c of candidates) {
      if (results.length >= personBudget) break;
      if (Date.now() - t0 > TIME_BUDGET_MS) break;
      const person = c.person_id;
      const got = await claim(person, runId);
      if (!got) {
        results.push({ person, skipped: "leased" });
        continue;
      }
      try {
        // THE `error-marked-done` LAW: nothing here marks a person consolidated
        // by virtue of having been attempted. There is no separate resume-
        // state write at all — the outcome IS the DB state runConsolidation
        // itself writes (episodes exist, meera_log.episode_id is claimed), so
        // a failed or partial call simply leaves that person's lag non-zero
        // and the NEXT sweep's lag query picks them up again, unprompted.
        // limit:1 — onlyPerson already selects exactly one person;
        // limit only bounds findEligiblePersons's OWN (unused, since
        // onlyPerson is set) internal query.
        const out = await runConsolidation({ onlyPerson: person, limit: 1, dryRun: false });
        results.push({
          person,
          pending_rows_before: Number(c.pending_rows),
          episodes: out.episodes_finalized,
          facts: out.facts_finalized,
          halted: out.halted,
          audited: out.audited,
          refuted: out.refuted,
        });
        if (out.halted) {
          halted = true;
          break; // the SAME §4.2 layer-3 halt api/consolidate.js's own run honors — never override it here
        }
      } catch (e) {
        results.push({ person, error: e?.message || "consolidation failed" });
        // no state write on failure — see the law note above
      } finally {
        await release(person, runId);
      }
    }

    return res.status(halted ? 500 : 200).json({
      ok: !halted,
      dryRun: false,
      halted,
      candidates_seen: candidates.length,
      processed: results.filter((r) => !r.skipped && !r.error).length,
      skipped_leased: results.filter((r) => r.skipped === "leased").length,
      errored: results.filter((r) => r.error).length,
      results,
      ms: Date.now() - t0,
    });
  } catch (e) {
    return res.status(500).json({ error: "sweep failure", message: e?.message });
  }
}
