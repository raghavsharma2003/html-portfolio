// Offline control flow, not PostgreSQL proof. Execute the complete current
// production modules with ONLY I/O dependencies replaced. The query double
// checks shipping disclosure clauses/bindings, then returns declared authority
// results; it does not reimplement a SQL evaluator or infer who may see a row.
import assert from "node:assert/strict";
import ts from "typescript";
import { SOURCE, fixture, clone, AGENT, P1, P2, P3, DEVICE } from "./fixture.mjs";

let groups = 0;
async function check(name, test) { await test(); console.log(`ok ${++groups} ${name}`); }
async function suppressed(f, modelCount = 0, sendCount = 0) {
  let error;
  try { await f.run(); } catch (caught) { error = caught; }
  if (error && error.code !== "group_authority_unavailable" && error.message !== "history authority unavailable") throw error;
  assert.equal(f.calls.model.length, modelCount, "raw model dispatch count");
  assert.equal(f.calls.sent.length, sendCount, "wire delivery count");
}

function sourcePacket(call) {
  assert.equal(call.turns.length, 1, "group model receives one bounded attributed packet");
  assert.equal(call.turns[0].role, "user");
  return JSON.parse(call.turns[0].content);
}
function olderHistory() {
  return Array.from({ length: 28 }, (_, index) => ({
    id: String(200 + index), role: "me", episode_id: String(80 + index), speaker_person_id: index % 2 ? P1 : P2,
    at: null, content: index === 0 ? "An ochre painting needs an archival art method." : `Unrelated historical note ${index}.`,
  }));
}
function assertCurrentOnce(f) {
  const call = f.calls.model[0], packet = sourcePacket(call);
  assert.equal(packet.current.text, f.ev.text);
  assert.equal(packet.current.speakerId, P1);
  assert.equal(packet.current.sourceId, f.calls.logs[0].id);
  assert.equal(packet.current.episodeId, f.calls.logs[0].episode_id);
  assert.equal(call.turns[0].content.split(f.ev.text).length - 1, 1, "current question occurs exactly once in model turns");
  assert(!packet.history.some((row) => row.sourceId === packet.current.sourceId), "current source cannot be duplicated in history");
  return packet;
}
function assertHumanTextOnly(f) {
  const packet = sourcePacket(f.calls.model[0]);
  const raw = [...packet.history, packet.current].map((row) => ({ from: "me", text: row.text }));
  assert.deepEqual(f.calls.humanVocabulary, [raw], "human vocabulary sees exact human text, not packet metadata");
  assert.deepEqual(f.calls.commitments, [raw], "commitments see exact human text, not packet metadata");
}
const providerContextBytes = ({ compiled, turns }) => Buffer.byteLength(JSON.stringify({
  compiled: { core: compiled.core, tail: compiled.tail }, turns,
}), "utf8");

await check("actual dispatch compiles and gates a source-bound turn once", async () => {
  const f = fixture();
  const result = await f.run();
  assert.equal(result.action, "speak"); assert.equal(result.gate.applied, true);
  assert.equal(f.calls.model.length, 1); assert.equal(f.calls.sent.length, 1);
  assert.deepEqual(assertCurrentOnce(f).history, []);
  assert.equal(f.calls.logs.length, 2);
  assert.equal(f.calls.logs[0].episode_id, f.calls.logs[1].episode_id);
  assert.equal(f.calls.logs[0].speaker_person_id, P1);
  assert.equal(f.calls.logs[1].speaker_person_id, null);
  assert.equal(f.calls.authority >= 7, true);
  assert(providerContextBytes(f.calls.model[0]) <= 98304, "real ordinary compiler output fits the provider-relevant budget");
});

await check("older authorized source beyond twenty reaches actual model with exact speaker and episode", async () => {
  const f = fixture(); f.state.allowedHistory = olderHistory();
  await f.run();
  const packet = assertCurrentOnce(f);
  const older = packet.history.find((row) => row.sourceId === "200");
  assert(older, "query-relevant source beyond recent window survives bounded selection");
  assert.equal(older.text, f.state.allowedHistory[0].content);
  assert.equal(older.speakerId, P2);
  assert.equal(older.episodeId, "80");
  assert.equal(older.recordedAt, null, "missing recorded timestamp stays unavailable");
  assert.equal(older.sourceRevision, null);
  assert.equal(older.occurredAt, null);
  assert.equal(older.replyToSourceId, null);
  assert.equal(older.subjectIds, null);
  assert.equal(older.span.start, 0); assert.equal(older.span.end, older.text.length);
  assert(!packet.history.some((row) => row.sourceId === "201"), "irrelevant older row remains omitted from packet");
  for (const row of f.state.allowedHistory.slice(-19))
    assert(packet.history.some((source) => source.sourceId === row.id && source.text === row.content), "mandatory recent source must remain verbatim");
  assert(Buffer.byteLength(JSON.stringify(f.calls.model[0].turns), "utf8") <= 32768, "complete escaped source payload is bounded");
  assert(providerContextBytes(f.calls.model[0]) <= 98304, "provider-relevant core/tail plus turns are bounded");
  assertHumanTextOnly(f);
});

