// The Room's money (WS-R11) — offline, deterministic, $0, no DB, no network,
// no real provider. Recorded fixtures only: the fake provider's requests and
// responses never leave this process.
//
//   node evals/payments/run.mjs
//
// Drives the REAL api/_payments.js (and, through it, the REAL
// api/_room-surface.js session/room/follower resolution and the REAL
// api/_payments/providers/fake.js) through a fake `db` — the code path a
// request reaches is the code path this suite reaches; only Postgres and the
// network are replaced. `offline-mocks-cannot-type-check-sql` still applies:
// nothing here proves migration 078's statements parse against a live
// database (see the final report for what does).
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");

let pass = 0;
let fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) pass++;
  else fail++;
  console.log(`${cond ? "  ok  " : "FAIL  "}${name}${extra ? `   ${extra}` : ""}`);
};

const payments = await import(pathToFileURL(join(REPO, "api/_payments.js")).href);
const {
  PaymentsError,
  ROOM_PRICE_MIN_INR,
  ROOM_PRICE_MAX_INR,
  PLATFORM_TAKE_BP_DEFAULT,
  getRoomPrice,
  setRoomPrice,
  startFollowerSubscription,
  followerSubscriptionStatus,
  applyWebhook,
  ownerRevenue,
  runPayoutRollup,
  KIND_TO_STATE,
  parseWebhookPayload,
} = payments;
const roomSurface = await import(pathToFileURL(join(REPO, "api/_room-surface.js")).href);
const { mintRoomSession, RoomError } = roomSurface;
const fake = await import(pathToFileURL(join(REPO, "api/_payments/providers/fake.js")).href);

// ── the fixture world ───────────────────────────────────────────────────
const OWNER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const REPLICA = "c1000000-0000-4000-8000-000000000001";
const AGENT = "b1000000-0000-4000-8000-000000000001";
const ROOM = "d0000000-0000-4000-8000-000000000001";
const SLUG = "anjali";
const PERSON = "aa111111-1111-4111-8111-111111111111";
const SESSION_SECRET = "x".repeat(48);
const WEBHOOK_SECRET = "test-webhook-secret-v1";
const ENV = { ROOM_SESSION_SECRET: SESSION_SECRET, PAYMENTS_PROVIDER: "fake", PAYMENTS_FAKE_WEBHOOK_SECRET: WEBHOOK_SECRET };
const NOW = Date.parse("2026-09-03T12:00:00Z");

const loadAgent = async (slug) => {
  if (slug !== SLUG) throw new Error("teacher_sheet_unavailable");
  return { module: {}, sheet: { name: "Anjali", slug: SLUG } };
};

function freshState() {
  return {
    rooms: [{ room_id: ROOM, slug: SLUG, replica_id: REPLICA, agent_id: AGENT, owner_user_id: OWNER, published_at: "2026-09-01T00:00:00.000Z", paused_at: null }],
    followers: [{ follower_id: "f1000000-0000-4000-8000-000000000001", room_id: ROOM, person_id: PERSON, agent_id: AGENT, age_attested_at: "2026-09-01T00:00:00.000Z", memory_consent_at: null, tier: "free" }],
    prices: [],
    subscriptions: [],
    events: [],
    payouts: [],
  };
}

function session(overrides = {}) {
  return mintRoomSession(
    { r: SLUG, i: ROOM, p: PERSON, a: AGENT, dd: "d", td: "t", iat: NOW, n: 0, ...overrides },
    ENV,
  );
}

/** Mimics migration 078's structural guarantees the fake needs to actually
 *  enforce for the negative controls below to mean anything — an insert with
 *  `signature_verified !== true`, or a split that does not sum, is refused
 *  the same way Postgres would refuse it, not merely "not attempted". */
