// api/_room-whatsapp.js — check-ins delivered as a WhatsApp UTILITY TEMPLATE
// (WS-R29, migration 092). Every decision lives here, not in api/room.js or
// api/room-wa.js, so a fake `db` can reach it — api/_room-push.js's own shape
// one channel over.
//
// Built on two precedents rather than a third invented lane:
//
//   api/whatsapp.js    Meera's Cloud API surface. NOT WIRED there either, and
//                       this file inherits that same honest state for the
//                       pieces it reuses rather than reimplementing them:
//                       `verify` (the HMAC check AND the GET handshake, both
//                       imported, never re-derived — a second HMAC
//                       implementation is a second thing that can silently
//                       drift from Meta's real algorithm) and, for the ONE
//                       reply this file ever sends, `send`/`noteInbound`
//                       (the 24-hour-window machinery, correct exactly
//                       because this file never tries to reproduce it).
//   api/_room-push.js  the follower-scoped opt-in / revoke-on-failure shape:
//                       one destination per follower, a status write that
//                       never reads a message table, a sweep-only read
//                       function that takes no session at all.
//
// ── LAW 3 (workstream brief): A TEMPLATE, ALWAYS ────────────────────────────
// `send()` in api/whatsapp.js refuses a free-form message outside Meta's
// 24-hour customer-service window — exactly the defect a proactive check-in
// (nothing the follower just said prompted it) would hit on every single
// send. So this file never calls `send()` for the check-in itself and never
// builds a `type: "text"` body for it: `sendTemplate` below is the ONLY exit
// this module has to Meta for a check-in, and its body is always
// `type: "template"`, naming TEMPLATE_NAME/TEMPLATE_LANG — constants, never
// read from a request body or an env var. Approval status is a separate env
// FACT (`ROOM_WHATSAPP_TEMPLATE_APPROVED=1`): unset, the channel is
// structurally absent from a follower's choices, `INVITES_REQUIRED`'s own
// shape (`api/_replica.js`) — `optIn`/`status` below refuse or hide before
// any write, and the client control that would offer it is never rendered
// (src/room/CheckinsPanel.tsx checks the SAME flag, server-driven exactly as
// `ROOM_PUSH_VAPID_PUBLIC` already is for push).
//
// ── LAW 1: A SEPARATE PHONE, PERSON-LANE, COUNTED BY NAME ───────────────────
// migration 092's own header. `optIn` writes `vy_room_follower_whatsapp`
// (primary key `follower_id`, so a second opt-in REPLACES the first rather
// than growing a duplicate); `api/_room-surface.js`'s `roomForget` deletes it
// by name (WS-R27's own lesson: a row reached only by cascade is a row
// deleted but never counted); `api/memory.js`'s `PERSON_TABLES` covers the
// whole-account wipe and `roomExport`.
//
// ── LAW 2: THE PAYLOAD IS SCANNABLE ──────────────────────────────────────
// `buildTemplatePayload` is pure and reads nothing from a database — it is
// four public facts (slug, thread id, the check-in's own title, the
// creator's display name) handed in by the caller, never a lookup of its
// own. It must never read a message table, `prompt_shape`, or anything a
// follower or a creator SAID — `checkinPushPayload`'s own law
// (api/_push/webpush.js) one channel over. evals/room-whatsapp/run.mjs's own
// static control scans this function's source and proves the scan actually
// catches a poisoned version, not merely passes a clean one.
//
// ── LAW 4: REVOKE ON FAILURE, RETRY ON TRANSIENT ────────────────────────────
// The caller (api/_checkins.js's `deliverers.whatsappTemplate`) marks the
// opt-in 'failed' on a 4xx naming an invalid number and stops sending
// (`markFollowerWhatsappFailed` below) — `api/_room-push.js`'s 404/410-
// revokes-a-subscription law, restated for a phone number instead of a push
// endpoint. A 429/5xx writes NO ledger row at all (`sendTemplate`'s caller
// decides this, this file only reports the status back) so this occurrence
// is left for a later sweep rather than recorded as a false terminal state.
//
// ── LAW 6: NO CONVERSATION ON THIS WIRE, v0 ─────────────────────────────────
// `handleStatusWebhook` never persists a follower's reply text anywhere —
// the one thing it may do for an inbound message is send ONE deterministic,
// app-voiced line (never a model call) pointing at the Room link, in the
// follower's own locale. Two reasons, both worth stating rather than
// assuming: (1) a template opening a delivery does not itself hand this
// product a general-purpose customer-service window in Meta's AI-primary
// terms sense — Meta's own policy treats an AUTOMATED SYSTEM continuing a
// conversation on a business number as a materially different surface than
// a human agent, and this workstream was not asked to build or review that;
// (2) `surface-bypasses-parse` (context/rejected.md) is the standing law
// that an adapter answering with its own model call has silently become a
// second engine, missing every gate `gatedReply` provides — building one for
// ONE MORE WIRE inside a workstream scoped to a delivery channel is exactly
// the shortcut that law exists to refuse.
import { RoomError, readRoomSession, assertSessionFresh, resolveRoom, followerRow } from "./_room-surface.js";
import { verify as verifyWhatsappWebhook, send as whatsappSend, noteInbound, windowOpen } from "./whatsapp.js";

