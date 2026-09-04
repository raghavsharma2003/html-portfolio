// The Telegram surface — SPEC-AGENT-LAYER §4 (Law E3), originally
// PROPOSAL-MULTIPARTY-V1 §6 / WS-TGBOT.
//
// This file is now ONLY the four functions the contract asks for plus the HTTP
// edge: verify, parse, send, render. Everything that is not Telegram —
// identity resolve, room ensure, roster, the disclosure predicate call, recall,
// compile, think, logging the turn, the commands, the app-voiced rail — moved
// to api/_surface.js and is shared with every other adapter. Nothing was
// dropped on the way: the behaviour evals/mp/tgbot.mjs measures is the
// behaviour this file still produces, which is what makes the move a refactor
// rather than a rewrite.
//
// One webhook for both channel types (§6.5's duality): a private chat is
// exactly today's 1:1 product with a different transport, and a group/
// supergroup is a room. There is one bot, two channel types, and ONE person
// identity — now vy_surface_identity, with vy_tg_person as the transitional
// fallback (§4: identity resolution is agent-independent, and it is also
// surface-independent for the same human).
//
// ── the room binding, since migration 013 (task #78) ──────────────────────
//
// A room used to be addressed by `vy_group.tg_chat_id`, a bigint on a column
// named for this wire. It is now `(surface, surface_chat_id)` — text, because
// `chatKey` is an OPAQUE ADDRESS and this file already treats it as one.
//
// NOTHING IN THIS FILE CHANGED FOR THAT, and that is the contract working
// rather than an omission. `parse()` has always emitted `String(chat.id)` and
// handed it back untouched; the address book is api/_surface.js's
// (`roomForChat` / `ensureRoomForSurfaceChat` / `upsertRoomMember`), which
// dual-reads the old Telegram-shaped key and adopts any room created before
// 013. An adapter that had needed editing here would have been an adapter
// holding a query, which §"What you must NOT do" forbids for exactly this
// reason: the schema moved under four surfaces and none of them noticed.
//
// The one Telegram-specific consequence, stated so it is not rediscovered: a
// Telegram room is still MIRRORED into `tg_chat_id` by the engine half, and
// only while `vy_group_tg_chat_ix` exists. Both retire together — the
// condition is written down in docs/SURFACES.md §4.
//
// ── what is code-complete here, and what is not testable without a token ──
//
// Code-complete and exercised offline: the four functions, the constant-time
// secret compare and its fail-closed path, the update triage, the deep-link
// payload validator, the 4,096-char render, the whole engine half (identity,
// rooms, roster, disclosure-gated recall, the compiler, the honesty gate)
// driven end to end by evals/mp/tgbot.mjs against real Postgres with mock
// updates, and the room binding by evals/mp/binding.mjs.
//
// NOT exercised, and it cannot be from here: every `send()` path — no
// outbound Bot API call has ever been made, and `tgCall()` refuses
// fail-closed without TELEGRAM_BOT_TOKEN, which is the only thing an offline
// eval can prove about it. The webhook has never been registered, so nothing
// has verified that promotion-after-addition clears privacy mode for a chat
// (both outcomes are handled without a code change — see api/_surface.js's
// onBotMembership), nor that `chat_member` is delivered at the rate the
// roster path assumes. All of that needs TELEGRAM_BOT_TOKEN /
// TELEGRAM_WEBHOOK_SECRET / TELEGRAM_BOT_USERNAME, which are deliberately
// empty in api/_config.js — no human action short of registering a real
// webhook against a real bot settles it.
//
// WS-R41 (2026-09-04): what CAN be verified without a token — the request
// SHAPES `send()` builds — is now checked against core.telegram.org/bots/api
// (and its changelog), not merely self-consistent:
//   - `https://api.telegram.org/bot<token>/<method>`: "All queries to the
//     Telegram Bot API must be served over HTTPS and need to be presented in
//     this form: https://api.telegram.org/bot<token>/METHOD_NAME" — matches
//     `tgCall()` exactly.
//   - The response envelope `{ok, result, description, error_code}`: "Always
//     has a Boolean field 'ok'"; "the result of the query can be found in
//     the 'result' field" — matches `tgCall()`'s own `{ok: j?.ok === true,
//     result: j?.result}`, and its comment about never surfacing
//     `description` (which could carry the token back in an error string).
//   - FINDING, FIXED: `tgExtra()`'s reply shape used the pre-Bot-API-7.0
//     `reply_to_message_id`. core.telegram.org/bots/api-changelog: Bot API
//     7.0 (2023-12-29) "replaced parameters reply_to_message_id and
//     allow_sending_without_reply" with the `ReplyParameters` class across
//     every send method. See `tgExtra()`'s own header for the fix and the
//     full citation, and `context/rejected.md#ws-r41-tg-reply-to-message-id-
//     is-pre-bot-api-7-0`.
//   - `setMessageReaction`'s own body shape
//     ({chat_id, message_id, reaction:[{type:"emoji", emoji}]}) — VERIFIED
//     (WS-R60, 2026-09-04), but not by the primary page directly: this
//     session's fetch tool reproduced WS-R41's exact truncation once more
//     (core.telegram.org/bots/api, fetched again 2026-09-04, still cuts off
//     inside "Available types" — this pass's own last-heading probe landed on
//     "InputChecklist" — and the third-party mirror JSON spec at
//     github.com/PaulSonOfLars/telegram-bot-api-spec truncates too, at
//     "sendVenue", alphabetically right before "setMessageReaction" — new
//     evidence this is the fetch tool's own size limit, not a page-specific
//     failure). Two independent sources instead: (1) core.telegram.org/bots/
//     api-changelog, fetched 2026-09-04, Bot API 7.0 (2023-12-29): "Added the
//     method setMessageReaction that allows bots to react to messages" — this
//     page IS reachable and confirms the method exists and its version; (2)
//     raw.githubusercontent.com/grammyjs/types (main/methods.ts,
//     main/message.ts), fetched 2026-09-04 — a widely-used typed SDK
//     generated from Telegram's own reference — gives `setMessageReaction`'s
//     full parameter table (`chat_id: number|string`, `message_id: number`,
//     `reaction?: ReactionType[]`, `is_big?: boolean`) and `ReactionTypeEmoji`
//     (`{type: "emoji", emoji: <59-value enum>}`), matching this file's
//     `clientFor(...).react()` body exactly, field for field. See
//     context/rejected.md#ws-r41-provider-docs-sites-resist-a-single-page-fetch-tool-two-ways
//     for the original attempts and context/measurements.md#ws-r60-open-provider-marks-2026-09-04
//     for the full citation set.
//
// ── the security boundary at the edge ─────────────────────────────────────
//
// Telegram's webhook secret_token is delivered as the
// `X-Telegram-Bot-Api-Secret-Token` header on every update and is the ONLY
// thing standing between this endpoint and an anonymous POST that can forge a
// room, a member, or an admin promotion. It is compared in constant time, it
// is required (a missing configured secret refuses every request rather than
// defaulting open), and it is never logged.
//
// verified against core.telegram.org/bots/api#setwebhook, fetched
// 2026-09-04: "A secret token to be sent in a header
// 'X-Telegram-Bot-Api-Secret-Token' in every webhook request, 1-256
// characters. Only characters A-Z, a-z, 0-9, _ and - are allowed" — matches
// the header name `secretOk()` reads exactly. `chat_member` must be
// explicitly named in `allowed_updates` — this file's own header already
// says so and the same fetch confirms it: "explicitly specify 'chat_member'
// in the list of allowed_updates to receive these updates".
//
// ── how this endpoint gets its updates ────────────────────────────────────
//
// WEBHOOK (the shipping path). Registered once, by the owner, with the secret
// this file then requires on every update:
//
//   POST https://api.telegram.org/bot<TOKEN>/setWebhook
//     url            = https://<deployment>/api/tg
//     secret_token   = <TELEGRAM_WEBHOOK_SECRET>
//     allowed_updates= ["message","edited_message","my_chat_member","chat_member","callback_query"]
//
// `chat_member` MUST be listed explicitly — Telegram does not deliver it by
// default even to an admin bot — and its reliability is reported as patchy,
// which is why roster maintenance never depends on it alone.
//
// getUpdates (the fallback, deliberately NOT implemented). Long polling is the
// same update objects over a pull instead of a push, so parse() below is
// unchanged and a ~30-line poller script is the entire delta. It is not
// written because a poller is a process that has to live somewhere, and this
// repo's only always-on surface is Vercel functions, which are the wrong shape
// for one. Noted so the fallback is a known small job rather than a discovered
// blocker.
import { createHmac, timingSafeEqual } from "node:crypto";
import { allow, ipOf } from "./_ratelimit.js";
import { TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET, TELEGRAM_BOT_USERNAME } from "./_config.js";
import { dispatch, loadEngine, makeCtx, splitForLimit, ROOM_CARD, withdrawReceipt } from "./_surface.js";
import { q } from "./_db.js";
import { resolveInboundClone } from "./_clonechannel.js";
import { getChannelSecret } from "./_channel-secrets.js";

