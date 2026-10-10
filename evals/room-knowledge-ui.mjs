// Execute actual RoomApp effect/click callbacks with deferred HTTP/digest
// fixtures. This proves lifecycle logic, not browser layout or real network.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
const source = readFileSync(new URL("../src/room/RoomApp.tsx", import.meta.url), "utf8");
const tree = ts.createSourceFile("RoomApp.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const nodes = [];
function visit(node) { nodes.push(node); ts.forEachChild(node, visit); }
visit(tree);
const effects = nodes.filter(n => ts.isCallExpression(n) && n.expression.getText(tree) === "useEffect");
const history = effects.find(n => n.arguments[0].getText(tree).includes("void roomHistory(token, thread)"));
const citationScope = effects.find(n => n.arguments[0].getText(tree).includes("citationRequestRef.current++"));
const click = nodes.find(n => ts.isJsxAttribute(n) && n.name.getText(tree) === "onClick" &&
  n.initializer?.getText(tree).includes("const request = ++citationRequestRef.current"));
assert.ok(history && citationScope && click, "actual lifecycle callbacks located");
const callback = (code, env) => {
  const js = ts.transpile(`const extracted = ${code};`, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 });
  return new Function(...Object.keys(env), `${js};return extracted;`)(...Object.values(env));
};
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const flush = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };
let checks = 0;
const pass = name => console.log(`ok ${++checks} - ${name}`);
function world() {
  const updates = [], reads = [];
  const env = { phase: "talking", hasSession: true, thread: "thread-a", remembers: true, fixtureOpen: null,
    slug: "room-a", roomScope: "room-a", accountScope: "owner-a", session: "token-1",
    sessionRef: { current: "token-1" }, historyRequestRef: { current: 0 },
    setTurns: value => updates.push(value), roomHistory: (token, thread) => {
      const pending = deferred(); reads.push({ token, thread, ...pending }); return pending.promise;
    } };
  let deps, cleanup;
  const render = () => {
    const next = callback(history.arguments[1].getText(tree), env);
    if (deps && deps.every((value, i) => Object.is(value, next[i]))) return;
    cleanup?.(); deps = next; cleanup = callback(history.arguments[0].getText(tree), env)();
  };
  return { env, updates, reads, render, cleanup: () => cleanup?.() };
}

{
  const w = world(); w.render();
  assert.equal(w.reads.length, 1);
  w.reads[0].resolve({ turns: [{ role: "assistant", content: "old history" }] }); await flush();
  const live = { role: "assistant", content: "new reply", knowledge: { relation: "provided_to_model" } };
  w.env.setTurns([live]);
  w.env.session = "token-2"; w.env.sessionRef.current = "token-2"; w.render();
  assert.equal(w.reads.length, 1); assert.deepEqual(w.updates.at(-1), [live]);
  w.env.thread = "thread-b"; w.render();
  assert.equal(w.reads.length, 2); assert.equal(w.reads[1].token, "token-2");
  assert.equal(w.reads[1].thread, "thread-b"); assert.deepEqual(w.updates.at(-1), []);
  pass("actual effect dependencies preserve evidence on token refresh and use the current token when thread changes");
}

for (const failure of [false, true]) {
  const w = world(); w.render(); const first = w.reads[0];
  w.env.thread = "thread-b"; w.render();
  w.reads[1].resolve({ turns: [{ role: "assistant", content: "thread-b-only" }] }); await flush();
  if (failure) first.reject(new Error("old request failed"));
  else first.resolve({ turns: [{ role: "assistant", content: "thread-a-private" }] });
  await flush(); assert.equal(w.updates.at(-1)[0].content, "thread-b-only");
}
pass("cleanup prevents both late history success and failure from replacing a different thread");

{
  const w = world(); w.render();
  w.env.historyRequestRef.current++; // The exact invalidation send() performs.
  const current = [{ role: "assistant", content: "new reply", knowledge: { exact: false } }];
  w.env.setTurns(current);
  w.reads[0].resolve({ turns: [] }); await flush();
  assert.deepEqual(w.updates.at(-1), current);
  const send = nodes.find(n => ts.isFunctionDeclaration(n) && n.name?.getText(tree) === "send").getText(tree);
  assert.ok(send.indexOf("const request = ++historyRequestRef.current") < send.indexOf("await sayInRoom"));
  assert.ok(send.indexOf("if (request !== historyRequestRef.current) return;") < send.indexOf("setSession(turn.session)"));
  pass("pending initial history cannot erase a newer send, and actual send refuses responses from an obsolete scope");
}

