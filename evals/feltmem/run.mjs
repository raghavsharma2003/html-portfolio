// ── THE FELT-MEMORY BATTERY RUNNER (docs/MEMORY-FELT.md §9) ───────────────
//
// The acceptance test of the memory arc: a pre-registered scenario suite that
// scores her memory BEHAVIOUR against what the best human in the relationship
// would do, arm-vs-arm, blind, with the rubric written before any reply
// existed.
//
// ── SHAPE, AND WHY IT IS THIS SHAPE ───────────────────────────────────────
// Modelled on evals/candidate/ (WS-CORPUS/WS-CANDGEN, the harness
// docs/SWAP-TEST-PREREG.md Amendment 1 produced): the deterministic half runs
// offline for free and is a CI gate; the generation and judging half is a
// separate, explicitly flagged, paid step. Contexts are compiled ONCE and
// hashed, so a difference between arms is a difference in what the compiler
// built and never a difference in what the harness happened to assemble that
// afternoon.
//
//   node evals/feltmem/run.mjs                → plan + coverage + projected
//                                               cost. Calls nothing.
//   node evals/feltmem/run.mjs --arms         → also materializes the pre-wave
//                                               tree and diffs the compiled
//                                               contexts. Offline, $0, slower.
//   node evals/feltmem/run.mjs --dry-run      → the WHOLE pipeline (generation,
//                                               both orders, judging, tallying,
//                                               acceptance) against a
//                                               deterministic mock brain and a
//                                               mock judge. No network, $0.
//   FELTMEM_RUN_JUDGED=1 node evals/feltmem/run.mjs --live \
//       --judge evals/dbattery/judge-candidates/<cfg>.json \
//       [--draws N] [--max-spend USD] [--allow-cash]
//                                             → real generation + real judging.
//
// --live REFUSES to spend anything unless the pre-registration hash matches
// the committed manifest (prereg.mjs). That refusal is the whole point: a
// rubric edited after seeing an arm's replies is not a rubric.
//
// NOT in evals/run.mjs's suite map, by construction and for the same reason
// evals/dbattery/d2.mjs is not: it spends money. The OFFLINE half of this
// battery is wired there separately, as evals/feltmem/gate.mjs.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { tallyBothOrdersAgree, mulberry32 } from "../dbattery/common.mjs";
import { compileProbes, loadEngine, ROOT } from "./compile.mjs";
import { materializeTree } from "./arms.mjs";
import { verifyPrereg } from "./prereg.mjs";
import { makeCaller, judgeUnit, resolvePanel, costUsd, normalizePricing } from "./judge.mjs";
import {
  ACCEPTANCE,
  DRAWS_PER_PROBE,
  LAWS,
  PERMANENT_NEGATIVES,
  POWERED_UNITS,
  PREWAVE_REF,
  PROBES,
} from "./fixtures/index.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "out");

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f, d = null) => (argv.indexOf(f) >= 0 ? argv[argv.indexOf(f) + 1] : d);

const DRY_RUN = has("--dry-run");
const LIVE = has("--live");
const ARMS_ONLY = has("--arms");
const ALLOW_CASH = has("--allow-cash");
const DRAWS = Number(val("--draws", DRAWS_PER_PROBE));
const MAX_SPEND = val("--max-spend") === null ? null : Number(val("--max-spend"));
const JUDGE_PATHS = argv.flatMap((a, i) => (a === "--judge" ? [argv[i + 1]] : [])).filter(Boolean);
const RUN_JUDGED = process.env.FELTMEM_RUN_JUDGED === "1" && LIVE && !DRY_RUN;

const ARMS = ["prewave", "current"];