// Re-exported because they are the product's promises, not this wire's, and
// evals/mp/tgbot.mjs asserts the card this surface actually posts.
export { ROOM_CARD, withdrawReceipt };

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || TELEGRAM_BOT_TOKEN || "";
const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET || TELEGRAM_WEBHOOK_SECRET || "";
// Not a secret. Read once, here, so the deep links and the @-mention detector
// can never disagree about which bot this is.
const BOT_USERNAME = process.env.TELEGRAM_BOT_USERNAME || TELEGRAM_BOT_USERNAME || "MeeraBot";
const API = "https://api.telegram.org";
/** Bot API hard limit on a text message body. */
export const TG_TEXT_LIMIT = 4096;

const GROUP_TYPES = new Set(["group", "supergroup"]);
const ADMIN_STATUS = new Set(["administrator", "creator"]);

// ── 1. verify ─────────────────────────────────────────────────────────────

/** Constant-time compare that does not leak length through an early return. */
function secretOk(header) {
  if (!WEBHOOK_SECRET) return false;
  const a = createHmac("sha256", "tg-webhook").update(String(header || "")).digest();
  const b = createHmac("sha256", "tg-webhook").update(WEBHOOK_SECRET).digest();
  return timingSafeEqual(a, b);
}

export async function verify(req) {
  if (!secretOk(req?.headers?.["x-telegram-bot-api-secret-token"]))
    return { ok: false, reason: "bad secret" };
  return { ok: true, reason: "", payload: req.body || {} };
}

