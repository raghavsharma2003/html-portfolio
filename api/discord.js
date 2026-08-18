// The Discord surface — SPEC-AGENT-LAYER §4 (Law E3).
//
// NOT WIRED. This adapter has no credentials, no registered webhook, and has
// never been contacted by Discord. It is code and tests. What is verified
// offline is the contract (the four functions), the signature algorithm
// against locally generated Ed25519 key pairs, the fail-closed paths, and the
// 2,000-char split. What is NOT verified is anything that needs a real
// application: whether Discord's interaction timing tolerates our deferral,
// and whether the gateway intents an unregistered bot is granted actually
// deliver message content. Both are named in docs/SURFACES.md rather than
// implied to work.
//
// ── the four functions, and nothing else ──────────────────────────────────
//
// Identity, rooms, recall, compile, logging and the commands are all
// api/_surface.js's. If this file ever grows a `select`, the contract has
// failed. It is ~250 lines and most of them are this comment and the
// signature check.
//
// ── the security boundary: Ed25519 over the RAW body ──────────────────────
//
// Discord signs `timestamp || rawBody` with its application key and sends
// `X-Signature-Ed25519` (hex) and `X-Signature-Timestamp`. Two properties this
// implementation refuses to compromise on:
//
//   1. THE RAW BYTES, NEVER A RE-SERIALIZATION. `JSON.stringify(req.body)` is
//      not the bytes Discord signed — key order, unicode escaping and number
//      formatting all differ — so a re-serialized verify either fails at random
//      or, worse, is "fixed" later by someone who disables it. If the raw body
//      is unavailable this adapter REFUSES rather than guesses.
//   2. FAIL CLOSED ON A MISSING KEY. No configured public key means every
//      request is refused, exactly as api/tg.js refuses without its secret. A
//      webhook that defaults open is a webhook that is open.
//
// Vercel parses request bodies by default, which would destroy property 1 —
// hence the `config` export below.
import { createPublicKey, verify as edVerify } from "node:crypto";
import { allow, ipOf } from "./_ratelimit.js";
import { dispatch, loadEngine, makeCtx, splitForLimit } from "./_surface.js";

/** Vercel must hand us the untouched stream: see property 1 above. */
export const config = { api: { bodyParser: false } };

// Env only. api/_config.js belongs to the deploy payload and is another
// workstream's file; adding a key there is an owner action, documented in
// docs/SURFACES.md. Absent => every request refused.
const PUBLIC_KEY = process.env.DISCORD_PUBLIC_KEY || "";
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN || "";
const BOT_ID = process.env.DISCORD_APPLICATION_ID || "";
const BOT_NAME = process.env.DISCORD_BOT_USERNAME || "Meera";
const API = "https://discord.com/api/v10";

/** Discord's own hard cap on a message body. Not configurable, not negotiable,
 *  and the reason render() exists as a separate function at all. */
export const DISCORD_TEXT_LIMIT = 2000;

/** Interaction types / callback types we use. */
const PING = 1;
const PONG = 1;
const DEFERRED_CHANNEL_MESSAGE = 5; // "Meera is thinking…", then a follow-up

// ── 1. verify ─────────────────────────────────────────────────────────────

/** hex -> the SPKI DER an Ed25519 public key needs. The 12-byte prefix is the
 *  fixed AlgorithmIdentifier for id-Ed25519; Node has no raw-key importer. */
function ed25519Key(hex) {
  if (!/^[0-9a-fA-F]{64}$/.test(String(hex || ""))) return null;
  const der = Buffer.concat([
    Buffer.from("302a300506032b6570032100", "hex"),
    Buffer.from(hex, "hex"),
  ]);
  try {
    return createPublicKey({ key: der, format: "der", type: "spki" });
  } catch {
    return null;
  }
}

/** The raw request bytes, or null. Prefers a platform-provided rawBody, then
 *  the unread stream. A body that has ALREADY been parsed is unrecoverable and
 *  yields null — which this adapter treats as "cannot verify", never as
 *  "verified". */
export async function rawBodyOf(req) {
  if (req?.rawBody) return Buffer.isBuffer(req.rawBody) ? req.rawBody : Buffer.from(req.rawBody);
  if (typeof req?.on !== "function") return null;
  if (req.readableEnded || req.complete) return null;
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    const b = Buffer.isBuffer(c) ? c : Buffer.from(c);
    size += b.length;
    if (size > 1_000_000) return null; // a webhook body this large is not ours
    chunks.push(b);
  }
  return Buffer.concat(chunks);
}

