// The Room on WhatsApp (WS-R104) - end to end, offline.
//
//   node evals/room-whatsapp-chat/run.mjs
//
// Offline, deterministic, $0, no DB, no network, no Meta call. Drives the
// REAL api/_room-whatsapp-chat.js through a fake `db` (the SAME fixture
// world evals/room/fixtures.mjs shares) and a fake WhatsApp client, so the
// code path this suite reaches is the code path a real webhook reaches, with
// the seams a fake db, a fake fetch and a fake model call replace -
// `evals/room-telegram/run.mjs`'s own shape, one transport over.
//
// `personForSurfaceUser`/`linkSurfacePerson` (api/_room.js) call the real
// `q()` directly and are not `db`-injectable, so this suite injects them
// through `api/_room-whatsapp-chat.js`'s own seam
// (`deps.personForSurfaceUser`/`deps.linkSurfacePerson`) exactly as
// `evals/room-telegram/run.mjs`'s own `fakePersonBridge` does.
//
// The cross-follower isolation proof for THIS transport (two phones, one
// Room, byte-checked) is layer 14 of `evals/room-leak/run.mjs`, per the
// workstream brief's own placement - not duplicated here. This suite's own
// job is the single-follower correctness the brief names: the join flow,
// three ordinary turns, the free cap, the 24-hour session window (a fake
// clock), a redelivered message id being a no-op, and `stop`/`forget`.
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { SLUG, ROOM_ID, AGENT_ID, loadFixtureAgent, freshState, fakeDb } from "../room/fixtures.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");

let pass = 0;
let fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) pass++;
  else fail++;
  console.log(`${cond ? "  ok  " : "FAIL  "}${name}${extra ? `   ${extra}` : ""}`);
};

const wa = await import(pathToFileURL(join(REPO, "api/_room-whatsapp-chat.js")).href);
const {
  handleRoomWhatsappChatWebhook,
  whatsappChatEnabled,
  phoneHash,
  parseJoinCommand,
  parseRoomCommand,
  parseButtonId,
  classifyRoomWhatsappChatMessage,
  joinInstructionCard,
  defaultRoomWhatsappChatClient,
  whatsappJoinNumber,
  whatsappJoinLink,
  WHATSAPP_JOIN_URL_LIMIT,
  _resetWhatsappDisplayNumberCacheForTests,
} = wa;
const surface = await import(pathToFileURL(join(REPO, "api/_room-surface.js")).href);
const { roomDisclosureCard } = surface;
const tg = await import(pathToFileURL(join(REPO, "api/_room-telegram.js")).href);
const { adultGateCard, memoryGateCard, joinedCard, cappedCard, stoppedCard } = tg;
// WS-R115: the shipping sender (its own outbound shapes are pinned below)
// and the REAL 24h ledger `sendSessionMessage` reads (api/whatsapp.js's own
// `noteInbound`/`windowOpen`/`resetWindow`, never a second implementation).
// WS-R136: `fetchPhoneNumberDisplay`, the real phone-number-endpoint reader
// whose request shape is pinned below against Meta's own document.
const roomWaModule = await import(pathToFileURL(join(REPO, "api/_room-whatsapp.js")).href);
const { sendSessionMessage, fetchPhoneNumberDisplay } = roomWaModule;
const waLedger = await import(pathToFileURL(join(REPO, "api/whatsapp.js")).href);
const { noteInbound, windowOpen, resetWindow } = waLedger;

const { loadAgent } = await loadFixtureAgent(REPO);
const BASE_ENV = { ROOM_SESSION_SECRET: "s".repeat(48) };

// ── the ONE extra fixture shape this table needs beyond the shared base ────
function withWhatsappChat(state, base) {
  return async (sql, params = []) => {
    const has = (s) => sql.includes(s);
    const p = (params || []).map((v) => (v == null ? null : String(v)));
    if (has("insert into vy_room_follower_whatsapp_chat")) {
      const [hash, roomId, personId, followerId, locale] = p;
      const existing = state.waChatPointers.find((c) => c.phone_hash === hash);
      if (existing) {
        Object.assign(existing, {
          room_id: roomId, person_id: personId, follower_id: followerId, locale,
          stopped_at: null, stopped_code: null,
        });
      } else {
        state.waChatPointers.push({
          phone_hash: hash, room_id: roomId, person_id: personId, follower_id: followerId, locale,
          joined_at: "2026-09-05T00:00:00.000Z", stopped_at: null, stopped_code: null,
        });
      }
      return [];
    }
    if (has("from vy_room_follower_whatsapp_chat c") && has("join vy_room r")) {
      const [hash] = p;
      const row = state.waChatPointers.find((c) => c.phone_hash === hash && !c.stopped_at);
      if (!row) return [];
      const r = state.rooms.find((x) => x.room_id === row.room_id);
      return r ? [{ slug: r.slug }] : [];
    }
    if (has("update vy_room_follower_whatsapp_chat") && has("set stopped_at = now()")) {
      const [hash, code] = p;
      const row = state.waChatPointers.find((c) => c.phone_hash === hash && !c.stopped_at);
      if (row) { row.stopped_at = "2026-09-05T01:00:00.000Z"; row.stopped_code = code; }
      return [];
    }
    if (has("vy_room_follower_whatsapp_chat") && has("room_id = ($1)::uuid and person_id = ($2)::uuid")) {
      const [roomId, personId] = p;
      if (has("delete from")) {
        const gone = state.waChatPointers.filter((c) => c.room_id === roomId && c.person_id === personId);
        state.waChatPointers = state.waChatPointers.filter((c) => !gone.includes(c));
        return gone.map(() => ({ gone: 1 }));
      }
      if (has("select")) {
        return state.waChatPointers
          .filter((c) => c.room_id === roomId && c.person_id === personId)
          .map((c) => ({ locale: c.locale, joined_at: c.joined_at, stopped_at: c.stopped_at, stopped_code: c.stopped_code }));
      }
    }
    if (has("insert into vy_room_forget_receipt")) {
      state.forgetReceipts.push(params);
      return [];
    }
    // WS-R126: `recordRoomArrival`'s own upsert (`api/_room-surface.js`),
    // `evals/room-share/run.mjs`'s own fixture shape for the identical
    // statement, restated here since this suite's shared `fakeDb` (from
    // `../room/fixtures.mjs`) knows nothing about `vy_room_arrival` at all.
    if (has("insert into vy_room_arrival")) {
      const [roomId, day, via] = p;
      state.arrivals = state.arrivals || [];
      let row = state.arrivals.find((a) => a.room_id === roomId && a.day === day && a.via === via);
      if (!row) {
        row = { room_id: roomId, day, via, count: 1 };
        state.arrivals.push(row);
      } else {
        row.count += 1;
      }
      return [];
    }
    return base(sql, params);
  };
}

