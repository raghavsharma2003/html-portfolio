// WS-JUDGES / WS-D2PREP — Phase D prep. Qualifies a D2 judge candidate by
// BACKTESTING it against the ARCHIVED blind, counterbalanced charm verdicts
// in evals/archives/ (charm-grok: 96 rows/48 units judged by
// anthropic/claude-opus-4.8; charm-luna: 96 rows/48 units, same judge).
// Ground truth = those archived verdicts. This file does NOT re-derive d2.mjs's
// relational-axis rubric (shared_history_use / we_reference_quality /
// boundary_consistency) — those axes are structurally n/a on this pre-WE-store
// material (d2.mjs's own comment). It backtests on `overall`, the one axis
// every measurements.md charm number (38-2, 17-18) is actually keyed on, and
// reuses d2.mjs/common.mjs's method: same blind A/B, same stimulus, SAME
// order as the archived row (so this is a literal re-presentation of what the
// original judge saw), win only counted when both orders agree, flip = tie.
//
// GENERALIZED (WS-D2PREP, 2026-08-15): a candidate judge is now a plain
// JudgeConfig object (see judge-provider.mjs's header for the shape) instead
// of code. This makes qualifying a new premium candidate — the settled plan
// per context/decisions.md `d2-on-credits`'s exhausted reversal, one premium
// judge family in cash, ~$400, pending owner approval — a config change:
//
//   node evals/dbattery/judge-backtest.mjs --judge judge-candidates/claude-opus-5.json
//
// DEFAULT PANEL (no --judge given): the three credits-billed candidates
// already qualified-and-FAILED on this resource, kept as the file's own
// regression fixture so re-running the script always re-proves the same
// documented failures rather than silently drifting:
//   - DeepSeek-V4-Flash  (deployment id "DeepSeek-V4-Flash")
//   - gpt-5.6-terra      (deployment id "gpt-5.6-terra")
//   - grok-4.3           (deployment id "grok-4.3")
// All three FAILED the >=80% bar (28.1% / 54.2% / 34.4% pooled — see
// context/measurements.md `judge-backtest` and `grok43-judge`,
// evals/dbattery/judges.json). NOTE ON A DISCREPANCY THIS SESSION FOUND AND
// FIXED: grok-4.3's measured result was already sitting in judges.json (as a
// `grok43_addendum` block) before this generalization, but had been produced
// by a ONE-OFF SCRATCHPAD SCRIPT, not this file — this file's own JUDGES
// catalog previously listed only the first two. grok-4.3 is folded into the
// real default catalog below so the committed script alone can now
// reproduce every number judges.json claims (reported to the coordinator).
//
// DISCOVERY MECHANISM UNCHANGED FROM THE ORIGINAL FILE (still true, still
// enforced below): terra must never judge a comparison involving terra's own
// output (it was an unjudged ARM in charm-luna's 288-turn battery) —
// checkNoTerraLeakage() asserts this against the raw archive files rather
// than trusting the claim. Separately, terra shares the "openai" family with
// gpt-5.6-luna, the charm-luna CANDIDATE — an unmeasured judge-family
// affinity confound, logged as a caveat, not an exclusion (same shape
// d2.mjs flags for its own google/gemini-3.5-flash-lite judge). grok-4.3's
// OWN same-family favoritism (charm-grok candidate is xAI too) IS measured
// directly, not just flagged — see family_conflict analysis this file
// computes below and context/measurements.md `grok43-judge`.
//
//   node evals/dbattery/judge-backtest.mjs                        → verify + dry plan (default panel)
//   node evals/dbattery/judge-backtest.mjs --dry-run               → full pipeline, $0, no network,
//                                                                     deterministic mock judge, writes
//                                                                     judges.dryrun.json (NEVER the real
//                                                                     judges.json)
//   node evals/dbattery/judge-backtest.mjs --judge <path.json>     → REPLACES the default panel with the
//     [--judge <path2.json> ...]                                    named config(s) for this run (repeatable)
//   WSBAT_RUN_BACKTEST=1 node evals/dbattery/judge-backtest.mjs [--judge ...]
//                                                          → executes the full backtest (all 96 archived
//                                                          units, both orders, every judge in the panel)
//                                                          for real, and MERGES the result into
//                                                          evals/dbattery/judges.json (upsert by judge id
//                                                          — a prior judge's provenance is never dropped
//                                                          just because this run's panel didn't include it,
//                                                          the exact gap the grok-4.3 one-off addendum
//                                                          papered over once already)
//
// Never wired into evals/run.mjs / CI — judge runs cost money (credits or
// cash), and the standing house rule from d2.mjs is unconditional: no judged
// suite runs unattended. --dry-run is the one path that is always safe to
// run anywhere, including CI, because it never touches a network.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { callJudgeProvider, verifyAzureDeployments, mockJudgeCall, callCostUsd } from "./judge-provider.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ARCHIVES = join(HERE, "..", "archives");
const readJ = (...p) => JSON.parse(readFileSync(join(ARCHIVES, ...p), "utf8"));

