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
import { OPENROUTER_KEY } from "./_config.js";
import { MEERA_AGENT_ID } from "./_agentscope.js";
// WS-R4. The owner's "Never say this" rules, as a predicate on the assembled
// reply. `api/_never-rules.js` imports NOTHING, on purpose: this file is on
// every surface's reply path and must not gain a transitive dependency on
// storage config or a database client to enforce an owner's rule.
import { replyViolatesNeverRule } from "./_never-rules.js";
import {
  setReadConsent,
  setQuiet,
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
 * @property {*} [agent]
 *           The AgentModule that answers on this wire, or null for Meera's
 *           compile-time default. Set by `api/_clonechannel.js`'s inbound
 *           resolution — see the CLONE BINDING note below.
 * @property {string} [agentId]
 *           The uuid the same clone's rows are written under. Defaults to
 *           MEERA_AGENT_ID so every existing lane is byte-identical.
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
// THE CLONE BINDING (Gurukul WS-N) — why `agent` and `agentId` are on ctx
// ─────────────────────────────────────────────────────────────────────────
//
// Everything in this file used to answer as exactly one agent. Not by a
// setting — by a CONSTANT: `MEERA_AGENT_ID` appeared in the two writers below,
// and `compile()` took no `agent`, so it fell to the engine's default. That is
// correct for a product with one persona and it is precisely why a second
// clone on Telegram was a code change.
//
// The generalization is two fields on ctx and nothing else:
//
//   ctx.agent    the AgentModule that answers here, or null for the default
//   ctx.agentId  the uuid its rows are written under, defaulting to Meera's
//
// Both are resolved by `api/_clonechannel.js` AT THE HTTP EDGE, from
// `vy_clone_channel`, before an event reaches `dispatch()`. This file does not
// know how that resolution works and must never learn: a surface layer that
// could decide WHICH clone answers is a surface layer that has become a
// tenancy boundary, and docs/SURFACES.md §0's first sentence is that a surface
// scopes nothing.
//
// WHAT DID NOT CHANGE, and is the load-bearing half:
//
//   - `vy_surface_identity` still has no `agent_id`. Identity resolution is
//     agent-independent (§4). The agent enters at RETRIEVAL — which is what
//     `ctx.agentId` reaching the two writers below actually means.
//   - `gatedReply()` is still the ONLY call site of `ctx.reply` in this file.
//     A clone inherits every honesty family for free, and cannot opt out,
//     because there is no second door.
//   - Defaults are Meera's, so every existing lane compiles the same bytes.
//     `evals/surface.mjs` and `evals/mp/tgbot.mjs` are the proof of that, and
//     they were not edited for this change.

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
  // The SAME read every other completion caller in api/ makes (`chat.js`,
  // `memory.js`, `speech.js`, `search.js`, `culture.js`, `_embed.js`): the
  // env alias first, then the key `scripts/write-config.mjs` bakes into
  // `_config.js` under the name the self-check verifies (`OPENROUTER_KEY`,
  // `api/_self-check.js`'s REQUIRED_ENV). From 2026-09-03 to 2026-09-05
  // this door read the alias ALONE, so a deployment with the required name
  // set and the alias unset passed its own self-check while every Room,
  // Mirror Call and channel reply came back empty (WS-R96's finding,
  // `docs/gurukul/DAY-ONE.md`'s section 2).
  const key = process.env.OPENROUTER_API_KEY || OPENROUTER_KEY || "";
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
// PARSE AND GATE — the one door model text leaves by (ticket #102)
// ─────────────────────────────────────────────────────────────────────────
//
// Until this section existed, `think()` handed raw model text straight to
// `deliver()`. That meant every non-web surface shipped with NONE of the
// engine's output-path guarantees: protocol markers went out as literal text,
// em-dashes went out as the clearest "written by an AI" tell in a chat bubble,
// and — the expensive one — the honesty gate never ran, so families 1–4 and
// the presupposition detector did not exist on Telegram at all.
//
// The fix is deliberately NOT a copy of the gate. `docs/CONVERSATION-DEFECTS.md`
// closes with the rule this section implements: **a surface may choose how
// bytes reach the wire; it may never choose whether the engine's guarantees
// apply.** A second gate beside the adapter is `age-tier-never-realtime`
// waiting to happen — it misses every rule added after the fork, silently,
// while returning 200. So this calls the SAME entry point the web lane calls
// (brain.ts's `gate()`: parseBubbles → stripTextingDashes → guardReply), via
// the committed bundle, and inherits every future family for free.
//
// THE INVARIANT THAT MAKES IT A GUARANTEE RATHER THAN A HABIT: `ctx.reply` is
// called in exactly ONE place in this file — `gatedReply()` below — so there
// is no expression anywhere that produces model text without gating it. A gate
// the bytes can walk around is an absent gate (`dead-writers`, sharpened in
// brain.ts's own comment on the same point). `evals/surface.mjs` asserts the
// single call site statically, because that is the part a future edit breaks.

/**
 * The honesty gate's context for a surface turn, assembled from the same
 * material brain.ts assembles it from, in the same roles.
 *
 * `turns` is the OpenAI-shaped history the surface lanes already build, so the
 * mapping is the only surface-specific thing here and it is two lines: an
 * `assistant` turn is HERS, everything else is HIS. In a room "his" is every
 * human in it, which is correct — everything said in front of her is hers to
 * quote, and nothing else is.
 *
 * The four fields, and why each is what it is (brain.ts's own honestyCtx holds
 * the long version; this is the short one, kept here so the next person
 * editing this file does not have to guess):
 *   trustedText — provenance for family 1. Her assembled brief (which carries
 *                 CRISIS_LINES, so the helplines survive the gate) plus HIS
 *                 own words. Never her own past output: one fabrication would
 *                 otherwise launder itself into permanence.
 *   openItems   — what he said he would send and the record does not show
 *                 arriving (family 2's ledger).
 *   hisVocab    — family 3. His words only. ABSENT disables the family, which
 *                 is fail-closed in the direction of saying nothing.
 *   sharedVocab — family 4. The memory text this turn retrieved through the
 *                 disclosure predicate: a moment she was HANDED is a moment
 *                 she may retell. NOT the brief, which mentions half the world
 *                 and would make the check vacuous.
 */
/**
 * WS-R111: the material block's own lines are excluded from `trustedText`.
 * `context/rejected.md#ws-r105-no-material-instruction-boundary-in-the-compiler`
 * measured a secret-shaped string placed in a sheet field reaching the
 * delivered reply BECAUSE `trustedText` carried the whole compiled prompt —
 * a string the creator's own material contains is not thereby something the
 * gate should treat as grounded to say. This changes only the trusted SET
 * (never `honesty.ts`'s families, per this workstream's own law) and is a
 * no-op whenever the markers are absent — every Meera/Kabir compiled prompt,
 * and any bundle predating this change, strips nothing.
 */
function stripMaterialBlock(text, engine) {
  const open = engine?.MATERIAL_BLOCK_OPEN;
  const close = engine?.MATERIAL_BLOCK_CLOSE;
  if (!open || !close) return text;
  let out = text;
  let start = out.indexOf(open);
  while (start >= 0) {
    const end = out.indexOf(close, start);
    if (end < 0) break; // an unclosed marker is a malformed prompt, not a block to strip
    out = out.slice(0, start) + out.slice(end + close.length);
    start = out.indexOf(open);
  }
  return out;
}

export function honestyContextFor(engine, compiled, turns, { record = [], nameable = [] } = {}) {
  const history = (turns || []).map((m) => ({
    from: m.role === "assistant" ? "her" : "me",
    text: String(m.content ?? ""),
  }));
  const fullSystem = stripMaterialBlock(`${compiled?.core ?? ""}${compiled?.tail ?? ""}`, engine);
  return {
    trustedText: [
      fullSystem,
      ...nameable.map(String),
      ...history.filter((m) => m.from === "me").map((m) => m.text),
    ],
    openItems: engine.openCommitments(history),
    hisVocab: engine.hisVocabulary(history),
    sharedVocab: engine.sharedVocabulary([...record.map(String), ...nameable.map(String)]),
  };
}

/** Does this bundle carry the gate at all? A stale api/_engine.gen.js is the
 *  drift `scripts/build-engine-bundle.mjs --check` exists to catch, and this is
 *  what turns that drift into silence rather than into ungated bytes. */
export function hasGate(engine) {
  return Boolean(
    engine &&
      typeof engine.parseBubbles === "function" &&
      typeof engine.stripTextingDashes === "function" &&
      typeof engine.guardReply === "function" &&
      typeof engine.openCommitments === "function" &&
      typeof engine.hisVocabulary === "function" &&
      typeof engine.sharedVocabulary === "function",
  );
}

/**
 * Raw model text → the bytes a surface is allowed to put on the wire.
 *
 * FAIL CLOSED. A bundle without the gate means she says NOTHING, loudly. The
 * alternative — sending the ungated text because the gate happened to be
 * missing — is precisely the failure this ticket is about, and it would be
 * invisible: everything returns 200 and the guarantee is simply gone.
 *
 * Findings are logged as COUNTS AND RULE NAMES ONLY. The whole point of the
 * event is that the string it caught must not travel; logging it here would
 * put it in a log aggregator instead of a chat window, which is not better.
 */
export function gateReply(engine, raw, honestyCtx, label = "surface", neverRules = []) {
  const text = String(raw ?? "");
  if (!text) return { text: "", findings: [], gated: true };
  if (!hasGate(engine)) {
    console.error(
      `[${label}] engine bundle carries no honesty gate — reply SUPPRESSED. ` +
        "api/_engine.gen.js is stale; run node scripts/build-engine-bundle.mjs",
    );
    return { text: "", findings: [], gated: false, reason: "gate unavailable" };
  }
  // The same three steps, in the same order, as brain.ts's `gate()`:
  // protocol extraction first (a marker must never reach a human as text),
  // then the texting-dash predicate — text lane only, and every surface lane
  // is a text lane; the live voice lane does not come through this file — then
  // the honesty gate over the bubbles.
  const parsed = engine.parseBubbles(text);
  parsed.bubbles = (parsed.bubbles || []).map((b) => engine.stripTextingDashes(b)).filter(Boolean);
  const { reply, findings } = engine.guardReply(parsed, honestyCtx);
  if (findings.length) {
    console.warn(
      `[${label}] honesty_block n=${findings.length} ` +
        `rules=${[...new Set(findings.map((f) => f.rule))].join(",")} ` +
        `kinds=${[...new Set(findings.map((f) => f.kind).filter(Boolean))].join(",")} ` +
        `open_items=${honestyCtx.openItems.length}`,
    );
  }
  // Bubbles rejoin into ONE OutboundMessage because a surface's own render()
  // owns fragmentation (splitForLimit) — the engine does not get to decide how
  // many messages a wire wants. Newline-joined, so her burst structure
  // survives into whatever the adapter makes of it.
  const joined = (reply.bubbles || []).join("\n").trim();
  // ── WS-R4. THE OWNER'S "Never say this", AS A PREDICATE ON THE OUTPUT ────
  //
  // Last, and here rather than anywhere else, for the reason
  // docs/gurukul/safety-floor-teacher.md states with a measurement attached:
  // "prompt instructions leaked 57-98%; the SQL predicate leaked 0 of 31,122 …
  // a sentence in a brief is a preference, a predicate on the output is a
  // guarantee." A list of forbidden sentences in a persona would ALSO be a
  // phrase bank pointed at the exact strings it forbids (`recited-prompt`), so
  // the rules never go near a prompt — they are rows, read per turn, matched
  // here, on the assembled bytes.
  //
  // A match SUPPRESSES. Saying nothing is the fail-closed direction and it is
  // the same direction this function already takes when the gate is missing. The
  // rule id travels in `neverRule` so a surface can say why it went quiet; the
  // TEXT never does, for `gateReply`'s standing reason.
  const violated = joined && neverRules.length ? replyViolatesNeverRule(joined, neverRules) : "";
  if (violated) {
    console.warn(`[${label}] never_rule_block rule=${violated}`);
    return { text: "", findings, gated: true, parsed: reply, neverRule: violated };
  }
  return {
    text: joined,
    findings,
    gated: true,
    parsed: reply,
    neverRule: "",
  };
}

/**
 * THE ONLY CALL SITE OF `ctx.reply` IN THIS FILE, and the reason it is a
 * function rather than three inline pairs of lines. Every lane below asks for
 * a reply here; nothing below can obtain model text any other way. That is
 * what makes "every surface inherits the gate" a structural property instead
 * of a rule someone has to remember on the day they add the fifth surface.
 */
export async function gatedReply(ctx, compiled, turns, opts = {}) {
  const label = opts.label || ctx.adapter?.surface || "surface";
  // WS-R4. Compiled never-rules ride in on `opts` rather than being loaded
  // here, because this file has no database and must keep none: a lane that
  // knows the replica loads them (api/_review-queue.js::loadNeverRules) and
  // hands them down, and a lane that does not passes none and is unchanged.
  const neverRules = Array.isArray(opts.neverRules) ? opts.neverRules : [];
  const raw = await ctx.reply(compiled, turns);
  // The availability check comes BEFORE the context is built, and that order
  // is load-bearing rather than tidy: a bundle without the gate is also a
  // bundle without the vocabulary builders `honestyContextFor` calls, so
  // building the context first turns a refusal into a TypeError thrown out of
  // the middle of a lane — after the user's turn is logged and before hers is.
  // `evals/surface.mjs` drives exactly this, which is how the order was found.
  if (!hasGate(ctx.engine)) return gateReply(ctx.engine, raw, { trustedText: [], openItems: [] }, label, neverRules);
  return gateReply(ctx.engine, raw, honestyContextFor(ctx.engine, compiled, turns, opts), label, neverRules);
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
// THE ROOM BINDING — (surface, surface_chat_id), migration 013
// ─────────────────────────────────────────────────────────────────────────
//
// Until migration 013 a room's address was `vy_group.tg_chat_id`, a bigint
// with a unique index, and that shape carried two defects the contract had
// already refused everywhere else:
//
//   1. A NON-NUMERIC chat key could not be stored at all. `roomByChatKey()`
//      returned null for one and the room lane refused fail-closed with a
//      named reason — correct behaviour for a wrong schema, not a feature.
//      WhatsApp's `120363…@g.us` is the ordinary case, not the exotic one.
//   2. Two surfaces whose numeric ranges overlap COLLIDED on a column whose
//      name says Telegram: Discord channel 9001 and Telegram chat 9001 were
//      one room. That is exactly the collision `surfaceDeviceId(surface, key)`
//      already refuses to make for devices, re-introduced one table over.
//
// 013 adds `(surface, surface_chat_id)` / `(surface, surface_user_id)` — text,
// because a chat key is an OPAQUE ADDRESS this contract forbids parsing — and
// drops NOTHING. The transition is therefore DUAL-READ, NEW-WRITE:
//
//   READ   the new key first; on a miss, the legacy Telegram-shaped key; and
//          a row found the legacy way is ADOPTED on the way past (its new
//          columns are filled in) so the legacy read drains itself under
//          ordinary traffic. Same shape `personForSurfaceUser()` already uses
//          to drain `vy_tg_person`, for the same reason: the day the old
//          column goes is then a delete rather than a migration.
//   WRITE  the new columns, always, on every surface. `tg_chat_id` /
//          `tg_user_id` are MIRRORED for Telegram only, and only while the old
//          unique index still exists — two unique indexes that disagree about
//          which row is the room would be worse than either alone.
//
// THE RETIREMENT CONDITION, so the transition ends rather than becomes the
// architecture (docs/SURFACES.md §4 carries the same words): the legacy read,
// the mirror write and `vy_group_tg_chat_ix` go together, in one follow-up,
// once `select count(*) from vy_group where surface is null` has been 0 for
// long enough to be believed and `surface`/`surface_chat_id` have been made
// NOT NULL. Until then, removing any one of the three alone is what turns
// every existing room into "unknown room" and makes her go silent in all of
// them.
//
// WHY THESE LIVE HERE AND NOT IN api/_room.js. They are the surface layer's
// own address book: they take a `surface` and an opaque `chatKey` — two things
// api/_room.js has no opinion about — and they hold NO disclosure logic, which
// is the one thing that file exists to own. Every retrieval below this section
// still goes through api/_room.js and therefore through api/_disclosure.js;
// nothing here reads a row a person could hear.

/** The columns every lane below reads off a room. Named once so the two reads
 *  cannot drift into disagreeing about what a room is. */
const ROOM_COLS =
  "id, agent_id, name, kind, surface, surface_chat_id, tg_chat_id, room_device_id, " +
  "read_consent_at, quiet_level, member_cap, created_at";

/**
 * The legacy Telegram-shaped key for a chat key, or null when there is none.
 *
 * Two conditions, and the FIRST is the one migration 013 exists for: only
 * Telegram ever had a legacy binding, so a Discord snowflake that happens to
 * fit in a bigint must NOT be looked up in a column named for Telegram. The
 * old `chatKeyToChatId()` tested only the second condition, which is precisely
 * how channel 9001 and chat 9001 became one room.
 */
export function legacyChatId(surface, chatKey) {
  if (surface !== "telegram") return null;
  const s = String(chatKey ?? "");
  return /^-?\d{1,19}$/.test(s) ? s : null;
}

/** The same rule for a member's surface-local id. */
export const legacyUserId = (surface, surfaceUserId) =>
  surfaceUserId == null ? null : legacyChatId(surface, surfaceUserId);

/**
 * A room by its surface address. Dual-read; returns the row or null, and never
 * creates anything.
 *
 * The adoption UPDATE is `.catch()`-swallowed on purpose: it is a repair, not
 * the read. A database that refuses it must still answer "which room is this",
 * because the alternative is she goes silent in a room she can plainly see.
 */
export async function roomForChat(surface, chatKey, t = ident, agentId = MEERA_AGENT_ID) {
  const key = String(chatKey ?? "");
  if (!surface || !key) return null;
  const [row] = await q(
    `select ${ROOM_COLS} from ${t("vy_group")}
      where surface = $1 and surface_chat_id = $2 and agent_id = $3::uuid`,
    [surface, key, agentId],
  ).catch(() => []);
  if (row) return row;

  // ── the compatibility read. Every room created before 013 is here.
  const legacy = legacyChatId(surface, key);
  if (legacy === null) return null;
  const [old] = await q(
    `select ${ROOM_COLS} from ${t("vy_group")}
      where tg_chat_id = $1 and agent_id = $2::uuid`,
    [legacy, agentId],
  ).catch(() => []);
  if (!old) return null;
  // Adopt it. `and surface is null` makes this idempotent and makes it
  // impossible to re-address a room the new writer already owns.
  await q(
    `update ${t("vy_group")} set surface = $2, surface_chat_id = $3
      where id = $1 and agent_id = $4::uuid and surface is null`,
    [old.id, surface, key, agentId],
  ).catch(() => {});
  return { ...old, surface, surface_chat_id: key };
}

/**
 * The room for this chat, created if it does not exist. New-write: the new
 * columns are authoritative and are set on every surface.
 *
 * `agent_id` is named explicitly rather than left to a column default, because
 * there is no longer a default to leave it to — migration 010 dropped it on
 * all twenty agent-scoped tables so that a writer which never heard of agents
 * fails LOUDLY instead of filing another agent's memory under Meera.
 */
export async function ensureRoomForSurfaceChat(
  surface,
  chatKey,
  { name = "", kind = "friend_group", agentId = MEERA_AGENT_ID } = {},
  t = ident,
) {
  const have = await roomForChat(surface, chatKey, t, agentId);
  if (have) return have;
  const key = String(chatKey ?? "");
  if (!surface || !key) return null;
  await q(
    `insert into ${t("vy_group")}
       (agent_id, name, kind, room_device_id, surface, surface_chat_id, tg_chat_id)
     values ($1,$2,$3,$4,$5,$6,$7) on conflict do nothing`,
    [
      // The clone that owns this room, not a constant. Defaulted above to
      // MEERA_AGENT_ID so a caller that never heard of clones writes exactly
      // the rows it always wrote.
      agentId,
      String(name || "").slice(0, 120),
      kind,
      surfaceRoomDeviceId(surface, key),
      surface,
      key,
      // the mirror, Telegram only, and only while vy_group_tg_chat_ix exists
      legacyChatId(surface, key),
    ],
  );
  return await roomForChat(surface, chatKey, t, agentId);
}

/**
 * A member's row in a room, keyed (group_id, person_id) as it always was — the
 * new pair is the member's surface-local ADDRESS, not an identity key, and
 * identity stays `vy_surface_identity`'s (§4: agent- and surface-independent).
 *
 * `coalesce(excluded.…, existing)` on every updatable column: the same human
 * may reach one room from two surfaces, and the second arrival must not blank
 * the address the first one recorded. Before 013 a non-Telegram member was
 * written with a NULL `tg_user_id` and had no surface address anywhere; now
 * every member has one, on every surface.
 */
export async function upsertRoomMember(
  groupId,
  { personId, surface = null, surfaceUserId = null, agentId = MEERA_AGENT_ID },
  t = ident,
) {
  const key = surfaceUserId == null ? null : String(surfaceUserId);
  const m = `${t("vy_group")}_member`;
  await q(
    `insert into ${m}
       (agent_id, group_id, person_id, surface, surface_user_id, tg_user_id, joined_at)
     select $1::uuid, g.id, $3::uuid, $4, $5, $6, now()
       from ${t("vy_group")} g where g.id = $2 and g.agent_id = $1::uuid
     on conflict (group_id, person_id) do update set
       left_at = null,
       surface = coalesce(excluded.surface, ${m}.surface),
       surface_user_id = coalesce(excluded.surface_user_id, ${m}.surface_user_id),
       tg_user_id = coalesce(excluded.tg_user_id, ${m}.tg_user_id)`,
    [agentId, groupId, personId, surface || null, key, legacyUserId(surface, key)],
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
  const room = await ensureRoomForSurfaceChat(
    ev.surface,
    ev.chatKey,
    { name: ev.chatName || "", agentId: ctx.agentId },
    ctx.t,
  );
  if (!room) return { ok: false, error: "room not created" };

  if (status === "left" || status === "kicked") {
    // Demotion/removal is instant, total, user-controlled revocation with no
    // code path of ours involved — we only record that it happened.
    await setReadConsent(room.id, false, ctx.t, ctx.agentId);
    return { ok: true, room: room.id, consent: false, event: status };
  }
  const isAdmin = status === "admin";
  await setReadConsent(room.id, isAdmin, ctx.t, ctx.agentId);
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
  const room = await roomForChat(ev.surface, ev.chatKey, ctx.t, ctx.agentId);
  if (!room) return { ok: true, skipped: "unknown room" };
  const bits = ev.adminBits || {};
  if (!bits.subjectUserId || bits.subjectIsBot) return { ok: true, skipped: "bot or no user" };
  const bound = await personForSurfaceUser(ev.surface, bits.subjectUserId, ctx.t);
  if (!bound) return { ok: true, skipped: "unlinked member" };
  if (bits.subjectStatus === "left" || bits.subjectStatus === "kicked") {
    await markMemberLeft(room.id, bound.person_id, ctx.t, ctx.agentId);
    return { ok: true, room: room.id, left: true };
  }
  if (!(await roomHasSpaceFor(room.id, bound.person_id, ctx.t, ctx.agentId)))
    return { ok: true, room: room.id, joined: false, full: true };
  await upsertRoomMember(
    room.id,
    { personId: bound.person_id, surface: ev.surface, surfaceUserId: bits.subjectUserId, agentId: ctx.agentId },
    ctx.t,
  );
  return { ok: true, room: room.id, joined: true };
}

export async function onJoin(ev, ctx) {
  const room = await roomForChat(ev.surface, ev.chatKey, ctx.t, ctx.agentId);
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
    if (!(await roomHasSpaceFor(room.id, bound.person_id, ctx.t, ctx.agentId))) continue;
    await upsertRoomMember(
      room.id,
      { personId: bound.person_id, surface: ev.surface, surfaceUserId: u.surfaceUserId, agentId: ctx.agentId },
      ctx.t,
    );
    added++;
  }
  return { ok: true, room: room.id, added };
}

export async function onLeave(ev, ctx) {
  const room = await roomForChat(ev.surface, ev.chatKey, ctx.t, ctx.agentId);
  if (!room) return { ok: true, skipped: "unknown room" };
  const u = ev.adminBits?.left || null;
  if (!u || u.isBot) return { ok: true, skipped: "bot or no user" };
  const bound = await personForSurfaceUser(ev.surface, u.surfaceUserId, ctx.t);
  if (!bound) return { ok: true, skipped: "unlinked" };
  await markMemberLeft(room.id, bound.person_id, ctx.t, ctx.agentId);
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
  await logDmTurn({ device, person, role: "me", content: text, agentId: ctx.agentId }, ctx.t);

  // M2 — the disclosure predicate, one recipient, no room. She still has what
  // the rooms she was in hold, because she was there with them; she does not
  // have anyone else's DMs, because she was not.
  const facts = await dmRecall(person, { agentId: ctx.agentId }, ctx.t);
  const compiled = ctx.engine.compile({
    agent: ctx.agent ?? undefined,
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
  const history = await dmHistory(device, ctx.t, 30, ctx.agentId);
  // The shared record family 4 may retell FROM: the facts this turn retrieved
  // through the disclosure predicate, and nothing else. A moment she was
  // handed is a moment she may claim; one she was not is a fabrication.
  const gatedOut = await gatedReply(
    ctx,
    compiled,
    [...history, { role: "user", content: text }],
    { record: facts.map((f) => f.body), label: `${ev.surface}/dm` },
  );
  const said = gatedOut.text;
  if (said) {
    await deliver(ctx, ev.chatKey, { kind: "text", text: said, replyTo: null, buttons: [] });
    await logDmTurn({ device, person, role: "her", content: said, agentId: ctx.agentId }, ctx.t);
  }
  return {
    ok: true,
    dm: true,
    person,
    said: Boolean(said),
    recalled: facts.length,
    // Counts only, for the same reason gateReply logs counts only. A caller
    // may assert the gate ran; nobody may read what it caught.
    gate: { applied: gatedOut.gated, findings: gatedOut.findings.length },
  };
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
    if (await roomHasSpaceFor(roomRef, linked.personId, ctx.t, ctx.agentId)) {
      await upsertRoomMember(
        roomRef,
        { personId: linked.personId, surface: ev.surface, surfaceUserId: ev.surfaceUserId, agentId: ctx.agentId },
        ctx.t,
      );
      await linkMember(roomRef, linked.personId, ctx.t, ctx.agentId);
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
      agent: ctx.agent ?? undefined,
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
    // The intro is model output like any other, so it is gated like any other.
    // It has no history and no retrieved record — an introduction that claims a
    // shared past is exactly the family-4 case, and here the gate has no
    // support set at all, which is the strictest the check ever is.
    const { text } = await gatedReply(
      ctx,
      compiled,
      [{ role: "user", content: ctx.engine.ROOM_INTRO_DIRECTIVE() }],
      { label: `${ev.surface}/intro` },
    );
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
export async function logDmTurn(
  { device, person, role, content, agentId = MEERA_AGENT_ID },
  t = ident,
) {
  await q(
    `insert into ${t("meera_log")} (agent_id, device_id, role, channel, kind, content, at, speaker_person_id)
     values ($5,$1,$2,'chat','text',$3, now(), $4)`,
    [device, role === "her" ? "her" : "me", String(content || "").slice(0, 4000), person, agentId],
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
export async function dmHistory(device, t = ident, limit = 30, agentId = MEERA_AGENT_ID) {
  const rows = await q(
    `select role, content from ${t("meera_log")}
      where device_id = $1 and agent_id = $2::uuid and group_id is null
      order by id desc limit ${limit | 0}`,
    [device, agentId],
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
  const room = await roomForChat(ev.surface, ev.chatKey, ctx.t, ctx.agentId);
  if (!room) return { ok: true, skipped: "unknown room" };
  // No engine, no room behaviour AT ALL — not even the participation decision,
  // which lives in the same bundle. She stays silent and the failure is loud.
  // A degraded fallback here would be a second Meera nobody tested.
  if (!ctx.engine) {
    await recordTurnAction(
      { groupId: room.id, action: "lurk", addressed: false, reason: "engine bundle missing", agentId: ctx.agentId },
      ctx.t,
    );
    return { ok: false, room: room.id, action: "lurk", reason: "engine bundle missing" };
  }

  const bound = await resolveIdentity(ctx, ev);
  const speaker = bound?.person_id || null;
  if (speaker)
    await upsertRoomMember(
      room.id,
      { personId: speaker, surface: ev.surface, surfaceUserId: ev.surfaceUserId, agentId: ctx.agentId },
      ctx.t,
    );
  const memberRow = speaker
    ? (
        await q(
          `select quiet_level, linked_at from ${ctx.t("vy_group")}_member
            where group_id = $1 and person_id = $2 and agent_id = $3::uuid`,
          [room.id, speaker, ctx.agentId],
        ).catch(() => [])
      )[0]
    : null;

  // commands first — they are app-voiced control, never model output
  const cmd = commandOf(ev.text);
  if (cmd) return await onCommand(cmd, { ev, room, speaker, ctx });

  const recipients = await recipientSet(room.id, ctx.t, ctx.agentId);
  const ent = await roomEntitled(room, ctx.t, ctx.agentId);
  const gates = {
    readConsent: room.read_consent_at != null,
    quorum: recipients.length >= QUORUM,
    speakerLinked: Boolean(speaker) && memberRow?.linked_at != null,
    entitled: ent.entitled,
  };

  const words = gates.readConsent && gates.quorum
    ? await roomWords(room.id, recipients, ctx.t, ctx.agentId)
    : [];
  const decision = ctx.engine.decideParticipation({
    text: ev.text || ev.caption || "",
    botUsername: ctx.botHandle,
    replyToHer: Boolean(ev.replyToSelf),
    sinceHerLastMs: await sinceHerLast(room, ctx.t, ctx.agentId),
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
    const ep = await openOrExtendGroupEpisode(
      room.id,
      { roomDevice, agentId: ctx.agentId },
      ctx.t,
    );
    episodeId = ep?.id ?? null;
    if (episodeId) {
      // The participant set is the ACL. Every currently-linked, active member
      // is a participant of what is said in front of them — that is the
      // primitive, and it is why the room->room and room->DM directions need
      // no consent and no model judgement.
      for (const pid of recipients)
        await addEpisodeParticipant(episodeId, pid, "participant", ctx.t, ctx.agentId);
      if (!recipients.includes(speaker))
        await addEpisodeParticipant(episodeId, speaker, "participant", ctx.t, ctx.agentId);
    }
    logId = await logRoomTurn(
      {
        groupId: room.id,
        roomDevice,
        speakerPersonId: speaker,
        role: "me",
        content: ev.text || ev.caption || "",
        agentId: ctx.agentId,
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
      agentId: ctx.agentId,
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
    roomRecall(room.id, recipients, { agentId: ctx.agentId }, ctx.t),
    roomBridge(room.id, recipients, ctx.t, ctx.agentId),
    roster(room.id, ctx.t, ctx.agentId),
  ]);

  // ── RENDER through the REAL compiler, with the mp slots live.
  const compiled = ctx.engine.compile({
    agent: ctx.agent ?? undefined,
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

  const history = await roomHistory(room.id, ctx.t, 20, ctx.agentId);
  // In a room the shared record is what came through the predicate for THIS
  // room's recipient set, plus the bridge rows — every one of them already
  // disclosure-checked above. She may retell what she was handed here and
  // nothing beyond it, which is the same rule the 1:1 lane runs under.
  const gatedOut = await gatedReply(
    ctx,
    compiled,
    [...history, { role: "user", content: `${ev.handle}: ${ev.text || ""}` }],
    {
      record: [...facts.map((f) => f.body), ...bridge.map((b) => JSON.stringify(b))],
      label: `${ev.surface}/room`,
    },
  );
  const text = gatedOut.text;
  if (text) {
    await deliver(ctx, ev.chatKey, {
      kind: "text",
      text,
      replyTo: ev.messageId,
      buttons: [],
    });
    await logRoomTurn(
      { groupId: room.id, roomDevice, speakerPersonId: null, role: "her", content: text, agentId: ctx.agentId },
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
    gate: { applied: gatedOut.gated, findings: gatedOut.findings.length },
  };
}

/** Her own last word in THIS ROOM. `group_id = $1` pins it, so a DM row
 *  (group_id null) can never match and the cooldown can never be reset by
 *  something she said somewhere else. */
export async function sinceHerLast(room, t = ident, agentId = MEERA_AGENT_ID) {
  const r = await q(
    `select extract(epoch from (now() - max(at))) * 1000 as ms from ${t("meera_log")}
      where group_id = $1 and agent_id = $2::uuid and role = 'her'`,
    [room.id, agentId],
  ).catch(() => []);
  const ms = Number(r[0]?.ms);
  return Number.isFinite(ms) ? ms : Number.MAX_SAFE_INTEGER;
}

/** The room's live turn window, pinned to the room by `group_id = $1`. A DM
 *  turn (group_id null) can never enter a room's history — the other half of
 *  the channel guard above, in the other direction. */
export async function roomHistory(groupId, t = ident, limit = 20, agentId = MEERA_AGENT_ID) {
  const rows = await q(
    `select role, content from ${t("meera_log")}
      where group_id = $1 and agent_id = $2::uuid order by id desc limit ${limit | 0}`,
    [groupId, agentId],
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
        `update ${t("vy_group")}_member set quiet_level = 'quiet'
          where group_id = $1 and person_id = $2 and agent_id = $3::uuid`,
        [room.id, speaker, ctx.agentId],
      );
      await deliver(ctx, ev.chatKey, {
        kind: "text",
        text: "theek hai — tumhare messages pe main chup rahungi. wapas: /bolo me",
        replyTo: null,
        buttons: [],
      });
      return { ok: true, room: room.id, quiet: "member" };
    }
    await setQuiet(room.id, "quiet", t, ctx.agentId);
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
        `update ${t("vy_group")}_member set quiet_level = 'normal'
          where group_id = $1 and person_id = $2 and agent_id = $3::uuid`,
        [room.id, speaker, ctx.agentId],
      );
    } else {
      await setQuiet(room.id, "normal", t, ctx.agentId);
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
    const res = await withdrawSharedRows(speaker, { t, agentId: ctx.agentId });
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

// `memberKeys()` lived here: it existed only to decide whether a member's
// surface id could be written into `vy_group_member.tg_user_id` without
// lying, and it answered "no" for every surface but Telegram — which left
// Discord and WhatsApp members with no surface address anywhere. Migration
// 013 gave every member `(surface, surface_user_id)`, so the question is
// gone and `upsertRoomMember()` above writes the honest pair on every
// surface. The Telegram mirror it used to compute is now `legacyUserId()`,
// and it retires with the column.

/** Build the ctx an adapter's handler hands to dispatch(). The `send` seam is
 *  what lets an offline suite drive the REAL pipeline with no network.
 *
 *  `reply` is the RAW brain call and its bytes are not deliverable: everything
 *  in this file reaches it through `gatedReply()`, which parses and gates what
 *  it returns. An injected `reply` is therefore a way to drive the pipeline
 *  with a fixed model output, not a way around the gate — `evals/surface.mjs`
 *  drives exactly that path with a known family-4 violation. */
export function makeCtx(adapter, deps = {}) {
  const engine = deps.engine !== undefined ? deps.engine : null;
  return {
    adapter,
    t: deps.t || ident,
    engine,
    reply: deps.reply || ((compiled, turns) => think(engine, compiled, turns)),
    send: deps.send || ((chatKey, msg) => adapter.send(chatKey, msg)),
    botHandle: deps.botHandle || "",
    // The clone binding (see THE CLONE BINDING above). Both default to
    // Meera's, so a caller that passes neither gets today's behaviour exactly.
    agent: deps.agent ?? null,
    agentId: deps.agentId || MEERA_AGENT_ID,
    linkIntent: deps.linkIntent || null,
    linkFor: deps.linkFor || null,
  };
}
