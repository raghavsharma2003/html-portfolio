// Handoff v0 (WS-R20, migration 083). A follower asks for the human.
//
// The GroupAI kernel's plan names Handoff as Phase 3. This is v0 inside
// Rooms - the kernel's one law ported as a predicate rather than the kernel
// itself:
//
//   NOTHING a follower said reaches the creator unless the follower chose
//   that exact payload, saw it verbatim, and said yes; and the creator's
//   reply reaches only that follower, in that follower's private thread,
//   marked as the human creator and never as their AI.
//
// Every decision lives here rather than in api/handoff.js, so a fake `db`
// can reach it - `api/_checkins.js` is the pattern this file copies closest
// (owner-scoped design/config ops, follower-scoped session ops, the same
// `followerScope`/`ownedRoomHandle` shape, re-derived rather than imported
// for that file's own stated reason: this module stays reachable with only
// a fake `db`).
//
// ── NO MODEL CALL, ANYWHERE IN THIS FILE ────────────────────────────────
//
// A creator's answer is real human text. It is never compiled, never
// gated through `gatedReply`, and never handed to `think()` - `docs/SURFACES.md`
// §2c's own words, restated for a human reply rather than an AI one: "do
// not write your own honesty gate, and do not deliver around the one that
// is there" describes what NOT sending this through the gate protects
// against in the other direction - the gate exists to catch a MODEL
// inventing something; running a human's own words through it would be
// asking whether Meera's engine approves of what a real person said, which
// is not a question this product ever asks.
//
// ── why a creator's reply never touches meera_log ──────────────────────────
//
// `api/_surface.js`'s `dmHistory` maps every row that is not `role='her'`
// to `"user"` when it feeds the next compile - there is no third bucket.
// Writing a creator's reply into that table under any role value would
// either read back as the AI's own past turn (if `role='her'`, the exact
// harm law 3 forbids: "never fed to the model as if the AI said it") or as
// the FOLLOWER's own past turn (any other role value, `dmHistory`'s binary
// mapping being what it is) - a second, different harm the brief does not
// name but the same shape covers. So `vy_room_handoff.reply_text` is the
// creator's reply's ONLY home: the follower's own `mine` read surfaces it
// tagged `kind:"creator"` (`docs/SURFACES.md`'s "app-voiced" cards are the
// precedent for a message the follower's client renders that never passed
// through the model or the gate), and nothing that compiles a turn for this
// follower's AI ever queries this table. That is what "passes untouched"
// means here: untouched BY not reaching the one door that could touch it.
//
// A later workstream that wants the AI to be able to say "what <Name> told
// you" needs its own, deliberate retrieval wiring (a fact/episode write
// scoped to this follower, gated by api/_disclosure.js exactly as every
// other retrieval is) - not built here, named as explicitly out of scope in
// context/decisions.md.
import { randomUUID, createHash } from "node:crypto";
import {
  RoomError,
  roomUnavailable,
  readRoomSession,
  resolveRoom,
  followerRow,
  ownedThread,
  monthKeyOf,
  roomThreadDevice,
} from "./_room-surface.js";
// The default history reader for `draftHandoffPayload`'s message-pick path -
// `api/_room-surface.js`'s own `DEFAULT_MEMORY.history`, re-derived (not
// imported) so this module needs only a `db` and an optional `deps.memory`
// to be driven offline, `api/_checkins.js`'s own stated reason.
import { dmHistory } from "./_surface.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX64 = /^[0-9a-f]{64}$/;

/** Which wording of "what happens when you send this" the follower saw.
 *  `vy_room_handoff.policy_version` on the row, so a later rewrite of the
 *  payload screen's own words does not silently change what an ALREADY-SENT
 *  row is understood to have consented to. */
export const HANDOFF_POLICY_VERSION = 1;
export const HANDOFF_PAYLOAD_MAX = 4000;
export const HANDOFF_NOTE_MAX = 2000;
export const HANDOFF_REPLY_MAX = 4000;
export const HANDOFF_MESSAGE_PICK_MAX = 5;