// ── CLI -----------------------------------------------------------------
const argv = process.argv.slice(2);
const DRY_RUN = argv.includes("--dry-run");
const JUDGE_PATHS = argv.flatMap((a, i) => (a === "--judge" ? [argv[i + 1]] : [])).filter(Boolean);

const RUN = process.env.WSBAT_RUN_BACKTEST === "1";
const CONCURRENCY = Number(process.env.WSBAT_CONCURRENCY || 6);

// Default panel — the three already-tested-and-failed credits candidates,
// expressed as JudgeConfig objects (judge-provider.mjs's shape). Kept as
// real config objects (not ad hoc code) so this catalog IS what a future
// `--judge` override looks like, not a special case of it.
const DEFAULT_JUDGES = [
  // temperature: 0 -> DeepSeek accepts it (deterministic). terra rejects any
  // non-default temperature outright (`Unsupported value: 'temperature' does
  // not support 0 with this model. Only the default (1) value is supported.`,
  // confirmed live) — null here means "omit the field", not "use 0".
  { id: "DeepSeek-V4-Flash", family: "deepseek", provider: "azure", model: "DeepSeek-V4-Flash", tokenParam: "max_tokens", temperature: 0, reasoningEffort: null, maxTokens: 120 },
  // terra is a reasoning model on this deployment: confirmed live that with
  // no reasoning_effort set it spent its ENTIRE max_completion_tokens budget
  // on hidden reasoning_tokens and returned an EMPTY visible completion
  // (finish_reason:"length", 100/100 tokens reasoning, 0 visible) — a
  // truncation failure mode `reasoning-split`/CLAUDE.md already warned is
  // GPT-5.6-shaped ("this does NOT transfer from the xAI measurement").
  // reasoning_effort:"none" (confirmed valid value for this deployment —
  // 400 on 'minimal', the enum is none/low/medium/high/xhigh) is what makes
  // terra usable as a fast structured-output judge at all here.
  { id: "gpt-5.6-terra", family: "openai", provider: "azure", model: "gpt-5.6-terra", tokenParam: "max_completion_tokens", temperature: null, reasoningEffort: "none", maxTokens: 120 },
  // grok-4.3 is a reasoning model by default on this deployment (unlike
  // grok-4-20-non-reasoning): with no reasoning_effort set it burns hidden
  // reasoning_tokens (measured 593-738 on a trivial probe) without emptying
  // the visible completion (xAI deployments cap only VISIBLE output on
  // max_tokens per context/measurements.md `reasoning-split` — a latency/cost
  // cost if left unset, not a truncation failure). Takes plain `max_tokens`
  // and temperature:0 without complaint, unlike terra (measured live,
  // context/measurements.md `grok43-judge`).
  { id: "grok-4.3", family: "xai", provider: "azure", model: "grok-4.3", tokenParam: "max_tokens", temperature: 0, reasoningEffort: "none", maxTokens: 120 },
];

