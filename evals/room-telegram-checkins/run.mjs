// WS-R34. CHECK-INS OVER TELEGRAM (migration 096) — offline, deterministic,
// $0, no DB, no network, no Telegram call, no model call.
//
//   node evals/room-telegram-checkins/run.mjs
//
// The Room on Telegram (WS-R18, migration 082) already carries a
// one-Room-per-chat pointer, `vy_room_follower_channel`. Check-ins (WS-R16)
// already deliver in-app, by web push (WS-R22) and by a WhatsApp utility
// template (WS-R29). This is the fourth channel, and the pointer that
// already exists IS the opt-in — no new person table, workstream law #1.
// Seven sections:
//
//   §1 PARSING. `parseCheckinsCommand`; `classifyRoomTelegramUpdate`'s new
//      `replyToMessageId` field; `resolveReplyThreadId` — the reply-to-
//      thread mapping (law 5), proven as a real, injectable seam even
//      though the shipping default resolves it to `null` (the Room's
//      default thread) every time, because `vy_room_checkin` carries no
//      `thread_id` column and this workstream does not add one.
//   §2 THE TOGGLE'S SQL. `activeTelegramChannelFor`/`markTelegramChannel
//      Stopped`/`telegramCheckinsStatusFor`/`setTelegramCheckinsEnabledFor
//      Follower` (api/_room-surface.js) — the eligibility predicate is SQL
//      text, never a JS filter after a broader read.
//   §3 `/checkins on|off`, through the REAL Telegram pipeline
//      (handleRoomTelegramUpdate). Also proves the reply-to-thread mapping
//      end to end: an ordinary message that IS a reply to an earlier
//      message still reaches `roomSay` and is answered normally.
//   §4 THE SEND — `deliverers.telegram` (api/_checkins.js): not_configured,
//      delivered, failed+revoke (403/400), transient (429, no ledger row),
//      and NEGATIVE CONTROLS (a) `checkins_enabled=false` never sends, (b) a
//      `stopped_code` never sends — both proven with a spy `fetch` that
//      would record a call if one were made.
//   §5 ONE DOOR, NOT A SECOND ASSEMBLER — NEGATIVE CONTROL (c). Whatever text
//      is handed to `deliverers.telegram` as `said` is exactly what reaches
//      Telegram, byte for byte; a static scan of the function's own source
//      proves it can reach no model call at all (no `gatedReply`, `think(`,
//      `engine.compile`, or `deps.reply`); and `deliverOne`'s own source is
//      scanned to prove it is called with the SAME `said` the in-app
//      delivery already produced, never a second one.
//   §6 THE ROOM PANEL'S OWN CONTROL — `api/_checkins.js`'s `telegram
//      CheckinsStatus`/`setTelegramCheckins`, scoped off the caller's own
//      session; B cannot toggle A's pointer.
//   §7 STATIC WIRING — `api/checkins.js` dispatches both new ops;
//      `CheckinsPanel.tsx` renders the control; `copy.ts` carries the
//      strings in both locales; migration 096 widens the channel CHECK.
import fs from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { SLUG, freshState, fakeDb, loadFixtureAgent } from "../room/fixtures.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");

process.env.ROOM_SESSION_SECRET = "t".repeat(48);

let pass = 0;
let fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) pass++;
  else fail++;
  console.log(`${cond ? "  ok  " : "FAIL  "}${name}${extra ? `   ${extra}` : ""}`);
};

const SURFACE = await import(pathToFileURL(join(REPO, "api/_room-surface.js")).href);
const {
  activeTelegramChannelFor,
  markTelegramChannelStopped,
  telegramCheckinsStatusFor,
  setTelegramCheckinsEnabledForFollower,
} = SURFACE;
const CI = await import(pathToFileURL(join(REPO, "api/_checkins.js")).href);
const { deliverers, telegramCheckinsStatus, setTelegramCheckins } = CI;
const TG = await import(pathToFileURL(join(REPO, "api/_room-telegram.js")).href);
const {
  handleRoomTelegramUpdate,
  classifyRoomTelegramUpdate,
  parseCheckinsCommand,
  resolveReplyThreadId,
  checkinsOnCard,
  checkinsOffCard,
  joinFirstCard,
} = TG;

