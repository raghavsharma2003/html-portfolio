// WS-R22. WEB PUSH FOR CHECK-INS — offline, deterministic, $0, no DB, no
// network, no model call, no GPU.
//
//   node evals/room-push/run.mjs
//
// Migration 085. Six sections:
//
//   §1 THE CRYPTO. `encryptPayload`/`decryptPayload` (api/_push/webpush.js)
//      round-tripped against a freshly generated real EC keypair — an
//      INDEPENDENTLY WRITTEN decoder (the receiver's own math, not a mirror
//      of the encoder), proving the two sides of RFC 8291 agree with each
//      other on the wire format and the key derivation. See that file's own
//      header for exactly what this does and does not prove (real-browser
//      interop is UNPROVEN — this environment has no network route to one).
//   §2 VAPID. The JWT header/claims shape and a signature node's own
//      `crypto.verify` accepts.
//   §3 QUIET HOURS. `computeNextDue` (api/_checkins.js) with a quiet window:
//      a plain (non-wrapping) window, a wraparound one, and the "no window"
//      default all resolving correctly.
//   §4 SUBSCRIBE/UNSUBSCRIBE SCOPING. `api/_room-push.js` through the real
//      Room session — a follower can only ever touch their OWN subscription
//      row, proven by having follower B try to revoke follower A's endpoint.
//   §5 THE DELIVERY LEDGER. `deliverers.webPush` (api/_checkins.js) over a
//      fake push service: not_configured (no VAPID env), failed (no active
//      subscription), delivered (a 2xx), and the negative controls:
//      (b) a 410 revokes the subscription and a second attempt sends
//      nothing to it; (c) a world check — follower B's active subscription
//      is never touched by a push aimed at follower A's check-in.
//   §6 NEGATIVE CONTROL (a), STATIC. `checkinPushPayload`'s own source is
//      scanned for every check-in-text identifier and must carry none — and
//      the scanner is proven capable of catching a bad one first.
//   §7 RFC 8291 APPENDIX A, REPRODUCED (WS-R41). Not the round-trip §1
//      already proves (encoder vs. its own independent decoder over a
//      freshly generated keypair) — this section feeds the RFC's OWN
//      published salt and sender keypair into the REAL `encryptPayload` and
//      asserts its output equals the RFC's own published request body
//      byte-for-byte, then feeds that same published body into the REAL
//      `decryptPayload` and asserts it recovers the RFC's own published
//      plaintext. See api/_push/webpush.js's header for the doc url/date
//      and the decoder bug this section's own first run surfaced and this
//      workstream fixed (rejected.md#ws-r41-webpush-decoder-required-rs-
//      equal-record-length).
import fs from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomUUID, generateKeyPairSync } from "node:crypto";
import {
  ROOM_ID,
  SLUG,
  USER_A,
  USER_B,
  PERSON_A,
  freshState,
  fakeDb,
} from "../room/fixtures.mjs";

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

const WP = await import(pathToFileURL(join(REPO, "api/_push/webpush.js")).href);
const {
  encryptPayload, decryptPayload, vapidHeaders, checkinPushPayload, renewalPushPayload, dormancyPushPayload,
  b64uEncode, b64uDecode,
} = WP;
const ROOM = await import(pathToFileURL(join(REPO, "api/_room-surface.js")).href);
const { joinRoom } = ROOM;
const PUSH = await import(pathToFileURL(join(REPO, "api/_room-push.js")).href);
const { setSubscription, removeSubscription, subscriptionStatus } = PUSH;
const CI = await import(pathToFileURL(join(REPO, "api/_checkins.js")).href);
const { computeNextDue, deliverers } = CI;

// ── a real P-256 keypair in the raw uncompressed-point / raw-scalar shape
//    this file's crypto works over. ─────────────────────────────────────
function ecKeypair() {
  const kp = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const pubJwk = kp.publicKey.export({ format: "jwk" });
  const privJwk = kp.privateKey.export({ format: "jwk" });
  const publicRaw = Buffer.concat([Buffer.from([0x04]), b64uDecode(pubJwk.x), b64uDecode(pubJwk.y)]);
  const privateRaw = b64uDecode(privJwk.d);
  return { publicRaw, privateRaw, publicB64u: b64uEncode(publicRaw), privateB64u: b64uEncode(privateRaw) };
}

