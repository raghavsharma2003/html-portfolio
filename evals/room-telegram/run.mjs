// The Room on Telegram (WS-R18) - end to end, offline.
//
//   node evals/room-telegram/run.mjs
//
// Offline, deterministic, $0, no DB, no network, no Telegram call. It drives
// the REAL api/_room-telegram.js through a fake `db` (the SAME fixture world
// evals/room/run.mjs and evals/room-leak/run.mjs share) and a fake Telegram
// client, so the code path this suite reaches is the code path a real
// webhook reaches, with the seams a fake db and a fake model call replace.
//
// `personForSurfaceUser`/`linkSurfacePerson` (api/_room.js) are NOT
// db-injectable - they call the real `q()` directly, Meera's own shape for a
// function tested against a real Postgres schema rather than a JS fake. So
// this suite injects THEM directly (`fakePersonBridge` below, backed by the
// same `state` object the fake `db` mutates) through `api/_room-telegram.js`'s
// own seam (`deps.personForSurfaceUser`/`deps.linkSurfacePerson`), rather than
// routing identity through the `db` fake the way every other write here does.
//
// ── what this suite is actually guarding ────────────────────────────────
//
// 1. JOIN VIA DEEP LINK. `/start <slug>` -> disclosure -> age gate -> memory
//    gate -> ONE `joinRoom` call with both answers at once, the SAME
//    atomicity the web join requires. The channel pointer (migration 082)
//    is bound so the next ordinary message resolves to this Room with no
//    slug in it.
// 2. THE ATTESTATION GATE. Declining the age question writes no follower row
//    and no channel pointer - "no" is not a degraded join, it is no join.
// 3. THE DISCLOSURE IS SENT ONCE. Not on every message - `roomSay`'s own
//    disclosure predicate is re-checked on every turn (it is what makes a
//    stale session refuse), but the APP CARD itself is only ever posted from
//    `handleStart`, so a whole conversation's worth of ordinary messages
//    must show it exactly once.
// 4. SAY, THROUGH THE REAL FOLLOWER LANE. An ordinary message after a real
//    join reaches `roomSay` (and therefore `gatedReply`), never a
//    hand-rolled reply. The free cap is spent by the SAME conditional
//    UPDATE the web Room spends - this suite counts to the cap and back.
// 5. THE COMMAND TABLE. `/forget` deletes for real (the manifest loop, this
//    Room only); `/export` sends a document, not a text bubble; `/stop`
//    removes only the channel pointer - the follower row, the memory and the
//    consent ledger are untouched, and a fresh `/start` reaches the room
//    again.
//
// ── the four negative controls ──────────────────────────────────────────
//
// (a) an unjoined chat NEVER receives a creator-voiced reply - the model
//     call is never invoked.
// (b) a wrong webhook secret is refused before any db read - proven
//     structurally: `verifyRoomTelegramWebhook` takes no `db` parameter at
//     all, so there is nothing for it to read.
// (c) a group chat update is refused by name, before identity resolution or
//     a db read - a poisoned `db` that throws on any call proves the second
//     half.
// (d) two Telegram followers, one Room: the REAL follower lane produces zero
//     cross-follower tokens, and - `ws-r8-negative-control-2-was-tautological-
//     in-its-first-draft` (context/rejected.md) - the check is proven CAPABLE
//     of failing first, by rigging the model reply to paste the other
//     follower's token in, the same shape evals/room-leak/run.mjs's own
//     second required control uses. The deep SQL-level retrieval isolation
//     this exercises indirectly is evals/room-leak's own 16,080-check sweep,
//     unmodified by this workstream (same `roomSay`, same `dmRecall`); what
//     THIS control proves is that the Telegram OUTBOUND wiring carries
//     nothing beyond what `roomSay` handed it.
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { SLUG, loadFixtureAgent, freshState, fakeDb, fakeMemory } from "../room/fixtures.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");

