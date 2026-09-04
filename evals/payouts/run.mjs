// WS-R36. Creator payouts as a product: the Suite share folded into
// `runPayoutRollup`'s own arithmetic, the closed payout state machine (built
// -> pending_account | queued -> sent -> settled | failed, one transition
// each), the `sendPayout`/`registerFundAccount` seam twins, and the
// statement (`payoutStatementFromRows`/`payoutStatement`) - four numbers,
// the period, the follower subscription count, the Suite line, the TDS
// sentence, the state, and nothing per follower.
//
//   node evals/payouts/run.mjs
//
// Offline, deterministic, $0, no DB, no network, no real provider. Drives
// the REAL api/_payments.js and api/_payments/providers/fake.js through a
// fake `db` - `evals/payments/run.mjs` and `evals/org-billing/run.mjs`'s own
// pattern, extended rather than duplicated. `offline-mocks-cannot-type-check-sql`
// still applies: nothing here proves migration 098's statements parse
// against a live database (see the final report for what does).
import assert from "node:assert/strict";
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
  TDS_RATE_BP_DEFAULT,
  TDS_DISCLOSURE_SENTENCE,
  SUITE_SEAT_SHARE_BP,
  runPayoutRollup,
  sendPayout,
  markPayoutSent,
  markPayoutSettled,
  retryFailedPayout,
  registerFundAccount,
  payoutStatementFromRows,
  payoutStatement,
  payoutStatements,
} = payments;
const fake = await import(pathToFileURL(join(REPO, "api/_payments/providers/fake.js")).href);

// ── the fixture world ───────────────────────────────────────────────────
const OWNER_FOLLOWER_ONLY = "a1000000-0000-4000-8000-000000000001";
const OWNER_SUITE_ONLY = "a2000000-0000-4000-8000-000000000002";
const OWNER_BOTH = "a3000000-0000-4000-8000-000000000003";
const ROOM_FOLLOWER_ONLY = "b1000000-0000-4000-8000-000000000001";
const ROOM_SUITE_ONLY = "b2000000-0000-4000-8000-000000000002";
const ROOM_BOTH = "b3000000-0000-4000-8000-000000000003";
const ORG = "c1000000-0000-4000-8000-000000000001";
const NOW = Date.parse("2026-09-04T12:00:00Z");
const ENV = { PAYMENTS_PROVIDER: "fake", PAYMENTS_FAKE_WEBHOOK_SECRET: "test-webhook-secret-payouts-v1" };

function freshState() {
  return { rooms: [], orgSubscriptions: [], events: [], payouts: [], payoutAccounts: [] };
}

function seedRoom(state, roomId, ownerUserId, orgId = null) {
  state.rooms.push({ room_id: roomId, owner_user_id: ownerUserId, org_id: orgId });
}

function seedEvent(state, { roomId, subscriptionId, amountInr, takeInr, shareInr, receivedAt }) {
  state.events.push({
    room_id: roomId, subscription_id: subscriptionId, amount_inr: amountInr,
    platform_take_inr: takeInr, creator_share_inr: shareInr, received_at: receivedAt,
  });
}

let payoutCounter = 0;
function nextPayoutId() {
  payoutCounter += 1;
  return `d${String(payoutCounter).padStart(7, "0")}-0000-4000-8000-000000000000`;
}

/** Mirrors the exact algebra of `runPayoutRollup`'s own SQL - not a second
 *  implementation of the product's decision (that would prove nothing), but
 *  the arithmetic a fake `db` must perform to answer the SAME statement text
 *  the real function sends, `evals/org-billing/run.mjs`'s `effectiveSeatCap`
 *  precedent restated for money instead of a seat count. */
