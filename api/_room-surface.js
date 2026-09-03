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
import { activePersonTables, keysOf, ownerEq, wipeWhereSql, wipeParams, tableApplied } from "./memory.js";

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
export function roomDisclosureCard(creatorName) {
  const name = String(creatorName || "").trim() || "this creator";
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
export function mintFollowerSession(resolved, personId, { now = Date.now(), env } = {}) {
  const disclosure = roomDisclosureCard(roomNameFor(resolved.sheet));
  return mintRoomSession(
    {
      r: resolved.room.slug,
      i: String(resolved.room.room_id),
      p: String(personId),
      a: String(resolved.agentId),
      dd: sha(disclosure),
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
            r.display_name, r.free_monthly_messages, r.published_at, a.slug as agent_slug
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
            f.month_key, f.month_message_count, f.last_seen_at
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
  const cap = Number(room?.free_monthly_messages ?? ROOM_FREE_MONTHLY_MESSAGES);
  const key = monthKeyOf(at);
  const used = row.month_key === key ? Number(row.month_message_count || 0) : 0;
  return {
    joined_at: row.joined_at ?? null,
    tier: row.tier === "paid" ? "paid" : "free",
    remembers: row.memory_consent_at != null,
    messages_used: used,
    messages_included: cap,
    messages_left: row.tier === "paid" ? null : Math.max(0, cap - used),
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
 */
export async function openRoom(db, { slug, authUserId = null, personId: givenPersonId = null }, deps = {}) {
  const resolved = await resolveRoom(db, slug, deps);
  const name = roomNameFor(resolved.sheet);
  const disclosure = roomDisclosureCard(name);
  const now = deps.now ?? Date.now();
  const out = {
    room: {
      slug: resolved.room.slug,
      display_name: resolved.room.display_name || name,
      name,
    },
    // The bytes the page MUST render, returned as DATA, in the app's voice,
    // never generated by the model.
    disclosure,
    joined: false,
    follower: null,
    session: null,
  };
  if (!authUserId && !givenPersonId) return out;

  const personId = authUserId ? await personForAccount(db, authUserId) : String(givenPersonId);
  const follower = await followerRow(db, resolved.room.room_id, personId, resolved.agentId);
  // An attestation that never happened is not a join, whatever else the row
  // says. Fail toward "ask again" rather than toward "already answered".
  if (!follower || follower.age_attested_at == null) return out;
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
  { slug, authUserId = null, personId: givenPersonId = null, ageAttested, memoryConsent },
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

  const rows = await db(
    `insert into vy_room_follower
       (follower_id, room_id, person_id, agent_id, age_attested_at, memory_consent_at,
        tier, month_key, month_message_count, last_seen_at)
     values (($1)::uuid, ($2)::uuid, ($3)::uuid, ($4)::uuid, ($5)::timestamptz, ($6)::timestamptz,
             'free', $7, 0, now())
     on conflict (room_id, person_id) do update
        set age_attested_at = coalesce(vy_room_follower.age_attested_at, excluded.age_attested_at),
            -- the memory answer is REPLACED, not coalesced: this op is also how
            -- a follower changes their mind, and a coalesce would make the
            -- first answer permanent, which is the one thing a consent record
            -- may never be.
            memory_consent_at = excluded.memory_consent_at,
            last_seen_at = now(),
            updated_at = now()
     returning follower_id, room_id, person_id, agent_id, joined_at, age_attested_at,
               memory_consent_at, tier, month_key, month_message_count, last_seen_at`,
    [
      randomUUID(),
      String(resolved.room.room_id),
      personId,
      String(resolved.agentId),
      at,
      memoryConsent ? at : null,
      monthKeyOf(now),
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

  const disclosure = roomDisclosureCard(roomNameFor(resolved.sheet));
  return {
    joined: true,
    follower: clientFollower(follower, resolved.room, now),
    threads: await listThreads(db, resolved.room.room_id, personId, resolved.agentId),
    session: mintRoomSession(
      {
        r: resolved.room.slug,
        i: String(resolved.room.room_id),
        p: personId,
        a: String(resolved.agentId),
        dd: sha(disclosure),
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

/** THE THREAD SCOPE PREDICATE. Person and agent are in the WHERE clause, before
 *  anything is returned - not checked afterwards in JS. This is the clause the
 *  offline suite's negative control STRIKES, and the suite fails unless the
 *  struck copy leaks another follower's thread. */
async function ownedThread(db, roomId, personId, agentId, threadId) {
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
  if (!Number.isFinite(payload.iat) || now - payload.iat > ROOM_SESSION_TTL_MS) {
    throw new RoomError("room_session_expired", 401);
  }
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
  const disclosure = roomDisclosureCard(name);
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
        and (f.tier <> 'free'
             or f.month_key <> $4
             or f.month_message_count < r.free_monthly_messages)
     returning f.month_key, f.month_message_count, f.tier, r.free_monthly_messages`,
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
    throw new RoomError("room_free_cap_reached", 402, {
      messages_included: Number(resolved.room.free_monthly_messages ?? ROOM_FREE_MONTHLY_MESSAGES),
    });
  }
  const used = Number(spent[0].month_message_count || 0);
  const included = Number(spent[0].free_monthly_messages ?? ROOM_FREE_MONTHLY_MESSAGES);
  const paid = spent[0].tier === "paid";

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
  const left = paid ? null : Math.max(0, included - used);
  return {
    bubbles: sent,
    reply: said,
    remembers,
    thread_id: thread?.thread_id ?? null,
    quota: { tier: paid ? "paid" : "free", messages_used: used, messages_included: included, messages_left: left },
    // A STATE THE CLIENT RENDERS AT THE END, never an interruption. True only
    // on the last few messages of a free month, so it is a fact about where
    // they are rather than a nudge that fires whenever there is money to be
    // made. NEVER MANIPULATE is the floor and manufactured urgency is the
    // named failure.
    upgrade_prompt: !paid && left !== null && left <= 3,
    session: mintRoomSession(
      { ...payload, td: remembers ? transcriptDigest([]) : transcriptDigest(nextTurns), n: (payload.n | 0) + 1 },
      deps.env,
    ),
    // Counts only, never the strings - `gateReply`'s rule, and the whole point
    // of the event is that what it caught must not travel.
    gate: { applied: gatedOut.gated, findings: gatedOut.findings.length },
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

  // The membership and the thread names. The ROOM is untouched: a follower's
  // forget is not a creator's takedown, and deleting vy_room here would take
  // the room away from everyone else in it.
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

  // WS-R12 (migration 077): the retention day-counts, this Room only. Not in
  // `roomScopedTables()` above - it carries no `agent_id` column (see
  // api/memory.js's PERSON_TABLES comment), so it cannot flow through that
  // loop's generic `and agent_id = (...)::uuid` delete, and is reached here
  // explicitly instead, `vy_room_thread`/`vy_room_follower`'s pattern one
  // statement over. Gated on the migration having landed, `isTableApplied`'s
  // same seam `roomSay` uses above: unlike those two siblings (live since
  // 071, long before this file existed), this table and this delete ship in
  // the same change, so an ungated statement here would 500 every follower's
  // forget the moment this code deploys ahead of its own migration.
  if (await isTableAppliedFor(deps)("vy_room_follower_day")) {
    const dayRows = await db(
      `delete from vy_room_follower_day
        where room_id = ($1)::uuid and person_id = ($2)::uuid
       returning 1 as gone`,
      [who.roomId, who.personId],
    );
    deleted.vy_room_follower_day = dayRows.length;
  }

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

  return {
    forgotten: true,
    scope: "this room only",
    room: who.slug,
    // COUNTS, per table, because a delete nobody can see the size of is a
    // delete nobody can tell happened.
    deleted,
    note:
      "Your conversations with this creator's AI are deleted. Your account and " +
      "your conversations with anyone else are untouched.",
  };
}

/** The only way this file names a person: from the caller's OWN signed session,
 *  never from a request field. A person id in a JSON body is not identity
 *  proof - api/_auth.js's first law, restated here because this is the lane
 *  where getting it wrong hands one follower another follower's whole history. */
async function selfScope(db, session, deps) {
  const payload = readRoomSession(session, deps.env);
  const resolved = await resolveRoom(db, payload.r, deps);
  if (String(resolved.room.room_id) !== String(payload.i)) throw roomUnavailable();
  const follower = await followerRow(db, resolved.room.room_id, payload.p, resolved.agentId);
  if (!follower) throw new RoomError("room_join_required", 403);
  return {
    personId: String(payload.p),
    agentId: String(resolved.agentId),
    roomId: String(resolved.room.room_id),
    slug: String(resolved.room.slug),
    device: roomThreadDevice(resolved.room.room_id, payload.p, null),
  };
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
  const resolved = await resolveRoom(db, payload.r, deps);
  if (String(resolved.room.room_id) !== String(payload.i)) throw roomUnavailable();
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