process.env.ROOM_SESSION_SECRET = "r".repeat(48);

let pass = 0;
let fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) pass++;
  else fail++;
  console.log(`${cond ? "  ok  " : "FAIL  "}${name}${extra ? `   ${extra}` : ""}`);
};

const tg = await import(pathToFileURL(join(REPO, "api/_room-telegram.js")).href);
const {
  handleRoomTelegramUpdate,
  classifyRoomTelegramUpdate,
  parseStartCommand,
  parseRoomCommand,
  parseCallbackData,
  verifyRoomTelegramWebhook,
  joinFirstCard,
  adultRefusedCard,
  cappedCard,
  stoppedCard,
  languageChangedCard,
} = tg;
const surface = await import(pathToFileURL(join(REPO, "api/_room-surface.js")).href);
const { roomDisclosureCard } = surface;

const { engine, loadAgent } = await loadFixtureAgent(REPO);
const BASE_ENV = { ROOM_SESSION_SECRET: process.env.ROOM_SESSION_SECRET, ROOM_TELEGRAM_WEBHOOK_SECRET: "w".repeat(40) };

// ── the fake Telegram wire ──────────────────────────────────────────────
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

const textUpdate = (tgUserId, text) => ({
  message: { chat: { id: Number(tgUserId), type: "private" }, from: { id: Number(tgUserId), username: `u${tgUserId}` }, text, message_id: 1 },
});
const groupUpdate = (tgUserId, text) => ({
  message: { chat: { id: -1001234567890, type: "supergroup" }, from: { id: Number(tgUserId) }, text, message_id: 1 },
});
const callbackUpdate = (tgUserId, data) => ({
  callback_query: {
    id: `cbq${tgUserId}${data}`,
    from: { id: Number(tgUserId), username: `u${tgUserId}` },
    message: { chat: { id: Number(tgUserId) } },
    data,
  },
});

// The Telegram identity bridge, backed by the SAME `state` the fake `db`
// mutates - see the file header on why this is not routed through `db`.
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
    state.surfaceIdentities.push({
      surface, surface_user_id: key, person_id: pid, handle: String(handle || "").slice(0, 64),
    });
    return { personId: pid, created: true };
  };
  return { findPerson, linkPerson };
}

// A minimal, injected manifest - `evals/room/run.mjs`'s own precedent, and
// for the identical reason: `roomForget`/`roomExport` default to the REAL
// `activePersonTables()`, which reaches Postgres. This suite is offline,
// deterministic and $0, so both the manifest and the migration-presence
// probe are replaced with fakes rather than left to fall through to a live
// call this environment cannot make.
const personTables = async () => [
  { table: "vy_fact", key: "person_id", lane: "relational", agent: true, wipeWhere: "group_id is null" },
];
const tableApplied = async () => false;

const depsFor = (state, db, tgClient, memlog, extra = {}) => {
  const bridge = fakePersonBridge(state);
  return {
    db, tg: tgClient, loadAgent, engine, env: { ...BASE_ENV },
    memory: fakeMemory(memlog), personTables, tableApplied,
    personForSurfaceUser: bridge.findPerson,
    linkSurfacePerson: bridge.linkPerson,
    ...extra,
  };
};

async function fullJoin(state, db, tgClient, memlog, tgUserId, slug, { memory = true } = {}) {
  await handleRoomTelegramUpdate(textUpdate(tgUserId, `/start ${slug}`), depsFor(state, db, tgClient, memlog));
  await handleRoomTelegramUpdate(callbackUpdate(tgUserId, `a1:${slug}`), depsFor(state, db, tgClient, memlog));
  await handleRoomTelegramUpdate(
    callbackUpdate(tgUserId, `${memory ? "m1" : "m0"}:${slug}`),
    depsFor(state, db, tgClient, memlog),
  );
}