/**
 * @param {*} req
 * @returns {Promise<{ok:boolean, reason:string, payload?:*, respond?:{status:number,body:*}}>}
 */
export async function verify(req) {
  const key = ed25519Key(PUBLIC_KEY);
  if (!key) return { ok: false, reason: "no public key" };
  const sig = String(req?.headers?.["x-signature-ed25519"] || "");
  const ts = String(req?.headers?.["x-signature-timestamp"] || "");
  if (!/^[0-9a-fA-F]{128}$/.test(sig) || !ts) return { ok: false, reason: "bad signature header" };
  const raw = await rawBodyOf(req);
  if (!raw) return { ok: false, reason: "raw body unavailable" };
  let good = false;
  try {
    good = edVerify(null, Buffer.concat([Buffer.from(ts, "utf8"), raw]), key, Buffer.from(sig, "hex"));
  } catch {
    good = false;
  }
  if (!good) return { ok: false, reason: "bad signature" };
  let payload;
  try {
    payload = JSON.parse(raw.toString("utf8"));
  } catch {
    return { ok: false, reason: "bad json" };
  }
  // A PING must be answered with a PONG on the SAME response or Discord
  // deregisters the endpoint. It is an authentication handshake, so it belongs
  // to verify() — the engine never sees it.
  if (payload?.type === PING)
    return { ok: true, reason: "ping", payload, respond: { status: 200, body: { type: PONG } } };
  return { ok: true, reason: "", payload };
}

/** Exposed for the offline suite: the same check, against a caller-supplied
 *  key, with no module state. Keeps the algorithm testable without pretending
 *  a credential exists. */
export function verifySignature(publicKeyHex, timestamp, rawBody, signatureHex) {
  const key = ed25519Key(publicKeyHex);
  if (!key || !/^[0-9a-fA-F]{128}$/.test(String(signatureHex || ""))) return false;
  const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody), "utf8");
  try {
    return edVerify(
      null,
      Buffer.concat([Buffer.from(String(timestamp), "utf8"), body]),
      key,
      Buffer.from(signatureHex, "hex"),
    );
  } catch {
    return false;
  }
}

// ── 2. parse ──────────────────────────────────────────────────────────────

const GUILD = (p) => Boolean(p?.guild_id);

/** A member's Discord permission bits. `MANAGE_GUILD` (1<<5) is the closest
 *  analogue to Telegram's admin bit: it is the permission a room's owner
 *  holds, it is granted deliberately, and revoking it is instant. Consent is
 *  the same artifact on both wires — a visible, revocable act by whoever runs
 *  the room — which is why _surface.js only ever sees 'admin'. */
const MANAGE_GUILD = 1n << 5n;
const hasManage = (perms) => {
  try {
    return (BigInt(perms || "0") & MANAGE_GUILD) === MANAGE_GUILD;
  } catch {
    return false;
  }
};

const base = (over = {}) => ({
  surface: "discord",
  kind: "ignore",
  chatKey: "",
  chatName: "",
  isGroup: false,
  surfaceUserId: null,
  handle: "",
  text: "",
  caption: "",
  messageId: null,
  replyToSelf: false,
  fromBot: false,
  reason: "",
  adminBits: {},
  raw: null,
  ...over,
});

const userOf = (u) => ({
  surfaceUserId: u?.id == null ? null : String(u.id),
  handle: String(u?.global_name || u?.username || "").slice(0, 64),
  isBot: Boolean(u?.bot),
});

/** Interaction payloads and gateway-style MESSAGE_CREATE both normalize here.
 *  Discord sends one event per POST. */
