#!/usr/bin/env node
// THE FIRST REAL CONSOLIDATION RUN — one bounded sweep, against production,
// with a human watching. WS-SPINE.
//
//   node scripts/consolidate-first-run.mjs                  # PLAN ONLY (default) — $0
//   node scripts/consolidate-first-run.mjs --confirm        # one bounded real sweep
//   node scripts/consolidate-first-run.mjs --confirm --limit 1
//   node scripts/consolidate-first-run.mjs --confirm --person <uuid>
//
// ── WHY THIS SCRIPT EXISTS AT ALL ─────────────────────────────────────────
//
// Consolidation has never run in production. Not once, by any mechanism:
// `.github/workflows/consolidate.yml` has never fired (it lives on a
// non-default branch — measurements `never-scheduled`), and the hourly Vercel
// cron that replaced it defaults to a dry run, so every firing since
// 2026-08-18 returned an arithmetic report and spent nothing.
//
// The switch that ends that is the env var `CONSOLIDATE_SWEEP_LIVE` (not a
// query string on the cron path — see api/consolidate-sweep.js for what was
// checked against Vercel's docs and why). The moment it is set, the next
// hourly invocation is the first paid run this pipeline has ever had, over a
// backlog nobody has ever derived from, with nobody watching.
//
// THIS SCRIPT EXISTS SO THAT IS NOT THE FIRST RUN. Run it once, deliberately,
// read the per-person output, and only then set the flag.
//
// ── WHAT IT DOES AND DOES NOT DO ──────────────────────────────────────────
//
// It drives ONE bounded sweep through `runFullChainForPerson` — the same
// entry point the cron uses, so what you see here is what the cron will do,
// not an approximation of it. It processes at most `--limit` people (default
// 2), oldest-lag-first, and prints per-person results plus MEASURED cost.
//
// It does NOT: loop until the backlog is drained (that is the hourly cron's
// job, and draining gradually is the design — see "idempotent resumption"
// below); take the sweep endpoint's lease (it runs the pipeline in-process,
// so DO NOT run it while the cron is mid-invocation on the same person — the
// worst case is a redundant episode and a doubled call, not corruption);
// touch anything a dry run would not, unless `--confirm` is present.
//
// ── IDEMPOTENT RESUMPTION, AND WHY THERE IS NO PROGRESS FILE ──────────────
//
// There is no resume state to go stale, because the outcome IS the state:
// `meera_log.episode_id` is claimed by the episode that covers it, and the
// lag query only ever returns rows still genuinely unconsolidated. Ctrl-C
// this at any point, re-run it tomorrow, run it twice — every one of those is
// correct, because it re-reads live lag rather than a record of attempts.
// (`context/rejected.md#error-marked-done`: resume state records outcomes,
// never attempts.)
//
// ── BEFORE YOU RUN IT ─────────────────────────────────────────────────────
//
//   1. `node db/migrations/apply.mjs 014` — the kin writer needs
//      vy_kin.provisional and the texture writer needs the drift columns.
//      Without it those writes fail (loudly, in `kin_errors`), and the rest
//      of the chain still works, which is exactly the half-working state
//      worth avoiding on a first run.
//   2. Read the PLAN this script prints with no flags. It costs nothing.
//   3. Have `CONSOLIDATE_KILL=1` ready in the Vercel dashboard. It stops the
//      hourly cron on the next firing with no deploy.
import { q } from "../api/_db.js";
import { runFullChainForPerson, LOG_BATCH_CAP, costSnapshot, costDelta, WATCH_CHANNEL } from "../api/consolidate.js";

const args = process.argv.slice(2);
const CONFIRM = args.includes("--confirm");
const LIMIT = args.includes("--limit") ? Math.max(1, Number(args[args.indexOf("--limit") + 1]) || 1) : 2;
const ONLY = args.includes("--person") ? args[args.indexOf("--person") + 1] : null;

// Same rates and the same honesty as the sweep's own report: the token counts
// are measured, the dollar line multiplies them by a configured ASSUMPTION.
const USD_IN = Number(process.env.CONSOLIDATE_USD_PER_MTOK_IN || 0.2);
const USD_OUT = Number(process.env.CONSOLIDATE_USD_PER_MTOK_OUT || 0.5);
const usd = (tin, tout) => Math.round(((tin / 1e6) * USD_IN + (tout / 1e6) * USD_OUT) * 10000) / 10000;

// Byte-identical to api/consolidate-sweep.js's findLaggingPersons, including
// its watch exclusion — a first-run script that measures a DIFFERENT backlog
// than the cron will process is a first-run script that lies.
const LAG_SQL = `with pd as (
   select device_id, person_id from vy_person_device
 ),
 cons as (
   select person_id, max(log_to) as log_to
   from vy_episode where log_to is not null group by person_id
 )
 select
   coalesce(pd.person_id, l.device_id)                          as person_id,
   max(coalesce(c.log_to, 0))                                   as consolidated_to,
   max(l.id)                                                    as max_log_id,
   count(*) filter (where l.id > coalesce(c.log_to, 0)
                      and l.channel is distinct from '${WATCH_CHANNEL}') as pending_rows,
   min(l.at) filter (where l.id > coalesce(c.log_to, 0)
                      and l.channel is distinct from '${WATCH_CHANNEL}') as oldest_pending_at
 from meera_log l
 left join pd on pd.device_id = l.device_id
 left join cons c on c.person_id = coalesce(pd.person_id, l.device_id)
 group by coalesce(pd.person_id, l.device_id)
 having count(*) filter (where l.id > coalesce(c.log_to, 0)
                           and l.channel is distinct from '${WATCH_CHANNEL}') > 0
 order by oldest_pending_at asc
 limit 500`;

