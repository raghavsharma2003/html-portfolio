// The Room on Telegram (WS-R18). A transport, never a tenant.
//
// Every message that reaches a reply goes through the SAME follower lane the
// web Room uses (api/_room-surface.js: resolve, join, say, export, forget)
// and leaves through the ONE reply door (`gatedReply`, reached inside
// `roomSay`). This file adds exactly one new thing to that lane: a Telegram-
// shaped IDENTITY BRIDGE and a Telegram-shaped ADDRESS BOOK, never a second
// engine and never a second reply assembler (`surface-bypasses-parse`,
// context/rejected.md - a lane that owns its own model call has silently
// become a second engine, missing every rule added after the fork).
//
// ── identity: reuse, never a second system ─────────────────────────────────
//
// `personForSurfaceUser`/`linkSurfacePerson` (api/_room.js) are the exact
// bridge api/tg.js already uses to map a Telegram user to a `vy_person` for
// Meera - agent-independent, surface-independent, migration 009's own law.
// Reused here verbatim rather than re-derived: a Telegram follower and a
// Supabase-authenticated web follower are bridged into the SAME shared person
// table by two different doors (`vy_surface_identity` here,
// `vy_account_person` there), which is what `openRoom`/`joinRoom`'s new
// `personId` bypass exists to accept.
//
// ── which Room: the pointer, not the identity ───────────────────────────────
//
// `ROOM_TELEGRAM_BOT_TOKEN` is ONE bot for the whole platform, so one private
// Telegram chat can mean different creators' Rooms at different times. The
// pointer that resolves "which Room is THIS ordinary message for" is the
// channel-mapping table migration 082 adds, read and written only through
// `api/_room-surface.js`'s `bindTelegramChannel`/`telegramChannelRoom`/
// `unbindTelegramChannel` - never a raw query here, so this file never grows
// the SQL `evals/room-leak/run.mjs`'s repo-wide scan for a creator-facing
// reader of the follower tables would have to allowlist by name.
//
// ── the gate, before any reply ──────────────────────────────────────────────
//
// `/start <slug>` sends the disclosure card once, then an inline-keyboard age
// question, then (only on "yes") an inline-keyboard memory question - both
// answered BEFORE `joinRoom` is ever called, exactly the web join's own
// requirement that both answers arrive together. An ordinary message from a
// chat with no active Room pointer, or a follower row with no attestation,
// gets the app-voiced "open a Room first" card and NEVER reaches `roomSay` -
// Law 4. Nothing in this file's cards is model text; they are deterministic
// strings sent by the app, the same posture `api/_surface.js`'s ROOM_CARD
// rail and `_room-surface.js`'s `roomDisclosureCard` both take.
import { createHmac, timingSafeEqual } from "node:crypto";
import {
  resolveRoom,
  RoomError,
  roomDisclosureCard,
  roomNameFor,
  joinRoom,
  roomSay,
  roomExport,
  roomForget,
  roomSetLocale,
  followerRow,
  mintFollowerSession,
  bindTelegramChannel,
  telegramChannelRoom,
  unbindTelegramChannel,
  normalizeLocale,
  telegramCheckinsStatusFor,
  setTelegramCheckinsEnabledForFollower,
  flagReply,
  lastReplySha256,
  FLAG_REASONS,
} from "./_room-surface.js";
import { personForSurfaceUser, linkSurfacePerson } from "./_room.js";
import { activeProviderName } from "./_payments.js";

/** Telegram's own hard limit on a text message body - `roomSay`'s own bubbles
 *  are split at 4000 (`ROOM_TEXT_LIMIT`, api/_room-surface.js), which already
 *  fits under this with room to spare, so nothing here re-splits them. */
export const ROOM_TG_TEXT_LIMIT = 4096;

// ─────────────────────────────────────────────────────────────────────────
// THE APP-VOICED CARDS - deterministic strings, never model text
// ─────────────────────────────────────────────────────────────────────────
//
// WS-R24: every card below takes a `locale` (default `"en"`, so no existing
// caller changes shape) and is picked with `normalizeLocale`'s own fallback
// rule - an unrecognised or absent value reads as English, never a thrown
// error mid-conversation. Before a follower row exists (the welcome, the age
// question, the memory question, a refusal) the caller reads the locale off
// Telegram's own `language_code` on the incoming update; once joined, it
// reads the follower's own stored `locale` - `resolveActiveFollower`'s job,
// never re-derived here.

export function welcomeNoSlugCard(locale = "en") {
  return normalizeLocale(locale) === "hi"
    ? "किसी क्रिएटर का रूम उस लिंक से खोलें जो उन्होंने आपको भेजा है। यह इस तरह दिखता है: " +
      "t.me/<bot>?start=<उनका-रूम>."
    : "Open a creator's Room with the link they shared with you - it looks like " +
      "t.me/<bot>?start=<their room>.";
}

