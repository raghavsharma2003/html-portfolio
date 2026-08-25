// Year scan for the persona size ceilings: the compiled core is DATE-dependent
// (her life texture rotates by calendar day), so the invariant ceilings in
// evals/persona-invariants.data.mjs must be set from the YEARLY MAX, and
// buildLanes pins its clock to the argmax date this script reports. Re-run
// after any persona texture edit; if the argmax moves, update both the pinned
// date in buildLanes and the ceiling, with a dated rationale.
// Run: node scripts/scan-core-max.mjs
import { execSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const tmp = mkdtempSync(join(tmpdir(), "coremax-"));
execSync(
  `npx esbuild ${join(ROOT, "evals/.entry.ts")} --bundle --format=esm --platform=node ` +
    `--outfile=${join(tmp, "b.mjs")} --log-level=error --alias:@capacitor/core=${join(ROOT, "evals/stubs/capacitor.mjs")}`,
  { stdio: "inherit", cwd: ROOT },
);
const E = await import(join(tmp, "b.mjs"));
const agent = E.meeraAgent ?? E.DEFAULT_AGENT ?? { buildSystemPromptParts: E.buildSystemPromptParts, buildSpeechStyle: E.buildSpeechStyle };
const USER = { name: "Arjun", facts: {}, interests: [], memories: [], vibe: [] };
const RealDate = Date;
let best = { core: 0 }, bestA = { len: 0 };
const hist = new Map();
for (let dd = 0; dd < 366; dd++) {
  const t = new RealDate(2026, 0, 1 + dd, 12, 45).getTime();
  globalThis.Date = class extends RealDate {
    constructor(...a) { if (a.length) super(...a); else super(t); }
    static now() { return t; }
  };
  const p = agent.buildSystemPromptParts(USER, 999, "text");
  const v = agent.buildSystemPromptParts(USER, 999, "voice");
  const live = v.core + agent.buildSpeechStyle("live");
  hist.set(p.core.length, (hist.get(p.core.length) || 0) + 1);
  if (p.core.length > best.core) best = { core: p.core.length, when: new RealDate(2026, 0, 1 + dd).toDateString() };
  if (live.length > bestA.len) bestA = { len: live.length, when: new RealDate(2026, 0, 1 + dd).toDateString() };
}
globalThis.Date = RealDate;
console.log("distinct core sizes across the year:", [...hist.keys()].sort((a, b) => a - b).join(", "));
console.log("MAX text core:", best.core, "on", best.when, "| ceiling: see data.mjs \"under ceiling\"");
console.log("MAX live assembled in-app:", bestA.len + 720, "on", bestA.when, "| assembled cap: see data.mjs 52200");
