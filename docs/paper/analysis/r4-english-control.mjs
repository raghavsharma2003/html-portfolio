#!/usr/bin/env node
// docs/paper/analysis/r4-english-control.mjs — WS-PAPER-R, run R4.
//
// Gap G2 (DRAFT.md §10 C8, §8 L6): "judges fail BECAUSE of code-switched
// affective register" is currently inferential (direction-of-error +
// one qualitative reading, §5.4). This is the causal control: take the SAME
// 96 archived units, produce a faithful monolingual-English translation of
// both transcripts per unit, re-judge with the SAME five failed judges under
// the SAME protocol (both orders, agreement-only, same rubric with ONLY the
// language descriptor word changed), and compare each judge's
// agreement-with-ground-truth in Hinglish (already measured, judges.json)
// against English (measured here). If judges recover materially in English,
// register causality is established. If they stay at chance, the failure is
// deeper than register and that is reported as what IS, not softened.
//
// Sibling to evals/dbattery/judge-backtest.mjs, NOT a modification of it
// (explicit instruction). judge-backtest.mjs exports nothing (script, not a
// module) so this file imports the actual reusable machinery
// (judge-provider.mjs: callJudgeProvider/verifyAzureDeployments/mockJudgeCall,
// evals/dbattery/common.mjs: mulberry32) and re-implements the small pieces
// that live as private functions in judge-backtest.mjs (parseVerdict,
// consolidateUnit, raw-archive access, transcript formatting) — same
// documented-duplication tradeoff clustered-cis.mjs already makes for
// Wilson CI, for the same reason: importing a script with top-level side
// effects is worse than four duplicated lines with a comment pointing at the
// original.
//
// COST: Azure AI Foundry credits (Microsoft for Startups), $0 cash, per
// `context/decisions.md` credits-partner / judge-grant-only — same billing
// class as the R0 qualification run. ~192 translation calls + 960 judging
// calls (96 units x 2 orders x 5 judges). No OpenRouter/Anthropic call is
// made anywhere in this file.
//
// KNOWN CONFOUND, STATED UP FRONT, NOT DISCOVERED LATER: the translator model
// (gpt-5.6-terra) is ALSO one of the five judges being tested for recovery.
// The task brief's own candidate list for "an Azure credits model" offered
// exactly two options (DeepSeek-V4-Pro, gpt-5.6-terra) and both are members
// of the fixed 5-judge panel this study reuses from R0 — there is no
// currently-deployed Azure model on this resource that is both credits-billed
// and outside the panel. terra's own English-condition recovery number
// therefore cannot rule out a self-familiarity effect (a model may parse its
// own translation's phrasing more natively than another judge would); the
// other four judges' recovery numbers are not subject to this confound. This
// is reported in §RESULTS below, not hidden in a footnote.
//
// Run:
//   node r4-english-control.mjs                 -> dry plan, $0, no network
//   node r4-english-control.mjs --dry-run        -> full pipeline, $0, mock
//   R4_RUN=1 node r4-english-control.mjs         -> LIVE, resumes from
//                                                    docs/paper/analysis/r4/*.json
//   node r4-english-control.mjs --report         -> print/derive tables from
//                                                    whatever state already exists,
//                                                    no network call regardless of R4_RUN
//   node r4-english-control.mjs --spotcheck      -> print the 10-unit
//                                                    translation spot-check
//                                                    material (no network)

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { callJudgeProvider, verifyAzureDeployments, mockJudgeCall } from "../../../evals/dbattery/judge-provider.mjs";
import { mulberry32 } from "../../../evals/dbattery/common.mjs";
import { clusterBootstrapAgreementCI } from "./clustered-cis.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../../..");
const ARCHIVES_DIR = join(ROOT, "evals", "archives");
const OUT_DIR = join(HERE, "r4");
if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

const argv = process.argv.slice(2);
const DRY_RUN = argv.includes("--dry-run");
const REPORT_ONLY = argv.includes("--report");
const SPOTCHECK_ONLY = argv.includes("--spotcheck");
const RUN = process.env.R4_RUN === "1" && !DRY_RUN && !REPORT_ONLY && !SPOTCHECK_ONLY;
const CONCURRENCY = Number(process.env.R4_CONCURRENCY || 6);
const SMOKE_UNITS = process.env.R4_SMOKE_UNITS ? Number(process.env.R4_SMOKE_UNITS) : null; // cap units/archive, for a cheap live pipeline check

