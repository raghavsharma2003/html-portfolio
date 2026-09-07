// Actual navigation helper and entry dispatch; browser coverage is separate.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
const root = new URL("../", import.meta.url);
const source = readFileSync(new URL("src/studio/conversationSetupNavigation.ts", root), "utf8");
const js = ts.transpile(source, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 });
const { conversationSetupUrl } = await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);
const RID = "10000000-0000-4000-8000-000000000001";
let checks = 0;
function ok(name, test) { test(); console.log(`ok ${++checks} - ${name}`); }
const entry = readFileSync(new URL("src/studio/main.tsx", root), "utf8").replaceAll("import(", "load(");
const creatorEntry = ts.transpileModule(readFileSync(new URL("src/creatorStudio/main.tsx", root), "utf8"), {
  fileName: "main.tsx", compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React },
}).outputText;
function nestedDestination(url) {
  let tree, restored = 0;
  const module = { exports: {} };
  const React = { StrictMode: "StrictMode", createElement: (type, props, ...children) => ({ type, props, children }) };
  runInNewContext(creatorEntry, { module, exports: module.exports, URLSearchParams,
    window: { location: new URL(url, "https://example.test") }, document: { getElementById: () => ({}) },
    require(name) {
      if (name === "react") return { __esModule: true, default: React };
      if (name === "react-dom/client") return { __esModule: true, default: { createRoot: () => ({ render: value => { tree = value; } }) } };
      if (name === "./StudioApp" || name === "./OpsBoard") return { __esModule: true, default: name.slice(2) };
      if (name === "./studioAuth") return { restoreStudioMode: () => { restored++; } };
      if (name === "./startSuiteDraft") return { restoreStartSuiteDraft: () => {} };
      if (name === "./copy") return { loadStudioCopyAuth: async () => {} };
      if (name.endsWith(".css")) return {};
      throw new Error(`Unexpected entry dependency ${name}`);
    },
  });
  return { component: tree.children[0].type, restored };
}
function destination(url) {
  let loaded;
  runInNewContext(entry, { URLSearchParams, window: { location: new URL(url, "https://example.test") }, load: path => { loaded = path; } });
  return loaded;
}
for (const search of ["", "?replica=foreign&replica=also-foreign&mode=teacher&step=meet&view=evolve&sample=1&panels=1&lang=hi", "?lang=en&view=call"]) {
  const path = conversationSetupUrl(RID, search), url = new URL(path, "https://example.test");
  ok("exact replica, generic private setup and runtime action survive navigation", () => {
    assert.deepEqual(url.searchParams.getAll("replica"), [RID]); assert.equal(url.pathname, "/studio");
    assert.equal(url.searchParams.get("mode"), "setup"); assert.equal(url.searchParams.get("step"), "deploy"); assert.equal(url.hash, "#runtime-gate");
    assert.equal(url.searchParams.get("lang"), new URLSearchParams(search).get("lang"));
    for (const key of ["view", "sample", "panels"]) assert.equal(url.searchParams.has(key), false);
    assert.equal(destination(path), "../creatorStudio/main");
    assert.deepEqual(nestedDestination(path), { component: "StudioApp", restored: 0 });
  });
}
ok("negative control: prior evolve destination cannot reach the runtime workspace", () => {
  const old = `/studio?replica=${RID}&mode=replica&view=evolve`;
  assert.equal(destination(old), "./personalMain");
  assert.throws(() => assert.equal(destination(old), "../creatorStudio/main"), assert.AssertionError);
});
ok("actual nested ops router is an operator destination, never private setup", () => {
  assert.deepEqual(nestedDestination(`/studio?mode=ops&replica=${RID}`), { component: "OpsBoard", restored: 0 });
  assert.throws(() => assert.equal(nestedDestination('/studio?mode=ops').component, 'StudioApp'), assert.AssertionError);
});
ok("ordinary teacher entry still restores remembered mode before the existing app", () => {
  assert.deepEqual(nestedDestination('/studio?mode=teacher'), { component: "StudioApp", restored: 1 });
});
const callerSource = readFileSync(new URL("src/studio/CloneExperience.tsx", root), "utf8");
const caller = callerSource.match(/<ExpertConversation\b[\s\S]*?\/>/)?.[0];
assert(caller, "actual CloneExperience caller exists");
const callerJs = ts.transpileModule(`globalThis.result = (${caller});`, {
  fileName: "caller.tsx", compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React },
}).outputText;
ok("actual CloneExperience JSX passes exact lifecycle without weakening its existing generation lock", () => {
  for (const lifecycle of ["draft", "consent_pending", "enrolling", "calibrating", "ready", "active", "paused", "revoked", "purging"]) {
    const state = { React: { createElement: (type, props) => props }, ExpertConversation: "ExpertConversation", selected: { replica_id: RID, lifecycle },
      accessToken: "synthetic-token", runtimeStatus: null, onAuthError: () => {}, chooseRoom: () => {} };
    runInNewContext(callerJs, state);
    assert.equal(state.result.replicaId, RID); assert.equal(state.result.lifecycle, lifecycle);
    assert.equal(state.result.stopped, lifecycle !== "active" && lifecycle !== "ready");
  }
});
console.log(`${checks} navigation/dispatch checks passed; no browser or network calls.`);
