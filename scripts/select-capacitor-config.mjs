#!/usr/bin/env node
// WS-R157. Capacitor's CLI (`node_modules/@capacitor/cli/dist/config.js`,
// `loadExtConfig`) always reads a FIXED filename in the project root —
// `capacitor.config.ts` (or `.js`/`.json`) — from `process.cwd()`. There is
// no `--config <path>` flag and no env var it consults for an alternate
// path: verified against the installed 8.5.0 CLI source; the one place
// `CAPACITOR_CONFIG` appears there (`common.js`, `runInDir`) is an OUTPUT
// the CLI injects INTO the native build's own environment, never an input
// this repo can set to redirect which file it reads
// (`context/decisions.md#ws-r157-capacitor-config-selected-by-a-repo-script-not-a-cli-flag`).
//
// So a second Capacitor app in the SAME project (the brief's own law 2:
// "never a copy of android/") needs something upstream of `cap sync` that
// puts the right config under that one fixed name first — this script is
// that something. It is a plain copy, never a merge: `capacitor.vyakti.
// config.ts` is a COMPLETE config in its own right (checked in as such),
// not a patch over Meera's.
//
// Meera's own CI job (`.github/workflows/build-apk.yml`'s `build` job)
// never calls this file at all — it still runs `npx cap sync android`
// straight against the tracked `capacitor.config.ts`, exactly as it always
// has. That is what makes "keep the Meera flavour byte-identical in
// behaviour" true by construction rather than by a test that could rot:
// nothing about her build's inputs changed.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export const CAPACITOR_CONFIG_FILE = "capacitor.config.ts";

/** flavor -> the source file this repo carries for it. "meera" resolves to
 *  the tracked `capacitor.config.ts` ITSELF, so staging it is a no-op copy
 *  of the file onto its own path — one code path for every flavour rather
 *  than "meera: do nothing, vyakti: do this", and no second file that could
 *  ever drift from Meera's real config because there IS no second file. */
export function sourceConfigPath(flavor, { dir = process.cwd() } = {}) {
  if (flavor === "meera") return join(dir, "capacitor.config.ts");
  if (flavor === "vyakti") return join(dir, "capacitor.vyakti.config.ts");
  throw new Error(`select-capacitor-config: unknown flavor ${JSON.stringify(flavor)} (expected "meera" or "vyakti")`);
}

/** Reads `sourceConfigPath(flavor, {dir})` and writes those exact bytes to
 *  `<dir>/capacitor.config.ts` — the ONE name the Capacitor CLI reads.
 *  Returns the bytes written so a caller (an eval included) can assert on
 *  content without a second read. `dir` defaults to `process.cwd()` for the
 *  real CI use; a suite passes its own throwaway fixture directory instead
 *  so this can be proven without ever touching the real repo's tracked
 *  `capacitor.config.ts`. */
export function stageCapacitorConfig(flavor, { dir = process.cwd() } = {}) {
  const source = sourceConfigPath(flavor, { dir });
  if (!existsSync(source)) throw new Error(`select-capacitor-config: ${source} does not exist`);
  const bytes = readFileSync(source, "utf8");
  writeFileSync(join(dir, CAPACITOR_CONFIG_FILE), bytes);
  return bytes;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const flavor = process.argv[2] || process.env.CAPACITOR_CONFIG || "meera";
  try {
    stageCapacitorConfig(flavor);
    console.log(`select-capacitor-config: capacitor.config.ts <- ${sourceConfigPath(flavor)}`);
  } catch (error) {
    console.error(`select-capacitor-config: ${error.message}`);
    process.exit(1);
  }
}
