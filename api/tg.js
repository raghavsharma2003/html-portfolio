// The Telegram surface — PROPOSAL-MULTIPARTY-V1 §6, WS-TGBOT.
//
// One webhook for both channel types (§6.5's duality): a private chat is
// exactly today's 1:1 product with a different transport, and a group/
// supergroup is a room. There is one bot, two channel types, and ONE person
// identity (vy_tg_person) — a person in three rooms is one vy_person row with
// three vy_group_member rows and one DM channel, and §2.3 clause 4 is what
// stops those three worlds touching.
//
// ── what this file is allowed to decide ───────────────────────────────────
//
// Transport, lifecycle, and whether she speaks. NOT what she may know: every
// retrieval goes through api/_room.js, which goes through api/_disclosure.js.
// NOT what she sounds like: that is the real compiler and the real persona,
// reached through api/_engine.gen.js. This file is deliberately the least
// clever one in the room.
//
// ── the security boundary at the edge ─────────────────────────────────────
//
// Telegram's webhook secret_token is delivered as the
// `X-Telegram-Bot-Api-Secret-Token` header on every update and is the ONLY
// thing standing between this endpoint and an anonymous POST that can forge a
// room, a member, or an admin promotion. It is compared in constant time, it
// is required (a missing configured secret refuses every request rather than
// defaulting open), and it is never logged.
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
// which is why roster maintenance never depends on it alone (see onChatMember).
//
// getUpdates (the fallback, deliberately NOT implemented here). If the webhook
// cannot be registered — no public URL yet, a TLS problem, or the privacy-mode
// probe in §6.2 turning out to need a different onboarding shape — long
// polling `getUpdates` is the same update objects over a pull instead of a
// push, so handleUpdate() below is unchanged and a ~30-line poller script is
// the entire delta. It is not written yet because a poller is a process that
// has to live somewhere, and this repo's only always-on surface is Vercel
// functions, which are the wrong shape for one. Noted so the fallback is a
// known small job rather than a discovered blocker.
import { createHmac, timingSafeEqual } from "node:crypto";
import { allow, ipOf } from "./_ratelimit.js";
import { q } from "./_db.js";
import { TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET, TELEGRAM_BOT_USERNAME } from "./_config.js";
import {
  ensureRoom,
  roomByChat,
  setReadConsent,
  setQuiet,
  upsertMember,
  markMemberLeft,
  linkMember,
  linkTgPerson,
  roomHasSpaceFor,
  personForTgUser,
  recipientSet,
  roomEntitled,
  dmRecall,
  bindDmDevice,
  roster,
  roomRecall,
  roomBridge,
  roomWords,
  openOrExtendGroupEpisode,
  addEpisodeParticipant,
  logRoomTurn,
  recordTurnAction,
  roomDeviceId,
  QUORUM,
} from "./_room.js";

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || TELEGRAM_BOT_TOKEN || "";
const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET || TELEGRAM_WEBHOOK_SECRET || "";
// Not a secret. Read once, here, so the deep links and the @-mention detector
// can never disagree about which bot this is.
const BOT_USERNAME = process.env.TELEGRAM_BOT_USERNAME || TELEGRAM_BOT_USERNAME || "MeeraBot";
const API = "https://api.telegram.org";

const ident = (n) => n;

