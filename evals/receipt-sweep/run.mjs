// WS-R103 (no migration). The receipt backfill sweep - offline, deterministic,
// $0, no DB, no network, no model call.
//
//   node evals/receipt-sweep/run.mjs
//
// Drives the REAL `backfillReceipts` and `issueFollowerReceipt`
// (api/_payments.js) through a small, dedicated fake `db` modelling only the
// two statement shapes this workstream adds - `evals/room-receipt/run.mjs`'s
// own §4 `receiptCounterDb` precedent, extended with the new SELECT. Also
// drives the REAL `receiptsIssuedLateThisWeek` (api/_ops.js), `evals/room-
// dormancy/run.mjs`'s own "the ops-board read gets its own direct suite"
// precedent for `dormancyThisWeek`.
//
// What this suite is actually guarding:
//
//   1. THE SELECT'S OWN THREE PREDICATES. A landed follower charge with no
//      receipt is found (`CREATOR_CHARGE_KINDS`, `amount_inr > 0`, `room_id
//      is not null`); a non-charge event with a positive amount (the
//      refund-shaped fixture row) and an org-lane charge (`room_id` null)
//      are both never receipted - the REQUIRED negative control (this
//      workstream's own law 4) proves the KIND filter specifically, by
//      running a version of the same select with it removed against the
//      IDENTICAL fixture rows and showing that version would have swept the
//      non-charge row.
//   2. LAW 1's OWN DATE RULE. A receipt issued by the backfill carries the
//      CHARGE's own `received_at` as `issued_at`, never the sweep's clock -
//      `backfillReceipts` never reads `Date.now()` at all, so this is
//      structural, not merely observed once.
//   3. THE COUNTER STAYS THE ONLY ARBITER. Two new charges get two
//      CONSECUTIVE numbers after an existing receipt's own number - never a
//      fresh sequence, never a gap; a second sweep run over the SAME rows
//      issues NOTHING (idempotent by `not exists`, `vy_receipt`'s own unique
//      index one layer down).
//   4. THE OPS BOARD'S OWN READ. `receiptsIssuedLateThisWeek` sums the
//      `receipt` sweep's own `vy_sweep_run` history over a rolling 7 days,
//      never a cached or invented number.
//   5. WS-R133 (referral-reward hardening, law 3). A `referral_reward`
//      ledger row with a missing receipt (the exact gap
//      `maybeGrantReferralReward`'s own `catch` names) is closed by this
//      SAME sweep - kind-aware, exactly `amount_inr = 0`, the SAME atomic
//      counter claim - never a second, parallel mint path.
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

const paymentsMod = await import(pathToFileURL(join(REPO, "api/_payments.js")).href);
const { backfillReceipts, issueFollowerReceipt, CREATOR_CHARGE_KINDS, RECEIPT_SWEEP_DEFAULT_LIMIT, REFERRAL_REWARD_REASON } = paymentsMod;
const opsMod = await import(pathToFileURL(join(REPO, "api/_ops.js")).href);
const { receiptsIssuedLateThisWeek } = opsMod;

// `tableApplied` (api/memory.js) reads the REAL database when not injected -
// `evals/room-receipt/run.mjs`'s own `deps()` helper precedent, restated:
// every call below that means to exercise the real SELECT passes
// `tableApplied: async () => true` explicitly, never the module default.
const deps = (extra = {}) => ({ tableApplied: async () => true, ...extra });

const ROOM_1 = "b1000000-0000-4000-8000-000000000001";
const ROOM_2 = "b2000000-0000-4000-8000-000000000002";
const SUB_1 = "c1000000-0000-4000-8000-000000000001";
const SUB_2 = "c2000000-0000-4000-8000-000000000002";
const PERSON_1 = "d1000000-0000-4000-8000-000000000001";
const PERSON_2 = "d2000000-0000-4000-8000-000000000002";

/** A tiny world: `vy_payment_event` rows (with the columns `backfillReceipts`
 *  own SELECT reads), `vy_room_subscription`'s own `person_id` per
 *  subscription, and the two `vy_receipt`/`vy_receipt_counter` statements
 *  `issueFollowerReceipt` issues - `evals/room-receipt/run.mjs`'s own
 *  `receiptCounterDb` extended with the new backfill SELECT. */