// ═════════════════════════════════════════════════════════════════════════
console.log("── parsing and the webhook secret ──");
// ═════════════════════════════════════════════════════════════════════════

ok("a bare /start has a payload of null", parseStartCommand("/start") === null);
ok("/start <slug> extracts the slug", parseStartCommand(`/start ${SLUG}`) === SLUG);
ok("/start@bot <slug> (Telegram's own @-mention form) still parses", parseStartCommand(`/start@RoomBot ${SLUG}`) === SLUG);
ok("an ordinary message is not a /start at all", parseStartCommand("hello") === undefined);
ok("/forget /export /stop parse to their own name", ["forget", "export", "stop"].every((c) => parseRoomCommand(`/${c}`) === c));
ok("an unrecognised command is not one of the three", parseRoomCommand("/nope") === null);
ok("callback data round-trips", JSON.stringify(parseCallbackData(`a1:${SLUG}`)) === JSON.stringify({ step: "a1", slug: SLUG }));
ok("malformed callback data is refused, not guessed at", parseCallbackData("garbage") === null);

{
  const groupEv = classifyRoomTelegramUpdate(groupUpdate("1", "hi"));
  ok("(c) a group/supergroup update is classified 'ignore', named 'group chat refused'",
    groupEv.kind === "ignore" && groupEv.reason === "group chat refused");

  const poison = async () => { throw new Error("a group update reached the database"); };
  const out = await handleRoomTelegramUpdate(groupUpdate("1", "hi"), { db: poison });
  ok("(c) …and the full handler never reaches the database for a group update",
    out.ok === true && out.skipped === "group chat refused");
}

{
  const unconfigured = verifyRoomTelegramWebhook({ headers: {} }, {});
  ok("(b) an unset webhook secret is a NAMED 503, never a silent 200",
    unconfigured.ok === false && unconfigured.status === 503 && unconfigured.reason === "room_telegram_unconfigured");

  const wrong = verifyRoomTelegramWebhook(
    { headers: { "x-telegram-bot-api-secret-token": "wrong" } },
    { ROOM_TELEGRAM_WEBHOOK_SECRET: "w".repeat(40) },
  );
  ok("(b) a wrong (but configured) secret is refused, 401", wrong.ok === false && wrong.status === 401);
  ok("(b) …refused with a function that takes no db parameter at all - structurally before any read",
    verifyRoomTelegramWebhook.length <= 2);

  const rightHeader = verifyRoomTelegramWebhook(
    { headers: { "x-telegram-bot-api-secret-token": "w".repeat(40) } },
    { ROOM_TELEGRAM_WEBHOOK_SECRET: "w".repeat(40) },
  );
  ok("(b) the correct secret is accepted", rightHeader.ok === true);
}

// ═════════════════════════════════════════════════════════════════════════
console.log("── (a) an unjoined chat never gets a creator-voiced reply ──");
// ═════════════════════════════════════════════════════════════════════════
{
  const state = freshState();
  const db = fakeDb(state);
  const sent = {};
  const tgClient = fakeTgClient(sent);
  const memlog = [];
  let replyCalls = 0;
  const reply = async () => { replyCalls++; return "this would be the AI talking"; };

  await handleRoomTelegramUpdate(textUpdate("5001", "hello, anyone there?"), depsFor(state, db, tgClient, memlog, { reply }));
  const got = texts(sent, "5001");
  ok("(a) an unjoined chat's ordinary message gets the app-voiced card and nothing else",
    got.length === 1 && got[0] === joinFirstCard());
  ok("(a) the model was never called", replyCalls === 0);
  ok("(a) no follower row was created by a bare message", state.followers.length === 0);
}

