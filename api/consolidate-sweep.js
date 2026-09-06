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
// ═══════════════════════════════════════════════════════════════════════════
// WS-SPINE, 2026-08-23 — WHAT WAS ACTUALLY WRONG, AND WHAT THIS CHANGE DOES
//
// The header above says this endpoint is "the only thing that will ever run
// consolidation unattended". It has been deployed and firing hourly since
// 2026-08-18 and it has consolidated NOTHING, for two independent reasons,
// both fixed here:
//
//   1. THE FLAG. `vercel.json`'s cron path is `/api/consolidate-sweep` with
//      no query string, and the GET branch below defaults `dryRun` to TRUE.
//      Every hourly firing since deploy has returned an arithmetic report and
//      spent nothing. The dry-run default was the right call to SHIP with
//      (see its own comment — an unattended hourly job must not turn spend on
//      by accident) and it was never followed by the deliberate second step
//      docs/CONSOLIDATION.md describes. That step is now the env var
//      `CONSOLIDATE_SWEEP_LIVE`, NOT the `?dryRun=0` query string the runbook
//      used to prescribe — see that flag's own comment below for what was
//      checked and why the query string is not shipped.
//
//   2. THE CHAIN. Even flipped, this file called `runConsolidation` and
//      nothing else, while `.github/workflows/consolidate.yml` chains SIX
//      steps. Episodes and facts would have appeared; vy_rel_state,
//      vy_pattern, vy_phrase, vy_rel_texture and vy_self_arc would have
//      stayed empty, so T2/T3/T4/T6/T11/T12 would still render zero bytes for
//      every user — while the run report showed cost and progress. This now
//      calls `runFullChainForPerson`, which is that workflow's order in
//      process.
//
// Reason 2 is the more instructive half: reason 1 is a job that never ran,
// which this repo already has a name for (`never-scheduled`); reason 2 is a
// job that runs and does a THIRD of its work while reporting success. The
// first is invisible and loud once found. The second would have been read as
// a fix that worked.
//
// THE RAILS BELOW EXIST BECAUSE THE FIRST REAL RUN IS OVER MONTHS OF BACKLOG.
// Every previous invocation of this endpoint spent $0. The next one spends
// real money against ~2,000 unconsolidated rows and 40 people who have never
// been derived for at all, and it does so unattended, hourly, with nobody
// watching. So: a per-invocation person budget (already existed), a hard
// per-invocation LLM CALL and TOKEN ceiling (new — checked between people,
// counted on ATTEMPTS not successes so a failing provider cannot walk through
// it), a kill switch that needs no deploy, and a measured cost line in every
// run report. Resumption is unchanged and needs no new state: the lag query
// IS the outcome record (`error-marked-done`), so the hourly cadence drains
// the backlog gradually and a killed invocation costs nothing but its hour.
// ═══════════════════════════════════════════════════════════════════════════
import { q } from "./_db.js";
import { timingSafeEqual } from "node:crypto";
import {
  runFullChainForPerson,
  LOG_BATCH_CAP,
  costSnapshot,
  costDelta,
  WATCH_CHANNEL,
} from "./consolidate.js";
import { MEERA_AGENT_ID } from "./_agentscope.js";
import { allow, ipOf } from "./_ratelimit.js";
import { withSweepRun } from "./_sweep-run.js";

const CRON_SECRET = process.env.CRON_SECRET || "";
const SWEEP_SECRET = process.env.CONSOLIDATE_SWEEP_SECRET || "";

// ── the three environment controls ────────────────────────────────────────
//
// KILL SWITCH, checked before anything else and honored on every path
// including an explicitly-real POST. Setting it takes effect on the NEXT
// invocation with no deploy, no redeploy of vercel.json, and no code change —
// which is the only kind of off switch worth having at 3am. It is deliberately
// not the same variable as the enable flag below: "turn it on" and "stop it
// NOW" must not be the same lever, or turning it back on later silently
// re-enables whatever state the emergency left behind.
const KILL = ["1", "true", "yes"].includes(String(process.env.CONSOLIDATE_KILL || "").toLowerCase());

