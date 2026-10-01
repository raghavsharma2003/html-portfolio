// Actual dispatch/guard/render/delivery modules with bounded I/O doubles only.
// No provider, HTTP, database or real transport is invoked. An accepted adapter
// receipt is not proof a person read a message and does not imply deduplication.
import assert from "node:assert/strict";
import { SOURCE, fixture, clone } from "../group-turn-authority/fixture.mjs";

const PRIVATE = "SYNTHETIC_PRIVATE_TRANSPORT_BODY";
let groups = 0;
async function check(name, run) { await run(); console.log(`ok ${++groups} ${name}`); }
const threeParts = (text) => [{ text: text.slice(0, 2) }, { text: text.slice(2, 5) }, { text: text.slice(5) }];

function deliveryFixture({ reaction = false, render, outcomes = [{ ok: true }], sources = SOURCE, afterAttempt } = {}) {
  const f = fixture({ sources });
  const attempts = [];
  if (reaction) {
    f.ev.replyToSelf = false; f.state.sinceHerLast = 900000;
    f.state.words = [{ id: "8", phrase: "painting", origin_episode: "7" }];
  }
  if (render) f.ctx.adapter.render = render;
  f.ctx.send = async (chat, msg) => {
    const index = attempts.length;
    attempts.push(clone({ chat, msg }));
    await afterAttempt?.(f, index);
    const value = outcomes[Math.min(index, outcomes.length - 1)];
    if (typeof value === "function") return value();
    return value;
  };
  return { ...f, attempts };
}
async function capture(f) {
  try { return { result: await f.run(), error: null }; }
  catch (error) { return { result: null, error }; }
}
function assertFailure(error, expected) {
  assert(error, "unconfirmed dispatch must reject instead of claiming success");
  assert.equal(error.code, "surface_delivery_unconfirmed");
  assert.equal(error.message, "surface_delivery_unconfirmed");
  assert.equal(error.status, 502);
  assert.equal(error.phase, "delivery");
  assert.equal(error.retrySafe, false, "a delivery receipt cannot authorize retrying prior effects");
  for (const [key, value] of Object.entries(expected)) assert.equal(error[key], value, key);
  const forbidden = ["cause", "receipt", "rawError", "rawReceipt", "text", "description", "body"];
  for (const key of forbidden) assert.equal(Object.hasOwn(error, key), false, `failure must not carry ${key}`);
  const described = Reflect.ownKeys(error).map((key) => {
    const field = Object.getOwnPropertyDescriptor(error, key);
    return "value" in field ? String(field.value) : "accessor";
  }).join("|");
  assert(!described.includes(PRIVATE), "private transport data must not escape through any error field");
}
async function assertUnconfirmed(f, expected, count) {
  const { result, error } = await capture(f);
  assert.equal(result, null, "unconfirmed group work cannot return said/react success");
  assertFailure(error, expected);
  assert.equal(f.attempts.length, count, "stop at the first unconfirmed transport outcome");
  assert.equal(f.calls.logs.filter((row) => row.role === "her").length, 0, "unconfirmed or partial answer cannot be logged as a completed reply");
  assert.equal(f.calls.logs.filter((row) => row.role === "me").length, 1, "already-authorized human observation remains recorded");
  await Promise.resolve(); await Promise.resolve();
  assert.equal(f.attempts.length, count, "no automatic retry or later fragment");
}

for (const [name, receipt] of [
  ["negative receipt", { ok: false, description: PRIVATE }],
  ["null receipt", null], ["absent receipt", undefined], ["boolean receipt", true],
  ["string receipt", "ok"], ["empty receipt", {}], ["array receipt", []],
  ["array with true ok", Object.assign([], { ok: true })],
  ["numeric ok", { ok: 1 }], ["string ok", { ok: "true" }],
  ["other success property", { success: true }], ["inherited ok", Object.create({ ok: true })],
]) await check(`actual group dispatch rejects ${name} before assistant persistence`, async () => {
  const f = deliveryFixture({ outcomes: [receipt] });
  await assertUnconfirmed(f, { outcome: "unknown", reason: "send_unconfirmed", acceptedFragments: 0, attemptedFragments: 1, failedFragment: 0 }, 1);
  assert.equal(f.calls.model.length, 1);
});

