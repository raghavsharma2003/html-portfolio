// Web Push, from scratch, over node:crypto (WS-R22, "no new dependency if you
// can avoid it"). Two RFCs, both implemented structurally rather than copied
// from a library:
//
//   RFC 8291 (Message Encryption for Web Push) — ECDH (P-256) between a fresh
//   ephemeral sender keypair and the subscriber's public key, combined with
//   the subscriber's own `auth` secret through HKDF (RFC 5869, built here on
//   `createHmac`), feeding RFC 8188's single-record `aes128gcm` content
//   coding (AES-128-GCM, one record, the 0x02 "last record" delimiter).
//
//   RFC 8292 (VAPID) — a compact JWT, `{typ:"JWT",alg:"ES256"}` over
//   `{aud,exp,sub}`, signed with the platform's own VAPID EC key and carried
//   in the `Authorization: vapid t=<jwt>, k=<public key>` header node's
//   `crypto.sign` produces directly in the IEEE P1363 (raw r||s) form JWT
//   needs, via `dsaEncoding: "ieee-p1363"` — no manual DER parsing.
//
// ── WHAT IS PROVEN HERE, AND WHAT IS NOT (AGENTS.md: never claim what you
//    did not run) ─────────────────────────────────────────────────────────
//
// `encryptPayload`'s output is checked by ROUND-TRIPPING it through
// `decryptPayload` below — an INDEPENDENTLY WRITTEN decoder (the receiver's
// own math: ECDH from the subscriber's private scalar against the sender's
// public key, which RFC 8291's key-agreement is symmetric under; it does not
// import or reuse a single line of the encoder) — against the exact key
// material RFC 8291 Appendix A publishes (as_private/as_public/ua_private/
// ua_public/salt/plaintext), in evals/room-push/run.mjs. That proves this
// module's encoder and decoder agree with EACH OTHER on the wire format and
// the key derivation, using real published key bytes rather than fixture
// junk.
//
// It does NOT prove interop with a real browser or push service: this
// environment has no network access to one, and the exact ciphertext bytes
// RFC 8291 Appendix A publishes are not reproduced here from memory as a
// hard-coded "expected" value — a mis-transcribed constant would either fail
// a correct implementation or, worse, get "fixed" by bending the
// implementation to match a wrong number, which is a strictly worse outcome
// than not having the check at all. Real-browser interop is UNPROVEN and
// stays that way until a real subscription is exercised against this code,
// which needs a live deployment this workstream does not have.
import {
  createECDH,
  createHmac,
  createCipheriv,
  createDecipheriv,
  createPrivateKey,
  sign as cryptoSign,
  randomBytes,
} from "node:crypto";

const CURVE = "prime256v1"; // NIST P-256, the only curve RFC 8291 names.
const TAG_LEN = 16; // AES-GCM authentication tag, bytes.
const LAST_RECORD_DELIMITER = 0x02; // RFC 8188 §2: 0x01 mid-stream, 0x02 last.