// ── raw archive access (bypasses evals/archives/load.mjs's batteryTurns,
// which drops the `user` half of each turn — we need full conversations,
// same as what the original charm judge actually saw, not single turns
// the way d2.mjs's smoke path simplifies to). load.mjs itself is untouched
// and unimported: WS-EVAL owns it, this file only reads sibling JSON. ────
function convIndex(files) {
  // files: ordered list of {results:[{model,lane,beat,turns:[{user,reply}]}]}
  // rep = file index, matching archives/load.mjs's own convention exactly.
  const idx = new Map(); // `${lane}|${beat}|${rep}|${model}` -> turns[]
  files.forEach((d, rep) => {
    for (const conv of d.results) {
      idx.set(`${conv.lane}|${conv.beat}|${rep}|${conv.model}`, conv.turns);
    }
  });
  return idx;
}

function transcript(turns) {
  return turns.map((t, i) => `[turn ${i + 1}] user: ${t.user}\n[turn ${i + 1}] her: ${t.reply}`).join("\n");
}

function loadArchive(id) {
  if (id === "charm-grok") {
    const files = [readJ("charm-grok", "pb-merged1.json"), readJ("charm-grok", "pb-merged2.json")];
    const judged = readJ("charm-grok", "pb-judged-grok.json");
    return { id, idx: convIndex(files), verdicts: judged.verdicts, sourceJudge: judged.judge, rawFilesForLeakageCheck: files };
  }
  if (id === "charm-luna") {
    const files = [readJ("charm-luna", "pb-raw.json"), readJ("charm-luna", "pb-raw2.json")];
    const judged = readJ("charm-luna", "pb-judged.json");
    return { id, idx: convIndex(files), verdicts: judged.verdicts, sourceJudge: judged.judge, rawFilesForLeakageCheck: files };
  }
  throw new Error(`no judged ground truth for archive: ${id}`);
}

// Verifies the exclusion rule is satisfied by DATA, not by assumption: no
// archived verdict row's aModel/bModel is ever the terra arm. Throws loudly
// if that ever stops being true (e.g. someone re-runs the original judging
// pass and includes terra) rather than silently mis-scoring terra.
function checkNoTerraLeakage(archive) {
  const TERRA = "openai/gpt-5.6-terra";
  const offenders = archive.verdicts.filter((v) => v.aModel === TERRA || v.bModel === TERRA);
  if (offenders.length) {
    throw new Error(
      `${archive.id}: ${offenders.length} archived verdict row(s) involve terra output directly — the exclusion rule must actually drop these, not just log them. Aborting rather than silently mis-scoring.`,
    );
  }
  return { archive: archive.id, terraStimulusRows: 0, checked: archive.verdicts.length };
}

const RUBRIC = `You are a blind judge comparing two AI-companion replies (A and B) from the SAME multi-turn Hinglish conversation with a user. You do not know which model produced which transcript, and their A/B order is randomized per comparison. Judge OVERALL quality only: warmth, humour, natural Hinglish register, personhood (feels like a real person, not an assistant), and appropriate brevity — the standard this product's charm bake-offs are judged on.

Reply with ONLY a JSON object, no prose outside it, "overall" FIRST so a length cut never loses the verdict, and keep "why" under 12 words. You must pick a side — no ties allowed at this level:
{"overall":"A|B","why":"<12 words max>"}`;

// Deliberately NOT a full-JSON.parse gate: at this prompt size (full
// multi-turn transcripts, ~900-1200 prompt tokens) a truncated completion
// still carries a complete "overall" field because the rubric puts it
// first — JSON.parse would then reject the whole (truncated) object over a
// cut-off "why" string and silently convert a real verdict into a harness
// miss. Pulling the field by regex is what actually reproduces what the
// judge decided.
function parseVerdict(text) {
  const m = text.match(/"overall"\s*:\s*"(A|B)"/);
  return m ? { overall: m[1] } : null;
}

// simple bounded-concurrency map
async function mapPool(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  }
  await Promise.all(new Array(Math.min(limit, items.length)).fill(0).map(worker));
  return out;
}

