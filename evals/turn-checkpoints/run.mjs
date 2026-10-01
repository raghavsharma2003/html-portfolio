import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync, readdirSync } from "node:fs";
import { createTurnCheckpoints, CHECKPOINT_LIMITS } from "../../api/_group-runtime/checkpoints.js";

// Unit-contract proof only. No database, network, server, provider or transport.
let passed = 0;
async function check(name, run) {
  await run();
  passed++;
  console.log(`PASS ${name}`);
}
function errorIs(reason) {
  return (error) => {
    assert.equal(error.name, "TurnCheckpointError");
    assert.equal(error.code, "turn_checkpoint_unavailable");
    assert.equal(error.message, "turn_checkpoint_unavailable");
    assert.equal(error.reason, reason);
    assert.equal("cause" in error, false);
    assert.equal(Object.isFrozen(error), true);
    return true;
  };
}
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const scope = () => ({ project: "synthetic", conversation: "shared-1" });
const make = (readAuthority = () => ({ version: 1 }), options = {}) =>
  createTurnCheckpoints({ scope: scope(), policyVersion: "policy/v1", readAuthority, ...options });
const bind = (turn, source = { ids: ["doc-1"], revision: 1 }, reader = () => source) => {
  turn.bindSources(reader, source);
  return turn;
};
const sourceFailure = async (source) => {
  const turn = await make();
  assert.throws(() => turn.bindSources(() => source, source), errorIs("invalid_source_snapshot"));
  await assert.rejects(turn.assertCurrent(), errorIs("invalid_source_snapshot"));
};

await check("initialized immutable detached scope, policy, authority and handle", async () => {
  const inputScope = { project: "documents", nested: { tenant: "a" } };
  const authority = { version: 1, members: ["a", "b"] };
  const calls = [];
  const pending = make((context) => { calls.push(context); return authority; }, { scope: inputScope });
  inputScope.nested.tenant = "b";
  const turn = await pending;
  authority.members.push("c");
  assert.equal(turn.scope.nested.tenant, "a");
  assert.deepEqual(turn.authority.members, ["a", "b"]);
  assert.equal(turn.guarantee, "checkpointed");
  for (const value of [turn, turn.scope, turn.scope.nested, turn.authority, turn.authority.members, calls[0]]) {
    assert(Object.isFrozen(value));
  }
  assert.throws(() => { turn.policyVersion = "other"; }, TypeError);
  assert.throws(() => { turn.scope.nested.tenant = "other"; }, TypeError);
  assert.throws(() => { turn.authority.members.push("other"); }, TypeError);
  bind(turn);
  await assert.rejects(turn.assertCurrent(), errorIs("authority_changed"));
});

await check("exact initialized A then checkpoint A/S/A/S sequence", async () => {
  const order = [];
  const contexts = [];
  const turn = await make((context) => { order.push("A"); contexts.push(context); return { revision: 1 }; });
  bind(turn, [], (context) => { order.push("S"); contexts.push(context); return []; });
  await turn.assertCurrent();
  assert.deepEqual(order, ["A", "A", "S", "A", "S"]);
  assert(contexts.every((context) => context === contexts[0]));
});

await check("unbound check fails at invocation and cannot be rescued by later binding", async () => {
  let reads = 0;
  const turn = await make(() => { reads++; return { version: 1 }; });
  const checking = turn.assertCurrent();
  assert.throws(() => bind(turn), errorIs("sources_unbound"));
  await assert.rejects(checking, errorIs("sources_unbound"));
  assert.equal(reads, 1);
});

await check("exactly-once binding invalidates even for an identical reader/snapshot", async () => {
  const turn = await make();
  const sources = [];
  const reader = () => sources;
  bind(turn, sources, reader);
  assert.throws(() => bind(turn, sources, reader), errorIs("sources_already_bound"));
  await assert.rejects(turn.assertCurrent(), errorIs("sources_already_bound"));
});

await check("invalid source reader permanently invalidates turn", async () => {
  const turn = await make();
  assert.throws(() => turn.bindSources(null, []), errorIs("invalid_source_reader"));
  assert.throws(() => bind(turn), errorIs("invalid_source_reader"));
});

