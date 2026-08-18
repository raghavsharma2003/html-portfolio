#!/usr/bin/env node
// docs/paper/analysis/r2-axis-decomposition.mjs — WS-PAPER-R, run R2.
//
// Gap G8 (DRAFT.md §10 C22, §6.3): the paper's "taste failure, not a
// code-switching failure" mechanism story is currently INFERENTIAL —
// direction-of-error (§5.4) plus one qualitative reading, generalised from
// the `overall` axis alone. The archived ground truth (evals/archives/,
// anthropic/claude-opus-4.8, blind, both-orders) carries SEVEN axes per unit
// (warmth, humour, register, specificity, brevity, personhood, overall) and
// only `overall` has ever been backtested (R0, evals/dbattery/judges.json).
// This run re-judges the SAME 96 archived units, same five judges, same
// both-orders-agree protocol, against each axis's own archived ground truth,
// so §6.3 can say WHERE judge failure concentrates instead of assuming it.
//
// Sibling to docs/paper/analysis/r4-english-control.mjs (explicitly the
// pattern to follow) and to evals/dbattery/judge-backtest.mjs (explicitly
// NOT to be modified — imported machinery only). Duplicates the small
// archive-access/parse/consolidate functions for the same documented reason
// r4-english-control.mjs gives: importing a script with top-level side
// effects is worse than a dozen duplicated lines pointing at the original.
//
// ── THE ONE SPENDING DECISION THIS FILE MAKES, STATED UP FRONT ─────────────
// `overall` is EXCLUDED from live calls here. It is not an "archived axis
// without ground truth" (it has the fullest ground truth of any axis, 96/96
// units, no TIE) — it is excluded because it was ALREADY backtested by R0
// under the byte-identical protocol this file reuses (evals/dbattery/judges.json
// raw_rows/pooled). Re-running it would spend ~960 more credits-billed calls
// to reproduce, at best, R0's numbers plus whatever temperature-driven sampling
// noise the temp=1 judges (DeepSeek-V4-Pro, Mistral-Large-3) contribute — not
// new mechanism evidence. `overall`'s row in every table below is the R0
// number, reused, labelled REUSED, $0 new spend, same discipline R4 already
// used to reuse the Hinglish numbers rather than re-judging them.
//
// COST: Azure AI Foundry credits (Microsoft for Startups), $0 cash, per
// context/decisions.md credits-partner / judge-grant-only. 6 NEW axes (warmth,
// humour, register, specificity, brevity, personhood) x 96 units x 2 orders x
// 5 judges = 5,760 calls. No OpenRouter/Anthropic call anywhere in this file.
//
// ── THE RUBRIC SUBSTITUTION, FLAGGED EXACTLY (task requirement) ────────────
// Base text is byte-identical to evals/dbattery/judge-backtest.mjs:170 /
// docs/paper/analysis/r4-english-control.mjs's RUBRIC_HINGLISH, with exactly
// two changes, both mechanical:
//   1. The sentence "Judge OVERALL quality only: warmth, humour, natural
//      Hinglish register, personhood (feels like a real person, not an
//      assistant), and appropriate brevity — the standard this product's
//      charm bake-offs are judged on." is replaced by "Judge {AXIS} only:
//      {axis's own definition} — the standard this product's charm bake-offs
//      are judged on." — i.e. the enumerated-axis-list sentence collapses to
//      ONE axis, and that axis's clause is its OWN definition, not invented.
//   2. The JSON field name and the "<axis> FIRST" instruction change from
//      "overall" to the axis key (warmth/humour/register/specificity/
//      brevity/personhood) so the parser reads the same field the archived
//      ground truth is keyed on.
// Nothing else — no rubric preamble word, no scoring instruction, no output
// format constraint — differs from the R0/R4 rubric.
//
// ── AXIS DEFINITIONS: SOURCED, NOT INVENTED ─────────────────────────────────
// evals/dbattery/judge-backtest.mjs's own RUBRIC only ever asked for
// `overall` and names the sub-qualities in one clause without defining them.
// The ACTUAL per-axis definitions were written for the script that produced
// the archived ground truth itself: `pb-judge.mjs` (the blind counterbalanced
// judge referenced by evals/archives/charm-grok/personality-battery.md
// section "Appendix — method and spend": "`pb-judge.mjs` for blind judging").
// That script is not checked into this repo (its output is: pb-judged*.json,
// which is what `evals/archives/` holds) but a copy was present in this
// session's scratchpad and its SYS prompt is the definitional source quoted
// verbatim below, one clause per axis, with attribution. This is the
// "archived battery's own axis definitions... recorded" the task requires —
// not a fresh gloss on the word.
const AXIS_DEFS = {
  warmth: {
    label: "WARMTH",
    def: "does she read as a friend who likes this person, or as a service being nice to them?",
  },
  humour: {
    label: "HUMOUR",
    // Source clause continues "...If neither is funny, TIE." — dropped here,
    // not silently: this protocol forbids ties structurally ("no ties allowed
    // at this level", same as R0/R4), so a tie-permission instruction would
    // contradict the output format. Every other word of the definition is verbatim.
    def: "is it actually funny, and is it HER kind of funny (chronically-online, Indian internet, teasing)? Present-but-unfunny does not count.",
  },
  register: {
    label: "REGISTER",
    def: 'casual romanised Hinglish as a young urban Indian actually types/talks. Textbook or over-formal Hindi is a failure. So is English wearing a Hinglish costume (one "yaar" bolted onto a fully English sentence).',
  },
  specificity: {
    label: "SPECIFICITY",
    def: "does she respond to the actual thing this person said, or merely to its topic? Generic comfort/hype/curiosity loses.",
  },
  brevity: {
    label: "BREVITY",
    def: "one thought, said and stopped. Long, tidy, multi-point replies lose. At most one question, never a reply that is only a question.",
  },
  personhood: {
    label: "PERSONHOOD",
    def: 'does she feel like a person with her own life and views, or like an assistant/therapist wearing a name? Penalise: offering unrequested help, "let me know if", summarising their feelings back, over-explaining.',
  },
};
const NEW_AXES = Object.keys(AXIS_DEFS); // 6 — `overall` handled separately (REUSED, see above)
const ALL_AXES = [...NEW_AXES, "overall"];

