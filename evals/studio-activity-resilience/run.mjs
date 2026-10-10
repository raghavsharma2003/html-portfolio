import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const model = await import(pathToFileURL(join(ROOT, "src/studio/activityPresentation.ts")));

let failures = 0;
function ok(name, condition, extra = "") {
  if (condition) console.log(`  ok  ${name}`);
  else {
    failures++;
    console.log(`FAIL  ${name}${extra ? `\n      ${extra}` : ""}`);
  }
}

const NOW = Date.parse("2026-08-29T12:00:00.000Z");
const isoAgo = (ms) => new Date(NOW - ms).toISOString();
const job = (overrides = {}) => ({
  job_id: "upload_processing:primary",
  ref: "primary",
  lane: "upload_processing",
  subject: "Audio recording",
  state: "queued",
  state_reason: "Received. Waiting for a worker to pick it up.",
  started_at: isoAgo(60_000),
  updated_at: isoAgo(60_000),
  finished_at: null,
  progress: null,
  next_action: { kind: "wait", label: "Wait" },
  in_flight: true,
  ...overrides,
});

const justInside = model.presentActivityTiming(job({ started_at: isoAgo(5 * 60_000 + 59_000) }), NOW);
const missed = model.presentActivityTiming(job({ started_at: isoAgo(6 * 60_000) }), NOW);
ok("queued work distinguishes the normal pickup window from a missed worker window",
  justInside.tone === "active"
  && missed.tone === "delayed"
  && /past the normal five-minute pickup window/.test(missed.detail));
const sourceGuidance = model.presentActivityTiming(job(), NOW, 3_000);
ok("source timing shows an observed range, next check, background behavior and return time",
  /5 to 15 minutes/.test(sourceGuidance.observedRange)
  && /3 seconds/.test(sourceGuidance.nextCheck)
  && /close, reload, or leave/.test(sourceGuidance.background)
  && /return is around/.test(sourceGuidance.returnGuidance));

const moving = model.presentActivityTiming(job({
  state: "running",
  started_at: isoAgo(14 * 60_000),
  updated_at: isoAgo(9 * 60_000 + 59_000),
}), NOW);
const stale = model.presentActivityTiming(job({
  state: "running",
  started_at: isoAgo(20 * 60_000),
  updated_at: isoAgo(10 * 60_000),
}), NOW);
ok("running work distinguishes elapsed time from a stale server update",
  moving.tone === "active"
  && stale.tone === "stale"
  && /No server update for 10 minutes/.test(stale.detail));

const platformFailure = model.presentActivityAction(job({
  state: "failed",
  state_reason: "A worker was interrupted while holding this job. It will be picked up again.",
  next_action: { kind: "fix_input", label: "Upload this recording again" },
  in_flight: false,
}));
const fileFailure = model.presentActivityAction(job({
  state: "failed",
  state_reason: "This file has no audio track in it.",
  next_action: { kind: "fix_input", label: "Upload this recording again" },
  in_flight: false,
}));
ok("platform failures never instruct the owner to re-upload",
  platformFailure.kind === "wait"
  && /No re-upload is needed/.test(platformFailure.label)
  && !/upload.*again/i.test(platformFailure.label));
ok("a server-named source defect can ask for a different recording",
  fileFailure.kind === "fix_input" && fileFailure.label === "Choose a different recording");

const source = (id, state, role) => ({
  source_id: id,
  replica_id: "replica",
  kind: "audio",
  capture_mode: "upload",
  mime: "audio/wav",
  byte_size: 100,
  state,
  contains_third_parties: false,
  voice_role: role,
  rejection_code: "",
  created_at: "2026-08-29T10:00:00.000Z",
  updated_at: "2026-08-29T10:00:00.000Z",
});
const view = (jobs, generated = "2026-08-29T12:00:00.000Z") => ({
  replica_id: "replica",
  generated_at: generated,
  jobs,
  lanes: [],
  in_flight: jobs.some((entry) => entry.in_flight),
  next_poll_ms: 3_000,
});
const runtime = (status) => ({ versions: { voice_genome: 1 }, voice_genome_status: status });