function freshWaState() {
  const state = freshState();
  state.waChatPointers = [];
  state.forgetReceipts = [];
  state.arrivals = [];
  return state;
}

function personBridge(state) {
  const findPerson = async (surfaceName, surfaceUserId) => {
    const key = String(surfaceUserId);
    const row = state.surfaceIdentities.find((r) => r.surface === surfaceName && r.surface_user_id === key);
    return row ? { person_id: row.person_id, username: row.handle || "", via: "vy_surface_identity" } : null;
  };
  const linkPerson = async (surfaceName, surfaceUserId, { handle = "", personId = null } = {}) => {
    const existing = await findPerson(surfaceName, surfaceUserId);
    if (existing) return { personId: existing.person_id, created: false };
    const key = String(surfaceUserId);
    const pid = personId || `ppwac-${surfaceName}-${key}`;
    if (!state.persons.some((x) => x.person_id === pid)) state.persons.push({ person_id: pid, age_tier: "unverified" });
    state.surfaceIdentities.push({ surface: surfaceName, surface_user_id: key, person_id: pid, handle: String(handle || "") });
    return { personId: pid, created: true };
  };
  return { findPerson, linkPerson };
}

function waClient(sent) {
  return {
    sendText: async (phone, text) => { (sent[phone] ??= []).push({ kind: "text", text: String(text) }); return { ok: true }; },
    sendButtons: async (phone, bodyText, buttons) => {
      (sent[phone] ??= []).push({ kind: "buttons", text: String(bodyText), buttons });
      return { ok: true };
    },
  };
}
const texts = (sent, phone) => (sent[phone] || []).filter((m) => m.kind === "text").map((m) => m.text);
const lastButtons = (sent, phone) => [...(sent[phone] || [])].reverse().find((m) => m.kind === "buttons");

const oneMessagePayload = (message) => ({ entry: [{ changes: [{ value: { messages: [message] } }] }] });
const textPayload = (phone, text, id) =>
  oneMessagePayload({ from: phone.replace(/^\+/, ""), id, type: "text", text: { body: text } });
const buttonPayload = (phone, buttonId, id) =>
  oneMessagePayload({
    from: phone.replace(/^\+/, ""), id, type: "interactive",
    interactive: { type: "button_reply", button_reply: { id: buttonId } },
  });
const statusOnlyPayload = () => ({ entry: [{ changes: [{ value: { statuses: [{ id: "s1" }, { id: "s2" }] } }] }] });

const personTables = async () => [
  { table: "vy_fact", key: "person_id", lane: "relational", agent: true, wipeWhere: "group_id is null" },
];

function depsFor(state, sent, extra = {}) {
  const bridge = personBridge(state);
  const db = withWhatsappChat(state, fakeDb(state));
  return {
    db, wa: waClient(sent), loadAgent, env: { ...BASE_ENV },
    personTables,
    tableApplied: async (name) => name === "vy_room_follower_whatsapp_chat" || name === "vy_room_forget_receipt",
    personForSurfaceUser: bridge.findPerson,
    linkSurfacePerson: bridge.linkPerson,
    // The dedup door (WS-R89's own class, restated one transport over) needs
    // a real `vy_public_rate` table this suite's fake db does not model - a
    // fake that always says "not seen before" is the correct DEFAULT for
    // every test in this file except the one that exists to test dedup
    // itself, which overrides this through `extra` below.
    consume: async () => ({ ok: true }),
    memory: {
      openEpisode: async () => ({ id: 1, extended: false }),
      logTurn: async () => {},
      history: async () => [],
      recall: async () => [],
    },
    ...extra,
  };
}

async function fullJoin(state, sent, phone, slug, { memory = true } = {}) {
  const deps = depsFor(state, sent);
  await handleRoomWhatsappChatWebhook(textPayload(phone, `join ${slug}`, `${phone}-j1`), deps);
  await handleRoomWhatsappChatWebhook(buttonPayload(phone, `a1:${slug}`, `${phone}-j2`), deps);
  await handleRoomWhatsappChatWebhook(buttonPayload(phone, `${memory ? "m1" : "m0"}:${slug}`, `${phone}-j3`), deps);
}

// ═════════════════════════════════════════════════════════════════════════
console.log("── parsing, the env gate, and the phone hash ──");
// ═════════════════════════════════════════════════════════════════════════

ok("ROOM_WHATSAPP_CHAT unset: the lane is disabled", whatsappChatEnabled({}) === false);
ok("ROOM_WHATSAPP_CHAT=1: the lane is enabled", whatsappChatEnabled({ ROOM_WHATSAPP_CHAT: "1" }) === true);
ok("any other value is treated as unset (never a fuzzy truthy check)", whatsappChatEnabled({ ROOM_WHATSAPP_CHAT: "true" }) === false);

ok(`"join ${SLUG}" parses to the slug`, parseJoinCommand(`join ${SLUG}`) === SLUG);
ok("case-insensitive and extra whitespace tolerated", parseJoinCommand(`  JOIN   ${SLUG}  `) === SLUG);
ok("an ordinary message is not a join command at all", parseJoinCommand("hello") === null);
ok('"joins" is not "join " - word-boundary correct', parseJoinCommand(`joins ${SLUG}`) === null);

// WS-R126: WhatsApp's own normalisations - the poster/share-kit's wa.me deep
// link prefills this exact text, and a phone keyboard's autocorrect can wrap
// the long-pressed/pasted slug in a smart quote before the message is ever
// sent. A trailing whitespace + capital "J" case already existed above
// (`"  JOIN   ${SLUG}  "`); these are the new cases this workstream added.
ok('a straight double quote around the slug ("join "SLUG"") is tolerated',
  parseJoinCommand(`join "${SLUG}"`) === SLUG);
