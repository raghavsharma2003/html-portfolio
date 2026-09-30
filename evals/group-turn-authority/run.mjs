// Offline control flow, not PostgreSQL proof. Execute the complete current
// production modules with ONLY I/O dependencies replaced. The query double
// checks shipping disclosure clauses/bindings, then returns declared authority
// results; it does not reimplement a SQL evaluator or infer who may see a row.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as crypto from "node:crypto";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as disclosure from "../../api/_disclosure.js";
import * as neverRules from "../../api/_never-rules.js";
import * as engine from "../../api/_engine.gen.js";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const SOURCE = { room: read("api/_room.js"), surface: read("api/_surface.js") };
const AGENT = "a0000000-0000-4000-8000-000000000001";
const P1 = "b0000000-0000-4000-8000-000000000001";
const P2 = "b0000000-0000-4000-8000-000000000002";
const P3 = "b0000000-0000-4000-8000-000000000003";
const DEVICE = "c0000000-0000-4000-8000-000000000001";
const BIND = { recipients: "$1", isGroup: "$2", roomId: "$3", negTags: "$4", agentId: "$5" };
const clone = (value) => JSON.parse(JSON.stringify(value));
const flat = (text) => text.replace(/\s+/g, " ").trim();
const failIO = () => { throw new Error("offline_unexpected_io"); };

