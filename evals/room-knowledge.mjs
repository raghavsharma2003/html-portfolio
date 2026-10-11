import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { readPublicRoomKnowledge, assertPublicRoomKnowledgeCurrent, PUBLIC_ROOM_KNOWLEDGE_SQL } from "../api/_room-knowledge.js";

let checks = 0;
const pass = (name) => console.log(`ok ${++checks} - ${name}`);
const uid = (n) => `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;
const scope = { roomId: uid(1), replicaId: uid(2), ownerUserId: uid(3), agentId: uid(4) };
const row = (n = 1) => ({ room_id: scope.roomId, id: uid(n + 10), question: `Question ${n}`, answer: `Answer ${n}`, position: n });
const empty = () => ({ room_id: scope.roomId, id: null, question: null, answer: null, position: null });
const read = (rows, input = scope) => readPublicRoomKnowledge(async () => rows, input);
const rejects = async (fn, code) => assert.rejects(fn, { code });

let calls = 0;
const first = await readPublicRoomKnowledge(async (sql, params) => {
  calls++;
  assert.equal(sql, PUBLIC_ROOM_KNOWLEDGE_SQL);
  assert.deepEqual(params, Object.values(scope));
  return [row(2), row(1)];
}, scope);
assert.equal(calls, 1);
assert.deepEqual(first.sources.map(x => x.position), [1, 2]);
assert.equal(first.scope, "public_room_qa");
assert.ok(Object.isFrozen(first) && Object.isFrozen(first.sources) && first.sources.every(Object.isFrozen));
assert.deepEqual(await read([row(1), row(2)]), first);
pass("actual reader binds four parameters and produces deterministic deeply frozen ordered evidence");

assert.equal((await read([empty()])).sources.length, 0);
await rejects(() => read([]), "room_knowledge_unavailable");
await rejects(() => readPublicRoomKnowledge(async () => { throw new Error("private SQL contents"); }, scope), "room_knowledge_read_failed");
pass("eligible empty corpus differs from unavailable Room and content-free database failure");

for (const key of Object.keys(scope)) {
  for (const invalid of [null, 1, "", scope[key] + "\n", " " + scope[key]]) {
    await rejects(() => readPublicRoomKnowledge(async () => assert.fail("scope reached DB"), { ...scope, [key]: invalid }), "room_knowledge_scope_invalid");
  }
}
await rejects(() => readPublicRoomKnowledge(null, scope), "room_knowledge_database_required");
pass("all scope IDs reject invalid types, whitespace and newline suffix before database");

for (const rows of [null, {}, [null], [{ ...row(), room_id: uid(99) }], Array.from({ length: 6 }, (_, i) => row(i + 1)),
  [{ ...empty(), question: "not a sentinel" }], [empty(), row()], [row(), row()], [row(), { ...row(2), position: 1 }],
  [{ ...row(), id: uid(11) + "\n" }], [{ ...row(), position: "1" }], [{ ...row(), position: 0 }],
  [{ ...row(), position: 6 }], [{ ...row(), position: 1.5 }], [{ ...row(), question: "" }],
  [{ ...row(), question: "q".repeat(201) }], [{ ...row(), answer: "a".repeat(1201) }],
  [{ ...row(), answer: null }], [{ ...row(), question: true }], [{ ...row(), answer: "\uD800" }],
  [{ ...row(), answer: "bad\u0000text" }]]) {
  await rejects(() => read(rows), "room_knowledge_result_invalid");
}
pass("malformed database rows, sentinel mixing, duplicate identity/position and all bounds refuse");

const unicode = { ...row(), question: "😀".repeat(200), answer: "😀".repeat(1200) };
assert.equal((await read([unicode])).sources[0].answer, unicode.answer);
assert.equal((await read([{ ...row(), question: " ", answer: "  Exact public copy.\n" }])).sources[0].answer, "  Exact public copy.\n");
assert.equal((await read(Array.from({ length: 5 }, (_, i) => row(i + 1)))).sources.length, 5);
pass("PostgreSQL Unicode-character limits and exact whitespace survive without cropping");

const base = await read([row()]);
for (const patch of [{ id: uid(90) }, { question: "changed" }, { answer: "changed" }]) {
  const changed = await read([{ ...row(), ...patch }]);
  assert.notEqual(changed.sources[0].contentSha256, base.sources[0].contentSha256);
  assert.notEqual(changed.setSha256, base.setSha256);
}
const moved = await read([{ ...row(), position: 2 }]);
assert.equal(moved.sources[0].contentSha256, base.sources[0].contentSha256);
assert.notEqual(moved.setSha256, base.setSha256);
for (const key of Object.keys(scope)) {
  const other = { ...scope, [key]: uid(80) };
  const result = await read([{ ...row(), room_id: other.roomId }], other);
  assert.notEqual(result.setSha256, base.setSha256);
}
pass("content changes bind item hash; membership, position and every authority bind set hash");

assert.deepEqual(await assertPublicRoomKnowledgeCurrent(async () => [row()], scope, base), base);
for (const rows of [[empty()], [row(), row(2)], [{ ...row(), answer: "edited" }], [{ ...row(), id: uid(90) }]]) {
  await rejects(() => assertPublicRoomKnowledgeCurrent(async () => rows, scope, base), "room_knowledge_changed");
}
await rejects(() => assertPublicRoomKnowledgeCurrent(async () => [], scope, base), "room_knowledge_unavailable");
await rejects(() => assertPublicRoomKnowledgeCurrent(async () => { throw new Error(); }, scope, base), "room_knowledge_read_failed");
pass("revalidation re-reads, accepts unchanged, and refuses remove/add/edit/replace/unavailable/error");

for (const changed of [null, { ...base, extra: true }, { ...base, roomId: uid(99) }, { ...base, scope: "private" },
  { ...base, setSha256: "0".repeat(64) }, { ...base, sources: [{ ...base.sources[0], answer: "forged" }] },
  { ...base, sources: [{ ...base.sources[0], contentSha256: "0".repeat(64) }] }]) {
  await rejects(() => assertPublicRoomKnowledgeCurrent(async () => assert.fail("bad snapshot reached DB"), scope, changed), "room_knowledge_snapshot_invalid");
}
pass("retained snapshot cannot change fields or commitments before revalidation");

// A deliberately small fixture evaluator for the exact SQL predicates. It
// demonstrates actual-source guard sensitivity, NOT PostgreSQL parsing/types.
const clauses = [
  ["r.room_id=$1::uuid", "roomId"], ["r.replica_id=$2::uuid", "replicaId"],
  ["r.owner_user_id=$3::uuid", "ownerUserId"], ["r.agent_id=$4::uuid", "agentId"],
];
const worldDb = (world) => async (sql, params) => {
  const eligible = clauses.every(([clause, field], i) => !sql.includes(clause) || world[field] === params[i]) &&
    (!sql.includes("r.published_at is not null") || world.published) &&
    (!sql.includes("r.paused_at is null") || !world.paused);
  if (!eligible) return [];
  const items = world.items.filter(x => !sql.includes("s.removed_at is null") || !x.removed);
  return items.length ? items.map(x => ({ ...x, room_id: world.roomId })) : [{ ...empty(), room_id: world.roomId }];
};
const world = { ...scope, published: true, paused: false, items: [row()] };
for (const [, key] of clauses) await rejects(() => readPublicRoomKnowledge(worldDb(world), { ...scope, [key]: uid(99) }), "room_knowledge_unavailable");
await rejects(() => readPublicRoomKnowledge(worldDb({ ...world, published: false }), scope), "room_knowledge_unavailable");
await rejects(() => readPublicRoomKnowledge(worldDb({ ...world, paused: true }), scope), "room_knowledge_unavailable");
assert.equal((await readPublicRoomKnowledge(worldDb({ ...world, items: [{ ...row(), removed: true }] }), scope)).sources.length, 0);
pass("four authority predicates, published/unpaused and active-only behavior in explicit SQL fixture model");

const moduleUrl = new URL("../api/_room-knowledge.js", import.meta.url);
const original = await readFile(moduleUrl, "utf8");
const importPath = new URL("../api/_provenance/contracts.js", import.meta.url).href;
async function mutant(from, to) {
  assert.equal(original.split(from).length, 2, "mutation must replace exactly one real source site");
  const source = original.replace(from, to).replace('"./_provenance/contracts.js"', JSON.stringify(importPath));
  return import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
}
for (const [clause, key] of clauses) {
  const changed = await mutant(clause, "true");
  if (key === "roomId") {
    // The second-layer returned Room binding still refuses an escaped row.
    await rejects(() => changed.readPublicRoomKnowledge(worldDb(world), { ...scope, roomId: uid(99) }), "room_knowledge_result_invalid");
  } else {
    assert.equal((await changed.readPublicRoomKnowledge(worldDb(world), { ...scope, [key]: uid(99) })).sources.length, 1);
  }
  pass(`actual-source negative control: removing ${key} predicate changes refusal/row exposure`);
}
for (const [clause, altered] of [["r.published_at is not null", { published: false }], ["r.paused_at is null", { paused: true }]]) {
  const changed = await mutant(clause, "true");
  assert.equal((await changed.readPublicRoomKnowledge(worldDb({ ...world, ...altered }), scope)).sources.length, 1);
  pass(`actual-source negative control: removing ${clause} admits ineligible public copy`);
}
const removedMutant = await mutant("s.removed_at is null", "true");
assert.equal((await removedMutant.readPublicRoomKnowledge(worldDb({ ...world, items: [{ ...row(), removed: true }] }), scope)).sources.length, 1);
pass("actual-source negative control: removed-publication predicate is necessary");
const hashMutant = await mutant('question, answer,\n    }));', 'question, answer: "",\n    }));');
const beforeHash = await hashMutant.readPublicRoomKnowledge(async () => [row()], scope);
const afterHash = await hashMutant.readPublicRoomKnowledge(async () => [{ ...row(), answer: "different" }], scope);
assert.equal(beforeHash.setSha256, afterHash.setSha256);
pass("actual-source negative control: omitting answer from commitment conceals content change");
const currentMutant = await mutant('if (current.setSha256 !== retained.setSha256)', 'if (false)');
assert.equal((await currentMutant.assertPublicRoomKnowledgeCurrent(async () => [{ ...row(), answer: "changed" }], scope, base)).sources[0].answer, "changed");
pass("actual-source negative control: current-set comparison is necessary");

assert.deepEqual([...PUBLIC_ROOM_KNOWLEDGE_SQL.matchAll(/\b(?:from|join)\s+(vy_\w+)/g)].map(x => x[1]).sort(), ["vy_replica_runtime_capability", "vy_room", "vy_room_showcase"]);
assert.ok(!/\b(?:insert|update|delete)\b/i.test(PUBLIC_ROOM_KNOWLEDGE_SQL));
pass("reader SQL names Room, public showcase and the active-candidate fence and performs no writes");
console.log(`room knowledge: ${checks} checks passed; offline fixtures only, no SQL/provider proof`);