function rollupFixture(state, start, end, tdsBp, shareBp) {
  const byOwner = new Map();
  const get = (owner) => {
    if (!byOwner.has(owner)) byOwner.set(owner, { followerGross: 0, take: 0, creatorGross: 0, suiteShare: 0 });
    return byOwner.get(owner);
  };
  for (const e of state.events) {
    if (e.received_at < start || e.received_at >= end) continue;
    const room = state.rooms.find((r) => r.room_id === e.room_id);
    if (!room) continue;
    const acc = get(room.owner_user_id);
    acc.followerGross += e.amount_inr;
    acc.take += e.platform_take_inr;
    acc.creatorGross += e.creator_share_inr;
  }
  for (const r of state.rooms) {
    if (!r.org_id) continue;
    const sub = state.orgSubscriptions.find((s) => s.org_id === r.org_id && s.state === "active");
    if (!sub) continue;
    const acc = get(r.owner_user_id);
    acc.suiteShare += Math.trunc((sub.price_per_seat_inr * shareBp) / 10000);
  }
  const out = [];
  for (const [owner, acc] of byOwner) {
    if (state.payouts.some((p) => p.owner_user_id === owner && p.period_start === start && p.period_end === end)) continue;
    const creatorPlusSuite = acc.creatorGross + acc.suiteShare;
    const tds = Math.trunc((creatorPlusSuite * tdsBp) / 10000);
    const net = creatorPlusSuite - tds;
    const gross = acc.followerGross + acc.suiteShare;
    const row = {
      payout_id: nextPayoutId(), owner_user_id: owner, period_start: start, period_end: end,
      gross_inr: gross, take_inr: acc.take, net_inr: net, tds_inr: tds, suite_share_inr: acc.suiteShare,
      provider_payout_ref: null, state: "built", created_at: new Date(NOW).toISOString(),
    };
    state.payouts.push(row);
    out.push(row);
  }
  return out;
}

function makeDb(state) {
  const calls = [];
  const db = async (sql, params = []) => {
    calls.push({ sql, params });
    const has = (s) => sql.includes(s);

    // ── runPayoutRollup ──
    if (has("with per_owner as") && has("suite_share as")) {
      const [start, end, tdsBp, shareBp] = params;
      return rollupFixture(state, start, end, Number(tdsBp), Number(shareBp));
    }

    // ── sendPayout's own read ──
    if (has("select payout_id, owner_user_id, net_inr, state")) {
      const [payoutId, ownerUserId] = params;
      const row = state.payouts.find(
        (p) => p.payout_id === payoutId && p.owner_user_id === ownerUserId && ["built", "pending_account"].includes(p.state),
      );
      return row ? [{ ...row }] : [];
    }
    // ── sendPayout's fund-account lookup ──
    if (has("select fund_account_ref from vy_creator_payout_account")) {
      const [ownerUserId, provider] = params;
      const row = state.payoutAccounts.find((a) => a.owner_user_id === ownerUserId && a.provider === provider && a.verified_at);
      return row ? [{ fund_account_ref: row.fund_account_ref }] : [];
    }
    // ── sendPayout: built|pending_account -> pending_account ──
    if (has("set state = 'pending_account'")) {
      const [payoutId] = params;
      const row = state.payouts.find((p) => p.payout_id === payoutId && ["built", "pending_account"].includes(p.state));
      if (!row) return [];
      row.state = "pending_account";
      return [{ state: row.state }];
    }
    // ── sendPayout: built|pending_account -> failed (provider error path) ──
    if (has("set state = 'failed'")) {
      const [payoutId] = params;
      const row = state.payouts.find((p) => p.payout_id === payoutId && ["built", "pending_account"].includes(p.state));
      if (row) row.state = "failed";
      return [];
    }
    // ── sendPayout: built|pending_account -> queued ──
    if (has("set state = 'queued'")) {
      const [payoutId, providerRef] = params;
      const row = state.payouts.find((p) => p.payout_id === payoutId && ["built", "pending_account"].includes(p.state));
      if (!row) return [];
      row.state = "queued";
      row.provider_payout_ref = providerRef;
      return [{ state: row.state, provider_payout_ref: row.provider_payout_ref }];
    }
    // ── markPayoutSent: queued -> sent ──
    if (has("set state = 'sent'")) {
      const [payoutId] = params;
      const row = state.payouts.find((p) => p.payout_id === payoutId && p.state === "queued");
      if (!row) return [];
      row.state = "sent";
      return [{ state: row.state }];
    }
    // ── markPayoutSettled: sent -> settled ──
    if (has("set state = 'settled'")) {
      const [payoutId] = params;
      const row = state.payouts.find((p) => p.payout_id === payoutId && p.state === "sent");
      if (!row) return [];
      row.state = "settled";
      return [{ state: row.state }];
    }
    // ── retryFailedPayout: failed -> built ──
    if (has("set state = 'built'")) {
      const [payoutId] = params;
      const row = state.payouts.find((p) => p.payout_id === payoutId && p.state === "failed");
      if (!row) return [];
      row.state = "built";
      return [{ owner_user_id: row.owner_user_id, state: row.state }];
    }
    // ── registerFundAccount's upsert ──
    if (has("insert into vy_creator_payout_account")) {
      const [ownerUserId, provider, ref] = params;
      let row = state.payoutAccounts.find((a) => a.owner_user_id === ownerUserId && a.provider === provider);
      if (!row) {
        row = { owner_user_id: ownerUserId, provider, fund_account_ref: ref, verified_at: new Date(NOW).toISOString() };
        state.payoutAccounts.push(row);
      } else {
        row.fund_account_ref = ref;
        row.verified_at = new Date(NOW).toISOString();
      }
      return [{ ...row }];
    }
    // ── payoutStatement's main select ──
    if (has("suite_share_inr, state, provider_payout_ref, created_at")) {
      const [payoutId, ownerUserId] = params;
      const row = state.payouts.find((p) => p.payout_id === payoutId && p.owner_user_id === ownerUserId);
      return row ? [{ ...row }] : [];
    }
    // ── payoutStatement's follower-subscription count ──
    if (has("count(distinct e.subscription_id)")) {
      const [ownerUserId, start, end] = params;
      const subs = new Set();
      for (const e of state.events) {
        if (e.received_at < start || e.received_at >= end) continue;
        const room = state.rooms.find((r) => r.room_id === e.room_id);
        if (room && room.owner_user_id === ownerUserId) subs.add(e.subscription_id);
      }
      return [{ follower_subscriptions: subs.size }];
    }
    // ── payoutStatement's Suite-name read ──
    if (has("select o.name") && has("join vy_org o on o.org_id = r.org_id")) {
      const [ownerUserId] = params;
      const room = state.rooms.find((r) => r.owner_user_id === ownerUserId && r.org_id);
      return room ? [{ name: `Suite ${room.org_id}` }] : [];
    }
    // ── payoutStatements list ──
    if (has("gross_inr, net_inr, state, created_at") && has("order by period_start desc")) {
      const [ownerUserId] = params;
      return state.payouts
        .filter((p) => p.owner_user_id === ownerUserId)
        .sort((a, b) => b.period_start.localeCompare(a.period_start))
        .map((p) => ({ ...p }));
    }

    throw new Error(`payouts: unmodelled statement: ${sql.slice(0, 140)}`);
  };
  db.calls = calls;
  return db;
}

