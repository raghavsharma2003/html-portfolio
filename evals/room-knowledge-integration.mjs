// Actual Room + compiler + gated reply + Azure adapter, with explicit fake
// database, memory, authentication loader and fetch. No SQL or model proof.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { SLUG, ROOM_ID, REPLICA_ID, OWNER, AGENT_ID, USER_A, USER_B, PERSON_A, PERSON_B,
  loadFixtureAgent, freshState, fakeDb, fakeMemory } from "./room/fixtures.mjs";
import { readPublicRoomKnowledge, PUBLIC_ROOM_KNOWLEDGE_SQL } from "../api/_room-knowledge.js";

process.env.ROOM_SESSION_SECRET = "q".repeat(48);
const { roomSay, joinRoom, roomCitations, readRoomSession, mintRoomSession } = await import("../api/_room-surface.js");
const { think } = await import("../api/_surface.js");
const { engine, loadAgent } = await loadFixtureAgent(fileURLToPath(new URL("../", import.meta.url)));
let checks = 0;
const pass = (name) => console.log(`ok ${++checks} - ${name}`);
const sha = (value) => createHash("sha256").update(value).digest("hex");
const SOURCE = "d1000000-0000-4000-8000-000000000001";
const qa = () => ({ id: SOURCE, room_id: ROOM_ID, question: "What is your published threshold?",
  answer: "PUBLIC_QA_SENTINEL: the threshold is seven.", position: 1, removed_at: null });
const scope = { roomId: ROOM_ID, replicaId: REPLICA_ID, ownerUserId: OWNER, agentId: AGENT_ID };
const safeReply = "yes, that one is the same idea seen from the other end.";
const defaultDeps = { loadAgent, engine, reply: async () => safeReply, neverRules: [], tableApplied: async () => false };
async function setup({ remembers = false, items = [qa()], authUserId = USER_A } = {}) {
  const state = freshState({ publishedQA: items });
  const db = fakeDb(state), memlog = [];
  const deps = { ...defaultDeps, memory: fakeMemory(memlog) };
  const joined = await joinRoom(db, { slug: SLUG, authUserId, ageAttested: true, memoryConsent: remembers }, deps);
  return { state, db, memlog, deps, joined };
}
const say = (w, extra = {}) => roomSay(w.db, { session: w.joined.session,
  message: "What is the threshold?", transcript: [] }, { ...w.deps, ...extra });

{
  const w = await setup(); let input, compiled;
  const trackingEngine = { ...engine, compile: (value) => { input = value; return engine.compile(value); } };
  const turn = await say(w, { engine: trackingEngine, reply: async (value) => { compiled = value; return safeReply; } });
  assert.deepEqual(input.publicKnowledge, [{ id: SOURCE, question: qa().question, answer: qa().answer }]);
  assert.equal(input.memories, "");
  assert.deepEqual(compiled.publicKnowledge.ids, [SOURCE]);
  assert.ok(compiled.tail.includes(compiled.publicKnowledge.block) && compiled.publicKnowledge.block.includes("PUBLIC_QA_SENTINEL"));
  assert.equal(w.memlog.length, 0);
  assert.ok(turn.reply && turn.bubbles.length && turn.gate.applied);
  assert.equal(turn.knowledge.relation, "provided_to_model");
  assert.equal(turn.knowledge.exact, false);
  assert.equal(turn.knowledge.reply_sha256, sha(turn.reply));
  assert.deepEqual(turn.knowledge.sources.map(x => x.id), [SOURCE]);
  assert.ok(!JSON.stringify(turn.knowledge).includes(qa().answer));
  assert.equal(w.db.calls.filter(sql => sql === PUBLIC_ROOM_KNOWLEDGE_SQL).length, 3);
  assert.ok(!w.db.calls.some(sql => /from vy_context_item|from vy_replica_claim/.test(sql)));
  pass("actual memory-off Room compiles public evidence separately, revalidates twice and returns honest supplied-source metadata");
}