export function adultGateCard(locale = "en") {
  return normalizeLocale(locale) === "hi"
    ? "आपके पहले संदेश से पहले: यह रूम वयस्कों के लिए है। क्या आपकी उम्र 18 साल या उससे ज़्यादा है?"
    : "Before your first message: this Room is for adults. Are you 18 or older?";
}

export function memoryGateCard(locale = "en") {
  return normalizeLocale(locale) === "hi"
    ? "एक और सवाल। क्या यह रूम संदेशों के बीच आपको याद रखे, या हर बार नई शुरुआत करे?"
    : "One more question. Should this Room remember you between messages, or start fresh every time?";
}

export function adultRefusedCard(locale = "en") {
  return normalizeLocale(locale) === "hi"
    ? "यह रूम सिर्फ वयस्कों के लिए है। अगर यह बदलता है तो आपका फिर से स्वागत है।"
    : "This Room is for adults only. You are welcome back if that changes.";
}

export function joinedCard(follower, locale = "en") {
  const included = follower?.messages_included;
  if (normalizeLocale(locale) === "hi") {
    const lines = ["आप जुड़ गए हैं। कभी भी संदेश भेजें।"];
    if (Number.isFinite(included)) {
      lines.push(
        follower?.remembers
          ? `यह रूम संदेशों के बीच आपको याद रखेगा। इस महीने आपके पास ${included} मुफ़्त संदेश हैं।`
          : `यह रूम संदेशों के बीच आपको याद नहीं रखेगा। इस महीने आपके पास ${included} मुफ़्त संदेश हैं।`,
      );
    }
    lines.push(
      "यहां के कमांड: /forget इस रूम के साथ आपका इतिहास मिटाता है, /export आपको एक कॉपी भेजता है, " +
        "/stop रूम छोड़ देता है, /english या /hindi भाषा बदलता है।",
    );
    return lines.join("\n");
  }
  const lines = ["You're in. Send a message any time."];
  if (Number.isFinite(included)) {
    lines.push(
      follower?.remembers
        ? `This Room will remember you between messages. You have ${included} free messages this month.`
        : `This Room will not remember you between messages. You have ${included} free messages this month.`,
    );
  }
  lines.push(
    "Commands here: /forget deletes your history with this Room, /export sends you a copy, " +
      "/stop leaves the Room, /hindi or /english changes the language.",
  );
  return lines.join("\n");
}

export function joinFirstCard(locale = "en") {
  return normalizeLocale(locale) === "hi"
    ? "पहले एक रूम खोलें। किसी क्रिएटर का भेजा लिंक इस्तेमाल करें, फिर यहां दो सवालों के जवाब दें।"
    : "Open a Room first. Use the link a creator shared with you, then answer the two questions here.";
}

export function roomUnavailableCard(locale = "en") {
  return normalizeLocale(locale) === "hi"
    ? "यह रूम अभी उपलब्ध नहीं है।"
    : "This Room is not available right now.";
}

export function cappedCard(details, providerConfigured, locale = "en") {
  const included = details?.messages_included;
  if (normalizeLocale(locale) === "hi") {
    const base = Number.isFinite(included)
      ? `इस महीने आपके ${included} मुफ़्त संदेश इस्तेमाल हो चुके हैं।`
      : "इस महीने आपके मुफ़्त संदेश इस्तेमाल हो चुके हैं।";
    const line = providerConfigured
      ? "अगर आप अगले महीने का इंतज़ार किए बिना बात जारी रखना चाहते हैं, तो वेब रूम पर एक पेड प्लान उपलब्ध है।"
      : "पेड प्लान अभी सेट नहीं हैं। अगले महीने और मुफ़्त संदेश मिलेंगे।";
    return `${base} ${line}`;
  }
  const base = Number.isFinite(included)
    ? `You have used your ${included} free messages this month.`
    : "You have used your free messages this month.";
  const line = providerConfigured
    ? "A paid plan is available on the web Room if you want to keep talking without waiting for next month."
    : "Paid plans are not set up yet. More free messages arrive next month.";
  return `${base} ${line}`;
}

/** `result.note` is `roomForget`'s OWN app-voiced string, already localized
 *  server side against the follower's locale before their row was deleted -
 *  this falls back to a locale-matched default only when that field is
 *  somehow absent, never overrides a note the server already localized. */
export function forgottenCard(result, locale = "en") {
  return String(
    result?.note ||
      (normalizeLocale(locale) === "hi"
        ? "इस रूम के साथ आपकी बातचीत मिटा दी गई है।"
        : "Your conversation with this Room is deleted."),
  );
}

export function stoppedCard(locale = "en") {
  return normalizeLocale(locale) === "hi"
    ? "आपने यह रूम छोड़ दिया। कुछ भी मिटाया नहीं गया, आपका इतिहास वैसा ही रहेगा। वापस आने के लिए रूम का लिंक फिर से खोलें।"
    : "You left this Room. Nothing was deleted - your history stays as it was. Open the Room's link again any time to come back.";
}

