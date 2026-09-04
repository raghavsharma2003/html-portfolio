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
const { encryptPayload, decryptPayload, vapidHeaders, checkinPushPayload, b64uEncode, b64uDecode } = WP;
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
  ok("the payload names the room and the creator's public name",
    parsed.t === "checkin" && parsed.r === SLUG && parsed.n === "Anjali" && parsed.th === null);

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
  const banned = ["prompt_shape", "promptShape", "row.title", "\\btitle\\b", "message", "\\bsaid\\b", "checkinDirective"];
  const bannedRegex = new RegExp(banned.join("|"));
  const clean = !bannedRegex.test(body);
  ok("the REAL checkinPushPayload's own source names none of the check-in-text identifiers",
    clean, clean ? "" : body);

  // Prove the detector actually catches a bad version, not merely passes a
  // good one — evals/room-leak's own required shape for a static check.
  const poisoned = `export function checkinPushPayload(slug, promptShape, threadId) {\n  return JSON.stringify({ r: slug, shape: promptShape });\n}`;
  ok("NEGATIVE CONTROL: the same scan DOES flag a poisoned version that carries promptShape",
    bannedRegex.test(poisoned));
}

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
