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
// `_org.js`, `_replica.js`, `_apply.js`, `_invites.js`, `_pulse.js`,
// `_ops.js` [WS-R62, migration 114]), OR ARE `api/account.js` by name —
// the one door in the brief that owns no shared
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
// WS-R44: three more GET-only doors joined `api/` after WS-R38 and are
// excluded on the SAME rule (a), named rather than silently dropped —
// `decisions.md#ws-r44-get-doors-do-not-belong-in-the-door-list`:
// `api/room-embed.js` (`?slug=`), `api/creators.js` (`?cursor=`) and
// `api/sitemap.js` (no query identity at all). None reads `req.body`, none
// mints or consumes a Room session, and none accepts a bearer — every one is
// PUBLIC BY DESIGN (their own file headers say so in as many words), so
// there is no forged credential for class (a) to tamper with, no session to
// cross a Room boundary with for class (b), and no owner identity for class
// (e) to steal. `api/room-embed.js`'s own `?slug=` read and
// `api/creators.js`'s own `?cursor=` read both go through `resolveRoom`/
// the SAME "does not exist" and "not published" collapse this file's own
// header already names for `stats`/`open` — an unknown slug and a paused one
// answer byte-identically, which is the ENTIRE guarantee a public GET door
// needs and already has, proven by `evals/room-embed/run.mjs` and
// `evals/creator-directory/run.mjs` respectively. Extending law 1's rule (a)
// to admit a bodyless GET would not add a real attack surface; it would add
// three doors' worth of assertions with no applicable class under this
// file's own attack-class taxonomy (a)-(h) above — dead weight a future
// reader would have to prove is dead weight all over again.
//
// ── ATTACK CLASSES, AND WHERE EACH APPLIES ──────────────────────────────────
//
//   (a) forged session      — every session-consuming door
//   (b) cross-Room session  — every door that resolves a room off a session
//   (c) body-supplied ids   — every door that takes a body id alongside a
//                              session or an owner bearer
//   (d) webhook replay      — payments-webhook.js, payout-webhook.js, room-tg.js, room-wa.js
//   (e) owner bearer on another owner's replica/org — org.js, replica.js,
//       room-publish.js, checkins.js, handoff.js (owner ops), ops.js
//       (WS-R62: a non-operator bearer against the platform-operator
//       allowlist, not "another owner's" resource, but the identical
//       shape — a credential that must discriminate one identity from
//       every other)
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
import { readFileSync, readdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
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
  // WS-R62 (migration 114): the ops door's own subscribe/revoke ops, the
  // first `op`-shaped body this door has ever read.
  "./_ops.js",
];
const EXPECTED_DOORS = [
  "account.js", "apply.js", "checkins.js", "handoff.js", "invites.js", "ops.js", "org.js",
  "payments-webhook.js", "payments.js", "payout-webhook.js", "pulse.js", "replica.js", "room-pay.js",
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
  roomDisclosureCard, roomSettings, roomSettingsReviewed,
  flagReply, unflagReply, followerFlags,
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
  payoutStatement, payoutStatements, registerFundAccount, retryFailedPayout,
  applyPayoutWebhook,
  // WS-R51: start_creator_subscription (payments.js) and org.js's
  // start_subscription/update_seats, three of the 27 preexisting-uncased ops.
  startCreatorSubscription, startOrgSubscription, updateOrgSeats,
} = PAYMENTS;
const FAKE_PROVIDER = await import(pathToFileURL(join(API, "_payments/providers/fake.js")).href);
const ORG = await import(pathToFileURL(join(API, "_org.js")).href);
const { listOrgMembers, attachRoom, OrgError } = ORG;
const REPLICA = await import(pathToFileURL(join(API, "_replica.js")).href);
const { getOwnedReplica, createSelfReplica } = REPLICA;
const ROOM_PUBLISH = await import(pathToFileURL(join(API, "_room-publish.js")).href);
const { getOwnedRoom, listRoom, unlistRoom, setRoomBio, RoomPublishError } = ROOM_PUBLISH;
const INVITES = await import(pathToFileURL(join(API, "_invites.js")).href);
const { issueInvite, requireOperator, InvitesError, hashInviteCode, issueCreatorInvite, myInvites } = INVITES;
const APPLY = await import(pathToFileURL(join(API, "_apply.js")).href);
const RENEWALS = await import(pathToFileURL(join(API, "_renewals.js")).href);
const { cancelFollowerRenewal, cancelCreatorRenewal, cancelOrgRenewal } = RENEWALS;
const OPS = await import(pathToFileURL(join(API, "_ops.js")).href);
const { isOpsOwner, subscribeOperatorPush, revokeOperatorPush, operatorPushSubscriptionsFor } = OPS;
const RATE = await import(pathToFileURL(join(API, "_rate-limit.js")).href);
const { consume } = RATE;
const RATELIMIT = await import(pathToFileURL(join(API, "_ratelimit.js")).href);
const ROOM_TG = await import(pathToFileURL(join(API, "_room-telegram.js")).href);
const { verifyRoomTelegramWebhook } = ROOM_TG;
const ROOM_WA = await import(pathToFileURL(join(API, "_room-whatsapp.js")).href);
const { verifyRoomWhatsappWebhook } = ROOM_WA;
const WHATSAPP = await import(pathToFileURL(join(API, "whatsapp.js")).href);
const { signatureOk } = WHATSAPP;
// WS-R51: the widened §18 door list's own new callers.
const FUNNEL = await import(pathToFileURL(join(API, "_funnel.js")).href);
const { markStep } = FUNNEL;
const REPLICA_ERASURE = await import(pathToFileURL(join(API, "_replica-full-erasure.js")).href);
const { getReplicaErasureStatus } = REPLICA_ERASURE;

const { loadAgent } = await loadFixtureAgent(ROOT);

const SECRET = "s".repeat(48);
const OTHER_SECRET = "t".repeat(48);
const ENV = { ROOM_SESSION_SECRET: SECRET };
// The fixture clock is the REAL clock, read once. It used to be a fixed
// calendar date (2026-09-04T12:00Z); sessions minted with `iat = NOW` were
// then judged by resolvers that default `now` to `Date.now()`, and at
// 2026-09-05T00:00Z real time crossed NOW + the 12h TTL and three cross-room
// cases plus one crash flipped to failing with no code change (found by
// WS-R57, fixed by the main loop at its merge). Every relative offset below
// (`NOW - 13h` stale, `NOW - 11h59m` fresh) keeps its meaning under both
// clocks because they now agree to within the run's own duration.
const NOW = Date.now();
// The rate cases below feed `consume()` a run of timestamps a few seconds
// apart and expect them to land in ONE window. `windowStartOf` buckets by
// calendar (floor of now over the window), so a base taken at an arbitrary
// real-clock instant can straddle a minute boundary and the "11th attempt
// refused" case flakes (seen at the WS-R51 merge, 2 of 487, absent on the
// rerun). RATE_NOW sits one minute after the top of the current hour:
// minute-aligned and far from the hour's end, so +N seconds stays in one
// minute window and in one hour window alike.
const RATE_NOW = Math.floor(NOW / 3_600_000) * 3_600_000 + 60_000;

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
  const hoErr = await threw(() => draftHandoffPayload(hoDb, { session: hoCross, note: "hi" }, { loadAgent: loadAgentTwoRooms, now: NOW, env: ENV }));
  okClass("b-cross-room", "handoff.js", "draft: cross-room session refused room_unavailable", hoErr?.code === "room_unavailable");

  const ciState = withSecondRoom(freshDoorsState());
  const ciDb = doorsDb(ciState);
  const ciJoined = await joinRoom(ciDb, { slug: SLUG, authUserId: USER_A, ageAttested: true, memoryConsent: true }, { loadAgent: loadAgentTwoRooms, now: NOW, env: ENV });
  const design = await createDesign(ciDb, OWNER, REPLICA_ID, { title: "Walk", promptShape: "x" });
  const ciCross = mintRoomSession({ ...reencodeWithSameSig(ciJoined.session).payload, r: "kabir" }, ENV);
  const ciErr = await threw(() => optIn(ciDb, { session: ciCross, designId: design.design_id, daysOfWeek: [1], localTime: "09:00", timezone: "Asia/Kolkata" }, { loadAgent: loadAgentTwoRooms, now: NOW, env: ENV }));
  okClass("b-cross-room", "checkins.js", "opt_in: cross-room session refused room_unavailable", ciErr?.code === "room_unavailable");

  // room-pay.js — the disclosure card is bound too: room A's disclosure
  // digest against room B's card (same room-B rename as above) must ALSO be
  // refused for the disclosure predicate `roomSay` runs, not only the id
  // check — confirmed once here since `paidSessionScope` shares the same
  // `resolveRoom`+id-match sequence and does not read `dd` at all (that
  // predicate is `roomSay`/`roomSpeak`'s own, see this file's header on
  // why it is scoped to ops where the AI speaks).
  const payErr = await threw(() => followerSubscriptionStatus(db, { session: crossToken }, { loadAgent: loadAgentTwoRooms, now: NOW, env: ENV }));
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
  // WS-R51: this call was missing `now: NOW` — `deps.now ?? Date.now()`
  // silently fell back to the REAL wall clock, so this test passed only
  // while the real date stayed within 12h of the fixture's fixed
  // "2026-09-04T12:00:00Z" `iat` and started failing `room_session_expired`
  // the moment it did not (found when this session's own clock crossed that
  // boundary mid-run) — a latent, date-dependent flake in the ORIGINAL
  // WS-R38 test, not a security-relevant weakening; every other call in this
  // file already pins `now: NOW`.
  const draftB = await draftHandoffPayload(db, { session: joinedB.session, note: "B's own note" }, { loadAgent, now: NOW, env: ENV });
  const sentB = await sendHandoffRequest(db, { session: joinedB.session, payloadText: draftB.payload_text, payloadSha256: draftB.payload_sha256 }, { loadAgent, now: NOW, env: ENV });
  ok("fixture: follower B's own handoff request exists", Boolean(sentB.handoff_id));

  const crossWithdraw = await threw(() => withdrawHandoffRequest(db, { session: joinedA.session, handoffId: sentB.handoff_id }, { loadAgent, now: NOW, env: ENV }));
  okClass("c-body-ids", "handoff.js", "withdraw: follower A naming follower B's own handoff_id is refused by name, never A's row", crossWithdraw?.code === "handoff_not_withdrawable");
  const stillSent = (await myHandoffs(db, { session: joinedB.session }, { loadAgent, now: NOW, env: ENV }))[0];
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

  const crossStop = await threw(() => stop(db, { session: joinedA.session, checkinId: optB.checkin_id }, { loadAgent, now: NOW, env: ENV }));
  okClass("c-body-ids", "checkins.js", "stop: follower A naming follower B's own checkin_id is refused by name", crossStop?.code === "checkin_not_found");
  const stillActive = (await listMine(db, { session: joinedB.session }, { loadAgent, now: NOW, env: ENV }))[0];
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
    loadAgent, now: NOW, env: { ...ENV, PAYMENTS_PROVIDER: "fake" }, secrets: { webhookSecret: "wh" },
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