// ═════════════════════════════════════════════════════════════════════════
console.log("── join via deep link, the attestation gate, disclosure once ──");
// ═════════════════════════════════════════════════════════════════════════
{
  const state = freshState();
  const db = fakeDb(state);
  const sent = {};
  const tgClient = fakeTgClient(sent);
  const memlog = [];
  const reply = async () => "yes, that one is the same idea seen from the other end.";

  // The age gate first: declining writes NOTHING.
  await handleRoomTelegramUpdate(textUpdate("6001", `/start ${SLUG}`), depsFor(state, db, tgClient, memlog, { reply }));
  await handleRoomTelegramUpdate(callbackUpdate("6001", `a0:${SLUG}`), depsFor(state, db, tgClient, memlog, { reply }));
  ok("declining the age question writes no follower row", state.followers.length === 0);
  ok("declining the age question writes no channel pointer", state.channelMap.length === 0);
  ok("the refusal card, not the disclosure, is the last thing sent",
    texts(sent, "6001").at(-1) === adultRefusedCard());

  // A real join: /start -> yes -> remember me.
  sent["6002"] = [];
  await fullJoin(state, db, tgClient, memlog, "6002", SLUG, { memory: true });
  ok("join via deep link creates exactly one follower row", state.followers.length === 1);
  ok("the follower is attested and remembers",
    state.followers[0]?.age_attested_at != null && state.followers[0]?.memory_consent_at != null);
  ok("the channel pointer now names this Room for this chat",
    state.channelMap.some((c) => c.channel_ref === "6002" && c.room_id === state.rooms[0].room_id));

  const joinTexts = texts(sent, "6002");
  const disclosure = roomDisclosureCard("Anjali");
  ok("disclosure once: exactly one message in the whole join equals the disclosure card",
    joinTexts.filter((t) => t === disclosure).length === 1);
  ok("the disclosure never says the banned word", !/clone/i.test(disclosure));

  // A few ordinary messages afterward must not repeat the disclosure card.
  for (let i = 0; i < 3; i++) {
    await handleRoomTelegramUpdate(textUpdate("6002", `message number ${i}`), depsFor(state, db, tgClient, memlog, { reply }));
  }
  const allTexts = texts(sent, "6002");
  ok("disclosure once, still: three more turns add zero more disclosure cards",
    allTexts.filter((t) => t === disclosure).length === 1);
}

// ═════════════════════════════════════════════════════════════════════════
console.log("── say through the real follower lane, and the free cap ──");
// ═════════════════════════════════════════════════════════════════════════
{
  const state = freshState();
  const db = fakeDb(state);
  const sent = {};
  const tgClient = fakeTgClient(sent);
  const memlog = [];
  const reply = async () => "the reply text this turn's model call produced";

  await fullJoin(state, db, tgClient, memlog, "7001", SLUG, { memory: true });
  sent["7001"] = [];

  await handleRoomTelegramUpdate(
    textUpdate("7001", "what's the syllabus for next week?"),
    depsFor(state, db, tgClient, memlog, { reply }),
  );
  const said = texts(sent, "7001");
  ok("an ordinary message from a joined follower reaches the REAL follower lane",
    said.some((t) => t.includes("the reply text this turn's model call produced")));
  ok("the cap was spent by the same conditional UPDATE the web Room spends",
    state.followers[0].month_message_count === 1);

  // Spend the rest of the free allowance (19 more, cap is 20).
  for (let i = 0; i < 19; i++) {
    await handleRoomTelegramUpdate(textUpdate("7001", `message ${i}`), depsFor(state, db, tgClient, memlog, { reply }));
  }
  ok("the follower has now spent the full free allowance", state.followers[0].month_message_count === 20);

  // #21, PAYMENTS_PROVIDER unset: the honest "not yet" copy.
  sent["7001"] = [];
  await handleRoomTelegramUpdate(
    textUpdate("7001", "one more"),
    depsFor(state, db, tgClient, memlog, { reply, env: { ...BASE_ENV, PAYMENTS_PROVIDER: "" } }),
  );
  ok("cap reached, PAYMENTS_PROVIDER unset: the honest capped card, naming no paid plan",
    texts(sent, "7001").at(-1) === cappedCard({ messages_included: 20 }, false));
  ok("the cap refusal never reaches the model", state.followers[0].month_message_count === 20);

  // #21 again, PAYMENTS_PROVIDER set: the upgrade line.
  sent["7001"] = [];
  await handleRoomTelegramUpdate(
    textUpdate("7001", "one more"),
    depsFor(state, db, tgClient, memlog, { reply, env: { ...BASE_ENV, PAYMENTS_PROVIDER: "fake" } }),
  );
  const cappedWithProvider = texts(sent, "7001").at(-1);
  ok("cap reached, PAYMENTS_PROVIDER set: the upgrade line, not the honest-absence one",
    cappedWithProvider === cappedCard({ messages_included: 20 }, true) &&
      cappedWithProvider !== cappedCard({ messages_included: 20 }, false));
}

