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
  roomSpeak,
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
import { consume } from "./_rate-limit.js";
// WS-R110: `pcmToWavBuffer` is the pure container helper — no synthesis, no
// network — `api/_room-voice.js`'s own new header explains why this is not
// a second synthesis path. `recordIncident` is the SAME closed-list ledger
// `api/_checkins.js`'s own Telegram-send failures already write through —
// this workstream adds no new `INCIDENT_KINDS` member (that CHECK lives in
// migration 109, and this workstream carries no migration), so a real
// voice-synthesis failure is recorded under the existing generic
// `door_5xx` kind, named `door: "room-tg-voice"`.
import { pcmToWavBuffer, ROOM_TELEGRAM_VOICE_CONTAINER } from "./_room-voice.js";
import { recordIncident } from "./_incidents.js";

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

/** `/voice on` or `/voice off` (WS-R110). Neither toggles anything: this
 *  deployment has no available place to STORE a per-follower preference
 *  without a schema change this workstream is not permitted to make (both
 *  candidate locations the brief named were checked and are already
 *  committed to a different meaning — the channel pointer row's (082)
 *  `checkins_enabled`/`stopped_code` columns, WS-R34/WS-R89's own migration
 *  096, and the follower row's only settings-shaped column
 *  (`settings_reviewed_at`), is a timestamp, not a flag — see
 *  `context/rejected.md#ws-r110-room-telegram-voice-preference-no-
 *  available-column`). Parsed and answered anyway, honestly, rather than
 *  left to fall through to an ordinary message: a follower typing `/voice
 *  off` must never have those two words sent to the creator's AI as a
 *  chat turn, spending part of their monthly cap on a confused reply. */
export function voiceCommandCard(locale = "en") {
  return normalizeLocale(locale) === "hi"
    ? "जब आप पेड सदस्य हों, हर जवाब के साथ अपने आप एक वॉइस नोट आता है (आपकी मासिक सीमा तक)। " +
      "यह डिवाइस अभी हर बातचीत के लिए इसे अलग से बंद करना याद नहीं रख सकता।"
    : "A voice note already arrives automatically with every reply for paid members, up to your monthly minutes. " +
      "This deployment cannot remember a separate on/off choice per conversation yet.";
}

/** `roomSpeak` refused `room_voice_cap_reached` (WS-R110, law 3). Sent AT
 *  MOST once a day (`room_tg_voice_capped_follower`, api/_rate-limit.js) -
 *  a follower deep in a long conversation past their monthly voice minutes
 *  must not read this after every single reply. The text reply itself has
 *  already arrived by the time this is ever sent. */
