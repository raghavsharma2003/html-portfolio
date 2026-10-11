// Actual history/service helpers, injected database rows only. SQL semantics
// are proved separately by dialogue-history-live.mjs on isolated development.
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { readFileSync } from "node:fs";
import { canonicalJson, sha256Hex } from "../api/_provenance/contracts.js";
const dbUrl = new URL("../api/_db.js", import.meta.url).href;
const recallUrl = new URL("../api/_recall-run.js", import.meta.url);
const recallVersion = readFileSync(recallUrl, "utf8").match(/export const RECALL_RUN_METHOD_VERSION = "[^"]+";/)[0];
const hooks = registerHooks({ load(url, context, next) {
  if (url === dbUrl) return { format: "module", shortCircuit: true, source: "export async function q(){throw new Error('default DB forbidden')}" };
  if (url === recallUrl.href) return { format: "module", shortCircuit: true, source: recallVersion };
  return next(url, context);
} });
let history, handler;
try { history = await import("../api/_replica-dialogue-history.js"); handler = (await import("../api/_replica-dialogue.js")).createReplicaDialogueHandler; }
finally { hooks.deregister(); }
const { DIALOGUE_HISTORY_SQL: READ, DIALOGUE_OPEN_SQL: OPEN, DIALOGUE_HISTORY_SPEND_SQL: SPEND,
  readOwnedDialogueHistory: read, openOwnedDialogueSession: open } = history;
const rid = "10000000-0000-4000-8000-000000000001", owner = "20000000-0000-4000-8000-000000000001";
const sid = "30000000-0000-4000-8000-000000000001", tid = "40000000-0000-4000-8000-000000000001";
const delivery = { mode: "grounded", pace: "natural", intensity: 0.2, language_hint: "English", nonverbals: [] };
const candidate = { turn_id: tid, provider_family: "azure", provider_name: "synthetic", provider_version: "v1", model: "synthetic" };
const hash = sha256Hex(canonicalJson({ operation: "dialogue", request_key: tid, provider_family: candidate.provider_family,
  provider_name: candidate.provider_name, provider_version: candidate.provider_version, model: candidate.model }));
const empty = () => ({ runtime_active: true, session_id: null, exchanges: [], billing_candidates: [], pending: false, latest_request: null });
const complete = () => ({ ...empty(), session_id: sid, exchanges: [{ turn_id: tid, ordinal: 1, trace_id: "synthetic-trace",
  question: "Synthetic earlier question", reply: "Synthetic earlier answer", delivery, created_at: "2026-09-07T00:00:00Z" }],
  billing_candidates: [candidate], latest_request: { trace_id: "synthetic-trace", state: "complete" } });
let checks = 0;
const ok = name => console.log(`ok ${++checks} - ${name}`);

const calls = [];
assert.deepEqual(await read(async (sql, params) => { calls.push({ sql, params }); return [empty()]; }, owner, { replica_id: rid }),
  { replica_id: rid, session_id: null, exchanges: [], latest_request: null, pending: false, billing_pending: false });
assert.equal(calls.length, 1); assert.equal(calls[0].sql, READ); assert.deepEqual(calls[0].params.slice(0, 3), [rid, owner, null]);
ok("empty read uses exact authenticated scope and creates no session");
await assert.rejects(() => read(async () => { throw new Error("SQL unavailable"); }, owner, { replica_id: rid }), /SQL unavailable/);
ok("SQL failure is not an empty conversation");
await assert.rejects(() => read(async () => [{ ...empty(), runtime_active: false }], owner, { replica_id: rid }), { code: "dialogue_runtime_not_active" });
await assert.rejects(() => read(async () => [empty()], owner, { replica_id: rid, session_id: sid }), { code: "dialogue_session_not_authorized" });
ok("inactive runtime and missing exact session refuse rather than select another session");
for (const bad of ["bad", {}, "00000000-0000-0000-0000-000000000000"])
  await assert.rejects(() => open(async () => assert.fail("DB must not run"), owner, { replica_id: rid, session_id: bad }), { code: "valid_session_id_required" });
