// No server, provider, secret file or database. Exercise the real pure boundary
// and the complete Telegram HTTP module with only its I/O seams substituted.
import assert from "node:assert/strict";
import * as crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as admission from "../../api/_group-source-event.js";

const { assertGroupSourceEvent, normalizeGroupSourceSentAtSeconds } = admission;
const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const source = read("api/tg.js");
const boundarySource = read("api/_group-source-event.js");
const clone = (value) => JSON.parse(JSON.stringify(value));
const SENT = Date.parse("2026-10-01T12:00:00.000Z") / 1000;
const EARLIER = "2026-10-01T11:59:59.999999Z";
const P1 = "b0000000-0000-4000-8000-000000000001";
const P2 = "b0000000-0000-4000-8000-000000000002";
const AGENT = "a0000000-0000-4000-8000-000000000001";
const failIO = () => { throw new Error("offline_unexpected_io"); };
let groups = 0;
async function check(label, run) { await run(); groups++; console.log(`ok ${groups} - ${label}`); }

function inputs() {
  return {
    ev: { kind: "message", isGroup: true, sourceEventKind: "ordinary_message", sourceSentAtSeconds: SENT,
      surface: "telegram", chatKey: "-100001", surfaceUserId: "101", text: "synthetic private body" },
    authority: { surface: "telegram", surface_chat_id: "-100001", read_consent_at: EARLIER,
      recipients: [P1, P2], linked_members: [P1, P2].map((person_id, index) => ({
        person_id, surface: "telegram", surface_user_id: String(101 + index), linked_at: EARLIER, left_at: null,
      })) },
    recipients: [P1, P2],
  };
}

function allowed(data = inputs(), fn = assertGroupSourceEvent) {
  return fn(data.ev, data.authority, data.recipients);
}

function refused(data, fn = assertGroupSourceEvent) {
  assert.throws(() => allowed(data, fn), (error) => {
    assert.equal(error.message, "group_source_event_unavailable");
    assert.equal(error.code, "group_source_event_unavailable");
    assert.equal(error.status, 503);
    assert.equal(error.cause, undefined);
    assert.deepEqual(Object.keys(error).sort(), ["code", "status"]);
    assert(!JSON.stringify(error).includes("synthetic private"));
    return true;
  });
}