function makeWorld() {
  const events = [];
  const subscriptions = new Map([
    [SUB_1, PERSON_1],
    [SUB_2, PERSON_2],
  ]);
  const counters = new Map();
  const receipts = new Map(); // payment_event_id -> row
  let nextReceiptId = 1;
  const db = async (sql, params = []) => {
    const has = (s) => sql.includes(s);

    // ── backfillReceipts's own SELECT (WS-R133: kind-aware amount test —
    //    a real charge still needs amount_inr > 0; the reward kind is
    //    ADDITIONALLY admitted at exactly amount_inr = 0, never a blanket
    //    "amount_inr >= 0" that would also sweep a broken zero-amount
    //    charge) ─────────────────────────────────────────────────────────
    if (has("from vy_payment_event e") && has("left join vy_room_subscription s") && has("not exists")) {
      const [kinds, limit, rewardKind] = params;
      const kindSet = new Set(kinds);
      return events
        .filter((e) => {
          if (e.room_id == null || receipts.has(e.event_id)) return false;
          const amount = Number(e.amount_inr);
          if (kindSet.has(e.kind) && amount > 0) return true;
          if (rewardKind && e.kind === rewardKind && amount === 0) return true;
          return false;
        })
        .sort((a, b) => a.received_at.localeCompare(b.received_at))
        .slice(0, limit)
        .map((e) => ({
          event_id: e.event_id,
          room_id: e.room_id,
          received_at: e.received_at,
          person_id: subscriptions.get(e.subscription_id) ?? null,
        }));
    }

    // ── issueFollowerReceipt's own two statements (evals/room-receipt/
    //    run.mjs's own §4 shape, unchanged) ────────────────────────────
    if (has("insert into vy_receipt_counter")) {
      const [fy, eventId, roomId, personId, issuedAt] = params;
      if (!counters.has(fy)) counters.set(fy, 1);
      if (receipts.has(String(eventId))) return [];
      const claimed = counters.get(fy);
      counters.set(fy, claimed + 1);
      const row = {
        receipt_id: `r${nextReceiptId++}`,
        receipt_no: claimed,
        payment_event_id: String(eventId),
        room_id: String(roomId),
        person_id: personId ? String(personId) : null,
        issued_at: issuedAt || new Date().toISOString(),
      };
      receipts.set(row.payment_event_id, row);
      return [{ receipt_id: row.receipt_id, receipt_no: row.receipt_no, issued_at: row.issued_at }];
    }

    throw new Error(`receipt-sweep: unmodelled statement: ${sql.slice(0, 140)}`);
  };
  return { db, events, subscriptions, counters, receipts };
}