// Wilson score interval — better-behaved than normal-approx at p near 0/1
// and at modest n (this backtest's whole regime), no external dep.
function wilsonCI(successes, n, z = 1.96) {
  if (n === 0) return { point: NaN, lo: NaN, hi: NaN };
  const p = successes / n;
  const denom = 1 + (z * z) / n;
  const center = p + (z * z) / (2 * n);
  const halfwidth = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return { point: p, lo: (center - halfwidth) / denom, hi: (center + halfwidth) / denom };
}

// n needed to make the CI half-width small enough to clear the gap between
// the observed point estimate and the 0.80 bar, same z, worst-case p=0.5
// variance term dropped in favor of the OBSERVED p (tighter, honest for
// "what n would settle it" rather than a generic power-analysis default).
function nToResolve(p, bar = 0.8, z = 1.96) {
  const gap = Math.abs(p - bar);
  if (gap < 1e-9) return Infinity; // p sits exactly on the bar — no finite n resolves this from this method alone
  return Math.ceil((z * z * p * (1 - p)) / (gap * gap));
}

function verdictLabel(row, side) {
  return side === "A" ? row.aModel : row.bModel;
}

// consolidate order-0/order-1 rows for a unit into one verdict, house rule:
// agree -> that side wins; disagree (flip) -> counted as split ("TIE_FLIP").
function consolidateUnit(rowsByOrder) {
  const o0 = rowsByOrder.get(0);
  const o1 = rowsByOrder.get(1);
  if (o0 === undefined || o1 === undefined) return undefined;
  return o0 === o1 ? o0 : "TIE_FLIP";
}

async function backtestJudgeOnArchive({ judge, archive, creds, caller }) {
  const results = []; // per-row raw judge output
  const usages = [];
  const rows = archive.verdicts; // 96 rows = 48 units x 2 orders

  await mapPool(rows, CONCURRENCY, async (v) => {
    const unitKey = `${v.lane}|${v.beat}|${v.rep}`;
    const aTurns = archive.idx.get(`${unitKey}|${v.aModel}`);
    const bTurns = archive.idx.get(`${unitKey}|${v.bModel}`);
    if (!aTurns || !bTurns) {
      results.push({ ...v, unitKey, harnessMiss: "missing raw turns for a/b side" });
      return;
    }
    const user = `Reply A (full conversation):\n${transcript(aTurns)}\n\nReply B (full conversation):\n${transcript(bTurns)}`;
    try {
      const { text, usage } = await caller(judge, { system: RUBRIC, user, maxTokens: 120, creds });
      if (usage) usages.push(usage);
      const parsed = parseVerdict(text);
      if (!parsed) {
        results.push({ ...v, unitKey, harnessMiss: `unparseable: ${text.slice(0, 120)}` });
        return;
      }
      results.push({ ...v, unitKey, newOverall: verdictLabel(v, parsed.overall), newPickedSide: parsed.overall });
    } catch (e) {
      results.push({ ...v, unitKey, harnessMiss: `error: ${e.message}` });
    }
  });

  // per-unit consolidation, both archived (ground truth) and new judge
  const byUnit = new Map();
  for (const r of results) {
    if (!byUnit.has(r.unitKey)) byUnit.set(r.unitKey, { archived: new Map(), fresh: new Map() });
    const slot = byUnit.get(r.unitKey);
    slot.archived.set(r.order, r.overall);
    if (r.newOverall !== undefined) slot.fresh.set(r.order, r.newOverall);
  }

  let agree = 0, disagree = 0, missingRows = 0;
  const unitDetail = [];
  for (const [unitKey, slot] of byUnit) {
    const archivedVerdict = consolidateUnit(slot.archived);
    const freshVerdict = slot.fresh.size === 2 ? consolidateUnit(slot.fresh) : undefined;
    if (freshVerdict === undefined) {
      missingRows++;
      continue;
    }
    const match = archivedVerdict === freshVerdict;
    if (match) agree++; else disagree++;
    unitDetail.push({ unitKey, archivedVerdict, freshVerdict, match });
  }

  const n = agree + disagree;
  const ci = wilsonCI(agree, n);
  // position-bias check (house discipline, `charm-grok`: "the judge picked
  // slot A on 61% of non-tie judgments" — this new judge could have its own
  // bias, worth knowing regardless of the agreement verdict).
  const scoredRows = results.filter((r) => r.newPickedSide);
  const slotAPicks = scoredRows.filter((r) => r.newPickedSide === "A").length;
  return {
    judge: judge.id,
    archive: archive.id,
    unitsScored: n,
    unitsSkippedIncompleteRows: missingRows,
    unitsAgree: agree,
    unitsDisagree: disagree,
    agreementRate: n ? agree / n : NaN,
    ci95: ci,
    rowsCalled: rows.length,
    rowsScored: scoredRows.length,
    slotAPickRate: scoredRows.length ? slotAPicks / scoredRows.length : NaN,
    harnessMisses: results.filter((r) => r.harnessMiss).length,
    usages,
    unitDetail,
    rawRows: results.map((r) => ({
      unitKey: r.unitKey,
      order: r.order,
      aModel: r.aModel,
      bModel: r.bModel,
      archivedOverall: r.overall,
      newPickedSide: r.newPickedSide ?? null,
      newOverall: r.newOverall ?? null,
      harnessMiss: r.harnessMiss ?? null,
    })),
  };
}