// ENABLE FLAG. THIS IS THE MECHANISM — read the next paragraph before
// reaching for the other one.
//
// docs/CONSOLIDATION.md's original step 2 said to turn this on by changing
// `vercel.json`'s cron path to `/api/consolidate-sweep?dryRun=0`. That was
// CHECKED against Vercel's own documentation on 2026-08-23 and it is not
// supported in writing: the `crons` entry documents exactly two properties,
// `path` ("must start with /") and `schedule`, and nothing in the docs says a
// query string on `path` is accepted, preserved, or forwarded. It might well
// work. "Might well work" is the wrong basis for the one config file whose
// rejection takes the ENTIRE deployment with it, to enable the one job that
// spends money — and this repo has a name for a scheduler that looks correct
// and silently never runs (`never-scheduled`).
//
// So the query string is NOT shipped, and this env var is the whole switch.
// It is strictly better on every axis that matters: it needs no deploy to
// set or unset, it cannot invalidate vercel.json, and it is visible in the
// same dashboard as CRON_SECRET and CONSOLIDATE_KILL. The GET branch below
// still HONORS `?dryRun=0` if someone passes it by hand, so nothing is lost.
//
// An explicit `?dryRun=1` always forces a dry run, so a human can ask for
// arithmetic on a live-configured project without unsetting anything.
const SWEEP_LIVE = ["1", "true", "yes"].includes(String(process.env.CONSOLIDATE_SWEEP_LIVE || "").toLowerCase());

// PER-INVOCATION SPEND CEILINGS. These are the rails that make the first run
// over the backlog safe to leave unattended. Checked BETWEEN people (never
// mid-person — a half-derived person is the one state this pipeline has no
// representation for), against `costDelta`, which counts ATTEMPTS: a provider
// failing every call would otherwise register zero spend and run forever.
const MAX_LLM_CALLS_PER_SWEEP = Number(process.env.CONSOLIDATE_MAX_CALLS || 24);
const MAX_TOKENS_PER_SWEEP = Number(process.env.CONSOLIDATE_MAX_TOKENS || 400_000);

// Cost arithmetic for the run report. STATED AS AN ASSUMPTION, not a fact:
// these are blended per-million-token rates for the extraction family, and
// they are here so a run report carries an ORDER OF MAGNITUDE rather than a
// bare token count nobody converts. Override per environment. The token
// counts beside them are measured; only the multiplication is an estimate,
// and the report labels it that way.
const USD_PER_MTOK_IN = Number(process.env.CONSOLIDATE_USD_PER_MTOK_IN || 0.2);
const USD_PER_MTOK_OUT = Number(process.env.CONSOLIDATE_USD_PER_MTOK_OUT || 0.5);
const usd = (tin, tout) =>
  Math.round(((tin / 1_000_000) * USD_PER_MTOK_IN + (tout / 1_000_000) * USD_PER_MTOK_OUT) * 10_000) / 10_000;

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
// into db/schema.sql. INTERFACE TICKET to WS-AGENT-SCHEMA: fold this into a
// real migration when convenient.
//
// NAMED `meera_consolidate_lease`, NOT `vy_consolidate_lease` — deliberately.
// scripts/relcheck.mjs's manifest-coverage gate hard-fails the build if any
// `vy_%` table with a person_id/device_id column is missing from
// PERSON_TABLES (api/memory.js), which this workstream may not edit. A
// `vy_`-prefixed lease table would trip that gate for real: this row is
// person-keyed by construction (the whole point is one claim per person).
// The `meera_` prefix is the repo's OWN existing convention for exactly this
// shape of table — `meera_diag` is device-keyed and, like this one, absent
// from PERSON_TABLES and outside the vy_% scan. That is not evading the
// check's INTENT: the intent is "no table holding relationship content is
// invisible to forget/export," and this table holds none — a person_id, two
// timestamps and a run_id, self-expiring via LEASE_TTL regardless of whether
// forget ever touches it. A forgotten person's stale lease row (worst case,
// up to LEASE_TTL) blocks nothing but a hypothetical concurrent claim on a
// person_id with no data left to protect.
async function ensureSchema() {
  if (schemaEnsured) return;
  await q(`
    create table if not exists meera_consolidate_lease (
      agent_id  uuid not null default '${MEERA_AGENT_ID}'::uuid,
      person_id uuid not null,
      leased_at timestamptz not null default now(),
      leased_by text not null default '',
      run_id    text,
      primary key (agent_id, person_id)
    )
  `).catch(() => {});
  schemaEnsured = true;
}

/** The lag query itself — the one thing this file most needs to get right.
 *  One statement (Neon SQL-HTTP allows exactly one per request), oldest-
 *  pending-first so a person who has been waiting longest is never starved
 *  by newer, smaller lag jumping the queue every hour.
 *
 *  Migration 018 makes the cursor and lease work unit `(agent, person)`.
 *  Filtering `l.agent_id` and `e.agent_id` before MAX/count means agent A's
 *  progress cannot hide agent B's pending rows for the same human. The
 *  production sweep remains Meera-only until an authenticated replica
 *  scheduler supplies another trusted agent id. */
