// evals/time/g1.mjs — the G1 structural gate. WS-TIME.
//
// inner.ts's G1 forbids any code path from a usage metric into persisted
// INTERIOR state, and names elapsed time on that list. This workstream reads
// elapsed time. The line it draws:
//
//   reading the gap to reason about HIS world  = conversation content
//   letting the gap move HER interior          = what G1 forbids
//
// This file is the proof that the line is STRUCTURAL and not a convention. It
// asserts over source text and over the repo's import graph, never by reading
// the code and being satisfied — the same posture SPEC-SELF-LAYER §9's G-S4
// takes ("asserted structurally, not reviewed by eye").
//
//   node evals/time/g1.mjs
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { ROOT, SRC, bundle, checkSourceG1, checkGapUnrenderable, checkNoStateLeak } from "./_checks.mjs";

const source = readFileSync(SRC, "utf8");
const BUNDLE = bundle(SRC, "g1");
const M = await import(BUNDLE);

let failed = 0;
let passed = 0;
const ok = (name, cond, detail = "") => {
  if (cond) {
    passed++;
    console.log(`  ok  ${name}`);
  } else {
    failed++;
    console.log(`FAIL  ${name}  ${detail}`);
  }
};
const run = (name, r) => ok(`${name} (n=${r.n})`, r.problems.length === 0, r.problems.join(" | "));
const section = (s) => console.log(`\n── ${s} ──`);

section("no writer exists in this module");
run("source carries no query fn, storage, network, or interior write", checkSourceG1(source));

section("the gap is structurally unrenderable");
run("HisFrame has no gap field and no block names the silence", checkGapUnrenderable(M));
run("no rendered row carries her state", checkNoStateLeak(M));

section("no affect field can be constructed");
{
  // MovedNote is the only per-item type this module produces for his clock.
  // If a valence/weight/mood field ever appears here, "she is X because he
  // was away" becomes representable, which is the whole thing G1 exists to
  // prevent (inner.ts: "Here that state is unrepresentable").
  const now = Date.now();
  const f = M.hisClock({
    now,
    lastSpokeAt: now - 9 * 86_400_000,
    facts: [
      {
        id: "a",
        name: "exam",
        kind: "event",
        summary: "exam",
        saidAt: now - 20 * 86_400_000,
        dueAt: now - 3 * 86_400_000,
      },
    ],
  });
  ok("the fixture actually produced a note to inspect", f.moved.length === 1);
  const keys = new Set(Object.keys(f.moved[0] || {}));
  const banned = ["w", "weight", "valence", "sign", "mood", "affect", "feel", "carry", "told"];
  const hit = banned.filter((k) => keys.has(k));
  ok(`MovedNote carries no affect field (${[...keys].join(",")})`, hit.length === 0, hit.join(","));
}

section("import graph — nothing has wired this into a writer");
{
  const files = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir)) {
      if (e === "node_modules" || e === ".git" || e === "dist") continue;
      const p = join(dir, e);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|tsx|js|mjs)$/.test(e)) files.push(p);
    }
  };
  walk(join(ROOT, "src"));
  walk(join(ROOT, "api"));
  const importers = files.filter(
    (f) => f !== SRC && /from\s+["'][^"']*\/timeline(\.js)?["']|from\s+["']\.\/timeline(\.js)?["']/.test(readFileSync(f, "utf8")),
  );
  // The writers G1 names: her interior, the memory extractor, the appraiser.
  // A timeline import inside one of those is the shape of the violation.
  const writers = importers.filter((f) => /engine\/(inner|memory|brain)\.ts$|api\/(memory|consolidate)\.js$/.test(f));
  console.log(`      importers: ${importers.length ? importers.map((f) => f.replace(ROOT, "")).join(", ") : "(none yet — not wired)"}`);
  ok("no interior writer imports this module", writers.length === 0, writers.join(","));
}

console.log(failed ? `\n${failed} FAILURE(S) — ${passed} passed` : `\nall ${passed} checks passed`);
process.exit(failed ? 1 : 0);