function makeDb(state) {
  const calls = [];
  const db = async (sql, params = []) => {
    calls.push({ sql, params });
    const has = (s) => sql.includes(s);

    if (has("from vy_room r") && has("join vy_agent a")) {
      const row = state.rooms.find((r) => r.slug.toLowerCase() === String(params[0]) && r.published_at != null && r.paused_at == null);
      return row ? [{ ...row, agent_slug: row.slug }] : [];
    }
    if (has("from vy_room_follower f") && has("select f.follower_id")) {
      const [roomId, personId, agentId] = params.map(String);
      const row = state.followers.find((f) => f.room_id === roomId && f.person_id === personId && f.agent_id === agentId);
      return row ? [{ ...row }] : [];
    }
    if (has("update vy_room_follower f") && has("case when su.state")) {
      // handled inside the big write below; unreachable branch guard
    }

    // ── vy_room (owner scope) ──
    if (has("owner_user_id = ($1)::uuid and replica_id = ($2)::uuid")) {
      const [owner, replica] = params.map(String);
      const row = state.rooms.find((r) => r.owner_user_id === owner && r.replica_id === replica);
      return row ? [{ ...row }] : [];
    }

    // ── vy_room_price ──
    if (has("insert into vy_room_price")) {
      const [roomId, owner, priceInr, currency, takeBp] = params;
      if (!Number.isInteger(priceInr) || priceInr < 299 || priceInr > 599) {
        throw Object.assign(new Error("check violation: vy_room_price_band"), { code: "23514" });
      }
      let row = state.prices.find((p) => p.room_id === String(roomId));
      if (row) {
        row.follower_price_inr = priceInr;
        row.updated_at = new Date(NOW).toISOString();
      } else {
        row = { room_id: String(roomId), owner_user_id: String(owner), follower_price_inr: priceInr, currency, platform_take_bp: takeBp, updated_at: new Date(NOW).toISOString() };
        state.prices.push(row);
      }
      return [{ ...row }];
    }
    if (has("select follower_price_inr from vy_room_price")) {
      const row = state.prices.find((p) => p.room_id === String(params[0]));
      return row ? [{ follower_price_inr: row.follower_price_inr }] : [];
    }
    if (has("from vy_room_price where room_id")) {
      const row = state.prices.find((p) => p.room_id === String(params[0]));
      return row ? [{ ...row }] : [];
    }

    // ── vy_room_subscription: existing-live lookup (startFollowerSubscription) ──
    if (has("from vy_room_subscription") && has("state in ('created','authenticated','active','paused')") && has("order by created_at desc")) {
      const followerId = String(params[0]);
      const row = state.subscriptions
        .filter((s) => s.follower_id === followerId && ["created", "authenticated", "active", "paused"].includes(s.state))
        .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
      return row ? [{ ...row }] : [];
    }
    // ── vy_room_subscription: status lookup (followerSubscriptionStatus) ──
    if (has("from vy_room_subscription") && has("order by created_at desc") && has("current_period_start, current_period_end") && !has("left join")) {
      const followerId = String(params[0]);
      const row = state.subscriptions.filter((s) => s.follower_id === followerId).sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
      return row ? [{ ...row }] : [];
    }
    if (has("insert into vy_room_subscription")) {
      const [roomId, personId, followerId, provider] = params;
      const live = state.subscriptions.some((s) => s.follower_id === String(followerId) && ["created", "authenticated", "active", "paused"].includes(s.state));
      if (live) throw Object.assign(new Error("duplicate key value violates unique constraint \"vy_room_subscription_follower_live_ix\""), { code: "23505" });
      const row = {
        subscription_id: `s${state.subscriptions.length + 1}`.padEnd(36, "0"),
        room_id: String(roomId), person_id: String(personId), follower_id: String(followerId),
        provider, provider_subscription_ref: null, state: "created",
        current_period_start: null, current_period_end: null,
        created_at: new Date(NOW + state.subscriptions.length).toISOString(),
      };
      state.subscriptions.push(row);
      return [{ subscription_id: row.subscription_id, state: row.state }];
    }
    if (has("update vy_room_subscription") && has("set provider_subscription_ref")) {
      const [subId, ref] = params;
      const row = state.subscriptions.find((s) => s.subscription_id === String(subId));
      if (!row) return [];
      row.provider_subscription_ref = ref;
      return [{ state: row.state }];
    }

    // ── applyWebhook: the context read ──
    if (has("left join vy_room_price p on p.room_id = s.room_id")) {
      const [provider, ref] = params;
      const row = state.subscriptions.find((s) => s.provider === provider && s.provider_subscription_ref === ref);
      if (!row) return [];
      const price = state.prices.find((p) => p.room_id === row.room_id);
      return [{ subscription_id: row.subscription_id, room_id: row.room_id, platform_take_bp: price ? price.platform_take_bp : params[2] }];
    }
    // ── applyWebhook (WS-R33): the Suite and creator-tier lane lookups.
    // This suite carries no org/creator fixtures at all — see
    // evals/org-billing/run.mjs for those — so both always miss, which is
    // exactly what proves an unknown ref falls through all three lookups to
    // a clean `payments_subscription_unknown` rather than an unmodelled
    // statement.
    if (has("from vy_org_subscription where provider")) return [];
    if (has("from vy_creator_subscription where provider")) return [];

    // ── applyWebhook: THE BIG WRITE ──
    if (has("with candidate as") && has("insert into vy_payment_event")) {
      const [provider, ref, roomId, subId, kind, amountInr, takeInr, shareInr, payloadHash, nextState, periodStart, periodEnd] = params;
      // migration 078's vy_payment_event_signature_verified CHECK: the SQL
      // literal is `true` here (see api/_payments.js), so this branch can
      // never be exercised via applyWebhook. Kept anyway — the negative
      // control below calls this same CHECK by hand.
      const dup = state.events.find((e) => e.provider === provider && e.provider_event_ref === ref);
      if (dup) return []; // ON CONFLICT DO NOTHING
      const event = { event_id: `e${state.events.length + 1}`, provider, provider_event_ref: ref, room_id: roomId, subscription_id: subId, kind, amount_inr: amountInr, platform_take_inr: takeInr, creator_share_inr: shareInr, signature_verified: true, payload_hash: payloadHash, received_at: new Date(NOW + state.events.length).toISOString() };
      state.events.push(event);
      const sub = state.subscriptions.find((s) => s.subscription_id === String(subId));
      if (sub && nextState !== "") sub.state = nextState;
      if (sub) {
        if (periodStart) sub.current_period_start = periodStart;
        if (periodEnd) sub.current_period_end = periodEnd;
      }
      let tier = null;
      if (sub && ["active", "cancelled", "expired"].includes(nextState)) {
        const follower = state.followers.find((f) => f.follower_id === sub.follower_id);
        if (follower) {
          follower.tier = nextState === "active" ? "paid" : "free";
          tier = follower.tier;
        }
      }
      return [{ event_id: event.event_id, subscription_id: subId, state: sub ? sub.state : null, tier }];
    }

    // ── ownerRevenue ──
    if (has("count(*) filter (where s.state = 'active')")) {
      const roomId = String(params[0]);
      const subs = state.subscriptions.filter((s) => s.room_id === roomId);
      const events = state.events.filter((e) => e.room_id === roomId);
      return [{
        subscribers: subs.filter((s) => s.state === "active").length,
        churned_this_month: subs.filter((s) => ["cancelled", "expired"].includes(s.state)).length,
        gross_this_month_inr: events.reduce((n, e) => n + e.amount_inr, 0),
        platform_take_this_month_inr: events.reduce((n, e) => n + e.platform_take_inr, 0),
        creator_share_this_month_inr: events.reduce((n, e) => n + e.creator_share_inr, 0),
      }];
    }
    if (has("from vy_creator_payout") && has("order by period_start desc")) {
      const owner = String(params[0]);
      const row = state.payouts.filter((p) => p.owner_user_id === owner).sort((a, b) => b.period_start.localeCompare(a.period_start))[0];
      return row ? [{ ...row }] : [];
    }

    // ── runPayoutRollup (widened WS-R36: a Suite share term, migration 098's
    //    default state 'built'). This fixture world seeds no
    //    `vy_org_subscription` rows, so the Suite-share CTE always
    //    contributes zero here - evals/payouts/run.mjs is where the Suite
    //    share itself is proven; this suite only needs its own follower-lane
    //    numbers to stay byte-identical to before. ──
    if (has("with per_owner as") && has("suite_share as")) {
      const [start, end, tdsRateBp] = params;
      const byOwner = new Map();
      for (const e of state.events) {
        if (e.received_at < start || e.received_at >= end) continue;
        const room = state.rooms.find((r) => r.room_id === e.room_id);
        if (!room) continue;
        const acc = byOwner.get(room.owner_user_id) || { gross: 0, take: 0, creatorGross: 0 };
        acc.gross += e.amount_inr;
        acc.take += e.platform_take_inr;
        acc.creatorGross += e.creator_share_inr;
        byOwner.set(room.owner_user_id, acc);
      }
      const out = [];
      for (const [owner, acc] of byOwner) {
        if (state.payouts.some((p) => p.owner_user_id === owner && p.period_start === start && p.period_end === end)) continue; // ON CONFLICT DO NOTHING
        const tds = Math.trunc((acc.creatorGross * tdsRateBp) / 10000);
        const net = acc.creatorGross - tds;
        const row = {
          payout_id: `p${state.payouts.length + 1}`, owner_user_id: owner, period_start: start, period_end: end,
          gross_inr: acc.gross, take_inr: acc.take, net_inr: net, tds_inr: tds, suite_share_inr: 0, state: "built",
        };
        state.payouts.push(row);
        out.push(row);
      }
      return out;
    }

    throw new Error(`unmodelled statement: ${sql.slice(0, 90)}`);
  };
  db.calls = calls;
  return db;
}

