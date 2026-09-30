#!/usr/bin/env node
// One product identity for both Vercel's install and build phases.
// Vyakti is the only product built or deployed from this repository.

import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

export function vercelProduct(_environment = process.env) {
  return "vyakti-clone";
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  process.stdout.write(`${vercelProduct()}\n`);
}