await check("receipt ok getter is not treated as confirmation or executed", async () => {
  let reads = 0;
  const receipt = Object.defineProperty({}, "ok", { enumerable: true, get() { reads++; return true; } });
  await assertUnconfirmed(deliveryFixture({ outcomes: [receipt] }),
    { outcome: "unknown", reason: "send_unconfirmed", acceptedFragments: 0, attemptedFragments: 1, failedFragment: 0 }, 1);
  assert.equal(reads, 0);
});
for (const thrown of [new Error(PRIVATE), PRIVATE, { body: PRIVATE, status: 401 }])
  await check(`send rejection type ${typeof thrown} is content-free and not retry-safe`, async () => {
    const f = deliveryFixture({ outcomes: [() => { throw thrown; }] });
    await assertUnconfirmed(f, { outcome: "unknown", reason: "send_unconfirmed", acceptedFragments: 0, attemptedFragments: 1, failedFragment: 0 }, 1);
  });

for (const failedFragment of [0, 1]) await check(`three-fragment dispatch stops at failure ${failedFragment} with honest partial counts`, async () => {
  const outcomes = [{ ok: true }, { ok: true }, { ok: true }]; outcomes[failedFragment] = { ok: false, body: PRIVATE };
  const f = deliveryFixture({ render: threeParts, outcomes });
  await assertUnconfirmed(f, { outcome: "unknown", reason: "send_unconfirmed", acceptedFragments: failedFragment,
    attemptedFragments: failedFragment + 1, failedFragment }, failedFragment + 1);
});
await check("transport throws on second fragment without retry, third fragment or assistant success log", async () => {
  const f = deliveryFixture({ render: threeParts, outcomes: [{ ok: true }, () => { throw new Error(PRIVATE); }, { ok: true }] });
  await assertUnconfirmed(f, { outcome: "unknown", reason: "send_unconfirmed", acceptedFragments: 1, attemptedFragments: 2, failedFragment: 1 }, 2);
});
for (const outcome of [{ ok: false }, null, () => { throw new Error(PRIVATE); }])
  await check("actual reaction dispatch needs an explicit confirmed receipt", async () => {
    const f = deliveryFixture({ reaction: true, outcomes: [outcome] });
    await assertUnconfirmed(f, { outcome: "unknown", reason: "send_unconfirmed", acceptedFragments: 0, attemptedFragments: 1, failedFragment: 0 }, 1);
    assert.equal(f.calls.model.length, 0);
  });

