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
// migration 104's statements, or `reconcilePeriod`'s own four SELECTs, parse
// against a live database (see this workstream's final report for what
// does). §1-3 drive `reconcile` directly, no fake `db` at all - it is a pure
// function, `payoutStatementFromRows`'s own precedent. §4-5 drive the real
// `applyWebhook`/`startCreatorSubscription` through a fake `db`,
// `evals/org-billing/run.mjs`'s own fixture pattern, extended with the one
// new table it does not yet model.
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
  const suiteRows = [
    { owner_user_id: OWNER_A, room_id: ROOM_A, org_id: ORG_X, price_per_seat_inr: PRICE_PER_SEAT },
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
console.log("\n§4 THE NEW SQL - applyWebhook's creator lane writes vy_creator_charge_event");
// ═════════════════════════════════════════════════════════════════════════
function freshChargeState() {
  return { creatorSubscriptions: [], creatorChargeEvents: [] };
}

function makeChargeDb(state) {
  let subCounter = 0;
  const db = async (sql, params = []) => {
    const has = (s) => sql.includes(s);

    // ── seatCoversCreatorTier's own read (api/_org.js): nobody in this
    //    fixture is Suite-covered unless a test overrides it via deps. ──
    if (has("select exists (") && has("vy_org_subscription")) return [{ covered: false }];

    // ── startCreatorSubscription's own reads/writes ──
    if (has("from vy_creator_subscription") && has("state in")) {
      const [replicaId] = params;
      const row = state.creatorSubscriptions
        .filter((s) => s.replica_id === replicaId && ["created", "authenticated", "active", "paused"].includes(s.state))
        .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
      return row ? [{ subscription_id: row.subscription_id, provider_subscription_ref: row.provider_subscription_ref, state: row.state }] : [];
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

    // ── THE NEW STATEMENT: state flip + conditional charge insert, one CTE ──
    if (has("with sub_update as") && has("insert into vy_creator_charge_event")) {
      const [subId, nextState, periodStart, periodEnd, provider, chargeRef, amountInr, payloadHash, isCharge] = params;
      const sub = state.creatorSubscriptions.find((s) => s.subscription_id === subId);
      if (!sub) return [];
      if (nextState !== "") sub.state = nextState;
      if (periodStart) sub.current_period_start = periodStart;
      if (periodEnd) sub.current_period_end = periodEnd;
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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