// payout-webhook.js / api/_payments.js's applyPayoutWebhook (WS-R56,
// migration 111) — keyed by the PROVIDER's own ref, never our `payout_id`,
// with the leaving state(s) named in the WHERE.
{
  const state = freshDoorsState();
  const db = doorsDb(state);
  const PAYOUT_WH_SECRET = "payout-wh-secret-r56";
  const PAYOUT_ENV = { PAYMENTS_PROVIDER: "fake", PAYMENTS_FAKE_WEBHOOK_SECRET: PAYOUT_WH_SECRET };

  const payoutId = "f1000000-0000-4000-8000-000000000001";
  const providerRef = "fake_payout_r56_001";
  state.payouts.push({
    payout_id: payoutId, owner_user_id: OWNER, period_start: "2026-08-01T00:00:00Z", period_end: "2026-09-01T00:00:00Z",
    gross_inr: 1000, take_inr: 100, net_inr: 800, tds_inr: 100, suite_share_inr: 0,
    provider_payout_ref: providerRef, state: "queued", created_at: "2026-09-01T00:00:00Z",
  });

  const body = Buffer.from(JSON.stringify({ event: "payout.processed", payload: { payout: { entity: { id: providerRef } } } }));
  const goodSig = FAKE_PROVIDER.signWebhookForTest(body, PAYOUT_WH_SECRET);

  const first = await applyPayoutWebhook(db, { rawBody: body, headers: { "x-razorpay-signature": goodSig } }, { env: PAYOUT_ENV });
  okClass("d-webhook-replay", "payout-webhook.js", "a validly signed 'processed' event settles a still-queued payout (no 'sent' step ever ran)", first.applied === true && first.state === "settled" && state.payouts[0].state === "settled");

  const second = await applyPayoutWebhook(db, { rawBody: body, headers: { "x-razorpay-signature": goodSig } }, { env: PAYOUT_ENV });
  okClass("d-webhook-replay", "payout-webhook.js", "NEGATIVE CONTROL: the SAME processed event replayed against an already-settled payout is refused by the WHERE — applied:false, never a second settled_at write", second.applied === false && state.payouts[0].state === "settled");

  // signature over a MODIFIED body — flip a byte, keep the signature computed over the ORIGINAL bytes.
  const tamperedBody = Buffer.from(JSON.stringify({ event: "payout.processed", payload: { payout: { entity: { id: providerRef, note: "tampered" } } } }));
  const tamperedErr = await threw(() => applyPayoutWebhook(db, { rawBody: tamperedBody, headers: { "x-razorpay-signature": goodSig } }, { env: PAYOUT_ENV }));
  okClass("d-webhook-replay", "payout-webhook.js", "NEGATIVE CONTROL: a tampered signature admitted — refused, never applied", tamperedErr?.code === "payout_webhook_signature_invalid");

  // wrong secret entirely.
  const wrongSecretSig = FAKE_PROVIDER.signWebhookForTest(body, "not-the-real-secret");
  const wrongSecretErr = await threw(() => applyPayoutWebhook(db, { rawBody: body, headers: { "x-razorpay-signature": wrongSecretSig } }, { env: PAYOUT_ENV }));
  okClass("d-webhook-replay", "payout-webhook.js", "a signature made with the wrong secret is refused", wrongSecretErr?.code === "payout_webhook_signature_invalid");

  // 'failed' on a second, still-queued payout — the reason is recorded.
  const payoutId2 = "f1000000-0000-4000-8000-000000000002";
  const providerRef2 = "fake_payout_r56_002";
  state.payouts.push({
    payout_id: payoutId2, owner_user_id: OWNER, period_start: "2026-08-01T00:00:00Z", period_end: "2026-09-01T00:00:00Z",
    gross_inr: 500, take_inr: 50, net_inr: 400, tds_inr: 50, suite_share_inr: 0,
    provider_payout_ref: providerRef2, state: "queued", created_at: "2026-09-01T00:00:00Z",
  });
  const failBody = Buffer.from(JSON.stringify({ event: "payout.failed", payload: { payout: { entity: { id: providerRef2, failure_reason: "insufficient_balance" } } } }));
  const failSig = FAKE_PROVIDER.signWebhookForTest(failBody, PAYOUT_WH_SECRET);
  const failed = await applyPayoutWebhook(db, { rawBody: failBody, headers: { "x-razorpay-signature": failSig } }, { env: PAYOUT_ENV });
  okClass("d-webhook-replay", "payout-webhook.js", "'failed' moves a still-queued payout to failed with the provider's own reason recorded", failed.applied === true && state.payouts[1].state === "failed" && state.payouts[1].failure_reason === "insufficient_balance");

  // NEGATIVE CONTROL (law 2's own case, named in this workstream's brief):
  // a failed event replayed against an ALREADY-failed payout — the leaving
  // state ('queued'/'sent') no longer matches, so the WHERE misses and this
  // must be refused (a no-op), never re-applied or the reason overwritten.
  const replayFailed = await applyPayoutWebhook(db, { rawBody: failBody, headers: { "x-razorpay-signature": failSig } }, { env: PAYOUT_ENV });
  okClass("d-webhook-replay", "payout-webhook.js", "NEGATIVE CONTROL: a failed event without the leaving-state WHERE matching (already failed) is refused, applied:false", replayFailed.applied === false);

  // an event for an UNKNOWN provider ref — logged, never thrown, so the
  // door still answers 200 (law 2: the provider stops retrying).
  const unknownBody = Buffer.from(JSON.stringify({ event: "payout.processed", payload: { payout: { entity: { id: "fake_payout_does_not_exist" } } } }));
  const unknownSig = FAKE_PROVIDER.signWebhookForTest(unknownBody, PAYOUT_WH_SECRET);
  const unknownResult = await applyPayoutWebhook(db, { rawBody: unknownBody, headers: { "x-razorpay-signature": unknownSig } }, { env: PAYOUT_ENV });
  okClass("d-webhook-replay", "payout-webhook.js", "an event for an unknown provider ref is a content-free no-op, never a throw", unknownResult.applied === false && unknownResult.replay === false);

  // an event kind this platform does not treat as a transition.
  const ignoredBody = Buffer.from(JSON.stringify({ event: "payout.queued", payload: { payout: { entity: { id: providerRef } } } }));
  const ignoredSig = FAKE_PROVIDER.signWebhookForTest(ignoredBody, PAYOUT_WH_SECRET);
  const ignoredResult = await applyPayoutWebhook(db, { rawBody: ignoredBody, headers: { "x-razorpay-signature": ignoredSig } }, { env: PAYOUT_ENV });
  okClass("d-webhook-replay", "payout-webhook.js", "an ignored event kind (e.g. queued/initiated) changes nothing", ignoredResult.applied === false && ignoredResult.kind === "" && state.payouts[0].state === "settled");
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
    const r = await consume(db, { scope: "room_open_ip", key: "", now: RATE_NOW + i * 1000, env });
    okClass("f-rate-key", "api/_rate-limit.js", `empty-string key, attempt ${i + 1}/3 admitted`, r.ok === true);
  }
  const fourth = await consume(db, { scope: "room_open_ip", key: "", now: RATE_NOW + 3000, env });
  okClass("f-rate-key", "api/_rate-limit.js", "empty-string key: the 4th attempt IS bounded, never an unlimited bypass", fourth.ok === false && fourth.code === "rate_limited");
}
{
  // a very long key — 10,000 characters, well past any real header's size.
  const env = { RATE_LIMITS_JSON: JSON.stringify({ room_open_ip: { limit: 2, windowMs: 60_000 } }) };
  const db = doorsDb(freshDoorsState());
  const longKey = "x".repeat(10_000);
  const a = await consume(db, { scope: "room_open_ip", key: longKey, now: RATE_NOW, env });
  const b = await consume(db, { scope: "room_open_ip", key: longKey, now: RATE_NOW + 1000, env });
  const c = await consume(db, { scope: "room_open_ip", key: longKey, now: RATE_NOW + 2000, env });
  okClass("f-rate-key", "api/_rate-limit.js", "a 10,000-char key is admitted twice then bounded on the 3rd", a.ok && b.ok && !c.ok);
  // a SECOND long key differing only in its last character never shares the
  // first one's counter — the hash does not collapse long, near-identical
  // keys into one bucket.
  const otherLongKey = longKey.slice(0, -1) + "y";
  const d = await consume(db, { scope: "room_open_ip", key: otherLongKey, now: RATE_NOW + 2000, env });
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
  const a = await consume(db, { scope: "room_open_ip", key: canonical, now: RATE_NOW, env });
  const b = await consume(db, { scope: "room_open_ip", key: expanded, now: RATE_NOW, env });
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
    results.push(await consume(db, { scope: "otp_verify_dest", key: "+919900011122", now: RATE_NOW + i * 1000 }));
  }
  okClass("h-otp-brute-force", "account.js", "attempts 1-10 against one destination are admitted", results.slice(0, 10).every((r) => r.ok === true));
  okClass("h-otp-brute-force", "account.js", "the 11th verify attempt against the SAME destination is refused (WS-R32's own floor, re-asserted here)", results[10].ok === false && results[10].code === "rate_limited");

  const src = readFileSync(join(API, "account.js"), "utf8");
  const verifyBlock = src.slice(src.indexOf('if (op === "verify_sms")'), src.indexOf('if (op === "google_url")'));
  okClass("h-otp-brute-force", "account.js", "verify_sms wires otp_verify_dest, keyed by the phone itself", /refused\(res, "otp_verify_dest", phone\)/.test(verifyBlock));
  okClass("h-otp-brute-force", "account.js", "verify_sms validates the phone BEFORE the gate runs — a malformed destination never touches the counter", verifyBlock.indexOf("phone.length < 8") < verifyBlock.indexOf('refused(res, "otp_verify_dest"'));
}

// ═════════════════════════════════════════════════════════════════════════
// §9. WS-R44 — room.js's "settings" / "settings_reviewed" (WS-R39), covered
// only through the shared scope resolver before this workstream, never by a
// case of their own. Both go through `selfScope`, the identical gate
// export/forget/offer_dismiss/citations already run through above — same
// classes, same shape, no body-supplied id for either op.
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── §9: room.js settings / settings_reviewed (WS-R44) ──");
{
  const { db, session } = await setupFollower();
  await assertForgeryRefused("room.js", "settings", () => session);
  const expired = mintRoomSession({ ...reencodeWithSameSig(session).payload, iat: NOW - (13 * 60 * 60 * 1000) }, ENV);
  const settingsErr = await threw(() => roomSettings(db, { session: expired }, { loadAgent, now: NOW, env: ENV }));
  okClass("a-forged-session", "room.js", "settings: a stale session is refused (WS-R44 — this op had no case before)", settingsErr?.code === "room_session_expired");
  const reviewedErr = await threw(() => roomSettingsReviewed(db, { session: expired }, { loadAgent, now: NOW, env: ENV }));
  okClass("a-forged-session", "room.js", "settings_reviewed: a stale session is refused (WS-R44)", reviewedErr?.code === "room_session_expired");

  const ok1 = await threw(() => roomSettings(db, { session }, { loadAgent, now: NOW, env: ENV }));
  okClass("a-forged-session", "room.js", "settings: a fresh, valid session is NOT refused (the fixture itself is sound)", !(ok1 instanceof RoomError));
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
  const { payload: payloadA } = reencodeWithSameSig(joinedA.session);
  const crossToken = mintRoomSession({ ...payloadA, r: "kabir" }, ENV);
  const settingsErr = await threw(() => roomSettings(db, { session: crossToken }, { loadAgent: loadAgentTwoRooms, now: NOW, env: ENV }));
  okClass("b-cross-room", "room.js", "settings: cross-room session refused room_unavailable", settingsErr?.code === "room_unavailable");
  const reviewedErr = await threw(() => roomSettingsReviewed(db, { session: crossToken }, { loadAgent: loadAgentTwoRooms, now: NOW, env: ENV }));
  okClass("b-cross-room", "room.js", "settings_reviewed: cross-room session refused room_unavailable", reviewedErr?.code === "room_unavailable");
}

// ═════════════════════════════════════════════════════════════════════════
// §9b. WS-R67 — room.js's "flag" / "unflag" / "flags" (migration 116). Same
// classes, same shape as §9's settings/settings_reviewed: all three go
// through `selfScope`, no body-supplied id for any of them (`flag`/`unflag`
// take a reply hash, never a person/follower id; `flags` takes only the
// session). None of these three test cases reaches migration 116's own
// tables at all — every one is refused by `assertSessionFresh`/`resolveRoom`
// BEFORE `flagReply`/`unflagReply`/`followerFlags` ever issue a statement
// against them, so this door battery's own fake db needs no extension for
// the boundary this section proves (the read-back and the unique-index
// refusal are `evals/room-flags/run.mjs`'s own job).
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── §9b: room.js flag / unflag / flags (WS-R67) ──");
{
  const { db, session } = await setupFollower();
  const HASH = "a".repeat(64);
  await assertForgeryRefused("room.js", "flag", () => session);
  await assertForgeryRefused("room.js", "unflag", () => session);
  await assertForgeryRefused("room.js", "flags", () => session);

  const expired = mintRoomSession({ ...reencodeWithSameSig(session).payload, iat: NOW - (13 * 60 * 60 * 1000) }, ENV);
  const flagErr = await threw(() => flagReply(db, { session: expired, replySha256: HASH, reason: "wrong" }, { loadAgent, now: NOW, env: ENV }));
  okClass("a-forged-session", "room.js", "flag: a stale session is refused", flagErr?.code === "room_session_expired");
  const unflagErr = await threw(() => unflagReply(db, { session: expired, replySha256: HASH }, { loadAgent, now: NOW, env: ENV }));
  okClass("a-forged-session", "room.js", "unflag: a stale session is refused", unflagErr?.code === "room_session_expired");
  const flagsErr = await threw(() => followerFlags(db, { session: expired }, { loadAgent, now: NOW, env: ENV }));
  okClass("a-forged-session", "room.js", "flags: a stale session is refused", flagsErr?.code === "room_session_expired");
}
{
  const state = withSecondRoom(freshDoorsState());
  const db = doorsDb(state);
  const loadAgentTwoRooms = async (slug) => {
    if (slug === SLUG) return loadAgent(slug);
    if (slug === "kabir") return { module: {}, sheet: { name: "Kabir", slug: "kabir" } };
    throw new Error("teacher_sheet_unavailable");
  };
  const joined = await joinRoom(db, { slug: SLUG, authUserId: USER_A, ageAttested: true, memoryConsent: true }, { loadAgent: loadAgentTwoRooms, now: NOW, env: ENV });
  const { payload } = reencodeWithSameSig(joined.session);
  const crossToken = mintRoomSession({ ...payload, r: "kabir" }, ENV);
  const HASH = "b".repeat(64);
  const flagErr = await threw(() => flagReply(db, { session: crossToken, replySha256: HASH, reason: "wrong" }, { loadAgent: loadAgentTwoRooms, now: NOW, env: ENV }));
  okClass("b-cross-room", "room.js", "flag: cross-room session refused room_unavailable", flagErr?.code === "room_unavailable");
  const unflagErr = await threw(() => unflagReply(db, { session: crossToken, replySha256: HASH }, { loadAgent: loadAgentTwoRooms, now: NOW, env: ENV }));
  okClass("b-cross-room", "room.js", "unflag: cross-room session refused room_unavailable", unflagErr?.code === "room_unavailable");
  const flagsErr = await threw(() => followerFlags(db, { session: crossToken }, { loadAgent: loadAgentTwoRooms, now: NOW, env: ENV }));
  okClass("b-cross-room", "room.js", "flags: cross-room session refused room_unavailable", flagsErr?.code === "room_unavailable");
}