function loadModule(text, filename, imports, extras = {}) {
  const exports = {};
  const output = ts.transpileModule(text, { fileName: filename,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  runInNewContext(output, { exports, require(name) {
    assert(Object.hasOwn(imports, name), `unapproved import ${name}`);
    return imports[name];
  }, console: { error() {} }, Buffer, URL, fetch: failIO, ...extras }, { filename, timeout: 5000 });
  return exports;
}

function telegram({ onLoad = null, onDispatch = null, text = source } = {}) {
  const calls = { engine: 0, dispatch: [], authority: 0, db: 0, secrets: 0 };
  const syntheticSecret = "synthetic-group-source-eval-only";
  const tg = loadModule(text, "api/tg.js", {
    "node:crypto": crypto,
    "./_ratelimit.js": { allow: () => true, ipOf: () => "synthetic-ip" },
    "./_config.js": {}, // Never import or read the actual local configuration.
    "./_surface.js": {
      async dispatch(ev, ctx) { calls.dispatch.push({ ev, ctx }); return onDispatch ? onDispatch(ev, ctx) : { ok: true }; },
      async loadEngine() { calls.engine++; await onLoad?.(); return {}; },
      makeCtx: (_adapter, deps) => deps, splitForLimit: () => { throw new Error("unexpected render"); },
      ROOM_CARD: "fixture", withdrawReceipt: () => "fixture",
    },
    "./_db.js": { q: () => { calls.db++; failIO(); } },
    "./_clonechannel.js": { resolveInboundClone: failIO, createClonePublicAuthorityGuard: failIO },
    "./_channel-secrets.js": { getChannelSecret: () => { calls.secrets++; failIO(); } },
    "./_incidents.js": { withDoor: (_q, _name, handler) => handler },
    "./_agentscope.js": { MEERA_AGENT_ID: AGENT },
    "./_group-audience.js": { createTelegramGroupAuthority: () => { calls.authority++; return {}; } },
    "./_group-source-event.js": admission,
  }, { process: { env: { TELEGRAM_WEBHOOK_SECRET: syntheticSecret } } });
  async function request(body, secret = syntheticSecret) {
    const response = { statusCode: null, body: null,
      status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; } };
    await tg.default({ method: "POST", headers: { "x-telegram-bot-api-secret-token": secret }, body }, response);
    assert.equal(calls.db, 0); assert.equal(calls.secrets, 0);
    return response;
  }
  return { tg, calls, request };
}

function update(extra = {}) {
  return { update_id: 9001, message: { message_id: 17, date: SENT,
    chat: { id: -100001, type: "supergroup", title: "Synthetic group" },
    from: { id: 101, is_bot: false, first_name: "Synthetic speaker" },
    text: "Can we discuss the painting?", ...extra } };
}

await check("accepted ordinary source is canonical whole-second ISO after every known boundary", () => {
  const data = inputs(), before = clone(data);
  assert.equal(allowed(data), "2026-10-01T12:00:00.000Z");
  assert.deepEqual(data, before);
});
await check("Unix seconds normalize without coercion or arrival-time fallback", () => {
  assert.equal(normalizeGroupSourceSentAtSeconds(1), 1);
  assert.equal(normalizeGroupSourceSentAtSeconds(253402300799), 253402300799);
  for (const value of [undefined, null, 0, -1, 0.5, SENT + 0.1, String(SENT), true, NaN, Infinity,
    253402300800, Number.MAX_SAFE_INTEGER, {}, 1n]) {
    assert.equal(normalizeGroupSourceSentAtSeconds(value), null);
    const data = inputs(); data.ev.sourceSentAtSeconds = value; refused(data);
  }
});
await check("before/equal consent and before/equal each recipient link refuse", () => {
  for (const value of ["2026-10-01T12:00:00Z", "2026-10-01T12:00:00.000001Z", "2026-10-01T12:00:01Z"]) {
    const consent = inputs(); consent.authority.read_consent_at = value; refused(consent);
    for (let index = 0; index < 2; index++) {
      const linked = inputs(); linked.authority.linked_members[index].linked_at = value; refused(linked);
    }
  }
});
await check("explicit timezone offsets preserve exact boundary comparison", () => {
  const data = inputs();
  data.authority.read_consent_at = "2026-10-01 17:29:59.999999+05:30";
  data.authority.linked_members[1].linked_at = "2026-10-01T04:59:59.999999-07:00";
  assert.equal(allowed(data), "2026-10-01T12:00:00.000Z");
  data.authority.linked_members[1].linked_at = "2026-10-01T17:30:00+05:30";
  refused(data);
});
await check("PostgreSQL short, compact and colon authority offsets are equivalent at microsecond boundaries", () => {
  const formats = [
    ["2026-10-01 11:59:59.999999+00", "2026-10-01 12:00:00+00"],
    ["2026-10-01 11:59:59.999999+0000", "2026-10-01 12:00:00+0000"],
    ["2026-10-01 16:59:59.999999+05", "2026-10-01 17:00:00+05"],
    ["2026-10-01 17:29:59.999999+0530", "2026-10-01 17:30:00+0530"],
    ["2026-10-01T17:29:59.999999+05:30", "2026-10-01T17:30:00+05:30"],
    ["2026-10-01 04:59:59.999999-07", "2026-10-01 05:00:00-07"],
    ["2026-10-01 04:29:59.999999-0730", "2026-10-01 04:30:00-0730"],
    ["2026-10-01T04:29:59.999999-07:30", "2026-10-01T04:30:00-07:30"],
  ];
  for (const [before, equal] of formats) {
    const data = inputs(); data.authority.read_consent_at = before;
    data.authority.linked_members.forEach((member) => { member.linked_at = before; });
    assert.equal(allowed(data), "2026-10-01T12:00:00.000Z", before);
    data.authority.read_consent_at = equal; refused(data);
    data.authority.read_consent_at = before;
    data.authority.linked_members[1].linked_at = equal; refused(data);
    data.authority.linked_members[1].linked_at = equal.replace(/00(?=[+-])/, "00.000001");
    refused(data);
  }
});
await check("malformed PostgreSQL authority offsets remain fail closed", () => {
  for (const zone of ["+0", "+000", "+00000", "+00:", "+0:00", "+00:0", "+00:000", "+24",
    "+2400", "+0060", "-24", "-2400", "-0060", "+00:60", "+00:00:00", "++00", "UTC", "z", " +00"]) {
    const timestamp = `2026-09-30 00:00:00${zone}`;
    const consent = inputs(); consent.authority.read_consent_at = timestamp; refused(consent);
    const linked = inputs(); linked.authority.linked_members[1].linked_at = timestamp; refused(linked);
  }
});
await check("missing or malformed consent/link timestamps never normalize into permission", () => {
  for (const value of [null, undefined, 0, new Date(SENT * 1000), "", "2026-02-30T00:00:00Z",
    "2025-02-29T00:00:00Z", "0000-01-01T00:00:00Z", "2026-10-01T24:00:00Z",
    "2026-10-01T00:60:00Z", "2026-10-01T00:00:60Z", "2026-09-30", "2026-09-30T00:00:00",
    "2026-09-30T00:00:00+24:00", "2026-09-30T00:00:00+00:60", "2026-09-30T00:00:00.0000001Z"]) {
    const consent = inputs(); consent.authority.read_consent_at = value; refused(consent);
    const linked = inputs(); linked.authority.linked_members[1].linked_at = value; refused(linked);
  }
});
await check("only declared ordinary group event with exact transport scope is admitted", () => {
  for (const [key, values] of Object.entries({ kind: ["ignore", "join", null], isGroup: [false, 1],
    sourceEventKind: ["edited_message", "unsupported_event", null], surface: ["discord", null],
    chatKey: ["-100002", -100001], surfaceUserId: ["103", 101, null] })) {
    for (const value of values) { const data = inputs(); data.ev[key] = value; refused(data); }
  }
});
await check("all and only current recipient members must be present once", () => {
  const mutations = [
    (data) => { data.recipients = []; },
    (data) => { data.recipients = [P1, P1]; },
    (data) => { data.recipients = [P1]; },
    (data) => { data.authority.recipients = [P1, P1]; },
    (data) => { data.authority.recipients = [P1]; },
    (data) => { data.authority.linked_members.pop(); },
    (data) => { data.authority.linked_members[1].person_id = P1; },
    (data) => { data.authority.linked_members[1].surface_user_id = "101"; },
    (data) => { data.authority.linked_members[1].surface = "discord"; },
    (data) => { data.authority.linked_members[1].left_at = EARLIER; },
    (data) => { delete data.authority.linked_members[1]; },
    (data) => { delete data.recipients[0]; },
  ];
  for (const mutate of mutations) { const data = inputs(); mutate(data); refused(data); }
  const reordered = inputs(); reordered.recipients.reverse();
  assert.equal(allowed(reordered), "2026-10-01T12:00:00.000Z");
});
await check("getters and throwing proxies cannot leak private errors", () => {
  const data = inputs(); let accesses = 0;
  Object.defineProperty(data.authority.linked_members[1], "linked_at", {
    get() { accesses++; throw new Error("synthetic private body"); },
  });
  refused(data); assert.equal(accesses, 0);
  const proxy = inputs(); proxy.authority = new Proxy({}, {
    getOwnPropertyDescriptor() { throw new Error("synthetic private body"); },
  }); refused(proxy);
});
await check("known-boundary check deliberately does not invent current-time event-age policy", () => {
  const data = inputs(); data.ev.sourceSentAtSeconds = SENT + 100_000_000;
  assert.equal(allowed(data), new Date(data.ev.sourceSentAtSeconds * 1000).toISOString());
  assert(!boundarySource.includes("Date.now"));
});
await check("negative control detects non-strict consent equality", () => {
  const target = 'eventMicros > timestampMicros(own(authority, "read_consent_at"))';
  assert.equal(boundarySource.split(target).length, 2);
  const mutant = loadModule(boundarySource.replace(target, target.replace(" > ", " >= ")),
    "api/_group-source-event.js", {}).assertGroupSourceEvent;
  const data = inputs(); data.authority.read_consent_at = "2026-10-01T12:00:00Z";
  assert.equal(allowed(data, mutant), "2026-10-01T12:00:00.000Z");
  refused(data);
});
await check("negative control detects replacing every-member consent with sender-only consent", () => {
  const target = 'need(eventMicros > timestampMicros(own(member, "linked_at")));';
  assert.equal(boundarySource.split(target).length, 2);
  const mutant = loadModule(boundarySource.replace(target,
    'if (transportUser === speakerUser) need(eventMicros > timestampMicros(own(member, "linked_at")));'),
  "api/_group-source-event.js", {}).assertGroupSourceEvent;
  const data = inputs(); data.authority.linked_members[1].linked_at = "2026-10-01T12:00:00Z";
  assert.equal(allowed(data, mutant), "2026-10-01T12:00:00.000Z");
  refused(data);
});

await check("actual parser copies sent date, source kind and literal text/caption only", () => {
  const { tg } = telegram(); const payload = update({ text: "", caption: "literal art caption", photo: [{ file_id: "unused" }] });
  const [event] = tg.parse(payload);
  assert.equal(event.kind, "message"); assert.equal(event.sourceEventKind, "ordinary_message");
  assert.equal(event.sourceSentAtSeconds, SENT); assert.equal(event.caption, "literal art caption");
  assert.equal(event.photo, undefined); assert.equal(event.media, undefined);
  payload.message.date = SENT + 1; payload.message.caption = "mutated raw text";
  assert.equal(event.sourceSentAtSeconds, SENT); assert.equal(event.caption, "literal art caption");
});
await check("parser refuses missing/coerced dates as source metadata without manufacturing time", () => {
  const { tg } = telegram();
  for (const date of [undefined, null, 0, String(SENT), SENT + 0.5, Infinity]) {
    const [event] = tg.parse(update({ date })); assert.equal(event.sourceSentAtSeconds, null);
    refused({ ...inputs(), ev: event });
  }
  const payload = update(); let accesses = 0;
  Object.defineProperty(payload.message, "date", { enumerable: true, get() { accesses++; return SENT; } });
  assert.equal(tg.parse(payload)[0].sourceSentAtSeconds, null); assert.equal(accesses, 0);
});
await check("group edits and other or ambiguous update variants cannot dispatch ordinary commands", () => {
  const { tg } = telegram(); const message = update({ text: "/chup", edit_date: SENT + 1 }).message;
  for (const payload of [
    { update_id: 1, edited_message: message }, { update_id: 1, channel_post: message },
    { update_id: 1, business_message: message }, { update_id: 1, edited_business_message: message },
    { update_id: 1, message }, { ...update({ text: "/chup" }), edited_message: message },
    { ...update({ text: "/chup" }), unknown_new_update_variant: {} },
    { ...update({ text: "/chup" }), chat_member: { chat: message.chat } },
  ]) {
    const [event] = tg.parse(payload); assert.equal(event.kind, "ignore");
    assert.notEqual(event.sourceEventKind, "ordinary_message");
    assert.equal(event.sourceSentAtSeconds, null);
  }
});
await check("ephemeral/guest/business/anonymous group namespace is ignored before command handling", () => {
  const { tg } = telegram();
  for (const [key, value] of Object.entries({ receiver_user: { id: 101 }, ephemeral_message_id: "private",
    ephemeral_custom: true, guest: {}, guest_query_id: "guest", guest_bot_caller_user: { id: 101 },
    guest_bot_caller_chat: { id: -100001 }, guest_future_field: true, business_connection_id: "business",
    sender_business_bot: { id: 9000 }, sender_chat: { id: -100001 }, author_signature: "anonymous",
    is_anonymous: true, is_from_offline: true })) {
    const [event] = tg.parse(update({ text: "/chup", [key]: value }));
    assert.equal(event.kind, "ignore", key); assert.equal(event.sourceSentAtSeconds, null, key);
  }
});
await check("legacy parseUpdate triage and ordinary membership control events stay intact", () => {
  const { tg } = telegram();
  assert.equal(tg.parseUpdate({ edited_message: update().message }).kind, "message");
  assert.equal(tg.parseUpdate({ my_chat_member: {} }).kind, "my_chat_member");
  assert.equal(tg.parseUpdate({ message: { new_chat_members: [{}] } }).kind, "join");
  assert.equal(tg.parseUpdate({ message: { left_chat_member: {} } }).kind, "leave");
  const group = update().message.chat;
  for (const [payload, expected] of [
    [{ my_chat_member: { chat: group, new_chat_member: { status: "administrator" } } }, "bot_membership"],
    [{ chat_member: { chat: group, new_chat_member: { user: { id: 101 }, status: "member" } } }, "member_change"],
    [update({ new_chat_members: [{ id: 102 }] }), "join"],
    [update({ left_chat_member: { id: 102 } }), "leave"],
  ]) assert.equal(tg.parse(payload)[0].kind, expected);
});
await check("DM edit and DM scoped-message behavior remains outside group source admission", () => {
  const { tg } = telegram(); const message = update({ chat: { id: 101, type: "private" },
    receiver_user: { id: 101 }, text: "/start", edit_date: SENT + 1 }).message;
  const [event] = tg.parse({ edited_message: message });
  assert.equal(event.kind, "message"); assert.equal(event.isGroup, false); assert.equal(event.chatKey, "101");
  assert.equal(event.text, "/start"); assert.equal(event.sourceEventKind, "edited_message");
  assert.equal(event.sourceSentAtSeconds, null);
  refused({ ...inputs(), ev: event });
});
await check("actual authenticated HTTP handler carries parsed primitives through admission", async () => {
  let admitted = null;
  const harness = telegram({ onDispatch(ev) { admitted = allowed({ ...inputs(), ev }); return { ok: true }; } });
  const response = await harness.request(update());
  assert.equal(response.statusCode, 200); assert.equal(response.body.handled, true);
  assert.equal(harness.calls.engine, 1); assert.equal(harness.calls.dispatch.length, 1);
  assert.equal(admitted, "2026-10-01T12:00:00.000Z");
});
await check("wrong/missing authenticated webhook secret refuses before engine or dispatch", async () => {
  for (const secret of ["wrong-synthetic", "", null]) {
    const harness = telegram(); const response = await harness.request(update(), secret);
    assert.equal(response.statusCode, 401); assert.equal(harness.calls.engine, 0);
    assert.equal(harness.calls.dispatch.length, 0); assert.equal(harness.calls.authority, 0);
  }
});
await check("actual handler does not replace invalid source admission with successful handling", async () => {
  const harness = telegram({ onDispatch(ev) { return allowed({ ...inputs(), ev }); } });
  const response = await harness.request(update({ date: SENT - 1 }));
  assert.equal(response.statusCode, 200); assert.equal(response.body.handled, false);
  assert.deepEqual(clone(response.body), { ok: true, handled: false });
});
await check("payload mutation while engine loads cannot rewrite normalized event/date/text", async () => {
  const payload = update();
  const harness = telegram({ onLoad() {
    payload.message.date = SENT - 100; payload.message.text = "mutated raw text";
    payload.message.chat.id = -100999; payload.message.from.id = 999;
  } });
  await harness.request(payload);
  const event = harness.calls.dispatch[0].ev;
  assert.equal(event.sourceSentAtSeconds, SENT); assert.equal(event.text, "Can we discuss the painting?");
  assert.equal(event.chatKey, "-100001"); assert.equal(event.surfaceUserId, "101");
  assert.equal(event.raw.date, SENT - 100); assert(Object.isFrozen(event));
  assert.equal(allowed({ ...inputs(), ev: event }), "2026-10-01T12:00:00.000Z");
});
await check("authenticated scoped group command reaches dispatch only as ignore", async () => {
  const harness = telegram();
  const response = await harness.request(update({ text: "/chup", receiver_user: { id: 101 } }));
  assert.equal(response.statusCode, 200); assert.equal(harness.calls.dispatch[0].ev.kind, "ignore");
});
await check("negative control detects parsing after asynchronous engine load", async () => {
  const line = "  const engine = deps.engine !== undefined ? deps.engine : await loadEngine();";
  assert.equal(source.split(line).length, 2);
  const mutant = source.replace(line, "").replace('  const [ev0] = parse(update);', `${line}\n  const [ev0] = parse(update);`);
  const payload = update();
  const harness = telegram({ text: mutant, onLoad() { payload.message.date = SENT - 100; } });
  await harness.request(payload);
  assert.equal(harness.calls.dispatch[0].ev.sourceSentAtSeconds, SENT - 100);
});
await check("negative control detects scoped group namespace guard removal", () => {
  const target = "if (!supportedKind || scopedMessage)";
  assert.equal(source.split(target).length, 2);
  const { tg } = telegram({ text: source.replace(target, "if (false)") });
  assert.equal(tg.parse(update({ text: "/chup", receiver_user: { id: 101 } }))[0].kind, "message");
  assert.equal(telegram().tg.parse(update({ text: "/chup", receiver_user: { id: 101 } }))[0].kind, "ignore");
});

console.log(`group source event: ${groups} offline groups passed; authenticated-handler doubles, not live Telegram, historical membership, freshness, deduplication or atomic egress proof`);
