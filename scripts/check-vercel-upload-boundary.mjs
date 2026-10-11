#!/usr/bin/env node
// The Vercel CLI does not apply .gitignore while constructing an upload. A
// gitignored workstation config can therefore enter a deployment unless the
// same path is refused by .vercelignore. This gate keeps that refusal exact.
//
// The required rules are deliberately simple top-level or exact-path rules.
// That makes their Vercel ignore semantics unambiguous and lets this check fail
// closed if somebody later adds a negation. Its negative controls prove both
// ways the boundary previously broke: deleting a rule and re-including a path.

import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const IGNORE_PATH = new URL("../.vercelignore", import.meta.url);

const REQUIRED_RULES = Object.freeze([
  ".env*",
  "api/_config.js",
  "api/_config.env",
  "api/keyring.json",
  "api/google-keys.env",
]);

const TRACKED_SECRET_PATTERNS = Object.freeze([
  ".env",
  ".env.*",
  "api/_config.js",
  "api/_config.env",
  "api/keyring.json",
  "api/google-keys.env",
]);

function activeRules(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
}

function boundaryProblems(rules) {
  const problems = [];
  const negations = rules.filter((rule) => rule.startsWith("!"));
  if (negations.length) {
    problems.push(
      `.vercelignore contains re-inclusion rule(s): ${negations.join(", ")}. ` +
      "The credential boundary forbids negations because a later broad rule can silently reopen a secret path.",
    );
  }
  for (const required of REQUIRED_RULES) {
    if (!rules.includes(required)) {
      problems.push(`.vercelignore must contain the exact rule ${JSON.stringify(required)}`);
    }
  }
  return problems;
}

const rules = activeRules(readFileSync(IGNORE_PATH, "utf8"));
const problems = boundaryProblems(rules);

if (existsSync(new URL("../.nowignore", import.meta.url))) {
  problems.push(".nowignore exists beside .vercelignore; Vercel refuses the conflicting pair");
}

// .vercelignore protects the CLI upload. The thin-build fallback can also pull
// the repository tarball, so a secret committed to Git would bypass that first
// boundary. Refuse both paths, without reading any candidate file contents.
try {
  const tracked = execFileSync("git", ["ls-files", "--", ...TRACKED_SECRET_PATTERNS], {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  if (tracked) problems.push(`credential-shaped path(s) are tracked by Git: ${tracked.split(/\r?\n/).join(", ")}`);
} catch (error) {
  problems.push(`could not inspect tracked paths: ${error.message}`);
}

// Negative controls: each required rule must be load-bearing, and any
// re-inclusion must make the policy fail. These catch a gate accidentally
// reduced to "the file exists" or "some ignore rule exists".
for (const required of REQUIRED_RULES) {
  const without = rules.filter((rule) => rule !== required);
  if (!boundaryProblems(without).some((problem) => problem.includes(JSON.stringify(required)))) {
    problems.push(`negative control failed when ${JSON.stringify(required)} was removed`);
  }
}
if (!boundaryProblems([...rules, "!api/_config.js"]).some((problem) => problem.includes("re-inclusion"))) {
  problems.push("negative control failed for a re-included api/_config.js");
}

if (problems.length) {
  console.error(`Vercel upload boundary: ${problems.length} problem(s)`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

console.log(
  `Vercel upload boundary ok - ${REQUIRED_RULES.length} credential rules, no re-inclusions, no tracked credential paths`,
);
