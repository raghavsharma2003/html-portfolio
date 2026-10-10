// Actual post-turn caller -> owner authority -> shared lease/meter -> next-turn recall.
// Database and provider are deterministic local doubles; no network or real SQL.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const runtime = await import("../../api/_replica-runtime.js");
const dialogue = await import("../../api/_replica-dialogue.js");
const authority = await import("../../api/_room-memory-authority.js");
const meter = await import("../../api/_room-memory-consolidation.js");
const { drainOwnerMemory } = await import("../../api/_owner-memory-drain.js");
const { llm } = await import("../../api/consolidate.js");
const { AuthError } = await import("../../api/_auth.js");
const { createOwnerMemoryDrainHandler, default: endpoint } = await import("../../api/replica-memory-drain.js");

const REPLICA_ID = "11111111-1111-4111-8111-111111111111";
const OWNER_ID = "22222222-2222-4222-8222-222222222222";
const PERSON_ID = "33333333-3333-4333-8333-333333333333";
const AGENT_ID = "44444444-4444-4444-8444-444444444444";
const OTHER_AGENT = "55555555-5555-4555-8555-555555555555";
const OTHER_PERSON = "66666666-6666-4666-8666-666666666666";
const env = {
  VYAKTI_MODEL_SERVING: "azure_only",
  CONSOLIDATE_SWEEP_MODE: "room_only",
  CONSOLIDATE_ROOM_DEV: "1",
  CONSOLIDATE_ROOM_PERSON_LIMIT: "1",
  CONSOLIDATE_KILL: "0",
  AZURE_FOUNDRY_ENDPOINT: "https://fixture.services.ai.azure.com",
  AZURE_FOUNDRY_API_KEY: "synthetic-key",
  AZURE_FOUNDRY_ROOM_MEMORY_MODEL: "gpt-4.1-mini",
  AZURE_FOUNDRY_ROOM_MEMORY_EXPECTED_RESPONSE_MODEL: "gpt-4.1-mini-2025-04-14",
  AZURE_REPLICA_BUDGET_ID: "owner-memory-delivery-fixture",
  AZURE_REPLICA_APP_BUDGET_USD: "1",
  AZURE_FOUNDRY_INPUT_USD_PER_MTOKENS: "0.4",
  AZURE_FOUNDRY_OUTPUT_USD_PER_MTOKENS: "1.6",
};
const profile = {
  schema: "vyakti.person-model.v1",
  identity: { self_name: "Private Owner", pronouns: "", home: "", culture: "" },
  speech: { languages: ["English"], code_switching: "", register: "", fillers: [], pacing: "", dialogue_register: { sources: 0, claims: [] } },
  behavior: { turn_shape: "", humor: "", disagreement: "", repair: "", emotional_regulation: "" },
  values: [], boundaries: [], autobiography: [], knowledge: [], relationship_modes: [], uncertainty: { alternatives: [] },
  provenance: { builder: "person-model-builder/v1", claims: [] },
};
const status = {
  replica_id: REPLICA_ID, subject_mode: "self", lifecycle: "enrolling", subject_person_id: PERSON_ID,
  account_person_matches: true, inference_consent: true, profile_approved: true, profile_version: 1,
  capability_state: null, qualification_passed: 0, candidate_binding_required: false,
  agent_id: AGENT_ID,
};

function replyGenerator(text) {
  return { family: "fixture", name: "fixture", version: "1", model: "fixture", async generate({ prompt }) {
    replyGenerator.lastPrompt = prompt.messages[0].content;
    return { output: { reply: text, delivery: { mode: "grounded", pace: "natural", intensity: 0.4, language_hint: "", nonverbals: [] } } };
  } };
}