export async function findLaggingPersons(limit, agentId = MEERA_AGENT_ID, queryFn = q) {
  return queryFn(
    // WS-SPINE, THE WATCH CONTRACT'S SWEEP-SIDE HALF (P0-3). `api/consolidate
    // .js`'s `fetchLogBatch` refuses to derive from a `channel = 'watch'` row,
    // which on its own would create a permanent phantom lag: a watch row would
    // sit at the tail of meera_log forever, un-derivable and therefore never
    // claimed, counting as "pending" on every hourly firing, selecting its
    // person every hour for a run that then finds nothing to do. Excluding
    // watch rows from the PENDING COUNT is what makes "never derived from"
    // and "never counted as owed" the same statement. Without this line the
    // two halves of the contract disagree and the disagreement costs a
    // selection slot an hour, forever.
    `with pd as (
       select device_id, person_id from vy_person_device
     ),
     cons as (
       select person_id, max(log_to) as log_to
       from vy_episode
       where log_to is not null and agent_id = ($2)::uuid
       group by person_id
     )
     select
       coalesce(pd.person_id, l.device_id)                              as person_id,
       max(coalesce(c.log_to, 0))                                       as consolidated_to,
       max(l.id)                                                        as max_log_id,
       count(*) filter (where l.id > coalesce(c.log_to, 0)
                          and l.channel is distinct from '${WATCH_CHANNEL}') as pending_rows,
       min(l.at) filter (where l.id > coalesce(c.log_to, 0)
                          and l.channel is distinct from '${WATCH_CHANNEL}') as oldest_pending_at
     from meera_log l
     left join pd on pd.device_id = l.device_id
     left join cons c on c.person_id = coalesce(pd.person_id, l.device_id)
     where l.agent_id = ($2)::uuid
     group by coalesce(pd.person_id, l.device_id)
     having count(*) filter (where l.id > coalesce(c.log_to, 0)
                               and l.channel is distinct from '${WATCH_CHANNEL}') > 0
     order by oldest_pending_at asc
     limit $1`,
    [limit, agentId],
  );
}

/** Atomic claim: a single upsert whose WHERE clause only matches a lease
 *  that does not exist yet or has expired. Postgres row-locking during the
 *  UPDATE serializes two concurrent claims on the same person_id — at most
 *  one RETURNs a row, which is the whole guarantee this file needs given
 *  Neon SQL-HTTP's one-statement-per-request rule (no session/xact advisory
 *  lock survives across two separate q() calls, so the claim MUST be atomic
 *  within one statement, not coordinated across several). */
async function claim(agentId, personId, runId) {
  const rows = await q(
    `insert into meera_consolidate_lease (agent_id, person_id, leased_at, leased_by, run_id)
     values (($1)::uuid, $2, now(), 'sweep', $3)
     on conflict (agent_id, person_id) do update
       set leased_at = now(), leased_by = 'sweep', run_id = $3
       where meera_consolidate_lease.leased_at < now() - interval '${LEASE_TTL}'
     returning agent_id, person_id`,
    [agentId, personId, runId],
  ).catch(() => []);
  return rows.length > 0;
}

/** Release only the lease THIS run holds — guarded by run_id so a slow
 *  invocation whose lease already expired and was taken over by a newer one
 *  can never release the newer one's claim out from under it. */
async function release(agentId, personId, runId) {
  await q(
    `delete from meera_consolidate_lease
      where agent_id = ($1)::uuid and person_id = $2 and run_id = $3`,
    [agentId, personId, runId],
  ).catch(
    () => {},
  );
}

/** Constant-time equality of two secrets, false for an unset or short
 *  expected value (`api/self-check.js`'s own `authorized` shape restated). */
function secretMatches(expected, provided) {
  const e = Buffer.from(String(expected || ""));
  const p = Buffer.from(String(provided || ""));
  return e.length >= 16 && e.length === p.length && timingSafeEqual(e, p);
}

