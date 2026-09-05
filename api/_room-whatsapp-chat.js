// The Room on WhatsApp (WS-R104). A transport, never a tenant — this file is
// `api/_room-telegram.js`'s own design over the Cloud API, reusing
// `api/_room-whatsapp.js`'s webhook verify, sender and the ONE WhatsApp
// Business number (`WHATSAPP_ACCESS_TOKEN`/`WHATSAPP_PHONE_NUMBER_ID`), never
// a second credential pair.
//
// WS-R115 (2026-09-05): WS-R104's own reply-button join gate was built and
// merged with no live WhatsApp Business Account ever available to try it
// against (`context/decisions.md#ws-r104-whatsapp-join-gate-uses-reply-
// buttons-not-free-text`'s own reversal condition, stated in as many words).
// This workstream verifies every outbound shape this file sends and the one
// inbound shape it parses against Meta's own Cloud API documents — WS-R41's
// method (api/whatsapp.js's own header), a citation with a URL and a fetch
// date pinned against the exact field this codebase's own behaviour must
// match, never a document skimmed and trusted from memory. The citations
// live next to the code they verify: `defaultRoomWhatsappChatClient`'s own
// header (outbound: text messages, interactive reply-button messages, the
// three limits Meta's own document states) and
// `classifyRoomWhatsappChatMessage`'s own header (inbound: the
// `button_reply` webhook shape — NOT symmetric with the outbound `type`,
// the one place a guess would have been wrong). The 24-hour window ledger
// (`sendSessionMessage`'s own `windowOpen` check, api/_room-whatsapp.js)
// was ALREADY verified against the identical document by WS-R41
// (api/whatsapp.js's own header) — this workstream proves it again here at
// the fake-clock boundary this specific join flow's brief names (23:59
// sends, 24:01 does not, a new inbound reopens it, a struck ledger is
// caught), through the REAL shipping sender rather than a stub, in
// `evals/room-whatsapp-chat/run.mjs`'s own "the REAL 24h ledger" section —
// not a second, independent verification of the rule itself, which WS-R41
// already settled. ONE real disagreement was found and fixed: this file's
// own `sendButtons` builder had no cap on button COUNT at all, though every
// real call site has only ever sent two — see `defaultRoomWhatsappChatClient`'s
// own header for the fix and the citation it closes.
//
// Every message that reaches a reply goes through the SAME follower lane the
// web Room and the Telegram lane both use (api/_room-surface.js: resolve,
// join, say, forget) and leaves through the ONE reply door (`gatedReply`,
// reached inside `roomSay`, which is also where `roomNeverRules()` is read —
// this file adds no second reply assembler and no second never-rules read).
// The ONLY new thing this file adds to that lane is a WhatsApp-shaped
// IDENTITY BRIDGE and a WhatsApp-shaped ADDRESS BOOK — `_room-telegram.js`'s
// own header, restated one transport over.
//
// Every card this file's own flow uses (the disclosure line, the adult gate,
// the memory question, "joined", "capped", "forgotten", "stopped", "language
// changed", "unavailable", "join first") is IMPORTED from
// `api/_room-telegram.js`, never re-typed — those strings are transport
// neutral (none of them names Telegram by word), so re-typing them here would
// be a second copy of app-voiced text this codebase's own standing law
// (`src/engine/persona.ts`'s "write shapes never lines", restated for a
// deterministic card rather than a model line) exists to prevent drifting
// from its sibling. The ONE card this file writes itself is
// `joinInstructionCard` below — genuinely transport-specific text (Telegram's
// own `welcomeNoSlugCard` names `t.me/<bot>?start=`, which means nothing on
// this wire), and the four short button titles, which carry no card text of
// their own to duplicate.
//
// ── why a phone hash and not the number itself ──────────────────────────
//
// migration 128's own header carries the full argument: `vy_room_follower_
// whatsapp_chat.phone_hash` is a salted sha256, never the raw E.164 number —
// `phoneHash` below is the ONE function that computes it, reusing the SAME
// salted-sha256 SHAPE `api/_rate-limit.js`'s `hashKey` already uses (WS-R26's
// own law) but WITHOUT that function's daily rotation, since this hash is a
// durable lookup key for a row meant to outlive one calendar day, not a
// rotating rate-limit bucket. This file never needs to reverse the hash: the
// reply is always sent to the number Meta's own webhook payload just handed
// it, in the SAME request, never read back off a stored column.
//
// ── identity: a NEW surface, not Telegram's, and why ────────────────────
//
// Telegram's own bridge (`personForSurfaceUser`/`linkSurfacePerson`, surface
// `"telegram"`) is reused verbatim there because ONE Telegram bot token
// serves both Meera's own DMs and every Room, so bridging the two into the
// SAME person is the correct behaviour, not an accident (`_room-telegram.js`'s
// own header states this). This file's WhatsApp Business number is ALSO
// shared with Meera's own base bot (`api/whatsapp.js` reads the identical
// `WHATSAPP_ACCESS_TOKEN`/`WHATSAPP_PHONE_NUMBER_ID`), so the SAME argument
// would say to reuse surface `"whatsapp"` too — this file deliberately does
// NOT, for one reason worth stating rather than hand-waving: this file's own
// identity key is the phone HASH (the paragraph above), never the raw
// number, and no other reader of `vy_surface_identity` today keys the
// `"whatsapp"` surface on a hash rather than a raw E.164 (`grep` across
// `api/*.js` at the time this file was written found no existing
// `personForSurfaceUser("whatsapp", ...)` call at all — NOT PROVEN to stay
// that way). Sharing the literal string `"whatsapp"` across a hash-keyed
// reader and a hypothetical future raw-number-keyed one would be a silent
// key-shape collision waiting to happen, not a bridge — so this file uses
// its OWN surface, `"room_whatsapp"`, and does NOT bridge with Meera's own
// WhatsApp DMs the way Telegram's Room lane bridges with Meera's own
// Telegram DMs. `context/decisions.md#ws-r104-whatsapp-chat-identity-is-its-
// own-surface` states what would reverse this (a second, careful audit of
// every `vy_surface_identity` reader confirming a shared raw-number key is
// safe, which this workstream did not have the scope to perform).
//
// ── the two-question gate, over reply BUTTONS not free text ────────────
//
// migration 128's own column list is closed (`phone_hash`, `room_id`,
// `person_id`, `follower_id`, `locale`, `joined_at`, `stopped_at`,
// `stopped_code` — no "pending step" column), and this file keeps NOTHING in
// memory between one webhook delivery and the next (a serverless function
// remembers nothing a request did not just prove, `_room-telegram.js`'s own
// header restated). So the age/memory gate cannot be answered by parsing free
// text across two separate messages the way a stateful bot could — it needs
// the SAME trick Telegram's own inline-keyboard `callback_data` already
// proves works: the state (which slug, which step) travels IN the button
// itself, never in a row this file would otherwise have to invent a column
// for. WhatsApp's Cloud API interactive reply buttons carry an opaque `id`
// string back on the tap, exactly like a Telegram callback query does — so
// `a1:<slug>`/`a0:<slug>`/`m1:<slug>`/`m0:<slug>` are reused VERBATIM as
// button ids, `parseButtonId`/`CALLBACK_RE`'s own shape one file over.
import { createHash } from "node:crypto";
import {
  resolveRoom,
  RoomError,
  roomDisclosureCard,
  roomNameFor,
  joinRoom,
  roomSay,
  roomForget,
  roomSetLocale,
  followerRow,
  mintFollowerSession,
  normalizeLocale,
  recordRoomArrival,
} from "./_room-surface.js";
import {
  adultGateCard,
  memoryGateCard,
  adultRefusedCard,
  joinedCard,
  joinFirstCard,
  roomUnavailableCard,
  cappedCard,
  forgottenCard,
  stoppedCard,
  languageChangedCard,
} from "./_room-telegram.js";
import { personForSurfaceUser, linkSurfacePerson } from "./_room.js";
import { activeProviderName } from "./_payments.js";
import { consume } from "./_rate-limit.js";
import { sendSessionMessage } from "./_room-whatsapp.js";
import { noteInbound } from "./whatsapp.js";
// WS-R123. `_incidents.js` also imports `_operator-telegram.js`, which
// imports `_room-telegram.js`, which imports `_room-surface.js` — none of
// which import THIS file, so this edge closes no cycle (`_room-telegram.js`
// already imports `_incidents.js` directly and has since WS-R58 — the
// identical shape, one file over).
import { recordIncident } from "./_incidents.js";

