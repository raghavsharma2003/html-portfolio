// One-shot, resumable backfill over the EXISTING log — Law E4 (docs/
// SPEC-AGENT-LAYER.md §5, point 3): "the 40 people who have already talked
// to her get the relationship they already earned." Drives api/consolidate.
// js's real pipeline (runConsolidation — the SAME exported entry point the
// nightly GH Actions pass and the day-1 client seed both call), so backfilled
// episodes/facts are held to the identical citation-validation + sampled-
// entailment-audit bar as ongoing consolidation. Nothing here reimplements
// or edits any of that.
//
// THIS IS A DIFFERENT MECHANISM FROM scripts/migrate/backfill-episodes.mjs,
// DELIBERATELY, and both now exist — flagged here rather than silently
// decided, because it is a real design fork worth an owner's eyes:
//   - backfill-episodes.mjs: cheap deterministic boundaries for ALL history
//     (no LLM) + LLM enrichment for only the top-K=200 MOST SALIENT episodes
//     per device (a bounded-cost compromise, correct for a history too large
//     to fully re-derive).
//   - this script: the FULL runConsolidation extraction pass for every
//     pending log row, no salience cap.
//   At today's real scale (2,025 pending rows across 40 people, ~51/person,
//   all but 2 people under one LOG_BATCH_CAP=220 batch) the bounded-cost
//   compromise buys nothing — a full pass is already cheap (see the dry-run
//   output below) — so this script is the more complete choice FOR NOW. If
//   the backlog ever grows past what a full pass stays cheap for, that
//   inequality flips and backfill-episodes.mjs's approach is the one to
//   reach for instead, not this one scaled up.
//   Evidence that backfill-episodes.mjs already ran once, live: its
//   'backfill-enrich' vy_derivation rows (2026-08-15, device 52df2d07) are
//   the ONLY pre-existing consolidation output in the DB — not a real
//   api/consolidate.js run, despite SPEC-AGENT-LAYER.md §0's "consolidation
//   runs... once, ever" framing implying otherwise. Worth an owner's eyes
//   because right now nothing stops both scripts from being pointed at the
//   same backlog: they are non-conflicting (both leave meera_log.episode_id
//   claimed either way, and this script's lag query only sees rows still
//   unclaimed either way) but redundant if both are actually run over time.
//
// RESUME STATE RECORDS OUTCOMES, NOT ATTEMPTS (the error-marked-done law,
// context/rejected.md — read it before touching this file). This script
// keeps NO separate resume-state file or table on purpose: the database
// itself already is the outcome record. A person's lag (meera_log.id >
// coalesce(max(vy_episode.log_to), 0)) only shrinks when runConsolidation
// actually inserts episodes and claims the log rows they cover — never on a
// mere attempt, never on an LLM call that failed or returned unparseable
// JSON (finalizePerson returns early in both cases, per api/consolidate.js).
// So re-running this script top to bottom, any time, after any interruption
// — a killed process, a crashed run, a network blip — is always correct:
// it re-reads the SAME lag query, sees exactly the still-pending rows, and
// picks up from there. There is nothing to corrupt by running it twice.
//
//   node scripts/backfill-consolidate.mjs                 → DRY RUN (default):
//                                                             arithmetic only,
//                                                             zero LLM calls,
//                                                             reports the plan
//   node scripts/backfill-consolidate.mjs --execute        → the real thing
//   node scripts/backfill-consolidate.mjs --execute --person <uuid>
//                                                           → one person only
//   node scripts/backfill-consolidate.mjs --execute --limit 5
//                                                           → cap how many
//                                                             persons this
//                                                             invocation
//                                                             touches
//
// COST DISCIPLINE — read before ever passing --execute against production:
// api/consolidate.js's OWN dryRun flag still calls the real extraction LLM
// (see that file's finalizePerson — the raw = await llm(...) call is NOT
// gated on dryRun, only the DB writes and the audit call are). So this
// script's dry run below NEVER calls runConsolidation at all, dry or not —
// it is pure arithmetic over the lag query, exactly the number a real run
// would need, computed without spending a token to find out.
import { q } from "../api/_db.js";
import { runConsolidation } from "../api/consolidate.js";

const LOG_BATCH_CAP = 220; // api/consolidate.js's own constant, duplicated — see api/consolidate-sweep.js's identical note and the "minimal export" proposal in docs/CONSOLIDATION.md
const MAX_ROUNDS_PER_PERSON = 15; // ceil(2025/220) across the WHOLE backlog is 10; this is headroom, not a real expectation, and it exists so one stuck person can never hang the run
const DEFAULT_PERSON_LIMIT = 200; // effectively "all of them" at today's scale (40 people) while still being an explicit, loggable number rather than "no limit"

// NOT agent-scoped — correct only while exactly one agent (Meera) exists.
// See api/consolidate-sweep.js's identical query for the full note: migration
// 009 already added vy_episode.agent_id live, so this silently means "max
// log_to across all agents" today. Fine now (one agent, one default); must
// gain `group by person_id, agent_id` the day a second agent's own
// consolidation path exists, alongside an agentId parameter on
// runConsolidation itself — not pre-emptively duplicated here without a
// verified mirror (scripts/verify-agent-id.mjs does not watch this file).
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

