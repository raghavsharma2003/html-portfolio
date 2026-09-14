#!/usr/bin/env node
// Capacitor reads only `capacitor.config.ts` from the working directory and
// has no input flag for another config path. Keep the committed Vyakti config
// independently reviewable, then stage its exact bytes immediately before
// `cap sync`.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export const CAPACITOR_CONFIG_FILE = "capacitor.config.ts";
export const VYAKTI_CONFIG_FILE = "capacitor.vyakti.config.ts";

export function sourceConfigPath(product = "vyakti", { dir = process.cwd() } = {}) {
  if (product !== "vyakti") {
    throw new Error(`select-capacitor-config: unknown product ${JSON.stringify(product)} (expected "vyakti")`);
  }
  return join(dir, VYAKTI_CONFIG_FILE);
}

export function stageCapacitorConfig(product = "vyakti", { dir = process.cwd() } = {}) {
  const source = sourceConfigPath(product, { dir });
  if (!existsSync(source)) throw new Error(`select-capacitor-config: ${source} does not exist`);
  const bytes = readFileSync(source, "utf8");
  writeFileSync(join(dir, CAPACITOR_CONFIG_FILE), bytes);
  return bytes;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const product = process.argv[2] || "vyakti";
  try {
    stageCapacitorConfig(product);
    console.log(`select-capacitor-config: ${CAPACITOR_CONFIG_FILE} <- ${sourceConfigPath(product)}`);
  } catch (error) {
    console.error(`select-capacitor-config: ${error.message}`);
    process.exit(1);
  }
}