await check("source baseline is detached and mutation cannot silently adopt new data", async () => {
  const turn = await make();
  const sources = { documents: [{ id: "d1", content: "original" }] };
  bind(turn, sources);
  sources.documents[0].content = "replacement";
  await assert.rejects(turn.assertCurrent(), errorIs("sources_changed"));
  sources.documents[0].content = "original";
  await assert.rejects(turn.assertCurrent(), errorIs("sources_changed"));
});

await check("authority mismatch stays invalid after state returns to its baseline", async () => {
  let revision = 1;
  const turn = bind(await make(() => ({ revision })));
  revision = 2;
  await assert.rejects(turn.assertCurrent(), errorIs("authority_changed"));
  revision = 1;
  await assert.rejects(turn.assertCurrent(), errorIs("authority_changed"));
});

await check("membership mutation during awaited source read is caught by second A", async () => {
  let revision = 1;
  const started = deferred();
  const release = deferred();
  const turn = await make(() => ({ revision }));
  bind(turn, [], async () => { started.resolve(); await release.promise; return []; });
  const checking = turn.assertCurrent();
  await started.promise;
  revision = 2;
  release.resolve();
  await assert.rejects(checking, errorIs("authority_changed"));
});

await check("source mutation during second awaited authority read is caught by second S", async () => {
  let reads = 0;
  let revision = 1;
  const started = deferred();
  const release = deferred();
  const turn = await make(async () => {
    if (++reads === 3) { started.resolve(); await release.promise; }
    return { membership: 1 };
  });
  bind(turn, { revision }, () => ({ revision }));
  const checking = turn.assertCurrent();
  await started.promise;
  revision = 2;
  release.resolve();
  await assert.rejects(checking, errorIs("sources_changed"));
});

await check("concurrent checks serialize complete A/S/A/S sequences", async () => {
  const order = [];
  const started = deferred();
  const release = deferred();
  let reads = 0;
  const turn = await make(async () => {
    order.push("A");
    if (++reads === 2) { started.resolve(); await release.promise; }
    return { revision: 1 };
  });
  bind(turn, [], () => { order.push("S"); return []; });
  const first = turn.assertCurrent();
  const second = turn.assertCurrent();
  await started.promise;
  assert.deepEqual(order, ["A", "A"]);
  release.resolve();
  await Promise.all([first, second]);
  assert.deepEqual(order, ["A", "A", "S", "A", "S", "A", "S", "A", "S"]);
});

await check("queued calls cannot succeed after earlier check invalidates", async () => {
  let revision = 1;
  const turn = bind(await make(() => ({ revision })));
  revision = 2;
  const results = await Promise.allSettled([turn.assertCurrent(), turn.assertCurrent(), turn.assertCurrent()]);
  assert(results.every((result) => result.status === "rejected" && errorIs("authority_changed")(result.reason)));
});

await check("rebind during an awaited check invalidates that in-flight check", async () => {
  let reads = 0;
  const started = deferred();
  const release = deferred();
  const turn = bind(await make(async () => {
    if (++reads === 2) { started.resolve(); await release.promise; }
    return { revision: 1 };
  }));
  const checking = turn.assertCurrent();
  await started.promise;
  assert.throws(() => bind(turn), errorIs("sources_already_bound"));
  release.resolve();
  await assert.rejects(checking, errorIs("sources_already_bound"));
});

await check("fixed reader error codes never expose adapter exceptions or private values", async () => {
  const secret = "PRIVATE-TENANT-SOURCE-CONTENT";
  await assert.rejects(make(() => { throw new Error(secret); }), (error) => {
    errorIs("authority_read_failed")(error);
    assert(!String(error.stack).includes(secret));
    assert(!JSON.stringify(error).includes(secret));
    return true;
  });
  const turn = await make(() => ({ private: secret }));
  bind(turn, { private: secret }, () => { throw { content: secret }; });
  await assert.rejects(turn.assertCurrent(), (error) => {
    errorIs("source_read_failed")(error);
    assert(!JSON.stringify(error).includes(secret));
    assert(!String(error.stack).includes(secret));
    return true;
  });
  await assert.rejects(turn.assertCurrent(), errorIs("source_read_failed"));
});