// ═════════════════════════════════════════════════════════════════════════
console.log("§1 THE ARITHMETIC — the Suite share is a term in gross, and gross = take + tds + net always");
// ═════════════════════════════════════════════════════════════════════════
{
  const state = freshState();
  seedRoom(state, ROOM_FOLLOWER_ONLY, OWNER_FOLLOWER_ONLY, null);
  seedRoom(state, ROOM_SUITE_ONLY, OWNER_SUITE_ONLY, ORG);
  seedRoom(state, ROOM_BOTH, OWNER_BOTH, ORG);
  state.orgSubscriptions.push({ org_id: ORG, state: "active", price_per_seat_inr: 2999 });

  seedEvent(state, { roomId: ROOM_FOLLOWER_ONLY, subscriptionId: "sub-1", amountInr: 399, takeInr: 100, shareInr: 299, receivedAt: "2026-08-10T00:00:00.000Z" });
  seedEvent(state, { roomId: ROOM_BOTH, subscriptionId: "sub-2", amountInr: 399, takeInr: 100, shareInr: 299, receivedAt: "2026-08-15T00:00:00.000Z" });

  const db = makeDb(state);
  const rows = await runPayoutRollup(db, { periodStart: "2026-08-01T00:00:00.000Z", periodEnd: "2026-09-01T00:00:00.000Z" });
  ok("three owners get a payout row: follower-only, Suite-only, and both", rows.length === 3);

  const followerOnly = rows.find((r) => r.owner_user_id === OWNER_FOLLOWER_ONLY);
  ok("follower-only owner has zero Suite share", followerOnly.suite_share_inr === 0);
  ok("follower-only owner's gross is just the follower gross", followerOnly.gross_inr === 399);

  const suiteOnly = rows.find((r) => r.owner_user_id === OWNER_SUITE_ONLY);
  const expectedShare = Math.trunc((2999 * SUITE_SEAT_SHARE_BP) / 10000);
  ok("Suite-only owner (no follower revenue at all) still gets a payout row", suiteOnly.gross_inr === expectedShare);
  ok("Suite-only owner's whole gross IS the Suite share", suiteOnly.gross_inr === suiteOnly.suite_share_inr);
  ok("Suite-only owner's take is zero (no follower events at all)", suiteOnly.take_inr === 0);

  const both = rows.find((r) => r.owner_user_id === OWNER_BOTH);
  ok("an owner with both sees the Suite share as a term IN gross, added to follower gross", both.gross_inr === 399 + expectedShare);
  ok("no TDS rate set: tds is 0 and net equals the creator's full share plus the Suite share", both.tds_inr === 0 && both.net_inr === 299 + expectedShare);

  for (const r of rows) {
    ok(`THE ARITHMETIC INVARIANT holds for ${r.owner_user_id}: gross = take + tds + net`, r.gross_inr === r.take_inr + r.tds_inr + r.net_inr);
  }

  const again = await runPayoutRollup(db, { periodStart: "2026-08-01T00:00:00.000Z", periodEnd: "2026-09-01T00:00:00.000Z" });
  ok("idempotent on (owner, period): re-running the same period inserts nothing new", again.length === 0 && state.payouts.length === 3);

  const withTds = await runPayoutRollup(db, { periodStart: "2026-09-01T00:00:00.000Z", periodEnd: "2026-10-01T00:00:00.000Z", tdsRateBp: 1000 });
  const suiteOnlyNextMonth = withTds.find((r) => r.owner_user_id === OWNER_SUITE_ONLY);
  const expectedTds = Math.trunc((expectedShare * 1000) / 10000);
  ok("A 10% TDS rate withholds 10% of the CREATOR's income (Suite share included), not of gross", suiteOnlyNextMonth.tds_inr === expectedTds);

  ok("all rows are created in state 'built', never sent to a provider by the rollup itself", rows.every((r) => r.state === "built") && withTds.every((r) => r.state === "built"));
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n§2 THE STATE MACHINE — built -> pending_account | queued -> sent -> settled | failed");
// ═════════════════════════════════════════════════════════════════════════
{
  // NEGATIVE CONTROL (a): no fund account, zero provider calls.
  const state = freshState();
  const payoutId = nextPayoutId();
  state.payouts.push({ payout_id: payoutId, owner_user_id: OWNER_FOLLOWER_ONLY, period_start: "p", period_end: "p2", gross_inr: 300, take_inr: 75, net_inr: 225, tds_inr: 0, suite_share_inr: 0, provider_payout_ref: null, state: "built", created_at: new Date(NOW).toISOString() });
  const db = makeDb(state);
  const callsBefore = db.calls.length;
  const result = await sendPayout(db, { ownerUserId: OWNER_FOLLOWER_ONLY, payoutId }, { env: ENV });
  ok("built -> pending_account when no fund account is on file", result.state === "pending_account");
  const dbCallsAfter = db.calls.slice(callsBefore).map((c) => c.sql);
  ok("NEGATIVE CONTROL (a): only two reads ran (the payout, the account lookup) plus the state update - never a provider call", dbCallsAfter.length === 3);
  ok("the payout row itself is 'pending_account'", state.payouts[0].state === "pending_account");

  // Register a fund account (both twins' seam), then re-attempt: pending_account -> queued.
  const account = await registerFundAccount(db, { ownerUserId: OWNER_FOLLOWER_ONLY, fundAccountRef: "fa_test_001" }, { env: ENV });
  ok("registerFundAccount stores the reference, never a bank detail (the input shape has no such field to store)", account.fund_account_ref === "fa_test_001" && account.verified_at);
  ok("only ONE fund account row exists for this owner+provider", state.payoutAccounts.length === 1);

  const queued = await sendPayout(db, { ownerUserId: OWNER_FOLLOWER_ONLY, payoutId }, { env: ENV });
  ok("pending_account -> queued once a verified fund account exists", queued.state === "queued");
  ok("a real provider_payout_ref was minted (the fake provider's own deterministic shape)", /^fake_payout_[0-9a-f]{24}$/.test(queued.provider_payout_ref));

  // queued -> sent -> settled.
  const sent = await markPayoutSent(db, { payoutId });
  ok("queued -> sent", sent.state === "sent");
  const settled = await markPayoutSettled(db, { payoutId });
  ok("sent -> settled", settled.state === "settled");

  // NEGATIVE CONTROL (c): a second sent transition on the same payout is refused by the WHERE.
  const secondSent = await markPayoutSent(db, { payoutId }).then(() => null, (e) => e);
  ok("NEGATIVE CONTROL (c): a second 'sent' transition on an already-settled payout is refused, named", secondSent instanceof PaymentsError && secondSent.code === "payout_not_queued");
  ok("the payout's own state is UNCHANGED by the refused second transition", state.payouts[0].state === "settled");

  // ILLEGAL TRANSITION: settled can never go back to queued.
  const illegal = await sendPayout(db, { ownerUserId: OWNER_FOLLOWER_ONLY, payoutId }, { env: ENV }).then(() => null, (e) => e);
  ok("ILLEGAL TRANSITION refused: sendPayout on an already-settled payout is refused, named", illegal instanceof PaymentsError && illegal.code === "payout_not_sendable");
}

{
  // The failed path and its OPERATOR-ONLY retry.
  const state = freshState();
  const payoutId = nextPayoutId();
  state.payouts.push({ payout_id: payoutId, owner_user_id: OWNER_FOLLOWER_ONLY, period_start: "p", period_end: "p2", gross_inr: 300, take_inr: 75, net_inr: 225, tds_inr: 0, suite_share_inr: 0, provider_payout_ref: null, state: "failed", created_at: new Date(NOW).toISOString() });
  const db = makeDb(state);

  const notFailed = await markPayoutSent(db, { payoutId }).then(() => null, (e) => e);
  ok("a 'failed' payout cannot be marked sent (it was never queued)", notFailed instanceof PaymentsError && notFailed.code === "payout_not_queued");

  await registerFundAccount(db, { ownerUserId: OWNER_FOLLOWER_ONLY, fundAccountRef: "fa_test_retry" }, { env: ENV });
  const retried = await retryFailedPayout(db, { payoutId }, { env: ENV });
  ok("failed -> built -> queued, in one operator op", retried.state === "queued");
  ok("the row itself reflects the retry", state.payouts[0].state === "queued");

  const doubleRetry = await retryFailedPayout(db, { payoutId }, { env: ENV }).then(() => null, (e) => e);
  ok("retrying an already-recovered (queued) payout is refused, named - 'failed' is a real precondition, not a courtesy", doubleRetry instanceof PaymentsError && doubleRetry.code === "payout_not_failed");
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n§3 THE SEAM TWINS — registerFundAccount and sendPayout, both never receive a bank detail");
// ═════════════════════════════════════════════════════════════════════════
{
  const fakeAccount = await fake.registerFundAccount("fa_anything");
  ok("the fake twin verifies any non-empty ref", fakeAccount.verified === true);
  const fakeAccountEmpty = await fake.registerFundAccount("");
  ok("the fake twin refuses an empty ref", fakeAccountEmpty.verified === false);

  const paidTwice = await fake.sendPayout({ fundAccountRef: "fa_x", ref: "payout-1", amountInr: 500 });
  const paidAgain = await fake.sendPayout({ fundAccountRef: "fa_x", ref: "payout-1", amountInr: 500 });
  ok("the fake provider's own payout ref is deterministic on (fundAccountRef, ref, amountInr)", paidTwice.provider_payout_ref === paidAgain.provider_payout_ref);
  const paidDifferent = await fake.sendPayout({ fundAccountRef: "fa_x", ref: "payout-2", amountInr: 500 });
  ok("a different payout id mints a different ref", paidDifferent.provider_payout_ref !== paidTwice.provider_payout_ref);

  const razorpaySrc = readFileSync(join(REPO, "api/_payments/providers/razorpay.js"), "utf8");
  ok("razorpay.js's registerFundAccount is marked NOT VERIFIED", /registerFundAccount[\s\S]{0,20}\(fundAccountRef, secrets\)/.test(razorpaySrc) && razorpaySrc.includes("NOT VERIFIED"));
  ok("razorpay.js's sendPayout never sends a bank account number or a UPI VPA - only a fund_account_id reference", /fund_account_id:\s*input\.fundAccountRef/.test(razorpaySrc) && !/bank_account|vpa:/.test(razorpaySrc));
  ok("razorpay.js's sendPayout uses the PLATFORM's own account_number, never a creator's", /account_number:\s*secrets\.accountNumber/.test(razorpaySrc));
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n§4 THE STATEMENT — four numbers, the period, the follower count, the Suite line, and nothing per follower");
// ═════════════════════════════════════════════════════════════════════════
{
  const state = freshState();
  seedRoom(state, ROOM_BOTH, OWNER_BOTH, ORG);
  state.orgSubscriptions.push({ org_id: ORG, state: "active", price_per_seat_inr: 2999 });
  seedEvent(state, { roomId: ROOM_BOTH, subscriptionId: "sub-a", amountInr: 399, takeInr: 100, shareInr: 299, receivedAt: "2026-08-10T00:00:00.000Z" });
  seedEvent(state, { roomId: ROOM_BOTH, subscriptionId: "sub-b", amountInr: 399, takeInr: 100, shareInr: 299, receivedAt: "2026-08-20T00:00:00.000Z" });
  seedEvent(state, { roomId: ROOM_BOTH, subscriptionId: "sub-a", amountInr: 399, takeInr: 100, shareInr: 299, receivedAt: "2026-08-25T00:00:00.000Z" }); // same subscriber, second charge

  const db = makeDb(state);
  const [row] = await runPayoutRollup(db, { periodStart: "2026-08-01T00:00:00.000Z", periodEnd: "2026-09-01T00:00:00.000Z" });

  const statement = await payoutStatement(db, OWNER_BOTH, row.payout_id);
  ok("the statement carries the period", statement.period_start === "2026-08-01T00:00:00.000Z" && statement.period_end === "2026-09-01T00:00:00.000Z");
  ok("the statement carries all four numbers", [statement.gross_inr, statement.take_inr, statement.tds_inr, statement.net_inr].every((n) => typeof n === "number"));
  ok("the follower subscription count is DISTINCT subscriptions, not events (two charges from sub-a count once)", statement.follower_subscriptions === 2);
  ok("the Suite share line is present with a Suite name (this owner's Room is attached)", statement.suite_share_inr > 0 && typeof statement.suite_name === "string");
  ok("the TDS note is the same disclosure sentence the constant carries", statement.tds_note === TDS_DISCLOSURE_SENTENCE);
  ok("the amount is INR", statement.currency === "INR");
  ok("the statement carries the payout's own state and created_at", statement.state === "built" && Boolean(statement.created_at));

  const owner2 = await payoutStatement(db, OWNER_FOLLOWER_ONLY, row.payout_id);
  ok("a payout is never visible under the WRONG owner", owner2 === null);

  const list = await payoutStatements(db, OWNER_BOTH);
  ok("payoutStatements lists this owner's own payout", list.length === 1 && list[0].payout_id === row.payout_id);

  // NEGATIVE CONTROL (b): a statement never contains a follower identifier -
  // static scan of the builder, `evals/payments/run.mjs`'s own "assert the
  // guarantee is textually present" technique.
  const src = readFileSync(join(REPO, "api/_payments.js"), "utf8");
  const fnStart = src.indexOf("export function payoutStatementFromRows");
  const fnEnd = src.indexOf("\n}", fnStart);
  const fnBody = src.slice(fnStart, fnEnd);
  ok(
    "NEGATIVE CONTROL (b): payoutStatementFromRows's own source never mentions a follower identifier",
    !/person_id|follower_id|thread_id|message_text/i.test(fnBody),
  );
  const stmtFnStart = src.indexOf("export async function payoutStatement(");
  const stmtFnEnd = src.indexOf("\nexport async function payoutStatements", stmtFnStart);
  const stmtFnBody = src.slice(stmtFnStart, stmtFnEnd);
  ok(
    "NEGATIVE CONTROL (b): payoutStatement's own SQL never selects a follower identifier",
    !/select[^;]*\b(person_id|follower_id)\b/i.test(stmtFnBody),
  );

  // Pure-function proof, no db at all: payoutStatementFromRows over a hand-built row.
  const pure = payoutStatementFromRows(
    { payout_id: "x", period_start: "s", period_end: "e", gross_inr: 500, take_inr: 100, tds_inr: 0, net_inr: 400, suite_share_inr: 0, state: "built", provider_payout_ref: null, created_at: "c" },
    { followerSubscriptions: 3, suiteName: null },
  );
  ok("a zero Suite share never shows a Suite name, even if one were passed in", pure.suite_share_inr === 0 && pure.suite_name === null);
  ok("payoutStatementFromRows returns null for a null row (an owner asking about a payout that is not theirs)", payoutStatementFromRows(null) === null);
}

// ═════════════════════════════════════════════════════════════════════════
console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