const { engine, loadAgent } = await loadFixtureAgent(REPO);
const BASE_ENV = { ROOM_SESSION_SECRET: process.env.ROOM_SESSION_SECRET, ROOM_TELEGRAM_WEBHOOK_SECRET: "w".repeat(40) };

// ─────────────────────────────────────────────────────────────────────────
// THE FIXTURE WORLD — wrapping the shared evals/room/fixtures.mjs, never
// editing it: that fixture is shared with the release-gating evals/room-
// leak/run.mjs, `evals/room-cohorts/run.mjs`'s own `withDayTable` precedent
// and `evals/checkins/run.mjs`'s own `withCheckins` restated one workstream
// over. Adds the two columns migration 096 adds (simulated as real column
// DEFAULTS apply only at insert time, never on an ON CONFLICT update — the
// same discipline the real migration's own additive columns carry) plus the
// 'telegram' channel's own delivery-ledger insert.
// ─────────────────────────────────────────────────────────────────────────
function withTelegramCheckins(baseDb, state) {
  state.checkinDeliveries = state.checkinDeliveries || [];
  const calls = [];
  const wrapped = async (sql, params = []) => {
    calls.push(sql);

    if (sql.includes("insert into vy_room_follower_channel")) {
      const result = await baseDb(sql, params);
      const channelRef = String(params[4]);
      const row = state.channelMap.find((c) => c.channel === "telegram" && c.channel_ref === channelRef);
      // Migration 096: `checkins_enabled boolean not null default true`,
      // `stopped_code text null` — both apply only the FIRST time a pointer
      // is created; a re-`/start` (ON CONFLICT) must not silently re-enable
      // a follower who had turned check-ins off, which is exactly why the
      // real UPDATE branch of that statement never names either column.
      if (row && row.checkins_enabled === undefined) {
        row.checkins_enabled = true;
        row.stopped_code = null;
      }
      return result;
    }
    if (sql.includes("select channel_ref from vy_room_follower_channel")) {
      const [followerId] = params.map(String);
      const row = state.channelMap.find(
        (c) => c.channel === "telegram" && c.follower_id === followerId
          && c.checkins_enabled === true && c.stopped_code == null,
      );
      return row ? [{ channel_ref: row.channel_ref }] : [];
    }
    if (sql.includes("set stopped_code = $2")) {
      const [followerId, code] = params.map(String);
      const row = state.channelMap.find((c) => c.channel === "telegram" && c.follower_id === followerId);
      if (row) row.stopped_code = code;
      return [];
    }
    if (sql.includes("select checkins_enabled, stopped_code from vy_room_follower_channel")) {
      const [followerId] = params.map(String);
      const row = state.channelMap.find((c) => c.channel === "telegram" && c.follower_id === followerId);
      return row ? [{ checkins_enabled: row.checkins_enabled, stopped_code: row.stopped_code }] : [];
    }
    if (sql.includes("set checkins_enabled = ($2)::bool")) {
      const [followerId, enabled] = params;
      const row = state.channelMap.find((c) => c.channel === "telegram" && c.follower_id === String(followerId));
      if (!row) return [];
      row.checkins_enabled = Boolean(enabled);
      if (enabled) row.stopped_code = null;
      return [{ checkins_enabled: row.checkins_enabled }];
    }
    if (/insert into vy_room_checkin_delivery\b/.test(sql) && sql.includes("'telegram'")) {
      const [deliveryId, checkinId, roomId, personId, dueAtIso, deliveredAtIso, st, reason] = params;
      const exists = state.checkinDeliveries.some(
        (d) => d.checkin_id === String(checkinId) && d.due_at === dueAtIso && d.channel === "telegram",
      );
      if (exists) return [];
      const row = {
        delivery_id: String(deliveryId), checkin_id: String(checkinId), room_id: String(roomId),
        person_id: String(personId), due_at: dueAtIso, delivered_at: deliveredAtIso,
        channel: "telegram", state: st, reason,
      };
      state.checkinDeliveries.push(row);
      return [{ delivery_id: row.delivery_id }];
    }

    return baseDb(sql, params);
  };
  wrapped.calls = calls;
  return wrapped;
}