function world() {
  const state = {
    memoryOn: true, logs: [], facts: [], forgotten: new Set(), leases: new Map(), spends: new Map(),
    providerCalls: 0, personaWrites: 0, commitRefuse: false, events: [], nextLog: 100,
  };
  const device = authority.ownerMeetDeviceId(PERSON_ID);
  state.logs.push(
    { id: "91", content: "Sibling agent secret", device_id: device, agent_id: OTHER_AGENT, person_id: PERSON_ID, episode_id: null, room_memory_follower_id: null, speaker_person_id: null },
    { id: "92", content: "Sibling person secret", device_id: "77777777-7777-4777-8777-777777777777", agent_id: AGENT_ID, person_id: OTHER_PERSON, episode_id: null, room_memory_follower_id: null, speaker_person_id: null },
    { id: "93", content: "Room-only secret", device_id: "88888888-8888-4888-8888-888888888888", agent_id: AGENT_ID, person_id: PERSON_ID, episode_id: null, room_memory_follower_id: "99999999-9999-4999-8999-999999999999", speaker_person_id: PERSON_ID },
  );
  const ownedPending = () => state.logs.filter((row) => row.agent_id === AGENT_ID && row.person_id === PERSON_ID
    && row.episode_id === null && row.room_memory_follower_id === null && row.speaker_person_id === null
    && ![...state.forgotten].some((term) => row.content.toLowerCase().includes(term.toLowerCase())));
  state.db = async (sql, params = []) => {
    if (/\b(?:insert into|update|delete from)\s+vy_teacher_sheet\b/i.test(sql)) state.personaWrites++;
    if (sql === runtime.OWNED_PRIVATE_RUNTIME_CONTEXT_SQL) return [];
    if (sql === runtime.RUNTIME_STATUS_SQL) return params[0] === REPLICA_ID && params[1] === OWNER_ID ? [{ ...status }] : [];
    if (sql === runtime.TEXT_CAPABILITY_ENSURE_SQL) return [{ capability_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }];
    if (sql === runtime.OWNED_TEXT_PROFILE_SQL) return [{ version: 1, definition: JSON.stringify(profile) }];
    if (sql === dialogue.OWNER_PERSON_TALK_SHEET_SQL) return [];
    if (sql === authority.OWNER_MEMORY_CONSENT_STATUS_SQL) return [{ memory_on: state.memoryOn }];
    if (sql === authority.OWNER_MEMORY_RECALL_SQL) return state.memoryOn ? state.facts.map((fact) => ({ ...fact })) : [];
    if (sql === authority.OWNER_MEMORY_LOG_SQL) {
      if (!state.memoryOn || params[0] !== REPLICA_ID || params[1] !== OWNER_ID || params[2] !== device) return [];
      const row = { id: String(state.nextLog++), content: params[3], device_id: device, agent_id: AGENT_ID,
        person_id: PERSON_ID, episode_id: null, room_memory_follower_id: null, speaker_person_id: null };
      state.logs.push(row); state.events.push("persist"); return [{ id: row.id }];
    }
    if (sql === authority.OWNER_MEMORY_BATCH_SQL) {
      state.events.push("batch");
      if (!state.memoryOn || params[0] !== REPLICA_ID || params[1] !== OWNER_ID) return [];
      return ownedPending().map((row) => ({ ...row, replica_id: REPLICA_ID }));
    }
    if (sql === authority.OWNER_MEMORY_COMMIT_SQL) {
      state.events.push("commit");
      if (state.commitRefuse || !state.memoryOn) return [];
      const sources = JSON.parse(params[2]);
      const proposals = JSON.parse(params[3]);
      const current = ownedPending().filter((row) => sources.some((source) => source.id === row.id && source.content === row.content));
      if (current.length !== sources.length) return [];
      const episode = String(800 + state.facts.length);
      for (const proposal of proposals) state.facts.push({ id: String(900 + state.facts.length), body: proposal.quote,
        kind: proposal.kind, name: proposal.name, created_at: new Date().toISOString(), citations: [episode] });
      current.forEach((row) => { row.episode_id = episode; });
      return [{ facts_written: proposals.length, observations_written: 0, sources_consumed: current.length }];
    }
    if (sql === meter.ROOM_MEMORY_CLAIM_SQL) {
      state.events.push("claim");
      const key = `${params[0]}:${params[1]}`;
      const lease = state.leases.get(key);
      if (lease && lease.leased_by.startsWith("room-memory:") && !["settled", "released"].includes(state.spends.get(lease.request_hash)?.state)) return [];
      state.leases.set(key, { run_id: params[2], leased_by: "sweep" });
      return [{ agent_id: params[0], person_id: params[1] }];
    }
    if (sql === meter.ROOM_MEMORY_ADMIT_SQL) {
      state.events.push("admit");
      const key = `${params[0]}:${params[1]}`; const lease = state.leases.get(key);
      if (!lease || lease.run_id !== params[2] || lease.leased_by !== "sweep") return [];
      lease.leased_by = params[3]; lease.request_hash = params[3].split(":").at(-1);
      return [{ person_id: params[1] }];
    }
    if (sql === meter.ROOM_MEMORY_RELEASE_SQL) {
      state.events.push("release");
      const key = `${params[0]}:${params[1]}`; const lease = state.leases.get(key);
      if (!lease || lease.run_id !== params[2]) return [];
      const spend = state.spends.get(lease.request_hash);
      if (lease.leased_by.startsWith("room-memory:") && !["settled", "released"].includes(spend?.state)) return [];
      state.leases.delete(key); return [{ person_id: params[1] }];
    }
    if (sql === meter.ROOM_MEMORY_CANCEL_ADMISSION_SQL) return [];
    if (sql.includes("insert into vy_provider_budget")) { state.events.push("budget-init"); return []; }
    if (sql.includes("insert into vy_provider_spend")) {
      state.events.push("reserve");
      let spend = state.spends.get(params[7]);
      if (!spend) {
        spend = { reservation_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", budget_id: params[0], request_hash: params[7],
          reserved_microusd: params[10], state: "reserved" };
        state.spends.set(params[7], spend);
      }
      return [{ ...spend }];
    }
    if (sql.includes("set state='in_flight'")) {
      const spend = [...state.spends.values()].find((item) => item.reservation_id === params[0]);
      spend.state = "in_flight"; state.events.push("begin"); return [{ reservation_id: spend.reservation_id, state: spend.state }];
    }
    if (sql.includes("with settled as")) {
      const spend = [...state.spends.values()].find((item) => item.reservation_id === params[0]);
      spend.state = "settled"; state.events.push("settle"); return [{ spent_microusd: params[5], reserved_microusd: 0 }];
    }
    if (sql.includes("with released as")) return [{ reserved_microusd: 0 }];
    if (sql.includes("set state='reconcile_required'")) return [];
    if (/from vy_(?:rel_state|pattern|ritual|currency|phrase|kin)\b/.test(sql)) return [];
    if (sql.includes("from vy_replica where replica_id = $1::uuid and owner_user_id = $2::uuid")) return [{ replica_id: params[0] }];
    if (sql.includes("from vy_replica_vibe where replica_id=$1::uuid and owner_user_id=$2::uuid")) return [];
    throw new Error(`owner-memory-delivery fixture: unmatched SQL (${sql.length}): ${sql.slice(0, 100)}`);
  };
  state.fetch = async (url, init) => {
    state.providerCalls++; state.events.push("provider");
    assert.equal(url, "https://fixture.services.ai.azure.com/openai/v1/chat/completions");
    const body = JSON.parse(init.body);
    const sources = JSON.parse(body.messages[1].content);
    assert(sources.every((source) => !source.content.includes("Sibling") && !source.content.includes("Room-only")));
    const source = sources[0];
    return new Response(JSON.stringify({ model: env.AZURE_FOUNDRY_ROOM_MEMORY_EXPECTED_RESPONSE_MODEL,
      usage: { prompt_tokens: 80, completion_tokens: 20 }, choices: [{ finish_reason: "stop", message: { content: JSON.stringify({
        memories: [{ source_id: source.id, kind: "user", name: "project", quote: source.content, communication: null }],
      }) } }] }));
  };
  state.drain = (requestId) => drainOwnerMemory({ db: state.db, ownerUserId: OWNER_ID,
    input: { replica_id: REPLICA_ID, request_id: requestId }, model: llm, env, fetchImpl: state.fetch });
  return state;
}

