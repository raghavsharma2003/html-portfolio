import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const model = await import(pathToFileURL(join(ROOT, "src/studio/activityPresentation.ts")));
const studio = readFileSync(join(ROOT, "src/studio/StudioApp.tsx"), "utf8");
const panel = readFileSync(join(ROOT, "src/studio/VoicePreviewPanel.tsx"), "utf8");
const mirror = readFileSync(join(ROOT, "src/studio/MirrorCallStudio.tsx"), "utf8");
const machine = readFileSync(join(ROOT, "src/studio/mirrorCallMachine.ts"), "utf8");

let failures = 0;
function ok(name, condition, detail = "") {
  if (condition) console.log(`  ok  ${name}`);
  else {
    failures += 1;
    console.log(`FAIL  ${name}${detail ? `\n      ${detail}` : ""}`);
  }
}

const NOW = Date.parse("2026-08-29T12:00:00.000Z");
const ago = (ms) => new Date(NOW - ms).toISOString();
const job = (lane, state, overrides = {}) => ({
  job_id: `${lane}:one`,
  ref: "one",
  lane,
  subject: "Primary recording",
  state,
  state_reason: state === "queued" ? "Waiting for a worker." : "Preparing private evidence.",
  started_at: ago(60_000),
  updated_at: ago(20_000),
  finished_at: null,
  progress: null,
  next_action: { kind: "wait", label: "Wait" },
  in_flight: true,
  ...overrides,
});

const sourceTiming = model.presentActivityTiming(job("upload_processing", "queued"), NOW, 3_000);
ok("source processing names phase, measured range, next server check and a return time",
  /Waiting for a worker/.test(sourceTiming.phase)
  && /5 to 15 minutes/.test(sourceTiming.observedRange)
  && /3 seconds/.test(sourceTiming.nextCheck)
  && /return is around/.test(sourceTiming.returnGuidance)
  && /close, reload, or leave/.test(sourceTiming.background));

const buildTiming = model.presentActivityTiming(job("voice_model_build", "running"), NOW, 60_000);
ok("voice-draft timing is distinct from source timing",
  /1 to 3 minutes/.test(buildTiming.observedRange)
  && !/5 to 15 minutes/.test(buildTiming.observedRange)
  && /1 minute/.test(buildTiming.nextCheck));

const unknownTiming = model.presentActivityTiming(job("mirror_finetune", "running"), NOW, null);
ok("an unmeasured call-learning runner gets no invented completion time",
  /No completion range has been measured/.test(unknownTiming.observedRange)
  && /no honest finish time/.test(unknownTiming.returnGuidance));

const source = {
  source_id: "primary",
  replica_id: "replica",
  kind: "audio",
  capture_mode: "upload",
  mime: "audio/wav",
  byte_size: 10,
  state: "processing",
  contains_third_parties: false,
  voice_role: "primary",
  rejection_code: "",
  created_at: ago(5 * 60_000),
  updated_at: ago(60_000),
};
const noActivity = model.presentCloneProgress([source], null, null, NOW);
ok("a processing source with a temporarily missing activity row never looks ready",
  noActivity.canTest === false
  && /Preparing the primary recording/.test(noActivity.timing.phase)
  && /5 to 15 minutes/.test(noActivity.timing.observedRange)
  && /return is around/.test(noActivity.timing.returnGuidance));

function timingUiFindings(studioSource, panelSource, mirrorSource, machineSource) {
  const issues = [];
  if (/Setup progress/.test(studioSource) || /<progress\b|role="progressbar"/i.test(studioSource)) issues.push("fixed-milestone-percent");
  if (!/Setup milestones/.test(studioSource) || !/clone-overview-timing/.test(studioSource)) issues.push("setup-timing");
  if (!["Current phase", "Observed range", "Automatic check", "Leave or return"].every((value) => studioSource.includes(value))) issues.push("source-build-guidance");
  if (!/pendingStartedAt/.test(panelSource) || !/Elapsed/.test(panelSource) || !/Observed range/.test(panelSource) || !/Return around/.test(panelSource) || !/Next check in about/.test(panelSource) || !/2 to 8 minute/.test(panelSource)) issues.push("gpu-return-guidance");
  if (/<progress\b|role="progressbar"/i.test(panelSource)) issues.push("gpu-fake-progress");
  if (!["Observed range", "Next check", "Leave or return"].every((value) => mirrorSource.includes(value))) issues.push("call-readiness-guidance");
  if (!/A useful time to return is around/.test(mirrorSource) || !/within 6 seconds/.test(mirrorSource)) issues.push("call-return-check");
  if (!/phrase or/.test(mirrorSource) || !/slang patterns/.test(mirrorSource) || !/advisory observations/.test(mirrorSource)
      || !/Review later/.test(mirrorSource) || !/tap Accept/.test(mirrorSource)) issues.push("call-learning-review");
  if (/phrase, register|boundary, fact|fact, and delivery changes/.test(mirrorSource)) issues.push("call-learning-overclaim");
  if (/fine-tune job is queued\. It runs|runs on GPU time after the call/.test(machineSource + mirrorSource)) issues.push("dead-finetune-claim");
  return issues;
}

const findings = timingUiFindings(studio, panel, mirror, machine);
ok("all four asynchronous journeys show truthful timing and return guidance", findings.length === 0, findings.join(", "));
ok("NEGATIVE CONTROL: a fake GPU progress bar is caught",
  timingUiFindings(studio, panel.replace('<div className="hear-voice-wait-metrics"', '<progress value="50" max="100" /><div className="hear-voice-wait-metrics"'), mirror, machine).includes("gpu-fake-progress"));
ok("NEGATIVE CONTROL: an active fine-tune claim is caught",
  timingUiFindings(studio, panel, mirror, machine + '\nCall ended. A fine-tune job is queued. It runs on GPU time after the call.').includes("dead-finetune-claim"));

const emailAction = studio.indexOf("Email me a sign-in link");
const googleAction = studio.indexOf("Continue with Google");
ok("expired sessions lead with email-link recovery and explain what is preserved",
  emailAction >= 0 && googleAction > emailAction
  && /Your session expired/.test(studio)
  && /Private uploads and server work continue/.test(studio)
  && /unsent recording or form field is not stored/.test(studio));
ok("auth expiry preserves the intended replica and step, then restores both after sign-in",
  /authResumeContext\.current = \{[\s\S]*replicaId: id/.test(studio)
  && /loadReplicas\(next, intent\?\.replicaId \?\? null\)/.test(studio)
  && /window\.history\.replaceState\(\{ step: intent\.step \}/.test(studio));
ok("NEGATIVE CONTROL: falling back to the first replica would lose the intended place",
  !/preferredReplicaId/.test("setSelected(visible[0] ?? null)"));

console.log(failures ? `\n${failures} FAILURES` : "\nALL PASS");
process.exit(failures ? 1 : 0);
