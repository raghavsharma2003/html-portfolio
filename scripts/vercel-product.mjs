#!/usr/bin/env node
// One product selector for both Vercel's install and build phases.
//
// The release commitment is captured before dependency installation while the
// landing page is selected after the web build. Duplicating this predicate in
// two shell blocks would let the marker say "Vyakti" while the output serves
// the companion product, or vice versa.

import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

// The Vyakti branch family: the original platform branch plus every
// claude/vyakti-cloning-platform-* ref (matched as a pattern so a rename inside
// the family needs no script change, the rule vercel-build.sh documents). A
// companion branch keeps Meera's landing; the studio project sets STUDIO_ROOT.
const VYAKTI_BRANCH = /^(claude\/gurukul-platform|claude\/vyakti-cloning-platform-[a-z0-9-]+)$/;

export function vercelProduct(environment = process.env) {
  return environment.STUDIO_ROOT === "1" ||
    VYAKTI_BRANCH.test(environment.VERCEL_GIT_COMMIT_REF || "")
    ? "vyakti-clone"
    : "meera-companion";
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  process.stdout.write(`${vercelProduct()}\n`);
}