// ═════════════════════════════════════════════════════════════════════════
// §10. WS-R44 — room-pay.js's "cancel" (WS-R37), the third op this workstream
// was built to case: `cancelFollowerRenewal` runs through `paidSessionScope`,
// the SAME resolver `subscribe`/`status` already prove forgery-refused above
// — this is that op's own case, not a re-derivation of the resolver's own
// check.
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── §10: room-pay.js cancel (WS-R44) ──");
{
  const { db, session } = await setupFollower({ tier: "paid" });
  await setRoomPrice(db, OWNER, REPLICA_ID, 299);
  const started = await startFollowerSubscription(db, { session }, { loadAgent, now: NOW, env: { ...ENV, PAYMENTS_PROVIDER: "fake" }, secrets: { webhookSecret: "wh" } });
  ok("[c-body-ids/room-pay.js] fixture: a real subscription exists to cancel", Boolean(started.subscription_id));

  await assertForgeryRefused("room-pay.js", "cancel", () => session);
  const expired = mintRoomSession({ ...reencodeWithSameSig(session).payload, iat: NOW - (13 * 60 * 60 * 1000) }, ENV);
  const cancelErr = await threw(() => cancelFollowerRenewal(db, { session: expired }, { loadAgent, now: NOW, env: ENV }));
  okClass("a-forged-session", "room-pay.js", "cancel: a stale session is refused (WS-R44 — this op had no case before)", cancelErr?.code === "room_session_expired");

  const cancelled = await cancelFollowerRenewal(db, { session }, {
    loadAgent, now: NOW, env: { ...ENV, PAYMENTS_PROVIDER: "fake" },
    secrets: { keyId: "fake_key_id", keySecret: "fake_key_secret", webhookSecret: "wh" },
  });
  okClass("a-forged-session", "room-pay.js", "cancel: a fresh, valid session actually flips cancel_at_period_end (the fixture is sound)", cancelled?.cancel_at_period_end === true);
}
{
  const state = withSecondRoom(freshDoorsState());
  const db = doorsDb(state);
  const loadAgentTwoRooms = async (slug) => {
    if (slug === SLUG) return loadAgent(slug);
    if (slug === "kabir") return { module: {}, sheet: { name: "Kabir", slug: "kabir" } };
    throw new Error("teacher_sheet_unavailable");
  };
  const joined = await joinRoom(db, { slug: SLUG, authUserId: USER_A, ageAttested: true, memoryConsent: true }, { loadAgent: loadAgentTwoRooms, now: NOW, env: ENV });
  const { payload } = reencodeWithSameSig(joined.session);
  const crossToken = mintRoomSession({ ...payload, r: "kabir" }, ENV);
  const err = await threw(() => cancelFollowerRenewal(db, { session: crossToken }, { loadAgent: loadAgentTwoRooms, now: NOW, env: ENV }));
  okClass("b-cross-room", "room-pay.js", "cancel: cross-room session refused room_unavailable", err?.code === "room_unavailable");
}

// ═════════════════════════════════════════════════════════════════════════
// §11. WS-R44 — api/payments.js's five owner-bearer ops this workstream was
// built to case: `payout_statements`, `payout_statement`, `register_fund_
// account`, `retry_failed_payout` (WS-R36) and `cancel_creator_subscription`
// (WS-R37).
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── §11: payments.js payout / cancel_creator_subscription ops (WS-R44) ──");

{
  // payout_statements — class e: a different owner's bearer sees only their
  // OWN list, never another owner's payouts, through the plain WHERE
  // `payoutStatements`'s own SELECT names.
  const state = freshDoorsState();
  const db = doorsDb(state);
  state.payouts.push(
    { payout_id: "f0000001-0000-4000-8000-000000000001", owner_user_id: OWNER, period_start: "2026-08-01T00:00:00Z", period_end: "2026-09-01T00:00:00Z", gross_inr: 1000, take_inr: 100, net_inr: 800, tds_inr: 100, suite_share_inr: 0, provider_payout_ref: null, state: "built", created_at: "2026-09-01T00:00:00Z" },
  );
  const mine = await payoutStatements(db, OWNER);
  okClass("e-owner-bearer", "payments.js", "payout_statements: the real owner sees their own payout", mine.length === 1 && mine[0].payout_id === state.payouts[0].payout_id);
  const stolen = await payoutStatements(db, OWNER_B);
  okClass("e-owner-bearer", "payments.js", "payout_statements: a DIFFERENT owner's bearer sees an empty list, never another owner's payout", Array.isArray(stolen) && stolen.length === 0);
}
{
  // payout_statement — class c: a body-supplied payout_id belonging to
  // someone else is refused by name (null -> the door's own payout_not_found),
  // never another owner's statement — `payoutStatement`'s own WHERE names
  // BOTH payout_id and owner_user_id together.
  const state = freshDoorsState();
  const db = doorsDb(state);
  const payoutId = "f0000002-0000-4000-8000-000000000002";
  state.payouts.push({ payout_id: payoutId, owner_user_id: OWNER, period_start: "2026-08-01T00:00:00Z", period_end: "2026-09-01T00:00:00Z", gross_inr: 1000, take_inr: 100, net_inr: 800, tds_inr: 100, suite_share_inr: 0, provider_payout_ref: null, state: "built", created_at: "2026-09-01T00:00:00Z" });
  const mine = await payoutStatement(db, OWNER, payoutId);
  okClass("c-body-ids", "payments.js", "payout_statement: the real owner reads their own statement", mine?.payout_id === payoutId);
  const stolen = await payoutStatement(db, OWNER_B, payoutId);
  okClass("c-body-ids", "payments.js", "payout_statement: OWNER_B naming OWNER's own payout_id in the body gets null, never OWNER's statement", stolen == null);
}
{
  // register_fund_account — class e: two owners' fund-account rows never
  // cross, `on conflict (owner_user_id, provider)` scoped by the bearer's own
  // id, never a body-supplied one.
  const state = freshDoorsState();
  const db = doorsDb(state);
  const fakeSecrets = { keyId: "fake_key_id", keySecret: "fake_key_secret", webhookSecret: "wh" };
  const a = await registerFundAccount(db, { ownerUserId: OWNER, fundAccountRef: "fa_owner_a" }, { env: { PAYMENTS_PROVIDER: "fake" }, secrets: fakeSecrets });
  const b = await registerFundAccount(db, { ownerUserId: OWNER_B, fundAccountRef: "fa_owner_b" }, { env: { PAYMENTS_PROVIDER: "fake" }, secrets: fakeSecrets });
  okClass("e-owner-bearer", "payments.js", "register_fund_account: each owner's own reference is stored under their OWN id", a.owner_user_id === OWNER && a.fund_account_ref === "fa_owner_a");
  okClass("e-owner-bearer", "payments.js", "register_fund_account: a second owner's registration never overwrites the first owner's row", b.owner_user_id === OWNER_B && state.payoutAccounts.find((x) => x.owner_user_id === OWNER)?.fund_account_ref === "fa_owner_a");
}
{
  // retry_failed_payout — law 2(c)'s own words: "the operator gate 404s a
  // non-operator." The function itself (by its own header comment) never
  // checks ownerUserId — an operator may retry ANY creator's payout by
  // design, so the security boundary is entirely the door's `isOpsOwner`
  // check, proven both dynamically (the primitive itself) and statically
  // (the door calls it BEFORE `retryFailedPayout`, evals/rate-limit/run.mjs's
  // own §7 method).
  const OPS_ENV = { OPS_OWNER_USER_IDS: "op-uid-r44" };
  okClass("e-owner-bearer", "payments.js", "retry_failed_payout: isOpsOwner admits the configured operator", isOpsOwner("op-uid-r44", OPS_ENV) === true);
  okClass("e-owner-bearer", "payments.js", "retry_failed_payout: isOpsOwner refuses a non-operator bearer (404, never 403, decided at the door)", isOpsOwner(OWNER_B, OPS_ENV) === false);

  const src = readFileSync(join(API, "payments.js"), "utf8");
  const block = src.slice(src.indexOf('if (op === "retry_failed_payout")'));
  ok(
    '[wiring/payments.js] "retry_failed_payout" checks isOpsOwner BEFORE calling retryFailedPayout, never after',
    block.indexOf("isOpsOwner(user.id)") !== -1 &&
      block.indexOf("isOpsOwner(user.id)") < block.indexOf("retryFailedPayout("),
  );

  const state = freshDoorsState();
  const db = doorsDb(state);
  const payoutId = "f0000003-0000-4000-8000-000000000003";
  state.payouts.push({ payout_id: payoutId, owner_user_id: OWNER, period_start: "2026-08-01T00:00:00Z", period_end: "2026-09-01T00:00:00Z", gross_inr: 1000, take_inr: 100, net_inr: 800, tds_inr: 100, suite_share_inr: 0, provider_payout_ref: null, state: "failed", created_at: "2026-09-01T00:00:00Z" });
  const retryOutcome = await threw(() => retryFailedPayout(db, { payoutId }, { env: { PAYMENTS_PROVIDER: "fake" } }));
  okClass("e-owner-bearer", "payments.js", "retry_failed_payout: the real operator's retry actually moves the payout off 'failed' (the fixture is sound)", !(retryOutcome instanceof PaymentsError) && state.payouts[0].state !== "failed");
}
{
  // reconcile (WS-R42, landed beside this workstream at the merge) — the same
  // operator-only shape as retry_failed_payout: the security boundary is the
  // door's own `isOpsOwner` check, proven dynamically on the primitive and
  // statically as running BEFORE `reconcilePeriod`; a non-operator bearer gets
  // 404 by name, never 403, never a period's findings.
  const OPS_ENV = { OPS_OWNER_USER_IDS: "op-uid-r44" };
  okClass("e-owner-bearer", "payments.js", "reconcile: isOpsOwner admits the configured operator", isOpsOwner("op-uid-r44", OPS_ENV) === true);
  okClass("e-owner-bearer", "payments.js", "reconcile: isOpsOwner refuses a non-operator bearer (404, never 403, decided at the door)", isOpsOwner(OWNER_B, OPS_ENV) === false);
  const src = readFileSync(join(API, "payments.js"), "utf8");
  const block = src.slice(src.indexOf('if (op === "reconcile")'));
  ok(
    '[wiring/payments.js] "reconcile" checks isOpsOwner BEFORE calling reconcilePeriod, never after',
    block.indexOf("isOpsOwner(user.id)") !== -1 &&
      block.indexOf("reconcilePeriod(") !== -1 &&
      block.indexOf("isOpsOwner(user.id)") < block.indexOf("reconcilePeriod("),
  );
}
{
  // cancel_creator_subscription — class e: owner bearer on ANOTHER owner's
  // replica is refused, never touches OWNER's own subscription — the SAME
  // shape §5 already proves for getOwnedReplica/getOwnedRoom/listDesigns,
  // one payments op over.
  const state = freshDoorsState();
  const db = doorsDb(state);
  state.creatorSubscriptions.push({
    subscription_id: "f0000004-0000-4000-8000-000000000004", owner_user_id: OWNER, replica_id: REPLICA_ID,
    provider: "fake", provider_subscription_ref: null, state: "active", cancel_at_period_end: false, current_period_end: "2026-10-01T00:00:00Z",
  });
  const stolen = await threw(() => cancelCreatorRenewal(db, { ownerUserId: OWNER_B, replicaId: REPLICA_ID }, {}));
  okClass("e-owner-bearer", "payments.js", "cancel_creator_subscription: a DIFFERENT owner's bearer against OWNER's own replica_id is refused, never touches OWNER's subscription", stolen instanceof PaymentsError && stolen.code === "payments_subscription_not_started");
  ok("[e-owner-bearer/payments.js] cancel_creator_subscription: OWNER's own subscription is UNCHANGED by OWNER_B's attempt", state.creatorSubscriptions[0].cancel_at_period_end === false);
  const mine = await cancelCreatorRenewal(db, { ownerUserId: OWNER, replicaId: REPLICA_ID }, {});
  okClass("e-owner-bearer", "payments.js", "cancel_creator_subscription: the real owner's own cancel actually flips cancel_at_period_end (the fixture is sound)", mine.cancel_at_period_end === true);
}

// ═════════════════════════════════════════════════════════════════════════
// §12. WS-R44 — org.js's "cancel_subscription" (WS-R37), the sixth named op.
// `cancelOrgRenewal` runs through `orgAdminOrThrow`, byte-identical to the
// admin check §5 already proves refuses a non-member org_not_found — this is
// that predicate reached through the renewals cancel lane instead of
// `listOrgMembers`/`attachRoom`.
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── §12: org.js cancel_subscription (WS-R44) ──");
{
  const state = freshDoorsState();
  state.orgMembers = [{ org_id: ORG_A, owner_user_id: OWNER, role: "admin", added_at: "2026-08-01T00:00:00.000Z" }];
  state.orgSubscriptions.push({
    subscription_id: "f0000005-0000-4000-8000-000000000005", org_id: ORG_A,
    provider: "fake", provider_subscription_ref: null, state: "active", cancel_at_period_end: false, current_period_end: "2026-10-01T00:00:00Z",
  });
  const db = doorsDb(state);
  const stolen = await threw(() => cancelOrgRenewal(db, { ownerUserId: OWNER_B, orgId: ORG_A }, {}));
  okClass("e-owner-bearer", "org.js", "cancel_subscription: a NON-member's bearer is refused org_not_found (404, never a 403 that would confirm the org exists)", stolen instanceof PaymentsError && stolen.code === "org_not_found");
  ok("[e-owner-bearer/org.js] cancel_subscription: the org's own subscription is UNCHANGED by the non-member's attempt", state.orgSubscriptions[0].cancel_at_period_end === false);
  const mine = await cancelOrgRenewal(db, { ownerUserId: OWNER, orgId: ORG_A }, {});
  okClass("e-owner-bearer", "org.js", "cancel_subscription: the real admin's own cancel actually flips cancel_at_period_end (the fixture is sound)", mine.cancel_at_period_end === true);
}