// ── 2. parse ──────────────────────────────────────────────────────────────

/** The raw update triage. Kept exported and unchanged: it is the shape
 *  evals/mp/tgbot.mjs asserts on directly. */
export function parseUpdate(u) {
  if (!u || typeof u !== "object") return null;
  if (u.my_chat_member) return { kind: "my_chat_member", ev: u.my_chat_member };
  if (u.chat_member) return { kind: "chat_member", ev: u.chat_member };
  if (u.callback_query) return { kind: "callback", ev: u.callback_query };
  const m = u.message || u.edited_message || u.channel_post;
  if (!m) return null;
  if (m.new_chat_members?.length) return { kind: "join", ev: m };
  if (m.left_chat_member) return { kind: "leave", ev: m };
  return { kind: "message", ev: m };
}

const displayName = (from) =>
  String(from?.username || [from?.first_name, from?.last_name].filter(Boolean).join(" ") || "").slice(0, 64);

/** `/start r<token>` and `t.me/<bot>?startgroup=r<token>` both arrive as a
 *  payload after the command. ≤64 chars, [A-Za-z0-9_-] — Telegram's own
 *  constraint, restated as a validator rather than trusted. */
export function parseStartPayload(text) {
  const m = /^\/start(?:@[\w_]+)?(?:\s+([A-Za-z0-9_-]{1,64}))?\s*$/.exec(String(text || "").trim());
  if (!m) return null;
  return { payload: m[1] || "" };
}

const statusOf = (s) =>
  s === "left" || s === "kicked" ? s : ADMIN_STATUS.has(s) ? "admin" : s ? "member" : null;

