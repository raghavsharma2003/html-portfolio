// The Room's money (WS-R11) - every decision behind the follower's revenue
// line: creator pays for capacity (Build/Room/Studio/Institute, a Phase 2
// concern with no table here); follower pays for the relationship, INR
// 299-599 a month, set by the creator inside that band. Platform take 25%,
// shown as one number. Migration 078 is the ledger; this file is every write
// and read that touches it, api/_room-publish.js's own shape: a decision in a
// handler is a decision no offline eval can reach.
//
// ── PHASE 0, NOT PHASE 1 ────────────────────────────────────────────────
// "Payments are Phase 1 work. This workstream builds the durable ledger and
// the provider seam so Phase 1 can turn it on with a key, and spends
// nothing." `PAYMENTS_PROVIDER` defaults to `none`; every write below refuses
// with a named reason before any provider is ever called, and NEVER invents a
// subscription - api/_channel-secrets.js's own posture, copied on purpose
// rather than re-argued: "the default backend REFUSES, and that is the
// feature."
//
// ── THE PROVIDER SEAM ───────────────────────────────────────────────────
// `api/_payments/providers/razorpay.js` and `fake.js` are twins: same three
// functions (createSubscription, cancelSubscription, verifyWebhookSignature),
// same signature ALGORITHM (HMAC-SHA256 over the raw body), one hits a real
// account and has never been called, the other is deterministic and zero-
// network. This file never branches on which one it is talking to beyond
// selecting it once.
//
// ── THE SECRET, FROM THE SAME SEAM AS A CHANNEL'S ──────────────────────
// api/_channel-secrets.js exists because "a live credential belonging to a
// real named teacher structurally cannot sit in a table the routing path
// selects, joins and logs on every inbound event." A Razorpay key/secret pair
// is the identical shape of problem one level up - this platform's own
// credential, not a creator's, but no less a live secret - so it is stored
// through the SAME backend rather than a second one invented for this file.
// Every Room shares the ONE platform Razorpay account, so there is exactly
// one credential to hold rather than one per `credentials_ref` the way a
// creator's own bot token is: `PAYMENTS_SECRET_REF` is a fixed, well-known
// uuid rather than one minted per row. The `fake` provider deliberately does
// NOT go through this seam - env vars only, so evals/payments/run.mjs and a
// staging deploy can prove every line below with zero network and zero Azure
// account, api/_channel-secrets.js's own "NOT VERIFIED... never a round trip"
// honesty restated for this file's own seam.
//
// ── THE TIER FLIP IS A PREDICATE, NEVER A BRANCH ABOVE THE WRITE ─────────
// api/_room-surface.js's cap predicate already reads `f.tier <> 'free'` to
// skip the free-cap UPDATE. `applyWebhook` below flips that column in the
// SAME statement that lands the webhook's own state change - one multi-CTE
// write, `api/_provider-budget.js`'s reservation shape one file over - so
// "paid" can never mean anything other than "a subscription row this
// database can see is active right now."
//
// ── WS-R33: THE SUITE AND CREATOR TIER LANES ────────────────────────────
// `startOrgSubscription`/`updateOrgSeats`/`startCreatorSubscription` and
// `applyWebhook`'s widened lane resolution are this workstream's own
// additions, over WS-R11's original follower-only file. Three subscription
// tables now share the one provider seam (`vy_room_subscription`, 078;
// `vy_org_subscription`, 091; `vy_creator_subscription`, 095) and the one
// signature-verify-then-apply webhook door - never a second webhook
// receiver, never a second provider client, this file's own header
// restated for a second and third lane. `seatCoversCreatorTier`
// (api/_org.js, built and proven by WS-R28 with no caller) gets its one
// caller here: `startCreatorSubscription` refuses BEFORE any provider call
// when a Suite seat already covers this creator - law 4.
import { sha256Hex } from "./_provenance/contracts.js";
import { consume } from "./_rate-limit.js";
import { getChannelSecret, ChannelSecretError } from "./_channel-secrets.js";
import { tableApplied } from "./memory.js";
import {
  readRoomSession,
  assertSessionFresh,
  resolveRoom,
  followerRow,
  roomUnavailable,
  RoomError,
} from "./_room-surface.js";
import { seatCoversCreatorTier } from "./_org.js";
import * as fakeProvider from "./_payments/providers/fake.js";
import * as razorpayProvider from "./_payments/providers/razorpay.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The follower price band. Mirrors migration 078's own CHECK
 *  (`vy_room_price_band`), validated here too so a bad value returns a NAMED
 *  reason instead of a raw constraint-violation 500 - `api/_room-publish.js`'s
 *  ROOM_FREE_CAP_MIN/MAX precedent exactly. */
export const ROOM_PRICE_MIN_INR = 299;
export const ROOM_PRICE_MAX_INR = 599;
export const ROOM_PRICE_CURRENCY = "INR";
/** 25.00%, in basis points - migration 078's default and every price row's
 *  default. A column, not only a constant: "a product decision that lives in
 *  a deployed constant moves by deploy" (071's own argument for the free
 *  cap), and the platform's cut is exactly that kind of decision. */
export const PLATFORM_TAKE_BP_DEFAULT = 2500;
/** No TDS rate has been set by the owner. Zero rather than a guessed
 *  percentage: `context/rejected.md`'s no-fake-numbers law applied to a tax
 *  withholding rate nobody has decided, which is a worse thing to invent than
 *  almost any other number in this file. */
export const TDS_RATE_BP_DEFAULT = 0;
/** The operator's own guess at which section of India's Income Tax Act
 *  applies to a creator's Room earnings on this platform - 194J (fees for
 *  professional or technical services) reads closest, but this is NOT a tax
 *  opinion anyone here is authorized to give (WS-R36's own law 2). The rate
 *  actually withheld stays `TDS_RATE_BP_DEFAULT` (0) regardless of what this
 *  sentence says; the sentence exists so a creator reading their own
 *  statement sees the identical caveat the code carries, never a rate
 *  presented as settled when nobody has confirmed it. The owner must confirm
 *  the section and the rate with an accountant before the first real payout. */
export const TDS_DISCLOSURE_SENTENCE =
  "TDS reflects the rate the platform operator has configured. Right now that rate is 0%, so nothing is withheld. " +
  "The operator believes Section 194J of India's Income Tax Act applies to a creator's Room earnings, but an accountant has not confirmed this, and the rate may change before any real payout is sent.";
/** A creator whose Room sits in a paying Suite receives this share of that
 *  Suite's own per-seat price, for every period the Room was attached at
 *  build time (`vy_room.org_id`, read fresh, never stored anywhere else).
 *  Migration 095 shipped a Suite's own seat revenue as 100% platform take
 *  with the distribution question named, not answered
 *  (`context/decisions.md#ws-r33-suite-seat-revenue-not-distributed-to-creators`).
 *  This is that answer for v0: a FLAT share of the Suite's own per-seat
 *  PRICE, never a re-derivation of what the Suite's ledger rows actually
 *  COLLECTED - a Suite pays one subscription for N seats, so there is no
 *  per-Room amount collected to divide, only a flat per-seat price known
 *  ahead of any billing event. 50% is the operator's own placeholder, not a
 *  measured or negotiated number - `context/rejected.md`'s no-fake-numbers
 *  law applied to a revenue split nobody has agreed to yet. Reverses the day
 *  a Suite wants a different split: this becomes a per-org column rather
 *  than one platform-wide basis-point figure. */
export const SUITE_SEAT_SHARE_BP = 5000;

/** The creator tier's own two priced plans, from the Rooms plan itself
 *  (api/_payments.js's original header: "creator pays for capacity...
 *  Build free, Room, Studio, Institute"). 'institute' has no fixed self-serve
 *  price - it is sold to a Suite (`SUITE_SEAT_PRICE_INSTITUTE_INR`,
 *  api/_org.js), never charged to one creator directly, so
 *  `startCreatorSubscription` below refuses it by name. */
export const CREATOR_TIER_ROOM_PRICE_INR = 4999;
export const CREATOR_TIER_STUDIO_PRICE_INR = 19999;
const CREATOR_TIER_PLAN_PRICE_INR = Object.freeze({
  room: CREATOR_TIER_ROOM_PRICE_INR,
  studio: CREATOR_TIER_STUDIO_PRICE_INR,
});

/** One secret-store entry for the whole platform's Razorpay credential - see
 *  the header. A uuid so `_channel-secrets.js`'s own `secretNameFor` accepts
 *  it unchanged; fixed rather than derived so every deployment resolves the
 *  same Key Vault name. */
export const PAYMENTS_SECRET_REF = "00000000-0000-4000-8000-0000000000f1";

const PROVIDERS = Object.freeze({ fake: fakeProvider, razorpay: razorpayProvider });

export class PaymentsError extends Error {
  constructor(code, status = 400, details) {
    super(code);
    this.code = code;
    this.status = status;
    if (details) this.details = details;
  }
}

/** Which provider this deployment runs, resolved per call rather than cached
 *  at import - `_channel-secrets.js`'s `activeBackend`'s own reasoning: an eval
 *  can drive every arm in one process, and a serverless instance that warms
 *  before the env is present does not pin `none` for its whole life. */
export function activeProviderName(env = process.env) {
  return String(env.PAYMENTS_PROVIDER || "none");
}

// Exported (WS-R37): api/_renewals.js's three cancel functions resolve the
// same provider twin through this one function - "this file never branches
// on which provider it is talking to beyond selecting it once" (this file's
// own header), restated for a second caller.
export function providerFor(name) {
  if (name === "none") throw new PaymentsError("payments_not_configured", 503, { reason: "PAYMENTS_PROVIDER is unset" });
  const provider = PROVIDERS[name];
  if (!provider) throw new PaymentsError("payments_provider_unknown", 500, { provider: name });
  return provider;
}

/**
 * The provider's credential. `fake` reads three env vars, no network, no
 * secret store - the whole point of the fake provider is that nothing above
 * this line needs an Azure account to prove itself. `razorpay` reads the ONE
 * JSON blob behind `PAYMENTS_SECRET_REF` through the channel-secret backend
 * seam; its default backend (`none`) refuses, which is what makes
 * `PAYMENTS_PROVIDER=razorpay` with no Key Vault configured fail loudly at
 * the first subscribe rather than mint a row nothing can ever collect on.
 */
