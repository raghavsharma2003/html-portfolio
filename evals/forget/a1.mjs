// ── A1 — THE MUTATION-TIME FORGET-MATCHING HOOK, MEASURED ──────────────────
//
// A4 (a4.mjs, next door) is the pre-registered surface and the baseline:
// **5.9% adversarial recall, 100% controls, 2 wrong rows in the precision
// set**, recorded 2026-08-23 against the lexical matcher. This file measures
// the same cases through the hook that api/memory.js now runs at mutation
// time, so the gain is a measured delta on OUR Hinglish rather than a
// vendor-shaped claim (docs/research/MEMORY-FIELD-SURVEY.md §9: "A4 before A1").
//
// ── WHAT IS ACTUALLY EXERCISED ─────────────────────────────────────────────
// The two halves of the hook that decide everything are IMPORTED FROM
// api/memory.js, not restated here:
//   forgetHookPrompt()  — the shipped prompt, verbatim
//   parseForgetHook()   — the shipped parser, including its id closure
//   askForgetHook()     — the shipped two-lane call, driven once per live run
// A prompt tested through a copy is a copy that was tested
// (`gates-that-live-nowhere`).
//
// The 27-case sweep uses this file's OWN transport, deliberately: it has to be
// able to point at a lane that does not eat the production key pool, and at a
// model the production path is not currently using, or "which model" stops
// being a question this battery can answer. What that leaves uncovered is the
// lane plumbing itself — the credits-then-pool order, the call cap, the fuse —
// so the live arm additionally drives the REAL askForgetHook once, end to end.
//
// ── SPEND ──────────────────────────────────────────────────────────────────
// The default run makes ZERO model calls. `dryrun-still-spends` is a rejection
// in this repo precisely because a flag whose name implies no spend spent
// money, so the offline arms here are offline by CONSTRUCTION — they never
// reach a transport function at all — and the live arm needs `--live` plus an
// explicit lane. In CI api/_config.js is a stub, so the pool is empty and
// api/memory.js's own hook short-circuits before its first fetch.
//
// ── THE ARMS ───────────────────────────────────────────────────────────────
//   baseline  the lexical matcher alone. Must reproduce a4.mjs exactly, or
//             one of the two files is measuring something else.
//   fallback  the hook forced to fail on every case. Must be BYTE-IDENTICAL
//             to baseline, and every receipt must be hedged or none. This is
//             the fail-safe proof, and it is offline and free.
//   hook      --live only. One model call per case.
//
// Usage:
//   node evals/forget/a1.mjs                       structural + fallback, $0
//   node evals/forget/a1.mjs --live --lane=azure   credits lane
//   node evals/forget/a1.mjs --live --lane=free --confirm   production pool
import { execSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { CASES, RESOLVED_CASES } from "./cases.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const MEM = readFileSync(join(ROOT, "api/memory.js"), "utf8");

// THE SHIPPED HALVES. api/memory.js reaches api/_config.js, which is
// gitignored; CI writes a stub before evals/run.mjs (see evals/recall/run.mjs's
// header for the same posture). Nothing in the default run executes a query or
// a fetch.
const { forgetHookPrompt, parseForgetHook, askForgetHook } = await import(
  join(ROOT, "api/memory.js")
);

const ARGV = process.argv.slice(2);
const LIVE = ARGV.includes("--live");
const LANE = (ARGV.find((a) => a.startsWith("--lane=")) || "--lane=azure").slice(7);
const MODEL = (ARGV.find((a) => a.startsWith("--model=")) || "").slice(8);
const CONFIRM = ARGV.includes("--confirm");

let fail = 0;
let checks = 0;
const ok = (name, cond, extra = "") => {
  checks++;
  if (!cond) {
    fail++;
    console.log(`FAIL ${name}${extra ? " — " + extra : ""}`);
  }
};

// ── the lexical half, emulated exactly as a4.mjs emulates it ───────────────
// Same emulation, same unverified Devanagari edge, same exclusion of the
// script cases from the headline. Kept identical on purpose so "baseline here
// == baseline there" is a real check and not a coincidence.
const reEsc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function pgWordMatch(term, text) {
  return new RegExp(`(?<![\\p{L}\\p{N}_])${reEsc(term)}(?![\\p{L}\\p{N}_])`, "iu").test(text);
}

const tmp = mkdtempSync(join(tmpdir(), "a1-"));
const BUNDLE = join(tmp, "a1.bundle.mjs");
execSync(
  `npx esbuild ${join(HERE, ".entry.ts")} --bundle --format=esm --platform=node ` +
    `--outfile=${BUNDLE} --log-level=error --alias:@capacitor/core=${join(ROOT, "evals/stubs/capacitor.mjs")}`,
  { stdio: "inherit", cwd: ROOT },
);
const { resolveForget } = await import(BUNDLE);

// ── STRUCTURAL: the properties that must hold with no model in the room ────

// 1. The prompt is closed over the ids it shows, carries the marker verbatim,
//    and has no persona in it.
{
  const rows = [
    { id: "7", text: "priya — his colleague, the one who moved to bangalore" },
    { id: "9", text: "he is learning to drive" },
  ];
  const p = forgetHookPrompt("woh ladki", rows);
  const flat = p.map((m) => m.content).join("\n");
  ok("prompt shows every candidate id in brackets", /\[7\]/.test(flat) && /\[9\]/.test(flat));
  ok("prompt carries the referring expression verbatim", flat.includes("woh ladki"));
  ok("prompt forces the id-only schema", /\{"ids":\[/.test(flat));
  ok("prompt states the closure as a rule", /MUST appear in brackets/i.test(flat));
  ok("prompt licenses the empty answer", /empty answer is a correct answer/i.test(flat));
  // NO PERSONA. This is a matching primitive; a voice in it would be a second
  // place her character lives and a second thing to keep in sync — and
  // `recited-prompt` says anything sentence-shaped in a prompt gets recited.
  ok(
    "prompt carries no persona",
    !/meera|girlfriend|warm|hinglish girl|you are a \d|24-year/i.test(flat),
    "a matching primitive must not carry a voice",
  );
  ok("row text is capped", forgetHookPrompt("x", [{ id: "1", text: "a".repeat(9000) }])
    .map((m) => m.content).join("").length < 2000);
}

// 2. THE ANTI-FABRICATION CLOSURE. The parser cannot return a row it was not
//    shown, in any encoding, and this is the whole safety story of the hook.
{
  const allow = ["7", "9"];
  ok("parser keeps ids that were shown", String(parseForgetHook('{"ids":[7,9]}', allow)) === "7,9");
  ok("parser DROPS an id that was never shown",
    String(parseForgetHook('{"ids":[7,4242]}', allow)) === "7");
  ok("parser drops a fabricated id even when it is the only one",
    Array.isArray(parseForgetHook('{"ids":[4242]}', allow)) &&
      parseForgetHook('{"ids":[4242]}', allow).length === 0);
  ok("parser drops a string that merely looks like an id",
    String(parseForgetHook('{"ids":["7 "]}', allow)) === "");
  ok("parser drops a duplicate", String(parseForgetHook('{"ids":[7,7]}', allow)) === "7");
  ok("parser reads through a code fence",
    String(parseForgetHook('```json\n{"ids":[9]}\n```', allow)) === "9");
  ok("parser returns [] for an honest empty answer",
    Array.isArray(parseForgetHook('{"ids":[]}', allow)) && parseForgetHook('{"ids":[]}', allow).length === 0);
  // null, not [] — an unusable reply is a HOOK FAILURE (fallback + hedge), and
  // an empty answer is a RESULT (the honest ask). Collapsing the two would
  // turn every transport hiccup into "nothing matched", which is a lie.
  ok("parser returns null on garbage", parseForgetHook("sorry, I can't help", allow) === null);
  ok("parser returns null on a non-object", parseForgetHook('{"ids":"7"}', allow) === null);
  ok("parser returns null on a non-string", parseForgetHook(undefined, allow) === null);
  ok("failure and emptiness are distinguishable",
    parseForgetHook("nonsense", allow) === null && Array.isArray(parseForgetHook('{"ids":[]}', allow)));
}

// 3. The call-site properties, read out of the shipped source. These are the
//    ones a unit test cannot reach without a database and a key.
ok("the hook UNIONS with the lexical predicate, never replaces it",
  /or id::text = any\(\$4\)\)\s*\n\s*returning id, name/.test(MEM),
  "under-deleting is the wrong direction for this law");
ok("the lexical predicate is still intact inside that union",
  /name = \$2 or name ~\* \$3 or summary ~\* \$3/.test(MEM));
ok("a1 keeps a4's assertion true: the word-bounded regex is still built",
  /const rx = `\\\\m\$\{reEsc\(name\)\}\\\\M`/.test(MEM));
ok("the widened predicate keeps the same word boundary",
  /rxWide = terms\.length > 1 \? `\\\\m\(\$\{terms\.join\("\|"\)\}\)\\\\M`/.test(MEM));
ok("the widened predicate keeps the >= 3 character refusal",
  /\[name, \.\.\.hookNames\]\.filter\(\(t\) => t\.length >= 3\)/.test(MEM));
ok("there is a hard per-op call cap", /FORGET_HOOK_MAX_CALLS = 2/.test(MEM));
ok("the cap is enforced at the call site, not left to the pool helper",
  /const budget = \(\) => calls < FORGET_HOOK_MAX_CALLS/.test(MEM) &&
    /if \(!budget\(\)\) return \{ ok: false, error: "hook call cap" \}/.test(MEM));
ok("the cap counts BOTH lanes, so two dead lanes cannot become four round trips",
  (MEM.match(/calls\+\+;/g) || []).length === 2 &&
    (MEM.match(/budget\(\)/g) || []).length >= 3);
ok("there is a fuse on every attempt",
  /FORGET_HOOK_FUSE_MS = 5_000/.test(MEM) &&
    (MEM.match(/AbortSignal\.timeout\(FORGET_HOOK_FUSE_MS\)/g) || []).length === 2);
ok("the hook reaches the free pool through the same helper api/chat.js uses",
  /from "\.\/_gkeys\.js"/.test(MEM) && /withGeminiKey\(async \(gkey\)/.test(MEM));
// The lane ORDER is a measured decision (see the note above askForgetHook),
// and a measured decision that can be silently reversed is not a decision.
ok("the credits lane is tried first, the free pool second",
  MEM.indexOf("── lane 1: credits ──") < MEM.indexOf("── lane 2: the free pool ──") &&
    MEM.indexOf("── lane 1: credits ──") > 0);
ok("the lane order carries its own reversal condition",
  /REVERSES IF: the free pool stops being saturated/.test(MEM));
ok("a dead credits lane falls THROUGH rather than failing the hook",
  /fall through to the free pool/.test(MEM));
ok("a hook failure falls back rather than throwing",
  /askForgetHook\(name, candidates\)\.catch\(\(\) => \(\{ failed: true \}\)\)/.test(MEM));
ok("the RECEIPT is gated on the hook",
  /scope !== "item" \? "done" : took > 0 \? \(hook\?\.used \? "done" : "hedged"\) : "none"/.test(MEM));
ok("the receipt carries no words, only an outcome",
  !/receipt.*\bname\b|hook = \{[^}]*term/.test(MEM));
ok("the RECALL PATH is untouched — no hook call inside opRecall",
  !/opRecall[\s\S]*?askForgetHook[\s\S]*?\n}/.test(MEM.slice(MEM.indexOf("async function opRecall"), MEM.indexOf("function relBundleShape"))),
  "L2 forbids an LLM in the retrieval path");
ok("the spoken lane can opt out", /body\.nohook/.test(MEM));

// 4. The client half: no receipt for a delete that took nothing.
const BRAIN = readFileSync(join(ROOT, "src/engine/brain.ts"), "utf8");
const CMEM = readFileSync(join(ROOT, "src/engine/memory.ts"), "utf8");
ok("brain.ts refuses to set `forgot` when nothing matched",
  /res\?\.receipt === "none"/.test(BRAIN) && /parsed\.bubbles = \["kaunsi wali\? naam bata do"\]/.test(BRAIN));
ok("the zero-match turn drops any attachment with the false receipt",
  /forget_unmatched/.test(BRAIN) && /parsed\.photo = undefined;\s*\n\s*parsed\.voice = undefined;/.test(BRAIN));
ok("the receipt rides the result type", /receipt: ForgetReceipt/.test(CMEM));
ok("an older server degrades to today's behaviour, not to silence",
  /d\.receipt === "none" \|\| d\.receipt === "hedged" \? d\.receipt : "done"/.test(CMEM));
ok("a spoken turn skips the hook", /nohook: mode === "call"/.test(BRAIN));

// ── the battery ────────────────────────────────────────────────────────────
// One case = one forget. `chosen` is what the delete would take: the lexical
// hits UNION whatever the resolver picked, exactly as opForget composes them.
function lexical(c) {
  const target = resolveForget(c.marker, []);
  const name = target?.scope === "item" ? target.name : null;
  return {
    scope: target?.scope ?? "none",
    name,
    ids: name ? c.rows.filter((r) => pgWordMatch(name, r.text)).map((r) => String(r.id)) : [],
  };
}

function score(c, chosen, hookOk) {
  const want = c.rows.filter((r) => r.hit).map((r) => String(r.id));
  const tp = want.filter((id) => chosen.includes(id)).length;
  return {
    ...c,
    chosen,
    tp,
    fp: chosen.length - tp,
    want: want.length,
    // THE RECEIPT, computed by the same rule opForget computes it by
    receipt: chosen.length ? (hookOk ? "done" : "hedged") : "none",
  };
}

const ADVERSARIAL = new Set([
  "referent-hi", "referent-en", "temporal-ref", "translit", "morphology", "phrase-order",
]);
const ALL = [...CASES, ...RESOLVED_CASES];

function report(label, scored) {
  const adv = scored.filter((r) => ADVERSARIAL.has(r.cat));
  const ctl = scored.filter((r) => r.cat === "control");
  const pre = scored.filter((r) => r.cat === "precision");
  const res = scored.filter((r) => r.cat === "resolved-by-model");
  const rate = (rows) => {
    const w = rows.reduce((a, r) => a + r.want, 0);
    return w ? rows.reduce((a, r) => a + r.tp, 0) / w : 1;
  };
  const advPrec = () => {
    const t = adv.reduce((a, r) => a + r.tp, 0);
    const d = adv.reduce((a, r) => a + r.tp + r.fp, 0);
    return d ? t / d : 1;
  };
  return {
    label,
    adversarialRecall: rate(adv),
    adversarialPrecision: advPrec(),
    controlRecall: rate(ctl),
    resolvedRecall: rate(res),
    precisionFalsePositives: pre.reduce((a, r) => a + r.fp, 0),
    zeroMatch: scored.filter((r) => r.receipt === "none").length,
    hedged: scored.filter((r) => r.receipt === "hedged").length,
    scored,
  };
}

// ── ARM 1: baseline. Must reproduce a4.mjs. ────────────────────────────────
const baseline = report("baseline (lexical only)", ALL.map((c) => score(c, lexical(c).ids, true)));
ok("baseline reproduces the pre-registered A4 headline (5.9%)",
  Math.abs(baseline.adversarialRecall - 0.0588235) < 0.001,
  `${(baseline.adversarialRecall * 100).toFixed(1)}%`);
ok("baseline reproduces the pre-registered controls (100%)", baseline.controlRecall === 1);
ok("baseline reproduces the pre-registered precision cost (2 wrong rows)",
  baseline.precisionFalsePositives === 2, `${baseline.precisionFalsePositives}`);

// ── ARM 2: fallback. The hook fails on every case. ─────────────────────────
// Offline and free by construction: there is no transport in this arm at all.
const fallback = report("fallback (hook fails on every case)",
  ALL.map((c) => score(c, [...new Set([...lexical(c).ids])], false)));
ok("FAIL-SAFE: a dead hook is byte-identical to the lexical matcher",
  JSON.stringify(fallback.scored.map((r) => [r.id, r.chosen])) ===
    JSON.stringify(baseline.scored.map((r) => [r.id, r.chosen])),
  "the fallback must lose nothing that the old matcher took");
ok("FAIL-SAFE: a dead hook never yields an unhedged receipt",
  fallback.scored.every((r) => r.receipt !== "done"));
ok("FAIL-SAFE: every case that took rows is hedged, every case that took none asks",
  fallback.scored.every((r) => (r.chosen.length ? r.receipt === "hedged" : r.receipt === "none")));
ok("the honest ask is what an unmatched adversarial case gets today",
  fallback.scored.filter((r) => ADVERSARIAL.has(r.cat) && r.receipt === "none").length > 0,
  "if this is 0 the false-receipt bug was never real");

// ── ARM 3: live ────────────────────────────────────────────────────────────
const AZ_MODEL = "grok-4-1-fast-reasoning";
const FREE_MODEL = "gemini-3.6-flash";
const GEMINI_OPENAI_URL = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";

async function callLive(messages, cfg) {
  const t = Date.now();
  // `or` exists to answer ONE question the other two lanes cannot: how good is
  // the free lane's MODEL, separated from how healthy the free lane's POOL is.
  // The first free-lane run of this battery came back 35.3% with 18 of 27 calls
  // 429'd — a number about quota, not about matching, and unusable as either.
  if (LANE === "or") {
    const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.OPENROUTER_KEY}`,
        "Content-Type": "application/json",
        "X-Title": "Meera",
      },
      body: JSON.stringify({
        model: MODEL || "google/gemini-3.6-flash",
        max_tokens: 300,
        temperature: 0,
        messages,
      }),
      signal: AbortSignal.timeout(60_000),
    });
    const j = r.ok ? await r.json() : null;
    return { text: j?.choices?.[0]?.message?.content ?? null, ms: Date.now() - t, status: r.status };
  }
  if (LANE === "azure") {
    const r = await fetch(`${cfg.AZURE_ENDPOINT}/chat/completions`, {
      method: "POST",
      headers: { "api-key": cfg.AZURE_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ model: MODEL || AZ_MODEL, max_tokens: 2000, temperature: 0, messages }),
      signal: AbortSignal.timeout(60_000),
    });
    const j = r.ok ? await r.json() : null;
    return { text: j?.choices?.[0]?.message?.content ?? null, ms: Date.now() - t, status: r.status };
  }
  const keys = process.env.EVAL_GOOGLE_KEYS?.split(",").filter(Boolean) ?? cfg.GOOGLE_KEYS;
  for (const k of keys) {
    const r = await fetch(GEMINI_OPENAI_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${k}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: MODEL || FREE_MODEL, max_tokens: 300, temperature: 0, messages }),
      signal: AbortSignal.timeout(20_000),
    });
    if (r.status === 429 || r.status === 403 || r.status >= 500) continue;
    const j = r.ok ? await r.json() : null;
    return { text: j?.choices?.[0]?.message?.content ?? null, ms: Date.now() - t, status: r.status };
  }
  return { text: null, ms: Date.now() - t, status: 0 };
}

let live = null;
if (LIVE) {
  if (LANE === "free" && !process.env.EVAL_GOOGLE_KEYS && !CONFIRM) {
    console.log(
      "\nSTOP: --lane=free with no EVAL_GOOGLE_KEYS would spend the PRODUCTION pool,\n" +
        "which is a shared daily budget (~75 calls/day, `free-pool-capacity`).\n" +
        "Set EVAL_GOOGLE_KEYS, or pass --confirm to spend it deliberately.",
    );
    process.exit(1);
  }
  const cfg = await import(join(ROOT, "api/_config.js"));

  // ── the SHIPPED function, driven once, over the real lane plumbing ───────
  // Everything above measures the shipped PROMPT and PARSER through this
  // file's own transport. That leaves the two-lane fallback, the call cap and
  // the fuse covered only by source assertions, and a source assertion cannot
  // tell you the request body is one the provider accepts. This drives
  // api/memory.js's own askForgetHook — one call — so the whole path is
  // exercised at least once per live run.
  {
    const rows = [
      { id: "41", name: "priya", text: "priya — his colleague, the one who moved to bangalore" },
      { id: "42", name: "driving", text: "he is learning to drive" },
    ];
    const t = Date.now();
    const r = await askForgetHook("woh ladki", rows);
    const ms = Date.now() - t;
    ok("SHIPPED askForgetHook answers over its own lanes", !r.failed, JSON.stringify(r));
    ok("SHIPPED askForgetHook returns only ids it was given",
      (r.ids ?? []).every((id) => id === "41" || id === "42"), JSON.stringify(r.ids));
    ok("SHIPPED askForgetHook resolves the Hinglish referent to the right row",
      String(r.ids) === "41", JSON.stringify(r.ids));
    ok("SHIPPED askForgetHook stays inside its own fuse", ms <= 11_000, `${ms}ms`);
    ok("SHIPPED askForgetHook fails closed on an empty candidate list",
      (await askForgetHook("woh ladki", [])).failed === true);
    console.log(`\nshipped askForgetHook: ${ms}ms, ids=${JSON.stringify(r.ids ?? null)}`);
  }

  const scored = [];
  const lat = [];
  let hookFailures = 0;
  for (const c of ALL) {
    const lex = lexical(c);
    const rows = c.rows.map((r) => ({ id: String(r.id), text: r.text }));
    // THE SHIPPED PROMPT, on the shipped candidate shape.
    const { text, ms } = await callLive(forgetHookPrompt(lex.name ?? c.marker, rows), cfg);
    lat.push(ms);
    const ids = parseForgetHook(text, rows.map((r) => r.id));
    if (!ids) hookFailures++;
    // UNION, exactly as opForget composes it
    const chosen = [...new Set([...lex.ids, ...(ids ?? [])])];
    scored.push(score(c, chosen, Boolean(ids)));
  }
  lat.sort((a, b) => a - b);
  live = report(`hook (${LANE}: ${MODEL || (LANE === "azure" ? AZ_MODEL : FREE_MODEL)})`, scored);
  live.hookFailures = hookFailures;
  live.p50 = lat[Math.floor(lat.length / 2)];
  live.p90 = lat[Math.floor(lat.length * 0.9)];
  live.max = lat[lat.length - 1];
  // THE NUMBER THE FUSE IS ACTUALLY SET AGAINST. api/memory.js's fuse is
  // 5,000 ms; a case slower than that does not fail, it falls to lane 2 and
  // then to the lexical matcher with a hedged receipt. That is the designed
  // behaviour, but the FRACTION is a product decision and it has to be a
  // number somebody can see rather than a shrug in a comment.
  live.overFuse = lat.filter((ms) => ms > 5_000).length;
}

// ── the report ─────────────────────────────────────────────────────────────
const pct = (x) => `${(x * 100).toFixed(1)}%`;
console.log("\nA1 — the mutation-time forget-matching hook, on the A4 battery");
console.log(`(${ALL.length} cases; adversarial headline excludes the two script cases,`);
console.log(` for the reason a4.mjs's header gives)\n`);
console.log("arm                                    adv recall   adv prec   controls   wrong rows   asks");
for (const r of [baseline, fallback, live].filter(Boolean)) {
  console.log(
    `${r.label.padEnd(38)}${pct(r.adversarialRecall).padStart(10)}` +
      `${pct(r.adversarialPrecision).padStart(11)}${pct(r.controlRecall).padStart(11)}` +
      `${String(r.precisionFalsePositives).padStart(13)}${String(r.zeroMatch).padStart(7)}`,
  );
}

if (live) {
  console.log(
    `\nlatency: p50 ${live.p50}ms, p90 ${live.p90}ms, max ${live.max}ms  |  ` +
      `over the 5s fuse: ${live.overFuse}/${ALL.length} (those hedge)  |  ` +
      `hook failures ${live.hookFailures}/${ALL.length}`,
  );
  console.log("\nper-case (baseline → hook):");
  for (const b of baseline.scored) {
    const h = live.scored.find((x) => x.id === b.id);
    const mark = (r) => (r.want && r.tp === r.want ? "hit " : r.tp ? "part" : "MISS");
    const moved = mark(b) !== mark(h) ? "  <<" : "";
    console.log(
      `  ${mark(b)} → ${mark(h)}  ${h.id.padEnd(28)} receipt=${h.receipt.padEnd(6)} fp=${h.fp}${moved}`,
    );
  }
  // THE BATTERY'S OWN RULE (a4.mjs's ratchet): A1 widens a match set, so the
  // one thing it is not allowed to do is take rows that should have survived.
  ok("A1 takes no new wrong rows in the precision set",
    live.precisionFalsePositives <= baseline.precisionFalsePositives,
    `${live.precisionFalsePositives} > ${baseline.precisionFalsePositives}`);
  ok("A1 does not regress adversarial recall",
    live.adversarialRecall >= baseline.adversarialRecall);
  ok("A1 does not regress the controls", live.controlRecall >= baseline.controlRecall);
  ok("A1 does not regress the model-resolved arm", live.resolvedRecall >= baseline.resolvedRecall);
  const out = join(HERE, `a1-run-${LANE}.json`);
  writeFileSync(out, JSON.stringify({
    at: new Date().toISOString(),
    lane: LANE,
    model: MODEL || (LANE === "azure" ? AZ_MODEL : FREE_MODEL),
    n: ALL.length,
    p50: live.p50, p90: live.p90, max: live.max,
    overFuse: live.overFuse, fuseMs: 5000,
    hookFailures: live.hookFailures,
    baseline: { adversarialRecall: baseline.adversarialRecall, precisionFalsePositives: baseline.precisionFalsePositives },
    hook: {
      adversarialRecall: live.adversarialRecall,
      adversarialPrecision: live.adversarialPrecision,
      controlRecall: live.controlRecall,
      resolvedRecall: live.resolvedRecall,
      precisionFalsePositives: live.precisionFalsePositives,
      zeroMatch: live.zeroMatch,
    },
    cases: live.scored.map((r) => ({ id: r.id, cat: r.cat, tp: r.tp, fp: r.fp, want: r.want, receipt: r.receipt })),
  }, null, 2) + "\n");
  console.log(`\nrecorded → ${out}`);
} else {
  console.log("\n(no live arm — pass --live --lane=azure|free. The default run spends nothing.)");
}

console.log(fail ? `\n${fail} of ${checks} FAILED` : `\nOK, ${checks} checks`);
process.exit(fail ? 1 : 0);
