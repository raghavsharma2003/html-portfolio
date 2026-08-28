import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const model = await import(pathToFileURL(join(ROOT, "src/studio/studioTestMode.ts")));

let failed = 0;
const ok = (name, condition, extra = "") => {
  if (condition) console.log(`  ok  ${name}`);
  else {
    failed++;
    console.log(`FAIL  ${name}${extra ? `\n      ${extra}` : ""}`);
  }
};

const missing = (code, label) => ({ code, label, owner: "you", cls: "you", note: label, anchor: `#${code}` });
const base = {
  emberStep: "feed",
  steps: [
    { id: "feed", number: 1, title: "Feed it", promise: "Feed", state: "waiting", ember: true,
      missing: [missing("source_consent_required", "Source consent")], statusLabel: "Your turn", top: missing("source_consent_required", "Source consent") },
    { id: "meet", number: 2, title: "Meet it", promise: "Meet", state: "waiting", ember: false,
      missing: [missing("identity_not_verified", "Identity verification"), missing("liveness_not_verified", "Liveness verification")],
      statusLabel: "Your turn", top: missing("identity_not_verified", "Identity verification") },
    { id: "deploy", number: 3, title: "Deploy it", promise: "Deploy", state: "later", ember: false,
      missing: [missing("inference_consent_required", "Inference consent")], statusLabel: "Not started", top: missing("inference_consent_required", "Inference consent") },
  ],
};

const ceremony = /consent|permission|verification|liveness|compliance|readiness|activate|deploy|publish/i;
const naive = { ...base, steps: base.steps.filter((step) => step.id !== "deploy") };
ok("negative control: filtering Deploy alone leaves verification ceremony behind", ceremony.test(JSON.stringify(naive)));

for (const [mode, environment] of [
  [undefined, undefined], ["", ""], ["true", undefined], ["true", "production"],
  ["TRUE", "internal-owner-testing"], [" true ", "internal-owner-testing"],
  [true, "internal-owner-testing"], ["true", " internal-owner-testing "],
]) {
  ok(`the presentation guard rejects ${String(mode)} / ${String(environment)}`,
    model.studioSelfTestUiEnabled(mode, environment) === false);
}
ok("the presentation guard accepts only the exact internal-owner-testing pair",
  model.studioSelfTestUiEnabled("true", "internal-owner-testing"));

const testView = model.selfTestWizard(base);
ok("test mode is a two-step source-first flow", testView.steps.length === 2 && testView.steps.map((step) => step.id).join(",") === "feed,meet");
ok("source guidance never blocks interaction",
  testView.steps.every((step) => step.missing.length === 0 && step.top === null)
  && testView.steps[1].statusLabel === "Available now");
ok("test mode carries no consent, verification, readiness, activation, or publishing ceremony",
  !ceremony.test(JSON.stringify(testView)), JSON.stringify(testView));
ok("the production wizard object is not mutated", base.steps.length === 3 && base.steps[1].missing.length === 2);

const studio = readFileSync(join(ROOT, "src/studio/StudioApp.tsx"), "utf8");
const enrollment = readFileSync(join(ROOT, "src/studio/EnrollmentWorkspace.tsx"), "utf8");
const contextLocker = readFileSync(join(ROOT, "src/studio/ContextLockerPanel.tsx"), "utf8");
const videoEnroll = readFileSync(join(ROOT, "src/studio/VideoEnrollPanel.tsx"), "utf8");
const channelWatch = readFileSync(join(ROOT, "src/studio/IngestChannelStudio.tsx"), "utf8");
const voiceExperiment = readFileSync(join(ROOT, "src/studio/VoiceExperimentPanel.tsx"), "utf8");
const voiceExperimentContract = readFileSync(join(ROOT, "src/studio/voiceExperiment.ts"), "utf8");
ok("the self-test presentation is gated by exact Vite mode and environment flags",
  /VITE_REPLICA_SELF_TEST_MODE/.test(studio)
  && /VITE_REPLICA_SELF_TEST_ENVIRONMENT/.test(studio)
  && /studioSelfTestUiEnabled/.test(studio));
ok("test mode removes verification and review panels and has no Deploy step to mount activation or publishing",
  /!testEnvironment && <Band[\s\S]{0,3000}<IdentityProofing[\s\S]{0,3000}<LivenessCapture[\s\S]{0,3000}<ModelConsentGate/.test(studio)
  && /!testEnvironment && <ProcessingReview/.test(studio)
  && /selfTestWizard\(base\)/.test(studio)
  && /STUDIO_SELF_TEST_UI && step === "deploy" \? "feed" : step/.test(studio));
