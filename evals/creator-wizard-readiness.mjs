import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
const root = new URL("../src/creatorStudio/", import.meta.url);
const modelSource = readFileSync(new URL("wizardModel.ts", root), "utf8");
function load(source = modelSource) {
  const modules = {};
  function evaluate(name, text) {
    const exports = {};
    runInNewContext(ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText,
      { exports, URLSearchParams, require: dependency => modules[dependency] });
    modules[name] = exports; return exports;
  }
  evaluate("./blockerClass", readFileSync(new URL("blockerClass.ts", root), "utf8"));
  return evaluate("model", source);
}
const M = load();
const appSource = readFileSync(new URL("StudioApp.tsx", root), "utf8");
const appAst = ts.createSourceFile("StudioApp.tsx", appSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let runtimeExpression;
function findCaller(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(appAst) === "wizardInput") {
    const object = node.initializer.arguments[0].body.expression;
    runtimeExpression = object.properties.find(property => property.name?.getText(appAst) === "runtime").initializer.getText(appAst);
  }
  ts.forEachChild(node, findCaller);
}
findCaller(appAst); assert(runtimeExpression);
const caller = {}; runInNewContext(ts.transpileModule(`globalThis.reduce = runtimeStatus => (${runtimeExpression});`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, caller);
const base = { stopped: false, sourceConsent: true, sourceCount: 1, contextItemCount: 1, identityVerified: true, livenessVerified: true,
  sheetPersisted: true, mode: "generic", runtime: { active: false, canActivate: false, blockers: [], voiceGenomeVersion: null },
  connectedChannels: null, roomPublished: null, platformWork: null };
const rows = (runtime, extra = {}, model = M) => model.computeWizard({ ...base, ...extra, runtime }).steps.find(step => step.id === "deploy").missing;
let count = 0;
function check(name, test) { test(); console.log(`ok ${++count} - ${name}`); }
check("actual earlier-step blockers survive Deploy without false activation instruction", () => {
  const blocked = ["identity_verification_required", "liveness_verification_required", "voice_genome_not_approved", "voice_not_ready"];
  const actual = rows({ ...base.runtime, blockers: blocked });
  assert.deepEqual(Array.from(actual, row => row.code), blocked); assert(!actual.some(row => row.code === "not_activated"));
});
check("actual StudioApp reduction preserves server permission without deriving it", () => {
  for (const value of [true, false, undefined]) {
    const actual = caller.reduce({ active: false, can_activate: value, blockers: [], versions: { voice_genome: null } });
    assert.equal(actual.canActivate, value);
  }
  assert.equal(caller.reduce(null), null);
});
check("existing ownership classification and destination anchors survive mirrored prerequisites", () => {
  for (const code of M.allBlockerCodes()) {
    const actual = rows({ ...base.runtime, blockers: [code] })[0], meta = M.blockerMeta(code);
    assert.equal(actual.code, code); assert.equal(actual.owner, meta.owner); assert.equal(actual.cls, meta.owner === "you" ? "you" : "us");
    assert.equal(actual.anchor, meta.anchor);
  }
});
check("processing-held approvals stay on the platform side in Deploy", () => {
  for (const code of ["person_profile_not_approved", "calibration_not_approved", "voice_genome_not_approved"]) {
    const actual = rows({ ...base.runtime, blockers: [code] }, { platformWork: { running: 1, stuck: 0, undeployedLanes: [] } })[0];
    assert.equal(actual.cls, "us"); assert.match(actual.note, /processing/);
  }
});
check("activation instruction requires explicit readiness with no blockers", () => {
  assert.equal(rows({ ...base.runtime, canActivate: true })[0].code, "not_activated");
  for (const canActivate of [false, undefined]) assert(!rows({ ...base.runtime, canActivate }).some(row => row.code === "not_activated"));
  assert(!rows({ ...base.runtime, canActivate: true, blockers: ["voice_not_ready"] }).some(row => row.code === "not_activated"));
});
check("unknown and inactive unexplained readiness remain platform states", () => {
  const unknown = rows({ ...base.runtime, blockers: ["future_gate"] }); assert.equal(unknown[0].code, "future_gate"); assert.equal(unknown[0].cls, "us");
  const unexplained = rows(base.runtime); assert.equal(unexplained[0].cls, "us"); assert(!unexplained.some(row => /Every gate is closed/.test(row.note)));
});
check("unloaded runtime and already active runtime never invite activation", () => {
  assert(!rows(null).some(row => row.code === "not_activated")); assert(!rows({ ...base.runtime, active: true }).some(row => row.code === "not_activated"));
});
check("negative control old deploy-only filtering reproduces misleading instruction", () => {
  const oldStart = 'const rows: Missing[] = blockersForStep(input.runtime?.blockers ?? [], "deploy", input);';
  const mutant = modelSource.replace(/const rows: Missing\[\] = \[\.\.\.new Set\(input\.runtime\?\.blockers \?\? \[\]\)\][\s\S]*?;\n  for \(const code/, oldStart + '\n  for (const code')
    .replace('input.runtime.canActivate === true && input.runtime.blockers.length === 0', 'rows.length === 0');
  assert.notEqual(mutant, modelSource);
  const actual = rows({ ...base.runtime, blockers: ["identity_verification_required"] }, {}, load(mutant));
  assert(actual.some(row => row.code === "not_activated"));
  assert.throws(() => assert(actual.some(row => row.code === "identity_verification_required")), assert.AssertionError);
});
console.log(`${count} actual creator wizard readiness groups passed; no network.`);