function buildRubric(axisKey) {
  const { label, def } = AXIS_DEFS[axisKey];
  return `You are a blind judge comparing two AI-companion replies (A and B) from the SAME multi-turn Hinglish conversation with a user. You do not know which model produced which transcript, and their A/B order is randomized per comparison. Judge ${label} only: ${def} — the standard this product's charm bake-offs are judged on.

Reply with ONLY a JSON object, no prose outside it, "${axisKey}" FIRST so a length cut never loses the verdict, and keep "why" under 12 words. You must pick a side — no ties allowed at this level:
{"${axisKey}":"A|B","why":"<12 words max>"}`;
}
// The substitution note printed in every report, so nobody has to diff the
// two rubrics by hand to see exactly what changed.
const RUBRIC_DIFF_NOTE =
  "[R2 rubric change, per axis] ONE sentence changes: the enumerated-axis-list " +
  'sentence ("Judge OVERALL quality only: warmth, humour, ... brevity — the standard ' +
  "this product's charm bake-offs are judged on.\") becomes \"Judge {AXIS} only: " +
  "{axis's own definition, verbatim from pb-judge.mjs} — the standard this product's " +
  'charm bake-offs are judged on." Plus the JSON field name/"FIRST" instruction ' +
  "switches from \"overall\" to the axis key. Nothing else differs from " +
  "judge-backtest.mjs:170 / r4-english-control.mjs's RUBRIC_HINGLISH.";

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { callJudgeProvider, verifyAzureDeployments, mockJudgeCall } from "../../../evals/dbattery/judge-provider.mjs";
import { mulberry32 } from "../../../evals/dbattery/common.mjs";
import { clusterBootstrapAgreementCI } from "./clustered-cis.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../../..");
const ARCHIVES_DIR = join(ROOT, "evals", "archives");
const OUT_DIR = join(HERE, "r2");
if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

