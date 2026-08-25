// The labeled key pool — RCA mechanism gate. Hermetic: every credential is a
// FAKE pinned before import (battery-gates-the-machine). Proves that the
// owner-label travels with each key, that a bare key still works, that dupes
// collapse, and that a label can never reconstruct a key.
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

process.env.GOOGLE_KEYS = [
  "gaurav-3~AQ.Ab8RN6aaaaaaaaaaaaaaaaaaaaaaaa",
  "team@x.world~AQ.Ab8RN6bbbbbbbbbbbbbbbbbbbbbbbb",
  "AQ.Ab8RN6cccccccccccccccccccccccc",
  "dupe~AQ.Ab8RN6aaaaaaaaaaaaaaaaaaaaaaaa",
  "short~AQ.tooshort",
].join(",");

const { poolSize, labelFor, poolRca } = await import(pathToFileURL(join(ROOT, "api", "_gkeys.js")).href);

let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) { pass++; console.log(`  ok   ${n}${d ? " — " + d : ""}`); } else { fail++; console.log(`  FAIL ${n}${d ? " — " + d : ""}`); } };

console.log("── the labeled pool ──");
ok("three unique keys survive (dupe collapses, short dropped)", poolSize() === 3, `size=${poolSize()}`);
ok("a label~key entry carries its owner label", labelFor("AQ.Ab8RN6aaaaaaaaaaaaaaaaaaaaaaaa") === "gaurav-3");
ok("an email label survives verbatim", labelFor("AQ.Ab8RN6bbbbbbbbbbbbbbbbbbbbbbbb") === "team@x.world");
ok("a bare key gets a positional label, not blank", labelFor("AQ.Ab8RN6cccccccccccccccccccccccc") === "key-2");
ok("the FIRST label wins on a duplicate key", labelFor("AQ.Ab8RN6aaaaaaaaaaaaaaaaaaaaaaaa") === "gaurav-3");
ok("an unknown key is 'unknown', never throws, never a key", labelFor("nope") === "unknown");
ok("RCA snapshot starts empty and is a plain object", JSON.stringify(poolRca()) === "{}");
const labels = ["gaurav-3", "team@x.world", "key-2"];
ok("no label contains 'AQ.' (a label can never reconstruct a secret)", labels.every((l) => !l.includes("AQ.")));

console.log(`\n${pass} passed, ${fail} failed`);


// ── paste sanitation: the 2026-08-24 outage class ────────────────────────
// One malformed pasted entry must shrink the pool by one, never abort it.
{
  const { execSync } = await import("node:child_process");
  const A = "AQ." + "A".repeat(44);
  const B = "AQ." + "B".repeat(44);
  const C = "AQ." + "C".repeat(44);
  const fixture =
    "GOOGLE_KEYS='alice~" + A + "', bob~" + B + ",\ncarol~" + C + ", dave~AQ.bad key with spaces inside it longer, eve~short";
  const out = execSync(
    "node --input-type=module -e \"const g = await import('./api/_gkeys.js'); console.log(g.poolSize(), g.poolHealth());\"",
    { encoding: "utf8", env: { ...process.env, GOOGLE_KEYS: fixture } },
  ).trim();
  const [size, health] = out.split(" ");
  ok("prefix, quotes, newline and whitespace are sanitised: 3 clean keys survive", size === "3", out);
  ok("the 2 malformed entries are dropped, not sent upstream, and counted", health.includes("!2"), health);
}


// ── the bake seam: write-config must parse label~key like the runtime ────
// The pool-0 outage: baked GOOGLE_KEYS carried "label~key" strings verbatim;
// upstream answered 400 API_KEY_INVALID for the glued-on label, and after
// the paste sanitiser landed the same entries were charset-dropped to zero.
{
  const { execSync } = await import("node:child_process");
  const { mkdtempSync, mkdirSync, copyFileSync, readFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const A = "AQ." + "D".repeat(44);
  const B = "AQ." + "E".repeat(44);
  const dir = mkdtempSync(join(tmpdir(), "wc-"));
  mkdirSync(join(dir, "scripts"));
  mkdirSync(join(dir, "api"));
  copyFileSync("scripts/write-config.mjs", join(dir, "scripts", "write-config.mjs"));
  execSync("node scripts/write-config.mjs", {
    encoding: "utf8", cwd: dir,
    env: { ...process.env, CI: "1", OPENROUTER_KEY: "sk-or-battery-not-real", NEON_URL: "postgres://battery:not@real.invalid/db", GOOGLE_KEYS: "alice~" + A + "," + B },
  });
  const baked = readFileSync(join(dir, "api", "_config.js"), "utf8");
  ok("the bake parses label~key: no tilde survives into the key array", !/GOOGLE_KEYS = \[[^\]]*~/.test(baked), "");
  ok("…the label lands in GOOGLE_KEYRING for RCA", baked.includes('"label":"alice"'), "");
  ok("…and a bare key gets a null label, not a mangled one", baked.includes('"label":null'), "");
}
// ── the baked-array runtime path parses label~key too ────────────────────
{
  const { execSync } = await import("node:child_process");
  const A = "AQ." + "F".repeat(44);
  const out = execSync(
    "node --input-type=module -e \"const g = await import('./api/_gkeys.js'); console.log(g.poolSize(), g.labelFor('" + A + "'));\"",
    { encoding: "utf8", env: { ...process.env, GOOGLE_KEYS: "frank~" + A } },
  ).trim();
  ok("env label~key: pool 1, label resolves for RCA", out === "1 frank", out);
}

if (fail) process.exit(1);
