// The surface contract — SPEC-AGENT-LAYER §4 (Law E3).
//
// A surface is a TRANSPORT. It is not a tenant, it is not a relationship, and
// it scopes nothing. The same human on Telegram and on the web is the same
// relationship, so identity resolution here is AGENT-INDEPENDENT and memory is
// never keyed by surface. Anything that keys memory by surface reintroduces
// the amnesia the relational layer exists to delete.
//
// ── the four functions, and only four ─────────────────────────────────────
//
// An adapter (api/tg.js, api/discord.js, api/whatsapp.js) implements exactly:
//
//   verify(req)                  -> Promise<{ok, reason, payload?, raw?, respond?}>
//   parse(payload, req?)         -> InboundEvent[]
//   send(chatKey, OutboundMessage) -> Promise<{ok, ...}>
//   render(text)                 -> NativeMessage[]
//
// Everything else — identity resolve, room ensure, roster, the disclosure
// predicate call, recall, compile, think, logging the turn, the consolidation
// trigger — lives HERE, once, and is shared. That is the measure of the
// contract: a new surface is the four functions and nothing else, and api/tg.js
// is not allowed to stay the exception (§4: "a new surface is under ~200 lines,
// and api/tg.js shrinks toward that number").
//
// ── what this file is NOT allowed to know ─────────────────────────────────
//
// Surface-specific limits and affordances. Discord's 2,000-char message cap
// and WhatsApp's 24-hour customer-service window are `render()` and `send()`
// concerns; if either ever appears in this file the contract has failed and
// §10's E3 reversal condition has fired. The engine asks for delivery; the
// adapter decides what delivery means on its wire.
//
// ── what this file is NOT allowed to decide ───────────────────────────────
//
// What she may KNOW. Every retrieval below goes through api/_room.js, which
// goes through api/_disclosure.js, where every disclosure rule is a WHERE
// clause and none of them is a sentence in a prompt (`structural-disclosure`:
// a model asked to decline while holding the answer leaks at 9-90%).
//
// What she SOUNDS LIKE. That is the real compiler and the real persona,
// reached through api/_engine.gen.js. If the bundle is missing she does NOT
// answer from a hand-rolled prompt: she stays silent and the failure is loud.
// A degraded persona that still replies is the `silent-truncation` shape — it
// works, everything returns 200, and she is quietly someone else.
import { q } from "./_db.js";
import {
  ensureRoomForChat,
  roomByChatKey,
  setReadConsent,
  setQuiet,
  upsertMember,
  markMemberLeft,
  linkMember,
  roomHasSpaceFor,
  personForSurfaceUser,
  linkSurfacePerson,
  recipientSet,
  roomEntitled,
  dmRecall,
  bindSurfaceDmDevice,
  roster,
  roomRecall,
  roomBridge,
  roomWords,
  openOrExtendGroupEpisode,
  addEpisodeParticipant,
  logRoomTurn,
  recordTurnAction,
  surfaceRoomDeviceId,
  QUORUM,
} from "./_room.js";

const ident = (n) => n;

// ─────────────────────────────────────────────────────────────────────────
// THE SHAPES
// ─────────────────────────────────────────────────────────────────────────

/**
 * InboundEvent — one normalized thing that happened on a wire.
 *
 * `parse()` returns an ARRAY of these because one webhook POST is not one
 * event on every surface: a WhatsApp Cloud API delivery carries
 * `entry[].changes[].value.messages[]` and may hold several. Telegram's is
 * always length 0 or 1.
 *
 * @typedef  {Object} InboundEvent
 * @property {'telegram'|'discord'|'whatsapp'|'web'} surface
 * @property {'message'|'bot_membership'|'member_change'|'join'|'leave'|'ignore'} kind
 * @property {string}  chatKey        opaque conversation address; the ONLY thing
 *                                    handed back to `send()`. Never parsed here.
 * @property {string}  chatName       human-readable room title, "" if none
 * @property {boolean} isGroup        room semantics vs 1:1 semantics
 * @property {string|null} surfaceUserId  the speaker, as the surface numbers them
 * @property {string}  handle         display name, already length-clamped
 * @property {string}  text           the message body ("" if none)
 * @property {string}  caption        media caption ("" if none) — kept separate
 *                                    because the shipped Telegram lane treats
 *                                    `text` and `text||caption` differently in
 *                                    two places and that is behaviour, not noise
 * @property {string|null} messageId  native id, for threading and reactions
 * @property {boolean} replyToSelf    is this a reply to the agent's own message
 * @property {boolean} fromBot        did a bot send it
 * @property {string}  reason         why an 'ignore' event is being ignored
 * @property {AdminBits} adminBits    membership/permission facts, normalized
 * @property {*}       raw            the native object. ADAPTERS ONLY.
 *
 * @typedef  {Object} AdminBits
 * @property {'member'|'admin'|'left'|'kicked'|null} selfStatus
 *           The AGENT's own status in this room. `admin` is the read-consent
 *           artifact on Telegram (§6.2) and the generalization is deliberate:
 *           on every surface, consent is a deliberate, visible, revocable act
 *           by a room admin, never a checkbox we ship enabled.
 * @property {'member'|'admin'|'left'|'kicked'|null} subjectStatus
 * @property {string|null} subjectUserId
 * @property {string}  subjectHandle
 * @property {boolean} subjectIsBot
 * @property {Array<{surfaceUserId:string, handle:string, isBot:boolean}>} joined
 * @property {{surfaceUserId:string, handle:string, isBot:boolean}|null} left
 */