// ═════════════════════════════════════════════════════════════════════════
console.log("── the command table: /forget /export /stop ──");
// ═════════════════════════════════════════════════════════════════════════
{
  const state = freshState();
  const db = fakeDb(state);
  const sent = {};
  const tgClient = fakeTgClient(sent);
  const memlog = [];
  const reply = async () => "noted.";

  await fullJoin(state, db, tgClient, memlog, "8001", SLUG, { memory: true });
  await handleRoomTelegramUpdate(
    textUpdate("8001", "remember this: I like mechanics"),
    depsFor(state, db, tgClient, memlog, { reply }),
  );
  ok("a real turn was logged before forgetting it", memlog.some((e) => e.call === "logTurn"));

  // /export first (so it reads real state, not a post-forget empty one).
  sent["8001"] = [];
  await handleRoomTelegramUpdate(textUpdate("8001", "/export"), depsFor(state, db, tgClient, memlog, { reply }));
  const exported = (sent["8001"] || []).find((m) => m.kind === "document");
  ok("/export sends a DOCUMENT, never a text bubble",
    Boolean(exported) && !(sent["8001"] || []).some((m) => m.kind === "text"));
  const exportedJson = exported ? JSON.parse(exported.text) : null;
  ok("the export names this Room and this scope only",
    exportedJson?.room === SLUG && exportedJson?.scope === "this room only");

  // /stop: leaves, no deletion.
  sent["8001"] = [];
  await handleRoomTelegramUpdate(textUpdate("8001", "/stop"), depsFor(state, db, tgClient, memlog, { reply }));
  ok("/stop sends the leave card, not the forget receipt", texts(sent, "8001").at(-1) === stoppedCard());
  ok("/stop removes the channel pointer", !state.channelMap.some((c) => c.channel_ref === "8001"));
  ok("/stop does NOT delete the follower row", state.followers.length === 1);
  ok("/stop does NOT delete the memory ledger's own consent rows", state.consent.some((c) => c.granted === true));

  // An ordinary message after /stop, with no re-`/start`, is unjoined again.
  sent["8001"] = [];
  await handleRoomTelegramUpdate(textUpdate("8001", "are you still there?"), depsFor(state, db, tgClient, memlog, { reply }));
  ok("after /stop, an ordinary message gets the open-a-Room-first card again",
    texts(sent, "8001").at(-1) === joinFirstCard());

  // Re-`/start` restores the pointer without a second follower row. A
  // returning follower re-taps both buttons (the same UI a brand-new one
  // sees); `joinRoom`'s own `on conflict` makes this idempotent rather than a
  // second row.
  await handleRoomTelegramUpdate(textUpdate("8001", `/start ${SLUG}`), depsFor(state, db, tgClient, memlog, { reply }));
  await handleRoomTelegramUpdate(callbackUpdate("8001", `a1:${SLUG}`), depsFor(state, db, tgClient, memlog, { reply }));
  await handleRoomTelegramUpdate(callbackUpdate("8001", `m1:${SLUG}`), depsFor(state, db, tgClient, memlog, { reply }));
  ok("returning after /stop and re-`/start`ing is still ONE follower row, not two", state.followers.length === 1);
  ok("…and the channel pointer is back", state.channelMap.some((c) => c.channel_ref === "8001"));

  // Now /forget: the real delete.
  sent["8001"] = [];
  await handleRoomTelegramUpdate(textUpdate("8001", "/forget"), depsFor(state, db, tgClient, memlog, { reply }));
  ok("/forget deletes the follower row for real", state.followers.length === 0);
  ok("/forget deletes this Room's threads for this person", state.threads.length === 0);
  ok("/forget's channel pointer is gone too (cascade from the follower row, not a second delete)",
    !state.channelMap.some((c) => c.channel_ref === "8001"));
  ok("/forget leaves the Room itself standing", state.rooms.length === 1);
  ok("/forget sends the real receipt, app-voiced", texts(sent, "8001").at(-1).includes("deleted"));
}