ok("invalid new-session key refuses before SQL");
assert.equal((await open(async (sql, params) => { assert.equal(sql, OPEN); assert.deepEqual(params.slice(0, 3), [rid, owner, sid]); return [{ session_id: sid }]; }, owner,
  { replica_id: rid, session_id: sid, owner_user_id: "ignored-attacker" })).session_id, sid);
await assert.rejects(() => open(async () => [], owner, { replica_id: rid, session_id: sid }), { code: "dialogue_session_not_authorized" });
ok("open uses actor identity and exact UUID; refused insertion is not success");
for (const state of ["settled", "reserved", "in_flight", "reconcile_required", "released"]) {
  const result = await read(async (sql, params) => {
    if (sql === READ) return [complete()];
    assert.equal(sql, SPEND); assert.deepEqual(params, [[hash]]); return [{ request_hash: hash, state }];
  }, owner, { replica_id: rid, session_id: sid });
  assert.equal(result.exchanges[0].answer.session_id, sid);
  assert.equal(result.billing_pending, !["settled", "released"].includes(state));
  assert.equal(result.exchanges[0].answer.billing_state, state === "settled" ? "settled" : state === "released" ? "not_metered" : "reconcile_required");
}
ok("restored billing uses the exact existing budget commitment and retains uncertainty");
await assert.rejects(() => read(async sql => { if (sql === READ) return [complete()]; throw new Error("ledger unavailable"); }, owner, { replica_id: rid }), /ledger unavailable/);
ok("ledger read failure cannot unlock a restored reply");
const pending = await read(async () => [{ ...empty(), session_id: sid, pending: true, latest_request: { state: "generating", trace_id: "synthetic-trace" } }], owner, { replica_id: rid });
assert.equal(pending.pending, true); assert.deepEqual(pending.exchanges, []);
ok("unfinished request is represented without inventing a completed answer");
const malformed = complete(); malformed.exchanges[0].delivery = null;
await assert.rejects(() => read(async sql => sql === READ ? [malformed] : [], owner, { replica_id: rid }), { code: "dialogue_history_invalid" });
ok("malformed completed answer refuses the history response");
const safe = await read(async sql => sql === READ ? [complete()] : [], owner, { replica_id: rid });
assert(!/provider_family|provider_name|provider_version|request_hash|billing_candidates|owner_user_id|agent_id|person_id/.test(JSON.stringify(safe)));
ok("client history exposes no provider, person, log or ledger identifiers");
for (const operation of ["read", "open"]) {
  let resolves = 0; const response = { statusCode: 0, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  const serve = handler({ db: async sql => sql === READ ? [empty()] : sql === OPEN ? [{ session_id: sid }] : assert.fail("unexpected query"),
    requireUser: async () => ({ id: owner }), resolveGenerator: async () => { resolves++; throw new Error("provider forbidden"); } });
  await serve(operation === "read" ? { method: "GET", query: { replica_id: rid } } : { method: "POST", body: { op: "open_session", replica_id: rid, session_id: sid } }, response);
  assert.equal(response.statusCode, operation === "read" ? 200 : 201); assert.equal(resolves, 0);
}
ok("actual endpoint helper restores and opens without resolving any provider");
let queried = false; const denied = { status(code) { this.code = code; return this; }, json(body) { this.body = body; } };
await handler({ db: async () => { queried = true; }, requireUser: async () => { throw Object.assign(new Error("unauthorized"), { code: "unauthorized", status: 401 }); }, resolveGenerator: async () => assert.fail() })({ method: "GET", query: { replica_id: rid } }, denied);
assert.equal(denied.code, 401); assert.equal(queried, false);
ok("unauthenticated history stops before database work");
console.log(`ALL ${checks} PASS (injected SQL rows; no SQL execution or model calls)`);
