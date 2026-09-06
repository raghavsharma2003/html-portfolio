// api/_room-taste.js — WS-R53: the taste. A stranger asks a creator's AI
// three questions before joining, from creator material alone, remembering
// nothing, through the one door (`gatedReply`, api/_surface.js) every other
// reply in this product leaves by.
//
// ── THE ONE PROPERTY THIS FILE EXISTS TO GUARANTEE ─────────────────────────
//
// A taste turn is a GUEST lane. It reads creator material (the SAME
// compiled agent module `resolveRoom` hands the follower lane) and reads
// NOTHING from any follower scope — no person, no episode, no fact, no
// thread. It WRITES NOTHING a later turn could read: no session, no thread
// row, no message row, no memory, no person. `roomTaste` below is stateless
// ACROSS CALLS by construction — every call recompiles from nothing but the
// message just sent — which is what makes the follower lane's own writer
// functions UNREACHABLE from here rather than merely unused: this file
// imports NONE of them, by name, anywhere. `evals/room-leak/run.mjs`'s
// static reach layer is extended to prove this the same way it already
// proves no creator-material writer is reachable from the follower lane —
// the identical technique, pointed the other direction (see that file's own
// "layer 1b — guest lane" block).
//
// Every import below is READ-ONLY or PURE: `resolveRoom` (a SELECT),
// `roomNameFor` / `roomDisclosureCard` / `normalizeLocale` (string
// functions over data already in hand), `roomUnavailable` / `RoomError`
// (error shaping, no I/O), `collector` (an in-memory adapter that takes no
// `db` parameter at all — api/_room-surface.js's own definition, reused
// rather than re-implemented so this file does not carry a second copy of
// `splitForLimit`'s wiring). Nothing here can mint a session, touch the
// follower roster table, the thread table, a follower's own long-term
// facts, their episode log, or any consent ledger — none of those writers
// are imported by NAME anywhere in this file's own import graph, which is
// the exact bar `evals/room-leak/run.mjs`'s layer 1 already uses for the
// creator-material side of this same boundary, applied here in the other
// direction (see that same suite's own "layer 7" block, which re-derives
// this claim rather than trusting this comment).
//
// The ONE write this file performs (`recordRoomTasteTurn`) is a
// content-free (room, day) counter with no person column at all — migration
// 110's own header states why it is a dedicated table rather than a fifth
// value on the arrival-source counter's own `via` column — and it is never
// reachable from a follower's own turn (`roomSay` never imports this file).
import { gatedReply, makeCtx, loadEngine, think, deliver } from "./_surface.js";
import {
  RoomError,
  resolveRoom,
  roomNameFor,
  roomDisclosureCard,
  normalizeLocale,
  collector,
  ROOM_INBOUND_LIMIT,
  roomNeverRules,
} from "./_room-surface.js";
import { tableApplied } from "./memory.js";

/** How many questions a stranger may ask before the join control replaces
 *  the input — the workstream brief's own number, and the SAME number
 *  `api/_rate-limit.js`'s `DEFAULT_LIMITS.room_taste.limit` carries. THE
 *  ENFORCEMENT lives entirely in that module's configurable limit, never
 *  here — `api/room.js` derives `turnIndex` from what `consume()` returns
 *  and this file trusts it completely, no second ceiling checked against
 *  this constant. That is deliberate: an operator who widens
 *  `RATE_LIMITS_JSON`'s `room_taste` limit (`context/decisions.md#ws-r26-
 *  limits-are-code-constants-not-a-database-table`'s own escape hatch) must
 *  see MORE turns, not a second, silently-out-of-sync wall at 3 — a
 *  hardcoded bound here duplicating the rate limiter's own number is
 *  exactly the "two names for one number" drift this whole product's
 *  copy-vs-source discipline warns against elsewhere. This constant exists
 *  only so `turns_left` below has a DEFAULT to compute against when this
 *  function is called directly (an offline eval, a future non-HTTP caller)
 *  without a `turnIndex` already keyed to a live configured limit. */
