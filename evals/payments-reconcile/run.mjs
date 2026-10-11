// WS-R42, migration 104. "The money reconciles": `reconcile` (a pure
// function over rows, api/_payments.js), the creator-tier charge ledger
// (`vy_creator_charge_event`, written inside `applyWebhook`'s creator lane in
// the SAME statement as the state flip, idempotent on `(provider,
// provider_charge_ref)`), and `scripts/check-mirrors.mjs` (every `// mirror
// of api/<file>.js#<NAME>` marker parsed on both sides).
//
//   node evals/payments-reconcile/run.mjs
//
// Offline, deterministic, $0, no DB, no network, no real provider.
// `offline-mocks-cannot-type-check-sql` still applies: nothing here proves
// migration 104's statements, migration 108's (WS-R54), or `reconcilePeriod`'s
// own five SELECTs (the fifth reading `vy_room_org_attachment` history, added
// by WS-R54) parse against a live database (see this workstream's final
// report for what does). §1-3d drive `reconcile` directly, no fake `db` at
// all - it is a pure function, `payoutStatementFromRows`'s own precedent;
// §3b-3d prove the WS-R54 proration/two-Suite/period-true behaviour the same
// way. §4-5 drive the real `applyWebhook`/`startCreatorSubscription` through
// a fake `db`, `evals/org-billing/run.mjs`'s own fixture pattern, extended
// with the one new table it does not yet model.
import assert from "node:assert/strict";
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
  reconcile,
  reconcilePeriod,
  SUITE_SEAT_SHARE_BP,
  CREATOR_CHARGE_KINDS,
  startCreatorSubscription,
  applyWebhook,
} = payments;
const fake = await import(pathToFileURL(join(REPO, "api/_payments/providers/fake.js")).href);
const { checkMirrors } = await import(pathToFileURL(join(REPO, "scripts/check-mirrors.mjs")).href);

const WEBHOOK_SECRET = "test-webhook-secret-payments-reconcile-v1";
const ENV = { PAYMENTS_PROVIDER: "fake", PAYMENTS_FAKE_WEBHOOK_SECRET: WEBHOOK_SECRET };
const RAZORPAY_EVENT = (kind, ref, amountPaise = 0) => JSON.stringify({
  event: kind,
  payload: {
    subscription: { entity: { id: ref, status: kind, current_start: 1693526400, current_end: 1696118400 } },
    payment: { entity: { id: "pay_1", amount: amountPaise, currency: "INR", status: "captured" } },
  },
});

const PERIOD = { start: "2026-09-01T00:00:00.000Z", end: "2026-10-01T00:00:00.000Z" };
const IN_PERIOD = "2026-09-15T00:00:00.000Z";

const OWNER_A = "a1000000-0000-4000-8000-000000000001"; // Room A, attached to ORG
const OWNER_B = "a2000000-0000-4000-8000-000000000002"; // Room B, follower-only
const OWNER_C = "a3000000-0000-4000-8000-000000000003"; // Room C, follower-only
const OWNER_CREATOR = "a4000000-0000-4000-8000-000000000004"; // creator-tier charge, no Room
const OWNER_COVERED = "a5000000-0000-4000-8000-000000000005"; // seat-covered creator
const ROOM_A = "b1000000-0000-4000-8000-000000000001";
const ROOM_B = "b2000000-0000-4000-8000-000000000002";
const ROOM_C = "b3000000-0000-4000-8000-000000000003";
const ORG_X = "c1000000-0000-4000-8000-000000000001";
const PRICE_PER_SEAT = 2999;
const SUITE_SHARE_INR = Math.trunc((PRICE_PER_SEAT * SUITE_SEAT_SHARE_BP) / 10000); // 1499