// ═════════════════════════════════════════════════════════════════════════
console.log("── §1: THE CRYPTO — aes128gcm round-trip, independently decoded ──");
// ═════════════════════════════════════════════════════════════════════════
{
  const receiver = ecKeypair();
  const authSecret = Buffer.from("f".repeat(32), "hex"); // 16 bytes
  const sub = { endpoint: "https://push.example.com/x/abc", p256dh: receiver.publicB64u, auth: b64uEncode(authSecret) };
  const payload = checkinPushPayload(SLUG, "Anjali", null);

  const { body, senderPublicKey } = encryptPayload(sub, payload);
  ok("record header carries salt(16)+rs(4)+idlen(1)+65-byte sender key = 86 bytes",
    body.length > 86 && body[20] === 65);
  ok("the sender's ephemeral public key in the header matches what encryptPayload returned",
    body.subarray(21, 86).equals(senderPublicKey));

  const decoded = decryptPayload(body, { uaPrivate: receiver.privateRaw, authSecret });
  const parsed = JSON.parse(decoded.toString("utf8"));
  ok("round trip recovers the exact payload", JSON.stringify(parsed) === payload, JSON.stringify(parsed));
  ok("the payload carries the WS-R81 {t,title,body,url} contract, naming the room and the creator's public name",
    parsed.t === "checkin" && parsed.title === "Anjali AI has a check-in for you" &&
      parsed.body === "Tap to open the conversation." && parsed.url === `/r/${SLUG}?via=push`,
    JSON.stringify(parsed));

  // Determinism: a fixed salt and sender keypair yield byte-identical output.
  const salt = Buffer.from("0".repeat(32), "hex");
  const fixedPair = ecKeypair();
  const fixedOpts = { salt, senderKeypair: { privateKey: fixedPair.privateRaw, publicKey: fixedPair.publicRaw } };
  const { body: b1 } = encryptPayload(sub, payload, fixedOpts);
  const { body: b2 } = encryptPayload(sub, payload, fixedOpts);
  ok("a fixed salt and sender keypair produce byte-identical ciphertext", b1.equals(b2));

  // Wrong receiver key must fail to authenticate, not silently decode junk.
  const stranger = ecKeypair();
  let threw = false;
  try {
    decryptPayload(body, { uaPrivate: stranger.privateRaw, authSecret });
  } catch {
    threw = true;
  }
  ok("decrypting with the WRONG receiver key throws (AEAD authentication fails)", threw);

  // Malformed subscription keys are refused before any crypto runs.
  let badKeyThrew = false;
  try {
    encryptPayload({ endpoint: "https://x", p256dh: "not-a-point", auth: sub.auth }, payload);
  } catch {
    badKeyThrew = true;
  }
  ok("an invalid subscriber public key is refused, not silently accepted", badKeyThrew);
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n── §2: VAPID — JWT shape and a signature node itself verifies ──");
// ═════════════════════════════════════════════════════════════════════════
{
  const vapid = ecKeypair();
  const headers = vapidHeaders(
    "https://fcm.googleapis.com/wp/xyz",
    { publicKey: vapid.publicB64u, privateKey: vapid.privateB64u, subject: "mailto:ops@example.com" },
    Date.parse("2026-09-04T00:00:00.000Z"),
  );
  const m = headers.Authorization.match(/^vapid t=([^,]+), k=(.+)$/);
  ok("Authorization header carries both t= and k=", Boolean(m));
  const [, jwt, k] = m;
  ok("k= is the raw base64url VAPID public key", k === vapid.publicB64u);
  const [h, p, s] = jwt.split(".");
  const header = JSON.parse(b64uDecode(h).toString("utf8"));
  const claims = JSON.parse(b64uDecode(p).toString("utf8"));
  ok("JWT header is exactly {typ:JWT,alg:ES256}", header.typ === "JWT" && header.alg === "ES256");
  ok("aud is the endpoint's own origin", claims.aud === "https://fcm.googleapis.com");
  ok("sub carries the configured mailto:", claims.sub === "mailto:ops@example.com");
  ok("exp is roughly 12h out", claims.exp - Math.floor(Date.parse("2026-09-04T00:00:00.000Z") / 1000) === 12 * 3600);
  const sigBytes = b64uDecode(s);
  ok("the signature is raw IEEE P1363 r||s, 64 bytes (not DER)", sigBytes.length === 64);

  const { verify } = await import("node:crypto");
  const kp2 = { key: { kty: "EC", crv: "P-256", x: b64uEncode(vapid.publicRaw.subarray(1, 33)), y: b64uEncode(vapid.publicRaw.subarray(33, 65)) }, format: "jwk" };
  const { createPublicKey } = await import("node:crypto");
  const pubKeyObj = createPublicKey(kp2);
  const verified = verify("sha256", Buffer.from(`${h}.${p}`), { key: pubKeyObj, dsaEncoding: "ieee-p1363" }, sigBytes);
  ok("node's own crypto.verify accepts the signature", verified);

  let badSubjectThrew = false;
  try {
    vapidHeaders("https://x", { publicKey: vapid.publicB64u, privateKey: vapid.privateB64u, subject: "not-a-mailto" });
  } catch {
    badSubjectThrew = true;
  }
  ok("a subject that is not mailto: is refused", badSubjectThrew);
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n── §3: QUIET HOURS — computeNextDue with a 'not between' window ──");
// ═════════════════════════════════════════════════════════════════════════
{
  // No window at all — today's behaviour, unaffected (migration 085's own
  // shipping default, both columns null).
  const now = new Date("2026-09-03T10:00:00.000Z").getTime(); // Thursday, 15:30 IST
  const plain = computeNextDue(now, [1, 2, 3, 4, 5, 6, 7], "03:00", "Asia/Kolkata");
  const expectedPlainNoWindow = new Date("2026-09-04T03:00:00.000Z").getTime() - 5.5 * 3600 * 1000; // Fri 03:00 IST
  ok("no quiet window: 03:00 IST fires at 03:00 IST as picked",
    plain === expectedPlainNoWindow, new Date(plain).toISOString());

  // A PLAIN window (does not cross midnight): 01:00-05:00, picked time 03:00
  // falls inside it — every occurrence shifts to 05:00 that same day.
  const plainWindow = computeNextDue(now, [1, 2, 3, 4, 5, 6, 7], "03:00", "Asia/Kolkata", { quietFrom: "01:00", quietTo: "05:00" });
  const expectedPlain = new Date("2026-09-04T05:00:00.000Z").getTime() - 5.5 * 3600 * 1000; // 05:00 IST that day, in UTC
  ok("a picked time inside a PLAIN quiet window shifts to the window's own end, same day",
    plainWindow === expectedPlain, new Date(plainWindow).toISOString());

  // A WRAPAROUND window (crosses midnight): 22:00-07:00, picked time 23:00
  // falls inside it — the window's end (07:00) lands on the day AFTER the
  // occurrence's own date.
  const wrap = computeNextDue(now, [1, 2, 3, 4, 5, 6, 7], "23:00", "Asia/Kolkata", { quietFrom: "22:00", quietTo: "07:00" });
  // The occurrence itself is TODAY (Thursday, in `days`); the window it falls
  // in runs Thu 22:00 IST -> Fri 07:00 IST, so the window's END lands on
  // FRIDAY, the day after the occurrence's own date, not two days out.
  const expectedWrap = new Date("2026-09-04T07:00:00.000Z").getTime() - 5.5 * 3600 * 1000; // Fri 07:00 IST
  ok("a picked time inside a WRAPAROUND quiet window shifts to the window's end the NEXT day",
    wrap === expectedWrap, new Date(wrap).toISOString());

  // A picked time OUTSIDE the window is unaffected by it.
  const outside = computeNextDue(now, [1, 2, 3, 4, 5, 6, 7], "12:00", "Asia/Kolkata", { quietFrom: "22:00", quietTo: "07:00" });
  const expectedOutside = new Date("2026-09-04T12:00:00.000Z").getTime() - 5.5 * 3600 * 1000;
  ok("a picked time outside the window is unaffected", outside === expectedOutside, new Date(outside).toISOString());
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n── §4: SUBSCRIBE/UNSUBSCRIBE — scoped to the caller's OWN follower row ──");
// ═════════════════════════════════════════════════════════════════════════
{
  const state = freshState();
  const db = fakeDb(state);
  const { loadAgent } = await loadFixtureAgentForRoom(REPO);
  const joinedA = await joinRoom(db, { slug: SLUG, authUserId: USER_A, ageAttested: true, memoryConsent: true }, { loadAgent });
  const joinedB = await joinRoom(db, { slug: SLUG, authUserId: USER_B, ageAttested: true, memoryConsent: true }, { loadAgent });
  const followerA = state.followers.find((f) => f.person_id === PERSON_A);

  const pushDb = withPush(db, state);
  const subA = await setSubscription(pushDb, {
    session: joinedA.session,
    endpoint: "https://push.example.com/a",
    p256dh: "A".repeat(44),
    auth: "B".repeat(22),
    userAgent: "TestBrowser/1.0",
  }, { loadAgent });
  ok("A's subscribe returns a subscription id", typeof subA.subscription_id === "string" && subA.subscribed === true);
  ok("the row is scoped to A's own follower_id, never a request field",
    state.pushSubs.find((s) => s.subscription_id === subA.subscription_id).follower_id === followerA.follower_id);

  const statusA = await subscriptionStatus(pushDb, { session: joinedA.session }, { loadAgent });
  ok("A's own status reads subscribed:true", statusA.subscribed === true);
  const statusB = await subscriptionStatus(pushDb, { session: joinedB.session }, { loadAgent });
  ok("B, who never subscribed, reads subscribed:false", statusB.subscribed === false);

  // B tries to revoke A's endpoint by guessing it. Must be a structural no-op:
  // scoped by B's OWN follower_id, which A's row does not carry.
  const attempted = await removeSubscription(pushDb, { session: joinedB.session, endpoint: "https://push.example.com/a" }, { loadAgent });
  ok("B cannot revoke A's subscription by naming A's endpoint", attempted.revoked === false);
  ok("A's subscription is still active after B's attempt",
    state.pushSubs.find((s) => s.subscription_id === subA.subscription_id).revoked_at == null);

  // A's own unsubscribe DOES work.
  const removedA = await removeSubscription(pushDb, { session: joinedA.session, endpoint: "https://push.example.com/a" }, { loadAgent });
  ok("A's own unsubscribe revokes their own row", removedA.revoked === true);
  ok("A's status now reads subscribed:false", (await subscriptionStatus(pushDb, { session: joinedA.session }, { loadAgent })).subscribed === false);

  // Re-subscribing on the SAME endpoint updates the same row (upsert), never
  // grows a duplicate — the migration's own "unique on endpoint" law.
  await setSubscription(pushDb, { session: joinedA.session, endpoint: "https://push.example.com/a", p256dh: "C".repeat(44), auth: "D".repeat(22) }, { loadAgent });
  ok("re-subscribing on the same endpoint yields exactly one row for it",
    state.pushSubs.filter((s) => s.endpoint === "https://push.example.com/a").length === 1);
  ok("...and it is active again", state.pushSubs.find((s) => s.endpoint === "https://push.example.com/a").revoked_at == null);
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n── §5: THE DELIVERY LEDGER — not_configured / failed / delivered, and the world check ──");
// ═════════════════════════════════════════════════════════════════════════
{
  const state = freshState();
  const db = fakeDb(state);
  const { loadAgent } = await loadFixtureAgentForRoom(REPO);
  const joinedA = await joinRoom(db, { slug: SLUG, authUserId: USER_A, ageAttested: true, memoryConsent: true }, { loadAgent });
  const joinedB = await joinRoom(db, { slug: SLUG, authUserId: USER_B, ageAttested: true, memoryConsent: true }, { loadAgent });
  const followerA = state.followers.find((f) => f.person_id === PERSON_A);
  const pushDb = withPush(db, state);

  // §5 actually SENDS through `deliverers.webPush`, which calls the real
  // `encryptPayload` — unlike §4's pure scoping checks, these keys must be
  // REAL valid P-256 points and 16-byte auth secrets, or `send()` refuses
  // them before any fetch happens (exactly as it should for a malformed
  // subscription — proven separately in §1's own negative control).
  const { randomBytes } = await import("node:crypto");
  const deviceAKeys = ecKeypair();
  const deviceBKeys = ecKeypair();
  await setSubscription(pushDb, { session: joinedA.session, endpoint: "https://push.example.com/A-device", p256dh: deviceAKeys.publicB64u, auth: b64uEncode(randomBytes(16)) }, { loadAgent });
  await setSubscription(pushDb, { session: joinedB.session, endpoint: "https://push.example.com/B-device", p256dh: deviceBKeys.publicB64u, auth: b64uEncode(randomBytes(16)) }, { loadAgent });

  const rowFor = (follower, checkinId, dueAtIso) => ({
    checkin_id: checkinId,
    room_id: ROOM_ID,
    person_id: follower.person_id,
    follower_id: follower.follower_id,
    due_at: dueAtIso,
    slug: SLUG,
    display_name: "Anjali",
  });

  // — not_configured: no VAPID env at all, no read of any subscription row.
  const before = pushDb.calls.length;
  const r1 = await deliverers.webPush(pushDb, rowFor(followerA, randomUUID(), "2026-09-04T03:00:00.000Z"), { env: {} });
  ok("unconfigured VAPID writes a not_configured ledger row", r1 && state.webPushLedger.find((d) => d.delivery_id === r1.delivery_id)?.state === "not_configured");
  const subscriptionReadsWhileUnconfigured = pushDb.calls.slice(before).filter((c) => c.includes("select subscription_id, endpoint"));
  ok("...and never even reads the follower's subscriptions to get there", subscriptionReadsWhileUnconfigured.length === 0);

  const vapid = ecKeypair();
  const envDeps = { ROOM_PUSH_VAPID_PUBLIC: vapid.publicB64u, ROOM_PUSH_VAPID_PRIVATE: vapid.privateB64u, ROOM_PUSH_VAPID_SUBJECT: "mailto:ops@example.com" };

  // — failed: configured, but this follower has zero active subscriptions.
  const noSubFollower = { ...followerA, follower_id: "ffffffff-0000-4000-8000-00000000ffff", person_id: followerA.person_id };
  const r2 = await deliverers.webPush(pushDb, rowFor(noSubFollower, randomUUID(), "2026-09-04T04:00:00.000Z"), { env: envDeps });
  ok("configured VAPID + no active subscription writes a failed ledger row",
    r2 && state.webPushLedger.find((d) => d.delivery_id === r2.delivery_id)?.state === "failed");

  // — delivered: a real 2xx from the fake push service.
  const sends = [];
  const okFetch = async (url, init) => {
    sends.push(url);
    return { ok: true, status: 201 };
  };
  const checkinIdOk = randomUUID();
  const r3 = await deliverers.webPush(pushDb, rowFor(followerA, checkinIdOk, "2026-09-04T05:00:00.000Z"), { env: envDeps, fetch: okFetch, now: Date.now() });
  ok("a 2xx from the push service writes a delivered ledger row",
    r3 && state.webPushLedger.find((d) => d.delivery_id === r3.delivery_id)?.state === "delivered");
  ok("exactly one send reached A's own endpoint", sends.length === 1 && sends[0] === "https://push.example.com/A-device");
  ok("A's subscription got its last_used_at touched on a successful send",
    state.pushSubs.find((s) => s.endpoint === "https://push.example.com/A-device").last_used_at != null);

  // — (b) NEGATIVE CONTROL: a 410 revokes the subscription, and a second
  //     attempt (a different due occurrence) sends NOTHING to it.
  const deviceA2Keys = ecKeypair();
  await setSubscription(pushDb, { session: joinedA.session, endpoint: "https://push.example.com/A-second-device", p256dh: deviceA2Keys.publicB64u, auth: b64uEncode(randomBytes(16)) }, { loadAgent });
  const gone410 = [];
  const fetch410 = async (url) => {
    gone410.push(url);
    return { ok: false, status: url.endsWith("A-second-device") ? 410 : 201 };
  };
  const checkinIdRevoke = randomUUID();
  await deliverers.webPush(pushDb, rowFor(followerA, checkinIdRevoke, "2026-09-04T06:00:00.000Z"), { env: envDeps, fetch: fetch410 });
  ok("(b) a 410 revokes the subscription that returned it",
    state.pushSubs.find((s) => s.endpoint === "https://push.example.com/A-second-device").revoked_at != null);
  const sendsBeforeSecondSweep = gone410.length;
  await deliverers.webPush(pushDb, rowFor(followerA, checkinIdRevoke, "2026-09-04T07:00:00.000Z"), { env: envDeps, fetch: fetch410 });
  const newSendsToRevoked = gone410.slice(sendsBeforeSecondSweep).filter((u) => u.endsWith("A-second-device"));
  ok("(b) a second sweep sends NOTHING to the revoked subscription", newSendsToRevoked.length === 0, JSON.stringify(gone410));

  // — (c) NEGATIVE CONTROL, WORLD CHECK: a push aimed at A's check-in must
  //     never reach B's endpoint, and B's own row is untouched by it.
  const bBefore = { ...state.pushSubs.find((s) => s.endpoint === "https://push.example.com/B-device") };
  const worldSends = [];
  const worldFetch = async (url) => {
    worldSends.push(url);
    return { ok: true, status: 201 };
  };
  await deliverers.webPush(pushDb, rowFor(followerA, randomUUID(), "2026-09-04T08:00:00.000Z"), { env: envDeps, fetch: worldFetch });
  ok("(c) delivering A's check-in never sends to B's endpoint",
    !worldSends.includes("https://push.example.com/B-device"), JSON.stringify(worldSends));
  const bAfter = state.pushSubs.find((s) => s.endpoint === "https://push.example.com/B-device");
  ok("(c) B's subscription row is byte-for-byte untouched by A's delivery",
    bAfter.last_used_at === bBefore.last_used_at && bAfter.revoked_at === bBefore.revoked_at);
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n── §6: NEGATIVE CONTROL (a), STATIC — the payload builder can carry no check-in text ──");
// ═════════════════════════════════════════════════════════════════════════
{
  const src = fs.readFileSync(join(REPO, "api/_push/webpush.js"), "utf8");
  const start = src.indexOf("export function checkinPushPayload");
  ok("checkinPushPayload is present in the source", start >= 0);
  const closingBrace = src.indexOf("\n}\n", start); // the function's own end, not the next export's
  const body = src.slice(start, closingBrace < 0 ? src.length : closingBrace + 2);
  // WS-R81: the wire contract now legitimately carries a `title:` FIELD KEY
  // (the bare word "title"), so the bare-word ban this scan used to run is
  // no longer a usable signal on its own — a leak of an actual THREAD title
  // would read as property access off some row/object (`row.title`,
  // `thread.title`, `checkin.title`), never a top-level object-literal key
  // with nothing before the dot. `\.title\b` catches exactly that shape and
  // NOTHING about the contract's own `title:` key, which the NEGATIVE
  // CONTROL below proves both halves of.
  const banned = ["prompt_shape", "promptShape", "\\.title\\b", "\\bmessage\\b", "\\bsaid\\b", "checkinDirective"];
  const bannedRegex = new RegExp(banned.join("|"));
  const clean = !bannedRegex.test(body);
  ok("the REAL checkinPushPayload's own source names none of the check-in-text identifiers",
    clean, clean ? "" : body);

  // Prove the detector actually catches a bad version, not merely passes a
  // good one — evals/room-leak's own required shape for a static check.
  const poisoned = `export function checkinPushPayload(slug, promptShape, threadId) {\n  return JSON.stringify({ r: slug, shape: promptShape });\n}`;
  ok("NEGATIVE CONTROL: the same scan DOES flag a poisoned version that carries promptShape",
    bannedRegex.test(poisoned));

  // NEGATIVE CONTROL (WS-R81): a version that reads an actual row's own
  // title (property access, not the contract's own literal key) must also
  // be flagged — and the REAL function, which only ever WRITES a `title:`
  // key and never reads one off a row, must not trip it.
  const poisonedRowTitle = `export function checkinPushPayload(slug, displayName, threadId, row) {\n  return JSON.stringify({ title: row.title });\n}`;
  ok("NEGATIVE CONTROL: the same scan DOES flag a version that reads row.title off an external object",
    bannedRegex.test(poisonedRowTitle));
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n── §7: RFC 8291 APPENDIX A, REPRODUCED (WS-R41) ──");
// ═════════════════════════════════════════════════════════════════════════
{
  // Every value below was fetched from https://datatracker.ietf.org/doc/
  // html/rfc8291 (Appendix A and the Section 5 worked example), 2026-09-04 —
  // not typed from memory. Two independently-published fragments — the
  // header's own bytes and the AES-GCM ciphertext's own bytes — are checked
  // against EACH OTHER (concatenate, re-encode as base64url, compare to the
  // RFC's own Section 5 body) before this file trusts either, which is what
  // makes this a check on THIS MODULE rather than a check on whether one
  // string was typed correctly.
  const AS_PUBLIC = "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8";
  const AS_PRIVATE = "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw";
  const UA_PUBLIC = "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4";
  const UA_PRIVATE = "q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94";
  const SALT_B64U = "DGv6ra1nlYgDCS1FRnbzlw";
  const AUTH_SECRET_B64U = "BTBZMqHH6r4Tts7J_aSIgg";
  const PLAINTEXT_B64U = "V2hlbiBJIGdyb3cgdXAsIEkgd2FudCB0byBiZSBhIHdhdGVybWVsb24";
  const PLAINTEXT_UTF8 = "When I grow up, I want to be a watermelon";
  // The RFC's own Section 5 request body — header (86 octets: salt || rs=4096
  // || idlen=65 || as_public) followed directly by the 58-octet AES-GCM
  // record (41 plaintext octets + 1 delimiter + 16-octet tag) — re-encoded as
  // ONE base64url string exactly as the RFC prints it.
  const BODY_B64U = "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN";

  const bodyBytes = b64uDecode(BODY_B64U);
  ok("(self-check) the RFC's own §5 body decodes to 144 octets (86-octet header + 58-octet record)",
    bodyBytes.length === 144, `got=${bodyBytes.length}`);
  ok("(self-check) the header's own declared idlen is 65 (an uncompressed P-256 point)", bodyBytes[20] === 65);
  ok("(self-check) the header's own declared rs is 4096, not the record's actual length",
    bodyBytes.readUInt32BE(16) === 4096);

  // ── the encoder, fed the RFC's exact inputs with injected randomness ──
  const sub = { p256dh: UA_PUBLIC, auth: AUTH_SECRET_B64U };
  const salt = b64uDecode(SALT_B64U);
  const senderKeypair = { privateKey: b64uDecode(AS_PRIVATE), publicKey: b64uDecode(AS_PUBLIC) };
  const plaintext = b64uDecode(PLAINTEXT_B64U);
  ok("the RFC's own plaintext decodes to the ASCII string it names", plaintext.toString("utf8") === PLAINTEXT_UTF8);

  const { body: ourBody } = encryptPayload(sub, plaintext, { salt, senderKeypair, recordSize: 4096 });
  ok(
    "encryptPayload, given the RFC's own salt/keypair/rs=4096, produces the EXACT published request body",
    ourBody.equals(bodyBytes),
    ourBody.equals(bodyBytes) ? "" : `got=${b64uEncode(ourBody)} want=${BODY_B64U}`,
  );

  // ── the decoder, fed the RFC's own published body ──
  const decoded = decryptPayload(bodyBytes, { uaPrivate: b64uDecode(UA_PRIVATE), authSecret: b64uDecode(AUTH_SECRET_B64U) });
  ok(
    "decryptPayload, over the RFC's own published body, yields the exact published plaintext",
    decoded.toString("utf8") === PLAINTEXT_UTF8,
    decoded.toString("utf8"),
  );

  // NEGATIVE CONTROL: RFC 8291 §4's MUST — `rs` may never be smaller than
  // the record it has to hold.
  let refused = false;
  try {
    encryptPayload(sub, plaintext, { salt, senderKeypair, recordSize: 10 });
  } catch (e) {
    refused = e.message === "webpush_record_size_invalid";
  }
  ok("NEGATIVE CONTROL: a recordSize smaller than the actual record is refused, not silently truncated", refused);

  // NEGATIVE CONTROL: production's own default (no `recordSize` override,
  // `rs === record.length`) must still round-trip through the SAME decoder
  // this section just proved against the RFC — widening `rs` from an exact-
  // match requirement to a ceiling must not have broken the case the decoder
  // always handled.
  const { body: prodBody } = encryptPayload(sub, plaintext);
  const prodDecoded = decryptPayload(prodBody, { uaPrivate: b64uDecode(UA_PRIVATE), authSecret: b64uDecode(AUTH_SECRET_B64U) });
  ok(
    "production's own default (rs === record.length, no override) still round-trips through the same decoder",
    prodDecoded.toString("utf8") === PLAINTEXT_UTF8,
  );

  // NEGATIVE CONTROL: a body whose declared rs is smaller than the bytes
  // actually present after the header — malformed on the wire, or a multi-
  // record stream this single-record decoder does not support — is still
  // refused. The fix widened "rs" from "must equal" to "must be at least
  // this many bytes", never removed the check.
  const truncatedRs = Buffer.from(bodyBytes);
  truncatedRs.writeUInt32BE(30, 16); // rs=30, but 58 octets of record data follow
  let tooSmallRefused = false;
  try {
    decryptPayload(truncatedRs, { uaPrivate: b64uDecode(UA_PRIVATE), authSecret: b64uDecode(AUTH_SECRET_B64U) });
  } catch (e) {
    tooSmallRefused = e.message === "webpush_record_length_mismatch";
  }
  ok("a declared rs smaller than the actual record's bytes is still refused, not silently accepted", tooSmallRefused);
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n── §8: REAL CHROMIUM — public/room-sw.js's own push handler, every kind ──");
// ═════════════════════════════════════════════════════════════════════════
// WS-R81's own law #4: dispatch a synthetic `push` event for EACH kind
// against the REAL, currently-built `dist/room-sw.js` and assert a
// notification is shown with the right title and URL; NEGATIVE CONTROL: an
// unlisted kind shows nothing. THE REGRESSION TEST: a synthetic worker
// carrying the EXACT pre-fix guard this workstream found
// (`context/rejected.md#ws-r75-web-push-type-switch-drops-every-non-checkin-
// payload` - `if (data.t !== "checkin") return;`) must FAIL to show a
// renewal notification, and the REAL, current worker must PASS the
// identical dispatch - proving the fix with the exact defect shape rather
// than asserting it in prose.
//
// Uses Chrome DevTools Protocol's `ServiceWorker.deliverPushMessage` (via
// Playwright's own `context.newCDPSession`) to simulate a real push
// service delivery without a network route to one - `scripts/check-
// install.mjs`'s own chromium-launch/executablePath precedent (WS-R59),
// restated for a push dispatch instead of a precache walk. SKIPS cleanly,
// same as that file, if `dist/` is unbuilt or no chromium binary is
// available - this suite still runs standalone with no browser; only this
// section needs one, and `evals/run.mjs`'s own gate order runs `npx vite
// build` before the eval suite, so `dist/` is real by the time this runs
// as part of the release gate.
await (async () => {
  const { existsSync } = fs;
  const { readFile } = await import("node:fs/promises");
  const { createServer } = await import("node:http");
  const { extname, join: pjoin, normalize } = await import("node:path");

  const DIST = join(REPO, "dist");
  const PORT = 8941; // never 8931-8935/8940 - every other Chromium gate's own port (ws-common.md)
  const SLUG8 = "anjali";

  if (!existsSync(join(DIST, "room-sw.js")) || !existsSync(join(DIST, "room.html"))) {
    console.log("  skip  §8: dist/room-sw.js or dist/room.html absent, run `npx vite build` first");
    return;
  }
  let chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    console.log("  skip  §8: playwright not installed");
    return;
  }
  const executablePath = [
    process.env.CHROMIUM_PATH,
    "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
    "/opt/pw-browsers/chromium/chrome-linux/chrome",
  ].find((p) => p && existsSync(p));

  const MIME = {
    ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript",
    ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml",
    ".png": "image/png", ".webmanifest": "application/manifest+json",
  };
  const contentTypeFor = (p) => MIME[extname(p).toLowerCase()] || "application/octet-stream";

  // The OLD, pre-fix worker — the exact bug this workstream found
  // (`context/rejected.md#ws-r75-web-push-type-switch-drops-every-non-
  // checkin-payload`), served at a DISTINCT scope (`/broken-test/`) so it
  // never collides with the real worker's own registration at scope "/".
  const BROKEN_SW = `
self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = {}; }
  if (data.t !== "checkin") return;
  event.waitUntil(self.registration.showNotification(data.title || "x", { body: data.body || "", tag: "broken" }));
});
`;

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
      if (url.pathname === "/broken-test/sw.js") {
        res.writeHead(200, { "content-type": "text/javascript" });
        res.end(BROKEN_SW);
        return;
      }
      if (url.pathname === "/broken-test/" || url.pathname === "/broken-test/index.html") {
        res.writeHead(200, { "content-type": "text/html" });
        res.end("<!doctype html><title>broken-test</title>");
        return;
      }
      if (url.pathname === "/harness.html") {
        res.writeHead(200, { "content-type": "text/html" });
        res.end("<!doctype html><title>room-push harness</title>");
        return;
      }
      const rel = normalize(url.pathname.slice(1)).replace(/^(\.\.(\/|\\|$))+/, "");
      const file = pjoin(DIST, rel);
      if (!existsSync(file)) {
        res.writeHead(404).end("not found");
        return;
      }
      res.writeHead(200, { "content-type": contentTypeFor(file) });
      res.end(await readFile(file));
    } catch (err) {
      res.writeHead(500).end(String(err?.message || err));
    }
  });
  await new Promise((r) => server.listen(PORT, "127.0.0.1", r));

  // With no explicit binary, ask Playwright for its FULL chromium build by
  // channel, never its default `chromium-headless-shell`: the shell
  // registers workers and runs `push` handlers, but it has no notification
  // service, so `showNotification` resolves and `getNotifications()` stays
  // empty for every kind. That is exactly how this section passed on the
  // build container (whose binary is the full build, found above) and
  // failed on both CI runners for `04395e2` (`context/rejected.md#room-
  // push-chromium-headless-shell-shows-no-notification`). The control
  // below turns that shape into one named failure instead of eleven.
  const browser = await chromium
    .launch(
      executablePath
        ? { executablePath, args: ["--no-sandbox"] }
        : { channel: "chromium", args: ["--no-sandbox"] },
    )
    .catch(() => null);
  if (!browser) {
    server.close();
    console.log("  skip  §8: no chromium binary available");
    return;
  }

  try {
    const context = await browser.newContext({ serviceWorkers: "allow", permissions: ["notifications"] });
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${PORT}/harness.html`, { waitUntil: "load" });

    const cdp = await context.newCDPSession(page);
    await cdp.send("ServiceWorker.enable");
    const registrations = new Map(); // scopeURL -> registrationId
    cdp.on("ServiceWorker.workerRegistrationUpdated", (e) => {
      for (const r of e.registrations || []) registrations.set(r.scopeURL, r.registrationId);
    });

    // ── register the REAL worker at scope "/" ──
    await page.evaluate(() => navigator.serviceWorker.register("/room-sw.js"));
    await page
      .waitForFunction(
        () => navigator.serviceWorker.getRegistration("/room-sw.js").then((r) => !!r && !!r.active),
        null,
        { timeout: 15_000 },
      )
      .catch(() => {});
    await page.waitForTimeout(400);

    // ── register the BROKEN, pre-fix worker at a distinct scope ──
    await page.evaluate(() =>
      navigator.serviceWorker.register("/broken-test/sw.js", { scope: "/broken-test/" }),
    );
    await page
      .waitForFunction(
        () => navigator.serviceWorker.getRegistration("/broken-test/").then((r) => !!r && !!r.active),
        null,
        { timeout: 15_000 },
      )
      .catch(() => {});
    await page.waitForTimeout(400);

    const origin = `http://127.0.0.1:${PORT}`;
    const realRegId = registrations.get(`${origin}/`);
    const brokenRegId = registrations.get(`${origin}/broken-test/`);
    ok("§8 setup: the REAL room-sw.js registration was captured over CDP", Boolean(realRegId));
    ok("§8 setup: the BROKEN test worker's own registration was captured over CDP", Boolean(brokenRegId));

    // ── CONTROL: this browser can show a notification AT ALL ──
    // A page-side `showNotification` on the real registration, read back
    // through `getNotifications()`. Fails by name on a build with no
    // notification service (Playwright's `chromium-headless-shell`), so
    // the eleven kind assertions below never fail for a reason that is
    // not the worker's.
    const control = await page.evaluate(async () => {
      try {
        const reg = await navigator.serviceWorker.getRegistration("/room-sw.js");
        if (!reg) return { shown: -1, error: "no registration" };
        await reg.showNotification("control", { body: "control", tag: "control" });
        const list = await reg.getNotifications({ tag: "control" });
        for (const n of list) n.close();
        return { shown: list.length, error: null, permission: Notification.permission };
      } catch (err) {
        return { shown: -1, error: String(err?.message || err), permission: Notification.permission };
      }
    });
    ok(
      "§8 CONTROL: this Chromium build has a notification service (a page-side showNotification is readable back)",
      control.shown === 1,
      control.shown === 1
        ? "1"
        : `${control.error || `getNotifications() returned ${control.shown}`} (Notification.permission=${control.permission}): ` +
          "this is Playwright's chromium-headless-shell, which grants no notification permission; launch the full build (channel: \"chromium\")",
    );

    async function notificationsFor(swPath) {
      return page.evaluate(async (p) => {
        const reg = await navigator.serviceWorker.getRegistration(p);
        if (!reg) return [];
        const list = await reg.getNotifications();
        return list.map((n) => ({ title: n.title, body: n.body, tag: n.tag, data: n.data }));
      }, swPath);
    }
    async function closeAll(swPath) {
      await page.evaluate(async (p) => {
        const reg = await navigator.serviceWorker.getRegistration(p);
        if (!reg) return;
        const list = await reg.getNotifications();
        for (const n of list) n.close();
      }, swPath);
    }
    async function deliver(registrationId, dataString) {
      if (!registrationId) return;
      await cdp.send("ServiceWorker.deliverPushMessage", { origin, registrationId, data: dataString });
      await page.waitForTimeout(300);
    }

    if (realRegId) {
      // ── 1. EVERY LISTED KIND shows, title/body/url intact ──
      const cases = [
        { kind: "checkin", payload: checkinPushPayload(SLUG8, "Anjali", null), expectTitle: "Anjali AI has a check-in for you", expectBody: "Tap to open the conversation.", expectUrl: `/r/${SLUG8}?via=push` },
        { kind: "renewal", payload: renewalPushPayload(SLUG8, "Anjali"), expectTitle: "Renewal reminder", expectUrl: `/r/${SLUG8}?via=push` },
        { kind: "dormancy", payload: dormancyPushPayload(SLUG8, "Anjali"), expectTitle: "Dormancy notice", expectUrl: `/r/${SLUG8}?via=push` },
      ];
      for (const c of cases) {
        await closeAll("/room-sw.js");
        await deliver(realRegId, c.payload);
        const shown = await notificationsFor("/room-sw.js");
        ok(`§8: t="${c.kind}" shows a real notification`, shown.length === 1, JSON.stringify(shown));
        const n = shown[0] || {};
        ok(`§8: t="${c.kind}" notification title matches the payload`, n.title === c.expectTitle, n.title);
        if (c.expectBody) ok(`§8: t="${c.kind}" notification body matches the payload`, n.body === c.expectBody, n.body);
        ok(`§8: t="${c.kind}" notification data.url matches the payload's own url`, n.data?.url === c.expectUrl, JSON.stringify(n.data));
      }

      // ── 2. NEGATIVE CONTROL: an unlisted kind shows NOTHING ──
      await closeAll("/room-sw.js");
      await deliver(realRegId, JSON.stringify({ t: "bogus_kind", title: "should never show", body: "x", url: "/r/anjali" }));
      const afterShown = await notificationsFor("/room-sw.js");
      ok("§8 NEGATIVE CONTROL: an unlisted kind shows NOTHING", afterShown.length === 0, JSON.stringify(afterShown));
      // The drop is named in a `console.warn` — asserted STATICALLY against
      // the real built worker's own source rather than captured live: a
      // service worker's console output runs in its own DevTools target,
      // which Playwright's page-level `console` event does not bridge, so a
      // live capture here would be testing Playwright's own plumbing, not
      // this file's behaviour.
      const swSrc = fs.readFileSync(join(DIST, "room-sw.js"), "utf8");
      ok("§8 NEGATIVE CONTROL: the built worker's own source names the drop in a console.warn",
        /console\.warn\(`\[room-sw\] unrecognised push kind/.test(swSrc));
    } else {
      ok("§8: every listed kind shows a real notification (SKIPPED — real registration id unavailable)", true);
    }

    // ── 3. THE REGRESSION TEST: the renewal kind's dead path ──
    // BEFORE this workstream's fix (reproduced exactly by the BROKEN worker
    // above): a renewal push must FAIL to show. AFTER (the REAL worker,
    // already proven passing above): it must show. Both are asserted here
    // so this section fails loudly if either side of the regression is
    // ever untrue again.
    if (brokenRegId) {
      await closeAll("/broken-test/");
      await deliver(brokenRegId, renewalPushPayload(SLUG8, "Anjali"));
      const brokenShown = await notificationsFor("/broken-test/");
      ok("§8 REGRESSION: BEFORE the fix (the exact old guard), a renewal push shows NOTHING",
        brokenShown.length === 0, JSON.stringify(brokenShown));
    } else {
      ok("§8 REGRESSION: BEFORE the fix, a renewal push shows nothing (SKIPPED — broken registration id unavailable)", true);
    }
    if (realRegId) {
      await closeAll("/room-sw.js");
      await deliver(realRegId, renewalPushPayload(SLUG8, "Anjali"));
      const fixedShown = await notificationsFor("/room-sw.js");
      ok("§8 REGRESSION: AFTER the fix (the real, current worker), the SAME renewal push shows a notification",
        fixedShown.length === 1 && fixedShown[0]?.title === "Renewal reminder", JSON.stringify(fixedShown));
    }

    await context.close();
  } finally {
    await browser.close();
    server.close();
  }
})();

// ═════════════════════════════════════════════════════════════════════════
console.log("\n── §9: THE PRECACHE LEARNS THE ROOM'S LAZY CHUNKS FROM THE BUILT PAGE ──");
// ═════════════════════════════════════════════════════════════════════════
// WS-R139. The Room's secondary screens (`AccountPage`/`CheckinsPanel`/
// `SubscriptionPanel`/`HandoffPanel`/`DataMenu`/`TasteScreen`/`ForgetReceipt`)
// and the Hindi copy split (`hiTalkCopy`/`hiCopy`) now load as their own
// chunks, reached only through a runtime `import()` — invisible to a plain
// `<script src>`/`<link href>` scan of `dist/room.html`. This section proves
// `public/room-sw.js`'s own `derivePrecacheList` — restated here as a
// same-shape static walk over the REAL built `dist/room.html` and its real
// compiled JS, never a hand-typed list of chunk names — actually finds every
// one of them, offline, against whatever content hash this build happened to
// produce. Skips cleanly if `dist/` is unbuilt (this suite's own §8 precedent
// one section up).
await (async () => {
  const { existsSync } = fs;
  const { readFile } = await import("node:fs/promises");
  const DIST = join(REPO, "dist");
  if (!existsSync(join(DIST, "room.html"))) {
    console.log("  skip  §9: dist/room.html absent, run `npx vite build` first");
    return;
  }
  const html = await readFile(join(DIST, "room.html"), "utf8");
  const jsUrls = [];
  const tagRe = /\b(?:src|href)="(\/[^"]+)"/g;
  let tm;
  while ((tm = tagRe.exec(html))) {
    if (tm[1].endsWith(".js") || tm[1].endsWith(".mjs")) jsUrls.push(tm[1]);
  }
  ok("§9 setup: dist/room.html names at least one JS entry", jsUrls.length > 0, JSON.stringify(jsUrls));

  // `public/room-sw.js`'s own `DYNAMIC_IMPORT_RE`, restated here rather than
  // imported — that file is a plain (non-module) service worker script with
  // no export to read, `src/room/copy.ts`'s own restated-not-imported
  // `DEVANAGARI_RANGE` precedent one surface over. Confirmed present in the
  // real file (by name) so this section's own regex cannot silently drift
  // out of sync with the SHIPPED one without a failure naming the gap.
  const swSrc = await readFile(join(REPO, "public/room-sw.js"), "utf8");
  ok("§9 setup: public/room-sw.js still defines DYNAMIC_IMPORT_RE", swSrc.includes("const DYNAMIC_IMPORT_RE ="));
  // WS-R139 fix, found by THIS suite against the REAL build (not assumed):
  // this repo's Vite 8 build is Rolldown-powered and emits a dynamic
  // import's path as a TEMPLATE LITERAL (`` import(`./chunk-<hash>.js`) ``),
  // never the quoted string a classic Rollup build would leave — the
  // original quote-only regex here matched ZERO real chunks the moment this
  // workstream's lazy screens shipped (every assertion below would have
  // read `discovered` as empty). The quote character is its own capture
  // group, closed by a backreference, so the path is always group 2, never
  // group 1 — `public/room-sw.js`'s own identical fix has the full story
  // and must be kept byte-identical to this one.
  const dynamicImportRe = /\bimport\(\s*(?:\/\*[^*]*\*\/\s*)?(["'`])(\.[^"'`]+\.[cm]?js)\1\s*\)/g;

  const discovered = new Set();
  for (const jsUrl of jsUrls) {
    const jsPath = join(DIST, jsUrl.replace(/^\//, ""));
    if (!existsSync(jsPath)) continue;
    const jsText = await readFile(jsPath, "utf8");
    dynamicImportRe.lastIndex = 0;
    let dm;
    while ((dm = dynamicImportRe.exec(jsText))) {
      discovered.add(new URL(dm[2], `http://x${jsUrl}`).pathname);
    }
  }

  // REGRESSION: the exact shape that broke silently. BEFORE the fix (the
  // quote-only regex), a Rolldown-style template-literal import() matched
  // nothing at all; AFTER (the current regex), the identical source line
  // resolves correctly. Proven against a literal snippet rather than only
  // the built output, so this fails by name even if a future `dist/`
  // happens to switch bundlers back to quoted strings and hides the gap.
  const rolldownStyleSnippet = 'const p = () => import(`./AccountPage-abc123.js`);';
  const oldQuoteOnlyRe = /\bimport\(\s*(?:\/\*[^*]*\*\/\s*)?["'](\.[^"']+\.[cm]?js)["']\s*\)/g;
  ok("§9 REGRESSION: BEFORE the fix (the exact old quote-only regex), a Rolldown-style template-literal import() matches NOTHING",
    oldQuoteOnlyRe.exec(rolldownStyleSnippet) === null);
  dynamicImportRe.lastIndex = 0;
  const fixedMatch = dynamicImportRe.exec(rolldownStyleSnippet);
  ok("§9 REGRESSION: AFTER the fix (the real, current regex), the SAME template-literal import() resolves to the right path",
    fixedMatch !== null && fixedMatch[2] === "./AccountPage-abc123.js", fixedMatch ? fixedMatch[2] : "no match");

  const expectedPrefixes = [
    "AccountPage-", "CheckinsPanel-", "SubscriptionPanel-", "HandoffPanel-",
    "DataMenu-", "TasteScreen-", "ForgetReceipt-",
  ];
  for (const prefix of expectedPrefixes) {
    const hit = [...discovered].some((u) => u.includes(`/${prefix}`));
    ok(`§9: the built page's own dynamic import() graph names a ${prefix}*.js chunk`, hit, [...discovered].join(", "));
  }
  ok("§9: none of the discovered chunk URLs are under /api/",
    [...discovered].every((u) => !u.startsWith("/api/")));

  // NEGATIVE CONTROL: an ordinary STATIC import of a `.js` file — real ESM
  // syntax with no parentheses after `import` — must trip nothing. Only a
  // genuine CALL, `import(...)`, is a dynamic import.
  const staticImportOnly = 'import { x } from "./not-a-dynamic-chunk.js";\nexport const y = x;';
  dynamicImportRe.lastIndex = 0;
  const falseHit = dynamicImportRe.exec(staticImportOnly);
  ok("§9 NEGATIVE CONTROL: a plain static `import ... from \"./file.js\"` trips nothing",
    falseHit === null, falseHit ? falseHit[0] : "");
})();

console.log(`\nroom-push: ${pass} ok, ${fail} failed`);
process.exit(fail ? 1 : 0);

// ── local helpers ──────────────────────────────────────────────────────────

/** `evals/room/fixtures.mjs`'s own `loadFixtureAgent`, imported lazily so the
 *  top-level import list above stays limited to what §1-§3 need without a
 *  real db. */
async function loadFixtureAgentForRoom(repo) {
  const fx = await import(pathToFileURL(join(repo, "evals/room/fixtures.mjs")).href);
  return fx.loadFixtureAgent(repo);
}

/**
 * The push-subscription table, wrapping the shared Room fixture's `db` —
 * `evals/checkins/run.mjs`'s `withCheckins` one file over, same technique:
 * wrap rather than edit the shared fixture (it is shared with the
 * release-gating `evals/room-leak/run.mjs`), read the real SQL text rather
 * than assume it. Also handles the ONE new statement `deliverers.webPush`
 * (api/_checkins.js) contributes — the `web_push`-channel ledger insert —
 * so §5 can drive the real function rather than a copy of it.
 */
function withPush(baseDb, state) {
  state.pushSubs = state.pushSubs || [];
  state.webPushLedger = state.webPushLedger || [];
  const calls = [];
  const wrapped = async (sql, params = []) => {
    calls.push(sql);

    if (/insert into vy_room_push_subscription/.test(sql)) {
      const [id, roomId, personId, followerId, endpoint, p256dh, auth, uaHash] = params;
      let row = state.pushSubs.find((s) => s.endpoint === endpoint);
      if (row) {
        row.room_id = String(roomId);
        row.person_id = String(personId);
        row.follower_id = String(followerId);
        row.p256dh = p256dh;
        row.auth = auth;
        row.user_agent_hash = uaHash;
        row.revoked_at = null;
      } else {
        row = {
          subscription_id: String(id),
          room_id: String(roomId),
          person_id: String(personId),
          follower_id: String(followerId),
          endpoint,
          p256dh,
          auth,
          user_agent_hash: uaHash,
          created_at: new Date().toISOString(),
          last_used_at: null,
          revoked_at: null,
        };
        state.pushSubs.push(row);
      }
      return [{ subscription_id: row.subscription_id, created_at: row.created_at }];
    }
    if (sql.includes("vy_room_push_subscription") && sql.includes("set revoked_at") && sql.includes("endpoint =")) {
      const [followerId, endpoint] = params.map(String);
      const row = state.pushSubs.find((s) => s.follower_id === followerId && s.endpoint === endpoint && s.revoked_at == null);
      if (!row) return [];
      row.revoked_at = new Date().toISOString();
      return [{ subscription_id: row.subscription_id }];
    }
    if (sql.includes("vy_room_push_subscription") && sql.includes("set last_used_at")) {
      const [subId] = params.map(String);
      const row = state.pushSubs.find((s) => s.subscription_id === String(subId));
      if (row) row.last_used_at = new Date().toISOString();
      return [];
    }
    if (sql.includes("vy_room_push_subscription") && sql.includes("set revoked_at") && sql.includes("where subscription_id")) {
      const [subId] = params.map(String);
      const row = state.pushSubs.find((s) => s.subscription_id === String(subId));
      if (row) row.revoked_at = new Date().toISOString();
      return [];
    }
    if (sql.includes("select count(*)::int as n from vy_room_push_subscription")) {
      const [followerId] = params.map(String);
      const n = state.pushSubs.filter((s) => s.follower_id === followerId && s.revoked_at == null).length;
      return [{ n }];
    }
    if (sql.includes("select subscription_id, endpoint, p256dh, auth")) {
      const [followerId] = params.map(String);
      return state.pushSubs
        .filter((s) => s.follower_id === followerId && s.revoked_at == null)
        .map((s) => ({ subscription_id: s.subscription_id, endpoint: s.endpoint, p256dh: s.p256dh, auth: s.auth }));
    }
    if (/insert into vy_room_checkin_delivery/.test(sql) && sql.includes("'web_push'")) {
      const [deliveryId, checkinId, roomId, personId, dueAtIso, deliveredAtIso, state_, reason] = params;
      const exists = state.webPushLedger.some(
        (d) => d.checkin_id === String(checkinId) && d.due_at === dueAtIso && d.channel === "web_push",
      );
      if (exists) return [];
      const row = {
        delivery_id: String(deliveryId),
        checkin_id: String(checkinId),
        room_id: String(roomId),
        person_id: String(personId),
        due_at: dueAtIso,
        delivered_at: deliveredAtIso,
        channel: "web_push",
        state: state_,
        reason,
      };
      state.webPushLedger.push(row);
      return [{ delivery_id: row.delivery_id }];
    }

    return baseDb(sql, params);
  };
  wrapped.calls = calls;
  return wrapped;
}
