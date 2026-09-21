import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createContext, Script } from "node:vm";
import ts from "typescript";

// Execute the actual room initializer and selection effect extracted by the
// TypeScript parser. No copied navigation helper can agree with its own bug.
const source = readFileSync(new URL("../src/studio/CloneExperience.tsx", import.meta.url), "utf8");
function callbacks(text) {
  const ast = ts.createSourceFile("CloneExperience.tsx", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const initializers = [];
  const effects = [];
  function visit(node) {
    if (ts.isVariableDeclaration(node) && ts.isArrayBindingPattern(node.name)
      && node.name.elements[0]?.name?.getText(ast) === "room"
      && node.initializer && ts.isCallExpression(node.initializer)) {
      initializers.push(node.initializer.arguments[0].getText(ast));
    }
    if (ts.isCallExpression(node) && node.expression.getText(ast) === "useEffect"
      && node.arguments[0]?.getText(ast).includes("activeReplicaRef.current === nextReplicaId")) {
      effects.push(node.arguments[0].getText(ast));
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.equal(initializers.length, 1, "one actual room initializer");
  assert.equal(effects.length, 1, "one actual replica selection effect");
  const compile = code => new Script(ts.transpileModule(`(${code})()`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText);
  return { initialize: compile(initializers[0]), select: compile(effects[0]) };
}
function harness(code, search, initialReplica = null) {
  const compiled = callbacks(code);
  const writes = [];
  const revoked = [];
  const context = createContext({
    window: { location: { search } }, URLSearchParams,
    selected: initialReplica ? { replica_id: initialReplica } : null,
    activeReplicaRef: { current: initialReplica }, retryRef: { current: null },
    uploadAttemptRef: { current: 0 }, uploadLockedRef: { current: false },
    URL: { revokeObjectURL: value => revoked.push(value) },
    readVoiceSaga: replicaId => ({ replicaId }),
  });
  const state = { room: compiled.initialize.runInContext(context) };
  for (const [setter, key] of Object.entries({ setRoom: "room", setUpload: "upload", setReplacePrimary: "replacePrimary",
    setEnrichView: "enrichView", setVoiceSaga: "voiceSaga", setVoiceBuildIntent: "voiceBuildIntent" })) {
    context[setter] = value => { state[key] = value; writes.push([setter, value]); };
  }
  return { state, context, writes, revoked, select(replicaId) {
    context.selected = replicaId ? { replica_id: replicaId } : null;
    compiled.select.runInContext(context);
  } };
}
let checks = 0;
function check(name, test) { test(); console.log(`ok ${++checks} - ${name}`); }
for (const room of ["enrich", "evolve", "call", "share", "voice"]) {
  check(`delayed first selection preserves requested ${room}`, () => {
    const h = harness(source, `?replica=first&view=${room}`);
    h.select(null); h.select(null); // loading renders before list completion
    assert.equal(h.state.room, room);
    h.select("first");
    assert.equal(h.state.room, room);
    assert.equal(h.context.activeReplicaRef.current, "first");
    assert.equal(h.state.voiceSaga.replicaId, "first");
    assert.equal(h.state.upload, null);
  });
}
for (const query of ["", "?view=", "?view=invalid", "?view=CALL", "?view=%3Cscript%3E"]) {
  check(`missing/invalid destination defaults to voice: ${query || "empty query"}`, () => {
    const h = harness(source, query); h.select(null); h.select("first"); assert.equal(h.state.room, "voice");
  });
}
check("already hydrated first mount preserves URL room", () => {
  const h = harness(source, "?view=call", "first"); h.select("first");
  assert.equal(h.state.room, "call"); assert.equal(h.writes.length, 0);
});
check("real replica switch resets room and clears exact pending upload", () => {
  const h = harness(source, "?view=enrich"); h.select("first");
  h.context.retryRef.current = { sample: { url: "blob:pending-first" } };
  h.context.uploadLockedRef.current = true;
  const attempt = h.context.uploadAttemptRef.current;
  h.select("second");
  assert.equal(h.state.room, "voice"); assert.equal(h.state.enrichView, "menu");
  assert.equal(h.state.voiceSaga.replicaId, "second"); assert.equal(h.state.voiceBuildIntent, null);
  assert.equal(h.context.retryRef.current, null); assert.equal(h.context.uploadLockedRef.current, false);
  assert.equal(h.context.uploadAttemptRef.current, attempt + 1);
  assert.deepEqual(h.revoked, ["blob:pending-first"]);
});
check("same replica refresh preserves an owner's later room choice", () => {
  const h = harness(source, "?view=enrich"); h.select("first"); h.state.room = "evolve";
  h.select("first"); assert.equal(h.state.room, "evolve");
});
check("clearing an existing replica resets before another selection", () => {
  const h = harness(source, "?view=call"); h.select("first"); h.select(null);
  assert.equal(h.state.room, "voice"); h.select("second"); assert.equal(h.state.room, "voice");
});
check("negative control: original unconditional reset fails the delayed selection regression", () => {
  const mutant = source.replace('if (activeReplicaRef.current !== null) setRoom("voice");', 'setRoom("voice");');
  assert.notEqual(mutant, source, "mutation must touch the actual callback");
  const h = harness(mutant, "?view=enrich"); h.select(null); h.select("first");
  assert.throws(() => assert.equal(h.state.room, "enrich"), assert.AssertionError);
});
console.log(`PASS ${checks} actual initializer/effect regression checks; no browser or model calls.`);
