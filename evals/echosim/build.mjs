// Transpile the REAL liveCall.ts (and its two imports) to ESM that node can
// run, so the simulation drives production code rather than a paraphrase.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
// Derived from this file's own location, never hardcoded. It used to name
// "/home/user/html-portfolio" as the fallback, which was true of exactly one
// container and silently wrong everywhere else — including the day the project
// moved repositories, which is when the audio-floor proof would have stopped
// running and nobody would have noticed until they needed it.
// evals/echosim/build.mjs -> repo root is two levels up.
const REPO = process.env.SRCROOT ? path.dirname(process.env.SRCROOT) : path.resolve(HERE, "..", "..");
const SRCDIR = process.env.SRCROOT ?? "src";
fs.rmSync(path.join(HERE, "build"), { recursive: true, force: true });
execFileSync(process.execPath, [
  path.join(REPO, "node_modules", "typescript", "bin", "tsc"),
  "--ignoreConfig", path.join(SRCDIR, "voice", "liveCall.ts"),
  "--target", "es2022", "--module", "esnext", "--moduleResolution", "bundler",
  "--skipLibCheck", "--outDir", path.join(HERE, "build"), "--rootDir", SRCDIR,
], { cwd: REPO, stdio: "inherit" });
// node ESM wants extensions
for (const f of ["voice/liveCall.js", "voice/level.js", "engine/diag.js"]) {
  const p = path.join(HERE, "build", f);
  let s = fs.readFileSync(p, "utf8");
  s = s.replace(/from "(\.[^"]*)"/g, (m, spec) => (spec.endsWith(".js") ? m : `from "${spec}.js"`));
  fs.writeFileSync(p, s);
}
// diag() is fire-and-forget over fetch; tee it into a global the harness reads.
{
  const p = path.join(HERE, "build", "engine", "diag.js");
  let s = fs.readFileSync(p, "utf8");
  s = s.replace(
    /export function diag\(([^)]*)\) \{/,
    (m, args) =>
      `export function diag(${args}) {\n  (globalThis.__DIAG ||= []).push({ t: Date.now(), scope, event, detail });`,
  );
  if (!s.includes("__DIAG")) throw new Error("diag tee failed to apply");
  fs.writeFileSync(p, s);
}
// A read-only probe on the arbiter's own variables, for the harness only.
{
  const p = path.join(HERE, "build", "voice", "liveCall.js");
  let s = fs.readFileSync(p, "utf8");
  const anchor = "            const ratio = e.inputBuffer.sampleRate / 16000;";
  if (!s.includes(anchor)) throw new Error("probe anchor missing");
  // the baseline lane has scalar bars, the reworked one has per-sub-frame
  // arrays; probe whichever this build actually has
  const arrays = s.includes("thrBAt");
  const fields = arrays
    ? "thrB: thrBAt[0], thrS: thrSAt[0], echoLag, herMax, echoLocked,"
    : "thrB, thrS, echoLag: -1, herMax: herNow, echoLocked: false,";
  s = s.replace(
    anchor,
    "            globalThis.__PROBE?.({ t: Date.now(), rms, herSpeaking, herNow, thrL, " +
      fields +
      " echoTerm, kappa, noiseFloor, open, holding, claim, hard: hardHits.length," +
      " soft: softHits.length, hold: hold.length, ducked, sub: sub.slice() });\n" +
      anchor,
  );
  fs.writeFileSync(p, s);
}
// constant overrides for parameter sweeps — production source stays canonical
if (process.env.TUNE) {
  const p2 = path.join(HERE, "build", "voice", "liveCall.js");
  let t = fs.readFileSync(p2, "utf8");
  for (const [k, v] of Object.entries(JSON.parse(process.env.TUNE))) {
    const re = new RegExp(`const ${k} = [^;]+;`);
    if (!re.test(t)) throw new Error("no such constant: " + k);
    t = t.replace(re, `const ${k} = ${v};`);
  }
  fs.writeFileSync(p2, t);
}
console.log("built");