export async function providerSecrets(providerName, env = process.env, backend) {
  if (providerName === "fake") {
    const webhookSecret = String(env.PAYMENTS_FAKE_WEBHOOK_SECRET || "");
    if (!webhookSecret) throw new PaymentsError("payments_provider_credentials_missing", 503);
    return {
      keyId: String(env.PAYMENTS_FAKE_KEY_ID || "fake_key_id"),
      keySecret: String(env.PAYMENTS_FAKE_KEY_SECRET || "fake_key_secret"),
      webhookSecret,
    };
  }
  let raw;
  try {
    raw = await getChannelSecret(PAYMENTS_SECRET_REF, backend);
  } catch (e) {
    throw e instanceof ChannelSecretError ? new PaymentsError(e.code, e.status) : e;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new PaymentsError("payments_secret_shape_invalid", 500);
  }
  if (!parsed?.keyId || !parsed?.keySecret || !parsed?.webhookSecret) {
    throw new PaymentsError("payments_secret_shape_invalid", 500);
  }
  return parsed;
}

// ─────────────────────────────────────────────────────────────────────────
// THE FOLLOWER SESSION - the same room session api/_room-surface.js mints
// ─────────────────────────────────────────────────────────────────────────

/** `roomSay`'s own preamble, one file over: the session names a room and a
 *  person, the room resolved NOW must be the room the token was minted
 *  against, and the follower must have actually joined. Reused rather than
 *  re-implemented, `surface-bypasses-parse`'s discipline applied to identity
 *  rather than to a reply. */
// Exported (WS-R37): api/_renewals.js's follower-lane `cancelRenewal` reuses
// this exact identity resolution rather than re-deriving it - the same
// "reuse the seam, never re-implement" rule this file's own header states
// for the provider twins, applied to identity instead of HTTP.
export async function paidSessionScope(db, session, deps) {
  const payload = readRoomSession(session, deps.env);
  const now = deps.now ?? Date.now();
  assertSessionFresh(payload, now);
  const resolved = await resolveRoom(db, payload.r, deps);
  if (String(resolved.room.room_id) !== String(payload.i) || String(resolved.agentId) !== String(payload.a)) {
    throw roomUnavailable();
  }
  const follower = await followerRow(db, resolved.room.room_id, payload.p, resolved.agentId);
  if (!follower || follower.age_attested_at == null) throw new RoomError("room_join_required", 403);
  return { room: resolved.room, follower };
}

// ─────────────────────────────────────────────────────────────────────────
// THE OWNER-SCOPED ROOM HANDLE - api/_room-publish.js's `ownedRoomRow`, the
// two columns this file actually needs
// ─────────────────────────────────────────────────────────────────────────

async function ownedRoomForPayments(db, ownerUserId, replicaId) {
  if (!UUID.test(String(ownerUserId || "")) || !UUID.test(String(replicaId || ""))) {
    throw new PaymentsError("room_publish_identity_invalid", 400);
  }
  const rows = await db(
    `select room_id, slug, replica_id, owner_user_id
       from vy_room
      where owner_user_id = ($1)::uuid and replica_id = ($2)::uuid
      limit 1`,
    [String(ownerUserId).toLowerCase(), String(replicaId).toLowerCase()],
  );
  return rows[0] || null;
}

// ─────────────────────────────────────────────────────────────────────────
// THE PRICE - set by the creator, inside the band, never outside it
// ─────────────────────────────────────────────────────────────────────────

export function clientPrice(row) {
  if (!row) return null;
  return {
    room_id: row.room_id,
    follower_price_inr: Number(row.follower_price_inr),
    currency: row.currency,
    platform_take_bp: Number(row.platform_take_bp),
    updated_at: row.updated_at ?? null,
  };
}

export async function getRoomPrice(db, ownerUserId, replicaId) {
  const room = await ownedRoomForPayments(db, ownerUserId, replicaId);
  if (!room) return null;
  const rows = await db(
    `select room_id, follower_price_inr, currency, platform_take_bp, updated_at
       from vy_room_price where room_id = ($1)::uuid limit 1`,
    [String(room.room_id)],
  );
  return clientPrice(rows[0] || null);
}

/** Upsert, idempotent on the room - `api/_room-publish.js`'s `setRoomFreeCap`
 *  one table over. The band is enforced here AND by migration 078's own
 *  CHECK; this copy is what turns a bad value into a named reason instead of
 *  a raw 500. */
export async function setRoomPrice(db, ownerUserId, replicaId, priceInr) {
  const room = await ownedRoomForPayments(db, ownerUserId, replicaId);
  if (!room) return null;
  const n = Number(priceInr);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < ROOM_PRICE_MIN_INR || n > ROOM_PRICE_MAX_INR) {
    throw new PaymentsError("room_price_invalid", 400, { min: ROOM_PRICE_MIN_INR, max: ROOM_PRICE_MAX_INR });
  }
  const rows = await db(
    `insert into vy_room_price (room_id, owner_user_id, follower_price_inr, currency, platform_take_bp)
     values (($1)::uuid, ($2)::uuid, ($3)::int4, $4, ($5)::int4)
     on conflict (room_id) do update
        set follower_price_inr = excluded.follower_price_inr, updated_at = now()
     returning room_id, follower_price_inr, currency, platform_take_bp, updated_at`,
    [String(room.room_id), String(room.owner_user_id), n, ROOM_PRICE_CURRENCY, PLATFORM_TAKE_BP_DEFAULT],
  );
  return clientPrice(rows[0] || null);
}

// ─────────────────────────────────────────────────────────────────────────
// THE SUBSCRIBE FLOW - the follower's side
// ─────────────────────────────────────────────────────────────────────────

/**
 * Start (or resume) a follower's subscription to this room.
 *
 * IDEMPOTENT ON THE FOLLOWER, `vy_room_subscription_follower_live_ix`'s own
 * guarantee read here rather than relied on blind: an existing non-terminal
 * row is returned (if it already has a provider ref) or retried (if a prior
 * attempt died between the local insert and the provider call, leaving a
 * `created` row with no ref) - never a second row racing the first.
 *
 * NEVER INVENTS A SUBSCRIPTION. `PAYMENTS_PROVIDER=none` refuses before any
 * row is written; no price set refuses before any provider is called.
 */
export async function startFollowerSubscription(db, { session }, deps = {}) {
  const env = deps.env ?? process.env;
  const { room, follower } = await paidSessionScope(db, session, deps);

  const providerName = activeProviderName(env);
  const provider = providerFor(providerName);

  const priceRows = await db(
    `select follower_price_inr from vy_room_price where room_id = ($1)::uuid limit 1`,
    [String(room.room_id)],
  );
  const price = priceRows[0];
  if (!price) throw new PaymentsError("room_price_not_set", 409);
  const priceInr = Number(price.follower_price_inr);

  const existingRows = await db(
    `select subscription_id, provider_subscription_ref, state
       from vy_room_subscription
      where follower_id = ($1)::uuid
        and state in ('created','authenticated','active','paused')
      order by created_at desc
      limit 1`,
    [String(follower.follower_id)],
  );
  let subscriptionId = existingRows[0]?.subscription_id || null;
  let providerRef = existingRows[0]?.provider_subscription_ref || null;
  let state = existingRows[0]?.state || null;

  if (!subscriptionId) {
    const created = await db(
      `insert into vy_room_subscription (room_id, person_id, follower_id, provider, state)
       values (($1)::uuid, ($2)::uuid, ($3)::uuid, $4, 'created')
       returning subscription_id, state`,
      [String(room.room_id), String(follower.person_id), String(follower.follower_id), providerName],
    );
    subscriptionId = created[0]?.subscription_id || null;
    state = created[0]?.state || "created";
  }
  if (!subscriptionId) throw new PaymentsError("payments_subscription_create_failed", 503);

  if (providerRef) {
    // Already minted on a previous call - return it rather than call the
    // provider again. A fresh checkout link for an abandoned mandate flow is
    // a real gap: not built here, named in this workstream's final report.
    return { subscription_id: subscriptionId, provider: providerName, provider_subscription_ref: providerRef, checkout_url: null, state };
  }

  const secrets = deps.secrets ?? (await providerSecrets(providerName, env, deps.secretBackend));
  const created = await provider.createSubscription(
    { priceInr, label: room.slug, ref: String(follower.follower_id) },
    secrets,
  );
  providerRef = String(created.provider_subscription_ref || "");
  if (!providerRef) throw new PaymentsError("payments_provider_subscription_failed", 502);

  const updated = await db(
    `update vy_room_subscription
        set provider_subscription_ref = $2, updated_at = now()
      where subscription_id = ($1)::uuid
      returning state`,
    [String(subscriptionId), providerRef],
  );
  state = updated[0]?.state ?? state;

  return {
    subscription_id: subscriptionId,
    provider: providerName,
    provider_subscription_ref: providerRef,
    checkout_url: created.checkout_url ?? null,
    state,
  };
}

/** The follower's own honest read: their tier and their subscription's state,
 *  never more than that - no other follower's anything, `docs/SURFACES.md`'s
 *  rule for this whole surface. `price_inr`/`currency` (WS-R37) are the
 *  room's CURRENT price - `startFollowerSubscription`'s own read one section
 *  up - so the subscription panel can state "renews on X for Y" without a
 *  second endpoint; absent when the room has never had one set. */