/** WhatsApp's own Cloud API text limit — `api/whatsapp.js`'s `WA_TEXT_LIMIT`,
 *  restated rather than imported (that constant is not exported for reuse
 *  and this file needs only the number, `ROOM_TG_TEXT_LIMIT`'s own
 *  precedent one file over). `roomSay`'s own bubbles are already split at
 *  4000 (`ROOM_TEXT_LIMIT`, api/_room-surface.js), which fits under this
 *  with room to spare, so nothing here re-splits them. */
export const ROOM_WA_TEXT_LIMIT = 4096;

// ─────────────────────────────────────────────────────────────────────────
// THE ENV GATE (workstream law #3)
// ─────────────────────────────────────────────────────────────────────────

/** UNSET MEANS THE LANE DOES NOT EXIST, structurally — `templateApproved`'s
 *  own shape (api/_room-whatsapp.js) restated for this lane: every caller in
 *  this file's own entry point checks this BEFORE reading anything off the
 *  request, so a half-configured deploy answers with the EXISTING auto-reply
 *  (api/room-wa.js's own unchanged branch) rather than a half-built one. */
export function whatsappChatEnabled(env = process.env) {
  return String(env.ROOM_WHATSAPP_CHAT || "") === "1";
}

// ─────────────────────────────────────────────────────────────────────────
// THE JOIN LINK (WS-R126) — a wa.me deep link that opens THIS business
// number's chat with `join <slug>` already typed, for a poster QR or a
// share-kit row. "No new env var" is this workstream's own brief law, so
// `whatsappJoinNumber` reads the ONE env var this file's own module already
// names (`WHATSAPP_PHONE_NUMBER_ID`) rather than inventing a second one —
// NAMED HONESTLY: under Meta's Cloud API that value is the phone's opaque
// GRAPH API IDENTIFIER, not necessarily the dialable E.164 number a wa.me
// link needs (`api/whatsapp.js`'s own `PHONE_ID` is used exclusively as a
// path segment in a Graph API call, never printed or dialled anywhere in
// this codebase before this workstream). This workstream had no network
// access to fetch Meta's own documentation to settle whether a given
// deployment's configured value happens to be dialable (`ws-common.md`'s own
// network law: a provider's public documentation page is reachable only
// where a workstream's OWN section names it, and this one does not) —
// NOT PROVEN, named rather than implied: whether `WHATSAPP_PHONE_NUMBER_ID`
// as configured on this deploy is the dialable number wa.me expects. A
// deployer must confirm their own value before treating this link as live;
// `context/decisions.md#ws-r126-whatsapp-join-number-reuses-phone-number-id`
// states what would reverse this (a real, separate dialable-number env var,
// once one exists to reuse).
export function whatsappJoinNumber(env = process.env) {
  return String(env.WHATSAPP_PHONE_NUMBER_ID || "").replace(/[^0-9]/g, "");
}