for (const env of [{}, { GROUP_SOURCE_RECALL_MODE: "recency" }])
  await check(`server ${Object.hasOwn(env, "GROUP_SOURCE_RECALL_MODE") ? "explicit recency" : "unset mode"} keeps attributed recency baseline`, async () => {
    const f = fixture({ env }); f.state.allowedHistory = olderHistory();
    await f.run();
    const packet = assertCurrentOnce(f);
    assert.equal(packet.selection.mode, "recency");
    assert.equal(packet.history.length, 19);
    assert(!packet.history.some((row) => row.sourceId === "200"));
  });
await check("request fields cannot enable candidate recall against server recency default", async () => {
  const f = fixture({ env: {} }); f.state.allowedHistory = olderHistory();
  f.ev.mode = "lexical_recency"; f.ev.GROUP_SOURCE_RECALL_MODE = "lexical_recency";
  f.ev.body = { mode: "lexical_recency", GROUP_SOURCE_RECALL_MODE: "lexical_recency" };
  f.ctx.groupSourceRecallMode = "lexical_recency";
  await f.run();
  const packet = assertCurrentOnce(f);
  assert.equal(packet.selection.mode, "recency");
  assert(!packet.history.some((row) => row.sourceId === "200"));
});
await check("invalid deployment recall mode refuses rather than silently enabling a candidate", async () => {
  const f = fixture({ env: { GROUP_SOURCE_RECALL_MODE: "typo" } });
  await assert.rejects(() => f.run(), { code: "group_context_unavailable" });
  assert.equal(f.calls.candidateReads.length, 0);
  assert.equal(f.calls.model.length, 0); assert.equal(f.calls.sent.length, 0);
});
for (const phase of ["onSources", "duringModel"])
  await check(`server recall mode is captured before ${phase} and cannot switch midturn`, async () => {
    const env = { GROUP_SOURCE_RECALL_MODE: "recency" };
    const f = fixture({ env }); f.state.allowedHistory = olderHistory();
    f.state[phase] = () => { env.GROUP_SOURCE_RECALL_MODE = "lexical_recency"; };
    await f.run();
    assert.equal(env.GROUP_SOURCE_RECALL_MODE, "lexical_recency", "fixture reached mutable external environment");
    assert.equal(sourcePacket(f.calls.model[0]).selection.mode, "recency");
  });

await check("candidate rereads retain persisted cutoff and ignore later concurrent source", async () => {
  const f = fixture(); f.state.allowedHistory = olderHistory();
  f.state.duringModel = () => f.state.allowedHistory.push({ id: "999", role: "me", episode_id: "999", speaker_person_id: P2,
    at: null, content: "FUTURE_PAINTING_SOURCE_MUST_NOT_DISPLACE_CURRENT" });
  const result = await f.run();
  assert.equal(result.action, "speak"); assert.equal(f.calls.sent.length, 1);
  assert(f.calls.candidateReads.length >= 3, "candidate source authority reread at effect boundaries");
  assert(f.calls.candidateReads.every((args) => args[5] === "300" && args[6] === 160), "fixed cutoff and ceiling on every source read");
  assert(!JSON.stringify(f.calls.model).includes("FUTURE_PAINTING"));
  assertCurrentOnce(f);
});

for (const [name, mutate] of [
  ["selected source removed", (rows) => rows.filter((row) => row.id !== "200")],
  ["omitted source changed", (rows) => rows.map((row) => row.id === "201" ? { ...row, content: "Changed painting context not in the selected packet." } : row)],
  ["recorded speaker changed", (rows) => rows.map((row) => row.id === "200" ? { ...row, speaker_person_id: P1 } : row)],
  ["episode changed", (rows) => rows.map((row) => row.id === "200" ? { ...row, episode_id: "99" } : row)],
]) await check(`${name} after generation invalidates the whole candidate receipt`, async () => {
  const f = fixture(); f.state.allowedHistory = olderHistory();
  f.state.duringModel = () => { f.state.allowedHistory = mutate(f.state.allowedHistory); };
  await suppressed(f, 1);
  assert(sourcePacket(f.calls.model[0]).history.some((row) => row.sourceId === "200"));
  assert(!sourcePacket(f.calls.model[0]).history.some((row) => row.sourceId === "201"));
  assert.equal(f.calls.logs.length, 1, "refused result cannot create an assistant audit row");
});

