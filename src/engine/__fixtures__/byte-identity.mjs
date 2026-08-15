// WS-COMPILER M2 — the extraction proof. Bundles the REAL source (compiler.ts
// against the FROZEN oldOracle.ts) and asserts, per fixture, that:
//
//   1. compile(fixture) === compileOld(fixture)   — byte-for-byte, core/tail/
//      system all three — the "behavior-frozen extraction" law (SPEC §3, M2
//      rule; SPEC §0.3 "Persona factoring charm risk": byte-identity first
//      is the single safest migration technique any proposal offered).
//   2. compile(fixture) called twice on identical input produces identical
//      output — the double-compile byte-identity check SPEC §3.3 requires
//      in CI ("a single-byte diff fails the build").
//
// Run standalone: `node src/engine/__fixtures__/byte-identity.mjs`
// Also invoked from scripts/check-prompt-budget.mjs so it rides the same
// gate `verify-release.mjs` already runs (db-free, no network).
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..", "..");
const BUNDLE = join(HERE, ".bundle.mjs");

execSync(
  `npx esbuild ${join(HERE, ".entry.ts")} --bundle --format=esm --platform=node ` +
    `--outfile=${BUNDLE} --log-level=error --alias:@capacitor/core=${join(ROOT, "evals/stubs/capacitor.mjs")}`,
  { stdio: "inherit", cwd: ROOT },
);

const { compile, compileOld, FIXTURES } = await import(BUNDLE);

let failed = 0;
let checked = 0;

for (const { id, input } of FIXTURES) {
  checked++;
  const a = compile(input);
  const b = compileOld(input);
  const coreOk = a.core === b.core;
  const tailOk = a.tail === b.tail;
  const systemOk = a.system === b.system;
  if (!coreOk || !tailOk || !systemOk) {
    failed++;
    console.log(`FAIL  ${id}`);
    if (!coreOk) console.log(`      core differs: new=${a.core.length}c old=${b.core.length}c`);
    if (!tailOk) console.log(`      tail differs: new=${a.tail.length}c old=${b.tail.length}c`);
    if (!systemOk) console.log(`      system differs: new=${a.system.length}c old=${b.system.length}c`);
    continue;
  }
  // double-compile byte-identity (§3.3): same input, called twice, must be
  // byte-identical — this is the CI shape of the cache-9x guard.
  const a2 = compile(input);
  if (a2.core !== a.core || a2.tail !== a.tail) {
    failed++;
    console.log(`FAIL  ${id}  (double-compile mismatch — non-determinism in compile())`);
  }
}

console.log(
  failed
    ? `\n${failed} of ${checked} fixtures FAILED byte-identity`
    : `\nbyte-identity: ${checked}/${checked} fixtures pass (compile() === compileOld(), hash method: strict string equality on core/tail/system; double-compile determinism also checked per fixture)`,
);
process.exit(failed ? 1 : 0);