{
  const w = await setup({ remembers: true });
  const other = await joinRoom(w.db, { slug: SLUG, authUserId: USER_B, ageAttested: true, memoryConsent: true }, w.deps);
  for (const [joined, person, marker, forbidden] of [[w.joined, PERSON_A, "PRIVATE_PERSON_A", "PRIVATE_PERSON_B"],
    [other, PERSON_B, "PRIVATE_PERSON_B", "PRIVATE_PERSON_A"]]) {
    let compiled;
    const memory = { ...fakeMemory(w.memlog), recall: async (p, a) => {
      assert.equal(p, person); assert.equal(a, AGENT_ID); return [{ body: marker }];
    } };
    const turn = await roomSay(w.db, { session: joined.session, message: "the threshold?" }, {
      ...w.deps, memory, reply: async (value) => { compiled = value; return safeReply; },
    });
    assert.ok(compiled.tail.includes(marker));
    assert.ok(!JSON.stringify(compiled).includes(forbidden));
    assert.ok(!JSON.stringify(compiled.publicKnowledge).includes(marker));
    assert.ok(!JSON.stringify(turn.knowledge).includes(marker));
  }
  pass("two actual Room followers retain exact private recall scope while public material and metadata stay shared and nonprivate");
}

{
  const w = await setup({ items: [] });
  const turn = await say(w);
  assert.ok(turn.reply); assert.equal(turn.knowledge, null); assert.equal(w.memlog.length, 0);
  pass("eligible empty public corpus preserves ordinary reply and no-memory behavior");
}

{
  const w = await setup({ items: [qa(), { ...qa(), id: "d1000000-0000-4000-8000-000000000002", position: 2,
    question: "REMOVED_PUBLIC_QUESTION", removed_at: "2026-09-07" },
  { ...qa(), id: "d1000000-0000-4000-8000-000000000003", room_id: "d0000000-0000-4000-8000-000000000002",
    question: "OTHER_ROOM_QUESTION" }] });
  const result = await roomCitations(w.db, { session: w.joined.session }, w.deps);
  assert.deepEqual(result.sources, [qa().question]);
  assert.equal(result.exact, false); assert.equal(result.relation, "published_catalog");
  assert.ok(!JSON.stringify(result).includes("Class 12 mechanics notes"));
  assert.ok(!w.db.calls.some(sql => sql.includes("from vy_context_item c")));
  const payload = readRoomSession(w.joined.session);
  await assert.rejects(roomCitations(w.db, { session: mintRoomSession({ ...payload,
    a: "b1000000-0000-4000-8000-000000000099" }) }, w.deps), { code: "room_unavailable" });
  pass("actual citations catalog exposes only active public questions, has no exact-use claim and refuses a changed session agent");
}

for (const key of Object.keys(scope)) {
  const w = await setup();
  await assert.rejects(readPublicRoomKnowledge(w.db, { ...scope, [key]: "f0000000-0000-4000-8000-000000000099" }), { code: "room_knowledge_unavailable" });
}
pass("shared fixture honors all four exact reader authority predicates");

for (const field of ["published_at", "paused_at"]) {
  const w = await setup(); let providers = 0;
  w.state.rooms[0][field] = field === "published_at" ? null : "2026-09-07";
  await assert.rejects(say(w, { reply: async () => { providers++; return safeReply; } }), { code: "room_unavailable" });
  assert.equal(providers, 0); assert.equal(w.memlog.length, 0);
}
pass("unpublished or paused Room refuses before provider and memory work");

for (const broken of ["missing_metadata", "missing_block", "wrong_ids", "oversized_tail"]) {
  const w = await setup(); let providers = 0;
  const badEngine = { ...engine, compile: (input) => {
    const out = engine.compile(input);
    if (broken === "missing_metadata") return { ...out, publicKnowledge: undefined };
    if (broken === "missing_block") return { ...out, tail: out.tail.replace(out.publicKnowledge.block, "") };
    if (broken === "wrong_ids") return { ...out, publicKnowledge: { ...out.publicKnowledge, ids: [] } };
    return { ...out, tail: out.tail + "x".repeat(24_001) };
  } };
  await assert.rejects(say(w, { engine: badEngine, reply: async () => { providers++; return safeReply; } }), { code: "room_knowledge_prompt_unavailable" });
  assert.equal(providers, 0);
}
pass("missing/stale compiler metadata, absent prompt block and truncation risk refuse before provider");

