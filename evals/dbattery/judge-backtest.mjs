// WS-JUDGES — Phase D prep. Qualifies the two credits-billed D2 judge
// candidates (context/decisions.md `d2-on-credits`) by BACKTESTING them
// against the ARCHIVED blind, counterbalanced charm verdicts in
// evals/archives/ (charm-grok: 96 rows/48 units judged by
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
// Judges under test (both Azure-credits-billed, per `d2-on-credits`):
//   - DeepSeek-V4-Flash  (deployment id "DeepSeek-V4-Flash")
//   - gpt-5.6-terra      (deployment id "gpt-5.6-terra" — owner-reported
//     newly deployed; THIS FILE VERIFIES that rather than assuming it, see
//     verifyDeployments() below)
//
// EXCLUSION (task brief, explicit subtlety): terra was itself an ARM in the
// charm-luna battery (288 turns, unjudged — see archives/load.mjs's
// `unjudged` field). terra must never judge a comparison involving terra's
// own output. The archived judged verdicts we backtest against (charm-grok:
// incumbent-vs-grok, charm-luna: incumbent-vs-luna) never include terra as a
// stimulus side by construction (checkNoTerraLeakage() asserts this against
// the raw files rather than trusting the claim) — so 0 units are excluded in
// practice, and that is logged, not assumed. Separately (and NOT the same
// rule): terra shares the "openai" family with gpt-5.6-luna, the charm-luna
// CANDIDATE — an unmeasured judge-family affinity confound (same shape
// d2.mjs flags for its own google/gemini-3.5-flash-lite judge). Recorded as
// a caveat on any terra-vs-charm-luna number, not an exclusion.
//
//   node evals/dbattery/judge-backtest.mjs               → verify + dry plan
//   WSBAT_RUN_BACKTEST=1 node evals/dbattery/judge-backtest.mjs
//                                                          → executes the full
//                                                          backtest (all 96
//                                                          archived units,
//                                                          both orders, both
//                                                          judges) against
//                                                          Azure, writes
//                                                          evals/dbattery/judges.json
//
// Never wired into evals/run.mjs / CI — judge runs cost money (credits here,
// but the standing house rule from d2.mjs is unconditional: no judged suite
// runs unattended).
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ARCHIVES = join(HERE, "..", "archives");
const readJ = (...p) => JSON.parse(readFileSync(join(ARCHIVES, ...p), "utf8"));

const RUN = process.env.WSBAT_RUN_BACKTEST === "1";
const CONCURRENCY = Number(process.env.WSBAT_CONCURRENCY || 6);