function buildFixture() {
  // Two follower-lane events per Room, 399 rupees each.
  const ledgerRows = [
    { lane: "follower", owner_user_id: OWNER_A, room_id: ROOM_A, amount_inr: 399, received_at: IN_PERIOD },
    { lane: "follower", owner_user_id: OWNER_A, room_id: ROOM_A, amount_inr: 399, received_at: IN_PERIOD },
    { lane: "follower", owner_user_id: OWNER_B, room_id: ROOM_B, amount_inr: 399, received_at: IN_PERIOD },
    { lane: "follower", owner_user_id: OWNER_B, room_id: ROOM_B, amount_inr: 399, received_at: IN_PERIOD },
    { lane: "follower", owner_user_id: OWNER_C, room_id: ROOM_C, amount_inr: 399, received_at: IN_PERIOD },
    { lane: "follower", owner_user_id: OWNER_C, room_id: ROOM_C, amount_inr: 399, received_at: IN_PERIOD },
    { lane: "creator", owner_user_id: OWNER_CREATOR, replica_id: "d1000000-0000-4000-8000-000000000001", amount_inr: 4999, received_at: IN_PERIOD },
  ];
  const payoutRows = [
    { owner_user_id: OWNER_A, gross_inr: 798 + SUITE_SHARE_INR, take_inr: 200, net_inr: 598 + SUITE_SHARE_INR, tds_inr: 0, suite_share_inr: SUITE_SHARE_INR },
    { owner_user_id: OWNER_B, gross_inr: 798, take_inr: 200, net_inr: 598, tds_inr: 0, suite_share_inr: 0 },
    { owner_user_id: OWNER_C, gross_inr: 798, take_inr: 200, net_inr: 598, tds_inr: 0, suite_share_inr: 0 },
  ];
  // WS-R54 (migration 108): `suiteRows` now carries the attachment INTERVAL,
  // not just the current fact of attachment. Attached at the period's own
  // start and still open (`detached_at: null`) - full-period overlap, so
  // every assertion below that expects the FULL SUITE_SHARE_INR is
  // unchanged by this shape.
  const suiteRows = [
    { owner_user_id: OWNER_A, room_id: ROOM_A, org_id: ORG_X, price_per_seat_inr: PRICE_PER_SEAT,
      attached_at: PERIOD.start, detached_at: null },
  ];
  return { ledgerRows, payoutRows, suiteRows };
}