for (const [name, render, reason] of [
  ["empty renderer", () => [], "empty_render"],
  ["throwing renderer", () => { throw new Error(PRIVATE); }, "render_unavailable"],
  ["non-array renderer", () => ({ text: "not a fragment list" }), "invalid_render"],
  ["null renderer result", () => null, "invalid_render"],
  ["later empty fragment", () => [{ text: "valid first" }, { text: "" }], "invalid_render"],
  ["later malformed fragment", () => [{ text: "valid first" }, { text: 17 }], "invalid_render"],
  ["sparse fragment list", () => { const parts = [{ text: "valid first" }]; parts.length = 2; return parts; }, "invalid_render"],
  ["throwing render length", () => new Proxy([{ text: "valid" }], { get(target, key) { if (key === "length") throw new Error(PRIVATE); return Reflect.get(target, key); } }), "invalid_render"],
  ["revoked render proxy", () => { const pair = Proxy.revocable([{ text: "valid" }], {}); pair.revoke(); return pair.proxy; }, "invalid_render"],
]) await check(`${name} refuses the whole render before any transport attempt`, async () => {
  const f = deliveryFixture({ render });
  await assertUnconfirmed(f, { outcome: "not_executed", reason, acceptedFragments: 0, attemptedFragments: 0, failedFragment: null }, 0);
});
await check("fragment text accessor is rejected before first send without executing getter", async () => {
  let reads = 0;
  const bad = Object.defineProperty({}, "text", { enumerable: true, get() { reads++; return PRIVATE; } });
  await assertUnconfirmed(deliveryFixture({ render: () => [{ text: "valid first" }, bad] }),
    { outcome: "not_executed", reason: "invalid_render", acceptedFragments: 0, attemptedFragments: 0, failedFragment: null }, 0);
  assert.equal(reads, 0);
});
await check("validated render text is snapshotted before a transport can mutate later fragments", async () => {
  const parts = [{ text: "first" }, { text: "original second" }];
  const f = deliveryFixture({ render: () => parts, afterAttempt: (_f, index) => { if (!index) parts[1].text = PRIVATE; } });
  const result = await f.run();
  assert.equal(result.said, true); assert.equal(f.attempts.length, 2);
  assert.equal(f.attempts[1].msg.text, "original second");
});

await check("explicit custom ok=true without message ID confirms actual dispatch", async () => {
  const f = deliveryFixture({ outcomes: [{ ok: true }] });
  const result = await f.run();
  assert.equal(result.said, true); assert.equal(f.attempts.length, 1);
  assert.equal(f.calls.logs.filter((row) => row.role === "her").length, 1);
});
await check("web-style collector is accepted and successful last receipt identity is unchanged", async () => {
  const f = fixture(); const collected = []; const receipt = { ok: true };
  f.ctx.send = async (_chat, message) => { collected.push(message); return receipt; };
  const result = await f.surface.deliver(f.ctx, "synthetic-web", { kind: "text", text: "hello", replyTo: null, buttons: [] });
  assert.equal(result, receipt); assert.equal(collected.length, 1);
});
await check("successful multi-fragment delivery preserves last receipt and threading", async () => {
  const f = fixture(); const sent = []; const receipts = [{ ok: true, marker: "first" }, { ok: true, marker: "last" }];
  f.ctx.adapter.render = () => [{ text: "first" }, { text: "second" }];
  f.ctx.send = async (_chat, msg) => { sent.push(msg); return receipts[sent.length - 1]; };
  const buttons = [{ label: "Continue", data: "continue" }];
  const result = await f.surface.deliver(f.ctx, "synthetic", { kind: "text", text: "whole", replyTo: "message-1", buttons });
  assert.equal(result, receipts[1]);
  assert.deepEqual(sent.map((msg) => msg.replyTo), ["message-1", null]);
  assert.deepEqual(clone(sent.map((msg) => msg.buttons)), [[], buttons]);
});
await check("confirmed reaction succeeds without generating a model answer", async () => {
  const f = deliveryFixture({ reaction: true }); const result = await f.run();
  assert.equal(result.action, "react"); assert.equal(f.calls.model.length, 0); assert.equal(f.attempts.length, 1);
});
await check("authority failure before send remains the original error, not a transport failure", async () => {
  const f = deliveryFixture(); const marker = Object.assign(new Error("synthetic_authority_revoked"), { code: "synthetic_authority_revoked" });
  let checks = 0;
  f.ctx.assertPublicAuthority = async () => { if (++checks === 3) throw marker; };
  const { error } = await capture(f);
  assert.equal(error, marker); assert.equal(f.attempts.length, 0);
  assert.equal(f.calls.logs.filter((row) => row.role === "her").length, 0);
});
await check("revoked group authority after first fragment stops remaining sends without relabeling error", async () => {
  const f = deliveryFixture({ render: threeParts, afterAttempt: (current, index) => { if (!index) current.state.room.read_consent_at = null; } });
  const { error } = await capture(f);
  assert.equal(error.code, "group_authority_unavailable"); assert.equal(f.attempts.length, 1);
  assert.equal(f.calls.logs.filter((row) => row.role === "her").length, 0);
});
await check("command mutation can complete before unknown acknowledgement and must not be labeled retry-safe", async () => {
  const f = deliveryFixture({ outcomes: [{ ok: false, description: PRIVATE }] }); f.ev.text = "/chup me";
  const { result, error } = await capture(f);
  assert.equal(result, null);
  assertFailure(error, { outcome: "unknown", reason: "send_unconfirmed", acceptedFragments: 0, attemptedFragments: 1, failedFragment: 0 });
  assert.equal(f.state.memberQuiet, "quiet"); assert.equal(f.calls.commandMutations.length, 1);
  assert.equal(f.calls.model.length, 0); assert.equal(f.attempts.length, 1);
});
await check("known limitation: repeated identical transport event is not deduplicated by receipt confirmation", async () => {
  const f = deliveryFixture(); await f.run(); await f.run();
  assert.equal(f.ev.messageId, "17"); assert.equal(f.attempts.length, 2);
  assert.equal(f.calls.model.length, 2); assert.equal(f.calls.logs.filter((row) => row.role === "her").length, 2);
});

