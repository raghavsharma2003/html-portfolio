#!/usr/bin/env node
// harness/judge-backtest.mjs — qualify a candidate LLM judge by backtesting it
// against a set of verdicts you already trust.
//
// THIS IS THE WHOLE PROTOCOL. Point it at your own archive and your own judge
// and it will tell you, with an interval and against a stated bar, whether that
// judge reproduces decisions you already believe — or refuse to tell you
// anything, if the run was crippled (see harness/guards.mjs).
//
//   node harness/judge-backtest.mjs --dry-run
//       full pipeline, deterministic mock judge, no network, $0. Always safe.
//
//   node harness/judge-backtest.mjs --judge harness/judges/<config>.json --run
//       the real thing. Costs money. Never run a judged suite unattended.
//
//   --archive <id>    repeatable; default: every archive under data/archives/
//   --axis <name>     which archived axis to backtest; default "overall"
//   --bar <0..1>      qualification bar; default 0.80
//   --rubric <file>   override the rubric text (see protocol/RUBRIC.md)
//   --out <file>      where to write the result JSON
//
// WHAT COUNTS AS AGREEMENT. A unit is one conversation, presented to the judge
// in BOTH orders. It yields a verdict only when both orders name the same side;
// an order flip is recorded as TIE_FLIP. The candidate agrees on a unit when
// its consolidated verdict — TIE_FLIP included — equals the archived one.
//
// READ protocol/BAR.md BEFORE CHOOSING A BAR. The single most important thing
// this suite has to say is that a bar chosen without measuring the ground
// truth's own test-retest ceiling is a number nobody has checked. Ours was
// 80%; the ceiling turned out to be 77.1%.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { callJudge, mockJudge } from "./providers.mjs";
import { countMisses, runVerdict, wilsonCI, MISS_TRANSPORT, MISS_PARSE } from "./guards.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => JSON.parse(readFileSync(resolve(ROOT, p), "utf8"));

// ── CLI ─────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const many = (n) => argv.flatMap((a, i) => (a === n ? [argv[i + 1]] : [])).filter(Boolean);

const DRY = flag("--dry-run");
const RUN = flag("--run");
const AXIS = opt("--axis", "overall");
const BAR = Number(opt("--bar", "0.80"));
const CONCURRENCY = Number(process.env.JUDGE_CONCURRENCY || 6);
const OUT = opt("--out", "qualification.json");
const ARCHIVE_IDS = many("--archive").length ? many("--archive") : ["charm-grok", "charm-luna"];
const JUDGE_PATHS = many("--judge");

const DEFAULT_RUBRIC = readFileSync(resolve(ROOT, "protocol/RUBRIC.md"), "utf8")
  .split("<!-- RUBRIC BEGIN -->")[1]?.split("<!-- RUBRIC END -->")[0]?.trim();
const RUBRIC = opt("--rubric") ? readFileSync(opt("--rubric"), "utf8").trim() : DEFAULT_RUBRIC;
if (!RUBRIC) throw new Error("no rubric: protocol/RUBRIC.md must contain a <!-- RUBRIC BEGIN/END --> block");

// ── data ────────────────────────────────────────────────────────────────────
function loadArchive(id) {
  const t = read(`data/archives/${id}/transcripts.json`);
  const v = read(`data/archives/${id}/verdicts.json`);
  const idx = new Map();
  for (const c of t.transcripts) idx.set(`${c.lane}|${c.beat}|${c.rep}|${c.model}`, c.turns);
  return { id, idx, verdicts: v.verdicts, sourceJudge: v.judge, arms: t.arms };
}

const transcript = (turns) =>
  turns.map((t, i) => `[turn ${i + 1}] user: ${t.user}\n[turn ${i + 1}] her: ${t.reply}`).join("\n");

// Deliberately NOT a full JSON.parse gate. At this prompt size a truncated
// completion still carries a complete verdict because the rubric puts the
// decision field FIRST; JSON.parse would reject the whole object over a cut-off
// trailing string and silently convert a real verdict into a harness miss.
const parseVerdict = (text, axis) => {
  const m = String(text).match(new RegExp(`"${axis}"\\s*:\\s*"(A|B)"`));
  return m ? m[1] : null;
};