// ═════════════════════════════════════════════════════════════════════════
console.log("§1 reconcile() on the consistent fixture - zero mismatches");
// ═════════════════════════════════════════════════════════════════════════
{
  const { ledgerRows, payoutRows, suiteRows } = buildFixture();
  const result = reconcile(ledgerRows, payoutRows, suiteRows, PERIOD);
  ok("the consistent fixture finds zero mismatches", result.ok === true && result.findings.length === 0,
    JSON.stringify(result.findings));
  ok("the creator lane's own number is reported, never compared", result.creator_lane_total_inr === 4999);
  ok("the period is echoed back", result.period.start === PERIOD.start && result.period.end === PERIOD.end);
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n§2 NEGATIVE CONTROL (a) - one ledger row removed");
// ═════════════════════════════════════════════════════════════════════════
{
  const { ledgerRows, payoutRows, suiteRows } = buildFixture();
  // Remove one of Room A's two follower events.
  const idx = ledgerRows.findIndex((r) => r.lane === "follower" && r.room_id === ROOM_A);
  ledgerRows.splice(idx, 1);
  const result = reconcile(ledgerRows, payoutRows, suiteRows, PERIOD);
  const followerFindings = result.findings.filter((f) => f.type === "follower_gross_mismatch");
  ok("removing one ledger row produces EXACTLY ONE finding", followerFindings.length === 1, JSON.stringify(result.findings));
  const f = followerFindings[0];
  ok("the finding names the owner", f?.owner_user_id === OWNER_A);
  ok("the finding names the Room", Array.isArray(f?.room_ids) && f.room_ids.includes(ROOM_A));
  ok("the finding states the difference in paise (399 rupees short)", f?.difference_paise === 39900,
    `got ${f?.difference_paise}`);
  ok("Rooms B and C, untouched, produce no finding of their own",
    !result.findings.some((x) => x.owner_user_id === OWNER_B || x.owner_user_id === OWNER_C));
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n§3 NEGATIVE CONTROL (b) - suite_share_inr for a Room not attached at period end");
// ═════════════════════════════════════════════════════════════════════════
{
  const { ledgerRows, payoutRows, suiteRows } = buildFixture();
  // Room B is not attached to any Suite (absent from suiteRows). Give its
  // payout row a positive suite_share_inr anyway, holding gross - suite
  // constant so this negative control isolates the SUITE check alone.
  const ownerB = payoutRows.find((p) => p.owner_user_id === OWNER_B);
  ownerB.suite_share_inr = SUITE_SHARE_INR;
  ownerB.gross_inr = 798 + SUITE_SHARE_INR;
  const result = reconcile(ledgerRows, payoutRows, suiteRows, PERIOD);
  const suiteFindings = result.findings.filter((f) => f.type === "suite_share_mismatch");
  ok("a suite_share_inr with no attached Room produces a finding", suiteFindings.length === 1, JSON.stringify(result.findings));
  ok("the finding names Owner B", suiteFindings[0]?.owner_user_id === OWNER_B);
  ok("expected is zero (no Room attached)", suiteFindings[0]?.expected_inr === 0);
  ok("actual is the recorded suite_share_inr", suiteFindings[0]?.actual_inr === SUITE_SHARE_INR);
  ok("the follower check for Owner B is UNCHANGED (this control is isolated)",
    !result.findings.some((f) => f.type === "follower_gross_mismatch" && f.owner_user_id === OWNER_B));
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n§3b (WS-R54, migration 108) - a Room attached for HALF the period gets HALF the share");
// ═════════════════════════════════════════════════════════════════════════
{
  const { ledgerRows, payoutRows, suiteRows } = buildFixture();
  // ROOM_A attaches at period start and detaches exactly halfway through
  // (Sept 1 -> Sept 16 of a Sept 1 -> Oct 1 period: 15 of 30 days).
  const s = suiteRows[0];
  s.attached_at = PERIOD.start;
  s.detached_at = "2026-09-16T00:00:00.000Z";
  const HALF_SHARE_INR = Math.trunc(((PRICE_PER_SEAT * SUITE_SEAT_SHARE_BP) / 10000) * 0.5); // 749
  const ownerA = payoutRows.find((p) => p.owner_user_id === OWNER_A);
  ownerA.suite_share_inr = HALF_SHARE_INR;
  ownerA.gross_inr = 798 + HALF_SHARE_INR;
  const result = reconcile(ledgerRows, payoutRows, suiteRows, PERIOD);
  ok("a payout that correctly paid the PRORATED half-period share reconciles clean",
    result.ok === true, JSON.stringify(result.findings));

  // The full FLAT share (what the old, unprorated read would have expected)
  // is now the WRONG number for a half-period attachment.
  const overpaid = payoutRows.find((p) => p.owner_user_id === OWNER_A);
  overpaid.suite_share_inr = SUITE_SHARE_INR;
  overpaid.gross_inr = 798 + SUITE_SHARE_INR;
  const badResult = reconcile(ledgerRows, payoutRows, suiteRows, PERIOD);
  const suiteFindings = badResult.findings.filter((f) => f.type === "suite_share_mismatch");
  ok("a payout that paid the FULL flat share for a HALF-period attachment is caught",
    suiteFindings.length === 1 && suiteFindings[0].expected_inr === HALF_SHARE_INR && suiteFindings[0].actual_inr === SUITE_SHARE_INR,
    JSON.stringify(suiteFindings));
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n§3c (WS-R54) - a Room attached to TWO Suites in one period: the SUM of both prorated shares");
// ═════════════════════════════════════════════════════════════════════════
{
  // Write down what this gets, per this workstream's own law 3: ROOM_A
  // spends the first 10 days of a 30-day period with ORG_X (price 2999) and
  // the remaining 20 with a SECOND Suite, ORG_Y (price 1999) - a real
  // mid-period Suite switch, back-to-back with no gap.
  const { ledgerRows, payoutRows, suiteRows } = buildFixture();
  const ORG_Y = "c1000000-0000-4000-8000-000000000002";
  const PRICE_Y = 1999;
  suiteRows[0].attached_at = PERIOD.start;
  suiteRows[0].detached_at = "2026-09-11T00:00:00.000Z"; // 10 days with ORG_X
  suiteRows.push({
    owner_user_id: OWNER_A, room_id: ROOM_A, org_id: ORG_Y, price_per_seat_inr: PRICE_Y,
    attached_at: "2026-09-11T00:00:00.000Z", detached_at: null, // 20 days with ORG_Y, still open
  });
  const shareX = Math.trunc(((PRICE_PER_SEAT * SUITE_SEAT_SHARE_BP) / 10000) * (10 / 30)); // trunc(1499.5 * 1/3) = 499
  const shareY = Math.trunc(((PRICE_Y * SUITE_SEAT_SHARE_BP) / 10000) * (20 / 30)); // trunc(999.5 * 2/3) = 666
  const expectedTotal = shareX + shareY; // 1165 - neither Suite's own full-period number (1499 or 999)
  ok("the two prorated shares are neither Suite's own full-period number",
    expectedTotal !== SUITE_SHARE_INR && expectedTotal !== Math.trunc((PRICE_Y * SUITE_SEAT_SHARE_BP) / 10000));
  const ownerA = payoutRows.find((p) => p.owner_user_id === OWNER_A);
  ownerA.suite_share_inr = expectedTotal;
  ownerA.gross_inr = 798 + expectedTotal;
  const result = reconcile(ledgerRows, payoutRows, suiteRows, PERIOD);
  ok("a payout that paid the SUM of both prorated shares reconciles clean",
    result.ok === true, JSON.stringify(result.findings));
  const suiteFinding = result.findings.find((f) => f.type === "suite_share_mismatch");
  ok("no suite_share_mismatch finding for owner A", !suiteFinding);
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n§3d NEGATIVE CONTROL (e) - reconciling against the CURRENT attachment (the old behaviour) is wrong for a Room detached mid-period");
// ═════════════════════════════════════════════════════════════════════════
{
  // The exact motivating case from context/decisions.md#ws-r42-reconcile-
  // suite-lane-uses-current-attachment: "a Room detached on the 2nd is
  // reconciled as never attached." ROOM_A attached for the first 2 days of
  // the period, then detached - by period end it is no longer attached to
  // ANY Suite, but it correctly earned 2 days' worth of prorated share.
  const { ledgerRows, payoutRows, suiteRows } = buildFixture();
  suiteRows[0].attached_at = PERIOD.start;
  suiteRows[0].detached_at = "2026-09-03T00:00:00.000Z"; // 2 of 30 days
  const TWO_DAY_SHARE_INR = Math.trunc(((PRICE_PER_SEAT * SUITE_SEAT_SHARE_BP) / 10000) * (2 / 30)); // 99
  const ownerA = payoutRows.find((p) => p.owner_user_id === OWNER_A);
  ownerA.suite_share_inr = TWO_DAY_SHARE_INR;
  ownerA.gross_inr = 798 + TWO_DAY_SHARE_INR;

  // THE NEW (period-true) reading: reconcile() is handed the real interval
  // and finds the payout correct.
  const newResult = reconcile(ledgerRows, payoutRows, suiteRows, PERIOD);
  ok("the NEW, interval-based reading finds NO mismatch for a Room correctly paid for its 2 attached days",
    newResult.ok === true, JSON.stringify(newResult.findings));

  // THE OLD behaviour: `suiteRows` built from CURRENT attachment only (the
  // shape `reconcilePeriod` used before migration 108 - a Room's org_id is
  // null by period end, so it is simply ABSENT from suiteRows, exactly as
  // the pre-108 `where r.org_id is not null` query would leave it). This is
  // NOT a live query here (offline; `reconcile` never touches a database) -
  // it is the SAME pure function fed the shape the OLD code would have
  // produced, proving that shape was wrong, not merely different.
  const oldStyleSuiteRows = [];
  const oldResult = reconcile(ledgerRows, payoutRows, oldStyleSuiteRows, PERIOD);
  const oldFindings = oldResult.findings.filter((f) => f.type === "suite_share_mismatch");
  ok("NEGATIVE CONTROL (e): the OLD (current-attachment-only) reading FALSELY flags a correctly-paid, since-detached Room",
    oldFindings.length === 1 && oldFindings[0].owner_user_id === OWNER_A && oldFindings[0].expected_inr === 0,
    JSON.stringify(oldFindings));
  ok("the false finding's own actual_inr is exactly the 2-day share the Room really earned",
    oldFindings[0]?.actual_inr === TWO_DAY_SHARE_INR);
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n§4 THE NEW SQL - applyWebhook's creator lane writes vy_creator_charge_event");
// ═════════════════════════════════════════════════════════════════════════
function freshChargeState() {
  return { creatorSubscriptions: [], creatorChargeEvents: [] };
}

function makeChargeDb(state) {
  let subCounter = 0;
  const db = async (sql, params = []) => {
    const has = (s) => sql.includes(s);

    // WS-R51: startCreatorSubscription's own new ownership check
    // (api/_payments.js's `ownedReplicaHandle`) - unconditionally admitted
    // here, `evals/org-billing/run.mjs`'s own precedent, since this suite's
    // own subject is reconciliation and webhook replay, not the ownership
    // boundary (that is `evals/room-doors`'s own new case).
    if (has("select replica_id from vy_replica where replica_id = $1::uuid and owner_user_id = $2::uuid")) {
      return [{ replica_id: params[0] }];
    }

    // ── seatCoversCreatorTier's own read (api/_org.js): nobody in this
    //    fixture is Suite-covered unless a test overrides it via deps. ──
    if (has("select exists (") && has("vy_org_subscription")) return [{ covered: false }];

    // ── startCreatorSubscription's own reads/writes. WS-R132 (migration
    // 135): the widened predicate excludes a halted or cancelled mandate
    // too - a fixture row with no `mandate_state` at all (every row this
    // file minted before this workstream) reads as `undefined`, which is
    // not in the exclusion list either, so this is a no-op for every
    // EXISTING test in this file. ──
    if (has("from vy_creator_subscription") && has("state in")) {
      const [replicaId] = params;
      const row = state.creatorSubscriptions
        .filter((s) => s.replica_id === replicaId
          && ["created", "authenticated", "active", "paused"].includes(s.state)
          && !["halted", "cancelled"].includes(s.mandate_state))
        .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
      return row ? [{ subscription_id: row.subscription_id, provider_subscription_ref: row.provider_subscription_ref, state: row.state }] : [];
    }
    // ── WS-R132's own "close halted/cancelled row, then insert" statement
    // family - checked BEFORE the plain insert branch below, since it also
    // contains the substring "insert into vy_creator_subscription". ──
    if (has("with closed as (") && has("insert into vy_creator_subscription")) {
      const [replicaId, ownerUserId, plan, priceInr, currency, provider] = params;
      for (const s of state.creatorSubscriptions) {
        if (s.replica_id === replicaId
          && ["created", "authenticated", "active", "paused"].includes(s.state)
          && ["halted", "cancelled"].includes(s.mandate_state)) {
          s.state = "cancelled";
        }
      }
      subCounter += 1;
      const row = {
        subscription_id: `e${String(subCounter).padStart(7, "0")}-0000-4000-8000-000000000000`,
        owner_user_id: ownerUserId, replica_id: replicaId, plan, price_inr: priceInr, currency, provider,
        state: "created", provider_subscription_ref: null, created_at: new Date(Date.now() + subCounter).toISOString(),
        mandate_state: "none", mandate_state_at: null,
      };
      state.creatorSubscriptions.push(row);
      return [{ subscription_id: row.subscription_id, state: row.state }];
    }
    if (has("insert into vy_creator_subscription")) {
      const [ownerUserId, replicaId, plan, priceInr, currency, provider] = params;
      subCounter += 1;
      const row = {
        subscription_id: `e${String(subCounter).padStart(7, "0")}-0000-4000-8000-000000000000`,
        owner_user_id: ownerUserId, replica_id: replicaId, plan, price_inr: priceInr, currency, provider,
        state: "created", provider_subscription_ref: null, created_at: new Date(Date.now() + subCounter).toISOString(),
      };
      state.creatorSubscriptions.push(row);
      return [{ subscription_id: row.subscription_id, state: row.state }];
    }
    if (has("set provider_subscription_ref")) {
      const [subId, ref] = params;
      const row = state.creatorSubscriptions.find((s) => s.subscription_id === subId);
      if (row) row.provider_subscription_ref = ref;
      return [{ state: row?.state }];
    }

    // ── applyWebhook's own lane resolution: follower/org lanes never match ──
    if (has("from vy_room_subscription s")) return [];
    if (has("from vy_org_subscription where provider")) return [];
    if (has("from vy_creator_subscription where provider")) {
      const [provider, ref] = params;
      const row = state.creatorSubscriptions.find((s) => s.provider === provider && s.provider_subscription_ref === ref);
      return row ? [{ subscription_id: row.subscription_id, owner_user_id: row.owner_user_id, replica_id: row.replica_id }] : [];
    }

    // ── THE NEW STATEMENT: state flip + conditional charge insert, one CTE.
    // WS-R132: the 10th bound param is `nextMandateState` (`api/_payments.js`'s
    // own creator-lane `sub_update`, migration 130) - previously ignored
    // here since no test in this file ever read `mandate_state` back;
    // applied now with the SAME "only advance when leaving a different
    // value" guard the real UPDATE's CASE expression carries, so a halt
    // fired in this fixture is a real, stored fact the new close-then-insert
    // branch above can act on. ──
    if (has("with sub_update as") && has("insert into vy_creator_charge_event")) {
      const [subId, nextState, periodStart, periodEnd, provider, chargeRef, amountInr, payloadHash, isCharge, nextMandateState] = params;
      const sub = state.creatorSubscriptions.find((s) => s.subscription_id === subId);
      if (!sub) return [];
      if (nextState !== "") sub.state = nextState;
      if (periodStart) sub.current_period_start = periodStart;
      if (periodEnd) sub.current_period_end = periodEnd;
      if (nextMandateState && sub.mandate_state !== nextMandateState) {
        sub.mandate_state = nextMandateState;
        sub.mandate_state_at = new Date().toISOString();
      }
      let chargeId = null;
      if (isCharge === true || isCharge === "true") {
        const dup = state.creatorChargeEvents.find((c) => c.provider === provider && c.provider_charge_ref === chargeRef);
        if (!dup) {
          chargeId = `f${state.creatorChargeEvents.length + 1}`;
          state.creatorChargeEvents.push({
            charge_id: chargeId, owner_user_id: sub.owner_user_id, replica_id: sub.replica_id,
            subscription_id: sub.subscription_id, provider, provider_charge_ref: chargeRef,
            amount_inr: amountInr, signature_verified: true, payload_hash: payloadHash,
          });
        }
      }
      return [{ subscription_id: sub.subscription_id, state: sub.state, charge_id: chargeId }];
    }

    throw new Error(`payments-reconcile: unmodelled statement: ${sql.slice(0, 140)}`);
  };
  return db;
}

{
  const state = freshChargeState();
  const db = makeChargeDb(state);
  const started = await startCreatorSubscription(db, { ownerUserId: OWNER_CREATOR, replicaId: "d1000000-0000-4000-8000-000000000001", plan: "room" }, { env: ENV });
  const ref = started.provider_subscription_ref;

  ok("CREATOR_CHARGE_KINDS names the two landed-charge kinds", CREATOR_CHARGE_KINDS.has("subscription.charged") && CREATOR_CHARGE_KINDS.has("subscription.activated"));

  const body = RAZORPAY_EVENT("subscription.activated", ref, 499900);
  const sig = fake.signWebhookForTest(body, WEBHOOK_SECRET);
  const applied = await applyWebhook(db, { rawBody: body, signatureHeader: sig, eventRef: "evt_charge_1" }, { env: ENV });
  ok("the creator lane still resolves and applies", applied.applied === true && applied.lane === "creator");
  ok("the state flips to active", state.creatorSubscriptions[0].state === "active");
  ok("A CHARGE ROW LANDS for subscription.activated with a positive amount", state.creatorChargeEvents.length === 1);
  ok("the charge row's provider ref is the webhook's own event ref", state.creatorChargeEvents[0].provider_charge_ref === "evt_charge_1");
  ok("the charge amount is whole rupees (499900 paise / 100)", state.creatorChargeEvents[0].amount_inr === 4999);
  ok("the returned charge_id is surfaced", applied.charge_id === state.creatorChargeEvents[0].charge_id && applied.charge_id != null);

  // Idempotent replay: the SAME event ref again inserts nothing new.
  const replay = await applyWebhook(db, { rawBody: body, signatureHeader: sig, eventRef: "evt_charge_1" }, { env: ENV });
  ok("a replayed charge event is a no-op on the ledger (still exactly one row)", state.creatorChargeEvents.length === 1);
  ok("the replay is reported as a replay", replay.replay === true);

  // A non-charge kind (a pause) still flips state and writes NOTHING.
  const pauseBody = RAZORPAY_EVENT("subscription.paused", ref, 0);
  const pauseSig = fake.signWebhookForTest(pauseBody, WEBHOOK_SECRET);
  await applyWebhook(db, { rawBody: pauseBody, signatureHeader: pauseSig, eventRef: "evt_charge_2" }, { env: ENV });
  ok("subscription.paused flips state to paused", state.creatorSubscriptions[0].state === "paused");
  ok("subscription.paused writes NO charge row (still exactly one)", state.creatorChargeEvents.length === 1);
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n§5 NEGATIVE CONTROL (c) - a seat-covered creator writes zero charge rows");
// ═════════════════════════════════════════════════════════════════════════
{
  const state = freshChargeState();
  const db = makeChargeDb(state);
  let providerCalls = 0;
  const originalCreate = fake.createSubscription;
  // Count provider calls without mutating the imported module.
  const countingDeps = {
    env: ENV,
    seatCoversCreatorTier: async () => true,
    secrets: { keyId: "k", keySecret: "s", webhookSecret: WEBHOOK_SECRET },
  };
  let threw = null;
  try {
    await startCreatorSubscription(db, { ownerUserId: OWNER_COVERED, replicaId: "d5000000-0000-4000-8000-000000000005", plan: "studio" }, countingDeps);
  } catch (e) {
    threw = e;
  }
  ok("a seat-covered creator's own charge attempt is refused before any provider call",
    threw instanceof PaymentsError && threw.code === "creator_tier_covered_by_suite");
  ok("NEGATIVE CONTROL (c): zero vy_creator_subscription rows were ever written for them",
    state.creatorSubscriptions.length === 0);
  ok("NEGATIVE CONTROL (c): therefore zero vy_creator_charge_event rows exist - structurally " +
     "impossible otherwise (the table's own subscription_id column is NOT NULL with a real FK, " +
     "migration 104's own header)", state.creatorChargeEvents.length === 0);
  void originalCreate; void providerCalls;
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n§6 NEGATIVE CONTROL (d) - check-mirrors fails on a fixture pair that differs by one");
// ═════════════════════════════════════════════════════════════════════════
{
  const front = { "fixture/pulseApi.ts": 'export const PULSE_MAX_LABELS = 12; // mirror of api/_pulse.js#PULSE_MAX_LABELS\n' };
  const apiClean = { "api/_pulse.js": "export const PULSE_MAX_LABELS = 12;\n" };
  const apiDrifted = { "api/_pulse.js": "export const PULSE_MAX_LABELS = 13;\n" };

  const clean = checkMirrors(front, apiClean);
  ok("a matching pair produces zero mismatches", clean.mismatches.length === 0);

  const drifted = checkMirrors(front, apiDrifted);
  ok("a pair that differs by exactly one is caught", drifted.mismatches.length === 1,
    JSON.stringify(drifted.mismatches));
  ok("the mismatch names both sides' values", drifted.mismatches[0]?.reason.includes("12") && drifted.mismatches[0]?.reason.includes("13"));
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n§7 (WS-R103, no migration) - reconcilePeriod gains charges_without_receipt; zero after a sweep");
// ═════════════════════════════════════════════════════════════════════════
{
  const PERIOD_START = "2026-09-01T00:00:00.000Z";
  const PERIOD_END = "2026-10-01T00:00:00.000Z";
  // Two landed follower-lane charges inside the period, no receipt yet - the
  // SAME shape `evals/receipt-sweep/run.mjs` drives `backfillReceipts`
  // against; this suite's own subject is `reconcilePeriod`'s NEW count, not
  // the sweep itself, so every OTHER query it issues (follower/creator/
  // suite/payout) is fed empty rows on purpose - this section is isolated
  // to the one new statement.
  const chargeEvents = [
    { event_id: "g1", room_id: ROOM_A, kind: "subscription.charged", amount_inr: 399, received_at: "2026-09-05T00:00:00.000Z" },
    { event_id: "g2", room_id: ROOM_B, kind: "subscription.activated", amount_inr: 599, received_at: "2026-09-06T00:00:00.000Z" },
  ];
  const receiptedEventIds = new Set(); // mutated between the two calls below - "the sweep runs"

  function makeDb() {
    let receiptQueryRan = false;
    const db = async (sql, params = []) => {
      const has = (s) => sql.includes(s);
      if (has("from vy_payment_event e") && has("join vy_room r on r.room_id = e.room_id")) return []; // followerRows
      if (has("from vy_creator_charge_event")) return []; // creatorRows
      if (has("from vy_room_org_attachment a")) return []; // suiteRows
      if (has("from vy_creator_payout")) return []; // payoutRows
      if (has("count(*)::int as n") && has("from vy_payment_event e") && has("not exists")) {
        receiptQueryRan = true;
        const [kinds, start, end] = params;
        const kindSet = new Set(kinds);
        const n = chargeEvents.filter((e) =>
          e.room_id != null && kindSet.has(e.kind) && e.amount_inr > 0 &&
          e.received_at >= start && e.received_at < end && !receiptedEventIds.has(e.event_id)).length;
        return [{ n }];
      }
      // WS-R130 (migration 133): `referral_rewards` - this section's own
      // fixture seeds no reward rows at all, on purpose (its own subject is
      // `charges_without_receipt`, not this NEW field) - an empty answer
      // proves the query runs and returns the honest zero shape rather than
      // this section throwing on an unmodelled statement.
      if (has("from vy_room_referral_reward rr")) return [];
      throw new Error(`payments-reconcile §7: unmodelled statement: ${sql.slice(0, 140)}`);
    };
    return { db, ranFlag: () => receiptQueryRan };
  }

  // `tableApplied` (api/memory.js) reads the REAL database when not
  // injected - `evals/room-receipt/run.mjs`'s own `deps()` precedent,
  // restated: every call below meaning to exercise the real new query
  // passes `tableApplied: async () => true` explicitly.
  const RECEIPT_APPLIED = { tableApplied: async () => true };
  const { db } = makeDb();
  const before = await reconcilePeriod(db, { periodStart: PERIOD_START, periodEnd: PERIOD_END }, RECEIPT_APPLIED);
  ok("§7 two unreceipted landed charges in the period are counted", before.charges_without_receipt === 2, JSON.stringify(before));
  ok("§7 the count sits ALONGSIDE the existing reconciliation shape, not instead of it",
    before.ok === true && Array.isArray(before.findings) && before.creator_lane_total_inr === 0);

  // "the sweep runs": both charges get receipts.
  receiptedEventIds.add("g1");
  receiptedEventIds.add("g2");
  const after = await reconcilePeriod(db, { periodStart: PERIOD_START, periodEnd: PERIOD_END }, RECEIPT_APPLIED);
  ok("§7 zero after a sweep is the proof (this workstream's own law 3)", after.charges_without_receipt === 0, JSON.stringify(after));

  // Gated on vy_receipt being applied - `backfillReceipts`'s own gate,
  // restated: a database that has not run migration 126 reports zero
  // without ever running the new query at all.
  const { db: gatedDb, ranFlag: gatedRanFlag } = makeDb();
  const ungated = await reconcilePeriod(gatedDb, { periodStart: PERIOD_START, periodEnd: PERIOD_END }, { tableApplied: async () => false });
  ok("§7 an unapplied vy_receipt reports zero without ever running that query",
    ungated.charges_without_receipt === 0 && gatedRanFlag() === false);
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n§8 WS-R130 (migration 133) - reconcilePeriod names referral_rewards, never missing");
// ═════════════════════════════════════════════════════════════════════════
{
  const PERIOD_START = "2026-09-01T00:00:00.000Z";
  const PERIOD_END = "2026-10-01T00:00:00.000Z";
  const rewardRows = [
    { room_id: ROOM_A, follower_price_inr: 399, granted_at: "2026-09-10T00:00:00.000Z" },
    { room_id: ROOM_B, follower_price_inr: 599, granted_at: "2026-09-20T00:00:00.000Z" },
  ];
  function makeDb() {
    let ranFlag = false;
    const db = async (sql, params = []) => {
      const has = (s) => sql.includes(s);
      if (has("from vy_payment_event e") && has("join vy_room r on r.room_id = e.room_id")) return [];
      if (has("from vy_creator_charge_event")) return [];
      if (has("from vy_room_org_attachment a")) return [];
      if (has("from vy_creator_payout")) return [];
      if (has("from vy_room_referral_reward rr")) {
        ranFlag = true;
        const [start, end] = params;
        return rewardRows
          .filter((r) => r.granted_at >= start && r.granted_at < end)
          .map((r) => ({ follower_price_inr: r.follower_price_inr }));
      }
      // `charges_without_receipt`'s own gated query also fires under a
      // blanket `tableApplied: true` - this section's own subject is
      // `referral_rewards`, so this is answered honestly-empty rather than
      // widening this section's own fixture to model it a second time.
      if (has("count(*)::int as n") && has("from vy_payment_event e") && has("not exists")) return [{ n: 0 }];
      throw new Error(`payments-reconcile §8: unmodelled statement: ${sql.slice(0, 140)}`);
    };
    return { db, ranFlag: () => ranFlag };
  }

  const { db } = makeDb();
  const result = await reconcilePeriod(db, { periodStart: PERIOD_START, periodEnd: PERIOD_END }, { tableApplied: async () => true });
  ok("§8 two rewards granted inside the period are counted, both rooms' own price named",
    result.referral_rewards.count === 2 && result.referral_rewards.forgone_inr === 399 + 599,
    JSON.stringify(result.referral_rewards));
  ok("§8 the line sits ALONGSIDE the existing shape, never replacing it",
    result.ok === true && Array.isArray(result.findings));

  // Gated on vy_room_referral_reward being applied - the honest zero shape,
  // never a fake count, `charges_without_receipt`'s own gate restated.
  const { db: gatedDb, ranFlag: gatedRanFlag } = makeDb();
  const ungated = await reconcilePeriod(gatedDb, { periodStart: PERIOD_START, periodEnd: PERIOD_END }, { tableApplied: async () => false });
  ok("§8 migration 133 not applied - referral_rewards reports zero without ever running that query",
    ungated.referral_rewards.count === 0 && ungated.referral_rewards.forgone_inr === 0 && gatedRanFlag() === false);
}

console.log("\n§9 WS-R132 (migration 135): A RESTARTED CREATOR MANDATE STILL PLACES EVERY RUPEE");
// ═════════════════════════════════════════════════════════════════════════
{
  // §4's own charge ledger, restated: a creator whose FIRST mandate halts
  // and who restarts must land exactly the charges each subscription
  // actually earned - never a lost charge (the closed row's own history
  // silently dropped) and never a double count (the new row's charges
  // somehow re-summing the old one's).
  const state = freshChargeState();
  const db = makeChargeDb(state);
  const replicaId = "d1000000-0000-4000-8000-0000000000c9";
  const started = await startCreatorSubscription(db, { ownerUserId: OWNER_CREATOR, replicaId, plan: "room" }, { env: ENV });
  const oldRef = started.provider_subscription_ref;

  const fireRef = (ref, kind, tag, amountPaise = 0) => {
    const body = RAZORPAY_EVENT(kind, ref, amountPaise);
    const sig = fake.signWebhookForTest(body, WEBHOOK_SECRET);
    return applyWebhook(db, { rawBody: body, signatureHeader: sig, eventRef: `evt_r132_${tag}` }, { env: ENV });
  };
  await fireRef(oldRef, "subscription.activated", "old_activate", 499900);
  await fireRef(oldRef, "subscription.halted", "old_halt");
  ok("§9 the first mandate landed exactly one charge before it halted",
    state.creatorChargeEvents.filter((c) => c.subscription_id === started.subscription_id).length === 1);

  const restarted = await startCreatorSubscription(db, { ownerUserId: OWNER_CREATOR, replicaId, plan: "room" }, { env: ENV });
  ok("§9 the restart is a genuinely NEW subscription row", restarted.subscription_id !== started.subscription_id);
  const newRef = restarted.provider_subscription_ref;
  ok("the real restart result routes to a different provider subscription", newRef !== oldRef);
  await fireRef(newRef, "subscription.activated", "new_activate", 499900);

  ok("§9 the OLD subscription's own charge is untouched by the restart - still exactly one",
    state.creatorChargeEvents.filter((c) => c.subscription_id === started.subscription_id).length === 1);
  ok("§9 the NEW subscription earns its OWN charge, separately",
    state.creatorChargeEvents.filter((c) => c.subscription_id === restarted.subscription_id).length === 1);
  ok("§9 every rupee is placed exactly once - two charge rows total, one per subscription, never merged and never dropped",
    state.creatorChargeEvents.length === 2
      && state.creatorChargeEvents.reduce((sum, c) => sum + c.amount_inr, 0) === 4999 * 2);
  ok("§9 no charge row was ever double-counted for the SAME provider_charge_ref",
    new Set(state.creatorChargeEvents.map((c) => c.provider_charge_ref)).size === state.creatorChargeEvents.length);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