const concurrent = model.presentCloneProgress(
  [source("supporting", "ready", "supporting"), source("primary", "processing", "primary")],
  runtime("retired"),
  view([job({ progress: { done: 0, total: 8, unit: "steps" } })]),
);
ok("a ready supporting source cannot mark the primary voice prepared",
  concurrent.completed === 1
  && concurrent.primarySourceId === "primary"
  && concurrent.milestones[1].done === false
  && concurrent.milestones[1].detail === "0 of 8 source checks complete.");
ok("a retired genome is not a testable voice draft",
  concurrent.canTest === false && concurrent.next.action !== "Test your clone");

const supportingOnly = model.presentCloneProgress(
  [source("supporting", "ready", "supporting")],
  { versions: { voice_genome: 0 }, voice_genome_status: null },
  view([]),
  NOW,
);
ok("a supporting source is never silently promoted to primary",
  supportingOnly.primarySourceId === null
  && supportingOnly.completed === 0
  && supportingOnly.next.action === "Add a recording");

const ready = model.presentCloneProgress(
  [source("primary", "ready", "primary")],
  runtime("draft"),
  view([job({ state: "done", progress: { done: 8, total: 8, unit: "steps" }, in_flight: false })]),
);
ok("only a usable draft or approved genome unlocks Test clone",
  ready.canTest === true && ready.completed === 3 && ready.next.action === "Test your clone");

const handoff = model.presentCloneProgress(
  [{ ...source("primary", "ready", "primary"), updated_at: isoAgo(60_000) }],
  { versions: { voice_genome: 0 }, voice_genome_status: null },
  view([]),
  NOW,
);
ok("voice build hand-off has its own measured range and return time",
  /1 to 3 minutes/.test(handoff.timing.observedRange)
  && /once a minute/.test(handoff.timing.nextCheck)
  && /return is around/.test(handoff.timing.returnGuidance));

const sameA = view([job()], "2026-08-29T12:00:00.000Z");
const sameB = view([job()], "2026-08-29T12:00:30.000Z");
ok("generated timestamps alone do not multiply readiness refreshes",
  model.activityRevision(sameA) === model.activityRevision(sameB));
ok("an idle hand-off keeps a slow reconciliation only while the draft is pending",
  model.shouldReconcileActivity(view([], "2026-08-29T12:00:00.000Z"), true) === true
  && model.shouldReconcileActivity(view([], "2026-08-29T12:00:00.000Z"), false) === false);

const panel = readFileSync(join(ROOT, "src/studio/ActivityPanel.tsx"), "utf8");
const studio = readFileSync(join(ROOT, "src/studio/StudioApp.tsx"), "utf8");
ok("polling survives first-read failure, reconnect, focus, visibility and manual retry",
  /failures\.current \+= 1/.test(panel)
  && /addEventListener\("online", resume\)/.test(panel)
  && /addEventListener\("focus", resume\)/.test(panel)
  && /addEventListener\("visibilitychange", onVisibility\)/.test(panel)
  && /Check now/.test(panel));
ok("activity transitions refresh source, runtime and replica truth without a reload",
  /const activityKey = useMemo\(\(\) => activityRevision\(activityView\)/.test(studio)
  && /listSources\(fresh\.accessToken, selectedId\)/.test(studio)
  && /readRuntimeStatus\(fresh\.accessToken, selectedId\)/.test(studio));
ok("a pending draft also reconciles durable readiness when activity has no new revision",
  /const readinessPending = useMemo/.test(studio)
  && /readinessPending && document\.visibilityState !== "hidden"/.test(studio)
  && /IDLE_RECONCILE_MS/.test(studio)
  && /addEventListener\("online", resume\)/.test(studio)
  && /addEventListener\("visibilitychange", onVisibility\)/.test(studio));
ok("the overview no longer presents a milestone fraction as a processing percentage",
  !/aria-label="Clone setup progress"/.test(studio)
  && !/Setup progress/.test(studio)
  && /Setup milestones/.test(studio)
  && /milestones complete/.test(readFileSync(join(ROOT, "src/studio/activityPresentation.ts"), "utf8")));

// Negative controls prove the wording checks bite.
ok("NEGATIVE CONTROL: a platform failure that says upload again is caught",
  /upload.*again/i.test("Upload this recording again"));
ok("NEGATIVE CONTROL: any genome version would incorrectly unlock a retired draft",
  Boolean(runtime("retired").versions.voice_genome) === true && concurrent.canTest === false);

console.log(failures ? `\n${failures} FAILURES` : "\nALL PASS");
process.exit(failures ? 1 : 0);