let checks = 0;
async function check(name, fn) { await fn(); checks++; console.log(`ok ${name}`); }

await check("successful Meet answer persists, drains through the shared meter, and reaches the next prompt", async () => {
  const state = world();
  const first = await dialogue.generateOwnedTextDialogue(state.db, OWNER_ID,
    { replica_id: REPLICA_ID, message: "My release checklist lives in Notion." }, replyGenerator("I will remember."), null);
  assert.equal(first.session_id, null);
  const drained = await state.drain("dialogue_success_00000001");
  assert.deepEqual(drained, { state: "updated", facts_written: 1, sources_consumed: 1 });
  const second = await dialogue.generateOwnedTextDialogue(state.db, OWNER_ID,
    { replica_id: REPLICA_ID, message: "Where is my release checklist?" }, replyGenerator("In Notion."), null);
  assert.equal(second.has_memory, true);
  assert.match(replyGenerator.lastPrompt, /My release checklist lives in Notion\./);
  assert.equal(state.providerCalls, 1);
  assert.equal(state.personaWrites, 0);
  assert.deepEqual(state.events.filter((event) => ["claim", "batch", "admit", "budget-init", "reserve", "begin", "provider", "settle", "commit", "release"].includes(event)),
    ["claim", "batch", "admit", "budget-init", "reserve", "batch", "begin", "provider", "settle", "commit", "release"]);
  assert.equal(state.leases.size, 0);
  assert(state.logs.slice(0, 3).every((row) => row.episode_id === null));
});

