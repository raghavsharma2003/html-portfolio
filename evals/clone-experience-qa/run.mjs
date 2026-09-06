import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const experience = readFileSync(resolve(root, "src/studio/CloneExperience.tsx"), "utf8");
const verification = readFileSync(resolve(root, "src/studio/CloneVerificationJourney.tsx"), "utf8");
const css = readFileSync(resolve(root, "src/studio/clone-verification-journey.css"), "utf8");
const experienceCss = readFileSync(resolve(root, "src/studio/clone-experience.css"), "utf8");
const voiceField = readFileSync(resolve(root, "src/studio/VoiceField.tsx"), "utf8");
const voiceFieldCss = readFileSync(resolve(root, "src/studio/voice-field.css"), "utf8");
const mark = readFileSync(resolve(root, "src/studio/VyaktiMark.tsx"), "utf8");
const videoEnroll = readFileSync(resolve(root, "src/studio/VideoEnrollPanel.tsx"), "utf8");
const contextLocker = readFileSync(resolve(root, "src/studio/ContextLockerPanel.tsx"), "utf8");
let checks = 0;
const ok = (label, value) => { assert.ok(value, label); console.log(`ok ${++checks} - ${label}`); };

ok("an active replacement saga suppresses old-primary rooms",
  /voiceWorkspaceReady = Boolean\(selected && consentActive && !voiceSaga && currentVoiceReady/.test(experience));
ok("knowledge can open independently while voice workspace authority stays unchanged",
  /knowledgeOpen = Boolean\(selected && consentActive && room === "enrich" && !upload && !reveal\)/.test(experience)
  && /showRooms = voiceWorkspaceReady \|\| knowledgeOpen/.test(experience)
  && /voiceWorkspaceReady && <RoomNav/.test(experience)
  && /captureState === "idle" && !sample && onKnowledge/.test(experience));
ok("the replacement candidate resolves only by its exact source or upload intent",
  /source\.source_id === voiceSaga\.sourceId \|\| source\.upload_intent_id === voiceSaga\.uploadIntentId/.test(experience));
ok("verification receives the exact active candidate",
  /candidateSourceId=\{activeCandidate\?\.source_id\}/.test(experience));
ok("a finalized idempotent replay skips private PUT and finalize",
  /operation\.finalized = created\.finalized;[\s\S]*?if \(!created\.finalized\) \{[\s\S]*?putSignedUpload/.test(experience)
  && /if \(!operation\.finalized\) \{[\s\S]*?onFinalizeUpload/.test(experience));
ok("a missing saga receipt exposes two owner recovery actions",
  /showSagaRecovery = Boolean\(selected && consentActive && voiceSaga && !activeCandidate && !upload\)/.test(experience)
  && /Check private receipt/.test(experience) && /Start again/.test(experience));
ok("an older draft cannot complete a candidate without its promoted build intent",
  /candidatePromoted = !candidateSourceId \|\| Boolean\(buildIntent/.test(verification)
  && /exactDraftReady && candidatePromoted/.test(verification));
ok("short landscape uses the verification stage as the scroll owner",
  /@media \(max-height: 660px\)[\s\S]*?\.cvj-shell\s*\{[\s\S]*?min-height:\s*0/.test(css)
  && /\.cvj-stage\s*\{[\s\S]*?overflow-y:\s*auto/.test(css));
ok("the visible ID picker receives the hidden input focus ring",
  /\.cvj-file-input:focus-visible\s*\+\s*\.cvj-file-picker/.test(css));
ok("the premium voice field is driven by microphone history rather than a canned waveform",
  /history\?\.\[sourceIndex\]/.test(voiceField)
  && /setLevelHistory\(\(current\) => \[\.\.\.current\.slice\(-95\), nextLevel\]\)/.test(experience)
  && !/animation:/.test(voiceFieldCss));
ok("the same voice field carries recording, upload, reveal, and build states",
  /<VoiceField level=\{level\} history=\{levelHistory\}/.test(experience)
  && /<VoiceField level=\{upload\.phase/.test(experience)
  && /<VoiceField level=\{0\.26\}/.test(experience)
  && /cvj-build__signal"><VoiceField calm/.test(verification));
ok("the app uses the verified Vyakti wordmark and official neutral brand palette",
  /\\u0935\\u094d\\u092f/.test(mark)
  && /<span>vyakti<\/span>/.test(mark)
  && /--vx-paper:\s*#f8f8f5/.test(experienceCss)
  && /--vx-brand-ember:\s*#b93627/.test(experienceCss));
ok("invented upload phase percentages are absent outside byte transfer",
  /upload\.phase === "hash" \? "Checking recording"/.test(experience)
  && /upload\.phase === "upload" \? `Uploading \$\{upload\.progress\}%`/.test(experience));
ok("reduced motion removes drawer travel, room blur travel, and live ray movement",
  /initial=\{reduceMotion \? false : \{ x: "-102%" \}\}/.test(experience)
  && /className="vx-scene vx-room"[\s\S]*?initial=\{reduceMotion \? false/.test(experience)
  && /active && !reduceMotion/.test(voiceField));
ok("the branded home target and short-landscape copy keep their mobile floors",
  /\.vx-wordmark\s*\{[\s\S]*?min-height:\s*44px/.test(experienceCss)
  && /@media \(max-height: 680px\)[\s\S]*?\.vx-stage-title p\s*\{[\s\S]*?font-size:\s*13px/.test(experienceCss));
ok("identity copy does not claim that a document proves voice ownership",
  /confirms your age and identity\. A separate live check connects you to the recording\./.test(verification)
  && !/ID[\s\S]{0,120}voice belongs to you/.test(verification));

const harness = readFileSync(resolve(root, "evals/clone-experience-qa/harness.tsx"), "utf8");
ok("the deterministic rooms fixture carries no active replacement saga",
  /scenario === "replacement-old-draft" \|\| scenario === "candidate-ready" \|\| scenario === "missing-receipt"/.test(harness)
  && /scenario === "missing-receipt" \|\| scenario === "rooms" \? \[oldPrimary\]/.test(harness));
ok("short landscape room panels remain scrollable above the fixed room navigation",
  /@media \(max-height: 680px\)[\s\S]*?\.vx-room__panel:not\(\.vx-room__voice\)\s*\{[\s\S]*?overflow-y:\s*auto[\s\S]*?padding-bottom:\s*60px/.test(experienceCss));
ok("malformed video availability cannot unmount the whole Add room",
  /!Array\.isArray\(nextView\.enrollments\)/.test(videoEnroll)
  && /!nextView\.limits/.test(videoEnroll)
  && /typeof nextView\.extraction_configured !== "boolean"/.test(videoEnroll));
ok("malformed private-context availability cannot unmount the whole Add room",
  /!Array\.isArray\(next\.items\)/.test(contextLocker)
  && /!next\.quota/.test(contextLocker)
  && /!Number\.isFinite\(next\.limits\.max_item_bytes\)/.test(contextLocker));

console.log(`\n${checks} clone experience QA checks passed`);
