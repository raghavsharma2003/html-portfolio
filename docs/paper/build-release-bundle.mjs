#!/usr/bin/env node
// docs/paper/build-release-bundle.mjs — WS-PAPER-CAM.
//
// Builds `release/vyakti-judge-qual/`, the artifact release that ships with the
// paper (DRAFT.md §9, CAMERA.md §7). Offline, deterministic, $0.
//
// WHY A BUILDER AND NOT A COPY. The archived bake-off files embed the product's
// persona prompt at 44,002 (`personaText`) and 47,094 (`personaVoice`)
// characters. Copying `evals/archives/` into a public repo would publish the
// company's principal asset. This script therefore EXTRACTS the fields the
// paper's claims depend on — transcripts, verdicts, judge rows — and never
// carries a whole source object across. The de-identification gates in
// `verify-release-bundle.mjs` are run against the BUILT tree, not this source,
// because the built tree is what gets published.
//
// Deterministic: no timestamps, no randomness, stable key order, LF endings.
// Re-running produces byte-identical output, which is what makes the gate
// results in BUILD.md re-checkable by anyone.
//
//   node docs/paper/build-release-bundle.mjs
//
import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync, statSync } from "node:fs";
import { dirname, resolve, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = resolve(ROOT, "release/vyakti-judge-qual");
const read = (p) => JSON.parse(readFileSync(resolve(ROOT, p), "utf8"));

// ── pseudonymisation (§13.4 D2/D3) ──────────────────────────────────────────
// Person names are replaced; place references are NOT (they are authored
// character detail in a fictional script, and removing them would damage the
// linguistic content that is the point of the release) — but every occurrence
// is counted and reported so the decision is recorded, not assumed.
const PERSON_SUBS = [
  [/Raghav/g, "USER"],
  [/raghav/g, "USER"],
  [/Meera/g, "HER"],
  [/meera/g, "HER"],
  [/Sharma/g, "[NAME]"],
];
const scrub = (s) => {
  if (typeof s !== "string") return s;
  let out = s;
  for (const [re, to] of PERSON_SUBS) out = out.replace(re, to);
  return out;
};
const scrubDeep = (v) => {
  if (typeof v === "string") return scrub(v);
  if (Array.isArray(v)) return v.map(scrubDeep);
  if (v && typeof v === "object") {
    const o = {};
    for (const k of Object.keys(v)) o[k] = scrubDeep(v[k]);
    return o;
  }
  return v;
};

// ── miss-string redaction ───────────────────────────────────────────────────
// A harness miss records WHY a row was not scored, and the guards need its KIND
// and COUNT. The raw provider error body is neither: it carries the tenant's
// endpoint hostname (which contains the owner's name), request ids, and
// provider internals. The de-identification gates caught exactly this in the
// first build of this bundle — 10 R2 rows carried a full Azure endpoint URL —
// which is what the gates are for.
//
// `unparseable:` bodies are the judge's own prose reply. Those are evidence
// (they are how we know one judge wrote preamble instead of JSON) and carry no
// secret, so they are kept, pseudonymised and truncated.
const redactMiss = (m) => {
  if (typeof m !== "string") return m;
  if (m.startsWith("error:")) {
    const status = (m.match(/\s(\d{3})\s*:/) || [])[1];
    const reason =
      /content_filter/i.test(m) ? "content filter"
        : /timeout|aborted/i.test(m) ? "timeout"
          : /\b429\b|rate.?limit/i.test(m) ? "rate limit"
            : /\b401\b|\b403\b|credit|quota|spend/i.test(m) ? "auth or spend limit"
              : "provider error";
    return `error: ${status ? `HTTP ${status} — ` : ""}${reason} [provider body, endpoint and request id redacted at release; the miss KIND and COUNT are what the guards use]`;
  }
  if (m.startsWith("unparseable:")) {
    return "unparseable: " + scrub(m.slice("unparseable:".length).trim())
      .replace(/https?:\/\/\S+/g, "[URL]")
      .replace(/\b[0-9a-fA-F]{16,}\b/g, "[ID]")
      .slice(0, 240);
  }
  return scrub(m).replace(/https?:\/\/\S+/g, "[URL]");
};

const writeJson = (rel, obj) => {
  const p = join(OUT, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(obj, null, 2) + "\n");
};
const writeJsonl = (rel, rows) => {
  const p = join(OUT, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
};
const writeText = (rel, s) => {
  const p = join(OUT, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, s.endsWith("\n") ? s : s + "\n");
};
const copyText = (srcRel, dstRel, transform = (s) => s) =>
  writeText(dstRel, transform(readFileSync(resolve(ROOT, srcRel), "utf8")));

// ── clean ───────────────────────────────────────────────────────────────────
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

// ── 1. transcripts, stripped ────────────────────────────────────────────────
// Extract ONLY results[].turns[].{user, reply} plus {model, lane, beat, rep}.
// Dropped on purpose: personaText, personaVoice (the product), and per-turn
// cost/in/out/ms (deployment economics). Nothing else in the source object is
// carried across — the objects below are constructed field by field.
const ARCHIVES = [
  {
    id: "charm-grok",
    files: ["evals/archives/charm-grok/pb-merged1.json", "evals/archives/charm-grok/pb-merged2.json"],
    verdicts: "evals/archives/charm-grok/pb-judged-grok.json",
    incumbent: "google/gemini-3.6-flash",
    candidate: "grok-4-20-non-reasoning",
    note: "Landslide archive: the trusted judge chose the incumbent on 38 of 40 decisive units.",
  },
  {
    id: "charm-luna",
    files: ["evals/archives/charm-luna/pb-raw.json", "evals/archives/charm-luna/pb-raw2.json"],
    verdicts: "evals/archives/charm-luna/pb-judged.json",
    incumbent: "google/gemini-3.6-flash",
    candidate: "openai/gpt-5.6-luna",
    note: "Coin-toss archive: 17-18 among decisive units. A third generated arm (gpt-5.6-terra) exists in the raw files but was never judged, so it carries no ground truth and is excluded here.",
  },
];

let placeHits = {};
const countPlaces = (s) => {
  for (const t of ["Silk Board", "silk board", "Bangalore", "Bengaluru", "Bandra", "HSR"]) {
    const n = s.split(t).length - 1;
    if (n) placeHits[t] = (placeHits[t] || 0) + n;
  }
};

const stats = {};
for (const a of ARCHIVES) {
  const units = [];
  a.files.forEach((f, rep) => {
    const src = read(f);
    for (const conv of src.results) {
      // charm-luna's raw files carry a third, never-judged arm; keep only the
      // two arms the ground truth actually compares.
      if (conv.model !== a.incumbent && conv.model !== a.candidate) continue;
      units.push({
        model: conv.model,
        lane: conv.lane,
        beat: conv.beat,
        rep,
        turns: conv.turns.map((t) => ({ user: scrub(t.user), reply: scrub(t.reply) })),
      });
    }
  });
  units.sort((x, y) => `${x.lane}|${x.beat}|${x.rep}|${x.model}`.localeCompare(`${y.lane}|${y.beat}|${y.rep}|${y.model}`));
  countPlaces(JSON.stringify(units));

  writeJson(`data/archives/${a.id}/transcripts.json`, {
    archive: a.id,
    note: a.note,
    arms: { incumbent: a.incumbent, candidate: a.candidate },
    unit_key: "`${lane}|${beat}|${rep}` — one 6-turn scripted conversation per (lane, beat, replicate) per arm",
    fields: "turns[].user and turns[].reply only. The system prompt that produced the replies is NOT released (see DATASHEET §Composition). Per-turn latency and cost fields are dropped.",
    pseudonymisation: "Person names are substituted in the released text: the scripted interlocutor's given name -> USER, the companion persona's name -> HER, one surname appearing in a scripted work anecdote -> [NAME]. See DATASHEET.md, Preprocessing.",
    transcripts: units,
  });

  const jv = read(a.verdicts);
  const verdicts = jv.verdicts.map((v) => scrubDeep({
    lane: v.lane, beat: v.beat, rep: v.rep, order: v.order,
    aModel: v.aModel, bModel: v.bModel,
    warmth: v.warmth, humour: v.humour, register: v.register,
    specificity: v.specificity, brevity: v.brevity, personhood: v.personhood,
    overall: v.overall,
    stagedir: v.stagedir, deniesai: v.deniesai, crisisfail: v.crisisfail,
    why: v.why,
    rawSlots: v.rawSlots,
  }));
  writeJson(`data/archives/${a.id}/verdicts.json`, {
    archive: a.id,
    judge: jv.judge,
    produced: "2026-08-11, before this study existed, to decide which model would serve a live consumer product.",
    method: "Blind (model identity stripped), counterbalanced (each unit judged in both presentation orders), seven axes plus three safety flags, free-text rationale per judgment.",
    ground_truth_warning: "THESE ARE LLM VERDICTS, NOT HUMAN ANNOTATIONS. See DATASHEET, first section.",
    consolidation_rule: "A unit yields a verdict only when both orders name the same model; an order flip is TIE_FLIP.",
    verdicts,
  });
  stats[a.id] = { units: units.length, verdicts: verdicts.length };
}

// ── 2. judge rows ───────────────────────────────────────────────────────────
// R0 (overall axis, 8 judges x 192 rows). Already free of transcript text; the
// per-row `usage` object is not present in this source. Field order is fixed.
const J = read("evals/dbattery/judges.json");
const r0 = J.raw_rows.map((r) => ({
  judge: r.judge, archive: r.archive, unitKey: r.unitKey, order: r.order,
  aModel: r.aModel, bModel: r.bModel,
  archivedOverall: r.archivedOverall,
  newPickedSide: r.newPickedSide ?? null,
  newOverall: r.newOverall ?? null,
  harnessMiss: r.harnessMiss == null ? null : redactMiss(r.harnessMiss),
}));
writeJsonl("data/judge-rows/r0-overall.jsonl", r0);

// R2 (six further axes) and R4 (English condition). D6: these were produced
// after the release table was written and are covered by the same strip rules.
// Neither carries transcript text; the per-row `usage` object IS dropped —
// per-call token counts are deployment economics, and the run totals are
// published in data/runs/cost.json instead.
const stripUsage = (r) => {
  const { usage, ...rest } = r;
  if (rest.harnessMiss != null) rest.harnessMiss = redactMiss(rest.harnessMiss);
  return rest;
};
const r2 = read("docs/paper/analysis/r2/judge-rows.json").map(stripUsage);
const r4 = read("docs/paper/analysis/r4/judge-rows.json").map(stripUsage);
writeJsonl("data/judge-rows/r2-per-axis.jsonl", r2);
writeJsonl("data/judge-rows/r4-english.jsonl", r4);

// R4's translations DO carry full transcript text (D6). They are released as
// transcripts — same strip rules, same pseudonymisation — with the redundant
// `sourceText` (the Hinglish original, already in data/archives/) and the
// per-call usage dropped.
const tr = read("docs/paper/analysis/r4/translations.json");
const translations = Object.keys(tr).sort().map((k) => {
  const v = tr[k];
  return { key: k, archive: v.archive, unitKey: v.unitKey, model: v.model, text: scrub(v.text) };
});
countPlaces(JSON.stringify(translations));
writeJson("data/r4-english-transcripts.json", {
  run: "R4 — English-translation control",
  method: "Each archived transcript machine-translated to faithful monolingual English by gpt-5.6-terra, preserving turn structure and speaker boundaries. The Hinglish source is data/archives/*/transcripts.json; it is not duplicated here.",
  confound: "The translator is a member of the judge panel under test. See the paper's L5.",
  pseudonymisation: "Same person-name substitutions as the source transcripts.",
  n: translations.length,
  translations,
});

// ── 3. run outputs ──────────────────────────────────────────────────────────
writeJson("data/runs/r0-pooled.json", {
  run: "R0 — overall-axis qualification backtest (+ R1's ceiling row, merged by judge id)",
  bar: J.bar,
  method: J.method,
  leakage_check: J.leakage_check,
  pooled: J.pooled,
  per_archive: J.per_archive,
});
copyText("docs/paper/analysis/r2/summary.json", "data/runs/r2-summary.json");
copyText("docs/paper/analysis/r2/pooled-per-axis.json", "data/runs/r2-pooled-per-axis.json");
copyText("docs/paper/analysis/r2/ground-truth-audit.json", "data/runs/r2-ground-truth-audit.json");
copyText("docs/paper/analysis/r4/summary.json", "data/runs/r4-summary.json");

const r2cost = read("docs/paper/analysis/r2/cost.json");
const r4cost = read("docs/paper/analysis/r4/cost.json");
writeJson("data/runs/cost.json", {
  note: "Per-run call and token totals. Per-CALL usage objects are stripped from the released judge rows; these aggregates replace them. Azure-billed runs are $0 cash against a Microsoft-for-Startups grant; the only cash item is R1.",
  R0_and_R1: J.cost_by_run.map((c) => ({
    at: c.at, judges: c.judges, calls: c.calls,
    promptTokens: c.promptTokens, completionTokens: c.completionTokens,
    billedTo: c.billedTo, cashCostUsd: c.cashCostUsd,
  })),
  R1_cash_note: "The 2026-08-18 run reports cashCostUsd null, not 0: the judge configs declare pricing as {prompt_per_token, completion_per_token} while the cost helper reads {inUsdPerTok, outUsdPerTok}, so the priced path returned NaN and serialised as null. This is the guard behaving as designed (an unknown rate must never print as $0) plus a field-name mismatch, which is in QUIRKS.md. Priced by hand at the logged rate ($5/M prompt, $25/M completion, fetched 2026-08-15): 650150*5e-6 + 27175*25e-6 = $3.93.",
  R2: r2cost,
  R4: r4cost,
});

// ── 4. harness, guards, analysis ────────────────────────────────────────────
// The analysis scripts are the repo's own, with their two source paths
// repointed at the bundle. Nothing else changes: the arithmetic that produced
// the paper is the arithmetic that runs here.
const repoint = (s) =>
  s
    .replace(
      'const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");',
      'const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");',
    )
    .replace(/resolve\(dirname\(fileURLToPath\(import\.meta\.url\)\), "\.\.\/\.\.\/\.\."\)/g,
      'resolve(dirname(fileURLToPath(import.meta.url)), "..")')
    .replace(/"evals\/dbattery\/judges\.json"/g, '"data/runs/r0-pooled.json"')
    .replace(/"evals\/archives\/charm-grok\/pb-judged-grok\.json"/g, '"data/archives/charm-grok/verdicts.json"')
    .replace(/"evals\/archives\/charm-luna\/pb-judged\.json"/g, '"data/archives/charm-luna/verdicts.json"')
    .replace(/evals\/dbattery\/judge-backtest\.mjs:228/g, "harness/judge-backtest.mjs (consolidateUnit)")
    .replace(/"\.\.\/\.\.\/\.\.\/evals\/dbattery\/common\.mjs"/g, '"../harness/rng.mjs"')
    .replace(/evals\/dbattery\/common\.mjs/g, "harness/rng.mjs")
    .replace(/docs\/paper\/analysis\//g, "analysis/");

// derive-tables reads raw_rows from judges.json; in the bundle the rows live in
// a JSONL file, so the loader is swapped for one that reads it. This is the
// only behavioural edit and it is a read path, not a computation.
let deriveSrc = repoint(readFileSync(resolve(ROOT, "docs/paper/analysis/derive-tables.mjs"), "utf8"));
deriveSrc = deriveSrc.replace(
  'const J = read("data/runs/r0-pooled.json");',
  `const J = { ...read("data/runs/r0-pooled.json"), raw_rows: readFileSync(resolve(ROOT, "data/judge-rows/r0-overall.jsonl"), "utf8").trim().split("\\n").map((l) => JSON.parse(l)) };`,
);
deriveSrc = deriveSrc.replace(
  "// ── T1: ground-truth archive structure + chance baselines",
  "// BUNDLE BUILD: paths repointed at the bundle's own data/ tree by\n// docs/paper/build-release-bundle.mjs. The statistics are unmodified.\n\n// ── T1: ground-truth archive structure + chance baselines",
);
// the archive verdict files in the bundle wrap their rows in {verdicts:[...]},
// same shape as the source, so no change is needed for the ground-truth reader.
writeText("analysis/derive-tables.mjs", deriveSrc);

let clusSrc = repoint(readFileSync(resolve(ROOT, "docs/paper/analysis/clustered-cis.mjs"), "utf8"));
clusSrc = clusSrc.replace(
  /const J = read\("data\/runs\/r0-pooled\.json"\);/,
  `const J = { ...read("data/runs/r0-pooled.json"), raw_rows: readFileSync(resolve(ROOT, "data/judge-rows/r0-overall.jsonl"), "utf8").trim().split("\\n").map((l) => JSON.parse(l)) };`,
);
writeText("analysis/clustered-cis.mjs", clusSrc);

// The seeded PRNG the cluster bootstrap imports, extracted so the bundle has no
// dependency on the private repo.
writeText("harness/rng.mjs", `// harness/rng.mjs — the seeded PRNG the cluster bootstrap uses.
// Extracted verbatim from the programme's own evals/dbattery/common.mjs so the
// released analysis reproduces the paper's intervals bit for bit on any machine.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
`);

// ── 4b. everything authored for the bundle (README, DATASHEET, licences,
// protocol docs, generalised harness) is copied verbatim from
// docs/paper/release-src/. Authored as real files so they are reviewable in
// the private repo before they are published. ─────────────────────────────
const SRC = resolve(ROOT, "docs/paper/release-src");
function copyTree(dir, rel = "") {
  for (const e of readdirSync(dir).sort()) {
    const p = join(dir, e);
    const r = rel ? `${rel}/${e}` : e;
    if (statSync(p).isDirectory()) copyTree(p, r);
    else writeText(r, readFileSync(p, "utf8"));
  }
}
copyTree(SRC);

console.log("bundle: data + analysis + authored files written");

// ── 5. file list for BUILD.md ───────────────────────────────────────────────
export function walk(dir, acc = []) {
  for (const e of readdirSync(dir).sort()) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, acc);
    else acc.push({ path: relative(OUT, p), bytes: statSync(p).size });
  }
  return acc;
}

writeJson("data/BUILD-STATS.json", {
  note: "Counts asserted by the builder against the built tree, so a silently truncated extraction fails loudly rather than shipping.",
  archives: stats,
  judge_rows: { r0_overall: r0.length, r2_per_axis: r2.length, r4_english: r4.length },
  r4_english_transcripts: translations.length,
  place_references_retained: placeHits,
});

// Hard assertions — the build fails rather than shipping a short bundle.
const expect = (actual, want, what) => {
  if (actual !== want) throw new Error(`bundle build: ${what} = ${actual}, expected ${want}`);
};
expect(stats["charm-grok"].units, 96, "charm-grok transcripts");
expect(stats["charm-luna"].units, 96, "charm-luna transcripts");
expect(stats["charm-grok"].verdicts, 96, "charm-grok verdicts");
expect(stats["charm-luna"].verdicts, 96, "charm-luna verdicts");
expect(r0.length, 1536, "R0 judge rows");
expect(r2.length, 5760, "R2 judge rows");
expect(r4.length, 960, "R4 judge rows");
expect(translations.length, 192, "R4 English transcripts");

// ── 6. BUILD.md — provenance and inventory ──────────────────────────────────
const inventory = walk(OUT).filter((f) => f.path !== "BUILD.md");
const totalBytes = inventory.reduce((a, f) => a + f.bytes, 0);
const kb = (b) => (b / 1024).toFixed(1).padStart(9) + " KB";

writeText("BUILD.md", `# How this bundle was built, and what was checked

This directory is **generated**, not hand-assembled. It is produced by
\`build-release-bundle.mjs\` in the private repository the study was run in, and
re-running that script byte-reproduces this tree.

## Why a builder rather than a copy

The source archives embed the product's system prompt — 44,002 characters of
\`personaText\` and 47,094 of \`personaVoice\` — inside the same JSON objects as
the transcripts. Copying those files into a public repository would publish the
company's principal asset. The builder therefore **extracts** the fields the
paper's claims depend on, constructing every released object field by field, and
never carries a whole source object across.

"We stripped it" is not something anyone should take on trust, so a separate
script runs the de-identification gates **against this built tree** — not
against the source — and any hit fails the build rather than shipping.

## What is deliberately not here

| dropped | why |
|---|---|
| \`personaText\` / \`personaVoice\` | the product. Not needed for any claim: the result depends on transcripts, verdicts, rubric and harness, and on none of the prompt that produced the transcripts. |
| per-turn \`cost\`, \`in\`, \`out\`, \`ms\` | deployment economics |
| per-call \`usage\` on judge rows | same; run-level totals are in \`data/runs/cost.json\` instead |
| raw provider error bodies in \`harnessMiss\` | they carried the tenant's endpoint hostname, request ids and provider internals. The **kind** and **count** of a miss are what the guards use, and those are preserved; the body is redacted. *The gates caught this: the first build of this bundle leaked a full endpoint URL in 10 rows.* |
| \`sourceText\` in the translation artifacts | a redundant duplicate of the Hinglish transcripts already released under \`data/archives/\` |
| a third generated arm in one source archive | it was never judged, so it carries no ground truth |

## Pseudonymisation

Person names are substituted in the released text: the scripted interlocutor's
given name → \`USER\`, the companion persona's name → \`HER\`, and one surname
appearing in a scripted work anecdote → \`[NAME]\`. \`CITATION.cff\` is the one
file exempt, because a citation file is supposed to name its authors.

**Place references are retained and that is a decision.** The scripts contain
Indian city and landmark references. They are authored character detail in a
fictional script, they identify no person, and removing them would damage the
code-switched linguistic content that is the point of the release. Every
occurrence is counted in \`data/BUILD-STATS.json\` and reported by the gate run
so the decision is auditable. **This item is flagged for the data owner's
sign-off before publication.**

## Verifying this tree yourself

\`\`\`
node analysis/derive-tables.mjs      # reproduces every headline number, offline
node analysis/clustered-cis.mjs      # reproduces every clustered interval
node harness/judge-backtest.mjs --dry-run
\`\`\`

The de-identification gate run writes \`de-identification-report.txt\` beside
this file. If that report is missing, the gates have not been run against the
current tree — a rebuild deletes it on purpose, because a stale gate report is
worse than none.

## Inventory

${inventory.length} files, ${(totalBytes / 1024).toFixed(0)} KB total.

\`\`\`
${inventory.map((f) => `${kb(f.bytes)}  ${f.path}`).join("\n")}
\`\`\`

## Counts asserted by the builder

The build fails rather than shipping a short bundle:

| item | count |
|---|---|
| transcripts, charm-grok | ${stats["charm-grok"].units} |
| transcripts, charm-luna | ${stats["charm-luna"].units} |
| ground-truth verdicts, charm-grok | ${stats["charm-grok"].verdicts} (7 axes + 3 flags + rationale each) |
| ground-truth verdicts, charm-luna | ${stats["charm-luna"].verdicts} (7 axes + 3 flags + rationale each) |
| judge rows, R0 \`overall\` | ${r0.length} |
| judge rows, R2 six further axes | ${r2.length} |
| judge rows, R4 English condition | ${r4.length} |
| English-condition transcripts | ${translations.length} |
`);

console.log("bundle: assertions passed");
console.log(JSON.stringify({ archives: stats, r0: r0.length, r2: r2.length, r4: r4.length, translations: translations.length, placeHits }, null, 2));