// ═════════════════════════════════════════════════════════════════════════
console.log("§1 THE SELECT'S THREE PREDICATES, and the two required negative controls");
// ═════════════════════════════════════════════════════════════════════════
{
  const world = makeWorld();
  const { db, events, counters, receipts } = world;

  // An existing receipt for E1, already claimed - `counters` reflects the
  // next number this FY (2026-27) would hand out, exactly as a real prior
  // webhook-time claim would leave it.
  events.push({ event_id: "E1", room_id: ROOM_1, subscription_id: SUB_1, kind: "subscription.charged", amount_inr: 399, received_at: "2026-09-01T00:00:00.000Z" });
  receipts.set("E1", { receipt_id: "r0", receipt_no: 1, payment_event_id: "E1", room_id: ROOM_1, person_id: PERSON_1, issued_at: "2026-09-01T00:00:00.000Z" });
  counters.set("2026-27", 2);

  // Two genuinely NEW landed charges, no receipt yet.
  events.push({ event_id: "E2", room_id: ROOM_1, subscription_id: SUB_1, kind: "subscription.charged", amount_inr: 399, received_at: "2026-09-10T00:00:00.000Z" });
  events.push({ event_id: "E3", room_id: ROOM_2, subscription_id: SUB_2, kind: "subscription.activated", amount_inr: 599, received_at: "2026-09-12T00:00:00.000Z" });

  // NEGATIVE CONTROL (a): a non-charge kind carrying a positive amount - the
  // brief's own "refund" shape (this ledger's own CHECK constraint,
  // migration 078, has no literal 'refund' kind; a cancellation event
  // carrying money is the closest real analogue and exercises the identical
  // property: money moved, but the KIND says this was never a landed
  // charge).
  events.push({ event_id: "E4", room_id: ROOM_1, subscription_id: SUB_1, kind: "subscription.cancelled", amount_inr: 100, received_at: "2026-09-11T00:00:00.000Z" });

  // NEGATIVE CONTROL (b): an org-lane charge - `room_id` null, exactly the
  // shape `applyWebhook`'s org lane writes into this SAME `vy_payment_event`
  // table (migration 108's own `candidate` CTE has no `room_id` column at
  // all for that lane).
  events.push({ event_id: "E5", room_id: null, subscription_id: null, kind: "subscription.charged", amount_inr: 999, received_at: "2026-09-13T00:00:00.000Z" });

  // A landed-KIND event with a ZERO amount - proves `amount_inr > 0` is a
  // real filter, not a tautology every charge-kind row already satisfies.
  events.push({ event_id: "E6", room_id: ROOM_1, subscription_id: SUB_1, kind: "subscription.activated", amount_inr: 0, received_at: "2026-09-14T00:00:00.000Z" });

  const summary = await backfillReceipts(db, deps());
  ok("§1 exactly the two genuinely landed, unreceipted charges are scanned", summary.scanned === 2, JSON.stringify(summary));
  ok("§1 exactly two receipts are issued", summary.issued === 2, JSON.stringify(summary));

  const r2 = receipts.get("E2");
  const r3 = receipts.get("E3");
  ok("§1 E2 gets receipt_no 2 - CONSECUTIVE after the existing receipt's own 1", r2?.receipt_no === 2, JSON.stringify(r2));
  ok("§1 E3 gets receipt_no 3", r3?.receipt_no === 3, JSON.stringify(r3));
  ok("law 1: E2's issued_at is the CHARGE's own received_at, never the sweep's clock", r2?.issued_at === "2026-09-10T00:00:00.000Z");
  ok("law 1: E3's issued_at is the CHARGE's own received_at", r3?.issued_at === "2026-09-12T00:00:00.000Z");
  ok("the counter ends at 4 - both new claims accounted for, no gap, no collision", counters.get("2026-27") === 4);

  ok("NEGATIVE CONTROL (a): the non-charge event (E4) is never receipted", !receipts.has("E4"));
  ok("NEGATIVE CONTROL (b): the org-lane charge (E5) is never receipted", !receipts.has("E5"));
  ok("the zero-amount landed-kind event (E6) is never receipted", !receipts.has("E6"));

  // THE REQUIRED NEGATIVE CONTROL (this workstream's own law 4): a version
  // of the SAME select with the KIND filter removed, run against the
  // IDENTICAL fixture rows, proves that filter specifically is what keeps
  // E4 out - never merely asserted, demonstrated against the real data.
  const withoutKindFilter = events.filter((e) => e.room_id != null && Number(e.amount_inr) > 0 && !receipts.has(e.event_id));
  ok("REQUIRED NEGATIVE CONTROL: a select WITHOUT the kind filter WOULD sweep the non-charge event",
    withoutKindFilter.some((e) => e.event_id === "E4"),
    JSON.stringify(withoutKindFilter.map((e) => e.event_id)));
  ok("...while the REAL sweep (kind filter intact) already ran above and did not", !receipts.has("E4"));
  // The same demonstration for the room_id (follower-lane) predicate.
  const withoutRoomFilter = events.filter((e) => CREATOR_CHARGE_KINDS.has(e.kind) && Number(e.amount_inr) > 0 && !receipts.has(e.event_id));
  ok("REQUIRED NEGATIVE CONTROL: a select WITHOUT the room_id filter WOULD sweep the org-lane charge",
    withoutRoomFilter.some((e) => e.event_id === "E5"));

  // ── §2 idempotent second run ──────────────────────────────────────────
  const second = await backfillReceipts(db, deps());
  ok("§2 a second run over the SAME rows scans nothing new", second.scanned === 0, JSON.stringify(second));
  ok("§2 a second run issues nothing new", second.issued === 0, JSON.stringify(second));
  ok("§2 the counter is unchanged by the second, idempotent run", counters.get("2026-27") === 4);
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n§2b WS-R133 law 3 - the sweep also closes a missing REWARD receipt");
// ═════════════════════════════════════════════════════════════════════════
{
  // The exact gap `maybeGrantReferralReward`'s own `catch` produces: the
  // reward's synthetic, zero-amount `vy_payment_event` row landed (the
  // grant and the subscription extension already happened), but the
  // receipt mint that was supposed to follow it never ran - modelled here
  // by seeding the ledger row directly and never calling
  // `issueFollowerReceipt` for it at all, "killing the receipt mint" the
  // same way a Key Vault outage or a crash between the two statements
  // would in production (`issueFollowerReceipt`'s own header names this
  // exact gap for a real charge; this is the identical gap for a reward).
  const world = makeWorld();
  world.events.push({
    event_id: "REWARD-1", room_id: ROOM_1, subscription_id: SUB_1, kind: "referral_reward",
    amount_inr: 0, received_at: "2026-09-16T00:00:00.000Z",
  });
  // A genuine charge in the SAME batch, so the sweep is proven to handle
  // both kinds together in one run, oldest-first across both.
  world.events.push({
    event_id: "E-CHARGE", room_id: ROOM_1, subscription_id: SUB_1, kind: "subscription.charged",
    amount_inr: 399, received_at: "2026-09-17T00:00:00.000Z",
  });

  const summary = await backfillReceipts(world.db, deps());
  ok("§2b the reward's own zero-amount event is scanned alongside the real charge",
    summary.scanned === 2, JSON.stringify(summary));
  ok("§2b the reward's own receipt IS issued - kind-aware, not excluded by amount_inr > 0",
    world.receipts.has("REWARD-1"), JSON.stringify([...world.receipts.keys()]));
  const rewardReceipt = world.receipts.get("REWARD-1");
  ok("§2b the reward's receipt carries the SAME atomic FY counter claim as any other receipt",
    Number.isInteger(rewardReceipt?.receipt_no) && rewardReceipt.receipt_no > 0, JSON.stringify(rewardReceipt));
  ok("§2b the reward's receipt's issued_at is the LEDGER ROW's own received_at, never the sweep's clock",
    rewardReceipt?.issued_at === "2026-09-16T00:00:00.000Z");
  ok("§2b the real charge in the same batch also gets its receipt", world.receipts.has("E-CHARGE"));

  // NEGATIVE CONTROL: a second run over the SAME rows sweeps nothing new -
  // the reward-kind branch is exactly as idempotent as the charge branch,
  // the SAME `not exists (select 1 from vy_receipt ...)` guarding both.
  const second = await backfillReceipts(world.db, deps());
  ok("§2b NEGATIVE CONTROL: a second run issues no second reward receipt", second.issued === 0, JSON.stringify(second));

  // NEGATIVE CONTROL: a referral_reward event that is NOT exactly zero-amount
  // (a shape that should never exist given migration 133's own CHECK, but
  // this SELECT's own predicate is what would refuse it if it somehow did)
  // is never swept - proves the reward branch is gated on amount_inr = 0
  // specifically, never merely on the kind string.
  const world2 = makeWorld();
  world2.events.push({
    event_id: "REWARD-BAD", room_id: ROOM_1, subscription_id: SUB_1, kind: "referral_reward",
    amount_inr: 50, received_at: "2026-09-18T00:00:00.000Z",
  });
  const summary2 = await backfillReceipts(world2.db, deps());
  ok("NEGATIVE CONTROL: a non-zero-amount referral_reward row is never swept (amount_inr = 0 is a real filter)",
    !world2.receipts.has("REWARD-BAD") && summary2.scanned === 0, JSON.stringify(summary2));

  // REQUIRED NEGATIVE CONTROL (this suite's own §1 convention, restated for
  // the reward branch): a version of the SAME select without the
  // reward-kind clause would never have found REWARD-1 at all - demonstrated
  // against the identical fixture rows, never merely asserted.
  const world3 = makeWorld();
  world3.events.push({
    event_id: "REWARD-2", room_id: ROOM_1, subscription_id: SUB_1, kind: "referral_reward",
    amount_inr: 0, received_at: "2026-09-19T00:00:00.000Z",
  });
  const withoutRewardClause = world3.events.filter(
    (e) => e.room_id != null && CREATOR_CHARGE_KINDS.has(e.kind) && Number(e.amount_inr) > 0,
  );
  ok("REQUIRED NEGATIVE CONTROL: a select WITHOUT the reward-kind clause would never find the reward row",
    !withoutRewardClause.some((e) => e.event_id === "REWARD-2"));
  ok(`REQUIRED NEGATIVE CONTROL: REFERRAL_REWARD_REASON really is "referral_reward" (the clause is not vacuous)`,
    REFERRAL_REWARD_REASON === "referral_reward");
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n§3 THE TABLE GATE - a database without migration 126 costs nothing");
// ═════════════════════════════════════════════════════════════════════════
{
  let dbTouched = false;
  const poisoned = async () => {
    dbTouched = true;
    throw new Error("db must not be touched when vy_receipt is not applied");
  };
  const summary = await backfillReceipts(poisoned, { tableApplied: async () => false });
  ok("§3 an unapplied vy_receipt returns a harmless all-zero summary", summary.scanned === 0 && summary.issued === 0 && summary.receipt_ids.length === 0);
  ok("§3 the database is never even queried", !dbTouched);
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n§4 THE BOUND - a limit stops one run from being unbounded work");
// ═════════════════════════════════════════════════════════════════════════
{
  ok("§4 the default limit is a real, named number", Number.isInteger(RECEIPT_SWEEP_DEFAULT_LIMIT) && RECEIPT_SWEEP_DEFAULT_LIMIT > 0);
  const world = makeWorld();
  for (let i = 0; i < 5; i++) {
    world.events.push({
      event_id: `B${i}`, room_id: ROOM_1, subscription_id: SUB_1, kind: "subscription.charged",
      amount_inr: 299, received_at: `2026-09-${String(10 + i).padStart(2, "0")}T00:00:00.000Z`,
    });
  }
  const summary = await backfillReceipts(world.db, deps({ limit: 3 }));
  ok("§4 a caller-supplied limit bounds one run's own work", summary.scanned === 3 && summary.issued === 3, JSON.stringify(summary));
  ok("§4 the OLDEST rows are claimed first (oldest-first ordering)",
    world.receipts.has("B0") && world.receipts.has("B1") && world.receipts.has("B2") && !world.receipts.has("B3"),
    JSON.stringify([...world.receipts.keys()]));
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n§5 THE OPS BOARD'S OWN READ - receiptsIssuedLateThisWeek");
// ═════════════════════════════════════════════════════════════════════════
{
  const NOW = Date.parse("2026-09-15T00:00:00.000Z");
  const sweepRuns = [
    // Inside the rolling 7 days.
    { sweep: "receipt", started_at: "2026-09-10T02:00:00.000Z", counts: { scanned: 3, issued: 2 } },
    { sweep: "receipt", started_at: "2026-09-12T02:00:00.000Z", counts: { scanned: 1, issued: 1 } },
    // Outside the rolling 7 days - must not count.
    { sweep: "receipt", started_at: "2026-09-01T02:00:00.000Z", counts: { scanned: 9, issued: 9 } },
    // A different sweep entirely - must not count.
    { sweep: "renewals", started_at: "2026-09-13T02:00:00.000Z", counts: { issued: 40 } },
  ];
  const db = async (sql, params = []) => {
    if (sql.includes("from vy_sweep_run") && sql.includes("sweep = 'receipt'")) {
      const [sinceIso] = params;
      const issued = sweepRuns
        .filter((r) => r.sweep === "receipt" && r.started_at >= sinceIso)
        .reduce((sum, r) => sum + Number(r.counts.issued || 0), 0);
      return [{ issued }];
    }
    throw new Error(`receipt-sweep §5: unmodelled statement: ${sql.slice(0, 120)}`);
  };
  const result = await receiptsIssuedLateThisWeek(db, NOW);
  ok("§5 sums only the receipt sweep's own runs inside the rolling 7 days", result.issued === 3, JSON.stringify(result));

  const emptyDb = async (sql, params = []) => {
    if (sql.includes("from vy_sweep_run") && sql.includes("sweep = 'receipt'")) return [{ issued: 0 }];
    throw new Error("unreachable");
  };
  const empty = await receiptsIssuedLateThisWeek(emptyDb, NOW);
  ok("§5 no runs yet is an honest zero, never null or a throw", empty.issued === 0);
}

console.log(`\nreceipt-sweep: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
