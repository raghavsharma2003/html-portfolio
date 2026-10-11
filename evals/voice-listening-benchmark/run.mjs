import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  AXES,
  BENCHMARK_VERSION,
  DISCLOSURE_OPTIONS,
  buildCells,
  canonical,
  commonTargetRms,
  normaliseAndPad,
  opaqueId,
  opaqueReport,
  parseWav,
  sha256,
  tonePcm,
  unsealedReport,
  validateSheet,
  wrapWav,
} from "./lib.mjs";
import { serveListeningBenchmark } from "./server.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
let checks = 0;
function ok(name, value) {
  assert.ok(value, name);
  console.log(`ok ${++checks} - ${name}`);
}

ok("contract is versioned", BENCHMARK_VERSION === "vyakti-voice-listening-benchmark/v1");
ok("the four required perceptual axes are separate", AXES.map((axis) => axis.id).join(",") === "owner_likeness,naturalness,indian_accent,pronunciation");
ok("disclosure is full, partial or absent rather than a fake quality score", DISCLOSURE_OPTIONS.map((option) => option.id).join(",") === "full,partial,absent");
ok("canonical JSON ignores object insertion order", canonical({ b: 2, a: 1 }) === canonical({ a: 1, b: 2 }));

const secret = Buffer.alloc(32, 7);
const otherSecret = Buffer.alloc(32, 8);
const firstId = opaqueId(secret, "pack", "source");
ok("opaque ids are 24 lowercase hex characters", /^[0-9a-f]{24}$/.test(firstId));
ok("opaque ids are deterministic inside a run", firstId === opaqueId(secret, "pack", "source"));
ok("a new run secret changes every listener-facing id", firstId !== opaqueId(otherSecret, "pack", "source"));

const toneA = tonePcm({ frequency: 440, durationMs: 650, amplitude: 0.08 });
const toneB = tonePcm({ frequency: 550, durationMs: 900, amplitude: 0.12 });
const wavA = wrapWav(toneA);
const parsedA = parseWav(wavA);
ok("canonical WAV round-trips as 24 kHz mono PCM16", parsedA.sampleRate === 24_000 && parsedA.channels === 1 && parsedA.bitsPerSample === 16 && parsedA.pcm.equals(toneA));

const badRate = Buffer.from(wavA);
badRate.writeUInt32LE(16_000, 24);
let badRateRefused = false;
try { parseWav(badRate); } catch (error) { badRateRefused = error.message === "benchmark_wav_format_invalid"; }
ok("non-24 kHz input fails closed", badRateRefused);

const targetRms = commonTargetRms([toneA, toneB]);
const targetSamples = Math.max(toneA.length, toneB.length) / 2;
const treatedA = normaliseAndPad(toneA, { targetRms, samples: targetSamples });
const treatedB = normaliseAndPad(toneB, { targetRms, samples: targetSamples });
ok("normalisation never exceeds the registered peak ceiling", Math.max(...[treatedA, treatedB].map((entry) => {
  const parsed = parseWav(wrapWav(entry.pcm));
  let peak = 0;
  for (let cursor = 0; cursor < parsed.pcm.length; cursor += 2) peak = Math.max(peak, Math.abs(parsed.pcm.readInt16LE(cursor)) / 32768);
  return peak;
})) <= 0.92001);
ok("padding gives different source clips one sample count", treatedA.pcm.length === treatedB.pcm.length);
ok("padding gives different source clips one WAV byte length", wrapWav(treatedA.pcm).length === wrapWav(treatedB.pcm).length);
ok("the padded source duration is the longest source duration", parseWav(wrapWav(treatedA.pcm)).durationMs === 900);

const stimuli = [
  { id: "s1", candidateId: "candidate-a", language: "Hindi", textSha256: sha256("same") },
  { id: "s2", candidateId: "candidate-b", language: "Hindi", textSha256: sha256("same") },
  { id: "s3", candidateId: "candidate-c", language: "English", textSha256: sha256("same") },
  { id: "s4", candidateId: "candidate-c", language: "Hindi", textSha256: sha256("unique") },
];
const cells = buildCells(stimuli);
ok("exact language and text hash form one matched cell", cells.filter((cell) => cell.comparison === "matched_text").length === 1 && cells.find((cell) => cell.comparison === "matched_text").stimulusIds.length === 2);
ok("the same text in another language is not silently matched", cells.find((cell) => cell.language === "English").comparison === "unmatched_lane");
ok("a singleton remains an unmatched lane", cells.find((cell) => cell.textSha256 === sha256("unique")).comparison === "unmatched_lane");