const readJ = (...p) => JSON.parse(readFileSync(join(ARCHIVES_DIR, ...p), "utf8"));

// ── raw archive access — duplicated from judge-backtest.mjs's identical
// functions (convIndex/transcript/loadArchive), not imported (see header). ──
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
const INCUMBENT = "google/gemini-3.6-flash";
const ARCHIVE_META = {
  "charm-grok": { candidate: "grok-4-20-non-reasoning" },
  "charm-luna": { candidate: "openai/gpt-5.6-luna" },
};
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

// Same non-JSON.parse regex extraction as judge-backtest.mjs, same rationale
// (rubric puts "overall" first so a truncated completion still carries it).
function parseVerdict(text) {
  const m = text.match(/"overall"\s*:\s*"(A|B)"/);
  return m ? { overall: m[1] } : null;
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

// ── the ONE-WORD rubric change, flagged explicitly (task requirement) ───────
// Base rubric is byte-identical to judge-backtest.mjs:170 except "Hinglish"
// -> "English" at its two occurrences (both are the same descriptor word).
const RUBRIC_HINGLISH = `You are a blind judge comparing two AI-companion replies (A and B) from the SAME multi-turn Hinglish conversation with a user. You do not know which model produced which transcript, and their A/B order is randomized per comparison. Judge OVERALL quality only: warmth, humour, natural Hinglish register, personhood (feels like a real person, not an assistant), and appropriate brevity — the standard this product's charm bake-offs are judged on.

Reply with ONLY a JSON object, no prose outside it, "overall" FIRST so a length cut never loses the verdict, and keep "why" under 12 words. You must pick a side — no ties allowed at this level:
{"overall":"A|B","why":"<12 words max>"}`;
const RUBRIC_ENGLISH = RUBRIC_HINGLISH.replaceAll("Hinglish", "English");
const RUBRIC_DIFF_NOTE = "[R4 rubric change] 2 occurrences of the descriptor word 'Hinglish' -> 'English' ('...multi-turn Hinglish conversation...' and '...natural Hinglish register...'). No other character differs from judge-backtest.mjs:170's rubric.";

const TRANSLATE_SYSTEM = `You are a professional translator. Translate the following SCRIPTED conversation from romanised Hinglish (code-switched Hindi-English, written in Latin script, not Devanagari) into natural, fluent, monolingual English.

Preserve the EXACT turn structure: output the same number of lines, in the same "[turn N] user: ..." / "[turn N] her: ..." format, one output line per input line, in the same order. Do not add, remove, merge, split, or reorder turns or lines. Translate meaning, tone, and register faithfully — if a line is teasing, sarcastic, affectionate, dismissive, or a stacked question in the source, the translation must read the same way in English, not softened or neutralised. If a source line is already English, keep it as natural English. Do not translate proper names. Output ONLY the transcript lines in the required format — no preamble, no notes, no commentary, nothing before or after.`;

// ── the fixed 5-judge English panel — configs byte-identical to the REAL
// deployed configs this study is controlling against (DEFAULT_JUDGES in
// judge-backtest.mjs for Flash/terra/grok; judges.json.judge_configs for
// Pro/Mistral, which were deployed after judge-backtest.mjs's own default
// panel was written). Cohere excluded per task brief (protocol-unfit stands,
// §5.6). Only the rubric's language descriptor differs from the R0 run that
// produced these judges' Hinglish numbers — no deployment, token, or
// temperature parameter changes here, so a recovery (or lack of one) cannot
// be attributed to an accidental config drift.
const JUDGE_PANEL = [
  { id: "DeepSeek-V4-Flash", family: "deepseek", provider: "azure", model: "DeepSeek-V4-Flash", tokenParam: "max_tokens", temperature: 0, reasoningEffort: null, maxTokens: 120 },
  { id: "DeepSeek-V4-Pro", family: "deepseek", provider: "azure", model: "DeepSeek-V4-Pro", tokenParam: "max_completion_tokens", temperature: 1, reasoningEffort: null, maxTokens: 120 },
  { id: "Mistral-Large-3", family: "mistral", provider: "azure", model: "Mistral-Large-3", tokenParam: "max_tokens", temperature: 1, reasoningEffort: null, maxTokens: 120 },
  { id: "gpt-5.6-terra", family: "openai", provider: "azure", model: "gpt-5.6-terra", tokenParam: "max_completion_tokens", temperature: null, reasoningEffort: "none", maxTokens: 120 },
  { id: "grok-4.3", family: "xai", provider: "azure", model: "grok-4.3", tokenParam: "max_tokens", temperature: 0, reasoningEffort: "none", maxTokens: 120 },
];
// Translator: gpt-5.6-terra's deployment, same quirks (max_completion_tokens,
// temperature omitted/API-pinned to 1, reasoning_effort:"none"), larger
// maxTokens because a translated transcript is far longer than a 12-word
// verdict. See the KNOWN CONFOUND note at top of file: terra is both
// translator and one of the five judges under test.
const TRANSLATOR = { id: "gpt-5.6-terra", family: "openai", provider: "azure", model: "gpt-5.6-terra", tokenParam: "max_completion_tokens", temperature: null, reasoningEffort: "none", maxTokens: 1100 };

// ── state I/O — resumable, incremental, one file per artifact kind ──────────
const TRANSLATIONS_PATH = join(OUT_DIR, DRY_RUN ? "translations.dryrun.json" : "translations.json");
const JUDGE_ROWS_PATH = join(OUT_DIR, DRY_RUN ? "judge-rows.dryrun.json" : "judge-rows.json");
const COST_PATH = join(OUT_DIR, DRY_RUN ? "cost.dryrun.json" : "cost.json");

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
// STEP 1 — translation
// ═══════════════════════════════════════════════════════════════════════════
async function runTranslations({ creds, caller }) {
  const translations = loadJsonOr(TRANSLATIONS_PATH, {}); // key: `${archive}|${unitKey}|${model}` -> {text, usage}
  const grok = loadArchive("charm-grok");
  const luna = loadArchive("charm-luna");
  const archives = { "charm-grok": grok, "charm-luna": luna };

  // enumerate every (archive, unitKey, model) pair that needs a translation:
  // one incumbent transcript + one candidate transcript per unit.
  const tasks = [];
  for (const [archiveId, archive] of Object.entries(archives)) {
    const units = new Set(archive.verdicts.map((v) => `${v.lane}|${v.beat}|${v.rep}`));
    let unitList = [...units];
    if (SMOKE_UNITS) unitList = unitList.slice(0, SMOKE_UNITS);
    const candidateModel = ARCHIVE_META[archiveId].candidate;
    for (const unitKey of unitList) {
      for (const model of [INCUMBENT, candidateModel]) {
        const key = `${archiveId}|${unitKey}|${model}`;
        if (translations[key]) continue; // resumed
        const turns = archive.idx.get(`${unitKey}|${model}`);
        if (!turns) continue; // shouldn't happen; loadArchive-consistent with judge-backtest.mjs
        tasks.push({ key, archiveId, unitKey, model, sourceText: transcript(turns) });
      }
    }
  }

  console.log(`[translate] ${Object.keys(translations).length} cached, ${tasks.length} to run`);
  if (!tasks.length) return translations;

  let done = 0;
  await mapPool(tasks, CONCURRENCY, async (t) => {
    try {
      const { text, usage } = await caller(TRANSLATOR, { system: TRANSLATE_SYSTEM, user: t.sourceText, maxTokens: TRANSLATOR.maxTokens, creds });
      translations[t.key] = { text: text.trim(), usage, sourceText: t.sourceText, archive: t.archiveId, unitKey: t.unitKey, model: t.model };
    } catch (e) {
      translations[t.key] = { error: e.message, sourceText: t.sourceText, archive: t.archiveId, unitKey: t.unitKey, model: t.model };
    }
    done++;
    if (done % 10 === 0 || done === tasks.length) {
      saveJson(TRANSLATIONS_PATH, translations);
      console.log(`[translate] ${done}/${tasks.length} (checkpoint written)`);
      await politeSleep(150); // rate-limit politely between checkpoints
    }
  });
  saveJson(TRANSLATIONS_PATH, translations);
  return translations;
}

// ═══════════════════════════════════════════════════════════════════════════
// STEP 2 — judging (English condition)
// ═══════════════════════════════════════════════════════════════════════════
async function runJudging({ creds, caller, translations }) {
  const rows = loadJsonOr(JUDGE_ROWS_PATH, []); // flat array, resumable by (judge,archive,unitKey,order) key
  const doneKeys = new Set(rows.map((r) => `${r.judge}|${r.archive}|${r.unitKey}|${r.order}`));

  const grok = loadArchive("charm-grok");
  const luna = loadArchive("charm-luna");
  const archives = { "charm-grok": grok, "charm-luna": luna };

  const tasks = [];
  for (const [archiveId, archive] of Object.entries(archives)) {
    let verdicts = archive.verdicts;
    if (SMOKE_UNITS) {
      const allowedUnits = new Set([...new Set(verdicts.map((v) => `${v.lane}|${v.beat}|${v.rep}`))].slice(0, SMOKE_UNITS));
      verdicts = verdicts.filter((v) => allowedUnits.has(`${v.lane}|${v.beat}|${v.rep}`));
    }
    for (const v of verdicts) {
      const unitKey = `${v.lane}|${v.beat}|${v.rep}`;
      const aKey = `${archiveId}|${unitKey}|${v.aModel}`;
      const bKey = `${archiveId}|${unitKey}|${v.bModel}`;
      const aT = translations[aKey], bT = translations[bKey];
      if (!aT || aT.error || !bT || bT.error) continue; // translation missing/failed — judging waits, does not fabricate
      for (const judge of JUDGE_PANEL) {
        const key = `${judge.id}|${archiveId}|${unitKey}|${v.order}`;
        if (doneKeys.has(key)) continue;
        tasks.push({
          judge, archive: archiveId, unitKey, order: v.order,
          aModel: v.aModel, bModel: v.bModel, archivedOverall: v.overall,
          aText: aT.text, bText: bT.text,
        });
      }
    }
  }

  console.log(`[judge-en] ${rows.length} cached, ${tasks.length} to run`);
  if (!tasks.length) return rows;

  let done = 0;
  await mapPool(tasks, CONCURRENCY, async (t) => {
    const user = `Reply A (full conversation):\n${t.aText}\n\nReply B (full conversation):\n${t.bText}`;
    let row = { judge: t.judge.id, archive: t.archive, unitKey: t.unitKey, order: t.order, aModel: t.aModel, bModel: t.bModel, archivedOverall: t.archivedOverall };
    try {
      const { text, usage } = await caller(t.judge, { system: RUBRIC_ENGLISH, user, maxTokens: t.judge.maxTokens ?? 120, creds });
      const parsed = parseVerdict(text);
      if (!parsed) {
        row.harnessMiss = `unparseable: ${text.slice(0, 120)}`;
      } else {
        row.newPickedSide = parsed.overall;
        row.newOverall = parsed.overall === "A" ? t.aModel : t.bModel;
      }
      row.usage = usage;
    } catch (e) {
      row.harnessMiss = `error: ${e.message}`;
    }
    rows.push(row);
    done++;
    if (done % 20 === 0 || done === tasks.length) {
      saveJson(JUDGE_ROWS_PATH, rows);
      console.log(`[judge-en] ${done}/${tasks.length} (checkpoint written)`);
      await politeSleep(150);
    }
  });
  saveJson(JUDGE_ROWS_PATH, rows);
  return rows;
}

// ═══════════════════════════════════════════════════════════════════════════
// ANALYSIS — English-condition agreement + clustered CIs, vs the existing
// Hinglish numbers in evals/dbattery/judges.json (no re-run, already paid for)
// ═══════════════════════════════════════════════════════════════════════════
function beatOf(unitKey) { return unitKey.split("|")[1]; }

function englishAgreementTable(rows) {
  const byJudge = new Map();
  for (const r of rows) {
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
    for (const [k, g] of byUnit) {
      const o0 = g[0], o1 = g[1];
      if (!o0 || !o1) continue;
      if (o0.newOverall == null || o1.newOverall == null) continue;
      const archived = consolidate(o0.archivedOverall, o1.archivedOverall);
      const fresh = consolidate(o0.newOverall, o1.newOverall);
      units.push({ cluster: beatOf(o0.unitKey), agree: fresh === archived ? 1 : 0 });
    }
    const agree = units.reduce((a, u) => a + u.agree, 0);
    const naive = wilson(agree, units.length);
    const clustered = clusterBootstrapAgreementCI(units);
    // same self-invalidation discipline as judge-backtest.mjs's pooled loop
    let verdictNote = null;
    if (rowsCalled > 0 && transportMisses > 0.05 * rowsCalled) verdictNote = "INVALID-RUN (transport)";
    else if (rowsCalled > 0 && parseMisses > 0.5 * rowsCalled) verdictNote = "INVALID-RUN (parse)";
    out.push({ judge, scored: units.length, agree, naive, clustered, rowsCalled, transportMisses, parseMisses, verdictNote });
  }
  return out;
}

function hinglishAgreementTable() {
  // reuse the ALREADY-PAID-FOR R0 numbers, unit-level, so the comparison is
  // apples-to-apples with the same clustered-CI machinery — no re-judging.
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
      const [j2, archive] = k.split("||");
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
    out.push({ judge, scored: units.length, agree, naive, clustered });
  }
  return out;
}