export class HandoffError extends Error {
  constructor(code, status = 400, details) {
    super(code);
    this.code = code;
    this.status = status;
    if (details) this.details = details;
  }
}

const sha256Hex = (s) => createHash("sha256").update(String(s), "utf8").digest("hex");

function assertOwnerScope(ownerUserId, replicaId) {
  if (!UUID.test(String(ownerUserId || "")) || !UUID.test(String(replicaId || ""))) {
    throw new HandoffError("handoff_identity_invalid", 400);
  }
}

/** The owner-scoped room handle, carrying the two switches this file's
 *  owner ops read and write. `api/_checkins.js`'s `ownedRoomHandle`
 *  re-derived rather than imported for its own stated reason: this module
 *  stays reachable with only a fake `db`. */
async function ownedRoomHandle(db, ownerUserId, replicaId) {
  const rows = await db(
    `select room_id, owner_user_id, handoff_enabled, handoff_monthly_cap
       from vy_room
      where owner_user_id = ($1)::uuid and replica_id = ($2)::uuid
      limit 1`,
    [String(ownerUserId).toLowerCase(), String(replicaId).toLowerCase()],
  );
  return rows[0] || null;
}

/** The only way this file names a follower: from the caller's OWN signed
 *  room session, never from a request field - api/_checkins.js's
 *  `followerScope`, restated here for its own stated reason (that function
 *  is not exported, and "re-derived rather than imported" is already this
 *  house's convention). */
