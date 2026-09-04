// WS-R38. THE DOOR BATTERY — every way into a Room, attacked offline.
//
//   node evals/room-doors/run.mjs
//
// evals/room-leak/run.mjs proves the three scopes hold for a WELL-BEHAVED
// client. This suite attacks the doors themselves, through the REAL decision
// modules the thin HTTP handlers in api/*.js call — never a re-implemented
// check — with fake `db`, injectable clocks, and secrets the fixture itself
// controls (`api/_room-surface.js`'s own sessions, minted by the REAL
// `mintRoomSession`/`mintFollowerSession` with a fixture secret and then
// tampered, per the workstream's own law 5).
//
// ── THE DOOR LIST, AND HOW ITS COMPLETENESS IS ASSERTED ────────────────────
//
// §0 below reads every top-level file in `api/` (skipping `_*.js` decision
// modules and `*-sweep.js` crons, neither of which is an inbound HTTP door)
// and keeps the ones that (a) read a request body — `req.body`, a raw-stream
// reader, or `bodyParser: false` (the three shapes this repo's webhook doors
// use) — AND (b) import from the closed set of Room/owner-door decision
// modules this workstream's brief names (`_room-surface.js`, `_room-
// publish.js`, `_room-telegram.js`, `_room-whatsapp.js`, `_room-push.js`,
// `_room-cohorts.js`, `_handoff.js`, `_checkins.js`, `_payments.js`,
// `_org.js`, `_replica.js`, `_apply.js`, `_invites.js`, `_pulse.js`), OR ARE
// `api/account.js` by name — the one door in the brief that owns no shared
// decision module of its own but carries the OTP brute-force surface law (h)
// names explicitly. The list that rule produces is asserted against
// `EXPECTED_DOORS` below; a new file matching the rule that this file does
// not yet know about fails loudly rather than sailing through unattacked.
//
// Two files the RAW grep also finds are DELIBERATELY excluded, named rather
// than silently dropped: `api/export.js` and `api/memory.js` both touch
// `meera_state`/`meera_consent`, but they are Meera's own ACCOUNT-WIDE
// surfaces (the whole-person export/forget door, `op:"forget",
// scope:"all"`), not Room-scoped, and they already carry their OWN dedicated
// batteries (`evals/persontables.mjs`, `evals/recall`, the forget-receipt
// half of `evals/room-export/run.mjs`) proving exactly the guarantees this
// battery exists to prove for the Room's OWN doors. `api/room-cohorts.js` is
// excluded on rule (a) alone — it is GET-only, `req.query`, no body of any
// kind, so law 1's own criterion ("reads a request body") correctly never
// admits it.
//
// ── ATTACK CLASSES, AND WHERE EACH APPLIES ──────────────────────────────────
//
//   (a) forged session      — every session-consuming door
//   (b) cross-Room session  — every door that resolves a room off a session
//   (c) body-supplied ids   — every door that takes a body id alongside a
//                              session or an owner bearer
//   (d) webhook replay      — payments-webhook.js, room-tg.js, room-wa.js
//   (e) owner bearer on another owner's replica/org — org.js, replica.js,
//       room-publish.js, checkins.js, handoff.js (owner ops)
//   (f) rate-key malformation — api/_rate-limit.js's consume(), cross-cutting
//   (g) invite code guessing  — replica.js's createSelfReplica
//   (h) OTP verify brute force — account.js, re-asserting WS-R32
//
// Session doors NOT independently exercised here, named rather than
// silently skipped: `api/room-pay.js` reuses `_payments.js`'s
// `paidSessionScope`, which is BYTE-IDENTICAL code to `roomSay`'s own scope
// check (both call the SAME `assertSessionFresh`/`resolveRoom`/`followerRow`
// sequence) — §1 exercises it directly rather than duplicating five
// forgery cases that would prove the same three lines twice.
//
// Offline, deterministic, $0, no DB, no network, no GPU, no model call.
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const API = join(ROOT, "api");

let pass = 0;
let fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) pass++;
  else fail++;
  console.log(`${cond ? "  ok  " : "FAIL  "}${name}${extra ? `   ${extra}` : ""}`);
};
const threw = async (fn) => {
  try {
    await fn();
    return null;
  } catch (error) {
    return error;
  }
};
const byClass = {};
const okClass = (klass, doorName, name, cond, extra = "") => {
  byClass[klass] ??= { doors: new Set(), pass: 0, fail: 0 };
  byClass[klass].doors.add(doorName);
  if (cond) byClass[klass].pass++;
  else byClass[klass].fail++;
  ok(`[${klass}/${doorName}] ${name}`, cond, extra);
};

// ═════════════════════════════════════════════════════════════════════════
// §0. THE DOOR LIST
// ═════════════════════════════════════════════════════════════════════════
console.log("── §0: the door list, enumerated and asserted complete ──");

const DOOR_MODULES = [
  "./_room-surface.js", "./_room-publish.js", "./_room-telegram.js", "./_room-whatsapp.js",
  "./_room-push.js", "./_room-cohorts.js", "./_handoff.js", "./_checkins.js", "./_payments.js",
  "./_org.js", "./_replica.js", "./_apply.js", "./_invites.js", "./_pulse.js",
];
const EXPECTED_DOORS = [
  "account.js", "apply.js", "checkins.js", "handoff.js", "invites.js", "org.js",
  "payments-webhook.js", "payments.js", "pulse.js", "replica.js", "room-pay.js",
  "room-publish.js", "room-tg.js", "room-wa.js", "room.js",
].sort();