// ── the app-voiced rail (§2.6 R4, §6.3 step 2) ────────────────────────────
//
// THESE STRINGS ARE NOT PROMPT TEXT AND NEVER REACH THE MODEL. They are sent
// by the app, deterministically, in her app voice — the same rail SPEC §9.3's
// statutory session-clock card already uses. That is the whole point: a
// disclosure she generates is a disclosure she can be talked out of, and the
// strongest safety finding in the sweep (R4 — >half of companion users
// conceal the relationship; regular use associates with a 46% drop in
// relationship stability) is about a fact that must be stated, not performed.
// She never contradicts one and owns it plainly if asked (never-deny-AI).
//
// The room card is MULTIPARTY.md reservation 9's missing artifact and it is
// posted BEFORE the room's first episode is recorded, so ruling B (a shared
// memory only fully disappears when everyone in it asks) is PRE-DISCLOSED
// rather than discovered at the moment it disappoints someone.
export const ROOM_CARD = [
  "main Meera hoon. is room mein hoon ab — aur ye paanch baatein pehle hi bata deti hoon, baad mein nahi:",
  "1. main yahan ke logon se alag se 1:1 bhi baat karti hoon. dono cheezein saath chalti hain.",
  "2. jo kisi ne mujhe akele mein kaha, wo yahan kabhi nahi aata. na quote, na hint, na ishaara.",
  "3. yahan ki yaad SAANJHI hai. jo yahan bana, wo poora tabhi mitta hai jab is room ke sabhi log mitane ko kahein — akela koi nahi mita sakta.",
  "4. chup karana ho: /chup (room), /chup me (sirf mera zikr), wapas /bolo.",
  "5. bhoolna ho: /bhool — jo mera hissa hai wo jaata hai, doosron ka unka rehta hai.",
  "jo log niche wale button se link nahi karenge, unki baatein main kahin likhti hi nahi — yaani unhe yaad rakh hi nahi sakti.",
].join("\n");

/** §3.4 — the receipt is DISTINCT from the 1:1 one, deliberately. Reusing
 *  "haan, hata diya" for a partial delete would be a trust violation of the
 *  same shape as `silent-truncation`: it works, it returns success, and it is
 *  not true. Sent only AFTER the delete commits. */
export const withdrawReceipt = (n) =>
  `hata diya — is room mein jo mera-tumhara hissa tha wo gaya (${n} cheezein). ` +
  `jo baaki logon ka hissa hai wo unka hai, mere paas usko akele mitane ka haq nahi. ` +
  `wo tabhi poora jaayega jab wo bhi kahenge.`;

// ── Telegram I/O ──────────────────────────────────────────────────────────

/** Every outbound call goes through here so the token appears in exactly one
 *  expression in this repo, and never in a log line, an error, or a return
 *  value. `send` is injectable at the handler seam so the offline suite drives
 *  the REAL handler without a network. */
