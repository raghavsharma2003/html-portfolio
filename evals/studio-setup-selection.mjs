import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
const source = readFileSync(new URL("../src/creatorStudio/StudioApp.tsx", import.meta.url), "utf8");
function callbacks(source) {
  const ast = ts.createSourceFile("StudioApp.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const names = new Set(["loadReplicas", "signOut"]), declarations = [];
  function visit(node) {
    if (ts.isVariableStatement(node) && node.declarationList.declarations.some(d => ts.isIdentifier(d.name) && names.has(d.name.text))) declarations.push(node.getText(ast));
    ts.forEachChild(node, visit);
  }
  visit(ast); assert.equal(declarations.length, 2);
  return ts.transpileModule(declarations.join("\n") + "\nglobalThis.callbacks={loadReplicas,signOut};", { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
}
const actual=callbacks(source);
const A = { replica_id: "10000000-0000-4000-8000-000000000001" }, B = { replica_id: "10000000-0000-4000-8000-000000000002" };
const session = { accessToken: "fixture-session", userId: "fixture-owner" };
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function harness({ search = `?mode=setup&replica=${B.replica_id}`, rows = [A, B], selected = null, refresh = async value => value, list = async () => rows, code = actual } = {}) {
  const state = { selected, replicas: [], loadState: null, error: null, session, writes: [] };
  const scope = { URLSearchParams, window: { location: { search } }, replicaLoadRequest: { current: 0 },
    useCallback: callback => callback, handleApiError: error => { state.error = error.message; },
    ensureStudioSession: refresh, listReplicas: list,
    writeStoredSession: value => state.writes.push(value), setSession: value => { state.session = value; },
    setReplicas: value => { state.replicas = value; }, setSelected: value => { state.selected = typeof value === "function" ? value(state.selected) : value; },
    setLoadState: value => { state.loadState = value; }, setError: value => { state.error = value; }, setShowCreate: value => { state.showCreate = value; },
    setErasureRequestId: () => {}, setErasureStatus: () => {},
  };
  runInNewContext(code, scope); return { state, scope, ...scope.callbacks };
}
let count = 0;
async function check(name, test) { await test(); console.log(`ok ${++count} - ${name}`); }
await check("actual load callback selects requested second owned workspace", async () => { const h = harness(); await h.loadReplicas(session); assert.equal(h.state.selected, B); });
await check("explicit user selection survives list refresh", async () => { const h = harness({ selected: A }); await h.loadReplicas(session); assert.equal(h.state.selected, A); });
await check("entry without any explicit replica retains first-owned default", async () => {
  for (const search of ["?mode=setup", "", "?mode=teacher", "?mode=replica", "?mode=teacher&step=deploy&view=share"]) {
    const h = harness({ search }); await h.loadReplicas(session); assert.equal(h.state.selected, A);
  }
});
await check("teacher, replica, share and mode-free links select the exact owned requested workspace", async () => {
  for(const prefix of ["?mode=teacher&", "?mode=replica&", "?mode=teacher&step=deploy&view=share&lang=hi&", "?"]) {
    const h=harness({search:`${prefix}replica=${B.replica_id}`});await h.loadReplicas(session);assert.equal(h.state.selected,B);
    const selected=harness({search:`${prefix}replica=${B.replica_id}`,selected:A});await selected.loadReplicas(session);assert.equal(selected.state.selected,A);
  }
});
await check("empty, malformed and unowned specified IDs never select fallback", async () => {
  for (const mode of ["setup","teacher","replica"]) for (const id of ["", "not-a-uuid", "10000000-0000-4000-8000-000000000099", B.replica_id + "\n"]) {
    const h = harness({ search: `?mode=${mode}&replica=${encodeURIComponent(id)}` }); await h.loadReplicas(session);
    assert.equal(h.state.selected, null); assert.equal(h.state.replicas.length, 0); assert.equal(h.state.loadState, "error"); assert.match(h.state.error, /unavailable/);
  }
});
await check("empty owned list remains create state only without specified target", async () => {
  const h = harness({ rows: [], search: "?mode=setup" }); await h.loadReplicas(session); assert.equal(h.state.selected, null); assert.equal(h.state.showCreate, true);
  const specified = harness({ rows: [] }); await specified.loadReplicas(session); assert.equal(specified.state.loadState, "error");
});
await check("delayed refresh after sign-out cannot restore auth or select", async () => {
  const d = deferred(); let lists = 0; const h = harness({ refresh: () => d.promise, list: async () => { lists++; return [A, B]; } });
  const pending = h.loadReplicas(session); h.signOut(); d.resolve({ ...session, accessToken: "refreshed-old-token" }); await pending;
  assert.equal(lists, 0); assert.equal(h.state.session, null); assert.equal(h.state.selected, null); assert.deepEqual(h.state.writes, [null]);
});
await check("delayed list from prior load cannot overwrite newer owner state", async () => {
  const d = deferred(), started = deferred(); let calls = 0; const h = harness({ list: () => { if (++calls === 1) { started.resolve(); return d.promise; } return Promise.resolve([B]); } });
  const old = h.loadReplicas(session); await started.promise;
  await h.loadReplicas({ ...session, userId: "new-owner" }); d.resolve([A]); await old;
  assert.equal(h.state.selected, B); assert.equal(h.state.replicas.length, 1); assert.equal(h.state.error, null);
});
await check("late rejection after sign-out is ignored", async () => {
  const d = deferred(), started = deferred(), h = harness({ list: () => { started.resolve(); return d.promise; } }); const old = h.loadReplicas(session); await started.promise;
  h.signOut(); d.reject(new Error("old scope failure")); await old; assert.equal(h.state.error, null); assert.equal(h.state.selected, null);
});
await check("negative control restores old first-row fallback and fails selection assertion", async () => {
  const mutant = actual.replace("?? requested ??", "??"); assert.notEqual(mutant, actual); const h = harness({ code: mutant }); await h.loadReplicas(session);
  assert.throws(() => assert.equal(h.state.selected, B), assert.AssertionError);
});
await check("negative control removing scope guards allows old auth resurrection", async () => {
  const mutant = actual.replaceAll("if (!current())", "if (false)"); assert.notEqual(mutant, actual);
  const d = deferred(), h = harness({ code: mutant, refresh: () => d.promise }); const old = h.loadReplicas(session); h.signOut();
  d.resolve({ ...session, accessToken: "refreshed-old-token" }); await old; assert.throws(() => assert.equal(h.state.session, null), assert.AssertionError);
});
await check("exact checkpoint22 setup-only query guard loses teacher/replica/share selection",async()=>{
  // blob from commit 43230e5e94d2086bfaf8b974fbb041862736b28c, moved to a
  // committed fixture (context/rejected.md#ci-shallow-checkout-starved-the-
  // history-reading-suites).
  const oldSource=readFileSync(new URL('studio-setup-selection/fixtures/43230e5e/src__creatorStudio__StudioApp.tsx',new URL('./',import.meta.url)),'utf8');
  assert(oldSource.includes('query.get("mode") === "setup" ? query.get("replica") : null'));const old=callbacks(oldSource);
  for(const prefix of ["?mode=teacher&", "?mode=replica&", "?mode=teacher&step=deploy&view=share&"]){const h=harness({code:old,search:`${prefix}replica=${B.replica_id}`});await h.loadReplicas(session);assert.equal(h.state.selected,A);assert.throws(()=>assert.equal(h.state.selected,B),assert.AssertionError);}
  const setup=harness({code:old});await setup.loadReplicas(session);assert.equal(setup.state.selected,B);
});
console.log(`${count} actual selection/scope groups passed; synthetic callbacks, no network.`);
