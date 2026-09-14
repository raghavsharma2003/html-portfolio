#!/usr/bin/env node
// Vyakti palette contrast floors, read from the CSS that Room and Studio load.
// Browser accessibility checks still inspect rendered screens; this fast gate
// pins the shared tokens so an unreadable palette cannot reach that later gate.

import { readFileSync } from "node:fs";

const read = (relative) => readFileSync(new URL(relative, import.meta.url), "utf8");

function tokens(source) {
  const clean = source.replace(/\/\*[\s\S]*?\*\//g, "");
  const found = new Map();
  for (const match of clean.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    if (!found.has(match[1])) found.set(match[1], match[2].trim());
  }
  return found;
}

function resolveHex(table, name, seen = new Set()) {
  if (seen.has(name)) throw new Error(`token cycle at ${name}`);
  seen.add(name);
  const value = table.get(name);
  if (!value) throw new Error(`missing token ${name}`);
  const reference = /^var\((--[\w-]+)\)$/.exec(value);
  if (reference) return resolveHex(table, reference[1], seen);
  if (!/^#[0-9a-f]{6}$/i.test(value)) throw new Error(`${name} must resolve to a six-digit hex, got ${value}`);
  return value;
}

function luminance(hex) {
  const channels = [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16) / 255);
  const linear = channels.map((channel) => channel <= 0.04045
    ? channel / 12.92
    : ((channel + 0.055) / 1.055) ** 2.4);
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrast(a, b) {
  const [high, low] = [luminance(a), luminance(b)].sort((left, right) => right - left);
  return (high + 0.05) / (low + 0.05);
}

const REQUIRED_PAIRS = [
  ["body ink on paper", "--ink", "--paper", 4.5],
  ["secondary ink on paper", "--ink-soft", "--paper", 4.5],
  ["AA faint ink on paper", "--ink-faint-aa", "--paper", 4.5],
  ["forest action on paper", "--forest", "--paper", 4.5],
  ["selected action label on forest", "--panel-solid", "--forest", 4.5],
  ["success ink on success ground", "--forest-deep", "--forest-soft", 4.5],
  ["danger ink on danger ground", "--danger", "--danger-soft", 4.5],
  ["waiting ink on waiting ground", "--state-waiting", "--state-waiting-soft", 4.5],
  ["running ink on running ground", "--state-running", "--state-running-soft", 4.5],
  ["focus ring on paper", "--forest", "--paper", 3],
];

export function evaluatePalette(foundationSource, studioSource, statusSource) {
  const foundation = tokens(foundationSource);
  const studio = tokens(studioSource);
  const combined = new Map([...foundation, ...tokens(statusSource)]);
  const findings = [];
  const results = [];

  for (const name of [
    "--paper", "--panel-solid", "--ink", "--ink-soft",
    "--forest", "--forest-deep", "--forest-soft", "--danger", "--danger-soft",
  ]) {
    const expected = resolveHex(foundation, name);
    const actual = resolveHex(studio, name);
    if (expected.toLowerCase() !== actual.toLowerCase()) {
      findings.push(`Studio ${name} ${actual} drifted from shared ${expected}`);
    }
  }

  for (const [label, foregroundName, backgroundName, floor] of REQUIRED_PAIRS) {
    const foreground = resolveHex(combined, foregroundName);
    const background = resolveHex(combined, backgroundName);
    const measured = contrast(foreground, background);
    results.push({ label, measured, floor });
    if (measured + 1e-9 < floor) findings.push(`${label}: ${measured.toFixed(2)} < ${floor.toFixed(1)}`);
  }
  return { findings, results };
}

const foundationSource = read("../src/creatorStudio/design/foundation.css");
const studioSource = read("../src/studio/studio.css");
const statusSource = read("../src/studio/design/tokens.css");
const roomEntry = read("../src/room/main.tsx");
if (!roomEntry.includes('import "../creatorStudio/design/foundation.css";')) {
  throw new Error("Room no longer imports the palette this gate measures");
}

const actual = evaluatePalette(foundationSource, studioSource, statusSource);
const lowContrastMutant = foundationSource.replace("--ink: #171915;", "--ink: #f4f1e9;");
const driftMutant = studioSource.replace("--forest: #17493b;", "--forest: #ffffff;");
const lowContrastCaught = evaluatePalette(lowContrastMutant, studioSource, statusSource).findings
  .some((finding) => finding.includes("body ink on paper"));
const driftCaught = evaluatePalette(foundationSource, driftMutant, statusSource).findings
  .some((finding) => finding.includes("Studio --forest"));
if (!lowContrastCaught || !driftCaught) {
  throw new Error(`contrast negative controls failed: low=${lowContrastCaught} drift=${driftCaught}`);
}

for (const result of actual.results) {
  console.log(`  ok  ${result.label} ${result.measured.toFixed(2)} >= ${result.floor.toFixed(1)}`);
}
if (actual.findings.length) {
  for (const finding of actual.findings) console.error(`FAIL  ${finding}`);
  process.exit(1);
}
console.log(`contrast ok - ${actual.results.length} Vyakti token floors, 2 negative controls`);
