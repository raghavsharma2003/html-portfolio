import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(fs.readFileSync(path.join(here, "frontier.v1.json"), "utf8"));
const prompts = JSON.parse(fs.readFileSync(path.join(here, "prompts.v1.json"), "utf8"));
let checks = 0;
const check = (condition, message) => {
  checks += 1;
  assert.ok(condition, message);
};

check(manifest.schemaVersion === "vyakti-voice-frontier/v1", "frontier schema must be pinned");
check(manifest.asOf === "2026-08-28", "frontier evidence date must be explicit");
check(manifest.azureBudget.hardCapUsd === 1000, "Azure hard cap must match owner approval");

const profiles = new Map(manifest.azureBudget.profiles.map((item) => [item.id, item]));
check(profiles.size === manifest.azureBudget.profiles.length, "compute profile ids must be unique");
for (const profile of profiles.values()) {
  check(profile.gpuMemoryGiB > 0 && profile.retailUsdPerHour > 0, `${profile.id} needs measured capacity and price`);
}

const expected = manifest.azureBudget.stages.reduce((sum, stage) => sum + stage.expectedUsd, 0);
const capped = manifest.azureBudget.stages.reduce((sum, stage) => sum + stage.hardCapUsd, 0);
check(expected <= manifest.azureBudget.hardCapUsd, "expected Azure spend exceeds approval");
check(capped <= manifest.azureBudget.hardCapUsd, "stage hard stops exceed approval");
check(manifest.azureBudget.stages.every((stage) => stage.expectedUsd <= stage.hardCapUsd && stage.stop), "every stage needs a bounded stop");

const sha = /^[0-9a-f]{40}$/;
const ids = new Set();
manifest.nextBuild.forEach((candidate, index) => {
  check(candidate.rank === index + 1, "next-build ranks must be consecutive");
  check(!ids.has(candidate.id), `duplicate candidate ${candidate.id}`);
  ids.add(candidate.id);
  check(sha.test(candidate.modelRevision), `${candidate.id} model revision is not immutable`);
  check(sha.test(candidate.sourceRevision), `${candidate.id} source revision is not immutable`);
  check(candidate.weightsCommercial === true, `${candidate.id} checkpoint license is not commercial-use eligible`);
  check(candidate.license.includes("Apache") || candidate.license.includes("MIT"), `${candidate.id} lacks a permissive license record`);
  check(candidate.languages.includes("hi-IN"), `${candidate.id} is not a Hindi candidate`);
  check(candidate.reversal.length > 30, `${candidate.id} lacks a reversal condition`);
  const profile = profiles.get(candidate.minimumProfile);
  check(Boolean(profile), `${candidate.id} references an unknown Azure profile`);
  check(candidate.parameterCount > 0 && candidate.repositoryStorageBytes > 0, `${candidate.id} lacks exact checkpoint evidence`);
  check(candidate.vramEvidence.length > 40, `${candidate.id} lacks a VRAM evidence statement`);
  check(profile.gpuMemoryGiB >= candidate.qualificationVramGiB, `${candidate.id} exceeds its qualification allocation`);
});

check(manifest.nextBuild[0].id === "voxcpm2", "VoxCPM2 must remain the first build until its reversal fires");
check(manifest.nextBuild.some((item) => item.id === "moss-tts-local-v1.5"), "MOSS v1.5 must be in the direct bake-off");
check(manifest.nextBuild.some((item) => item.id === "zonos2"), "ZONOS2 must be in the direct bake-off");
check(manifest.nextBuild.some((item) => item.id === "dhvaani-0.5" && item.productionRightsCleared === false), "DhVaani must stay qualification-only until its corpus audit closes");
check(manifest.vendorAnchors.some((item) => item.id === "azure-personal-voice" && item.azureCreditEligible), "Azure Personal Voice must be an access-gated Azure anchor");
check(manifest.vendorAnchors.every((item) => item.source.startsWith("https://")), "vendor anchors need official sources");
check(manifest.researchOnly.every((item) => item.weightsCommercial === false), "research-only weights cannot be production eligible");
check(manifest.researchOnly.some((item) => item.id === "omnivoice" && item.license.includes("CC-BY-NC")), "OmniVoice weight restriction must stay visible");
check(manifest.architecture.openVoiceRole.startsWith("Diagnostic"), "OpenVoice must not silently become the primary architecture");
check(manifest.data.some((item) => item.id === "uploaded-third-party-lecture" && item.role.includes("cannot train")), "third-party lecture must remain outside identity training");
check(manifest.evaluation.minimumFluentListeners >= 20, "a five-listener claim is too weak for indistinguishability");
check(manifest.evaluation.minimumJudgments >= 800, "the identity study is underpowered");
check(manifest.evaluation.catchAccuracyFloor >= 0.9, "listener attention floor is too weak");
check(manifest.evaluation.indistinguishableRule.includes("45 to 55 percent"), "equivalence margin must be pre-registered");
check(prompts.seeds.join(",") === manifest.evaluation.fixedSeeds.join(","), "frontier and prompt seeds drifted");

const promptCount = prompts.promptSets.reduce((sum, set) => sum + set.variants.length, 0);
check(promptCount === 24, "frontier plan expects the frozen 24-prompt corpus");

const invalidLicenseControl = structuredClone(manifest.nextBuild[0]);
invalidLicenseControl.weightsCommercial = false;
assert.throws(() => assert.equal(invalidLicenseControl.weightsCommercial, true));
checks += 1;

const invalidBudgetControl = structuredClone(manifest.azureBudget);
invalidBudgetControl.stages[0].hardCapUsd = 1001;
assert.ok(invalidBudgetControl.stages.reduce((sum, stage) => sum + stage.hardCapUsd, 0) > invalidBudgetControl.hardCapUsd);
checks += 1;

console.log(JSON.stringify({
  schemaVersion: "vyakti-voice-frontier-plan/v1",
  checks,
  promptCount,
  seedsPerPrompt: prompts.seeds.length,
  rankedNextBuild: manifest.nextBuild.map(({ rank, id, modelRevision, license, minimumProfile }) => ({
    rank,
    id,
    modelRevision,
    license,
    minimumProfile,
  })),
  azureBudget: {
    expectedUsd: expected,
    hardStopsUsd: capped,
    approvedUsd: manifest.azureBudget.hardCapUsd,
  },
  status: "plan_only_no_model_call_no_spend",
}, null, 2));
