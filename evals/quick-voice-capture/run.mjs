import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const capture = readFileSync(join(ROOT, "src/studio/QuickVoiceCapture.tsx"), "utf8");
const wav = readFileSync(join(ROOT, "src/studio/wavCapture.ts"), "utf8");
const enrollment = readFileSync(join(ROOT, "src/studio/EnrollmentWorkspace.tsx"), "utf8");
const fixture = readFileSync(join(ROOT, "src/studio/layoutFixture.tsx"), "utf8");
const studio = readFileSync(join(ROOT, "src/studio/StudioApp.tsx"), "utf8");
const studioCss = readFileSync(join(ROOT, "src/studio/studio.css"), "utf8");
// WS-R159: QuickVoiceCapture.tsx's own literal English strings moved into
// `copy.ts#quickVoiceCapture` (`t.` reads replaced the literals in place,
// the component's structure and every non-copy assertion below is
// unchanged); the checks that used to regex-match those literals directly
// against `capture` now check `copy.ts`'s own English table instead, the
// established `evals/studio-locale/run.mjs`'s own header pattern for a
// literal that moves file ("both evals were updated to check copy.ts ...
// instead").
const copy = readFileSync(join(ROOT, "src/studio/copy.ts"), "utf8");

let failures = 0;
function ok(name, condition) {
  if (condition) console.log(`  ok  ${name}`);
  else { failures++; console.log(`FAIL  ${name}`); }
}

const eagerNegative = `useEffect(() => { openPrivateWavCapture(); }, []);`;
ok("negative control: eager mount-time microphone access is detectable",
  /useEffect[\s\S]*openPrivateWavCapture/.test(eagerNegative));