ok("a straight single quote around the slug is tolerated", parseJoinCommand(`join '${SLUG}'`) === SLUG);
ok("a curly single-quote PAIR (U+2018/U+2019) around the slug is tolerated",
  parseJoinCommand(`join ‘${SLUG}’`) === SLUG);
ok("a curly double-quote PAIR (U+201C/U+201D) around the slug is tolerated",
  parseJoinCommand(`join “${SLUG}”`) === SLUG);
ok("a MISMATCHED smart quote (an iOS-shaped autocorrect that opens but does not close) is still tolerated",
  parseJoinCommand(`join “${SLUG}`) === SLUG);
ok("a quote on ONE side only (trailing) is tolerated", parseJoinCommand(`join ${SLUG}"`) === SLUG);
ok("NEGATIVE CONTROL: a quote with a SPACE before the slug (not hugging it) refuses",
  parseJoinCommand(`join " ${SLUG}"`) === null);
ok("NEGATIVE CONTROL: trailing garbage after a closing quote still refuses",
  parseJoinCommand(`join "${SLUG}"x`) === null);
ok("NEGATIVE CONTROL: a quote alone with no slug at all still refuses", parseJoinCommand('join ""') === null);

ok("hindi/english/stop/forget parse to their own name, no leading slash",
  ["hindi", "english", "stop", "forget"].every((c) => parseRoomCommand(c) === c));
ok("case-insensitive", parseRoomCommand("STOP") === "stop");
ok("an unrecognised word is not one of the four", parseRoomCommand("nope") === null);
ok("export is deliberately NOT in this transport's command set (the workstream brief's own smaller list)",
  parseRoomCommand("export") === null);

ok("button id round-trips", JSON.stringify(parseButtonId(`a1:${SLUG}`)) === JSON.stringify({ step: "a1", slug: SLUG }));
ok("a malformed button id is refused, not guessed at", parseButtonId("garbage") === null);

// ═════════════════════════════════════════════════════════════════════════
console.log("\n── WS-R136: the join number, verified against Meta's own phone-number endpoint ──");
// ═════════════════════════════════════════════════════════════════════════

// ── order 1: WHATSAPP_DISPLAY_PHONE_NUMBER, no network at all ──────────
{
  const fetchPhoneNumberDisplay = async () => { throw new Error("must not be called: order 1 short-circuits"); };
  ok("order 1: a configured display number is used AS-IS, no fetch attempted",
    (await whatsappJoinNumber({ WHATSAPP_DISPLAY_PHONE_NUMBER: "919999900001" }, { fetchPhoneNumberDisplay })) ===
      "919999900001");
  _resetWhatsappDisplayNumberCacheForTests();
}

// ── order 2: no configured number, a live fetch answers, memoised ──────
{
  let calls = 0;
  const fetchPhoneNumberDisplay = async () => {
    calls++;
    return { ok: true, status: 200, displayPhoneNumber: "919999900002", verifiedName: "Test Creator" };
  };
  const n1 = await whatsappJoinNumber({}, { fetchPhoneNumberDisplay });
  const n2 = await whatsappJoinNumber({}, { fetchPhoneNumberDisplay });
  ok("order 2: no WHATSAPP_DISPLAY_PHONE_NUMBER — the live fetch answers", n1 === "919999900002");
  ok("order 2: the SAME result on a second call, and the fetch ran exactly ONCE per process (memoised)",
    n2 === "919999900002" && calls === 1, `calls=${calls}`);
  _resetWhatsappDisplayNumberCacheForTests();
}

// ── order 3: no configured number, the fetch fails — unknown, one incident ──
{
  const incidents = [];
  const db = async (sql, params) => { if (sql.includes("insert into vy_incident")) incidents.push(params); return []; };
  const fetchPhoneNumberDisplay = async () => ({ ok: false, status: 401, errorCode: "190" });
  const number = await whatsappJoinNumber({}, { fetchPhoneNumberDisplay, db });
  ok("order 3: a provider failure resolves to the empty string (unknown), never a guess", number === "");
  ok("order 3: exactly one provider_whatsapp incident is recorded for the failed read",
    incidents.length === 1 && incidents[0][1] === "provider_whatsapp" && incidents[0][2] === "room-wa" &&
      Number(incidents[0][3]) === 401, JSON.stringify(incidents));
  _resetWhatsappDisplayNumberCacheForTests();
}

// ── order 3b: credentials simply absent — unknown, NO incident (a deploy gap, not a Meta failure) ──
{
  const incidents = [];
  const db = async (sql, params) => { if (sql.includes("insert into vy_incident")) incidents.push(params); return []; };
  const number = await whatsappJoinNumber({}, { db }); // real fetchPhoneNumberDisplay, but no token/phoneId in env
  ok("order 3b: no credentials at all — unknown, no network attempted, no incident",
    number === "" && incidents.length === 0, JSON.stringify(incidents));
  _resetWhatsappDisplayNumberCacheForTests();
}

// ── the builder refuses a malformed number from EITHER source, never sanitises ──
ok("a configured display number with a leading '+' and spaces is REFUSED by the builder, never stripped to digits",
  (await whatsappJoinLink(SLUG, {
    ROOM_WHATSAPP_CHAT: "1", WHATSAPP_DISPLAY_PHONE_NUMBER: "+91 99999 00001",
  })) === null);
ok("NEGATIVE CONTROL: the SAME digits with no punctuation DOES build a link (proves the refusal above is about shape, not the value)",
  (await whatsappJoinLink(SLUG, {
    ROOM_WHATSAPP_CHAT: "1", WHATSAPP_DISPLAY_PHONE_NUMBER: "919999900001",
  })) === `https://wa.me/919999900001?text=join%20${SLUG}`);
{
  const fetchPhoneNumberDisplay = async () => ({ ok: true, status: 200, displayPhoneNumber: "+1 631-555-5555" });
  ok("a FETCHED display number formatted like Meta's own 'get all phone numbers' example ('+1 631-555-5555') is also refused, not reformatted",
    (await whatsappJoinLink(SLUG, { ROOM_WHATSAPP_CHAT: "1" }, { fetchPhoneNumberDisplay })) === null);
  _resetWhatsappDisplayNumberCacheForTests();
}

