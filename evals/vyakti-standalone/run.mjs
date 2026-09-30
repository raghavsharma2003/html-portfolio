// Wave 25: Vyakti's compiler and public conversation doors must never regain
// an implicit product persona. Offline, deterministic, no provider calls.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
let pass = 0;
let fail = 0;
const ok = (name, condition) => {
  condition ? pass++ : fail++;
  console.log(`${condition ? "  ok  " : "FAIL  "}${name}`);
};

const dir = mkdtempSync(join(tmpdir(), "vyakti-standalone-"));
try {
  const entry = join(dir, "entry.ts");
  const bundle = join(dir, "bundle.mjs");
  writeFileSync(entry, `
    export { compile } from ${JSON.stringify(join(ROOT, "src/engine/compiler.ts"))};
    export { demoTeacherAgent } from ${JSON.stringify(join(ROOT, "src/engine/agents/teacher.ts"))};
    export { getAgent } from ${JSON.stringify(join(ROOT, "src/engine/agents/registry.ts"))};
  `);
  await build({ entryPoints: [entry], outfile: bundle, bundle: true, platform: "node", format: "esm" });
  const { compile, demoTeacherAgent, getAgent } = await import(`${pathToFileURL(bundle).href}?v=${Date.now()}`);
  const base = { user: { name: "Riya", vibe: [], facts: {} }, history: [], nowMs: 1_700_000_000_000, messageCount: 0 };
  let missingError = "";
  try { compile(base); } catch (error) { missingError = String(error?.message || error); }
  ok("compiler fails closed without an explicit agent module", missingError === "agent_module_required");
  const result = compile({ ...base, agent: demoTeacherAgent });
  ok("explicit sheet-backed agent preserves compile output shape", typeof result.core === "string" && typeof result.tail === "string");
  ok("Meera is not an accessible registry persona", getAgent("meera") === undefined);

  const room = readFileSync(join(ROOT, "api/_room-surface.js"), "utf8");
  ok("Room passes its resolved sheet module to the compiler", /engine\.compile\(\{[\s\S]*?agent:\s*resolved\.module/.test(room));
  const meet = readFileSync(join(ROOT, "api/_replica-dialogue.js"), "utf8");
  ok("Meet compiles from the authenticated replica definition", /compileReplicaRuntimeCore\(profile\.definition/.test(meet));
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