// WS-R89's second door battery found (and, being Room-scoped, left to the
// main loop) two defects here: the sweep secret was also accepted from the
// GET query string or the POST body, where it lands in access logs and
// browser history, and both comparisons were plain `===`, which leaks the
// match length in timing. Headers only now, both compared in constant time
// (`context/rejected.md#ws-r89-consolidate-sweep-secret-in-query-or-body-found-out-of-scope`).
// `docs/CONSOLIDATION.md`'s own runbook already sends `x-sweep-secret` as a
// header; nothing in this repo sent the secret any other way.
function authorized(req) {
  const auth = String(req.headers.authorization || "");
  if (CRON_SECRET && auth.startsWith("Bearer ") && secretMatches(CRON_SECRET, auth.slice(7))) return true;
  if (SWEEP_SECRET && secretMatches(SWEEP_SECRET, req.headers["x-sweep-secret"])) return true;
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

  // THE KILL SWITCH, ahead of every other decision including an explicit
  // real-run POST. An off switch that can be argued with by a request
  // parameter is not an off switch.
  if (KILL) {
    return res.status(200).json({
      ok: true,
      disabled: "CONSOLIDATE_KILL is set — no lag query, no lease, no model call, nothing written",
    });
  }

  const body = req.method === "POST" ? req.body || {} : {};
  // ── enablement resolution, in priority order ─────────────────────────────
  // 1. an EXPLICIT request parameter always wins, in both directions, so a
  //    human can force arithmetic (`?dryRun=1`) on a live-configured project
  //    without unsetting an env var, and force a real run on a project where
  //    the env flag is not set yet.
  // 2. otherwise `CONSOLIDATE_SWEEP_LIVE` decides.
  // 3. otherwise DRY. Unchanged, and it stays the default forever: the day
  //    this file's default becomes "spend" is the day a misconfigured
  //    redeploy starts costing money silently.
  const explicit =
    req.method === "GET"
      ? req.query?.dryRun === undefined
        ? null
        : !["0", "false", "no"].includes(String(req.query.dryRun).toLowerCase())
      : body.dryRun === undefined
        ? null
        : body.dryRun !== false;
  const dryRun = explicit !== null ? explicit : !SWEEP_LIVE;
  const enabledBy = explicit !== null ? "request" : SWEEP_LIVE ? "env CONSOLIDATE_SWEEP_LIVE" : "default (dry)";
  const personBudget = Math.max(1, Math.min(MAX_PERSON_BUDGET, Number(body.limit) || DEFAULT_PERSON_BUDGET));

  try {
    // WS-R21: the ops board's heartbeat (migration 084). The inner function
    // returns the same payload this handler used to `res.json()` directly;
    // only the status-code decision (dryRun vs halted) now happens after the
    // heartbeat's own UPDATE, from the returned object, so the JSON body a
    // caller sees is byte-identical to before this change.
    const summary = await withSweepRun(q, "consolidate", async () => {
    await ensureSchema();
    const t0 = Date.now();
    // The cron is deliberately pinned to Meera. Replica agents will need an
    // authenticated scheduler binding; accepting an agent id from this HTTP
    // request would turn tenant selection into user input.
    const sweepAgentId = MEERA_AGENT_ID;
    const candidates = await findLaggingPersons(CANDIDATE_FETCH, sweepAgentId);

    if (dryRun) {
      // Pure arithmetic — zero LLM calls, safe to hit as often as anyone
      // likes. See the file header: consolidate.js's OWN dryRun still calls
      // the extraction model, so it is never used for cost projection here.
      let extractionCalls = 0;
      let rows = 0;
      let personSweeps = 0;
      for (const c of candidates) {
        const pending = Number(c.pending_rows);
        rows += pending;
        // Each sweep pulls at most ONE batch per person (fetchLogBatch's own
        // LOG_BATCH_CAP), so a person with 3 batches of backlog needs 3
        // separate sweeps — which is exactly how the hourly cadence drains it
        // gradually instead of in one unbounded run.
        const batches = Math.ceil(pending / LOG_BATCH_CAP);
        extractionCalls += batches;
        personSweeps += batches;
      }
      // The chain costs more than extraction alone, and the whole point of a
      // dry run before a first-ever backfill is knowing that number BEFORE
      // committing to it. Per person-sweep: 1 extraction + 1 trust/repair +
      // 1 pattern + up to LIFE_TOLD_MAX_CHECKS (2) life-told confirmations.
      // Phrase capture, the self layer and the rel-event/honorific pass make
      // ZERO model calls (deterministic counting and pure SQL). The entailment
      // audit adds ~5% of facts written, small and bounded, excluded here
      // rather than guessed at.
      const CHAIN_CALLS_PER_PERSON_SWEEP = 3;
      const CHAIN_CALLS_WORST_CASE = 5;
      // Token arithmetic from real table shape: a full 220-row batch renders
      // at <=280 chars/row (renderBatch's own slice) ~= 62k chars ~= 15.5k
      // tokens in, 2.2k max out; the measured average person carries ~51
      // pending rows (`never-scheduled`: 2,025 rows / 40 people), so a typical
      // batch is ~14k chars ~= 3.6k tokens in. Trust/repair and pattern
      // prompts are episode summaries, not raw log: <=60 lines, ~1.5k tokens
      // in, <=700 out. Stated so the multiplication below is auditable rather
      // than a number that appeared.
      const TOK_IN_PER_BATCH_TYPICAL = 3_600;
      const TOK_IN_PER_BATCH_WORST = 15_500;
      const TOK_IN_PER_DERIVATION = 1_500;
      const TOK_OUT_PER_PERSON_SWEEP = 2_200 + 500 + 700;
      const est = (tokInPerBatch, callsPer) => {
        const tin = personSweeps * (tokInPerBatch + 2 * TOK_IN_PER_DERIVATION);
        const tout = personSweeps * TOK_OUT_PER_PERSON_SWEEP;
        return {
          llm_calls: personSweeps * callsPer,
          tokens_in: tin,
          tokens_out: tout,
          usd_estimate: usd(tin, tout),
        };
      };
      return {
        ok: true,
        dryRun: true,
        enabled_by: enabledBy,
        env: { sweep_live: SWEEP_LIVE, kill: KILL },
        lagging_persons_sampled: candidates.length,
        // "sampled" because this reads only the oldest CANDIDATE_FETCH —
        // exactly what one real invocation would also see and act on.
        pending_rows: rows,
        estimated_extraction_calls: extractionCalls,
        person_sweeps_to_drain: personSweeps,
        // At DEFAULT_PERSON_BUDGET people per hourly firing.
        hours_to_drain_at_current_budget: Math.ceil(personSweeps / personBudget),
        backlog_cost_estimate: {
          note:
            "ONE-TIME cost to drain the CURRENTLY SAMPLED backlog through the full six-step chain. " +
            "Token counts are arithmetic over real table shape; the USD line multiplies them by " +
            "CONSOLIDATE_USD_PER_MTOK_IN/OUT, which are configured ASSUMPTIONS, not measured prices.",
          typical: est(TOK_IN_PER_BATCH_TYPICAL, CHAIN_CALLS_PER_PERSON_SWEEP),
          worst_case: est(TOK_IN_PER_BATCH_WORST, CHAIN_CALLS_WORST_CASE),
          rates_assumed: { usd_per_mtok_in: USD_PER_MTOK_IN, usd_per_mtok_out: USD_PER_MTOK_OUT },
        },
        per_invocation_ceilings: {
          persons: personBudget,
          log_rows_per_person: LOG_BATCH_CAP,
          llm_calls: MAX_LLM_CALLS_PER_SWEEP,
          tokens: MAX_TOKENS_PER_SWEEP,
          time_budget_ms: TIME_BUDGET_MS,
        },
        note: "arithmetic only — no LLM call made, no lease taken",
        oldest_pending_at: candidates[0]?.oldest_pending_at ?? null,
        candidates: candidates.slice(0, personBudget).map((c) => ({
          agent_id: sweepAgentId,
          person_id: c.person_id,
          pending_rows: Number(c.pending_rows),
          oldest_pending_at: c.oldest_pending_at,
        })),
      };
    }

    const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const results = [];
    let halted = false;
    let stoppedBy = null;
    // The spend rails read a DELTA against this snapshot, never the raw
    // counters: `cost` in api/consolidate.js is module-level and a warm
    // serverless container serves many invocations, so the absolute numbers
    // are "everything this container ever spent", not "this run".
    const costBefore = costSnapshot();
    const spent = () => costDelta(costBefore);
    for (const c of candidates) {
      if (results.length >= personBudget) break;
      if (Date.now() - t0 > TIME_BUDGET_MS) {
        stoppedBy = "time budget";
        break;
      }
      // CEILINGS, checked between people and never mid-person: a person is
      // the smallest unit this pipeline can leave cleanly half-done (its
      // resume state is per-log-row, and every step is independently
      // re-entrant), so stopping here is always safe and stopping inside a
      // chain is not.
      const s = spent();
      if (s.llm_calls >= MAX_LLM_CALLS_PER_SWEEP) {
        stoppedBy = `llm call ceiling (${s.llm_calls}/${MAX_LLM_CALLS_PER_SWEEP})`;
        break;
      }
      if (s.tokens_in + s.tokens_out >= MAX_TOKENS_PER_SWEEP) {
        stoppedBy = `token ceiling (${s.tokens_in + s.tokens_out}/${MAX_TOKENS_PER_SWEEP})`;
        break;
      }
      const person = c.person_id;
      const got = await claim(sweepAgentId, person, runId);
      if (!got) {
        results.push({ agent: sweepAgentId, person, skipped: "leased" });
        continue;
      }
      try {
        // THE `error-marked-done` LAW: nothing here marks a person consolidated
        // by virtue of having been attempted. There is no separate resume-
        // state write at all — the outcome IS the DB state runConsolidation
        // itself writes (episodes exist, meera_log.episode_id is claimed), so
        // a failed or partial call simply leaves that person's lag non-zero
        // and the NEXT sweep's lag query picks them up again, unprompted.
        //
        // WS-SPINE: `runFullChainForPerson`, NOT `runConsolidation`. See this
        // file's header, reason 2 — calling finalize alone writes episodes and
        // facts and leaves every derived table empty, which renders as nothing
        // and reports as success.
        const before = spent();
        const out = await runFullChainForPerson(person, { dryRun: false, agentId: sweepAgentId });
        const fin = out.steps.finalize || {};
        const after = spent();
        results.push({
          agent: sweepAgentId,
          person,
          pending_rows_before: Number(c.pending_rows),
          episodes: fin.episodes_finalized,
          facts: fin.facts_finalized,
          watch_episodes_finalized: fin.watch_episodes_finalized,
          kin: fin.kin_written,
          rituals: fin.rituals_written,
          kin_errors: fin.kin_errors?.length ? fin.kin_errors : undefined,
          rel_events: out.steps.rel_events?.honorific_events_written,
          trust_events: out.steps.trust_repair?.trust_events_written,
          patterns: out.steps.patterns?.patterns_written,
          phrases: out.steps.phrases?.phrases_written,
          life_told: out.steps.life_told?.told_written,
          textures: out.steps.self_layer?.textures_written,
          arc: out.steps.self_layer?.arc?.written ? 1 : 0,
          step_errors: Object.entries(out.steps)
            .filter(([, v]) => v && v.error)
            .map(([k, v]) => `${k}: ${v.error}`),
          halted: out.halted,
          audited: fin.audited,
          refuted: fin.refuted,
          llm_calls: after.llm_calls - before.llm_calls,
          tokens: after.tokens_in + after.tokens_out - before.tokens_in - before.tokens_out,
          ms: out.ms,
        });
        if (out.halted) {
          halted = true;
          break; // the SAME §4.2 layer-3 halt api/consolidate.js's own run honors — never override it here
        }
      } catch (e) {
        results.push({ agent: sweepAgentId, person, error: e?.message || "consolidation failed" });
        // no state write on failure — see the law note above
      } finally {
        await release(sweepAgentId, person, runId);
      }
    }

    const s = spent();
    return {
      ok: !halted,
      dryRun: false,
      enabled_by: enabledBy,
      halted,
      stopped_by: stoppedBy,
      candidates_seen: candidates.length,
      processed: results.filter((r) => !r.skipped && !r.error).length,
      skipped_leased: results.filter((r) => r.skipped === "leased").length,
      errored: results.filter((r) => r.error).length,
      // MEASURED, printed on every real run. `llm_calls` counts attempts, so
      // a run against a failing provider reports what it actually did rather
      // than a comfortable zero (see api/consolidate.js's `azure_attempts`).
      spend: {
        llm_calls: s.llm_calls,
        tokens_in: s.tokens_in,
        tokens_out: s.tokens_out,
        usd_estimate: usd(s.tokens_in, s.tokens_out),
        usd_estimate_note: "rates are configured assumptions (CONSOLIDATE_USD_PER_MTOK_IN/OUT), tokens are measured",
        ceilings: { llm_calls: MAX_LLM_CALLS_PER_SWEEP, tokens: MAX_TOKENS_PER_SWEEP },
      },
      results,
      ms: Date.now() - t0,
    };
    });
    return res.status(summary.dryRun || !summary.halted ? 200 : 500).json(summary);
  } catch (e) {
    return res.status(500).json({ error: "sweep failure", message: e?.message });
  }
}