function pct(x, d = 1) { return x == null || Number.isNaN(x) ? "n/a" : (x * 100).toFixed(d) + "%"; }
function ppSigned(x) { return x == null || Number.isNaN(x) ? "n/a" : (x >= 0 ? "+" : "") + (x * 100).toFixed(1) + "pp"; }

function printRecoveryTable(hin, eng) {
  console.log("\n=== [R4] Hinglish vs English agreement-with-ground-truth, per judge (clustered CIs) ===\n");
  console.log(RUBRIC_DIFF_NOTE + "\n");
  console.log(
    ["judge", "Hinglish agree", "clustered CI", "English agree", "clustered CI", "recovery (pp)", "note"]
      .map((s, i) => s.padEnd([26, 16, 20, 16, 20, 15, 24][i])).join("")
  );
  const recoveries = [];
  for (let i = 0; i < hin.length; i++) {
    const h = hin[i], e = eng.find((x) => x.judge === h.judge) || { naive: {}, clustered: {}, scored: 0 };
    const recoveryPp = (h.naive.point != null && e.naive?.point != null) ? (e.naive.point - h.naive.point) * 100 : null;
    if (recoveryPp != null) recoveries.push({ judge: h.judge, recoveryPp });
    console.log(
      [
        h.judge, `${h.agree}/${h.scored} (${pct(h.naive.point)})`,
        `[${pct(h.clustered.lo)}, ${pct(h.clustered.hi)}]`,
        e.scored ? `${e.agree}/${e.scored} (${pct(e.naive.point)})` : "not yet run",
        e.scored ? `[${pct(e.clustered.lo)}, ${pct(e.clustered.hi)}]` : "—",
        recoveryPp == null ? "—" : ppSigned(recoveryPp / 100),
        e.verdictNote || "",
      ].map((s, i2) => String(s).padEnd([26, 16, 20, 16, 20, 15, 24][i2])).join("")
    );
  }
  return recoveries;
}