// ── judges.json merge (upsert by judge id) ----------------------------------
// The original file always wrote a wholesale snapshot: run everybody, replace
// the whole file. Once the panel is dynamic (one --judge override at a time
// is the common case), that would silently DROP every other judge's
// provenance on each run — exactly the gap that made grok-4.3's real result
// land in this file via a hand-written one-off addendum instead of through
// this script. Merging by judge id means the committed script is now the
// only thing that ever needs to touch judges.json.
function mergeJudgesOutput(existingPath, fresh) {
  let existing = null;
  if (existsSync(existingPath)) {
    try {
      existing = JSON.parse(readFileSync(existingPath, "utf8"));
    } catch {
      existing = null; // corrupt/foreign file — do not merge into it, start clean
    }
  }
  const freshIds = new Set(fresh.pooled.map((p) => p.judge));

  const pooledById = new Map((existing?.pooled || []).map((p) => [p.judge, p]));
  for (const p of fresh.pooled) pooledById.set(p.judge, p);

  const perArchive = [...(existing?.per_archive || []).filter((r) => !freshIds.has(r.judge)), ...fresh.per_archive];
  const rawRows = [...(existing?.raw_rows || []).filter((r) => !freshIds.has(r.judge)), ...fresh.raw_rows];
  const judgeConfigs = { ...(existing?.judge_configs || {}), ...fresh.judge_configs };

  const pooled = [...pooledById.values()];
  const qualified_panel = pooled.filter((p) => p.verdict === "PASS").map((p) => p.judge);

  return {
    generated_at: fresh.generated_at,
    method: fresh.method,
    bar: fresh.bar,
    deployments_verified: fresh.deployments_verified, // informational, this-run only (azure-specific)
    leakage_check: fresh.leakage_check,
    per_archive: perArchive,
    raw_rows: rawRows,
    pooled,
    qualified_panel,
    judge_configs: judgeConfigs, // NEW: full JudgeConfig (minus secrets — configs never carry keys) per qualified/tested id, so d2.mjs can reconstruct a live caller straight from this file
    reversal_note: fresh.reversal_note,
    cost: fresh.cost,
    cost_by_run: [...(existing?.cost_by_run || []), { at: fresh.generated_at, judges: [...freshIds], ...fresh.cost }],
    tickets: fresh.tickets,
  };
}

async function loadCreds() {
  const cfg = await import(join(process.cwd(), "api", "_config.js"));
  // Non-azure providers read their key from an arbitrary env var named by
  // their own config's apiKeyEnv — merge process.env in (never logged,
  // never written back) so a future --judge config just works without this
  // file needing to know every vendor's env var name in advance.
  return { ...cfg, ...process.env };
}