const argv = process.argv.slice(2);
const DRY_RUN = argv.includes("--dry-run");
const REPORT_ONLY = argv.includes("--report");
const RUN = process.env.R2_RUN === "1" && !DRY_RUN && !REPORT_ONLY;
const CONCURRENCY = Number(process.env.R2_CONCURRENCY || 8);
const SMOKE_UNITS = process.env.R2_SMOKE_UNITS ? Number(process.env.R2_SMOKE_UNITS) : null;
const SMOKE_AXES = process.env.R2_SMOKE_AXES ? process.env.R2_SMOKE_AXES.split(",") : null;

const readJ = (...p) => JSON.parse(readFileSync(join(ARCHIVES_DIR, ...p), "utf8"));

// ── raw archive access — duplicated from judge-backtest.mjs (see header) ───
function convIndex(files) {
  const idx = new Map();
  files.forEach((d, rep) => {
    for (const conv of d.results) idx.set(`${conv.lane}|${conv.beat}|${rep}|${conv.model}`, conv.turns);
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
    return { id, idx: convIndex(files), verdicts: judged.verdicts };
  }
  if (id === "charm-luna") {
    const files = [readJ("charm-luna", "pb-raw.json"), readJ("charm-luna", "pb-raw2.json")];
    const judged = readJ("charm-luna", "pb-judged.json");
    return { id, idx: convIndex(files), verdicts: judged.verdicts };
  }
  throw new Error(`no judged ground truth for archive: ${id}`);
}

const consolidate = (o0, o1) =>
  o0 === undefined || o1 === undefined ? undefined : o0 === o1 ? o0 : "TIE_FLIP";

function wilson(k, n, z = 1.959963984540054) {
  if (!n) return { point: null, lo: null, hi: null };
  const p = k / n;
  const d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n);
  const s = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return { point: p, lo: (c - s) / d, hi: (c + s) / d };
}

function parseVerdict(text, axisKey) {
  const re = new RegExp(`"${axisKey}"\\s*:\\s*"(A|B)"`);
  const m = text.match(re);
  return m ? { [axisKey]: m[1] } : null;
}

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
async function politeSleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// ── the fixed 5-judge panel — byte-identical configs to R0/R4 (same
// deployments, same token-param/temperature/reasoning-effort quirks) so a
// difference in agreement cannot be attributed to an accidental config drift.
const JUDGE_PANEL = [
  { id: "DeepSeek-V4-Flash", family: "deepseek", provider: "azure", model: "DeepSeek-V4-Flash", tokenParam: "max_tokens", temperature: 0, reasoningEffort: null, maxTokens: 120 },
  { id: "DeepSeek-V4-Pro", family: "deepseek", provider: "azure", model: "DeepSeek-V4-Pro", tokenParam: "max_completion_tokens", temperature: 1, reasoningEffort: null, maxTokens: 120 },
  { id: "Mistral-Large-3", family: "mistral", provider: "azure", model: "Mistral-Large-3", tokenParam: "max_tokens", temperature: 1, reasoningEffort: null, maxTokens: 120 },
  { id: "gpt-5.6-terra", family: "openai", provider: "azure", model: "gpt-5.6-terra", tokenParam: "max_completion_tokens", temperature: null, reasoningEffort: "none", maxTokens: 120 },
  { id: "grok-4.3", family: "xai", provider: "azure", model: "grok-4.3", tokenParam: "max_tokens", temperature: 0, reasoningEffort: "none", maxTokens: 120 },
];

// ── state I/O — resumable, one flat file, keyed so a rerun only fills gaps ──
const JUDGE_ROWS_PATH = join(OUT_DIR, DRY_RUN ? "judge-rows.dryrun.json" : "judge-rows.json");
const GROUND_TRUTH_PATH = join(OUT_DIR, "ground-truth-audit.json");
const SUMMARY_PATH = join(OUT_DIR, "summary.json");
const COST_PATH = join(OUT_DIR, "cost.json");