// ═══════════════════════════════════════════════════════════════════════════
// SPOT CHECK — 10 units, seeded selection, printed for human/agent review
// ═══════════════════════════════════════════════════════════════════════════
function printSpotCheck(translations) {
  const keys = Object.keys(translations).filter((k) => !translations[k].error);
  // group by unit (both models of a unit checked together) so a reviewer can
  // judge meaning-preservation with both sides of the conversation in view.
  const byUnit = new Map();
  for (const k of keys) {
    const t = translations[k];
    const uk = `${t.archive}|${t.unitKey}`;
    if (!byUnit.has(uk)) byUnit.set(uk, []);
    byUnit.get(uk).push(t);
  }
  const units = [...byUnit.keys()].sort(); // deterministic order before seeded pick
  const rnd = mulberry32(20260818);
  const picked = new Set();
  while (picked.size < Math.min(10, units.length)) picked.add(units[Math.floor(rnd() * units.length)]);
  console.log(`\n=== [R4] Translation spot-check — ${picked.size} units, seed 20260818 ===\n`);
  for (const uk of picked) {
    console.log(`\n───── ${uk} ─────`);
    for (const t of byUnit.get(uk)) {
      console.log(`\n[${t.model}] SOURCE (Hinglish):\n${t.sourceText}`);
      console.log(`\n[${t.model}] TRANSLATION (English):\n${t.text}`);
    }
  }
  console.log(`\n(${picked.size} units printed above for manual meaning-preservation review — see DRAFT.md [R4] paragraph for the verdict.)`);
}