const JUDGES = [
  // temperature: 0 -> DeepSeek accepts it (deterministic). terra rejects any
  // non-default temperature outright (`Unsupported value: 'temperature' does
  // not support 0 with this model. Only the default (1) value is supported.`,
  // confirmed live) — null here means "omit the field", not "use 0".
  { id: "DeepSeek-V4-Flash", deployment: "DeepSeek-V4-Flash", tokenParam: "max_tokens", temperature: 0, reasoningEffort: null, family: "deepseek" },
  // terra is a reasoning model on this deployment: confirmed live that with
  // no reasoning_effort set it spent its ENTIRE max_completion_tokens budget
  // on hidden reasoning_tokens and returned an EMPTY visible completion
  // (finish_reason:"length", 100/100 tokens reasoning, 0 visible) — a
  // truncation failure mode `reasoning-split`/CLAUDE.md already warned is
  // GPT-5.6-shaped ("this does NOT transfer from the xAI measurement").
  // reasoning_effort:"none" (confirmed valid value for this deployment —
  // 400 on 'minimal', the enum is none/low/medium/high/xhigh) is what makes
  // terra usable as a fast structured-output judge at all here.
  { id: "gpt-5.6-terra", deployment: "gpt-5.6-terra", tokenParam: "max_completion_tokens", temperature: null, reasoningEffort: "none", family: "openai" },
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

// ── Azure caller: same endpoint shape as scripts/derive-adapter.mjs's
// callModel (AZURE_ENDPOINT already includes /openai/v1, deployment name
// goes in the JSON body's `model` field, no api-version query param — the
// working pattern this session confirmed live against the resource).
// gpt-5.x-family deployments reject `max_tokens` (`unsupported_parameter`)
// and require `max_completion_tokens` instead — JUDGES[].tokenParam encodes
// that per-deployment quirk so callers don't have to guess or retry-detect.
async function callAzure({ endpoint, key, deployment, tokenParam, temperature, reasoningEffort, system, user, maxTokens = 60 }) {
  const t0 = Date.now();
  const body = {
    model: deployment,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    ...(temperature === null || temperature === undefined ? {} : { temperature }),
    ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
    [tokenParam]: maxTokens,
  };
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await fetch(`${endpoint}/chat/completions`, {
      method: "POST",
      headers: { "api-key": key, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(45_000),
    });
    if (r.ok) {
      const j = await r.json();
      return {
        text: j?.choices?.[0]?.message?.content ?? "",
        usage: j?.usage ?? null,
        latencyMs: Date.now() - t0,
      };
    }
    if (r.status === 429 || r.status >= 500) {
      await new Promise((s) => setTimeout(s, 1200 * (attempt + 1)));
      continue;
    }
    const errBody = await r.text();
    throw new Error(`azure ${deployment} ${r.status}: ${errBody.slice(0, 300)}`);
  }
  throw new Error(`azure ${deployment}: exhausted retries`);
}

// GET /openai/deployments?api-version=2023-03-15-preview against the BASE
// resource host (AZURE_ENDPOINT strips its /openai/v1 suffix for this one
// call — the management-plane list-deployments route lives at the resource
// root, not under the v1 inference surface).
async function verifyDeployments({ endpoint, key }) {
  const base = endpoint.replace(/\/openai\/v1\/?$/, "");
  const r = await fetch(`${base}/openai/deployments?api-version=2023-03-15-preview`, {
    headers: { "api-key": key },
    signal: AbortSignal.timeout(20_000),
  });
  if (!r.ok) throw new Error(`deployments list ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const j = await r.json();
  return (j.data || []).map((d) => ({ id: d.id, model: d.model, status: d.status }));
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

async function backtestJudgeOnArchive({ judge, archive, endpoint, key }) {
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
      const { text, usage, latencyMs } = await callAzure({
        endpoint,
        key,
        deployment: judge.deployment,
        tokenParam: judge.tokenParam,
        temperature: judge.temperature,
        reasoningEffort: judge.reasoningEffort,
        system: RUBRIC,
        user,
        maxTokens: 120,
      });
      if (usage) usages.push(usage);
      const parsed = parseVerdict(text);
      if (!parsed) {
        results.push({ ...v, unitKey, harnessMiss: `unparseable: ${text.slice(0, 120)}` });
        return;
      }
      results.push({ ...v, unitKey, newOverall: verdictLabel(v, parsed.overall), newPickedSide: parsed.overall, latencyMs });
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

async function main() {
  const { AZURE_ENDPOINT, AZURE_KEY } = await import(join(process.cwd(), "api", "_config.js"));
  if (!AZURE_ENDPOINT || !AZURE_KEY) throw new Error("AZURE_ENDPOINT/AZURE_KEY not configured (api/_config.js)");

  console.log("── STEP 1: verify Azure deployments ──");
  const deployments = await verifyDeployments({ endpoint: AZURE_ENDPOINT, key: AZURE_KEY });
  console.log(deployments.map((d) => `  ${d.id} (model=${d.model}, status=${d.status})`).join("\n"));
  const missing = JUDGES.filter((j) => !deployments.some((d) => d.id === j.deployment && d.status === "succeeded"));
  if (missing.length) {
    console.log(`\nMISSING/NOT-SUCCEEDED deployments: ${missing.map((m) => m.id).join(", ")} — stopping their half of the backtest.`);
  }
  const liveJudges = JUDGES.filter((j) => !missing.includes(j));

  console.log("\n── STEP 2: leakage check (terra must never judge terra output) ──");
  const grok = loadArchive("charm-grok");
  const luna = loadArchive("charm-luna");
  const leak = [checkNoTerraLeakage(grok), checkNoTerraLeakage(luna)];
  console.log(leak.map((l) => `  ${l.archive}: ${l.terraStimulusRows} rows involve terra output (checked ${l.checked} archived verdict rows)`).join("\n"));
  console.log(`  Separately noted, NOT excluded: terra shares vendor family ("openai") with gpt-5.6-luna, the charm-luna candidate — a judge-family confound, logged not filtered.`);

  if (!RUN) {
    console.log(`\nDRY (no judge calls made — set WSBAT_RUN_BACKTEST=1 to execute against Azure).`);
    console.log(`Would score ${liveJudges.length} judge(s) x 2 archives x 96 rows/archive = ${liveJudges.length * 2 * 96} calls.`);
    return;
  }

  const allResults = [];
  for (const judge of liveJudges) {
    for (const archive of [grok, luna]) {
      console.log(`\n── backtesting ${judge.id} against ${archive.id} (ground truth: ${archive.sourceJudge}) ──`);
      const res = await backtestJudgeOnArchive({ judge, archive, endpoint: AZURE_ENDPOINT, key: AZURE_KEY });
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
  console.log(`  billed to: Azure AI Foundry credits (Microsoft for Startups) — cash cost $0.`);
  console.log(`  No per-token credit-consumption rate is published in this repo for DeepSeek-V4-Flash or gpt-5.6-terra`);
  console.log(`  (config/models.json carries no row for either yet — WS-ROUTER's file, ticketed below). Token counts above`);
  console.log(`  are the measured figure; a $-equivalent burn estimate is deliberately not fabricated without a sourced rate.`);

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
    // Azure credits to reproduce it.
    raw_rows: allResults.flatMap((r) => r.rawRows.map((row) => ({ judge: r.judge, archive: r.archive, ...row }))),
    pooled,
    qualified_panel: pooled.filter((p) => p.verdict === "PASS").map((p) => p.judge),
    reversal_note:
      pooled.every((p) => p.verdict === "FAIL")
        ? "Both credit-billed judge candidates FAILED the >=80% bar with CIs that do not straddle it — context/decisions.md `d2-on-credits`'s own pre-registered reversal condition has fired: 'the credit-billed judges fail the 80% agreement backtest — then one premium judge family is paid in cash and the run costs ~$400, not $834, since only one family needs buying.' Logging this into context/decisions.md is out of this workstream's file grant (Fable per CLAUDE.md's model policy) — reported here so the coordinator can act on it."
        : pooled.some((p) => p.verdict === "PASS")
          ? "At least one credit-billed judge PASSED — d2-on-credits stands as designed, no reversal."
          : "Mixed/underpowered result — see per-judge verdicts before deciding whether d2-on-credits's reversal condition applies.",
    cost: {
      calls: allUsages.length,
      promptTokens: tokIn,
      completionTokens: tokOut,
      billedTo: "Azure AI Foundry credits (Microsoft for Startups)",
      cashCostUsd: 0,
      creditRateNote: "No published per-token credit-consumption rate for DeepSeek-V4-Flash / gpt-5.6-terra in this repo; not estimated to avoid fabricating a number (see context/measurements.md house rule: a figure needs n/method/date to be comparable).",
    },
    tickets: [
      "WS-ROUTER: seed DeepSeek-V4-Flash and gpt-5.6-terra rows into config/models.json (billing:'credits', card_risk per credits-partner check) — not edited here, out of this workstream's file grant.",
      "WS-ROUTER/FinOps: no per-token Azure credit-consumption rate exists in-repo for either deployment; add one so future judge-cost logging can report a $-equivalent burn instead of raw tokens only.",
    ],
  };
  writeFileSync(join(HERE, "judges.json"), JSON.stringify(out, null, 2) + "\n");
  console.log(`\nWrote evals/dbattery/judges.json`);
}

await main();