export const ROOM_TASTE_TURNS = 3;

const isTableAppliedFor = (deps) => deps.tableApplied ?? tableApplied;

/**
 * ONE upsert, `recordRoomArrival`'s own shape (api/_room-surface.js) one
 * dimension narrower — see migration 110's header for why this is a
 * DIFFERENT table rather than a fifth value on that function's own `via`
 * column. Best effort by construction: the caller below wraps this in
 * `.catch(() => {})`, so a write failure here must never turn a taste
 * reply into an error for a counting reason.
 */
export async function recordRoomTasteTurn(db, { roomId, now = Date.now() } = {}) {
  if (typeof db !== "function") throw new Error("recordRoomTasteTurn: db required");
  const day = new Date(now).toISOString().slice(0, 10);
  await db(
    `insert into vy_room_taste_turn (room_id, day, count)
     values (($1)::uuid, ($2)::date, 1)
     on conflict (room_id, day) do update
       set count = vy_room_taste_turn.count + 1`,
    [String(roomId), day],
  );
}

/**
 * The taste turn itself.
 *
 * `turnIndex` (1-based) is derived by the CALLER (`api/room.js`) from
 * `api/_rate-limit.js`'s own `consume()` result — `limit - gate.remaining` —
 * so the disclosure decision below is driven by the SAME predicate that
 * enforces the daily limit, never a second counter this file would have to
 * keep in sync with it. THIS FUNCTION ENFORCES NO CEILING ON `turnIndex`
 * ITSELF — `ROOM_TASTE_TURNS`'s own comment states why a second, hardcoded
 * wall here would drift from an operator's `RATE_LIMITS_JSON` override the
 * day the two stopped agreeing. `api/room.js` refuses with a 429 BEFORE
 * this function is ever called once the limit is spent, and that refusal
 * is the entire enforcement.
 *
 * NO SESSION PARAMETER EXISTS ON THIS FUNCTION, and the absence is the
 * point: there is nothing here to verify the freshness of, nothing to
 * recompute a disclosure digest against, because nothing produced here is
 * meant to outlive this one call. Compare `roomSay`, which re-derives its
 * disclosure against a token's own `dd`/`loc` fields — this function has no
 * token, no `dd`, no `loc` to re-derive against, because it mints none of
 * them.
 */