const consolidate = (o0, o1) =>
  o0 === undefined || o1 === undefined ? undefined : o0 === o1 ? o0 : "TIE_FLIP";

async function mapPool(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const worker = async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]); } };
  await Promise.all(new Array(Math.min(limit, items.length)).fill(0).map(worker));
  return out;
}

async function backtest(judge, archive) {
  const rows = archive.verdicts;
  const results = [];
  const usages = [];
  await mapPool(rows, CONCURRENCY, async (v) => {
    const unitKey = `${v.lane}|${v.beat}|${v.rep}`;
    const a = archive.idx.get(`${unitKey}|${v.aModel}`);
    const b = archive.idx.get(`${unitKey}|${v.bModel}`);
    if (!a || !b) { results.push({ ...v, unitKey, harnessMiss: `${MISS_TRANSPORT} missing transcript for a/b side` }); return; }
    const user = `Reply A (full conversation):\n${transcript(a)}\n\nReply B (full conversation):\n${transcript(b)}`;
    try {
      const { text, usage } = DRY
        ? mockJudge({ judgeId: judge.id, system: RUBRIC, user, respond: (rnd) => `{"${AXIS}":"${rnd() < 0.5 ? "A" : "B"}","why":"deterministic dry-run pick"}` })
        : await callJudge(judge, { system: RUBRIC, user, maxTokens: judge.maxTokens });
      if (usage) usages.push(usage);
      const side = parseVerdict(text, AXIS);
      if (!side) { results.push({ ...v, unitKey, harnessMiss: `${MISS_PARSE} ${String(text).slice(0, 120)}` }); return; }
      results.push({ ...v, unitKey, newPickedSide: side, newValue: side === "A" ? v.aModel : v.bModel });
    } catch (e) {
      results.push({ ...v, unitKey, harnessMiss: `${MISS_TRANSPORT} ${e.message}` });
    }
  });

  const byUnit = new Map();
  for (const r of results) {
    if (!byUnit.has(r.unitKey)) byUnit.set(r.unitKey, { archived: new Map(), fresh: new Map() });
    const s = byUnit.get(r.unitKey);
    s.archived.set(r.order, r[AXIS]);
    if (r.newValue !== undefined) s.fresh.set(r.order, r.newValue);
  }

  let agree = 0, disagree = 0, skipped = 0;
  const unitDetail = [];
  for (const [unitKey, s] of byUnit) {
    const archived = consolidate(s.archived.get(0), s.archived.get(1));
    const fresh = s.fresh.size === 2 ? consolidate(s.fresh.get(0), s.fresh.get(1)) : undefined;
    if (fresh === undefined) { skipped++; continue; }
    const match = archived === fresh;
    if (match) agree++; else disagree++;
    unitDetail.push({ unitKey, archivedVerdict: archived, freshVerdict: fresh, match });
  }

  const scoredRows = results.filter((r) => r.newPickedSide);
  const slotA = scoredRows.filter((r) => r.newPickedSide === "A").length;
  const misses = countMisses(results);
  // The tie rate a purely content-blind judge with this slot-A propensity would
  // produce. The gap between observed and predicted is a usable index of how
  // much content the verdicts are carrying — see protocol/BAR.md.
  const q = scoredRows.length ? slotA / scoredRows.length : null;
  const contentBlindTieRate = q == null ? null : q * q + (1 - q) * (1 - q);
  const observedTieRate = unitDetail.length ? unitDetail.filter((u) => u.freshVerdict === "TIE_FLIP").length / unitDetail.length : null;

  return {
    judge: judge.id, archive: archive.id, axis: AXIS,
    unitsScored: agree + disagree, unitsAgree: agree, unitsDisagree: disagree, unitsSkipped: skipped,
    agreementRate: agree + disagree ? agree / (agree + disagree) : null,
    ci95: wilsonCI(agree, agree + disagree),
    rowsCalled: rows.length, rowsScored: scoredRows.length,
    slotAPickRate: q, contentBlindTieRate, observedTieRate,
    contentSignalGapPp: contentBlindTieRate == null || observedTieRate == null ? null
      : (observedTieRate - contentBlindTieRate) * 100,
    transportMisses: misses.transport, parseMisses: misses.parse, unclassifiedMisses: misses.unclassified,
    trustedJudge: archive.sourceJudge,
    usages, unitDetail,
    rawRows: results.map((r) => ({
      unitKey: r.unitKey, order: r.order, aModel: r.aModel, bModel: r.bModel,
      archivedValue: r[AXIS], newPickedSide: r.newPickedSide ?? null,
      newValue: r.newValue ?? null, harnessMiss: r.harnessMiss ?? null,
    })),
  };
}