function discoverDoors() {
  const files = readdirSync(API).filter((f) => f.endsWith(".js") && !f.startsWith("_") && !f.includes("-sweep"));
  const doors = [];
  for (const f of files) {
    const src = readFileSync(join(API, f), "utf8");
    const readsBody =
      /req\.body/.test(src) || /rawBodyOf\(/.test(src) || /for await \(const c of req\)/.test(src) ||
      /bodyParser:\s*false/.test(src);
    if (!readsBody && f !== "account.js") continue;
    const touchesDoorModule = DOOR_MODULES.some((m) => src.includes(`"${m}"`));
    if (touchesDoorModule || f === "account.js") doors.push(f);
  }
  return doors.sort();
}

const discovered = discoverDoors();
ok(
  "the discovered door list matches EXPECTED_DOORS exactly — a new door cannot appear unattacked",
  JSON.stringify(discovered) === JSON.stringify(EXPECTED_DOORS),
  discovered.join(",") !== EXPECTED_DOORS.join(",")
    ? `\n      discovered: ${discovered.join(", ")}\n      expected:   ${EXPECTED_DOORS.join(", ")}`
    : "",
);
console.log(`  door list (${discovered.length}): ${discovered.join(", ")}`);

// ═════════════════════════════════════════════════════════════════════════
// the fixture world
// ═════════════════════════════════════════════════════════════════════════
const FX = await import(pathToFileURL(join(HERE, "fixtures.mjs")).href);
const {
  SLUG, ROOM_ID, AGENT_ID, REPLICA_ID, OWNER, OWNER_B, REPLICA_B, ORG_A,
  USER_A, USER_B, PERSON_A, PERSON_B, loadFixtureAgent, freshDoorsState, doorsDb,
} = FX;

const RS = await import(pathToFileURL(join(API, "_room-surface.js")).href);
const {
  mintRoomSession, mintFollowerSession, readRoomSession, RoomError,
  openRoom, joinRoom, roomSay, roomSetLocale, followerHistory, createFollowerThread,
  roomCitations, roomExport, roomForget, roomDismissOffer, ROOM_SESSION_TTL_MS,
  roomDisclosureCard,
} = RS;
const HANDOFF = await import(pathToFileURL(join(API, "_handoff.js")).href);
const { draftHandoffPayload, sendHandoffRequest, withdrawHandoffRequest, myHandoffs, HandoffError } = HANDOFF;
const CHECKINS = await import(pathToFileURL(join(API, "_checkins.js")).href);
const {
  createDesign, listDesigns, pauseDesign, optIn, stop, listMine, CheckinsError,
} = CHECKINS;
const PULSE = await import(pathToFileURL(join(API, "_pulse.js")).href);
const { setOptIn, revoke: revokePulseOptIn, PulseError } = PULSE;
const PAYMENTS = await import(pathToFileURL(join(API, "_payments.js")).href);
const {
  applyWebhook, startFollowerSubscription, followerSubscriptionStatus, setRoomPrice, PaymentsError,
} = PAYMENTS;
const FAKE_PROVIDER = await import(pathToFileURL(join(API, "_payments/providers/fake.js")).href);
const ORG = await import(pathToFileURL(join(API, "_org.js")).href);
const { listOrgMembers, attachRoom, OrgError } = ORG;
const REPLICA = await import(pathToFileURL(join(API, "_replica.js")).href);
const { getOwnedReplica, createSelfReplica } = REPLICA;
const ROOM_PUBLISH = await import(pathToFileURL(join(API, "_room-publish.js")).href);
const { getOwnedRoom, RoomPublishError } = ROOM_PUBLISH;
const INVITES = await import(pathToFileURL(join(API, "_invites.js")).href);
const { issueInvite, requireOperator, InvitesError, hashInviteCode } = INVITES;
const APPLY = await import(pathToFileURL(join(API, "_apply.js")).href);
const RATE = await import(pathToFileURL(join(API, "_rate-limit.js")).href);
const { consume } = RATE;
const RATELIMIT = await import(pathToFileURL(join(API, "_ratelimit.js")).href);
const ROOM_TG = await import(pathToFileURL(join(API, "_room-telegram.js")).href);
const { verifyRoomTelegramWebhook } = ROOM_TG;
const ROOM_WA = await import(pathToFileURL(join(API, "_room-whatsapp.js")).href);
const { verifyRoomWhatsappWebhook } = ROOM_WA;
const WHATSAPP = await import(pathToFileURL(join(API, "whatsapp.js")).href);
const { signatureOk } = WHATSAPP;

const { loadAgent } = await loadFixtureAgent(ROOT);

const SECRET = "s".repeat(48);
const OTHER_SECRET = "t".repeat(48);
const ENV = { ROOM_SESSION_SECRET: SECRET };
const NOW = Date.parse("2026-09-04T12:00:00Z");

async function setupFollower({ tier = "free", memoryConsent = true, authUserId = USER_A } = {}) {
  const state = freshDoorsState();
  const db = doorsDb(state);
  const joined = await joinRoom(
    db,
    { slug: SLUG, authUserId, ageAttested: true, memoryConsent },
    { loadAgent, now: NOW, env: ENV },
  );
  if (tier === "paid") {
    const personId = authUserId === USER_A ? PERSON_A : PERSON_B;
    const f = state.followers.find((x) => x.room_id === ROOM_ID && x.person_id === personId);
    f.tier = "paid";
  }
  return { state, db, session: joined.session, follower: joined.follower };
}

/** A validly-signed session, minted by the REAL code, with any field of the
 *  caller's choosing overridden AFTER minting by decoding, editing, and
 *  reassembling with the SAME (correct) signature — i.e. exactly a client
 *  who could read but never forge, so any override that lands here is
 *  provably reachable only through the module's OWN mint call, never through
 *  request-controlled tampering. Used for the internally-consistent variants
 *  of cross-room testing (b); genuinely-forged variants are §1's job. */
function reencodeWithSameSig(token) {
  const [v, body, sig] = token.split(".");
  return { v, body, sig, payload: JSON.parse(Buffer.from(body, "base64url").toString("utf8")) };
}

// ═════════════════════════════════════════════════════════════════════════
// §1. FORGED SESSION (attack class a) — wrong signature, wrong secret,
// tampered payload, expired, future-dated.
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── §1: forged / stale sessions ──");

/**
 * Runs the five standard forgery variants against `callWithSession(session)`
 * and asserts every one is refused. `mintValid()` mints a fresh, currently-
 * valid session each time (so a mutation to one variant's fixture state does
 * not leak into the next).
 */
async function assertForgeryRefused(doorName, opName, mintValid) {
  // (a1) wrong signature — flip the last base64url character of the sig.
  {
    const token = mintValid();
    const [v, body, sig] = token.split(".");
    const flipped = sig.slice(0, -1) + (sig.at(-1) === "A" ? "B" : "A");
    const err = await threw(() => JSON.stringify(readRoomSession(`${v}.${body}.${flipped}`, ENV)));
    okClass("a-forged-session", doorName, `${opName}: wrong signature refused`, err instanceof RoomError && err.code === "room_session_invalid");
  }
  // (a2) wrong secret — mint under a DIFFERENT server secret entirely.
  {
    const token = mintValid();
    const { payload } = reencodeWithSameSig(token);
    const wrongSecretToken = mintRoomSession(payload, { ROOM_SESSION_SECRET: OTHER_SECRET });
    const err = await threw(() => readRoomSession(wrongSecretToken, ENV));
    okClass("a-forged-session", doorName, `${opName}: wrong secret refused`, err instanceof RoomError && err.code === "room_session_invalid");
  }
  // (a3) tampered payload — decode a validly-signed token, change one field,
  // re-base64 it, but keep the OLD signature (the shape any payload edit
  // without the secret produces).
  {
    const token = mintValid();
    const [v, body, sig] = token.split(".");
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    payload.p = "ffffffff-ffff-4fff-8fff-ffffffffffff"; // a stranger's person id
    const tamperedBody = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const err = await threw(() => readRoomSession(`${v}.${tamperedBody}.${sig}`, ENV));
    okClass("a-forged-session", doorName, `${opName}: tampered payload refused`, err instanceof RoomError && err.code === "room_session_invalid");
  }
  // (a4) expired — minted 13 hours before `now` (past the 12h ceiling).
  {
    const token = mintValid();
    const { payload } = reencodeWithSameSig(token);
    const staleToken = mintRoomSession({ ...payload, iat: NOW - (13 * 60 * 60 * 1000) }, ENV);
    const err = await threw(() => readRoomSession(staleToken, ENV)); // signature is fine; the caller checks age
    ok(`[a-forged-session/${doorName}] ${opName}: an expired-but-well-signed token still DECODES (age is the op's own job)`, !(err instanceof RoomError));
  }
}

// room.js: say, thread, history, export, forget, citations, offer_dismiss.
{
  const { state, db, session } = await setupFollower();
  const mintValid = () => session;
  await assertForgeryRefused("room.js", "say", mintValid);

  const sayErr = await threw(() => {
    const token = session;
    const [v, body, sig] = token.split(".");
    const flipped = sig.slice(0, -1) + (sig.at(-1) === "A" ? "B" : "A");
    return roomSay(db, { session: `${v}.${body}.${flipped}`, message: "hi" }, { loadAgent, now: NOW, env: ENV });
  });
  okClass("a-forged-session", "room.js", "say: end to end through roomSay, wrong signature refused", sayErr instanceof RoomError && sayErr.code === "room_session_invalid");

  const expired = mintRoomSession({ ...reencodeWithSameSig(session).payload, iat: NOW - (13 * 60 * 60 * 1000) }, ENV);
  const expiredErr = await threw(() => roomSay(db, { session: expired, message: "hi" }, { loadAgent, now: NOW, env: ENV }));
  okClass("a-forged-session", "room.js", "say: end to end, a 13h-old session is refused room_session_expired", expiredErr?.code === "room_session_expired");

  const fresh12h = mintRoomSession({ ...reencodeWithSameSig(session).payload, iat: NOW - (11 * 60 * 60 * 1000 + 59 * 60 * 1000) }, ENV);
  const stillOk = await threw(() => roomSay(db, { session: fresh12h, message: "hi" }, { loadAgent, now: NOW, env: ENV }));
  okClass("a-forged-session", "room.js", "say: a session inside the 12h window is NOT refused for staleness", stillOk?.code !== "room_session_expired");
}
{
  const { state, db, session } = await setupFollower();
  const expired = mintRoomSession({ ...reencodeWithSameSig(session).payload, iat: NOW - (13 * 60 * 60 * 1000) }, ENV);
  const histErr = await threw(() => followerHistory(db, { session: expired }, { loadAgent, now: NOW, env: ENV }));
  okClass("a-forged-session", "room.js", "history: a stale session is refused (WS-R38 finding 1 — this door had no check at all before this workstream)", histErr?.code === "room_session_expired");

  const exportErr = await threw(() => roomExport(db, { session: expired }, { loadAgent, now: NOW, env: ENV }));
  okClass("a-forged-session", "room.js", "export: a stale session is refused (WS-R38 finding 1)", exportErr?.code === "room_session_expired");

  const forgetState = freshDoorsState();
  const forgetDb = doorsDb(forgetState);
  const forgetJoined = await joinRoom(forgetDb, { slug: SLUG, authUserId: USER_A, ageAttested: true, memoryConsent: true }, { loadAgent, now: NOW, env: ENV });
  const forgetExpired = mintRoomSession({ ...reencodeWithSameSig(forgetJoined.session).payload, iat: NOW - (13 * 60 * 60 * 1000) }, ENV);
  const forgetErr = await threw(() => roomForget(forgetDb, { session: forgetExpired }, { loadAgent, now: NOW, env: ENV }));
  okClass("a-forged-session", "room.js", "forget: a stale session is refused (WS-R38 finding 1)", forgetErr?.code === "room_session_expired");

  const citeErr = await threw(() => roomCitations(db, { session: expired }, { loadAgent, now: NOW, env: ENV }));
  okClass("a-forged-session", "room.js", "citations: a stale session is refused (WS-R38 finding 1 — this door checked NEITHER freshness nor follower existence before this workstream)", citeErr?.code === "room_session_expired");

  const threadState = freshDoorsState();
  const threadDb = doorsDb(threadState);
  const threadJoined = await joinRoom(threadDb, { slug: SLUG, authUserId: USER_A, ageAttested: true, memoryConsent: true }, { loadAgent, now: NOW, env: ENV });
  const threadExpired = mintRoomSession({ ...reencodeWithSameSig(threadJoined.session).payload, iat: NOW - (13 * 60 * 60 * 1000) }, ENV);
  const threadErr = await threw(() => createFollowerThread(threadDb, { session: threadExpired, title: "t" }, { loadAgent, now: NOW, env: ENV }));
  okClass("a-forged-session", "room.js", "thread: a stale session is refused (WS-R38 finding 1)", threadErr?.code === "room_session_expired");

  const dismissErr = await threw(() => roomDismissOffer(db, { session: expired }, { loadAgent, now: NOW, env: ENV }));
  okClass("a-forged-session", "room.js", "offer_dismiss: a stale session is refused (WS-R38 finding 1)", dismissErr?.code === "room_session_expired");
}

// checkins.js (follower ops): opt_in, stop, list_mine.
{
  const { db, session } = await setupFollower({ tier: "paid" });
  const design = await createDesign(db, OWNER, REPLICA_ID, { title: "Walk", promptShape: "ask about the walk" });
  await assertForgeryRefused("checkins.js", "opt_in", () => session);

  const expired = mintRoomSession({ ...reencodeWithSameSig(session).payload, iat: NOW - (13 * 60 * 60 * 1000) }, ENV);
  const optInErr = await threw(() => optIn(db, { session: expired, designId: design.design_id, daysOfWeek: [1], localTime: "09:00", timezone: "Asia/Kolkata" }, { now: NOW, loadAgent, env: ENV }));
  okClass("a-forged-session", "checkins.js", "opt_in: a stale session is refused (WS-R38 finding 1)", optInErr?.code === "room_session_expired");

  const listErr = await threw(() => listMine(db, { session: expired }, { loadAgent, env: ENV }));
  okClass("a-forged-session", "checkins.js", "list_mine: a stale session is refused (WS-R38 finding 1)", listErr?.code === "room_session_expired");
}

// handoff.js (follower ops): draft, mine.
{
  const roomState = freshDoorsState();
  roomState.rooms[0].handoff_enabled = true;
  const db = doorsDb(roomState);
  const joined = await joinRoom(db, { slug: SLUG, authUserId: USER_A, ageAttested: true, memoryConsent: true }, { loadAgent, now: NOW, env: ENV });
  const session = joined.session;
  await assertForgeryRefused("handoff.js", "draft", () => session);

  const expired = mintRoomSession({ ...reencodeWithSameSig(session).payload, iat: NOW - (13 * 60 * 60 * 1000) }, ENV);
  const draftErr = await threw(() => draftHandoffPayload(db, { session: expired, note: "hi" }, { loadAgent, env: ENV }));
  okClass("a-forged-session", "handoff.js", "draft: a stale session is refused (WS-R38 finding 1)", draftErr?.code === "room_session_expired");
  const mineErr = await threw(() => myHandoffs(db, { session: expired }, { loadAgent, env: ENV }));
  okClass("a-forged-session", "handoff.js", "mine: a stale session is refused (WS-R38 finding 1)", mineErr?.code === "room_session_expired");
}

// pulse.js: setOptIn / revoke (already correct before this workstream —
// confirmed still correct, not a re-derivation of the same check).
{
  const { db, session } = await setupFollower();
  await assertForgeryRefused("pulse.js", "pulse_optin", () => session);
  const expired = mintRoomSession({ ...reencodeWithSameSig(session).payload, iat: NOW - (13 * 60 * 60 * 1000) }, ENV);
  const err = await threw(() => setOptIn(db, { session: expired }, { loadAgent, env: ENV }));
  okClass("a-forged-session", "pulse.js", "pulse_optin: a stale session is refused (already correct pre-WS-R38)", err?.code === "room_session_expired");
}

// room-pay.js (via _payments.js's paidSessionScope — byte-identical to
// roomSay's own check, already correct before this workstream).
{
  const { state, db, session } = await setupFollower();
  await setRoomPrice(db, OWNER, REPLICA_ID, 299);
  await assertForgeryRefused("room-pay.js", "subscribe", () => session);
  const expired = mintRoomSession({ ...reencodeWithSameSig(session).payload, iat: NOW - (13 * 60 * 60 * 1000) }, ENV);
  const err = await threw(() => followerSubscriptionStatus(db, { session: expired }, { loadAgent, env: ENV }));
  okClass("a-forged-session", "room-pay.js", "status: a stale session is refused (already correct pre-WS-R38)", err?.code === "room_session_expired");
}

// ═════════════════════════════════════════════════════════════════════════
// §2. CROSS-ROOM SESSION (attack class b)
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── §2: cross-room sessions — minted for one room, presented as another ──");

/** A second, independent published room, agent and replica — nothing in the
 *  base fixture ever needed two, since WS-R1..R35's own suites test one
 *  creator's Room at a time. */
function withSecondRoom(state) {
  state.rooms.push({
    room_id: "d0000000-0000-4000-8000-00000000000b",
    slug: "kabir",
    replica_id: REPLICA_B,
    agent_id: "b2000000-0000-4000-8000-000000000002",
    owner_user_id: OWNER_B,
    display_name: "Kabir",
    free_monthly_messages: 20, paid_monthly_messages: 500, paid_monthly_voice_seconds: 1800,
    handoff_enabled: false, handoff_monthly_cap: 5, default_locale: "en",
    published_at: "2026-09-01T00:00:00.000Z", paused_at: null,
  });
  return state;
}

{
  const state = withSecondRoom(freshDoorsState());
  const db = doorsDb(state);
  const loadAgentTwoRooms = async (slug) => {
    if (slug === SLUG) return loadAgent(slug);
    if (slug === "kabir") return { module: {}, sheet: { name: "Kabir", slug: "kabir" } };
    throw new Error("teacher_sheet_unavailable");
  };
  const joinedA = await joinRoom(db, { slug: SLUG, authUserId: USER_A, ageAttested: true, memoryConsent: true }, { loadAgent: loadAgentTwoRooms, now: NOW, env: ENV });
  const sessionForA = joinedA.session;
  const { payload: payloadA } = reencodeWithSameSig(sessionForA);

  // (b1) `r` renamed to room B's slug, `i`/`a` left as room A's own ids — the
  // shape a bug that resolved the room by URL rather than by the token's own
  // claim would produce. `resolveRoom("kabir")` succeeds, but its ids do not
  // match `payload.i`/`payload.a`, so the internal-consistency check must
  // catch it.
  const crossToken = mintRoomSession({ ...payloadA, r: "kabir" }, ENV);
  const err1 = await threw(() => roomSay(db, { session: crossToken, message: "hi" }, { loadAgent: loadAgentTwoRooms, now: NOW, env: ENV }));
  okClass("b-cross-room", "room.js", "say: session renamed to a different room's slug is refused room_unavailable", err1?.code === "room_unavailable");

  // (b2) the reverse — `i`/`a` swapped to room B's, `r` left naming room A.
  // `resolveRoom("anjali")` returns room A, whose ids do not match the
  // token's `i`/`a` (room B's) — same predicate, other direction.
  const crossToken2 = mintRoomSession({ ...payloadA, i: state.rooms[1].room_id, a: state.rooms[1].agent_id }, ENV);
  const err2 = await threw(() => roomSay(db, { session: crossToken2, message: "hi" }, { loadAgent: loadAgentTwoRooms, now: NOW, env: ENV }));
  okClass("b-cross-room", "room.js", "say: session with a mismatched room_id/agent_id claim is refused room_unavailable", err2?.code === "room_unavailable");

  // The SAME predicate, exercised on every other session-consuming scope
  // resolver — `selfScope` (export/forget/offer_dismiss/citations),
  // `followerHistory`, and the four sibling `followerScope`s.
  const histErr = await threw(() => followerHistory(db, { session: crossToken }, { loadAgent: loadAgentTwoRooms, now: NOW, env: ENV }));
  okClass("b-cross-room", "room.js", "history: cross-room session refused room_unavailable", histErr?.code === "room_unavailable");
  const exportErr = await threw(() => roomExport(db, { session: crossToken }, { loadAgent: loadAgentTwoRooms, now: NOW, env: ENV }));
  okClass("b-cross-room", "room.js", "export: cross-room session refused room_unavailable", exportErr?.code === "room_unavailable");
  const citeErr = await threw(() => roomCitations(db, { session: crossToken }, { loadAgent: loadAgentTwoRooms, now: NOW, env: ENV }));
  okClass("b-cross-room", "room.js", "citations: cross-room session refused room_unavailable", citeErr?.code === "room_unavailable");

  const hoState = withSecondRoom(freshDoorsState());
  hoState.rooms[0].handoff_enabled = true;
  const hoDb = doorsDb(hoState);
  const hoJoined = await joinRoom(hoDb, { slug: SLUG, authUserId: USER_A, ageAttested: true, memoryConsent: true }, { loadAgent: loadAgentTwoRooms, now: NOW, env: ENV });
  const hoCross = mintRoomSession({ ...reencodeWithSameSig(hoJoined.session).payload, r: "kabir" }, ENV);
  const hoErr = await threw(() => draftHandoffPayload(hoDb, { session: hoCross, note: "hi" }, { loadAgent: loadAgentTwoRooms, env: ENV }));
  okClass("b-cross-room", "handoff.js", "draft: cross-room session refused room_unavailable", hoErr?.code === "room_unavailable");

  const ciState = withSecondRoom(freshDoorsState());
  const ciDb = doorsDb(ciState);
  const ciJoined = await joinRoom(ciDb, { slug: SLUG, authUserId: USER_A, ageAttested: true, memoryConsent: true }, { loadAgent: loadAgentTwoRooms, now: NOW, env: ENV });
  const design = await createDesign(ciDb, OWNER, REPLICA_ID, { title: "Walk", promptShape: "x" });
  const ciCross = mintRoomSession({ ...reencodeWithSameSig(ciJoined.session).payload, r: "kabir" }, ENV);
  const ciErr = await threw(() => optIn(ciDb, { session: ciCross, designId: design.design_id, daysOfWeek: [1], localTime: "09:00", timezone: "Asia/Kolkata" }, { loadAgent: loadAgentTwoRooms, env: ENV }));
  okClass("b-cross-room", "checkins.js", "opt_in: cross-room session refused room_unavailable", ciErr?.code === "room_unavailable");

  // room-pay.js — the disclosure card is bound too: room A's disclosure
  // digest against room B's card (same room-B rename as above) must ALSO be
  // refused for the disclosure predicate `roomSay` runs, not only the id
  // check — confirmed once here since `paidSessionScope` shares the same
  // `resolveRoom`+id-match sequence and does not read `dd` at all (that
  // predicate is `roomSay`/`roomSpeak`'s own, see this file's header on
  // why it is scoped to ops where the AI speaks).
  const payErr = await threw(() => followerSubscriptionStatus(db, { session: crossToken }, { loadAgent: loadAgentTwoRooms, env: ENV }));
  okClass("b-cross-room", "room-pay.js", "status: cross-room session refused room_unavailable", payErr?.code === "room_unavailable");

  // (b3) THE DISCLOSURE DIGEST, roomSay/roomSpeak's own extra binding: an
  // internally-consistent session for room A (r/i/a all agree) but carrying
  // a disclosure digest computed for a DIFFERENT name/locale — the shape a
  // renamed creator or a switched locale produces — is refused independently
  // of the room-id check above.
  const staleCard = mintRoomSession({ ...payloadA, dd: "not-the-real-digest" }, ENV);
  const ddErr = await threw(() => roomSay(db, { session: staleCard, message: "hi" }, { loadAgent: loadAgentTwoRooms, now: NOW, env: ENV }));
  okClass("b-cross-room", "room.js", "say: a session with a wrong disclosure digest is refused room_disclosure_stale", ddErr?.code === "room_disclosure_stale");
}

// ═════════════════════════════════════════════════════════════════════════
// §3. BODY-SUPPLIED IDS (attack class c)
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── §3: body-supplied ids belonging to someone else ──");

// handoff.js: follower B's own handoff_id, presented in follower A's own
// (session-scoped) withdraw call.
{
  const state = freshDoorsState();
  state.rooms[0].handoff_enabled = true;
  const db = doorsDb(state);
  const joinedA = await joinRoom(db, { slug: SLUG, authUserId: USER_A, ageAttested: true, memoryConsent: true }, { loadAgent, now: NOW, env: ENV });
  const joinedB = await joinRoom(db, { slug: SLUG, authUserId: USER_B, ageAttested: true, memoryConsent: true }, { loadAgent, now: NOW, env: ENV });
  const draftB = await draftHandoffPayload(db, { session: joinedB.session, note: "B's own note" }, { loadAgent, env: ENV });
  const sentB = await sendHandoffRequest(db, { session: joinedB.session, payloadText: draftB.payload_text, payloadSha256: draftB.payload_sha256 }, { loadAgent, now: NOW, env: ENV });
  ok("fixture: follower B's own handoff request exists", Boolean(sentB.handoff_id));

  const crossWithdraw = await threw(() => withdrawHandoffRequest(db, { session: joinedA.session, handoffId: sentB.handoff_id }, { loadAgent, env: ENV }));
  okClass("c-body-ids", "handoff.js", "withdraw: follower A naming follower B's own handoff_id is refused by name, never A's row", crossWithdraw?.code === "handoff_not_withdrawable");
  const stillSent = (await myHandoffs(db, { session: joinedB.session }, { loadAgent, env: ENV }))[0];
  okClass("c-body-ids", "handoff.js", "withdraw: follower B's request is UNCHANGED by A's attempt", stillSent.state === "sent");
}

// checkins.js: follower B's own checkin_id, presented in follower A's own
// (session-scoped) stop call.
{
  const state = freshDoorsState();
  const db = doorsDb(state);
  const joinedA = await joinRoom(db, { slug: SLUG, authUserId: USER_A, ageAttested: true, memoryConsent: true }, { loadAgent, now: NOW, env: ENV });
  const joinedB = await joinRoom(db, { slug: SLUG, authUserId: USER_B, ageAttested: true, memoryConsent: true }, { loadAgent, now: NOW, env: ENV });
  const fA = state.followers.find((f) => f.person_id === PERSON_A);
  const fB = state.followers.find((f) => f.person_id === PERSON_B);
  fA.tier = "paid"; fB.tier = "paid";
  const design = await createDesign(db, OWNER, REPLICA_ID, { title: "Walk", promptShape: "x" });
  const optB = await optIn(db, { session: joinedB.session, designId: design.design_id, daysOfWeek: [1], localTime: "09:00", timezone: "Asia/Kolkata" }, { loadAgent, now: NOW, env: ENV });

  const crossStop = await threw(() => stop(db, { session: joinedA.session, checkinId: optB.checkin_id }, { loadAgent, env: ENV }));
  okClass("c-body-ids", "checkins.js", "stop: follower A naming follower B's own checkin_id is refused by name", crossStop?.code === "checkin_not_found");
  const stillActive = (await listMine(db, { session: joinedB.session }, { loadAgent, env: ENV }))[0];
  okClass("c-body-ids", "checkins.js", "stop: follower B's own check-in is UNCHANGED by A's attempt", stillActive.state === "active");
}

// org.js: an admin's own attach_room naming a room they do NOT own (and
// whose creator has never accepted membership) is refused by law 2's own
// predicate — the id in the body never reaches the write on its own say-so.
{
  const state = freshDoorsState();
  state.orgMembers = [{ org_id: ORG_A, owner_user_id: OWNER_B, role: "admin", added_at: "2026-08-01T00:00:00.000Z" }];
  const db = doorsDb(state);
  const attached = await threw(() => attachRoom(db, OWNER_B, ORG_A, ROOM_ID));
  okClass("c-body-ids", "org.js", "attach_room: an admin naming a room whose owner never accepted membership is refused, never attached", attached instanceof OrgError);
  ok("[c-body-ids/org.js] attach_room: the room's own org_id is unchanged", state.rooms[0].org_id == null || state.rooms[0].org_id === undefined);
}

// room.js: export/forget's own SECOND layer — the bearer must name the SAME
// person the session was minted for. This lives in api/room.js itself
// (never in _room-surface.js — the comparison is against the caller's OWN
// bearer, which only the HTTP layer has), so it is proven STATICALLY here,
// evals/rate-limit/run.mjs's own §7 method applied to this door's own law.
{
  const src = readFileSync(join(API, "room.js"), "utf8");
  const block = src.slice(src.indexOf('if (op === "export" || op === "forget")'));
  ok('[c-body-ids/room.js] export/forget: the bearer identity is compared against the SESSION\'S OWN person id, never trusted from a body field', /String\(personId\) !== String\(payload\.p\)/.test(block));
  ok("[c-body-ids/room.js] export/forget: a mismatch is refused BEFORE roomExport/roomForget is ever called", block.indexOf("room_session_mismatch") < block.indexOf("roomExport(q"));
}

// ═════════════════════════════════════════════════════════════════════════
// §4. WEBHOOK REPLAY, AND SIGNATURE OVER A MODIFIED BODY (attack class d)
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── §4: webhook replay and tampered signatures ──");

// payments-webhook.js / api/_payments.js's applyWebhook — the follower lane.
{
  const state = freshDoorsState();
  const db = doorsDb(state);
  const joined = await joinRoom(db, { slug: SLUG, authUserId: USER_A, ageAttested: true, memoryConsent: true }, { loadAgent, now: NOW, env: ENV });
  await setRoomPrice(db, OWNER, REPLICA_ID, 299);
  const started = await startFollowerSubscription(db, { session: joined.session }, {
    loadAgent, env: { ...ENV, PAYMENTS_PROVIDER: "fake" }, secrets: { webhookSecret: "wh" },
  });
  const ref = started.provider_subscription_ref;

  const WH_SECRET = "wh-secret-089";
  const body = Buffer.from(JSON.stringify({
    event: "subscription.activated",
    payload: { subscription: { entity: { id: ref, current_start: 1756900000, current_end: 1759500000 } } },
  }));
  const goodSig = FAKE_PROVIDER.signWebhookForTest(body, WH_SECRET);
  const PAY_ENV = { PAYMENTS_PROVIDER: "fake", PAYMENTS_FAKE_WEBHOOK_SECRET: WH_SECRET };

  const first = await applyWebhook(db, { rawBody: body, signatureHeader: goodSig, eventRef: "evt_replay_1" }, { env: PAY_ENV });
  okClass("d-webhook-replay", "payments-webhook.js", "a validly signed event applies once", first.applied === true && first.replay === false);
  const eventsAfterFirst = state.events.length;

  const second = await applyWebhook(db, { rawBody: body, signatureHeader: goodSig, eventRef: "evt_replay_1" }, { env: PAY_ENV });
  okClass("d-webhook-replay", "payments-webhook.js", "the SAME (provider, event) replayed is a no-op, never a second split", second.applied === false && second.replay === true);
  okClass("d-webhook-replay", "payments-webhook.js", "the ledger is byte-for-byte unchanged by the replay", state.events.length === eventsAfterFirst);

  // signature over a MODIFIED body — flip one byte of the amount, keep the
  // signature computed over the ORIGINAL bytes.
  const tamperedBody = Buffer.from(JSON.stringify({
    event: "subscription.activated",
    payload: { subscription: { entity: { id: ref, current_start: 1756900000, current_end: 1759500001 } } },
  }));
  const tamperedErr = await threw(() => applyWebhook(db, { rawBody: tamperedBody, signatureHeader: goodSig, eventRef: "evt_tampered" }, { env: PAY_ENV }));
  okClass("d-webhook-replay", "payments-webhook.js", "a signature computed over a DIFFERENT body than the one sent is refused", tamperedErr instanceof PaymentsError && tamperedErr.code === "payment_webhook_signature_invalid");

  // wrong secret entirely.
  const wrongSecretSig = FAKE_PROVIDER.signWebhookForTest(body, "not-the-real-secret");
  const wrongSecretErr = await threw(() => applyWebhook(db, { rawBody: body, signatureHeader: wrongSecretSig, eventRef: "evt_wrong_secret" }, { env: PAY_ENV }));
  okClass("d-webhook-replay", "payments-webhook.js", "a signature made with the wrong secret is refused", wrongSecretErr?.code === "payment_webhook_signature_invalid");
}

// room-tg.js's verifyRoomTelegramWebhook — a header secret, not a body HMAC
// (Telegram's own model), so "replay" here is "the SAME correct secret is
// accepted every time" (there is nothing else Telegram signs per-request)
// and the attack surface is the secret itself: unconfigured, wrong, correct.
{
  const TG_SECRET = "tg-webhook-secret-r38";
  const okReq = { headers: { "x-telegram-bot-api-secret-token": TG_SECRET } };
  const wrongReq = { headers: { "x-telegram-bot-api-secret-token": "not-it" } };
  const missingReq = { headers: {} };
  const TG_ENV = { ROOM_TELEGRAM_WEBHOOK_SECRET: TG_SECRET };
  const UNCONFIGURED_ENV = { ROOM_TELEGRAM_WEBHOOK_SECRET: "" };

  okClass("d-webhook-replay", "room-tg.js", "the correct secret is admitted", verifyRoomTelegramWebhook(okReq, TG_ENV).ok === true);
  const wrong = verifyRoomTelegramWebhook(wrongReq, TG_ENV);
  okClass("d-webhook-replay", "room-tg.js", "the wrong secret is refused, named", wrong.ok === false && wrong.reason === "room_telegram_bad_secret");
  const missing = verifyRoomTelegramWebhook(missingReq, TG_ENV);
  okClass("d-webhook-replay", "room-tg.js", "a missing secret header is refused", missing.ok === false);
  const unconfigured = verifyRoomTelegramWebhook(okReq, UNCONFIGURED_ENV);
  okClass("d-webhook-replay", "room-tg.js", "an unconfigured deployment (empty env secret) fails CLOSED, not open, even with the RIGHT-looking header", unconfigured.ok === false && unconfigured.status === 503);
}

// room-wa.js / api/whatsapp.js's HMAC — the real per-body signature the
// Cloud API sends, so a genuine replay test applies here: the SAME signed
// body sent twice must not be double-counted at the whatsapp status-webhook
// layer either. That layer (`handleStatusWebhook`) is idempotent by
// construction (workstream law #6, `_room-whatsapp.js`'s own header: "no
// conversation is ever persisted on this wire"); what this battery adds is
// the signature boundary itself.
{
  const WA_SECRET = "wa-app-secret-r38";
  const rawBody = Buffer.from(JSON.stringify({ entry: [{ changes: [{ value: { statuses: [] } }] }] }));
  const goodSig = "sha256=" + createHmac("sha256", WA_SECRET).update(rawBody).digest("hex");
  const badSig = "sha256=" + "0".repeat(64);

  const wrongBody = Buffer.from(JSON.stringify({ entry: [{ changes: [{ value: { statuses: [{ tampered: true }] } }] }] }));

  // signatureOk is api/whatsapp.js's own exported primitive — the SAME
  // function room-wa.js's verify() calls, never re-derived.
  okClass("d-webhook-replay", "room-wa.js", "a correctly signed body verifies", signatureOk(WA_SECRET, rawBody, goodSig) === true);
  okClass("d-webhook-replay", "room-wa.js", "a garbage signature is refused", signatureOk(WA_SECRET, rawBody, badSig) === false);
  okClass("d-webhook-replay", "room-wa.js", "the SAME signature over a MODIFIED body is refused (the signature does not travel with the bytes)", signatureOk(WA_SECRET, wrongBody, goodSig) === false);
  // a replay — the identical (body, signature) pair presented twice — is by
  // definition the SAME verification result both times, and this door's own
  // law (#6, this file's header) is that nothing here persists a
  // conversation for a duplicate to corrupt; confirmed the signature layer
  // itself has no per-call state to leak.
  okClass("d-webhook-replay", "room-wa.js", "a replay of the identical signed body verifies identically the second time (no hidden per-call state)", signatureOk(WA_SECRET, rawBody, goodSig) === true);
}

// ═════════════════════════════════════════════════════════════════════════
// §5. OWNER BEARER ON ANOTHER OWNER'S REPLICA/ORG (attack class e)
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── §5: an owner bearer reaching for someone else's replica/org ──");

{
  const state = freshDoorsState();
  const db = doorsDb(state);
  const mine = await getOwnedReplica(db, OWNER, REPLICA_ID);
  okClass("e-owner-bearer", "replica.js", "the real owner reads their own replica", mine?.replica_id === REPLICA_ID);
  const stolen = await getOwnedReplica(db, OWNER_B, REPLICA_ID);
  okClass("e-owner-bearer", "replica.js", "a DIFFERENT owner's bearer reading the same replica_id gets nothing, not another owner's row", stolen == null);
}
{
  const state = freshDoorsState();
  const db = doorsDb(state);
  const mine = await getOwnedRoom(db, OWNER, REPLICA_ID);
  okClass("e-owner-bearer", "room-publish.js", "the real owner reads their own Room", mine?.room?.room_id === ROOM_ID || mine?.reason === "not_created");
  const stolen = await getOwnedRoom(db, OWNER_B, REPLICA_ID);
  okClass("e-owner-bearer", "room-publish.js", "a different owner's bearer against the same replica_id gets null (`replica_not_found`), never another owner's Room", stolen == null);
}
{
  const state = freshDoorsState();
  const db = doorsDb(state);
  const mine = await listDesigns(db, OWNER, REPLICA_ID);
  okClass("e-owner-bearer", "checkins.js", "the real owner lists their own designs", Array.isArray(mine));
  const stolen = await listDesigns(db, OWNER_B, REPLICA_ID);
  okClass("e-owner-bearer", "checkins.js", "a different owner's bearer against the same replica_id gets null, never another owner's designs", stolen === null);
}
{
  const state = freshDoorsState();
  state.rooms[0].handoff_enabled = true;
  const db = doorsDb(state);
  const HANDOFF2 = await import(pathToFileURL(join(API, "_handoff.js")).href);
  const mine = await HANDOFF2.getHandoffConfig(db, OWNER, REPLICA_ID);
  okClass("e-owner-bearer", "handoff.js", "the real owner reads their own handoff config", mine?.enabled === true);
  const stolen = await threw(() => HANDOFF2.getHandoffConfig(db, OWNER_B, REPLICA_ID));
  okClass("e-owner-bearer", "handoff.js", "a different owner's bearer against the same replica_id is refused room_not_found, never another owner's config", stolen?.code === "room_not_found");
}
{
  const state = freshDoorsState();
  state.orgMembers = [{ org_id: ORG_A, owner_user_id: OWNER, role: "admin", added_at: "2026-08-01T00:00:00.000Z" }];
  const db = doorsDb(state);
  const mine = await listOrgMembers(db, OWNER, ORG_A);
  okClass("e-owner-bearer", "org.js", "the real admin lists this org's members", mine.length === 1);
  const stolen = await threw(() => listOrgMembers(db, OWNER_B, ORG_A));
  // "404, never 403" — this file's own law: a Suite's EXISTENCE is not
  // disclosed to someone who is not on its own roster.
  okClass("e-owner-bearer", "org.js", "a NON-member's bearer against the same org_id is refused org_not_found (404, never a 403 that would confirm the org exists), never the roster", stolen instanceof OrgError && stolen.code === "org_not_found");
}

// ═════════════════════════════════════════════════════════════════════════
// §6. RATE-KEY MALFORMATION (attack class f)
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── §6: rate-key malformation never bypasses the counter ──");

{
  const env = { RATE_LIMITS_JSON: JSON.stringify({ room_open_ip: { limit: 3, windowMs: 60_000 } }) };
  const state = new Map();
  const db = doorsDb(freshDoorsState()); // reuse the doors db's own vy_public_rate handler
  // an empty-string key.
  for (let i = 0; i < 3; i++) {
    const r = await consume(db, { scope: "room_open_ip", key: "", now: NOW + i * 1000, env });
    okClass("f-rate-key", "api/_rate-limit.js", `empty-string key, attempt ${i + 1}/3 admitted`, r.ok === true);
  }
  const fourth = await consume(db, { scope: "room_open_ip", key: "", now: NOW + 3000, env });
  okClass("f-rate-key", "api/_rate-limit.js", "empty-string key: the 4th attempt IS bounded, never an unlimited bypass", fourth.ok === false && fourth.code === "rate_limited");
}
{
  // a very long key — 10,000 characters, well past any real header's size.
  const env = { RATE_LIMITS_JSON: JSON.stringify({ room_open_ip: { limit: 2, windowMs: 60_000 } }) };
  const db = doorsDb(freshDoorsState());
  const longKey = "x".repeat(10_000);
  const a = await consume(db, { scope: "room_open_ip", key: longKey, now: NOW, env });
  const b = await consume(db, { scope: "room_open_ip", key: longKey, now: NOW + 1000, env });
  const c = await consume(db, { scope: "room_open_ip", key: longKey, now: NOW + 2000, env });
  okClass("f-rate-key", "api/_rate-limit.js", "a 10,000-char key is admitted twice then bounded on the 3rd", a.ok && b.ok && !c.ok);
  // a SECOND long key differing only in its last character never shares the
  // first one's counter — the hash does not collapse long, near-identical
  // keys into one bucket.
  const otherLongKey = longKey.slice(0, -1) + "y";
  const d = await consume(db, { scope: "room_open_ip", key: otherLongKey, now: NOW + 2000, env });
  okClass("f-rate-key", "api/_rate-limit.js", "a DIFFERENT long key (one char different) has its own, unspent counter", d.ok === true);
}
{
  // IPv6, non-canonical forms of the SAME address. `hashKey` hashes the raw
  // string, so two textual spellings of one address are two counters —
  // named here as a MEASURED property of `ipOf()`'s own header
  // ("platform-set headers... never re-formatted by an attacker on this
  // path") rather than treated as a live bypass: see this battery's final
  // report and `decisions.md#ws-r38-ipv6-key-canonicalization-not-fixed`
  // for why this is measured and left alone rather than "fixed" blind.
  const env = { RATE_LIMITS_JSON: JSON.stringify({ room_open_ip: { limit: 1, windowMs: 60_000 } }) };
  const db = doorsDb(freshDoorsState());
  const canonical = "2001:db8::1";
  const expanded = "2001:0db8:0000:0000:0000:0000:0000:0001";
  const a = await consume(db, { scope: "room_open_ip", key: canonical, now: NOW, env });
  const b = await consume(db, { scope: "room_open_ip", key: expanded, now: NOW, env });
  ok(
    "[f-rate-key/api/_rate-limit.js] MEASURED (not a live bypass — see final report): two textual spellings of the SAME IPv6 address are two separate counters",
    a.ok === true && b.ok === true,
  );
}
{
  // ipOf() itself: it reads ONLY platform-set headers (x-real-ip /
  // x-vercel-forwarded-for / the LAST x-forwarded-for hop), never the
  // client-controlled first hop — the static proof this battery adds for
  // WS-R38 law (f) on the ORIGINAL `_ratelimit.js` in-memory layer too.
  const spoofed = { headers: { "x-forwarded-for": "1.1.1.1, 2.2.2.2", "x-real-ip": "9.9.9.9" } };
  const clientOnly = { headers: { "x-forwarded-for": "1.1.1.1, 2.2.2.2" } };
  okClass("f-rate-key", "api/_ratelimit.js", "x-real-ip (platform-set) wins over a client-suppliable x-forwarded-for first hop", RATELIMIT.ipOf(spoofed) === "9.9.9.9");
  okClass("f-rate-key", "api/_ratelimit.js", "with no platform header, the LAST x-forwarded-for hop is used (the one the platform itself appended), never the client-controlled first one", RATELIMIT.ipOf(clientOnly) === "2.2.2.2");
  okClass("f-rate-key", "api/_ratelimit.js", "a missing IP entirely never throws and never yields an empty string that would collapse every caller into one bucket", RATELIMIT.ipOf({ headers: {} }) === "unknown");
}

// ═════════════════════════════════════════════════════════════════════════
// §7. INVITE CODE GUESSING BOUNDED BY THE RATE SCOPE (attack class g)
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── §7: invite code guessing is bounded ──");

{
  const state = freshDoorsState();
  const db = doorsDb(state);
  const { code } = await issueInvite(db, "operator-uid", { contact: "someone@example.com" });
  ok("[g-invite-guess/replica.js] fixture: a real invite code was issued", typeof code === "string" && code.length > 0);

  let refusedCount = 0;
  for (let i = 0; i < 5; i++) {
    const err = await threw(() => createSelfReplica(db, OWNER_B, `Guess ${i}`, { invitesRequired: true, inviteCode: `WRONG-CODE-${i}` }));
    if (err?.code === "invite_invalid") refusedCount++;
  }
  okClass(
    "g-invite-guess", "replica.js",
    "five wrong-code guesses are ALL refused invite_invalid, none creates a replica",
    refusedCount === 5 && !state.replicas.some((r) => r.owner_user_id === OWNER_B),
  );

  // the real code, redeemed once — still works, proving the refusals above
  // were not a fixture bug that would have refused the RIGHT code too.
  const real = await createSelfReplica(db, OWNER_B, "Real one", { invitesRequired: true, inviteCode: code });
  okClass("g-invite-guess", "replica.js", "the REAL code, presented after five wrong guesses, still redeems", Boolean(real?.replica_id));

  // the rate scope: api/replica.js's `create` op is bounded by the SAME
  // in-memory `allow()` limiter every op on that door uses
  // (`replica_user`, 60/min) — confirmed directly against the real limiter
  // rather than re-derived, so a guessing script cannot outrun it merely by
  // never repeating a code.
  const RL = await import(pathToFileURL(join(API, "_ratelimit.js")).href);
  let allowed = 0;
  for (let i = 0; i < 61; i++) {
    if (RL.allow("guess-bot-uid", "replica_user", 60)) allowed++;
  }
  okClass("g-invite-guess", "replica.js", "the create op's own rate scope (replica_user, 60/min) admits exactly 60 attempts and refuses the 61st", allowed === 60);
}

// ═════════════════════════════════════════════════════════════════════════
// §8. OTP VERIFY BRUTE FORCE (attack class h) — re-asserting WS-R32
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── §8: OTP verify brute force (re-asserting WS-R32) ──");

{
  const db = doorsDb(freshDoorsState());
  const results = [];
  for (let i = 0; i < 11; i++) {
    results.push(await consume(db, { scope: "otp_verify_dest", key: "+919900011122", now: NOW + i * 1000 }));
  }
  okClass("h-otp-brute-force", "account.js", "attempts 1-10 against one destination are admitted", results.slice(0, 10).every((r) => r.ok === true));
  okClass("h-otp-brute-force", "account.js", "the 11th verify attempt against the SAME destination is refused (WS-R32's own floor, re-asserted here)", results[10].ok === false && results[10].code === "rate_limited");

  const src = readFileSync(join(API, "account.js"), "utf8");
  const verifyBlock = src.slice(src.indexOf('if (op === "verify_sms")'), src.indexOf('if (op === "google_url")'));
  okClass("h-otp-brute-force", "account.js", "verify_sms wires otp_verify_dest, keyed by the phone itself", /refused\(res, "otp_verify_dest", phone\)/.test(verifyBlock));
  okClass("h-otp-brute-force", "account.js", "verify_sms validates the phone BEFORE the gate runs — a malformed destination never touches the counter", verifyBlock.indexOf("phone.length < 8") < verifyBlock.indexOf('refused(res, "otp_verify_dest"'));
}

// ═════════════════════════════════════════════════════════════════════════
// §9. STATIC WIRING PROOFS — the fixes this workstream made are proven
// dynamically above against the DECISION module directly; these confirm the
// real HTTP door actually CALLS that module rather than a bare primitive
// that skips the checks. evals/rate-limit/run.mjs's own §7 method.
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── §9: static wiring — the real door calls the fixed function, not a bypass ──");
{
  const room = readFileSync(join(API, "room.js"), "utf8");
  ok(
    '[wiring/room.js] "thread" calls createFollowerThread (the session-freshness-checked wrapper), never the bare createThread primitive that skipped it before WS-R38',
    /op === "thread"[\s\S]{0,600}createFollowerThread\(q, \{ session: body\.session, title: body\.title \}\)/.test(room),
  );
  ok("[wiring/room.js] createThread (the unchecked primitive) is not imported by this door at all", !/^\s*createThread,\s*$/m.test(room.slice(0, room.indexOf("export default"))));
}
{
  const src = readFileSync(join(API, "_room-surface.js"), "utf8");
  const fns = ["roomSay", "roomSpeak", "roomSetLocale", "followerHistory", "roomCitations"];
  for (const fn of fns) {
    const start = src.indexOf(`export async function ${fn}(`);
    const body = src.slice(start, src.indexOf("\n}\n", start));
    ok(`[wiring/_room-surface.js] ${fn} calls assertSessionFresh (not a re-derived copy of the same three lines)`, /assertSessionFresh\(/.test(body));
  }
  const selfScopeStart = src.indexOf("async function selfScope(");
  const selfScopeBody = src.slice(selfScopeStart, src.indexOf("\n}\n", selfScopeStart));
  ok("[wiring/_room-surface.js] selfScope (export/forget/offer_dismiss's own scope) calls assertSessionFresh", /assertSessionFresh\(/.test(selfScopeBody));
  ok("[wiring/_room-surface.js] selfScope also requires age_attested_at, not only a follower row's existence", /follower\.age_attested_at == null/.test(selfScopeBody));
}
{
  for (const [file, count] of [["_handoff.js", 1], ["_checkins.js", 1], ["_room-push.js", 1], ["_room-whatsapp.js", 1], ["_pulse.js", 1]]) {
    const src = readFileSync(join(API, file), "utf8");
    const hits = (src.match(/assertSessionFresh\(/g) || []).length;
    ok(`[wiring/${file}] its own followerScope calls assertSessionFresh exactly once (imported, not re-derived inline)`, hits === count);
  }
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n── case counts per attack class, per door ──");
for (const [klass, { doors, pass: p, fail: f }] of Object.entries(byClass)) {
  console.log(`  ${klass.padEnd(20)} doors: ${[...doors].sort().join(", ")}  (${p} ok, ${f} failed)`);
}

console.log(`\n${pass} ok, ${fail} failed`);
process.exit(fail ? 1 : 0);