export async function roomTaste(db, { slug, message, locale: hintLocale = null, turnIndex }, deps = {}) {
  const n = Number(turnIndex);
  if (!Number.isInteger(n) || n < 1) throw new Error("roomTaste: turnIndex required");
  const text = String(message ?? "").trim();
  if (!text) throw new RoomError("room_message_empty", 400);
  if (text.length > ROOM_INBOUND_LIMIT) throw new RoomError("room_message_too_long", 413);

  const resolved = await resolveRoom(db, slug, deps);
  // The creator's own switch (migration 110). Checked AFTER `resolveRoom`
  // (an unpublished/unavailable Room already refuses there with the same
  // indistinguishable `room_unavailable` every other reason does) and with
  // its OWN named code — a creator who turned taste off is a different,
  // honest reason than "this Room does not exist", and the client's `open`
  // response already told it not to render this screen at all
  // (`openRoom`'s own `taste_enabled` field) — this is the defence in depth
  // for a client that ignored that.
  if (resolved.room.taste_enabled === false) throw new RoomError("room_taste_disabled", 404);

  const name = roomNameFor(resolved.sheet);
  // Same fallback chain `openRoom` uses for a follower who has not joined
  // yet: a browser hint when present and recognised, otherwise the
  // creator's own `default_locale` — never a hardcoded "en". There is no
  // follower row here to prefer over the hint, ever — a taste turn has no
  // "own stored locale" to consult, by construction.
  const locale = hintLocale != null && String(hintLocale).trim()
    ? normalizeLocale(hintLocale)
    : normalizeLocale(resolved.room.default_locale);
  const disclosure = roomDisclosureCard(name, locale);

  const now = deps.now ?? Date.now();
  const engine = deps.engine !== undefined ? deps.engine : await loadEngine();
  // No engine, no answer, and the failure is LOUD — `roomSay`'s own rule,
  // restated: a hand-rolled fallback prompt here would be a second,
  // unvalidated version of a real, named, living person that nobody
  // consented to.
  if (!engine) throw new RoomError("room_engine_unavailable", 503);

  const { adapter } = collector();
  const ctx = makeCtx(adapter, {
    engine,
    agent: resolved.module,
    agentId: resolved.agentId,
    reply: deps.reply || ((compiled, turns) => think(engine, compiled, turns)),
  });

  const compiled = engine.compile({
    agent: resolved.module,
    user: { name: "", vibe: [], facts: {} },
    // A taste turn is ALWAYS a first-time caller from this function's own
    // point of view — `messageCount` is `turnIndex - 1` (0, 1, 2),
    // `roomSay`'s memory-free branch shape (`history.length`) applied to a
    // lane that carries no history at all rather than a client-carried one.
    messageCount: n - 1,
    medium: "text",
    mode: "chat",
    voiceEngine: "none",
    isDirective: false,
    watching: false,
    innerThread: "",
    innerWants: "",
    // NOTHING RETRIEVED. A taste turn has no follower, so it has no facts to
    // recall and no history to carry — every claim of a shared past would be
    // false by construction, exactly `roomSay`'s memory-free branch.
    memories: "",
    herLife: "",
    cultureNoteText: "",
    latestUserText: text,
  });

  // ONE TURN, NEVER A THREAD. No history is read from anywhere and none is
  // accepted from the caller either — a taste turn is stateless ACROSS
  // calls by construction (the workstream brief's own law), so there is no
  // transcript digest to bind and no client-supplied history to validate
  // against one, unlike `roomSay`'s memory-free branch.
  const turns = [{ role: "user", content: text }];
  const gatedOut = await gatedReply(ctx, compiled, turns, {
    // Nothing was retrieved, so nothing rides in the disclosure record
    // either — `roomSay`'s memory-free branch, restated: every claim of a
    // shared past is false by construction on this path.
    record: [],
    label: "web/room-taste",
    // The creator's "Never say this" set as a predicate on this reply, the
    // SAME read `roomSay` makes (a SELECT on the creator's own rule table,
    // nothing of any follower's). A stranger's three questions are the
    // easiest place to coax a forbidden sentence out of a creator's AI, and
    // until 2026-09-05 this lane carried no rules at all (WS-R99's finding).
    neverRules: await roomNeverRules(db, resolved.room, deps),
  });
  const said = gatedOut.text;
  if (said) {
    await deliver(ctx, "room", { kind: "text", text: said, replyTo: null, buttons: [] });
  }

  // THE COUNTER, best-effort, gated on migration 110 having landed — the
  // identical posture `recordRoomArrival` already uses for migration 102,
  // one table over. Only an ACCEPTED turn is counted: this function never
  // runs for a refused (429) call — `api/room.js`'s rate gate refuses before
  // `roomTaste` is ever invoked.
  if (await isTableAppliedFor(deps)("vy_room_taste_turn")) {
    await recordRoomTasteTurn(db, { roomId: resolved.room.room_id, now }).catch(() => {});
  }

  return {
    room: { slug: resolved.room.slug, display_name: resolved.room.display_name || name, name },
    // Only the FIRST answer carries the card — the workstream brief's own
    // law 2. Every later taste turn answers the SAME room under the SAME
    // disclosure a stranger already saw once in this browser tab; the
    // client renders it once, on turn one, and keeps it on screen rather
    // than re-fetching it every turn.
    disclosure: n === 1 ? disclosure : null,
    locale,
    reply: said,
    turn_index: n,
    turns_left: Math.max(0, ROOM_TASTE_TURNS - n),
    // Counts only, never the strings — `gatedReply`'s rule, restated.
    gate: { applied: gatedOut.gated, findings: gatedOut.findings.length },
  };
}