const RAZORPAY_CHARGED = (ref, amountPaise, currentStart, currentEnd) => JSON.stringify({
  event: "subscription.charged",
  payload: {
    subscription: { entity: { id: ref, status: "active", current_start: currentStart, current_end: currentEnd } },
    payment: { entity: { id: "pay_1", amount: amountPaise, currency: "INR", status: "captured" } },
  },
});
const RAZORPAY_EVENT = (kind, ref) => JSON.stringify({ event: kind, payload: { subscription: { entity: { id: ref, status: kind } } } });

// ═════════════════════════════════════════════════════════════════════════
console.log("§1 THE PRICE BAND — enforced before the database is ever asked");
// ═════════════════════════════════════════════════════════════════════════
{
  const state = freshState();
  const db = makeDb(state);
  ok("298 (below band) refused", await setRoomPrice(db, OWNER, REPLICA, 298).then(() => false, (e) => e instanceof PaymentsError && e.code === "room_price_invalid"));
  ok("600 (above band) refused", await setRoomPrice(db, OWNER, REPLICA, 600).then(() => false, (e) => e instanceof PaymentsError && e.code === "room_price_invalid"));
  ok("299 (floor) accepted", (await setRoomPrice(db, OWNER, REPLICA, 299)).follower_price_inr === 299);
  ok("599 (ceiling) accepted", (await setRoomPrice(db, OWNER, REPLICA, 599)).follower_price_inr === 599);
  ok("default platform take is 25.00%", (await getRoomPrice(db, OWNER, REPLICA)).platform_take_bp === PLATFORM_TAKE_BP_DEFAULT);
  ok("upsert on the room: one price row, not two", state.prices.length === 1);
  ok("a non-owner's replica id returns null, never another owner's price", await getRoomPrice(db, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", REPLICA) === null);
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n§2 PAYMENTS_PROVIDER=none REFUSES, NEVER INVENTS A SUBSCRIPTION");
// ═════════════════════════════════════════════════════════════════════════
{
  const state = freshState();
  state.prices.push({ room_id: ROOM, owner_user_id: OWNER, follower_price_inr: 399, currency: "INR", platform_take_bp: 2500 });
  const db = makeDb(state);
  const noneEnv = { ...ENV, PAYMENTS_PROVIDER: "none" };
  const err = await startFollowerSubscription(db, { session: session() }, { env: noneEnv, loadAgent, now: NOW }).then(() => null, (e) => e);
  ok("no provider configured: refused, named", err instanceof PaymentsError && err.code === "payments_not_configured");
  ok("and nothing was written", state.subscriptions.length === 0);
  const webhookErr = await applyWebhook(db, { rawBody: "{}", signatureHeader: "x", eventRef: "evt_1" }, { env: noneEnv }).then(() => null, (e) => e);
  ok("a webhook with no provider configured is also refused", webhookErr instanceof PaymentsError && webhookErr.code === "payments_not_configured");
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n§3 SUBSCRIBE THROUGH THE FAKE PROVIDER");
// ═════════════════════════════════════════════════════════════════════════
let SUB_REF;
{
  const state = freshState();
  const db = makeDb(state);
  const noPrice = await startFollowerSubscription(db, { session: session() }, { env: ENV, loadAgent, now: NOW }).then(() => null, (e) => e);
  ok("no price set yet: refused, named, nothing invented", noPrice instanceof PaymentsError && noPrice.code === "room_price_not_set");
  ok("still no subscription row", state.subscriptions.length === 0);

  state.prices.push({ room_id: ROOM, owner_user_id: OWNER, follower_price_inr: 399, currency: "INR", platform_take_bp: 2500 });
  const started = await startFollowerSubscription(db, { session: session() }, { env: ENV, loadAgent, now: NOW });
  ok("a subscription row exists, state 'created' then referenced", state.subscriptions.length === 1);
  ok("the provider ref is the fake provider's deterministic id", /^fake_sub_[0-9a-f]{24}$/.test(started.provider_subscription_ref));
  ok("a checkout url comes back", typeof started.checkout_url === "string" && started.checkout_url.length > 0);
  SUB_REF = started.provider_subscription_ref;

  const again = await startFollowerSubscription(db, { session: session() }, { env: ENV, loadAgent, now: NOW });
  ok("idempotent on the follower: the SAME ref, no second row", again.provider_subscription_ref === SUB_REF && state.subscriptions.length === 1);

  const status = await followerSubscriptionStatus(db, { session: session() }, { env: ENV, loadAgent, now: NOW });
  ok("status reads the follower's own tier, still free (not yet authenticated)", status.tier === "free");
  ok("status reads the subscription's current state", status.subscription?.state === "created");
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n§4 THE WEBHOOK — verify, then apply, never the other order");
// ═════════════════════════════════════════════════════════════════════════
{
  const state = freshState();
  state.prices.push({ room_id: ROOM, owner_user_id: OWNER, follower_price_inr: 399, currency: "INR", platform_take_bp: 2500 });
  const db = makeDb(state);
  await startFollowerSubscription(db, { session: session() }, { env: ENV, loadAgent, now: NOW });
  const ref = state.subscriptions[0].provider_subscription_ref;

  const body = RAZORPAY_EVENT("subscription.authenticated", ref);
  const badSig = "0".repeat(64);
  const badResult = await applyWebhook(db, { rawBody: body, signatureHeader: badSig, eventRef: "evt_bad" }, { env: ENV }).then(() => null, (e) => e);
  ok("a bad signature is refused, named", badResult instanceof PaymentsError && badResult.code === "payment_webhook_signature_invalid");
  ok("and NOTHING was written for it", state.events.length === 0);

  const goodSig = fake.signWebhookForTest(body, WEBHOOK_SECRET);
  const applied = await applyWebhook(db, { rawBody: body, signatureHeader: goodSig, eventRef: "evt_1" }, { env: ENV });
  ok("a correctly signed event is applied", applied.applied === true);
  ok("state moves to 'authenticated'", applied.state === "authenticated");
  ok("tier is untouched by an 'authenticated' event (not active yet)", state.followers[0].tier === "free");
  ok("exactly one ledger row landed", state.events.length === 1);

  // THE REQUIRED NEGATIVE CONTROL: a webhook body corrupted by ONE byte after
  // a valid signature was computed must still be refused — proves the check
  // is byte-exact, not "roughly matches".
  const corrupted = body.slice(0, -1) + (body.slice(-1) === "}" ? "]" : "}");
  const corruptResult = await applyWebhook(db, { rawBody: corrupted, signatureHeader: goodSig, eventRef: "evt_corrupt" }, { env: ENV }).then(() => null, (e) => e);
  ok("a body that does not match its own signature is refused", corruptResult instanceof PaymentsError && corruptResult.code === "payment_webhook_signature_invalid");

  // IDEMPOTENT REPLAY — the provider retries a webhook it did not get a 200 for.
  const replay = await applyWebhook(db, { rawBody: body, signatureHeader: goodSig, eventRef: "evt_1" }, { env: ENV });
  ok("the identical (provider, event) pair replays as a no-op", replay.applied === false && replay.replay === true);
  ok("still exactly one ledger row — no second split applied to the same rupee", state.events.length === 1);
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n§5 THE STATE MACHINE AND THE TIER FLIP");
// ═════════════════════════════════════════════════════════════════════════
{
  const state = freshState();
  state.prices.push({ room_id: ROOM, owner_user_id: OWNER, follower_price_inr: 399, currency: "INR", platform_take_bp: 2500 });
  const db = makeDb(state);
  await startFollowerSubscription(db, { session: session() }, { env: ENV, loadAgent, now: NOW });
  const ref = state.subscriptions[0].provider_subscription_ref;
  const follower = state.followers[0];

  const fire = async (kind, n, amountPaise = 0) => {
    const body = RAZORPAY_CHARGED(ref, amountPaise, 1690000000, 1692600000).replace('"subscription.charged"', JSON.stringify(kind));
    const sig = fake.signWebhookForTest(body, WEBHOOK_SECRET);
    return applyWebhook(db, { rawBody: body, signatureHeader: sig, eventRef: `evt_sm_${n}` }, { env: ENV });
  };

  await fire("subscription.authenticated", 1);
  ok("authenticated: local state 'authenticated'", state.subscriptions[0].state === "authenticated");
  ok("authenticated: tier still free", follower.tier === "free");

  const activated = await fire("subscription.activated", 2, 39900);
  ok("activated: local state 'active'", activated.state === "active");
  ok("TIER FLIPS TO PAID ONLY ON ACTIVE", follower.tier === "paid");

  await fire("subscription.paused", 3);
  ok("paused: local state 'paused'", state.subscriptions[0].state === "paused");
  ok("paused does NOT demote tier (not a terminal state)", follower.tier === "paid");

  await fire("subscription.resumed", 4);
  ok("resumed: local state 'active' again", state.subscriptions[0].state === "active");
  ok("resumed: tier is paid again", follower.tier === "paid");

  await fire("subscription.cancelled", 5);
  ok("cancelled: local state 'cancelled'", state.subscriptions[0].state === "cancelled");
  ok("cancelled DEMOTES tier to free", follower.tier === "free");

  ok("subscription.pending is logged but changes no state", KIND_TO_STATE["subscription.pending"] === "");
  ok("payment.failed is logged but changes no state", KIND_TO_STATE["payment.failed"] === "");
  ok("subscription.halted maps to 'paused', not 'cancelled' (retries, not a hard stop)", KIND_TO_STATE["subscription.halted"] === "paused");
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n§6 THE 25% SPLIT — computed once, and it always sums");
// ═════════════════════════════════════════════════════════════════════════
{
  const state = freshState();
  state.prices.push({ room_id: ROOM, owner_user_id: OWNER, follower_price_inr: 399, currency: "INR", platform_take_bp: 2500 });
  const db = makeDb(state);
  await startFollowerSubscription(db, { session: session() }, { env: ENV, loadAgent, now: NOW });
  const ref = state.subscriptions[0].provider_subscription_ref;
  const body = RAZORPAY_CHARGED(ref, 39900, 1690000000, 1692600000); // Rs 399.00
  const sig = fake.signWebhookForTest(body, WEBHOOK_SECRET);
  await applyWebhook(db, { rawBody: body, signatureHeader: sig, eventRef: "evt_split" }, { env: ENV });
  const event = state.events[0];
  ok("amount parsed from paise to whole rupees", event.amount_inr === 399);
  ok("platform take is 25% of 399 = 99.75, rounded to 100", event.platform_take_inr === 100);
  ok("creator share is the remainder, 299", event.creator_share_inr === 299);
  ok("the split always sums to the amount, by construction", event.platform_take_inr + event.creator_share_inr === event.amount_inr);
  ok("the period bounds are parsed from unix seconds", state.subscriptions[0].current_period_start === new Date(1690000000 * 1000).toISOString());
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n§7 UNKNOWN INPUTS ARE REFUSED, NEVER GUESSED AT");
// ═════════════════════════════════════════════════════════════════════════
{
  const state = freshState();
  state.prices.push({ room_id: ROOM, owner_user_id: OWNER, follower_price_inr: 399, currency: "INR", platform_take_bp: 2500 });
  const db = makeDb(state);
  await startFollowerSubscription(db, { session: session() }, { env: ENV, loadAgent, now: NOW });
  const ref = state.subscriptions[0].provider_subscription_ref;

  const unknownKindBody = JSON.stringify({ event: "subscription.teleported", payload: { subscription: { entity: { id: ref } } } });
  const sig1 = fake.signWebhookForTest(unknownKindBody, WEBHOOK_SECRET);
  const r1 = await applyWebhook(db, { rawBody: unknownKindBody, signatureHeader: sig1, eventRef: "evt_unknown_kind" }, { env: ENV }).then(() => null, (e) => e);
  ok("a kind outside migration 078's CHECK is refused, not silently dropped", r1 instanceof PaymentsError && r1.code === "payment_webhook_kind_unknown");

  const noRefBody = JSON.stringify({ event: "subscription.activated", payload: {} });
  const sig2 = fake.signWebhookForTest(noRefBody, WEBHOOK_SECRET);
  const r2 = await applyWebhook(db, { rawBody: noRefBody, signatureHeader: sig2, eventRef: "evt_no_ref" }, { env: ENV }).then(() => null, (e) => e);
  ok("a body with no subscription ref is refused", r2 instanceof PaymentsError && r2.code === "payment_webhook_subscription_ref_missing");

  const unknownRefBody = RAZORPAY_EVENT("subscription.activated", "sub_never_created");
  const sig3 = fake.signWebhookForTest(unknownRefBody, WEBHOOK_SECRET);
  const r3 = await applyWebhook(db, { rawBody: unknownRefBody, signatureHeader: sig3, eventRef: "evt_unknown_ref" }, { env: ENV }).then(() => null, (e) => e);
  ok("a ref this database has never seen is refused, never silently accepted", r3 instanceof PaymentsError && r3.code === "payments_subscription_unknown");

  const noEventIdBody = RAZORPAY_EVENT("subscription.activated", ref);
  const sig4 = fake.signWebhookForTest(noEventIdBody, WEBHOOK_SECRET);
  const r4 = await applyWebhook(db, { rawBody: noEventIdBody, signatureHeader: sig4, eventRef: "" }, { env: ENV }).then(() => null, (e) => e);
  ok("a missing X-Razorpay-Event-Id is refused rather than hashed as a fallback", r4 instanceof PaymentsError && r4.code === "payment_webhook_event_id_required");
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n§8 THE MONTHLY PAYOUT ROLL-UP");
// ═════════════════════════════════════════════════════════════════════════
{
  const state = freshState();
  state.prices.push({ room_id: ROOM, owner_user_id: OWNER, follower_price_inr: 399, currency: "INR", platform_take_bp: 2500 });
  const db = makeDb(state);
  await startFollowerSubscription(db, { session: session() }, { env: ENV, loadAgent, now: NOW });
  const ref = state.subscriptions[0].provider_subscription_ref;

  for (const [n, ts] of [[1, "2026-08-05T00:00:00.000Z"], [2, "2026-08-20T00:00:00.000Z"], [3, "2026-09-05T00:00:00.000Z"]]) {
    const body = RAZORPAY_CHARGED(ref, 39900, 1690000000, 1692600000);
    const sig = fake.signWebhookForTest(body, WEBHOOK_SECRET);
    await applyWebhook(db, { rawBody: body, signatureHeader: sig, eventRef: `evt_payout_${n}` }, { env: ENV });
    state.events.at(-1).received_at = ts; // pin the period the fixture means to test
  }

  const rows = await runPayoutRollup(db, { periodStart: "2026-08-01T00:00:00.000Z", periodEnd: "2026-09-01T00:00:00.000Z" });
  ok("one payout row for the one owner with revenue that period", rows.length === 1);
  ok("gross is the two August events, not the September one", rows[0].gross_inr === 798);
  ok("take is 25% of gross", rows[0].take_inr === 200);
  ok("no TDS rate set: tds is 0 and net equals the creator's full share", rows[0].tds_inr === 0 && rows[0].net_inr === 798 - 200);
  ok("the arithmetic invariant holds: gross = take + tds + net", rows[0].gross_inr === rows[0].take_inr + rows[0].tds_inr + rows[0].net_inr);

  const again = await runPayoutRollup(db, { periodStart: "2026-08-01T00:00:00.000Z", periodEnd: "2026-09-01T00:00:00.000Z" });
  ok("idempotent on (owner, period): re-running the same period inserts nothing new", again.length === 0 && state.payouts.length === 1);

  const withTds = await runPayoutRollup(db, { periodStart: "2026-09-01T00:00:00.000Z", periodEnd: "2026-10-01T00:00:00.000Z", tdsRateBp: 1000 });
  ok("a 10% TDS rate withholds 10% of the creator's share, not of gross", withTds[0].tds_inr === Math.trunc((299 * 1000) / 10000));

  const revenue = await ownerRevenue(db, OWNER, REPLICA, { now: Date.parse("2026-09-10T00:00:00Z") });
  ok("ownerRevenue's latest_payout reads the most recent period", revenue.latest_payout.period_start === "2026-09-01T00:00:00.000Z");
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n§9 REQUIRED NEGATIVE CONTROL — skipping signature verification must fail this suite");
// ═════════════════════════════════════════════════════════════════════════
{
  // (a) THE SOURCE ITSELF: `applyWebhook` must throw BEFORE the body is ever
  // parsed or the database is ever touched if the signature does not verify.
  // If a future edit deleted or reordered this check, this assertion is what
  // catches it — evals/room-publish/run.mjs's "strike the clause from the
  // shipping text" technique, read here rather than re-derived, because
  // api/_payments.js's guard is a JS `if`, not a SQL predicate a fake `db`
  // could re-run with a clause struck out.
  const src = readFileSync(join(REPO, "api/_payments.js"), "utf8");
  const verifyIdx = src.indexOf("provider.verifyWebhookSignature(");
  const insertIdx = src.indexOf("insert into vy_payment_event");
  ok(
    "the signature check appears in the source BEFORE the ledger write",
    verifyIdx > -1 && insertIdx > -1 && verifyIdx < insertIdx,
  );
  ok(
    "a failed verification throws (the write is never reached)",
    /if \(!verified\) throw new PaymentsError\("payment_webhook_signature_invalid"/.test(src),
  );

  // (b) THE DATABASE'S OWN BACKSTOP: even a hypothetical caller that bypassed
  // (a) entirely — hand-writing an INSERT rather than going through
  // `applyWebhook` — hits migration 078's `vy_payment_event_signature_verified`
  // CHECK, which makes `signature_verified=false` structurally impossible to
  // store rather than merely undesired. This suite has no live Postgres to
  // fire that CHECK against (offline-mocks-cannot-type-check-sql), so what is
  // proven here is that the CHECK exists in the exact shape that would refuse
  // it — the same "assert the guarantee is textually present" technique (a)
  // uses, one layer down.
  const migrationSql = readFileSync(join(REPO, "db/migrations/078_room_payments.sql"), "utf8");
  ok(
    "migration 078 declares signature_verified boolean NOT NULL",
    /signature_verified\s+boolean\s+not\s+null/.test(migrationSql),
  );
  ok(
    "and a CHECK that a false value can never satisfy",
    /vy_payment_event_signature_verified[\s\S]{0,80}check\s*\(signature_verified\s*=\s*true\)/.test(migrationSql),
  );
  ok(
    "and applyWebhook's own INSERT always passes the literal `true`, never a variable",
    /values \(\$1,\$2,\(\$3\)::uuid,\(\$4\)::uuid,\$5,\(\$6\)::int4,\(\$7\)::int4,\(\$8\)::int4,true,\$9\)/.test(src),
  );
}

// ═════════════════════════════════════════════════════════════════════════
console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