const base = (over = {}) => ({
  surface: "telegram",
  kind: "ignore",
  // The BINDING address (Gurukul WS-N): the bot this update was delivered
  // for. Telegram does not put it in the update body — every update is
  // already scoped to the bot whose token registered the webhook — so it
  // rides on the webhook URL (`?ch=<bot id>`) and is threaded in by
  // `handleUpdate`. It is NOT the chatKey: the chatKey addresses a human,
  // this addresses the bot, and `vy_clone_channel` routes on the second.
  channelRef: "",
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

const person = (u) => ({
  surfaceUserId: u?.id == null ? null : String(u.id),
  handle: displayName(u),
  isBot: Boolean(u?.is_bot),
});

/** One Telegram update -> zero or one InboundEvent. Telegram never batches. */
export function parse(payload) {
  const p = parseUpdate(payload);
  if (!p) return [base({ reason: "unparsable" })];
  const chat = p.ev.chat || {};
  const isGroup = GROUP_TYPES.has(chat.type);
  const common = {
    chatKey: chat.id == null ? "" : String(chat.id),
    chatName: chat.title || "",
    isGroup,
    raw: p.ev,
  };

  if (p.kind === "callback") return [base({ reason: "callback-not-in-v1" })];

  if (p.kind === "my_chat_member") {
    if (!isGroup) return [base({ reason: "not a room" })];
    return [
      base({
        ...common,
        kind: "bot_membership",
        adminBits: { selfStatus: statusOf(p.ev.new_chat_member?.status) },
      }),
    ];
  }

  if (p.kind === "chat_member") {
    if (!isGroup) return [base({ reason: "not a room" })];
    const u = person(p.ev.new_chat_member?.user);
    return [
      base({
        ...common,
        kind: "member_change",
        adminBits: {
          subjectStatus: statusOf(p.ev.new_chat_member?.status),
          subjectUserId: u.surfaceUserId,
          subjectHandle: u.handle,
          subjectIsBot: u.isBot,
        },
      }),
    ];
  }

  if (p.kind === "join")
    return [
      base({
        ...common,
        kind: "join",
        adminBits: { joined: (p.ev.new_chat_members || []).map(person) },
      }),
    ];

  if (p.kind === "leave")
    return [base({ ...common, kind: "leave", adminBits: { left: person(p.ev.left_chat_member) } })];

  // an ordinary message
  const m = p.ev;
  const from = m.from || {};
  if (!isGroup && chat.type !== "private") return [base({ reason: `chat type ${chat.type}` })];
  return [
    base({
      ...common,
      kind: "message",
      // A private chat's id and its user's id are the same number on Telegram,
      // but the DM device is derived from the USER, so the user is what the
      // chat key is built from — a chat key that drifted from the identity
      // would silently re-key someone's whole 1:1 history.
      chatKey: isGroup ? common.chatKey : from.id == null ? common.chatKey : String(from.id),
      surfaceUserId: from.id == null ? null : String(from.id),
      handle: displayName(from),
      text: m.text || "",
      caption: m.caption || "",
      messageId: m.message_id ?? null,
      replyToSelf: Boolean(m.reply_to_message?.from?.is_bot),
      fromBot: Boolean(from.is_bot),
    }),
  ];
}

// ── 3. send ───────────────────────────────────────────────────────────────

/** Every outbound call goes through here so the token appears in exactly one
 *  expression in this repo, and never in a log line, an error, or a return
 *  value. */
async function tgCall(method, body, token = BOT_TOKEN) {
  if (!token) return { ok: false, error: "no bot token" };
  const r = await fetch(`${API}/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null);
  if (!r) return { ok: false, error: "network" };
  const j = await r.json().catch(() => ({}));
  // never surface description text that could carry the token back
  return { ok: j?.ok === true, result: j?.result };
}

/**
 * The Bot API's own vocabulary for an OutboundMessage's optional parts.
 *
 * FINDING (WS-R41, 2026-09-04, fixed): this used to send a top-level
 * `reply_to_message_id`. core.telegram.org/bots/api-changelog, fetched
 * 2026-09-04, Bot API 7.0 (2023-12-29): "Added the class ReplyParameters and
 * replaced parameters reply_to_message_id and allow_sending_without_reply"
 * across sendMessage and every other send method. core.telegram.org/bots/api
 * #replyparameters, fetched the same date, confirms the replacement's own
 * shape: `message_id` (Integer) is "Identifier of the message that will be
 * replied to in the current chat" — no `chat_id` needed for a same-chat
 * reply, which is the only kind this file ever sends. `reply_to_message_id`
 * does not appear anywhere in the current Bot API reference this file's own
 * fetch could reach. Fixed to `reply_parameters: {message_id}`.
 */
function tgExtra(msg) {
  const extra = {};
  if (msg.replyTo != null) extra.reply_parameters = { message_id: msg.replyTo };
  if (msg.buttons?.length)
    extra.reply_markup = {
      inline_keyboard: [msg.buttons.map((b) => ({ text: b.text, url: b.url }))],
    };
  return extra;
}

/** The legacy client shape the offline suite injects — kept as the seam so
 *  evals/mp/tgbot.mjs drives the REAL pipeline with no network. Exported
 *  (WS-R60) purely so evals/mp/tgbot.mjs can also pin the REAL outbound
 *  `setMessageReaction` body shape against a monkey-patched fetch, rather
 *  than only against the injected fake client that never reaches `tgCall`
 *  at all — no behaviour change, the function itself is untouched. */
export const clientFor = (token) => ({
  message: (chatId, text, extra = {}) =>
    tgCall("sendMessage", { chat_id: chatId, text, ...extra }, token),
  react: (chatId, messageId, emoji) =>
    tgCall(
      "setMessageReaction",
      { chat_id: chatId, message_id: messageId, reaction: [{ type: "emoji", emoji }] },
      token,
    ),
});

/** Meera's own bot, and the shape the offline suite injects. A per-clone lane
 *  builds its own with `clientFor(<that clone's token>)` — never by mutating a
 *  module-level token, because two clones' updates interleave inside one warm
 *  lambda and a mutable would hand one teacher's reply to another's students. */
const defaultClient = clientFor(BOT_TOKEN);

const sendVia = (client) => (chatKey, msg) =>
  msg.kind === "reaction"
    ? client.react(chatKey, msg.replyTo, msg.emoji)
    : client.message(chatKey, msg.text, tgExtra(msg));

export const send = sendVia(defaultClient);

// ── 4. render ─────────────────────────────────────────────────────────────

/** Telegram's own limit, and nothing else: this surface has native voice notes
 *  and animated stickers, and when the media-tag lane reaches it they are
 *  rendered HERE, never in the engine. */
export const render = (text) => splitForLimit(text, TG_TEXT_LIMIT);

// ── the adapter ───────────────────────────────────────────────────────────

export const adapter = { surface: "telegram", verify, parse, send, render };

/** The deep link every member taps (§6.3 step 3). One mechanic, three jobs
 *  (onboarding, consent, payment) — §6.6. */
export function startLink(roomId, bot = BOT_USERNAME) {
  return `https://t.me/${bot}?start=r${roomId}`;
}

/**
 * The whole surface, with its four dependencies injected so the offline suite
 * drives THIS function end-to-end against a fixture namespace with no network
 * and no model:
 *
 *   t       — table-name resolver (identity in production)
 *   send    — the Telegram client ({message, react})
 *   engine  — the compiled engine bundle
 *   reply   — the brain call, so a suite can assert on the COMPILED PROMPT
 *             rather than on a generated sentence (a suite that asserted on
 *             model output would be measuring the model, not the wiring)
 *
 * `reply` returns RAW model text and this file never sees it again: since
 * ticket #102 every lane in api/_surface.js takes its reply through
 * `gatedReply()`, which runs the engine's own parse-and-gate (protocol
 * extraction, the texting-dash predicate, honesty families 1–4 and the
 * presupposition detector) before anything reaches `send()`. So an injected
 * `reply` here drives the pipeline; it is not a way around the gate, and this
 * adapter must never grow a reply path of its own — `evals/surface.mjs`
 * asserts that it has not.
 */
export async function handleUpdate(update, deps = {}) {
  const engine = deps.engine !== undefined ? deps.engine : await loadEngine();
  const [ev0] = parse(update);
  const ev = deps.channelRef ? { ...ev0, channelRef: String(deps.channelRef) } : ev0;

  // The clone binding seam. OPTIONAL by design: absent, this is byte-for-byte
  // the single-agent lane that shipped and `evals/mp/tgbot.mjs` measures it
  // unchanged. Present, it returns the clone bound to THIS bot, or null.
  //
  // NULL MEANS THE UPDATE IS DROPPED. An unbound bot, a paused or revoked
  // binding, an unpublished clone and a withdrawn consent artifact all arrive
  // as the same null (api/_clonechannel.js flattens them on purpose), and the
  // only safe response to "I do not know who should answer this" is silence.
  let bound = null;
  if (deps.bind) {
    bound = await deps.bind(ev).catch(() => null);
    if (!bound) return { ok: false, skipped: "clone_unavailable" };
  }

  const ctx = makeCtx(adapter, {
    ...deps,
    engine,
    agent: bound?.agent ?? deps.agent,
    agentId: bound?.agentId ?? deps.agentId,
    send: bound?.send ?? sendVia(deps.send || defaultClient),
    botHandle: bound?.botHandle || BOT_USERNAME,
    // `/start` with or without a room token is the linking tap. Without a
    // token it still links: it is the only way a Telegram bot may ever open a
    // conversation with someone.
    linkIntent: (ev) => {
      const s = parseStartPayload(ev.text);
      return s ? { roomRef: /^r(\d+)$/.exec(s.payload)?.[1] || null } : null;
    },
    linkFor: (roomId) => startLink(roomId, bound?.botHandle || BOT_USERNAME),
  });
  return await dispatch(ev, ctx);
}

// ── the clone binding (Gurukul WS-N) ──────────────────────────────────────

/**
 * A bot id → the published clone that answers on it, with ITS OWN bot token.
 *
 * WHERE THE BOT ID COMES FROM. Telegram never names the recipient bot in an
 * update, because a token is already one bot. So the studio's connect flow
 * hands the owner a webhook URL carrying `?ch=<bot id>` and this reads it
 * back. That is a public identifier in a URL an owner registers themselves —
 * the SECRET half is still `X-Telegram-Bot-Api-Secret-Token`, checked in
 * constant time above, and a forged `ch` without it gets nowhere.
 *
 * NOT VERIFIED, AND NO PUBLIC DOCUMENT CAN SETTLE IT (WS-R41): whether a
 * second connected bot's own token actually authorizes sends is this
 * platform's own operational state, not a fact Telegram's docs publish — no
 * second bot has ever been connected and no secret has ever been written, so
 * the default secret backend `none` refuses and this path currently ends in
 * a null and a dropped update. What WOULD settle it: an owner completing the
 * studio's connect flow against a real second bot with
 * `CHANNEL_SECRET_BACKEND=azure-keyvault` configured, then a single `/start`
 * exercising this function end to end. Named here rather than implied to
 * work, in the same words this file's header uses about `send()`.
 */
export async function bindTelegramClone(channelRef, deps = {}) {
  const ref = String(channelRef || "");
  if (!ref) return null;
  const db = deps.db || q;
  const resolved = await resolveInboundClone(db, "telegram", ref, deps).catch(() => null);
  if (!resolved) return null;
  const read = deps.readSecret || getChannelSecret;
  const token = await read(resolved.channel.credentials_ref).catch(() => null);
  // No token, no lane. Binding a clone we cannot send as would log the
  // student's turn and then go silent, which is worse than never resolving.
  if (!token) return null;
  return {
    agent: resolved.module,
    agentId: resolved.agentId,
    botHandle: resolved.module?.displayName || BOT_USERNAME,
    send: sendVia(clientFor(token)),
  };
}

// ── HTTP ──────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  // Telegram retries on non-2xx, so a rate-limited update must not be lost
  // forever — but an unauthenticated flood must not reach the database either.
  if (!allow(ipOf(req), "tg", 120)) return res.status(429).json({ error: "slow down" });
  const auth = await verify(req);
  if (!auth.ok) return res.status(401).json({ error: auth.reason });
  try {
    // The clone binder is wired at the EDGE, never inside the adapter: an
    // adapter that could reach the database would be an adapter holding a
    // query, which docs/SURFACES.md §"What you must NOT do" forbids. No `ch`
    // means Meera's own bot and today's single-agent lane, unchanged.
    const channelRef = String(req.query?.ch || "");
    const out = await handleUpdate(
      auth.payload,
      channelRef ? { channelRef, bind: () => bindTelegramClone(channelRef) } : {},
    );
    // Always 200 to Telegram once the update is authenticated: a 500 makes it
    // redeliver the same update forever, which would re-run the writes above.
    return res.status(200).json({ ok: true, handled: out?.ok !== false });
  } catch (e) {
    console.error("[tg] handler failure:", e?.message || "unknown");
    return res.status(200).json({ ok: true, handled: false });
  }
}