function changed(from, to) {
  assert.equal(SOURCE.surface.split(from).length - 1, 1, "unique production delivery mutation anchor");
  return { ...SOURCE, surface: SOURCE.surface.replace(from, to) };
}
await check("mutation: ignoring failed receipt reproduces false said, false audit and later fragments", async () => {
  const sources = changed('if (!ok || !("value" in ok) || ok.value !== true) throw new Error();', "");
  const f = deliveryFixture({ sources, render: threeParts, outcomes: [{ ok: false }, { ok: true }] });
  await assert.rejects(() => assertUnconfirmed(f,
    { outcome: "unknown", reason: "send_unconfirmed", acceptedFragments: 0, attemptedFragments: 1, failedFragment: 0 }, 1),
  /unconfirmed group work cannot return said\/react success/);
  assert.equal(f.attempts.length, 3, "old ignored-failure behavior sends later fragments");
  assert.equal(f.calls.logs.filter((row) => row.role === "her").length, 1, "old ignored-failure behavior persists false completed reply");
});
await check("mutation: ignoring reaction receipt reproduces false action success", async () => {
  const f = deliveryFixture({ reaction: true, outcomes: [null],
    sources: changed('if (!ok || !("value" in ok) || ok.value !== true) throw new Error();', "") });
  await assert.rejects(() => assertUnconfirmed(f,
    { outcome: "unknown", reason: "send_unconfirmed", acceptedFragments: 0, attemptedFragments: 1, failedFragment: 0 }, 1),
  /unconfirmed group work cannot return said\/react success/);
  assert.equal(f.attempts.length, 1); assert.equal(f.calls.model.length, 0);
});
await check("mutation: raw transport exception instead of sanitized error is rejected", async () => {
  const f = deliveryFixture({ outcomes: [() => { throw new Error(PRIVATE); }], sources: changed(
    '} catch {\n    throw deliveryUnconfirmed("unknown", "send_unconfirmed", acceptedFragments,\n      acceptedFragments + 1, acceptedFragments);\n  }',
    '} catch (error) { throw error; }') });
  const { error } = await capture(f);
  assert.equal(error.message, PRIVATE, "raw-error mutant reaches the actual dispatch boundary");
  assert.throws(() => assertFailure(error, { outcome: "unknown" }), /surface_delivery_unconfirmed/);
});

console.log(`\n${groups} surface delivery control-flow groups passed.`);
console.log("NOT PROVEN: actual platform acceptance, human receipt, exactly-once delivery, durable deduplication, atomic authorization/send, PostgreSQL or provider behavior.");