/** The confirmation after `/hindi` or `/english`, spoken in the LANGUAGE
 *  JUST CHOSEN - never the old one, since a follower who just asked for
 *  English wants to read the confirmation in English. */
export function languageChangedCard(locale) {
  return normalizeLocale(locale) === "hi"
    ? "भाषा हिन्दी में बदल दी गई है।"
    : "Language changed to English.";
}

/** `/checkins on` (WS-R34). Also the confirmation the Telegram lane never
 *  itself renders for the Room panel's own toggle - that control reads its
 *  own copy from src/room/copy.ts, `languageChangedCard`'s own split between
 *  a server-rendered card here and a client-rendered string there. */
export function checkinsOnCard(locale = "en") {
  return normalizeLocale(locale) === "hi"
    ? "टेलीग्राम पर चेक-इन चालू हैं। जब कोई बकाया हो, यह यहीं पहुंचेगा।"
    : "Check-ins on Telegram are on. A due one will reach you right here.";
}

/** `/checkins off`. Never deletes anything - the schedule itself is
 *  untouched, only THIS channel stops carrying it, `stoppedCard`'s own
 *  "leaves, no deletion" restated for a toggle instead of the whole
 *  pointer. */
export function checkinsOffCard(locale = "en") {
  return normalizeLocale(locale) === "hi"
    ? "टेलीग्राम पर चेक-इन बंद हैं। किसी भी समय /checkins on से वापस चालू करें।"
    : "Check-ins on Telegram are off. Turn them back on any time with /checkins on.";
}

/** `/flag <reason>` succeeded (WS-R67). Never names the reason back - the
 *  creator's queue is where reasons matter, not this confirmation. */
export function flaggedCard(locale = "en") {
  return normalizeLocale(locale) === "hi"
    ? "फ्लैग हो गया। इसे क्रिएटर की समीक्षा सूची में भेज दिया गया है।"
    : "Flagged. This has been sent to the creator's review queue.";
}

/** The unique index refused it (migration 116) - this exact reply was
 *  already flagged by this same account. */
export function alreadyFlaggedCard(locale = "en") {
  return normalizeLocale(locale) === "hi"
    ? "यह जवाब पहले ही फ्लैग किया जा चुका है।"
    : "You already flagged this reply.";
}

/** `/flag` with no reply yet in this follower's history to flag - a fresh
 *  join, or a Room that has said nothing since. */
export function nothingToFlagCard(locale = "en") {
  return normalizeLocale(locale) === "hi"
    ? "अभी फ्लैग करने के लिए कोई जवाब नहीं है।"
    : "There is no reply yet to flag.";
}

// ─────────────────────────────────────────────────────────────────────────
// PARSING - one Telegram update -> zero or one classified event
// ─────────────────────────────────────────────────────────────────────────

const displayName = (from) =>
  String(from?.username || [from?.first_name, from?.last_name].filter(Boolean).join(" ") || "").slice(0, 64);

/** Only PRIVATE chats. A group or supergroup is refused BY NAME, before any
 *  identity resolution or db read - Law: "groups refused by name". Vyakti
 *  Rooms v1 has no multiparty shape; a group update here is not a smaller
 *  version of the product, it is a different one this file does not build. */
export function classifyRoomTelegramUpdate(update) {
  if (update?.callback_query) {
    const cq = update.callback_query;
    const chat = cq.message?.chat || {};
    if (chat.id == null || cq.from?.id == null) {
      return { kind: "ignore", reason: "callback missing chat or user" };
    }
    return {
      kind: "callback",
      chatId: String(chat.id),
      tgUserId: String(cq.from.id),
      handle: displayName(cq.from),
      data: String(cq.data || ""),
      callbackQueryId: String(cq.id || ""),
      // WS-R24: Telegram's own `language_code` on the user object, e.g. "hi"
      // or "en". Raw here, `normalizeLocale`'s job at the point of use - this
      // file never decides what counts as Hindi, `_room-surface.js` does.
      languageCode: String(cq.from.language_code || ""),
    };
  }
  const m = update?.message;
  if (!m) return { kind: "ignore", reason: "unparsable" };
  const chat = m.chat || {};
  if (chat.type !== "private") return { kind: "ignore", reason: "group chat refused" };
  if (m.from?.id == null || chat.id == null) return { kind: "ignore", reason: "no user" };
  return {
    kind: "message",
    chatId: String(chat.id),
    tgUserId: String(m.from.id),
    handle: displayName(m.from),
    text: String(m.text || ""),
    messageId: m.message_id ?? null,
    // WS-R34, law 5: Telegram's own "reply to a specific message" gesture -
    // present only when the follower actually tapped Reply on an earlier
    // message in this chat (theirs or the bot's). `null` for an ordinary,
    // unthreaded message - the overwhelmingly common case.
    replyToMessageId: m.reply_to_message?.message_id != null ? String(m.reply_to_message.message_id) : null,
    languageCode: String(m.from.language_code || ""),
  };
}