await check("mandatory recent source payload exceeding32KiB refuses before actual model or send", async () => {
  const f = fixture();
  f.state.allowedHistory = Array.from({ length: 19 }, (_, index) => ({ id: String(200 + index), role: "me", episode_id: "80",
    speaker_person_id: P2, at: null, content: "x".repeat(4000) }));
  await assert.rejects(() => f.run(), { code: "source_selection_unavailable", reason: "required_context_over_budget" });
  assert.equal(f.calls.model.length, 0); assert.equal(f.calls.sent.length, 0);
});

await check("compiled input plus source turns exceeding96KiB refuses before actual model or send", async () => {
  const f = fixture();
  f.state.compiledOverride = { core: "ह".repeat(40000), tail: "", sections: {} };
  await assert.rejects(() => f.run(), { code: "group_context_unavailable", reason: "context_over_budget" });
  assert.equal(f.calls.model.length, 0); assert.equal(f.calls.sent.length, 0);
});
for (const [name, compiled] of [
  ["core beyond provider cap", { core: "x".repeat(64001), tail: "", sections: {} }],
  ["tail beyond provider cap", { core: "", tail: "x".repeat(24001), sections: {} }],
]) await check(`${name} refuses even below total96KiB ceiling`, async () => {
  const f = fixture(); f.state.compiledOverride = compiled;
  assert(Buffer.byteLength(JSON.stringify(compiled), "utf8") < 98304);
  await assert.rejects(() => f.run(), { code: "group_context_unavailable", reason: "context_over_budget" });
  assert.equal(f.calls.model.length, 0); assert.equal(f.calls.sent.length, 0);
});
await check("exact96KiB full compiled-plus-source bytes pass while one extra byte refuses", async () => {
  const baseline = fixture(); await baseline.run();
  const turns = baseline.calls.model[0].turns;
  const compiled = { core: "x".repeat(64000), tail: "y".repeat(24000), sections: {} };
  const available = 98304 - providerContextBytes({ compiled, turns });
  assert(available > 0 && available < 64000, "synthetic source packet leaves bounded UTF8 expansion room");
  compiled.core = "é".repeat(available) + "x".repeat(64000 - available);
  const exact = fixture(); exact.state.compiledOverride = clone(compiled);
  await exact.run();
  assert.equal(providerContextBytes(exact.calls.model[0]), 98304);
  assert.equal(exact.calls.sent.length, 1);
  const over = fixture(); over.state.compiledOverride = clone(compiled);
  over.state.compiledOverride.core = "é".repeat(available + 1) + "x".repeat(63999 - available);
  await assert.rejects(() => over.run(), { code: "group_context_unavailable", reason: "context_over_budget" });
  assert.equal(over.calls.model.length, 0); assert.equal(over.calls.sent.length, 0);
});
await check("provider-relevant budget explicitly excludes duplicated compiled system and diagnostic fields", async () => {
  const f = fixture();
  f.state.compiledOverride = { core: "safe core", tail: "", system: "x".repeat(150000), sections: { diagnostic: "x".repeat(150000) } };
  await f.run();
  assert.equal(f.calls.sent.length, 1);
  assert(Buffer.byteLength(JSON.stringify(f.calls.model[0]), "utf8") > 98304, "fixture intentionally exceeds full-object bytes");
  assert(providerContextBytes(f.calls.model[0]) < 98304, "bound is the explicit provider core/tail envelope, not all compiler diagnostics");
});

for (const [name, mutate, code] of [
  ["assistant candidate", (row) => { row.role = "her"; }, "group_context_unavailable"],
  ["malformed speaker", (row) => { row.speaker_person_id = "not-a-person"; }, "group_context_unavailable"],
  ["missing timestamp field", (row) => { delete row.at; }, "group_context_unavailable"],
  ["malformed timestamp", (row) => { row.at = "not-a-timestamp"; }, "group_context_unavailable"],
  ["calendar overflow timestamp", (row) => { row.at = "2026-02-30T00:00:00Z"; }, "group_context_unavailable"],
  ["hour overflow timestamp", (row) => { row.at = "2026-10-01T24:00:00Z"; }, "group_context_unavailable"],
  ["second overflow timestamp", (row) => { row.at = "2026-10-01T00:00:60Z"; }, "group_context_unavailable"],
  ["out-of-range episode", (row) => { row.episode_id = "9223372036854775808"; }, "group_context_unavailable"],
  ["nontext candidate", (row) => { row.content = 42; }, "source_selection_unavailable"],
]) await check(`actual candidate adapter refuses ${name} before provider/send`, async () => {
  const f = fixture(); f.state.allowedHistory = olderHistory(); mutate(f.state.allowedHistory[0]);
  await assert.rejects(() => f.run(), { code });
  assert.equal(f.calls.model.length, 0); assert.equal(f.calls.sent.length, 0);
});