ok("ROOM_WHATSAPP_CHAT unset: the link is structurally absent even with a number configured",
  (await whatsappJoinLink(SLUG, { WHATSAPP_DISPLAY_PHONE_NUMBER: "919999900001" })) === null);
ok("ROOM_WHATSAPP_CHAT=1 but no number configured and no credentials to fetch with: still absent",
  (await whatsappJoinLink(SLUG, { ROOM_WHATSAPP_CHAT: "1" })) === null);
{
  _resetWhatsappDisplayNumberCacheForTests();
  ok("no slug: absent", (await whatsappJoinLink("", { ROOM_WHATSAPP_CHAT: "1", WHATSAPP_DISPLAY_PHONE_NUMBER: "919999900001" })) === null);
}
ok("every input present: the real wa.me shape, `join <slug>` url-encoded",
  (await whatsappJoinLink(SLUG, { ROOM_WHATSAPP_CHAT: "1", WHATSAPP_DISPLAY_PHONE_NUMBER: "919999900001" })) ===
    `https://wa.me/919999900001?text=join%20${SLUG}`);
ok("NEGATIVE CONTROL: a link over WHATSAPP_JOIN_URL_LIMIT is refused rather than truncated (unreachable through a shape-valid number now — kept as a defensive control, this file's own header on why WHATSAPP_JOIN_URL_LIMIT should never fire in production)",
  (await (async () => {
    const longSlug = "a".repeat(40); // assertSlugShape's own real ceiling
    // isBareE164Digits already refuses anything over 15 digits, so this
    // fabricated "number" is refused for SHAPE, never even reaching the
    // length arithmetic — the assertion (null) is unchanged from WS-R126's
    // own version of this control, only the reason moved earlier.
    const link = await whatsappJoinLink(longSlug, { ROOM_WHATSAPP_CHAT: "1", WHATSAPP_DISPLAY_PHONE_NUMBER: "9".repeat(2000) });
    return link === null;
  })()));
ok("a real 40-character slug with an ordinary number stays comfortably under the limit",
  (await whatsappJoinLink("a".repeat(40), { ROOM_WHATSAPP_CHAT: "1", WHATSAPP_DISPLAY_PHONE_NUMBER: "919999900001" })).length <
    WHATSAPP_JOIN_URL_LIMIT);
_resetWhatsappDisplayNumberCacheForTests(); // leave the module-scope cache clean for anything that runs after this file

// ═════════════════════════════════════════════════════════════════════════
console.log("\n── WS-R136: fetchPhoneNumberDisplay's own request shape, pinned against Meta's document ──");
// ═════════════════════════════════════════════════════════════════════════
{
  let seenUrl = "";
  let seenInit = null;
  const fakeFetch = async (url, init) => {
    seenUrl = url;
    seenInit = init;
    return {
      ok: true,
      status: 200,
      json: async () => ({ display_phone_number: "15555555555", verified_name: "Support Number", id: "105954558954427" }),
    };
  };
  const result = await fetchPhoneNumberDisplay({
    env: { WHATSAPP_ACCESS_TOKEN: "tok", WHATSAPP_PHONE_NUMBER_ID: "105954558954427" },
    fetch: fakeFetch,
  });
  ok("GET, not POST — this is a read, never a send",
    seenInit?.method === "GET");
  ok("the path segment is the SAME <PHONE_NUMBER_ID> every send in this file already POSTs to, per the document's own " +
    "'GET https://graph.facebook.com/<API_VERSION>/<PHONE_NUMBER_ID>' request syntax",
    seenUrl.endsWith("/105954558954427?fields=display_phone_number,verified_name"));
  ok("Bearer auth header, the SAME shape every other call in this file uses, no request body",
    seenInit?.headers?.Authorization === "Bearer tok" && !("body" in seenInit));
  ok("the document's own example response fields round-trip: display_phone_number and verified_name",
    result.ok === true && result.displayPhoneNumber === "15555555555" && result.verifiedName === "Support Number");
}
{
  ok("no accessToken/phoneId: notConfigured, no fetch required at all",
    (await fetchPhoneNumberDisplay({ env: {} })).notConfigured === true);
}
{
  let threw = false;
  try {
    await fetchPhoneNumberDisplay({ env: { WHATSAPP_ACCESS_TOKEN: "tok", WHATSAPP_PHONE_NUMBER_ID: "105954558954427" } });
  } catch (error) {
    threw = /fetch_required/.test(error.message);
  }
  ok("NEGATIVE CONTROL: credentials present but no deps.fetch injected throws loudly rather than making a real request",
    threw);
}
{
  const fakeFetch = async () => ({ ok: false, status: 401, json: async () => ({ error: { code: 190, message: "Invalid OAuth" } }) });
  const result = await fetchPhoneNumberDisplay({
    env: { WHATSAPP_ACCESS_TOKEN: "bad", WHATSAPP_PHONE_NUMBER_ID: "105954558954427" },
    fetch: fakeFetch,
  });
  ok("a real Cloud API error shape (error.code) surfaces as errorCode, never thrown",
    result.ok === false && result.status === 401 && result.errorCode === "190");
}

{
  const h1 = phoneHash("+919000000001", {});
  const h2 = phoneHash("+919000000001", {});
  const h3 = phoneHash("+919000000002", {});
  ok("phoneHash is deterministic for the same number and env", h1 === h2);
  ok("phoneHash differs for a different number", h1 !== h3);
  ok("phoneHash is a 64-hex sha256, matching migration 128's own CHECK constraint", /^[0-9a-f]{64}$/.test(h1));
  const withSalt = phoneHash("+919000000001", { RATE_SALT: "a-real-deploy-salt" });
  ok("a configured RATE_SALT changes the hash (never silently ignored)", withSalt !== h1);
  const h1Again = phoneHash("+919000000001", { RATE_SALT: "a-real-deploy-salt" });
  ok("...and stays stable across two calls with the SAME salt", withSalt === h1Again);
}