// ── production call shape, mirrored from api/chat.js the way
// evals/candidate/generate-incumbent.mjs mirrors it (that file carries the
// line references; nothing here edits api/*). SCOPE, STATED: the call lanes'
// real transport is Gemini Live, which cannot be replayed from a compiled
// prompt. What this battery serves on every lane is the LANE'S OWN COMPILED
// CONTEXT through the chat completion path — which is exactly the question law
// 8 asks (does she KNOW the same things on that lane) and is not a claim about
// realtime prosody, latency or turn-taking. Anything about how it SOUNDS
// belongs to evals/echosim and the voice suites, not here.
const MODEL = "google/gemini-3.6-flash";
const FREE_MODEL = "gemini-3.6-flash";
const GEMINI_OPENAI_URL = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
const EFFORT = "low";
const MAX_TOKENS = 800;
const SYSTEM_MAX = 64_000;

async function liveGenerator() {
  const { withGeminiKey } = await import(join(ROOT, "api", "_gkeys.js"));
  const { OPENROUTER_KEY } = await import(join(ROOT, "api", "_config.js"));
  return async function generate({ system, user }) {
    const body = {
      model: FREE_MODEL,
      messages: [
        { role: "system", content: [{ type: "text", text: String(system).slice(0, SYSTEM_MAX), cache_control: { type: "ephemeral" } }] },
        { role: "user", content: user },
      ],
      max_tokens: MAX_TOKENS,
      reasoning_effort: EFFORT,
    };
    const got = await withGeminiKey(async (gkey) => {
      const r = await fetch(GEMINI_OPENAI_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${gkey}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(60_000),
      }).catch((e) => ({ ok: false, status: 0, _err: e?.message }));
      if (!r.ok) return { ok: false, retry: r.status === 429 || r.status >= 500, error: `upstream ${r.status ?? 0}` };
      const j = await r.json();
      const text = j?.choices?.[0]?.message?.content ?? "";
      return text.trim() ? { ok: true, value: { text, usage: j?.usage ?? null, billed: "free-pool" } } : { ok: false, retry: true, error: "empty" };
    });
    if (got?.ok) return got.value;
    if (!ALLOW_CASH)
      throw new Error(
        "free Gemini pool exhausted or failing and --allow-cash was not given. The pool is a DAILY budget SHARED with production " +
          "(context/measurements.md `both-lanes-dry`: production chat went down once because our own evals spent the day's budget) — pausing is the correct behaviour.",
      );
    const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${OPENROUTER_KEY}`, "Content-Type": "application/json", "X-Title": "Meera WS-FELTBATTERY" },
      body: JSON.stringify({ model: MODEL, messages: [{ role: "system", content: system }, { role: "user", content: user }], max_tokens: MAX_TOKENS, reasoning: { effort: EFFORT } }),
      signal: AbortSignal.timeout(60_000),
    });
    const j = await r.json();
    return { text: j?.choices?.[0]?.message?.content ?? "", usage: j?.usage ?? null, billed: "openrouter-cash" };
  };
}

/** The $0 brain: deterministic in (arm, probe, draw, compiled system bytes),
 *  so a dry-run proves the pipeline without proving anything about a model. */
function mockGenerator() {
  return async function generate({ system, user, tag }) {
    const rnd = mulberry32([...`${tag}${system.length}${user}`].reduce((h, c) => (Math.imul(h ^ c.charCodeAt(0), 0x01000193) >>> 0), 0x811c9dc5));
    const n = 6 + Math.floor(rnd() * 8);
    return { text: `MOCK reply ${tag} (${n} words of deterministic filler, no model was called)`, usage: null, billed: "mock" };
  };
}

// ── the offline half, printed by every mode ───────────────────────────────
async function plan() {
  const pre = verifyPrereg();
  console.log("── pre-registration ──");
  console.log(`  combined hash  ${pre.computed.combined}`);
  console.log(`  committed      ${pre.manifest ? pre.manifest.combined : "(none on disk)"}`);
  console.log(`  status         ${pre.ok ? "MATCHES — a judged run is permitted" : `BLOCKED — ${pre.why}`}`);
  if (!pre.ok && pre.movedRubrics?.length) console.log(`  rubrics moved  ${pre.movedRubrics.join(", ")}`);

  const cur = await compileProbes({ arm: "current" });
  console.log(`\n── suite ──`);
  console.log(
    `  ${pre.computed.counts.dyads} dyads, ${PROBES.length} probes, ${pre.computed.counts.twins} twin pairs, ` +
      `${DRAWS} draws/probe -> ${PROBES.length * DRAWS} judged units per arm (powered floor ${POWERED_UNITS})`,
  );
  const perLaw = {};
  for (const p of PROBES) (perLaw[p.law] ??= []).push(p.id);
  for (const law of Object.keys(LAWS))
    console.log(`  law ${law}  ${String(perLaw[law]?.length ?? 0).padStart(2)} probes  ${LAWS[law]}`);
  const perLane = {};
  for (const r of cur.rows) perLane[r.lane] = (perLane[r.lane] ?? 0) + 1;
  console.log(`  lanes: ${Object.entries(perLane).map(([k, v]) => `${k} ${v}`).join(", ")}`);
  return { pre, cur };
}

async function armRows() {
  const cur = await compileProbes({ arm: "current" });
  console.log(`\n── arms ──`);
  const tree = materializeTree(PREWAVE_REF);
  console.log(`  prewave ${tree.sha.slice(0, 8)}  ${tree.subject}`);
  const { engine } = await loadEngine({ root: tree.dir, label: "prewave" });
  const pre = await compileProbes({ root: tree.dir, arm: "prewave", engine });
  let moved = 0;
  for (let i = 0; i < cur.rows.length; i++) if (cur.rows[i].sha256 !== pre.rows[i].sha256) moved++;
  console.log(`  compiled contexts differing between arms: ${moved}/${cur.rows.length}`);
  if (moved === 0)
    console.log(
      `  WARNING: the two arms compiled IDENTICAL contexts for every probe. Either the ref is wrong or this suite cannot see the change under test — judging it would measure sampling noise and nothing else.`,
    );
  const bytes = { prewave: 0, current: 0 };
  for (const r of pre.rows) bytes.prewave += r.system.length;
  for (const r of cur.rows) bytes.current += r.system.length;
  console.log(`  mean compiled system bytes: prewave ${Math.round(bytes.prewave / pre.rows.length)}, current ${Math.round(bytes.current / cur.rows.length)}`);
  return { current: cur, prewave: pre, tree, moved };
}

// ── generation + judging ──────────────────────────────────────────────────
async function generateArms({ arms, generate }) {
  const replies = new Map(); // `${arm}|${probeId}|${draw}` -> text
  let calls = 0;
  for (const arm of ARMS) {
    const rows = arms[arm].rows;
    for (const row of rows) {
      for (let draw = 0; draw < DRAWS; draw++) {
        const { text } = await generate({ system: row.system, user: row.stimulus, tag: `${arm}|${row.probeId}|${draw}` });
        replies.set(`${arm}|${row.probeId}|${draw}`, String(text).trim());
        calls++;
        if (calls % 25 === 0) console.log(`  generated ${calls}…`);
      }
    }
  }
  return { replies, calls };
}

async function judgeAll({ replies, panel, caller }) {
  const byId = new Map(PROBES.map((p) => [p.id, p]));
  const verdicts = [];
  const usages = [];
  let spend = 0;
  let aborted = false;
  outer: for (const probe of PROBES) {
    for (let draw = 0; draw < DRAWS; draw++) {
      const a = replies.get(`prewave|${probe.id}|${draw}`);
      const b = replies.get(`current|${probe.id}|${draw}`);
      if (!a || !b) continue;
      for (const judge of panel) {
        for (const order of [0, 1]) {
          if (MAX_SPEND !== null && spend >= MAX_SPEND) {
            aborted = true;
            break outer;
          }
          // order 0: slot A = prewave. order 1: slot A = current. The judge is
          // never told which is which, and a side wins the UNIT only when both
          // orders agree — the house rule, tallied by common.mjs below.
          const [replyA, replyB, armA, armB] =
            order === 0 ? [a, b, "prewave", "current"] : [b, a, "current", "prewave"];
          let res;
          try {
            res = await judgeUnit({ judge, probe: byId.get(probe.id), replyA, replyB, caller });
          } catch (e) {
            console.log(`  ERROR ${judge.id} ${probe.id} draw ${draw} order ${order}: ${e.message}`);
            continue;
          }
          if (res.usage) {
            usages.push({ judgeId: judge.id, usage: res.usage });
            const c = costUsd(judge, res.usage);
            if (Number.isFinite(c)) spend += c;
          }
          if (!res.verdict) {
            console.log(`  UNPARSEABLE verdict (${judge.id}, ${probe.id}, draw ${draw}, order ${order}) — counted as a harness miss`);
            continue;
          }
          const v = res.verdict;
          verdicts.push({
            lane: probe.lane,
            beat: probe.id,
            rep: draw,
            order,
            judge: judge.id,
            law: probe.law,
            felt: v.preference === "A" ? armA : v.preference === "B" ? armB : "tie",
            score: { [armA]: v.a_score, [armB]: v.b_score },
            failures: { [armA]: v.a_failures, [armB]: v.b_failures },
            notes: v.notes,
          });
        }
      }
    }
  }
  return { verdicts, usages, spend, aborted };
}

// ── the tables §9 asks for: per-law and overall, with n, method and date ──
function report({ verdicts, panel, draws, prewaveSha, live }) {
  const date = new Date().toISOString().slice(0, 10);
  const units = new Set(verdicts.map((v) => `${v.beat}|${v.rep}`)).size;

  console.log(`\n══ FELT-MEMORY BATTERY — ${live ? "JUDGED" : "MOCK"} RESULT ══`);
  console.log(
    `method: pre-registered rubric per probe (hash-pinned), blind A/B with both presentation orders, ` +
      `unit win only when both orders agree (evals/dbattery/common.mjs), arms = compiled context from the ` +
      `pre-wave build (${prewaveSha?.slice(0, 8) ?? "?"}) vs the current tree, same brain (${MODEL}) and sampling on both.`,
  );
  console.log(`n: ${units} judged units/arm (${PROBES.length} probes x ${draws} draws), ${verdicts.length} judgments across ${panel.length} judge(s) x 2 orders`);
  console.log(`date: ${date}`);
  if (units < POWERED_UNITS)
    console.log(
      `n=${units} < ${POWERED_UNITS} is UNDERPOWERED (context/measurements.md \`fab-noise-floor\`: judged rates spread 13.6pp on byte-identical input). ` +
        `Proof of execution only at this scale — do not cite any rate below as a measurement.`,
    );

  const meanScore = (arm, filter) => {
    const xs = verdicts.filter(filter).map((v) => v.score[arm]).filter(Number.isFinite);
    return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN;
  };
  const flagCount = (arm, filter) =>
    verdicts.filter(filter).reduce((a, v) => a + (v.failures[arm] || []).length, 0);

  console.log(`\nlaw                                        prewave  current   delta   pref(cur-pre)   flags(cur)`);
  const perLawRows = [];
  for (const law of Object.keys(LAWS)) {
    const f = (v) => String(v.law) === String(law);
    const pre = meanScore("prewave", f);
    const cur = meanScore("current", f);
    const t = tallyBothOrdersAgree({ verdicts: verdicts.filter(f) }, "felt", "prewave", "current");
    const pp = t.units ? ((t.cand - t.inc) / t.units) * 100 : NaN;
    const flags = flagCount("current", f);
    perLawRows.push({ law: Number(law), prewave: pre, current: cur, delta: cur - pre, prefPp: pp, flagsCurrent: flags, units: t.units });
    console.log(
      `${(law + ". " + LAWS[law]).padEnd(42)}` +
        `${pre.toFixed(2).padStart(7)}  ${cur.toFixed(2).padStart(7)}  ${(cur - pre).toFixed(2).padStart(6)}   ` +
        `${(Number.isFinite(pp) ? pp.toFixed(1) + "pp" : "n/a").padStart(13)}   ${String(flags).padStart(10)}`,
    );
  }

  const all = () => true;
  const overall = tallyBothOrdersAgree({ verdicts }, "felt", "prewave", "current");
  const overallPp = overall.units ? ((overall.cand - overall.inc) / overall.units) * 100 : NaN;
  console.log(
    `\noverall: prewave ${meanScore("prewave", all).toFixed(2)} / current ${meanScore("current", all).toFixed(2)} mean rubric score; ` +
      `preference ${overall.cand} current - ${overall.inc} prewave - ${overall.tie} tie/split of ${overall.units} both-orders-agreeing units (${Number.isFinite(overallPp) ? overallPp.toFixed(1) : "n/a"}pp)`,
  );

  // ── named-failure table ────────────────────────────────────────────────
  const byFlag = {};
  for (const v of verdicts)
    for (const arm of ARMS) for (const f of v.failures[arm] || []) ((byFlag[f] ??= { prewave: 0, current: 0 })[arm] += 1);
  console.log(`\nnamed failure flags            prewave  current${Object.keys(byFlag).length ? "" : "   (none flagged)"}`);
  for (const [f, c] of Object.entries(byFlag).sort((a, b) => b[1].current - a[1].current))
    console.log(`  ${f.padEnd(28)}${String(c.prewave).padStart(7)}  ${String(c.current).padStart(7)}${PERMANENT_NEGATIVES.includes(f) ? "   PERMANENT NEGATIVE" : ""}`);

  // ── the pre-registered decision rule, applied ─────────────────────────
  const permanentOnCurrent = Object.entries(byFlag).filter(([f, c]) => PERMANENT_NEGATIVES.includes(f) && c.current > 0);
  const gateA = permanentOnCurrent.length === 0;
  const gateB = Number.isFinite(overallPp) && overallPp >= ACCEPTANCE.preference.minMarginPp;
  const gateC = perLawRows.every((r) => r.current >= ACCEPTANCE.perLaw.minMeanScore && r.delta >= -ACCEPTANCE.perLaw.maxRegressionVsPrewave);
  const twinPairs = PROBES.filter((p) => p.twin_of).map((p) => [p.id, p.twin_of].sort().join("|"));
  const uniqueTwins = [...new Set(twinPairs)].map((k) => k.split("|"));
  const twinScore = (id) => meanScore("current", (v) => v.beat === id);
  const gateD = uniqueTwins.every(([a, b]) => twinScore(a) >= 4 && twinScore(b) >= 4);

  console.log(`\n── the pre-registered decision rule (prereg.manifest.json, frozen before this run) ──`);
  console.log(`  A  no permanent negative on the current arm       ${gateA ? "PASS" : `FAIL (${permanentOnCurrent.map(([f, c]) => `${f} x${c.current}`).join(", ")})`}`);
  console.log(`  B  preference margin >= ${ACCEPTANCE.preference.minMarginPp}pp                      ${gateB ? "PASS" : `FAIL (${Number.isFinite(overallPp) ? overallPp.toFixed(1) : "n/a"}pp)`}`);
  console.log(`  C  every law >= ${ACCEPTANCE.perLaw.minMeanScore} and no law down > ${ACCEPTANCE.perLaw.maxRegressionVsPrewave}   ${gateC ? "PASS" : "FAIL"}`);
  console.log(`  D  both sides of every twin pair >= 4             ${gateD ? "PASS" : "FAIL"}`);
  console.log(
    `\nVERDICT: ${gateA && gateB && gateC && gateD ? "the wave is ACCEPTED by this battery" : "NOT accepted"}` +
      (units < POWERED_UNITS ? " — and this run is UNDERPOWERED, so the verdict is a rehearsal of the decision rule, not the decision." : ""),
  );

  return { date, units, perLawRows, overall, overallPp, byFlag, gates: { A: gateA, B: gateB, C: gateC, D: gateD } };
}