await check("actual candidate adapter canonicalizes SQL recording time without inventing event time", async () => {
  const f = fixture(); f.state.allowedHistory = olderHistory();
  f.state.allowedHistory[0].at = "2026-10-01 05:30:00+05:30";
  await f.run();
  const row = sourcePacket(f.calls.model[0]).history.find((source) => source.sourceId === "200");
  assert.equal(row.recordedAt, "2026-10-01T00:00:00.000Z");
  assert.equal(row.occurredAt, null);
  assert.equal(row.speakerLabel, "person2");
  assert.equal(row.speakerLabelKind, "current_roster_label");
});
await check("current display label is trimmed without changing recorded speaker or human vocabulary", async () => {
  const f = fixture(); f.state.allowedHistory = olderHistory();
  f.state.rosterTransform = (rows) => rows.map((row) => row.person_id === P2 ? { ...row, username: "  Current label  " } : row);
  await f.run();
  const row = sourcePacket(f.calls.model[0]).history.find((source) => source.sourceId === "200");
  assert.equal(row.speakerId, P2); assert.equal(row.speakerLabel, "Current label");
  assertHumanTextOnly(f);
});
for (const label of [null, "\u202eUNTRUSTED_LABEL", " ".repeat(3), "x".repeat(161)])
  await check(`unknown or invalid current roster label ${JSON.stringify(label)} stays unavailable`, async () => {
    const f = fixture(); f.state.allowedHistory = olderHistory();
    f.state.rosterTransform = (rows) => label === null ? rows.filter((row) => row.person_id !== P2)
      : rows.map((row) => row.person_id === P2 ? { ...row, username: label } : row);
    await f.run();
    const row = sourcePacket(f.calls.model[0]).history.find((source) => source.sourceId === "200");
    assert.equal(row.speakerId, P2);
    assert.equal(row.speakerLabel, null);
    assert.equal(row.speakerLabelKind, null);
    assert.equal(row.text, olderHistory()[0].content);
  });

const routingMutations = {
  destination: (f) => { f.ev.chatKey = "-100999"; },
  surface: (f) => { f.ev.surface = "discord"; },
  replyTarget: (f) => { f.ev.messageId = "foreign-message"; },
  agent: (f) => { f.ctx.agentId = P3; },
  table: (f) => { f.ctx.t = (name) => { f.calls.redirected.push({ kind: "table", name }); return `wrong_${name}`; }; },
  send: (f) => { f.ctx.send = async (chat, msg) => { f.calls.redirected.push({ kind: "send", chat, msg }); return { ok: true }; }; },
  render: (f) => { f.ctx.adapter.render = () => { f.calls.redirected.push({ kind: "render" }); return [{ text: "REPLACED_RENDER" }]; }; },
  room: (f) => { f.state.returnedRoom.id = "92"; f.state.returnedRoom.room_device_id = P3; },
};
async function routingControl(kind, phase, sources = SOURCE) {
  const f = fixture({ sources });
  let mutated = false;
  f.state[phase] = () => { if (!mutated) { mutated = true; routingMutations[kind](f); } };
  let result;
  try { result = await f.run(); }
  catch (error) { if (error.code !== "group_authority_unavailable") throw error; }
  assert.equal(mutated, true, "routing mutation reached its awaited phase");
  assert.deepEqual(f.calls.redirected, [], "bound context cannot switch table/send/render handles");
  assert(!f.calls.sql.some(({ sql, args }) => sql.includes("wrong_") || args.includes(P3) || args.includes("92")),
    "bound room and agent cannot switch SQL read/write scope");
  assert(f.calls.witnessInputs.every(({ event, scope }) => event.surface === "telegram" && event.chatKey === "-100001" &&
    scope.roomId === "91" && scope.agentId === AGENT), "bound witness routing cannot change");
  assert.equal(result?.action, "speak", "unchanged authority still completes on original routing");
  assert.equal(f.calls.model.length, 1);
  assert.equal(f.calls.sent.length, 1);
  assert.equal(f.calls.sent[0].chat, "-100001", "delivery keeps the authorized destination");
  assert.equal(f.calls.sent[0].msg.replyTo, "17", "delivery keeps the original message target");
  assert.equal(f.calls.sent[0].msg.text, "haan bilkul", "delivery keeps the bound renderer output");
}
for (const kind of ["destination", "surface", "replyTarget"])
  await check(`caller event ${kind} mutation during model cannot change bound routing`, () => routingControl(kind, "duringModel"));
for (const phase of ["onSources", "duringModel"])
  for (const kind of ["agent", "table", "send", "render", "room"])
    await check(`caller ${kind} mutation at ${phase} keeps bound handles and scope`, () => routingControl(kind, phase));

