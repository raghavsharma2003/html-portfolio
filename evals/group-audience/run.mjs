// Offline protocol/control-flow tests only: injected Telegram responses and
// fake SQL for the existing clone binder. No socket, database or provider call.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { createTelegramGroupAuthority } from "../../api/_group-audience.js";

const AGENT = "a0000000-0000-4000-8000-000000000001";
const OTHER = "a0000000-0000-4000-8000-000000000002";
const P1 = "b0000000-0000-4000-8000-000000000001";
const P2 = "b0000000-0000-4000-8000-000000000002";
const BOT = "700001";
const room = () => ({ id: "91", agent_id: AGENT, surface: "telegram", surface_chat_id: "-100001",
  read_consent_at: "2026-09-29T00:00:00Z", member_cap: 6 });
const members = () => [
  { person_id: P1, surface: "telegram", surface_user_id: "101", linked_at: "2026-09-29T00:01:00Z", left_at: null },
  { person_id: P2, surface: "telegram", surface_user_id: "102", linked_at: "2026-09-29T00:02:00Z", left_at: null },
];
const event = () => ({ surface: "telegram", isGroup: true, chatKey: "-100001" });
const args = () => ({ room: room(), roomId: "91", agentId: AGENT, linkedMembers: members() });
const success = (result) => ({ ok: true, result });
const member = (id, status = "member") => ({ user: { id: Number(id), is_bot: id === BOT }, status });
function fixture() {
  const calls = [];
  const state = { count: 3, counts: [], bot: { id: Number(BOT), is_bot: true },
    chat: { id: -100001, type: "supergroup" },
    members: new Map([[BOT, member(BOT, "administrator")], ["101", member("101")], ["102", member("102")]]) };
  const client = {
    async getMe() { calls.push(["getMe"]); return success(state.bot); },
    async getChatMemberCount(chat) { calls.push(["getChatMemberCount", chat]); return success(state.counts.length ? state.counts.shift() : state.count); },
    async getChatMember(chat, id) { calls.push(["getChatMember", chat, id]); return success(state.members.get(String(id))); },
    async getChat(chat) { calls.push(["getChat", chat]); return success(state.chat); },
  };
  return { calls, state, client, hooks: createTelegramGroupAuthority(client, { agentId: AGENT, botId: BOT }) };
}
let groups = 0;
async function check(name, run) {
  await run();
  groups++;
  console.log(`ok ${groups} ${name}`);
}
const rejects = (run) => assert.rejects(run, (error) => error.code === "group_audience_unverified"
  && error.message === "group_audience_unverified" && error.status === 403 && !error.cause);

