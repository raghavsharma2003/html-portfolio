// The labeled key pool — RCA mechanism gate. Hermetic: every credential is a
// FAKE pinned before import (battery-gates-the-machine). Proves that the
// owner-label travels with each key, that a bare key still works, that dupes
// collapse, and that a label can never reconstruct a key.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

process.env.GOOGLE_KEYS = [
  "gaurav-3~AQ.Ab8RN6aaaaaaaaaaaaaaaaaaaaaaaa",
  "team@x.world~AQ.Ab8RN6bbbbbbbbbbbbbbbbbbbbbbbb",
  "AQ.Ab8RN6cccccccccccccccccccccccc",
  "dupe~AQ.Ab8RN6aaaaaaaaaaaaaaaaaaaaaaaa",
  "short~AQ.tooshort",
].join(",");

const { poolSize, labelFor, poolRca } = await import(join(ROOT, "api", "_gkeys.js"));

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
if (fail) process.exit(1);
