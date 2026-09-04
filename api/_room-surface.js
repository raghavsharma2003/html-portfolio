// The Room - the follower's side of a published replica (WS-R1).
//
// A creator publishes; a follower arrives at /r/<slug> from a bio link and is
// in a conversation within one screen. Every decision lives here rather than in
// api/room.js because a decision in a handler is a decision no offline eval can
// reach - `dead-writers`, and api/clone-chat.js over api/_clonechat.js is the
// house shape this copies exactly.
//
// NAMED `_room-surface.js` and not `_room.js` because api/_room.js already
// exists and is a different thing: the MULTIPARTY room (a Telegram group chat).
// Two files called "the room" that mean two products is a merge waiting to
// happen, so the collision is avoided in the filename rather than argued about
// in a header.
//
// ── it is the widget's AUTHENTICATED, REMEMBERING SIBLING ─────────────────
//
// api/_clonechat.js is the anonymous lane: no vy_person row, no episode, no
// retrieval, transcript on the client and signed. That is correct there and it
// is the whole reason this file exists separately: a visitor on somebody else's
// website is very likely a minor and consented to nothing, while a follower
// here signed in, attested to being an adult, and answered the memory question
// in their own words. So the two lanes share every mechanism they can share and
// differ in exactly one place - whether there is a person to remember.
//
//   SHARED     the gatedReply() door, the app-voiced disclosure card bound into
//              the session token by digest, the HMAC session shape, and
//              `transcriptDigest` itself (imported, not re-implemented).
//   DIFFERENT  a real vy_person per follower; an agent-scoped relationship
//              (migration 009: the PERSON is shared across surfaces, the AGENT
//              scopes the relationship, the SURFACE scopes nothing); episodes
//              and memory through the existing DM path, so "it remembers what
//              you said three weeks ago" is true rather than aspirational.
//
// ── ONE DOOR, and this file does not own it ───────────────────────────────
//
// Every byte a follower reads leaves by `gatedReply()` in api/_surface.js.
// `surface-bypasses-parse` is the measured law: a lane that owns its own model
// call has silently become a second engine, missing every rule added after the
// fork, and the giveaway is that it returns a string rather than a parsed
// reply. There is exactly one call to `ctx.reply` reachable from here and it is
// inside `gatedReply`.
//
// ── the disclosure is BOUND, not requested ────────────────────────────────
//
// `structural-disclosure` measured this repo's own numbers: a prompt
// instruction leaked 57.1% naturalistic / 98.1% adversarial against ZERO for
// the SQL predicate. So the card is not a sentence in a brief and not a thing
// the page is asked to render. `openRoom` computes it, hashes it, and mints a
// token carrying the digest; every later op recomputes the card for the room
// that is answering NOW and REFUSES a token whose digest does not match. A page
// that stripped the card cannot buy a turn, and a room whose creator renamed
// themselves cannot keep answering under a card the follower never saw.
//
// ── the free cap is a PREDICATE, never a counter ──────────────────────────
//
// Twenty messages a month on the free tier, enforced by ONE conditional UPDATE
// that rolls the month over and increments in the same statement. A client
// counter is a number the client owns; a SELECT-then-UPDATE lets two tabs both
// read 19 and both write 20. `gate0-structural` is the standing distinction: a
// sentence in a brief is a preference, a predicate on the write is a guarantee.
//
// ── the upgrade prompt is a STATE, not an interruption ────────────────────
//
// `proactive-reason-contingent` and NEVER MANIPULATE both point the same way:
// nothing here blocks a reply mid-turn to sell anything. The cap refusal is the
// ONE place a turn does not happen, and it happens at the door with a named
// code, before any model call. Everything else about money is a FLAG on a
// successful turn (`upgrade_prompt`), which the client renders at the END of a
// session that worked.
import { createHmac, timingSafeEqual, createHash, randomUUID } from "node:crypto";
import {
  gatedReply,
  makeCtx,
  splitForLimit,
  loadEngine,
  think,
  deliver,
  logDmTurn,
  dmHistory,
} from "./_surface.js";
import { transcriptDigest } from "./_clonechat.js";
import { loadTeacherAgent } from "./_teachersheet.js";
import { surfaceDeviceId, dmRecall } from "./_room.js";
import { openOrExtendEpisode } from "./episodes.js";
import {
  activePersonTables, keysOf, ownerEq, wipeWhereSql, wipeParams, tableApplied,
  roomForgetReceiptHash, ROOM_FORGET_RECEIPT_POLICY_VERSION,
} from "./memory.js";
import { authorizeRoomVoice, estimateClipSeconds } from "./_room-voice.js";
import { sessionWorked, recordOffer, markOfferOutcome } from "./_phase-gate.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A reply bubble's ceiling on this wire. A product number, not a platform
 *  one: long enough for a worked answer, short enough that a wall of text is a
 *  bug rather than a style. Same value the widget uses, deliberately - two
 *  surfaces of one product that fragment differently read as two products. */
export const ROOM_TEXT_LIMIT = 4000;
/** What a follower may send in one turn. */
export const ROOM_INBOUND_LIMIT = 2000;
/** How much of an unremembered session rides on a request. Only reachable when
 *  the follower declined memory: with consent the history is the SERVER's. */
export const ROOM_HISTORY_TURNS = 30;
/** How much remembered history is compiled into a turn. `dmHistory`'s window,
 *  because this IS a DM in every respect but the address it arrived at. */
export const ROOM_RECALL_TURNS = 30;
/** A session is short. Not the security boundary (the digests are), but a
 *  token minted on a tab that has been open since last Tuesday should not
 *  still buy turns. */
export const ROOM_SESSION_TTL_MS = 12 * 60 * 60 * 1000;
/** The free allowance, as the DEFAULT for a new room. The live number is
 *  `vy_room.free_monthly_messages` and the predicate reads the column, never
 *  this constant - a cap that lives in a deployed constant moves by deploy. */
export const ROOM_FREE_MONTHLY_MESSAGES = 20;
/** The paid allowance, as the DEFAULT for a new room — WS-R19. Same law as
 *  the free constant above: the live number is `vy_room.paid_monthly_messages`
 *  and the predicate reads the column, this is a fixture/fallback only. */
export const ROOM_PAID_MONTHLY_MESSAGES = 500;
/** The paid voice minutes allowance in SECONDS, as the DEFAULT for a new
 *  room. The live number is `vy_room.paid_monthly_voice_seconds`. */
export const ROOM_PAID_MONTHLY_VOICE_SECONDS = 1800;
/** How many of the creator's own material names a citation answer may name. */
export const ROOM_CITATION_SOURCES = 4;
/** The consent ledger `kind` values this surface writes. New VALUES rather
 *  than a new table, which is migration 016's own instruction: one ledger
 *  answers "what has this person agreed to". They are distinct from Meera's
 *  `memory` because the WORDS of the ask are different, and 016's `version`
 *  column means "which ask this answers" - reusing a kind across two different
 *  asks would file an answer under words the person never read. */
export const ROOM_CONSENT_MEMORY = "room_memory";
export const ROOM_CONSENT_AGE = "room_age";
export const ROOM_CONSENT_VERSION = 1;

/** WS-R24, migration 087. v1: English and Hindi (Devanagari). Adding a third
 *  locale means widening this array, `vy_room_follower`/`vy_room`'s CHECK
 *  constraints, and every locale-keyed table this file and `src/room/copy.ts`
 *  hold - `evals/room-locale/run.mjs` fails loudly on a mismatch rather than
 *  silently falling one of them back to English. */
export const ROOM_LOCALES = ["en", "hi"];

/** Anything that is not exactly "hi" or a "hi-*" variant reads as "en" - a
 *  browser's `navigator.language`, a Telegram `language_code`, an absent
 *  value or garbage all fall back to the locale this product already ships,
 *  never to a thrown error on someone's very first request. The client copy
 *  of this function (`src/room/copy.ts`) must stay byte-identical in
 *  behaviour; `evals/room-locale/run.mjs` asserts both agree on a fixed input
 *  set rather than trusting the comment. */
export function normalizeLocale(input) {
  const s = String(input || "").trim().toLowerCase();
  return s === "hi" || s.startsWith("hi-") ? "hi" : "en";
}

export class RoomError extends Error {
  constructor(code, status = 400, details) {
    super(code);
    this.code = code;
    this.status = status;
    if (details) this.details = details;
  }
}

/** THE indistinguishable one. api/_clonechannel.js's rule, and it binds here
 *  for the same reason one product wider: unbound, unpublished, paused, and
 *  consent-withdrawn are four situations and exactly one error, because a
 *  caller that could tell them apart could enumerate which creators had taken
 *  their Room down, and that is the creator's business. */
export const roomUnavailable = () => new RoomError("room_unavailable", 404);

/** The signing key. UNSET MEANS THE ROOM IS OFF, everywhere, immediately, and
 *  that is the correct posture rather than an inconvenience: without it the
 *  disclosure binding and the person binding are both forgeable by anyone,
 *  which is to say the lane has no guarantees left to offer. */
function sessionSecret(env = process.env) {
  const secret = String(env.ROOM_SESSION_SECRET || "");
  if (secret.length < 32) throw new RoomError("room_unconfigured", 503);
  return secret;
}

const b64url = (buf) => Buffer.from(buf).toString("base64url");
const sha = (s) => createHash("sha256").update(String(s)).digest("base64url").slice(0, 32);

/** Constant-time over equal-length digests; `timingSafeEqual` throws on a
 *  length mismatch, so both sides are hashed to a fixed width first. The shape
 *  api/tg.js's `secretOk` and api/_clonechat.js both use. */
function sameSignature(a, b) {
  const ha = createHash("sha256").update(String(a)).digest();
  const hb = createHash("sha256").update(String(b)).digest();
  return timingSafeEqual(ha, hb);
}

export function mintRoomSession(payload, env = process.env) {
  const body = b64url(JSON.stringify(payload));
  const sig = createHmac("sha256", sessionSecret(env)).update(body).digest("base64url");
  return `r1.${body}.${sig}`;
}

export function readRoomSession(token, env = process.env) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3 || parts[0] !== "r1") throw new RoomError("room_session_invalid", 401);
  const expected = createHmac("sha256", sessionSecret(env)).update(parts[1]).digest("base64url");
  if (!sameSignature(parts[2], expected)) throw new RoomError("room_session_invalid", 401);
  let payload;
  try {
    payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    throw new RoomError("room_session_invalid", 401);
  }
  if (!payload || typeof payload !== "object") throw new RoomError("room_session_invalid", 401);
  return payload;
}

/**
 * THE ONE STALENESS CHECK, so every op enforces the SAME 12-hour ceiling
 * rather than each op's own copy of the same three-line `if`.
 *
 * WS-R38 (the door battery): `roomSay`/`roomSpeak`/`roomSetLocale` and
 * `_payments.js`'s `paidSessionScope` each carried this inline, correctly,
 * while `selfScope` (export/forget/offer_dismiss), `followerHistory`,
 * `roomCitations`, and every OTHER `followerScope` in this product
 * (`_handoff.js`, `_checkins.js`, `_room-push.js`, `_room-whatsapp.js`) did
 * not call it at all — a signed session more than twelve hours old (a tab
 * left open, a device that changed hands, a token that leaked) went on
 * buying reads and writes on those doors forever, including the two ops
 * this file's OWN header names as the highest-consequence ones a stolen
 * session can reach ("a stolen one downloading their whole history or
 * deleting it is a harm the next turn does not undo"). Exported and called
 * from every scope resolver in this product now, so a future op can only
 * get this right by construction rather than by remembering to copy it.
 *
 * A FUTURE-DATED `iat` is NOT bounded here, and `evals/room-doors/run.mjs`
 * says so rather than silently matching only the cases that were easy: this
 * check only ever bounds `now - iat` from ABOVE. A token whose own `iat`
 * claims to be from the future has a NEGATIVE age, which is never greater
 * than the ceiling, so it does not expire by this check until `now` catches
 * up to that future instant. WS-R38 tried adding a symmetric lower bound and
 * reverted it (`rejected.md#ws-r38-session-clock-skew-lower-bound`): no
 * request field ever reaches the `now` a session is MINTED with (every mint
 * call is `deps.now ?? Date.now()`, a real server clock, never a client
 * value), so a future `iat` is not a live external hole — and the fix broke
 * a convention this test suite uses repo-wide, minting a session against the
 * real wall clock while driving a scenario's own business-math `deps.now`
 * against a fixed calendar date unrelated to it, which is now negative
 * relative to a real `iat` and would need auditing across every suite that
 * does it, not just the one this fix happened to touch first.
 */