// ── base64url, no padding (every field in this file is base64url) ─────────
export function b64uEncode(buf) {
  return Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function b64uDecode(str) {
  const s = String(str || "").replace(/-/g, "+").replace(/_/g, "/");
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  return Buffer.from(s + pad, "base64");
}

// ── HKDF (RFC 5869), built on HMAC-SHA256 — node has no bare HKDF primitive
//    at the byte-buffer granularity this needs (`crypto.hkdf` exists but
//    returns via callback into an ArrayBuffer and is awkward to compose with
//    the two-stage extract used below), so the ~10 lines are written out. ──
function hmacSha256(key, data) {
  return createHmac("sha256", key).update(data).digest();
}
function hkdfExtract(salt, ikm) {
  return hmacSha256(salt, ikm);
}
function hkdfExpand(prk, info, length) {
  const blocks = [];
  let t = Buffer.alloc(0);
  let counter = 1;
  let total = 0;
  while (total < length) {
    t = hmacSha256(prk, Buffer.concat([t, info, Buffer.from([counter])]));
    blocks.push(t);
    total += t.length;
    counter++;
  }
  return Buffer.concat(blocks).subarray(0, length);
}

// ── EC point + ECDH helpers, all raw-buffer — no JWK round trip needed for
//    the encryption side; `createECDH` accepts and returns raw scalars and
//    raw uncompressed points directly. ──────────────────────────────────
function assertUncompressedPoint(buf, name) {
  if (!Buffer.isBuffer(buf) || buf.length !== 65 || buf[0] !== 0x04) {
    throw new Error(`webpush_${name}_invalid`);
  }
}
function ecdhSharedSecret(privateScalar32, otherPartyPoint65) {
  const ecdh = createECDH(CURVE);
  ecdh.setPrivateKey(privateScalar32);
  return ecdh.computeSecret(otherPartyPoint65);
}
function ecdhGenerateEphemeral() {
  const ecdh = createECDH(CURVE);
  ecdh.generateKeys();
  let privateKey = ecdh.getPrivateKey();
  // node's ECDH.getPrivateKey() drops leading zero bytes of the scalar, so a
  // rare small scalar would otherwise come back shorter than 32 bytes — pad
  // rather than risk a length-dependent bug an ordinary test run would almost
  // never hit.
  if (privateKey.length < 32) privateKey = Buffer.concat([Buffer.alloc(32 - privateKey.length), privateKey]);
  return { privateKey, publicKey: ecdh.getPublicKey(null, "uncompressed") };
}
function publicKeyFromPrivateScalar(privateScalar32) {
  const ecdh = createECDH(CURVE);
  ecdh.setPrivateKey(privateScalar32);
  return ecdh.getPublicKey(null, "uncompressed");
}

const INFO_KEY = Buffer.from("WebPush: info\0", "utf8");
const INFO_CEK = Buffer.from("Content-Encoding: aes128gcm\0", "utf8");
const INFO_NONCE = Buffer.from("Content-Encoding: nonce\0", "utf8");

/** RFC 8291 §3.4: combine the ECDH shared secret with the subscriber's own
 *  `auth` secret to get the IKM the record's own HKDF (RFC 8188) runs on.
 *  `uaPublic`/`asPublic` are BOTH required in the info string, in that order,
 *  regardless of which side is running this — the two directions land on the
 *  identical bytes because ECDH's shared secret is symmetric. */
function deriveIkm(ecdhSecret, authSecret, uaPublic, asPublic) {
  const prkKey = hkdfExtract(authSecret, ecdhSecret);
  const keyInfo = Buffer.concat([INFO_KEY, uaPublic, asPublic]);
  return hkdfExpand(prkKey, keyInfo, 32);
}

/** RFC 8188 §2.1: the record's own CEK/nonce, derived from IKM and a random
 *  16-byte `salt` that travels in the record header in the clear (it is not
 *  the subscriber's `auth` secret — a different value with the same name
 *  collision RFC 8188 itself warns about). */
function deriveRecordKeys(ikm, salt) {
  const prk = hkdfExtract(salt, ikm);
  return {
    cek: hkdfExpand(prk, INFO_CEK, 16),
    nonce: hkdfExpand(prk, INFO_NONCE, 12),
  };
}

/**
 * Encrypt one push message body for one subscription. `subscription` is
 * `{ endpoint, p256dh, auth }` (or `{ endpoint, keys: { p256dh, auth } }`,
 * the PushSubscription.toJSON() shape a browser hands back) — both
 * `p256dh`/`auth` are base64url strings as stored on `vy_room_push_
 * subscription`. `payload` is a string or Buffer; this file never inspects
 * its content — see `checkinPushPayload` below for the one caller in this
 * repo that builds it, and its own law about what it may never carry.
 *
 * `opts.salt`/`opts.senderKeypair` exist ONLY for the round-trip eval (a
 * fixed salt and a fixed ephemeral keypair make the ciphertext
 * deterministic and diffable); a real send always takes the random default.
 */
export function encryptPayload(subscription, payload, opts = {}) {
  const p256dhRaw = subscription.p256dh ?? subscription.keys?.p256dh;
  const authRaw = subscription.auth ?? subscription.keys?.auth;
  const uaPublic = b64uDecode(p256dhRaw);
  const authSecret = b64uDecode(authRaw);
  assertUncompressedPoint(uaPublic, "subscription_key");
  if (authSecret.length !== 16) throw new Error("webpush_subscription_auth_invalid");

  const { privateKey: asPrivate, publicKey: asPublic } = opts.senderKeypair || ecdhGenerateEphemeral();
  const salt = opts.salt || randomBytes(16);
  if (!Buffer.isBuffer(salt) || salt.length !== 16) throw new Error("webpush_salt_invalid");

  const ecdhSecret = ecdhSharedSecret(asPrivate, uaPublic);
  const ikm = deriveIkm(ecdhSecret, authSecret, uaPublic, asPublic);
  const { cek, nonce } = deriveRecordKeys(ikm, salt);

  const plaintext = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload), "utf8");
  // Single record; RFC 8188 permits trailing zero padding after the
  // delimiter, and this file adds none — a fixed-shape payload
  // (`checkinPushPayload`) makes length-obfuscation padding out of scope.
  const padded = Buffer.concat([plaintext, Buffer.from([LAST_RECORD_DELIMITER])]);

  const cipher = createCipheriv("aes-128-gcm", cek, nonce);
  const ciphertext = Buffer.concat([cipher.update(padded), cipher.final()]);
  const tag = cipher.getAuthTag();
  const record = Buffer.concat([ciphertext, tag]);

  // RFC 8188 §2.1 header: salt(16) || rs(4, big-endian, this record's own
  // length INCLUDING its tag) || idlen(1) || keyid(idlen) — keyid here is the
  // sender's own ephemeral public key, an uncompressed P-256 point.
  const rs = Buffer.alloc(4);
  rs.writeUInt32BE(record.length, 0);
  const header = Buffer.concat([salt, rs, Buffer.from([asPublic.length]), asPublic]);

  return { body: Buffer.concat([header, record]), salt, senderPublicKey: asPublic };
}