// ── the fake Telegram wire (evals/room-telegram/run.mjs's own precedent) ──
function fakeTgClient(sent) {
  return {
    sendMessage: async (chatId, text) => {
      (sent[chatId] ??= []).push({ kind: "text", text: String(text) });
      return { ok: true };
    },
    sendDocument: async (chatId, buffer, filename, caption) => {
      (sent[chatId] ??= []).push({ kind: "document", filename, caption, text: buffer.toString("utf8") });
      return { ok: true };
    },
    answerCallbackQuery: async () => ({ ok: true }),
  };
}
const texts = (sent, chatId) => (sent[chatId] || []).filter((m) => m.kind === "text").map((m) => m.text);

// ── the Telegram identity bridge (evals/room-telegram/run.mjs's own precedent) ──
function fakePersonBridge(state) {
  const findPerson = async (surface, surfaceUserId) => {
    const key = String(surfaceUserId);
    const row = state.surfaceIdentities.find((r) => r.surface === surface && r.surface_user_id === key);
    return row ? { person_id: row.person_id, username: row.handle || "", via: "vy_surface_identity" } : null;
  };
  const linkPerson = async (surface, surfaceUserId, { handle = "", personId = null } = {}) => {
    const existing = await findPerson(surface, surfaceUserId);
    if (existing) return { personId: existing.person_id, created: false };
    const key = String(surfaceUserId);
    const pid = personId || `pp-${surface}-${key}`;
    if (!state.persons.some((p) => p.person_id === pid)) {
      state.persons.push({ person_id: pid, age_tier: "unverified" });
    }
    state.surfaceIdentities.push({ surface, surface_user_id: key, person_id: pid, handle: String(handle || "").slice(0, 64) });
    return { personId: pid, created: true };
  };
  return { findPerson, linkPerson };
}

const personTables = async () => [];
const tableApplied = async () => false;

const depsFor = (state, db, tgClient, memlog, extra = {}) => {
  const bridge = fakePersonBridge(state);
  return {
    db, tg: tgClient, loadAgent, engine, env: { ...BASE_ENV },
    personTables, tableApplied,
    personForSurfaceUser: bridge.findPerson,
    linkSurfacePerson: bridge.linkPerson,
    ...extra,
  };
};

const textUpdate = (tgUserId, text, replyToId = null) => ({
  message: {
    chat: { id: Number(tgUserId), type: "private" },
    from: { id: Number(tgUserId), username: `u${tgUserId}` },
    text,
    message_id: 1,
    ...(replyToId != null ? { reply_to_message: { message_id: Number(replyToId) } } : {}),
  },
});
const callbackUpdate = (tgUserId, data) => ({
  callback_query: {
    id: `cbq${tgUserId}${data}`,
    from: { id: Number(tgUserId), username: `u${tgUserId}` },
    message: { chat: { id: Number(tgUserId) } },
    data,
  },
});

async function fullJoin(state, db, tgClient, memlog, tgUserId, slug, { memory = true } = {}) {
  await handleRoomTelegramUpdate(textUpdate(tgUserId, `/start ${slug}`), depsFor(state, db, tgClient, memlog));
  await handleRoomTelegramUpdate(callbackUpdate(tgUserId, `a1:${slug}`), depsFor(state, db, tgClient, memlog));
  await handleRoomTelegramUpdate(
    callbackUpdate(tgUserId, `${memory ? "m1" : "m0"}:${slug}`),
    depsFor(state, db, tgClient, memlog),
  );
}