{
  const w = await setup(); let providers = 0;
  const changingEngine = { ...engine, compile: (input) => {
    const compiled = engine.compile(input); w.state.publishedQA[0].removed_at = "2026-09-07"; return compiled;
  } };
  await assert.rejects(say(w, { engine: changingEngine, reply: async () => { providers++; return safeReply; } }), { code: "room_knowledge_changed" });
  assert.equal(providers, 0);
  pass("source removed after initial read is refused at actual pre-provider revalidation");
}

for (const mutate of [w => { w.state.publishedQA[0].removed_at = "2026-09-07"; },
  w => { w.state.publishedQA[0].answer = "changed after provider"; },
  w => { w.state.rooms[0].paused_at = "2026-09-07"; }]) {
  const w = await setup({ remembers: true }); let providers = 0;
  await assert.rejects(say(w, { reply: async () => { providers++; mutate(w); return safeReply; } }),
    error => ["room_knowledge_changed", "room_knowledge_unavailable"].includes(error.code));
  assert.equal(providers, 1);
  assert.equal(w.memlog.filter(x => x.call === "logTurn" && x.role === "her").length, 0);
}
pass("removal/edit/Room pause after provider blocks successful delivery and assistant memory logging");

{
  const w = await setup(); let providers = 0;
  const underlying = w.db;
  w.db = async (sql, params) => {
    if (sql === PUBLIC_ROOM_KNOWLEDGE_SQL) throw new Error("synthetic read failure");
    return underlying(sql, params);
  };
  await assert.rejects(say(w, { reply: async () => { providers++; return safeReply; } }), { code: "room_knowledge_read_failed" });
  assert.equal(providers, 0);
  pass("public retrieval failure is a named platform refusal, never a generic-model fallback");
}

{
  const w = await setup(); let providerRequest;
  const env = { VYAKTI_MODEL_SERVING: "azure_only", AZURE_FOUNDRY_REPLY_ENDPOINT: "https://fixture.services.ai.azure.com/",
    AZURE_FOUNDRY_REPLY_MODEL: "fixture-model", AZURE_FOUNDRY_REPLY_API_KEY: "fixture-not-a-real-key",
    AZURE_REPLICA_APP_BUDGET_USD: "1", AZURE_FOUNDRY_REPLY_INPUT_USD_PER_MTOKENS: "1",
    AZURE_FOUNDRY_REPLY_OUTPUT_USD_PER_MTOKENS: "1" };
  let reservation;
  const ledger = async (sql, p) => {
    if (sql.includes("insert into vy_provider_budget")) return [];
    if (sql.includes("with budget as")) {
      reservation = { reservation_id: "fixture-reservation", budget_id: p[0], request_hash: p[7], reserved_microusd: p[10], state: "reserved" };
      return [reservation];
    }
    if (sql.includes("set state='in_flight'")) return [{ ...reservation, state: "in_flight" }];
    if (sql.includes("with settled as")) return [{ budget_id: reservation.budget_id }];
    if (sql.includes("reconcile_required") || sql.includes("with released as")) return [];
    assert.fail("unexpected fixture ledger statement");
  };
  const turn = await say(w, { reply: (compiled, turns) => think(engine, compiled, turns, { env, db: ledger,
    fetchImpl: async (url, init) => {
      assert.equal(new URL(url).origin, "https://fixture.services.ai.azure.com");
      assert.equal(init.redirect, "error"); providerRequest = JSON.parse(init.body);
      return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: safeReply } }],
        usage: { prompt_tokens: 20, completion_tokens: 8 } }));
    } }) });
  const requestText = JSON.stringify(providerRequest.messages);
  assert.ok(requestText.includes("PUBLIC_QA_SENTINEL") && requestText.includes(SOURCE));
  assert.ok(!requestText.includes("Class 12 mechanics notes") && !requestText.includes("Doubt session transcript"));
  assert.equal(providerRequest.model, "fixture-model"); assert.equal(turn.knowledge.exact, false);
  assert.equal(w.memlog.length, 0);
  pass("actual Room compiler and shared think/Azure adapter send public Q&A through bounded Azure request with fake transport only");
}

console.log(`room knowledge integration: ${checks} checks passed; offline only, no SQL/model/network proof`);