/** The named template. A constant, never a request field and never an env
 *  var — workstream law #3. Its language is a constant for the identical
 *  reason. Neither has ever been submitted to Meta for approval; this file
 *  assumes an operator has done so out of band before setting
 *  ROOM_WHATSAPP_TEMPLATE_APPROVED=1. */
export const TEMPLATE_NAME = "vyakti_checkin_v1";
export const TEMPLATE_LANG = "en";

const CLOUD_API = "https://graph.facebook.com/v21.0";

/** ₹0.11 per template send (workstream law #5) — Meta's own India utility-
 *  template rate as most recently checked; a comment, not a live price feed,
 *  so the ops board's cost line is honest about being an ESTIMATE. Kept as a
 *  named constant rather than folded into a computation somewhere, so the
 *  owner can find and correct it in one place when Meta's rate changes. */
export const WHATSAPP_TEMPLATE_UNIT_COST_INR = 0.11;

const E164 = /^\+[1-9][0-9]{7,14}$/;

/** UNSET MEANS THE CHANNEL DOES NOT EXIST, structurally — `INVITES_REQUIRED`'s
 *  own shape. Every caller in this file checks this BEFORE touching the
 *  database, never after. */
export function templateApproved(env = process.env) {
  return String(env.ROOM_WHATSAPP_TEMPLATE_APPROVED || "") === "1";
}

/** A follower's own number, shown back to them after saving — the digits
 *  that matter for "is this the right phone" (country code, last two) and
 *  nothing that helps a shoulder-surfer reconstruct the rest. Pure; never
 *  touches a database. */
export function maskPhone(phone) {
  const p = String(phone || "");
  const m = p.match(/^\+(\d{6,15})$/);
  if (!m) return "";
  const digits = m[1];
  const head = digits.slice(0, 2);
  const tail = digits.slice(-2);
  const middleLen = digits.length - head.length - tail.length;
  return `+${head} ${"•".repeat(Math.max(0, middleLen))}${tail}`;
}

/** The follower's own scope, off the VERIFIED session — `api/_room-push.js`'s
 *  `followerScope`, re-derived here for the identical stated reason (that
 *  function is not exported, and re-deriving a small owner/follower-scope
 *  helper rather than importing it is this house's own convention, `api/
 *  _room-cohorts.js`'s `ownedRoomHandle`/`api/_checkins.js`'s own copy). */
