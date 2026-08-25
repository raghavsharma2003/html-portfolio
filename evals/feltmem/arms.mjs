// ── THE TWO ARMS ──────────────────────────────────────────────────────────
//
// This battery's independent variable is the BUILD, not the model. Arm
// `current` is the working tree; arm `prewave` is the tree as it stood at the
// last commit before the memory wave. Both are compiled through the same
// declared engine surface (.entry.ts) and both are served to the same brain
// with the same sampling, so the only thing that differs between an A and a B
// reply is what the compiler put in front of the model.
//
// ── HOW THE OLD TREE IS MATERIALIZED, AND WHY NOT WITH CHECKOUT ───────────
// `git archive <ref> | tar -x` into a scratch directory. It is read-only on
// the repository: no checkout, no stash, no worktree, no index touched, and
// nothing that a concurrent workstream in the same tree could notice —
// context/rejected.md `shared-tree-concurrency` (seven agents, one working
// tree, one reset) is a bill this repo has already paid once.
//
// node_modules is SYMLINKED rather than copied: esbuild resolves from the
// entry file's directory upward, the old tree's package.json is not being
// installed, and a 400MB copy per arm would make the arms step the slowest
// thing in the battery for no gain.

import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { ROOT } from "./compile.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

export function resolveRef(ref) {
  return execFileSync("git", ["rev-parse", ref], { cwd: ROOT, encoding: "utf8" }).trim();
}

/** Extracts `ref` into a scratch tree and returns { dir, sha, subject }. */
export function materializeTree(ref) {
  const sha = resolveRef(ref);
  const subject = execFileSync("git", ["log", "-1", "--format=%s", sha], { cwd: ROOT, encoding: "utf8" }).trim();
  const dir = mkdtempSync(join(tmpdir(), `feltmem-tree-${sha.slice(0, 7)}-`));
  mkdirSync(dir, { recursive: true });
  execFileSync("bash", ["-c", `git archive ${sha} | tar -x -C ${JSON.stringify(dir)}`], {
    cwd: ROOT,
    stdio: "inherit",
  });
  // the old tree predates this battery: give it the entry file and the deps
  mkdirSync(join(dir, "evals", "feltmem"), { recursive: true });
  copyFileSync(join(HERE, ".entry.ts"), join(dir, "evals", "feltmem", ".entry.ts"));
  if (!existsSync(join(dir, "node_modules"))) symlinkSync(join(ROOT, "node_modules"), join(dir, "node_modules"), "dir");
  // the capacitor stub the bundle aliases to lives in the CURRENT tree and is
  // passed by absolute path (compile.mjs), so nothing else needs copying.
  return { dir, sha, subject };
}