await check("null, empty or primitive authority is never an initialized receipt", async () => {
  for (const invalid of [null, {}, [], false, "authorized", 1, undefined]) {
    await assert.rejects(make(() => invalid), errorIs("invalid_authority_snapshot"));
  }
});

await check("malformed authority on a later read fails closed", async () => {
  let authority = { version: 1 };
  const turn = bind(await make(() => authority));
  authority = new Date();
  await assert.rejects(turn.assertCurrent(), errorIs("invalid_authority_snapshot"));
});

await check("malformed source read invalidates instead of comparing a lossy JSON result", async () => {
  const turn = await make();
  bind(turn, { version: 1 }, () => ({ version: 1, hidden: undefined }));
  await assert.rejects(turn.assertCurrent(), errorIs("invalid_source_snapshot"));
});

await check("canonical object keys, nested keys and negative zero compare consistently", async () => {
  let reversed = false;
  const turn = await make(() => reversed ? { b: { z: 2, a: 1 }, a: 0 } : { a: -0, b: { a: 1, z: 2 } });
  bind(turn, { z: [1, 2], a: { d: true, c: null } }, () => ({ a: { c: null, d: true }, z: [1, 2] }));
  reversed = true;
  await turn.assertCurrent();
});

await check("array order remains significant", async () => {
  const turn = await make();
  bind(turn, [1, 2], () => [2, 1]);
  await assert.rejects(turn.assertCurrent(), errorIs("sources_changed"));
});

await check("cross-realm VM plain DTOs and null-prototype records are supported", async () => {
  const foreign = vm.runInNewContext('({ scope: { project: "other", thread: "t" }, authority: { ok: true, people: ["p"] }, sources: [{ id: "s" }] })');
  const turn = await make(() => foreign.authority, { scope: foreign.scope });
  const normal = Object.assign(Object.create(null), { id: "s" });
  bind(turn, foreign.sources, () => [normal]);
  await turn.assertCurrent();
  assert.deepEqual(turn.scope, { project: "other", thread: "t" });
});

await check("own __proto__ and constructor keys stay inert own data properties", async () => {
  const authority = JSON.parse('{"__proto__":{"polluted":true},"constructor":"data"}');
  const turn = bind(await make(() => authority));
  assert.equal(Object.getPrototypeOf(turn.authority), Object.prototype);
  assert.equal(Object.hasOwn(turn.authority, "__proto__"), true);
  assert.equal(turn.authority.__proto__.polluted, true);
  assert.equal({}.polluted, undefined);
  await turn.assertCurrent();
});

await check("accessor and toJSON hooks never execute", async () => {
  let invoked = 0;
  const getter = Object.defineProperty({}, "private", { enumerable: true, get() { invoked++; return "secret"; } });
  const toJSONGetter = Object.defineProperty({}, "toJSON", { enumerable: true, get() { invoked++; return () => ({}); } });
  const toJSONMethod = { toJSON() { invoked++; return {}; } };
  const arrayGetter = Object.defineProperty([0], "0", { enumerable: true, get() { invoked++; return 0; } });
  for (const value of [getter, toJSONGetter, toJSONMethod, arrayGetter]) await sourceFailure(value);
  assert.equal(invoked, 0);
  const options = Object.defineProperty({ scope: scope(), policyVersion: "v1" }, "readAuthority", { enumerable: true, get() { invoked++; return () => ({}); } });
  await assert.rejects(createTurnCheckpoints(options), errorIs("invalid_configuration"));
  assert.equal(invoked, 0);
});

await check("synchronous then getters and arbitrary thenables are rejected without invocation", async () => {
  let invoked = 0;
  const thenGetter = Object.defineProperty({ allowed: true }, "then", { enumerable: true, get() { invoked++; return undefined; } });
  await assert.rejects(make(() => thenGetter), errorIs("invalid_authority_snapshot"));
  const turn = await make();
  bind(turn, [], () => thenGetter);
  await assert.rejects(turn.assertCurrent(), errorIs("invalid_source_snapshot"));
  await assert.rejects(make(() => ({ then() { invoked++; } })), errorIs("invalid_authority_snapshot"));
  assert.equal(invoked, 0);
});