/** `/start <slug>` (with or without a payload) -> the slug, `null` for a bare
 *  `/start`, or `undefined` for "not a /start at all" - three outcomes on
 *  purpose, so a caller never confuses "no payload" with "not this command".
 *  The slug shape matches `vy_room.slug`'s own contract
 *  (`api/_room-surface.js`'s `slugOf`), so a malformed payload is treated as
 *  no payload rather than trusted through to `resolveRoom`. */
export function parseStartCommand(text) {
  const m = /^\/start(?:@[\w_]+)?(?:\s+([a-z0-9][a-z0-9-]{0,62}))?\s*$/i.exec(String(text || "").trim());
  if (!m) return undefined;
  return m[1] ? m[1].toLowerCase() : null;
}

/** `/forget`, `/export`, `/stop`, and (WS-R24) `/hindi`/`/english`. One
 *  command each, plain words - the law. */
export function parseRoomCommand(text) {
  const m = /^\/(forget|export|stop|hindi|english)(?:@[\w_]+)?\s*$/.exec(String(text || "").trim());
  return m ? m[1] : null;
}

/** `/checkins on|off` (WS-R34). A separate parser rather than folded into
 *  `parseRoomCommand` above - that one is "no argument, one word each", and
 *  this is the first Room command in this file that takes one, so it stays
 *  its own function rather than growing the regex a case it does not share
 *  the shape of. Returns "on"/"off", or null for anything else (including a
 *  bare `/checkins`, an unrecognised argument, or not this command at all -
 *  the caller treats all three identically: nothing to do). */
export function parseCheckinsCommand(text) {
  const m = /^\/checkins(?:@[\w_]+)?\s+(on|off)\s*$/.exec(String(text || "").trim());
  return m ? m[1] : null;
}

/** `/flag <reason>` (WS-R67), law 5: same lane rules as the web control -
 *  the reason off the SAME closed list (`FLAG_REASONS`, api/_room-surface.js)
 *  the web sheet offers, `parseCheckinsCommand`'s exact shape one command
 *  over. Returns the reason, or null for anything else (including a bare
 *  `/flag`, an unrecognised reason, or not this command at all) - the
 *  caller treats all three identically: fall through, `parseCheckinsCommand`'s
 *  own rule. */
export function parseFlagCommand(text) {
  const m = /^\/flag(?:@[\w_]+)?\s+(wrong|harmful|not_them|other)\s*$/.exec(String(text || "").trim());
  return m && FLAG_REASONS.includes(m[1]) ? m[1] : null;
}

const CALLBACK_RE = /^(a1|a0|m1|m0):([a-z0-9][a-z0-9-]{0,62})$/;
export function parseCallbackData(data) {
  const m = CALLBACK_RE.exec(String(data || ""));
  return m ? { step: m[1], slug: m[2] } : null;
}

const ageKeyboard = (slug) => ({
  inline_keyboard: [[
    { text: "Yes, 18 or older", callback_data: `a1:${slug}` },
    { text: "No", callback_data: `a0:${slug}` },
  ]],
});
const memoryKeyboard = (slug) => ({
  inline_keyboard: [[
    { text: "Remember me", callback_data: `m1:${slug}` },
    { text: "Do not remember me", callback_data: `m0:${slug}` },
  ]],
});

// ─────────────────────────────────────────────────────────────────────────
// THE OUTBOUND CLIENT - injectable, so the eval fakes it with no network
// ─────────────────────────────────────────────────────────────────────────

async function tgCall(token, method, body) {
  if (!token) return { ok: false, error: "no bot token" };
  const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null);
  if (!r) return { ok: false, error: "network" };
  const j = await r.json().catch(() => ({}));
  return { ok: j?.ok === true, result: j?.result };
}

async function tgSendDocument(token, chatId, buffer, filename, caption) {
  if (!token) return { ok: false, error: "no bot token" };
  const form = new FormData();
  form.append("chat_id", String(chatId));
  if (caption) form.append("caption", String(caption).slice(0, 1024));
  form.append("document", new Blob([buffer], { type: "application/json" }), filename);
  const r = await fetch(`https://api.telegram.org/bot${token}/sendDocument`, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(20_000),
  }).catch(() => null);
  if (!r) return { ok: false, error: "network" };
  const j = await r.json().catch(() => ({}));
  return { ok: j?.ok === true, result: j?.result };
}

/**
 * The check-in sweep's own send (WS-R34, api/_checkins.js's
 * `deliverers.telegram`) - deliberately SEPARATE from `tgCall`/
 * `defaultRoomTelegramClient` above, which is the bot's reply wire and never
 * exposes an HTTP status or Telegram's own `retry_after`. The sweep needs
 * both: workstream law #3 tells "stop trying" (403 bot-blocked, 400 naming a
 * dead chat) apart from "try again later" (429, 5xx, honouring
 * `parameters.retry_after` when Telegram sends one) by the status code, not
 * by Telegram's own `ok` boolean alone. `deps.fetch` is REQUIRED -
 * `api/_room-whatsapp.js`'s `sendTemplate` own law, restated: no fallback to
 * a global `fetch`, so an eval that forgets to inject one gets a loud error
 * rather than a silent real HTTP request. Never called from an offline eval
 * without an injected `fetch` - this file's own "no calls to Telegram from
 * any eval" list, restated for a second exit rather than assumed to cover it
 * by name alone.
 */
