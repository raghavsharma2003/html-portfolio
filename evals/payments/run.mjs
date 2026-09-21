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
  MANDATE_KIND_TO_STATE,
  parseWebhookPayload,
} = payments;
const roomSurface = await import(pathToFileURL(join(REPO, "api/_room-surface.js")).href);
const { mintRoomSession, RoomError } = roomSurface;
const fake = await import(pathToFileURL(join(REPO, "api/_payments/providers/fake.js")).href);
const razorpay = await import(pathToFileURL(join(REPO, "api/_payments/providers/razorpay.js")).href);

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
    // WS-R100 (migration 126). Untouched by every test above this
    // workstream's own section - `issueFollowerReceipt` is gated on
    // `tableApplied("vy_receipt")`, which resolves false (the real,
    // DB-less `tableApplied`) unless a case below explicitly overrides it.
    receipts: [],
    receiptCounters: [],
    // WS-R130 (migration 133). Untouched by every test above this
    // workstream's own section - `maybeGrantReferralReward` is gated on
    // `tableApplied("vy_room_referral_credit")`/`"vy_room_referral_reward"`,
    // which resolve false unless a case below explicitly overrides it,
    // `receipts`' own precedent one field up restated.
    referralCredits: [],
    referralRewards: [],
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

    // ── vy_room_subscription: existing-live lookup (startFollowerSubscription).
    // WS-R132 (migration 135): the widened predicate excludes a halted or
    // cancelled MANDATE too, mirroring the real widened index. ──
    if (has("from vy_room_subscription") && has("state in ('created','authenticated','active','paused')") && has("order by created_at desc")) {
      const followerId = String(params[0]);
      const row = state.subscriptions
        .filter((s) => s.follower_id === followerId
          && ["created", "authenticated", "active", "paused"].includes(s.state)
          && !["halted", "cancelled"].includes(s.mandate_state))
        .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
      return row ? [{ ...row }] : [];
    }
    // ── vy_room_subscription: status lookup (followerSubscriptionStatus) ──
    if (has("from vy_room_subscription") && has("order by created_at desc") && has("current_period_start, current_period_end") && !has("left join")) {
      const followerId = String(params[0]);
      const row = state.subscriptions.filter((s) => s.follower_id === followerId).sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
      return row ? [{ ...row }] : [];
    }
    // ── vy_payment_event: WS-R69's own "paused or halted" read
    // (`pausedOrHalted`, api/_payments.js) — the most recent of the two kinds
    // for one subscription, off the SAME `state.events` array §5/§6/etc
    // already populate through `applyWebhook`'s real write, never a second
    // parallel store. ──
    if (has("from vy_payment_event") && has("kind in ('subscription.paused', 'subscription.halted')")) {
      const subId = String(params[0]);
      const row = state.events
        .filter((e) => e.subscription_id === subId && (e.kind === "subscription.paused" || e.kind === "subscription.halted"))
        .sort((a, b) => b.received_at.localeCompare(a.received_at))[0];
      return row ? [{ kind: row.kind }] : [];
    }
    // ── vy_room_subscription: WS-R132's own "close halted/cancelled row,
    // then insert" statement family - checked BEFORE the plain insert
    // branch below, since it also contains the substring "insert into
    // vy_room_subscription", and its bound params are in a DIFFERENT order
    // (`[followerId, roomId, personId, provider]`, `$1` reused for both the
    // WHERE and the insert's own follower_id column - api/_payments.js's
    // own comment on that statement). ──
    if (has("with closed as (") && has("insert into vy_room_subscription")) {
      const [followerId, roomId, personId, provider] = params;
      for (const s of state.subscriptions) {
        if (s.follower_id === String(followerId)
          && ["created", "authenticated", "active", "paused"].includes(s.state)
          && ["halted", "cancelled"].includes(s.mandate_state)) {
          s.state = "cancelled";
        }
      }
      const live = state.subscriptions.some((s) => s.follower_id === String(followerId)
        && ["created", "authenticated", "active", "paused"].includes(s.state)
        && !["halted", "cancelled"].includes(s.mandate_state));
      if (live) throw Object.assign(new Error("duplicate key value violates unique constraint \"vy_room_subscription_follower_live_ix\""), { code: "23505" });
      const row = {
        subscription_id: `s${state.subscriptions.length + 1}`.padEnd(36, "0"),
        room_id: String(roomId), person_id: String(personId), follower_id: String(followerId),
        provider, provider_subscription_ref: null, state: "created",
        current_period_start: null, current_period_end: null,
        created_at: new Date(NOW + state.subscriptions.length).toISOString(),
        mandate_state: "none", mandate_state_at: null,
      };
      state.subscriptions.push(row);
      return [{ subscription_id: row.subscription_id, state: row.state }];
    }
    // ── vy_room_subscription: the plain insert. Dead for
    // `startFollowerSubscription` since WS-R132 (that function now always
    // issues the combined statement above), kept only in case a future
    // caller inserts a row directly with no close-old-row step of its own. ──
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
        // WS-R125 (migration 130): the column's own default - 'none' for
        // every subscription until a mandate-lifecycle webhook says
        // otherwise, `mandate_state_at` null until it does.
        mandate_state: "none", mandate_state_at: null,
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
      const [provider, ref, roomId, subId, kind, amountInr, takeInr, shareInr, payloadHash, nextState, periodStart, periodEnd, nextMandateState] = params;
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
      // WS-R125 (migration 130): the SAME "leaving state" guard the real
      // UPDATE's CASE expression carries — `mandate_state_at` only advances
      // when the row is actually leaving a DIFFERENT stored mandate_state,
      // so a replay (this branch is never reached twice for the same event
      // anyway, `dup` above) or an out-of-order duplicate never fakes a new
      // transition time.
      if (sub && nextMandateState && sub.mandate_state !== nextMandateState) {
        sub.mandate_state = nextMandateState;
        sub.mandate_state_at = new Date(NOW + state.events.length).toISOString();
      }
      let tier = null;
      if (sub && ["active", "cancelled", "expired"].includes(nextState)) {
        const follower = state.followers.find((f) => f.follower_id === sub.follower_id);
        if (follower) {
          follower.tier = nextState === "active" ? "paid" : "free";
          tier = follower.tier;
        }
      }
      // WS-R125 (mandate_state) and WS-R130 (follower_id, for
      // `maybeGrantReferralReward`'s own caller in `applyWebhook`) both
      // joined the real SELECT list; the fixture returns both.
      return [{
        event_id: event.event_id, subscription_id: subId, state: sub ? sub.state : null,
        mandate_state: sub ? sub.mandate_state : null, person_id: sub ? sub.person_id : null,
        follower_id: sub ? sub.follower_id : null, tier,
      }];
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

    // ── WS-R100 (migration 126): `issueFollowerReceipt`'s own single
    //    statement. Only ever reached by a test in this workstream's own
    //    section below - every test above never overrides `tableApplied`
    //    to admit "vy_receipt", so this branch is unreachable for them,
    //    `applyWebhook`'s own gate proving itself by construction. ──────
    if (has("insert into vy_receipt_counter")) {
      const [fy, eventId, roomId, personId, issuedAt] = params;
      let counter = state.receiptCounters.find((c) => c.fy === fy);
      if (!counter) { counter = { fy, next: 1 }; state.receiptCounters.push(counter); }
      if (state.receipts.some((r) => r.payment_event_id === String(eventId))) return []; // bump's own not-exists guard
      const claimed = counter.next;
      counter.next += 1;
      const row = {
        receipt_id: `r${state.receipts.length + 1}`, receipt_no: claimed,
        payment_event_id: String(eventId), room_id: String(roomId),
        person_id: personId ? String(personId) : null, issued_at: issuedAt || new Date(NOW).toISOString(),
      };
      state.receipts.push(row);
      return [{ receipt_id: row.receipt_id, receipt_no: row.receipt_no, issued_at: row.issued_at }];
    }

    // ── WS-R130 (migration 133): `maybeGrantReferralReward`'s own single
    //    statement. Only ever reached by a test in this workstream's own
    //    section below - every test above never overrides `tableApplied`
    //    to admit "vy_room_referral_credit"/"vy_room_referral_reward", so
    //    this branch is unreachable for them, `applyWebhook`'s own gate
    //    proving itself by construction exactly like the receipt one does
    //    immediately above. Mirrors the REAL CTE's own predicate: is this
    //    landed charge this follower's first ever, who referred them, do
    //    that referrer's OWN referred followers now number the threshold,
    //    has no reward already landed this year, extend the referrer's own
    //    ACTIVE subscription by one month. ────────────────────────────────
    if (has("with this_follower_first as")) {
      const [followerId, eventId, roomId, threshold, yearKey, chargeKinds, rewardId, reason] = params;
      const fid = String(followerId);
      const landedKinds = new Set(chargeKinds);
      const landed = (fId, excludeEventId) =>
        state.events.some((e) => {
          if (excludeEventId != null && e.event_id === excludeEventId) return false;
          const sub = state.subscriptions.find((s) => s.subscription_id === e.subscription_id);
          return sub && sub.follower_id === fId && landedKinds.has(e.kind) && e.amount_inr > 0;
        });
      const isFirst = !landed(fid, String(eventId));
      if (!isFirst) return [];
      const credit = state.referralCredits.find((c) => c.referred_follower_id === fid && c.room_id === String(roomId));
      if (!credit) return [];
      const siblings = state.referralCredits.filter((c) => c.referrer_follower_id === credit.referrer_follower_id);
      const n = siblings.filter((c) => landed(c.referred_follower_id, null)).length;
      if (n < Number(threshold)) return [];
      const already = state.referralRewards.find(
        (r) => r.referrer_follower_id === credit.referrer_follower_id &&
          r.room_id === String(roomId) && r.year_key === String(yearKey),
      );
      if (already) return [];
      const referrerSub = state.subscriptions.find(
        (s) => s.follower_id === credit.referrer_follower_id && s.state === "active",
      );
      const base = referrerSub ? new Date(referrerSub.current_period_end) : new Date(NOW);
      const extended = new Date(base.getTime());
      extended.setUTCMonth(extended.getUTCMonth() + 1);
      const reward = {
        reward_id: String(rewardId), room_id: String(roomId),
        referrer_follower_id: credit.referrer_follower_id, referrer_person_id: credit.referrer_person_id,
        granted_at: new Date(NOW).toISOString(), period_extended_to: extended.toISOString(),
        year_key: String(yearKey), reason: String(reason),
      };
      state.referralRewards.push(reward);
      if (referrerSub) referrerSub.current_period_end = reward.period_extended_to;
      return [{ ...reward }];
    }
    // The reward's own synthetic zero-amount vy_payment_event insert
    // (`maybeGrantReferralReward`'s second statement, feeding `issueFollowerReceipt`) -
    // best-effort, `.catch()`-wrapped in the real code, so an honest empty
    // return here (no fixture support for finding the referrer's own
    // active subscription id by follower_id) proves that path, never
    // crashes the reward already granted above.
    if (has("insert into vy_payment_event") && has("'referral_reward'")) {
      return [];
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
console.log("\n§10 WS-R41: THE REAL RAZORPAY SIGNATURE, REPRODUCED DIRECTLY");
// ═════════════════════════════════════════════════════════════════════════
{
  // §4 above already proves applyWebhook rejects a bad signature and accepts
  // a good one, but only through the FAKE provider's twin algorithm. This
  // section calls the REAL api/_payments/providers/razorpay.js
  // `verifyWebhookSignature` directly - law 3's own reproduction, against
  // razorpay.com/docs/webhooks/, fetched 2026-09-04: header
  // `X-Razorpay-Signature`, "HMAC-SHA256 over the RAW request body... with
  // the webhook secret as the key" (this file's own header, one workstream
  // over, restates the same citation date).
  const rzpBody = Buffer.from(JSON.stringify({ event: "subscription.charged" }), "utf8");
  const rzpSecret = "test-razorpay-secret-ws-r41";
  const goodSig = createHmac("sha256", rzpSecret).update(rzpBody).digest("hex");
  ok("razorpay.js's real verifyWebhookSignature accepts a genuinely valid signature",
    razorpay.verifyWebhookSignature(rzpBody, goodSig, rzpSecret) === true);
  ok("...and refuses a one-byte-corrupted body under the same valid-looking signature",
    razorpay.verifyWebhookSignature(Buffer.concat([rzpBody, Buffer.from("x")]), goodSig, rzpSecret) === false);
  ok("...and refuses a header of the wrong length before ever comparing",
    razorpay.verifyWebhookSignature(rzpBody, "ab", rzpSecret) === false);
  ok("...and refuses a well-formed-but-wrong 64-hex-char signature",
    razorpay.verifyWebhookSignature(rzpBody, "0".repeat(64), rzpSecret) === false);
  ok("...and refuses when no secret is configured, rather than comparing against undefined",
    razorpay.verifyWebhookSignature(rzpBody, goodSig, "") === false);

  const razorpaySrc = readFileSync(join(REPO, "api/_payments/providers/razorpay.js"), "utf8");
  ok("razorpay.js's own source compares in constant time (timingSafeEqual), not ===",
    /return timingSafeEqual\(a, b\)/.test(razorpaySrc));
  ok("...and refuses a length mismatch BEFORE calling it",
    /if \(a\.length !== b\.length\) return false;\s*\n\s*try \{\s*\n\s*return timingSafeEqual/.test(razorpaySrc));
  ok("...wrapped in a try/catch, so a malformed hex string throws into 'false', never past this function",
    /try \{\s*\n\s*return timingSafeEqual\(a, b\);\s*\n\s*\} catch \{\s*\n\s*return false;/.test(razorpaySrc));
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n§11 WS-R60: THE OPEN PROVIDER MARKS, PINNED AS FIXTURES");
// ═════════════════════════════════════════════════════════════════════════
{
  // No network: a monkey-patched global.fetch captures the REAL request each
  // function builds, then a fake success response lets the function return
  // normally so its own return-shape can be asserted too. Restored after
  // each call so later sections (and any suite run after this one in the
  // same process) see the real global.fetch again.
  const realFetch = globalThis.fetch;
  const withFetch = async (impl, run) => {
    let captured = null;
    globalThis.fetch = async (url, init) => {
      captured = { url: String(url), method: init?.method, body: init?.body ? JSON.parse(init.body) : null };
      return impl(captured);
    };
    try {
      return { captured: () => captured, result: await run() };
    } finally {
      globalThis.fetch = realFetch;
    }
  };

  // razorpay.com/docs/api/payments/subscriptions/update-subscription/,
  // fetched 2026-09-04: "PATCH https://api.razorpay.com/v1/subscriptions/{id}",
  // request table names `quantity` and `schedule_change_at` — closes the mark
  // rejected.md#ws-r41-provider-docs-sites-resist-a-single-page-fetch-tool-two-ways
  // left open (found this time by web search for the operation's own title,
  // not a guessed slug). See api/_payments/providers/razorpay.js's own
  // WS-R60 addendum for the full citation.
  {
    const { captured } = await withFetch(
      () => ({ ok: true, json: async () => ({ id: "sub_wsr60", quantity: 3 }) }),
      () => razorpay.updateSubscriptionQuantity("sub_wsr60", 3, { keyId: "k", keySecret: "s" }),
    );
    const c = captured();
    ok("updateSubscriptionQuantity PATCHes /v1/subscriptions/:id",
      c?.method === "PATCH" && c.url === "https://api.razorpay.com/v1/subscriptions/sub_wsr60");
    ok("...with exactly the documented {quantity, schedule_change_at} fields",
      c?.body?.quantity === 3 && c.body.schedule_change_at === "now");
  }

  // razorpay.com/docs/us/api/x/fund-accounts/fetch-with-id/, fetched
  // 2026-09-04: "GET https://api.razorpay.com/v1/fund_accounts/{id}" — closes
  // the "method+path still convention" half of the WS-R41 partial mark (the
  // response shape, including `active`, was already confirmed then).
  {
    const { captured, result } = await withFetch(
      () => ({ ok: true, json: async () => ({ id: "fa_wsr60", contact_id: "cont_1", account_type: "bank_account", active: true }) }),
      () => razorpay.registerFundAccount("fa_wsr60", { keyId: "k", keySecret: "s" }),
    );
    const c = captured();
    ok("registerFundAccount GETs /v1/fund_accounts/:id",
      c?.method === "GET" && c.url === "https://api.razorpay.com/v1/fund_accounts/fa_wsr60");
    ok("...and reads only the documented 'active' boolean off the response",
      result.verified === true);
  }

  // razorpay.com/docs/api/x/payouts/create/bank-account/, fetched 2026-09-04:
  // "POST https://api.razorpay.com/v1/payouts", request table names
  // `account_number` as a REQUEST field (WS-R41 had only confirmed the
  // RESPONSE field `debit_account_number` for the same concept) plus `mode`,
  // `purpose`, `reference_id` (max 40 chars, already enforced by WS-R41's own
  // fix) — closes the mark.
  {
    const { captured } = await withFetch(
      () => ({ ok: true, json: async () => ({ id: "pout_wsr60", status: "queued" }) }),
      () => razorpay.sendPayout(
        { fundAccountRef: "fa_wsr60", amountInr: 500, ref: "r".repeat(60) },
        { keyId: "k", keySecret: "s", accountNumber: "7878780080316316" },
      ),
    );
    const c = captured();
    ok("sendPayout POSTs /v1/payouts",
      c?.method === "POST" && c.url === "https://api.razorpay.com/v1/payouts");
    ok("...with the documented request field name account_number (no longer just convention)",
      c?.body?.account_number === "7878780080316316");
    ok("...mode IMPS and purpose payout, both documented enum values",
      c?.body?.mode === "IMPS" && c.body.purpose === "payout");
    ok("...reference_id still truncated to the documented 40-char ceiling",
      c?.body?.reference_id?.length === 40);
  }
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n§12 WS-R69: THE MANDATE'S OWN LIFECYCLE, DRIVEN THROUGH THE REALISTIC SEQUENCE");
// ═════════════════════════════════════════════════════════════════════════
{
  const state = freshState();
  state.prices.push({ room_id: ROOM, owner_user_id: OWNER, follower_price_inr: 399, currency: "INR", platform_take_bp: 2500 });
  const db = makeDb(state);
  await startFollowerSubscription(db, { session: session() }, { env: ENV, loadAgent, now: NOW });
  const ref = state.subscriptions[0].provider_subscription_ref;
  const follower = state.followers[0];

  // razorpay.com/docs/payments/subscriptions/workflow/, fetched 2026-09-05
  // (razorpay.js's own WS-R69 addendum, law 2 of this file's own header):
  // "Immediate start: charged the plan amount" — this platform never sends
  // `start_at`, so the sequence's own FIRST landed charge (`activated`) must
  // be the full plan amount, never a token registration amount.
  const sequence = fake.mandateEventSequence(ref, { priceInr: 399, cycles: 3 });
  ok("the sequence fires in Razorpay's own documented order (workflow page, fetched 2026-09-05)",
    sequence.map((e) => e.kind).join(",") === "subscription.authenticated,subscription.activated,subscription.charged,subscription.charged");

  for (const [n, evt] of sequence.entries()) {
    const sig = fake.signWebhookForTest(evt.body, WEBHOOK_SECRET);
    await applyWebhook(db, { rawBody: evt.body, signatureHeader: sig, eventRef: `evt_lifecycle_${n}` }, { env: ENV });
  }
  ok("after the full sequence, local state is 'active'", state.subscriptions[0].state === "active");
  ok("the tier flipped to paid", follower.tier === "paid");
  ok("the FIRST landed charge (the authentication transaction) is the FULL plan amount, not a token amount",
    state.events.find((e) => e.kind === "subscription.activated")?.amount_inr === 399);
  ok("both monthly renewals charge the same amount as the authentication transaction",
    state.events.filter((e) => e.kind === "subscription.charged").every((e) => e.amount_inr === 399) &&
    state.events.filter((e) => e.kind === "subscription.charged").length === 2);
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n§13 WS-R69: A HALT IS NOT A CANCELLATION — REQUIRED NEGATIVE CONTROL");
// ═════════════════════════════════════════════════════════════════════════
{
  const state = freshState();
  state.prices.push({ room_id: ROOM, owner_user_id: OWNER, follower_price_inr: 399, currency: "INR", platform_take_bp: 2500 });
  const db = makeDb(state);
  await startFollowerSubscription(db, { session: session() }, { env: ENV, loadAgent, now: NOW });
  const ref = state.subscriptions[0].provider_subscription_ref;
  const follower = state.followers[0];

  const sequence = fake.mandateEventSequence(ref, { priceInr: 399, cycles: 5, haltAtCycle: 3 });
  ok("the sequence STOPS at the halt — nothing fires after a mandate's retries exhaust",
    sequence.length === 4 && sequence.at(-1).kind === "subscription.halted"); // authenticated, activated, charged, halted

  for (const [n, evt] of sequence.entries()) {
    const sig = fake.signWebhookForTest(evt.body, WEBHOOK_SECRET);
    await applyWebhook(db, { rawBody: evt.body, signatureHeader: sig, eventRef: `evt_halt_${n}` }, { env: ENV });
  }

  // THE BRIEF'S OWN REQUIRED NEGATIVE CONTROL: "a halted event that leaves
  // the state active fails". Proven two ways — the real outcome through
  // applyWebhook (a), and this file's own §9 "strike the clause" technique
  // (b): a source assertion that would itself FAIL if a future edit changed
  // `KIND_TO_STATE`'s own `subscription.halted` entry to `'active'`.
  ok("(a) a halted mandate's local state is 'paused' — this assertion FAILS if it is 'active'",
    state.subscriptions[0].state === "paused" && state.subscriptions[0].state !== "active");
  // §5's own precedent, re-confirmed here through a REAL multi-cycle
  // sequence rather than one isolated kind: `follower_update`'s own WHERE
  // clause (`api/_payments.js`) only demotes tier on 'active'/'cancelled'/
  // 'expired' — 'paused' (which is what 'halted' maps to) is DELIBERATELY
  // not in that list, so access keeps working while the mandate's own retry
  // ladder or the follower's UPI app decides what happens next. A real
  // finding, not a bug this workstream's own brief asks it to change (out of
  // scope — access-control policy, not the UPI-Autopay verification/copy
  // this workstream owns); named in the final report.
  ok("(a) tier is NOT demoted by a halt — 'paused'/'halted' keep access, same as an explicit pause (§5)",
    follower.tier === "paid");

  const src = readFileSync(join(REPO, "api/_payments.js"), "utf8");
  ok("(b) the SOURCE ITSELF never maps subscription.halted to 'active' — this fails if it ever did",
    !/"subscription\.halted":\s*"active"/.test(src));
  ok("(b) ...and does map it to 'paused', by name",
    /"subscription\.halted":\s*"paused"/.test(src));
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n§14 WS-R69: followerSubscriptionStatus TELLS 'PAUSED' FROM 'HALTED' HONESTLY");
// ═════════════════════════════════════════════════════════════════════════
{
  // Two followers of the SAME room: one pauses from their own UPI app
  // (`subscription.paused`), one has a failed auto-charge exhaust its
  // retries (`subscription.halted`). `KIND_TO_STATE` maps BOTH to the same
  // stored `vy_room_subscription.state`, `'paused'` — this section proves
  // the API's own read tells them apart from the ledger, never the column.
  const PERSON2 = "aa222222-2222-4222-8222-222222222222";
  const state = freshState();
  state.followers.push({
    follower_id: "f1000000-0000-4000-8000-000000000002", room_id: ROOM, person_id: PERSON2, agent_id: AGENT,
    age_attested_at: "2026-09-01T00:00:00.000Z", memory_consent_at: null, tier: "free",
  });
  state.prices.push({ room_id: ROOM, owner_user_id: OWNER, follower_price_inr: 399, currency: "INR", platform_take_bp: 2500 });
  const db = makeDb(state);

  const sessionPaused = session();
  const sessionHalted = session({ p: PERSON2 });
  await startFollowerSubscription(db, { session: sessionPaused }, { env: ENV, loadAgent, now: NOW });
  await startFollowerSubscription(db, { session: sessionHalted }, { env: ENV, loadAgent, now: NOW });
  const refPaused = state.subscriptions[0].provider_subscription_ref;
  const refHalted = state.subscriptions[1].provider_subscription_ref;

  const fire = async (ref, kind, tag) => {
    const body = kind === "subscription.charged"
      ? RAZORPAY_CHARGED(ref, 39900, 1690000000, 1692600000)
      : RAZORPAY_EVENT(kind, ref);
    const sig = fake.signWebhookForTest(body, WEBHOOK_SECRET);
    return applyWebhook(db, { rawBody: body, signatureHeader: sig, eventRef: `evt_${tag}` }, { env: ENV });
  };
  await fire(refPaused, "subscription.charged", "p_activate"); // activate first — pausing an unauthenticated mandate isn't a real state
  await fire(refHalted, "subscription.charged", "h_activate");
  await fire(refPaused, "subscription.paused", "p_pause");
  await fire(refHalted, "subscription.halted", "h_halt");

  ok("both subscriptions land on the SAME stored DB value, 'paused'",
    state.subscriptions[0].state === "paused" && state.subscriptions[1].state === "paused");

  const statusPaused = await followerSubscriptionStatus(db, { session: sessionPaused }, { env: ENV, loadAgent, now: NOW });
  const statusHalted = await followerSubscriptionStatus(db, { session: sessionHalted }, { env: ENV, loadAgent, now: NOW });
  ok("a customer-paused mandate reports 'paused'", statusPaused.subscription.state === "paused");
  ok("a retry-ladder-exhausted mandate reports 'halted' — the SAME stored column, an honestly DIFFERENT read",
    statusHalted.subscription.state === "halted");

  // NEGATIVE CONTROL: the derived read must never leak back into the STORED
  // column — every OTHER reader of `vy_room_subscription.state`
  // (`applyWebhook`'s own tier-flip predicate, §12/§13 above) would break the
  // instant 'halted' became a real stored value, since it is not in
  // migration 078's own CHECK.
  ok("the stored column never becomes the literal string 'halted'",
    state.subscriptions[1].state === "paused" && state.subscriptions[1].state !== "halted");
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n§15 WS-R69: THE CHECKOUT COPY NAMES THE MANDATE — NEGATIVE CONTROL");
// ═════════════════════════════════════════════════════════════════════════
{
  // §9's own "strike the clause from the shipping text" technique: read the
  // REAL committed files, not a hand-maintained fixture, so a future edit
  // that quietly drops the mandate sentence — from the copy, or from where
  // it is actually RENDERED — fails this exact assertion.
  //
  // WS-R139: `pay` is a TALK section (`copy.ts`'s own `TALK_KEYS`), so its
  // Hindi text now lives in `hiTalkCopy.ts`, not in `copy.ts` alongside the
  // English — `copy.ts` carries only the EN table plus the split's own
  // machinery today. Both files are read and concatenated so this scan
  // keeps finding exactly one EN window and one HI window, same as before
  // the split.
  const copySrc = readFileSync(join(REPO, "src/room/copy.ts"), "utf8") +
    readFileSync(join(REPO, "src/room/hiTalkCopy.ts"), "utf8");
  const roomAppSrc = readFileSync(join(REPO, "src/room/RoomApp.tsx"), "utf8");

  // `mandateNote`'s own value is built from concatenated string literals
  // (three lines, `+`-joined) rather than one quoted string — matched here
  // as a WINDOW of text after the key, not a single `"[^"]*"` capture, so
  // this does not silently pass or fail on a harmless line-wrap.
  const mandateWindows = [...copySrc.matchAll(/mandateNote:\s*\n?\s*((?:"[^"]*"\s*\+?\s*\n?\s*){1,6})/g)].map((m) => m[1]);
  ok("mandateNote is defined in BOTH locales (en, then hi) — this fails if either is missing",
    mandateWindows.length === 2);
  ok("checkout copy names UPI Autopay and 'mandate' together",
    mandateWindows.some((w) => /UPI Autopay/.test(w) && /mandate|मैनडेट/.test(w)));
  ok("...and states pausing happens from the follower's own UPI app",
    mandateWindows.every((w) => /UPI app|UPI ऐप/.test(w)));
  ok("a no-price fallback exists too, both locales, `offer`/`capOffer`'s own bodyNoPrice pattern",
    (copySrc.match(/mandateNoteNoPrice:\s*\n?\s*"/g) || []).length === 2);

  // The copy existing is not enough — it must be RENDERED at every place a
  // follower can start a mandate, or a screen could ship the string in
  // copy.ts and never show it. This fails if any subscribe surface (the
  // plain capped screen, the cap-reached offer, the session-worked offer)
  // stopped reading it. `>=` rather than `===` on the price-aware count: a
  // doc-comment mentioning the same identifier is harmless and should not
  // flip this control.
  const priceAwareRefs = (roomAppSrc.match(/copy\.pay\.mandateNote\b/g) || []).length;
  const noPriceRefs = (roomAppSrc.match(/copy\.pay\.mandateNoteNoPrice/g) || []).length;
  ok("RoomApp.tsx reads the price-aware mandate note at both offer surfaces (capOffer, offer)",
    priceAwareRefs >= 2);
  ok("RoomApp.tsx reads the no-price fallback at the plain capped screen AND as both offers' own fallback",
    noPriceRefs === 3);
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n§16 WS-R73: getSubscription — the READ updateOrgSeats calls before it ever PATCHes");
// ═════════════════════════════════════════════════════════════════════════
{
  // razorpay.js's own WS-R73 addendum: getSubscription GETs the SAME
  // resource updateSubscriptionQuantity PATCHes, and reads `payment_method`
  // off the response - `evals/payments/run.mjs`'s own §11 harness (WS-R60),
  // reused rather than reinvented.
  const realFetch = globalThis.fetch;
  const withFetch = async (impl, run) => {
    let captured = null;
    globalThis.fetch = async (url, init) => {
      captured = { url: String(url), method: init?.method, body: init?.body ? JSON.parse(init.body) : null };
      return impl(captured);
    };
    try {
      return { captured: () => captured, result: await run() };
    } finally {
      globalThis.fetch = realFetch;
    }
  };

  {
    const { captured, result } = await withFetch(
      () => ({ ok: true, json: async () => ({ id: "sub_wsr73_upi", payment_method: "upi" }) }),
      () => razorpay.getSubscription("sub_wsr73_upi", { keyId: "k", keySecret: "s" }),
    );
    const c = captured();
    ok("getSubscription GETs /v1/subscriptions/:id, the same resource updateSubscriptionQuantity PATCHes",
      c?.method === "GET" && c.url === "https://api.razorpay.com/v1/subscriptions/sub_wsr73_upi");
    ok("...and reads the documented payment_method field off the response, unvalidated against a closed set",
      result.payment_method === "upi");
  }
  {
    // A response with no payment_method at all (an account whose live
    // response shape does not carry it, per this function's own header
    // caveat) reads back null, never a guessed default - the CALLER
    // (api/_payments.js's updateOrgSeats) is the one place a fallback
    // string ("") lives, and only so `SEAT_UPDATE_LOCKED_METHODS.has()`
    // has something to call `.has` on.
    const { result } = await withFetch(
      () => ({ ok: true, json: async () => ({ id: "sub_wsr73_bare" }) }),
      () => razorpay.getSubscription("sub_wsr73_bare", { keyId: "k", keySecret: "s" }),
    );
    ok("a response with no payment_method field reads back null, never an invented default",
      result.payment_method === null);
  }
  {
    // NEGATIVE CONTROL: missing credentials refuses before any fetch runs,
    // the SAME posture every other function in this file already has.
    const refused = await razorpay.getSubscription("sub_x", {}).then(() => null, (e) => e);
    ok("NEGATIVE CONTROL: getSubscription with no credentials refuses, named, never a network call",
      refused?.code === "payments_provider_credentials_missing");
  }
  {
    // The fake twin: default 'card' (every eval written before WS-R73
    // expects an update to succeed), and a test-only setter for the other
    // two - api/_payments/providers/fake.js's own header.
    const bare = await fake.getSubscription("fake_sub_never_set");
    ok("the fake twin defaults an unset ref to 'card' - every pre-existing eval's own assumption",
      bare.payment_method === "card");
    fake.setFakeSubscriptionMethod("fake_sub_wsr73", "emandate");
    const set = await fake.getSubscription("fake_sub_wsr73");
    ok("setFakeSubscriptionMethod makes the fake twin report the method a test asks for",
      set.payment_method === "emandate");
  }
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n§10 WS-R100 (migration 126) — the follower's receipt, issued from THIS webhook");
// ═════════════════════════════════════════════════════════════════════════
{
  // Every test above this line never overrides `tableApplied` - proving,
  // by construction, that `issueFollowerReceipt` is never even attempted
  // on a database that has not applied migration 126 yet (the throwing
  // fake db above would have failed loudly the moment it was).
  const state = freshState();
  state.prices.push({ room_id: ROOM, owner_user_id: OWNER, follower_price_inr: 399, currency: "INR", platform_take_bp: 2500 });
  const db = makeDb(state);
  const depsOn = { env: ENV, loadAgent, now: NOW, tableApplied: async (name) => name === "vy_receipt" };
  await startFollowerSubscription(db, { session: session() }, depsOn);
  const ref = state.subscriptions[0].provider_subscription_ref;

  const body = RAZORPAY_CHARGED(ref, 39900, 1690000000, 1692600000);
  const sig = fake.signWebhookForTest(body, WEBHOOK_SECRET);
  const applied = await applyWebhook(db, { rawBody: body, signatureHeader: sig, eventRef: "evt_r100_1" }, depsOn);
  ok("§10 a landed charge on a migration-126 database returns a receipt_id", typeof applied.receipt_id === "string" && applied.receipt_id.length > 0);
  ok("§10 exactly one vy_receipt row exists", state.receipts.length === 1);
  ok("§10 the receipt names the ledger row it records", state.receipts[0].payment_event_id === state.events[0].event_id);
  ok("§10 the receipt carries the follower's own person id", state.receipts[0].person_id === PERSON);
  ok("§10 the receipt claimed number 1 (the first receipt in this financial year)", state.receipts[0].receipt_no === 1);

  // IDEMPOTENT REPLAY, restated for the receipt: the SAME event replayed
  // mints no second receipt (the ledger's own on-conflict-do-nothing means
  // `!result` fires and `issueFollowerReceipt` is never even called again).
  const replay = await applyWebhook(db, { rawBody: body, signatureHeader: sig, eventRef: "evt_r100_1" }, depsOn);
  ok("§10 a replayed webhook mints no second receipt", replay.replay === true && state.receipts.length === 1);

  // NEGATIVE CONTROL (restated from evals/room-receipt/run.mjs, driven here
  // end to end through the REAL webhook rather than a direct call): a
  // non-charge kind (a pause) lands no receipt at all.
  const pauseBody = RAZORPAY_CHARGED(ref, 0, 1690000000, 1692600000).replace('"subscription.charged"', '"subscription.paused"');
  const pauseSig = fake.signWebhookForTest(pauseBody, WEBHOOK_SECRET);
  await applyWebhook(db, { rawBody: pauseBody, signatureHeader: pauseSig, eventRef: "evt_r100_pause" }, depsOn);
  ok("NEGATIVE CONTROL: a non-charge event (pause) mints no receipt", state.receipts.length === 1);

  // NEGATIVE CONTROL: `tableApplied` false (the ordinary case for every
  // database that has not applied 126 yet) never even attempts the claim,
  // on a SECOND, otherwise-identical Room/follower so the ledger dedup
  // above cannot mask the result.
  const state2 = freshState();
  state2.prices.push({ room_id: ROOM, owner_user_id: OWNER, follower_price_inr: 399, currency: "INR", platform_take_bp: 2500 });
  const db2 = makeDb(state2);
  await startFollowerSubscription(db2, { session: session() }, { env: ENV, loadAgent, now: NOW });
  const ref2 = state2.subscriptions[0].provider_subscription_ref;
  const body2 = RAZORPAY_CHARGED(ref2, 39900, 1690000000, 1692600000);
  const sig2 = fake.signWebhookForTest(body2, WEBHOOK_SECRET);
  const applied2 = await applyWebhook(db2, { rawBody: body2, signatureHeader: sig2, eventRef: "evt_r100_2" }, { env: ENV });
  ok("NEGATIVE CONTROL: migration 126 not applied - the SAME charge lands no receipt_id at all", applied2.receipt_id === null);
  ok("NEGATIVE CONTROL: migration 126 not applied - no vy_receipt row was ever attempted", state2.receipts.length === 0);
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n§17 WS-R125 (migration 130): mandate_state, THE STORED FACT §14 ONLY EVER DERIVED");
// ═════════════════════════════════════════════════════════════════════════
{
  // §14's own two followers, restated: this time asserting on the SIBLING
  // COLUMN directly, not the virtual `state` overlay it now backs.
  const PERSON2 = "aa222222-2222-4222-8222-222222222222";
  const state = freshState();
  state.followers.push({
    follower_id: "f1000000-0000-4000-8000-000000000002", room_id: ROOM, person_id: PERSON2, agent_id: AGENT,
    age_attested_at: "2026-09-01T00:00:00.000Z", memory_consent_at: null, tier: "free",
  });
  state.prices.push({ room_id: ROOM, owner_user_id: OWNER, follower_price_inr: 399, currency: "INR", platform_take_bp: 2500 });
  const db = makeDb(state);
  const sessionPaused = session();
  const sessionHalted = session({ p: PERSON2 });
  await startFollowerSubscription(db, { session: sessionPaused }, { env: ENV, loadAgent, now: NOW });
  await startFollowerSubscription(db, { session: sessionHalted }, { env: ENV, loadAgent, now: NOW });
  const refPaused = state.subscriptions[0].provider_subscription_ref;
  const refHalted = state.subscriptions[1].provider_subscription_ref;
  const fire = (ref, kind, tag) => {
    const body = kind === "subscription.charged"
      ? RAZORPAY_CHARGED(ref, 39900, 1690000000, 1692600000)
      : RAZORPAY_EVENT(kind, ref);
    const sig = fake.signWebhookForTest(body, WEBHOOK_SECRET);
    return applyWebhook(db, { rawBody: body, signatureHeader: sig, eventRef: `evt_${tag}` }, { env: ENV });
  };

  ok("brand new: mandate_state defaults to 'none', matching migration 130's own column default",
    state.subscriptions[0].mandate_state === "none" && state.subscriptions[1].mandate_state === "none");

  await fire(refPaused, "subscription.charged", "m_p_activate");
  await fire(refHalted, "subscription.charged", "m_h_activate");
  ok("a plain charge never touches mandate_state — 'subscription.charged' is not a mandate-lifecycle kind",
    state.subscriptions[0].mandate_state === "none" && state.subscriptions[1].mandate_state === "none");

  const paused1 = await fire(refPaused, "subscription.paused", "m_pause");
  const halted1 = await fire(refHalted, "subscription.halted", "m_halt");
  ok("subscription.paused sets the STORED mandate_state to 'paused' (never just the virtual read)",
    state.subscriptions[0].mandate_state === "paused");
  ok("subscription.halted sets the STORED mandate_state to 'halted' — §14's virtual 'halted' now has a real column behind it",
    state.subscriptions[1].mandate_state === "halted");
  ok("applyWebhook's own return value carries mandate_state, so a caller never has to re-query it",
    paused1.mandate_state === "paused" && halted1.mandate_state === "halted");
  const firstMandateAt = state.subscriptions[1].mandate_state_at;
  ok("mandate_state_at is set the moment the mandate actually changed", typeof firstMandateAt === "string" && firstMandateAt.length > 0);

  // THE LEAVING-STATE GUARD, driven end to end: an out-of-order or
  // differently-ref'd duplicate delivery of the SAME target must never
  // advance mandate_state_at a second time — `applyWebhook`'s own CASE
  // expression inside `sub_update`, `context/rejected.md#ws-r125-mandate-
  // state-as-a-second-cte-on-the-same-table`'s rejected alternative would
  // have made this untestable by construction (two competing UPDATEs on one
  // row, unpredictable which wins).
  await fire(refHalted, "subscription.halted", "m_halt_dup");
  ok("a duplicate delivery of the SAME mandate target is a no-op — mandate_state_at does not move",
    state.subscriptions[1].mandate_state_at === firstMandateAt);

  // subscription.resumed -> 'active', never a literal 'resumed' (migration
  // 130's own CHECK admits no such value; this file's own §12/§13 precedent,
  // MANDATE_KIND_TO_STATE's own header explains the docs' own inconsistency
  // here).
  await fire(refPaused, "subscription.resumed", "m_resume");
  ok("subscription.resumed sets mandate_state to 'active', matching KIND_TO_STATE's own reading of the identical event",
    state.subscriptions[0].mandate_state === "active");
  ok("MANDATE_KIND_TO_STATE never maps resumed to the literal string 'resumed' — this fails if it ever did",
    MANDATE_KIND_TO_STATE["subscription.resumed"] === "active" && MANDATE_KIND_TO_STATE["subscription.resumed"] !== "resumed");

  // subscription.completed -> mandate_state 'completed', a DIFFERENT value
  // from `state`'s own terminal spelling (`KIND_TO_STATE` collapses
  // 'completed' into the SAME 'cancelled' `state` value as an explicit
  // cancellation) — the mandate ledger keeps the two apart even though the
  // access-control column does not.
  await fire(refPaused, "subscription.completed", "m_complete");
  ok("subscription.completed sets mandate_state to 'completed', not 'cancelled' — a DIFFERENT value from `state`'s own collapse",
    state.subscriptions[0].mandate_state === "completed" && state.subscriptions[0].state === "cancelled");

  // NEGATIVE CONTROL: a non-mandate kind reaching this far (an unauthorised
  // hand-typed one would already have been refused by KIND_TO_STATE's own
  // membership check upstream) never appears in MANDATE_KIND_TO_STATE at
  // all — asserted directly against the map so a future kind added to ONE
  // map without the other fails loudly here.
  for (const kind of ["subscription.authenticated", "subscription.activated", "subscription.charged", "payment.failed"]) {
    ok(`NEGATIVE CONTROL: '${kind}' is not a mandate-lifecycle kind — MANDATE_KIND_TO_STATE has no entry for it`,
      !Object.prototype.hasOwnProperty.call(MANDATE_KIND_TO_STATE, kind));
  }
}

console.log("\n§18 WS-R130 (migration 133) — the referral reward, granted from THIS webhook");
// ═════════════════════════════════════════════════════════════════════════
{
  const state = freshState();
  state.prices.push({ room_id: ROOM, owner_user_id: OWNER, follower_price_inr: 399, currency: "INR", platform_take_bp: 2500 });
  const db = makeDb(state);
  const depsOn = {
    env: ENV, loadAgent, now: NOW,
    tableApplied: async (name) => name === "vy_room_referral_credit" || name === "vy_room_referral_reward",
  };

  // A, the referrer — the fixture's own default follower, plus a real
  // ACTIVE subscription for the extension to have something to extend.
  const followerA = state.followers[0];
  state.subscriptions.push({
    subscription_id: "sub_a_active", room_id: ROOM, person_id: PERSON, follower_id: followerA.follower_id,
    provider: "fake", provider_subscription_ref: "sub_a_ref", state: "active",
    current_period_start: "2026-08-01T00:00:00.000Z", current_period_end: "2026-09-01T00:00:00.000Z",
    created_at: "2026-08-01T00:00:00.000Z",
  });

  // Three friends A referred, each with their own follower row and a
  // vy_room_referral_credit naming A as their referrer — seeded directly
  // (this suite's own domain is payments, not the join flow;
  // `evals/room-referrals/run.mjs`'s own §8 proves `joinRoom` writes this
  // row for real).
  const friends = ["11110000-0000-4000-8000-000000000001", "11110000-0000-4000-8000-000000000002", "11110000-0000-4000-8000-000000000003"];
  const friendSessions = [];
  for (const [i, friendPerson] of friends.entries()) {
    const followerId = `f2000000-0000-4000-8000-00000000000${i + 1}`;
    state.followers.push({
      follower_id: followerId, room_id: ROOM, person_id: friendPerson, agent_id: AGENT,
      age_attested_at: "2026-09-01T00:00:00.000Z", memory_consent_at: null, tier: "free",
    });
    state.referralCredits.push({
      credit_id: `cr${i + 1}`, room_id: ROOM,
      referred_follower_id: followerId, referrer_follower_id: followerA.follower_id, referrer_person_id: PERSON,
    });
    friendSessions.push(session({ p: friendPerson }));
  }

  const rewardIds = [];
  for (const [i, friendSession] of friendSessions.entries()) {
    await startFollowerSubscription(db, { session: friendSession }, depsOn);
    const ref = state.subscriptions.find((s) => s.person_id === friends[i]).provider_subscription_ref;
    const body = RAZORPAY_CHARGED(ref, 39900, 1690000000 + i, 1692600000 + i);
    const sig = fake.signWebhookForTest(body, WEBHOOK_SECRET);
    const applied = await applyWebhook(db, { rawBody: body, signatureHeader: sig, eventRef: `evt_r130_${i}` }, depsOn);
    rewardIds.push(applied.referral_reward_id);
  }
  ok("§17 the first two friends' first charges grant no reward yet",
    rewardIds[0] === null && rewardIds[1] === null, JSON.stringify(rewardIds));
  ok("§17 the THIRD friend's first charge grants the reward, through the REAL webhook",
    typeof rewardIds[2] === "string" && rewardIds[2].length > 0, JSON.stringify(rewardIds));
  ok("§17 exactly one reward row exists, naming A as referrer",
    state.referralRewards.length === 1 && state.referralRewards[0].referrer_follower_id === followerA.follower_id);
  ok("§17 A's own ACTIVE subscription period_end was extended by one month",
    state.subscriptions.find((s) => s.subscription_id === "sub_a_active").current_period_end === "2026-10-01T00:00:00.000Z",
    state.subscriptions.find((s) => s.subscription_id === "sub_a_active").current_period_end);

  // NEGATIVE CONTROL: a REPLAYED webhook for the same third-friend event
  // grants nothing a second time — `applyWebhook`'s own `!result` early
  // return means `maybeGrantReferralReward` is never even called on a
  // real replay.
  const ref3 = state.subscriptions.find((s) => s.person_id === friends[2]).provider_subscription_ref;
  const replayBody = RAZORPAY_CHARGED(ref3, 39900, 1690000002, 1692600002);
  const replaySig = fake.signWebhookForTest(replayBody, WEBHOOK_SECRET);
  const replay = await applyWebhook(db, { rawBody: replayBody, signatureHeader: replaySig, eventRef: "evt_r130_2" }, depsOn);
  ok("NEGATIVE CONTROL: a replayed webhook grants no second reward",
    replay.replay === true && state.referralRewards.length === 1);

  // NEGATIVE CONTROL: migration 133 not applied yet — the SAME third
  // charge, on an otherwise-identical fresh world, grants nothing at all.
  const state2 = freshState();
  state2.prices.push({ room_id: ROOM, owner_user_id: OWNER, follower_price_inr: 399, currency: "INR", platform_take_bp: 2500 });
  const db2 = makeDb(state2);
  await startFollowerSubscription(db2, { session: session() }, { env: ENV, loadAgent, now: NOW });
  const ref2 = state2.subscriptions[0].provider_subscription_ref;
  const body2 = RAZORPAY_CHARGED(ref2, 39900, 1690000000, 1692600000);
  const sig2 = fake.signWebhookForTest(body2, WEBHOOK_SECRET);
  const applied2 = await applyWebhook(db2, { rawBody: body2, signatureHeader: sig2, eventRef: "evt_r130_x" }, { env: ENV });
  ok("NEGATIVE CONTROL: migration 133 not applied - no referral_reward_id at all, never a crash",
    applied2.referral_reward_id === null);
  ok("NEGATIVE CONTROL: migration 133 not applied - no reward row was ever attempted", state2.referralRewards.length === 0);
}

console.log("\n§19 WS-R132 (migration 135): STARTING A NEW MANDATE AFTER A HALT");
// ═════════════════════════════════════════════════════════════════════════
{
  // §13's own halted mandate, restated: this time asking whether the
  // follower can ever get a WORKING second mandate rather than the SAME
  // dead reference back forever -
  // `context/rejected.md#ws-r125-halted-mandate-start-new-button-would-
  // have-been-a-silent-no-op`'s own gap, closed by this migration.
  const state = freshState();
  state.prices.push({ room_id: ROOM, owner_user_id: OWNER, follower_price_inr: 399, currency: "INR", platform_take_bp: 2500 });
  const db = makeDb(state);
  const deps = { env: ENV, loadAgent, now: NOW };
  const followerId = state.followers[0].follower_id;

  const started = await startFollowerSubscription(db, { session: session() }, deps);
  const oldRef = started.provider_subscription_ref;
  ok("§19 the first start mints a real provider ref", typeof oldRef === "string" && oldRef.length > 0);

  const fire = (ref, kind, tag) => {
    const body = kind === "subscription.charged"
      ? RAZORPAY_CHARGED(ref, 39900, 1690000000, 1692600000)
      : RAZORPAY_EVENT(kind, ref);
    const sig = fake.signWebhookForTest(body, WEBHOOK_SECRET);
    return applyWebhook(db, { rawBody: body, signatureHeader: sig, eventRef: `evt_r132_${tag}` }, { env: ENV });
  };
  await fire(oldRef, "subscription.charged", "activate");
  await fire(oldRef, "subscription.halted", "halt");
  ok("§19 the mandate is genuinely halted before the restart", state.subscriptions[0].mandate_state === "halted");
  ok("§19 the halted row's own `state` column is STILL a non-terminal value (KIND_TO_STATE maps halted to 'paused' on purpose) - this is exactly what made the OLD, unwidened index call it 'live' forever",
    ["created", "authenticated", "active", "paused"].includes(state.subscriptions[0].state));

  // NEGATIVE CONTROL: the OLD, unwidened predicate - struck of its own
  // `mandate_state` clause, this file's own §9/§13 "strike the clause"
  // technique - reads the SAME row back as live and hands back its DEAD
  // reference. This is exactly what shipped before migration 135
  // (`startFollowerSubscription`'s own existing-live lookup, before this
  // workstream); it is not what the function calls any more, and this
  // assertion exists so a regression that reverts the widened predicate is
  // caught here, not only in production.
  const staleRows = state.subscriptions.filter((s) => s.follower_id === followerId
    && ["created", "authenticated", "active", "paused"].includes(s.state));
  ok("NEGATIVE CONTROL: the OLD predicate (no mandate_state clause) still calls the halted row 'live' and would hand back its dead reference",
    staleRows.length === 1 && staleRows[0].provider_subscription_ref === oldRef);

  // THE RESTART, through the REAL function - no button, no HTTP door, the
  // exact same `startFollowerSubscription` the "subscribe" op already calls.
  const restarted = await startFollowerSubscription(db, { session: session() }, deps);
  ok("§19 restarting after a halt returns a NEW local subscription row, never the halted one",
    restarted.subscription_id !== started.subscription_id);
  ok("§19 the OLD row is closed (state 'cancelled'), never left dangling forever",
    state.subscriptions.find((s) => s.subscription_id === started.subscription_id).state === "cancelled");
  ok("§19 the NEW row starts with a clean mandate slate ('none', never inheriting the dead mandate's own state)",
    state.subscriptions.find((s) => s.subscription_id === restarted.subscription_id).mandate_state === "none");
  ok("§19 exactly two subscription rows exist for this follower - the close and the insert landed as ONE statement family, never a stray third row",
    state.subscriptions.filter((s) => s.follower_id === followerId).length === 2);
  ok("§19 the restart hands back a checkout link - a REAL second provider call happened, not a silent no-op",
    typeof restarted.checkout_url === "string" && restarted.checkout_url.length > 0);
  ok("a restarted subscription receives a distinct provider reference",
    restarted.provider_subscription_ref !== oldRef);

  // The widened index's OWN uniqueness guarantee, proven directly: a THIRD
  // live row for the SAME follower is still refused once the restarted row
  // is genuinely live (mandate_state 'none', not halted or cancelled) -
  // migration 135 widens the EXCLUSION, it does not remove uniqueness
  // itself.
  let threw = null;
  try {
    await db(
      `with closed as (
         update vy_room_subscription
            set state = 'cancelled', updated_at = now()
          where follower_id = ($1)::uuid
            and state in ('created','authenticated','active','paused')
            and mandate_state in ('halted','cancelled')
          returning subscription_id
       ), inserted as (
         insert into vy_room_subscription (room_id, person_id, follower_id, provider, state)
         values (($2)::uuid, ($3)::uuid, ($1)::uuid, $4, 'created')
         returning subscription_id, state
       )
       select subscription_id, state from inserted`,
      [String(followerId), ROOM, PERSON, "fake"],
    );
  } catch (e) {
    threw = e;
  }
  ok("the widened index still refuses a THIRD live row for the same follower - the restarted row from above is genuinely live and blocks a fourth",
    Boolean(threw) && threw.code === "23505");
}

// ═════════════════════════════════════════════════════════════════════════
{
  const input = { label: "retry-control", ref: "same-customer", priceInr: 399, subscriptionId: "local-row-one" };
  const first = await fake.createSubscription(input);
  const retry = await fake.createSubscription(input);
  const restart = await fake.createSubscription({ ...input, subscriptionId: "local-row-two" });
  ok("provider retry before persistence keeps the same local row's reference",
    first.provider_subscription_ref === retry.provider_subscription_ref);
  ok("the same customer's new local row gets a different provider reference",
    first.provider_subscription_ref !== restart.provider_subscription_ref);
  const { subscriptionId: _row, ...withoutRow } = input;
  const unkeyedFirst = await fake.createSubscription(withoutRow);
  const unkeyedNext = await fake.createSubscription(withoutRow);
  ok("unkeyed provider calls never derive a shared reference from customer and price",
    unkeyedFirst.provider_subscription_ref !== unkeyedNext.provider_subscription_ref);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