export function assertSessionFresh(payload, now = Date.now()) {
  if (!Number.isFinite(payload?.iat) || now - payload.iat > ROOM_SESSION_TTL_MS) {
    throw new RoomError("room_session_expired", 401);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// THE APP-VOICED DISCLOSURE CARD
// ─────────────────────────────────────────────────────────────────────────
//
// THIS TEXT IS NOT PROMPT TEXT AND NEVER REACHES THE MODEL. It is sent by the
// app, deterministically, in the app's voice - `api/_surface.js`'s ROOM_CARD
// rail and `clock.ts`'s law before it: the card speaks as the APP, never as the
// AI, because instruction is not emission and that gap is measured.
//
// It is NOT `cloneDisclosureCard` from api/_clonechannel.js, and the difference
// is one word that this product may not say. That card reads "an AI clone of
// <name>"; the standing copy rule for every string added after 2026-09-02 is
// that a follower never reads the word "clone" (they read "<Name> AI"), so
// reusing those bytes here would ship the banned word on the most-read screen
// in the product. The widget's card is NOT edited to match: it is live, it is
// what a teacher approved in DisclosurePreview, and a consent artifact whose
// words moved under it is exactly the failure safety-floor-teacher.md §2.1
// names. Two surfaces, two cards, one rule, and this comment is the record of
// why they differ rather than a drift nobody noticed.
//
// Three sentences and each is checkable against this repo:
//   1. never-deny-AI, stated first and stated plainly.
//   2. the creator built it and published it, and does not read this.
//   3. no other follower ever sees any of it (the private scope, which is
//      `dmRecall`'s one-recipient disclosure predicate, not a promise).
/** WS-R24: `locale` picks the WORDS, never the FACTS. Both languages state the
 *  identical three things in the identical order (never-deny-AI first), and
 *  `evals/room-locale/run.mjs` checks both against the same three fact
 *  predicates rather than trusting a translation to have kept them - a
 *  disclosure that reads differently in two languages is the exact failure
 *  the whole card exists to prevent, in a second language. */
export function roomDisclosureCard(creatorName, locale = "en") {
  const name = String(creatorName || "").trim() || "this creator";
  if (normalizeLocale(locale) === "hi") {
    return [
      `आप ${name} AI से बात कर रहे हैं। यह ${name} नहीं है।`,
      `${name} ने इसे अपनी सामग्री से बनाया और यहां प्रकाशित किया। ${name} यह बातचीत नहीं पढ़ते।`,
      `आप जो कहते हैं वह सिर्फ आपकी अपनी थ्रेड में रहता है। ${name} AI से बात करने वाला कोई और इसमें से कुछ भी नहीं देख सकता।`,
    ].join("\n");
  }
  return [
    `You are talking with ${name} AI. It is not ${name}.`,
    `${name} built it from their own material and published it here. ${name} does not read these conversations.`,
    `What you say stays in your own thread. Nobody else who talks to ${name} AI can see any of it.`,
  ].join("\n");
}

/** The name the card carries. Taken from the SHEET, never from the room row or
 *  the agent's display name: `sheet.name` is the field the consent artifact
 *  must byte-match (safety-floor-teacher.md §2.1 - "a clone published under a
 *  name the artifact does not cover is impersonation"), so it is the only name
 *  the card may name. The room's own `display_name` is a label a creator picked
 *  for a heading and is never substituted for this. */
export const roomNameFor = (sheet) => String(sheet?.name || "").trim();

/**
 * Mint a session for an ALREADY-RESOLVED room and an ALREADY-KNOWN person -
 * `openRoom`/`joinRoom`'s own inline construction, factored out for WS-R18.
 *
 * A Telegram reply has no browser tab to hold a session between turns, so
 * `api/_room-telegram.js` mints one fresh on every message rather than
 * persisting one. The disclosure digest inside it (`sha(disclosure)`) MUST be
 * computed with the exact function `roomSay` checks it against - a
 * Telegram-side re-derivation of that hash would be a second copy a future
 * edit to `roomDisclosureCard` could silently stop agreeing with, which is
 * exactly the failure `roomSay`'s own "the disclosure predicate is
 * RE-COMPUTED, never trusted" discipline exists to prevent.
 */
export function mintFollowerSession(resolved, personId, { now = Date.now(), env, locale = "en" } = {}) {
  const disclosure = roomDisclosureCard(roomNameFor(resolved.sheet), locale);
  return mintRoomSession(
    {
      r: resolved.room.slug,
      i: String(resolved.room.room_id),
      p: String(personId),
      a: String(resolved.agentId),
      dd: sha(disclosure),
      // WS-R24: the locale this card was minted in. roomSay/roomSpeak
      // re-derive the disclosure against THIS, never the follower row's
      // current value - a self-describing token, `dd`'s own discipline
      // extended: it names what it was minted against, not what is true now.
      loc: locale,
      td: transcriptDigest([]),
      iat: now,
      n: 0,
    },
    env,
  );
}

// ─────────────────────────────────────────────────────────────────────────
// RESOLUTION
// ─────────────────────────────────────────────────────────────────────────

const slugOf = (value) => {
  const s = String(value || "").trim().toLowerCase();
  return /^[a-z0-9][a-z0-9-]{0,62}$/.test(s) ? s : "";
};

/**
 * slug -> the published, unpaused room row.
 *
 * BOTH gate clauses are IN THE PREDICATE, not applied after. api/_disclosure.js
 * states the discipline and it transfers verbatim: a disqualified row that
 * reaches JS can still be logged, partially rendered, or escape through a
 * branch added later, and here the disqualified row is a Room a creator PAUSED.
 * The branch added later is whoever decides a paused Room should send a
 * friendly "I am away" message in the creator's voice.
 */
export async function roomBySlug(db, slug) {
  if (typeof db !== "function") throw new RoomError("room_db_required", 500);
  const s = slugOf(slug);
  if (!s) return null;
  const rows = await db(
    `select r.room_id, r.slug, r.replica_id, r.agent_id, r.owner_user_id,
            r.display_name, r.free_monthly_messages, r.paid_monthly_messages,
            r.paid_monthly_voice_seconds, r.handoff_enabled, r.handoff_monthly_cap,
            r.default_locale, r.published_at, a.slug as agent_slug
       from vy_room r
       join vy_agent a on a.agent_id = r.agent_id
      where lower(r.slug) = $1
        and r.published_at is not null
        and r.paused_at is null
      limit 1`,
    [s],
  );
  return rows[0] || null;
}

/**
 * The whole inbound resolution: address -> room -> the PUBLISHED agent module.
 *
 * `loadAgent` is injectable so an offline suite drives the REAL resolution
 * without a database behind api/_teachersheet.js - the same seam
 * api/_clonechannel.js's `resolveInboundClone` uses, for the same reason.
 *
 * There is NO FALLBACK AGENT here and there must never be one. The loader
 * throws four different codes and every one of them means "this AI may not
 * speak", so they are flattened into `room_unavailable` rather than
 * distinguished. A wrong-agent fallback is the disaster case for this product,
 * and it would return 200 the whole way down.
 */
export async function resolveRoom(db, slug, { loadAgent = loadTeacherAgent } = {}) {
  const room = await roomBySlug(db, slug);
  if (!room) throw roomUnavailable();
  let loaded;
  try {
    loaded = await loadAgent(room.agent_slug);
  } catch {
    // Deliberately swallowed and replaced: the loader's `details` carry a
    // sheet id and a blocker list, which is exactly what a creator's studio
    // needs and exactly what a follower's browser must never learn.
    throw roomUnavailable();
  }
  if (!loaded?.module) throw roomUnavailable();
  return { room, module: loaded.module, sheet: loaded.sheet, agentId: room.agent_id };
}

// ─────────────────────────────────────────────────────────────────────────
// IDENTITY - the follower's person, and their per-thread devices
// ─────────────────────────────────────────────────────────────────────────
//
// AGENT-INDEPENDENT, per SPEC-AGENT-LAYER §4 and migration 009: the same human
// is the same vy_person in this Room, in another creator's Room, and on
// Telegram. The agent enters at RETRIEVAL. Nothing below writes an agent id
// into an identity table and nothing ever may.

/**
 * The auth identity -> person bridge, minting the person on first arrival.
 *
 * `vy_account_person` is the ONE server-written bridge between a Supabase auth
 * id and this schema's person layer (015's own header), and this is
 * `createSelfReplica`'s pattern with the replica half removed. The advisory
 * lock is what makes two simultaneous first requests from one follower produce
 * ONE person rather than two, which matters more here than there: two person
 * rows for one human is a follower whose memory silently splits in half.
 */
export async function personForAccount(db, authUserId) {
  const uid = String(authUserId || "").toLowerCase();
  if (!UUID.test(uid)) throw new RoomError("room_identity_invalid", 400);
  const rows = await db(
    `with owner_lock as (
       select pg_advisory_xact_lock(hashtextextended($1::text, 0))
     ), existing_person as (
       select ap.person_id from vy_account_person ap, owner_lock
        where ap.auth_user_id = ($1)::uuid
     ), created_person as (
       insert into vy_person (age_tier)
       select 'unverified' from owner_lock
        where not exists (select 1 from existing_person)
       returning person_id
     ), any_person as (
       select person_id from existing_person
       union all
       select person_id from created_person
       limit 1
     ), bridge as (
       insert into vy_account_person (auth_user_id, person_id)
       select ($1)::uuid, person_id from any_person
       on conflict (auth_user_id) do update set auth_user_id = excluded.auth_user_id
       returning person_id
     ) select person_id from bridge`,
    [uid],
  );
  const personId = rows[0]?.person_id;
  if (!personId) throw new RoomError("room_identity_unavailable", 503);
  return String(personId);
}

/**
 * The synthetic device a thread's turns are logged under - uuid v5 over a
 * surface-qualified key, api/_room.js's own generator, imported rather than
 * re-derived.
 *
 * THIS IS WHY THREADS NEEDED NO NEW COLUMN ON meera_log. A thread is a
 * partition of one follower's own turns, and `meera_log.device_id` already
 * partitions turns exactly that way - it is what separates a person's Telegram
 * DM from their web DM today. Adding a `thread_id` column to a legacy table
 * that five other lanes write would be a schema change for a partition the
 * schema already has. The default thread ('main') is what a follower who never
 * names anything talks in.
 *
 * Every one of these devices is registered in `vy_person_device`, which is what
 * makes a whole wipe reach them: `personDeviceSet` resolves every device a
 * human owns and the legacy lane deletes over the array.
 */
export const roomThreadDevice = (roomId, personId, threadId) =>
  surfaceDeviceId("web", `room:${roomId}:${personId}:${threadId || "main"}`);

// ─────────────────────────────────────────────────────────────────────────
// THE FOLLOWER ROW
// ─────────────────────────────────────────────────────────────────────────

/** The follower's own membership, scoped by all three of room, person and
 *  agent. The agent binding is redundant with the room binding today and it is
 *  in the predicate anyway, api/_agentscope.js's rule: an absent agent yields
 *  NULL and therefore no rows, never everyone's. */
export async function followerRow(db, roomId, personId, agentId) {
  const rows = await db(
    `select f.follower_id, f.room_id, f.person_id, f.agent_id, f.joined_at,
            f.age_attested_at, f.memory_consent_at, f.tier,
            f.month_key, f.month_message_count, f.voice_seconds_month, f.voice_month_key, f.last_seen_at,
            f.locale
       from vy_room_follower f
      where f.room_id = ($1)::uuid
        and f.person_id = ($2)::uuid
        and f.agent_id = ($3)::uuid
      limit 1`,
    [String(roomId), String(personId), String(agentId)],
  );
  return rows[0] || null;
}

/** 'YYYY-MM' in UTC. The month key is computed in ONE place and passed as a
 *  parameter rather than derived in SQL, so the cap eval can drive a month
 *  rollover without waiting a month for one. */
export const monthKeyOf = (at = Date.now()) => new Date(at).toISOString().slice(0, 7);

/** 'YYYY-MM-DD' in UTC. WS-R12's day key, computed in JS for `dayKeyOf`'s own
 *  reason as `monthKeyOf`: one place, passed as a parameter, so an eval can
 *  drive a day rollover without waiting a day for one. */
export const dayKeyOf = (at = Date.now()) => new Date(at).toISOString().slice(0, 10);

/** The client shape of a follower's own state. Counts and flags, never another
 *  follower's anything, and never the creator's consent state. */
export function clientFollower(row, room, at = Date.now()) {
  if (!row) return null;
  const paid = row.tier === "paid";
  // WS-R19: the paid tier's own ceiling, same shape as the free one, never a
  // deployed constant — the live number is `vy_room.paid_monthly_messages`.
  const cap = paid
    ? Number(room?.paid_monthly_messages ?? ROOM_PAID_MONTHLY_MESSAGES)
    : Number(room?.free_monthly_messages ?? ROOM_FREE_MONTHLY_MESSAGES);
  const key = monthKeyOf(at);
  const used = row.month_key === key ? Number(row.month_message_count || 0) : 0;
  // The voice ceiling exists for every follower (so a free follower's panel
  // can render "voice is a paid feature" against a real number rather than a
  // blank), but only a paid follower's SPEND is ever real — a free follower's
  // `voice_seconds_month` column is always 0, by construction (`roomSpeak`
  // refuses a free follower before it is ever read for a write).
  const voiceCap = Number(room?.paid_monthly_voice_seconds ?? ROOM_PAID_MONTHLY_VOICE_SECONDS);
  // `voice_month_key`, NOT `month_key` — a follower's own separate rollover
  // key for the voice meter (migration 081's own header explains why sharing
  // `month_key` with the message counter is a real defect: whichever of
  // `roomSay`/`roomSpeak` runs first in a new month would claim the rollover
  // for itself and strand the other counter unreset).
  const voiceUsed = row.voice_month_key === key ? Number(row.voice_seconds_month || 0) : 0;
  return {
    joined_at: row.joined_at ?? null,
    tier: paid ? "paid" : "free",
    remembers: row.memory_consent_at != null,
    messages_used: used,
    messages_included: cap,
    messages_left: Math.max(0, cap - used),
    voice_seconds_used: paid ? voiceUsed : 0,
    voice_seconds_included: paid ? voiceCap : 0,
    voice_seconds_left: paid ? Math.max(0, voiceCap - voiceUsed) : 0,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// THE TELEGRAM CHANNEL POINTER (WS-R18, migration 082)
// ─────────────────────────────────────────────────────────────────────────
//
// ONE bot serves every creator's Room (`ROOM_TELEGRAM_BOT_TOKEN`, unlike
// Meera's per-clone `vy_clone_channel.credentials_ref`), so a single Telegram
// chat can mean different Rooms at different times - creator A's slug today,
// creator B's next month. An ordinary text message carries no room reference
// at all, so "which Room is THIS message for" needs the one fact this schema
// otherwise has no place to keep: which Room this chat's deep link most
// recently pointed at. `db/migrations/082_room_telegram_channel.sql` carries
// the full argument; these two functions are its only reader and writer, kept
// here (not in `api/_room-telegram.js`) so the raw table name lives in the
// ONE file `evals/room-leak/run.mjs`'s repo-wide scan already allowlists for
// it - see that suite's own header on why "the file that also holds a writer"
// is not the same question as "does the follower lane leak".
//
// A POINTER, not a subscription list. `on conflict (channel, channel_ref)`
// REPLACES the row rather than adding a second one, so a chat has at most one
// current Room, ever - re-`/start`ing a different slug in the same chat is a
// deliberate switch, never an accumulation.

/** Point one Telegram chat at one Room membership. Idempotent, and a second
 *  call for the same chat with a DIFFERENT room switches the pointer rather
 *  than erroring - the ordinary shape of "I `/start`ed a different creator's
 *  Room in this same chat". */
export async function bindTelegramChannel(db, { roomId, personId, followerId, channelRef }, deps = {}) {
  const id = deps.newId ? deps.newId() : randomUUID();
  await db(
    `insert into vy_room_follower_channel
       (channel_map_id, room_id, person_id, follower_id, channel, channel_ref)
     values (($1)::uuid, ($2)::uuid, ($3)::uuid, ($4)::uuid, 'telegram', $5)
     on conflict (channel, channel_ref) do update
        set room_id = excluded.room_id,
            person_id = excluded.person_id,
            follower_id = excluded.follower_id,
            updated_at = now()`,
    [id, String(roomId), String(personId), String(followerId), String(channelRef)],
  );
}

/** The slug this Telegram chat currently means, or null for a chat that has
 *  never completed a join. The join to `vy_room` (rather than returning a bare
 *  room_id) is what lets `api/_room-telegram.js` hand the result straight to
 *  `resolveRoom`, which is the ONLY function in this file allowed to decide
 *  whether a Room may answer. */
export async function telegramChannelRoom(db, channelRef) {
  const rows = await db(
    `select r.slug
       from vy_room_follower_channel c
       join vy_room r on r.room_id = c.room_id
      where c.channel = 'telegram' and c.channel_ref = $1
      limit 1`,
    [String(channelRef)],
  );
  return rows[0]?.slug ? String(rows[0].slug) : null;
}

/** `/stop` - LEAVES, no deletion. Removes only the pointer, so an ordinary
 *  message afterward reads as "not joined" (the same app-voiced card a chat
 *  that never joined gets) until the follower `/start`s again, while their
 *  membership, memory and consent ledger stay exactly as they were. */
export async function unbindTelegramChannel(db, channelRef) {
  await db(`delete from vy_room_follower_channel where channel = 'telegram' and channel_ref = $1`, [
    String(channelRef),
  ]);
}

// ─────────────────────────────────────────────────────────────────────────
// CHECK-INS ON TELEGRAM (WS-R34, migration 096) - the channel pointer above
// IS the opt-in. Every function here is scoped by `follower_id`, never by
// `channel_ref`: the sweep already has a due row's own `follower_id` (the
// due-select's own join, api/_checkins.js), and so does the Telegram bot's
// command handler (`resolveActiveFollower`'s own follower row) - re-deriving
// a channel_ref-scoped lookup a second time would be a second definition of
// "this follower's Telegram pointer" next to the one that already exists.
// ─────────────────────────────────────────────────────────────────────────

/** The sweep's own read (api/_checkins.js's `deliverers.telegram`) - a SQL
 *  predicate, not a JS filter after a broader select, `activeWhatsappFollower`'s
 *  own shape (api/_room-whatsapp.js) restated for this table: a pointer with
 *  `checkins_enabled = false` (the follower's own choice) or a non-null
 *  `stopped_code` (a prior 403/400) is structurally never returned, so there
 *  is no code path - correct or buggy - between "no eligible pointer" and a
 *  network call to Telegram. */
export async function activeTelegramChannelFor(db, followerId) {
  const rows = await db(
    `select channel_ref from vy_room_follower_channel
      where follower_id = ($1)::uuid and channel = 'telegram'
        and checkins_enabled = true and stopped_code is null
      limit 1`,
    [String(followerId)],
  );
  return rows[0] || null;
}

/** Revoke on failure (workstream law #3) - a 403 (bot blocked) or a 400
 *  naming a dead chat marks the pointer stopped, `markFollowerWhatsappFailed`'s
 *  own shape (api/_room-whatsapp.js) one channel over. This does NOT unbind
 *  the pointer (`unbindTelegramChannel` above is the follower's own `/stop`,
 *  a different act) - it only stops further CHECK-IN sends until the
 *  follower's own `/checkins on` or the Room panel's own toggle clears it. */
export async function markTelegramChannelStopped(db, followerId, code) {
  await db(
    `update vy_room_follower_channel
        set stopped_code = $2, updated_at = now()
      where follower_id = ($1)::uuid and channel = 'telegram'`,
    [String(followerId), String(code || "").slice(0, 120)],
  );
}

/** The follower's own read - the Room panel's "already on" state and the
 *  `/checkins` bot command's own status line, `subscriptionStatus`'s shape
 *  (api/_room-push.js) restated: `connected` is false (no query result at
 *  all is impossible to distinguish from "never joined via Telegram" and
 *  that is intentional - there is nothing to toggle when there is no
 *  pointer) when this follower has never bound a Telegram chat to this Room. */
export async function telegramCheckinsStatusFor(db, followerId) {
  const rows = await db(
    `select checkins_enabled, stopped_code from vy_room_follower_channel
      where follower_id = ($1)::uuid and channel = 'telegram'
      limit 1`,
    [String(followerId)],
  );
  const row = rows[0];
  if (!row) return { connected: false, checkins_enabled: false, stopped: false };
  return {
    connected: true,
    checkins_enabled: row.checkins_enabled === true,
    stopped: row.stopped_code != null,
  };
}

/** The follower's own toggle - `/checkins on|off` (api/_room-telegram.js) AND
 *  the Room panel's control (api/_checkins.js's `telegramCheckinsStatus`/
 *  `setTelegramCheckins`) both call this, scoped by the SAME `follower_id`
 *  each caller already resolved off its own session or its own follower row
 *  - never a second definition of "this follower". Turning ON also clears a
 *  prior `stopped_code`: a follower issuing this command or tapping this
 *  control is, by construction, currently able to reach the bot (they are
 *  either mid-conversation with it or authenticated into the Room), so a
 *  stale "the bot was blocked" code from before is no longer the truth -
 *  `optIn`'s own "re-subscribing clears the failure code"
 *  (api/_room-whatsapp.js) restated for a boolean instead of a phone number.
 *  No row to update (never joined via Telegram) is silently a no-op, never a
 *  thrown error - there is nothing for either caller to do about a pointer
 *  that does not exist. */
export async function setTelegramCheckinsEnabledForFollower(db, followerId, enabled) {
  const rows = await db(
    `update vy_room_follower_channel
        set checkins_enabled = ($2)::bool,
            stopped_code = case when ($2)::bool then null else stopped_code end,
            updated_at = now()
      where follower_id = ($1)::uuid and channel = 'telegram'
      returning checkins_enabled`,
    [String(followerId), Boolean(enabled)],
  );
  return rows[0] || null;
}

// ─────────────────────────────────────────────────────────────────────────
// OP: open
// ─────────────────────────────────────────────────────────────────────────

/**
 * Resolve the address and hand back the card.
 *
 * `authUserId` is OPTIONAL and that is the product shape rather than a
 * convenience: a follower arriving from a bio link is not signed in, and the
 * first screen they see must be the room and its disclosure, not a login wall.
 * Signed out they get the card and `joined:false`; signed in they get a session
 * bound to their person and, if they have joined, their own quota state.
 *
 * A session is minted ONLY for a follower who has completed the join. Without
 * one there is nothing to bind: no attestation, no answer to the memory
 * question, and therefore nothing this lane is allowed to do.
 *
 * `personId` is WS-R18's own bypass, and it is the identity BRIDGE that
 * changes, never the SQL below it. A Telegram follower has no Supabase bearer
 * token to hand `personForAccount`, and `docs/SURFACES.md` §0 forbids a second
 * identity system rather than a second door here - `api/_room-telegram.js`
 * resolves a person through `vy_surface_identity`
 * (`personForSurfaceUser`/`linkSurfacePerson`, the exact bridge api/tg.js
 * already uses for Meera) and hands the uuid straight in. `authUserId` still
 * wins if both are somehow present, which is what makes this additive: every
 * existing caller passes only `authUserId`, so its behaviour is unchanged byte
 * for byte.
 *
 * `locale` (WS-R24) is a HINT and only ever a fallback: a follower who has
 * already joined gets back their OWN stored `vy_room_follower.locale`
 * regardless of what this argument says - the hint exists for the screen
 * shown BEFORE a follower row exists at all, where the browser's own language
 * is the only signal there is. Behind that, the creator's own
 * `vy_room.default_locale` (never a hardcoded "en") is what a browser that
 * reports nothing at all falls back to.
 */
export async function openRoom(
  db,
  { slug, authUserId = null, personId: givenPersonId = null, locale: hintLocale = null },
  deps = {},
) {
  const resolved = await resolveRoom(db, slug, deps);
  const name = roomNameFor(resolved.sheet);
  const now = deps.now ?? Date.now();
  const personId = authUserId
    ? await personForAccount(db, authUserId)
    : givenPersonId
      ? String(givenPersonId)
      : null;
  const follower = personId
    ? await followerRow(db, resolved.room.room_id, personId, resolved.agentId)
    : null;
  // An attestation that never happened is not a join, whatever else the row
  // says. Fail toward "ask again" rather than toward "already answered".
  const joined = !!follower && follower.age_attested_at != null;
  // THE ONE PLACE THIS DECISION IS MADE. A joined follower's OWN stored
  // locale wins over any hint this call carries, always - a stale browser
  // hint (a shared device, a follower who reads Hindi on a phone set to
  // English) must never silently override a choice already recorded on the
  // row. Only pre-join is the hint consulted, and only when it is a
  // recognised value; otherwise the creator's own default answers.
  const locale = joined
    ? normalizeLocale(follower.locale)
    : hintLocale != null && String(hintLocale).trim()
      ? normalizeLocale(hintLocale)
      : normalizeLocale(resolved.room.default_locale);
  const disclosure = roomDisclosureCard(name, locale);
  const out = {
    room: {
      slug: resolved.room.slug,
      display_name: resolved.room.display_name || name,
      name,
      // WS-R20: whether the client renders "Ask <Name> directly" at all - a
      // read of the SAME column `sendHandoffRequest`'s predicate reads, never
      // a client-side guess, so a Room that never turned Handoff on shows no
      // affordance for a request that would only be refused anyway.
      handoff_enabled: resolved.room.handoff_enabled === true,
    },
    // The bytes the page MUST render, returned as DATA, in the app's voice,
    // never generated by the model.
    disclosure,
    locale,
    joined: false,
    follower: null,
    session: null,
  };
  if (!personId) return out;
  if (!joined) {
    // Signed in (or a bridged Telegram person) but not yet a follower: no
    // session to mint, nothing else to add.
    return out;
  }
  out.joined = true;
  out.follower = clientFollower(follower, resolved.room, now);
  out.threads = await listThreads(db, resolved.room.room_id, personId, resolved.agentId);
  out.session = mintRoomSession(
    {
      r: resolved.room.slug,
      i: String(resolved.room.room_id),
      p: personId,
      a: String(resolved.agentId),
      dd: sha(disclosure),
      loc: locale,
      td: transcriptDigest([]),
      iat: now,
      n: 0,
    },
    deps.env,
  );
  return out;
}

// ─────────────────────────────────────────────────────────────────────────
// OP: join
// ─────────────────────────────────────────────────────────────────────────

/**
 * The two questions, asked once, answered server-side.
 *
 * BOTH ANSWERS ARE RECORDED BEFORE ANY TURN IS POSSIBLE, and neither is
 * inferred from continued use. India's DPDP Act reaches full effect on
 * 2027-05-14 and storing cross-session personal memory needs its own specific,
 * informed, UNBUNDLED consent - not a line in a terms-of-service checkbox, not
 * a clause folded into the 18+ confirmation on the same sheet, and not an
 * inference. So they are two fields, two ledger rows, and the memory answer may
 * be `false` while the join still succeeds.
 *
 * The age answer may NOT be false: a Room is an adult surface (the student
 * surface is where a minor belongs, with `clock.ts`'s minor tier applied), and
 * a follower who says they are not 18 is refused a membership rather than given
 * a degraded one. No row is what makes persistence impossible rather than
 * merely forbidden - api/_room.js's §6.4 rule, one product over.
 *
 * The ledger write is APPEND-ONLY and has NO CONTENT COLUMN, migration 016's
 * design: a grant is a row, a withdrawal is a row, and the current answer is
 * the newest row. The `vy_room_follower` timestamps are the GATE the `say` path
 * reads; the ledger is the EVIDENCE, and the two are written together because
 * an answer that exists only in one of them is either unenforceable or
 * unprovable.
 */
export async function joinRoom(
  db,
  {
    slug,
    authUserId = null,
    personId: givenPersonId = null,
    ageAttested,
    memoryConsent,
    locale: hintLocale = null,
  },
  deps = {},
) {
  const resolved = await resolveRoom(db, slug, deps);
  // WS-R18's bypass, `openRoom`'s own header explains why: a Telegram follower
  // hands a personId already resolved through `vy_surface_identity`, never a
  // Supabase bearer token. `authUserId` still wins when both are present, and
  // every pre-existing caller passes only `authUserId`, so this is additive.
  if (!authUserId && !givenPersonId) throw new RoomError("room_sign_in_required", 401);
  if (ageAttested !== true) throw new RoomError("room_age_attestation_required", 403);
  if (typeof memoryConsent !== "boolean") throw new RoomError("room_memory_answer_required", 400);

  const personId = authUserId ? await personForAccount(db, authUserId) : String(givenPersonId);
  const now = deps.now ?? Date.now();
  const at = new Date(now).toISOString();
  // WS-R24: the locale this NEW row starts at, when it IS new. `openRoom`'s
  // own header explains the fallback chain; `hintLocale` here is normally the
  // very locale `openRoom` just told the client to render the join screen in,
  // passed back rather than re-derived, so the two can never disagree about
  // what a follower who has not answered anything yet was shown.
  const initialLocale = hintLocale != null && String(hintLocale).trim()
    ? normalizeLocale(hintLocale)
    : normalizeLocale(resolved.room.default_locale);

  const rows = await db(
    `insert into vy_room_follower
       (follower_id, room_id, person_id, agent_id, age_attested_at, memory_consent_at,
        tier, month_key, month_message_count, last_seen_at, locale)
     values (($1)::uuid, ($2)::uuid, ($3)::uuid, ($4)::uuid, ($5)::timestamptz, ($6)::timestamptz,
             'free', $7, 0, now(), $8)
     on conflict (room_id, person_id) do update
        set age_attested_at = coalesce(vy_room_follower.age_attested_at, excluded.age_attested_at),
            -- the memory answer is REPLACED, not coalesced: this op is also how
            -- a follower changes their mind, and a coalesce would make the
            -- first answer permanent, which is the one thing a consent record
            -- may never be.
            memory_consent_at = excluded.memory_consent_at,
            -- locale is deliberately ABSENT from this SET list. A repeat
            -- join (changing the memory answer, re-attesting) must never
            -- silently reset a locale the follower may have changed since
            -- with roomSetLocale - only the INSERT branch, a genuinely new
            -- follower, gets to set it at all.
            last_seen_at = now(),
            updated_at = now()
     returning follower_id, room_id, person_id, agent_id, joined_at, age_attested_at,
               memory_consent_at, tier, month_key, month_message_count, last_seen_at, locale`,
    [
      randomUUID(),
      String(resolved.room.room_id),
      personId,
      String(resolved.agentId),
      at,
      memoryConsent ? at : null,
      monthKeyOf(now),
      initialLocale,
    ],
  );
  const follower = rows[0];
  if (!follower) throw new RoomError("room_join_failed", 503);

  // The surface identity and the thread device. Both are agent-independent and
  // both exist so the rest of the stack can find this human: the identity is
  // what makes them the same person in another Room, and the device is what
  // makes their turns fall inside their own device-keyed whole wipe.
  const device = roomThreadDevice(resolved.room.room_id, personId, "main");
  await bindThreadDevice(db, device, personId);

  // THE EVIDENCE. Two rows, two kinds, one ledger - migration 016's own
  // instruction ("a second question is a new value here rather than a second
  // table"). Awaited rather than fired and forgotten: a serverless function
  // freezes the instant the response is sent, and this is the one write in this
  // file whose absence is a compliance gap rather than a lost metric.
  await recordRoomConsent(db, { device, authUserId, kind: ROOM_CONSENT_AGE, granted: true, at });
  await recordRoomConsent(db, {
    device,
    authUserId,
    kind: ROOM_CONSENT_MEMORY,
    granted: memoryConsent === true,
    at,
  });

  const locale = normalizeLocale(follower.locale);
  const disclosure = roomDisclosureCard(roomNameFor(resolved.sheet), locale);
  return {
    joined: true,
    locale,
    follower: clientFollower(follower, resolved.room, now),
    threads: await listThreads(db, resolved.room.room_id, personId, resolved.agentId),
    session: mintRoomSession(
      {
        r: resolved.room.slug,
        i: String(resolved.room.room_id),
        p: personId,
        a: String(resolved.agentId),
        dd: sha(disclosure),
        loc: locale,
        td: transcriptDigest([]),
        iat: now,
        n: 0,
      },
      deps.env,
    ),
  };
}

// ─────────────────────────────────────────────────────────────────────────
// OP: locale (WS-R24, migration 087)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Change the follower's own chrome language.
 *
 * THE PREDICATE IS THE SCOPE. Room, person and agent all come off the
 * VERIFIED session token, never a request field - the same discipline
 * `roomSay`'s cap UPDATE and `_pulse.js`'s `setOptIn` both carry, restated
 * here for exactly the reason those comments give: a `person_id` in a JSON
 * body is not identity proof. There is no shape of this call, honest or
 * forged, that can name a DIFFERENT follower's row, because nothing about
 * whose row is written comes from the caller at all.
 *
 * The disclosure card's bytes are locale-bound (`payload.dd`), so changing
 * the language invalidates the digest the old session carried on purpose - a
 * fresh session is minted here, bound to the new card, the same as any other
 * write that changes what a session must agree to.
 */
export async function roomSetLocale(db, { session, locale }, deps = {}) {
  const payload = readRoomSession(session, deps.env);
  const now = deps.now ?? Date.now();
  assertSessionFresh(payload, now);
  // Refused by name rather than silently folded into English: an empty value
  // (nothing to change to) and a value this deployment does not recognise
  // (garbage, a typo, a future locale) both read as `room_locale_invalid`,
  // never as a quiet "en". `normalizeLocale` is deliberately NOT used to
  // pick the outcome here - it exists to fall a HINT back to a safe default
  // for rendering, not to launder an invalid explicit REQUEST into success.
  const requested = String(locale || "").trim().toLowerCase();
  if (!requested || !ROOM_LOCALES.includes(requested)) {
    throw new RoomError("room_locale_invalid", 400);
  }
  const loc = requested;

  const resolved = await resolveRoom(db, payload.r, deps);
  if (
    String(resolved.room.room_id) !== String(payload.i) ||
    String(resolved.agentId) !== String(payload.a)
  ) {
    throw roomUnavailable();
  }

  const rows = await db(
    `update vy_room_follower
        set locale = $4, updated_at = now()
      where room_id = ($1)::uuid
        and person_id = ($2)::uuid
        and agent_id = ($3)::uuid
        and age_attested_at is not null
      returning locale`,
    [String(resolved.room.room_id), String(payload.p), String(resolved.agentId), loc],
  );
  if (!rows[0]) throw new RoomError("room_join_required", 403);

  const name = roomNameFor(resolved.sheet);
  const disclosure = roomDisclosureCard(name, loc);
  return {
    locale: loc,
    session: mintRoomSession(
      {
        r: resolved.room.slug,
        i: String(resolved.room.room_id),
        p: String(payload.p),
        a: String(resolved.agentId),
        dd: sha(disclosure),
        loc,
        td: transcriptDigest([]),
        iat: now,
        n: 0,
      },
      deps.env,
    ),
  };
}

/**
 * Register one thread device against its person.
 *
 * WRITTEN HERE rather than through api/_room.js's `bindSurfaceDmDevice`, and
 * the reason is a bug that function would have caused silently: it derives its
 * OWN device id from the key it is handed (`surfaceDeviceId(surface,
 * "dm:" + key)`), so passing it a device id would have registered a DIFFERENT
 * uuid than the one the turns are logged under. Every log row would then sit on
 * a device that is in nobody's `vy_person_device` mapping, and the follower's
 * own whole wipe would walk straight past their entire history while returning
 * a receipt. `plausible-return-hides-a-dead-pipeline`, exactly.
 *
 * Idempotent, so it is safe on every turn, which is what makes a thread created
 * later than the join still reachable by the wipe.
 */
export async function bindThreadDevice(db, device, personId) {
  await db(
    `insert into vy_person_device (device_id, person_id)
     values (($1)::uuid, ($2)::uuid)
     on conflict (device_id) do nothing`,
    [String(device), String(personId)],
  );
}

/** One append-only consent row. NO CONTENT COLUMN and there must never be one:
 *  this is the ledger of a decision ABOUT memory, and a text column on it would
 *  make the refusal path the one path that files new content about a person. */
export async function recordRoomConsent(db, { device, authUserId, kind, granted, at }) {
  await db(
    `insert into meera_consent (device_id, user_id, kind, granted, version, at)
     values (($1)::uuid, ($2)::uuid, $3, ($4)::bool, ($5)::int4, ($6)::timestamptz)`,
    [
      String(device),
      UUID.test(String(authUserId || "")) ? String(authUserId).toLowerCase() : null,
      String(kind),
      granted === true,
      ROOM_CONSENT_VERSION,
      String(at),
    ],
  );
}

// ─────────────────────────────────────────────────────────────────────────
// THREADS - the follower's own, and nobody else's
// ─────────────────────────────────────────────────────────────────────────

export async function listThreads(db, roomId, personId, agentId) {
  const rows = await db(
    `select t.thread_id, t.title, t.created_at, t.last_message_at
       from vy_room_thread t
      where t.room_id = ($1)::uuid
        and t.person_id = ($2)::uuid
        and t.agent_id = ($3)::uuid
        and t.archived_at is null
      order by t.last_message_at desc nulls last, t.created_at desc
      limit 40`,
    [String(roomId), String(personId), String(agentId)],
  );
  return rows.map((r) => ({
    thread_id: r.thread_id,
    title: r.title,
    last_message_at: r.last_message_at ?? null,
  }));
}

/** Name a thread. The follower's own scope is in the INSERT's own values, so
 *  there is no shape of this call that can create a thread inside somebody
 *  else's rail. */
export async function createThread(db, { roomId, personId, agentId, title }) {
  const name = String(title || "").trim().slice(0, 80);
  if (!name) throw new RoomError("room_thread_title_required", 400);
  const rows = await db(
    `insert into vy_room_thread (thread_id, room_id, person_id, agent_id, title)
     values (($1)::uuid, ($2)::uuid, ($3)::uuid, ($4)::uuid, $5)
     on conflict do nothing
     returning thread_id, title, created_at, last_message_at`,
    [randomUUID(), String(roomId), String(personId), String(agentId), name],
  );
  if (!rows[0]) throw new RoomError("room_thread_exists", 409);
  return { thread_id: rows[0].thread_id, title: rows[0].title, last_message_at: null };
}

/**
 * WS-R38 (the door battery). `createThread` above is a low-level primitive —
 * every OTHER caller in this codebase (evals, `_handoff.js`, `_pulse.js`)
 * already resolves its own (room, person, agent) some other way and hands it
 * in directly, so its signature stays exactly as it was. `api/room.js`'s
 * `thread` op was the ONE caller that fed it straight off a decoded session
 * with no check in between — no freshness check, and no confirmation that a
 * `vy_room_follower` row for that (room, person, agent) still exists and is
 * attested. Every sibling op (`roomSay`, `followerHistory`, `selfScope`)
 * requires both before it will touch a table; this door did not, so a
 * signed-but-stale session, or one whose follower row `roomForget` already
 * deleted, could still mint a brand-new `vy_room_thread` row — an orphan no
 * export or forget sweep would ever be asked to find again, because nothing
 * ties it back to a follower who, by the time it was created, no longer had
 * one. This is the session-consuming door `createThread` should have been
 * reached through all along; `api/room.js` now calls this instead.
 */
export async function createFollowerThread(db, { session, title }, deps = {}) {
  const who = await selfScope(db, session, deps);
  return createThread(db, { roomId: who.roomId, personId: who.personId, agentId: who.agentId, title });
}

/** THE THREAD SCOPE PREDICATE. Person and agent are in the WHERE clause, before
 *  anything is returned - not checked afterwards in JS. This is the clause the
 *  offline suite's negative control STRIKES, and the suite fails unless the
 *  struck copy leaks another follower's thread. */
/** Exported for WS-R20's api/_handoff.js: a request may be attached to a
 *  specific thread (so the creator's reply lands back in it), and validating
 *  ownership of that thread_id has to happen somewhere - this function
 *  already IS that predicate, so it is reused rather than re-derived a
 *  second time against the same table, `_room-cohorts.js`'s own convention
 *  applied the other direction (re-derive small owner-side helpers; import
 *  the follower-scope ones that already carry a proven predicate). */
export async function ownedThread(db, roomId, personId, agentId, threadId) {
  if (!threadId) return null;
  if (!UUID.test(String(threadId))) throw new RoomError("room_thread_unknown", 404);
  const rows = await db(
    `select t.thread_id, t.title
       from vy_room_thread t
      where t.thread_id = ($1)::uuid
        and t.room_id = ($2)::uuid
        and t.person_id = ($3)::uuid
        and t.agent_id = ($4)::uuid
        and t.archived_at is null
      limit 1`,
    [String(threadId), String(roomId), String(personId), String(agentId)],
  );
  if (!rows[0]) throw new RoomError("room_thread_unknown", 404);
  return rows[0];
}

// ─────────────────────────────────────────────────────────────────────────
// OP: say
// ─────────────────────────────────────────────────────────────────────────

/**
 * The seams. Every one of them defaults to the SHIPPING function and exists so
 * an offline suite can drive this file's decisions without a database.
 *
 * `offline-mocks-cannot-type-check-sql` is the standing law and it applies to
 * these four hardest: they are the DM lane's own writers, their SQL is proven
 * by live traffic on that lane and by nothing at all on this one. What the
 * suite proves is WHETHER they are called and with WHAT - which is the whole
 * question for a consent gate - and never that their statements parse.
 */
const DEFAULT_MEMORY = {
  openEpisode: (person, device, agentId) =>
    openOrExtendEpisode(person, device, "chat", { agentId }),
  logTurn: (args) => logDmTurn(args),
  history: (device, agentId, limit) => dmHistory(device, undefined, limit, agentId),
  recall: (person, agentId) => dmRecall(person, { agentId }),
};

/**
 * One turn.
 *
 * The order below IS the design, and every step of it fails closed:
 *   VERIFY the session, RESOLVE the room, RE-DERIVE the disclosure and refuse a
 *   stale one, LOAD the follower's own row, SPEND one message against the cap
 *   in a single conditional UPDATE, RETRIEVE only under consent, COMPILE, and
 *   only then reach the one door.
 *
 * The cap is spent BEFORE the model call and not after. Charging after a
 * successful reply sounds fairer and is not: a crash between the reply and the
 * increment gives away turns, and a retry storm gives away many. Charging first
 * costs a follower one message on a genuine platform failure, which is the
 * error the platform can afford to be wrong about.
 */
export async function roomSay(db, { session, message, threadId = null, transcript = [] }, deps = {}) {
  const payload = readRoomSession(session, deps.env);
  const now = deps.now ?? Date.now();
  assertSessionFresh(payload, now);
  const text = String(message ?? "").trim();
  if (!text) throw new RoomError("room_message_empty", 400);
  if (text.length > ROOM_INBOUND_LIMIT) throw new RoomError("room_message_too_long", 413);

  const resolved = await resolveRoom(db, payload.r, deps);
  // The room the token was minted against must be the room answering now. A
  // slug reassigned to a different creator is the wrong-agent disaster wearing
  // a URL, and it is caught here rather than trusted.
  if (String(resolved.room.room_id) !== String(payload.i) ||
      String(resolved.agentId) !== String(payload.a)) {
    throw roomUnavailable();
  }

  // THE DISCLOSURE PREDICATE. Recomputed from the room that is answering NOW,
  // so a session opened against an older card is refused rather than continued
  // under a disclosure the follower never saw. The client's response to this
  // code is to re-open, which is to say to re-render the card.
  const name = roomNameFor(resolved.sheet);
  // WS-R24: recomputed against `payload.loc` - the locale THIS TOKEN was
  // minted in, never the follower row's current value. The two can
  // legitimately differ for a moment (a second tab, a session minted just
  // before a language switch on another device), and re-deriving from the
  // row would refuse a perfectly valid session for a reason that has
  // nothing to do with the card actually shown - `payload.dd`'s own
  // "recomputed from what the token names, never trusted, never re-guessed"
  // discipline, applied to the language dimension too. An older token minted
  // before this field existed carries `undefined`, which reads as "en" -
  // exactly the card such a token was actually minted against.
  const disclosure = roomDisclosureCard(name, payload.loc);
  if (payload.dd !== sha(disclosure)) throw new RoomError("room_disclosure_stale", 409);

  const follower = await followerRow(db, resolved.room.room_id, payload.p, resolved.agentId);
  if (!follower || follower.age_attested_at == null) throw new RoomError("room_join_required", 403);

  const thread = await ownedThread(db, resolved.room.room_id, payload.p, resolved.agentId, threadId);
  const device = roomThreadDevice(resolved.room.room_id, payload.p, thread?.thread_id || null);

  // THE CAP, as one statement. It rolls the month over and increments in the
  // same UPDATE, so two tabs cannot both read 19 and both write 20, and the
  // allowance is read from the ROOM's column rather than from a constant in
  // this file. Zero rows back means the predicate refused: either the cap is
  // spent or the attestation is gone, and the read above has already separated
  // those, so this can name the reason honestly.
  //
  // WS-R19: a paid follower now spends against `r.paid_monthly_messages`
  // rather than being waved through unconditionally — WS-R11's own report
  // named this exact gap ("the paid tier's fair-use ceiling ... is not
  // enforced anywhere in this workstream"). ONE CASE inside the WHERE, on
  // `f.tier`, rather than a second statement: the free and paid ceilings are
  // the same predicate shape spending the same `month_key`, and a second
  // statement would be a second place the two definitions of "a turn" could
  // drift apart, exactly the failure 077's own cohort-count comment warns
  // against for a different pair of writers.
  const spent = await db(
    `update vy_room_follower f
        set month_key = $4,
            month_message_count =
              case when f.month_key = $4 then f.month_message_count + 1 else 1 end,
            last_seen_at = now(),
            updated_at = now()
       from vy_room r
      where r.room_id = f.room_id
        and f.room_id = ($1)::uuid
        and f.person_id = ($2)::uuid
        and f.agent_id = ($3)::uuid
        and f.age_attested_at is not null
        and (f.month_key <> $4
             or f.month_message_count <
                case when f.tier = 'paid' then r.paid_monthly_messages else r.free_monthly_messages end)
     returning f.month_key, f.month_message_count, f.tier,
               r.free_monthly_messages, r.paid_monthly_messages`,
    [
      String(resolved.room.room_id),
      String(payload.p),
      String(resolved.agentId),
      monthKeyOf(now),
    ],
  );
  if (!spent[0]) {
    // The ONE place a turn does not happen for a money reason, and it happens
    // at the door with a named code, before any model call. Never mid-sentence.
    //
    // WHICH CEILING WAS HIT: read off `follower.tier` (loaded above, before
    // this statement ran), never re-derived from the empty result — an empty
    // `spent` array carries no tier of its own to read. A stale-attestation
    // refusal is already impossible here (the earlier `followerRow` check
    // would have thrown `room_join_required` first), so a follower reaching
    // this line was refused for money, and the app-voiced capped card can
    // now say the right thing to a paid follower instead of the free line.
    const paidCeiling = follower.tier === "paid";
    // WS-R30 (migration 093): the OTHER moment the offer is shown, alongside
    // "a session that worked" - a free follower dead-ending on the cap. This
    // is a WRITE to the ledger only, never the reply: the refusal below is
    // unchanged and this write's own failure must never turn a 402 into a
    // 500 for a ledger reason, so it is best-effort, `_ops.js`'s own
    // `obsBestEffort` posture applied to a table write instead of a metric.
    if (!paidCeiling && await isTableAppliedFor(deps)("vy_room_upgrade_offer")) {
      await recordOffer(db, {
        roomId: resolved.room.room_id, personId: payload.p, followerId: follower.follower_id,
        reason: "cap_reached", now,
      }).catch(() => {});
    }
    throw new RoomError(paidCeiling ? "room_paid_cap_reached" : "room_free_cap_reached", 402, {
      messages_included: Number(
        paidCeiling
          ? resolved.room.paid_monthly_messages ?? ROOM_PAID_MONTHLY_MESSAGES
          : resolved.room.free_monthly_messages ?? ROOM_FREE_MONTHLY_MESSAGES,
      ),
    });
  }
  const used = Number(spent[0].month_message_count || 0);
  const paid = spent[0].tier === "paid";
  const included = paid
    ? Number(spent[0].paid_monthly_messages ?? ROOM_PAID_MONTHLY_MESSAGES)
    : Number(spent[0].free_monthly_messages ?? ROOM_FREE_MONTHLY_MESSAGES);

  // WS-R12 (migration 077): the cohort instrument. Bumped HERE, at the same
  // point the free cap is spent and for the identical reason - the cap UPDATE
  // above already proved this is a real, accepted turn, so the day table's
  // definition of "a turn" and the cap's agree by construction rather than by
  // two definitions that could drift apart. Gated on the migration having
  // landed (`isTableApplied`, injectable exactly the way `personTablesFor`
  // (below) makes `activePersonTables` injectable, so an offline eval can
  // prove the write happens without a live database) for `activePersonTables`'s
  // own reason: a database that has not yet had 077 applied must never turn a
  // follower's first message into a 500 for a deploy-ordering reason.
  // Content-free by construction - room id, person id, a date, and an integer
  // the statement itself increments.
  if (await isTableAppliedFor(deps)("vy_room_follower_day")) {
    await db(
      `insert into vy_room_follower_day (room_id, person_id, day, turns)
       values (($1)::uuid, ($2)::uuid, ($3)::date, 1)
       on conflict (room_id, person_id, day) do update
          set turns = vy_room_follower_day.turns + 1`,
      [String(resolved.room.room_id), String(payload.p), dayKeyOf(now)],
    );
  }

  const engine = deps.engine !== undefined ? deps.engine : await loadEngine();
  // No engine, no answer, and the failure is LOUD. A hand-rolled fallback
  // prompt here would be a second, unvalidated version of a real, named, living
  // person that nobody consented to.
  if (!engine) throw new RoomError("room_engine_unavailable", 503);

  const memory = { ...DEFAULT_MEMORY, ...(deps.memory || {}) };
  // THE CONSENT GATE, and it is a branch rather than a filter on purpose: with
  // no consent there is no episode, no log row and no retrieval, so there is
  // nothing to filter later and nothing a future edit can accidentally
  // un-filter. `memoryWritesAllowed`'s discipline, at the server.
  const remembers = follower.memory_consent_at != null;

  let history = [];
  let facts = [];
  if (remembers) {
    // Before the first write on this device, every time. A thread named after
    // the join has a device the join never registered, and an unregistered
    // device is history the follower's own wipe cannot find.
    await bindThreadDevice(db, device, payload.p);
    await memory.openEpisode(payload.p, device, resolved.agentId);
    await memory.logTurn({ device, person: payload.p, role: "me", content: text, agentId: resolved.agentId });
    history = await memory.history(device, resolved.agentId, ROOM_RECALL_TURNS);
    // The disclosure predicate with one recipient and no room: their own facts
    // under this agent, and nobody else's, because nobody else was there.
    facts = await memory.recall(payload.p, resolved.agentId);
  } else {
    // The memory-free path. The transcript rides on the request and is bound by
    // the SAME digest the anonymous widget lane uses, imported rather than
    // re-implemented: a client that edited history, or invented an `assistant`
    // turn putting words in a real named creator's AI's mouth, presents a
    // digest that does not match and is refused.
    history = (Array.isArray(transcript) ? transcript : [])
      .slice(-ROOM_HISTORY_TURNS)
      .map((t) => ({
        role: t?.role === "assistant" ? "assistant" : "user",
        content: String(t?.content ?? "").slice(0, ROOM_TEXT_LIMIT),
      }));
    if (payload.td !== transcriptDigest(history)) {
      throw new RoomError("room_transcript_mismatch", 409);
    }
  }

  const { sent, adapter } = collector();
  const ctx = makeCtx(adapter, {
    engine,
    agent: resolved.module,
    agentId: resolved.agentId,
    reply: deps.reply || ((compiled, turns) => think(engine, compiled, turns)),
  });

  const compiled = engine.compile({
    agent: resolved.module,
    user: { name: "", vibe: [], facts: {} },
    // A remembering follower is not a stranger, and `messageCount` is what the
    // compiler reads to decide that. Their real spend this month is the honest
    // number; without memory every turn is a first turn, which is exactly what
    // declining memory means.
    messageCount: remembers ? used : history.length,
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

  const turns = [...history, { role: "user", content: text }];
  // THE ONE DOOR. `record` is the retrieved set and nothing else: a moment the
  // AI was HANDED is a moment it may retell, and one it was not is a
  // fabrication. On the memory-free path `record` is empty, which makes honesty
  // family 4 as strict as it ever is - every claim of a shared past is false by
  // construction there.
  const gatedOut = await gatedReply(ctx, compiled, turns, {
    record: facts.map((f) => f.body),
    label: "web/room",
  });
  const said = gatedOut.text;
  if (said) {
    await deliver(ctx, "room", { kind: "text", text: said, replyTo: null, buttons: [] });
    if (remembers) {
      await memory.logTurn({ device, person: payload.p, role: "her", content: said, agentId: resolved.agentId });
      if (thread) await touchThread(db, thread.thread_id, resolved.agentId, payload.p);
    }
  }

  const nextTurns = said ? [...turns, { role: "assistant", content: said }] : turns;
  // WS-R19: paid now carries a REAL `left`, its own ceiling rather than the
  // free one — a paid follower who is about to hit their (much higher) cap
  // deserves the same honest countdown a free follower gets, never a `null`
  // that reads as "unlimited" when it is merely "unenforced".
  const left = Math.max(0, included - used);

  // WS-R30 (migration 093): "the offer belongs at the end of a session that
  // worked." Checked AFTER a real reply already left through `gatedReply` -
  // `said`/`sent` above are already final, and nothing below this point can
  // change them, so a struck copy of this block still delivers a
  // byte-identical reply with or without an offer attached. Free tier only
  // (`!paid`, the same guard `upgrade_prompt` already uses); a real thread
  // required (a brand new thread fails `sessionWorked`'s own "continued from
  // an earlier day" clause anyway, so this is a cheap short-circuit, not a
  // second definition of that rule); gated on migration 093 having landed.
  let offer = null;
  if (!paid && thread && await isTableAppliedFor(deps)("vy_room_upgrade_offer")) {
    const worked = await sessionWorked(db, {
      roomId: resolved.room.room_id, personId: payload.p, threadId: thread.thread_id,
      agentId: resolved.agentId, deviceId: device, now,
    });
    if (worked.worked) {
      const recorded = await recordOffer(db, {
        roomId: resolved.room.room_id, personId: payload.p, followerId: follower.follower_id,
        reason: "session_worked", now,
      });
      if (recorded.inserted) {
        // The price, read here rather than through api/_payments.js: that
        // file already imports FROM this one (`paidSessionScope`), so an
        // import the other way would be circular. A one-line duplicate read
        // of `vy_room_price`, `api/_room-cohorts.js`'s own `ownedRoomHandle`
        // precedent for "stays reachable with only a fake db" applied to a
        // second small table instead of a second whole function.
        const priceRows = await db(
          `select follower_price_inr, currency from vy_room_price where room_id = ($1)::uuid limit 1`,
          [String(resolved.room.room_id)],
        ).catch(() => []);
        offer = {
          reason: "session_worked",
          price_inr: priceRows[0] ? Number(priceRows[0].follower_price_inr) : null,
          currency: priceRows[0]?.currency ?? null,
        };
      }
    }
  }

  return {
    bubbles: sent,
    reply: said,
    remembers,
    thread_id: thread?.thread_id ?? null,
    // Chrome, never a second reply — see the block above. `null` when no
    // offer applies, exactly like `thread_id`'s own `?? null`.
    offer,
    quota: { tier: paid ? "paid" : "free", messages_used: used, messages_included: included, messages_left: left },
    // A STATE THE CLIENT RENDERS AT THE END, never an interruption. True only
    // on the last few messages of a free month, so it is a fact about where
    // they are rather than a nudge that fires whenever there is money to be
    // made. NEVER MANIPULATE is the floor and manufactured urgency is the
    // named failure. Paid never sees this line — `!paid` guards it exactly as
    // before — a follower who already pays is never shown an upgrade pitch.
    upgrade_prompt: !paid && left <= 3,
    session: mintRoomSession(
      {
        ...payload,
        td: remembers ? transcriptDigest([]) : transcriptDigest(nextTurns),
        n: (payload.n | 0) + 1,
        // THE REPLY BINDING (WS-R19): the hash of the reply this turn just
        // delivered through the one door, so `roomSpeak` can prove ANY clip
        // it is ever asked to synthesise is a rendering of a reply that
        // already passed `gatedReply` and reached this follower's screen -
        // never a second way to make this AI say something. Carried forward
        // unchanged on a silent turn (`said` empty), so a stale voice request
        // for the LAST real reply still resolves correctly.
        lr: said ? sha(said) : payload.lr ?? null,
      },
      deps.env,
    ),
    // Counts only, never the strings - `gateReply`'s rule, and the whole point
    // of the event is that what it caught must not travel.
    gate: { applied: gatedOut.gated, findings: gatedOut.findings.length },
  };
}

// ─────────────────────────────────────────────────────────────────────────
// OP: speak - the paid tier's voice reply (WS-R19)
// ─────────────────────────────────────────────────────────────────────────
//
// `roomSpeak` is NEVER a second reply assembler. It takes no message, has no
// `reply` dependency, and calls `gatedReply` nowhere in this file - the text
// it may ever synthesise is text `roomSay` ALREADY produced, spoken through a
// door that already ran, keyed by the hash `roomSay` mints into the session
// on every turn (`lr`, above). Voice is a RENDERING of a reply, never a
// second way to make this AI say something.
//
// The order below is `roomSay`'s own discipline, restated for money and audio
// rather than text: VERIFY the session, RESOLVE the room, RE-DERIVE the
// disclosure, LOAD the follower, REFUSE a free tier before any hash is
// checked, VERIFY the reply binding, SPEND the voice cap in one conditional
// UPDATE before any synthesis, THEN authorize + synthesise + protect, and
// only once the watermarked bytes exist does anything leave this function.
export async function roomSpeak(deps, session, replyRef) {
  const db = deps?.db;
  if (typeof db !== "function") throw new RoomError("room_db_required", 500);
  const payload = readRoomSession(session, deps.env);
  const now = deps.now ?? Date.now();
  assertSessionFresh(payload, now);

  const resolved = await resolveRoom(db, payload.r, deps);
  if (String(resolved.room.room_id) !== String(payload.i) ||
      String(resolved.agentId) !== String(payload.a)) {
    throw roomUnavailable();
  }

  // THE DISCLOSURE PREDICATE, `roomSay`'s own clause: a session opened
  // against an older card is refused rather than allowed to buy audio under a
  // disclosure the follower never saw.
  const name = roomNameFor(resolved.sheet);
  // WS-R24: `payload.loc`, `roomSay`'s own comment explains why - the token
  // names what it was minted against, never re-guessed from the row.
  const disclosure = roomDisclosureCard(name, payload.loc);
  if (payload.dd !== sha(disclosure)) throw new RoomError("room_disclosure_stale", 409);

  const follower = await followerRow(db, resolved.room.room_id, payload.p, resolved.agentId);
  if (!follower || follower.age_attested_at == null) throw new RoomError("room_join_required", 403);

  // PAID ONLY, as a predicate at the door - law 3: a free follower "never
  // receives audio bytes and never sees a play control that works". This is
  // the server half of that law; the client half is the flag simply not
  // rendering a play control for a free follower's own bubbles. Checked
  // BEFORE the reply binding and BEFORE the cap, so a free follower's request
  // costs this function nothing beyond one row read, win or lose.
  if (follower.tier !== "paid") {
    throw new RoomError("room_voice_paid_only", 402);
  }

  const text = String(replyRef?.text ?? "").trim();
  if (!text) throw new RoomError("room_voice_text_required", 400);
  if (text.length > ROOM_TEXT_LIMIT) throw new RoomError("room_voice_text_too_long", 413);

  // THE REPLY BINDING. `payload.lr` is the hash `roomSay` minted into this
  // exact session after the LAST reply it delivered through `gatedReply`. A
  // caller asking to speak anything else - edited, invented, or simply never
  // sent - is refused here, structurally, before a single second of the
  // voice cap is touched. This is what makes "an unwatermarked clip must be
  // structurally impossible" also true one layer up: there is no code path
  // in this function that can reach synthesis with text this session did not
  // already prove it was told.
  if (!payload.lr || sha(text) !== payload.lr) {
    throw new RoomError("room_voice_reply_mismatch", 409);
  }

  const clipSeconds = estimateClipSeconds(text);

  // THE VOICE CAP, as one statement - `roomSay`'s cap law restated for the
  // second number the plan promises. Rolls the month over and spends
  // `clipSeconds` in the same UPDATE, so two tabs cannot both read 1798 and
  // both write 1810; the allowance is read from the ROOM's column, never a
  // constant. Charged BEFORE synthesis (`roomSay`'s own reason, restated):
  // a crash between the spend and the delivered clip costs a follower some
  // seconds on a genuine platform failure, which is the error the platform
  // can afford to be wrong about, never the reverse.
  //
  // `voice_month_key`, NOT `month_key` - migration 081's own header names the
  // defect a shared key causes: `roomSay` and `roomSpeak` are two independent
  // statements, either of which can run first in a new month, and a SHARED
  // rollover key lets whichever one runs first silently strand the other
  // counter unreset (`context/rejected.md#ws-r19-shared-month-key-cross-
  // counter-rollover`, caught by this workstream's own offline eval).
  const spentVoice = await db(
    `update vy_room_follower f
        set voice_month_key = $4,
            voice_seconds_month =
              case when f.voice_month_key = $4 then f.voice_seconds_month + ($5)::int4 else ($5)::int4 end,
            last_seen_at = now(),
            updated_at = now()
       from vy_room r
      where r.room_id = f.room_id
        and f.room_id = ($1)::uuid
        and f.person_id = ($2)::uuid
        and f.agent_id = ($3)::uuid
        and f.age_attested_at is not null
        and f.tier = 'paid'
        and (f.voice_month_key <> $4
             or f.voice_seconds_month + ($5)::int4 <= r.paid_monthly_voice_seconds)
     returning f.voice_month_key, f.voice_seconds_month, r.paid_monthly_voice_seconds`,
    [
      String(resolved.room.room_id),
      String(payload.p),
      String(resolved.agentId),
      monthKeyOf(now),
      clipSeconds,
    ],
  );
  if (!spentVoice[0]) {
    throw new RoomError("room_voice_cap_reached", 402, {
      voice_seconds_included: Number(
        resolved.room.paid_monthly_voice_seconds ?? ROOM_PAID_MONTHLY_VOICE_SECONDS,
      ),
    });
  }

  // AUTHORIZE, through the EXISTING voice-preview fence, reused rather than
  // re-derived - api/_room-voice.js's own header states why this is the only
  // schema-compatible choice. `deps.authorize` is injectable so the offline
  // eval can drive every refusal shape with no database behind it; the real
  // wiring (api/room.js) supplies the real function, unmodified.
  const authorize = deps.authorize ?? ((input) => authorizeRoomVoice(db, resolved.room.owner_user_id, input));
  let authorized;
  try {
    authorized = await authorize({ replicaId: resolved.room.replica_id, text, traceId: deps.traceId });
  } catch (error) {
    throw new RoomError(String(error?.code || "room_voice_unavailable"), Number(error?.status) || 503, {
      blocker: error?.details?.blocker || error?.blockerClass || "us",
    });
  }

  // SYNTHESISE + PROTECT, both REQUIRED injections with no default - a call
  // to this function that supplies neither throws rather than silently
  // no-opping, `plausible-return-hides-a-dead-pipeline`'s law applied to a
  // seam rather than a return value. `deps.synth` is handed the WHOLE
  // `authorized` result (not a hand-picked subset) because reading the
  // reference audio object, choosing seed/style and calling the provider are
  // ALL the real wiring's own composition - `api/voice-preview.js`'s exact
  // sequence (`readObject` then `provider.synthesizePreview`), reused as one
  // seam rather than split into two so this file need not know its shape.
  // The real wiring passes the SAME provider and the SAME
  // `protectReplicaStream` the studio preview panel already uses; this
  // workstream never constructs that wiring's default in any path this
  // session executes (`api/_room-voice.js`'s header, "NO GPU WAKES").
  if (typeof deps.synth !== "function" || typeof deps.protect !== "function") {
    throw new RoomError("room_voice_unconfigured", 503);
  }
  let synthesized;
  try {
    synthesized = await deps.synth({ authorized, text });
  } catch (error) {
    throw new RoomError("room_voice_synthesis_failed", 503, {
      reason: error?.code || String(error?.message || "unknown"),
    });
  }

  let protectedAudio;
  try {
    protectedAudio = await deps.protect({
      authorization: authorized.authorizationInput,
      sourceStream: synthesized.stream,
      format: synthesized.format,
      disclosureEvidence: { renderedText: synthesized.renderedText, renderer: synthesized.renderer || "" },
      disclosureText: synthesized.disclosureText,
    });
  } catch (error) {
    throw new RoomError("room_voice_protection_failed", 503, {
      reason: error?.code || String(error?.message || "unknown"),
    });
  }

  // NEVER RAW SYNTH OUTPUT. Every byte collected below comes from
  // `protectedAudio.stream` - the watermark-embedded, disclosure-prefixed
  // output of `deps.protect` - and `synthesized` (the provider's raw PCM) is
  // never read again past this line. That is structural, not a habit: no
  // variable declared below this comment is bound to `synthesized`, so there
  // is nothing downstream a future edit could point at to ship an
  // unwatermarked clip by accident.
  const chunks = [];
  for await (const chunk of protectedAudio.stream) chunks.push(Buffer.from(chunk));
  const receipt = await protectedAudio.completion;
  const audio = Buffer.concat(chunks);
  if (!audio.length) throw new RoomError("room_voice_audio_empty", 503);

  // THE ROOM'S OWN USAGE ROW (migration 081) - content-free, day-granular,
  // `vy_room_follower_day`'s own shape one column deeper. Written AFTER a
  // clip has actually left the protection pipeline, so this row's `clips`
  // count is never higher than the number of clips a follower actually
  // received.
  await db(
    `insert into vy_room_voice_usage (room_id, person_id, follower_id, day, seconds, clips)
     values (($1)::uuid, ($2)::uuid, ($3)::uuid, ($4)::date, ($5)::int4, 1)
     on conflict (room_id, person_id, day) do update
        set seconds = vy_room_voice_usage.seconds + ($5)::int4,
            clips = vy_room_voice_usage.clips + 1`,
    [
      String(resolved.room.room_id),
      String(payload.p),
      String(follower.follower_id),
      dayKeyOf(now),
      clipSeconds,
    ],
  );

  const voiceUsed = Number(spentVoice[0].voice_seconds_month || 0);
  const voiceIncluded = Number(
    spentVoice[0].paid_monthly_voice_seconds ?? ROOM_PAID_MONTHLY_VOICE_SECONDS,
  );
  return {
    // Law 5: "12 of 30 voice minutes used this month" from the row, never
    // estimated - `voiceUsed` is what the UPDATE above actually wrote back,
    // not a client-side recomputation of the estimate.
    audio: audio.toString("base64"),
    format: synthesized.format,
    generation_id: authorized.generation.generation_id,
    watermark_algorithm: receipt.watermark_algorithm,
    disclosure_scheme: receipt.disclosure_scheme,
    voice: {
      seconds_used: voiceUsed,
      seconds_included: voiceIncluded,
      seconds_left: Math.max(0, voiceIncluded - voiceUsed),
    },
    // Passed through UNCHANGED, never re-minted: nothing in this function
    // advances a turn or touches `lr`/`td`/`n`, so the session the caller
    // already holds is still exactly as valid for the NEXT `say` or `speak`
    // as it was before this call. A caller that always threads `.session`
    // through, `roomSay`'s own contract, keeps working without a branch that
    // asks which op it just called.
    session,
  };
}

async function touchThread(db, threadId, agentId, personId) {
  await db(
    `update vy_room_thread
        set last_message_at = now()
      where thread_id = ($1)::uuid
        and agent_id = ($2)::uuid
        and person_id = ($3)::uuid`,
    [String(threadId), String(agentId), String(personId)],
  );
}

/**
 * `send` COLLECTS rather than transmits, because on this wire the reply IS the
 * HTTP response. The honest implementation of `send()` for a request/response
 * surface, and it keeps `deliver()`'s fragmentation rules identical to every
 * other surface's. Lifted from api/_clonechat.js's `collector` with one number
 * changed; kept local rather than exported from there because the two lanes'
 * limits are independent product decisions that happen to agree today.
 */
export function collector() {
  const sent = [];
  return {
    sent,
    adapter: {
      surface: "web",
      verify: async () => ({ ok: true, reason: "" }),
      parse: () => [],
      send: async (_chatKey, msg) => {
        sent.push(String(msg.text ?? ""));
        return { ok: true };
      },
      render: (text) => splitForLimit(text, ROOM_TEXT_LIMIT),
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────
// OP: history, export, forget - THEIR OWN SCOPE ONLY
// ─────────────────────────────────────────────────────────────────────────

/**
 * A follower's own turns, in one thread.
 *
 * THE SCOPE IS THE DEVICE, and the device is a uuid v5 over
 * (room, person, thread) - so there is no parameter on this function that can
 * name another follower's history, and no bug in it that can return one. That
 * is the same property api/_disclosure.js's scalar room binding has and it is
 * the reason this is derived rather than passed: a `device` parameter would be
 * a thing a client could send.
 */
export async function followerHistory(db, { session, threadId = null, limit = ROOM_RECALL_TURNS }, deps = {}) {
  const payload = readRoomSession(session, deps.env);
  assertSessionFresh(payload, deps.now ?? Date.now());
  const resolved = await resolveRoom(db, payload.r, deps);
  if (String(resolved.room.room_id) !== String(payload.i)) throw roomUnavailable();
  const follower = await followerRow(db, resolved.room.room_id, payload.p, resolved.agentId);
  if (!follower || follower.age_attested_at == null) throw new RoomError("room_join_required", 403);
  if (follower.memory_consent_at == null) return { remembers: false, turns: [] };
  const thread = await ownedThread(db, resolved.room.room_id, payload.p, resolved.agentId, threadId);
  const device = roomThreadDevice(resolved.room.room_id, payload.p, thread?.thread_id || null);
  const memory = { ...DEFAULT_MEMORY, ...(deps.memory || {}) };
  const turns = await memory.history(device, resolved.agentId, Math.min(200, Math.max(1, Number(limit) | 0)));
  return { remembers: true, thread_id: thread?.thread_id ?? null, turns };
}

/**
 * EXPORT AND FORGET ARE CALLERS OF THE MANIFEST, NEVER SECOND COPIES OF IT.
 *
 * api/export.js is the shape: it owns no rule about what a person's data IS. It
 * iterates `activePersonTables()` and builds each statement out of `keysOf` /
 * `wipeWhereSql` / `wipeParams`, all exported from api/memory.js, so a table
 * added to PERSON_TABLES lands in export and forget with no code anywhere. That
 * is the single-source property the manifest exists for, and these two are the
 * Room's caller of it rather than a Room-shaped restatement.
 *
 * ── WHAT "THEIR OWN SCOPE" MEANS HERE, EXACTLY ────────────────────────────
 *
 * This is LEAVE THIS ROOM, not DELETE MY ACCOUNT, and the difference is a
 * one-line predicate with a large consequence: every statement below carries
 * `agent_id = <this room's agent>`, so it takes the follower's whole
 * relationship with THIS creator and touches nothing of their relationship with
 * any other creator or with Meera. A global wipe that fired from a creator's
 * Room would be a follower asking one person to forget them and losing every
 * other conversation they have. The account-wide wipe still exists and is still
 * `POST /api/memory {op:"forget", scope:"all"}`; this is deliberately smaller
 * and says so in the receipt.
 *
 * The manifest entries WITHOUT `agent: true` are skipped, and that is the same
 * decision stated from the other side: `vy_person`, `vy_person_device`,
 * `vy_surface_identity`, `vy_account_person` and `meera_consent` are
 * person-intrinsic (api/_agentscope.js §2) - they are not this creator's to
 * delete, and deleting them would unbind the human from every other Room they
 * are in. The consent ledger instead gains a WITHDRAWAL ROW, which is migration
 * 016's own design: a grant is a row, a withdrawal is a row, and the newest row
 * is the answer.
 *
 * ── the device set is DERIVED, never accepted ─────────────────────────────
 *
 * The follower's turns live under one synthetic device per thread. The set is
 * computed from their own thread rows, so there is no parameter anywhere in
 * this file that can name another follower's device, which is the property
 * `roomThreadDevice`'s header describes and the reason it is a derivation.
 */
async function threadDeviceSet(db, roomId, personId, agentId) {
  const rows = await db(
    `select t.thread_id from vy_room_thread t
      where t.room_id = ($1)::uuid and t.person_id = ($2)::uuid and t.agent_id = ($3)::uuid`,
    [String(roomId), String(personId), String(agentId)],
  );
  return [
    roomThreadDevice(roomId, personId, null),
    ...rows.map((r) => roomThreadDevice(roomId, personId, r.thread_id)),
  ];
}

/** The manifest, as it applies to this database. A seam for `tableApplied`'s
 *  reason rather than for convenience: `activePersonTables` probes the live
 *  catalog through api/memory.js's own `q`, which a fake db cannot reach. */
const personTablesFor = (deps) => (deps.personTables ?? activePersonTables)();

/** WS-R12's own version of the seam above, for the one migration (077) that
 *  ships in the same change as the code that reads its presence: injectable
 *  so an offline eval can prove the gated write/delete happens without a live
 *  database to probe. */
const isTableAppliedFor = (deps) => deps.tableApplied ?? tableApplied;

/** The agent-scoped rows of the manifest, which is the only part of it a
 *  creator's Room may touch. */
async function roomScopedTables(deps) {
  return (await personTablesFor(deps)).filter((t) => t.agent === true);
}

/**
 * WS-R27 (migration 090). Nine Room-scoped person-lane tables landed after
 * WS-R1's original two (`vy_room_thread`/`vy_room_follower`, both `agent:
 * true` and already covered by `roomScopedTables()`'s loop above) - none of
 * them carries an `agent_id` column (every one of the comments in
 * api/memory.js's PERSON_TABLES states the same reason: agent context is
 * joined from `vy_room`), so none of them was ever reachable through that
 * loop, and until this workstream `roomExport` never named a single one.
 * Listed exactly once, here, so `roomExport`, `roomExportManifest` and
 * `evals/room-export/run.mjs`'s static battery cannot drift about which of
 * them is a full ROW export (the follower's own content, theirs to see
 * verbatim) versus a COUNT (a ledger whose content already IS a count, per
 * the workstream brief's own words: "the delivery ledger and the day counts
 * belong in the export as counts").
 */
const ROOM_EXPORT_EXTRA = Object.freeze([
  { table: "vy_room_checkin", shape: "rows",
    reason: "the follower's own check-in schedule (days, time, timezone) - theirs to see in full" },
  { table: "vy_room_subscription", shape: "rows",
    reason: "the follower's own subscription record - theirs to see in full" },
  { table: "vy_room_pulse_optin", shape: "rows",
    reason: "the follower's own opt-in decision - theirs to see in full" },
  { table: "vy_room_follower_channel", shape: "rows",
    reason: "the follower's own Telegram binding - theirs to see in full" },
  { table: "vy_room_push_subscription", shape: "rows",
    reason: "the follower's own push registration - theirs to see in full" },
  { table: "vy_room_handoff", shape: "rows",
    reason: "the follower's own verbatim ask and the creator's own verbatim reply to it - " +
      "083's own exception to 'never a word' restated, theirs to see in full" },
  // WS-R30 (migration 093). Content-free (`reason`/`outcome` are both closed
  // enums, never a word the follower typed), but every row IS a record of
  // when this follower was offered an upgrade and what they did about it -
  // exactly this manifest's own bar, `vy_room_subscription`'s reasoning one
  // row up restated for a ledger instead of a mandate.
  { table: "vy_room_upgrade_offer", shape: "rows",
    reason: "the follower's own upgrade-offer history (when, why, and what happened) - theirs to see in full" },
  { table: "vy_room_follower_day", shape: "count",
    reason: "a day-count ledger (turns per day) - the export already states how many days " +
      "and how many turns; a row-by-row dump would say nothing more" },
  { table: "vy_room_checkin_delivery", shape: "count",
    reason: "a content-free delivery ledger (079's own law) - exported as counts per " +
      "delivery state, never a row" },
  { table: "vy_room_voice_usage", shape: "count",
    reason: "a day-count ledger (seconds and clips per day) - same reasoning as " +
      "vy_room_follower_day above" },
  // WS-R29 (migration 092). Neither a full row dump nor a bare count: the
  // follower's own phone number is theirs to confirm ("is this still the
  // right number") but not theirs to have handed BACK in full over an
  // export payload that could sit in a downloaded file indefinitely - the
  // workstream brief's own words, "counts and the masked number".
  { table: "vy_room_follower_whatsapp", shape: "masked_phone",
    reason: "the follower's own WhatsApp opt-in - a masked number and its state, " +
      "never the number in full" },
]);

/** `api/_room-whatsapp.js`'s own function, re-derived here rather than
 *  imported - this house's standing convention (`api/_room-push.js`'s
 *  `followerScope`, `api/_checkins.js`'s own copy of the same) so this file
 *  never has to import a sibling that itself imports THIS file (`_room-
 *  whatsapp.js` imports `resolveRoom`/`followerRow`/`readRoomSession` from
 *  here), which would make the two modules' load order matter for no reason
 *  a one-line pure function is worth risking. */
function maskPhoneForExport(phone) {
  const p = String(phone || "");
  const m = p.match(/^\+(\d{6,15})$/);
  if (!m) return "";
  const digits = m[1];
  const head = digits.slice(0, 2);
  const tail = digits.slice(-2);
  const middleLen = digits.length - head.length - tail.length;
  return `+${head} ${"•".repeat(Math.max(0, middleLen))}${tail}`;
}

export async function roomExport(db, { session }, deps = {}) {
  const who = await selfScope(db, session, deps);
  const devices = await threadDeviceSet(db, who.roomId, who.personId, who.agentId);
  const tables = {};
  for (const t of await roomScopedTables(deps)) {
    const params = wipeParams(t, { device: devices, person: who.personId });
    // `wipeWhere` is deliberately NOT applied on the read side, api/export.js's
    // own rule: a row held together with somebody else is still this person's
    // to RECEIVE, it is just not theirs to destroy. So the ownership half is
    // rebuilt from the SAME two generators `wipeWhereSql` is built from rather
    // than sliced back out of its output - a string surgery that has to know
    // where one clause ends is a string surgery that breaks on the first
    // manifest entry with a parenthesis in it.
    const rows = await db(
      `select * from ${t.table} where ${ownershipSql(t)} and agent_id = ($${params.length + 1})::uuid limit 5000`,
      [...params, who.agentId],
    ).catch(() => []);
    if (rows.length) tables[t.table] = rows;
  }
  // WS-R27: the nine extras above. Gated per table, `isTableAppliedFor`'s
  // same seam `roomForget` below already uses - a database that has not
  // applied a later Room migration yet gets a smaller-but-honest export
  // rather than a 500.
  for (const e of ROOM_EXPORT_EXTRA) {
    if (!(await isTableAppliedFor(deps)(e.table))) continue;
    if (e.shape === "rows") {
      const rows = await db(
        `select * from ${e.table} where room_id = ($1)::uuid and person_id = ($2)::uuid limit 5000`,
        [who.roomId, who.personId],
      ).catch(() => []);
      if (rows.length) tables[e.table] = rows;
    } else if (e.shape === "masked_phone") {
      // MASKED_PHONE shape (WS-R29): a count, a state, and the number with
      // its middle digits replaced - never the number in full, `e.reason`
      // states why. At most one row (migration 092's own primary key).
      const rows = await db(
        `select phone_e164, state from ${e.table} where room_id = ($1)::uuid and person_id = ($2)::uuid limit 1`,
        [who.roomId, who.personId],
      ).catch(() => []);
      if (rows.length) {
        tables[e.table] = { count: rows.length, state: rows[0].state, phone_masked: maskPhoneForExport(rows[0].phone_e164) };
      }
    } else {
      // COUNT shape: one number, never the rows themselves - `e.reason`
      // states why for this table.
      const rows = await db(
        `select count(*)::int as n from ${e.table} where room_id = ($1)::uuid and person_id = ($2)::uuid`,
        [who.roomId, who.personId],
      ).catch(() => []);
      const n = Number(rows[0]?.n);
      if (Number.isFinite(n) && n > 0) tables[e.table] = { count: n };
    }
  }
  return {
    format: "vyakti-room-export/1",
    exported_at: new Date(deps.now ?? Date.now()).toISOString(),
    room: who.slug,
    person_id: who.personId,
    scope: "this room only",
    note:
      "Everything this creator's AI holds about you. Your account, your device " +
      "links and your conversations with other creators are not in here because " +
      "this creator's AI does not hold them.",
    tables,
  };
}

/**
 * WS-R27. Every table `roomExport` reaches, agent-scoped rows plus the nine
 * extras above - one list, so `evals/room-export/run.mjs`'s completeness
 * battery has a single authority to compare against `PERSON_TABLES` rather
 * than reading `roomExport`'s own source a second time and risking drift
 * between what the battery THINKS the function does and what it actually
 * does. Async and `deps`-shaped identically to `roomScopedTables`, for the
 * same reason: the agent-scoped half is genuinely dynamic (it depends on
 * which migrations this database has applied), so a static list here would
 * either duplicate that logic or silently under-report it.
 */
export async function roomExportManifest(deps = {}) {
  const scoped = await roomScopedTables(deps);
  return [...scoped.map((t) => t.table), ...ROOM_EXPORT_EXTRA.map((e) => e.table)];
}

/** The ownership half of `wipeWhereSql`, and NOTHING else: the owning columns
 *  OR'd together, over the device SET. Built from api/memory.js's own `keysOf`
 *  and `ownerEq`, which is what makes this the same clause the forget path uses
 *  rather than a second reading of the manifest. */
function ownershipSql(t) {
  return `(${keysOf(t)
    .map((k, i) => ownerEq(k, `$${i + 1}`, true))
    .join(" or ")})`;
}

export async function roomForget(db, { session }, deps = {}) {
  const who = await selfScope(db, session, deps);
  const devices = await threadDeviceSet(db, who.roomId, who.personId, who.agentId);
  const deleted = {};

  // ── WS-R27: EVERY explicit statement below runs CHILD BEFORE PARENT ───────
  //
  // `vy_room_thread` and `vy_room_follower` are deleted at the BOTTOM of this
  // function, not the top, and every table below carries `follower_id
  // references vy_room_follower(follower_id) on delete cascade` and/or
  // `thread_id references vy_room_thread(thread_id) on delete cascade`. This
  // used to be the other way round - thread/follower deleted first, every
  // other table's own explicit delete running after - which meant Postgres's
  // OWN cascade had already removed every row before this function's later
  // statements ever ran: the end state was correct (the rows really were
  // gone) but every one of those statements' `rows.length` was unconditionally
  // zero, so `deleted.vy_room_checkin`/`vy_room_voice_usage`/`vy_room_handoff`
  // etc. lied about how many rows a real forget had just removed. Found while
  // building `evals/room-export/run.mjs`'s dynamic battery (law 2: "the
  // receipt's counts must equal what was deleted"), which is exactly the
  // property this ordering broke. `api/memory.js`'s `PERSON_TABLES` array had
  // the identical bug for the account-wide whole wipe and is reordered in the
  // same change, by the same reasoning, stated at that array's own header.
  if (await isTableAppliedFor(deps)("vy_room_follower_day")) {
    // WS-R12 (migration 077): the retention day-counts, this Room only. No
    // `follower_id`/`thread_id` column at all (071's convention scoped
    // room_id/person_id and 077 added nothing new), so this one has no
    // cascade to race and its position here is not load-bearing the way the
    // rest of this block's is - it stays first only because it always has.
    const dayRows = await db(
      `delete from vy_room_follower_day
        where room_id = ($1)::uuid and person_id = ($2)::uuid
       returning 1 as gone`,
      [who.roomId, who.personId],
    );
    deleted.vy_room_follower_day = dayRows.length;
  }

  if (await isTableAppliedFor(deps)("vy_room_checkin")) {
    // WS-R16 (migration 079): a follower's own check-in schedules, and the
    // content-free delivery ledger behind them, this Room only. DELIVERY
    // BEFORE CHECKIN: `vy_room_checkin_delivery.checkin_id references
    // vy_room_checkin(checkin_id) on delete cascade`, so deleting the checkin
    // row first would cascade its delivery rows away before this statement
    // ever ran, the identical shape this block's own header names.
    const deliveryRows = await db(
      `delete from vy_room_checkin_delivery
        where room_id = ($1)::uuid and person_id = ($2)::uuid
       returning 1 as gone`,
      [who.roomId, who.personId],
    );
    deleted.vy_room_checkin_delivery = deliveryRows.length;
    const checkinRows = await db(
      `delete from vy_room_checkin
        where room_id = ($1)::uuid and person_id = ($2)::uuid
       returning 1 as gone`,
      [who.roomId, who.personId],
    );
    deleted.vy_room_checkin = checkinRows.length;
  }

  if (await isTableAppliedFor(deps)("vy_room_voice_usage")) {
    // WS-R19 (migration 081): the voice usage day-counts, this Room only.
    // Carries `follower_id references vy_room_follower(follower_id) on
    // delete cascade`, so it runs before the follower delete at the bottom.
    const voiceRows = await db(
      `delete from vy_room_voice_usage
        where room_id = ($1)::uuid and person_id = ($2)::uuid
       returning 1 as gone`,
      [who.roomId, who.personId],
    );
    deleted.vy_room_voice_usage = voiceRows.length;
  }

  if (await isTableAppliedFor(deps)("vy_room_subscription")) {
    // WS-R27 (migration 078): a follower's own subscription, this Room only
    // - and ONLY a subscription already in a terminal state, api/memory.js's
    // `vy_room_subscription` PERSON_TABLES entry's own `wipeWhere` restated
    // rather than loosened: a UPI Autopay mandate keeps debiting a real bank
    // account whether or not this table still names it, so this statement
    // may not remove a LIVE subscription any more than the account-wide
    // wipe's identical restriction may - an automatic provider-cancel wired
    // into either wipe is Phase 1 work, an owner decision, not this
    // workstream's.
    //
    // What this statement cannot prevent, stated rather than hidden: the
    // table's OWN `follower_id references vy_room_follower(follower_id) on
    // delete cascade` means the follower-row delete at the bottom of this
    // function removes EVERY subscription row for this follower regardless
    // of state, live one included, the moment it runs - a pre-existing
    // schema fact this workstream did not introduce and does not fix (see
    // `context/decisions.md#ws-r27-subscription-cascade-still-reaches-a-live-row`).
    // This statement's count is honest about what IT safely removed; it is
    // not a claim that nothing else happened to this table a moment later.
    const subRows = await db(
      `delete from vy_room_subscription
        where room_id = ($1)::uuid and person_id = ($2)::uuid
          and state in ('cancelled','expired')
       returning 1 as gone`,
      [who.roomId, who.personId],
    );
    deleted.vy_room_subscription = subRows.length;
  }

  if (await isTableAppliedFor(deps)("vy_room_pulse_optin")) {
    // WS-R17 (migration 080): Pulse's own toggle, this Room only. A full
    // delete rather than merely setting `revoked_at`: the row is
    // content-free either way, and this is the follower's OWN "forget me in
    // this room" - the honest answer is that nothing of theirs is left,
    // including the record that they once toggled it. Carries a nullable
    // `thread_id references vy_room_thread(thread_id) on delete cascade`, so
    // it runs before the thread delete below.
    const pulseRows = await db(
      `delete from vy_room_pulse_optin
        where room_id = ($1)::uuid and person_id = ($2)::uuid
       returning 1 as gone`,
      [who.roomId, who.personId],
    );
    deleted.vy_room_pulse_optin = pulseRows.length;
  }

  if (await isTableAppliedFor(deps)("vy_room_follower_channel")) {
    // WS-R27 (migration 082): which Telegram chat currently means this Room,
    // for this follower. Previously reached ONLY by the
    // `follower_id references vy_room_follower(follower_id) on delete
    // cascade` this table already carries (082's own header) - real, but
    // uncounted: the row really was deleted, and the receipt never said so.
    // Named explicitly here instead, `roomForget`'s own "a delete nobody can
    // see the size of is a delete nobody can tell happened" applied to a row
    // this function was already deleting, just not by name.
    const channelRows = await db(
      `delete from vy_room_follower_channel
        where room_id = ($1)::uuid and person_id = ($2)::uuid
       returning 1 as gone`,
      [who.roomId, who.personId],
    );
    deleted.vy_room_follower_channel = channelRows.length;
  }

  if (await isTableAppliedFor(deps)("vy_room_push_subscription")) {
    // WS-R27 (migration 085): a follower's own push registration, this Room
    // only. `vy_room_follower_channel`'s exact reasoning restated one table
    // over - previously cascade-only and uncounted, named explicitly now.
    const pushRows = await db(
      `delete from vy_room_push_subscription
        where room_id = ($1)::uuid and person_id = ($2)::uuid
       returning 1 as gone`,
      [who.roomId, who.personId],
    );
    deleted.vy_room_push_subscription = pushRows.length;
  }

  if (await isTableAppliedFor(deps)("vy_room_follower_whatsapp")) {
    // WS-R29 (migration 092): a follower's own WhatsApp check-in opt-in,
    // this Room only. `vy_room_push_subscription`'s exact reasoning restated
    // one channel over - carries `follower_id references vy_room_follower
    // (follower_id) on delete cascade`, so it runs before the follower
    // delete below; named explicitly rather than left to the cascade alone.
    const waRows = await db(
      `delete from vy_room_follower_whatsapp
        where room_id = ($1)::uuid and person_id = ($2)::uuid
       returning 1 as gone`,
      [who.roomId, who.personId],
    );
    deleted.vy_room_follower_whatsapp = waRows.length;
  }

  if (await isTableAppliedFor(deps)("vy_room_handoff")) {
    // WS-R20 (migration 083): Handoff. A departure from every content-free
    // sibling above in one respect worth naming: the rows this deletes carry
    // the follower's own verbatim words and the creator's own verbatim
    // reply to them (083's own header states why that exception exists at
    // all) - "forget me in this room" takes both, exactly as it takes every
    // other trace of the relationship. Carries BOTH `follower_id` and a
    // nullable `thread_id`, each `references ... on delete cascade`, so it
    // runs before BOTH the follower and the thread deletes below - this was
    // the clearest instance of the ordering bug this function's own header
    // names, since this statement already existed and simply ran too late
    // to ever count anything.
    const handoffRows = await db(
      `delete from vy_room_handoff
        where room_id = ($1)::uuid and person_id = ($2)::uuid
       returning 1 as gone`,
      [who.roomId, who.personId],
    );
    deleted.vy_room_handoff = handoffRows.length;
  }

  if (await isTableAppliedFor(deps)("vy_room_upgrade_offer")) {
    // WS-R30 (migration 093): the upgrade-offer ledger, this Room only.
    // Content-free (a reason, an outcome, two timestamps), but still this
    // follower's own record - `roomExport`'s own entry above states why it
    // is exported at all. Carries `follower_id references
    // vy_room_follower(follower_id) on delete cascade`, so it runs before
    // the follower delete at the bottom of this function, this block's own
    // child-before-parent rule.
    const offerRows = await db(
      `delete from vy_room_upgrade_offer
        where room_id = ($1)::uuid and person_id = ($2)::uuid
       returning 1 as gone`,
      [who.roomId, who.personId],
    );
    deleted.vy_room_upgrade_offer = offerRows.length;
  }

  // The agent-scoped rows (`vy_fact` et al., via `roomScopedTables()`) carry
  // no dependency on thread or follower - `agent_id` is their own scope, not
  // a foreign key to either - so their position relative to the two below is
  // not load-bearing; run here, ahead of the last two, out of habit rather
  // than necessity.
  for (const t of await roomScopedTables(deps)) {
    const where = wipeWhereSql(t, { deviceSet: true });
    const params = wipeParams(t, { device: devices, person: who.personId });
    // NOT catch-wrapped, api/memory.js's rule: the receipt may only be sent
    // once the delete actually happened, so a failed statement must fail the
    // whole op loudly rather than leave a receipt that is not true.
    const rows = await db(
      `delete from ${t.table} where ${where} and agent_id = ($${params.length + 1})::uuid returning 1 as gone`,
      [...params, who.agentId],
    );
    deleted[t.table] = rows.length;
  }

  // The topic threads, THEN the membership row itself - the two roots every
  // table above (except the day-count and the agent-scoped loop) cascades
  // from, so they are last. The ROOM is untouched: a follower's forget is not
  // a creator's takedown, and deleting vy_room here would take the room away
  // from everyone else in it.
  const threads = await db(
    `delete from vy_room_thread
      where room_id = ($1)::uuid and person_id = ($2)::uuid and agent_id = ($3)::uuid
     returning 1 as gone`,
    [who.roomId, who.personId, who.agentId],
  );
  deleted.vy_room_thread = threads.length;
  const membership = await db(
    `delete from vy_room_follower
      where room_id = ($1)::uuid and person_id = ($2)::uuid and agent_id = ($3)::uuid
     returning 1 as gone`,
    [who.roomId, who.personId, who.agentId],
  );
  deleted.vy_room_follower = membership.length;

  // THE WITHDRAWAL, appended rather than deleted. 016's content law and its
  // append-only law both point here: the ledger is evidence, and a withdrawal
  // that overwrote its own grant would destroy the record of the thing being
  // withdrawn. The rows keep their device ids, which stay in this person's own
  // `vy_person_device` mapping, so an account-wide wipe still takes them later.
  const at = new Date(deps.now ?? Date.now()).toISOString();
  for (const device of devices) {
    await recordRoomConsent(db, {
      device,
      authUserId: null,
      kind: ROOM_CONSENT_MEMORY,
      granted: false,
      at,
    });
  }

  // THE RECEIPT (migration 090, WS-R27). Written LAST, after every delete
  // above has committed, so its counts are true rather than a promise made
  // before the deletes ran - the one INSERT in this function gets the same
  // "only sent once the delete actually happened" discipline every DELETE
  // above already has, just from the other direction. `person_hash` never
  // `person_id` (`roomForgetReceiptHash`'s own header states why); `counts`
  // is a literal copy of `deleted` (WS-R27 law 1: the receipt's counts and
  // this response's counts must be the same claim, not two). Gated on its
  // own migration exactly as every table above it that shipped after this
  // file did - an ungated INSERT here would 500 every follower's forget the
  // moment this code deploys ahead of migration 090.
  let receipt = null;
  if (await isTableAppliedFor(deps)("vy_room_forget_receipt")) {
    const receiptId = deps.newId ? deps.newId() : randomUUID();
    const personHash = roomForgetReceiptHash(who.roomId, who.personId, ROOM_FORGET_RECEIPT_POLICY_VERSION);
    await db(
      `insert into vy_room_forget_receipt (receipt_id, room_id, person_hash, policy_version, counts, issued_at)
       values (($1)::uuid, ($2)::uuid, $3, ($4)::int4, $5::jsonb, ($6)::timestamptz)`,
      [receiptId, who.roomId, personHash, ROOM_FORGET_RECEIPT_POLICY_VERSION, JSON.stringify(deleted), at],
    );
    receipt = {
      receipt_id: receiptId,
      room: who.slug,
      person_hash: personHash,
      policy_version: ROOM_FORGET_RECEIPT_POLICY_VERSION,
      counts: { ...deleted },
      issued_at: at,
    };
  }

  return {
    forgotten: true,
    scope: "this room only",
    room: who.slug,
    // COUNTS, per table, because a delete nobody can see the size of is a
    // delete nobody can tell happened.
    deleted,
    // The one row that survives this request. `null` only on a database that
    // has not yet applied migration 090 - never because the write failed,
    // since a failed write throws before this function returns at all.
    receipt,
    // WS-R24: `who.locale` was read off the follower row BEFORE this
    // function deleted it, `selfScope`'s own header explains why - this is
    // the one app-voiced string in this file whose only reader today is a
    // Telegram card (`forgottenCard`), so it is localized the same way every
    // other card here is rather than left the one English string among them.
    note:
      who.locale === "hi"
        ? "इस क्रिएटर के AI के साथ आपकी बातचीत मिटा दी गई है। आपका अकाउंट और आपकी किसी और के साथ की बातचीत अछूती है।"
        : "Your conversations with this creator's AI are deleted. Your account and " +
          "your conversations with anyone else are untouched.",
  };
}

/** The only way this file names a person: from the caller's OWN signed session,
 *  never from a request field. A person id in a JSON body is not identity
 *  proof - api/_auth.js's first law, restated here because this is the lane
 *  where getting it wrong hands one follower another follower's whole history. */
async function selfScope(db, session, deps) {
  const payload = readRoomSession(session, deps.env);
  assertSessionFresh(payload, deps.now ?? Date.now());
  const resolved = await resolveRoom(db, payload.r, deps);
  if (String(resolved.room.room_id) !== String(payload.i)) throw roomUnavailable();
  const follower = await followerRow(db, resolved.room.room_id, payload.p, resolved.agentId);
  // WS-R38: this used to check only `!follower`, unlike every sibling scope
  // resolver (`roomSay`, `_handoff.js`/`_checkins.js`/`_room-whatsapp.js`'s
  // own `followerScope`), which all also require attestation. Harmless today
  // (nothing in this file inserts a `vy_room_follower` row without one — see
  // `joinRoom`), but this is the ONE gate export/forget/offer_dismiss run
  // through, so it is the one place that omission would matter most.
  if (!follower || follower.age_attested_at == null) throw new RoomError("room_join_required", 403);
  return {
    personId: String(payload.p),
    agentId: String(resolved.agentId),
    roomId: String(resolved.room.room_id),
    slug: String(resolved.room.slug),
    device: roomThreadDevice(resolved.room.room_id, payload.p, null),
    // WS-R24: captured HERE, before `roomForget` deletes the row this came
    // from, so the app-voiced note it returns can still be honestly localized
    // after the follower who asked for it no longer has a row to read it off.
    locale: normalizeLocale(follower.locale),
  };
}

// ─────────────────────────────────────────────────────────────────────────
// OP: offer_dismiss - WS-R30 (migration 093)
// ─────────────────────────────────────────────────────────────────────────

/**
 * "Continue free." Marks the follower's own most recent open offer
 * `dismissed`. No `offer_id` in the request body - scope comes off the
 * SESSION exactly as "thread"/"pulse_optin" do (`api/room.js`'s own rule),
 * so a follower cannot name a different offer even by constructing the
 * request by hand. `markOfferOutcome` (api/_phase-gate.js) does the actual
 * write; this function only derives the follower's own `follower_id` from
 * the verified session, the way every other self-scoped op here does.
 */
export async function roomDismissOffer(db, { session }, deps = {}) {
  const who = await selfScope(db, session, deps);
  const follower = await followerRow(db, who.roomId, who.personId, who.agentId);
  if (!follower) throw new RoomError("room_join_required", 403);
  const row = await markOfferOutcome(db, {
    followerId: follower.follower_id, outcome: "dismissed", now: deps.now ?? Date.now(),
  });
  return { dismissed: Boolean(row) };
}

// ─────────────────────────────────────────────────────────────────────────
// CITATIONS - "where did you get that?"
// ─────────────────────────────────────────────────────────────────────────

/**
 * The honest answer, and it is deliberately narrower than the question.
 *
 * THE ENGINE DOES NOT EXPOSE PER-REPLY CITATIONS ON THIS PATH. `vy_fact` has a
 * `citations` column and it cites EPISODES of the follower's own conversation,
 * which is provenance for what the follower said, not for what the creator
 * taught. Nothing in `compile()` returns which of the creator's material a
 * sentence drew on, and inventing a mapping here would be a plausible return
 * hiding a dead pipeline: a citation that looks like evidence and is a guess.
 *
 * So this returns what is TRUE and says exactly that: the material came from
 * this creator, and here are the names of the pieces of it that are in the
 * Context Locker. `source_name` is what the creator typed when they added it.
 * The day the engine carries per-reply provenance, this function narrows from
 * "their material" to "this piece of it" and the client changes nothing.
 */
export async function roomCitations(db, { session }, deps = {}) {
  const payload = readRoomSession(session, deps.env);
  // WS-R38: this door used to skip BOTH checks every other session-consuming
  // op runs — no freshness check, and no confirmation a follower row for this
  // (room, person, agent) still exists at all. A signed-but-stale token, or
  // one for a person who has since `forget`-left this Room, could still list
  // the creator's own source titles forever.
  assertSessionFresh(payload, deps.now ?? Date.now());
  const resolved = await resolveRoom(db, payload.r, deps);
  if (String(resolved.room.room_id) !== String(payload.i)) throw roomUnavailable();
  const follower = await followerRow(db, resolved.room.room_id, payload.p, resolved.agentId);
  if (!follower || follower.age_attested_at == null) throw new RoomError("room_join_required", 403);
  const rows = await db(
    `select c.source_name
       from vy_context_item c
      where c.replica_id = ($1)::uuid
        and c.owner_user_id = ($2)::uuid
        and c.status in ('mined','routed')
        and c.source_name <> ''
      order by c.created_at desc
      limit ${ROOM_CITATION_SOURCES}`,
    [String(resolved.room.replica_id), String(resolved.room.owner_user_id)],
  );
  return {
    name: roomNameFor(resolved.sheet),
    // A count and a handful of names. Never a chunk, never a passage, never a
    // score: the creator's material is theirs and a citation endpoint is not a
    // way to read it out of the product.
    sources: rows.map((r) => String(r.source_name).slice(0, 120)),
    exact: false,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// ROOM STATS - one number, and only if it is real
// ─────────────────────────────────────────────────────────────────────────

/**
 * "n people talked today", and nothing else, ever.
 *
 * DESIGN-LAW's no-fake-numbers rule is the floor and this function's whole
 * shape is it: it returns the count or it returns null, and null renders
 * nothing rather than a zero that looks like a measurement. A count is also the
 * ONLY statistic this product's three-scope rule permits a creator to see -
 * anything per-follower is the reveal the Room exists to refuse - and that is
 * why there is no second function here to grow.
 */
export async function roomStats(db, { slug }, deps = {}) {
  const resolved = await resolveRoom(db, slug, deps);
  const rows = await db(
    `select count(*)::int as n
       from vy_room_follower f
      where f.room_id = ($1)::uuid
        and f.last_seen_at >= now() - interval '24 hours'`,
    [String(resolved.room.room_id)],
  );
  const n = Number(rows[0]?.n);
  return { talked_today: Number.isFinite(n) ? n : null };
}
