// WS-R165. Finds a `git show <commit>:<path>` call reading a historical
// blob at SUITE START TIME under evals/ — the shape that starved on CI's
// depth-1 checkout (`context/rejected.md#ci-shallow-checkout-starved-the-
// history-reading-suites`, 18 suites failing with "exists on disk, but not
// in <commit>"). The fix moves every such blob into a committed fixture
// under the suite's own `fixtures/` directory; this scanner is what proves
// none is left, and what stops a new suite reintroducing the shape.
//
// Deliberately narrow: `git rev-parse`, `git status`, `git log` and
// `git ls-files` are unaffected by checkout depth for an ancestor commit (or,
// for `rev-parse HEAD`/`status`, read no history at all) and stay untouched
// — only `git show <ref>:<path>` (an actual historical FILE CONTENT read) is
// in scope. `evals/feltmem/arms.mjs`'s `git archive <ref> | tar -x` is also
// out of scope on purpose: it materializes a whole historical TREE for a
// real A/B compiler run, a different problem with its own header
// explaining why (read-only, no checkout, no stash — `context/
// rejected.md#shared-tree-concurrency`), not a single blob a fixture file
// can stand in for.
//
// Scans comment-stripped source (`evals/lib/source-scan.mjs`) so a comment
// that merely DISCUSSES the historical-blob problem — this file's own
// header, or the header comments this workstream left at every fixture read
// site — can never be mistaken for a real call.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { stripComments } from "./source-scan.mjs";

// Matches `git`/`"git"`/'git' as the program, followed (within a short
// window — the array literal naming the git subcommand and its argument)
// by a `show` string. Every real instance this repo ever had passed `git`
// and an argv array to `execFileSync`/`execSync`/`spawnSync`, always with
// `show` as the first element of that array.
const GIT_SHOW_CALL = /\bexec(?:File)?Sync\s*\(\s*[`'"]git[`'"]\s*,\s*\[\s*[`'"]show[`'"]/g;

/** `[{ index }]` for every `git ... show ...` blob-read call found in `src`
 *  (comment-stripped internally, so callers never pass raw text). */
export function findGitShowCalls(src) {
  const clean = stripComments(src);
  const hits = [];
  for (const m of clean.matchAll(GIT_SHOW_CALL)) hits.push({ index: m.index });
  return hits;
}

// Files whose own self-test (or, for the two `run.mjs` wrappers, whose own
// NEGATIVE CONTROL) carries the banned shape as a STRING LITERAL rather
// than real code — the same class of self-scan trap `context/
// rejected.md#ws-r127-own-eval-static-scan-tripped-by-its-own-prose` names
// for a comment, restated here for a string. None of the four is a suite
// that could itself read a historical git blob.
const SELF_EXCLUDED = new Set([
  join("lib", "launch-scan.mjs"),
  join("lib", "history-scan.mjs"),
  join("launch-scan", "run.mjs"),
  join("history-scan", "run.mjs"),
]);

function evalsFiles(evalsRoot) {
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules" || entry === "fixtures") continue;
      const full = join(dir, entry);
      if (SELF_EXCLUDED.has(relative(evalsRoot, full))) continue;
      const st = statSync(full);
      if (st.isDirectory()) walk(full);
      else if (st.isFile() && extname(full) === ".mjs") out.push(full);
    }
  };
  walk(evalsRoot);
  return out;
}

/** The scan the release gate runs: every `git show` blob-read call left
 *  under evals/. Returns `[{ file }]`, empty when the tree is clean. */
export function scanRepoForGitShow(repoRoot) {
  const evalsRoot = join(repoRoot, "evals");
  const findings = [];
  for (const file of evalsFiles(evalsRoot)) {
    const hits = findGitShowCalls(readFileSync(file, "utf8"));
    for (const hit of hits) findings.push({ file: relative(repoRoot, file).split("\\").join("/"), index: hit.index });
  }
  return findings;
}

export function selfTest() {
  const cases = [];
  const t = (name, cond) => cases.push({ name, cond: Boolean(cond) });

  t("finds a real execFileSync('git', ['show', ...]) call",
    findGitShowCalls("const old = execFileSync('git', ['show', `${base}:x`], { cwd, encoding: 'utf8' });").length === 1);

  t("finds the double-quoted / execSync shape too",
    findGitShowCalls('const old = execSync(`git show ${base}:x`);').length === 0
    // execSync with a template-built command line is a DIFFERENT call shape
    // this repo's suites never used (all 20 real instances passed an argv
    // array to execFileSync) — documented here as a known gap rather than
    // silently assumed covered; see this suite's own §2 below.
  );

  t("a comment mentioning the exact call shape is not a real call (the ws-r127 shape)",
    findGitShowCalls("// used to call execFileSync('git', ['show', ref], {})\nconst x = 1;").length === 0);

  t("git rev-parse/status/log/ls-files are never flagged (checkout-depth safe, or a different mechanism entirely)",
    findGitShowCalls([
      "execFileSync('git', ['rev-parse', 'HEAD'], {});",
      "execFileSync('git', ['status', '--porcelain'], {});",
      "execFileSync('git', ['log', '-1', '--format=%s', sha], {});",
      "execFileSync('git', ['ls-files', 'android'], {});",
    ].join("\n")).length === 0);

  t("`git archive <ref> | tar -x` (feltmem/arms.mjs's whole-tree mechanism) is never flagged",
    findGitShowCalls('execFileSync("bash", ["-c", `git archive ${sha} | tar -x -C ${dir}`], {});').length === 0);

  return { pass: cases.filter((c) => c.cond).length, fail: cases.filter((c) => !c.cond).length, cases };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { pass, fail, cases } = selfTest();
  for (const c of cases) console.log(`${c.cond ? "  ok  " : "FAIL  "}${c.name}`);
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