/** A conservative, generic URL-length bound (this workstream had no network
 *  access to fetch a WhatsApp-specific published limit — the comment above
 *  states why). `join <slug>` url-encoded is bounded by `assertSlugShape`'s
 *  own 3-40 characters (`api/_room-surface.js`) and can never come close to
 *  this — the same "a defensive assertion that never fires costs nothing"
 *  posture `api/_share-kit.js`'s own `SHARE_KIT_LIMITS` header states for
 *  its four templates. */
export const WHATSAPP_JOIN_URL_LIMIT = 2048;

/** `https://wa.me/<number>?text=join%20<slug>` — WhatsApp's own click-to-chat
 *  shape, restated WITH a phone segment from `ShareKitCard.tsx`'s existing
 *  `wa.me/?text=` (that one omits the number on purpose: it opens a contact
 *  PICKER so a creator can forward a message to any of their own contacts;
 *  this one names a number on purpose, so tapping it opens a chat with THIS
 *  business number instead). Returns `null` — structurally absent, this
 *  workstream's own law 1 — whenever the WhatsApp chat lane itself is off
 *  (`whatsappChatEnabled`), no number is configured, or the slug is empty;
 *  never a placeholder link that would resolve to nothing or to the wrong
 *  flow. */
export function whatsappJoinLink(slug, env = process.env) {
  if (!whatsappChatEnabled(env)) return null;
  const number = whatsappJoinNumber(env);
  const cleanSlug = String(slug || "").trim();
  if (!number || !cleanSlug) return null;
  const link = `https://wa.me/${number}?text=${encodeURIComponent(`join ${cleanSlug}`)}`;
  return link.length <= WHATSAPP_JOIN_URL_LIMIT ? link : null;
}

// ─────────────────────────────────────────────────────────────────────────
// THE PHONE HASH — salted, never reversed by this file, never rotated
// ─────────────────────────────────────────────────────────────────────────

// UNSET STILL WORKS, `api/_rate-limit.js`'s own `FALLBACK_SALT` law restated
// under its own name so this file's fallback can never be confused with
// that module's (a shared literal would not be a security problem — neither
// is ever printed or reachable from outside this deploy — but two purposes
// sharing one fallback constant is exactly the kind of accidental coupling
// this codebase's own convention avoids elsewhere).
const FALLBACK_SALT = "vy-room-wa-chat-fallback-salt-128";

function chatSalt(env) {
  const configured = String(env.RATE_SALT || "").trim();
  return configured || FALLBACK_SALT;
}

/** sha256 of a fixed scope tag, the raw E.164 number, and the deploy's own
 *  salt — hex-encoded, matching migration 128's own CHECK constraint
 *  (`^[0-9a-f]{64}$`). Deliberately NOT `api/_rate-limit.js`'s `hashKey`: that
 *  function also folds in the calendar day, which is correct for a rotating
 *  rate-limit bucket and wrong for a lookup key meant to resolve the SAME
 *  phone to the SAME row a year from now. */
export function phoneHash(e164, env = process.env) {
  return createHash("sha256").update(`room-wa-chat|${String(e164)}|${chatSalt(env)}`).digest("hex");
}

/** Meta's own inbound `messages[].from` is digits only, no leading "+" — the
 *  exact wire format `api/_room-whatsapp.js`'s `replyWithRoomLink` already
 *  normalises the identical way. */
function toE164(from) {
  const digits = String(from || "").trim();
  if (!digits) return "";
  return digits.startsWith("+") ? digits : `+${digits}`;
}

// ─────────────────────────────────────────────────────────────────────────
// THE ONE APP-VOICED CARD THIS FILE OWNS — everything else is imported
// ─────────────────────────────────────────────────────────────────────────

/** The instruction a phone with no pointer gets for anything that is not
 *  `join <slug>` itself — `_room-telegram.js`'s `welcomeNoSlugCard`, whose
 *  own text names a Telegram-only link shape and so cannot be reused
 *  verbatim on this wire (this file's own header states why). Locale is
 *  always `"en"` here: unlike Telegram, a WhatsApp webhook delivery carries
 *  no per-message language signal this file could read before a follower
 *  row exists (`m.from`'s own Cloud API shape has no `language_code`
 *  field) — NOT PROVEN to matter in practice, since every follower who gets
 *  this far can still switch with `hindi` once joined. */
export function joinInstructionCard(locale = "en") {
  return normalizeLocale(locale) === "hi"
    ? "किसी क्रिएटर का रूम खोलने के लिए भेजें: join <उनका-रूम>."
    : "To open a creator's Room, send: join <their room>.";
}

// ─────────────────────────────────────────────────────────────────────────
// PARSING — one inbound Cloud API message -> zero or one classified event
// ─────────────────────────────────────────────────────────────────────────

/** `join <slug>` only — case-insensitive, one argument, the same slug shape
 *  `_room-telegram.js`'s `parseStartCommand` validates. Returns the slug or
 *  `null` for "not this command at all" — ONE outcome rather than three,
 *  since unlike `/start` there is no bare `join` with a meaningfully
 *  different empty-payload case to distinguish worth a caller branching on.
 *
 *  WS-R126: this text is no longer only ever typed by hand — the poster/
 *  share-kit's own wa.me deep link (`whatsappJoinLink` below) PREFILLS it,
 *  and a phone keyboard's own autocorrect can wrap a pasted or long-pressed
 *  word in a smart quote before the message ever leaves the device. The
 *  outer `.trim()` already absorbed leading/trailing whitespace and the `i`
 *  flag already absorbed a capital `J` before this workstream touched the
 *  line; the one new tolerance is an OPTIONAL straight or curly quote
 *  (`"`, `'`, U+2018/U+2019 single, U+201C/U+201D double) immediately before
 *  and/or after the slug, independently — a phone's autocorrect does not
 *  reliably pair opening and closing glyphs, so requiring a matched pair
 *  would refuse exactly the input this exists to accept. Anything else
 *  (a second word, a quote NOT immediately hugging the slug, no `join`
 *  literal at all) still refuses, unchanged — proven by
 *  `evals/room-whatsapp-chat/run.mjs`'s own negative controls. */