export async function sendRoomCheckinMessage(chatId, text, deps = {}) {
  const token = deps.token ?? "";
  if (!token) return { ok: false, status: 0, errorCode: "not_configured" };
  if (typeof deps.fetch !== "function") throw new Error("room_telegram_checkin_send_fetch_required");
  const r = await deps
    .fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
      signal: AbortSignal.timeout(15_000),
    })
    .catch(() => null);
  if (!r) return { ok: false, status: 0, errorCode: "network" };
  const j = await r.json().catch(() => ({}));
  return {
    ok: j?.ok === true,
    status: Number(r.status) || 0,
    errorCode: j?.ok ? "" : String(j?.error_code ?? r.status ?? ""),
    retryAfter: Number(j?.parameters?.retry_after) || 0,
  };
}

/** Law 5's "reads it from the reply-to message when present, else the
 *  Room's default thread." Today a check-in never binds to anything BUT the
 *  Room's default thread - `vy_room_checkin` (migration 079) carries no
 *  `thread_id` column, and this workstream does not add one, so BOTH halves
 *  of that sentence resolve to the identical value today
 *  (`decisions.md#ws-r34-checkin-thread-mapping-defaults-to-null`). Built as
 *  a real seam rather than a hand-wave so the day a check-in CAN name a
 *  thread this function is where that wiring lands: `deps.threadForReply`,
 *  when injected, is asked to resolve a reply-to message id to a thread id
 *  and its answer is trusted; with nothing injected (the shipping default -
 *  no persisted message-id-to-thread mapping exists yet) it is never even
 *  called, and the result is always `null`, `roomSay`'s own "no thread
 *  named" meaning. */
export function resolveReplyThreadId(replyToMessageId, deps = {}) {
  if (replyToMessageId && typeof deps.threadForReply === "function") {
    const mapped = deps.threadForReply(replyToMessageId);
    if (mapped) return mapped;
  }
  return null;
}

/** The shipping client. `send()` is never called from an offline eval - the
 *  Do-not list this workstream carries: "No calls to Telegram from any
 *  eval." Every suite injects its own fake through `deps.tg`. */
export function defaultRoomTelegramClient(token) {
  return {
    sendMessage: (chatId, text, extra = {}) =>
      tgCall(token, "sendMessage", { chat_id: chatId, text, ...extra }),
    sendDocument: (chatId, buffer, filename, caption) =>
      tgSendDocument(token, chatId, buffer, filename, caption),
    answerCallbackQuery: (callbackQueryId, text = "") =>
      tgCall(token, "answerCallbackQuery", { callback_query_id: callbackQueryId, text: String(text).slice(0, 200) }),
  };
}

// ─────────────────────────────────────────────────────────────────────────
// THE WEBHOOK SECRET - fail closed, and unset is its own named reason
// ─────────────────────────────────────────────────────────────────────────

function secretOk(header, secret) {
  const a = createHmac("sha256", "room-tg-webhook").update(String(header || "")).digest();
  const b = createHmac("sha256", "room-tg-webhook").update(String(secret)).digest();
  return timingSafeEqual(a, b);
}

/** Law 5. An UNSET secret is a named 503 (`room_telegram_unconfigured`), never
 *  a silent 200 and never treated the same as a wrong one - a half-configured
 *  deploy must read as "not set up" on the owner's own dashboard, not as "no
 *  updates have arrived yet". A wrong (but configured) secret is a 401,
 *  refused in constant time, before any db read - negative control (b). */
export function verifyRoomTelegramWebhook(req, env = process.env) {
  const secret = String(env.ROOM_TELEGRAM_WEBHOOK_SECRET || "");
  if (!secret) return { ok: false, status: 503, reason: "room_telegram_unconfigured" };
  const header = req?.headers?.["x-telegram-bot-api-secret-token"];
  if (!secretOk(header, secret)) return { ok: false, status: 401, reason: "room_telegram_bad_secret" };
  return { ok: true, status: 200, reason: "" };
}

// ─────────────────────────────────────────────────────────────────────────
// THE STATE MACHINE - SQL predicates on the follower row, nothing kept in
// memory between updates (a serverless function remembers nothing a request
// did not just prove)
// ─────────────────────────────────────────────────────────────────────────

/** Resolve "which Room, which person, is this chat's active follower" from
 *  nothing but the chat and Telegram's own identity for it. Never creates a
 *  follower row - that is `joinRoom`'s job alone, reached only through the
 *  two-question gate. */