async function dryRunReport(persons) {
  let totalRows = 0;
  let totalCalls = 0;
  const perPerson = [];
  for (const p of persons) {
    const pending = Number(p.pending_rows);
    const calls = Math.ceil(pending / LOG_BATCH_CAP);
    totalRows += pending;
    totalCalls += calls;
    perPerson.push({ person: p.person_id, pending_rows: pending, extraction_calls: calls, oldest_pending_at: p.oldest_pending_at });
  }
  console.log(`DRY RUN — no LLM calls made, no database writes.\n`);
  console.log(`lagging persons:        ${persons.length}`);
  console.log(`total pending log rows: ${totalRows}`);
  console.log(`total extraction calls needed (LOG_BATCH_CAP=${LOG_BATCH_CAP}): ${totalCalls}`);
  console.log(
    `\ncost model: the primary lane (grok-4-1-fast-reasoning) runs on Azure`,
    `\nSTARTUP CREDITS, not cash — ${totalCalls} calls is negligible against any`,
    `\nreasonable credit balance. context/decisions.md#extract-model measured a`,
    `\n7.5% Azure DeploymentNotFound rate (n=40), so on this run's scale expect`,
    `\n~${Math.max(0, Math.round(totalCalls * 0.075))} call(s) to fall back to the OpenRouter/gemini-3.1-flash-lite`,
    `\ncash lane — small individual calls (this backlog's median pending span is`,
    `\nwell under the ${LOG_BATCH_CAP}-row batch cap), so the real cash exposure is a`,
    `\nfraction of a cent to low cents total, not a line item. The 5% sampled`,
    `\nentailment audit (google/gemini-3.6-flash, also OpenRouter cash) adds a`,
    `\nsmall single-digit number of additional calls, proportional to facts`,
    `\nwritten, not to this number.`,
  );
  console.log(`\nper-person plan (oldest-pending-first):`);
  for (const p of perPerson) {
    console.log(`  ${p.person}  pending=${p.pending_rows}  calls=${p.extraction_calls}  oldest=${p.oldest_pending_at}`);
  }
  console.log(`\nRun with --execute to actually consolidate. Add --person <uuid> to scope to one person, --limit N to cap how many people one invocation touches.`);
}

async function backfillPerson(personId, pendingRows) {
  const rep = { person: personId, pending_before: pendingRows, rounds: 0, episodes: 0, facts: 0, halted: false, error: null };
  for (let round = 0; round < MAX_ROUNDS_PER_PERSON; round++) {
    let out;
    try {
      out = await runConsolidation({ onlyPerson: personId, limit: 1, dryRun: false });
    } catch (e) {
      rep.error = e?.message || "consolidation threw";
      break; // no state write — this person's lag is untouched, next invocation retries (error-marked-done law)
    }
    rep.rounds++;
    rep.episodes += out.episodes_finalized;
    rep.facts += out.facts_finalized;
    if (out.halted) {
      rep.halted = true;
      break; // §4.2 layer 3 entailment halt — never overridden here, same as the sweep endpoint
    }
    // A round that finalized nothing means either the batch is exhausted
    // (fetchLogBatch returned nothing left to claim) or the extraction call
    // failed/returned nothing citable — either way, another round right now
    // would not make progress. Stop; the DB-driven lag query is the only
    // "did this actually finish" signal and it is checked by the caller.
    if (out.episodes_finalized === 0) break;
  }
  return rep;
}

async function main() {
  const args = process.argv.slice(2);
  const execute = args.includes("--execute");
  const personArg = args.includes("--person") ? args[args.indexOf("--person") + 1] : null;
  const limit = args.includes("--limit") ? Math.max(1, Number(args[args.indexOf("--limit") + 1]) || DEFAULT_PERSON_LIMIT) : DEFAULT_PERSON_LIMIT;

  const candidates = personArg
    ? (await findLaggingPersons(500)).filter((p) => p.person_id === personArg)
    : await findLaggingPersons(limit);

  if (!candidates.length) {
    console.log(personArg ? `${personArg}: nothing pending — already caught up, or not a real/lagging person_id.` : "nothing pending — every person is caught up.");
    process.exit(0);
  }

  if (!execute) {
    await dryRunReport(candidates);
    process.exit(0);
  }

  console.log(`EXECUTING against production for ${candidates.length} person(s). ^C is safe at any point — see the resume-state note in this file's header.\n`);
  const t0 = Date.now();
  const reports = [];
  let halted = false;
  for (const c of candidates) {
    const rep = await backfillPerson(c.person_id, Number(c.pending_rows));
    reports.push(rep);
    console.log(
      `${rep.person}  rounds=${rep.rounds}  episodes=${rep.episodes}  facts=${rep.facts}${rep.error ? `  ERROR=${rep.error}` : ""}${rep.halted ? "  HALTED" : ""}`,
    );
    if (rep.halted) {
      halted = true;
      console.log("\nSTOPPED: an entailment-audit halt fired (refutation rate > 2%, same halt api/consolidate.js's own run honors). Not resuming further people this invocation — investigate before re-running.");
      break;
    }
  }

  const summary = {
    persons_attempted: reports.length,
    episodes_finalized: reports.reduce((s, r) => s + r.episodes, 0),
    facts_finalized: reports.reduce((s, r) => s + r.facts, 0),
    errors: reports.filter((r) => r.error).length,
    halted,
    ms: Date.now() - t0,
  };
  console.log("\n" + JSON.stringify(summary, null, 2));
  const remaining = await findLaggingPersons(500);
  console.log(`\n${remaining.length} person(s) still lagging after this run (re-run this script to continue — it is safe to re-run any number of times).`);
  process.exit(halted || summary.errors ? 1 : 0);
}

main().catch((e) => {
  console.error("backfill-consolidate failed:", e?.message || e);
  process.exit(1);
});