export function parse(payload) {
  const p = payload || {};

  // GUILD_CREATE / GUILD_MEMBER_* style events, if a gateway relay is ever put
  // in front of this endpoint. Harmless when they never arrive.
  if (p.t === "GUILD_MEMBER_ADD" || p.t === "GUILD_MEMBER_REMOVE") {
    const u = userOf(p.d?.user);
    const common = { chatKey: String(p.d?.channel_id || p.d?.guild_id || ""), isGroup: true, raw: p };
    return p.t === "GUILD_MEMBER_ADD"
      ? [base({ ...common, kind: "join", adminBits: { joined: [u] } })]
      : [base({ ...common, kind: "leave", adminBits: { left: u } })];
  }

  const d = p.d || p;
  const author = d.author || d.member?.user || d.user;
  const text = String(d.content ?? d.data?.options?.[0]?.value ?? "");
  const channel = d.channel_id == null ? "" : String(d.channel_id);
  if (!channel) return [base({ reason: "no channel" })];

  // The agent's own permission state in this guild, when Discord tells us.
  // `app_permissions` rides every interaction payload.
  const selfStatus = d.app_permissions != null ? (hasManage(d.app_permissions) ? "admin" : "member") : null;
  if (d.app_permissions != null && !text)
    return [
      base({
        chatKey: channel,
        chatName: String(d.channel?.name || ""),
        isGroup: GUILD(d),
        kind: "bot_membership",
        adminBits: { selfStatus },
        raw: p,
      }),
    ];

  const u = userOf(author);
  return [
    base({
      kind: "message",
      chatKey: channel,
      chatName: String(d.channel?.name || ""),
      isGroup: GUILD(d),
      surfaceUserId: u.surfaceUserId,
      handle: u.handle,
      text,
      caption: "",
      messageId: d.id == null ? null : String(d.id),
      // Discord marks a reply with referenced_message; ours is the one whose
      // author id is the application id.
      replyToSelf: Boolean(BOT_ID) && String(d.referenced_message?.author?.id || "") === String(BOT_ID),
      fromBot: u.isBot,
      raw: p,
    }),
  ];
}

// ── 3. send ───────────────────────────────────────────────────────────────

/**
 * Fail-closed without a token, exactly as api/tg.js is without its own.
 *
 * ACK SEMANTICS, and why they do not live here: an interaction must be
 * answered within 3 seconds, and a compile-plus-model round trip is not
 * reliably that fast. The endpoint therefore replies DEFERRED_CHANNEL_MESSAGE
 * immediately (see `deferral()`), and this function delivers the real message
 * as an ordinary channel post afterwards. That keeps `send` a plain "put these
 * bytes in that room" — the same shape every other surface has — rather than
 * an interaction state machine the engine would have to know about.
 */
export async function send(chatKey, msg) {
  if (!BOT_TOKEN) return { ok: false, error: "no bot token" };
  const route =
    msg.kind === "reaction"
      ? `/channels/${chatKey}/messages/${encodeURIComponent(String(msg.replyTo))}/reactions/${encodeURIComponent(msg.emoji)}/@me`
      : `/channels/${chatKey}/messages`;
  const init = {
    method: msg.kind === "reaction" ? "PUT" : "POST",
    headers: { Authorization: `Bot ${BOT_TOKEN}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(15_000),
  };
  if (msg.kind !== "reaction") {
    const body = { content: String(msg.text ?? "").slice(0, DISCORD_TEXT_LIMIT) };
    if (msg.replyTo != null) body.message_reference = { message_id: String(msg.replyTo) };
    // Discord has no inline URL button outside components; a link button is a
    // component row. Rendering one as raw text instead would put a URL in her
    // mouth, which is the app-voiced rail leaking into her voice.
    if (msg.buttons?.length)
      body.components = [
        {
          type: 1,
          components: msg.buttons.slice(0, 5).map((b) => ({ type: 2, style: 5, label: b.text, url: b.url })),
        },
      ];
    init.body = JSON.stringify(body);
  }
  const r = await fetch(`${API}${route}`, init).catch(() => null);
  if (!r) return { ok: false, error: "network" };
  return { ok: r.ok };
}

/** The immediate ACK. Returned by the HTTP handler before the work starts. */
export const deferral = () => ({ type: DEFERRED_CHANNEL_MESSAGE });

// ── 4. render ─────────────────────────────────────────────────────────────

/** 2,000 characters, split on paragraph/line/word — never a hard slice. */
export const render = (text) => splitForLimit(text, DISCORD_TEXT_LIMIT);

// ── the adapter ───────────────────────────────────────────────────────────

export const adapter = { surface: "discord", verify, parse, send, render };

export async function handleEvent(payload, deps = {}) {
  const engine = deps.engine !== undefined ? deps.engine : await loadEngine();
  const ctx = makeCtx(adapter, { ...deps, engine, botHandle: BOT_NAME });
  const [ev] = parse(payload);
  return await dispatch(ev, ctx);
}

// ── HTTP ──────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!allow(ipOf(req), "discord", 120)) return res.status(429).json({ error: "slow down" });
  const auth = await verify(req);
  if (!auth.ok) return res.status(401).json({ error: auth.reason });
  if (auth.respond) return res.status(auth.respond.status).json(auth.respond.body);
  // ACK first, work after: the 3-second interaction deadline is Discord's, and
  // missing it shows the user an error even when the reply lands.
  res.status(200).json(deferral());
  try {
    await handleEvent(auth.payload);
  } catch (e) {
    console.error("[discord] handler failure:", e?.message || "unknown");
  }
}