export function parseJoinCommand(text) {
  const m = /^join\s+["'‘’“”]?([a-z0-9][a-z0-9-]{0,62})["'‘’“”]?\s*$/i
    .exec(String(text || "").trim());
  return m ? m[1].toLowerCase() : null;
}

/** `hindi`, `english`, `stop`, `forget` — the workstream brief's own set,
 *  plain words with NO leading slash (a WhatsApp business number's own
 *  idiom, unlike Telegram's `/command` convention) and case-insensitive, so
 *  a phone's own autocapitalization can never silently break a command. */
export function parseRoomCommand(text) {
  const m = /^(forget|stop|hindi|english)$/i.exec(String(text || "").trim());
  return m ? m[1].toLowerCase() : null;
}

const BUTTON_RE = /^(a1|a0|m1|m0):([a-z0-9][a-z0-9-]{0,62})$/;
export function parseButtonId(id) {
  const m = BUTTON_RE.exec(String(id || ""));
  return m ? { step: m[1], slug: m[2] } : null;
}

/** `_room-telegram.js`'s `ageKeyboard`/`memoryKeyboard`, WhatsApp's own
 *  interactive-button shape — button titles capped at Meta's own 20-character
 *  limit, `_room-telegram.js`'s own Telegram-length titles shortened to fit. */
const ageButtons = (slug) => [
  { id: `a1:${slug}`, title: "Yes, 18+" },
  { id: `a0:${slug}`, title: "No" },
];
const memoryButtons = (slug) => [
  { id: `m1:${slug}`, title: "Remember me" },
  { id: `m0:${slug}`, title: "Don't remember" },
];

/** One classified event per inbound Cloud API message — `api/whatsapp.js`'s
 *  own `parse()`, restated for the fields THIS file's state machine needs
 *  (a button's `id`, which that function never surfaces) rather than the
 *  generic surface-adapter shape. Never mutates, never reads a database.
 *
 *  WS-R115: the `interactive`/`button_reply` branch below is verified
 *  against Meta's own webhook example, not assumed symmetric with the
 *  outbound shape above (they are NOT symmetric — this is the one place a
 *  guess would have been wrong). developers.facebook.com/documentation/
 *  business-messaging/whatsapp/messages/interactive-reply-buttons-messages
 *  (fetched 2026-09-05), "## Webhooks" section, quoted verbatim: "When a
 *  WhatsApp user taps on a reply button, a **messages** webhook is
 *  triggered that describes their selection in a `button_reply` object" —
 *  and the worked example webhook payload nests it as
 *  `messages[].type: "interactive"`, `messages[].interactive.type:
 *  "button_reply"` (NOT `"button"` — the outbound `type` and the inbound
 *  `interactive.type` are two different strings on the two different sides
 *  of the SAME tap), `messages[].interactive.button_reply: {id, title}`.
 *  Matched exactly below: `m.type === "interactive"`,
 *  `m.interactive.type === "button_reply"`, `m.interactive.button_reply.id`
 *  — this file reads only `id` (the button's own opaque state, this file's
 *  own header explains why), never `title`, which the doc's own object also
 *  carries but this state machine has no use for. */
export function classifyRoomWhatsappChatMessage(m) {
  const from = m?.from == null ? null : String(m.from);
  if (!from) return { kind: "ignore", reason: "no sender" };
  const phone = toE164(from);
  const messageId = m?.id == null ? null : String(m.id);
  if (m?.type === "interactive" && m?.interactive?.type === "button_reply") {
    return {
      kind: "button",
      phone,
      messageId,
      buttonId: String(m.interactive.button_reply?.id || ""),
    };
  }
  if (m?.type === "text") {
    return { kind: "message", phone, messageId, text: String(m.text?.body ?? "") };
  }
  // Any other Cloud API message type (image, audio, location, an
  // unsupported interactive shape) is not this product — Vyakti Rooms v1
  // has no shape for it, and answering with silence is the honest response
  // rather than guessing what a caption or a location pin meant.
  return { kind: "ignore", reason: "unsupported message type" };
}

// ─────────────────────────────────────────────────────────────────────────
// THE OUTBOUND CLIENT — injectable, so the eval fakes it with no network
// ─────────────────────────────────────────────────────────────────────────

/** The shipping client. Every SUITE injects its own fake through `deps.wa`
 *  when driving the join flow end to end, so `sendText`/`sendButtons` are
 *  never reached from a webhook-shaped eval — `_room-telegram.js`'s own "no
 *  calls to Telegram from any eval" restated for this wire. WS-R115 is the
 *  one exception, and a narrow one: `evals/room-whatsapp-chat/run.mjs`'s own
 *  "outbound shapes pinned against Meta's own Cloud API documents" section
 *  calls `sendText`/`sendButtons` DIRECTLY, with a fake `fetch` (never a real
 *  one — the shape law above is unchanged, only reached one layer deeper),
 *  because pinning a wire shape against a citation means building the exact
 *  bytes this function builds, not a copy of them re-typed into the test.
 *  `sendDeps` is the SAME deps object `handleRoomWhatsappChatWebhook` was
 *  itself called with — `env`, `now`, and (in production) `fetch:
 *  globalThis.fetch`, threaded through exactly as `api/checkins-sweep.js`
 *  threads it into `sweep()` — a business-logic module never assumes a
 *  global, `sendSessionMessage`'s own "deps.fetch REQUIRED" law one file
 *  over.
 *
 *  ── WS-R115: every shape below verified against Meta's own document,
 *  never assumed ──
 *
 *  developers.facebook.com/documentation/business-messaging/whatsapp/
 *  messages/interactive-reply-buttons-messages (redirected from the
 *  `/docs/whatsapp/cloud-api/...` URL WS-R41's own citations in
 *  api/whatsapp.js used; fetched 2026-09-05) — the worked request example
 *  shows exactly `{type:"interactive", interactive:{type:"button",
 *  body:{text}, footer:{text}, action:{buttons:[{type:"reply",
 *  reply:{id,title}}]}}}` (this file sends no header/footer, both optional
 *  per the doc's own request-parameters table). Three field limits, quoted
 *  verbatim from that table: `<BODY_TEXT>` "Maximum 1024 characters.";
 *  `<BUTTON_LABEL_TEXT>` "Maximum 20 characters."; `<BUTTON_ID>` "A unique
 *  identifier for each button. Supports up to 3 buttons... Maximum 256
 *  characters." — matched by `.slice(0,1024)`/`.slice(0,20)` below (body,
 *  title) and, for the button COUNT specifically, a REFUSAL rather than a
 *  truncation: `evals/room-whatsapp-chat/run.mjs`'s own shape-pinning suite
 *  found this file's builder had NO cap on `buttons.length` at all before
 *  this workstream — every real call site (`ageButtons`/`memoryButtons`
 *  below) has only ever sent two, so nothing shipped was ever wrong, but a
 *  caller bug that reached this function with four buttons would have built
 *  and sent a shape Meta's own API document states it does not support. Per
 *  this workstream's own law 2 ("where the code disagrees with the
 *  document, fix the code"), `sendButtons` below now throws by name rather
 *  than silently building an invalid Cloud API payload — the SAME posture
 *  `sendSessionMessage`'s own "`deps.fetch` REQUIRED" throw already takes
 *  for a different missing precondition, never a template substituted or a
 *  message half-built. Button-id length is verified SOUND rather than
 *  enforced: `parseButtonId`'s own slug capture group above caps a slug at
 *  63 characters, so the longest id this file ever builds
 *  (`"m0:" + 63 chars = 66`) sits far under 256 by construction — nothing to
 *  truncate, and truncating an id would silently break `parseButtonId`'s own
 *  round-trip on the reply.
 *
 *  developers.facebook.com/documentation/business-messaging/whatsapp/
 *  messages/text-messages (fetched 2026-09-05) — `<BODY_TEXT>` "Maximum 4096
 *  characters.", matching `ROOM_WA_TEXT_LIMIT`/`WA_TEXT_LIMIT` exactly
 *  (api/whatsapp.js's own constant, restated in this file's own header).
 *
 *  developers.facebook.com/documentation/business-messaging/whatsapp/
 *  messages/send-messages#customer-service-windows (fetched 2026-09-05,
 *  reached by following developers.facebook.com/docs/whatsapp/pricing's own
 *  redirect and its own "customer service window" link — WS-R41's citation
 *  chain, now to the current URL) both lists "Interactive reply buttons" and
 *  "Text messages" among the service message types a business MAY send
 *  during an open customer service window, and states the window itself:
 *  "a 24-hour timer... starts... If the user messages... again before the
 *  timer expires, the timer resets to 24 hours. While the window is open,
 *  you can send any of the service message types listed... When the window
 *  closes, you can only send pre-approved template messages." — the exact
 *  rule `sendSessionMessage`'s own `windowOpen` check (api/_room-whatsapp.js,
 *  reusing api/whatsapp.js's ledger) enforces, and
 *  `evals/room-whatsapp-chat/run.mjs`'s own "the REAL 24h ledger" section
 *  proves with a fake clock: a message at 23:59 after the last inbound
 *  sends, at 24:01 it does not, a fresh inbound resets the timer, and a
 *  struck ledger (a cold start, this platform's own best-effort posture) is
 *  caught and refused rather than silently allowed through. */
// WS-R123: `sendDeps.db` rides in already — `handleRoomWhatsappChatWebhook`'s
// own `roomDeps = { ...deps, now, env }` spread already carries `deps.db`,
// so no call site needed a new argument. A genuine provider refusal or
// error (`!ok`, and NEITHER `notConfigured` — an unset credential pair, this
// deployment's own gap, not Meta's — NOR `skipped: "outside_window"` — an
// ordinary, expected refusal `sendSessionMessage`'s own header names, never
// a failure) records one `provider_whatsapp` incident, fire-and-forget, the
// SAME refusal-vs-error split `_room-telegram.js`'s own
// `defaultRoomTelegramClient` draws one surface over. `evals/room-whatsapp-
// chat/run.mjs`'s own §WS-R115 section calls this client directly with no
// `db` at all — `db &&` below is the guard that keeps that call safe.
function notedProviderFailure(db, result) {
  if (db && result?.ok === false && !result.notConfigured && result.skipped !== "outside_window") {
    recordIncident(db, { kind: "provider_whatsapp", door: "room-wa", status: Number(result.status) || 0 });
  }
  return result;
}

export function defaultRoomWhatsappChatClient(sendDeps) {
  const send = (phone, messageBody) =>
    sendSessionMessage(phone, messageBody, sendDeps).then((result) => notedProviderFailure(sendDeps?.db, result));
  return {
    sendText: (phone, text) =>
      send(phone, { type: "text", text: { body: String(text).slice(0, ROOM_WA_TEXT_LIMIT) } }),
    sendButtons: (phone, bodyText, buttons) => {
      // Meta's own document: "up to three predefined replies" — see this
      // function's own header. A count outside [1,3] is a caller bug, never
      // a shape to build and send anyway.
      if (!Array.isArray(buttons) || buttons.length < 1 || buttons.length > 3) {
        throw new Error(
          `room_wa_button_count_invalid: ${Array.isArray(buttons) ? buttons.length : typeof buttons} (Meta's own Cloud API supports 1-3 reply buttons)`,
        );
      }
      return send(phone, {
        type: "interactive",
        interactive: {
          type: "button",
          body: { text: String(bodyText).slice(0, 1024) },
          action: {
            buttons: buttons.map((b) => ({ type: "reply", reply: { id: b.id, title: b.title.slice(0, 20) } })),
          },
        },
      });
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────
// THE POINTER — every statement this table ever runs, owned here alone
// ─────────────────────────────────────────────────────────────────────────

/** Point one WhatsApp phone at one Room membership. A second `join <slug>`
 *  from the SAME phone — the same Room or a different one, active or
 *  previously `stop`ped — REPLACES this row rather than adding a second one,
 *  `bindTelegramChannel`'s own upsert law (api/_room-surface.js) restated:
 *  `phone_hash` is this table's own primary key, so the upsert needs no
 *  separate unique index the way 082's channel table does. */
async function bindWhatsappChatPointer(db, { hash, roomId, personId, followerId, locale }) {
  await db(
    `insert into vy_room_follower_whatsapp_chat
       (phone_hash, room_id, person_id, follower_id, locale, joined_at, stopped_at, stopped_code)
     values ($1, ($2)::uuid, ($3)::uuid, ($4)::uuid, $5, now(), null, null)
     on conflict (phone_hash) do update
        set room_id = excluded.room_id,
            person_id = excluded.person_id,
            follower_id = excluded.follower_id,
            locale = excluded.locale,
            joined_at = now(),
            stopped_at = null,
            stopped_code = null`,
    [hash, String(roomId), String(personId), String(followerId), normalizeLocale(locale)],
  );
}

/** The slug an ACTIVE (never-stopped) WhatsApp pointer currently means, or
 *  `null` — `telegramChannelRoom`'s own shape (api/_room-surface.js): joined
 *  to `vy_room` so the caller can hand the result straight to `resolveRoom`,
 *  the ONLY function allowed to decide whether a Room may answer. */
async function whatsappChatPointerRoom(db, hash) {
  const rows = await db(
    `select r.slug
       from vy_room_follower_whatsapp_chat c
       join vy_room r on r.room_id = c.room_id
      where c.phone_hash = $1 and c.stopped_at is null
      limit 1`,
    [hash],
  );
  return rows[0]?.slug ? String(rows[0].slug) : null;
}

/** `stop` — LEAVES, no deletion, `unbindTelegramChannel`'s own law restated
 *  as an UPDATE rather than a DELETE (migration 128's own header: this row
 *  is the only surviving record this channel ever existed for this phone,
 *  since `phone_hash` cannot be reversed back into a number to re-derive
 *  one). An ordinary message afterward reads as "not joined" via
 *  `whatsappChatPointerRoom`'s own `stopped_at is null` predicate, until the
 *  follower sends `join <slug>` again. */
async function stopWhatsappChatPointer(db, hash, code) {
  await db(
    `update vy_room_follower_whatsapp_chat
        set stopped_at = now(), stopped_code = $2
      where phone_hash = $1 and stopped_at is null`,
    [hash, String(code || "").slice(0, 120)],
  );
}

// ─────────────────────────────────────────────────────────────────────────
// THE STATE MACHINE — SQL predicates alone, nothing kept in memory between
// deliveries
// ─────────────────────────────────────────────────────────────────────────

/** Resolve "which Room, which person, is this phone's active follower" from
 *  nothing but the phone hash — `_room-telegram.js`'s `resolveActiveFollower`
 *  restated one transport over. Never creates a follower row or a person
 *  identity: `ctx.findPerson` only ever READS `vy_surface_identity`
 *  (`personForSurfaceUser`'s own contract, api/_room.js), so a phone this
 *  platform has never seen reaches this function, finds nothing, and creates
 *  nothing — the door law this workstream's brief names by name. */
async function resolveActiveFollower(db, hash, ctx) {
  const identity = await ctx.findPerson("room_whatsapp", hash, ctx.t);
  if (!identity) return { error: "not_linked" };
  const slug = await whatsappChatPointerRoom(db, hash);
  if (!slug) return { error: "no_room" };
  let resolved;
  try {
    resolved = await resolveRoom(db, slug, ctx.roomDeps);
  } catch {
    return { error: "unavailable" };
  }
  const follower = await followerRow(db, resolved.room.room_id, identity.person_id, resolved.agentId);
  if (!follower || follower.age_attested_at == null) return { error: "not_joined" };
  return { identity, resolved, follower, locale: normalizeLocale(follower.locale) };
}

async function handleJoin(db, wa, phone, slug, ctx) {
  let resolved;
  try {
    resolved = await resolveRoom(db, slug, ctx.roomDeps);
  } catch {
    await wa.sendText(phone, roomUnavailableCard("en"));
    return { ok: true, unavailable: true };
  }
  // WS-R126, law 4: counted the instant the `join <slug>` text resolves a
  // real Room, whether or not this phone ever answers the age/memory gate
  // that follows — the SAME "an arrival counts at OPEN, not at completed
  // join" posture `api/_room-surface.js`'s own `friendArrivalsThisWeek`
  // header states for a referral link, restated for a WhatsApp chat message
  // instead of an HTTP page view. Best effort (`.catch(() => {})`,
  // `recordRoomArrival`'s own posture) — a counting failure must never turn
  // into a follower-facing error. Reused `via='whatsapp'` on purpose, not a
  // new value: `db/migrations/131_arrival_via_whatsapp.sql`'s own header
  // explains why this bucket is shared with the share kit's web-link clicks
  // rather than split into a second one.
  await recordRoomArrival(db, { roomId: resolved.room.room_id, via: "whatsapp", now: ctx.roomDeps.now }).catch(() => {});
  // Law 2: the disclosure line BEFORE the first reply, sent once, then the
  // age question as a reply-button message — the first of the two answers
  // `joinRoom` requires together, `_room-telegram.js`'s `handleStart` own
  // sequence restated over buttons instead of an inline keyboard.
  await wa.sendText(phone, roomDisclosureCard(roomNameFor(resolved.sheet), "en"));
  await wa.sendButtons(phone, adultGateCard("en"), ageButtons(slug));
  return { ok: true, gate: "age", slug };
}

async function handleButton(db, wa, phone, buttonId, ctx) {
  const parsed = parseButtonId(buttonId);
  if (!parsed) return { ok: true, skipped: "bad button" };

  // No follower row exists across any of these three steps until the very
  // last one commits it, so every card here is "en" — the same limitation
  // `joinInstructionCard`'s own header states, and for the identical reason.
  if (parsed.step === "a0") {
    await wa.sendText(phone, adultRefusedCard("en"));
    return { ok: true, declined: "age" };
  }
  if (parsed.step === "a1") {
    await wa.sendButtons(phone, memoryGateCard("en"), memoryButtons(parsed.slug));
    return { ok: true, gate: "memory" };
  }

  // "m1" (remember me) or "m0" (do not remember me) — BOTH answers are now
  // known, the one moment `joinRoom` is called, matching the web join's own
  // atomic requirement.
  let resolved;
  try {
    resolved = await resolveRoom(db, parsed.slug, ctx.roomDeps);
  } catch {
    await wa.sendText(phone, roomUnavailableCard("en"));
    return { ok: true, unavailable: true };
  }

  const hash = phoneHash(phone, ctx.roomDeps.env);
  const identity = await ctx.linkPerson("room_whatsapp", hash, { handle: "" }, ctx.t);
  // The structural adult gate: a known minor gets no identity row at all,
  // so there is nothing here to join. Refused with the SAME card as "no" on
  // the age question — `_room-telegram.js`'s own `handleCallback` states why
  // a caller must not be able to tell the two apart.
  if (!identity) {
    await wa.sendText(phone, adultRefusedCard("en"));
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
        locale: "en",
      },
      ctx.roomDeps,
    );
  } catch (e) {
    if (e instanceof RoomError) {
      await wa.sendText(phone, roomUnavailableCard("en"));
      return { ok: true, unavailable: true };
    }
    throw e;
  }

  // THE POINTER. A fresh read of the follower row, `_room-telegram.js`'s own
  // "never `joined.follower`, which carries no follower_id" restated.
  const followerRowNow = await followerRow(db, resolved.room.room_id, identity.personId, resolved.agentId);
  if (followerRowNow) {
    await bindWhatsappChatPointer(db, {
      hash,
      roomId: resolved.room.room_id,
      personId: identity.personId,
      followerId: followerRowNow.follower_id,
      locale: joined.locale ?? "en",
    });
  }

  await wa.sendText(phone, joinedCard(joined.follower, joined.locale ?? "en"));
  return { ok: true, joined: true, slug: parsed.slug };
}

async function handleRoomCommand(db, wa, now, env, phone, cmd, ctx) {
  const hash = phoneHash(phone, env);
  const scope = await resolveActiveFollower(db, hash, ctx);
  if (scope.error) {
    await wa.sendText(phone, scope.error === "unavailable" ? roomUnavailableCard("en") : joinInstructionCard("en"));
    return { ok: true, skipped: scope.error };
  }

  if (cmd === "hindi" || cmd === "english") {
    const want = cmd === "hindi" ? "hi" : "en";
    const session = mintFollowerSession(scope.resolved, scope.identity.person_id, { now, env, locale: scope.locale });
    const result = await roomSetLocale(db, { session, locale: want }, ctx.roomDeps);
    // Keep the pointer's own copy of locale in step — this table carries its
    // own `locale` column (migration 128's own header states why, unlike
    // 082) rather than always reading it off the follower row, so a stale
    // copy here would be a silent, self-inflicted drift.
    await bindWhatsappChatPointer(db, {
      hash,
      roomId: scope.resolved.room.room_id,
      personId: scope.identity.person_id,
      followerId: scope.follower.follower_id,
      locale: result.locale,
    });
    await wa.sendText(phone, roomDisclosureCard(roomNameFor(scope.resolved.sheet), result.locale));
    await wa.sendText(phone, languageChangedCard(result.locale));
    return { ok: true, localeChanged: result.locale };
  }

  const session = mintFollowerSession(scope.resolved, scope.identity.person_id, { now, env, locale: scope.locale });

  if (cmd === "forget") {
    const result = await roomForget(db, { session }, ctx.roomDeps);
    await wa.sendText(phone, forgottenCard(result, scope.locale));
    return { ok: true, forgotten: true };
  }

  // cmd === "stop" — LEAVES, no deletion. Only the WhatsApp POINTER goes;
  // membership, memory and the consent ledger are all untouched. Sending
  // `join <slug>` again re-binds the pointer and answers again.
  await stopWhatsappChatPointer(db, hash, "user_stop");
  await wa.sendText(phone, stoppedCard(scope.locale));
  return { ok: true, stopped: true };
}

async function handleOrdinaryMessage(db, wa, now, env, phone, text, ctx) {
  const hash = phoneHash(phone, env);
  const scope = await resolveActiveFollower(db, hash, ctx);
  if (scope.error) {
    // Law 4 restated: a phone that has not joined gets the app-voiced card
    // and NEVER a creator-voiced reply — `roomSay` is never reached here.
    await wa.sendText(phone, scope.error === "unavailable" ? roomUnavailableCard("en") : joinInstructionCard("en"));
    return { ok: true, skipped: scope.error };
  }
  const trimmed = String(text || "").trim();
  if (!trimmed) return { ok: true, skipped: "empty" };

  const session = mintFollowerSession(scope.resolved, scope.identity.person_id, { now, env, locale: scope.locale });
  let turn;
  try {
    turn = await roomSay(db, { session, message: trimmed, threadId: null, transcript: [] }, ctx.roomDeps);
  } catch (e) {
    if (e instanceof RoomError) {
      if (e.code === "room_free_cap_reached") {
        const providerConfigured = activeProviderName(env) !== "none";
        await wa.sendText(phone, cappedCard(e.details, providerConfigured, scope.locale));
        return { ok: true, capped: true };
      }
      if (e.code === "room_join_required" || e.code === "room_session_expired" || e.code === "room_disclosure_stale") {
        await wa.sendText(phone, joinFirstCard(scope.locale));
        return { ok: true, skipped: "not joined" };
      }
      await wa.sendText(phone, roomUnavailableCard(scope.locale));
      return { ok: true, unavailable: true };
    }
    throw e;
  }

  // Law 2, "outside the window the follower gets nothing until they write
  // again — log the skip as a content-free count": `sendText` (through
  // `sendSessionMessage`) refuses on its own when the best-effort window
  // ledger says closed; this loop counts the refusal rather than treating it
  // as a delivery, and never substitutes a template on the follower's
  // behalf (`api/whatsapp.js`'s own `send()` states the identical law).
  let sent = 0;
  let skippedOutsideWindow = 0;
  for (const bubble of turn.bubbles) {
    if (!bubble) continue;
    const result = await wa.sendText(phone, bubble);
    if (result?.skipped === "outside_window") skippedOutsideWindow++;
    else if (result?.ok !== false) sent++;
  }
  return { ok: true, said: sent > 0, skippedOutsideWindow, gate: turn.gate };
}

// ─────────────────────────────────────────────────────────────────────────
// THE ONE ENTRY POINT — a whole webhook payload -> dispatched, one message
// at a time, in delivery order
// ─────────────────────────────────────────────────────────────────────────

/**
 * `db`, `wa` and every follower-lane dependency are injected so an offline
 * eval drives the REAL pipeline with a fake db and a fake WhatsApp client and
 * no network — `handleRoomTelegramUpdate`'s own shape, `evals/room-whatsapp-
 * chat/run.mjs`'s own precedent one transport over.
 *
 * Returns `{ok, statuses, replies}` — the SAME shape `handleStatusWebhook`
 * (api/_room-whatsapp.js) already returns, so `api/room-wa.js` can hand
 * either function's result straight to its own response body with no branch
 * on shape.
 */
export async function handleRoomWhatsappChatWebhook(payload, deps = {}) {
  const db = deps.db;
  if (typeof db !== "function") throw new RoomError("room_db_required", 500);
  const env = deps.env ?? process.env;
  const now = deps.now ?? Date.now();
  const consumeFn = deps.consume ?? consume;
  const noteInboundFn = deps.noteInbound ?? noteInbound;
  const roomDeps = { ...deps, now, env };
  const wa = deps.wa ?? defaultRoomWhatsappChatClient(roomDeps);
  const ctx = {
    findPerson: deps.personForSurfaceUser ?? personForSurfaceUser,
    linkPerson: deps.linkSurfacePerson ?? linkSurfacePerson,
    t: deps.t,
    roomDeps,
  };

  let statuses = 0;
  let replies = 0;
  for (const entry of payload?.entry || []) {
    for (const change of entry?.changes || []) {
      const v = change?.value || {};
      statuses += Array.isArray(v.statuses) ? v.statuses.length : 0;
      for (const m of v.messages || []) {
        const ev = classifyRoomWhatsappChatMessage(m);
        if (ev.kind === "ignore") continue;
        replies++;

        // WS-R89's own class-(d) redelivery law, restated for a WhatsApp
        // message id instead of a Telegram update_id — the FIRST delivery
        // consumes the slot, a redelivery this window is a no-op, never
        // reaching the database. Message ids missing entirely (should not
        // happen on a real Cloud API delivery) fall through to ordinary
        // dispatch rather than being silently dropped.
        if (ev.messageId) {
          const seen = await consumeFn(db, { scope: "room_wa_chat_seen", key: ev.messageId, now, env });
          if (!seen.ok) continue;
        }

        // Noted BEFORE any reply is attempted — this exact message is what
        // opens (or refreshes) the 24-hour window `sendSessionMessage`
        // checks a few lines further into the same request,
        // `api/_room-whatsapp.js`'s `replyWithRoomLink` own "noted THEN
        // sent" sequencing restated.
        noteInboundFn(ev.phone, now);

        if (ev.kind === "button") {
          await handleButton(db, wa, ev.phone, ev.buttonId, ctx);
          continue;
        }

        const joinSlug = parseJoinCommand(ev.text);
        if (joinSlug) {
          await handleJoin(db, wa, ev.phone, joinSlug, ctx);
          continue;
        }
        const cmd = parseRoomCommand(ev.text);
        if (cmd) {
          await handleRoomCommand(db, wa, now, env, ev.phone, cmd, ctx);
          continue;
        }
        // Anything else: `handleOrdinaryMessage` resolves the phone's own
        // active follower scope itself, so a phone with no pointer gets the
        // join instruction and NEVER reaches `roomSay` — structural, via that
        // function's own `resolveActiveFollower` call, not a branch here
        // duplicating the check.
        await handleOrdinaryMessage(db, wa, now, env, ev.phone, ev.text, ctx);
      }
    }
  }
  return { ok: true, statuses, replies };
}
