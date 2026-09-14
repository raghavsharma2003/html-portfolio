import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
const source = readFileSync(new URL("../src/studio/workspaceNavigation.ts", import.meta.url), "utf8");
const js = ts.transpile(source, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 });
const { expertWorkspaceUrl, voiceSampleUrl, initialMeetView, firstMeetSurface, deploySurface } = await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);
const id = "123e4567-e89b-12d3-a456-426614174000";
const share = new URL(expertWorkspaceUrl(id, "share", "?mode=replica&replica=wrong&view=call&panels=1"), "https://example.test");
assert.equal(share.pathname, "/studio");
assert.equal(share.searchParams.get("replica"), id);
assert.equal(share.searchParams.get("mode"), "teacher");
assert.equal(share.searchParams.get("step"), "deploy");
assert.equal(share.searchParams.has("panels"), false);
const voice = new URL(expertWorkspaceUrl(id, "voice", share.search), share.origin);
assert.equal(voice.searchParams.get("replica"), id);
assert.equal(voice.searchParams.get("mode"), "replica");
assert.equal(voice.searchParams.get("step"), "meet");
assert.equal(voice.searchParams.get("view"), "voice");
const sample = new URL(voiceSampleUrl(id, "?mode=teacher&replica=wrong&view=call&panels=1&lang=hi"), share.origin);
assert.equal(sample.searchParams.get("replica"), id);
assert.equal(sample.searchParams.get("mode"), "replica");
assert.equal(sample.searchParams.get("view"), "voice");
assert.equal(sample.searchParams.has("panels"), false);
assert.equal(sample.searchParams.get("lang"), "hi");
assert.equal(initialMeetView(sample.search, true), "sample");
assert.equal(initialMeetView("", true), "conversation");
assert.equal(initialMeetView("", false), "sample");
assert.equal(firstMeetSurface({ voiceWorkspaceReady: false, textReady: false, hasSavedSheet: false, hasTextMaterial: true }), "feed");
assert.equal(firstMeetSurface({ voiceWorkspaceReady: false, textReady: false, hasSavedSheet: true, hasTextMaterial: false }), "feed");
assert.equal(firstMeetSurface({ voiceWorkspaceReady: false, textReady: false, hasSavedSheet: true, hasTextMaterial: true }), "private-rehearsal");
assert.equal(firstMeetSurface({ voiceWorkspaceReady: false, textReady: true, hasSavedSheet: false, hasTextMaterial: false }), "conversation");
assert.equal(firstMeetSurface({ voiceWorkspaceReady: true, textReady: false, hasSavedSheet: false, hasTextMaterial: false }), "conversation");
assert.equal(deploySurface(false), "material");
assert.equal(deploySurface(true), "room");

const experience = readFileSync(new URL("../src/studio/CloneExperience.tsx", import.meta.url), "utf8");
const contextLocker = readFileSync(new URL("../src/studio/ContextLockerPanel.tsx", import.meta.url), "utf8");
const usesActiveVoiceAuthority = (text) => /voiceWorkspaceReady = Boolean\(selected && consentActive && !voiceSaga && runtimeStatus\?\.active[\s\S]*?&& currentVoiceReady/.test(text);
assert.equal(usesActiveVoiceAuthority(experience), true);
assert.equal(usesActiveVoiceAuthority(experience.replace(
  "!voiceSaga && runtimeStatus?.active\n    && currentVoiceReady",
  "!voiceSaga && true\n    && currentVoiceReady",
)), false);
const usesExactPrivateFeedDoor = (experienceText, lockerText) =>
  experienceText.includes("onPrivateTextItemCount={onPrivateTextItemCount}")
  && experienceText.includes("if (wizardInput.sheetPersisted) {")
  && experienceText.includes('setMeetView("conversation");')
  && lockerText.includes("onPrivateTextItemCount?.(next.items.filter(isTeachableContextSource).length)");
assert.equal(usesExactPrivateFeedDoor(experience, contextLocker), true);
assert.equal(usesExactPrivateFeedDoor(experience, contextLocker.replace(
  "next.items.filter(isTeachableContextSource).length",
  "next.items.length",
)), false);

const roomApp = readFileSync(new URL("../src/room/RoomApp.tsx", import.meta.url), "utf8");
const roomUsesEmailFirst = (text) => /sendEmailOtp\(email\.trim\(\), window\.location\.pathname \+ window\.location\.search\)/.test(text)
  && /verifyEmailOtp\(email\.trim\(\), code\)/.test(text)
  && /type="email"/.test(text)
  && !/sendPhoneOtp|verifyPhoneOtp/.test(text);
assert.equal(roomUsesEmailFirst(roomApp), true);
assert.equal(roomUsesEmailFirst(roomApp.replace("sendEmailOtp(email.trim(), window.location.pathname + window.location.search)", "sendEmailOtp(email.trim())")), false);
for (const namespace of ["studio", "creatorStudio"]) {
  const lab = readFileSync(new URL(`../src/${namespace}/VoicePreviewLab.tsx`, import.meta.url), "utf8");
  assert.match(lab, /href=\{voiceSampleUrl\(replicaId, window.location.search\)\}/);
  const calls = [...lab.matchAll(/generateVoicePreview\(token, \{([^}]+)\}/g)];
  assert.equal(calls.length, 4, `${namespace} keeps both trial pairs`);
  for (const [, body] of calls) {
    assert.match(body, /trialId:/, `${namespace}: every legacy generation is an issued trial`);
    assert.match(body, /trialSide:/);
  }
}
console.log("Journey surface: exact replica navigation, lawful first Meet, voice-only Room deploy, email-first Room auth, and issued preview trials verified.");