function loadModule(source, filename, imports) {
  const exports = {};
  const output = ts.transpileModule(source, {
    fileName: filename,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  runInNewContext(output, { exports, require(name) {
    assert(Object.hasOwn(imports, name), `unapproved import ${name}`);
    return imports[name];
  }, console, Buffer, URL, process: { env: {} }, fetch: failIO }, { filename, timeout: 5000 });
  return exports;
}

function fixture({ sources = SOURCE, audience = [P1, P2], split = false } = {}) {
  const state = {
    room: { id: "91", agent_id: AGENT, surface: "telegram", surface_chat_id: "-100001",
      read_consent_at: "2026-09-29T00:00:00Z", quiet_level: "normal", member_cap: 6,
      room_device_id: DEVICE, entitled: true },
    audience: [...audience], memberActive: true, linked: true, unknownIdentity: false,
    witnessComplete: true, witnessRevision: "a".repeat(64), witnessRecipients: null,
    membershipVerified: false, authorityError: false, historyError: false,
    allowedHistory: [], facts: [], words: [], grantValid: true, sinceHerLast: 90000,
    beforeCompile: null, duringModel: null, afterSend: null, onAuthority: null, onWitness: null,
    historyTransform: (rows) => rows,
  };
  const lookupRoom = clone(state.room);
  const calls = { sql: [], model: [], sent: [], episodes: [], logs: [], authority: 0, sources: 0, witnesses: 0 };
  const assertSourceQuery = (sql, args, kind) => {
    assert(sql.includes(disclosure.disclosurePredicate(kind, BIND)), `full shipping ${kind} disclosure predicate`);
    assert.deepEqual(clone(args.slice(0, 5)), [state.audience, true, "91", disclosure.NEGATIVE_AFFECT_TAGS, AGENT]);
  };
  const q = async (sql, args = []) => {
    calls.sql.push({ sql, args: clone(args) });
    const s = flat(sql);
    if (s.startsWith("select person_id, handle from vy_surface_identity"))
      return state.unknownIdentity ? [] : [{ person_id: P1, handle: "Ada" }];
    if (s.startsWith("select person_id, username from vy_tg_person")) return [];
    if (s.startsWith("select quiet_level, linked_at from vy_group_member")) {
      assert(s.includes("and left_at is null") && s.includes("surface=$4 and surface_user_id=$5"));
      assert.deepEqual(clone(args), ["91", P1, AGENT, "telegram", "101"]);
      return state.memberActive ? [{ quiet_level: "normal", linked_at: state.linked ? "2026-09-29T00:00:00Z" : null }] : [];
    }
    if (s.includes("as linked_members")) {
      calls.authority++;
      await state.onAuthority?.(calls.authority);
      if (state.authorityError) throw new Error("authority read failed");
      assert.deepEqual(clone(args), ["91", AGENT]);
      assert(s.includes("g.id = $1::bigint and g.agent_id = $2::uuid"));
      return [{ ...clone(state.room), recipients: [...state.audience], linked_members: state.audience.map((id, i) => ({
        person_id: id, surface: "telegram", surface_user_id: String(101 + i),
        linked_at: id === P1 && !state.linked ? null : "2026-09-29T00:00:00Z",
        left_at: id === P1 && !state.memberActive ? "2026-09-29T01:00:00Z" : null, quiet_level: "normal",
      })) }];
    }
    if (s.startsWith("select") && s.includes("from vy_group ") && !s.includes("from vy_group_member"))
      return [clone(lookupRoom)];
    if (s.includes("extract(epoch from")) return [{ ms: state.sinceHerLast }];
    if (s.startsWith("select f.phrase from vy_phrase")) {
      assertSourceQuery(sql, args, "phrase"); return [];
    }
    if (s.startsWith("with made as (insert into vy_episode")) {
      assert(s.includes("'audience_turn'") && !s.includes("update vy_episode"));
      assert(s.includes("insert into vy_episode_participant") && s.includes("unnest($4::uuid[])"));
      assert(s.includes("and m.left_at is null and m.linked_at is not null"));
      assert(s.includes("and $4::uuid[] = (select array_agg"));
      assert.deepEqual(clone(args), ["91", DEVICE, AGENT, state.audience]);
      const row = { id: String(200 + calls.episodes.length), recipients: clone(args[3]) };
      calls.episodes.push(row); return [{ id: row.id }];
    }
    if (s.startsWith("insert into meera_log")) {
      assert(s.includes("group_id, episode_id") && s.includes("e.id=$8::bigint"));
      assert(s.includes("e.disclosure_scope='participants'") && s.includes("cardinality(e.disclosure_deny)=0"));
      assert(s.includes("p.episode_id=e.id") && s.includes("m.left_at is null and m.linked_at is not null"));
      assert.deepEqual(clone([args[0], args[5], args[6], args[8]]), [DEVICE, "91", AGENT, state.audience]);
      assert(calls.episodes.some((ep) => ep.id === args[7] && JSON.stringify(ep.recipients) === JSON.stringify(args[8])));
      const row = { id: String(300 + calls.logs.length), role: args[1], content: args[3],
        speaker_person_id: args[4], episode_id: args[7] };
      calls.logs.push(clone(row)); return [{ id: row.id }];
    }
    if (s.startsWith("insert into vy_group_turn")) return [{ id: "400" }];
    if (s.startsWith("select f.id, f.body")) {
      assertSourceQuery(sql, args, "fact");
      if (s.includes("f.kind")) return [];
      calls.sources++;
      return state.grantValid ? clone(state.facts) : [];
    }
    if (s.startsWith("select f.id, f.phrase, f.origin_episode")) {
      assertSourceQuery(sql, args, "phrase"); return clone(state.words);
    }
    if (s.startsWith("select f.id, f.phrase")) {
      assertSourceQuery(sql, args, "phrase"); return [];
    }
    if (s.startsWith("select m.person_id, m.quiet_level")) {
      assert(s.includes("m.agent_id = $2::uuid and m.left_at is null"));
      return state.audience.map((id, i) => ({ person_id: id, username: `person${i + 1}`,
        quiet_level: "normal", linked_at: "2026-09-29T00:00:00Z", honorific: "tum" }));
    }
    if (s.startsWith("select l.id, l.role")) {
      assertSourceQuery(sql, args, "episode");
      assert(s.includes("join vy_episode f on f.id = l.episode_id"));
      assert(s.includes("f.agent_id = l.agent_id and f.group_id = l.group_id"));
      assert(s.includes("where l.group_id = $3::bigint and l.agent_id = $5::uuid"));
      assert(s.includes("and l.role = 'me' and l.speaker_person_id is not null"));
      assert(s.includes("f.superseded_by is null"));
      assert(s.indexOf("disclosure predicate") < s.indexOf("order by l.id desc"));
      if (state.historyError) throw new Error("history authority unavailable");
      // Declared DB authority result. NOT a copied ACL policy evaluator.
      return state.historyTransform([...clone(calls.logs.slice(-1)), ...clone(state.allowedHistory)].reverse());
    }
    if (s.startsWith("select count(*)") && s.includes("vy_group_member")) return [{ n: 2 }];
    if (s.includes("vy_person_device")) return [];
    throw new Error(`unexpected query: ${s.slice(0, 140)}`);
  };
  const room = loadModule(sources.room, "api/_room.js", {
    "node:crypto": crypto, "./_db.js": { q }, "./_agentscope.js": { MEERA_AGENT_ID: AGENT },
    "./_disclosure.js": disclosure,
  });
  const surface = loadModule(sources.surface, "api/_surface.js", {
    "./_db.js": { q }, "./_config.js": {}, "./_agentscope.js": { MEERA_AGENT_ID: AGENT },
    "./_room.js": room, "./_never-rules.js": neverRules,
    "./_reply-engine-capability.js": { replyEngineCapability: failIO },
    "./_azure-surface-reply.js": { azureSurfaceReply: failIO },
    "./_model-serving-policy.js": { resolveReplyServingProvider: failIO },
  });
  const adapter = { surface: "telegram", render: (text) => split
    ? [{ text: text.slice(0, 3) }, { text: text.slice(3) }] : [{ text }] };
  const ctx = surface.makeCtx(adapter, {
    agentId: AGENT,
    engine: { ...engine, compile(input) { state.beforeCompile?.(); return engine.compile(input); } },
    reply: async (compiled, turns) => {
      calls.model.push(clone({ compiled, turns })); await state.duringModel?.(); return "haan bilkul";
    },
    send: async (chat, msg) => { calls.sent.push(clone({ chat, msg })); await state.afterSend?.(); return { ok: true }; },
    groupAudienceWitness: async () => {
      calls.witnesses++; await state.onWitness?.(calls.witnesses);
      return { complete: state.witnessComplete,
        recipients: [...(state.witnessRecipients || state.audience)], revision: state.witnessRevision };
    },
    verifyGroupMembership: async ({ surfaceUserId }) => ({ verified: state.membershipVerified,
      surfaceUserId, revision: "verified-membership" }),
  });
  const ev = { kind: "message", surface: "telegram", chatKey: "-100001", isGroup: true,
    surfaceUserId: "101", handle: "Ada", text: "Can we discuss the painting?", replyToSelf: true,
    messageId: "17", fromBot: false };
  return { state, calls, surface, room, ctx, ev, run: () => surface.dispatch(ev, ctx) };
}

let groups = 0;
async function check(name, test) { await test(); console.log(`ok ${++groups} ${name}`); }
async function suppressed(f, modelCount = 0, sendCount = 0) {
  let error;
  try { await f.run(); } catch (caught) { error = caught; }
  if (error && error.code !== "group_authority_unavailable" && error.message !== "history authority unavailable") throw error;
  assert.equal(f.calls.model.length, modelCount, "raw model dispatch count");
  assert.equal(f.calls.sent.length, sendCount, "wire delivery count");
}

await check("actual dispatch compiles and gates a source-bound turn once", async () => {
  const f = fixture();
  const result = await f.run();
  assert.equal(result.action, "speak"); assert.equal(result.gate.applied, true);
  assert.equal(f.calls.model.length, 1); assert.equal(f.calls.sent.length, 1);
  assert.deepEqual(f.calls.model[0].turns, [{ role: "user", content: `Ada: ${f.ev.text}` }]);
  assert.equal(f.calls.logs.length, 2);
  assert.equal(f.calls.logs[0].episode_id, f.calls.logs[1].episode_id);
  assert.equal(f.calls.logs[0].speaker_person_id, P1);
  assert.equal(f.calls.logs[1].speaker_person_id, null);
  assert.equal(f.calls.authority >= 7, true);
});

await check("late joiner gets only DB-authorized human history and no unsupported assistant evidence", async () => {
  const f = fixture();
  f.state.allowedHistory = [{ id: "1", role: "me", content: "PREJOIN_HUMAN", speaker_person_id: P2, episode_id: "90" }];
  await f.run();
  assert(f.calls.model[0].turns.some((turn) => turn.content === "PREJOIN_HUMAN"));
  assert(!f.calls.model[0].turns.some((turn) => turn.role === "assistant"));
  const firstAudience = clone(f.calls.episodes[0].recipients);
  f.state.audience.push(P3); f.state.allowedHistory = [];
  await f.run();
  const second = JSON.stringify(f.calls.model[1]);
  assert(!second.includes("PREJOIN_HUMAN") && !second.includes("PREJOIN_ASSISTANT"));
  assert.deepEqual(f.calls.episodes[0].recipients, firstAudience);
  assert.deepEqual(f.calls.episodes[1].recipients, [P1, P2, P3]);
  assert.notEqual(f.calls.episodes[0].id, f.calls.episodes[1].id);
});

for (const [name, mutate] of [
  ["unknown external audience", (f) => { f.state.witnessComplete = false; }],
  ["unlinked audience omitted from transport witness", (f) => { f.state.witnessRecipients = [P1]; }],
  ["missing audience hook", (f) => { delete f.ctx.groupAudienceWitness; }],
  ["failed authority read", (f) => { f.state.authorityError = true; }],
  ["revoked room consent", (f) => { f.state.room.read_consent_at = null; }],
  ["expired entitlement", (f) => { f.state.room.entitled = false; }],
  ["unknown speaker", (f) => { f.state.unknownIdentity = true; }],
  ["speaker link revoked", (f) => { f.state.linked = false; }],
  ["post-withdrawal delayed message", (f) => { f.state.memberActive = false; }],
  ["cross-agent authority", (f) => { f.state.room.agent_id = P3; }],
  ["cross-room authority", (f) => { f.state.room.id = "92"; }],
  ["wrong transport destination", (f) => { f.state.room.surface_chat_id = "-100002"; }],
]) await check(`${name} refuses before raw model and never revives membership`, async () => {
  const f = fixture(); mutate(f); await suppressed(f);
  assert.equal(f.calls.logs.length, 0);
  assert(!f.calls.sql.some(({ sql }) => /insert into vy_group_member|update vy_group_member/.test(sql)));
});

await check("guessed room deep link requires actual membership proof", async () => {
  const f = fixture(); f.ev.isGroup = false; f.ctx.linkIntent = () => ({ roomRef: "91" });
  const result = await f.run();
  assert.equal(result.room, null); assert.equal(result.roomUnavailable, "group_membership_unverified");
  assert.equal(f.calls.model.length, 0);
  assert(!f.calls.sql.some(({ sql }) => /insert into vy_group_member|update vy_group_member/.test(sql)));
});

for (const phase of ["beforeCompile", "duringModel", "afterSend"]) {
  for (const [name, mutate] of [
    ["audience", (f) => { f.state.audience.push(P3); }],
    ["consent", (f) => { f.state.room.read_consent_at = null; }],
    ["transport membership revision", (f) => { f.state.witnessRevision = "b".repeat(64); }],
    ["source removed", (f) => { f.state.facts = []; }],
    ["grant revoked", (f) => { f.state.grantValid = false; }],
    ["source authority failed", (f) => { f.state.historyError = true; }],
  ]) await check(`${name} changed ${phase} suppresses remaining work`, async () => {
    const f = fixture({ split: true });
    f.state.facts = [{ id: "51", body: "palette: ochre", citations: ["50"], created_at: "2026-09-29T00:00:00Z", group_id: "91" }];
    f.state[phase] = () => mutate(f);
    await suppressed(f, phase === "beforeCompile" ? 0 : 1, phase === "afterSend" ? 1 : 0);
    assert.equal(f.calls.logs.length, 1, "undelivered complete answer not persisted");
  });
}

await check("authority changes while source authority reads are in flight are rechecked", async () => {
  const f = fixture();
  // Initial scope, then pre-model scope, then source read, then final scope.
  f.state.onAuthority = (n) => { if (n === 3) f.state.room.read_consent_at = null; };
  await suppressed(f);
});

await check("source revocation during final external audience witness is rechecked", async () => {
  const f = fixture();
  f.state.facts = [{ id: "51", body: "ochre", citations: ["50"] }];
  f.state.onWitness = (n) => { if (n === 3) f.state.grantValid = false; };
  await suppressed(f);
  assert.equal(f.calls.witnesses, 3);
});

for (const [name, mutate] of [
  ["missing current log", () => []],
  ["current log replaced by assistant", (rows) => rows.map((row) => ({ ...row, role: "her" }))],
  ["current speaker mismatched", (rows) => rows.map((row) => ({ ...row, speaker_person_id: P2 }))],
  ["current text mismatched", (rows) => rows.map((row) => ({ ...row, content: "different" }))],
]) await check(`${name} refuses actual generation`, async () => {
  const f = fixture(); f.state.historyTransform = mutate;
  await suppressed(f);
});

await check("actual reaction decision sends no model text and binds current phrase evidence", async () => {
  const f = fixture(); f.ev.replyToSelf = false; f.state.sinceHerLast = 900000;
  f.state.words = [{ id: "8", phrase: "painting", origin_episode: "7" }];
  const result = await f.run();
  assert.equal(result.action, "react"); assert.equal(f.calls.model.length, 0);
  assert.equal(f.calls.sent.length, 1); assert.equal(f.calls.sent[0].msg.kind, "reaction");
});
for (const [name, mutate] of [
  ["phrase withdrawn", (f) => { f.state.words = []; }],
  ["human source withdrawn", (f) => { f.state.historyTransform = () => []; }],
  ["same phrase from replaced source", (f) => { f.state.words[0].origin_episode = "99"; }],
]) await check(`reaction ${name} while audience read completes refuses delivery`, async () => {
  const f = fixture(); f.ev.replyToSelf = false; f.state.sinceHerLast = 900000;
  f.state.words = [{ id: "8", phrase: "painting", origin_episode: "7" }];
  f.state.onWitness = (n) => { if (n === 2) mutate(f); };
  await suppressed(f);
});

await check("empty source audience and legacy no-episode logs never reach a fallback history read", async () => {
  const f = fixture();
  assert.deepEqual(clone(await f.surface.roomHistory("91", undefined, 20, AGENT)), []);
  assert.equal(f.calls.sql.length, 0);
  await f.run();
  const queries = f.calls.sql.filter(({ sql }) => sql.includes("select l.id, l.role"));
  assert(queries.length >= 3);
  for (const { sql } of queries) {
    assert(sql.includes("join vy_episode f on f.id = l.episode_id"));
    assert(sql.includes("f.agent_id = l.agent_id and f.group_id = l.group_id"));
    assert(sql.includes("l.group_id = $3::bigint and l.agent_id = $5::uuid"));
  }
  assert(!f.calls.sql.some(({ sql }) => /select role, content from meera_log/.test(sql)));
});

function changed(which, from, to) {
  assert(SOURCE[which].includes(from), `mutation anchor present: ${from.slice(0, 70)}`);
  const value = SOURCE[which].replace(from, to);
  assert.notEqual(value, SOURCE[which]);
  return { ...SOURCE, [which]: value };
}

await check("mutation: actual raw second reply call is executed and caught", async () => {
  const f = fixture({ sources: changed("surface", "export async function onGroupMessage(ev, ctx) {",
    "export async function onGroupMessage(ev, ctx) {\n await ctx.reply({}, []);") });
  f.state.witnessComplete = false;
  await assert.rejects(() => suppressed(f), /raw model dispatch count/);
  assert.equal(f.calls.model.length, 1);
});
await check("mutation: removing pre-model guard is caught by actual model dispatch", async () => {
  const f = fixture({ sources: changed("surface", "await opts.assertAuthority?.();\n  const raw = await ctx.reply", "const raw = await ctx.reply") });
  f.state.beforeCompile = () => { f.state.room.read_consent_at = null; };
  await assert.rejects(() => suppressed(f), /raw model dispatch count/);
});
await check("mutation: removing source receipt comparison leaks revoked source and is caught", async () => {
  const f = fixture({ sources: changed("surface", "if (JSON.stringify(await sourceReader()) !== sourceReceipt) throw groupAuthorityError();", "await sourceReader();") });
  f.state.facts = [{ id: "51", body: "ochre", citations: ["50"] }];
  f.state.duringModel = () => { f.state.grantValid = false; };
  await assert.rejects(() => suppressed(f, 1), /wire delivery count/);
});
await check("mutation: removing fragment authority check is caught on second wire write", async () => {
  const f = fixture({ split: true, sources: changed("surface", "    await assertAuthority?.();\n    last = await ctx.send", "    last = await ctx.send") });
  f.state.afterSend = () => { f.state.room.read_consent_at = null; };
  await assert.rejects(() => suppressed(f, 1, 1), /wire delivery count/);
});
await check("mutation: removing post-model check is caught at actual gatedReply return", async () => {
  const f = fixture({ sources: changed("surface", "const raw = await ctx.reply(compiled, turns);\n  await ctx.assertPublicAuthority?.();\n  await opts.assertAuthority?.();",
    "const raw = await ctx.reply(compiled, turns);\n  await ctx.assertPublicAuthority?.();") });
  let allowed = true;
  f.state.duringModel = () => { allowed = false; };
  const result = await f.surface.gatedReply(f.ctx, { core: "test", tail: "", sections: {} }, [], {
    assertAuthority: async () => { assert(allowed, "authority revoked after model"); },
  });
  assert.equal(result.text, "haan bilkul");
  const current = fixture(); let currentAllowed = true;
  current.state.duringModel = () => { currentAllowed = false; };
  await assert.rejects(() => current.surface.gatedReply(current.ctx, { core: "test", tail: "", sections: {} }, [], {
    assertAuthority: async () => { assert(currentAllowed, "authority revoked after model"); },
  }), /authority revoked after model/);
});
await check("mutation: removing history agent/room join is caught structurally before provider", async () => {
  const f = fixture({ sources: changed("room", "and f.agent_id = l.agent_id and f.group_id = l.group_id", "") });
  await assert.rejects(() => f.run(), /f.agent_id = l.agent_id/);
  assert.equal(f.calls.model.length, 0);
});
await check("mutation: removing episode disclosure predicate is caught structurally", async () => {
  const f = fixture({ sources: changed("room", "and f.superseded_by is null ${pred}", "and f.superseded_by is null") });
  await assert.rejects(() => f.run(), /full shipping episode disclosure predicate/);
  assert.equal(f.calls.model.length, 0);
});
await check("mutation: enabling assistant history without dependency lineage is caught structurally", async () => {
  const f = fixture({ sources: changed("room", "and l.role = 'me' and l.speaker_person_id is not null", "") });
  await assert.rejects(() => f.run(), /l.role = 'me'/);
  assert.equal(f.calls.model.length, 0);
});

console.log(`\n${groups} group-turn authority control-flow groups passed.`);
console.log("NOT PROVEN: PostgreSQL parsing/semantics, transaction races, real Telegram membership, live model quality, deployment. SQL doubles validate exact clauses/bindings and return declared authority results only.");