// ═════════════════════════════════════════════════════════════════════════
console.log("── §1: PARSING — /checkins, reply-to-message, the thread mapping seam ──");
// ═════════════════════════════════════════════════════════════════════════
{
  ok("/checkins on parses to 'on'", parseCheckinsCommand("/checkins on") === "on");
  ok("/checkins off parses to 'off'", parseCheckinsCommand("/checkins off") === "off");
  ok("/checkins@bot on (the @-mention form) still parses", parseCheckinsCommand("/checkins@RoomBot on") === "on");
  ok("a bare /checkins (no argument) is null, never guessed at", parseCheckinsCommand("/checkins") === null);
  ok("an unrecognised argument is null", parseCheckinsCommand("/checkins maybe") === null);
  ok("an ordinary message is null", parseCheckinsCommand("hello") === null);

  const withReply = classifyRoomTelegramUpdate(textUpdate("1", "yes I did", 555));
  ok("classifyRoomTelegramUpdate extracts replyToMessageId as a string",
    withReply.kind === "message" && withReply.replyToMessageId === "555");
  const withoutReply = classifyRoomTelegramUpdate(textUpdate("1", "hello"));
  ok("an ordinary message's replyToMessageId is null", withoutReply.replyToMessageId === null);

  ok("resolveReplyThreadId(null, {}) is null — no reply, no mapping, the default thread",
    resolveReplyThreadId(null, {}) === null);
  ok("resolveReplyThreadId('555', {}) is null — the shipping default: no persisted mapping exists yet",
    resolveReplyThreadId("555", {}) === null);
  ok("resolveReplyThreadId('555', {threadForReply}) trusts an INJECTED resolver's answer",
    resolveReplyThreadId("555", { threadForReply: (id) => (id === "555" ? "thread-abc" : null) }) === "thread-abc");
  ok("...a resolver returning null (id not found) still falls back to the default thread",
    resolveReplyThreadId("999", { threadForReply: () => null }) === null);

  let consulted = false;
  resolveReplyThreadId(null, { threadForReply: () => { consulted = true; return "thread-abc"; } });
  ok("NEGATIVE CONTROL: with no reply-to id, the resolver is never even consulted", consulted === false);
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n── §2: THE TOGGLE'S SQL — a predicate, not a JS filter ──");
// ═════════════════════════════════════════════════════════════════════════
{
  const state = freshState();
  const db = withTelegramCheckins(fakeDb(state), state);
  const followerId = "ffffffff-0000-4000-8000-000000000001";
  state.channelMap.push({
    channel_map_id: randomUUID(), room_id: state.rooms[0].room_id, person_id: "p1",
    follower_id: followerId, channel: "telegram", channel_ref: "chat-1",
    checkins_enabled: true, stopped_code: null,
  });

  ok("an enabled, un-stopped pointer IS eligible",
    (await activeTelegramChannelFor(db, followerId))?.channel_ref === "chat-1");

  const status1 = await telegramCheckinsStatusFor(db, followerId);
  ok("telegramCheckinsStatusFor reads connected:true, checkins_enabled:true, stopped:false",
    status1.connected === true && status1.checkins_enabled === true && status1.stopped === false, JSON.stringify(status1));

  // NEGATIVE CONTROL (a): checkins_enabled=false is never eligible.
  await setTelegramCheckinsEnabledForFollower(db, followerId, false);
  ok("(a) after turning off, the SAME pointer is no longer eligible",
    (await activeTelegramChannelFor(db, followerId)) === null);

  // Turning back on.
  const turnedOn = await setTelegramCheckinsEnabledForFollower(db, followerId, true);
  ok("turning on again returns checkins_enabled:true", turnedOn.checkins_enabled === true);
  ok("...and eligibility is restored",
    (await activeTelegramChannelFor(db, followerId))?.channel_ref === "chat-1");

  // NEGATIVE CONTROL (b): a stopped pointer is never eligible, even enabled.
  await markTelegramChannelStopped(db, followerId, "403");
  ok("(b) a pointer with a stopped_code is never eligible even though checkins_enabled is still true",
    (await activeTelegramChannelFor(db, followerId)) === null);
  const status2 = await telegramCheckinsStatusFor(db, followerId);
  ok("...and status reads stopped:true", status2.stopped === true);

  // Turning on again clears the stop.
  await setTelegramCheckinsEnabledForFollower(db, followerId, true);
  ok("turning on again clears a prior stopped_code",
    (await activeTelegramChannelFor(db, followerId))?.channel_ref === "chat-1");

  // A follower who never joined via Telegram at all.
  const noPointer = await telegramCheckinsStatusFor(db, "zzzzzzzz-0000-4000-8000-000000000009");
  ok("no Telegram pointer at all reads connected:false, never an error",
    noPointer.connected === false && noPointer.checkins_enabled === false);
  const noSet = await setTelegramCheckinsEnabledForFollower(db, "zzzzzzzz-0000-4000-8000-000000000009", true);
  ok("toggling a nonexistent pointer is a silent no-op, never a throw", noSet === null);
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n── §3: /checkins on|off, and the thread mapping end to end ──");
// ═════════════════════════════════════════════════════════════════════════
{
  const state = freshState();
  const db = withTelegramCheckins(fakeDb(state), state);
  const sent = {};
  const tgClient = fakeTgClient(sent);
  const memlog = [];
  const reply = async () => "noted, see you tomorrow.";

  await fullJoin(state, db, tgClient, memlog, "4001", SLUG, { memory: true });
  const pointer = state.channelMap.find((c) => c.channel_ref === "4001");
  ok("joining via Telegram creates a pointer with checkins_enabled:true by default (migration 096's own column default)",
    pointer?.checkins_enabled === true);

  sent["4001"] = [];
  await handleRoomTelegramUpdate(textUpdate("4001", "/checkins off"), depsFor(state, db, tgClient, memlog, { reply }));
  ok("/checkins off sends the app-voiced card", texts(sent, "4001").at(-1) === checkinsOffCard());
  ok("...and the pointer's checkins_enabled is now false", pointer.checkins_enabled === false);

  sent["4001"] = [];
  await handleRoomTelegramUpdate(textUpdate("4001", "/checkins on"), depsFor(state, db, tgClient, memlog, { reply }));
  ok("/checkins on sends the app-voiced card", texts(sent, "4001").at(-1) === checkinsOnCard());
  ok("...and the pointer's checkins_enabled is true again", pointer.checkins_enabled === true);

  // A stopped pointer is cleared by the follower's own /checkins on.
  pointer.stopped_code = "403";
  sent["4001"] = [];
  await handleRoomTelegramUpdate(textUpdate("4001", "/checkins on"), depsFor(state, db, tgClient, memlog, { reply }));
  ok("/checkins on clears a prior stopped_code — the follower is, by construction, reachable again",
    pointer.stopped_code === null);

  // An unjoined chat gets the same "open a Room first" card, never a toggle.
  sent["9999"] = [];
  await handleRoomTelegramUpdate(textUpdate("9999", "/checkins on"), depsFor(state, db, tgClient, memlog, { reply }));
  ok("an unjoined chat's /checkins on gets the ordinary join-first card", texts(sent, "9999").at(-1) === joinFirstCard());

  // THE THREAD MAPPING, end to end: an ordinary message that IS a reply to
  // an earlier one still reaches the real follower lane and is answered
  // normally — `resolveReplyThreadId`'s own header on why this always
  // resolves to the Room's default thread today.
  sent["4001"] = [];
  await handleRoomTelegramUpdate(
    textUpdate("4001", "yes, I did it today", 42),
    depsFor(state, db, tgClient, memlog, { reply }),
  );
  ok("a reply-to-message update still reaches the real follower lane and is answered",
    texts(sent, "4001").some((t) => t.includes("noted, see you tomorrow")));
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n── §4: THE SEND — deliverers.telegram ──");
// ═════════════════════════════════════════════════════════════════════════
{
  const state = freshState();
  const db = withTelegramCheckins(fakeDb(state), state);
  const followerId = "aaaaaaaa-0000-4000-8000-000000000001";
  state.channelMap.push({
    channel_map_id: randomUUID(), room_id: state.rooms[0].room_id, person_id: "p1",
    follower_id: followerId, channel: "telegram", channel_ref: "chat-a1",
    checkins_enabled: true, stopped_code: null,
  });

  const rowFor = (checkinId, dueAtIso, fid = followerId) => ({
    checkin_id: checkinId, room_id: state.rooms[0].room_id, person_id: "p1", follower_id: fid,
    due_at: dueAtIso, slug: SLUG, display_name: "Anjali", title: "Evening walk",
  });

  // — not_configured: no ROOM_TELEGRAM_BOT_TOKEN.
  let calledFetch = false;
  const spyFetch = async () => { calledFetch = true; return { ok: true, status: 200, json: async () => ({ ok: true }) }; };
  const r1 = await deliverers.telegram(db, rowFor(randomUUID(), "2026-09-04T03:00:00.000Z"), "hi", { env: {}, fetch: spyFetch });
  const r1Ledger = state.checkinDeliveries.find((d) => d.delivery_id === r1?.delivery_id);
  ok("no ROOM_TELEGRAM_BOT_TOKEN — not_configured, no network call attempted",
    r1Ledger?.state === "not_configured" && calledFetch === false, JSON.stringify(r1Ledger));

  const env = { ROOM_TELEGRAM_BOT_TOKEN: "tok" };

  // NEGATIVE CONTROL (a): checkins_enabled=false is never sent to.
  const offFollower = "aaaaaaaa-0000-4000-8000-000000000002";
  state.channelMap.push({
    channel_map_id: randomUUID(), room_id: state.rooms[0].room_id, person_id: "p2",
    follower_id: offFollower, channel: "telegram", channel_ref: "chat-a2",
    checkins_enabled: false, stopped_code: null,
  });
  let sentToOff = false;
  const spyOff = async () => { sentToOff = true; return { ok: true, status: 200, json: async () => ({ ok: true }) }; };
  const rOff = await deliverers.telegram(db, rowFor(randomUUID(), "2026-09-04T03:05:00.000Z", offFollower), "hi", { env, fetch: spyOff });
  ok("(a) NEGATIVE CONTROL: checkins_enabled:false is never sent to (no fetch call at all)", sentToOff === false);
  ok("(a) the ledger records skipped_stopped",
    state.checkinDeliveries.find((d) => d.delivery_id === rOff?.delivery_id)?.state === "skipped_stopped");

  // NEGATIVE CONTROL (b): a stopped_code is never sent to.
  const stoppedFollower = "aaaaaaaa-0000-4000-8000-000000000003";
  state.channelMap.push({
    channel_map_id: randomUUID(), room_id: state.rooms[0].room_id, person_id: "p3",
    follower_id: stoppedFollower, channel: "telegram", channel_ref: "chat-a3",
    checkins_enabled: true, stopped_code: "403",
  });
  let sentToStopped = false;
  const spyStopped = async () => { sentToStopped = true; return { ok: true, status: 200, json: async () => ({ ok: true }) }; };
  const rStopped = await deliverers.telegram(db, rowFor(randomUUID(), "2026-09-04T03:06:00.000Z", stoppedFollower), "hi", { env, fetch: spyStopped });
  ok("(b) NEGATIVE CONTROL: a stopped pointer is never sent to (no fetch call at all)", sentToStopped === false);
  ok("(b) the ledger records skipped_stopped",
    state.checkinDeliveries.find((d) => d.delivery_id === rStopped?.delivery_id)?.state === "skipped_stopped");

  // — delivered: a real 2xx.
  let sentUrl = null;
  let sentBody = null;
  const okFetch = async (url, init) => { sentUrl = url; sentBody = JSON.parse(init.body); return { ok: true, status: 200, json: async () => ({ ok: true }) }; };
  const checkinIdOk = randomUUID();
  const r2 = await deliverers.telegram(db, rowFor(checkinIdOk, "2026-09-04T04:00:00.000Z"), "hey! did you get your walk in today?", { env, fetch: okFetch });
  const okLedger = state.checkinDeliveries.find((d) => d.delivery_id === r2?.delivery_id);
  ok("a 2xx writes a delivered ledger row", okLedger?.state === "delivered", JSON.stringify(okLedger));
  ok("the send hit the right chat", sentUrl.includes("/bottok/sendMessage") && sentBody.chat_id === "chat-a1");
  ok("the sent text is EXACTLY the reply text handed in, byte for byte",
    sentBody.text === "hey! did you get your walk in today?");

  // — failed + revoke: a 403 (bot blocked).
  const badFetch = async () => ({ ok: false, status: 403, json: async () => ({ ok: false, error_code: 403, description: "Forbidden: bot was blocked by the user" }) });
  const checkinIdBad = randomUUID();
  const r3 = await deliverers.telegram(db, rowFor(checkinIdBad, "2026-09-04T05:00:00.000Z"), "hey!", { env, fetch: badFetch });
  const failedLedger = state.checkinDeliveries.find((d) => d.delivery_id === r3?.delivery_id);
  ok("a 403 writes a failed ledger row naming Telegram's own error code",
    failedLedger?.state === "failed" && failedLedger.reason.includes("403"), JSON.stringify(failedLedger));
  const pointerA = state.channelMap.find((c) => c.follower_id === followerId);
  ok("...and the pointer is marked stopped — revoke on failure (law 3)", pointerA.stopped_code === "403");

  // A second occurrence for the SAME (now-stopped) follower is skipped_stopped.
  let sentAfterStop = false;
  const spyFetch2 = async () => { sentAfterStop = true; return { ok: true, status: 200, json: async () => ({ ok: true }) }; };
  const r4 = await deliverers.telegram(db, rowFor(randomUUID(), "2026-09-04T06:00:00.000Z"), "hey!", { env, fetch: spyFetch2 });
  ok("after a 403 revoke, no further send reaches this follower until they clear it", sentAfterStop === false);
  ok("...and the ledger says why",
    state.checkinDeliveries.find((d) => d.delivery_id === r4?.delivery_id)?.state === "skipped_stopped");

  // — transient: a 429 writes NO ledger row, and does not touch the pointer.
  pointerA.stopped_code = null; // re-eligible, as if the follower cleared it
  const beforeCount = state.checkinDeliveries.length;
  const flakyFetch = async () => ({ ok: false, status: 429, json: async () => ({ ok: false, error_code: 429, parameters: { retry_after: 30 } }) });
  const r5 = await deliverers.telegram(db, rowFor(randomUUID(), "2026-09-04T07:00:00.000Z"), "hey!", { env, fetch: flakyFetch });
  ok("a 429 returns null (no delivery_id) and writes NO ledger row", r5 === null && state.checkinDeliveries.length === beforeCount);
  ok("...and the pointer is left untouched — a transient failure is not a revoke", pointerA.stopped_code === null);

  // A 5xx behaves the same way (no ledger row, no revoke).
  const beforeCount2 = state.checkinDeliveries.length;
  const serverErrorFetch = async () => ({ ok: false, status: 500, json: async () => ({ ok: false }) });
  const r6 = await deliverers.telegram(db, rowFor(randomUUID(), "2026-09-04T08:00:00.000Z"), "hey!", { env, fetch: serverErrorFetch });
  ok("a 5xx also writes NO ledger row", r6 === null && state.checkinDeliveries.length === beforeCount2);
  ok("...and does not revoke the pointer", pointerA.stopped_code === null);
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n── §5: ONE DOOR, NOT A SECOND ASSEMBLER — NEGATIVE CONTROL (c) ──");
// ═════════════════════════════════════════════════════════════════════════
{
  const ciSrc = fs.readFileSync(join(REPO, "api/_checkins.js"), "utf8");
  const start = ciSrc.indexOf("async telegram(db, row, said, deps = {}) {");
  ok("deliverers.telegram is present in the source", start >= 0);
  const end = ciSrc.indexOf("\n};", start);
  const body = ciSrc.slice(start, end < 0 ? ciSrc.length : end);
  const banned = ["gatedReply", "think\\(", "engine\\.compile", "deps\\.reply", "\\.reply\\("];
  const bannedRegex = new RegExp(banned.join("|"));
  ok("deliverers.telegram's own source can reach no model call at all — no gatedReply, no think(), no engine.compile, no deps.reply",
    !bannedRegex.test(body), bannedRegex.test(body) ? body : "");

  // NEGATIVE CONTROL: the same scan DOES flag a poisoned version that calls
  // the model a second time.
  const poisoned = "async telegram(db, row, said, deps = {}) {\n  const out = await deps.reply(compiled, turns);\n  return out;\n}";
  ok("NEGATIVE CONTROL: the same scan DOES flag a poisoned version calling deps.reply",
    bannedRegex.test(poisoned));

  // `deliverOne`'s own call site: the SAME `said` variable, never a fresh one.
  ok("deliverOne calls deliverers.telegram with the SAME `said` the in-app delivery already produced",
    /deliverers\.telegram\(db, row, said, deps\)/.test(ciSrc));

  // Behavioural half: whatever text is handed in is exactly what is sent.
  const state = freshState();
  const db = withTelegramCheckins(fakeDb(state), state);
  const followerId = "bbbbbbbb-0000-4000-8000-000000000001";
  state.channelMap.push({
    channel_map_id: randomUUID(), room_id: state.rooms[0].room_id, person_id: "p1",
    follower_id: followerId, channel: "telegram", channel_ref: "chat-b1",
    checkins_enabled: true, stopped_code: null,
  });
  const said = "this exact string, and only this string, reaches Telegram";
  let sentText = null;
  const captureFetch = async (url, init) => { sentText = JSON.parse(init.body).text; return { ok: true, status: 200, json: async () => ({ ok: true }) }; };
  await deliverers.telegram(
    db,
    { checkin_id: randomUUID(), room_id: state.rooms[0].room_id, person_id: "p1", follower_id: followerId, due_at: "2026-09-04T09:00:00.000Z" },
    said,
    { env: { ROOM_TELEGRAM_BOT_TOKEN: "tok" }, fetch: captureFetch },
  );
  ok("(c) the text that reaches Telegram is byte-identical to `said`", sentText === said);
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n── §6: THE ROOM PANEL'S OWN CONTROL — session-scoped ──");
// ═════════════════════════════════════════════════════════════════════════
{
  const ROOM = await import(pathToFileURL(join(REPO, "api/_room-surface.js")).href);
  const { joinRoom, bindTelegramChannel } = ROOM;
  const state = freshState();
  const db = withTelegramCheckins(fakeDb(state), state);
  const a = await joinRoom(db, { slug: SLUG, authUserId: "11111111-1111-4111-8111-111111111111", ageAttested: true, memoryConsent: true }, { loadAgent });
  const b = await joinRoom(db, { slug: SLUG, authUserId: "22222222-2222-4222-8222-222222222222", ageAttested: true, memoryConsent: true }, { loadAgent });
  const fa = state.followers[0];
  const fb = state.followers[1];

  await bindTelegramChannel(db, { roomId: state.rooms[0].room_id, personId: fa.person_id, followerId: fa.follower_id, channelRef: "chat-panel-a" });

  const statusA = await telegramCheckinsStatus(db, { session: a.session }, { loadAgent });
  ok("A's own panel status reads connected:true", statusA.connected === true && statusA.checkins_enabled === true);

  const statusB = await telegramCheckinsStatus(db, { session: b.session }, { loadAgent });
  ok("B, who never joined via Telegram, reads connected:false", statusB.connected === false);

  // B cannot toggle A's pointer — there is no request shape naming A at all.
  await setTelegramCheckins(db, { session: b.session, enabled: false }, { loadAgent });
  const pointerA = state.channelMap.find((c) => c.channel_ref === "chat-panel-a");
  ok("B's own toggle never touches A's pointer", pointerA.checkins_enabled === true);

  const turnedOff = await setTelegramCheckins(db, { session: a.session, enabled: false }, { loadAgent });
  ok("A's own toggle turns A's pointer off", turnedOff.checkins_enabled === false && pointerA.checkins_enabled === false);
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n── §7: STATIC WIRING ──");
// ═════════════════════════════════════════════════════════════════════════
{
  const checkinsSrc = fs.readFileSync(join(REPO, "api/checkins.js"), "utf8");
  ok('api/checkins.js dispatches op:"telegram_status"', /op === "telegram_status"/.test(checkinsSrc));
  ok('api/checkins.js dispatches op:"telegram_set"', /op === "telegram_set"/.test(checkinsSrc));

  const panelSrc = fs.readFileSync(join(REPO, "src/room/CheckinsPanel.tsx"), "utf8");
  ok("CheckinsPanel.tsx reads telegramCheckinsStatus and calls setTelegramCheckins",
    /telegramCheckinsStatus/.test(panelSrc) && /setTelegramCheckins/.test(panelSrc));

  const copySrc = fs.readFileSync(join(REPO, "src/room/copy.ts"), "utf8");
  ok("copy.ts carries tgTitle in both locales (en then hi)",
    (copySrc.match(/tgTitle:/g) || []).length === 2);
  ok("copy.ts carries tgEnable/tgDisable/tgError in both locales",
    ["tgEnable", "tgDisable", "tgError"].every((k) => (copySrc.match(new RegExp(`${k}:`, "g")) || []).length === 2));

  const migrationSrc = fs.readFileSync(join(REPO, "db/migrations/096_checkin_telegram.sql"), "utf8");
  ok("migration 096 widens the channel CHECK to admit 'telegram'",
    /check \(channel in \('in_app','whatsapp_template','web_push','telegram'\)\)/.test(migrationSrc));
  ok("migration 096 adds checkins_enabled (default true) and stopped_code to vy_room_follower_channel",
    /add column if not exists checkins_enabled boolean not null default true/.test(migrationSrc)
      && /add column if not exists stopped_code text/.test(migrationSrc));

  const schemaSrc = fs.readFileSync(join(REPO, "db/schema.sql"), "utf8");
  ok("db/schema.sql mirrors the widened CHECK",
    schemaSrc.includes("check (channel in ('in_app','whatsapp_template','web_push','telegram'))"));
}

console.log(`\nroom-telegram-checkins: ${pass} ok, ${fail} failed`);
process.exit(fail ? 1 : 0);