export function voiceCappedCard(locale = "en") {
  return normalizeLocale(locale) === "hi"
    ? "इस महीने आपके वॉइस मिनट खत्म हो गए हैं। जवाब यहां लिखे रहेंगे।"
    : "You have used your voice minutes for this month. Replies will keep arriving here as text.";
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

/** `/voice on|off` (WS-R110), `parseCheckinsCommand`'s own shape, one
 *  command over. Returns "on"/"off", or null for anything else (including a
 *  bare `/voice`) - the caller falls through to ordinary dispatch on null,
 *  exactly as every other command parser here does. */
export function parseVoiceCommand(text) {
  const m = /^\/voice(?:@[\w_]+)?\s+(on|off)\s*$/.exec(String(text || "").trim());
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

// `status` rides on every return shape below (WS-R123) purely so the
// SHIPPING CLIENT's own wrapper (`defaultRoomTelegramClient`) can record a
// `provider_telegram` incident with a real status rather than a bare
// boolean — `0` for "never reached Telegram at all" (no token, or a network
// failure `fetch` itself caught), Telegram's own HTTP status otherwise.
// `recordIncident`'s own `validStatus` already accepts 0-999, so this adds
// no new validation surface.
async function tgCall(token, method, body) {
  if (!token) return { ok: false, error: "no bot token", status: 0 };
  const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null);
  if (!r) return { ok: false, error: "network", status: 0 };
  const j = await r.json().catch(() => ({}));
  return { ok: j?.ok === true, result: j?.result, status: Number(r.status) || 0 };
}

/**
 * WS-R110: multipart upload of a voice clip's bytes.
 *
 * WS-R114 fetched `core.telegram.org/bots/api` in full this session (curl
 * to a file, 860,075 bytes, HTTP 200 — no truncation, unlike the summarizing
 * fetch tool WS-R41/WS-R60 hit on this exact page) and read `sendVoice`'s
 * own paragraph, fetched 2026-09-05: "Use this method to send audio files,
 * if you want Telegram clients to display the file as a playable voice
 * message. For this to work, your audio must be in an .OGG file encoded
 * with OPUS, or in .MP3 format, or in .M4A format (other formats may be
 * sent as Audio or Document)." WAV is none of the three, so the codec
 * requirement WS-R110 left UNVERIFIED is now VERIFIED — against the
 * document, not a live send: whether Telegram's client renders a
 * non-conforming `sendVoice` upload as a generic attachment or refuses it
 * outright still needs a live bot token, same class of gap, now narrowed
 * to just that one point
 * (`context/decisions.md#ws-r114-telegram-wav-kept-over-unverifiable-lossy-
 * transcode`). The `chat_id` + multipart-file-field shape below matches
 * `tgSendDocument` above (already live, already exercised by `/export`) and
 * is unchanged: WAV stays, deliberately, over a transcode nobody here can
 * prove keeps the watermark (`ROOM_TELEGRAM_VOICE_CONTAINER`,
 * api/_room-voice.js, states the format shortfall as a structural fact).
 */
async function tgSendVoice(token, chatId, buffer, mimeType) {
  if (!token) return { ok: false, error: "no bot token", status: 0 };
  const form = new FormData();
  form.append("chat_id", String(chatId));
  form.append("voice", new Blob([buffer], { type: mimeType }), `reply.${ROOM_TELEGRAM_VOICE_CONTAINER.extension}`);
  const r = await fetch(`https://api.telegram.org/bot${token}/sendVoice`, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(30_000),
  }).catch(() => null);
  if (!r) return { ok: false, error: "network", status: 0 };
  const j = await r.json().catch(() => ({}));
  return { ok: j?.ok === true, result: j?.result, status: Number(r.status) || 0 };
}

async function tgSendDocument(token, chatId, buffer, filename, caption) {
  if (!token) return { ok: false, error: "no bot token", status: 0 };
  const form = new FormData();
  form.append("chat_id", String(chatId));
  if (caption) form.append("caption", String(caption).slice(0, 1024));
  form.append("document", new Blob([buffer], { type: "application/json" }), filename);
  const r = await fetch(`https://api.telegram.org/bot${token}/sendDocument`, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(20_000),
  }).catch(() => null);
  if (!r) return { ok: false, error: "network", status: 0 };
  const j = await r.json().catch(() => ({}));
  return { ok: j?.ok === true, result: j?.result, status: Number(r.status) || 0 };
}

/**
 * The check-in sweep's own send (WS-R34, api/_checkins.js's
 * `deliverers.telegram`) - deliberately SEPARATE from `tgCall`/
 * `defaultRoomTelegramClient` above, which is the bot's reply wire. Both now
 * expose an HTTP status (WS-R123 added it to `tgCall`/`tgSendVoice`/
 * `tgSendDocument` for the reply wire's own incident recording, below), but
 * only the sweep's own send ever reads Telegram's `retry_after` - the
 * reply wire has no due row to reschedule, so a retry ladder would have no
 * caller. The sweep needs
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
 *  eval." Every suite injects its own fake through `deps.tg`.
 *
 *  WS-R123: `deps.db`/`deps.recordIncident` are the SAME injection seam
 *  `attemptRoomVoiceDelivery` already uses one function up (`ctx.roomDeps.
 *  recordIncident ?? recordIncident`) — every method below records a
 *  `provider_telegram` incident when Telegram was actually reached and
 *  refused or errored (`result.status > 0`), never for "no bot token"
 *  (an unconfigured deployment, `_self-check.js`'s own surface, not a
 *  provider failure) — the identical refusal-vs-error split this file's own
 *  `attemptRoomVoiceDelivery` already draws for voice. Fire-and-forget, own
 *  catch inside `recordIncident` itself, never awaited: a reply already on
 *  its way to (or already failed toward) a follower must never wait on a
 *  bookkeeping write. */