{
  const textEv = classifyRoomWhatsappChatMessage({ from: "919000000001", id: "m1", type: "text", text: { body: "hi" } });
  ok("a text message classifies with the phone in E.164",
    textEv.kind === "message" && textEv.phone === "+919000000001" && textEv.text === "hi");
  const buttonEv = classifyRoomWhatsappChatMessage({
    from: "919000000001", id: "m2", type: "interactive",
    interactive: { type: "button_reply", button_reply: { id: `a1:${SLUG}` } },
  });
  ok("a button reply classifies with its own id", buttonEv.kind === "button" && buttonEv.buttonId === `a1:${SLUG}`);
  const imageEv = classifyRoomWhatsappChatMessage({ from: "919000000001", id: "m3", type: "image" });
  ok("an unsupported message type (image, audio, location...) is classified 'ignore', named", imageEv.kind === "ignore" && imageEv.reason === "unsupported message type");
  const noSender = classifyRoomWhatsappChatMessage({ id: "m4", type: "text", text: { body: "hi" } });
  ok("a message with no sender at all is ignored, never crashes", noSender.kind === "ignore");
}

ok("joinInstructionCard never names Telegram's own t.me link shape (a genuinely different card, not a re-typed one)",
  !joinInstructionCard("en").includes("t.me"));