async function resolveActiveFollower(db, ev, ctx) {
  const identity = await ctx.findPerson("telegram", ev.tgUserId, ctx.t);
  if (!identity) return { error: "not_linked" };
  const slug = await telegramChannelRoom(db, ev.chatId);
  if (!slug) return { error: "no_room" };
  let resolved;
  try {
    resolved = await resolveRoom(db, slug, ctx.roomDeps);
  } catch {
    return { error: "unavailable" };
  }
  const follower = await followerRow(db, resolved.room.room_id, identity.person_id, resolved.agentId);
  if (!follower || follower.age_attested_at == null) return { error: "not_joined" };
  // WS-R24: the follower's OWN stored locale, never Telegram's per-message
  // `language_code` - a follower who set their phone to English after
  // choosing Hindi here must not have this Room silently follow their phone.
  return { identity, resolved, follower, locale: normalizeLocale(follower.locale) };
}

async function handleStart(db, tg, ev, slug, ctx) {
  let resolved;
  try {
    resolved = await resolveRoom(db, slug, ctx.roomDeps);
  } catch {
    // No follower row exists yet - Telegram's own `language_code` is the
    // only signal there is, `resolveActiveFollower`'s header explains why
    // that changes the moment a follower row exists.
    await tg.sendMessage(ev.chatId, roomUnavailableCard(normalizeLocale(ev.languageCode)));
    return { ok: true, unavailable: true };
  }
  const locale = normalizeLocale(ev.languageCode);
  // Law 1: the disclosure line, BEFORE the first reply, sent once. Then the
  // age question - the first of the two answers `joinRoom` requires together.
  await tg.sendMessage(ev.chatId, roomDisclosureCard(roomNameFor(resolved.sheet), locale));
  await tg.sendMessage(ev.chatId, adultGateCard(locale), { reply_markup: ageKeyboard(slug) });
  return { ok: true, gate: "age", slug };
}

async function handleCallback(db, tg, ev, ctx) {
  const parsed = parseCallbackData(ev.data);
  if (!parsed) {
    await tg.answerCallbackQuery(ev.callbackQueryId);
    return { ok: true, skipped: "bad callback" };
  }
  await tg.answerCallbackQuery(ev.callbackQueryId);
  // No follower row exists across any of these three steps until the very
  // last one commits it, so every card here reads Telegram's own
  // `language_code` - the same value on every update from the same user.
  const locale = normalizeLocale(ev.languageCode);

  if (parsed.step === "a0") {
    await tg.sendMessage(ev.chatId, adultRefusedCard(locale));
    return { ok: true, declined: "age" };
  }

  if (parsed.step === "a1") {
    await tg.sendMessage(ev.chatId, memoryGateCard(locale), { reply_markup: memoryKeyboard(parsed.slug) });
    return { ok: true, gate: "memory" };
  }

  // "m1" (remember me) or "m0" (do not remember me) - BOTH answers are now
  // known, so this is the one moment `joinRoom` is called, with both at once,
  // matching the web join's own atomic requirement.
  let resolved;
  try {
    resolved = await resolveRoom(db, parsed.slug, ctx.roomDeps);
  } catch {
    await tg.sendMessage(ev.chatId, roomUnavailableCard(locale));
    return { ok: true, unavailable: true };
  }

  const identity = await ctx.linkPerson("telegram", ev.tgUserId, { handle: ev.handle }, ctx.t);
  // §6.4's adult gate, structural: a known minor gets no identity row at all,
  // so there is nothing here to join. Refused with the SAME card as "no" on
  // the age question - a caller must not be able to tell "declined" from
  // "already known to be a minor" apart, which would be an oracle.
  if (!identity) {
    await tg.sendMessage(ev.chatId, adultRefusedCard(locale));
    return { ok: true, refused: "minor" };
  }

  let joined;
  try {
    joined = await joinRoom(
      db,
      {
        slug: parsed.slug,
        personId: identity.personId,
        ageAttested: true,
        memoryConsent: parsed.step === "m1",
        // WS-R24: the exact locale the disclosure/age/memory cards above were
        // just sent in, so the new follower row's starting locale can never
        // disagree with what this Telegram chat actually read.
        locale,
      },
      ctx.roomDeps,
    );
  } catch (e) {
    if (e instanceof RoomError) {
      await tg.sendMessage(ev.chatId, roomUnavailableCard(locale));
      return { ok: true, unavailable: true };
    }
    throw e;
  }

  // THE POINTER. Written from a FRESH read of the follower row rather than
  // from `joined.follower` (the CLIENT shape, which deliberately carries no
  // follower_id) - `followerRow` is the same read every other op in this file
  // uses, so this is not a second definition of "this follower".
  const followerRowNow = await followerRow(db, resolved.room.room_id, identity.personId, resolved.agentId);
  if (followerRowNow) {
    await bindTelegramChannel(db, {
      roomId: resolved.room.room_id,
      personId: identity.personId,
      followerId: followerRowNow.follower_id,
      channelRef: ev.chatId,
    });
  }

  await tg.sendMessage(ev.chatId, joinedCard(joined.follower, joined.locale ?? locale));
  return { ok: true, joined: true, slug: parsed.slug };
}

