import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const prompts = JSON.parse(fs.readFileSync(path.join(here, "prompts.v1.json"), "utf8"));
const models = JSON.parse(fs.readFileSync(path.join(here, "models.v1.json"), "utf8"));

assert.equal(prompts.schemaVersion, "vyakti-voice-bakeoff/v1");
assert.equal(models.schemaVersion, "vyakti-voice-bakeoff-models/v1");
assert.equal(prompts.referencePolicy.sameBytesAcrossArms, true);
assert.equal(prompts.referencePolicy.substitutionOnProviderRefusal, "blocked");

const allPrompts = prompts.promptSets.flatMap((set) => set.variants.map((variant) => ({
  ...variant,
  semanticGroup: set.id,
})));
assert.equal(allPrompts.length, 24);
assert.equal(prompts.seeds.length, 3);
assert.equal(new Set(prompts.seeds).size, prompts.seeds.length);
assert.equal(new Set(allPrompts.map((item) => item.id)).size, allPrompts.length);

const matched = prompts.promptSets.filter((set) => set.domain !== "english");
assert.equal(matched.length, 6);
for (const set of matched) {
  assert.deepEqual(new Set(set.variants.map((item) => item.script)), new Set(["devanagari", "latin", "mixed"]));
}

const t4 = models.azureRetailCentralIndia;
const derivedT4Hour = 3600 * (
  t4.gpuT4PerSecondUsd +
  t4.allocation.vcpu * t4.vcpuActivePerSecondUsd +
  t4.allocation.memoryGiB * t4.memoryActivePerGiBSecondUsd
);
assert.ok(Math.abs(derivedT4Hour - t4.fullyAllocatedPerHourUsd) < 1e-9);

const results = [];
let usd = 0;
let inr = 0;
for (const arm of models.arms) {
  const eligible = allPrompts.filter((item) => arm.languages.includes(item.locale));
  assert.ok(eligible.length > 0, `${arm.id} has no eligible prompts`);
  let armUsd = Number(arm.fixedBudgetUsd || 0);
  let armInr = 0;
  if (arm.estimatedActiveMinutes) {
    armUsd += arm.estimatedActiveMinutes * derivedT4Hour / 60;
  }
  if (arm.usdPerMillionCharacters) {
    armUsd += eligible.reduce((sum, item) => sum + item.text.length, 0) * prompts.seeds.length * arm.usdPerMillionCharacters / 1_000_000;
  }
  if (arm.usdPerMillionUtf8BytesFallback) {
    armUsd += eligible.reduce((sum, item) => sum + Buffer.byteLength(item.text, "utf8"), 0) * prompts.seeds.length * arm.usdPerMillionUtf8BytesFallback / 1_000_000;
  }
  if (arm.inrPerTenThousandCharacters) {
    armInr += eligible.reduce((sum, item) => sum + item.text.length, 0) * prompts.seeds.length * arm.inrPerTenThousandCharacters / 10_000;
  }
  usd += armUsd;
  inr += armInr;
  results.push({
    arm: arm.id,
    prompts: eligible.length,
    usd: Number(armUsd.toFixed(4)),
    inr: Number(armInr.toFixed(2)),
    integration: arm.integration,
  });
}

const budget = {
  phase1Bakeoff: {
    estimatedUsdBeforeSarvamFx: Number(usd.toFixed(2)),
    estimatedInr: Number(inr.toFixed(2)),
    hardCapUsd: 35,
  },
  phase2SpeakerAdapters: {
    hardCapUsd: 100,
    measuredBasis: "140.4 seconds of T4 time for 62.1 seconds of training speech",
    extrapolatedThirtyMinuteSingleRunUsd: Number((140.4 * (1800 / 62.1) * derivedT4Hour / 3600).toFixed(2)),
    extrapolatedSixtyMinuteSingleRunUsd: Number((140.4 * (3600 / 62.1) * derivedT4Hour / 3600).toFixed(2)),
  },
  phase3HindiAdaptationPilot: {
    plannedT4Hours: 116,
    estimatedAzureRetailUsd: Number((116 * derivedT4Hour).toFixed(2)),
    hardCapUsd: 250,
  },
  totalProgramHardCapUsd: 500,
};

assert.ok(budget.phase1Bakeoff.estimatedUsdBeforeSarvamFx < budget.phase1Bakeoff.hardCapUsd);
assert.ok(budget.phase3HindiAdaptationPilot.estimatedAzureRetailUsd < budget.phase3HindiAdaptationPilot.hardCapUsd);
assert.ok(budget.phase1Bakeoff.hardCapUsd + budget.phase2SpeakerAdapters.hardCapUsd + budget.phase3HindiAdaptationPilot.hardCapUsd <= budget.totalProgramHardCapUsd);

console.log(JSON.stringify({
  schemaVersion: "vyakti-voice-bakeoff-plan/v1",
  promptCount: allPrompts.length,
  seedsPerPrompt: prompts.seeds.length,
  matchedHindiHinglishGroups: matched.length,
  azureT4FullyAllocatedPerHourUsd: derivedT4Hour,
  arms: results,
  budget,
}, null, 2));