const axesAnswer = Object.fromEntries(AXES.map((axis, index) => [axis.id, index + 2]));
const privateStimuli = stimuli.slice(0, 2).map((stimulus, index) => ({
  ...stimulus,
  candidateLabel: `Candidate ${index + 1}`,
  pack: `pack-${index + 1}`,
  cellId: cells.find((cell) => cell.stimulusIds.includes(stimulus.id)).id,
}));
const sequence = [
  { kind: "rating", trialId: "rating-1", stimulusId: "audio-1", sourceStimulusId: "s1", language: "Hindi" },
  { kind: "attention", trialId: "attention-1", stimulusId: "tone-1", correct: "tone" },
  { kind: "rating", trialId: "rating-2", stimulusId: "audio-2", sourceStimulusId: "s2", language: "Hindi" },
  { kind: "rating", trialId: "rating-repeat", stimulusId: "audio-repeat", sourceStimulusId: "s1", language: "Hindi" },
  { kind: "attention", trialId: "attention-2", stimulusId: "tone-2", correct: "tone" },
];
const publicTrials = {
  sequence: sequence.map((trial) => trial.kind === "attention"
    ? { kind: trial.kind, trialId: trial.trialId, stimulusId: trial.stimulusId, options: [{ id: "tone", label: "A tone" }] }
    : { kind: trial.kind, trialId: trial.trialId, stimulusId: trial.stimulusId, language: trial.language }),
};
const key = {
  contract: BENCHMARK_VERSION,
  runId: "fixture-run",
  policy: { minimumCatchRate: 1 },
  sequence,
  stimuli: privateStimuli,
  cells: cells.filter((cell) => cell.stimulusIds.every((id) => ["s1", "s2"].includes(id))),
  repeats: [{ pairId: "repeat-pair", originalTrialId: "rating-1", repeatTrialId: "rating-repeat" }],
};
const completeSheet = {
  runId: "fixture-run",
  listener: "listener",
  complete: true,
  answers: {
    "rating-1": { ...axesAnswer, disclosure: "full" },
    "attention-1": { choice: "tone" },
    "rating-2": { ...axesAnswer, naturalness: 5, disclosure: "partial" },
    "rating-repeat": { ...axesAnswer, owner_likeness: 3, disclosure: "full" },
    "attention-2": { choice: "tone" },
  },
};
ok("a complete rating sheet validates", validateSheet(completeSheet, publicTrials, key.runId).valid);
const missingAxis = structuredClone(completeSheet);
delete missingAxis.answers["rating-1"].naturalness;
ok("a missing axis invalidates the sheet", !validateSheet(missingAxis, publicTrials, key.runId).valid);
const wrongCatch = structuredClone(completeSheet);
wrongCatch.answers["attention-2"].choice = "silence";
const rejectedReport = opaqueReport({ key, trials: publicTrials, sheets: [wrongCatch] });
ok("one failed attention trial excludes the listener", rejectedReport.acceptedListeners === 0 && rejectedReport.listeners[0].catchRate === 0.5);
const opaque = opaqueReport({ key, trials: publicTrials, sheets: [completeSheet] });
ok("a complete attentive listener is accepted", opaque.acceptedListeners === 1);
ok("the opaque report keeps the model mapping sealed", opaque.modelMapping === "sealed" && !JSON.stringify(opaque).includes("Candidate 1"));
ok("hidden repeats measure consistency without becoming a winner", opaque.repeatConsistency.length === 1 && opaque.repeatConsistency[0].perListener[0].meanAbsoluteDelta === 0.25);
const revealed = unsealedReport({ key, trials: publicTrials, sheets: [completeSheet] });
ok("unsealing reports the exact matched cell", revealed.matchedCells.length === 1 && revealed.matchedCells[0].candidates.length === 2);
ok("hidden repeats do not inflate a candidate's model-evidence n", revealed.matchedCells[0].candidates.every((candidate) => candidate.n === 1));
ok("unsealing still refuses to invent a cross-provider winner", revealed.crossProviderWinner === null && /No exact text cell/.test(revealed.crossProviderWinnerReason));
let emptyUnsealRefused = false;
try { unsealedReport({ key, trials: publicTrials, sheets: [] }); } catch (error) { emptyUnsealRefused = error.message === "benchmark_no_accepted_listener"; }
ok("unsealing without an accepted listener fails closed", emptyUnsealRefused);