await check("complete sorted audience with bracketing count and bot checks", async () => {
  const f = fixture();
  const input = args();
  input.linkedMembers.reverse();
  const result = await f.hooks.groupAudienceWitness(event(), input);
  assert.deepEqual(result.recipients, [P1, P2]);
  assert.equal(result.complete, true);
  assert.match(result.revision, /^[a-f0-9]{64}$/);
  assert(Object.isFrozen(result) && Object.isFrozen(result.recipients));
  assert.deepEqual(f.calls.map((call) => call[0]), ["getMe", "getChatMemberCount", "getChatMember", "getChat",
    "getChatMember", "getChatMember", "getChat", "getChatMember", "getChatMemberCount"]);
  assert(f.calls.slice(1).every((call) => call[1] === "-100001"));
});
await check("revision is stable across SQL order and changes with server binding", async () => {
  const f = fixture();
  const first = await f.hooks.groupAudienceWitness(event(), args());
  const input = args();
  input.linkedMembers.reverse();
  assert.equal((await f.hooks.groupAudienceWitness(event(), input)).revision, first.revision);
  input.linkedMembers[0].linked_at = "2026-09-29T00:03:00Z";
  assert.notEqual((await f.hooks.groupAudienceWitness(event(), input)).revision, first.revision);
});
for (const [name, mutate] of [
  ["unknown silent reader", (f) => { f.state.count = 4; }],
  ["new member during verification", (f) => { f.state.counts = [3, 4]; }],
  ["member departed during verification", (f) => { f.state.counts = [3, 2]; }],
  ["count type is not trusted", (f) => { f.state.count = "3"; }],
  ["fractional count", (f) => { f.state.count = 3.5; }],
  ["oversized live audience", (f) => { f.state.count = 8; }],
  ["known human left with unchanged count", (f) => { f.state.members.set("101", member("101", "left")); }],
  ["known human banned", (f) => { f.state.members.set("101", member("101", "kicked")); }],
  ["restricted nonmember", (f) => { f.state.members.set("101", { ...member("101", "restricted"), is_member: false }); }],
  ["wrong returned identity", (f) => { f.state.members.set("101", member("999")); }],
  ["another bot is not a linked human", (f) => { f.state.members.get("101").user.is_bot = true; }],
  ["missing API identity", (f) => { f.state.members.delete("101"); }],
  ["our bot demoted", (f) => { f.state.members.set(BOT, member(BOT)); }],
  ["our bot is not this token", (f) => { f.state.bot.id = 700002; }],
  ["getMe returned human", (f) => { f.state.bot.is_bot = false; }],
  ["public supergroup has uncounted readers", (f) => { f.state.chat.username = "public_fixture"; }],
  ["collectible public username has uncounted readers", (f) => { f.state.chat.active_usernames = ["public_fixture"]; }],
  ["linked discussion audience", (f) => { f.state.chat.linked_chat_id = -999; }],
  ["location based chat", (f) => { f.state.chat.location = {}; }],
  ["community audience is unsupported", (f) => { f.state.chat.community = {}; }],
  ["future members can see old messages", (f) => { f.state.chat.has_visible_history = true; }],
  ["malformed history visibility", (f) => { f.state.chat.has_visible_history = null; }],
  ["channel is not a private group", (f) => { f.state.chat.type = "channel"; }],
  ["wrong chat metadata returned", (f) => { f.state.chat.id = -100002; }],
  ["privacy changes during verification", (f) => {
    let calls = 0;
    f.client.getChat = async () => success(++calls === 1 ? f.state.chat : { ...f.state.chat, username: "now_public" });
  }],
  ["bot demotion during verification", (f) => {
    const original = f.client.getChatMember;
    let checks = 0;
    f.client.getChatMember = async (chat, id) => id === BOT && ++checks === 2
      ? success(member(BOT)) : original(chat, id);
  }],
]) {
  await check(name, async () => {
    const f = fixture(); mutate(f);
    await rejects(() => f.hooks.groupAudienceWitness(event(), args()));
  });
}
await check("restricted current reader is included, not omitted", async () => {
  const f = fixture();
  f.state.members.set("101", { ...member("101", "restricted"), is_member: true });
  assert.deepEqual((await f.hooks.groupAudienceWitness(event(), args())).recipients, [P1, P2]);
});
for (const [name, mutate] of [
  ["missing SQL projection", (a) => { delete a.linkedMembers; }],
  ["empty recipient set", (a) => { a.linkedMembers = []; }],
  ["sparse recipient array", (a) => { delete a.linkedMembers[0]; }],
  ["duplicate person alias", (a) => { a.linkedMembers[1].person_id = P1; }],
  ["duplicate Telegram account", (a) => { a.linkedMembers[1].surface_user_id = "101"; }],
  ["unlinked current reader", (a) => { a.linkedMembers[0].linked_at = null; }],
  ["withdrawn reader", (a) => { a.linkedMembers[0].left_at = "2026-09-29T01:00:00Z"; }],
  ["missing active-state evidence", (a) => { delete a.linkedMembers[0].left_at; }],
  ["noncanonical person UUID", (a) => { a.linkedMembers[0].person_id = P1.toUpperCase(); }],
  ["noncanonical platform ID", (a) => { a.linkedMembers[0].surface_user_id = "0101"; }],
  ["unsafe platform number", (a) => { a.linkedMembers[0].surface_user_id = Number.MAX_SAFE_INTEGER + 1; }],
  ["unsupported member surface", (a) => { a.linkedMembers[0].surface = "discord"; }],
  ["malformed linkage date", (a) => { a.linkedMembers[0].linked_at = "yesterday"; }],
  ["room ID mismatch", (a) => { a.roomId = "92"; }],
  ["cross-agent scope", (a) => { a.agentId = OTHER; a.room.agent_id = OTHER; }],
  ["missing server agent binding", (a) => { delete a.room.agent_id; }],
  ["unsupported room surface", (a) => { a.room.surface = "whatsapp"; }],
  ["revoked room reading", (a) => { a.room.read_consent_at = null; }],
  ["recipient cap overflow", (a) => { a.room.member_cap = 1; }],
  ["unsupported room cap", (a) => { a.room.member_cap = 7; }],
  ["room username is not immutable chat identity", (a) => { a.room.surface_chat_id = "@example"; }],
]) {
  await check(name, async () => {
    const f = fixture(); const input = args(); mutate(input);
    await rejects(() => f.hooks.groupAudienceWitness(event(), input));
    assert.equal(f.calls.length, 0);
  });
}
await check("event destination cannot replace server room destination", async () => {
  const f = fixture();
  for (const ev of [{ ...event(), chatKey: "-100002" }, { ...event(), isGroup: false }, { ...event(), surface: "discord" }])
    await rejects(() => f.hooks.groupAudienceWitness(ev, args()));
  assert.equal(f.calls.length, 0);
});
await check("all transport failures collapse without provider text or tokens", async () => {
  for (const method of ["getMe", "getChatMember", "getChatMemberCount", "getChat"]) {
    for (const replacement of [undefined, async () => { throw new Error("sensitive-token-in-provider-url"); }, async () => ({ ok: false, description: "sensitive" })]) {
      const f = fixture(); f.client[method] = replacement;
      await rejects(() => f.hooks.groupAudienceWitness(event(), args()));
    }
  }
});
await check("link proof requires actual membership, not knowledge of room number", async () => {
  const f = fixture();
  const input = { ...args(), surfaceUserId: "101" };
  const proof = await f.hooks.verifyGroupMembership(input);
  assert.equal(proof.verified, true);
  assert.equal(proof.surfaceUserId, "101");
  assert.match(proof.revision, /^[a-f0-9]{64}$/);
  for (const status of ["left", "kicked", "restricted", "unknown"]) {
    f.state.members.set("101", member("101", status));
    await rejects(() => f.hooks.verifyGroupMembership(input));
  }
  await rejects(() => f.hooks.verifyGroupMembership({ ...input, surfaceUserId: BOT }));
});
await check("verification uses immutable input copy across await", async () => {
  const f = fixture(); const input = args();
  const expected = await f.hooks.groupAudienceWitness(event(), input);
  const original = f.client.getMe;
  f.client.getMe = async () => {
    input.linkedMembers[0].person_id = P2;
    input.room.surface_chat_id = "-100002";
    return original();
  };
  assert.deepEqual(await f.hooks.groupAudienceWitness(event(), input), expected);
});