await check("cross-realm native promises work without accessing overridden then properties", async () => {
  const foreign = vm.runInNewContext('Promise.resolve({ revision: 1 })');
  let invoked = 0;
  Object.defineProperty(foreign, "then", { get() { invoked++; throw new Error("unexpected"); } });
  const turn = bind(await make(() => foreign));
  await turn.assertCurrent();
  assert.equal(invoked, 0);
});

await check("unsupported primitives and exotic objects are rejected", async () => {
  for (const value of [undefined, () => {}, Symbol("x"), 1n, NaN, Infinity, -Infinity,
    new Date(), /x/u, new Map(), new Set(), new Uint8Array(1), new ArrayBuffer(1), new Number(1),
    new (class Example { constructor() { this.x = 1; } })()]) await sourceFailure(value);
});

await check("sparse, inherited, extra-property arrays and symbol/nonenumerable fields reject", async () => {
  const inherited = new Array(1);
  Object.setPrototypeOf(inherited, { 0: "inherited" });
  const extra = [1]; extra.private = true;
  const symbol = { id: 1, [Symbol("private")]: true };
  const hidden = Object.defineProperty({ id: 1 }, "private", { value: true });
  for (const value of [new Array(1), inherited, extra, symbol, hidden, Object.create({ inherited: true })]) await sourceFailure(value);
});

await check("cycles reject while shared acyclic values remain legal", async () => {
  const cycle = {}; cycle.self = cycle;
  const array = []; array.push(array);
  await sourceFailure(cycle);
  await sourceFailure(array);
  const common = { id: "one" };
  const turn = bind(await make(), { left: common, right: common }, () => ({ right: { id: "one" }, left: { id: "one" } }));
  await turn.assertCurrent();
});

await check("configuration requires explicit inert scope, policy and authority reader", async () => {
  for (const options of [null, {}, { scope: scope(), policyVersion: "v1" },
    { scope: scope(), policyVersion: "v1", readAuthority: null },
    { scope: scope(), policyVersion: "v1", readAuthority: () => ({}), typo: true }]) {
    await assert.rejects(createTurnCheckpoints(options), errorIs("invalid_configuration"));
  }
  for (const policyVersion of [null, "", "  ", "a\n", "x".repeat(129)]) {
    await assert.rejects(make(undefined, { policyVersion }), errorIs("invalid_configuration"));
  }
  await make(undefined, { policyVersion: "x".repeat(128) });
  for (const invalidScope of [null, {}, [], "tenant", new Date()]) {
    await assert.rejects(make(undefined, { scope: invalidScope }), errorIs("invalid_scope"));
  }
});

function deep(depth) {
  let value = 0;
  for (let index = 0; index < depth; index++) value = { next: value };
  return value;
}
function sizedRecord(size, stringLimit) {
  const fields = Math.ceil(size / stringLimit);
  const result = Object.fromEntries(Array.from({ length: fields }, (_, index) => [`k${index}`, ""]));
  let remaining = size - JSON.stringify(result).length;
  for (const key of Object.keys(result)) {
    const length = Math.min(stringLimit, remaining);
    result[key] = "x".repeat(length);
    remaining -= length;
  }
  assert.equal(remaining, 0);
  assert.equal(JSON.stringify(result).length, size);
  return result;
}

await check("scope depth, string, entry, node and serialized bounds include exact boundary", async () => {
  const limits = CHECKPOINT_LIMITS.scope;
  await make(undefined, { scope: deep(limits.depth) });
  await assert.rejects(make(undefined, { scope: deep(limits.depth + 1) }), errorIs("invalid_scope"));
  await make(undefined, { scope: { key: "x".repeat(limits.stringCharacters) } });
  await assert.rejects(make(undefined, { scope: { key: "x".repeat(limits.stringCharacters + 1) } }), errorIs("invalid_scope"));
  await make(undefined, { scope: Object.fromEntries(Array.from({ length: 64 }, (_, i) => [i, 0])) });
  await assert.rejects(make(undefined, { scope: Object.fromEntries(Array.from({ length: 65 }, (_, i) => [i, 0])) }), errorIs("invalid_scope"));
  const nodes = { values: Array.from({ length: 4 }, (_, i) => Array(i === 3 ? 64 : 62).fill(0)) };
  await make(undefined, { scope: nodes });
  await assert.rejects(make(undefined, { scope: { ...nodes, extra: 0 } }), errorIs("invalid_scope"));
  await make(undefined, { scope: sizedRecord(limits.serializedCharacters, limits.stringCharacters) });
  await assert.rejects(make(undefined, { scope: sizedRecord(limits.serializedCharacters + 1, limits.stringCharacters) }), errorIs("invalid_scope"));
});