// ═════════════════════════════════════════════════════════════════════════
// §13. WS-R44 — api/room-publish.js's "list" / "unlist" / "set_bio" (WS-R45,
// migration 105). All three run through `assertOwnerScope` + the SAME
// owner_user_id+replica_id WHERE §5 already proves refuses a different
// owner's bearer (null, never another owner's room) for getOwnedRoom.
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── §13: room-publish.js list / unlist / set_bio (WS-R44) ──");
{
  const state = freshDoorsState();
  const db = doorsDb(state);
  const stolenList = await listRoom(db, OWNER_B, REPLICA_ID);
  okClass("e-owner-bearer", "room-publish.js", "list: a DIFFERENT owner's bearer against OWNER's own replica_id gets null, never OWNER's room", stolenList == null);
  const mineList = await listRoom(db, OWNER, REPLICA_ID);
  okClass("e-owner-bearer", "room-publish.js", "list: the real owner's own list succeeds (the room is already published in this fixture — the fixture is sound)", mineList?.listed_at != null);
}
{
  const state = freshDoorsState();
  const db = doorsDb(state);
  await listRoom(db, OWNER, REPLICA_ID);
  const stolenUnlist = await unlistRoom(db, OWNER_B, REPLICA_ID);
  okClass("e-owner-bearer", "room-publish.js", "unlist: a DIFFERENT owner's bearer against OWNER's own replica_id gets null, never touches OWNER's own listing", stolenUnlist == null);
  ok("[e-owner-bearer/room-publish.js] unlist: OWNER's own listing is UNCHANGED by OWNER_B's attempt", state.rooms[0].listed_at != null);
  const mineUnlist = await unlistRoom(db, OWNER, REPLICA_ID);
  okClass("e-owner-bearer", "room-publish.js", "unlist: the real owner's own unlist actually clears listed_at (the fixture is sound)", mineUnlist?.listed_at == null);
}
{
  const state = freshDoorsState();
  const db = doorsDb(state);
  const stolenBio = await setRoomBio(db, OWNER_B, REPLICA_ID, "a stranger's bio");
  okClass("e-owner-bearer", "room-publish.js", "set_bio: a DIFFERENT owner's bearer against OWNER's own replica_id gets null, never writes OWNER's bio", stolenBio == null);
  ok("[e-owner-bearer/room-publish.js] set_bio: OWNER's own bio is UNCHANGED by OWNER_B's attempt", !state.rooms[0].one_line_bio);
  const mineBio = await setRoomBio(db, OWNER, REPLICA_ID, "JEE physics, one topic a day.");
  okClass("e-owner-bearer", "room-publish.js", "set_bio: the real owner's own bio write succeeds (the fixture is sound)", mineBio?.one_line_bio === "JEE physics, one topic a day.");
}

// ═════════════════════════════════════════════════════════════════════════
// §14. WS-R44 — api/invites.js's "mine_issue" / "mine_list" (WS-R47,
// migration 106). Both are scoped ENTIRELY off the verified bearer's own id
// (`issued_by_user_id`) — there is no body-supplied id for a caller to name
// someone else's account with, so the applicable class is (e): each
// creator's own quota and list never cross another creator's.
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── §14: invites.js mine_issue / mine_list (WS-R44) ──");
{
  const state = freshDoorsState();
  const db = doorsDb(state);
  const issued = await issueCreatorInvite(db, OWNER, { contact: "friend@example.com" });
  ok("[e-owner-bearer/invites.js] fixture: the real published owner can issue their own invite", Boolean(issued?.code));

  const mine = await myInvites(db, OWNER, { now: NOW });
  okClass("e-owner-bearer", "invites.js", "mine_list: the real owner sees their own issued invite", mine.invites.length === 1 && mine.quota.used === 1);
  const others = await myInvites(db, OWNER_B, { now: NOW });
  okClass("e-owner-bearer", "invites.js", "mine_list: a DIFFERENT creator's bearer sees an empty list and a fresh quota, never OWNER's invite", others.invites.length === 0 && others.quota.used === 0);

  // OWNER_B has never published a Room in this fixture (only OWNER has), so
  // their own issue is refused by the SAME quota_ok predicate's second
  // clause — never a cross-owner leak, a different, honest refusal reason.
  const refused = await threw(() => issueCreatorInvite(db, OWNER_B, { contact: "x@example.com" }));
  okClass("e-owner-bearer", "invites.js", "mine_issue: an unpublished creator's own issue is refused by their OWN standing, never by another creator's quota", refused instanceof InvitesError && refused.code === "creator_invite_unavailable");
}