// Real Telegram serializer and clone binder, with every fetch intercepted in
// this process. These are fake credentials, never environment/config values.
const { clientFor, bindTelegramClone } = await import("../../api/tg.js");
const savedFetch = globalThis.fetch;
try {
  const requests = [];
  globalThis.fetch = async (url, init) => {
    const route = /^https:\/\/api\.telegram\.org\/bot([^/]+)\/([A-Za-z]+)$/.exec(String(url));
    assert(route);
    const [, token, method] = route;
    const body = JSON.parse(init.body);
    requests.push({ token, method, body });
    const botId = token.split(":")[0];
    let result = true;
    if (method === "getMe") result = { id: Number(botId), is_bot: true };
    if (method === "getChatMemberCount") result = 3;
    if (method === "getChat") result = { id: Number(body.chat_id), type: "supergroup" };
    if (method === "getChatMember") result = { user: { id: body.user_id, is_bot: String(body.user_id) === botId },
      status: String(body.user_id) === botId ? "administrator" : "member" };
    return { json: async () => success(result) };
  };
  await check("actual client serializes documented membership methods", async () => {
    const client = clientFor("700001:synthetic-token-A");
    await client.getMe(); await client.getChatMember("-100001", "101"); await client.getChatMemberCount("-100001"); await client.getChat("-100001");
    assert.deepEqual(requests.slice(-4).map(({ method, body }) => ({ method, body })), [
      { method: "getMe", body: {} },
      { method: "getChatMember", body: { chat_id: "-100001", user_id: 101 } },
      { method: "getChatMemberCount", body: { chat_id: "-100001" } },
      { method: "getChat", body: { chat_id: "-100001" } },
    ]);
  });
  await check("explicitly missing token never falls back to global bot", async () => {
    const before = requests.length;
    assert.equal((await clientFor(undefined).getMe()).ok, false);
    assert.equal((await clientFor(null).getChatMemberCount("-100001")).ok, false);
    assert.equal(requests.length, before);
  });
  await check("two real clone binders retain separate read/send token authority", async () => {
    const bind = (agentId, botId) => bindTelegramClone(botId, {
      db: async () => [{ channel_id: "c0000000-0000-4000-8000-000000000001", agent_id: agentId,
        replica_id: "d0000000-0000-4000-8000-000000000001", owner_user_id: P1,
        kind: "telegram", external_ref: botId, credentials_ref: "fixture", slug: "fixture" }],
      loadAgent: async () => ({ module: { displayName: "Fixture" }, sheet: { name: "Fixture" } }),
      readSecret: async () => `${botId}:synthetic-token-${agentId}`,
    });
    const [a, b] = await Promise.all([bind(AGENT, BOT), bind(OTHER, "700002")]);
    assert(a && b);
    const inputB = args(); inputB.agentId = OTHER; inputB.room.agent_id = OTHER;
    const begin = requests.length;
    await Promise.all([a.groupAudienceWitness(event(), args()), b.groupAudienceWitness(event(), inputB)]);
    await Promise.all([a.send("-100001", { text: "a" }), b.send("-100001", { text: "b" })]);
    const outbound = requests.slice(begin);
    for (const [agent, bot] of [[AGENT, BOT], [OTHER, "700002"]]) {
      const calls = outbound.filter((request) => request.token === `${bot}:synthetic-token-${agent}`);
      assert(calls.some((request) => request.method === "getMe"));
      assert(calls.some((request) => request.method === "getChatMember" && request.body.user_id === Number(bot)));
      assert(calls.some((request) => request.method === "sendMessage"));
    }
    assert(outbound.every((request) => request.token.startsWith(`${BOT}:`) || request.token.startsWith("700002:")));
    await rejects(() => a.groupAudienceWitness(event(), inputB));
  });
} finally {
  globalThis.fetch = savedFetch;
}
await check("actual handler forwards hooks without bound-to-global fallback", async () => {
  const source = readFileSync(new URL("../../api/tg.js", import.meta.url), "utf8");
  const ast = ts.createSourceFile("tg.js", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const declaration = ast.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "handleUpdate");
  assert(declaration);
  const fn = declaration.getText(ast).replace(/^export\s+/, "");
  const makeHandler = (functionText) => vm.runInNewContext(`(${functionText})`, {
    parse: () => [event()], loadEngine: async () => { throw new Error("unexpected engine load"); },
    createTelegramGroupAuthority, MEERA_AGENT_ID: AGENT, BOT_USERNAME: "fixture",
    makeCtx: (_adapter, deps) => deps, adapter: {}, dispatch: async (_ev, ctx) => ctx,
    defaultClient: fixture().client, sendVia: (client) => client,
    parseStartPayload: () => null, startLink: () => "fixture",
  });
  const fallbackAudience = () => "forbidden-default-audience";
  const fallbackMember = () => "forbidden-default-member";
  const ownAudience = () => "bound-audience";
  const ownMember = () => "bound-member";
  const deps = { engine: {}, groupAudienceWitness: fallbackAudience, verifyGroupMembership: fallbackMember,
    bind: async () => ({ agentId: AGENT, send: () => null, groupAudienceWitness: ownAudience, verifyGroupMembership: ownMember }) };
  const handler = makeHandler(fn);
  const bound = await handler({}, deps);
  assert.equal(bound.groupAudienceWitness, ownAudience);
  assert.equal(bound.verifyGroupMembership, ownMember);
  const partialDeps = { ...deps, bind: async () => ({ agentId: AGENT, send: () => null }) };
  const partial = await handler({}, partialDeps);
  assert.equal(partial.groupAudienceWitness, undefined);
  assert.equal(partial.verifyGroupMembership, undefined);
  const missingSend = await handler({}, { ...deps,
    bind: async () => ({ agentId: AGENT, groupAudienceWitness: ownAudience, verifyGroupMembership: ownMember }) });
  assert.equal(missingSend.ok, false);
  assert.equal(missingSend.skipped, "clone_unavailable");
  const unbound = await handler({}, { ...deps, bind: undefined });
  assert.equal(unbound.groupAudienceWitness, fallbackAudience);
  assert.equal(unbound.verifyGroupMembership, fallbackMember);
  // Negative control: the actual extracted handler with its branch changed
  // to nullish fallback exposes the wrong bot's capability and is detected.
  const target = "bound ? groupAuthority.groupAudienceWitness : (deps.groupAudienceWitness || groupAuthority.groupAudienceWitness)";
  assert.equal(fn.split(target).length, 2);
  const mutant = makeHandler(fn.replace(target, "groupAuthority.groupAudienceWitness ?? deps.groupAudienceWitness"));
  assert.equal((await mutant({}, partialDeps)).groupAudienceWitness, fallbackAudience);
  const surface = readFileSync(new URL("../../api/_surface.js", import.meta.url), "utf8");
  assert(surface.includes("groupAudienceWitness: deps.groupAudienceWitness"));
  assert(surface.includes("verifyGroupMembership: deps.verifyGroupMembership"));
});
console.log(`group audience: ${groups} offline groups passed; no actual Telegram, SQL or atomic platform-snapshot claim`);