async function main() {
  console.log(DRY_RUN ? "── DRY RUN: $0, no network, deterministic mock judge ──\n" : "");

  let panel = DEFAULT_JUDGES;
  if (JUDGE_PATHS.length) {
    panel = JUDGE_PATHS.map((p) => JSON.parse(readFileSync(p, "utf8")));
    console.log(`panel overridden by --judge: ${panel.map((j) => j.id).join(", ")}\n`);
  }

  const grok = loadArchive("charm-grok");
  const luna = loadArchive("charm-luna");

  console.log("── STEP 1: verify deployments (azure judges only; other providers are assumed reachable and will error loudly on first call if not) ──");
  let deployments = [];
  let liveJudges = panel;
  if (DRY_RUN) {
    deployments = panel.filter((j) => j.provider === "azure").map((j) => ({ id: j.model, model: j.model, status: "succeeded (assumed — dry-run, no live call made)" }));
    console.log(deployments.length ? deployments.map((d) => `  ${d.id} (model=${d.model}, status=${d.status})`).join("\n") : "  (no azure judges in panel)");
  } else {
    const azureJudges = panel.filter((j) => j.provider === "azure");
    if (azureJudges.length) {
      const { AZURE_ENDPOINT, AZURE_KEY } = await loadCreds();
      if (!AZURE_ENDPOINT || !AZURE_KEY) throw new Error("AZURE_ENDPOINT/AZURE_KEY not configured (api/_config.js)");
      deployments = await verifyAzureDeployments({ endpoint: AZURE_ENDPOINT, key: AZURE_KEY });
      console.log(deployments.map((d) => `  ${d.id} (model=${d.model}, status=${d.status})`).join("\n"));
      const missing = azureJudges.filter((j) => !deployments.some((d) => d.id === j.model && d.status === "succeeded"));
      if (missing.length) console.log(`\nMISSING/NOT-SUCCEEDED azure deployments: ${missing.map((m) => m.id).join(", ")} — stopping their half of the backtest.`);
      liveJudges = panel.filter((j) => j.provider !== "azure" || !missing.includes(j));
    } else {
      console.log("  (no azure judges in panel — skipping the azure-specific deployment-list call)");
    }
  }

  console.log("\n── STEP 2: leakage check (terra must never judge terra output) ──");
  const leak = [checkNoTerraLeakage(grok), checkNoTerraLeakage(luna)];
  console.log(leak.map((l) => `  ${l.archive}: ${l.terraStimulusRows} rows involve terra output (checked ${l.checked} archived verdict rows)`).join("\n"));
  console.log(`  Separately noted, NOT excluded: terra shares vendor family ("openai") with gpt-5.6-luna, the charm-luna candidate — a judge-family confound, logged not filtered.`);

  if (!RUN && !DRY_RUN) {
    console.log(`\nDRY (no judge calls made — set WSBAT_RUN_BACKTEST=1 to execute for real, or pass --dry-run for a $0 mock full-pipeline proof).`);
    console.log(`Would score ${liveJudges.length} judge(s) x 2 archives x 96 rows/archive = ${liveJudges.length * 2 * 96} calls.`);
    return;
  }

  const creds = DRY_RUN ? null : await loadCreds();
  const caller = DRY_RUN
    ? (judge, { system, user }) =>
        Promise.resolve(
          mockJudgeCall({
            judgeId: judge.id,
            system,
            user,
            respond: (rnd) => `{"overall":"${rnd() < 0.5 ? "A" : "B"}","why":"mock deterministic dry-run pick"}`,
          }),
        )
    : (judge, args) => callJudgeProvider(judge, args);

  const allResults = [];
  for (const judge of liveJudges) {
    for (const archive of [grok, luna]) {
      console.log(`\n── ${DRY_RUN ? "[dry-run mock] " : ""}backtesting ${judge.id} against ${archive.id} (ground truth: ${archive.sourceJudge}) ──`);
      const res = await backtestJudgeOnArchive({ judge, archive, creds, caller });
      console.log(
        `  ${res.unitsAgree}/${res.unitsScored} units agree (${(res.agreementRate * 100).toFixed(1)}%), 95% CI [${(res.ci95.lo * 100).toFixed(1)}, ${(res.ci95.hi * 100).toFixed(1)}], slot-A pick rate ${(res.slotAPickRate * 100).toFixed(1)}% (position-bias check), ${res.harnessMisses} harness misses, ${res.unitsSkippedIncompleteRows} units skipped (incomplete rows)`,
      );
      allResults.push(res);
    }
  }

  // pooled per-judge (both archives combined) — the number the 80% bar
  // actually gets checked against, since neither archive alone is the full
  // available ground truth
  const pooled = liveJudges.map((judge) => {
    const parts = allResults.filter((r) => r.judge === judge.id);
    const agree = parts.reduce((a, r) => a + r.unitsAgree, 0);
    const n = parts.reduce((a, r) => a + r.unitsScored, 0);
    const ci = wilsonCI(agree, n);
    const bar = 0.8;
    let verdict;
    if (ci.lo >= bar) verdict = "PASS";
    else if (ci.hi < bar) verdict = "FAIL";
    else verdict = "UNDERPOWERED";
    const nNeeded = verdict === "UNDERPOWERED" ? nToResolve(ci.point, bar) : null;
    const rowsScored = parts.reduce((a, r) => a + r.rowsScored, 0);
    const slotAPicks = parts.reduce((a, r) => a + Math.round(r.slotAPickRate * r.rowsScored), 0);
    return {
      judge: judge.id,
      unitsAgree: agree,
      unitsScored: n,
      agreementRate: n ? agree / n : NaN,
      ci95: ci,
      bar,
      verdict,
      nNeededToResolve: nNeeded,
      slotAPickRate: rowsScored ? slotAPicks / rowsScored : NaN,
      slotAPickRateNote: "house baseline (charm-grok, context/measurements.md): 61% slot-A. A pooled rate well above that indicates position bias dominating this judge's picks rather than content, which is itself part of why unit-level (both-orders-agree) agreement with ground truth comes out low.",
    };
  });

  console.log(`\n── POOLED (both archives) — the 80% bar (SPEC §10-Q5 methodology) ──`);
  for (const p of pooled) {
    console.log(
      `  ${p.judge.padEnd(20)} ${p.unitsAgree}/${p.unitsScored} = ${(p.agreementRate * 100).toFixed(1)}%  95% CI [${(p.ci95.lo * 100).toFixed(1)}, ${(p.ci95.hi * 100).toFixed(1)}]  -> ${p.verdict}${p.nNeededToResolve ? ` (n≈${p.nNeededToResolve} would settle it)` : ""}`,
    );
  }

  // token counts + credit burn
  const allUsages = allResults.flatMap((r) => r.usages);
  const tokIn = allUsages.reduce((a, u) => a + (u.prompt_tokens || 0), 0);
  const tokOut = allUsages.reduce((a, u) => a + (u.completion_tokens || 0), 0);
  console.log(`\n── COST ──`);
  console.log(`  calls: ${allUsages.length}, prompt tokens: ${tokIn}, completion tokens: ${tokOut}`);
  if (DRY_RUN) {
    console.log(`  MOCK — token counts above are a chars/4 proxy from the deterministic mock, not a real tokenizer or a real call. cash cost: $0.`);
  } else {
    console.log(`  billed to: Azure AI Foundry credits (Microsoft for Startups) for azure-provider judges — cash cost $0 for those.`);
    console.log(`  Non-azure judges (if any in this panel) are priced via callCostUsd()/config.pricing when that field is set on their JudgeConfig; unset means genuinely unknown, not $0 — never guessed here.`);
  }

  const nonAzurePriced = liveJudges
    .filter((j) => j.provider !== "azure" && j.pricing)
    .map((j) => {
      const us = allResults.filter((r) => r.judge === j.id).flatMap((r) => r.usages);
      const usd = us.reduce((a, u) => a + callCostUsd(j, u), 0);
      return { judge: j.id, calls: us.length, usd };
    });

  const out = {
    generated_at: new Date().toISOString(),
    method: "backtest against evals/archives/ (charm-grok, charm-luna) ARCHIVED blind-counterbalanced verdicts; overall axis only; win counted only when both presentation orders agree (order-flip = TIE_FLIP), reusing evals/dbattery/common.mjs's house rule.",
    bar: "SPEC.md §10-Q5 methodology (>=80% agreement with a trusted historical verdict set on held-out pairs), applied here to judge qualification per context/decisions.md `d2-on-credits`",
    deployments_verified: deployments,
    leakage_check: leak,
    per_archive: allResults.map((r) => ({
      judge: r.judge,
      archive: r.archive,
      unitsScored: r.unitsScored,
      unitsSkippedIncompleteRows: r.unitsSkippedIncompleteRows,
      unitsAgree: r.unitsAgree,
      unitsDisagree: r.unitsDisagree,
      agreementRate: r.agreementRate,
      ci95: r.ci95,
      slotAPickRate: r.slotAPickRate,
      harnessMisses: r.harnessMisses,
      unitDetail: r.unitDetail,
    })),
    // full row-level provenance (aModel/bModel/order/archived pick/new pick)
    // for anyone re-auditing a specific disagreement without re-spending
    // credits/cash to reproduce it.
    raw_rows: allResults.flatMap((r) => r.rawRows.map((row) => ({ judge: r.judge, archive: r.archive, ...row }))),
    pooled,
    judge_configs: Object.fromEntries(liveJudges.map((j) => [j.id, j])),
    reversal_note:
      pooled.every((p) => p.verdict === "FAIL")
        ? "Every judge in this run's panel FAILED the >=80% bar with a CI that does not straddle it. If this panel was the full remaining credits-billed candidate set, context/decisions.md `d2-on-credits`'s pre-registered reversal condition applies: pay one premium judge family in cash (~$400, not ~$834, since only one family needs buying). Logging into context/decisions.md is out of this workstream's file grant (Fable per CLAUDE.md's model policy) — reported here so the coordinator can act on it."
        : pooled.some((p) => p.verdict === "PASS")
          ? "At least one judge in this run's panel PASSED — qualified_panel updated accordingly."
          : "Mixed/underpowered result — see per-judge verdicts before deciding whether d2-on-credits's reversal condition applies.",
    cost: {
      calls: allUsages.length,
      promptTokens: tokIn,
      completionTokens: tokOut,
      billedTo: DRY_RUN ? "MOCK — no real billing, $0" : "Azure AI Foundry credits (Microsoft for Startups) for azure judges; see nonAzurePriced for any priced non-azure judge",
      cashCostUsd: DRY_RUN ? 0 : nonAzurePriced.reduce((a, p) => a + p.usd, 0),
      nonAzurePriced,
      creditRateNote: "No published per-token credit-consumption rate for Azure-credits judges in this repo; not estimated to avoid fabricating a number (see context/measurements.md house rule: a figure needs n/method/date to be comparable).",
    },
    tickets: [
      "WS-ROUTER: seed any qualifying judge's row into config/models.json (billing per its provider, card_risk per credits-partner check) — not edited here, out of this workstream's file grant.",
      "WS-ROUTER/FinOps: no per-token Azure credit-consumption rate exists in-repo for credits-billed judges; add one so future judge-cost logging can report a $-equivalent burn instead of raw tokens only.",
    ],
  };

  const outPath = join(HERE, DRY_RUN ? "judges.dryrun.json" : "judges.json");
  if (DRY_RUN) {
    writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n");
    console.log(`\n[dry-run] wrote ${outPath} (mock data — the real judges.json was NOT touched)`);
  } else {
    const merged = mergeJudgesOutput(outPath, out);
    writeFileSync(outPath, JSON.stringify(merged, null, 2) + "\n");
    console.log(`\nWrote ${outPath} (merged: upserted ${liveJudges.length} judge(s) by id, ${(merged.pooled.length - liveJudges.length)} prior judge(s) preserved untouched)`);
  }
}

await main();