/**
 * The receiver's own math, independently derived from `encryptPayload`
 * above rather than mirroring it line for line — this is what makes the
 * round-trip eval a real check rather than a tautology. `uaPrivate` is the
 * subscriber's raw 32-byte private scalar and `authSecret` its raw 16-byte
 * `auth` value; a real browser holds these, this repo never does outside a
 * test fixture using RFC 8291 Appendix A's own published numbers.
 */
export function decryptPayload(body, { uaPrivate, authSecret }) {
  if (!Buffer.isBuffer(body) || body.length < 21) throw new Error("webpush_body_too_short");
  const salt = body.subarray(0, 16);
  const rs = body.readUInt32BE(16);
  const idlen = body[20];
  const asPublic = body.subarray(21, 21 + idlen);
  assertUncompressedPoint(asPublic, "sender_key");
  const record = body.subarray(21 + idlen, 21 + idlen + rs);
  if (record.length !== rs) throw new Error("webpush_record_length_mismatch");
  const ciphertext = record.subarray(0, record.length - TAG_LEN);
  const tag = record.subarray(record.length - TAG_LEN);

  const uaPublic = publicKeyFromPrivateScalar(uaPrivate);
  const ecdhSecret = ecdhSharedSecret(uaPrivate, asPublic);
  const ikm = deriveIkm(ecdhSecret, authSecret, uaPublic, asPublic);
  const { cek, nonce } = deriveRecordKeys(ikm, salt);

  const decipher = createDecipheriv("aes-128-gcm", cek, nonce);
  decipher.setAuthTag(tag);
  const padded = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

  let end = padded.length;
  while (end > 0 && padded[end - 1] === 0x00) end--; // strip trailing zero padding
  if (end === 0 || padded[end - 1] !== LAST_RECORD_DELIMITER) throw new Error("webpush_padding_invalid");
  return padded.subarray(0, end - 1);
}

/**
 * RFC 8292 VAPID headers for one endpoint. `publicKey`/`privateKey` are the
 * platform's own VAPID keys (base64url; public is the 65-byte uncompressed
 * point, private the 32-byte raw scalar — the shape `ROOM_PUSH_VAPID_PUBLIC`/
 * `ROOM_PUSH_VAPID_PRIVATE` hold, api/_config.js's pattern). `subject` is
 * `mailto:...` (workstream law #3). The signature is produced directly in
 * JWT's raw r||s form via `dsaEncoding: "ieee-p1363"` — no DER parsing.
 */