function loadJsonOr(path, fallback) {
  if (!existsSync(path)) return fallback;
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { return fallback; }
}
function saveJson(path, obj) { writeFileSync(path, JSON.stringify(obj, null, 2) + "\n"); }

async function loadCreds() {
  const cfg = await import(join(ROOT, "api", "_config.js"));
  return { ...cfg, ...process.env };
}

// ═══════════════════════════════════════════════════════════════════════════
// STEP 0 — ground-truth completeness audit (must run before spending a call)
// ═══════════════════════════════════════════════════════════════════════════
function auditGroundTruth() {
  const grok = loadArchive("charm-grok");
  const luna = loadArchive("charm-luna");
  const archives = { "charm-grok": grok, "charm-luna": luna };
  const out = {};
  for (const axis of ALL_AXES) {
    let total = 0, present = 0, tieBoth = 0, tieFlip = 0, decisive = 0;
    const byUnit = new Map(); // archiveId|unitKey -> {0:val,1:val}
    for (const [archiveId, archive] of Object.entries(archives)) {
      for (const v of archive.verdicts) {
        const k = `${archiveId}|${v.lane}|${v.beat}|${v.rep}`;
        if (!byUnit.has(k)) byUnit.set(k, {});
        byUnit.get(k)[v.order] = v[axis];
      }
    }
    for (const [, g] of byUnit) {
      total++;
      if (g[0] === undefined || g[1] === undefined) continue;
      present++;
      const c = consolidate(g[0], g[1]);
      if (c === "TIE_FLIP") tieFlip++;
      else if (c === "TIE") tieBoth++;
      else decisive++;
    }
    out[axis] = { totalUnits: total, presentBothOrders: present, decisive, tieBoth, tieFlip, complete: present === total };
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
// STEP 1 — judging (per axis, live)
// ═══════════════════════════════════════════════════════════════════════════
async function runJudging({ creds, caller }) {
  const rows = loadJsonOr(JUDGE_ROWS_PATH, []);
  const doneKeys = new Set(rows.map((r) => `${r.judge}|${r.axis}|${r.archive}|${r.unitKey}|${r.order}`));

  const grok = loadArchive("charm-grok");
  const luna = loadArchive("charm-luna");
  const archives = { "charm-grok": grok, "charm-luna": luna };
  const axesToRun = (SMOKE_AXES || NEW_AXES).filter((a) => NEW_AXES.includes(a));

  const tasks = [];
  for (const axis of axesToRun) {
    const rubric = buildRubric(axis);
    for (const [archiveId, archive] of Object.entries(archives)) {
      let verdicts = archive.verdicts;
      if (SMOKE_UNITS) {
        const allowedUnits = new Set([...new Set(verdicts.map((v) => `${v.lane}|${v.beat}|${v.rep}`))].slice(0, SMOKE_UNITS));
        verdicts = verdicts.filter((v) => allowedUnits.has(`${v.lane}|${v.beat}|${v.rep}`));
      }
      for (const v of verdicts) {
        const unitKey = `${v.lane}|${v.beat}|${v.rep}`;
        const aTurns = archive.idx.get(`${unitKey}|${v.aModel}`);
        const bTurns = archive.idx.get(`${unitKey}|${v.bModel}`);
        if (!aTurns || !bTurns) continue;
        for (const judge of JUDGE_PANEL) {
          const key = `${judge.id}|${axis}|${archiveId}|${unitKey}|${v.order}`;
          if (doneKeys.has(key)) continue;
          tasks.push({
            judge, axis, rubric, archive: archiveId, unitKey, order: v.order,
            aModel: v.aModel, bModel: v.bModel, archivedAxisValue: v[axis],
            user: `Reply A (full conversation):\n${transcript(aTurns)}\n\nReply B (full conversation):\n${transcript(bTurns)}`,
          });
        }
      }
    }
  }

  console.log(`[judge] ${rows.length} cached, ${tasks.length} to run (axes: ${axesToRun.join(", ")})`);
  if (!tasks.length) return rows;

  let done = 0;
  await mapPool(tasks, CONCURRENCY, async (t) => {
    let row = {
      judge: t.judge.id, axis: t.axis, archive: t.archive, unitKey: t.unitKey, order: t.order,
      aModel: t.aModel, bModel: t.bModel, archivedAxisValue: t.archivedAxisValue,
    };
    try {
      const { text, usage } = await caller(t.judge, { system: t.rubric, user: t.user, maxTokens: t.judge.maxTokens ?? 120, creds });
      const parsed = parseVerdict(text, t.axis);
      if (!parsed) {
        row.harnessMiss = `unparseable: ${text.slice(0, 120)}`;
      } else {
        row.newPickedSide = parsed[t.axis];
        row.newAxisValue = parsed[t.axis] === "A" ? t.aModel : t.bModel;
      }
      row.usage = usage;
    } catch (e) {
      row.harnessMiss = `error: ${e.message}`;
    }
    rows.push(row);
    done++;
    if (done % 40 === 0 || done === tasks.length) {
      saveJson(JUDGE_ROWS_PATH, rows);
      console.log(`[judge] ${done}/${tasks.length} (checkpoint written)`);
      await politeSleep(150);
    }
  });
  saveJson(JUDGE_ROWS_PATH, rows);
  return rows;
}

// ═══════════════════════════════════════════════════════════════════════════
// ANALYSIS
// ═══════════════════════════════════════════════════════════════════════════
function beatOf(unitKey) { return unitKey.split("|")[1]; }

function newAxisAgreementTable(rows, axis) {
  const byJudge = new Map();
  for (const r of rows.filter((r) => r.axis === axis)) {
    if (!byJudge.has(r.judge)) byJudge.set(r.judge, []);
    byJudge.get(r.judge).push(r);
  }
  const out = [];
  for (const judge of JUDGE_PANEL.map((j) => j.id)) {
    const rs = byJudge.get(judge) || [];
    const byUnit = new Map();
    for (const r of rs) {
      const k = `${r.archive}|${r.unitKey}`;
      if (!byUnit.has(k)) byUnit.set(k, {});
      byUnit.get(k)[r.order] = r;
    }
    const transportMisses = rs.filter((r) => typeof r.harnessMiss === "string" && r.harnessMiss.startsWith("error:")).length;
    const parseMisses = rs.filter((r) => typeof r.harnessMiss === "string" && r.harnessMiss.startsWith("unparseable:")).length;
    const rowsCalled = rs.length;
    const units = [];
    for (const [, g] of byUnit) {
      const o0 = g[0], o1 = g[1];
      if (!o0 || !o1) continue;
      if (o0.newAxisValue == null || o1.newAxisValue == null) continue;
      const archived = consolidate(o0.archivedAxisValue, o1.archivedAxisValue);
      const fresh = consolidate(o0.newAxisValue, o1.newAxisValue);
      units.push({ cluster: beatOf(o0.unitKey), agree: fresh === archived ? 1 : 0 });
    }
    const agree = units.reduce((a, u) => a + u.agree, 0);
    const naive = wilson(agree, units.length);
    const clustered = clusterBootstrapAgreementCI(units);
    let verdictNote = null;
    if (rowsCalled > 0 && transportMisses > 0.05 * rowsCalled) verdictNote = "INVALID-RUN (transport)";
    else if (rowsCalled > 0 && parseMisses > 0.5 * rowsCalled) verdictNote = "INVALID-RUN (parse)";
    out.push({ judge, axis, scored: units.length, agree, naive, clustered, rowsCalled, transportMisses, parseMisses, verdictNote, source: "R2 (new)" });
  }
  return out;
}

// `overall` — REUSED from R0 (evals/dbattery/judges.json.raw_rows), no new calls.
function overallAgreementTable() {
  const J = JSON.parse(readFileSync(join(ROOT, "evals", "dbattery", "judges.json"), "utf8"));
  const groups = new Map();
  for (const r of J.raw_rows) {
    const k = `${r.judge}||${r.archive}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  const out = [];
  for (const judge of JUDGE_PANEL.map((j) => j.id)) {
    const units = [];
    for (const [k, rs] of groups) {
      const [j2] = k.split("||");
      if (j2 !== judge) continue;
      const byUnit = new Map();
      for (const r of rs) {
        if (!byUnit.has(r.unitKey)) byUnit.set(r.unitKey, {});
        byUnit.get(r.unitKey)[r.order] = r;
      }
      for (const [unitKey, g] of byUnit) {
        const o0 = g[0], o1 = g[1];
        if (!o0 || !o1) continue;
        if (o0.newOverall == null || o1.newOverall == null) continue;
        const archived = consolidate(o0.archivedOverall, o1.archivedOverall);
        const fresh = consolidate(o0.newOverall, o1.newOverall);
        units.push({ cluster: beatOf(unitKey), agree: fresh === archived ? 1 : 0 });
      }
    }
    const agree = units.reduce((a, u) => a + u.agree, 0);
    const naive = wilson(agree, units.length);
    const clustered = clusterBootstrapAgreementCI(units);
    out.push({ judge, axis: "overall", scored: units.length, agree, naive, clustered, rowsCalled: null, transportMisses: null, parseMisses: null, verdictNote: null, source: "R0 (reused)" });
  }
  return out;
}

function pct(x, d = 1) { return x == null || Number.isNaN(x) ? "n/a" : (x * 100).toFixed(d) + "%"; }

function buildMatrix(rows) {
  const table = {};
  for (const axis of ALL_AXES) {
    const rs = axis === "overall" ? overallAgreementTable() : newAxisAgreementTable(rows, axis);
    table[axis] = rs;
  }
  return table;
}

function printMatrix(matrix) {
  console.log("\n=== [R2] Per-judge x per-axis agreement-with-ground-truth (clustered CIs) ===\n");
  console.log(RUBRIC_DIFF_NOTE + "\n");
  const header = ["axis", ...JUDGE_PANEL.map((j) => j.id)];
  console.log(header.map((s, i) => String(s).padEnd(i === 0 ? 14 : 22)).join(""));
  for (const axis of ALL_AXES) {
    const rs = matrix[axis];
    const cells = [axis, ...JUDGE_PANEL.map((j) => {
      const r = rs.find((x) => x.judge === j.id);
      if (!r || !r.scored) return "n/a";
      return `${pct(r.naive.point)} [${pct(r.clustered.lo)},${pct(r.clustered.hi)}]`;
    })];
    console.log(cells.map((s, i) => String(s).padEnd(i === 0 ? 14 : 22)).join(""));
  }
}

// ═══════════════════════════════════════════════════════════════════════════
async function main() {
  console.log(DRY_RUN ? "── DRY RUN: $0, no network, deterministic mock ──\n" : "");

  console.log("── STEP 0: ground-truth completeness audit (all 7 axes, both archives) ──");
  const audit = auditGroundTruth();
  saveJson(GROUND_TRUTH_PATH, audit);
  for (const [axis, a] of Object.entries(audit)) {
    console.log(`  ${axis.padEnd(12)} present ${a.presentBothOrders}/${a.totalUnits}  decisive ${a.decisive}  tie(both) ${a.tieBoth}  tie_flip ${a.tieFlip}  complete=${a.complete}`);
  }
  const incomplete = Object.entries(audit).filter(([, a]) => !a.complete);
  if (incomplete.length) {
    console.log(`\n!! Axes with INCOMPLETE archived ground truth (would be SKIPPED, not imputed): ${incomplete.map(([a]) => a).join(", ")}`);
  } else {
    console.log("\nAll 7 axes have complete both-orders archived ground truth (96/96 units each, both archives). Nothing skipped.");
  }

  if (REPORT_ONLY) {
    const rows = loadJsonOr(JUDGE_ROWS_PATH, []);
    const matrix = buildMatrix(rows);
    printMatrix(matrix);
    // Merge onto any existing summary rather than overwrite: --report never
    // makes a network call and so never re-derives `cost` (that only exists
    // as measured usage from a live run) or `pooledPerAxis` (written by the
    // separate r2-pooled-per-axis.mjs companion script) — clobbering those
    // fields here would silently discard real spend accounting that this
    // mode has no way to reconstruct.
    const existing = loadJsonOr(SUMMARY_PATH, {});
    saveJson(SUMMARY_PATH, { ...existing, generatedAt: new Date().toISOString(), rubricDiffNote: RUBRIC_DIFF_NOTE, groundTruthAudit: audit, matrix });
    return;
  }

  if (!RUN && !DRY_RUN) {
    console.log(`\nDRY (no calls made — set R2_RUN=1 to execute for real, or pass --dry-run for a $0 mock, or --report to derive tables from existing state).`);
    console.log(`Would judge: 6 new axes x 96 units x 2 orders x ${JUDGE_PANEL.length} judges = ${6 * 96 * 2 * JUDGE_PANEL.length} calls. 'overall' reused from R0, 0 new calls.`);
    console.log(`Panel: ${JUDGE_PANEL.map((j) => j.id).join(", ")}.`);
    return;
  }

  console.log("\n── STEP 0.5: verify Azure deployments ──");
  const creds = DRY_RUN ? null : await loadCreds();
  if (!DRY_RUN) {
    const { AZURE_ENDPOINT, AZURE_KEY } = creds;
    if (!AZURE_ENDPOINT || !AZURE_KEY) throw new Error("AZURE_ENDPOINT/AZURE_KEY not configured (api/_config.js)");
    const deployments = await verifyAzureDeployments({ endpoint: AZURE_ENDPOINT, key: AZURE_KEY });
    for (const j of JUDGE_PANEL) {
      const d = deployments.find((x) => x.model === j.model || x.id === j.model);
      console.log(`  ${j.model}: ${d ? d.status : "MISSING"}`);
      if (!d || d.status !== "succeeded") throw new Error(`deployment not ready: ${j.model}`);
    }
  } else {
    console.log("  (dry-run — deployments assumed)");
  }

  const caller = DRY_RUN
    ? (judge, { system, user }) => Promise.resolve(mockJudgeCall({
        judgeId: judge.id, system, user,
        respond: (rnd) => {
          const m = system.match(/"([a-z]+)" FIRST/);
          const axisKey = m ? m[1] : "overall";
          return `{"${axisKey}":"${rnd() < 0.5 ? "A" : "B"}","why":"mock deterministic dry-run pick"}`;
        },
      }))
    : (judge, args) => callJudgeProvider(judge, args);

  console.log("\n── STEP 1: judging (6 axes, same 5 judges, same protocol, axis-substituted rubric) ──");
  const rows = await runJudging({ creds, caller });

  console.log("\n── STEP 2: analysis ──");
  const matrix = buildMatrix(rows);
  printMatrix(matrix);

  const usages = rows.map((r) => r.usage).filter(Boolean);
  const sumTok = (f) => usages.reduce((a, u) => a + (u[f] || 0), 0);
  const cost = {
    newAxisCalls: rows.length,
    promptTokens: sumTok("prompt_tokens"),
    completionTokens: sumTok("completion_tokens"),
    overallAxisNewCalls: 0,
    overallAxisSource: "R0 (evals/dbattery/judges.json) — reused, not re-run",
    billedTo: DRY_RUN ? "MOCK — $0" : "Azure AI Foundry credits (Microsoft for Startups) — cash cost $0",
    generatedAt: new Date().toISOString(),
  };
  saveJson(COST_PATH, cost);
  saveJson(SUMMARY_PATH, { generatedAt: cost.generatedAt, rubricDiffNote: RUBRIC_DIFF_NOTE, groundTruthAudit: audit, matrix, cost });
  console.log("\n── COST ──");
  console.log(`  judging: ${cost.newAxisCalls} calls, ${cost.promptTokens} prompt + ${cost.completionTokens} completion tokens`);
  console.log(`  billed to: ${cost.billedTo}`);
}

await main();