ok("microphone access begins only in the explicit start action",
  /async function start\(\)[\s\S]*await openPrivateWavCapture/.test(capture)
  && !/useEffect\([\s\S]{0,300}openPrivateWavCapture/.test(capture));
// Execute the actual owned helper, including partial acquisition, throwing
// disconnects and its cleanup-removal control. A source spelling cannot prove
// resource release. Actual component unmount/late results are separately
// exercised by capture-lifetime and recorder-lifecycle's mounted fixtures.
let cleanupVerified = false;
try {
  execFileSync(process.execPath, [join(ROOT, "evals/wav-capture-cleanup.mjs")], {
    cwd: ROOT, encoding: "utf8", timeout: 30_000, stdio: "pipe",
  });
  cleanupVerified = true;
} catch (cause) {
  console.error("Actual owned-helper cleanup proof failed:", cause.stdout?.toString() || "", cause.stderr?.toString() || cause.message);
}
ok("owned WAV helper closes acquired microphone resources (actual helper suite)", cleanupVerified);
ok("the guided session has an honest minimum, target and hard maximum",
  /MINIMUM_MS = 12_000/.test(capture)
  && /TARGET_MS = 30_000/.test(capture)
  && /MAXIMUM_MS = 60_000/.test(capture)
  && /too short/i.test(copy));
ok("Hindi, Hinglish and Indian English have distinct visible prompts",
  /english:[\s\S]*lang: "en-IN"/.test(capture)
  && /hindi:[\s\S]*lang: "hi"/.test(capture)
  && /hinglish:[\s\S]*naturally Hindi aur English/.test(capture));
ok("live input level is measured from real samples without modifying captured PCM",
  /energy \+= sample \* sample/.test(wav)
  && /samplePeak = Math\.max\(samplePeak, Math\.abs\(sample\)\)/.test(wav)
  && /options\.onLevel\([\s\S]*samplePeak/.test(wav)
  && /chunks\.push\(samples\.slice\(\)\)/.test(wav));
ok("clean capture finishes and starts the clone in one action after the minimum",
  /finish\(true\)/.test(capture)
  && /finishAndBuild: "Finish and build"/.test(copy)
  && /disabled=\{elapsedMs < MINIMUM_MS\}/.test(capture)
  && /onUseRecording\(renamed, language\)/.test(capture));
ok("quality failure keeps playback and a clear retake path",
  /<audio controls preload="metadata"/.test(capture)
  && /retakeNeeded: "Retake needed"/.test(copy)
  && /recordAgain: "Record again"/.test(copy)
  && /samplePeakRef\.current >= 0\.995/.test(capture)
  && /audibleRatio < 0\.35/.test(capture));
ok("recording timer is not a rapidly repeating live region",
  /<div className="quick-voice-live">/.test(capture)
  && /recordingVisuallyHidden: "Recording started\. Finish and build becomes available after 12 seconds\."/.test(copy)
  && !/className="quick-voice-live" role="status" aria-live="polite"/.test(capture));
ok("accepted capture becomes a named 24 kHz WAV in the existing source queue",
  /new File\(\[result\.file\]/.test(capture)
  && /type: "audio\/wav"/.test(capture)
  && /selectFiles\(\[recording\], language, true\)/.test(enrollment)
  && /setContainsThirdParties\(false\)/.test(enrollment)
  && /setAutoUploadKey\(fileKey\(recording\)\)/.test(enrollment)
  && /onPrimaryVoiceQueued\?\.\(queuedPrimary\)/.test(enrollment));
ok("recording is the primary audio path while existing file upload remains available",
  /uploadMode === "audio" && files\.length === 0/.test(enrollment)
  && /<QuickVoiceCapture/.test(enrollment)
  && /Upload an existing audio file instead/.test(enrollment)
  && /<details className="file-upload-alternative"/.test(enrollment));
ok("capture copy states the real short-window pipeline instead of promising full-file conditioning",
  /more clean speech to choose from/i.test(copy)
  && /keep it private/i.test(copy)
  && !/more audio (?:always )?(?:means|guarantees) better/i.test(capture)
  && !/more audio (?:always )?(?:means|guarantees) better/i.test(copy));
ok("free speech is primary and the written prompt is optional",
  /Talk naturally about anything/.test(copy)
  && /Show an optional prompt/.test(copy)
  && /You do not have to read this/.test(copy));
ok("loopback fixture completes create, byte upload and finalize instead of returning a blank shape",
  /op === "create_upload"/.test(fixture)
  && /__fixture-private-upload/.test(fixture)
  && /op === "finalize"/.test(fixture)
  && /window\.XMLHttpRequest = FixtureUploadRequest/.test(fixture));
ok("clean capture advances directly to the preview task in Meet",
  /onPrimaryVoiceQueued=\{\(\) => \{[\s\S]*params\.set\("view", "preview"\)[\s\S]*setMeetView\("preview"\)[\s\S]*onGoStep\("meet"\)/.test(studio));
ok("Meet mounts one selected task while advanced work stays in Review",
  /meetView === "preview" && <Band/.test(studio)
  && /meetView === "call" && <Band/.test(studio)
  && /meetView === "review" && <>/.test(studio)
  && /meetView === "review"[\s\S]*Run a blind voice comparison/.test(studio));
ok("processing has one in-flow status surface instead of a fixed overlay",
  /<LiveWorkToast[\s\S]*<CloneOverview/.test(studio)
  && /\.live-work-toast \{[\s\S]*position: static/.test(studioCss)
  && !/\.live-work-toast \{[^}]*position: fixed/.test(studioCss));
ok("automatic recording upload failure exposes retry and retake recovery",
  /quickCaptureNeedsRecovery = quickCaptureUpload && Boolean\(uploadError\) && !uploadBusy/.test(enrollment)
  && /quickCaptureNeedsRecovery[\s\S]*Retry secure upload/.test(enrollment)
  && /discardQuickCaptureAndRetake[\s\S]*onDeleteSource\(pendingRetryId\)[\s\S]*setPendingRetryId\(null\)/.test(enrollment)
  && /Discard failed upload and record again/.test(enrollment));
ok("successful pending-source retry keeps the automatic Meet continuation",
  /async function retryUpload[\s\S]*queuedPrimary = await onSetPrimaryVoice\(sourceId\)[\s\S]*onPrimaryVoiceQueued\?\.\(queuedPrimary\)/.test(enrollment));
ok("Meet starts with its task navigation when there is no active server work",
  /step !== "meet" \? \([\s\S]*<CloneOverview/.test(studio)
  && /step === "meet" && \([\s\S]*<nav className="meet-view-tabs"/.test(studio));
// Signed-in panels now load only after authentication as well. Requiring
// eager enrollment/preview imports would undo the measured entry split.
function privatePanelsStayDeferred(source) {
  return ["MirrorCallStudio", "VoicePreviewLab", "IdentityProofing", "VoicePreviewPanel", "EnrollmentWorkspace", "CloneExperience"].every((name) =>
    source.includes(`const ${name} = lazy(() => import("./${name}"))`)
    && !source.includes(`import ${name} from "./${name}"`))
    && /<Suspense fallback=\{<DeferredWorkspacePanel \/>\}>/.test(source)
    && /import PersonalAuthGate\b[^;]*from "\.\/PersonalAuthGate"/.test(source)
    && /if \(!session\)\s*\{\s*return \(\s*<PersonalAuthGate\b[\s\S]*?\/>\s*\);\s*\}\s*if \(!STUDIO_SELF_TEST_UI\)[\s\S]*<Suspense[\s\S]*<CloneExperience/.test(source);
}
ok("phone-first source and preview code load after auth while advanced laboratories stay deferred", privatePanelsStayDeferred(studio));
ok("negative control: removing the signed-out early return breaks the boundary", !privatePanelsStayDeferred(studio.replace('if (!session) {\n    return (\n      <PersonalAuthGate', 'if (!session) {\n    (\n      <PersonalAuthGate').replace('if (!session) {\r\n    return (\r\n      <PersonalAuthGate', 'if (!session) {\r\n    (\r\n      <PersonalAuthGate')));
ok("negative control: an unrelated auth import cannot satisfy the boundary", !privatePanelsStayDeferred(studio.replace('from "./PersonalAuthGate"', 'from "./UnrelatedAuthGate"')));
for (const name of ["MirrorCallStudio", "VoicePreviewLab", "IdentityProofing", "VoicePreviewPanel", "EnrollmentWorkspace", "CloneExperience"]) {
  const eager = studio.replace(`const ${name} = lazy(() => import("./${name}"));`, `import ${name} from "./${name}";`);
  ok(`negative control: eager ${name} breaks the private-panel boundary`, !privatePanelsStayDeferred(eager));
}

console.log(failures ? `\n${failures} FAILURES` : "\nALL PASS");
process.exit(failures ? 1 : 0);