await check("forgotten, sibling-agent, sibling-person, and Room sources never reach the provider", async () => {
  const state = world();
  await dialogue.generateOwnedTextDialogue(state.db, OWNER_ID,
    { replica_id: REPLICA_ID, message: "My retired project was Cedar." }, replyGenerator("Understood."), null);
  state.forgotten.add("Cedar");
  const result = await state.drain("dialogue_forgotten_0001");
  assert.equal(result.state, "idle");
  assert.equal(result.reason, "no_authorized_sources");
  assert.equal(state.providerCalls, 0);
  assert.equal(state.facts.length, 0);
  assert.equal(state.logs.filter((row) => row.episode_id !== null).length, 0);
});

await check("same request identity cannot dispatch a settled provider request twice", async () => {
  const state = world();
  await dialogue.generateOwnedTextDialogue(state.db, OWNER_ID,
    { replica_id: REPLICA_ID, message: "My active project is Birch." }, replyGenerator("Understood."), null);
  state.commitRefuse = true;
  const first = await state.drain("dialogue_repeat_000001");
  assert.equal(first.state, "idle");
  assert.equal(first.reason, "memory_authority_changed");
  assert.equal(state.providerCalls, 1);
  const second = await state.drain("dialogue_repeat_000001");
  assert.equal(second.state, "pending");
  assert.equal(state.providerCalls, 1);
  assert.equal(state.leases.size, 0);
});

await check("memory off and invalid configuration refuse before lease or provider", async () => {
  const off = world(); off.memoryOn = false;
  assert.equal((await off.drain("dialogue_memory_off_01")).state, "off");
  assert.equal(off.events.includes("claim"), false);
  const broken = { ...env }; delete broken.AZURE_FOUNDRY_ROOM_MEMORY_MODEL;
  await assert.rejects(drainOwnerMemory({ db: off.db, ownerUserId: OWNER_ID,
    input: { replica_id: REPLICA_ID, request_id: "dialogue_unavailable_1" }, model: llm, env: broken, fetchImpl: off.fetch }));
  assert.equal(off.providerCalls, 0);
});

await check("endpoint authenticates POST, rejects GET, and refuses an absent owner runtime", async () => {
  let authenticated = 0;
  const handler = createOwnerMemoryDrainHandler({
    db: async () => [], env, model: llm,
    authenticate: async () => { authenticated++; return { id: OWNER_ID }; },
  });
  const response = () => ({ code: 0, payload: null, status(code) { this.code = code; return this; }, json(value) { this.payload = value; return this; } });
  const res = response();
  await handler({ body: { replica_id: REPLICA_ID, request_id: "dialogue_pending_0001" } }, res);
  assert.equal(authenticated, 1);
  assert.equal(res.code, 409); // exact owner runtime is absent, never fabricated
  const denied = createOwnerMemoryDrainHandler({ authenticate: async () => { throw new AuthError("invalid_session"); } });
  const deniedRes = response(); await denied({}, deniedRes); assert.equal(deniedRes.code, 401);
  const getRes = { ...response(), setHeader() {}, end() { return this; } };
  await endpoint({ method: "GET", headers: {}, socket: { remoteAddress: "127.0.0.1" } }, getRes);
  assert.equal(getRes.code, 405);
});

await check("Studio starts one authenticated post-turn drain and refreshes only after it resolves", async () => {
  const ui = readFileSync(join(ROOT, "src/studio/ExpertConversation.tsx"), "utf8");
  const client = readFileSync(join(ROOT, "src/studio/dialogueApi.ts"), "utf8");
  assert.match(client, /replicaRequest<\{ memory: MeetMemoryDrain \}>\(token, "\/api\/replica-memory-drain"/);
  assert.match(client, /method: "POST"/);
  assert.match(ui, /requestMeetMemoryDrain\(token, replicaId, traceId\)\.then\(\s*\(\) => loadMemory/);
  assert.equal((ui.match(/requestMeetMemoryDrain\(token, replicaId, traceId\)/g) || []).length, 1);
});

console.log(`Owner memory delivery: ${checks} focused checks passed (offline DB/provider doubles; SQL unparsed)`);