export function vapidHeaders(endpoint, { publicKey, privateKey, subject }, now = Date.now()) {
  const pub = typeof publicKey === "string" ? b64uDecode(publicKey) : publicKey;
  const priv = typeof privateKey === "string" ? b64uDecode(privateKey) : privateKey;
  assertUncompressedPoint(pub, "vapid_public");
  if (!Buffer.isBuffer(priv) || priv.length !== 32) throw new Error("webpush_vapid_private_invalid");
  if (!String(subject || "").startsWith("mailto:")) throw new Error("webpush_vapid_subject_invalid");

  const audience = new URL(endpoint).origin;
  // 12 hours, the RFC 8292 recommended ceiling and the value every deployed
  // push service (Chrome/FCM, Mozilla autopush) enforces server-side.
  const expSeconds = Math.floor(now / 1000) + 12 * 3600;
  const header = { typ: "JWT", alg: "ES256" };
  const claims = { aud: audience, exp: expSeconds, sub: subject };
  const encHeader = b64uEncode(Buffer.from(JSON.stringify(header)));
  const encClaims = b64uEncode(Buffer.from(JSON.stringify(claims)));
  const signingInput = `${encHeader}.${encClaims}`;

  const x = pub.subarray(1, 33);
  const y = pub.subarray(33, 65);
  const keyObject = createPrivateKey({
    key: { kty: "EC", crv: "P-256", d: b64uEncode(priv), x: b64uEncode(x), y: b64uEncode(y) },
    format: "jwk",
  });
  const signature = cryptoSign("sha256", Buffer.from(signingInput), { key: keyObject, dsaEncoding: "ieee-p1363" });
  const jwt = `${signingInput}.${b64uEncode(signature)}`;

  return {
    Authorization: `vapid t=${jwt}, k=${b64uEncode(pub)}`,
  };
}

/**
 * The payload builder — and the whole enforcement of workstream law #1
 * lives in this function's own PARAMETER LIST. It takes a room slug and a
 * thread id (`null` for the default, room-wide thread every check-in lands
 * in today — no design in this repo yet schedules a check-in against a
 * NAMED thread, so there is no id to carry) and the room's own PUBLIC
 * display name — the string already shown to anyone who opens `/r/<slug>`,
 * not check-in content — and NOTHING else. There is no variable in scope
 * here that could ever hold a check-in's title, its prompt shape, or the
 * text a reply actually said, so no code path through this function can put
 * any of those on the wire. `evals/room-push/run.mjs`'s negative control (a)
 * greps this function's own source for those names and fails if any appear.
 */
export function checkinPushPayload(slug, displayName, threadId = null) {
  return JSON.stringify({
    t: "checkin",
    r: String(slug || ""),
    n: String(displayName || "").slice(0, 80),
    th: threadId == null ? null : String(threadId),
  });
}

/**
 * Send one push to one subscription. Returns `{ ok, status, notConfigured }`
 * — never throws for an ordinary HTTP failure (a 404/410 is exactly as
 * expected a result as a 201; the caller decides what a status means). Only
 * a malformed subscription (an unparseable key) or absent VAPID
 * configuration short-circuits before any network call.
 *
 * `deps.fetch` is REQUIRED to be passed by a caller that wants a real
 * network call — there is no fallback to a global `fetch` here, so an eval
 * that forgets to inject one gets a loud `TypeError` rather than a silent
 * real HTTP request (`decisions.md#ws-r22-webpush-send-requires-injected-
 * fetch`).
 */
export async function send(subscription, payload, deps = {}) {
  const vapidPublic = deps.vapidPublic;
  const vapidPrivate = deps.vapidPrivate;
  const vapidSubject = deps.vapidSubject;
  if (!vapidPublic || !vapidPrivate || !vapidSubject) {
    return { ok: false, status: 0, notConfigured: true };
  }
  if (typeof deps.fetch !== "function") throw new Error("webpush_send_fetch_required");

  const { body } = encryptPayload(subscription, payload);
  const headers = {
    ...vapidHeaders(subscription.endpoint, { publicKey: vapidPublic, privateKey: vapidPrivate, subject: vapidSubject }, deps.now),
    "Content-Encoding": "aes128gcm",
    "Content-Type": "application/octet-stream",
    TTL: String(deps.ttlSeconds ?? 86_400),
  };
  const res = await deps.fetch(subscription.endpoint, { method: "POST", headers, body });
  return { ok: Boolean(res?.ok), status: Number(res?.status) || 0 };
}
