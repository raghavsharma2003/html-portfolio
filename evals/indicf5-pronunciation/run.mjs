import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const root = new URL("../../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const normalizer = read("services/indicf5-runtime/pronunciation_normalizer.py");
const tests = read("evals/indicf5-pronunciation/test_normalizer.py");
const expectedImpact = JSON.parse(read("evals/indicf5-pronunciation/expected-impact.v1.json"));
let passed = 0;
function ok(name, condition) {
  assert.ok(condition, name);
  passed += 1;
  console.log(`  PASS ${name}`);
}

console.log("\nIndicF5 bounded pronunciation normalizer");
ok("the module is explicitly integrated into only the isolated IndicF5 runtime",
  read("services/indicf5-runtime/app.py").includes("from pronunciation_normalizer import") &&
  read("services/indicf5-runtime/app.py").includes('app.state.model(\n                    synthesis_text,') &&
  read("services/indicf5-runtime/contract.py").includes("pronunciation_normalization_contract_invalid") &&
  !read("services/open-voice-runtime/app.py").includes("pronunciation_normalizer"));
ok("source and synthesis text are separately content addressed",
  normalizer.includes('"source_text": source') &&
  normalizer.includes('"source_sha256": source_hash') &&
  normalizer.includes('"synthesis_sha256": synthesis_hash') &&
  normalizer.includes('"audit_sha256": _sha256(_canonical(core))'));
ok("every transformation carries exact source spans and hashes",
  normalizer.includes('"source_start_codepoint"') &&
  normalizer.includes('"source_end_codepoint"') &&
  normalizer.includes('"source_text": original') &&
  normalizer.includes('"covered_units"'));
ok("there is no network, model or broad rewrite dependency",
  !/requests|httpx|urllib|socket|transformers|openai|anthropic|generate|completion/i.test(normalizer) &&
  !/pip install|npm install|docker/i.test(normalizer));
ok("scope and expansion are hard capped",
  normalizer.includes("MAX_SOURCE_CODEPOINTS = 1_000") &&
  normalizer.includes("MAX_SYNTHESIS_CODEPOINTS = 3_000") &&
  normalizer.includes("MAX_TRANSFORMATIONS = 64") &&
  normalizer.includes("MAX_EXPANSION_RATIO = 4.0"));
ok("ambiguous charge, date and English confusables have negative controls",
  tests.includes('Fe3+ is intentionally retained') &&
  tests.includes('03/04/2026') &&
  tests.includes('He, In, As, At, I, No, Am, AI') &&
  tests.includes('vitamin B two'));
ok("the frozen mixed prompt pre-registers four symbol and three numeral units",
  tests.includes('"chemical_symbol_units": 4') &&
  tests.includes('"numeral_units": 3') &&
  tests.includes('mixed["transformation_count"] == 4'));
ok("the conditional impact math is exact and explicitly unmeasured",
  expectedImpact.baselineAsrDisagreement.chemicalSymbols.errors -
    expectedImpact.deterministicallyCoveredErrorUnits.chemicalSymbols ===
    expectedImpact.preRegisteredIfEveryCoveredUnitResolvesAndNoOtherUnitRegresses.chemicalSymbols.remainingErrors &&
  expectedImpact.baselineAsrDisagreement.numerals.errors -
    expectedImpact.deterministicallyCoveredErrorUnits.numerals ===
    expectedImpact.preRegisteredIfEveryCoveredUnitResolvesAndNoOtherUnitRegresses.numerals.remainingErrors &&
  expectedImpact.status === "integrated_not_resynthesized" &&
  expectedImpact.sealedMappingIncluded === false);

const executed = spawnSync("python", ["evals/indicf5-pronunciation/test_normalizer.py"], {
  cwd: root,
  encoding: "utf8",
});
assert.equal(executed.status, 0, executed.stderr || executed.stdout);
ok("deterministic executable and negative controls pass",
  executed.stdout.includes("indicf5-pronunciation-normalizer-pass"));

const compiled = spawnSync("python", ["-m", "py_compile",
  "services/indicf5-runtime/pronunciation_normalizer.py",
  "evals/indicf5-pronunciation/test_normalizer.py"], {
  cwd: root,
  encoding: "utf8",
});
ok("normalizer and executable test compile", compiled.status === 0);

console.log(`\n${passed}/${passed} pronunciation normalizer checks passed.`);
