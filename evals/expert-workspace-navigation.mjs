import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
const source = readFileSync(new URL("../src/studio/workspaceNavigation.ts", import.meta.url), "utf8");
const js = ts.transpile(source, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 });
const { expertWorkspaceUrl, voiceSampleUrl, initialMeetView } = await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);
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
console.log("Expert workspace navigation: exact replica and explicit sample destination verified; both Labs use legacy generation only for issued trials.");