async function handleRoomCommand(db, tg, now, env, ev, cmd, ctx) {
  const scope = await resolveActiveFollower(db, ev, ctx);
  if (scope.error) {
    // No follower row (or none joined) - Telegram's `language_code` is the
    // only signal there is, `resolveActiveFollower`'s own header.
    const hint = normalizeLocale(ev.languageCode);
    await tg.sendMessage(
      ev.chatId,
      scope.error === "unavailable" ? roomUnavailableCard(hint) : joinFirstCard(hint),
    );
    return { ok: true, skipped: scope.error };
  }

  // WS-R24: `/hindi` and `/english` are answered here, before a session is
  // even minted - they need no `roomSay`/`roomExport`/`roomForget` call, only
  // the SAME session-scoped write the web Room's language switch uses
  // (`roomSetLocale`), reusing `mintFollowerSession`'s pattern for the
  // one-shot session this file mints on every message.
  if (cmd === "hindi" || cmd === "english") {
    const want = cmd === "hindi" ? "hi" : "en";
    const session = mintFollowerSession(scope.resolved, scope.identity.person_id, { now, env, locale: scope.locale });
    const result = await roomSetLocale(db, { session, locale: want }, ctx.roomDeps);
    await tg.sendMessage(ev.chatId, languageChangedCard(result.locale));
    return { ok: true, localeChanged: result.locale };
  }

  const session = mintFollowerSession(scope.resolved, scope.identity.person_id, {
    now,
    env,
    locale: scope.locale,
  });

  // WS-R34: `/checkins on|off`. No `roomSay`/`roomForget` call needed - this
  // toggles ONE column on the same channel pointer `resolveActiveFollower`
  // already resolved, `api/_room-surface.js`'s `setTelegramCheckinsEnabledForFollower`.
  if (cmd === "checkins_on" || cmd === "checkins_off") {
    const enabled = cmd === "checkins_on";
    await setTelegramCheckinsEnabledForFollower(db, scope.follower.follower_id, enabled);
    await tg.sendMessage(ev.chatId, enabled ? checkinsOnCard(scope.locale) : checkinsOffCard(scope.locale));
    return { ok: true, checkinsEnabled: enabled };
  }

  if (cmd.startsWith("flag:")) {
    // WS-R67, law 5: the LAST reply, never a hash the chat could supply -
    // `lastReplySha256` reads it back off this follower's own history, the
    // same read-back `flagReply` itself performs a second time (the boundary
    // law never trusts a caller-supplied hash's OWNER, only its match).
    const reason = cmd.slice(5);
    const hash = await lastReplySha256(db, { session }, ctx.roomDeps);
    if (!hash) {
      await tg.sendMessage(ev.chatId, nothingToFlagCard(scope.locale));
      return { ok: true, flagged: false, reason: "no_reply" };
    }
    try {
      await flagReply(db, { session, replySha256: hash, reason }, ctx.roomDeps);
      await tg.sendMessage(ev.chatId, flaggedCard(scope.locale));
      return { ok: true, flagged: true, reason };
    } catch (e) {
      if (e instanceof RoomError && e.code === "room_flag_already_flagged") {
        await tg.sendMessage(ev.chatId, alreadyFlaggedCard(scope.locale));
        return { ok: true, flagged: false, reason: "already_flagged" };
      }
      if (e instanceof RoomError) {
        await tg.sendMessage(ev.chatId, roomUnavailableCard(scope.locale));
        return { ok: true, flagged: false, reason: e.code };
      }
      throw e;
    }
  }

  if (cmd === "forget") {
    const result = await roomForget(db, { session }, ctx.roomDeps);
    await tg.sendMessage(ev.chatId, forgottenCard(result, scope.locale));
    return { ok: true, forgotten: true };
  }
  if (cmd === "export") {
    const result = await roomExport(db, { session }, ctx.roomDeps);
    const buf = Buffer.from(JSON.stringify(result, null, 2), "utf8");
    await tg.sendDocument(ev.chatId, buf, "room-export.json", "Your data from this Room.");
    return { ok: true, exported: true };
  }
  // cmd === "stop" - LEAVES, no deletion. Only the channel POINTER goes: the
  // membership, the memory, the consent ledger are all untouched. Reopening
  // the same slug's deep link re-binds the pointer and answers again.
  await unbindTelegramChannel(db, ev.chatId);
  await tg.sendMessage(ev.chatId, stoppedCard(scope.locale));
  return { ok: true, stopped: true };
}