async function defaultSendControl(kind, phase, sources = SOURCE) {
  const f = fixture({ sources, split: true, useDefaultSend: true });
  let mutated = false;
  f.state[phase] = () => {
    if (mutated) return;
    mutated = true;
    if (kind === "method") f.ctx.adapter.send = async (chat, msg) => {
      f.calls.redirected.push({ kind: "default-send", chat, msg }); return { ok: true };
    };
    else f.ctx.adapter.receiverMarker = "replaced-adapter";
  };
  const result = await f.run();
  assert.equal(mutated, true, "default transport mutation reached its awaited phase");
  assert.deepEqual(f.calls.redirected, [], "bound default transport cannot switch method");
  assert.deepEqual(f.calls.defaultReceivers.map(({ marker }) => marker), ["original-adapter", "original-adapter"],
    "bound default transport cannot switch receiver");
  assert(f.calls.defaultReceivers.every(({ frozen }) => frozen), "default transport receiver is immutable");
  assert.equal(result.action, "speak");
  assert.equal(f.calls.model.length, 1);
  assert.equal(f.calls.sent.length, 2);
  assert(f.calls.sent.every(({ chat }) => chat === "-100001"));
  assert.equal(f.calls.sent.map(({ msg }) => msg.text).join(""), "haan bilkul");
  assert.deepEqual(f.calls.sent.map(({ msg }) => msg.replyTo), ["17", null]);
}
for (const phase of ["duringModel", "afterSend"])
  for (const kind of ["method", "receiver"])
    await check(`default transport ${kind} mutation at ${phase} cannot change either fragment`, () => defaultSendControl(kind, phase));

await check("missing default transport fails closed even if the original adapter later adds send", async () => {
  const f = fixture(), adapter = { surface: "telegram", render: (text) => [{ text }] };
  const ctx = f.surface.makeCtx(adapter);
  adapter.send = async () => { f.calls.redirected.push({ kind: "late-send" }); return { ok: true }; };
  await assert.rejects(() => f.surface.deliver(ctx, "-100001", { kind: "text", text: "not authorized" }),
    { code: "surface_delivery_unconfirmed", outcome: "unknown", attemptedFragments: 1, retrySafe: false });
  assert.deepEqual(f.calls.redirected, []);
});

async function assertGuardBlocksEffects(f, guard) {
  await assert.rejects(() => f.surface.gatedReply(f.ctx, { core: "test", tail: "", sections: {} }, [], {
    assertAuthority: guard.assertAuthority,
  }), { code: "group_authority_unavailable" });
  await assert.rejects(() => f.surface.deliver(f.ctx, f.ev.chatKey, { kind: "text", text: "must not send" }, {
    assertAuthority: guard.assertAuthority,
  }), { code: "group_authority_unavailable" });
  assert.equal(f.calls.model.length, 0, "invalidated wrapper must block raw model");
  assert.equal(f.calls.sent.length, 0, "invalidated wrapper must block delivery");
}

async function rebindControl(sources = SOURCE) {
  const f = fixture({ sources });
  const guard = await f.surface.createGroupTurnGuard(f.ev, f.ctx, f.state.room);
  assert.equal(guard.guarantee, "checkpointed");
  assert(Object.isFrozen(guard) && Object.isFrozen(guard.recipients) && Object.isFrozen(guard.authority));
  const source = [{ evidenceId: "source-1", citations: null }], reader = () => source;
  guard.bindSources(reader, source);
  await guard.assertAuthority();
  assert.throws(() => guard.bindSources(reader, source), { code: "group_authority_unavailable" });
  const reads = f.calls.authority;
  await assertGuardBlocksEffects(f, guard);
  assert.equal(f.calls.authority, reads, "rebound invalidated wrapper does not reread authority");
}
await check("actual wrapper binds sources only once and blocks model/delivery after identical rebind", () => rebindControl());

async function stickyControl(kind, sources = SOURCE) {
  const f = fixture({ sources });
  const guard = await f.surface.createGroupTurnGuard(f.ev, f.ctx, f.state.room);
  const originalConsent = f.state.room.read_consent_at;
  let source = [{ evidenceId: "source-1", citations: null }];
  guard.bindSources(() => source, source);
  await guard.assertAuthority();
  if (kind === "authority") f.state.room.read_consent_at = null;
  else source = [];
  await assert.rejects(() => guard.assertAuthority(), { code: "group_authority_unavailable" });
  f.state.room.read_consent_at = originalConsent;
  source = [{ evidenceId: "source-1", citations: null }];
  const reads = f.calls.authority;
  await assertGuardBlocksEffects(f, guard);
  assert.equal(f.calls.authority, reads, "restoring state cannot revive an invalidated wrapper");
}
for (const kind of ["authority", "source"]) await check(`actual wrapper ${kind} invalidation stays closed after state is restored`, () => stickyControl(kind));

await check("actual wrapper rejects unbound effects and cannot be rescued by binding afterward", async () => {
  const f = fixture();
  const guard = await f.surface.createGroupTurnGuard(f.ev, f.ctx, f.state.room);
  await assertGuardBlocksEffects(f, guard);
  assert.throws(() => guard.bindSources(() => [], []), { code: "group_authority_unavailable" });
});