async function main() {
  if (!DRY && !RUN) {
    console.log("DRY PLAN — no calls made. Pass --dry-run for a $0 mock of the full pipeline, or --run to spend.");
  }
  const panel = JUDGE_PATHS.length
    ? JUDGE_PATHS.map((p) => JSON.parse(readFileSync(p, "utf8")))
    : [JSON.parse(readFileSync(resolve(ROOT, "harness/judges/example-azure.json"), "utf8"))];
  const archives = ARCHIVE_IDS.map(loadArchive);

  // Leakage: a judge must never score a transcript its own deployment produced.
  for (const a of archives) {
    for (const j of panel) {
      const own = a.verdicts.filter((v) => v.aModel === j.model || v.bModel === j.model);
      if (own.length) throw new Error(`leakage: ${j.id} would judge ${own.length} of its own rows in ${a.id}. Excluding is not optional; aborting rather than silently mis-scoring.`);
    }
  }
  console.log(`leakage check: 0 own-output rows for ${panel.length} judge(s) across ${archives.length} archive(s)`);
  console.log(`vendor-family conflicts are NOT excluded, they are measured — see protocol/BAR.md and the paper's between-judge control.`);

  if (!DRY && !RUN) {
    console.log(`Would score ${panel.length} judge(s) x ${archives.length} archive(s) x ${archives.reduce((n, a) => n + a.verdicts.length, 0)} rows.`);
    return;
  }

  const cells = [];
  for (const judge of panel) for (const a of archives) {
    const r = await backtest(judge, a);
    console.log(`${judge.id} / ${a.id}: ${r.unitsAgree}/${r.unitsScored} = ${r.agreementRate == null ? "n/a" : (r.agreementRate * 100).toFixed(1) + "%"}, slot-A ${(r.slotAPickRate * 100).toFixed(1)}%, misses ${r.transportMisses}T/${r.parseMisses}P`);
    cells.push(r);
  }

  const pooled = panel.map((j) => {
    const parts = cells.filter((c) => c.judge === j.id);
    const agree = parts.reduce((a, c) => a + c.unitsAgree, 0);
    const n = parts.reduce((a, c) => a + c.unitsScored, 0);
    const ci = wilsonCI(agree, n);
    const v = runVerdict({
      ci, bar: BAR,
      rowsCalled: parts.reduce((a, c) => a + c.rowsCalled, 0),
      transportMisses: parts.reduce((a, c) => a + c.transportMisses, 0),
      parseMisses: parts.reduce((a, c) => a + c.parseMisses, 0),
    });
    return { judge: j.id, family: j.family, axis: AXIS, unitsAgree: agree, unitsScored: n, agreementRate: n ? agree / n : null, ci95: ci, bar: BAR, ...v };
  });

  console.log(`\n── POOLED, bar >= ${(BAR * 100).toFixed(0)}% ──`);
  for (const p of pooled) console.log(`  ${p.judge.padEnd(28)} ${p.unitsAgree}/${p.unitsScored} -> ${p.verdict}  (${p.why})`);

  const out = {
    generated_by: "harness/judge-backtest.mjs",
    mode: DRY ? "DRY-RUN (mock judge, no network, $0 — NOT a measurement)" : "live",
    axis: AXIS, bar: BAR, rubric_sha_note: "the exact rubric text used is protocol/RUBRIC.md's RUBRIC block unless --rubric overrode it",
    archives: archives.map((a) => ({ id: a.id, trustedJudge: a.sourceJudge, arms: a.arms, rows: a.verdicts.length })),
    pooled,
    per_cell: cells.map(({ usages, ...c }) => c),
    raw_rows: cells.flatMap((c) => c.rawRows.map((r) => ({ judge: c.judge, archive: c.archive, axis: AXIS, ...r }))),
  };
  writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n");
  console.log(`\nwrote ${OUT}`);
}

await main();