const lagging = ONLY
  ? [{ person_id: ONLY, pending_rows: null, oldest_pending_at: null }]
  : await q(LAG_SQL, []);

const totalPending = lagging.reduce((s, r) => s + Number(r.pending_rows || 0), 0);
const personSweeps = lagging.reduce((s, r) => s + Math.ceil(Number(r.pending_rows || 0) / LOG_BATCH_CAP), 0);

console.log("── the backlog, right now ──");
console.log(`  people lagging          ${lagging.length}`);
console.log(`  rows pending            ${totalPending}`);
console.log(`  person-sweeps to drain  ${personSweeps}  (one batch of <=${LOG_BATCH_CAP} rows per person per sweep)`);
console.log(`  hours at 3/hour cron    ${Math.ceil(personSweeps / 3)}`);
console.log(`  oldest pending          ${lagging[0]?.oldest_pending_at ?? "n/a"}`);
console.log("\n── one-time cost to drain it, ESTIMATED ──");
console.log("  (per person-sweep: 1 extraction + 1 trust/repair + 1 pattern + <=2 life-told;");
console.log("   phrase capture, honorific derivation and the self layer make ZERO model calls)");
for (const [label, tokIn, calls] of [["typical", 3_600, 3], ["worst case", 15_500, 5]]) {
  const tin = personSweeps * (tokIn + 3_000);
  const tout = personSweeps * 3_400;
  console.log(
    `  ${label.padEnd(12)} ${personSweeps * calls} calls, ${tin.toLocaleString()} tok in, ` +
      `${tout.toLocaleString()} tok out  ~$${usd(tin, tout)}`,
  );
}
console.log(`  rates assumed: $${USD_IN}/Mtok in, $${USD_OUT}/Mtok out (CONSOLIDATE_USD_PER_MTOK_IN/OUT)`);

if (!CONFIRM) {
  console.log("\nPLAN ONLY — nothing was called, nothing was written, $0 spent.");
  console.log(`Re-run with --confirm to process the first ${LIMIT} ${LIMIT === 1 ? "person" : "people"}.`);
  process.exit(0);
}

const targets = lagging.slice(0, LIMIT);
console.log(`\n── real run: ${targets.length} ${targets.length === 1 ? "person" : "people"} ──`);
const before = costSnapshot();
let halted = false;

for (const t of targets) {
  const t0 = Date.now();
  const spentBefore = costDelta(before);
  process.stdout.write(`  ${t.person_id} (${t.pending_rows ?? "?"} pending) ... `);
  let out;
  try {
    out = await runFullChainForPerson(t.person_id, { dryRun: false });
  } catch (e) {
    console.log(`ERROR ${String(e?.message || e).slice(0, 160)}`);
    continue;
  }
  const spentAfter = costDelta(before);
  const fin = out.steps.finalize || {};
  console.log(`${Date.now() - t0}ms`);
  console.log(
    `      episodes ${fin.episodes_finalized ?? 0}  facts ${fin.facts_finalized ?? 0}` +
      `  rejected ${(fin.episodes_rejected ?? 0) + (fin.facts_rejected ?? 0)}` +
      `  watch-final ${fin.watch_episodes_finalized ?? 0}` +
      `  kin ${fin.kin_written ?? 0}/${(fin.kin_written ?? 0) + (fin.kin_rejected ?? 0)}` +
      `  rituals ${fin.rituals_written ?? 0}`,
  );
  console.log(
    `      honorific ${out.steps.rel_events?.honorific_events_written ?? 0}` +
      `  trust ${out.steps.trust_repair?.trust_events_written ?? 0}` +
      `  patterns ${out.steps.patterns?.patterns_written ?? 0}` +
      `  phrases ${out.steps.phrases?.phrases_written ?? 0}` +
      `  told ${out.steps.life_told?.told_written ?? 0}` +
      `  texture ${out.steps.self_layer?.textures_written ?? 0}` +
      `  arc ${out.steps.self_layer?.arc?.written ? 1 : 0}`,
  );
  const calls = spentAfter.llm_calls - spentBefore.llm_calls;
  const tin = spentAfter.tokens_in - spentBefore.tokens_in;
  const tout = spentAfter.tokens_out - spentBefore.tokens_out;
  console.log(`      spend: ${calls} calls, ${tin} tok in, ${tout} tok out  ~$${usd(tin, tout)}`);
  if (fin.audited) console.log(`      audit: ${fin.refuted}/${fin.audited} refuted`);
  // Anything that failed LOUDLY rather than silently — this is the half of a
  // first run worth reading, and the reason kin writes are not .catch()ed.
  for (const e of fin.kin_errors || []) console.log(`      ! ${e}`);
  for (const [k, v] of Object.entries(out.steps)) if (v?.error) console.log(`      ! ${k}: ${v.error}`);
  if (out.halted) {
    halted = true;
    console.log("      HALTED — entailment refutation over threshold. Investigate before the cron runs again.");
    break;
  }
}

const total = costDelta(before);
console.log("\n── this run, measured ──");
console.log(`  llm calls (attempts)  ${total.llm_calls}`);
console.log(`  tokens                ${total.tokens_in} in / ${total.tokens_out} out`);
console.log(`  estimated cost        ~$${usd(total.tokens_in, total.tokens_out)}  (rates are an assumption)`);
console.log(
  halted
    ? "\nHALTED. Do NOT set CONSOLIDATE_SWEEP_LIVE until the refutation source is understood."
    : "\nRe-run to take the next batch, or let the hourly cron drain the rest.",
);
process.exit(halted ? 1 : 0);