ok("test source intake opens immediately without silently recording an account attestation",
  /const intakeOpen = testEnvironment \|\| consentActive/.test(enrollment)
  && !/testGrantAttempted/.test(enrollment)
  && /!testEnvironment && <article className=\{`consent-panel/.test(enrollment));
ok("test upload defaults to owner-only and removes identity-document and people declarations",
  /useState<boolean \| null>\(testEnvironment \? false : null\)/.test(enrollment)
  && /!testEnvironment && <option value="identity_document"/.test(enrollment)
  && /!testEnvironment && uploadMode !== "identity_document"/.test(enrollment));
ok("YouTube video and channel intake remain mounted in test mode",
  /<VideoEnrollPanel/.test(studio) && /<IngestChannelStudio/.test(studio)
  && !/!testEnvironment && <VideoEnrollPanel/.test(studio)
  && !/!testEnvironment && <IngestChannelStudio/.test(studio));
ok("the test guide exposes the five source types without an item-count gate",
  ["Audio or video file", "Screenshot, document, or text file", "Text or web link", "YouTube video", "YouTube channel"]
    .every((label) => studio.includes(label))
  && !/TEST_SOURCE_TARGET|testSourceCount|five-source target/i.test(studio));
ok("testing removes the Context Locker acknowledgement click without blocking exports",
  /useState\(testEnvironment\)/.test(contextLocker)
  && /!testEnvironment && <label className="model-consent-check context-ack"/.test(contextLocker));
ok("testing removes YouTube video attestation clicks while preserving the server payload",
  /testEnvironment \|\| VIDEO_ATTESTATIONS/.test(videoEnroll)
  && /!testEnvironment && <fieldset>/.test(videoEnroll)
  && /VIDEO_ATTESTATIONS\.map\(\(key\) => \[key, true\]\)/.test(videoEnroll));
ok("testing records the channel predicate and starts the watch in one action",
  /testEnvironment && !liveFor\(channelUrl\)/.test(channelWatch)
  && /await attestChannel[\s\S]{0,300}await startChannelWatch/.test(channelWatch)
  && /!testEnvironment && !attested/.test(channelWatch));
ok("Meet exposes one compact owner-only blind voice experiment without a new public API",
  /<VoiceExperimentPanel[\s\S]{0,160}replicaId=\{replica\.replica_id\}/.test(studio)
  && /<details className="voice-experiment"/.test(voiceExperiment)
  && !/replicaRequest|fetch\(/.test(voiceExperiment));
ok("the Studio experiment keeps identities sealed until a seal-bound accepted report is imported",
  /parseVoiceExperimentResult/.test(voiceExperiment)
  && /!file \|\| !bundle \|\| !lockedAt/.test(voiceExperiment)
  && /result\.sealedKeySha256 !== bundle\.manifest\.sealedKeySha256/.test(voiceExperimentContract)
  && /boundedInt\(result\.acceptedListeners, 1, 100/.test(voiceExperimentContract)
  && /overallWinner !== null/.test(voiceExperimentContract));
ok("the Studio experiment saves locally and keeps an explicit portable answer path",
  /saveVoiceExperimentBundle/.test(voiceExperiment)
  && /localStorage\.setItem\(progressKey/.test(voiceExperiment)
  && /Export progress/.test(voiceExperiment)
  && /Import progress/.test(voiceExperiment)
  && /import-studio-answers/.test(voiceExperiment));
ok("the Studio experiment counts only completed playback and makes its final lock irreversible",
  /audio\.onended = \(\) => \{[\s\S]{0,180}setReferencePlayed\(true\)[\s\S]{0,180}setPlayedTrialId\(playedTrial\)/.test(voiceExperiment)
  && /audioRef\.current\.onended = null/.test(voiceExperiment)
  && !/await audio\.play\(\)[\s\S]{0,120}set(?:ReferencePlayed|PlayedTrialId)/.test(voiceExperiment)
  && /setLockedAt\(new Date\(\)\.toISOString\(\)\)/.test(voiceExperiment)
  && /Locking is irreversible in Studio/.test(voiceExperiment)
  && !/Review ratings/.test(voiceExperiment));
ok("the Studio experiment exposes progress and keyboard focus semantics",
  /role="progressbar"/.test(voiceExperiment)
  && /aria-valuemin=\{0\}/.test(voiceExperiment)
  && /aria-valuemax=\{total\}/.test(voiceExperiment)
  && /aria-valuenow=\{completed\}/.test(voiceExperiment)
  && /aria-valuetext=\{`\$\{completed\} of \$\{total\} ratings complete`\}/.test(voiceExperiment));
ok("the Studio experiment verifies an asymmetric private-pack signature before revealing identities",
  /crypto\.subtle\.verify/.test(voiceExperimentContract)
  && /RSASSA-PKCS1-v1_5/.test(voiceExperimentContract)
  && /await verifyVoiceExperimentReportAttestation/.test(voiceExperimentContract)
  && /await parseVoiceExperimentResult/.test(voiceExperiment)
  && /Signature verified/.test(voiceExperiment)
  && !/Seal matched/.test(voiceExperiment));
ok("the Studio experiment can replace or remove one bounded replica run",
  /deleteVoiceExperimentBundle\(replicaId, runId\)/.test(voiceExperiment)
  && /clearStoredRun\(replicaId, runId\)/.test(voiceExperiment)
  && /Replace pack/.test(voiceExperiment)
  && /Remove private experiment/.test(voiceExperiment)
  && /window\.confirm/.test(voiceExperiment)
  && /objectStore\(STORE_NAME\)\.delete\(`\$\{replicaId\}:\$\{runId\}`\)/.test(voiceExperimentContract));

console.log(failed ? `\n${failed} FAILURES` : "\nALL PASS");
process.exit(failed ? 1 : 0);