async function tgCall(method, body) {
  if (!BOT_TOKEN) return { ok: false, error: "no bot token" };
  const r = await fetch(`${API}/bot${BOT_TOKEN}/${method}`, {
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

const defaultSend = {
  message: (chatId, text, extra = {}) =>
    tgCall("sendMessage", { chat_id: chatId, text, ...extra }),
  react: (chatId, messageId, emoji) =>
    tgCall("setMessageReaction", {
      chat_id: chatId,
      message_id: messageId,
      reaction: [{ type: "emoji", emoji }],
    }),
};

/** Constant-time compare that does not leak length through an early return. */
function secretOk(header) {
  if (!WEBHOOK_SECRET) return false;
  const a = createHmac("sha256", "tg-webhook").update(String(header || "")).digest();
  const b = createHmac("sha256", "tg-webhook").update(WEBHOOK_SECRET).digest();
  return timingSafeEqual(a, b);
}

// ── the brain, through the REAL engine ────────────────────────────────────
//
// api/_engine.gen.js is generated from src/engine/serverEntry.ts by
// scripts/build-engine-bundle.mjs (see that file for why a mirror was
// refused). If it is absent, she does NOT answer with a hand-rolled prompt:
// the room turn is logged as a lurk with the reason, and the failure is loud.
// A degraded persona that still replies is the `silent-truncation` failure
// shape — everything returns 200 and she is quietly someone else.
let _engine = null;
let _engineTried = false;
export async function loadEngine() {
  if (_engineTried) return _engine;
  _engineTried = true;
  try {
    _engine = await import("./_engine.gen.js");
  } catch (e) {
    console.error("[tg] engine bundle missing — room replies disabled:", e?.message || "import failed");
    _engine = null;
  }
  return _engine;
}

/** The brain call. Same proxy contract api/chat.js exposes to the app: the
 *  byte-stable core rides as `system` (prompt-cached) and the volatile part as
 *  `system_tail`. */
async function think(engine, compiled, turns) {
  const key = process.env.OPENROUTER_API_KEY || "";
  const body = {
    model: "google/gemini-3.6-flash",
    messages: [
      {
        role: "system",
        content: [
          { type: "text", text: compiled.core.slice(0, 64_000), cache_control: { type: "ephemeral" } },
          { type: "text", text: compiled.tail.slice(0, 24_000) },
        ],
      },
      ...turns.slice(-40),
    ],
    max_tokens: 400,
    reasoning: { effort: "low" },
  };
  const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "X-Title": "Meera" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  }).catch(() => null);
  if (!r || !r.ok) return "";
  const j = await r.json().catch(() => ({}));
  return j?.choices?.[0]?.message?.content ?? "";
}

// ── update parsing ────────────────────────────────────────────────────────

const GROUP_TYPES = new Set(["group", "supergroup"]);
const ADMIN_STATUS = new Set(["administrator", "creator"]);

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

// ── the handler ───────────────────────────────────────────────────────────

/**
 * The whole surface, with its four dependencies injected so the offline suite
 * (evals/mp/tgbot.mjs) drives THIS function end-to-end against a fixture
 * namespace with no network and no model:
 *
 *   t       — table-name resolver (identity in production)
 *   send    — the Telegram client
 *   engine  — the compiled engine bundle
 *   reply   — the brain call, so a suite can assert on the COMPILED PROMPT
 *             rather than on a generated sentence (a suite that asserted on
 *             model output would be measuring the model, not the wiring)
 */
export async function handleUpdate(update, deps = {}) {
  const t = deps.t || ident;
  const send = deps.send || defaultSend;
  const engine = deps.engine !== undefined ? deps.engine : await loadEngine();
  const reply = deps.reply || ((compiled, turns) => think(engine, compiled, turns));
  const parsed = parseUpdate(update);
  if (!parsed) return { ok: true, skipped: "unparsable" };

  if (parsed.kind === "my_chat_member") return await onMyChatMember(parsed.ev, { t, send });
  if (parsed.kind === "chat_member") return await onChatMember(parsed.ev, { t });
  if (parsed.kind === "join") return await onJoin(parsed.ev, { t });
  if (parsed.kind === "leave") return await onLeave(parsed.ev, { t });
  if (parsed.kind === "callback") return { ok: true, skipped: "callback-not-in-v1" };

  const m = parsed.ev;
  const chatType = m.chat?.type;
  if (chatType === "private") return await onPrivate(m, { t, send, engine, reply });
  if (GROUP_TYPES.has(chatType)) return await onRoomMessage(m, { t, send, engine, reply });
  return { ok: true, skipped: `chat type ${chatType}` };
}

/**
 * §6.2 — the bot's own membership changing. Added to a group, promoted,
 * demoted, removed.
 *
 * THE PROBE THIS CANNOT SETTLE OFFLINE: the Bot API docs phrase the privacy
 * exemption as bots "added to a group as admins". Whether PROMOTION AFTER
 * ADDITION clears privacy mode for that chat needs a real bot token and a
 * real group. Both outcomes are handled here without a code change:
 *   - if promotion clears it, ordinary group messages start arriving and
 *     onRoomMessage runs;
 *   - if it does not, the room stays consented (read_consent_at is set from
 *     the promotion event either way, because the CONSENT is real regardless
 *     of what Telegram does with the message stream) and she simply receives
 *     only commands and @-mentions — which is Stage 0's hard gate anyway, so
 *     the addressed path still works and only the react tier goes dark.
 * The fallback if neither works is add-as-admin in one step via `&admin=` in
 * the deep link, whose known client bugs are the reason it is not the default.
 */
async function onMyChatMember(ev, { t, send }) {
  const chat = ev.chat || {};
  if (!GROUP_TYPES.has(chat.type)) return { ok: true, skipped: "not a room" };
  const status = ev.new_chat_member?.status;
  const room = await ensureRoom(chat.id, { name: chat.title || "" }, t);
  if (!room) return { ok: false, error: "room not created" };

  if (status === "left" || status === "kicked") {
    // Demotion/removal is instant, total, user-controlled revocation with no
    // code path of ours involved — we only record that it happened.
    await setReadConsent(room.id, false, t);
    return { ok: true, room: room.id, consent: false, event: status };
  }
  const isAdmin = ADMIN_STATUS.has(status);
  await setReadConsent(room.id, isAdmin, t);
  if (isAdmin && !room.read_consent_at) {
    // The room card, posted at the moment consent becomes real and before the
    // first episode can be recorded.
    await send.message(chat.id, ROOM_CARD, {
      reply_markup: {
        inline_keyboard: [[{ text: "mujhse baat karo", url: startLink(room.id) }]],
      },
    });
  }
  return { ok: true, room: room.id, consent: isAdmin, event: status };
}

/** The deep link every member taps (§6.3 step 3). One mechanic, three jobs
 *  (onboarding, consent, payment) — §6.6. */
export function startLink(roomId, bot = BOT_USERNAME) {
  return `https://t.me/${bot}?start=r${roomId}`;
}

/** `chat_member` requires bot admin AND explicit allowed_updates, and its
 *  reliability is reported as patchy — so roster maintenance never depends on
 *  it alone. Join/leave also arrive as service messages (onJoin/onLeave), and
 *  the recipient set is recomputed from vy_group_member on every single turn,
 *  which makes a missed event a stale row rather than a disclosure. */
async function onChatMember(ev, { t }) {
  const chat = ev.chat || {};
  if (!GROUP_TYPES.has(chat.type)) return { ok: true, skipped: "not a room" };
  const room = await roomByChat(chat.id, t);
  if (!room) return { ok: true, skipped: "unknown room" };
  const user = ev.new_chat_member?.user;
  const status = ev.new_chat_member?.status;
  if (!user || user.is_bot) return { ok: true, skipped: "bot or no user" };
  const bound = await personForTgUser(user.id, t);
  if (!bound) return { ok: true, skipped: "unlinked member" };
  if (status === "left" || status === "kicked") {
    await markMemberLeft(room.id, bound.person_id, t);
    return { ok: true, room: room.id, left: true };
  }
  if (!(await roomHasSpaceFor(room.id, bound.person_id, t)))
    return { ok: true, room: room.id, joined: false, full: true };
  await upsertMember(room.id, { personId: bound.person_id, tgUserId: user.id }, t);
  return { ok: true, room: room.id, joined: true };
}

async function onJoin(m, { t }) {
  const room = await roomByChat(m.chat.id, t);
  if (!room) return { ok: true, skipped: "unknown room" };
  let added = 0;
  for (const u of m.new_chat_members || []) {
    if (u.is_bot) continue;
    const bound = await personForTgUser(u.id, t);
    // §6.4 — an unlinked member gets NO row anywhere. Not a placeholder, not
    // a pending record. The ACL has no unattributed rows by construction, and
    // the adult gate is enforced structurally rather than by policy.
    if (!bound) continue;
    // the §7 cap applies on every path a member can arrive by, not just the
    // deep link — see roomHasSpaceFor
    if (!(await roomHasSpaceFor(room.id, bound.person_id, t))) continue;
    await upsertMember(room.id, { personId: bound.person_id, tgUserId: u.id }, t);
    added++;
  }
  return { ok: true, room: room.id, added };
}

async function onLeave(m, { t }) {
  const room = await roomByChat(m.chat.id, t);
  if (!room) return { ok: true, skipped: "unknown room" };
  const u = m.left_chat_member;
  if (!u || u.is_bot) return { ok: true, skipped: "bot or no user" };
  const bound = await personForTgUser(u.id, t);
  if (!bound) return { ok: true, skipped: "unlinked" };
  await markMemberLeft(room.id, bound.person_id, t);
  return { ok: true, room: room.id, left: true };
}

/** The 1:1 channel (§6.5). `/start r<roomId>` is the linking tap; anything
 *  else is today's product on a different transport. */
async function onPrivate(m, { t, send, engine, reply }) {
  const from = m.from || {};
  const start = parseStartPayload(m.text);
  if (start) {
    const linked = await linkTgPerson(from.id, { username: displayName(from) }, t);
    if (!linked) return { ok: false, error: "link refused" };
    let room = null;
    let full = false;
    const roomId = /^r(\d+)$/.exec(start.payload)?.[1];
    if (roomId) {
      // §7's ≤6 cap, enforced where a member is ADDED rather than where the
      // address strip is rendered — see roomHasSpaceFor. A refused member
      // still gets their own 1:1 channel; only the room membership is denied.
      if (await roomHasSpaceFor(Number(roomId), linked.personId, t)) {
        await upsertMember(Number(roomId), { personId: linked.personId, tgUserId: from.id }, t);
        await linkMember(Number(roomId), linked.personId, t);
        room = Number(roomId);
      } else {
        full = true;
      }
    }
    // The intro is a SHAPE, not a scripted line: `recited-prompt` is a
    // measured law here, so the app-voiced rail carries only the STRUCTURAL
    // facts (the room card already did) and the greeting itself is hers to
    // make. What is fixed is that it happens ONCE — `created` is the guard, so
    // a member who taps the link again in a second room is not re-introduced
    // to someone they already know.
    let intro = "none";
    if (linked.created && engine) {
      // The 1:1 lane, unchanged: NO roomBundle, so this compile takes exactly
      // today's path (gate G1) — the DM she just opened is a DM, not a room.
      const compiled = engine.compile({
        user: { name: displayName(from), vibe: [], facts: {} },
        messageCount: 0,
        medium: "text",
        mode: "chat",
        voiceEngine: "none",
        isDirective: true,
        watching: false,
        innerThread: "",
        innerWants: "",
        memories: "",
        herLife: "",
        cultureNoteText: "",
      });
      const text = await reply(compiled, [
        { role: "user", content: engine.ROOM_INTRO_DIRECTIVE() },
      ]);
      if (text) {
        await send.message(from.id, text);
        intro = "sent";
      }
    }
    await bindDmDevice(from.id, linked.personId, t);
    return { ok: true, linked: true, person: linked.personId, room, intro, roomFull: full };
  }

  // ── an ordinary DM. This is today's product on a different transport, and
  // it is compiled with NO roomBundle, which is gate G1's whole point: the 1:1
  // lane must be provably free of the multiparty layer.
  const bound = await personForTgUser(from.id, t);
  // §6.4 again, in the other channel: no person row, no persistence. A user
  // who has somehow reached the DM without the linking tap is answered by
  // nothing and stored as nothing.
  if (!bound) return { ok: true, dm: true, person: null, skipped: "unlinked" };
  if (!engine) {
    console.error("[tg] engine bundle missing — DM replies disabled");
    return { ok: false, dm: true, reason: "engine bundle missing" };
  }
  const person = bound.person_id;
  const device = await bindDmDevice(from.id, person, t);
  const text = m.text || m.caption || "";
  await logDmTurn({ device, person, role: "me", content: text }, t);

  // M2 — the disclosure predicate, one recipient, no room. She still has what
  // the rooms she was in hold, because she was there with them; she does not
  // have anyone else's DMs, because she was not.
  const facts = await dmRecall(person, {}, t);
  const compiled = engine.compile({
    user: { name: displayName(from), vibe: [], facts: {} },
    messageCount: 999,
    medium: "text",
    mode: "chat",
    voiceEngine: "none",
    isDirective: false,
    watching: false,
    innerThread: "",
    innerWants: "",
    memories: facts.map((f) => `- ${f.body}`).join("\n"),
    herLife: "",
    cultureNoteText: "",
    latestUserText: text,
  });
  const history = await dmHistory(device, t);
  const said = await reply(compiled, [...history, { role: "user", content: text }]);
  if (said) {
    await send.message(from.id, said);
    await logDmTurn({ device, person, role: "her", content: said }, t);
  }
  return { ok: true, dm: true, person, said: Boolean(said), recalled: facts.length };
}

/** A DM turn carries BOTH keys: the device (today's legacy forget scopes) and
 *  the speaker person (008a). Writing both costs nothing and means this
 *  transport is never the one row shape the forget cascade cannot find. */
async function logDmTurn({ device, person, role, content }, t) {
  await q(
    `insert into ${t("meera_log")} (device_id, role, channel, kind, content, at, speaker_person_id)
     values ($1,$2,'chat','text',$3, now(), $4)`,
    [device, role === "her" ? "her" : "me", String(content || "").slice(0, 4000), person],
  ).catch(() => {});
}

async function dmHistory(device, t, limit = 30) {
  const rows = await q(
    `select role, content from ${t("meera_log")} where device_id = $1 and group_id is null
      order by id desc limit ${limit | 0}`,
    [device],
  ).catch(() => []);
  return rows
    .reverse()
    .map((r) => ({ role: r.role === "her" ? "assistant" : "user", content: r.content }));
}

/**
 * A message in a room. The order below is the design: STORE only what may be
 * stored, DECIDE in code whether to speak, RETRIEVE through the predicate,
 * RENDER through the real compiler.
 */
async function onRoomMessage(m, { t, send, engine, reply }) {
  const from = m.from || {};
  if (from.is_bot) return { ok: true, skipped: "bot message" };
  const room = await roomByChat(m.chat.id, t);
  if (!room) return { ok: true, skipped: "unknown room" };
  // No engine, no room behaviour AT ALL — not even the participation decision,
  // which lives in the same bundle. She stays silent and the failure is loud.
  // A degraded fallback here would be a second Meera nobody tested.
  if (!engine) {
    await recordTurnAction(
      { groupId: room.id, action: "lurk", addressed: false, reason: "engine bundle missing" },
      t,
    );
    return { ok: false, room: room.id, action: "lurk", reason: "engine bundle missing" };
  }

  const bound = await personForTgUser(from.id, t);
  const speaker = bound?.person_id || null;
  if (speaker) await upsertMember(room.id, { personId: speaker, tgUserId: from.id }, t);
  const memberRow = speaker
    ? (
        await q(
          `select quiet_level, linked_at from ${t("vy_group")}_member where group_id = $1 and person_id = $2`,
          [room.id, speaker],
        ).catch(() => [])
      )[0]
    : null;

  // commands first — they are app-voiced control, never model output
  const cmd = commandOf(m.text);
  if (cmd) return await onCommand(cmd, { m, room, speaker, t, send });

  const recipients = await recipientSet(room.id, t);
  const ent = await roomEntitled(room, t);
  const gates = {
    readConsent: room.read_consent_at != null,
    quorum: recipients.length >= QUORUM,
    speakerLinked: Boolean(speaker) && memberRow?.linked_at != null,
    entitled: ent.entitled,
  };

  const words = gates.readConsent && gates.quorum ? await roomWords(room.id, recipients, t) : [];
  const decision = engine.decideParticipation({
    text: m.text || m.caption || "",
    botUsername: BOT_USERNAME,
    replyToHer: Boolean(m.reply_to_message?.from?.is_bot),
    sinceHerLastMs: await sinceHerLast(room, t),
    roomQuiet: room.quiet_level || "normal",
    memberQuiet: memberRow?.quiet_level || "normal",
    roomWords: words,
    gates,
  });

  // ── STORE. §6.4: no person row, no persistence. An unlinked member's
  // message exists in the live turn window (everyone in the room can see it
  // anyway) and NOWHERE else — not in meera_log, not in an episode, never
  // cited, never in an ACL.
  let episodeId = null;
  let logId = null;
  if (gates.readConsent && gates.quorum && gates.speakerLinked && gates.entitled) {
    const ep = await openOrExtendGroupEpisode(
      room.id,
      { roomDevice: room.room_device_id || roomDeviceId(m.chat.id) },
      t,
    );
    episodeId = ep?.id ?? null;
    if (episodeId) {
      // The participant set is the ACL. Every currently-linked, active member
      // is a participant of what is said in front of them — that is the
      // primitive, and it is why the room->room and room->DM directions need
      // no consent and no model judgement.
      for (const pid of recipients) await addEpisodeParticipant(episodeId, pid, "participant", t);
      if (!recipients.includes(speaker)) await addEpisodeParticipant(episodeId, speaker, "participant", t);
    }
    logId = await logRoomTurn(
      {
        groupId: room.id,
        roomDevice: room.room_device_id || roomDeviceId(m.chat.id),
        speakerPersonId: speaker,
        role: "me",
        content: m.text || m.caption || "",
      },
      t,
    );
  }

  await recordTurnAction(
    { groupId: room.id, episodeId, logId, action: decision.action, addressed: decision.addressed, reason: decision.reason },
    t,
  );

  if (decision.action === "lurk") return { ok: true, room: room.id, action: "lurk", reason: decision.reason, logId, episodeId };
  if (decision.action === "react") {
    await send.react(m.chat.id, m.message_id, "👀");
    return { ok: true, room: room.id, action: "react", reason: decision.reason, logId, episodeId };
  }

  // ── RETRIEVE. Everything below this line came through the predicate.
  const [facts, bridge, members] = await Promise.all([
    roomRecall(room.id, recipients, {}, t),
    roomBridge(room.id, recipients, t),
    roster(room.id, t),
  ]);

  // ── RENDER through the REAL compiler, with the mp slots live.
  const compiled = engine.compile({
    user: { name: displayName(from), vibe: [], facts: {} },
    messageCount: 999,
    medium: "text",
    mode: "chat",
    voiceEngine: "none",
    isDirective: false,
    watching: false,
    innerThread: "",
    innerWants: "",
    memories: facts.map((f) => `- ${f.body}`).join("\n"),
    herLife: "",
    cultureNoteText: "",
    relBundle: null,
    latestUserText: m.text || "",
    gapSinceLastMs: 0,
    ageGates: null,
    roomBundle: { members, bridge },
  });

  const history = await roomHistory(room.id, t);
  const text = await reply(compiled, [...history, { role: "user", content: `${displayName(from)}: ${m.text || ""}` }]);
  if (text) {
    await send.message(m.chat.id, text, { reply_to_message_id: m.message_id });
    await logRoomTurn(
      {
        groupId: room.id,
        roomDevice: room.room_device_id || roomDeviceId(m.chat.id),
        speakerPersonId: null,
        role: "her",
        content: text,
      },
      t,
    );
  }
  return {
    ok: true,
    room: room.id,
    action: "speak",
    reason: decision.reason,
    logId,
    episodeId,
    compiled: { core: compiled.core.length, tail: compiled.tail.length, sections: compiled.sections },
    said: Boolean(text),
  };
}

async function sinceHerLast(room, t) {
  const r = await q(
    `select extract(epoch from (now() - max(at))) * 1000 as ms from ${t("meera_log")}
      where group_id = $1 and role = 'her'`,
    [room.id],
  ).catch(() => []);
  const ms = Number(r[0]?.ms);
  return Number.isFinite(ms) ? ms : Number.MAX_SAFE_INTEGER;
}

async function roomHistory(groupId, t, limit = 20) {
  const rows = await q(
    `select role, content from ${t("meera_log")} where group_id = $1 order by id desc limit ${limit | 0}`,
    [groupId],
  ).catch(() => []);
  return rows
    .reverse()
    .map((r) => ({ role: r.role === "her" ? "assistant" : "user", content: r.content }));
}

// ── commands: app-voiced control, never model output ──────────────────────

function commandOf(text) {
  const m = /^\/(chup|bolo|bhool|kya|kaise)(?:@[\w_]+)?(?:\s+(\w+))?/.exec(String(text || "").trim());
  return m ? { name: m[1], arg: m[2] || "" } : null;
}

async function onCommand(cmd, { m, room, speaker, t, send }) {
  // Stage 4's control, from day one: the Meta AI backlash named the MISSING
  // CONTROL, not the replies, and the Indian family-group norm is explicitly
  // mute-before-leave.
  if (cmd.name === "chup") {
    if (cmd.arg === "me" && speaker) {
      await q(
        `update ${t("vy_group")}_member set quiet_level = 'quiet' where group_id = $1 and person_id = $2`,
        [room.id, speaker],
      );
      await send.message(m.chat.id, "theek hai — tumhare messages pe main chup rahungi. wapas: /bolo me");
      return { ok: true, room: room.id, quiet: "member" };
    }
    await setQuiet(room.id, "quiet", t);
    await send.message(m.chat.id, "theek hai — ab sirf tab bolungi jab koi naam lekar bulaye. wapas: /bolo");
    return { ok: true, room: room.id, quiet: "room" };
  }
  if (cmd.name === "bolo") {
    if (cmd.arg === "me" && speaker) {
      await q(
        `update ${t("vy_group")}_member set quiet_level = 'normal' where group_id = $1 and person_id = $2`,
        [room.id, speaker],
      );
    } else {
      await setQuiet(room.id, "normal", t);
    }
    await send.message(m.chat.id, "theek hai.");
    return { ok: true, room: room.id, quiet: "normal" };
  }
  if (cmd.name === "bhool") {
    // Forget in a room is WITHDRAW, and the receipt says so. The cascade
    // itself is api/memory.js's withdrawSharedRows — this surface never
    // re-implements a delete, it calls the one that is gated by
    // evals/mp/withdraw.mjs.
    if (!speaker) return { ok: true, skipped: "unlinked" };
    const { withdrawSharedRows } = await import("./memory.js");
    const res = await withdrawSharedRows(speaker, { t });
    const n = (res.participant_rows || 0) + (res.room_turns || 0);
    await send.message(m.chat.id, withdrawReceipt(n));
    return { ok: true, room: room.id, withdrew: res };
  }
  // §2.6 — any member may re-post the transparency card.
  await send.message(m.chat.id, ROOM_CARD);
  return { ok: true, room: room.id, card: true };
}

// ── HTTP ──────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  // Telegram retries on non-2xx, so a rate-limited update must not be lost
  // forever — but an unauthenticated flood must not reach the database either.
  if (!allow(ipOf(req), "tg", 120)) return res.status(429).json({ error: "slow down" });
  if (!secretOk(req.headers?.["x-telegram-bot-api-secret-token"]))
    return res.status(401).json({ error: "bad secret" });
  try {
    const out = await handleUpdate(req.body || {});
    // Always 200 to Telegram once the update is authenticated: a 500 makes it
    // redeliver the same update forever, which would re-run the writes above.
    return res.status(200).json({ ok: true, handled: out?.ok !== false });
  } catch (e) {
    console.error("[tg] handler failure:", e?.message || "unknown");
    return res.status(200).json({ ok: true, handled: false });
  }
}