const home = mkdtempSync(join(tmpdir(), "vyakti-listen-benchmark-"));
const paths = {
  runId: "fixture-run",
  served: join(home, "served"),
  answers: join(home, "answers"),
};
mkdirSync(join(paths.served, "stimuli"), { recursive: true });
mkdirSync(paths.answers, { recursive: true });
writeFileSync(join(paths.served, "page.html"), "<!doctype html><title>fixture</title>");
writeFileSync(join(paths.served, "manifest.json"), JSON.stringify({ contract: BENCHMARK_VERSION, runId: paths.runId }));
writeFileSync(join(paths.served, "trials.json"), JSON.stringify(publicTrials));
const servedId = "0123456789abcdef01234567";
writeFileSync(join(paths.served, "stimuli", `${servedId}.wav`), wrapWav(treatedA.pcm));

try {
  const server = await serveListeningBenchmark(paths, 0);
  const port = server.address().port;
  const get = (path) => fetch(`http://127.0.0.1:${port}${path}`);
  try {
    ok("the loopback listener serves the page", (await get("/")).status === 200);
    ok("the loopback listener serves only opaque audio ids", (await get(`/stimuli/${servedId}.wav`)).status === 200 && (await get("/stimuli/model.wav")).status === 404);
    ok("the sealed key is unreachable", (await get("/private/sealed-key.json")).status === 404);
    ok("encoded traversal cannot reach the sealed key", (await get("/stimuli/%2e%2e%2f%2e%2e%2fprivate%2fsealed-key.json")).status === 404);
    const saved = await fetch(`http://127.0.0.1:${port}/answers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...completeSheet, listener: "listener ../unsafe" }),
    });
    ok("an answer sheet saves through the local route", saved.status === 200);
    ok("listener names are filename-safe", existsSync(join(paths.answers, "listenerunsafe.json")));
  } finally {
    server.close();
  }
} finally {
  rmSync(home, { recursive: true, force: true });
}

const refusal = spawnSync(process.execPath, [join(ROOT, "scripts", "voice-listening-benchmark.mjs"), "unseal", "--home", join(tmpdir(), "missing-benchmark")], {
  cwd: ROOT,
  encoding: "utf8",
});
ok("the CLI refuses an accidental unseal without explicit confirmation", refusal.status === 1 && refusal.stderr.includes("benchmark_unseal_requires_confirm_ratings_locked"));

const actualPack = join(ROOT, "scratchpad", "voice-listening-benchmark-20260828", "private", "sealed-key.json");
if (existsSync(actualPack)) {
  const verification = spawnSync(process.execPath, [join(ROOT, "scripts", "voice-listening-benchmark.mjs"), "verify"], { cwd: ROOT, encoding: "utf8" });
  ok("the actual 15-clip pack passes its source-bound integrity audit", verification.status === 0 && verification.stdout.includes("18/18 checks passed"));
} else {
  console.log("skip - actual scratchpad pack is absent; deterministic mechanics still ran");
}

const page = readFileSync(join(ROOT, "evals", "voice-listening-benchmark", "page.html"), "utf8");
ok("the listener page has no external CDN, font or analytics request", !/(https?:\/\/|cdn|analytics|googleapis)/i.test(page));
ok("the listener page never displays a native audio duration control", !/<audio\b/i.test(page) && !/controls\s*=/.test(page));

console.log(`\n1..${checks}`);
console.log("voice listening benchmark: mechanics verified. No human quality result was created.");