await check("snapshot depth, string and entries bounds include exact boundary", async () => {
  const limits = CHECKPOINT_LIMITS.snapshot;
  const valid = [deep(limits.depth), "x".repeat(limits.stringCharacters), Array(limits.entries).fill(0),
    Object.fromEntries(Array.from({ length: limits.entries }, (_, i) => [i, 0]))];
  for (const value of valid) await bind(await make(), value).assertCurrent();
  for (const value of [deep(limits.depth + 1), "x".repeat(limits.stringCharacters + 1), Array(limits.entries + 1).fill(0),
    Object.fromEntries(Array.from({ length: limits.entries + 1 }, (_, i) => [i, 0]))]) await sourceFailure(value);
});

await check("snapshot node and escaped serialized size bounds include exact boundary", async () => {
  const limits = CHECKPOINT_LIMITS.snapshot;
  const nodes = Array.from({ length: 8 }, (_, i) => Array(i === 7 ? 4094 : 4095).fill(0));
  await bind(await make(), nodes).assertCurrent();
  nodes[7].push(0);
  await sourceFailure(nodes);
  await bind(await make(), sizedRecord(limits.serializedCharacters, limits.stringCharacters)).assertCurrent();
  await sourceFailure(sizedRecord(limits.serializedCharacters + 1, limits.stringCharacters));
  // Escaping counts: raw string fits, but JSON output exceeds the total limit.
  await sourceFailure("\u0000".repeat(200000));
});

await check("twenty 4k history messages plus fact receipts fit the pinned source envelope", async () => {
  const sources = {
    history: Array.from({ length: 20 }, (_, index) => ({ id: String(index), content: "x".repeat(4000), episode: "episode" })),
    facts: Array.from({ length: 100 }, (_, index) => ({ id: String(index), text: "fact".repeat(100), sources: ["episode"] })),
  };
  await bind(await make(), sources).assertCurrent();
});

await check("concurrency admission is bounded and overflow invalidates all pending checks", async () => {
  const turn = bind(await make());
  const calls = Array.from({ length: CHECKPOINT_LIMITS.pendingChecks + 1 }, () => turn.assertCurrent());
  const results = await Promise.allSettled(calls);
  assert(results.every((result) => result.status === "rejected" && errorIs("too_many_pending_checks")(result.reason)));
});

await check("exact pending limit succeeds and releases capacity for subsequent checks", async () => {
  const turn = bind(await make());
  for (let round = 0; round < 2; round++) {
    await Promise.all(Array.from({ length: CHECKPOINT_LIMITS.pendingChecks }, () => turn.assertCurrent()));
  }
});

await check("synthetic document coediting adapter has independent scope and policy checks", async () => {
  const store = { workspace: "design-team", document: "brief-7", accessRevision: 4, editorIds: ["writer", "reviewer"], sourceRevision: 9 };
  const checks = await createTurnCheckpoints({
    scope: { workspace: "design-team", document: "brief-7" },
    policyVersion: "coedit/share-v2",
    readAuthority({ scope: bound, policyVersion }) {
      if (bound.workspace !== store.workspace || bound.document !== store.document || policyVersion !== "coedit/share-v2") throw new Error("denied");
      return { accessRevision: store.accessRevision, editorIds: [...store.editorIds] };
    },
  });
  const readSources = ({ scope: bound }) => {
    assert.equal(bound.document, store.document);
    return { revision: store.sourceRevision };
  };
  checks.bindSources(readSources, readSources(checks));
  await checks.assertCurrent();
  store.accessRevision++;
  await assert.rejects(checks.assertCurrent(), errorIs("authority_changed"));
});