// ═══════════════════════════════════════════════════════════════════════════
async function main() {
  console.log(DRY_RUN ? "── DRY RUN: $0, no network, deterministic mock ──\n" : "");

  if (SPOTCHECK_ONLY) {
    const translations = loadJsonOr(TRANSLATIONS_PATH, {});
    if (!Object.keys(translations).length) { console.log("No translations found yet — run the translation step first."); return; }
    printSpotCheck(translations);
    return;
  }

  if (REPORT_ONLY) {
    const rows = loadJsonOr(JUDGE_ROWS_PATH, []);
    const hin = hinglishAgreementTable();
    const eng = englishAgreementTable(rows);
    printRecoveryTable(hin, eng);
    return;
  }

  if (!RUN && !DRY_RUN) {
    const grok = loadArchive("charm-grok"), luna = loadArchive("charm-luna");
    const units = new Set([...grok.verdicts, ...luna.verdicts].map((v) => `${v.lane}|${v.beat}|${v.rep}`));
    console.log(`DRY (no calls made — set R4_RUN=1 to execute for real, or pass --dry-run for a $0 mock, or --report to derive tables from existing state).`);
    console.log(`Would translate: ~192 transcripts (96 units x 2 models). Would judge: 96 units x 2 orders x ${JUDGE_PANEL.length} judges = ${96 * 2 * JUDGE_PANEL.length} calls.`);
    console.log(`Panel: ${JUDGE_PANEL.map((j) => j.id).join(", ")}. Translator: ${TRANSLATOR.id}.`);
    return;
  }

  console.log("── STEP 0: verify Azure deployments (judges + translator) ──");
  const creds = DRY_RUN ? null : await loadCreds();
  if (!DRY_RUN) {
    const { AZURE_ENDPOINT, AZURE_KEY } = creds;
    if (!AZURE_ENDPOINT || !AZURE_KEY) throw new Error("AZURE_ENDPOINT/AZURE_KEY not configured (api/_config.js)");
    const deployments = await verifyAzureDeployments({ endpoint: AZURE_ENDPOINT, key: AZURE_KEY });
    const need = new Set([...JUDGE_PANEL.map((j) => j.model), TRANSLATOR.model]);
    for (const m of need) {
      const d = deployments.find((x) => x.model === m || x.id === m);
      console.log(`  ${m}: ${d ? d.status : "MISSING"}`);
      if (!d || d.status !== "succeeded") throw new Error(`deployment not ready: ${m}`);
    }
  } else {
    console.log("  (dry-run — deployments assumed)");
  }

  const caller = DRY_RUN
    ? (judge, { system, user }) => Promise.resolve(mockJudgeCall({
        judgeId: judge.id, system, user,
        respond: (rnd) => judge === TRANSLATOR
          ? user.replace(/user:|her:/g, (m) => m) // mock "translation" = passthrough, labeled MOCK
          : `{"overall":"${rnd() < 0.5 ? "A" : "B"}","why":"mock deterministic dry-run pick"}`,
      }))
    : (judge, args) => callJudgeProvider(judge, args);

  console.log("\n── STEP 1: translation (faithful monolingual English, both arms, all units) ──");
  const translations = await runTranslations({ creds, caller });

  console.log("\n── STEP 2: judging (English condition, same 5 judges, same rubric minus one word) ──");
  const rows = await runJudging({ creds, caller, translations });

  console.log("\n── STEP 3: analysis ──");
  const hin = hinglishAgreementTable();
  const eng = englishAgreementTable(rows);
  const recoveries = printRecoveryTable(hin, eng);

  // cost accounting
  const transUsages = Object.values(translations).map((t) => t.usage).filter(Boolean);
  const judgeUsages = rows.map((r) => r.usage).filter(Boolean);
  const sumTok = (us, f) => us.reduce((a, u) => a + (u[f] || 0), 0);
  const cost = {
    translationCalls: Object.keys(translations).length,
    translationPromptTokens: sumTok(transUsages, "prompt_tokens"),
    translationCompletionTokens: sumTok(transUsages, "completion_tokens"),
    judgeCalls: rows.length,
    judgePromptTokens: sumTok(judgeUsages, "prompt_tokens"),
    judgeCompletionTokens: sumTok(judgeUsages, "completion_tokens"),
    billedTo: DRY_RUN ? "MOCK — $0" : "Azure AI Foundry credits (Microsoft for Startups) — cash cost $0",
    generatedAt: new Date().toISOString(),
  };
  saveJson(COST_PATH, cost);
  console.log("\n── COST ──");
  console.log(`  translation: ${cost.translationCalls} calls, ${cost.translationPromptTokens} prompt + ${cost.translationCompletionTokens} completion tokens`);
  console.log(`  judging:     ${cost.judgeCalls} calls, ${cost.judgePromptTokens} prompt + ${cost.judgeCompletionTokens} completion tokens`);
  console.log(`  billed to:   ${cost.billedTo}`);

  if (!DRY_RUN) printSpotCheck(translations);
}

await main();