{
  const w = world(); w.render(); w.cleanup();
  const before = w.updates.length;
  w.reads[0].resolve({ turns: [{ role: "assistant", content: "unmounted" }] }); await flush();
  assert.equal(w.updates.length, before);
  for (const key of ["slug", "roomScope", "accountScope"]) {
    const changed = world(); changed.render(); changed.env[key] += "-changed"; changed.render();
    assert.equal(changed.reads.length, 2, key);
  }
  for (const patch of [{ remembers: false }, { hasSession: false }, { phase: "join" }]) {
    const stopped = world(); stopped.render(); Object.assign(stopped.env, patch); stopped.render();
    assert.equal(stopped.reads.length, 1); assert.deepEqual(stopped.updates.at(-1), []);
    stopped.reads[0].resolve({ turns: [{ role: "assistant", content: "stale-private" }] }); await flush();
    assert.deepEqual(stopped.updates.at(-1), []);
  }
  pass("unmount, Room/account change, memory-off and session loss invalidate private history correctly");
}

const clickCode = click.initializer.expression.getText(tree);
function citationWorld({ supplied = true } = {}) {
  const updates = [], digest = deferred(), catalog = deferred(); let catalogs = 0;
  const env = { citationRequestRef: { current: 0 }, name: "Expert", session: "token", slug: "room-a", roomScope: "room-a",
    thread: "a", phase: "talking", hasSession: true, accountScope: "person-a",
    turns: [{ role: "assistant", content: "answer", ...(supplied ? { knowledge: { relation: "provided_to_model",
      reply_sha256: "hash", sources: [{ question: "Exact supplied question" }] } } : {}) }],
    replySha256: () => digest.promise, roomCitations: () => { catalogs++; return catalog.promise; },
    setCite: value => updates.push(value) };
  return { env, updates, digest, catalog, catalogs: () => catalogs,
    click: () => callback(clickCode, env)(), scope: () => callback(citationScope.arguments[0].getText(tree), env)() };
}

{
  const w = citationWorld(); const done = w.click(); w.digest.resolve("hash"); await done;
  assert.equal(w.catalogs(), 0); assert.equal(w.updates.at(-1).relation, "provided_to_model");
  assert.deepEqual(w.updates.at(-1).sources, ["Exact supplied question"]);
  pass("actual source click uses hash-bound immediate evidence without fetching a generic catalog");
}

{
  const w = citationWorld(); const done = w.click(); const cleanup = w.scope();
  w.digest.resolve("hash"); await done; assert.deepEqual(w.updates, [null]); assert.equal(w.catalogs(), 0); cleanup();
  const old = citationWorld({ supplied: false }); const oldDone = old.click();
  const clear = old.scope(); clear();
  old.catalog.resolve({ sources: ["other-thread-title"] }); await oldDone;
  assert.deepEqual(old.updates, [null]);
  pass("late digest and catalog cannot repopulate citations after scope change or unmount");
}

{
  const w = citationWorld(); const done = w.click(); w.digest.reject(new Error("digest unavailable")); await flush();
  assert.equal(w.catalogs(), 1);
  w.catalog.resolve({ name: "Expert", sources: ["Current published question"], relation: "published_catalog", exact: false });
  await done; assert.equal(w.updates.at(-1).relation, "published_catalog");
  pass("digest failure falls back to an explicitly current catalog without claiming per-reply sources");
}

{
  const w = world();
  const raw = history.arguments[0].getText(tree);
  const mutant = raw.replaceAll("live && request === historyRequestRef.current", "true");
  assert.notEqual(mutant, raw);
  const cleanup = callback(mutant, w.env)(); cleanup();
  w.reads[0].resolve({ turns: [{ role: "assistant", content: "late leak" }] }); await flush();
  assert.equal(w.updates.at(-1)[0].content, "late leak");
  const tokenDeps = history.arguments[1].getText(tree).replace("hasSession", "session");
  assert.notEqual(tokenDeps, history.arguments[1].getText(tree));
  const a = callback(tokenDeps, w.env); w.env.session = "rotated";
  assert.notDeepEqual(callback(tokenDeps, w.env), a);
  pass("actual-source negative controls expose stale writes and token-driven reloads when protections are removed");
}
console.log(`room knowledge UI: ${checks} checks passed; actual callbacks with deferred fixtures, no browser/network proof`);