await check("synthetic warehouse approval adapter rejects changed evidence with no chat concepts", async () => {
  const inventory = { depot: "west", order: "order-47", operator: "operator-a", approval: "revision-2", quantity: 8 };
  const checks = await createTurnCheckpoints({
    scope: { depot: "west", order: "order-47", operator: "operator-a" },
    policyVersion: "dispatch/approval-v3",
    readAuthority({ scope: bound }) {
      if (bound.operator !== inventory.operator || bound.depot !== inventory.depot || bound.order !== inventory.order) throw new Error("denied");
      return { approval: inventory.approval };
    },
  });
  checks.bindSources(({ scope: bound }) => ({ order: bound.order, quantity: inventory.quantity }), { order: "order-47", quantity: 8 });
  await checks.assertCurrent();
  inventory.quantity = 7;
  await assert.rejects(checks.assertCurrent(), errorIs("sources_changed"));
});

await check("kernel has no imports, timers, ambient IO or application-specific scope fields", async () => {
  const source = readFileSync(new URL("../../api/_group-runtime/checkpoints.js", import.meta.url), "utf8");
  assert(!/^\s*import\b/mu.test(source));
  for (const forbidden of [/\bprocess\./u, /\bfetch\s*\(/u, /\brequire\s*\(/u, /\bsetTimeout\s*\(/u,
    /\b(?:roomId|agentId|telegram|discord|whatsapp|replicaId)\b/u]) assert(!forbidden.test(source));
});

function verifyManifest(manifest) {
  assert.equal(manifest.name, "@vyakti/turn-checkpoints");
  assert.equal(manifest.version, "0.1.0");
  assert.equal(manifest.private, true);
  assert.equal(manifest.license, "UNLICENSED");
  assert.equal(manifest.type, "module");
  assert.equal(manifest.types, "./checkpoints.d.ts");
  assert.deepEqual(manifest.exports, {
    ".": { types: "./checkpoints.d.ts", import: "./checkpoints.js", default: "./checkpoints.js" },
  });
  assert.deepEqual(manifest.files, ["checkpoints.js", "checkpoints.d.ts", "README.md"]);
  for (const field of ["scripts", "dependencies", "devDependencies", "peerDependencies", "optionalDependencies", "bundledDependencies", "bundleDependencies"]) {
    assert.equal(Object.hasOwn(manifest, field), false, `${field} is not part of this private dependency-free package`);
  }
}

await check("local package is private, unlicensed, dependency-free and explicitly exported", async () => {
  const manifest = JSON.parse(readFileSync(new URL("../../api/_group-runtime/package.json", import.meta.url), "utf8"));
  verifyManifest(manifest);
  for (const mutation of [
    { private: false }, { license: "MIT" }, { scripts: { prepare: "unsafe" } },
    { dependencies: { unintended: "*" } }, { exports: { ".": "./checkpoints.js", "./*": "./*" } },
    { files: ["*"] },
  ]) assert.throws(() => verifyManifest({ ...manifest, ...mutation }));
});

await check("package exports resolve to exactly the existing public JavaScript API and types", async () => {
  const packageRoot = new URL("../../api/_group-runtime/", import.meta.url);
  const manifest = JSON.parse(readFileSync(new URL("package.json", packageRoot), "utf8"));
  const entry = await import(new URL(manifest.exports["."].import, packageRoot));
  assert.deepEqual(Object.keys(entry).sort(), ["CHECKPOINT_LIMITS", "createTurnCheckpoints"]);
  assert.equal(entry.createTurnCheckpoints, createTurnCheckpoints);
  assert.equal(entry.CHECKPOINT_LIMITS, CHECKPOINT_LIMITS);
  const declarations = readFileSync(new URL(manifest.exports["."].types, packageRoot), "utf8");
  assert.match(declarations, /export function createTurnCheckpoints/u);
  assert.match(declarations, /export const CHECKPOINT_LIMITS/u);
});

await check("package folder contains only the explicit whitelist and required manifest", async () => {
  const packageRoot = new URL("../../api/_group-runtime/", import.meta.url);
  const manifest = JSON.parse(readFileSync(new URL("package.json", packageRoot), "utf8"));
  const entries = readdirSync(packageRoot, { withFileTypes: true });
  assert(entries.every((entry) => entry.isFile()));
  assert.deepEqual(entries.map((entry) => entry.name).sort(), [...manifest.files, "package.json"].sort());
});

console.log(`\n${passed} checkpoint contract groups passed; unit contracts only, not atomic authorization, durable delivery or live integration proof.`);