// ═════════════════════════════════════════════════════════════════════════
console.log("── (d) two Telegram followers, one Room: zero cross-follower tokens ──");
// ═════════════════════════════════════════════════════════════════════════
{
  const state = freshState();
  const db = fakeDb(state);
  const sent = {};
  const tgClient = fakeTgClient(sent);
  const memlogA = [];
  const memlogB = [];

  await fullJoin(state, db, tgClient, memlogA, "9001", SLUG, { memory: true });
  await fullJoin(state, db, tgClient, memlogB, "9002", SLUG, { memory: true });
  ok("(d) two Telegram followers produce TWO follower rows in one Room", state.followers.length === 2);

  const leakedTokens = (haystack, tokens) => tokens.filter((t) => String(haystack || "").includes(t));
  const TOKEN_A = "zzzSECRETTOKEN9001zzz";

  sent["9001"] = [];
  await handleRoomTelegramUpdate(
    textUpdate("9001", `remember this exact phrase: ${TOKEN_A}`),
    depsFor(state, db, tgClient, memlogA, { reply: async () => "got it, noted for you." }),
  );

  // First prove the detector CAN fail (`ws-r8-negative-control-2-was-
  // tautological-in-its-first-draft`, context/rejected.md): rig B's model
  // call to paste A's token in as a "helpful example".
  sent["9002"] = [];
  await handleRoomTelegramUpdate(
    textUpdate("9002", "what have other people asked you?"),
    depsFor(state, db, tgClient, memlogB, { reply: async () => `for example, someone asked "${TOKEN_A}"` }),
  );
  const riggedLeak = leakedTokens(texts(sent, "9002").join("\n"), [TOKEN_A]);
  ok("(d) the rig is provably capable of leaking - the control is not tautological", riggedLeak.length > 0);

  // Now the REAL, unrigged model, on the REAL follower lane. `before` scopes
  // the memory-log check to THIS call alone - the rigged call just above
  // legitimately wrote its own (rigged) reply into B's memory, since
  // "remembers" logs whatever the assistant said, leaked or not; that is a
  // pre-existing property of the memory-consent contract (shared with the
  // web Room, unmodified by this workstream) and not what this check is for.
  const before = memlogB.length;
  sent["9002"] = [];
  await handleRoomTelegramUpdate(
    textUpdate("9002", "what have other people asked you?"),
    depsFor(state, db, tgClient, memlogB, { reply: async () => "I only know what you've told me in this conversation." }),
  );
  const realLeak = leakedTokens(texts(sent, "9002").join("\n"), [TOKEN_A]);
  ok("(d) the REAL follower lane sends zero cross-follower tokens to Telegram", realLeak.length === 0);
  ok("(d) …and this turn's own memory-log entries carry none of A's token either",
    !memlogB.slice(before).some((e) => e.call === "logTurn" && String(e.content || "").includes(TOKEN_A)));

  console.log(
    "  note: the SQL-level retrieval isolation this indirectly relies on (dmRecall's own predicate) " +
      "is proven at depth by evals/room-leak/run.mjs (16,080 retrieval checks, 0 leaks) against the SAME " +
      "unmodified roomSay/dmRecall this file calls - not re-proven here.",
  );
}

