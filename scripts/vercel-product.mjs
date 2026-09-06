#!/usr/bin/env node
// One product selector for both Vercel's install and build phases.
//
// The release commitment is captured before dependency installation while the
// landing page is selected after the web build. Duplicating this predicate in
// two shell blocks would let the marker say "Vyakti" while the output serves
// the companion product, or vice versa.

import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

export function vercelProduct(environment = process.env) {
  return environment.STUDIO_ROOT === "1" ||
    environment.VERCEL_GIT_COMMIT_REF === "claude/gurukul-platform"
    ? "vyakti-clone"
    : "meera-companion";
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  process.stdout.write(`${vercelProduct()}\n`);
}