/**
 * OutboundMessage — what the engine wants delivered. Deliberately poorer than
 * any real surface: it names an INTENT, and `render()`/`send()` decide what
 * that intent is on this wire.
 *
 * @typedef  {Object} OutboundMessage
 * @property {'text'|'reaction'} kind
 * @property {string}  text        the message body (kind 'text')
 * @property {string}  emoji       the reaction (kind 'reaction')
 * @property {string|null} replyTo native message id to thread to, or null
 * @property {Array<{text:string,url:string}>} buttons  link affordances; a
 *           surface without them drops them rather than inlining URLs
 * @property {NativeMessage} [native]  set by deliver(): the render() fragment
 *           this call is delivering, so send() never re-renders
 *
 * @typedef {Object} NativeMessage
 * @property {string} text   one fragment, already inside this surface's limits
 */

/**
 * SurfaceAdapter — the whole contract.
 *
 * @typedef  {Object} SurfaceAdapter
 * @property {string} surface
 * @property {(req:*) => Promise<{ok:boolean, reason:string, payload?:*, respond?:{status:number,body:*,contentType?:string}}>} verify
 * @property {(payload:*, req?:*) => InboundEvent[]} parse
 * @property {(chatKey:string, msg:OutboundMessage) => Promise<{ok:boolean}>} send
 * @property {(text:string) => NativeMessage[]} render
 */

/**
 * SurfaceCtx — the engine half's runtime, assembled by the adapter's handler.
 *
 * @typedef  {Object} SurfaceCtx
 * @property {SurfaceAdapter} adapter
 * @property {(name:string)=>string} t      table-name resolver (identity in prod)
 * @property {*}       engine               the compiled bundle, or null
 * @property {Function} reply               (compiled, turns) => Promise<string>
 * @property {(chatKey:string,msg:OutboundMessage)=>Promise<*>} send
 * @property {string}  botHandle            the agent's @-name on this surface
 * @property {(ev:InboundEvent)=>({roomRef:string|null}|null)} [linkIntent]
 *           Does this inbound event mean "link me"? Telegram's `/start r<id>`
 *           deep link is the shipped instance; a surface without deep links
 *           returns null and links on first contact instead.
 * @property {(roomId:number)=>string|null} [linkFor]
 *           A URL that onboards a room member, for the room card's button.
 *           Null on surfaces with no deep-link mechanic — the card still goes,
 *           without a button. It is a fact, not an affordance.
 */

// ─────────────────────────────────────────────────────────────────────────
// THE APP-VOICED RAIL (§2.6 R4, §6.3 step 2)
// ─────────────────────────────────────────────────────────────────────────
//
// THESE STRINGS ARE NOT PROMPT TEXT AND NEVER REACH THE MODEL. They are sent
// by the app, deterministically, in her app voice — the same rail SPEC §9.3's
// statutory session-clock card already uses. That is the whole point: a
// disclosure she generates is a disclosure she can be talked out of, and the
// strongest safety finding in the sweep (R4 — >half of companion users conceal
// the relationship; regular use associates with a 46% drop in relationship
// stability) is about a fact that must be stated, not performed. She never
// contradicts one and owns it plainly if asked (never-deny-AI).
//
// The room card is MULTIPARTY.md reservation 9's missing artifact and it is
// posted BEFORE the room's first episode is recorded, so ruling B (a shared
// memory only fully disappears when everyone in it asks) is PRE-DISCLOSED
// rather than discovered at the moment it disappoints someone.
//
// It lives HERE, not in an adapter, because these five facts are properties of
// the product and not of a wire. A surface that posted a different card would
// be a different promise.
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

/** The react tier's one glyph. Shared so two surfaces cannot disagree about
 *  what "she noticed" looks like. */
export const NOTICED_EMOJI = "👀";

// ─────────────────────────────────────────────────────────────────────────
// THE ENGINE
// ─────────────────────────────────────────────────────────────────────────