// ═════════════════════════════════════════════════════════════════════════
// §15. STATIC WIRING PROOFS — the fixes this workstream made are proven
// dynamically above against the DECISION module directly; these confirm the
// real HTTP door actually CALLS that module rather than a bare primitive
// that skips the checks. evals/rate-limit/run.mjs's own §7 method.
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── §15: static wiring — the real door calls the fixed function, not a bypass ──");
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
    // WS-R44: room.js's "locale" and "speak" ops (roomSetLocale/roomSpeak)
    // have no DYNAMIC cross-room case in §2 — this is their class-b coverage,
    // the same room_id-vs-payload.i match §2 already exercises dynamically
    // for say/history/export/citations, confirmed present in EVERY one of
    // these five functions rather than re-derived per function.
    ok(`[wiring/_room-surface.js] ${fn} checks resolved.room.room_id against the session's own claim before doing anything else (class b, room.js's "locale"/"speak" own coverage — WS-R44)`, /String\(resolved\.room\.room_id\) !== String\(payload\.i\)/.test(body));
  }
  const selfScopeStart = src.indexOf("async function selfScope(");
  const selfScopeBody = src.slice(selfScopeStart, src.indexOf("\n}\n", selfScopeStart));
  ok("[wiring/_room-surface.js] selfScope (export/forget/offer_dismiss's own scope) calls assertSessionFresh", /assertSessionFresh\(/.test(selfScopeBody));
  ok("[wiring/_room-surface.js] selfScope also requires age_attested_at, not only a follower row's existence", /follower\.age_attested_at == null/.test(selfScopeBody));
}
{
  // WS-R44: room.js's "pulse_optin"/"pulse_revoke" (via _pulse.js), "push_
  // subscribe"/"push_unsubscribe"/"push_status" (via _room-push.js) and
  // "whatsapp_optin"/"whatsapp_stop"/"whatsapp_status" (via _room-whatsapp.js)
  // have no case of their own in this file: each door's own `followerScope`
  // is the SAME assertSessionFresh-plus-room-id-match shape `selfScope`
  // above and §2's dynamic cross-room cases already prove — this extends the
  // existing class-a proof (assertSessionFresh) with the matching class-b
  // proof (the room-id match) so BOTH halves of every one of these ops'
  // coverage are on record, not only the half WS-R38 originally checked.
  for (const [file, count] of [["_handoff.js", 1], ["_checkins.js", 1], ["_room-push.js", 1], ["_room-whatsapp.js", 1], ["_pulse.js", 1]]) {
    const src = readFileSync(join(API, file), "utf8");
    const hits = (src.match(/assertSessionFresh\(/g) || []).length;
    ok(`[wiring/${file}] its own followerScope calls assertSessionFresh exactly once (imported, not re-derived inline)`, hits === count);
    const scopeStart = src.indexOf("async function followerScope(");
    const scopeBody = scopeStart === -1 ? "" : src.slice(scopeStart, src.indexOf("\n}\n", scopeStart));
    ok(`[wiring/${file}] its own followerScope checks resolved.room.room_id against the session's own claim (class b — WS-R44)`, /String\(resolved\.room\.room_id\) !== String\(payload\.i\)/.test(scopeBody));
  }
}

// ═════════════════════════════════════════════════════════════════════════
// §16. WS-R51 — THE 27 PREEXISTING-UNCASED OWNER-BEARER OPS. WS-R44's own
// `OP_COVERAGE` table (see §18 below) named 27 owner-bearer ops on seven
// doors with no case of their own, class "preexisting-uncased"
// (`decisions.md#ws-r44-computed-op-list-scoped-to-six-named-doors`). Every
// one gets a real dynamic case here, through the REAL decision module, per
// this workstream's own law 1 — the class each op ends up under in §18's
// table is decided by what its OWN predicate actually is, not by a fixed
// menu: most are class (e) (an owner bearer reaching for someone else's
// row), a few are scoping proofs (two owners' own writes never collide) for
// an op with no cross-owner input at all — `list_mine`'s own shape, this
// file's `payout_statements`/`mine_list` precedent one workstream over.
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── §16: the 27 preexisting-uncased owner-bearer ops (WS-R51) ──");

// ── payments.js: set_price, start_creator_subscription ─────────────────────
{
  const state = freshDoorsState();
  const db = doorsDb(state);
  const mine = await setRoomPrice(db, OWNER, REPLICA_ID, 349);
  okClass("e-owner-bearer", "payments.js", "set_price: the real owner's own price write succeeds (the fixture is sound)", mine?.follower_price_inr === 349);
  const stolen = await setRoomPrice(db, OWNER_B, REPLICA_ID, 349);
  okClass("e-owner-bearer", "payments.js", "set_price: a DIFFERENT owner's bearer against OWNER's own replica_id gets null, never writes OWNER's price", stolen == null);
  ok("[e-owner-bearer/payments.js] set_price: OWNER's own price is UNCHANGED by OWNER_B's attempt", state.prices.find((p) => p.room_id === ROOM_ID)?.follower_price_inr === 349);
}
{
  // start_creator_subscription — WS-R51's own FIX: `ownedReplicaHandle` used
  // to validate ONLY the shape of `replicaId`, trusting "the caller already
  // knows" it is their own (see api/_payments.js's own comment, now
  // rewritten). A body-supplied `replica_id` belonging to ANOTHER owner is
  // class (c): refused by name, never silently minting a
  // `vy_creator_subscription` row that binds one owner's id to another
  // owner's replica.
  const state = freshDoorsState();
  const db = doorsDb(state);
  const stolen = await threw(() => startCreatorSubscription(db, { ownerUserId: OWNER_B, replicaId: REPLICA_ID, plan: "room" }, { env: { PAYMENTS_PROVIDER: "fake" } }));
  okClass("c-body-ids", "payments.js", "start_creator_subscription: a body-supplied replica_id belonging to a DIFFERENT owner is refused, never subscribed (WS-R51 fix)", stolen?.code === "creator_tier_replica_not_owned");
  ok("[c-body-ids/payments.js] start_creator_subscription: zero vy_creator_subscription rows were written for OWNER_B's attempt", state.creatorSubscriptions.length === 0);
  // The real owner's own replica_id passes the SAME new ownership gate — the
  // door battery's own scope is this boundary, not the whole subscribe flow
  // downstream of it (already `evals/org-billing`/`evals/payments-reconcile`'s
  // own subject); the fixture does not model the INSERT past the gate, so a
  // sound positive result here is "not refused for OWNERSHIP", never a null
  // or an ownership-shaped error.
  const mineOutcome = await threw(() => startCreatorSubscription(db, { ownerUserId: OWNER, replicaId: REPLICA_ID, plan: "room" }, { env: { PAYMENTS_PROVIDER: "fake" }, secrets: { keyId: "k", keySecret: "s", webhookSecret: "wh" } }));
  okClass("c-body-ids", "payments.js", "start_creator_subscription: the real owner's own replica_id passes the ownership gate (a DIFFERENT, later failure than creator_tier_replica_not_owned — the fixture and the fix are both sound)", mineOutcome?.code !== "creator_tier_replica_not_owned");
}

// ── org.js: create, invite, accept, detach_room, board, start_subscription,
//    update_seats, list_mine, room_status ───────────────────────────────────
{
  // create: no cross-owner input exists for this op (it only ever creates
  // the CALLING bearer's own org+admin row, `room.js`'s "open"/"join" own
  // shape) — the real dynamic case is a scoping proof, two owners' own orgs
  // never collide or leak into each other.
  const state = freshDoorsState();
  const db = doorsDb(state);
  const orgA = await ORG.createOrg(db, OWNER, { name: "Anjali's Suite", seatLimit: 5 });
  const orgB = await ORG.createOrg(db, OWNER_B, { name: "A Second Suite", seatLimit: 3 });
  okClass("e-owner-bearer", "org.js", "create: two different owners' own orgs never collide", orgA.org_id !== orgB.org_id && orgA.slug !== orgB.slug);
  const adminA = state.orgMembers.find((m) => m.org_id === orgA.org_id);
  okClass("e-owner-bearer", "org.js", "create: the CREATING owner's own admin row is written, never a body-supplied one", adminA?.owner_user_id === OWNER);
}
{
  const state = freshDoorsState();
  state.orgs.push({ org_id: ORG_A, name: "Anjali's Suite", slug: "anjalis-suite", plan: "starter", seat_limit: 5, created_at: "2026-08-01T00:00:00.000Z" });
  state.orgMembers = [{ org_id: ORG_A, owner_user_id: OWNER, role: "admin", added_at: "2026-08-01T00:00:00.000Z" }];
  const db = doorsDb(state);
  const mine = await ORG.inviteMember(db, OWNER, ORG_A);
  okClass("e-owner-bearer", "org.js", "invite: the real admin invites into their own Suite", mine?.org_id === ORG_A);
  const stolen = await threw(() => ORG.inviteMember(db, OWNER_B, ORG_A));
  okClass("e-owner-bearer", "org.js", "invite: a NON-member's bearer against the same org_id is refused org_not_found (404, never 403)", stolen instanceof OrgError && stolen.code === "org_not_found");
}
{
  const state = freshDoorsState();
  state.orgs.push({ org_id: ORG_A, name: "Anjali's Suite", slug: "anjalis-suite", plan: "starter", seat_limit: 5, created_at: "2026-08-01T00:00:00.000Z" });
  const db = doorsDb(state);
  const acceptedB = await ORG.acceptMembership(db, OWNER_B, ORG_A);
  okClass("e-owner-bearer", "org.js", "accept: a creator's own acceptMembership writes their OWN row", acceptedB.owner_user_id === OWNER_B && acceptedB.role === "creator");
  ok("[e-owner-bearer/org.js] accept: nobody else's membership row was touched by OWNER_B's own accept", state.orgMembers.length === 1 && state.orgMembers[0].owner_user_id === OWNER_B);
  const unknownOrg = await threw(() => ORG.acceptMembership(db, OWNER, "ffffffff-0000-4000-8000-000000000000"));
  okClass("e-owner-bearer", "org.js", "accept: an unknown org_id is refused org_not_found, never a phantom membership", unknownOrg instanceof OrgError && unknownOrg.code === "org_not_found");
}
{
  // detach_room: the room's own owner OR an admin of its attached org may
  // detach it; a random third party (neither) may not. `evals/room-doors`'s
  // own attach_room precedent (§3) tolerates any OrgError rather than the
  // one specific code this fixture's own simplified diag path would report —
  // the same discipline, restated: this op's write predicate, not its
  // courtesy-layer wording, is what is under test.
  const state = freshDoorsState();
  state.orgs.push({ org_id: ORG_A, name: "Anjali's Suite", slug: "anjalis-suite", plan: "starter", seat_limit: 5, created_at: "2026-08-01T00:00:00.000Z" });
  state.orgMembers = [{ org_id: ORG_A, owner_user_id: OWNER, role: "admin", added_at: "2026-08-01T00:00:00.000Z" }];
  state.rooms[0].org_id = ORG_A;
  const db = doorsDb(state);
  const stolen = await threw(() => ORG.detachRoom(db, OWNER_B, ROOM_ID));
  okClass("e-owner-bearer", "org.js", "detach_room: a bearer who is neither the room's own owner nor an admin of its org is refused, never detaches it", stolen instanceof OrgError);
  ok("[e-owner-bearer/org.js] detach_room: the room's own org_id is UNCHANGED by the stranger's attempt", state.rooms[0].org_id === ORG_A);
  const mine = await ORG.detachRoom(db, OWNER, ROOM_ID);
  okClass("e-owner-bearer", "org.js", "detach_room: the room's own owner detaches it themselves, no admin role required (self-service exit, the fixture is sound)", mine?.org_id === null);
}
{
  const state = freshDoorsState();
  state.orgs.push({ org_id: ORG_A, name: "Anjali's Suite", slug: "anjalis-suite", plan: "starter", seat_limit: 5, created_at: "2026-08-01T00:00:00.000Z" });
  state.orgMembers = [{ org_id: ORG_A, owner_user_id: OWNER, role: "admin", added_at: "2026-08-01T00:00:00.000Z" }];
  const db = doorsDb(state);
  const mine = await ORG.orgBoard(db, ORG_A, OWNER, NOW);
  okClass("e-owner-bearer", "org.js", "board: the real admin reads their own Suite's board", mine?.org?.org_id === ORG_A);
  const stolen = await threw(() => ORG.orgBoard(db, ORG_A, OWNER_B, NOW));
  okClass("e-owner-bearer", "org.js", "board: a NON-member's bearer against the same org_id is refused org_not_found (404, never the roster or a Room's own counts)", stolen instanceof OrgError && stolen.code === "org_not_found");
}
{
  const state = freshDoorsState();
  state.orgs.push({ org_id: ORG_A, name: "Anjali's Suite", slug: "anjalis-suite", plan: "starter", seat_limit: 5, created_at: "2026-08-01T00:00:00.000Z" });
  state.orgMembers = [{ org_id: ORG_A, owner_user_id: OWNER, role: "admin", added_at: "2026-08-01T00:00:00.000Z" }];
  const db = doorsDb(state);
  const stolen = await threw(() => startOrgSubscription(db, { ownerUserId: OWNER_B, orgId: ORG_A, plan: "starter", seats: 2 }, { env: { PAYMENTS_PROVIDER: "fake" } }));
  okClass("e-owner-bearer", "org.js", "start_subscription: a NON-admin's bearer is refused org_not_found through orgAdminOrThrow, before any provider call", stolen instanceof PaymentsError && stolen.code === "org_not_found");
  ok("[e-owner-bearer/org.js] start_subscription: zero vy_org_subscription rows were written for the non-admin's attempt", state.orgSubscriptions.length === 0);
  const mineOutcome = await threw(() => startOrgSubscription(db, { ownerUserId: OWNER, orgId: ORG_A, plan: "starter", seats: 2 }, { env: { PAYMENTS_PROVIDER: "fake" } }));
  okClass("e-owner-bearer", "org.js", "start_subscription: the real admin's own call passes the SAME gate, refused for a DIFFERENT, later reason than org_not_found (the admin predicate discriminates)", mineOutcome?.code !== "org_not_found");
}
{
  const state = freshDoorsState();
  state.orgs.push({ org_id: ORG_A, name: "Anjali's Suite", slug: "anjalis-suite", plan: "starter", seat_limit: 5, created_at: "2026-08-01T00:00:00.000Z" });
  state.orgMembers = [{ org_id: ORG_A, owner_user_id: OWNER, role: "admin", added_at: "2026-08-01T00:00:00.000Z" }];
  const db = doorsDb(state);
  const stolen = await threw(() => updateOrgSeats(db, { ownerUserId: OWNER_B, orgId: ORG_A, seats: 4 }, { env: { PAYMENTS_PROVIDER: "fake" } }));
  okClass("e-owner-bearer", "org.js", "update_seats: a NON-admin's bearer is refused org_not_found through orgAdminOrThrow", stolen instanceof PaymentsError && stolen.code === "org_not_found");
  const mineOutcome = await threw(() => updateOrgSeats(db, { ownerUserId: OWNER, orgId: ORG_A, seats: 4 }, { env: { PAYMENTS_PROVIDER: "fake" } }));
  okClass("e-owner-bearer", "org.js", "update_seats: the real admin's own call passes the SAME gate, refused for a DIFFERENT, later reason than org_not_found", mineOutcome?.code !== "org_not_found");
}
{
  // list_mine: no cross-owner input at all (op:"list_mine" carries no
  // org_id) — the same shape `create` above and `payout_statements`/
  // `mine_list` already prove: two owners' own results never cross.
  const state = freshDoorsState();
  state.orgs.push({ org_id: ORG_A, name: "Anjali's Suite", slug: "anjalis-suite", plan: "starter", seat_limit: 5, created_at: "2026-08-01T00:00:00.000Z" });
  state.orgMembers = [{ org_id: ORG_A, owner_user_id: OWNER, role: "admin", added_at: "2026-08-01T00:00:00.000Z" }];
  const db = doorsDb(state);
  const mine = await ORG.listMyOrgs(db, OWNER);
  okClass("e-owner-bearer", "org.js", "list_mine: the real member sees their own Suite", mine.length === 1 && mine[0].org_id === ORG_A);
  const others = await ORG.listMyOrgs(db, OWNER_B);
  okClass("e-owner-bearer", "org.js", "list_mine: a DIFFERENT owner with no membership sees an empty list, never OWNER's Suite", Array.isArray(others) && others.length === 0);
}
{
  const state = freshDoorsState();
  state.orgs.push({ org_id: ORG_A, name: "Anjali's Suite", slug: "anjalis-suite", plan: "starter", seat_limit: 5, created_at: "2026-08-01T00:00:00.000Z" });
  state.rooms[0].org_id = ORG_A;
  const db = doorsDb(state);
  const mine = await ORG.roomSuiteStatus(db, OWNER, REPLICA_ID);
  okClass("e-owner-bearer", "org.js", "room_status: the real owner reads their own Room's Suite membership", mine?.org_id === ORG_A);
  const stolen = await ORG.roomSuiteStatus(db, OWNER_B, REPLICA_ID);
  okClass("e-owner-bearer", "org.js", "room_status: a DIFFERENT owner's bearer against the same replica_id gets null, never OWNER's Suite name", stolen == null);
}

// ── room-publish.js: create, rename, publish, pause, resume, set_free_cap,
//    set_paid_ceilings, set_default_locale, stats ──────────────────────────
{
  const state = freshDoorsState();
  const db = doorsDb(state);
  const stolen = await ROOM_PUBLISH.createRoom(db, OWNER_B, REPLICA_ID, {});
  okClass("e-owner-bearer", "room-publish.js", "create: a DIFFERENT owner's bearer against OWNER's own replica_id gets null (ownedReplica's own scope), never creates or returns OWNER's Room", stolen == null);
  const mine = await ROOM_PUBLISH.createRoom(db, OWNER, REPLICA_ID, {});
  okClass("e-owner-bearer", "room-publish.js", "create: the real owner's own call returns their existing Room, idempotent (the fixture is sound)", mine?.room_id === ROOM_ID || mine?.slug != null);
}
{
  const state = freshDoorsState();
  const db = doorsDb(state);
  const stolen = await ROOM_PUBLISH.renameRoom(db, OWNER_B, REPLICA_ID, "a-strangers-slug");
  okClass("e-owner-bearer", "room-publish.js", "rename: a DIFFERENT owner's bearer against OWNER's own replica_id gets null, never renames OWNER's Room", stolen == null);
  ok("[e-owner-bearer/room-publish.js] rename: OWNER's own slug is UNCHANGED by OWNER_B's attempt", state.rooms[0].slug !== "a-strangers-slug");
  const mine = await ROOM_PUBLISH.renameRoom(db, OWNER, REPLICA_ID, "anjali-renamed");
  okClass("e-owner-bearer", "room-publish.js", "rename: the real owner's own rename succeeds (the fixture is sound)", mine?.slug === "anjali-renamed");
}
{
  const state = freshDoorsState();
  const db = doorsDb(state);
  const stolen = await ROOM_PUBLISH.publishRoom(db, OWNER_B, REPLICA_ID);
  okClass("e-owner-bearer", "room-publish.js", "publish: a DIFFERENT owner's bearer against OWNER's own replica_id gets null (ownedRoomRow's own scope), never touches OWNER's Room", stolen == null);
  // This fixture takes the write's owner-matched branch unconditionally
  // (this block's own header: "prove the OWNER boundary, not the whole
  // write" — the readiness lock's three fragments are `_room-publish.js`'s
  // own dedicated suite's subject, not this workstream's), so the real
  // owner's own call is a clean, non-null publish, never a not-found.
  const mine = await ROOM_PUBLISH.publishRoom(db, OWNER, REPLICA_ID);
  okClass("e-owner-bearer", "room-publish.js", "publish: the real owner's own call reaches and writes THEIR OWN row (the fixture is sound)", mine?.published === true);
}
{
  const state = freshDoorsState();
  const db = doorsDb(state);
  const stolen = await ROOM_PUBLISH.pauseRoom(db, OWNER_B, REPLICA_ID);
  okClass("e-owner-bearer", "room-publish.js", "pause: a DIFFERENT owner's bearer against OWNER's own replica_id gets null, never pauses OWNER's Room", stolen == null);
  ok("[e-owner-bearer/room-publish.js] pause: OWNER's own room is UNCHANGED by OWNER_B's attempt", state.rooms[0].paused_at == null);
  const mine = await ROOM_PUBLISH.pauseRoom(db, OWNER, REPLICA_ID);
  okClass("e-owner-bearer", "room-publish.js", "pause: the real owner's own pause succeeds (pausing is unconditional, the fixture is sound)", mine?.paused === true);
}
{
  const state = freshDoorsState();
  const db = doorsDb(state);
  const stolen = await ROOM_PUBLISH.resumeRoom(db, OWNER_B, REPLICA_ID);
  okClass("e-owner-bearer", "room-publish.js", "resume: a DIFFERENT owner's bearer against OWNER's own replica_id gets null (ownedRoomRow's own scope), never touches OWNER's Room", stolen == null);
  const mine = await ROOM_PUBLISH.resumeRoom(db, OWNER, REPLICA_ID);
  okClass("e-owner-bearer", "room-publish.js", "resume: the real owner's own call reaches and writes THEIR OWN row, never a not-found (the fixture is sound)", mine?.paused === false);
}
{
  const state = freshDoorsState();
  const db = doorsDb(state);
  const stolen = await ROOM_PUBLISH.setRoomFreeCap(db, OWNER_B, REPLICA_ID, 30);
  okClass("e-owner-bearer", "room-publish.js", "set_free_cap: a DIFFERENT owner's bearer against OWNER's own replica_id gets null, never writes OWNER's cap", stolen == null);
  ok("[e-owner-bearer/room-publish.js] set_free_cap: OWNER's own cap is UNCHANGED by OWNER_B's attempt", state.rooms[0].free_monthly_messages !== 30);
  const mine = await ROOM_PUBLISH.setRoomFreeCap(db, OWNER, REPLICA_ID, 30);
  okClass("e-owner-bearer", "room-publish.js", "set_free_cap: the real owner's own write succeeds (the fixture is sound)", mine?.free_monthly_messages === 30);
}
{
  const state = freshDoorsState();
  const db = doorsDb(state);
  const stolen = await ROOM_PUBLISH.setRoomPaidCeilings(db, OWNER_B, REPLICA_ID, { messages: 700, voiceSeconds: 2400 });
  okClass("e-owner-bearer", "room-publish.js", "set_paid_ceilings: a DIFFERENT owner's bearer against OWNER's own replica_id gets null, never writes OWNER's ceilings", stolen == null);
  const mine = await ROOM_PUBLISH.setRoomPaidCeilings(db, OWNER, REPLICA_ID, { messages: 700, voiceSeconds: 2400 });
  okClass("e-owner-bearer", "room-publish.js", "set_paid_ceilings: the real owner's own write succeeds (the fixture is sound)", mine?.paid_monthly_messages === 700 && mine?.paid_monthly_voice_seconds === 2400);
}
{
  const state = freshDoorsState();
  const db = doorsDb(state);
  const stolen = await ROOM_PUBLISH.setRoomDefaultLocale(db, OWNER_B, REPLICA_ID, "hi");
  okClass("e-owner-bearer", "room-publish.js", "set_default_locale: a DIFFERENT owner's bearer against OWNER's own replica_id gets null, never writes OWNER's locale", stolen == null);
  const mine = await ROOM_PUBLISH.setRoomDefaultLocale(db, OWNER, REPLICA_ID, "hi");
  okClass("e-owner-bearer", "room-publish.js", "set_default_locale: the real owner's own write succeeds (the fixture is sound)", mine?.default_locale === "hi");
}
{
  const state = freshDoorsState();
  const db = doorsDb(state);
  const stolen = await ROOM_PUBLISH.ownerRoomStats(db, OWNER_B, REPLICA_ID);
  okClass("e-owner-bearer", "room-publish.js", "stats: a DIFFERENT owner's bearer against OWNER's own replica_id gets null, never OWNER's counts", stolen == null);
  const mine = await ROOM_PUBLISH.ownerRoomStats(db, OWNER, REPLICA_ID);
  okClass("e-owner-bearer", "room-publish.js", "stats: the real owner's own read succeeds, real zeros never a null (the fixture is sound)", mine != null && mine.followers_total === 0);
}

// ── invites.js: issue, list, revoke, erase (operator-only) ─────────────────
// The security boundary for all four is `requireOperator`, checked at the
// DOOR (api/invites.js), never inside the decision module — §11's own
// `isOpsOwner`/`retry_failed_payout` method, applied to `OPS_OWNER_USER_IDS`
// membership instead. Proven dynamically on the real primitive and
// statically as running BEFORE each of the four functions, `evals/rate-
// limit/run.mjs`'s own §7 method.
{
  const OPERATOR_ENV = { OPS_OWNER_USER_IDS: "op-uid-r51" };
  for (const opName of ["issue", "list", "revoke", "erase"]) {
    okClass("e-owner-bearer", "invites.js", `${opName}: requireOperator admits the configured operator`, (() => { try { requireOperator("op-uid-r51", OPERATOR_ENV); return true; } catch { return false; } })());
    okClass("e-owner-bearer", "invites.js", `${opName}: requireOperator refuses a non-operator bearer (403, before any of issue/list/revoke/erase runs)`, (() => { try { requireOperator(OWNER_B, OPERATOR_ENV); return false; } catch (e) { return e instanceof InvitesError && e.code === "operator_only"; } })());
  }
  const src = readFileSync(join(API, "invites.js"), "utf8");
  const block = src.slice(src.indexOf("requireOperator(user.id)"));
  for (const [opName, fnName] of [["issue", "issueInvite("], ["list", "listInvites("], ["revoke", "revokeInvite("], ["erase", "eraseInvite("]]) {
    ok(`[wiring/invites.js] "${opName}" calls requireOperator BEFORE ${fnName.slice(0, -1)}, never after`, block.indexOf(fnName) > 0);
  }
}
{
  // The functions themselves are sound once past the gate — proven once,
  // dynamically, rather than re-derived per op above.
  const state = freshDoorsState();
  const db = doorsDb(state);
  const { code, invite } = await INVITES.issueInvite(db, "op-uid-r51", { contact: "creator@example.com" });
  ok("[e-owner-bearer/invites.js] issue: an operator's own issue mints a real, redeemable code", typeof code === "string" && Boolean(invite?.invite_id));
  const listed = await INVITES.listInvites(db, {});
  ok("[e-owner-bearer/invites.js] list: the issued invite is visible to the operator console", listed.some((i) => i.invite_id === invite.invite_id));
  const revoked = await INVITES.revokeInvite(db, invite.invite_id);
  ok("[e-owner-bearer/invites.js] revoke: the operator's own revoke disables it", revoked.expires_at <= new Date().toISOString());
  const erased = await threw(() => INVITES.eraseInvite(db, invite.invite_id));
  ok("[e-owner-bearer/invites.js] erase: a REVOKED-but-unredeemed invite still erases outright", erased == null || erased.deleted === true);
}

// ── apply.js: list, erase (operator-only) ───────────────────────────────────
{
  const OPERATOR_ENV = { OPS_OWNER_USER_IDS: "op-uid-r51" };
  for (const opName of ["list", "erase"]) {
    okClass("e-owner-bearer", "apply.js", `${opName}: requireOperator admits the configured operator`, (() => { try { requireOperator("op-uid-r51", OPERATOR_ENV); return true; } catch { return false; } })());
    okClass("e-owner-bearer", "apply.js", `${opName}: requireOperator refuses a non-operator bearer (403, before ${opName} runs)`, (() => { try { requireOperator(OWNER_B, OPERATOR_ENV); return false; } catch (e) { return e instanceof InvitesError && e.code === "operator_only"; } })());
  }
  const src = readFileSync(join(API, "apply.js"), "utf8");
  const block = src.slice(src.indexOf("requireOperator(user.id)"));
  ok('[wiring/apply.js] "list" calls requireOperator BEFORE listApplications, never after', block.indexOf("listApplications(") > 0);
  ok('[wiring/apply.js] "erase" calls requireOperator BEFORE eraseApplicationsByContact, never after', block.indexOf("eraseApplicationsByContact(") > 0);
}
{
  const state = freshDoorsState();
  const db = doorsDb(state);
  await APPLY.submitApplication(db, { name: "A Creator", archive_link: "https://example.com/a", contact: "creator2@example.com" }, { now: NOW });
  const listed = await APPLY.listApplications(db, {});
  ok("[e-owner-bearer/apply.js] list: an operator's own list sees the real application", listed.length === 1);
  const erased = await APPLY.eraseApplicationsByContact(db, "creator2@example.com");
  ok("[e-owner-bearer/apply.js] erase: an operator's own erase-by-contact deletes it", erased.deleted === 1);
}

// ═════════════════════════════════════════════════════════════════════════
// §17. WS-R51 — THE FIVE WIDENED DOORS' OWN NEW/NEWLY-COVERED OPS.
// checkins.js/handoff.js/pulse.js/replica.js/account.js join §18's computed
// op list for the first time this workstream — every genuinely uncased
// owner-bearer op among them gets a real case here, exactly as §16 does for
// the original seven doors' own 27.
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── §17: the five widened doors' own new cases (WS-R51) ──");

// ── checkins.js: design_create, design_pause (design_list already cased
//    in §5; designs/opt_in/stop/list_mine/telegram_status/telegram_set
//    already cased or wiring-proved above) ──────────────────────────────
{
  const state = freshDoorsState();
  const db = doorsDb(state);
  const stolen = await threw(() => createDesign(db, OWNER_B, REPLICA_ID, { title: "Steal", promptShape: "x" }));
  okClass("e-owner-bearer", "checkins.js", "design_create: a DIFFERENT owner's bearer against OWNER's own replica_id is refused room_not_found, never creates a design under OWNER's Room", stolen?.code === "room_not_found");
  ok("[e-owner-bearer/checkins.js] design_create: no design was written for OWNER_B's attempt", state.checkinDesigns.length === 0);
  const mine = await createDesign(db, OWNER, REPLICA_ID, { title: "Walk", promptShape: "ask about the walk" });
  okClass("e-owner-bearer", "checkins.js", "design_create: the real owner's own create succeeds (the fixture is sound)", Boolean(mine?.design_id));
}
{
  const state = freshDoorsState();
  const db = doorsDb(state);
  const design = await createDesign(db, OWNER, REPLICA_ID, { title: "Walk", promptShape: "x" });
  const stolen = await threw(() => pauseDesign(db, OWNER_B, REPLICA_ID, design.design_id, { state: "paused" }));
  okClass("e-owner-bearer", "checkins.js", "design_pause: a DIFFERENT owner's bearer against OWNER's own replica_id is refused room_not_found, never pauses OWNER's design", stolen?.code === "room_not_found");
  ok("[e-owner-bearer/checkins.js] design_pause: OWNER's own design is UNCHANGED by OWNER_B's attempt", state.checkinDesigns[0].state === "active");
  const mine = await pauseDesign(db, OWNER, REPLICA_ID, design.design_id, { state: "paused" });
  okClass("e-owner-bearer", "checkins.js", "design_pause: the real owner's own pause succeeds (the fixture is sound)", mine.state === "paused");
}

// ── handoff.js: config_set, queue, answer (config_get already cased in §5;
//    draft/send/withdraw/mine already cased or wiring-proved above) ───────
{
  const state = freshDoorsState();
  const db = doorsDb(state);
  const stolen = await threw(() => HANDOFF.setHandoffConfig(db, OWNER_B, REPLICA_ID, { enabled: true, monthlyCap: 10 }));
  okClass("e-owner-bearer", "handoff.js", "config_set: a DIFFERENT owner's bearer against OWNER's own replica_id is refused room_not_found, never enables handoff on OWNER's Room", stolen?.code === "room_not_found");
  ok("[e-owner-bearer/handoff.js] config_set: OWNER's own handoff switch is UNCHANGED by OWNER_B's attempt", state.rooms[0].handoff_enabled === false);
  const mine = await HANDOFF.setHandoffConfig(db, OWNER, REPLICA_ID, { enabled: true, monthlyCap: 10 });
  okClass("e-owner-bearer", "handoff.js", "config_set: the real owner's own write succeeds (the fixture is sound)", mine.enabled === true && mine.monthly_cap === 10);
}
{
  const state = freshDoorsState();
  const db = doorsDb(state);
  const stolen = await threw(() => HANDOFF.handoffQueue(db, OWNER_B, REPLICA_ID));
  okClass("e-owner-bearer", "handoff.js", "queue: a DIFFERENT owner's bearer against OWNER's own replica_id is refused room_not_found, never OWNER's queue", stolen?.code === "room_not_found");
  const mine = await HANDOFF.handoffQueue(db, OWNER, REPLICA_ID);
  okClass("e-owner-bearer", "handoff.js", "queue: the real owner's own read succeeds, an honest empty queue never a refusal (the fixture is sound)", mine != null && mine.counts != null);
}
{
  const state = freshDoorsState();
  const db = doorsDb(state);
  const stolen = await threw(() => HANDOFF.answerHandoff(db, OWNER_B, REPLICA_ID, "ffffffff-0000-4000-8000-000000000000", { replyText: "hi" }));
  okClass("e-owner-bearer", "handoff.js", "answer: a DIFFERENT owner's bearer against OWNER's own replica_id is refused room_not_found, BEFORE the write predicate even runs", stolen?.code === "room_not_found");
  const mineOutcome = await threw(() => HANDOFF.answerHandoff(db, OWNER, REPLICA_ID, "ffffffff-0000-4000-8000-000000000000", { replyText: "hi" }));
  okClass("e-owner-bearer", "handoff.js", "answer: the real owner's own call reaches the write predicate for THEIR OWN room (a made-up handoff_id is 'not answerable', a DIFFERENT reason than room_not_found)", mineOutcome?.code === "handoff_not_answerable");
}

// ── pulse.js: set_topics ────────────────────────────────────────────────
{
  const state = freshDoorsState();
  const db = doorsDb(state);
  const stolen = await threw(() => PULSE.setTopics(db, OWNER_B, REPLICA_ID, []));
  okClass("e-owner-bearer", "pulse.js", "set_topics: a DIFFERENT owner's bearer against OWNER's own replica_id is refused pulse_room_not_found, never touches OWNER's topics", stolen?.code === "pulse_room_not_found");
  const mine = await PULSE.setTopics(db, OWNER, REPLICA_ID, []);
  okClass("e-owner-bearer", "pulse.js", "set_topics: the real owner's own write succeeds (the fixture is sound)", Array.isArray(mine));
}

// ── replica.js: revoke, erasure_status, funnel_mark (create already cased
//    in §7 via invite-code guessing) ─────────────────────────────────────
{
  const state = freshDoorsState();
  const db = doorsDb(state);
  const stolen = await REPLICA.requestOwnedReplicaErasure(db, OWNER_B, REPLICA_ID);
  okClass("e-owner-bearer", "replica.js", "revoke: a DIFFERENT owner's bearer against OWNER's own replica_id gets null, never revokes OWNER's replica", stolen == null);
  ok("[e-owner-bearer/replica.js] revoke: OWNER's own replica is UNCHANGED by OWNER_B's attempt", state.replicas[0].lifecycle !== "revoked");
  const mine = await REPLICA.requestOwnedReplicaErasure(db, OWNER, REPLICA_ID);
  okClass("e-owner-bearer", "replica.js", "revoke: the real owner's own revoke succeeds (the fixture is sound)", mine?.replica?.replica_id === REPLICA_ID);
}
{
  const state = freshDoorsState();
  const db = doorsDb(state);
  await REPLICA.requestOwnedReplicaErasure(db, OWNER, REPLICA_ID);
  const jobId = state.erasureJobs[0].job_id;
  const stolen = await getReplicaErasureStatus(db, OWNER_B, jobId);
  okClass("e-owner-bearer", "replica.js", "erasure_status: a DIFFERENT owner's bearer naming OWNER's own erasure_request_id gets null, never OWNER's status", stolen == null);
  const mine = await getReplicaErasureStatus(db, OWNER, jobId);
  okClass("e-owner-bearer", "replica.js", "erasure_status: the real owner's own read succeeds (the fixture is sound)", mine?.state === "pending");
}
{
  const state = freshDoorsState();
  const db = doorsDb(state);
  const stolen = await threw(() => markStep(db, OWNER_B, REPLICA_ID, "studio_opened"));
  okClass("e-owner-bearer", "replica.js", "funnel_mark: a DIFFERENT owner's bearer against OWNER's own replica_id is refused replica_not_found, never marks OWNER's funnel", stolen?.code === "replica_not_found");
  ok("[e-owner-bearer/replica.js] funnel_mark: no mark was written for OWNER_B's attempt", state.funnelMarks.length === 0);
  const mine = await markStep(db, OWNER, REPLICA_ID, "studio_opened");
  okClass("e-owner-bearer", "replica.js", "funnel_mark: the real owner's own mark succeeds (the fixture is sound)", mine?.step === "studio_opened");
}

// ── replica.js: set_locale (WS-R52's studio locale op, cased by the main
//    loop at the WS-R51 merge, the day the computed op list found it). The
//    write is one UPDATE whose WHERE carries owner_user_id; the locale is
//    checked against STUDIO_LOCALES before any SQL runs. ──
{
  const state = freshDoorsState();
  const db = doorsDb(state);
  const stolen = await REPLICA.setOwnedReplicaLocale(db, OWNER_B, REPLICA_ID, "hi");
  okClass("e-owner-bearer", "replica.js", "set_locale: a DIFFERENT owner's bearer against OWNER's own replica_id gets null, never changes OWNER's locale", stolen == null);
  ok("[e-owner-bearer/replica.js] set_locale: OWNER's own replica is UNCHANGED by OWNER_B's attempt", (state.replicas[0].locale ?? "en") === "en");
  const bad = await threw(() => REPLICA.setOwnedReplicaLocale(db, OWNER, REPLICA_ID, "fr"));
  okClass("e-owner-bearer", "replica.js", "set_locale: an unrecognised locale is refused by name (studio_locale_invalid) before any SQL runs", bad?.code === "studio_locale_invalid");
  const mine = await REPLICA.setOwnedReplicaLocale(db, OWNER, REPLICA_ID, "hi");
  okClass("e-owner-bearer", "replica.js", "set_locale: the real owner's own write succeeds (the fixture is sound)", mine?.locale === "hi" && state.replicas[0].locale === "hi");
}

// ── account.js: send_otp, verify_otp — WS-R51's own FIX (this file's
//    header: verify_sms/send_sms already carried these two persistent
//    scopes since WS-R32; send_otp/verify_otp did not). §8's own method,
//    one destination shape over (email rather than phone).
{
  const db = doorsDb(freshDoorsState());
  const sendResults = [];
  // `_rate-limit.js`'s own DEFAULT_LIMITS: otp_send_dest is 10/hour, the SAME
  // ceiling send_sms already carries.
  for (let i = 0; i < 11; i++) {
    sendResults.push(await consume(db, { scope: "otp_send_dest", key: "attacker@example.com", now: RATE_NOW + i * 1000 }));
  }
  okClass("h-otp-brute-force", "account.js", "send_otp: attempts 1-10 against one destination are admitted", sendResults.slice(0, 10).every((r) => r.ok === true));
  okClass("h-otp-brute-force", "account.js", "send_otp: the 11th send attempt against the SAME destination is refused (WS-R51 — this op had no persistent gate at all before this fix)", sendResults[10].ok === false && sendResults[10].code === "rate_limited");

  const verifyResults = [];
  for (let i = 0; i < 11; i++) {
    verifyResults.push(await consume(db, { scope: "otp_verify_dest", key: "attacker2@example.com", now: RATE_NOW + i * 1000 }));
  }
  okClass("h-otp-brute-force", "account.js", "verify_otp: attempts 1-10 against one destination are admitted", verifyResults.slice(0, 10).every((r) => r.ok === true));
  okClass("h-otp-brute-force", "account.js", "verify_otp: the 11th verify attempt against the SAME destination is refused (WS-R51 — this op had NO gate at all before this fix)", verifyResults[10].ok === false && verifyResults[10].code === "rate_limited");

  const src = readFileSync(join(API, "account.js"), "utf8");
  const sendBlock = src.slice(src.indexOf('if (op === "send_otp")'), src.indexOf('if (op === "verify_otp")'));
  ok('[wiring/account.js] "send_otp" wires otp_send_ip AND otp_send_dest, keyed by the email itself (WS-R51)', /refused\(res, "otp_send_ip", ipOf\(req\)\)/.test(sendBlock) && /refused\(res, "otp_send_dest", email\)/.test(sendBlock));
  const verifyBlock = src.slice(src.indexOf('if (op === "verify_otp")'), src.indexOf('if (op === "send_sms")'));
  ok('[wiring/account.js] "verify_otp" wires otp_verify_ip AND otp_verify_dest, keyed by the email itself (WS-R51)', /refused\(res, "otp_verify_ip", ipOf\(req\)\)/.test(verifyBlock) && /refused\(res, "otp_verify_dest", email\)/.test(verifyBlock));
  ok('[wiring/account.js] "verify_otp" validates the email BEFORE the gate runs, the same order verify_sms already uses', verifyBlock.indexOf("if (!email)") < verifyBlock.indexOf('refused(res, "otp_verify_ip"'));
}

// ═════════════════════════════════════════════════════════════════════════
// §17b. WS-R62 (migration 114) — ops.js's own push_subscribe/push_revoke,
// the ops door's first `op`-shaped body. A dedicated tiny fake `vy_operator_
// push_subscription` table rather than an addition to fixtures.mjs's shared
// state — this table has no room, no follower, no replica, nothing that
// fixture already models, so growing it here would be the exact "a fixture
// pulled in for one field it does not use" risk `evals/incidents/run.mjs`'s
// own header names for the identical reason.
//
// The class here is (e), restated for the platform-operator allowlist
// rather than "another owner's X" (this file's own class-e header comment
// names the shape): OWNER stands in for a real operator id, OWNER_B for a
// bearer NOT on `OPS_OWNER_USER_IDS` — every assertion below calls
// `api/_ops.js`'s exported functions DIRECTLY, the same "attack the real
// decision module, never a re-implemented check" law every other class-e
// block in this file already keeps.
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── §17b: ops.js push_subscribe / push_revoke (WS-R62) ──");
{
  const ALLOWLIST_ENV = { OPS_OWNER_USER_IDS: OWNER };
  const SUB = {
    endpoint: "https://push.example.test/operator-device-1",
    p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM",
    auth: "tBHItJI5svbpez7KI4CCXg",
  };

  function freshOpsPushState() {
    return { rows: [] };
  }
  /** A literal, faithful interpretation of the REAL SQL text `_ops.js`
   *  sends — not a re-implemented ownership check — so a passing assertion
   *  here means the query's own WHERE clause, not this fixture's JS, is
   *  what refused a non-operator bearer. */
  function opsPushDb(state) {
    return async (sql, params = []) => {
      const has = (s) => sql.includes(s);
      const allowedBy = (ownerUserId, ids) =>
        Array.isArray(ids) && ids.map((x) => String(x).toLowerCase()).includes(String(ownerUserId).toLowerCase());

      if (has("insert into vy_operator_push_subscription")) {
        const [id, ownerUserId, endpoint, p256dh, auth, ids] = params;
        if (!allowedBy(ownerUserId, ids)) return []; // the WHERE's own refusal
        let row = state.rows.find((r) => r.owner_user_id === ownerUserId && r.endpoint === endpoint);
        if (row) {
          row.p256dh = p256dh;
          row.auth = auth;
          row.revoked_at = null;
        } else {
          row = { id, owner_user_id: ownerUserId, endpoint, p256dh, auth, revoked_at: null };
          state.rows.push(row);
        }
        return [{ id: row.id }];
      }
      if (has("update vy_operator_push_subscription") && has("endpoint = $2")) {
        const [ownerUserId, endpoint, ids] = params;
        if (!allowedBy(ownerUserId, ids)) return [];
        const row = state.rows.find((r) => r.owner_user_id === ownerUserId && r.endpoint === endpoint && !r.revoked_at);
        if (!row) return [];
        row.revoked_at = "revoked";
        return [{ id: row.id }];
      }
      if (has("select id, endpoint, p256dh, auth") && has("from vy_operator_push_subscription")) {
        const [ownerUserId] = params;
        return state.rows
          .filter((r) => r.owner_user_id === ownerUserId && !r.revoked_at)
          .map((r) => ({ id: r.id, endpoint: r.endpoint, p256dh: r.p256dh, auth: r.auth }));
      }
      if (has("update vy_operator_push_subscription set revoked_at = now() where id")) {
        const [id] = params;
        const row = state.rows.find((r) => r.id === id);
        if (row) row.revoked_at = "revoked";
        return [];
      }
      return [];
    };
  }

  // subscribe: the real operator's own write succeeds.
  {
    const state = freshOpsPushState();
    const db = opsPushDb(state);
    const result = await subscribeOperatorPush(db, OWNER, SUB, ALLOWLIST_ENV);
    okClass("e-owner-bearer", "ops.js", "push_subscribe: the real operator's own subscribe succeeds (the fixture is sound)", result.subscribed === true && state.rows.length === 1);
  }
  // subscribe: NEGATIVE CONTROL — a bearer NOT on OPS_OWNER_USER_IDS writes
  // NO row. This calls `subscribeOperatorPush` directly, bypassing
  // `api/ops.js`'s own door-level `isOpsOwner` gate entirely, so a pass
  // here proves the INSERT's own WHERE clause refuses — not a JS `if`
  // above it that a door-level bug could someday skip.
  {
    const state = freshOpsPushState();
    const db = opsPushDb(state);
    const result = await subscribeOperatorPush(db, OWNER_B, SUB, ALLOWLIST_ENV);
    okClass("e-owner-bearer", "ops.js", "push_subscribe: NEGATIVE CONTROL — a bearer NOT on OPS_OWNER_USER_IDS writes ZERO rows, decided by the INSERT's own WHERE, not by this test skipping a JS check", result.subscribed === false && state.rows.length === 0);
  }
  // revoke: the real operator revokes their own subscription; a stranger's
  // attempt against the SAME endpoint leaves it untouched.
  {
    const state = freshOpsPushState();
    const db = opsPushDb(state);
    await subscribeOperatorPush(db, OWNER, SUB, ALLOWLIST_ENV);
    const stolen = await revokeOperatorPush(db, OWNER_B, SUB.endpoint, ALLOWLIST_ENV);
    okClass("e-owner-bearer", "ops.js", "push_revoke: a bearer NOT on OPS_OWNER_USER_IDS revokes nothing", stolen.revoked === false);
    ok("[e-owner-bearer/ops.js] push_revoke: OWNER's own row is UNCHANGED by the stranger's attempt", state.rows[0].revoked_at === null);
    const mine = await revokeOperatorPush(db, OWNER, SUB.endpoint, ALLOWLIST_ENV);
    okClass("e-owner-bearer", "ops.js", "push_revoke: the real operator's own revoke succeeds (the fixture is sound)", mine.revoked === true && state.rows[0].revoked_at !== null);
  }
  // reader: NEGATIVE CONTROL — a revoked row is never returned to the
  // sweep, so a 404/410 the sweep already acted on cannot be sent to twice
  // (workstream law #3's own words).
  {
    const state = freshOpsPushState();
    state.rows.push({ id: "s1", owner_user_id: OWNER, endpoint: "https://push.example.test/active", p256dh: "a", auth: "b", revoked_at: null });
    state.rows.push({ id: "s2", owner_user_id: OWNER, endpoint: "https://push.example.test/revoked", p256dh: "a", auth: "b", revoked_at: "revoked" });
    const db = opsPushDb(state);
    const active = await operatorPushSubscriptionsFor(db, OWNER);
    ok("[e-owner-bearer/ops.js] operatorPushSubscriptionsFor: only the active row is returned", active.length === 1 && active[0].id === "s1");
    ok("NEGATIVE CONTROL: operatorPushSubscriptionsFor never returns a revoked row", !active.some((r) => r.id === "s2"));
  }
}

// ═════════════════════════════════════════════════════════════════════════
// §18. THE COMPUTED OP LIST — law 1: every `op === "<name>"` literal in a
// door's own source is read off that source (never hand-typed twice) and
// asserted against this file's own coverage table, so a new op fails the
// gate the day it is written without an entry here — the mechanism WS-R44
// built for seven doors and WS-R51 widens to EVERY door in `EXPECTED_DOORS`
// that reads `op` from a body: the original seven (`room.js`, `room-pay.js`,
// `payments.js`, `org.js`, `room-publish.js`, `invites.js`, `apply.js`) plus
// `checkins.js`, `handoff.js`, `pulse.js`, `replica.js` and `account.js` —
// every EXPECTED_DOORS entry except the three webhook doors
// (`payments-webhook.js`, `room-tg.js`, `room-wa.js`), which this file's own
// assertion just below the table confirms read no `op` literal at all (they
// dispatch on `event`/a raw signature, never a body op — a STRUCTURAL
// exclusion under law 2's own words, "a door whose op shapes the regex
// cannot read is a finding, not an exclusion" — checked here rather than
// assumed, so a future op-shaped dispatch added to one of those three fails
// this file loudly instead of sailing through unaudited).
//
// Every op below is either CASED (a real class from this file's own attack
// taxonomy, exercised above) or EXCLUDED with a named reason — and every
// exclusion left standing is a SAFE one: "no session and no bearer" (law 1's
// own criterion — there is no credential-scoped boundary for any class here
// to test) or "no cross-identity input for classes b/c/e" (an op that reads
// or writes only the CALLING bearer's own row, `room.js`'s "open"/"join" own
// precedent). The `preexisting-uncased` class WS-R44 left standing for 27
// ops is DELETED by this workstream, not renamed — every op it used to mark
// that way now carries either a real class (a dynamic case in §16/§17 above)
// or one of the two safe exclusions, and `decisions.md#ws-r51-every-door-
// cased` names the reversal condition for the ops this run still cannot
// exercise (the three structurally op-less webhook doors).
console.log("\n── §18: the computed op list — every op is cased or named ──");

function computedOps(file) {
  const src = readFileSync(join(API, file), "utf8");
  const names = new Set();
  for (const m of src.matchAll(/(?:body\.)?op === "([a-z_]+)"/g)) names.add(m[1]);
  return [...names].sort();
}

// WS-R51 law 2's own check: the three webhook doors genuinely read no `op`
// literal — verified here, not merely asserted in a comment, so a future
// op-shaped dispatch added to one of them is a FINDING (this assertion
// fails) rather than a silent gap in EXPECTED_DOORS' own coverage.
for (const webhookDoor of ["payments-webhook.js", "room-tg.js", "room-wa.js"]) {
  ok(`[computed-op-list/${webhookDoor}] reads no "op" literal at all (structurally excluded from OP_COVERAGE, not merely skipped)`, computedOps(webhookDoor).length === 0);
}

// door -> op -> { classes: [...] } (cased, exercised above) | { excluded: "reason" }
const OP_COVERAGE = {
  "room.js": {
    open: { excluded: "no session and no bearer — the bearer it optionally reads is looked up only for the caller's OWN account continuity, never another follower's; no cross-identity input for classes b/c/e" },
    taste: { excluded: "no session and no bearer at all (WS-R53) — a stateless guest-lane turn keyed only by (slug, IP) through api/_rate-limit.js's own room_taste scope; no cross-identity input for classes b/c/e, and evals/room-taste/run.mjs and evals/room-leak/run.mjs's own layer 7 attack the boundary this op actually has (creator-material only, no follower row reachable)" },
    join: { excluded: "no session (none exists yet — join MINTS one) and no cross-person id in the body; the follower row created is always the bearer's own (evals/room/run.mjs's own join suite covers the happy path)" },
    say: { classes: ["a", "b"] },
    speak: { classes: ["a", "b"] },
    history: { classes: ["a", "b"] },
    thread: { classes: ["a", "b"] },
    locale: { classes: ["a", "b"] },
    pulse_optin: { classes: ["a", "b"] },
    pulse_revoke: { classes: ["a", "b"] },
    push_subscribe: { classes: ["a", "b"] },
    push_unsubscribe: { classes: ["a", "b"] },
    push_status: { classes: ["a", "b"] },
    whatsapp_optin: { classes: ["a", "b"] },
    whatsapp_stop: { classes: ["a", "b"] },
    whatsapp_status: { classes: ["a", "b"] },
    offer_dismiss: { classes: ["a"] },
    settings: { classes: ["a", "b"] },
    settings_reviewed: { classes: ["a", "b"] },
    citations: { classes: ["a", "b"] },
    // WS-R67 (migration 116). No body-supplied person/follower id on any of
    // the three — `flag`/`unflag` take a reply hash, `flags` takes only the
    // session, `selfScope`'s own gate (§9b).
    flag: { classes: ["a", "b"] },
    unflag: { classes: ["a", "b"] },
    flags: { classes: ["a", "b"] },
    stats: { excluded: "no session and no bearer — a public read by slug; resolveRoom's own WHERE already collapses paused/unpublished/unknown into the same answer" },
    export: { classes: ["a", "b", "c"] },
    forget: { classes: ["a", "c"] },
  },
  "room-pay.js": {
    subscribe: { classes: ["a"] },
    status: { classes: ["a"] },
    cancel: { classes: ["a", "b"] },
  },
  "payments.js": {
    set_price: { classes: ["e"] },
    start_creator_subscription: { classes: ["c"] },
    payout_statements: { classes: ["e"] },
    payout_statement: { classes: ["c"] },
    register_fund_account: { classes: ["e"] },
    retry_failed_payout: { classes: ["e"] },
    reconcile: { classes: ["e"] },
    cancel_creator_subscription: { classes: ["e"] },
  },
  "org.js": {
    create: { classes: ["e"] },
    invite: { classes: ["e"] },
    accept: { classes: ["e"] },
    attach_room: { classes: ["c"] },
    detach_room: { classes: ["e"] },
    board: { classes: ["e"] },
    subscription: { classes: ["e"] },
    start_subscription: { classes: ["e"] },
    update_seats: { classes: ["e"] },
    cancel_subscription: { classes: ["e"] },
    list_mine: { classes: ["e"] },
    members: { classes: ["e"] },
    room_status: { classes: ["e"] },
  },
  "room-publish.js": {
    create: { classes: ["e"] },
    rename: { classes: ["e"] },
    publish: { classes: ["e"] },
    pause: { classes: ["e"] },
    resume: { classes: ["e"] },
    set_free_cap: { classes: ["e"] },
    set_paid_ceilings: { classes: ["e"] },
    set_default_locale: { classes: ["e"] },
    set_bio: { classes: ["e"] },
    set_taste_enabled: { classes: ["e"] },
    list: { classes: ["e"] },
    unlist: { classes: ["e"] },
    stats: { classes: ["e"] },
  },
  "invites.js": {
    issue: { classes: ["e"] },
    list: { classes: ["e"] },
    revoke: { classes: ["e"] },
    erase: { classes: ["e"] },
    mine_issue: { classes: ["e"] },
    mine_list: { classes: ["e"] },
  },
  "apply.js": {
    submit: { excluded: "no session and no bearer — public, unauthenticated (the WS-R48 intent field widens this op's BODY, never its identity boundary)" },
    list: { classes: ["e"] },
    erase: { classes: ["e"] },
  },
  // ── WS-R51: the five doors §18 widens to for the first time. ────────────
  "checkins.js": {
    design_create: { classes: ["e"] },
    design_list: { classes: ["e"] },
    design_pause: { classes: ["e"] },
    designs: { classes: ["a", "b"] },
    opt_in: { classes: ["a", "b", "c"] },
    stop: { classes: ["a", "b", "c"] },
    list_mine: { classes: ["a", "b"] },
    telegram_status: { classes: ["a", "b"] },
    telegram_set: { classes: ["a", "b"] },
  },
  "handoff.js": {
    config_get: { classes: ["e"] },
    config_set: { classes: ["e"] },
    queue: { classes: ["e"] },
    answer: { classes: ["e"] },
    draft: { classes: ["a", "b"] },
    send: { classes: ["a", "b"] },
    withdraw: { classes: ["a", "b", "c"] },
    mine: { classes: ["a", "b"] },
  },
  "pulse.js": {
    set_topics: { classes: ["e"] },
  },
  "replica.js": {
    create: { classes: ["g"] },
    revoke: { classes: ["e"] },
    erasure_status: { classes: ["e"] },
    funnel_mark: { classes: ["e"] },
    set_locale: { classes: ["e"] },
  },
  // ── WS-R62 (migration 114): the ops door's first `op`-shaped body. ──────
  "ops.js": {
    push_subscribe: { classes: ["e"] },
    push_revoke: { classes: ["e"] },
  },
  "account.js": {
    send_otp: { classes: ["h"] },
    verify_otp: { classes: ["h"] },
    send_sms: { classes: ["h"] },
    verify_sms: { classes: ["h"] },
    google_url: { excluded: "no session and no bearer — a static redirect URL, no identity or another account's data anywhere in the response" },
    refresh: { excluded: "no cross-identity input for classes b/c/e — the caller presents their OWN refresh_token; Supabase Auth itself is what a stolen token would defeat, not a predicate this file could add" },
    save_state: { excluded: "no cross-identity input for classes b/c/e — user is resolved ONLY from userFromToken(access_token), never a body-supplied id; the row written is keyed on that verified user's own id" },
    load_state: { excluded: "no cross-identity input for classes b/c/e, save_state's own reason" },
    wipe_state: { excluded: "no cross-identity input for classes b/c/e, save_state's own reason" },
    consent: { excluded: "no session and no bearer — append-only ledger row, unauthenticated by design (this file's own header: most users are anonymous device ids); user_id rides along only when present and is never trusted to scope a READ, since there is no read op" },
    track: { excluded: "no session and no bearer — unauthenticated analytics row, this file's own header" },
  },
};

let uncasedOps = 0;
let preexistingGaps = 0;
for (const [file, coverage] of Object.entries(OP_COVERAGE)) {
  const ops = computedOps(file);
  for (const opName of ops) {
    const entry = coverage[opName];
    const known = Boolean(entry && (entry.excluded || (Array.isArray(entry.classes) && entry.classes.length > 0)));
    if (!known) uncasedOps++;
    // WS-R51 law 2: the "preexisting-uncased" class is DELETED, not
    // renamed — this loop fails loudly if any entry still uses it, so a
    // future rebase that reintroduces the string cannot silently reopen the
    // gap this workstream closed.
    if (entry?.excluded?.startsWith("preexisting-uncased")) preexistingGaps++;
    ok(`[computed-op-list/${file}] "${opName}" is either cased or named excluded`, known, known ? "" : "— UNCASED OP, no entry in OP_COVERAGE at all");
  }
  // The reverse direction: a stale OP_COVERAGE entry for an op the door's
  // own source no longer defines (renamed or removed) must not stand in
  // silently for coverage that no longer means anything.
  for (const opName of Object.keys(coverage)) {
    ok(`[computed-op-list/${file}] OP_COVERAGE's "${opName}" entry still names a real op in ${file}'s own source`, ops.includes(opName));
  }
  console.log(`  ${file.padEnd(18)} ops (${ops.length}): ${ops.join(", ")}`);
}
ok("the computed op list found ZERO ops with no OP_COVERAGE entry at all (every op is cased or named excluded)", uncasedOps === 0);
ok('the "preexisting-uncased" class is GONE from OP_COVERAGE — every op WS-R44 left there now carries a real class or a safe exclusion (WS-R51 law 2)', preexistingGaps === 0);

// ═════════════════════════════════════════════════════════════════════════
// §19. WS-R51 — NEGATIVE CONTROLS (law 4). Both MUST fail, or this
// workstream has proven nothing about its own new cases
// (`sound-gate-proved-by-silence`, `evals/room-leak/run.mjs`'s own header
// law, restated here for the door battery's own new material).
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── §19: negative controls (both MUST fail) ──");

// Control (1): the owner predicate STRUCK from a fixture copy of the
// decision path — `evals/room/run.mjs`'s own §6 technique (a wrapped `db`
// that rewrites the query BEFORE it reaches the fixture), applied here at
// the level this battery's own fixture operates on: `setRoomFreeCap`'s own
// UPDATE (`where owner_user_id = ($1)::uuid and replica_id = ($2)::uuid`) is
// intercepted and answered by REPLICA_ID ALONE, `owner_user_id` never
// consulted — exactly what a shipped WHERE clause losing its owner half
// would produce. If §16's own `set_free_cap` case still passed against THIS
// weakened world, that case would have been proving nothing.
{
  const state = freshDoorsState();
  const realDb = doorsDb(state);
  const ownerCheckStruck = async (sql, params) => {
    if (sql.includes("set free_monthly_messages = ($3)::int4")) {
      // The struck predicate: match by replica_id ALONE, the shape a
      // shipped WHERE clause missing its owner half would produce.
      const [, replica, cap] = params;
      const row = state.rooms.find((r) => r.replica_id === String(replica));
      if (!row) return [];
      row.free_monthly_messages = cap;
      return [{ ...row }];
    }
    return realDb(sql, params);
  };
  const leaked = await ROOM_PUBLISH.setRoomFreeCap(ownerCheckStruck, OWNER_B, REPLICA_ID, 77);
  ok(
    "NEGATIVE CONTROL (1): with the owner predicate struck, a DIFFERENT owner's bearer now DOES write OWNER's own free cap — proving §16's real case (which struck nothing) was actually load-bearing, not vacuous",
    leaked?.free_monthly_messages === 77,
  );
  ok("NEGATIVE CONTROL (1): the struck world genuinely changed the outcome (OWNER's own cap is now 77, not the fixture's original default)", state.rooms[0].free_monthly_messages === 77);
}

// Control (2): an op literal ADDED to a temp copy of a real door's source,
// with no OP_COVERAGE entry for it — proving §18's own completeness check
// (the mechanism this whole workstream widens) actually fails loudly on an
// uncased op, rather than silently passing on anything.
{
  const realSrc = readFileSync(join(API, "room-publish.js"), "utf8");
  const sneakyOp = "totally_new_sneaky_op_added_by_negative_control";
  const mutated = realSrc.replace(
    'if (op === "stats") {',
    `if (op === "${sneakyOp}") { /* WS-R51 negative control: an op with no case and no OP_COVERAGE entry at all */ }\n    if (op === "stats") {`,
  );
  ok("NEGATIVE CONTROL (2) fixture sanity: the injected op literal actually landed in the mutated copy", mutated.includes(`op === "${sneakyOp}"`) && mutated !== realSrc);
  const tmpDir = mkdtempSync(join(tmpdir(), "ws-r51-negctrl-"));
  const tmpFile = join(tmpDir, "room-publish.js");
  try {
    writeFileSync(tmpFile, mutated, "utf8");
    // computedOps() itself always reads from API/<file> (it is exercised
    // against the real doors elsewhere in this file, on purpose — a
    // relative-path parameter would defeat that); this control reads the
    // temp copy with the SAME extraction regex directly, never a second,
    // hand-derived one.
    const mutatedSrc = readFileSync(tmpFile, "utf8");
    const mutatedOps = [...new Set([...mutatedSrc.matchAll(/(?:body\.)?op === "([a-z_]+)"/g)].map((m) => m[1]))];
    const realCoverage = OP_COVERAGE["room-publish.js"];
    const known = Boolean(realCoverage[sneakyOp]);
    ok(
      `NEGATIVE CONTROL (2): a "${sneakyOp}" op discovered in the mutated door has NO OP_COVERAGE entry — this is exactly the "UNCASED OP" failure §18 raises on a real door, proving the completeness check actually catches a new, uncovered op rather than passing on anything`,
      mutatedOps.includes(sneakyOp) && !known,
    );
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n── case counts per attack class, per door ──");
for (const [klass, { doors, pass: p, fail: f }] of Object.entries(byClass)) {
  console.log(`  ${klass.padEnd(20)} doors: ${[...doors].sort().join(", ")}  (${p} ok, ${f} failed)`);
}

console.log(`\n${pass} ok, ${fail} failed`);
process.exit(fail ? 1 : 0);