// ── main ──────────────────────────────────────────────────────────────────
async function main() {
  const { pre } = await plan();

  if (!DRY_RUN && !LIVE && !ARMS_ONLY) {
    const { panel, qualifiedCount, cliCount } = resolvePanel({ judgePaths: JUDGE_PATHS });
    console.log(`\n── judge panel ──`);
    console.log(`  ${panel.length ? panel.map((j) => j.id).join(", ") : "(empty)"} (${qualifiedCount} from judges.json qualified_panel, ${cliCount} from --judge)`);
    if (!panel.length)
      console.log(
        `  judges.json's qualified_panel is empty — every credits-billed candidate failed the >=80% bar\n` +
          `  (context/measurements.md \`judge-backtest\`, \`grok43-judge\`). Pass --judge <config.json> from\n` +
          `  evals/dbattery/judge-candidates/ once one is qualified.`,
      );
    console.log(`\n── projected cost of ONE full judged run ──`);
    printProjection(panel);
    console.log(`\nDRY (nothing was called). --dry-run proves the pipeline at $0; --live with FELTMEM_RUN_JUDGED=1 spends.`);
    return;
  }

  if (ARMS_ONLY && !DRY_RUN && !LIVE) {
    await armRows();
    return;
  }

  if (LIVE && !pre.ok) {
    console.log(`\nREFUSING --live: ${pre.why}`);
    console.log(`The pre-registration commit must precede any judged run (docs/MEMORY-FELT.md §9, the terra idiom).`);
    process.exitCode = 1;
    return;
  }
  if (LIVE && !RUN_JUDGED) {
    console.log(`\n--live given without FELTMEM_RUN_JUDGED=1. Nothing was called (a flag that still spends is context/rejected.md \`dryrun-still-spends\`).`);
    return;
  }

  const { panel, usedPlaceholder } = resolvePanel({ judgePaths: JUDGE_PATHS, dryRun: DRY_RUN });
  if (!panel.length) {
    console.log(`\nNo judge panel resolved — nothing to run. Pass --judge <config.json>.`);
    process.exitCode = 1;
    return;
  }
  if (usedPlaceholder) console.log(`\n(using the built-in mock panel — no real judge was configured)`);

  if (RUN_JUDGED && MAX_SPEND !== null) {
    const proj = projection(panel).total;
    if (!Number.isFinite(proj)) {
      console.log(`\n--max-spend ${MAX_SPEND} given but a judge in the panel has no usable pricing. Refusing: a cap that cannot be checked is not a cap.`);
      process.exitCode = 1;
      return;
    }
    if (proj > MAX_SPEND) {
      console.log(`\n--max-spend ${MAX_SPEND} given, projected $${proj.toFixed(2)} EXCEEDS it. Aborting before any call.`);
      process.exitCode = 1;
      return;
    }
  }

  const arms = await armRows();
  const generate = RUN_JUDGED ? await liveGenerator() : mockGenerator();
  console.log(`\n── generation (${ARMS.length} arms x ${PROBES.length} probes x ${DRAWS} draws = ${ARMS.length * PROBES.length * DRAWS} calls, ${RUN_JUDGED ? "REAL" : "MOCK"}) ──`);
  const { replies, calls } = await generateArms({ arms, generate });
  console.log(`  ${calls} replies generated`);

  const creds = RUN_JUDGED ? await import(join(ROOT, "api", "_config.js")) : null;
  const caller = makeCaller({ dryRun: !RUN_JUDGED, creds: creds ? { ...creds, ...process.env } : null });
  console.log(`\n── judging (${PROBES.length} probes x ${DRAWS} draws x ${panel.length} judge(s) x 2 orders) ──`);
  const { verdicts, usages, spend, aborted } = await judgeAll({ replies, panel, caller });
  if (aborted) console.log(`  ABORTED at --max-spend ${MAX_SPEND}; the tables below are partial.`);

  const summary = report({ verdicts, panel, draws: DRAWS, prewaveSha: arms.tree.sha, live: RUN_JUDGED });

  console.log(`\n── cost ──`);
  const byJudge = {};
  for (const u of usages) {
    const b = (byJudge[u.judgeId] ??= { calls: 0, in: 0, out: 0 });
    b.calls++;
    b.in += u.usage.prompt_tokens || 0;
    b.out += u.usage.completion_tokens || 0;
  }
  for (const [id, b] of Object.entries(byJudge)) {
    const cfg = panel.find((j) => j.id === id);
    const usd = costUsd(cfg, { prompt_tokens: b.in, completion_tokens: b.out });
    console.log(`  ${id.padEnd(30)} ${b.calls} calls, ${b.in} in / ${b.out} out tok -> ${Number.isFinite(usd) ? "$" + usd.toFixed(4) : "UNKNOWN (no usable pricing)"}`);
  }
  console.log(`  running total: ${Number.isFinite(spend) ? "$" + spend.toFixed(4) : "unknown"}${RUN_JUDGED ? "" : "  (MOCK — chars/4 token proxy, $0 actually spent)"}`);

  mkdirSync(OUT, { recursive: true });
  const path = join(OUT, RUN_JUDGED ? `judged-${summary.date}.json` : "dryrun.json");
  writeFileSync(
    path,
    JSON.stringify(
      {
        what: "docs/MEMORY-FELT.md §9 felt-memory battery",
        live: RUN_JUDGED,
        date: summary.date,
        prereg: { combined: pre.computed.combined, manifest: pre.manifest?.combined ?? null },
        arms: { prewave: arms.tree.sha, prewaveSubject: arms.tree.subject, current: "working tree", contextsDiffering: arms.moved },
        model: MODEL,
        panel: panel.map((j) => j.id),
        draws: DRAWS,
        summary,
        verdicts,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(`\nwrote ${path}`);
}

// ── cost projection for ONE full judged run ───────────────────────────────
// Judge tokens are estimated from the actual compiled prompt sizes this suite
// produces (the rubric + two replies), not from a remembered figure for some
// other battery. Generation is the free Gemini pool by default, which is $0
// cash and a DAILY budget shared with production — see `both-lanes-dry`.
const EST_JUDGE_IN = 1100; // rubric + failure list + two replies, chars/4
const EST_JUDGE_OUT = 120;
function projection(panel) {
  const calls = PROBES.length * DRAWS * 2; // both orders
  const rows = panel.map((j) => {
    const p = normalizePricing(j);
    return {
      judge: j.id,
      calls,
      usd: p ? (EST_JUDGE_IN * p.inUsdPerTok + EST_JUDGE_OUT * p.outUsdPerTok) * calls : NaN,
    };
  });
  return { rows, total: rows.reduce((a, r) => a + r.usd, 0), calls };
}
function printProjection(panel) {
  const gen = ARMS.length * PROBES.length * DRAWS;
  console.log(`  generation: ${gen} calls (${ARMS.length} arms x ${PROBES.length} probes x ${DRAWS} draws) on the free Gemini pool -> $0 cash; with --allow-cash overflow at the measured $0.0019/chat-turn (context/measurements.md \`cost-per-turn\`) the worst case is $${(gen * 0.0019).toFixed(2)}.`);
  const p = projection(panel);
  if (!panel.length) {
    console.log(`  judging:    ${p.calls} calls, but no judge is resolved, so the cost is UNKNOWN until one is.`);
    return;
  }
  for (const r of p.rows) console.log(`  judging:    ${r.judge.padEnd(28)} ${r.calls} calls -> ${Number.isFinite(r.usd) ? "$" + r.usd.toFixed(2) : "UNKNOWN (no usable pricing on this judge config)"}`);
  console.log(`  TOTAL:      ${Number.isFinite(p.total) ? "$" + p.total.toFixed(2) : "UNKNOWN (at least one judge is unpriced)"} + $0 generation`);
}

await main();
