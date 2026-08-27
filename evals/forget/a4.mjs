// ── A4 — THE HINGLISH FORGET BATTERY (docs/research/MEMORY-FIELD-SURVEY.md) ─
//
// The survey adopts A1 (a mutation-time matching hook: an LLM widens a forget
// term into its variants before the delete runs) and orders A4 BEFORE it, for
// a stated reason: "build the measurement surface first, so A1's gain is a
// measured delta and not a vendor-shaped claim". The paper's own numbers are
// one author, one 385-case surface, and a cross-lingual category that is not
// Hinglish. This file is the surface, and the numbers it prints are ours.
//
// ── WHY THIS IS NOT A GATE ─────────────────────────────────────────────────
// It measures the CURRENT lexical matcher against cases the current lexical
// matcher is known not to handle. A gate that fails on a known-unfixed thing
// is noise, and noise is how a suite stops being read. So the assertions here
// are:
//   * the battery still runs and every case is well-formed;
//   * the controls still pass (if they do not, the harness is broken);
//   * the measured recall has not gone DOWN against the recorded baseline.
// It is a REPORT with a ratchet, and the ratchet only turns one way.
//
// ── WHAT IS MEASURED, EXACTLY ──────────────────────────────────────────────
// The deterministic half of the pipeline, end to end:
//   marker → resolveForget()  (REAL, src/engine/memory.ts)
//          → scope "item" + name
//          → the row predicate api/memory.js opForget builds from that name
// The predicate is `\m<escaped name>\M` applied case-insensitively to
// meera_nodes.name/.summary and meera_log.content. It is EMULATED here in JS
// (`pgWordMatch`) because running the real one needs a database, and this
// suite runs in CI with none.
//
// THE EMULATION'S ONE UNVERIFIED EDGE, said plainly rather than glossed:
// Postgres's \m/\M use its own word-character class, which is locale- and
// build-dependent for non-ASCII; the JS emulation uses \p{L}\p{N}_ lookarounds.
// For the two Devanagari cases the two may not agree, and nothing here can
// settle that without a live database. Both cases are reported separately and
// excluded from the headline number for that reason.
import { execSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { CASES, RESOLVED_CASES } from "./cases.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const tmp = mkdtempSync(join(tmpdir(), "a4-"));
const BUNDLE = join(tmp, "a4.bundle.mjs");
execSync(
  `npx esbuild ${join(HERE, ".entry.ts")} --bundle --format=esm --platform=node ` +
    `--outfile=${BUNDLE} --log-level=error --alias:@capacitor/core=${join(ROOT, "evals/stubs/capacitor.mjs")}`,
  { stdio: "inherit", cwd: ROOT },
);
const { resolveForget } = await import(pathToFileURL(BUNDLE).href);

let fail = 0;
let checks = 0;
const ok = (name, cond, extra = "") => {
  checks++;
  if (!cond) {
    fail++;
    console.log(`FAIL ${name}${extra ? " — " + extra : ""}`);
  }
};

// ── the matcher, emulated ──────────────────────────────────────────────────
// Read out of api/memory.js rather than restated from memory, so a change to
// the real predicate shows up here as a mismatch instead of as silence.
const MEM = readFileSync(join(ROOT, "api/memory.js"), "utf8");
ok("opForget still builds a word-bounded regex from the name",
  /const rx = `\\\\m\$\{reEsc\(name\)\}\\\\M`/.test(MEM),
  "the emulated matcher below may no longer match the real one");
ok("opForget still lower-cases and caps the name at 60 chars",
  /String\(body\.name \|\| ""\)\.trim\(\)\.toLowerCase\(\)\.slice\(0, 60\)/.test(MEM));
ok("opForget still refuses a term under 3 characters",
  /if \(name\.length < 3\) return \{ error: "nothing named" \}/.test(MEM));

const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Postgres `x ~* '\mterm\M'`, emulated. See the header's unverified edge. */
function pgWordMatch(term, text) {
  const re = new RegExp(`(?<![\\p{L}\\p{N}_])${reEsc(term)}(?![\\p{L}\\p{N}_])`, "iu");
  return re.test(text);
}

// ── run one case ───────────────────────────────────────────────────────────
function run(c) {
  const target = resolveForget(c.marker, []);
  const scope = target?.scope ?? "none";
  // only an item scope reaches the row predicate; anything else deletes by
  // window and is not what this battery is about
  const name = scope === "item" ? target.name : null;
  const deleted = name ? c.rows.filter((r) => pgWordMatch(name, r.text)) : [];
  const wanted = c.rows.filter((r) => r.hit);
  const hitIds = new Set(deleted.map((r) => r.id));
  const tp = wanted.filter((r) => hitIds.has(r.id)).length;
  const fp = deleted.length - tp;
  return {
    ...c, scope, name, tp, fp,
    want: wanted.length,
    recall: wanted.length ? tp / wanted.length : 1,
    precision: deleted.length ? tp / deleted.length : 1,
  };
}

const ALL = [...CASES, ...RESOLVED_CASES].map(run);
for (const r of ALL) {
  ok(`case ${r.id} is well-formed`, r.rows.length > 0 && r.want > 0 && r.marker.length > 0);
}

// ── the report ─────────────────────────────────────────────────────────────
const byCat = new Map();
for (const r of ALL) {
  const g = byCat.get(r.cat) ?? { cat: r.cat, n: 0, tp: 0, fp: 0, want: 0, zero: 0 };
  g.n++; g.tp += r.tp; g.fp += r.fp; g.want += r.want;
  if (r.tp === 0) g.zero++;
  byCat.set(r.cat, g);
}

console.log("\nA4 — Hinglish forget battery vs the CURRENT lexical matcher");
console.log("(baseline for the survey's A1 mutation-time matcher, NOT built this wave)\n");
console.log("category              n   recall   precision   cases taking nothing");
for (const g of byCat.values()) {
  const rec = g.want ? g.tp / g.want : 1;
  const prec = g.tp + g.fp ? g.tp / (g.tp + g.fp) : 1;
  console.log(
    `${g.cat.padEnd(20)}${String(g.n).padStart(2)}   ${(rec * 100).toFixed(0).padStart(5)}%   ` +
      `${(prec * 100).toFixed(0).padStart(8)}%   ${String(g.zero).padStart(10)}/${g.n}`,
  );
}

// The headline: the adversarial cases only — controls and the model-resolved
// arm are separate questions, and the Devanagari pair is unverifiable offline.
const ADVERSARIAL = new Set(["referent-hi", "referent-en", "temporal-ref", "translit", "morphology", "phrase-order"]);
const adv = ALL.filter((r) => ADVERSARIAL.has(r.cat));
const advRecall = adv.reduce((a, r) => a + r.tp, 0) / adv.reduce((a, r) => a + r.want, 0);
const controls = ALL.filter((r) => r.cat === "control");
const controlRecall = controls.reduce((a, r) => a + r.tp, 0) / controls.reduce((a, r) => a + r.want, 0);
const resolved = ALL.filter((r) => r.cat === "resolved-by-model");
const resolvedRecall = resolved.reduce((a, r) => a + r.tp, 0) / resolved.reduce((a, r) => a + r.want, 0);
const precisionCases = ALL.filter((r) => r.cat === "precision");
const precisionFp = precisionCases.reduce((a, r) => a + r.fp, 0);

console.log(`\nHEADLINE (${adv.length} adversarial cases, ${adv.reduce((a, r) => a + r.want, 0)} target rows)`);
console.log(`  recall                     ${(advRecall * 100).toFixed(1)}%`);
console.log(`  controls (sanity)          ${(controlRecall * 100).toFixed(1)}%`);
console.log(`  if the MODEL resolves it   ${(resolvedRecall * 100).toFixed(1)}%`);
console.log(`  wrong rows taken           ${precisionFp} in the precision set`);
console.log("\nper-case:");
for (const r of ALL) {
  console.log(
    `  ${r.tp === r.want ? "hit " : r.tp ? "part" : "MISS"} ${r.id.padEnd(28)} ` +
      `scope=${String(r.scope).padEnd(7)} term=${JSON.stringify(r.name ?? "")}`,
  );
}
for (const r of ALL) if (r.note) console.log(`  note ${r.id}: ${r.note}`);
const deva = ALL.filter((r) => r.id.startsWith("script-"));
console.log(`\nscript cases (EXCLUDED from the headline — the emulated word boundary`);
console.log(`may not match Postgres's on Devanagari without a live database):`);
for (const r of deva) console.log(`  ${r.tp === r.want ? "hit " : "MISS"} ${r.id}`);

// ── THE RATCHET ────────────────────────────────────────────────────────────
// Pre-registered 2026-08-23 against the tree of that date. These are the
// numbers A1 has to beat; the assertion is only that they do not get WORSE,
// and `precisionFalsePositives: 2` is a MEASUREMENT, not a target: both come
// from the common-noun case, where "office" legitimately word-matches three
// rows. A1 widens a term, so this is the number it must not raise.
// so this file stays green until someone makes it green for a better reason.
const BASELINE = { adversarial: 0, controls: 1, resolvedByModel: 1, precisionFalsePositives: 2 };
ok("controls still pass — otherwise the harness is broken, not the matcher",
  controlRecall >= BASELINE.controls, `${controlRecall}`);
ok("adversarial recall has not regressed below the pre-registered baseline",
  advRecall >= BASELINE.adversarial, `${advRecall} < ${BASELINE.adversarial}`);
ok("the model-resolved arm has not regressed",
  resolvedRecall >= BASELINE.resolvedByModel, `${resolvedRecall}`);
ok("no new wrong rows are taken",
  precisionFp <= BASELINE.precisionFalsePositives, `${precisionFp}`);

console.log(
  fail
    ? `\n${fail} of ${checks} FAILED`
    : `\nREPORT OK, ${checks} checks (non-gating: ${(advRecall * 100).toFixed(1)}% adversarial recall is the EXPECTED-FAIL baseline, not a pass)`,
);
process.exit(fail ? 1 : 0);