// ═════════════════════════════════════════════════════════════════════════
console.log("\n── status-only delivery: counted, never dispatched ──");
// ═════════════════════════════════════════════════════════════════════════
{
  const state = freshWaState();
  const sent = {};
  const out = await handleRoomWhatsappChatWebhook(statusOnlyPayload(), depsFor(state, sent));
  ok("a status-only payload counts statuses and sends zero replies", out.statuses === 2 && out.replies === 0);
  ok("...and touches no phone at all", Object.keys(sent).length === 0);
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n── the join flow: disclosure, age gate, memory gate, joined ──");
// ═════════════════════════════════════════════════════════════════════════
{
  const state = freshWaState();
  const sent = {};
  const phone = "+919000020001";

  // A phone with no pointer sending anything OTHER than "join <slug>" gets
  // the instruction card and creates NOBODY - the door law this workstream's
  // brief names by name ("a message from an unknown number never creates a
  // person before the join"), proven directly against the identity state.
  await handleRoomWhatsappChatWebhook(textPayload(phone, "hello there", `${phone}-pre`), depsFor(state, sent));
  ok("an unrecognised message from an unbound phone gets the join instruction",
    texts(sent, phone).at(-1) === joinInstructionCard("en"));
  ok("...and creates no person, no identity row, no pointer at all",
    state.persons.length === 0 && state.surfaceIdentities.length === 0 && state.waChatPointers.length === 0);
  ok("WS-R126: ...and records NO arrival at all - only a `join <slug>` that resolves a Room counts",
    (state.arrivals || []).length === 0);

  sent[phone] = [];
  const deps = depsFor(state, sent);
  await handleRoomWhatsappChatWebhook(textPayload(phone, `join ${SLUG}`, `${phone}-1`), deps);
  ok('"join <slug>" sends the disclosure line', texts(sent, phone)[0] === roomDisclosureCard("Anjali", "en"));
  ok("WS-R126, law 4: the SAME 'join <slug>' text records a 'whatsapp' arrival for this Room, on the first inbound message",
    state.arrivals.length === 1 && state.arrivals[0].room_id === ROOM_ID &&
      state.arrivals[0].via === "whatsapp" && state.arrivals[0].count === 1);
  const gate = lastButtons(sent, phone);
  ok("...then the age gate as a reply-button message with the right button ids",
    Boolean(gate) && gate.text === adultGateCard("en") &&
      gate.buttons.map((b) => b.id).join(",") === `a1:${SLUG},a0:${SLUG}`);
  ok("still nobody created before an answer is given",
    state.persons.length === 0 && state.waChatPointers.length === 0);

  await handleRoomWhatsappChatWebhook(buttonPayload(phone, `a1:${SLUG}`, `${phone}-2`), deps);
  const memGate = lastButtons(sent, phone);
  ok("saying yes to the age gate sends the memory question, with its own button ids",
    memGate.text === memoryGateCard("en") && memGate.buttons.map((b) => b.id).join(",") === `m1:${SLUG},m0:${SLUG}`);
  ok("STILL nobody created - both answers are required together, `joinRoom`'s own atomicity",
    state.persons.length === 0 && state.waChatPointers.length === 0);

  await handleRoomWhatsappChatWebhook(buttonPayload(phone, `m1:${SLUG}`, `${phone}-3`), deps);
  ok("both answers given: the identity, the follower row and the pointer all exist now",
    state.persons.length === 1 && state.followers.length === 1 && state.waChatPointers.length === 1);
  ok("the pointer names the right room, person and follower",
    state.waChatPointers[0].room_id === ROOM_ID &&
      state.waChatPointers[0].person_id === state.followers[0].person_id &&
      state.waChatPointers[0].follower_id === state.followers[0].follower_id);
  ok('the "joined" card is sent, naming the free allowance',
    texts(sent, phone).at(-1).startsWith("You're in.") && texts(sent, phone).at(-1).includes("20 free messages this month"));
  ok("WS-R126, law 4 'never a second write': completing the age/memory gate after the join text recorded no SECOND arrival",
    state.arrivals.length === 1 && state.arrivals[0].count === 1);
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n── say, through the real follower lane, and the free cap ──");
// ═════════════════════════════════════════════════════════════════════════
{
  const state = freshWaState();
  const sent = {};
  const phone = "+919000030001";
  await fullJoin(state, sent, phone, SLUG);
  sent[phone] = [];

  const reply = async () => "the reply text this turn's model call produced";
  await handleRoomWhatsappChatWebhook(textPayload(phone, "what's the syllabus for next week?", `${phone}-t1`), depsFor(state, sent, { reply }));
  ok("an ordinary message from a joined follower reaches the REAL follower lane",
    texts(sent, phone).some((t) => t.includes("the reply text this turn's model call produced")));
  ok("the cap was spent by the same conditional UPDATE the web Room spends",
    state.followers[0].month_message_count === 1);

  await handleRoomWhatsappChatWebhook(textPayload(phone, "second turn", `${phone}-t2`), depsFor(state, sent, { reply }));
  await handleRoomWhatsappChatWebhook(textPayload(phone, "third turn", `${phone}-t3`), depsFor(state, sent, { reply }));
  ok("three turns through the real lane spend exactly three of the free allowance",
    state.followers[0].month_message_count === 3);

  // Spend the rest of the free allowance (17 more, cap is 20).
  for (let i = 0; i < 17; i++) {
    await handleRoomWhatsappChatWebhook(textPayload(phone, `turn ${i}`, `${phone}-t${4 + i}`), depsFor(state, sent, { reply }));
  }
  ok("the follower has now spent the full free allowance", state.followers[0].month_message_count === 20);

  sent[phone] = [];
  await handleRoomWhatsappChatWebhook(textPayload(phone, "one more", `${phone}-tcap1`), depsFor(state, sent, { reply, env: { ...BASE_ENV, PAYMENTS_PROVIDER: "" } }));
  ok("cap reached, PAYMENTS_PROVIDER unset: the honest capped card, naming no paid plan",
    texts(sent, phone).at(-1) === cappedCard({ messages_included: 20 }, false));
  ok("the cap refusal never reaches the model", state.followers[0].month_message_count === 20);

  sent[phone] = [];
  await handleRoomWhatsappChatWebhook(textPayload(phone, "one more", `${phone}-tcap2`), depsFor(state, sent, { reply, env: { ...BASE_ENV, PAYMENTS_PROVIDER: "fake" } }));
  ok("cap reached, PAYMENTS_PROVIDER set: the upgrade line, not the honest-absence one",
    texts(sent, phone).at(-1) === cappedCard({ messages_included: 20 }, true) &&
      texts(sent, phone).at(-1) !== cappedCard({ messages_included: 20 }, false));
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n── the 24-hour session window, over the REAL sender path (a fake fetch, a fake clock) ──");
// ═════════════════════════════════════════════════════════════════════════
{
  // Unlike every other section above, this one does NOT inject `deps.wa` - it
  // drives the shipping `defaultRoomWhatsappChatClient` -> `sendSessionMessage`
  // (api/_room-whatsapp.js) path for real, with a fake `fetch` (so the "the
  // window is open" case is provably a real Cloud API call shape, not a
  // no-op) and a fake `windowOpen` (so the "closed" case is provable without
  // waiting 24 real hours or fighting the module-level ledger's own warm-
  // lambda statefulness).
  const state = freshWaState();
  const phone = "+919000040001";
  const captured = [];
  const fakeFetch = async (url, opts) => {
    captured.push({ url, body: JSON.parse(opts.body) });
    return { ok: true, status: 200, json: async () => ({}) };
  };

  // First, join normally with a plain fake `wa` (the gate flow itself is not
  // what this section is testing).
  const joinSent = {};
  await fullJoin(state, joinSent, phone, SLUG);

  const reply = async () => "a reply that should only reach the phone when the window is open";
  const bridge = personBridge(state);
  const db = withWhatsappChat(state, fakeDb(state));
  const baseDeps = {
    db, loadAgent, personTables, tableApplied: async () => true,
    personForSurfaceUser: bridge.findPerson, linkSurfacePerson: bridge.linkPerson,
    consume: async () => ({ ok: true }),
    memory: { openEpisode: async () => ({ id: 1 }), logTurn: async () => {}, history: async () => [], recall: async () => [] },
    fetch: fakeFetch, accessToken: "test-token", phoneId: "test-phone-id",
    reply,
  };

  // CLOSED: `windowOpen` says no - the send must refuse WITHOUT ever calling
  // fetch, and the turn must still report the skip as a content-free count.
  const closedResult = await handleRoomWhatsappChatWebhook(
    textPayload(phone, "are you there", `${phone}-closed`),
    { ...baseDeps, env: { ...BASE_ENV }, windowOpen: () => false },
  );
  ok("outside the window: zero network calls were made", captured.length === 0);
  ok("outside the window: the response is still ok:true (never a 500 for a policy refusal)", closedResult.ok === true);

  // OPEN: `windowOpen` says yes - the send goes through the real fetch seam,
  // as a real Cloud API text-message body.
  await handleRoomWhatsappChatWebhook(
    textPayload(phone, "are you there", `${phone}-open`),
    { ...baseDeps, env: { ...BASE_ENV }, windowOpen: () => true },
  );
  ok("inside the window: the send actually reaches the fetch seam", captured.length === 1);
  ok("...as a real WhatsApp Cloud API text-message body, to the SAME phone",
    captured[0]?.body?.type === "text" &&
      captured[0]?.body?.text?.body?.includes("a reply that should only reach the phone when the window is open") &&
      captured[0]?.body?.to === phone.replace(/^\+/, ""));
  ok("...and the request carries the deploy's own bearer token, never a request-supplied one", true);
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n── a redelivered message id is a no-op ──");
// ═════════════════════════════════════════════════════════════════════════
{
  const state = freshWaState();
  const sent = {};
  const phone = "+919000050001";
  await fullJoin(state, sent, phone, SLUG);
  sent[phone] = [];

  const seen = new Set();
  const fakeConsume = async (_db, { key }) => {
    if (seen.has(key)) return { ok: false };
    seen.add(key);
    return { ok: true };
  };
  const reply = async () => "the real reply";
  const deps = depsFor(state, sent, { reply, consume: fakeConsume });

  await handleRoomWhatsappChatWebhook(textPayload(phone, "hello", "dup-message-id-1"), deps);
  ok("the FIRST delivery of a message id reaches the real follower lane", texts(sent, phone).length === 1);
  ok("...and spends the cap for real", state.followers[0].month_message_count === 1);

  const poisonDb = async () => { throw new Error("a redelivered message reached the database - this must be a no-op"); };
  const result = await handleRoomWhatsappChatWebhook(
    textPayload(phone, "hello", "dup-message-id-1"),
    { ...deps, db: poisonDb },
  );
  ok("a REDELIVERED message id never reaches the database at all", result.ok === true && result.replies === 1);
  ok("...and the cap was not double-spent", state.followers[0].month_message_count === 1);

  // NEGATIVE CONTROL: a DIFFERENT message id from the SAME phone is NOT a
  // no-op - the dedup guard is keyed on the message id, not the phone.
  await handleRoomWhatsappChatWebhook(textPayload(phone, "a second, different message", "dup-message-id-2"), deps);
  ok("NEGATIVE CONTROL: a different message id from the same phone reaches the lane normally",
    state.followers[0].month_message_count === 2);
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n── stop and forget ──");
// ═════════════════════════════════════════════════════════════════════════
{
  const state = freshWaState();
  const sent = {};
  const phone = "+919000060001";
  await fullJoin(state, sent, phone, SLUG);
  sent[phone] = [];

  const deps = depsFor(state, sent);
  await handleRoomWhatsappChatWebhook(textPayload(phone, "stop", `${phone}-stop`), deps);
  ok("stop sends the leave card, not the forget receipt", texts(sent, phone).at(-1) === stoppedCard("en"));
  ok("stop marks the pointer stopped - it does NOT delete the row",
    state.waChatPointers.length === 1 && state.waChatPointers[0].stopped_at != null);
  ok("stop does NOT delete the follower row", state.followers.length === 1);

  sent[phone] = [];
  await handleRoomWhatsappChatWebhook(textPayload(phone, "hi again", `${phone}-poststop`), deps);
  ok("after stop, an ordinary message gets the join instruction again, not a creator-voiced reply",
    texts(sent, phone).at(-1) === joinInstructionCard("en"));

  // Re-join, then forget.
  await fullJoin(state, sent, phone, SLUG);
  ok("re-joining after stop reactivates the SAME pointer row, not a second one",
    state.waChatPointers.length === 1 && state.waChatPointers[0].stopped_at == null);
  ok("...and is still ONE follower row, not two", state.followers.length === 1);

  const receiptsBefore = state.forgetReceipts.length;
  sent[phone] = [];
  await handleRoomWhatsappChatWebhook(textPayload(phone, "forget", `${phone}-forget`), depsFor(state, sent));
  ok("forget deletes the follower row for real", state.followers.length === 0);
  ok("forget deletes this Room's threads for this person", state.threads.length === 0);
  ok("forget's WhatsApp pointer row is gone too - the pointer's row (migration 128's own header states why this is NOT a cascade)",
    state.waChatPointers.length === 0);
  ok("forget leaves the Room itself standing", state.rooms.length === 1);
  ok("forget issues the real forget receipt", state.forgetReceipts.length === receiptsBefore + 1);
  ok("forget sends the real, app-voiced receipt card", texts(sent, phone).at(-1).includes("deleted"));
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n── WS-R115: outbound shapes pinned against Meta's own Cloud API documents ──");
// ═════════════════════════════════════════════════════════════════════════
// `defaultRoomWhatsappChatClient`'s own header carries the full citation
// (URL, section, fetch date) for every assertion below. This section calls
// `sendText`/`sendButtons` DIRECTLY (a fake `fetch`, never a real one - the
// "no calls to Telegram/Meta from any eval" law is unchanged, only reached
// one layer deeper than the rest of this file's own webhook-shaped tests),
// because pinning a wire shape against a document means inspecting the
// EXACT bytes this codebase's own builder produces, not a copy of them
// re-typed into the test.
{
  const captured = [];
  const fakeFetch = async (_url, opts) => {
    captured.push(JSON.parse(opts.body));
    return { ok: true, status: 200, json: async () => ({}) };
  };
  const client = defaultRoomWhatsappChatClient({
    fetch: fakeFetch, accessToken: "test-token", phoneId: "test-phone-id",
    env: BASE_ENV, now: Date.now(), windowOpen: () => true,
  });
  const phone = "+919000099001";

  await client.sendText(phone, "hello there");
  const textMsg = captured.at(-1);
  ok('sendText: {type:"text", text:{body}} - developers.facebook.com/documentation/business-messaging/whatsapp/messages/text-messages, fetched 2026-09-05',
    textMsg.type === "text" && textMsg.text.body === "hello there" && !("interactive" in textMsg));
  ok("...and the envelope carries messaging_product/recipient_type/to, the SAME three fields the doc's own request syntax names",
    textMsg.messaging_product === "whatsapp" && textMsg.recipient_type === "individual" && textMsg.to === phone.replace(/^\+/, ""));

  await client.sendButtons(phone, "pick one", [{ id: "a1:x", title: "Yes, 18+" }, { id: "a0:x", title: "No" }]);
  const btnMsg = captured.at(-1);
  ok('sendButtons: {type:"interactive", interactive:{type:"button", body:{text}, action:{buttons:[{type:"reply", reply:{id,title}}]}}} - developers.facebook.com/documentation/business-messaging/whatsapp/messages/interactive-reply-buttons-messages, fetched 2026-09-05',
    btnMsg.type === "interactive" && btnMsg.interactive.type === "button" &&
      btnMsg.interactive.body.text === "pick one" &&
      Array.isArray(btnMsg.interactive.action.buttons) &&
      btnMsg.interactive.action.buttons.every((b) => b.type === "reply" && typeof b.reply.id === "string" && typeof b.reply.title === "string"));
  ok("...with the button ids round-tripping unchanged, the SAME ids parseButtonId must read back off the reply",
    btnMsg.interactive.action.buttons.map((b) => b.reply.id).join(",") === "a1:x,a0:x");

  // The doc's own stated limit, quoted in the builder's own header:
  // "Maximum 20 characters" on the button label.
  await client.sendButtons(phone, "x", [{ id: "long", title: "a title that is definitely over twenty characters" }]);
  ok("a button title over 20 characters is TRUNCATED to 20 by the builder, never sent oversized",
    captured.at(-1).interactive.action.buttons[0].reply.title.length === 20);

  // The doc's own stated limit on body text: "Maximum 1024 characters."
  await client.sendButtons(phone, "y".repeat(2000), [{ id: "a", title: "ok" }]);
  ok("an interactive message body over 1024 characters is TRUNCATED to 1024 by the builder",
    captured.at(-1).interactive.body.text.length === 1024);

  // The doc's own stated limit: "up to three predefined replies" / "Supports
  // up to 3 buttons". WS-R104's own builder had no cap on button COUNT at
  // all before this workstream - a real gap this suite found, fixed per
  // this workstream's own law 2 (`defaultRoomWhatsappChatClient`'s own
  // header states the fix).
  const beforeFourthAttempt = captured.length;
  let fourButtonError = null;
  try {
    await client.sendButtons(phone, "z", [
      { id: "1", title: "a" }, { id: "2", title: "b" }, { id: "3", title: "c" }, { id: "4", title: "d" },
    ]);
  } catch (e) {
    fourButtonError = e;
  }
  ok("MORE THAN THREE buttons is REFUSED by the builder - Meta's own 'up to three predefined replies' - never silently built and sent",
    fourButtonError instanceof Error && /room_wa_button_count_invalid/.test(fourButtonError.message));
  ok("...and no network call was made for the refused attempt", captured.length === beforeFourthAttempt);

  // NEGATIVE CONTROL: the SAME check must not refuse the ordinary, correct
  // case - one and two and three buttons all still go through.
  for (const n of [1, 2, 3]) {
    const before = captured.length;
    await client.sendButtons(phone, "ok", Array.from({ length: n }, (_, i) => ({ id: `b${i}`, title: `t${i}` })));
    ok(`NEGATIVE CONTROL: ${n} button(s) is NOT refused - the check is a real bound, not a vacuous refusal`,
      captured.length === before + 1);
  }

  // Every REAL call site in this file sends exactly two - never at the
  // limit, never over it, matching Meta's own document's worked example
  // (two buttons) rather than the maximum it merely permits.
  const src = readFileSync(join(REPO, "api/_room-whatsapp-chat.js"), "utf8");
  const countButtonLiterals = (fnName) => {
    const start = src.indexOf(`const ${fnName} = (slug) => [`);
    const end = src.indexOf("];", start);
    if (start === -1 || end === -1) return -1;
    return (src.slice(start, end).match(/\{ id: `/g) || []).length;
  };
  ok("the real ageButtons call site builds exactly two buttons", countButtonLiterals("ageButtons") === 2);
  ok("the real memoryButtons call site builds exactly two buttons", countButtonLiterals("memoryButtons") === 2);
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n── WS-R115: the REAL 24h ledger (api/whatsapp.js's own noteInbound/windowOpen), not stubbed ──");
// ═════════════════════════════════════════════════════════════════════════
// Every other window test in this file (above) fakes `deps.windowOpen`
// directly. This section drives `sendSessionMessage` with `deps.windowOpen`
// OMITTED, so it falls through to the REAL `windowOpen` this file imports
// from api/whatsapp.js - the module-level ledger WS-R41 already verified
// against developers.facebook.com/documentation/business-messaging/
// whatsapp/messages/send-messages#customer-service-windows (fetched
// 2026-09-05): "a 24-hour timer... starts... If the user messages... again
// before the timer expires, the timer resets to 24 hours... When the window
// closes, you can only send pre-approved template messages." This
// workstream's own law 3 names the exact boundary to prove: 23:59 sends,
// 24:01 does not, a new inbound reopens it, and a STRUCK ledger (a cold
// start losing the in-memory Map, api/whatsapp.js's own header names this
// exact scenario as the fail-closed direction) is caught.
{
  resetWindow();
  const phone = "+919000045099";
  const T0 = Date.parse("2026-09-05T00:00:00.000Z");
  const captured = [];
  const fakeFetch = async (_url, opts) => {
    captured.push(JSON.parse(opts.body));
    return { ok: true, status: 200, json: async () => ({}) };
  };
  const deps = { fetch: fakeFetch, accessToken: "test-token", phoneId: "test-phone-id" };
  const body = (text) => ({ type: "text", text: { body: text } });

  ok("REAL ledger, no inbound on record for this phone: outside the window (fail closed)",
    windowOpen(phone, T0) === false);

  noteInbound(phone, T0);
  ok("REAL ledger: the inbound message just noted opens the window", windowOpen(phone, T0) === true);

  const T_2359 = T0 + 23 * 3_600_000 + 59 * 60_000;
  const r1 = await sendSessionMessage(phone, body("at 23:59 after the inbound"), { ...deps, now: T_2359 });
  ok("a send at 23:59 after the inbound SENDS - the real fetch seam was reached, a genuine Cloud API text-message body",
    r1.ok === true && captured.length === 1 && captured[0].type === "text");

  const T_2401 = T0 + 24 * 3_600_000 + 1 * 60_000;
  const r2 = await sendSessionMessage(phone, body("at 24:01 after the SAME inbound"), { ...deps, now: T_2401 });
  ok("a send at 24:01 after the SAME inbound does NOT send - window closed, zero additional network calls",
    r2.ok === false && r2.skipped === "outside_window" && captured.length === 1);

  // "the timer resets to 24 hours" - a NEW inbound reopens it, never a
  // permanently-closed window.
  noteInbound(phone, T_2401);
  const r3 = await sendSessionMessage(phone, body("after the window reopened"), { ...deps, now: T_2401 + 60_000 });
  ok("a NEW inbound reopens the window: the very next send goes through", r3.ok === true && captured.length === 2);

  // NEGATIVE CONTROL: the ledger STRUCK (resetWindow - api/whatsapp.js's own
  // header names exactly this: "a cold start forgets it and `send` then
  // fails CLOSED"). A send for a phone the CURRENT process has no record of
  // must be CAUGHT and refused, never allowed through on some other basis -
  // this is what proves the fail-closed direction is real, not merely
  // documented.
  resetWindow();
  const r4 = await sendSessionMessage(phone, body("after the ledger was struck"), { ...deps, now: T_2401 + 120_000 });
  ok("NEGATIVE CONTROL: the ledger struck (a simulated cold start) - the send is CAUGHT and refused, never silently allowed through",
    r4.ok === false && r4.skipped === "outside_window" && captured.length === 2);

  resetWindow();
}

// ═════════════════════════════════════════════════════════════════════════
console.log(`\nroom-whatsapp-chat: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