await check("actual wrapper maps invalid source DTO failure without permitting model or delivery", async () => {
  const f = fixture();
  const guard = await f.surface.createGroupTurnGuard(f.ev, f.ctx, f.state.room);
  assert.throws(() => guard.bindSources(() => [], [{ citations: undefined }]), { code: "group_authority_unavailable" });
  await assertGuardBlocksEffects(f, guard);
});

await check("late joiner gets only DB-authorized human history and no unsupported assistant evidence", async () => {
  const f = fixture();
  f.state.allowedHistory = [{ id: "1", role: "me", content: "PREJOIN_HUMAN", speaker_person_id: P2, episode_id: "90", at: null }];
  await f.run();
  assert(sourcePacket(f.calls.model[0]).history.some((row) => row.text === "PREJOIN_HUMAN" && row.speakerId === P2 && row.episodeId === "90"));
  assert(f.calls.model[0].turns.every((turn) => turn.role === "user"));
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
function changedCandidate(from, to) {
  const ast = ts.createSourceFile("api/_room.js", SOURCE.room, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const declaration = ast.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "roomSourceCandidates");
  assert(declaration, "actual candidate reader mutation target");
  const text = declaration.getText(ast);
  assert.equal(text.split(from).length - 1, 1, "unique candidate-reader mutation anchor");
  return { ...SOURCE, room: SOURCE.room.slice(0, declaration.getStart(ast)) + text.replace(from, to) + SOURCE.room.slice(declaration.end) };
}

await check("mutation: omitting the candidate pool from source binding permits revoked omitted evidence", async () => {
  const f = fixture({ sources: changed("surface", "guard.bindSources(readSources, sources);",
    "guard.bindSources(async () => (await readSources()).slice(0, 3), sources.slice(0, 3));") });
  f.state.allowedHistory = olderHistory();
  f.state.duringModel = () => { f.state.allowedHistory[1].content = "An omitted candidate changed after generation."; };
  await assert.rejects(() => suppressed(f, 1), /wire delivery count/);
});
await check("mutation: packet metadata entering human vocabulary is detected through actual engine input", async () => {
  const f = fixture({ sources: changed("surface", "humanSourceTexts: selection.rawTexts,", "") });
  f.state.allowedHistory = olderHistory(); await f.run();
  assert.throws(() => assertHumanTextOnly(f), /human vocabulary sees exact human text/);
});
await check("mutation: substituting current roster speaker for historical author is detected", async () => {
  const f = fixture({ sources: changed("surface", "speakerId: row.speaker_person_id, speakerLabel", "speakerId: members[0].person_id, speakerLabel") });
  f.state.allowedHistory = olderHistory(); await f.run();
  const older = sourcePacket(f.calls.model[0]).history.find((row) => row.sourceId === "200");
  assert.throws(() => assert.equal(older.speakerId, P2, "historical author must survive normalization"), /historical author must survive/);
});
await check("mutation: replacing durable cutoff with event message ID is detected before provider", async () => {
  const f = fixture({ sources: changed("surface", "throughLogId: logId, limit: candidateLimit", "throughLogId: ev.messageId, limit: candidateLimit") });
  await assert.rejects(() => f.run(), /candidate cutoff is the persisted human turn/);
  assert.equal(f.calls.model.length, 0); assert.equal(f.calls.sent.length, 0);
});
for (const [name, anchor, replacement, pattern] of [
  ["same-agent/room join", "and f.agent_id = l.agent_id and f.group_id = l.group_id", "", /f.agent_id = l.agent_id/],
  ["episode disclosure", "and f.superseded_by is null ${pred}", "and f.superseded_by is null", /full shipping episode disclosure predicate/],
  ["assistant exclusion", "and l.role = 'me' and l.speaker_person_id is not null", "", /l.role = 'me'/],
  ["fixed upper cutoff", "and l.id <= $6::bigint", "", /candidate query keeps fixed cutoff/],
]) await check(`mutation: candidate ${name} is required before provider`, async () => {
  const f = fixture({ sources: changedCandidate(anchor, replacement) });
  await assert.rejects(() => f.run(), pattern);
  assert.equal(f.calls.model.length, 0); assert.equal(f.calls.sent.length, 0);
});
await check("mutation: removing final provider UTF8 byte check leaks oversized context", async () => {
  const f = fixture({ sources: changed("surface", 'if (Buffer.byteLength(serialized, "utf8") > 98304) throw groupContextError("context_over_budget");', "") });
  f.state.compiledOverride = { core: "ह".repeat(40000), tail: "", sections: {} };
  await f.run();
  assert.throws(() => assert(providerContextBytes(f.calls.model[0]) <= 98304, "provider-relevant context must fit byte ceiling"), /provider-relevant context must fit/);
});
await check("mutation: removing provider segment ceilings permits silently truncated core", async () => {
  const f = fixture({ sources: changed("surface", 'if (compiled.core.length > 64_000 || compiled.tail.length > 24_000)', "if (false)") });
  f.state.compiledOverride = { core: "x".repeat(64001), tail: "", sections: {} };
  await f.run();
  assert.throws(() => assert(f.calls.model[0].compiled.core.length <= 64000, "core must fit actual provider segment"), /core must fit actual provider segment/);
});
await check("mutation: dropping mandatory recent rows is detected in the actual model packet", async () => {
  const f = fixture({ sources: changed("selection", "const mandatory = candidates.slice(-mandatoryCount);", "const mandatory = candidates.slice(-1);") });
  f.state.allowedHistory = olderHistory(); await f.run();
  const packet = sourcePacket(f.calls.model[0]);
  assert.throws(() => assert(packet.history.some((row) => row.sourceId === "227"), "latest mandatory historical source cannot be dropped"), /latest mandatory historical source/);
});
await check("mutation: removing full source-packet32KiB check leaks oversized required sources", async () => {
  const f = fixture({ sources: changed("selection", 'if (chosen.bytes > SOURCE_SELECTION_LIMITS.payloadUtf8Bytes) throw failure("required_context_over_budget");', "") });
  f.state.compiledOverride = { core: "safe core", tail: "", sections: {} };
  f.state.allowedHistory = Array.from({ length: 19 }, (_, index) => ({ id: String(200 + index), role: "me", episode_id: "80",
    speaker_person_id: P2, at: null, content: "x".repeat(2000) }));
  await f.run();
  assert.throws(() => assert(Buffer.byteLength(JSON.stringify(f.calls.model[0].turns), "utf8") <= 32768,
    "complete escaped source packet must fit32KiB"), /complete escaped source packet must fit/);
});

await check("mutation: removing event snapshot exposes unauthorized delivery destination", async () => {
  await assert.rejects(() => routingControl("destination", "duringModel", changed("surface",
    "ev = Object.freeze({ ...ev, adminBits: Object.freeze({ ...ev.adminBits }) });", "")), /delivery keeps the authorized destination/);
});
await check("mutation: removing context snapshot exposes replaced send handle", async () => {
  await assert.rejects(() => routingControl("send", "duringModel", changed("surface",
    "ctx = Object.freeze({ ...ctx, adapter: Object.freeze({ ...ctx.adapter }) });", "")), /bound context cannot switch table\/send\/render handles/);
});
await check("mutation: retaining mutable nested adapter exposes replaced renderer", async () => {
  await assert.rejects(() => routingControl("render", "duringModel", changed("surface",
    "adapter: Object.freeze({ ...ctx.adapter })", "adapter: ctx.adapter")), /bound context cannot switch table\/send\/render handles/);
});
await check("mutation: removing room snapshot exposes changed SQL scope", async () => {
  await assert.rejects(() => routingControl("room", "duringModel", changed("surface",
    "const room = Object.freeze({ ...foundRoom });", "const room = foundRoom;")), /bound room and agent cannot switch SQL read\/write scope/);
});
await check("mutation: old default-send closure exposes swapped adapter method and receiver", async () => {
  const oldClosure = changed("surface", "send: deps.send || defaultSend,", "send: deps.send || ((chatKey, msg) => adapter.send(chatKey, msg)),");
  for (const kind of ["method", "receiver"])
    for (const phase of ["duringModel", "afterSend"])
      await assert.rejects(() => defaultSendControl(kind, phase, oldClosure), /bound default transport cannot switch/);
});
await check("mutation: captured method with mutable original receiver is rejected", async () => {
  await assert.rejects(() => defaultSendControl("receiver", "afterSend", changed("surface",
    "sendAdapter.send.bind(sendAdapter)", "sendAdapter.send.bind(adapter)")), /bound default transport cannot switch receiver/);
});

await check("mutation: actual wrapper detects a removed one-time source-binding guard", async () => {
  await assert.rejects(() => rebindControl(changed("checkpoints", 'if (sourceReader !== null) fail("sources_already_bound");', "")), /Missing expected exception/);
});
await check("mutation: actual wrapper detects non-sticky kernel failure", async () => {
  await assert.rejects(() => stickyControl("source", changed("checkpoints", "invalidReason ??= reason;", "")), /Missing expected rejection/);
});

await check("mutation: actual raw second reply call is executed and caught", async () => {
  const f = fixture({ sources: changed("surface", "export async function onGroupMessage(ev, ctx) {",
    "export async function onGroupMessage(ev, ctx) {\n await ctx.reply({}, []);") });
  f.state.witnessComplete = false;
  await assert.rejects(() => suppressed(f), /raw model dispatch count/);
  assert.equal(f.calls.model.length, 1);
});
await check("mutation: removing pre-model guard is caught by actual model dispatch", async () => {
  const f = fixture({ sources: changed("surface", "await opts.assertAuthority?.();\n  if (opts.groupContextBudget", "if (opts.groupContextBudget") });
  f.state.beforeCompile = () => { f.state.room.read_consent_at = null; };
  await assert.rejects(() => suppressed(f), /raw model dispatch count/);
});
const sourceCheck = "await checkSources();";
assert.equal(SOURCE.checkpoints.split(sourceCheck).length - 1, 2, "two kernel source checkpoints bracket the external audience witness");
const withoutSourceCheck = (index) => {
  const offset = index === 0 ? SOURCE.checkpoints.indexOf(sourceCheck) : SOURCE.checkpoints.lastIndexOf(sourceCheck);
  return { ...SOURCE, checkpoints: SOURCE.checkpoints.slice(0, offset) +
    'await read(sourceReader, "source_read_failed", "invalid_source_snapshot", false);' + SOURCE.checkpoints.slice(offset + sourceCheck.length) };
};
await check("mutation: either retained source checkpoint still blocks persistent revocation", async () => {
  for (const index of [0, 1]) {
    const f = fixture({ sources: withoutSourceCheck(index) });
    f.state.facts = [{ id: "51", body: "ochre", citations: ["50"] }];
    f.state.duringModel = () => { f.state.grantValid = false; };
    await suppressed(f, 1);
  }
});
await check("mutation: removing both source receipt comparisons leaks revoked source and is caught", async () => {
  const receiptCheck = 'if (current.receipt !== sourceReceipt) fail("sources_changed");';
  assert.equal(SOURCE.checkpoints.split(receiptCheck).length - 1, 1, "one actual comparator serves both source checkpoints");
  const f = fixture({ sources: changed("checkpoints", receiptCheck, "") });
  f.state.facts = [{ id: "51", body: "ochre", citations: ["50"] }];
  f.state.duringModel = () => { f.state.grantValid = false; };
  await assert.rejects(() => suppressed(f, 1), /wire delivery count/);
});
await check("mutation: first source checkpoint catches revocation even if the later witness restores it", async () => {
  for (const mutated of [false, true]) {
    const f = fixture({ sources: mutated ? withoutSourceCheck(0) : SOURCE });
    f.state.facts = [{ id: "51", body: "ochre", citations: ["50"] }];
    f.state.beforeCompile = () => { f.state.grantValid = false; };
    f.state.onWitness = (n) => { if (n === 3) f.state.grantValid = true; };
    if (mutated) await assert.rejects(() => suppressed(f), /raw model dispatch count/);
    else await suppressed(f);
  }
});
await check("mutation: final source checkpoint catches revocation during the external witness", async () => {
  const f = fixture({ sources: withoutSourceCheck(1) });
  f.state.facts = [{ id: "51", body: "ochre", citations: ["50"] }];
  f.state.onWitness = (n) => { if (n === 3) f.state.grantValid = false; };
  await assert.rejects(() => suppressed(f), /raw model dispatch count/);
});
await check("mutation: removing fragment authority check is caught on second wire write", async () => {
  const f = fixture({ split: true, sources: changed("surface", "    await assertAuthority?.();\n    last = await sendAccepted", "    last = await sendAccepted") });
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
  f.ev.replyToSelf = false; f.state.sinceHerLast = 900000;
  f.state.words = [{ id: "8", phrase: "painting", origin_episode: "7" }];
  await assert.rejects(() => f.run(), /f.agent_id = l.agent_id/);
  assert.equal(f.calls.model.length, 0);
});
await check("mutation: removing episode disclosure predicate is caught structurally", async () => {
  const f = fixture({ sources: changed("room", "and f.superseded_by is null ${pred}", "and f.superseded_by is null") });
  f.ev.replyToSelf = false; f.state.sinceHerLast = 900000;
  f.state.words = [{ id: "8", phrase: "painting", origin_episode: "7" }];
  await assert.rejects(() => f.run(), /full shipping episode disclosure predicate/);
  assert.equal(f.calls.model.length, 0);
});
await check("mutation: enabling assistant history without dependency lineage is caught structurally", async () => {
  const f = fixture({ sources: changed("room", "and l.role = 'me' and l.speaker_person_id is not null", "") });
  f.ev.replyToSelf = false; f.state.sinceHerLast = 900000;
  f.state.words = [{ id: "8", phrase: "painting", origin_episode: "7" }];
  await assert.rejects(() => f.run(), /l.role = 'me'/);
  assert.equal(f.calls.model.length, 0);
});

console.log(`\n${groups} group-turn authority control-flow groups passed.`);
console.log("NOT PROVEN: PostgreSQL parsing/semantics, transaction races, real Telegram membership, live model quality, deployment. SQL doubles validate exact clauses/bindings and return declared authority results only.");