async function handleOrdinaryMessage(db, tg, now, env, ev, ctx) {
  const scope = await resolveActiveFollower(db, ev, ctx);
  if (scope.error) {
    // Law 4: a chat that has not joined gets the app-voiced card and NEVER a
    // creator-voiced reply. `roomSay` (and therefore `gatedReply`) is simply
    // never reached on this branch.
    const hint = normalizeLocale(ev.languageCode);
    await tg.sendMessage(
      ev.chatId,
      scope.error === "unavailable" ? roomUnavailableCard(hint) : joinFirstCard(hint),
    );
    return { ok: true, skipped: scope.error };
  }
  const text = String(ev.text || "").trim();
  if (!text) return { ok: true, skipped: "empty" };

  const session = mintFollowerSession(scope.resolved, scope.identity.person_id, {
    now,
    env,
    locale: scope.locale,
  });
  // WS-R34, law 5: a reply-to-message id resolves to a thread id when a
  // mapping is injected (`resolveReplyThreadId`'s own header on why none is,
  // today) - `null` either way lands in the Room's default thread, exactly
  // where an ordinary (non-reply) message already lands.
  const threadId = resolveReplyThreadId(ev.replyToMessageId, ctx.roomDeps);
  let turn;
  try {
    turn = await roomSay(db, { session, message: text, threadId, transcript: [] }, ctx.roomDeps);
  } catch (e) {
    if (e instanceof RoomError) {
      if (e.code === "room_free_cap_reached") {
        const providerConfigured = activeProviderName(env) !== "none";
        await tg.sendMessage(ev.chatId, cappedCard(e.details, providerConfigured, scope.locale));
        return { ok: true, capped: true };
      }
      if (e.code === "room_join_required" || e.code === "room_session_expired" || e.code === "room_disclosure_stale") {
        await tg.sendMessage(ev.chatId, joinFirstCard(scope.locale));
        return { ok: true, skipped: "not joined" };
      }
      await tg.sendMessage(ev.chatId, roomUnavailableCard(scope.locale));
      return { ok: true, unavailable: true };
    }
    throw e;
  }
  for (const bubble of turn.bubbles) {
    if (bubble) await tg.sendMessage(ev.chatId, bubble);
  }
  return { ok: true, said: turn.bubbles.length > 0, gate: turn.gate };
}

// ─────────────────────────────────────────────────────────────────────────
// THE ONE ENTRY POINT
// ─────────────────────────────────────────────────────────────────────────

/**
 * `db`, `tg` and every follower-lane dependency are injected so an offline
 * eval drives the REAL pipeline with a fake db and a fake Telegram client and
 * no network - `evals/room-telegram/run.mjs`'s own shape, `evals/mp/tgbot.mjs`'s
 * precedent one surface over.
 */
export async function handleRoomTelegramUpdate(update, deps = {}) {
  const db = deps.db;
  if (typeof db !== "function") throw new RoomError("room_db_required", 500);
  const env = deps.env ?? process.env;
  const now = deps.now ?? Date.now();
  const tg = deps.tg ?? defaultRoomTelegramClient(String(env.ROOM_TELEGRAM_BOT_TOKEN || ""));
  const ctx = {
    findPerson: deps.personForSurfaceUser ?? personForSurfaceUser,
    linkPerson: deps.linkSurfacePerson ?? linkSurfacePerson,
    t: deps.t,
    // Threaded into every `_room-surface.js` call so the SAME injection points
    // that lane already offers (`loadAgent`, `engine`, `memory`, `reply`,
    // `personTables`, `tableApplied`, …) reach an offline eval from here too.
    roomDeps: { ...deps, now, env },
  };

  const ev = classifyRoomTelegramUpdate(update);
  if (ev.kind === "ignore") return { ok: true, skipped: ev.reason };

  if (ev.kind === "callback") return await handleCallback(db, tg, ev, ctx);

  const startSlug = parseStartCommand(ev.text);
  if (startSlug !== undefined) {
    if (startSlug === null) {
      await tg.sendMessage(ev.chatId, welcomeNoSlugCard(normalizeLocale(ev.languageCode)));
      return { ok: true, started: false };
    }
    return await handleStart(db, tg, ev, startSlug, ctx);
  }

  // WS-R34: checked before the no-argument command table above, since
  // `/checkins` is the first command in this file that takes one.
  const checkinsToggle = parseCheckinsCommand(ev.text);
  if (checkinsToggle) {
    return await handleRoomCommand(db, tg, now, env, ev, checkinsToggle === "on" ? "checkins_on" : "checkins_off", ctx);
  }

  // WS-R67: `/flag <reason>` takes an argument, `checkinsToggle`'s own reason
  // for being checked ahead of the no-argument command table below.
  const flagReason = parseFlagCommand(ev.text);
  if (flagReason) return await handleRoomCommand(db, tg, now, env, ev, `flag:${flagReason}`, ctx);

  const cmd = parseRoomCommand(ev.text);
  if (cmd) return await handleRoomCommand(db, tg, now, env, ev, cmd, ctx);

  return await handleOrdinaryMessage(db, tg, now, env, ev, ctx);
}