async function followerScope(db, session, deps) {
  const payload = readRoomSession(session, deps.env);
  // WS-R38: see api/_handoff.js's own followerScope for the finding.
  assertSessionFresh(payload, deps.now ?? Date.now());
  const resolved = await resolveRoom(db, payload.r, deps);
  if (String(resolved.room.room_id) !== String(payload.i)) throw new RoomError("room_unavailable", 404);
  const follower = await followerRow(db, resolved.room.room_id, payload.p, resolved.agentId);
  if (!follower || follower.age_attested_at == null) throw new RoomError("room_join_required", 403);
  return {
    roomId: String(resolved.room.room_id),
    personId: String(payload.p),
    followerId: String(follower.follower_id),
    follower,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// OPT-IN / STOP / STATUS — the follower's own control
// ─────────────────────────────────────────────────────────────────────────

/**
 * Save a phone number for check-in delivery. Paid-tier only — WhatsApp is a
 * DELIVERY CHANNEL for check-ins, and check-ins are already paid-only
 * (`api/_checkins.js`'s `optIn`, workstream law #2 there); a free follower
 * has nothing this channel would ever carry, so this door refuses before any
 * write rather than accepting a phone number that can never be used.
 *
 * ON CONFLICT the row is REPLACED, not merged: a follower who opts in again
 * (a new number, or the same one after `stop`) gets a fresh 'active' row —
 * `last_failure_code` clears, exactly the shape re-subscribing to push
 * clears `revoked_at` (`api/_room-push.js`'s `setSubscription`).
 */
export async function optIn(db, { session, phone }, deps = {}) {
  const env = deps.env || process.env;
  if (!templateApproved(env)) throw new RoomError("room_whatsapp_not_available", 404);
  const who = await followerScope(db, session, deps);
  if (who.follower.tier !== "paid") throw new RoomError("room_whatsapp_paid_only", 402);
  const p = String(phone || "").trim();
  if (!E164.test(p)) throw new RoomError("room_whatsapp_phone_invalid", 400);
  await db(
    `insert into vy_room_follower_whatsapp
       (follower_id, room_id, person_id, phone_e164, consented_at, state, last_failure_code, created_at, updated_at)
     values (($1)::uuid, ($2)::uuid, ($3)::uuid, $4, now(), 'active', '', now(), now())
     on conflict (follower_id) do update
        set phone_e164 = excluded.phone_e164,
            consented_at = now(),
            state = 'active',
            last_failure_code = '',
            updated_at = now()`,
    [who.followerId, who.roomId, who.personId, p],
  );
  return { subscribed: true, state: "active", phone_masked: maskPhone(p) };
}

/** The follower's own "stop these" — never a delete: `optIn` re-activating
 *  the SAME row later is what a follower who changes their mind twice
 *  expects, and a delete would also lose `last_failure_code`'s own history
 *  for no reason a follower asked for. */
export async function stop(db, { session }, deps = {}) {
  const who = await followerScope(db, session, deps);
  await db(
    `update vy_room_follower_whatsapp
        set state = 'stopped', updated_at = now()
      where follower_id = ($1)::uuid and state <> 'stopped'`,
    [who.followerId],
  );
  return { subscribed: false, state: "stopped" };
}

/** The panel's own "already on" read — `api/_room-push.js`'s
 *  `subscriptionStatus` one channel over. `available` is read BEFORE the
 *  follower scope even resolves, so a deployment with the flag unset never
 *  runs a query at all — structurally absent all the way down, not merely
 *  hidden by the client. */
export async function status(db, { session }, deps = {}) {
  const env = deps.env || process.env;
  const available = templateApproved(env);
  if (!available) return { available: false, subscribed: false, state: null, phone_masked: null };
  const who = await followerScope(db, session, deps);
  const rows = await db(
    `select phone_e164, state from vy_room_follower_whatsapp where follower_id = ($1)::uuid limit 1`,
    [who.followerId],
  );
  const row = rows[0];
  if (!row) return { available: true, subscribed: false, state: null, phone_masked: null };
  return {
    available: true,
    subscribed: row.state === "active",
    state: row.state,
    phone_masked: maskPhone(row.phone_e164),
  };
}

// ─────────────────────────────────────────────────────────────────────────
// THE SWEEP'S OWN READ — no session, called with a follower_id the sweep
// already resolved. `api/_room-push.js`'s `activeSubscriptionsFor` one
// channel over.
// ─────────────────────────────────────────────────────────────────────────

export async function activeWhatsappFollower(db, followerId) {
  const rows = await db(
    `select phone_e164, state from vy_room_follower_whatsapp
      where follower_id = ($1)::uuid and state = 'active'
      limit 1`,
    [String(followerId)],
  );
  return rows[0] || null;
}

/** Revoke-on-failure — workstream law #4, `api/_room-push.js`'s
 *  `revokeSubscriptionById` restated for this table. Scoped by `state =
 *  'active'` so a follower who already `stop()`-ped is never overwritten by
 *  a late-arriving 4xx for an occurrence queued before they stopped. */
export async function markFollowerWhatsappFailed(db, followerId, code) {
  await db(
    `update vy_room_follower_whatsapp
        set state = 'failed', last_failure_code = $2, updated_at = now()
      where follower_id = ($1)::uuid and state = 'active'`,
    [String(followerId), String(code || "").slice(0, 120)],
  );
}

// ─────────────────────────────────────────────────────────────────────────
// THE PAYLOAD — pure, scannable (workstream law #2)
// ─────────────────────────────────────────────────────────────────────────

/** Four public facts and nothing else. See this file's own header — this
 *  function's SOURCE TEXT is scanned by evals/room-whatsapp/run.mjs and must
 *  never read a message table, a prompt shape, or anything anyone said. */
export function buildTemplatePayload(slug, displayName, title, threadId = null) {
  return {
    slug: String(slug || ""),
    thread_id: threadId == null ? null : String(threadId),
    title: String(title || "").slice(0, 120),
    display_name: String(displayName || "").slice(0, 80),
  };
}

/** The link a template's body parameter carries. `ROOM_WHATSAPP_LINK_ORIGIN`
 *  is a NEW, optional env var — not a WHATSAPP_* credential, so it does not
 *  fall under the workstream's "reuse existing names" rule, which is about
 *  Meta credentials specifically. Unset, the link degrades to a bare
 *  `/r/<slug>` path — still informative (a follower who already knows this
 *  product's domain can find it), never a thrown error over a missing
 *  cosmetic. */
function roomLink(slug, env = process.env) {
  const origin = String(env.ROOM_WHATSAPP_LINK_ORIGIN || "").replace(/\/$/, "");
  return `${origin}/r/${String(slug || "")}`;
}

/** Meta's own `components` shape for a template send, built from the pure
 *  payload above plus the one env-dependent value (the link). Kept OUT of
 *  `buildTemplatePayload` on purpose: the function that reads env belongs
 *  next to the network call it feeds, not inside the function the static
 *  scan holds to a strict "no reads at all" bar. */
function templateComponents(payload, env = process.env) {
  return [
    {
      type: "body",
      parameters: [
        { type: "text", text: payload.display_name || "there" },
        { type: "text", text: payload.title || "" },
        { type: "text", text: roomLink(payload.slug, env) },
      ],
    },
  ];
}

// ─────────────────────────────────────────────────────────────────────────
// THE SEND — a template, always
// ─────────────────────────────────────────────────────────────────────────

/**
 * `deps.fetch` is REQUIRED, `api/_push/webpush.js`'s `send`'s own law
 * restated: no fallback to a global `fetch`, so an eval that forgets to
 * inject one gets a loud error rather than a silent real HTTP request.
 * `deps.accessToken`/`deps.phoneId` default to the SAME env names
 * `api/whatsapp.js` reads (`WHATSAPP_ACCESS_TOKEN`/`WHATSAPP_PHONE_NUMBER_ID`)
 * — workstream law: reuse, never invent a parallel pair.
 *
 * Returns `{ok, status, errorCode}` and never throws for an ordinary HTTP
 * failure — the caller (api/_checkins.js) decides what a status means
 * (4xx revokes, 429/5xx retries later).
 */
export async function sendTemplate(phoneE164, payload, deps = {}) {
  const env = deps.env || process.env;
  const accessToken = deps.accessToken ?? env.WHATSAPP_ACCESS_TOKEN ?? "";
  const phoneId = deps.phoneId ?? env.WHATSAPP_PHONE_NUMBER_ID ?? "";
  if (!accessToken || !phoneId) return { ok: false, status: 0, notConfigured: true };
  if (typeof deps.fetch !== "function") throw new Error("room_whatsapp_send_fetch_required");

  const body = {
    messaging_product: "whatsapp",
    // Stored as E.164 (a leading "+", migration 092's own CHECK constraint —
    // an unambiguous, internationally-portable format to hold a number in).
    // Meta's own wire convention for `to` is digits only, no "+" — the exact
    // shape `api/whatsapp.js`'s `chatKey` already uses everywhere on this
    // wire, restated here at the one seam that bridges the two formats.
    to: String(phoneE164).replace(/^\+/, ""),
    type: "template",
    template: {
      name: TEMPLATE_NAME,
      language: { code: TEMPLATE_LANG },
      components: templateComponents(payload, env),
    },
  };
  const res = await deps
    .fetch(`${CLOUD_API}/${phoneId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    })
    .catch(() => null);
  if (!res) return { ok: false, status: 0, errorCode: "network" };
  let errorCode = "";
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    errorCode = String(data?.error?.code ?? data?.error?.error_subcode ?? res.status);
  }
  return { ok: Boolean(res.ok), status: Number(res.status) || 0, errorCode };
}

// ─────────────────────────────────────────────────────────────────────────
// THE SESSION-MESSAGE SENDER (WS-R104) — beside the template sender above,
// the SAME fetch seam: `deps.fetch` REQUIRED, no fallback to a global
// `fetch`, so an eval that forgets to inject one gets a loud error rather
// than a silent real HTTP request; `deps.accessToken`/`deps.phoneId` default
// to the SAME `WHATSAPP_ACCESS_TOKEN`/`WHATSAPP_PHONE_NUMBER_ID` env names
// every other sender in this file already reads — one WhatsApp Business
// number, never a second credential pair.
//
// A TEMPLATE ALWAYS OPENS THE WINDOW; A SESSION MESSAGE MAY ONLY RIDE ONE
// ALREADY OPEN. `sendTemplate` above exists because a proactive check-in has
// no inbound message to open a window with. `api/_room-whatsapp-chat.js`'s
// whole lane is the opposite shape: every send it makes is a REPLY to a
// message that just arrived, so the window this function checks
// (`windowOpen`, api/whatsapp.js's own ledger — reused, never
// re-implemented, that file's own header states why: it is the ONE place
// this platform's best-effort mirror of Meta's real 24-hour clock lives) is
// the same one the caller's own `noteInbound` call for that inbound message
// just opened. The rare case this branch actually refuses — a cold start
// losing the in-memory ledger between the inbound webhook and this call —
// is the honest, named failure the caller reports as a content-free skip
// count, never a silent drop and never a template substituted on the
// follower's behalf (`api/whatsapp.js`'s own `send()` states the identical
// law one file over).
//
// `messageBody` is Meta's own per-type payload shape MINUS the envelope
// (`messaging_product`/`recipient_type`/`to`, which this function fills in)
// — `{type: "text", text: {body}}` or `{type: "interactive", interactive:
// {...}}`, so ONE sender carries every message shape the chat lane needs
// (a plain reply, the age/memory gate's own reply buttons) rather than one
// function per shape.
export async function sendSessionMessage(phoneE164, messageBody, deps = {}) {
  const env = deps.env || process.env;
  const accessToken = deps.accessToken ?? env.WHATSAPP_ACCESS_TOKEN ?? "";
  const phoneId = deps.phoneId ?? env.WHATSAPP_PHONE_NUMBER_ID ?? "";
  if (!accessToken || !phoneId) return { ok: false, status: 0, notConfigured: true };
  if (typeof deps.fetch !== "function") throw new Error("room_whatsapp_session_send_fetch_required");
  const now = deps.now ?? Date.now();
  const isWindowOpen = deps.windowOpen ?? windowOpen;
  if (!isWindowOpen(phoneE164, now)) return { ok: false, status: 0, skipped: "outside_window" };

  const body = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: String(phoneE164).replace(/^\+/, ""),
    ...messageBody,
  };
  const res = await deps
    .fetch(`${CLOUD_API}/${phoneId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    })
    .catch(() => null);
  if (!res) return { ok: false, status: 0, errorCode: "network" };
  let errorCode = "";
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    errorCode = String(data?.error?.code ?? data?.error?.error_subcode ?? res.status);
  }
  return { ok: Boolean(res.ok), status: Number(res.status) || 0, errorCode };
}

// ─────────────────────────────────────────────────────────────────────────
// THE PHONE-NUMBER READ (WS-R136) — the ONE call that answers "what number
// does wa.me need", as distinct from the opaque Graph API id this file's
// `phoneId` already holds for every send above.
//
// developers.facebook.com/documentation/business-messaging/whatsapp/
// business-phone-numbers/phone-numbers#get-a-single-phone-number (fetched
// 2026-09-05): "Use the WhatsApp Business Phone Number API to get
// information about a phone number:" — request syntax "GET https://graph.
// facebook.com/<API_VERSION>/<PHONE_NUMBER_ID>" — "On success, a JSON
// object is returned with the business name, phone number, phone number
// ID, and quality rating for the phone number queried." The example
// response on that same page: `{"code_verification_status":"VERIFIED",
// "display_phone_number":"15555555555","id":"105954558954427",
// "quality_rating":"GREEN","verified_name":"Support Number"}` — this
// function's own GET hits the identical `${CLOUD_API}/${phoneId}` path
// segment `sendTemplate`/`sendSessionMessage` above already POST to, with
// `fields=display_phone_number,verified_name` added so the response never
// carries more than this file reads.
//
// developers.facebook.com/documentation/business-messaging/whatsapp/
// reference/whatsapp-business-phone-number/whatsapp-business-account-
// phone-number-api (fetched 2026-09-05) — the response schema names
// `root.id` "The ID associated with the phone number" (example
// `"1906385232743451"`) and `root.display_phone_number` "The string
// representation of the phone number" (example `"+1 631-555-5555"`) as two
// DIFFERENT fields, confirming in the document's own words — not by
// inference — that `phoneId` (the `id` this file already sends every
// request to) is never the same value as the number this function exists
// to read.
//
// Same seams as `sendTemplate`/`sendSessionMessage` above: `deps.fetch`
// REQUIRED (no fallback to a global `fetch`, so a caller that forgets to
// inject one gets a loud error rather than a silent real HTTP request),
// `deps.accessToken`/`deps.phoneId` default to the SAME
// `WHATSAPP_ACCESS_TOKEN`/`WHATSAPP_PHONE_NUMBER_ID` env names every other
// function in this file reads. Never throws for an ordinary HTTP failure —
// `api/_room-whatsapp-chat.js`'s own memoised caller records the incident
// and treats the number as unknown, the same refusal-vs-error posture
// `notedProviderFailure` already draws for a send.
export async function fetchPhoneNumberDisplay(deps = {}) {
  const env = deps.env || process.env;
  const accessToken = deps.accessToken ?? env.WHATSAPP_ACCESS_TOKEN ?? "";
  const phoneId = deps.phoneId ?? env.WHATSAPP_PHONE_NUMBER_ID ?? "";
  if (!accessToken || !phoneId) return { ok: false, status: 0, notConfigured: true };
  if (typeof deps.fetch !== "function") throw new Error("room_whatsapp_phone_number_fetch_required");

  const res = await deps
    .fetch(`${CLOUD_API}/${phoneId}?fields=display_phone_number,verified_name`, {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(15_000),
    })
    .catch(() => null);
  if (!res) return { ok: false, status: 0, errorCode: "network" };
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const errorCode = String(data?.error?.code ?? data?.error?.error_subcode ?? res.status);
    return { ok: false, status: Number(res.status) || 0, errorCode };
  }
  return {
    ok: true,
    status: Number(res.status) || 0,
    displayPhoneNumber: String(data?.display_phone_number || ""),
    verifiedName: String(data?.verified_name || ""),
  };
}

// ─────────────────────────────────────────────────────────────────────────
// THE WEBHOOK — status callbacks and, for an inbound reply only, ONE
// deterministic line. No conversation on this wire (workstream law #6).
// ─────────────────────────────────────────────────────────────────────────

/** `api/whatsapp.js`'s own verify() reused verbatim — the HMAC check and the
 *  GET handshake, never a second implementation of either. */
export const verifyRoomWhatsappWebhook = (req) => verifyWhatsappWebhook(req);

/** The one line this wire may ever send back, deterministic and app-voiced —
 *  never a model call (see this file's own header, law #6). Locale-keyed the
 *  same way `api/_room-surface.js`'s `roomDisclosureCard` is, for the
 *  identical reason: an API module cannot import `src/room/copy.ts` (a
 *  browser/TS module), so server-side Room copy lives inline here exactly as
 *  it already does there. */
export function whatsappAutoReply(slug, locale = "en", env = process.env) {
  const link = roomLink(slug, env);
  if (String(locale) === "hi") {
    return `यह एक स्वचालित लाइन है। बातचीत के लिए यहां जाएं: ${link}`;
  }
  return `This is an automated line. For the conversation, go here: ${link}`;
}

/**
 * `db` is used for READS ONLY — this file's own header states why nothing is
 * ever written for a status callback or an inbound reply: no correlating
 * column exists on `vy_room_checkin_delivery` (workstream law #5, "gains
 * nothing") and a follower's reply text is never persisted, on this wire, in
 * v0.
 */
export async function handleStatusWebhook(payload, deps = {}) {
  const db = deps.db;
  let statuses = 0;
  let replies = 0;
  for (const entry of payload?.entry || []) {
    for (const change of entry?.changes || []) {
      const v = change?.value || {};
      statuses += Array.isArray(v.statuses) ? v.statuses.length : 0;
      for (const m of v.messages || []) {
        const phone = m.from == null ? null : String(m.from);
        if (!phone || typeof db !== "function") continue;
        replies++;
        await replyWithRoomLink(db, phone, deps).catch(() => {});
      }
    }
  }
  return { ok: true, statuses, replies };
}

/** Looks up which Room (if any) this phone number currently means, off THIS
 *  follower's own opt-in row — never a creator-facing read, never a scan
 *  across followers. An unknown number (never opted in, or opted in for a
 *  different feature entirely) is silence, `api/whatsapp.js`'s own
 *  `bindWhatsappClone` null-means-drop law restated for a phone number
 *  instead of a business line. */
async function replyWithRoomLink(db, phone, deps = {}) {
  const now = deps.now ?? Date.now();
  // Meta's own inbound `messages[].from` is digits only (no "+"), the exact
  // wire format `api/whatsapp.js`'s `chatKey` already carries — this table
  // stores E.164 WITH a "+" (migration 092's own CHECK constraint), so the
  // lookup key is normalised here rather than the storage format loosened
  // to match one caller's own wire convention.
  const e164 = phone.startsWith("+") ? phone : `+${phone}`;
  const rows = await db(
    `select w.follower_id, f.locale, r.slug
       from vy_room_follower_whatsapp w
       join vy_room_follower f on f.follower_id = w.follower_id
       join vy_room r on r.room_id = w.room_id
      where w.phone_e164 = $1
      limit 1`,
    [e164],
  );
  const row = rows[0];
  if (!row) return;
  const line = whatsappAutoReply(row.slug, row.locale, deps.env || process.env);
  // Noted THEN sent, in the same call — the window this single inbound
  // message just opened is checked by the SAME statement that opened it,
  // never a cross-request assumption about warm-lambda state (`api/
  // whatsapp.js`'s own `noteInbound`/`windowOpen` header — best effort by
  // design, and this call sequence never depends on it surviving a cold
  // start).
  noteInbound(phone, now);
  const sender = deps.whatsappSend || whatsappSend;
  await sender(phone, { text: line }, now, deps.creds || null).catch(() => {});
}