export function defaultRoomTelegramClient(token, deps = {}) {
  const db = deps.db;
  const recordIncidentFn = deps.recordIncident ?? recordIncident;
  const noted = (result) => {
    if (db && result?.ok === false && Number(result.status) > 0) {
      recordIncidentFn(db, { kind: "provider_telegram", door: "room-tg", status: Number(result.status) || 0 });
    }
    return result;
  };
  return {
    sendMessage: (chatId, text, extra = {}) =>
      tgCall(token, "sendMessage", { chat_id: chatId, text, ...extra }).then(noted),
    sendDocument: (chatId, buffer, filename, caption) =>
      tgSendDocument(token, chatId, buffer, filename, caption).then(noted),
    // WS-R110/WS-R114. `mimeType` is truthful; it is honestly NOT one of
    // sendVoice's own documented formats (`ROOM_TELEGRAM_VOICE_CONTAINER`,
    // api/_room-voice.js) — `tgSendVoice`'s own header states the citation.
    sendVoice: (chatId, buffer, mimeType) => tgSendVoice(token, chatId, buffer, mimeType).then(noted),
    answerCallbackQuery: (callbackQueryId, text = "") =>
      tgCall(token, "answerCallbackQuery", { callback_query_id: callbackQueryId, text: String(text).slice(0, 200) }).then(noted),
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
    // WS-R84 (law 3, "every app-voiced card takes a locale" restated for a
    // switch): the disclosure line is re-sent, in the NEW locale, in the
    // SAME reply as the confirmation - a chat that read the English card at
    // `/start` and then says `/hindi` must not be left with only an English
    // disclosure on record for the rest of the conversation. `result.locale`
    // (what the write actually committed), never `want` - the same
    // "trust the response, not the request" discipline `languageChangedCard`
    // one line down already follows.
    await tg.sendMessage(ev.chatId, roomDisclosureCard(roomNameFor(scope.resolved.sheet), result.locale));
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

  // WS-R110: `/voice on|off`. No session write, no `roomSay`/`roomSpeak`
  // call - `voiceCommandCard`'s own header states why there is nothing to
  // persist. Reached only through `resolveActiveFollower`'s own gate above,
  // so this still costs a stranger nothing (no card is sent to an unjoined
  // chat here either).
  if (cmd === "voice_on" || cmd === "voice_off") {
    await tg.sendMessage(ev.chatId, voiceCommandCard(scope.locale));
    return { ok: true, voiceAcknowledged: cmd === "voice_on" ? "on" : "off" };
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
  // WS-R110: attempted only AFTER the text reply above has already left -
  // a voice failure of any kind must cost this follower nothing they
  // already have. Never awaited-and-thrown past this point.
  const voice = await attemptRoomVoiceDelivery(tg, ev, scope, turn, ctx);
  return { ok: true, said: turn.bubbles.length > 0, gate: turn.gate, voice };
}

// ─────────────────────────────────────────────────────────────────────────
// VOICE DELIVERY (WS-R19's roomSpeak, reused - WS-R110)
// ─────────────────────────────────────────────────────────────────────────
//
// Never a second synthesis path: the ONLY text this function may ever ask
// `roomSpeak` to render is `turn.reply` - the exact string `roomSay` just
// produced through `gatedReply`, one call up - and `roomSpeak` itself
// re-verifies that by hash (`room_voice_reply_mismatch`) before touching a
// provider. This function adds no authorization, no ceiling, no watermark
// logic of its own; it is the transport glue `roomSpeak`'s own header says
// a Room reply is: "a RENDERING of a reply, never a second way to make
// this AI say something."
//
// `ctx.roomDeps.synth`/`.protect` (or a `buildVoiceDeps()` factory the real
// door injects lazily, api/room-tg.js) are the SAME two required, no-default
// seams `api/room.js`'s own "speak" op wires to the real provider and
// `protectReplicaStream` - constructed in the door, never here
// (`api/_room-voice.js`'s "NO GPU WAKES" header), so this workstream's own
// evals reach every branch below with fakes and no network, exactly the
// posture `evals/room-paid-tier/run.mjs` already proved for the web door.
async function attemptRoomVoiceDelivery(tg, ev, scope, turn, ctx) {
  const env = ctx.roomDeps.env ?? process.env;
  if (String(env.ROOM_VOICE || "") !== "1") return { attempted: false, reason: "off" };
  const text = String(turn?.reply || "").trim();
  if (!text) return { attempted: false, reason: "nothing_said" };

  // Constructed lazily, right before it is actually needed - never on
  // `/start`, `/forget`, or any other update this function is never called
  // for at all, and never for a silent turn just filtered out above.
  const buildVoiceDeps = typeof ctx.roomDeps.buildVoiceDeps === "function" ? ctx.roomDeps.buildVoiceDeps : null;
  const voiceDeps = { ...ctx.roomDeps, ...(buildVoiceDeps ? buildVoiceDeps() : {}) };

  let spoken;
  try {
    spoken = await roomSpeak(voiceDeps, turn.session, { text });
  } catch (error) {
    const code = error?.code || "";
    if (code === "room_voice_cap_reached") {
      // Once a day, never on every subsequent message - `voiceCappedCard`'s
      // own header. `ctx.roomDeps.consume` is injectable exactly like every
      // other rate-gate call in this file.
      const consumeFn = ctx.roomDeps.consume ?? consume;
      const gate = await consumeFn(ctx.roomDeps.db, {
        scope: "room_tg_voice_capped_follower",
        key: String(scope.follower.follower_id),
        now: ctx.roomDeps.now,
        env,
      });
      if (gate.ok) await tg.sendMessage(ev.chatId, voiceCappedCard(scope.locale));
      return { attempted: true, ok: false, reason: "capped" };
    }
    if (
      code === "room_voice_paid_only" ||
      code === "room_voice_join_required" ||
      code === "room_voice_not_built_yet" ||
      code === "room_voice_unavailable" ||
      code === "room_voice_unconfigured" ||
      code === "room_voice_reply_mismatch" ||
      code === "room_disclosure_stale" ||
      code === "room_voice_text_required" ||
      code === "room_voice_text_too_long"
    ) {
      // A structural or "us"-classed refusal (a free follower, a creator
      // whose voice is not built, a deployment with no real wiring, or a
      // race the reply binding itself catches) - never surfaced
      // mid-conversation as an error. The text reply already arrived.
      return { attempted: true, ok: false, reason: code };
    }
    // A genuine synthesis/protection failure (law 3: "records one incident
    // and sends nothing"). `door_5xx` is the existing generic kind - see
    // this file's own import header on why no new INCIDENT_KINDS member is
    // added.
    const recordIncidentFn = ctx.roomDeps.recordIncident ?? recordIncident;
    await recordIncidentFn(ctx.roomDeps.db, {
      kind: "door_5xx",
      door: "room-tg-voice",
      status: Number(error?.status) || 503,
    }).catch(() => {});
    return { attempted: true, ok: false, reason: "failed" };
  }

  const wav = pcmToWavBuffer(Buffer.from(String(spoken.audio || ""), "base64"), spoken.format);
  const result = await tg.sendVoice(ev.chatId, wav, ROOM_TELEGRAM_VOICE_CONTAINER.mimeType);
  return { attempted: true, ok: result?.ok !== false };
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

  // WS-R89 (the second door battery, class d): refuse a redelivered
  // `update_id` as a no-op — `api/_rate-limit.js`'s own header on the
  // `room_tg_update_seen` scope states exactly what this does and does not
  // guarantee (a bounded window, not a permanent ledger). `deps.consume` is
  // injectable, `assertSessionFresh`'s own shape, so an offline eval can
  // drive this with a fake counter without a real `vy_public_rate` table.
  const consumeFn = deps.consume ?? consume;
  const updateId = update?.update_id;
  if (Number.isInteger(updateId)) {
    const seen = await consumeFn(db, { scope: "room_tg_update_seen", key: String(updateId), now, env });
    if (!seen.ok) return { ok: true, skipped: "duplicate_update" };
  }

  const tg = deps.tg ?? defaultRoomTelegramClient(String(env.ROOM_TELEGRAM_BOT_TOKEN || ""), {
    db, recordIncident: deps.recordIncident,
  });
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

  // WS-R110: `/voice on|off` - `checkinsToggle`'s own reason for being
  // checked ahead of the no-argument table, one command over. Handled
  // (never falls through to an ordinary message) even though nothing is
  // actually stored - `voiceCommandCard`'s own header on why.
  const voiceToggle = parseVoiceCommand(ev.text);
  if (voiceToggle) {
    return await handleRoomCommand(db, tg, now, env, ev, voiceToggle === "on" ? "voice_on" : "voice_off", ctx);
  }

  const cmd = parseRoomCommand(ev.text);
  if (cmd) return await handleRoomCommand(db, tg, now, env, ev, cmd, ctx);

  return await handleOrdinaryMessage(db, tg, now, env, ev, ctx);
}