async function followerScope(db, session, deps) {
  const payload = readRoomSession(session, deps.env);
  const resolved = await resolveRoom(db, payload.r, deps);
  if (String(resolved.room.room_id) !== String(payload.i)) throw roomUnavailable();
  const follower = await followerRow(db, resolved.room.room_id, payload.p, resolved.agentId);
  if (!follower) throw new RoomError("room_join_required", 403);
  return {
    personId: String(payload.p),
    agentId: String(resolved.agentId),
    roomId: String(resolved.room.room_id),
    followerId: String(follower.follower_id),
    follower,
    room: resolved.room,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// OWNER OPS - the switch and the cap
// ─────────────────────────────────────────────────────────────────────────

export async function getHandoffConfig(db, ownerUserId, replicaId) {
  assertOwnerScope(ownerUserId, replicaId);
  const room = await ownedRoomHandle(db, ownerUserId, replicaId);
  if (!room) throw new HandoffError("room_not_found", 404);
  return { enabled: room.handoff_enabled === true, monthly_cap: Number(room.handoff_monthly_cap) };
}

export async function setHandoffConfig(db, ownerUserId, replicaId, { enabled, monthlyCap } = {}) {
  assertOwnerScope(ownerUserId, replicaId);
  const cap = Number(monthlyCap);
  if (!Number.isInteger(cap) || cap < 0 || cap > 50) throw new HandoffError("handoff_cap_invalid", 400);
  const room = await ownedRoomHandle(db, ownerUserId, replicaId);
  if (!room) throw new HandoffError("room_not_found", 404);
  const rows = await db(
    `update vy_room
        set handoff_enabled = ($3)::boolean, handoff_monthly_cap = ($4)::int4, updated_at = now()
      where room_id = ($1)::uuid and owner_user_id = ($2)::uuid
      returning room_id, handoff_enabled, handoff_monthly_cap`,
    [room.room_id, ownerUserId, enabled === true, cap],
  );
  if (!rows[0]) throw new HandoffError("room_not_found", 404);
  return { enabled: rows[0].handoff_enabled === true, monthly_cap: Number(rows[0].handoff_monthly_cap) };
}

/**
 * Counts first, then one request at a time - the workstream brief's own
 * words. `next` is the oldest 'sent' row WHOSE STORED HASH STILL MATCHES ITS
 * STORED TEXT, recomputed by Postgres on every read
 * (`encode(digest(payload_text,'sha256'),'hex') = payload_sha256`) rather
 * than trusted from the write - api/_disclosure.js's own discipline, "a
 * predicate, not a promise," restated for a consent boundary instead of a
 * group-membership one. This IS the ONE creator-facing read of a follower's
 * own words anywhere in this file, and evals/room-leak/run.mjs's
 * HANDOFF_CONSENTED_ONLY class exists to keep it that way.
 */
export async function handoffQueue(db, ownerUserId, replicaId) {
  assertOwnerScope(ownerUserId, replicaId);
  const room = await ownedRoomHandle(db, ownerUserId, replicaId);
  if (!room) throw new HandoffError("room_not_found", 404);
  const counted = await db(
    `select state, count(*)::int as n
       from vy_room_handoff
      where room_id = ($1)::uuid
      group by state`,
    [room.room_id],
  );
  const counts = { drafted: 0, sent: 0, answered: 0, withdrawn: 0 };
  for (const row of counted) if (row.state in counts) counts[row.state] = Number(row.n);

  const next = await db(
    `select handoff_id, thread_id, payload_text, policy_version, sent_at
       from vy_room_handoff
      where room_id = ($1)::uuid
        and state = 'sent'
        and payload_sha256 = encode(digest(payload_text, 'sha256'), 'hex')
      order by sent_at asc
      limit 1`,
    [room.room_id],
  );
  return {
    counts,
    next: next[0]
      ? {
          handoff_id: next[0].handoff_id,
          thread_id: next[0].thread_id,
          payload_text: next[0].payload_text,
          policy_version: next[0].policy_version,
          sent_at: next[0].sent_at,
        }
      : null,
  };
}

/**
 * Write once, answer once. The UPDATE carries the SAME hash-match predicate
 * `handoffQueue` reads by, so a tampered or already-answered row cannot be
 * answered even by a caller who already had its `handoff_id` - the write
 * path is gated by the identical predicate as the read path, not a weaker
 * cousin of it.
 */
export async function answerHandoff(db, ownerUserId, replicaId, handoffId, { replyText } = {}) {
  assertOwnerScope(ownerUserId, replicaId);
  if (!UUID.test(String(handoffId || ""))) throw new HandoffError("handoff_id_invalid", 400);
  const reply = String(replyText ?? "").trim();
  if (!reply) throw new HandoffError("handoff_reply_required", 400);
  if (reply.length > HANDOFF_REPLY_MAX) throw new HandoffError("handoff_reply_too_long", 400);
  const room = await ownedRoomHandle(db, ownerUserId, replicaId);
  if (!room) throw new HandoffError("room_not_found", 404);
  const rows = await db(
    `update vy_room_handoff
        set reply_text = $3, state = 'answered', answered_at = now(), updated_at = now()
      where handoff_id = ($1)::uuid and room_id = ($2)::uuid
        and state = 'sent'
        and payload_sha256 = encode(digest(payload_text, 'sha256'), 'hex')
      returning handoff_id, thread_id, person_id, follower_id, state, answered_at`,
    [handoffId, room.room_id, reply],
  );
  if (!rows[0]) throw new HandoffError("handoff_not_answerable", 404);
  return {
    handoff_id: rows[0].handoff_id,
    thread_id: rows[0].thread_id,
    state: rows[0].state,
    answered_at: rows[0].answered_at,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// FOLLOWER OPS - their own scope only
// ─────────────────────────────────────────────────────────────────────────

/**
 * The verbatim payload screen's own text and hash. PURE - no write, no
 * `vy_room_handoff` row - "draft" is the follower deciding what would be
 * sent, not the act of sending it, api/_checkins.js's `validateSchedule`
 * shape (a pure check before the one statement that writes).
 *
 * `messageIndexes`, not raw client-supplied text: the follower's OWN turns
 * for this thread are re-read from the server's own history
 * (`deps.memory.history`, the identical seam `roomSay`/`followerHistory`
 * use) and filtered to `role === "user"` - their own words, never the AI's -
 * before any index is honoured. A client that sent arbitrary text here
 * would not be picking "which of their own messages": it would be
 * dictating a payload with no relationship to anything they actually said,
 * which is not what law 1 describes. `note`, when given instead of indexes,
 * is a fresh note and is exactly what it says.
 */
export async function draftHandoffPayload(
  db,
  { session, threadId = null, messageIndexes = null, note = null },
  deps = {},
) {
  const who = await followerScope(db, session, deps);
  if (who.room.handoff_enabled !== true) throw new HandoffError("handoff_disabled", 409);
  const thread = threadId ? await ownedThread(db, who.roomId, who.personId, who.agentId, threadId) : null;

  let payloadText = "";
  if (Array.isArray(messageIndexes) && messageIndexes.length) {
    if (messageIndexes.length > HANDOFF_MESSAGE_PICK_MAX) throw new HandoffError("handoff_pick_too_many", 400);
    const memory = { ...DEFAULT_HANDOFF_MEMORY, ...(deps.memory || {}) };
    const device = roomThreadDevice(who.roomId, who.personId, thread?.thread_id || null);
    const turns = await memory.history(device, who.agentId, 200);
    const own = turns.filter((t) => t.role === "user");
    const picks = [...new Set(messageIndexes.map(Number))]
      .filter((i) => Number.isInteger(i) && i >= 0 && i < own.length)
      .sort((a, b) => a - b);
    if (!picks.length) throw new HandoffError("handoff_pick_invalid", 400);
    payloadText = picks.map((i) => String(own[i].content || "").trim()).filter(Boolean).join("\n\n");
  } else {
    payloadText = String(note ?? "").trim().slice(0, HANDOFF_NOTE_MAX);
  }
  payloadText = payloadText.slice(0, HANDOFF_PAYLOAD_MAX).trim();
  if (!payloadText) throw new HandoffError("handoff_payload_empty", 400);

  return { payload_text: payloadText, payload_sha256: sha256Hex(payloadText), thread_id: thread?.thread_id ?? null };
}

/**
 * The ONLY write in this file that creates a request. The cap and the
 * enabled switch are BOTH predicates inside the INSERT's own SELECT, not a
 * JS branch downstream of a pre-check - `api/_checkins.js`'s own law #2
 * restated for a write rather than a read: "a sentence in a brief is a
 * preference, a predicate on the write is a guarantee." The pre-checks
 * below exist ONLY to refuse by name before spending a round trip; the
 * INSERT's own WHERE is what actually protects a race between two tabs.
 */
export async function sendHandoffRequest(
  db,
  { session, payloadText, payloadSha256, threadId = null },
  deps = {},
) {
  const who = await followerScope(db, session, deps);
  if (who.room.handoff_enabled !== true) throw new HandoffError("handoff_disabled", 409);
  const text = String(payloadText ?? "").trim();
  if (!text || text.length > HANDOFF_PAYLOAD_MAX) throw new HandoffError("handoff_payload_invalid", 400);
  const hash = String(payloadSha256 || "").toLowerCase();
  if (!HEX64.test(hash) || hash !== sha256Hex(text)) {
    // The follower's client must submit exactly the bytes the draft screen
    // showed them, hash included - a mismatch here means the screen and the
    // send disagree about what was seen, and refusing is the only honest
    // response to that, never "send what they typed instead."
    throw new HandoffError("handoff_payload_hash_mismatch", 400);
  }
  const thread = threadId ? await ownedThread(db, who.roomId, who.personId, who.agentId, threadId) : null;
  const monthKey = monthKeyOf(deps.now ?? Date.now());

  const rows = await db(
    `insert into vy_room_handoff
       (handoff_id, room_id, person_id, follower_id, thread_id, payload_text, payload_sha256,
        policy_version, state, month_key, sent_at, created_at, updated_at)
     select ($1)::uuid, r.room_id, ($3)::uuid, ($4)::uuid, ($5)::uuid, $6, $7, ($8)::int4,
            'sent', $9, now(), now(), now()
       from vy_room r
      where r.room_id = ($2)::uuid
        and r.handoff_enabled = true
        and (
          select count(*)::int from vy_room_handoff h2
           where h2.follower_id = ($4)::uuid and h2.month_key = $9 and h2.state <> 'withdrawn'
        ) < r.handoff_monthly_cap
     returning handoff_id, state, sent_at`,
    [
      randomUUID(),
      who.roomId,
      who.personId,
      who.followerId,
      thread?.thread_id ?? null,
      text,
      hash,
      HANDOFF_POLICY_VERSION,
      monthKey,
    ],
  );
  if (!rows[0]) {
    // Refuse BY NAME: the two predicates above collapsed into zero rows, so
    // tell the follower which one it was, from a fresh read rather than a
    // guess - the insert itself is still the authority; this is only why.
    const capRows = await db(
      `select count(*)::int as n from vy_room_handoff
        where follower_id = ($1)::uuid and month_key = $2 and state <> 'withdrawn'`,
      [who.followerId, monthKey],
    );
    const used = Number(capRows[0]?.n || 0);
    if (used >= Number(who.room.handoff_monthly_cap)) throw new HandoffError("handoff_cap_reached", 429);
    throw new HandoffError("handoff_disabled", 409);
  }
  return { handoff_id: rows[0].handoff_id, state: rows[0].state, sent_at: rows[0].sent_at };
}

/** Before answered, and only ever the follower's own row - the room_id,
 *  person_id and follower_id in the WHERE clause are ALL derived from the
 *  caller's own session, never from the request. */
export async function withdrawHandoffRequest(db, { session, handoffId }, deps = {}) {
  const who = await followerScope(db, session, deps);
  if (!UUID.test(String(handoffId || ""))) throw new HandoffError("handoff_id_invalid", 400);
  const rows = await db(
    `update vy_room_handoff
        set state = 'withdrawn', updated_at = now()
      where handoff_id = ($1)::uuid and room_id = ($2)::uuid
        and person_id = ($3)::uuid and follower_id = ($4)::uuid
        and state in ('drafted','sent')
      returning handoff_id, state`,
    [handoffId, who.roomId, who.personId, who.followerId],
  );
  if (!rows[0]) throw new HandoffError("handoff_not_withdrawable", 404);
  return { handoff_id: rows[0].handoff_id, state: rows[0].state };
}

/** The follower's own requests and the creator's own replies to them - the
 *  ONLY read of `reply_text` outside the owner's queue, and it is scoped to
 *  the same person who sent the request it answers, never another
 *  follower's. This is how "lands in the follower's private thread" is
 *  actually true: the client merges these rows into the same thread view it
 *  already renders, tagged `kind:"creator"` so they are never mistaken for
 *  a bubble from the AI. */
export async function myHandoffs(db, { session }, deps = {}) {
  const who = await followerScope(db, session, deps);
  const rows = await db(
    `select handoff_id, thread_id, state, payload_text, sent_at, answered_at, reply_text, created_at
       from vy_room_handoff
      where room_id = ($1)::uuid and person_id = ($2)::uuid and follower_id = ($3)::uuid
      order by created_at desc
      limit 50`,
    [who.roomId, who.personId, who.followerId],
  );
  return rows.map((r) => ({
    handoff_id: r.handoff_id,
    thread_id: r.thread_id,
    state: r.state,
    payload_text: r.payload_text,
    sent_at: r.sent_at,
    answered_at: r.answered_at,
    reply_text: r.state === "answered" ? r.reply_text : "",
    created_at: r.created_at,
  }));
}

const DEFAULT_HANDOFF_MEMORY = {
  history: (device, agentId, limit) => dmHistory(device, undefined, limit, agentId),
};