// api/_engine.gen.js is generated from src/engine/serverEntry.ts by
// scripts/build-engine-bundle.mjs (see that file for why a mirror was
// refused). If it is absent, she does NOT answer with a hand-rolled prompt:
// the turn is logged as a lurk with the reason, and the failure is loud.
let _engine = null;
let _engineTried = false;
export async function loadEngine() {
  if (_engineTried) return _engine;
  _engineTried = true;
  try {
    _engine = await import("./_engine.gen.js");
  } catch (e) {
    console.error("[surface] engine bundle missing — replies disabled:", e?.message || "import failed");
    _engine = null;
  }
  return _engine;
}

/** The brain call. Same proxy contract api/chat.js exposes to the app: the
 *  byte-stable core rides as `system` (prompt-cached) and the volatile part as
 *  `system_tail`. One copy for every surface — a second copy is a second set
 *  of sampling parameters nobody remembers to keep in step. */
export async function think(engine, compiled, turns) {
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

// ─────────────────────────────────────────────────────────────────────────
// DELIVERY
// ─────────────────────────────────────────────────────────────────────────

/**
 * The one place an OutboundMessage becomes bytes. `render()` decides how many
 * fragments this surface needs; `send()` puts each on the wire. The engine
 * never learns either number.
 *
 * Threading rides the FIRST fragment and buttons ride the LAST: a reply arrow
 * points at what she answered, and an affordance belongs at the end of what it
 * refers to. Both are surface-agnostic statements about meaning, which is why
 * they are decided here rather than in three adapters.
 */
export async function deliver(ctx, chatKey, msg) {
  if (msg.kind === "reaction") return await ctx.send(chatKey, msg);
  const parts = ctx.adapter.render(String(msg.text ?? ""));
  if (!parts.length) return { ok: false, error: "empty render" };
  let last = null;
  for (let i = 0; i < parts.length; i++) {
    last = await ctx.send(chatKey, {
      ...msg,
      kind: "text",
      text: parts[i].text,
      replyTo: i === 0 ? (msg.replyTo ?? null) : null,
      buttons: i === parts.length - 1 ? (msg.buttons || []) : [],
      native: parts[i],
    });
  }
  return last;
}

/**
 * The shared splitter every `render()` is built on. Splits on paragraph, then
 * line, then space, and only mid-token when a single token exceeds the limit —
 * a hard slice at N characters lands inside a word, a URL or a devanagari
 * cluster, and a companion that saws her own sentences in half reads as broken
 * software rather than as a person typing.
 *
 * Adapters call this; they do not reimplement it. What differs between
 * surfaces is the NUMBER, and a number is not a reason for a second algorithm.
 */
export function splitForLimit(text, limit) {
  const s = String(text ?? "");
  if (!s) return [];
  if (s.length <= limit) return [{ text: s }];
  const out = [];
  let rest = s;
  while (rest.length > limit) {
    const window = rest.slice(0, limit);
    let cut = -1;
    for (const sep of ["\n\n", "\n", " "]) {
      cut = window.lastIndexOf(sep);
      if (cut > limit * 0.3) {
        cut += sep.length;
        break;
      }
      cut = -1;
    }
    if (cut < 0) cut = limit; // one unbreakable token, longer than the limit
    out.push({ text: rest.slice(0, cut).trimEnd() });
    rest = rest.slice(cut).trimStart();
  }
  if (rest) out.push({ text: rest });
  return out.filter((p) => p.text.length);
}

// ─────────────────────────────────────────────────────────────────────────
// IDENTITY — agent-independent, by design (§4)
// ─────────────────────────────────────────────────────────────────────────
//
// vy_surface_identity has NO agent_id column and must never gain one. The
// agent enters at RETRIEVAL, not at IDENTIFICATION: whoever you are talking
// to, you are the same person, and a table that split you by agent would make
// "she remembers me from Telegram" false on the web for no reason a user could
// ever be told.
//
// During the transition both vy_surface_identity and vy_tg_person exist. The
// read prefers the general table, falls back to the Telegram one, and
// backfills the general one on the way past — so the legacy table drains
// itself and the day it is dropped is a delete, not a migration.

/** Resolve an inbound event to a person, or null. Never creates anything. */
export async function resolveIdentity(ctx, ev) {
  if (!ev.surfaceUserId) return null;
  return await personForSurfaceUser(ev.surface, ev.surfaceUserId, ctx.t);
}

/**
 * Bind an inbound event to a person, creating the vy_person row if this is a
 * first contact. Returns `{personId, created}` or null when the binding is
 * REFUSED — which is the adult gate (§6.4): a known minor never gets a row,
 * and no row is what makes persistence impossible rather than merely
 * forbidden.
 */
export async function linkIdentity(ctx, ev, { personId = null } = {}) {
  if (!ev.surfaceUserId) return null;
  return await linkSurfacePerson(
    ev.surface,
    ev.surfaceUserId,
    { handle: ev.handle || "", personId },
    ctx.t,
  );
}

// ─────────────────────────────────────────────────────────────────────────
// DISPATCH
// ─────────────────────────────────────────────────────────────────────────

/** One normalized event, routed. The adapter's HTTP handler owns the request;
 *  this owns everything after it. */
export async function dispatch(ev, ctx) {
  switch (ev.kind) {
    case "ignore":
      return { ok: true, skipped: ev.reason || "ignored" };
    case "bot_membership":
      return await onBotMembership(ev, ctx);
    case "member_change":
      return await onMemberChange(ev, ctx);
    case "join":
      return await onJoin(ev, ctx);
    case "leave":
      return await onLeave(ev, ctx);
    case "message":
      return ev.isGroup ? await onGroupMessage(ev, ctx) : await onDirectMessage(ev, ctx);
    default:
      return { ok: true, skipped: `kind ${ev.kind}` };
  }
}

/**
 * §6.2 — the AGENT's own membership changing. Added to a room, promoted,
 * demoted, removed.
 *
 * THE ADMIN BIT IS THE ROOM'S READ CONSENT, and it generalizes: on Telegram
 * privacy mode stays ON globally and she is promoted per room, so full traffic
 * requires a deliberate, visible act by a room admin — a consent artifact the
 * platform gives us for free, whose revocation is instant, total, and involves
 * no code path of ours.
 *
 * THE PROBE THIS CANNOT SETTLE OFFLINE (Telegram): the Bot API docs phrase the
 * privacy exemption as bots "added to a group as admins". Whether PROMOTION
 * AFTER ADDITION clears privacy mode for that chat needs a real token and a
 * real group. Both outcomes are handled without a code change — if promotion
 * clears it, ordinary messages arrive; if not, the room stays consented
 * (because the CONSENT is real regardless of what the platform does with the
 * message stream) and only the react tier goes dark.
 */
export async function onBotMembership(ev, ctx) {
  if (!ev.isGroup) return { ok: true, skipped: "not a room" };
  const status = ev.adminBits?.selfStatus ?? null;
  const room = await ensureRoomForChat(ev.surface, ev.chatKey, { name: ev.chatName || "" }, ctx.t);
  if (!room) return { ok: false, error: "room not created" };

  if (status === "left" || status === "kicked") {
    // Demotion/removal is instant, total, user-controlled revocation with no
    // code path of ours involved — we only record that it happened.
    await setReadConsent(room.id, false, ctx.t);
    return { ok: true, room: room.id, consent: false, event: status };
  }
  const isAdmin = status === "admin";
  await setReadConsent(room.id, isAdmin, ctx.t);
  if (isAdmin && !room.read_consent_at) {
    // The room card, posted at the moment consent becomes real and before the
    // first episode can be recorded.
    const url = ctx.linkFor ? ctx.linkFor(room.id) : null;
    await deliver(ctx, ev.chatKey, {
      kind: "text",
      text: ROOM_CARD,
      replyTo: null,
      buttons: url ? [{ text: "mujhse baat karo", url }] : [],
    });
  }
  return { ok: true, room: room.id, consent: isAdmin, event: status };
}

/** A member's status changing, as reported by the surface's roster stream.
 *  Roster maintenance NEVER depends on it alone — Telegram's `chat_member` is
 *  reported patchy and needs admin plus an explicit allowed_updates entry — so
 *  joins and leaves also arrive as service messages, and the recipient set is
 *  recomputed from vy_group_member on every single turn. A missed event is a
 *  stale row, never a disclosure. */
export async function onMemberChange(ev, ctx) {
  if (!ev.isGroup) return { ok: true, skipped: "not a room" };
  const room = await roomByChatKey(ev.surface, ev.chatKey, ctx.t);
  if (!room) return { ok: true, skipped: "unknown room" };
  const bits = ev.adminBits || {};
  if (!bits.subjectUserId || bits.subjectIsBot) return { ok: true, skipped: "bot or no user" };
  const bound = await personForSurfaceUser(ev.surface, bits.subjectUserId, ctx.t);
  if (!bound) return { ok: true, skipped: "unlinked member" };
  if (bits.subjectStatus === "left" || bits.subjectStatus === "kicked") {
    await markMemberLeft(room.id, bound.person_id, ctx.t);
    return { ok: true, room: room.id, left: true };
  }
  if (!(await roomHasSpaceFor(room.id, bound.person_id, ctx.t)))
    return { ok: true, room: room.id, joined: false, full: true };
  await upsertMember(room.id, memberKeys(ev.surface, bound.person_id, bits.subjectUserId), ctx.t);
  return { ok: true, room: room.id, joined: true };
}

export async function onJoin(ev, ctx) {
  const room = await roomByChatKey(ev.surface, ev.chatKey, ctx.t);
  if (!room) return { ok: true, skipped: "unknown room" };
  let added = 0;
  for (const u of ev.adminBits?.joined || []) {
    if (u.isBot) continue;
    const bound = await personForSurfaceUser(ev.surface, u.surfaceUserId, ctx.t);
    // §6.4 — an unlinked member gets NO row anywhere. Not a placeholder, not a
    // pending record. The ACL has no unattributed rows by construction, and
    // the adult gate is enforced structurally rather than by policy.
    if (!bound) continue;
    // the §7 cap applies on every path a member can arrive by, not just the
    // deep link — see roomHasSpaceFor
    if (!(await roomHasSpaceFor(room.id, bound.person_id, ctx.t))) continue;
    await upsertMember(room.id, memberKeys(ev.surface, bound.person_id, u.surfaceUserId), ctx.t);
    added++;
  }
  return { ok: true, room: room.id, added };
}

export async function onLeave(ev, ctx) {
  const room = await roomByChatKey(ev.surface, ev.chatKey, ctx.t);
  if (!room) return { ok: true, skipped: "unknown room" };
  const u = ev.adminBits?.left || null;
  if (!u || u.isBot) return { ok: true, skipped: "bot or no user" };
  const bound = await personForSurfaceUser(ev.surface, u.surfaceUserId, ctx.t);
  if (!bound) return { ok: true, skipped: "unlinked" };
  await markMemberLeft(room.id, bound.person_id, ctx.t);
  return { ok: true, room: room.id, left: true };
}

// ─────────────────────────────────────────────────────────────────────────
// THE 1:1 LANE (§6.5)
// ─────────────────────────────────────────────────────────────────────────
//
// This is today's shipped product on a different transport, and it is compiled
// with NO roomBundle — gate G1's whole point: the 1:1 lane must be PROVABLY
// free of the multiparty layer, not merely observed to be.

export async function onDirectMessage(ev, ctx) {
  const intent = ctx.linkIntent ? ctx.linkIntent(ev) : null;
  if (intent) return await onLinkTap(ev, intent, ctx);

  const bound = await resolveIdentity(ctx, ev);
  // §6.4 in the other channel: no person row, no persistence. A user who has
  // somehow reached the DM without the linking tap is answered by nothing and
  // stored as nothing.
  if (!bound) return { ok: true, dm: true, person: null, skipped: "unlinked" };
  if (!ctx.engine) {
    console.error(`[${ev.surface}] engine bundle missing — DM replies disabled`);
    return { ok: false, dm: true, reason: "engine bundle missing" };
  }
  const person = bound.person_id;
  const device = await bindSurfaceDmDevice(ev.surface, ev.surfaceUserId, person, ctx.t);
  const text = ev.text || ev.caption || "";
  await logDmTurn({ device, person, role: "me", content: text }, ctx.t);

  // M2 — the disclosure predicate, one recipient, no room. She still has what
  // the rooms she was in hold, because she was there with them; she does not
  // have anyone else's DMs, because she was not.
  const facts = await dmRecall(person, {}, ctx.t);
  const compiled = ctx.engine.compile({
    user: { name: ev.handle, vibe: [], facts: {} },
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
  const history = await dmHistory(device, ctx.t);
  const said = await ctx.reply(compiled, [...history, { role: "user", content: text }]);
  if (said) {
    await deliver(ctx, ev.chatKey, { kind: "text", text: said, replyTo: null, buttons: [] });
    await logDmTurn({ device, person, role: "her", content: said }, ctx.t);
  }
  return { ok: true, dm: true, person, said: Boolean(said), recalled: facts.length };
}

/**
 * The linking tap (§6.3 step 3). Load-bearing rather than cosmetic: a bot
 * cannot initiate a conversation with a user who has never started one, so
 * this one tap simultaneously opens the 1:1 channel, binds the identity, runs
 * the adult gate, and sets vy_group_member.linked_at.
 */
async function onLinkTap(ev, intent, ctx) {
  const linked = await linkIdentity(ctx, ev);
  if (!linked) return { ok: false, error: "link refused" };
  let room = null;
  let full = false;
  const roomRef = intent.roomRef ? Number(intent.roomRef) : null;
  if (roomRef) {
    // §7's ≤6 cap, enforced where a member is ADDED rather than where the
    // address strip is rendered — see roomHasSpaceFor. A refused member still
    // gets their own 1:1 channel; only the room membership is denied.
    if (await roomHasSpaceFor(roomRef, linked.personId, ctx.t)) {
      await upsertMember(roomRef, memberKeys(ev.surface, linked.personId, ev.surfaceUserId), ctx.t);
      await linkMember(roomRef, linked.personId, ctx.t);
      room = roomRef;
    } else {
      full = true;
    }
  }
  // The intro is a SHAPE, not a scripted line: `recited-prompt` is a measured
  // law here, so the app-voiced rail carries only the STRUCTURAL facts (the
  // room card already did) and the greeting itself is hers to make. What is
  // fixed is that it happens ONCE — `created` is the guard, so a member who
  // taps the link again in a second room is not re-introduced to someone they
  // already know.
  let intro = "none";
  if (linked.created && ctx.engine) {
    // The 1:1 lane, unchanged: NO roomBundle, so this compile takes exactly
    // today's path (gate G1) — the DM she just opened is a DM, not a room.
    const compiled = ctx.engine.compile({
      user: { name: ev.handle, vibe: [], facts: {} },
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
    const text = await ctx.reply(compiled, [
      { role: "user", content: ctx.engine.ROOM_INTRO_DIRECTIVE() },
    ]);
    if (text) {
      await deliver(ctx, ev.chatKey, { kind: "text", text, replyTo: null, buttons: [] });
      intro = "sent";
    }
  }
  await bindSurfaceDmDevice(ev.surface, ev.surfaceUserId, linked.personId, ctx.t);
  return { ok: true, linked: true, person: linked.personId, room, intro, roomFull: full };
}

/** A DM turn carries BOTH keys: the device (today's legacy forget scopes) and
 *  the speaker person (008a). Writing both costs nothing and means no
 *  transport is ever the one row shape the forget cascade cannot find. */
export async function logDmTurn({ device, person, role, content }, t = ident) {
  await q(
    `insert into ${t("meera_log")} (device_id, role, channel, kind, content, at, speaker_person_id)
     values ($1,$2,'chat','text',$3, now(), $4)`,
    [device, role === "her" ? "her" : "me", String(content || "").slice(0, 4000), person],
  ).catch(() => {});
}

/**
 * THE CHANNEL GUARD. `and group_id is null` is not decoration and not an
 * optimisation: it is the §2.3 clause-4 wall stated at the transport layer.
 *
 * A DM history read must not sweep up room turns that happen to share a
 * device. Today it arguably could not anyway — a room turn is keyed on the
 * room's synthetic device, which is in nobody's vy_person_device mapping — but
 * that is inertness by ACCIDENT, and the accident is precisely the bug shape
 * the coordinator closed in api/consolidate.js (four explicit guards on the
 * unguarded episode selections; see `tgbot-landed`, "inertness-by-NULL-
 * accident"). Those four are that file's, not this one's. This clause is the
 * surface layer's own copy of the same discipline, and it moves with this
 * function wherever the function moves.
 */
export async function dmHistory(device, t = ident, limit = 30) {
  const rows = await q(
    `select role, content from ${t("meera_log")} where device_id = $1 and group_id is null
      order by id desc limit ${limit | 0}`,
    [device],
  ).catch(() => []);
  return rows
    .reverse()
    .map((r) => ({ role: r.role === "her" ? "assistant" : "user", content: r.content }));
}

// ─────────────────────────────────────────────────────────────────────────
// THE ROOM LANE
// ─────────────────────────────────────────────────────────────────────────

/**
 * A message in a room. The order below IS the design: STORE only what may be
 * stored, DECIDE in code whether to speak, RETRIEVE through the predicate,
 * RENDER through the real compiler.
 */
export async function onGroupMessage(ev, ctx) {
  if (ev.fromBot) return { ok: true, skipped: "bot message" };
  const room = await roomByChatKey(ev.surface, ev.chatKey, ctx.t);
  if (!room) return { ok: true, skipped: "unknown room" };
  // No engine, no room behaviour AT ALL — not even the participation decision,
  // which lives in the same bundle. She stays silent and the failure is loud.
  // A degraded fallback here would be a second Meera nobody tested.
  if (!ctx.engine) {
    await recordTurnAction(
      { groupId: room.id, action: "lurk", addressed: false, reason: "engine bundle missing" },
      ctx.t,
    );
    return { ok: false, room: room.id, action: "lurk", reason: "engine bundle missing" };
  }

  const bound = await resolveIdentity(ctx, ev);
  const speaker = bound?.person_id || null;
  if (speaker)
    await upsertMember(room.id, memberKeys(ev.surface, speaker, ev.surfaceUserId), ctx.t);
  const memberRow = speaker
    ? (
        await q(
          `select quiet_level, linked_at from ${ctx.t("vy_group")}_member where group_id = $1 and person_id = $2`,
          [room.id, speaker],
        ).catch(() => [])
      )[0]
    : null;

  // commands first — they are app-voiced control, never model output
  const cmd = commandOf(ev.text);
  if (cmd) return await onCommand(cmd, { ev, room, speaker, ctx });

  const recipients = await recipientSet(room.id, ctx.t);
  const ent = await roomEntitled(room, ctx.t);
  const gates = {
    readConsent: room.read_consent_at != null,
    quorum: recipients.length >= QUORUM,
    speakerLinked: Boolean(speaker) && memberRow?.linked_at != null,
    entitled: ent.entitled,
  };

  const words = gates.readConsent && gates.quorum ? await roomWords(room.id, recipients, ctx.t) : [];
  const decision = ctx.engine.decideParticipation({
    text: ev.text || ev.caption || "",
    botUsername: ctx.botHandle,
    replyToHer: Boolean(ev.replyToSelf),
    sinceHerLastMs: await sinceHerLast(room, ctx.t),
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
  const roomDevice = room.room_device_id || surfaceRoomDeviceId(ev.surface, ev.chatKey);
  if (gates.readConsent && gates.quorum && gates.speakerLinked && gates.entitled) {
    const ep = await openOrExtendGroupEpisode(room.id, { roomDevice }, ctx.t);
    episodeId = ep?.id ?? null;
    if (episodeId) {
      // The participant set is the ACL. Every currently-linked, active member
      // is a participant of what is said in front of them — that is the
      // primitive, and it is why the room->room and room->DM directions need
      // no consent and no model judgement.
      for (const pid of recipients) await addEpisodeParticipant(episodeId, pid, "participant", ctx.t);
      if (!recipients.includes(speaker))
        await addEpisodeParticipant(episodeId, speaker, "participant", ctx.t);
    }
    logId = await logRoomTurn(
      {
        groupId: room.id,
        roomDevice,
        speakerPersonId: speaker,
        role: "me",
        content: ev.text || ev.caption || "",
      },
      ctx.t,
    );
  }

  await recordTurnAction(
    {
      groupId: room.id,
      episodeId,
      logId,
      action: decision.action,
      addressed: decision.addressed,
      reason: decision.reason,
    },
    ctx.t,
  );

  if (decision.action === "lurk")
    return { ok: true, room: room.id, action: "lurk", reason: decision.reason, logId, episodeId };
  if (decision.action === "react") {
    await deliver(ctx, ev.chatKey, {
      kind: "reaction",
      emoji: NOTICED_EMOJI,
      replyTo: ev.messageId,
      text: "",
      buttons: [],
    });
    return { ok: true, room: room.id, action: "react", reason: decision.reason, logId, episodeId };
  }

  // ── RETRIEVE. Everything below this line came through the predicate.
  const [facts, bridge, members] = await Promise.all([
    roomRecall(room.id, recipients, {}, ctx.t),
    roomBridge(room.id, recipients, ctx.t),
    roster(room.id, ctx.t),
  ]);

  // ── RENDER through the REAL compiler, with the mp slots live.
  const compiled = ctx.engine.compile({
    user: { name: ev.handle, vibe: [], facts: {} },
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
    latestUserText: ev.text || "",
    gapSinceLastMs: 0,
    ageGates: null,
    roomBundle: { members, bridge },
  });

  const history = await roomHistory(room.id, ctx.t);
  const text = await ctx.reply(compiled, [
    ...history,
    { role: "user", content: `${ev.handle}: ${ev.text || ""}` },
  ]);
  if (text) {
    await deliver(ctx, ev.chatKey, {
      kind: "text",
      text,
      replyTo: ev.messageId,
      buttons: [],
    });
    await logRoomTurn(
      { groupId: room.id, roomDevice, speakerPersonId: null, role: "her", content: text },
      ctx.t,
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

/** Her own last word in THIS ROOM. `group_id = $1` pins it, so a DM row
 *  (group_id null) can never match and the cooldown can never be reset by
 *  something she said somewhere else. */
export async function sinceHerLast(room, t = ident) {
  const r = await q(
    `select extract(epoch from (now() - max(at))) * 1000 as ms from ${t("meera_log")}
      where group_id = $1 and role = 'her'`,
    [room.id],
  ).catch(() => []);
  const ms = Number(r[0]?.ms);
  return Number.isFinite(ms) ? ms : Number.MAX_SAFE_INTEGER;
}

/** The room's live turn window, pinned to the room by `group_id = $1`. A DM
 *  turn (group_id null) can never enter a room's history — the other half of
 *  the channel guard above, in the other direction. */
export async function roomHistory(groupId, t = ident, limit = 20) {
  const rows = await q(
    `select role, content from ${t("meera_log")} where group_id = $1 order by id desc limit ${limit | 0}`,
    [groupId],
  ).catch(() => []);
  return rows
    .reverse()
    .map((r) => ({ role: r.role === "her" ? "assistant" : "user", content: r.content }));
}

// ─────────────────────────────────────────────────────────────────────────
// COMMANDS — app-voiced control, never model output
// ─────────────────────────────────────────────────────────────────────────

/** The command grammar is the PRODUCT's, not Telegram's: `/chup /bolo /bhool
 *  /kya` are the controls the Meta AI backlash named as MISSING, and the
 *  Indian family-group norm is explicitly mute-before-leave. The optional
 *  `@bot` suffix is tolerated on every surface because more than one of them
 *  appends it. */
export function commandOf(text) {
  const m = /^\/(chup|bolo|bhool|kya|kaise)(?:@[\w_]+)?(?:\s+(\w+))?/.exec(String(text || "").trim());
  return m ? { name: m[1], arg: m[2] || "" } : null;
}

export async function onCommand(cmd, { ev, room, speaker, ctx }) {
  const t = ctx.t;
  if (cmd.name === "chup") {
    if (cmd.arg === "me" && speaker) {
      await q(
        `update ${t("vy_group")}_member set quiet_level = 'quiet' where group_id = $1 and person_id = $2`,
        [room.id, speaker],
      );
      await deliver(ctx, ev.chatKey, {
        kind: "text",
        text: "theek hai — tumhare messages pe main chup rahungi. wapas: /bolo me",
        replyTo: null,
        buttons: [],
      });
      return { ok: true, room: room.id, quiet: "member" };
    }
    await setQuiet(room.id, "quiet", t);
    await deliver(ctx, ev.chatKey, {
      kind: "text",
      text: "theek hai — ab sirf tab bolungi jab koi naam lekar bulaye. wapas: /bolo",
      replyTo: null,
      buttons: [],
    });
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
    await deliver(ctx, ev.chatKey, { kind: "text", text: "theek hai.", replyTo: null, buttons: [] });
    return { ok: true, room: room.id, quiet: "normal" };
  }
  if (cmd.name === "bhool") {
    // Forget in a room is WITHDRAW, and the receipt says so. The cascade
    // itself is api/memory.js's withdrawSharedRows — no surface ever
    // re-implements a delete, it calls the one that is gated by
    // evals/mp/withdraw.mjs.
    if (!speaker) return { ok: true, skipped: "unlinked" };
    const { withdrawSharedRows } = await import("./memory.js");
    const res = await withdrawSharedRows(speaker, { t });
    const n = (res.participant_rows || 0) + (res.room_turns || 0);
    await deliver(ctx, ev.chatKey, {
      kind: "text",
      text: withdrawReceipt(n),
      replyTo: null,
      buttons: [],
    });
    return { ok: true, room: room.id, withdrew: res };
  }
  // §2.6 — any member may re-post the transparency card.
  await deliver(ctx, ev.chatKey, { kind: "text", text: ROOM_CARD, replyTo: null, buttons: [] });
  return { ok: true, room: room.id, card: true };
}

// ─────────────────────────────────────────────────────────────────────────
// helpers
// ─────────────────────────────────────────────────────────────────────────

/**
 * vy_group_member.tg_user_id is a bigint and a Telegram artifact. Until a
 * migration replaces it with a (surface, surface_user_id) pair — WS-AGENT-
 * SCHEMA's ticket, not this workstream's file — a non-Telegram member is
 * written with a NULL there and identified through vy_surface_identity, which
 * is where it belongs anyway. Writing a Discord snowflake into a column named
 * for Telegram would be the kind of silent lie this repo has paid for before.
 */
function memberKeys(surface, personId, surfaceUserId) {
  return {
    personId,
    tgUserId: surface === "telegram" && surfaceUserId != null ? surfaceUserId : null,
  };
}

/** Build the ctx an adapter's handler hands to dispatch(). The `send` seam is
 *  what lets an offline suite drive the REAL pipeline with no network. */
export function makeCtx(adapter, deps = {}) {
  const engine = deps.engine !== undefined ? deps.engine : null;
  return {
    adapter,
    t: deps.t || ident,
    engine,
    reply: deps.reply || ((compiled, turns) => think(engine, compiled, turns)),
    send: deps.send || ((chatKey, msg) => adapter.send(chatKey, msg)),
    botHandle: deps.botHandle || "",
    linkIntent: deps.linkIntent || null,
    linkFor: deps.linkFor || null,
  };
}
