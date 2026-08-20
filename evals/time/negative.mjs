// evals/time/negative.mjs — THE NEGATIVE CONTROL. WS-TIME.
//
// A gate suite that has never been shown to fail is not evidence. This file
// takes src/engine/timeline.ts, injects one real defect at a time, and asserts
// that the SAME predicates evals/time/{her,his,g1}.mjs run do actually report
// it. If a mutation passes, the corresponding gate is decoration and this file
// fails the build instead.
//
// Each mutation is a bug this workstream could plausibly ship, not a strawman:
// the variant seed drifting to per-minute IS the reported two-minute bug, and
// the gap field appearing on HisFrame IS how G1 would be crossed.
//
// The mutant never touches the tree: its import specifiers are rewritten to
// absolute paths and it is bundled from a temp directory, so nothing is
// written into src/ and a failed run leaves no residue.
//
//   node evals/time/negative.mjs
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ROOT,
  SRC,
  checkAudit,
  checkTwoMinute,
  checkContinuity,
  checkDeterminism,
  checkSourceG1,
  checkGapUnrenderable,
  checkRenderShape,
} from "./_checks.mjs";

const ORIGINAL = readFileSync(SRC, "utf8");

let failed = 0;
let passed = 0;
const ok = (name, cond, detail = "") => {
  if (cond) {
    passed++;
    console.log(`  ok  ${name}`);
  } else {
    failed++;
    console.log(`FAIL  ${name}  ${detail}`);
  }
};
const section = (s) => console.log(`\n── ${s} ──`);

/** Apply [find, replace] pairs; every one MUST match, or the mutation itself
 *  has rotted and would silently become a no-op that "passes". */
function mutate(edits) {
  let src = ORIGINAL;
  for (const [find, repl] of edits) {
    if (!src.includes(find)) throw new Error(`mutation anchor missing: ${find.slice(0, 60)}`);
    src = src.split(find).join(repl);
  }
  return src;
}

let seq = 0;
function bundleSource(src) {
  const dir = mkdtempSync(join(tmpdir(), `wstime-neg-${seq++}-`));
  const file = join(dir, "mutant.ts");
  writeFileSync(
    file,
    src
      .replace(/from "\.\/shapelint"/g, `from "${join(ROOT, "src/engine/shapelint")}"`)
      .replace(/from "\.\/relstate"/g, `from "${join(ROOT, "src/engine/relstate")}"`),
  );
  const out = join(dir, "mutant.bundle.mjs");
  execFileSync(
    "npx",
    ["esbuild", file, "--bundle", "--format=esm", "--platform=node", `--outfile=${out}`, "--log-level=error"],
    { stdio: "inherit", cwd: ROOT },
  );
  return out;
}

/** A mutation is CAUGHT when at least one named check reports a problem. */
async function expectCaught(name, edits, checks, { sourceOnly = false } = {}) {
  const src = mutate(edits);
  const found = [];
  for (const [label, fn] of checks) {
    let r;
    if (sourceOnly) r = fn(src);
    else {
      const M = await import(bundleSource(src));
      r = fn(M);
    }
    if (r.problems.length) found.push(`${label}: ${r.problems[0]}`);
  }
  ok(`CAUGHT — ${name}`, found.length > 0, "no check reported it");
  if (found.length) console.log(`      ${found[0].slice(0, 150)}`);
}

section("control: the unmutated module passes every predicate");
{
  const M = await import(bundleSource(ORIGINAL));
  for (const [label, r] of [
    ["audit", checkAudit(M)],
    ["two-minute", checkTwoMinute(M)],
    ["determinism", checkDeterminism(M)],
    ["gap-unrenderable", checkGapUnrenderable(M)],
    ["render-shape", checkRenderShape(M)],
  ]) {
    ok(`baseline ${label} clean`, r.problems.length === 0, r.problems.join(" | "));
  }
  ok("baseline source-G1 clean", checkSourceG1(ORIGINAL).problems.length === 0);
}

section("mutation 1 — a mood word in an authored day note (G8)");
await expectCaught(
  "G8 mood leak",
  [['"just up, first chai, nothing started yet"', '"just up, tired and irritated already"']],
  [["audit", checkAudit]],
);

section("mutation 2 — the variant seed drifts to per-minute (THE reported bug)");
await expectCaught(
  "two-minute contradiction",
  [["pickNote(slot.def, t.dateKey)", 'pickNote(slot.def, t.dateKey + ":" + t.minuteOfDay)']],
  [
    ["two-minute", checkTwoMinute],
    ["continuity", checkContinuity],
  ],
);

section("mutation 3 — a day note written as a sentence she could recite");
await expectCaught(
  "recited-prompt shape",
  [
    [
      '"past midnight, in bed, phone still on"',
      '"I am sitting up past midnight in bed with my phone still on because the day got away from me."',
    ],
  ],
  [
    ["audit", checkAudit],
    ["render-shape", checkRenderShape],
  ],
);

section("mutation 4 — the gap becomes a field on HisFrame and gets rendered (G1)");
await expectCaught(
  "gap reaches the prompt",
  [
    ["export interface HisFrame {", "export interface HisFrame {\n  gapMs: number;"],
    ["  const empty: HisFrame = { moved: [], ahead: [], maybePassed: [] };", "  const empty: HisFrame = { gapMs: 0, moved: [], ahead: [], maybePassed: [] };"],
    ["  return {\n    moved: moved.slice(0, MAX_MOVED),", "  return {\n    gapMs: now - lastSpokeAt,\n    moved: moved.slice(0, MAX_MOVED),"],
    ["  const lines: string[] = [];\n  for (const n of frame.moved)", "  const lines: string[] = [`gap: ${frame.gapMs} ms`];\n  for (const n of frame.moved)"],
  ],
  [["gap-unrenderable", checkGapUnrenderable]],
);

section("mutation 5 — a write appears in the module (G1)");
await expectCaught(
  "persistence",
  [["export function herNow(", 'export function __persist(v: string) {\n  localStorage.setItem("meera.timeline", v);\n}\n\nexport function herNow(']],
  [["source-G1", checkSourceG1]],
  { sourceOnly: true },
);

section("mutation 6 — module-level mutable state (G1: accumulation)");
await expectCaught(
  "accumulating counter",
  [["export const IST_OFFSET_MIN = 330;", "export const IST_OFFSET_MIN = 330;\nlet gapsSeen = 0;"]],
  [["source-G1", checkSourceG1]],
  { sourceOnly: true },
);

section("mutation 7 — her clock is handed the gap (G1: the signature line)");
await expectCaught(
  "herNow reads a usage metric",
  [
    [
      "export function herNow(now: number, beats: readonly DatedBeat[] = []): HerFrame {",
      "export function herNow(now: number, beats: readonly DatedBeat[] = [], gapSinceLastMs = 0): HerFrame {",
    ],
  ],
  [["source-G1", checkSourceG1]],
  { sourceOnly: true },
);

console.log(
  failed
    ? `\n${failed} FAILURE(S) — ${passed} passed (a FAIL here means a GATE is decoration)`
    : `\nall ${passed} checks passed — 7 injected defects, 7 caught`,
);
process.exit(failed ? 1 : 0);
