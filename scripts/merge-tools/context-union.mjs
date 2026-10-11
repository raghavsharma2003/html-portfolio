#!/usr/bin/env node
// Union an append-only context file during a merge: keep OURS whole and append
// THEIRS' additions relative to the merge base. Never concatenates both files
// (see context/rejected.md#context-union-by-concatenation).
//
// usage: node context-union.mjs <base-rev> <theirs-rev> <path> [<path>...]
// Run from the repo root with the merge in progress (the working file is the
// conflicted one; it is overwritten with the union). Exits non-zero if theirs'
// change is not a pure append or if the result has duplicated "## " headings.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const [baseRev, theirsRev, ...paths] = process.argv.slice(2);
if (!baseRev || !theirsRev || paths.length === 0) {
  console.error("usage: node context-union.mjs <base-rev> <theirs-rev> <path>...");
  process.exit(2);
}
const show = (rev, p) => execFileSync("git", ["show", `${rev}:${p}`], { encoding: "utf8", maxBuffer: 1 << 28 });

for (const p of paths) {
  const base = show(baseRev, p);
  const theirs = show(theirsRev, p);
  const ours = show("HEAD", p);
  if (!theirs.startsWith(base)) {
    console.error(`${p}: theirs is not a pure append over base; resolve by hand`);
    process.exit(1);
  }
  const addition = theirs.slice(base.length);
  const sep = ours.endsWith("\n") ? "" : "\n";
  const out = ours + sep + addition;
  const heads = out.split("\n").filter((l) => l.startsWith("## "));
  const dups = heads.filter((h, i) => heads.indexOf(h) !== i);
  if (dups.length) {
    console.error(`${p}: duplicated headings after union:\n  ${[...new Set(dups)].join("\n  ")}`);
    process.exit(1);
  }
  writeFileSync(p, out);
  console.log(`${p}: ours ${ours.split("\n").length} + theirs' ${addition.split("\n").length} appended lines -> ${out.split("\n").length}`);
}