export async function followerSubscriptionStatus(db, { session }, deps = {}) {
  const { room, follower } = await paidSessionScope(db, session, deps);
  const rows = await db(
    `select subscription_id, provider, state, current_period_start, current_period_end,
            cancel_at_period_end
       from vy_room_subscription
      where follower_id = ($1)::uuid
      order by created_at desc
      limit 1`,
    [String(follower.follower_id)],
  );
  const row = rows[0] || null;
  const priceRows = await db(
    `select follower_price_inr, currency from vy_room_price where room_id = ($1)::uuid limit 1`,
    [String(room.room_id)],
  );
  const price = priceRows[0] || null;
  return {
    tier: follower.tier === "paid" ? "paid" : "free",
    price_inr: price ? Number(price.follower_price_inr) : null,
    currency: price ? price.currency : null,
    subscription: row && {
      subscription_id: row.subscription_id,
      provider: row.provider,
      state: row.state,
      current_period_start: row.current_period_start ?? null,
      current_period_end: row.current_period_end ?? null,
      cancel_at_period_end: row.cancel_at_period_end === true,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────
// THE SUITE'S OWN SUBSCRIPTION - a Suite pays per seat, monthly, through the
// SAME seam (WS-R33). `startOrgSubscription`/`updateOrgSeats` are the ops
// `api/_org.js`'s `orgSubscriptionStatus` (a read, WS-R28) was built beside
// but never wrote to - "table and read only, no start-subscription writer
// built" (that file's own header). Admin-only, exactly like every write in
// `api/_org.js`; the admin check is repeated here rather than imported,
// since `api/_org.js` exports no bare "is this owner an admin" helper and
// this file's own house style is "the decision lives where the write is."
// ─────────────────────────────────────────────────────────────────────────

function clientOrgSubscription(row) {
  if (!row) return null;
  return {
    subscription_id: row.subscription_id,
    plan: row.plan,
    seats: Number(row.seats),
    price_per_seat_inr: Number(row.price_per_seat_inr),
    currency: row.currency,
    state: row.state,
    provider: row.provider,
    current_period_start: row.current_period_start ?? null,
    current_period_end: row.current_period_end ?? null,
  };
}

// Exported (WS-R37): api/_renewals.js's org-lane `cancelRenewal` reuses this
// exact admin check rather than a second, hand-rolled join over
// vy_org_member - `paidSessionScope`'s own reasoning one section up.
export async function orgAdminOrThrow(db, orgId, adminOwnerUserId) {
  const rows = await db(
    `select o.org_id, o.slug, o.plan, o.seat_limit
       from vy_org o
       join vy_org_member m on m.org_id = o.org_id and m.owner_user_id = ($2)::uuid and m.role = 'admin'
      where o.org_id = ($1)::uuid
      limit 1`,
    [String(orgId), String(adminOwnerUserId)],
  );
  if (!rows[0]) throw new PaymentsError("org_not_found", 404);
  return rows[0];
}

/**
 * Start (or resume) a Suite's own seat subscription. IDEMPOTENT ON THE ORG,
 * `startFollowerSubscription`'s own shape one section up: an existing
 * non-terminal row is returned (if it already has a provider ref) or
 * resumed (if a prior attempt died between the local insert and the
 * provider call). NEVER INVENTS A SUBSCRIPTION - `PAYMENTS_PROVIDER=none`
 * refuses before any row is written.
 */
export async function startOrgSubscription(db, { ownerUserId, orgId, plan, seats }, deps = {}) {
  const env = deps.env ?? process.env;
  if (!UUID.test(String(ownerUserId || "")) || !UUID.test(String(orgId || ""))) {
    throw new PaymentsError("org_owner_identity_invalid", 400);
  }
  const org = await orgAdminOrThrow(db, orgId, ownerUserId);

  const orgPlan = plan === "institute" ? "institute" : plan === "starter" ? "starter" : null;
  if (!orgPlan) throw new PaymentsError("org_subscription_plan_invalid", 400);
  const seatCount = Number.isFinite(Number(seats)) ? Math.trunc(Number(seats)) : Number(org.seat_limit) || 1;
  const minSeats = orgPlan === "institute" ? 10 : 1;
  if (!Number.isInteger(seatCount) || seatCount < minSeats || seatCount > 500) {
    throw new PaymentsError("org_subscription_seats_invalid", 400, { min: minSeats, max: 500 });
  }
  const pricePerSeatInr = orgPlan === "institute" ? 1999 : 2999;

  const providerName = activeProviderName(env);
  const provider = providerFor(providerName);

  const existingRows = await db(
    `select subscription_id, provider_subscription_ref, state, seats
       from vy_org_subscription
      where org_id = ($1)::uuid
        and state in ('created','authenticated','active','paused')
      order by created_at desc
      limit 1`,
    [String(orgId)],
  );
  let subscriptionId = existingRows[0]?.subscription_id || null;
  let providerRef = existingRows[0]?.provider_subscription_ref || null;
  let state = existingRows[0]?.state || null;

  if (!subscriptionId) {
    const created = await db(
      `insert into vy_org_subscription (org_id, plan, seats, price_per_seat_inr, currency, provider, state)
       values (($1)::uuid, $2, ($3)::int4, ($4)::int4, $5, $6, 'created')
       returning subscription_id, state`,
      [String(orgId), orgPlan, seatCount, pricePerSeatInr, ROOM_PRICE_CURRENCY, providerName],
    );
    subscriptionId = created[0]?.subscription_id || null;
    state = created[0]?.state || "created";
  }
  if (!subscriptionId) throw new PaymentsError("payments_subscription_create_failed", 503);

  if (providerRef) {
    return { subscription_id: subscriptionId, provider: providerName, provider_subscription_ref: providerRef, checkout_url: null, state, seats: existingRows[0]?.seats ?? seatCount };
  }

  const secrets = deps.secrets ?? (await providerSecrets(providerName, env, deps.secretBackend));
  const created = await provider.createSubscription(
    { priceInr: pricePerSeatInr * seatCount, label: org.slug, ref: String(orgId) },
    secrets,
  );
  providerRef = String(created.provider_subscription_ref || "");
  if (!providerRef) throw new PaymentsError("payments_provider_subscription_failed", 502);

  const updated = await db(
    `update vy_org_subscription
        set provider_subscription_ref = $2, updated_at = now()
      where subscription_id = ($1)::uuid
      returning state, seats`,
    [String(subscriptionId), providerRef],
  );
  state = updated[0]?.state ?? state;

  return {
    subscription_id: subscriptionId,
    provider: providerName,
    provider_subscription_ref: providerRef,
    checkout_url: created.checkout_url ?? null,
    state,
    seats: updated[0]?.seats ?? seatCount,
  };
}

/**
 * Add (or reduce) a Suite's seats on its own LIVE subscription. "Adding a
 * seat is a subscription update through the seam, prorated by the provider,
 * never by us" (this workstream's own law 3): once a provider ref exists,
 * the new quantity is sent to the provider FIRST, and the local row is only
 * ever updated with what the provider actually accepted. A subscription that
 * has not yet been authenticated (no provider ref) has nothing for a
 * provider to prorate, so the local row alone is updated.
 */
export async function updateOrgSeats(db, { ownerUserId, orgId, seats }, deps = {}) {
  const env = deps.env ?? process.env;
  if (!UUID.test(String(ownerUserId || "")) || !UUID.test(String(orgId || ""))) {
    throw new PaymentsError("org_owner_identity_invalid", 400);
  }
  await orgAdminOrThrow(db, orgId, ownerUserId);

  const seatCount = Number.isFinite(Number(seats)) ? Math.trunc(Number(seats)) : NaN;
  if (!Number.isInteger(seatCount) || seatCount < 1 || seatCount > 500) {
    throw new PaymentsError("org_subscription_seats_invalid", 400, { min: 1, max: 500 });
  }

  const rows = await db(
    `select subscription_id, provider, provider_subscription_ref, plan, price_per_seat_inr, currency, state
       from vy_org_subscription
      where org_id = ($1)::uuid
        and state in ('created','authenticated','active','paused')
      order by created_at desc
      limit 1`,
    [String(orgId)],
  );
  const sub = rows[0];
  if (!sub) throw new PaymentsError("org_subscription_not_started", 409);

  const usedRows = await db(
    `select count(*)::int as seats_used from vy_room where org_id = ($1)::uuid`,
    [String(orgId)],
  );
  const seatsUsed = Number(usedRows[0]?.seats_used || 0);
  if (seatCount < seatsUsed) {
    throw new PaymentsError("org_seats_below_usage", 409, { seats_used: seatsUsed, requested: seatCount });
  }

  if (sub.provider_subscription_ref) {
    const secrets = deps.secrets ?? (await providerSecrets(sub.provider, env, deps.secretBackend));
    const provider = providerFor(sub.provider);
    await provider.updateSubscriptionQuantity(sub.provider_subscription_ref, seatCount, secrets);
  }

  const updated = await db(
    `update vy_org_subscription
        set seats = ($2)::int4, updated_at = now()
      where subscription_id = ($1)::uuid
      returning subscription_id, seats, state`,
    [String(sub.subscription_id), seatCount],
  );
  return { subscription_id: updated[0].subscription_id, seats: Number(updated[0].seats), state: updated[0].state };
}

// ─────────────────────────────────────────────────────────────────────────
// THE CREATOR'S OWN TIER SUBSCRIPTION - what a creator pays the platform for
// capacity (WS-R33). Refuses BEFORE any provider call when a Suite seat
// already covers this creator - law 4, `seatCoversCreatorTier`'s one caller.
// ─────────────────────────────────────────────────────────────────────────

async function ownedReplicaHandle(db, ownerUserId, replicaId) {
  // No `vy_replica` read needed: every caller of this file already knows the
  // replica belongs to the owner by construction (the studio only ever
  // offers this action against the caller's OWN replica id), and this file
  // holds no `vy_replica` query anywhere else - `ownedRoomForPayments`'s own
  // scope (a room row, not a replica row) one section up. UUID shape is
  // still validated, the same "refuse before any write" discipline as every
  // other identity check in this file.
  if (!UUID.test(String(ownerUserId || "")) || !UUID.test(String(replicaId || ""))) {
    throw new PaymentsError("room_publish_identity_invalid", 400);
  }
}

/**
 * Start (or resume) a creator's own tier subscription. REFUSES BEFORE ANY
 * PROVIDER CALL when a Suite seat already covers this creator (law 4) - the
 * exemption check runs first, before the provider is even resolved, so the
 * negative control "a creator charge started while a seat covers them is
 * refused before any provider call" can assert the fake twin recorded zero
 * calls. IDEMPOTENT ON THE REPLICA, the follower/org sections' own shape.
 */
export async function startCreatorSubscription(db, { ownerUserId, replicaId, plan }, deps = {}) {
  await ownedReplicaHandle(db, ownerUserId, replicaId);

  const covered = await (deps.seatCoversCreatorTier ?? seatCoversCreatorTier)(db, ownerUserId, replicaId);
  if (covered) throw new PaymentsError("creator_tier_covered_by_suite", 409);

  const priceInr = CREATOR_TIER_PLAN_PRICE_INR[plan];
  if (!priceInr) throw new PaymentsError("creator_tier_plan_invalid", 400, { plans: Object.keys(CREATOR_TIER_PLAN_PRICE_INR) });

  const env = deps.env ?? process.env;
  const providerName = activeProviderName(env);
  const provider = providerFor(providerName);

  const existingRows = await db(
    `select subscription_id, provider_subscription_ref, state
       from vy_creator_subscription
      where replica_id = ($1)::uuid
        and state in ('created','authenticated','active','paused')
      order by created_at desc
      limit 1`,
    [String(replicaId)],
  );
  let subscriptionId = existingRows[0]?.subscription_id || null;
  let providerRef = existingRows[0]?.provider_subscription_ref || null;
  let state = existingRows[0]?.state || null;

  if (!subscriptionId) {
    const created = await db(
      `insert into vy_creator_subscription (owner_user_id, replica_id, plan, price_inr, currency, provider, state)
       values (($1)::uuid, ($2)::uuid, $3, ($4)::int4, $5, $6, 'created')
       returning subscription_id, state`,
      [String(ownerUserId), String(replicaId), plan, priceInr, ROOM_PRICE_CURRENCY, providerName],
    );
    subscriptionId = created[0]?.subscription_id || null;
    state = created[0]?.state || "created";
  }
  if (!subscriptionId) throw new PaymentsError("payments_subscription_create_failed", 503);

  if (providerRef) {
    return { subscription_id: subscriptionId, provider: providerName, provider_subscription_ref: providerRef, checkout_url: null, state };
  }

  const secrets = deps.secrets ?? (await providerSecrets(providerName, env, deps.secretBackend));
  const created = await provider.createSubscription({ priceInr, label: `creator-tier:${plan}`, ref: String(replicaId) }, secrets);
  providerRef = String(created.provider_subscription_ref || "");
  if (!providerRef) throw new PaymentsError("payments_provider_subscription_failed", 502);

  const updated = await db(
    `update vy_creator_subscription
        set provider_subscription_ref = $2, updated_at = now()
      where subscription_id = ($1)::uuid
      returning state`,
    [String(subscriptionId), providerRef],
  );
  state = updated[0]?.state ?? state;

  return {
    subscription_id: subscriptionId,
    provider: providerName,
    provider_subscription_ref: providerRef,
    checkout_url: created.checkout_url ?? null,
    state,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// THE WEBHOOK - verify, then apply, and never the other order
// ─────────────────────────────────────────────────────────────────────────

/** Razorpay's own webhook event names this ledger will ever hold a row for -
 *  migration 078's `vy_payment_event_kind_check`, restated as the map that
 *  decides what each one does to `vy_room_subscription.state`. Empty string
 *  means "log the event, change nothing" - `subscription.pending` and
 *  `payment.failed` are the provider's own retry ladder narrating itself, not
 *  yet a fact about whether this follower keeps paid access. */
export const KIND_TO_STATE = Object.freeze({
  "subscription.authenticated": "authenticated",
  "subscription.activated": "active",
  "subscription.charged": "active",
  "subscription.resumed": "active",
  "subscription.paused": "paused",
  // All retries exhausted (Subscriptions States, fetched 2026-09-03). Mapped
  // to 'paused' rather than 'cancelled': the mandate is not gone, the card
  // just needs updating, and `resumeRoom`'s own precedent one file over is
  // "taking it down is unconditional, bringing it back is gated" - a halted
  // subscription is not this platform's decision to make final.
  "subscription.halted": "paused",
  "subscription.cancelled": "cancelled",
  // end_date reached. The product does not distinguish "cancelled" from
  // "completed" anywhere downstream (api/_room-surface.js's cap predicate
  // only ever asks `tier <> 'free'`), so both terminal spellings collapse
  // to one.
  "subscription.completed": "cancelled",
  "subscription.pending": "",
  "payment.failed": "",
});

/** WS-R42, migration 104. Which creator-tier webhook kinds represent a
 *  LANDED CHARGE - the two kinds `KIND_TO_STATE` already maps to `active`
 *  that also carry a real payment (as opposed to `subscription.authenticated`,
 *  which activates a mandate with no charge yet). `applyWebhook`'s creator
 *  lane writes a `vy_creator_charge_event` row only for these, and only when
 *  the parsed amount is positive - never for `subscription.pending`/
 *  `payment.failed`/a pause/a cancellation, which still flip
 *  `vy_creator_subscription.state` exactly as before but write no charge row. */
export const CREATOR_CHARGE_KINDS = new Set(["subscription.charged", "subscription.activated"]);

/** Razorpay's own webhook envelope (Webhooks, fetched 2026-09-03):
 *  `{event, payload:{subscription:{entity},payment:{entity}}}`. The fake
 *  provider's test fixtures use the IDENTICAL shape on purpose - this parser
 *  is the one the real provider will hit, not a simplified stand-in for it. */
export function parseWebhookPayload(json) {
  const kind = String(json?.event || "");
  const sub = json?.payload?.subscription?.entity || null;
  const pay = json?.payload?.payment?.entity || null;
  const providerSubscriptionRef = String(sub?.id || "");
  const amountInr = pay?.amount != null && Number.isFinite(Number(pay.amount))
    ? Math.round(Number(pay.amount) / 100)
    : 0;
  const periodStart = sub?.current_start ? new Date(Number(sub.current_start) * 1000).toISOString() : null;
  const periodEnd = sub?.current_end ? new Date(Number(sub.current_end) * 1000).toISOString() : null;
  return { kind, providerSubscriptionRef, amountInr, periodStart, periodEnd };
}

/**
 * Verify a webhook's signature, then apply it. THE ORDER IS THE WHOLE
 * FUNCTION: `verifyWebhookSignature` runs before a single byte of the parsed
 * body is trusted, and a failed verification throws before any database
 * write is even attempted - migration 078's `vy_payment_event_signature_verified`
 * CHECK is what makes the alternative (write the row, note that it failed)
 * structurally impossible, not merely undesired.
 *
 * IDEMPOTENT ON `(provider, provider_event_ref)` - a provider retries a
 * webhook it did not get a 200 for, and the `on conflict ... do nothing`
 * inside the write is what makes a replay a no-op rather than a second split
 * applied to the same rupee.
 *
 * `eventRef` is Razorpay's `X-Razorpay-Event-Id` header (Best Practices,
 * fetched 2026-09-03: "identify duplicate webhooks using the
 * x-razorpay-event-id header"), never a body field - required, and its
 * absence refuses the whole request rather than falling back to a hash of
 * the body, which would make every RETRY of the same event look like a new
 * one the instant the provider changes even one timestamp in it.
 */
export async function applyWebhook(db, { rawBody, signatureHeader, eventRef }, deps = {}) {
  const env = deps.env ?? process.env;
  const providerName = activeProviderName(env);
  const provider = providerFor(providerName);

  const bodyBuf = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody ?? ""), "utf8");
  const secrets = deps.secrets ?? (await providerSecrets(providerName, env, deps.secretBackend));

  const verified = provider.verifyWebhookSignature(bodyBuf, String(signatureHeader || ""), secrets.webhookSecret);
  if (!verified) throw new PaymentsError("payment_webhook_signature_invalid", 401);

  // WS-R26: the persistent abuse gate, kept HERE rather than in the thin
  // handler (api/payments-webhook.js) so a fake `db` can reach the decision -
  // this file's own header, restated. The HMAC check above runs FIRST (law
  // #5): an unsigned flood never reaches this line and never consumes the
  // counter. `deps.ip` is optional so a caller with no request in hand (a
  // future internal retry) is never forced to invent one.
  if (deps.ip) {
    const gate = await consume(db, { scope: "payments_webhook_ip", key: deps.ip, env });
    if (!gate.ok) throw new PaymentsError(gate.code, 429, { retry_after_seconds: gate.retryAfterSeconds });
  }

  const ref = String(eventRef || "").trim();
  if (!ref) throw new PaymentsError("payment_webhook_event_id_required", 400);

  let json;
  try {
    json = JSON.parse(bodyBuf.toString("utf8"));
  } catch {
    throw new PaymentsError("payment_webhook_body_invalid", 400);
  }
  const parsed = parseWebhookPayload(json);
  if (!parsed.kind || !Object.prototype.hasOwnProperty.call(KIND_TO_STATE, parsed.kind)) {
    throw new PaymentsError("payment_webhook_kind_unknown", 400, { kind: parsed.kind });
  }
  if (!parsed.providerSubscriptionRef) {
    throw new PaymentsError("payment_webhook_subscription_ref_missing", 400);
  }

  // WS-R33: THREE subscription tables now share this one webhook door.
  // Resolved in a fixed order (follower, then Suite, then creator tier) -
  // `(provider, provider_subscription_ref)` is unique WITHIN each table
  // (078/091/095's own partial unique indexes), never across them, so at
  // most one of the three lookups below can ever match a given ref, and
  // trying them in order rather than in parallel keeps the common case (a
  // follower webhook, by far the highest volume) at one query instead of
  // three.
  const followerCtxRows = await db(
    `select s.subscription_id, s.room_id,
            coalesce(p.platform_take_bp, $3) as platform_take_bp
       from vy_room_subscription s
       left join vy_room_price p on p.room_id = s.room_id
      where s.provider = $1 and s.provider_subscription_ref = $2
      limit 1`,
    [providerName, parsed.providerSubscriptionRef, PLATFORM_TAKE_BP_DEFAULT],
  );
  let lane = null;
  let ctx = followerCtxRows[0] || null;
  if (ctx) {
    lane = "follower";
  } else {
    const orgCtxRows = await db(
      `select subscription_id, org_id from vy_org_subscription where provider = $1 and provider_subscription_ref = $2 limit 1`,
      [providerName, parsed.providerSubscriptionRef],
    );
    if (orgCtxRows[0]) {
      lane = "org";
      ctx = orgCtxRows[0];
    } else {
      const creatorCtxRows = await db(
        `select subscription_id, owner_user_id, replica_id
           from vy_creator_subscription where provider = $1 and provider_subscription_ref = $2 limit 1`,
        [providerName, parsed.providerSubscriptionRef],
      );
      if (creatorCtxRows[0]) {
        lane = "creator";
        ctx = creatorCtxRows[0];
      }
    }
  }
  if (!lane) throw new PaymentsError("payments_subscription_unknown", 404);

  const nextState = KIND_TO_STATE[parsed.kind];
  const payloadHash = sha256Hex(bodyBuf);

  // ── THE CREATOR TIER LANE (WS-R42, migration 104): the state flip is
  //    UNCHANGED from WS-R33 - still the state machine's own idempotency,
  //    still no split columns, `db/migrations/095_creator_and_org_billing.sql`'s
  //    own header (a creator's own subscription to the platform has no
  //    second party to split revenue with). What is NEW is a SECOND write in
  //    the SAME statement, ONLY when this event is a landed charge
  //    (`CREATOR_CHARGE_KINDS`, positive amount): a `vy_creator_charge_event`
  //    row, idempotent on `(provider, provider_charge_ref)` via that table's
  //    own unique index - `on conflict ... do nothing`, the follower/org
  //    lanes' own dedup shape restated for a dedicated table instead of a
  //    shared one. A non-charge event (a pause, a cancellation, the first
  //    `authenticated`) still flips state exactly as before and writes
  //    nothing here - law 1's "a creator whose seat covers them writes
  //    nothing" holds by construction one level up: `startCreatorSubscription`
  //    refuses before any provider call, so no subscription and no webhook
  //    can ever exist for a covered creator, and this branch is never
  //    reached for them at all. ─────────────────────────────────────────
  if (lane === "creator") {
    const isCreatorCharge = CREATOR_CHARGE_KINDS.has(parsed.kind) && parsed.amountInr > 0;
    const rows = await db(
      `with sub_update as (
         update vy_creator_subscription s
            set state = case when $2 = '' then s.state else $2 end,
                current_period_start = coalesce($3::timestamptz, s.current_period_start),
                current_period_end = coalesce($4::timestamptz, s.current_period_end),
                updated_at = now()
          where s.subscription_id = ($1)::uuid
         returning s.subscription_id, s.state, s.owner_user_id, s.replica_id
       ), charge_insert as (
         insert into vy_creator_charge_event
           (owner_user_id, replica_id, subscription_id, provider, provider_charge_ref, amount_inr, signature_verified, payload_hash)
         select su.owner_user_id, su.replica_id, su.subscription_id, $5, $6, ($7)::int4, true, $8
           from sub_update su
          where ($9)::boolean
         on conflict (provider, provider_charge_ref) do nothing
         returning charge_id
       )
       select su.subscription_id, su.state, ci.charge_id
         from sub_update su
         left join charge_insert ci on true`,
      [ctx.subscription_id, nextState, parsed.periodStart, parsed.periodEnd,
        providerName, ref, parsed.amountInr, payloadHash, isCreatorCharge],
    );
    const result = rows[0];
    // A replay is only a meaningful concept for a chargeable event - the
    // ledger's own unique index is the ONLY dedup this lane has ever needed
    // for money math (095's own header), so `replay` reports whether a
    // charge-eligible event's own insert deduped, never a general "was this
    // webhook seen before" claim this lane's state flip does not need.
    const replay = isCreatorCharge && !result?.charge_id;
    return {
      applied: true,
      replay,
      lane,
      subscription_id: result?.subscription_id ?? ctx.subscription_id,
      state: result?.state ?? null,
      tier: null,
      offer_marked_paid: null,
      charge_id: result?.charge_id ?? null,
    };
  }

  // ── THE SUITE LANE: a ledger row that names the org, never a room. The
  //    whole amount is platform take today - see the migration's header for
  //    why distributing a Suite's seat charge across its attached creators
  //    is out of scope here rather than invented. ─────────────────────────
  if (lane === "org") {
    const rows = await db(
      `with candidate as (
         insert into vy_payment_event
           (provider, provider_event_ref, org_id, org_subscription_id, kind, amount_inr,
            platform_take_inr, creator_share_inr, signature_verified, payload_hash)
         values ($1,$2,($3)::uuid,($4)::uuid,$5,($6)::int4,($6)::int4,0,true,$7)
         on conflict (provider, provider_event_ref) do nothing
         returning event_id
       ), sub_update as (
         update vy_org_subscription s
            set state = case when $8 = '' then s.state else $8 end,
                current_period_start = coalesce($9::timestamptz, s.current_period_start),
                current_period_end = coalesce($10::timestamptz, s.current_period_end),
                updated_at = now()
           from candidate c
          where s.subscription_id = ($4)::uuid
         returning s.subscription_id, s.state
       )
       select c.event_id, su.subscription_id, su.state
         from candidate c
         left join sub_update su on true`,
      [
        providerName, ref, ctx.org_id, ctx.subscription_id, parsed.kind, parsed.amountInr,
        payloadHash, nextState, parsed.periodStart, parsed.periodEnd,
      ],
    );
    const result = rows[0];
    if (!result) return { applied: false, replay: true, lane, subscription_id: ctx.subscription_id };
    return {
      applied: true,
      replay: false,
      lane,
      subscription_id: result.subscription_id,
      state: result.state,
      tier: null,
      offer_marked_paid: null,
    };
  }

  // ── THE FOLLOWER LANE: unchanged from WS-R11/WS-R30, byte-identical SQL
  //    and behaviour to before this workstream. ──────────────────────────
  const takeBp = Number(ctx.platform_take_bp);
  const platformTakeInr = Math.round((parsed.amountInr * takeBp) / 10000);
  const creatorShareInr = parsed.amountInr - platformTakeInr;

  // WS-R30 (migration 093): the conversion moment's own outcome. "When a
  // subscription becomes active, the most recent open offer for that
  // follower gets outcome 'paid' in the same statement family (a second
  // UPDATE in the webhook's transaction; no new provider call)." Built as a
  // FIFTH CTE (`offer_update`) rather than a second round trip, spliced in
  // ONLY when migration 093 has landed - `isTableAppliedFor`'s own reason,
  // `_room-surface.js`'s seam, restated here: an ungated reference to a table
  // that does not exist yet would turn every webhook into a 500, including
  // the subscription state flip this file existed to make safe BEFORE this
  // workstream. The predicate mirrors `api/_phase-gate.js`'s
  // `markOfferOutcome` (most recent offer with a null outcome, for this
  // follower) - inlined rather than called, because that function's own
  // header explains why: it cannot be, and stay, one statement, once it is
  // ALSO the write that flips `su.state`.
  const offerTableReady = await (deps.tableApplied ?? tableApplied)("vy_room_upgrade_offer");
  const offerCte = offerTableReady
    ? `, offer_update as (
       update vy_room_upgrade_offer o
          set outcome = 'paid', outcome_at = now()
         from sub_update su
        where su.state = 'active'
          and o.offer_id = (
                select offer_id from vy_room_upgrade_offer
                 where follower_id = su.follower_id and outcome is null
                 order by shown_at desc
                 limit 1
              )
       returning o.offer_id
     )`
    : "";
  const offerJoin = offerTableReady ? "\n       left join offer_update ou on true" : "";
  const offerSelect = offerTableReady ? ", ou.offer_id as offer_marked_paid" : "";

  const rows = await db(
    `with candidate as (
       insert into vy_payment_event
         (provider, provider_event_ref, room_id, subscription_id, kind, amount_inr,
          platform_take_inr, creator_share_inr, signature_verified, payload_hash)
       values ($1,$2,($3)::uuid,($4)::uuid,$5,($6)::int4,($7)::int4,($8)::int4,true,$9)
       on conflict (provider, provider_event_ref) do nothing
       returning event_id, subscription_id
     ), sub_update as (
       update vy_room_subscription s
          set state = case when $10 = '' then s.state else $10 end,
              current_period_start = coalesce($11::timestamptz, s.current_period_start),
              current_period_end = coalesce($12::timestamptz, s.current_period_end),
              updated_at = now()
         from candidate c
        where s.subscription_id = c.subscription_id
       returning s.subscription_id, s.follower_id, s.state
     ), follower_update as (
       update vy_room_follower f
          set tier = case when su.state = 'active' then 'paid' else 'free' end,
              updated_at = now()
         from sub_update su
        where f.follower_id = su.follower_id
          and su.state in ('active','cancelled','expired')
       returning f.follower_id, f.tier
     )${offerCte}
     select c.event_id, su.subscription_id, su.state, fu.tier${offerSelect}
       from candidate c
       left join sub_update su on true
       left join follower_update fu on true${offerJoin}`,
    [
      providerName, ref, ctx.room_id, ctx.subscription_id, parsed.kind, parsed.amountInr,
      platformTakeInr, creatorShareInr, payloadHash, nextState, parsed.periodStart, parsed.periodEnd,
    ],
  );
  const result = rows[0];
  if (!result) {
    // ON CONFLICT DO NOTHING fired: this exact (provider, event) pair already
    // landed a row. A no-op, never an error - a webhook retry earns a 200.
    return { applied: false, replay: true, lane: "follower", subscription_id: ctx.subscription_id };
  }
  return {
    applied: true,
    replay: false,
    lane: "follower",
    subscription_id: result.subscription_id,
    state: result.state,
    tier: result.tier ?? null,
    offer_marked_paid: result.offer_marked_paid ?? null,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// THE MONEY STRIP - the owner's real counts, never invented
// ─────────────────────────────────────────────────────────────────────────

/** "subscribers, churn this month, payout, the one-number take" - real counts
 *  only, `api/_room-publish.js`'s `ownerRoomStats` precedent exactly: a room
 *  with no subscribers gets real zeros, never a placeholder. */
export async function ownerRevenue(db, ownerUserId, replicaId, { now = Date.now() } = {}) {
  const room = await ownedRoomForPayments(db, ownerUserId, replicaId);
  if (!room) return null;
  const monthStart = `${new Date(now).toISOString().slice(0, 7)}-01T00:00:00.000Z`;

  const rows = await db(
    `select
        count(*) filter (where s.state = 'active')::int as subscribers,
        count(*) filter (where s.state in ('cancelled','expired') and s.updated_at >= ($2)::timestamptz)::int as churned_this_month,
        coalesce(sum(e.amount_inr) filter (where e.received_at >= ($2)::timestamptz), 0)::int as gross_this_month_inr,
        coalesce(sum(e.platform_take_inr) filter (where e.received_at >= ($2)::timestamptz), 0)::int as platform_take_this_month_inr,
        coalesce(sum(e.creator_share_inr) filter (where e.received_at >= ($2)::timestamptz), 0)::int as creator_share_this_month_inr
       from vy_room_subscription s
       left join vy_payment_event e on e.subscription_id = s.subscription_id
      where s.room_id = ($1)::uuid`,
    [String(room.room_id), monthStart],
  );
  const row = rows[0] || {};

  const payoutRows = await db(
    `select payout_id, period_start, period_end, gross_inr, take_inr, net_inr, tds_inr, state
       from vy_creator_payout
      where owner_user_id = ($1)::uuid
      order by period_start desc
      limit 1`,
    [String(room.owner_user_id)],
  );

  return {
    subscribers: Number(row.subscribers || 0),
    churned_this_month: Number(row.churned_this_month || 0),
    gross_this_month_inr: Number(row.gross_this_month_inr || 0),
    platform_take_this_month_inr: Number(row.platform_take_this_month_inr || 0),
    creator_share_this_month_inr: Number(row.creator_share_this_month_inr || 0),
    latest_payout: payoutRows[0] || null,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// THE MONTHLY PAYOUT ROLL-UP
// ─────────────────────────────────────────────────────────────────────────

/**
 * Roll up every `vy_payment_event` in `[periodStart, periodEnd)` into one
 * `vy_creator_payout` row per owner, PLUS every owner whose Room sits in a
 * paying Suite this moment even if that Room earned nothing from a follower
 * this period (WS-R36) - the Suite share is a reason to see a payout row on
 * its own, not only a bonus line on top of follower revenue. Idempotent on
 * `(owner, period)` - re-running the sweep for a period it already rolled up
 * is a no-op. Every row is created in state `built` (migration 098's new
 * default), never sent anywhere by this function - `sendPayout` is the next,
 * separate step, this file's own "a decision in a handler is a decision no
 * offline eval can reach" restated for build-then-send instead of
 * verify-then-apply.
 *
 * `tdsRateBp` defaults to 0 - see `TDS_RATE_BP_DEFAULT`'s own header.
 * `suiteShareBp` defaults to `SUITE_SEAT_SHARE_BP` - see that constant's own
 * header. Both are parameters, not only constants, so an offline eval (and a
 * future owner-set rate) can drive this function without editing its source.
 *
 * THE ALGEBRA THAT MAKES THE ARITHMETIC GUARANTEE HOLD, spelled out because
 * migration 078's `vy_creator_payout_sums` CHECK (`gross = take + tds + net`)
 * is enforced twice and this is the second time: for every follower event,
 * `platform_take_inr + creator_share_inr = amount_inr` (078's own CHECK), so
 * summed across a period, `take_inr + creator_gross_inr = follower_gross_inr`.
 * `gross_inr` here is `follower_gross_inr + suite_share_inr`; `net_inr` is
 * `(creator_gross_inr + suite_share_inr) - tds_inr`. So
 * `take_inr + tds_inr + net_inr = take_inr + creator_gross_inr + suite_share_inr
 * = follower_gross_inr + suite_share_inr = gross_inr` - the CHECK holds by
 * construction, not by luck, whether or not this owner has a Suite at all.
 */
export async function runPayoutRollup(
  db,
  { periodStart, periodEnd, tdsRateBp = TDS_RATE_BP_DEFAULT, suiteShareBp = SUITE_SEAT_SHARE_BP } = {},
) {
  const start = new Date(periodStart);
  const end = new Date(periodEnd);
  if (!(start instanceof Date) || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || !(end > start)) {
    throw new PaymentsError("payout_period_invalid", 400);
  }
  const tdsBp = Number(tdsRateBp);
  if (!Number.isFinite(tdsBp) || tdsBp < 0 || tdsBp > 10000) throw new PaymentsError("payout_tds_rate_invalid", 400);
  const shareBp = Number(suiteShareBp);
  if (!Number.isFinite(shareBp) || shareBp < 0 || shareBp > 10000) throw new PaymentsError("payout_suite_share_rate_invalid", 400);

  const rows = await db(
    `with per_owner as (
       select r.owner_user_id,
              coalesce(sum(e.amount_inr), 0)::int as follower_gross_inr,
              coalesce(sum(e.platform_take_inr), 0)::int as take_inr,
              coalesce(sum(e.creator_share_inr), 0)::int as creator_gross_inr
         from vy_payment_event e
         join vy_room r on r.room_id = e.room_id
        where e.received_at >= ($1)::timestamptz and e.received_at < ($2)::timestamptz
        group by r.owner_user_id
     ), suite_share as (
       select r.owner_user_id,
              coalesce(sum((os.price_per_seat_inr * ($4)::int4) / 10000), 0)::int as suite_share_inr
         from vy_room r
         join vy_org_subscription os on os.org_id = r.org_id and os.state = 'active'
        where r.org_id is not null
        group by r.owner_user_id
     ), combined as (
       select coalesce(po.owner_user_id, ss.owner_user_id) as owner_user_id,
              coalesce(po.follower_gross_inr, 0) as follower_gross_inr,
              coalesce(po.take_inr, 0) as take_inr,
              coalesce(po.creator_gross_inr, 0) as creator_gross_inr,
              coalesce(ss.suite_share_inr, 0) as suite_share_inr
         from per_owner po
         full outer join suite_share ss on ss.owner_user_id = po.owner_user_id
     ), split_tds as (
       select owner_user_id, take_inr, suite_share_inr,
              (follower_gross_inr + suite_share_inr)::int as gross_inr,
              (((creator_gross_inr + suite_share_inr) * ($3)::int4) / 10000)::int as tds_inr,
              ((creator_gross_inr + suite_share_inr)
                 - (((creator_gross_inr + suite_share_inr) * ($3)::int4) / 10000))::int as net_inr
         from combined
     )
     insert into vy_creator_payout
       (owner_user_id, period_start, period_end, gross_inr, take_inr, net_inr, tds_inr, suite_share_inr)
     select owner_user_id, ($1)::timestamptz, ($2)::timestamptz, gross_inr, take_inr, net_inr, tds_inr, suite_share_inr
       from split_tds
     on conflict (owner_user_id, period_start, period_end) do nothing
     returning payout_id, owner_user_id, gross_inr, take_inr, net_inr, tds_inr, suite_share_inr, state`,
    [start.toISOString(), end.toISOString(), tdsBp, shareBp],
  );
  return rows;
}

// ─────────────────────────────────────────────────────────────────────────
// THE MONEY RECONCILES (WS-R42, migration 104) - a pure function over rows,
// never a query. `evals/payments-reconcile/run.mjs` drives it directly, no
// fake `db` required; `reconcilePeriod` below is the thin DB-backed wrapper
// that fetches what it needs for one period and hands rows to this function,
// `payoutStatementFromRows`/`payoutStatement`'s own pure/impure split
// restated for reconciliation instead of a statement.
//
// ── THE THREE INVARIANTS, AND WHY THE SUITE ONE IS NOT A LEDGER COMPARISON ──
//
// FOLLOWER: `gross_inr - suite_share_inr` on a period's payout row must equal
// the sum of that owner's follower-lane `vy_payment_event` rows in the same
// period - `runPayoutRollup`'s own algebra (this file's own header, "for
// every follower event, platform_take_inr + creator_share_inr = amount_inr...
// gross_inr here is follower_gross_inr + suite_share_inr") checked from the
// OUTSIDE, against real rows, rather than trusted because the SQL says so.
//
// SUITE: the brief that shipped this file first read as "Suite-lane ledger
// sum times SUITE_SEAT_SHARE_BP, equals the sum of suite_share_inr" - and
// that is NOT the invariant `runPayoutRollup` actually holds.
// `context/decisions.md#ws-r36-suite-share-flat-per-seat-not-ledger-derived`
// is explicit: `suite_share_inr` is a FLAT share of the Suite's own CURRENT
// `price_per_seat_inr`, for every Room attached at build time, "never as a
// fan-out of what that Suite's own `vy_payment_event` org-lane rows actually
// collected." A Suite pays ONE subscription for N seats; comparing its own
// ledger total against a PER-ROOM share only coincides when seats-billed
// equals rooms-attached, which is not guaranteed and not what the builder
// checks. So this function recomputes the BUILDER'S OWN FORMULA from
// `suiteRows` (the identical `vy_room join vy_org_subscription` shape
// `runPayoutRollup`'s own `suite_share` CTE reads) and compares THAT against
// the recorded `suite_share_inr` - proving the payout row was not corrupted
// or drifted from what the formula would produce today, which is the
// reconciliation this product's data shape actually supports. Logged with
// its reversal condition: `context/decisions.md#ws-r42-suite-reconcile-recomputes-the-builder-formula`.
//
// CREATOR: `vy_creator_charge_event` (104) has no payout counterpart at all
// (095's own header: 100% platform revenue, nothing to distribute) - summed
// and reported as its own number, never compared against anything.
//
// ── ROUNDING (law 4) ────────────────────────────────────────────────────
// Both `vy_payment_event.amount_inr` and every `vy_creator_payout` money
// column are WHOLE RUPEES - migration 078's own header says so in as many
// words ("amount_inr is whole rupees... the provider's own amounts are paise
// and are divided by 100 the moment a webhook is parsed, never stored as
// paise here"), confirmed by reading the column, not assumed from either
// column's name. So there is no unit CONVERSION anywhere in this function -
// the brief's own assumption of a paise/rupee split between the two tables
// does not hold, logged as `context/decisions.md#ws-r42-ledger-and-payout-are-both-whole-rupees`.
// A difference is still reported in PAISE (the brief's own unit, and the
// smaller unit is the more precise one to name a mismatch in): the rupee
// difference times 100, always an exact multiple of 100 while neither table
// stores a fraction of a rupee. The one real rounding this function performs
// is the Suite share recomputation, and it uses `Math.trunc` on a positive
// product/10000 - Postgres integer division truncates toward zero for
// non-negative operands, `runPayoutRollup`'s own SQL (`(os.price_per_seat_inr
// * ($4)::int4) / 10000`), so this function's copy MUST match it exactly or
// it manufactures a mismatch that is not a real bug - law 4's "the reconcile
// follows the builder" applied here.
function reconcileFollowerLane(ledgerRows, payoutRows, inPeriod) {
  const sumByOwner = new Map();
  const roomsByOwner = new Map();
  for (const r of ledgerRows) {
    if (r.lane !== "follower" || !inPeriod(r.received_at)) continue;
    const owner = String(r.owner_user_id);
    sumByOwner.set(owner, (sumByOwner.get(owner) || 0) + Number(r.amount_inr || 0));
    if (!roomsByOwner.has(owner)) roomsByOwner.set(owner, new Set());
    if (r.room_id != null) roomsByOwner.get(owner).add(String(r.room_id));
  }
  const findings = [];
  for (const p of payoutRows) {
    const owner = String(p.owner_user_id);
    const expectedInr = sumByOwner.get(owner) || 0;
    const actualInr = Number(p.gross_inr || 0) - Number(p.suite_share_inr || 0);
    if (expectedInr !== actualInr) {
      findings.push({
        type: "follower_gross_mismatch",
        owner_user_id: owner,
        room_ids: [...(roomsByOwner.get(owner) || [])],
        expected_inr: expectedInr,
        actual_inr: actualInr,
        difference_paise: (actualInr - expectedInr) * 100,
      });
    }
  }
  return findings;
}

function reconcileSuiteLane(payoutRows, suiteRows, suiteShareBp) {
  const expectedByOwner = new Map();
  const roomsByOwner = new Map();
  for (const s of suiteRows) {
    const owner = String(s.owner_user_id);
    const share = Math.trunc((Number(s.price_per_seat_inr) * Number(suiteShareBp)) / 10000);
    expectedByOwner.set(owner, (expectedByOwner.get(owner) || 0) + share);
    if (!roomsByOwner.has(owner)) roomsByOwner.set(owner, new Set());
    if (s.room_id != null) roomsByOwner.get(owner).add(String(s.room_id));
  }
  const owners = new Set([
    ...expectedByOwner.keys(),
    ...payoutRows.filter((p) => Number(p.suite_share_inr || 0) > 0).map((p) => String(p.owner_user_id)),
  ]);
  const findings = [];
  for (const owner of owners) {
    const expectedInr = expectedByOwner.get(owner) || 0;
    const payout = payoutRows.find((p) => String(p.owner_user_id) === owner);
    const actualInr = payout ? Number(payout.suite_share_inr || 0) : 0;
    if (expectedInr !== actualInr) {
      findings.push({
        type: "suite_share_mismatch",
        owner_user_id: owner,
        room_ids: [...(roomsByOwner.get(owner) || [])],
        expected_inr: expectedInr,
        actual_inr: actualInr,
        difference_paise: (actualInr - expectedInr) * 100,
      });
    }
  }
  return findings;
}

/**
 * Pure. `ledgerRows`: normalized entries `{lane: "follower"|"creator",
 * owner_user_id, room_id?, replica_id?, amount_inr, received_at}` - the org
 * lane is deliberately absent (see this section's own header: the Suite
 * check never sums org-lane ledger rows). `payoutRows`: `vy_creator_payout`
 * rows for exactly this period. `suiteRows`: `{owner_user_id, room_id,
 * org_id, price_per_seat_inr}`, one row per Room attached to an org with an
 * ACTIVE subscription right now - `runPayoutRollup`'s own `suite_share` CTE
 * join, restated for a JS array. `period`: `{start, end}`, ISO strings or
 * anything `Date` parses; only used to filter `ledgerRows` by `received_at`.
 * Never touches a database.
 */
export function reconcile(ledgerRows, payoutRows, suiteRows, period, { suiteShareBp = SUITE_SEAT_SHARE_BP } = {}) {
  const start = new Date(period?.start).getTime();
  const end = new Date(period?.end).getTime();
  const inPeriod = (receivedAt) => {
    const t = new Date(receivedAt).getTime();
    return Number.isFinite(t) && t >= start && t < end;
  };

  const findings = [
    ...reconcileFollowerLane(ledgerRows, payoutRows, inPeriod),
    ...reconcileSuiteLane(payoutRows, suiteRows, suiteShareBp),
  ];

  let creatorLaneTotalInr = 0;
  for (const r of ledgerRows) {
    if (r.lane === "creator" && inPeriod(r.received_at)) creatorLaneTotalInr += Number(r.amount_inr || 0);
  }

  return {
    period: { start: period?.start ?? null, end: period?.end ?? null },
    findings,
    ok: findings.length === 0,
    // The creator lane's own number, reported never compared - this
    // section's own header, "no payout counterpart... reported as its own
    // number."
    creator_lane_total_inr: creatorLaneTotalInr,
  };
}

/**
 * DB-backed. Fetches exactly the rows `reconcile` needs for one period and
 * runs it - `readCreatorTier`'s own "the decision lives where a fake db can
 * reach it, the wrapper is what a handler calls" restated. `suiteRows` reads
 * CURRENT `vy_org_subscription`/`vy_room` state, not a historical snapshot of
 * who was attached at THIS period's own end - this product keeps no such
 * snapshot (same limitation `runPayoutRollup` itself already has: "read
 * fresh, never stored anywhere else"). Reconciling a period other than the
 * most recently built one can therefore report a false Suite finding if
 * attachment changed since - logged with its reversal condition:
 * `context/decisions.md#ws-r42-reconcile-suite-lane-uses-current-attachment`.
 */
export async function reconcilePeriod(db, { periodStart, periodEnd }) {
  const start = new Date(periodStart);
  const end = new Date(periodEnd);
  if (!(start instanceof Date) || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || !(end > start)) {
    throw new PaymentsError("reconcile_period_invalid", 400);
  }
  const followerRows = await db(
    `select r.owner_user_id, e.room_id, e.amount_inr, e.received_at
       from vy_payment_event e
       join vy_room r on r.room_id = e.room_id
      where e.room_id is not null
        and e.received_at >= ($1)::timestamptz and e.received_at < ($2)::timestamptz`,
    [start.toISOString(), end.toISOString()],
  );
  const creatorRows = await db(
    `select owner_user_id, replica_id, amount_inr, received_at
       from vy_creator_charge_event
      where received_at >= ($1)::timestamptz and received_at < ($2)::timestamptz`,
    [start.toISOString(), end.toISOString()],
  );
  const suiteRows = await db(
    `select r.owner_user_id, r.room_id, r.org_id, os.price_per_seat_inr
       from vy_room r
       join vy_org_subscription os on os.org_id = r.org_id and os.state = 'active'
      where r.org_id is not null`,
    [],
  );
  const payoutRows = await db(
    `select owner_user_id, period_start, period_end, gross_inr, take_inr, net_inr, tds_inr, suite_share_inr
       from vy_creator_payout
      where period_start = ($1)::timestamptz and period_end = ($2)::timestamptz`,
    [start.toISOString(), end.toISOString()],
  );
  const ledgerRows = [
    ...followerRows.map((r) => ({
      lane: "follower", owner_user_id: r.owner_user_id, room_id: r.room_id,
      amount_inr: Number(r.amount_inr), received_at: r.received_at,
    })),
    ...creatorRows.map((r) => ({
      lane: "creator", owner_user_id: r.owner_user_id, replica_id: r.replica_id,
      amount_inr: Number(r.amount_inr), received_at: r.received_at,
    })),
  ];
  return reconcile(ledgerRows, payoutRows, suiteRows, { start: start.toISOString(), end: end.toISOString() });
}

/** The ops board's own line (WS-R42): "the count of periods with findings" -
 *  every distinct period this product has ever built a payout for, reconciled
 *  fresh, never cached. `whatsappSpendThisMonth`'s own aggregate-only shape
 *  (api/_ops.js): a count, never a list of which owner or which Room. Capped
 *  at 24 periods (two years of monthly payouts) so this stays a sub-second
 *  board read rather than an unbounded scan as the product ages. */
export async function reconciliationOverview(db, now = Date.now()) {
  const periodRows = await db(
    `select distinct period_start, period_end from vy_creator_payout order by period_start desc limit 24`,
    [],
  );
  let periodsWithFindings = 0;
  for (const p of periodRows) {
    const result = await reconcilePeriod(db, { periodStart: p.period_start, periodEnd: p.period_end });
    if (!result.ok) periodsWithFindings += 1;
  }
  return { periods_checked: periodRows.length, periods_with_findings: periodsWithFindings, generated_at: new Date(now).toISOString() };
}

// ─────────────────────────────────────────────────────────────────────────
// THE PAYOUT STATE MACHINE (WS-R36) - a closed set, one transition each:
// built -> pending_account | queued -> sent -> settled | failed. Every
// function below is exactly ONE UPDATE whose WHERE names the state(s) it
// leaves - `applyWebhook`'s tier-flip precedent, restated for a payout.
// ─────────────────────────────────────────────────────────────────────────

/**
 * built (or a previously stalled pending_account) -> pending_account | queued.
 *
 * NEGATIVE CONTROL (a), by construction: the fund-account lookup runs BEFORE
 * the provider is ever resolved for a real call, and a payout with no
 * verified fund account is flipped straight to `pending_account` with ZERO
 * provider calls - the same "refuse before any provider call" shape
 * `startCreatorSubscription`'s exemption check uses one section up.
 *
 * `pending_account` is treated as re-attemptable from THIS same function
 * (its own WHERE accepts both `built` and `pending_account`), not a separate
 * operator-only unlock: the fix for it (registering a fund account) is a
 * different write than sending money and needs no operator, so simply
 * calling this function again after `registerFundAccount` succeeds is the
 * whole retry mechanism for this one state.
 */
export async function sendPayout(db, { ownerUserId, payoutId }, deps = {}) {
  const env = deps.env ?? process.env;
  if (!UUID.test(String(ownerUserId || "")) || !UUID.test(String(payoutId || ""))) {
    throw new PaymentsError("payout_identity_invalid", 400);
  }
  const providerName = activeProviderName(env);
  const provider = providerFor(providerName);

  const rows = await db(
    `select payout_id, owner_user_id, net_inr, state
       from vy_creator_payout
      where payout_id = ($1)::uuid and owner_user_id = ($2)::uuid
        and state in ('built','pending_account')
      limit 1`,
    [String(payoutId), String(ownerUserId)],
  );
  const payout = rows[0];
  if (!payout) throw new PaymentsError("payout_not_sendable", 409);

  const accountRows = await db(
    `select fund_account_ref from vy_creator_payout_account
      where owner_user_id = ($1)::uuid and provider = $2 and verified_at is not null
      limit 1`,
    [String(ownerUserId), providerName],
  );
  const account = accountRows[0];
  if (!account) {
    const updated = await db(
      `update vy_creator_payout
          set state = 'pending_account'
        where payout_id = ($1)::uuid and state in ('built','pending_account')
       returning state`,
      [String(payoutId)],
    );
    return { payout_id: payoutId, state: updated[0]?.state ?? "pending_account", provider_payout_ref: null };
  }

  const secrets = deps.secrets ?? (await providerSecrets(providerName, env, deps.secretBackend));
  let sent;
  try {
    sent = await provider.sendPayout(
      { fundAccountRef: account.fund_account_ref, amountInr: Number(payout.net_inr), ref: String(payoutId) },
      secrets,
    );
  } catch (e) {
    // built|pending_account -> failed. A provider that refused or errored is
    // recorded rather than left silently stuck at `built` - `failed` is the
    // one state this product retries only through an operator op, never a
    // sweep, so leaving no trace of the failure would make that op unusable.
    await db(
      `update vy_creator_payout set state = 'failed'
        where payout_id = ($1)::uuid and state in ('built','pending_account')`,
      [String(payoutId)],
    );
    throw e instanceof PaymentsError ? e : new PaymentsError("payments_provider_payout_failed", 502);
  }
  const providerRef = String(sent.provider_payout_ref || "");
  if (!providerRef) throw new PaymentsError("payments_provider_payout_failed", 502);

  const updated = await db(
    `update vy_creator_payout
        set state = 'queued', provider_payout_ref = $2
      where payout_id = ($1)::uuid and state in ('built','pending_account')
     returning state, provider_payout_ref`,
    [String(payoutId), providerRef],
  );
  return {
    payout_id: payoutId,
    state: updated[0]?.state ?? "queued",
    provider_payout_ref: updated[0]?.provider_payout_ref ?? providerRef,
  };
}

/**
 * queued -> sent. No live trigger calls this in this workstream - a
 * RazorpayX payout-status webhook or poll would, and building that receiver
 * is Phase 2 work, named here rather than silently missing (this file's own
 * posture for every seam it ships proven-but-unwired, `seatCoversCreatorTier`'s
 * own precedent one file over). Proven by `evals/payouts/run.mjs` directly.
 */
export async function markPayoutSent(db, { payoutId }) {
  if (!UUID.test(String(payoutId || ""))) throw new PaymentsError("payout_identity_invalid", 400);
  const rows = await db(
    `update vy_creator_payout set state = 'sent' where payout_id = ($1)::uuid and state = 'queued' returning state`,
    [String(payoutId)],
  );
  if (!rows[0]) throw new PaymentsError("payout_not_queued", 409);
  return { payout_id: payoutId, state: rows[0].state };
}

/** sent -> settled. Same "no live trigger this workstream" note as
 *  `markPayoutSent` immediately above. */
export async function markPayoutSettled(db, { payoutId }) {
  if (!UUID.test(String(payoutId || ""))) throw new PaymentsError("payout_identity_invalid", 400);
  const rows = await db(
    `update vy_creator_payout set state = 'settled' where payout_id = ($1)::uuid and state = 'sent' returning state`,
    [String(payoutId)],
  );
  if (!rows[0]) throw new PaymentsError("payout_not_sent", 409);
  return { payout_id: payoutId, state: rows[0].state };
}

/**
 * failed -> built, then the SAME built|pending_account -> pending_account|
 * queued logic `sendPayout` uses (called, not duplicated) - "a failed payout
 * is retried by an operator op, never a sweep" (WS-R36's own law 5). Never
 * checks `ownerUserId` - an operator retries any creator's payout - the
 * 404-by-name / `OPS_OWNER_USER_IDS` gate lives in api/payments.js,
 * api/_ops.js's own precedent for where an operator check belongs (the
 * board's own door, never the board's own function).
 */
export async function retryFailedPayout(db, { payoutId }, deps = {}) {
  if (!UUID.test(String(payoutId || ""))) throw new PaymentsError("payout_identity_invalid", 400);
  const rows = await db(
    `update vy_creator_payout set state = 'built'
      where payout_id = ($1)::uuid and state = 'failed'
     returning owner_user_id, state`,
    [String(payoutId)],
  );
  const row = rows[0];
  if (!row) throw new PaymentsError("payout_not_failed", 409);
  return sendPayout(db, { ownerUserId: row.owner_user_id, payoutId }, deps);
}

// ─────────────────────────────────────────────────────────────────────────
// THE FUND ACCOUNT - a reference the provider issued, never a bank detail
// (WS-R36's own law 4).
// ─────────────────────────────────────────────────────────────────────────

/**
 * Register (really: VERIFY and store) a fund account reference the owner
 * brought back from the provider's own onboarding flow. This platform never
 * collects a bank account number or a UPI VPA through its own form - the
 * only thing it ever asks for is the reference string the provider already
 * issued after that exchange happened on the provider's own side.
 */
export async function registerFundAccount(db, { ownerUserId, fundAccountRef }, deps = {}) {
  const env = deps.env ?? process.env;
  if (!UUID.test(String(ownerUserId || ""))) throw new PaymentsError("org_owner_identity_invalid", 400);
  const ref = String(fundAccountRef || "").trim();
  if (!ref || ref.length > 200) throw new PaymentsError("payout_fund_account_ref_invalid", 400);

  const providerName = activeProviderName(env);
  const provider = providerFor(providerName);
  const secrets = deps.secrets ?? (await providerSecrets(providerName, env, deps.secretBackend));
  const result = await provider.registerFundAccount(ref, secrets);
  if (!result?.verified) throw new PaymentsError("payout_fund_account_unverified", 502);

  const rows = await db(
    `insert into vy_creator_payout_account (owner_user_id, provider, fund_account_ref, verified_at)
     values (($1)::uuid, $2, $3, now())
     on conflict (owner_user_id, provider) do update
        set fund_account_ref = excluded.fund_account_ref, verified_at = excluded.verified_at, updated_at = now()
     returning owner_user_id, provider, fund_account_ref, verified_at`,
    [String(ownerUserId), providerName, ref],
  );
  return rows[0];
}

// ─────────────────────────────────────────────────────────────────────────
// THE STATEMENT - one number a creator can check against a bank line
// (WS-R36's own law 1). Nothing per follower, ever.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Pure: turns already-fetched rows into the exact shape law 1 requires - the
 * four numbers, the period, the follower subscription count, the Suite line,
 * the TDS sentence, and the payout's own state and date. No database access,
 * so `evals/payouts/run.mjs` proves this function's own shape without a fake
 * `db` at all - `cohortRow`'s own pure/impure split in api/_room-cohorts.js,
 * restated here for a payout instead of a retention cohort.
 */
export function payoutStatementFromRows(payoutRow, { followerSubscriptions = 0, suiteName = null } = {}) {
  if (!payoutRow) return null;
  const suiteShareInr = Number(payoutRow.suite_share_inr || 0);
  return {
    payout_id: payoutRow.payout_id,
    period_start: payoutRow.period_start,
    period_end: payoutRow.period_end,
    currency: "INR",
    gross_inr: Number(payoutRow.gross_inr),
    take_inr: Number(payoutRow.take_inr),
    tds_inr: Number(payoutRow.tds_inr),
    net_inr: Number(payoutRow.net_inr),
    suite_share_inr: suiteShareInr,
    suite_name: suiteShareInr > 0 ? suiteName : null,
    follower_subscriptions: Number(followerSubscriptions),
    state: payoutRow.state,
    provider_payout_ref: payoutRow.provider_payout_ref ?? null,
    created_at: payoutRow.created_at,
    tds_note: TDS_DISCLOSURE_SENTENCE,
  };
}

/**
 * The owner's own read of one statement. NEGATIVE CONTROL (b), by
 * construction: no select list anywhere in this function (or in
 * `payoutStatementFromRows` above) names `person_id`, `follower_id`, or
 * anything a follower said - `follower_subscriptions` is a `count(distinct
 * ...)` over subscription ids, the same aggregate-only shape
 * `api/_room-cohorts.js` and `api/_ops.js` already prove out, never a list a
 * follower could be picked out of.
 */
export async function payoutStatement(db, ownerUserId, payoutId) {
  if (!UUID.test(String(ownerUserId || "")) || !UUID.test(String(payoutId || ""))) {
    throw new PaymentsError("payout_identity_invalid", 400);
  }
  const rows = await db(
    `select payout_id, period_start, period_end, gross_inr, take_inr, net_inr, tds_inr,
            suite_share_inr, state, provider_payout_ref, created_at
       from vy_creator_payout
      where payout_id = ($1)::uuid and owner_user_id = ($2)::uuid
      limit 1`,
    [String(payoutId), String(ownerUserId)],
  );
  const payout = rows[0];
  if (!payout) return null;

  const countRows = await db(
    `select count(distinct e.subscription_id)::int as follower_subscriptions
       from vy_payment_event e
       join vy_room r on r.room_id = e.room_id
      where r.owner_user_id = ($1)::uuid
        and e.received_at >= ($2)::timestamptz and e.received_at < ($3)::timestamptz`,
    [String(ownerUserId), payout.period_start, payout.period_end],
  );

  let suiteName = null;
  if (Number(payout.suite_share_inr) > 0) {
    const suiteRows = await db(
      `select o.name
         from vy_room r
         join vy_org o on o.org_id = r.org_id
        where r.owner_user_id = ($1)::uuid and r.org_id is not null
        limit 1`,
      [String(ownerUserId)],
    );
    suiteName = suiteRows[0]?.name ?? null;
  }

  return payoutStatementFromRows(payout, {
    followerSubscriptions: countRows[0]?.follower_subscriptions ?? 0,
    suiteName,
  });
}

/** The owner's own list: every period, newest first, for the studio's own
 *  "one statement open at a time" panel - real rows only, `ownerRevenue`'s
 *  own "real zeros, never a placeholder" precedent restated for a list. */
export async function payoutStatements(db, ownerUserId) {
  if (!UUID.test(String(ownerUserId || ""))) throw new PaymentsError("org_owner_identity_invalid", 400);
  const rows = await db(
    `select payout_id, period_start, period_end, gross_inr, net_inr, state, created_at
       from vy_creator_payout
      where owner_user_id = ($1)::uuid
      order by period_start desc`,
    [String(ownerUserId)],
  );
  return rows.map((r) => ({
    payout_id: r.payout_id,
    period_start: r.period_start,
    period_end: r.period_end,
    gross_inr: Number(r.gross_inr),
    net_inr: Number(r.net_inr),
    state: r.state,
    created_at: r.created_at,
  }));
}