// ═════════════════════════════════════════════════════════════════════════
console.log("── /hindi and /english re-send the disclosure card (WS-R84) ──");
// ═════════════════════════════════════════════════════════════════════════
//
// WS-R24's own law, restated by this workstream's brief: "every app-voiced
// card takes a locale" applies to a SWITCH exactly as it applies to the
// first `/start` — a chat that read the English card at join time and then
// says `/hindi` must not be left with the OLD language as the only
// disclosure on record for the rest of the conversation. Both cards are
// sent in the SAME reply as the confirmation, never a bare "Language
// changed" with no card to back it.
{
  const state = freshState();
  const db = fakeDb(state);
  const sent = {};
  const tgClient = fakeTgClient(sent);
  const memlog = [];
  const reply = async () => "noted.";

  await fullJoin(state, db, tgClient, memlog, "10001", SLUG, { memory: true });
  ok("setup: the follower joined on the room's default locale (en)",
    state.followers[0]?.locale === "en");

  const hiDisclosure = roomDisclosureCard("Anjali");
  const enDisclosure = roomDisclosureCard("Anjali", "en");
  ok("setup sanity: roomDisclosureCard's own default IS the English card",
    hiDisclosure === enDisclosure);
  const hiCard = roomDisclosureCard("Anjali", "hi");
  ok("setup sanity: the Hindi and English cards are different bytes (the checks below are not vacuous)",
    hiCard !== enDisclosure);

  sent["10001"] = [];
  await handleRoomTelegramUpdate(textUpdate("10001", "/hindi"), depsFor(state, db, tgClient, memlog, { reply }));
  const hiTexts = texts(sent, "10001");
  ok("/hindi re-sends the disclosure card, in Hindi, in the same reply as the confirmation",
    hiTexts.length === 2 && hiTexts[0] === hiCard && hiTexts[1] === languageChangedCard("hi"));
  ok("NEGATIVE CONTROL: the /hindi reply never contains the stale, pre-switch English card",
    !hiTexts.includes(enDisclosure));
  ok("the follower's own row actually moved to hi", state.followers[0]?.locale === "hi");

  // Switch back: /english must carry the SAME shape, in the other direction.
  sent["10001"] = [];
  await handleRoomTelegramUpdate(textUpdate("10001", "/english"), depsFor(state, db, tgClient, memlog, { reply }));
  const enTexts = texts(sent, "10001");
  ok("/english re-sends the disclosure card, in English, in the same reply as the confirmation",
    enTexts.length === 2 && enTexts[0] === enDisclosure && enTexts[1] === languageChangedCard("en"));
  ok("NEGATIVE CONTROL: the /english reply never contains the stale, pre-switch Hindi card",
    !enTexts.includes(hiCard));
  ok("the follower's own row moved back to en", state.followers[0]?.locale === "en");

  // A repeated /hindi (no-op switch — already Hindi) still re-sends the
  // card: a follower who taps the command twice in a row must see the SAME
  // disclosure both times, never a second reply that silently omits it
  // because the locale did not technically change.
  sent["10001"] = [];
  await handleRoomTelegramUpdate(textUpdate("10001", "/hindi"), depsFor(state, db, tgClient, memlog, { reply }));
  sent["10001"] = [];
  await handleRoomTelegramUpdate(textUpdate("10001", "/hindi"), depsFor(state, db, tgClient, memlog, { reply }));
  ok("a repeated /hindi still re-sends the disclosure card, not just the confirmation",
    texts(sent, "10001").length === 2 && texts(sent, "10001")[0] === hiCard);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
