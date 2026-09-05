// WS-R33. Suite billing and the creator tier charge: the Suite's own money
// end to end through api/_payments.js's provider seam (`startOrgSubscription`,
// `updateOrgSeats`), the coalesced seat cap at the boundary (`api/_org.js`'s
// `attachRoom`, migration 095's law 3), the creator tier charge and its one
// caller for `seatCoversCreatorTier` (`startCreatorSubscription`, law 4), and
// the webhook's widened three-lane resolution (`applyWebhook`).
//
//   node evals/org-billing/run.mjs
//
// Offline, deterministic, $0, no DB, no network, no real provider. Drives the
// REAL api/_payments.js, api/_org.js and api/_payments/providers/fake.js
// through a fake `db` - `evals/payments/run.mjs` and `evals/org/run.mjs`'s
// own precedent, extended rather than duplicated: `now: NOW` is passed to
// every call, `evals/payments/run.mjs`'s own header explains why (a frozen
// session against the wall clock once expired the suite).
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
  startOrgSubscription,
  updateOrgSeats,
  startCreatorSubscription,
  applyWebhook,
} = payments;
const org = await import(pathToFileURL(join(REPO, "api/_org.js")).href);
const { OrgError, attachRoom, seatCoversCreatorTier } = org;
const fake = await import(pathToFileURL(join(REPO, "api/_payments/providers/fake.js")).href);

// ── the fixture world ───────────────────────────────────────────────────
const ADMIN = "a0000000-0000-4000-8000-00000000000a";
const CREATOR = "c0000000-0000-4000-8000-00000000000c";
const ORG = "e0000000-0000-4000-8000-00000000000e";
const REPLICA_PREFIX = "c1000000-0000-4000-8000-";
const ROOM_PREFIX = "d1000000-0000-4000-8000-";
const SESSION_SECRET = "x".repeat(48);
const WEBHOOK_SECRET = "test-webhook-secret-org-billing-v1";
const ENV = { ROOM_SESSION_SECRET: SESSION_SECRET, PAYMENTS_PROVIDER: "fake", PAYMENTS_FAKE_WEBHOOK_SECRET: WEBHOOK_SECRET };
const NOW = Date.parse("2026-09-04T12:00:00Z");

function freshState() {
  return {
    orgs: [],
    orgMembers: [],
    rooms: [],
    orgSubscriptions: [],
    creatorSubscriptions: [],
    paymentEvents: [],
  };
}

function seedOrg(state, { seatLimit = 1 } = {}) {
  state.orgs.push({ org_id: ORG, slug: "north-coaching", plan: "starter", seat_limit: seatLimit });
  state.orgMembers.push({ org_id: ORG, owner_user_id: ADMIN, role: "admin" });
}

function seedCreatorMember(state, ownerUserId) {
  state.orgMembers.push({ org_id: ORG, owner_user_id: ownerUserId, role: "creator" });
}

function makeRoom(n, ownerUserId) {
  const hex = String(n).padStart(12, "0");
  return { room_id: `${ROOM_PREFIX}${hex}`, replica_id: `${REPLICA_PREFIX}${hex}`, owner_user_id: ownerUserId, org_id: null };
}

// WS-R33's own mirror of api/_org.js's `seatCapSql`, kept in ONE place so
// every fixture handler below agrees with itself - not a second
// implementation of the product's own logic (that would prove nothing), but
// the arithmetic a fake `db` must perform to answer the SAME SQL text the
// real function sends, exactly as evals/org/run.mjs's own `effectiveSeatCap`
// does for the sibling suite.
function effectiveSeatCap(orgId, state) {
  const o = state.orgs.find((x) => x.org_id === orgId);
  if (!o) return null;
  const subs = state.orgSubscriptions.filter((s) => s.org_id === orgId).sort((a, b) => b.created_at.localeCompare(a.created_at));
  const latest = subs[0];
  if (latest) {
    if (latest.state === "active") return Number(latest.seats);
    if (["paused", "cancelled", "expired"].includes(latest.state)) return 0;
  }
  return Number(o.seat_limit);
}

let subCounter = 0;
function nextSubId(prefix) {
  subCounter += 1;
  return `${prefix}${String(subCounter).padStart(8, "0")}-0000-4000-8000-000000000000`;
}

function makeDb(state) {
  const calls = [];
  const db = async (sql, params = []) => {
    calls.push({ sql, params });
    const has = (s) => sql.includes(s);

    // ── orgAdminOrThrow ──
    if (has("select o.org_id, o.slug, o.plan, o.seat_limit")) {
      const [orgId, adminId] = params;
      const isAdmin = state.orgMembers.some((m) => m.org_id === orgId && m.owner_user_id === adminId && m.role === "admin");
      if (!isAdmin) return [];
      const o = state.orgs.find((x) => x.org_id === orgId);
      return o ? [{ org_id: o.org_id, slug: o.slug, plan: o.plan, seat_limit: o.seat_limit }] : [];
    }

    // ── startOrgSubscription's existing-live lookup ──
    if (has("select subscription_id, provider_subscription_ref, state, seats")) {
      const [orgId] = params;
      const row = state.orgSubscriptions
        .filter((s) => s.org_id === orgId && ["created", "authenticated", "active", "paused"].includes(s.state))
        .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
      return row ? [{ ...row }] : [];
    }
    // ── startOrgSubscription's insert ──
    if (has("insert into vy_org_subscription")) {
      const [orgId, plan, seats, pricePerSeat, currency, provider] = params;
      const row = {
        subscription_id: nextSubId("f1"), org_id: orgId, plan, seats, price_per_seat_inr: pricePerSeat,
        currency, provider, provider_subscription_ref: null, state: "created",
        created_at: new Date(NOW + state.orgSubscriptions.length).toISOString(), updated_at: new Date(NOW).toISOString(),
      };
      state.orgSubscriptions.push(row);
      return [{ subscription_id: row.subscription_id, state: row.state }];
    }
    // ── startOrgSubscription's provider-ref update ──
    if (has("update vy_org_subscription") && has("set provider_subscription_ref")) {
      const [subId, ref] = params;
      const row = state.orgSubscriptions.find((s) => s.subscription_id === subId);
      if (!row) return [];
      row.provider_subscription_ref = ref;
      return [{ state: row.state, seats: row.seats }];
    }
    // ── updateOrgSeats's own lookup ──
    if (has("select subscription_id, provider, provider_subscription_ref, plan, price_per_seat_inr, currency, state")) {
      const [orgId] = params;
      const row = state.orgSubscriptions
        .filter((s) => s.org_id === orgId && ["created", "authenticated", "active", "paused"].includes(s.state))
        .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
      return row ? [{ ...row }] : [];
    }
    // ── updateOrgSeats's seats-used count ──
    if (has("select count(*)::int as seats_used from vy_room")) {
      const [orgId] = params;
      return [{ seats_used: state.rooms.filter((r) => r.org_id === orgId).length }];
    }
    // ── updateOrgSeats's own write ──
    if (has("update vy_org_subscription") && has("set seats =")) {
      const [subId, seats] = params;
      const row = state.orgSubscriptions.find((s) => s.subscription_id === subId);
      if (!row) return [];
      row.seats = seats;
      return [{ subscription_id: row.subscription_id, seats: row.seats, state: row.state }];
    }

    // WS-R51: startCreatorSubscription's own new ownership check
    // (api/_payments.js's `ownedReplicaHandle`, the door battery's own
    // class-c fix) - this suite never tests a mismatched owner/replica pair,
    // so every replica id it constructs from `REPLICA_PREFIX` for `CREATOR`
    // is admitted unconditionally, `evals/room-doors`'s own dedicated case
    // for the boundary.
    if (has("select replica_id from vy_replica where replica_id = $1::uuid and owner_user_id = $2::uuid")) {
      return [{ replica_id: params[0] }];
    }

    // ── seatCoversCreatorTier (api/_org.js) ──
    if (has("select exists (") && has("vy_org_subscription s on s.org_id = r.org_id")) {
      const [ownerId, replicaId] = params;
      const room = state.rooms.find((r) => r.owner_user_id === ownerId && r.replica_id === replicaId);
      const covered = Boolean(room?.org_id) && state.orgSubscriptions.some((s) => s.org_id === room.org_id && s.state === "active");
      return [{ covered }];
    }

    // ── startCreatorSubscription's existing-live lookup ──
    if (has("from vy_creator_subscription") && has("where replica_id = ($1)::uuid")) {
      const [replicaId] = params;
      const row = state.creatorSubscriptions
        .filter((s) => s.replica_id === replicaId && ["created", "authenticated", "active", "paused"].includes(s.state))
        .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
      return row ? [{ ...row }] : [];
    }
    // ── startCreatorSubscription's insert ──
    if (has("insert into vy_creator_subscription")) {
      const [ownerId, replicaId, plan, priceInr, currency, provider] = params;
      const row = {
        subscription_id: nextSubId("f2"), owner_user_id: ownerId, replica_id: replicaId, plan, price_inr: priceInr,
        currency, provider, provider_subscription_ref: null, state: "created",
        created_at: new Date(NOW + state.creatorSubscriptions.length).toISOString(), updated_at: new Date(NOW).toISOString(),
      };
      state.creatorSubscriptions.push(row);
      return [{ subscription_id: row.subscription_id, state: row.state }];
    }
    // ── startCreatorSubscription's provider-ref update ──
    if (has("update vy_creator_subscription") && has("set provider_subscription_ref")) {
      const [subId, ref] = params;
      const row = state.creatorSubscriptions.find((s) => s.subscription_id === subId);
      if (!row) return [];
      row.provider_subscription_ref = ref;
      return [{ state: row.state }];
    }

    // ── attachRoom's own UPDATE (checked before the diagnostic). WS-R48:
    //    also stamps org_attached_at in the same statement. ──
    if (has("update vy_room r") && has("set org_id = ($2)::uuid, org_attached_at = now(), updated_at = now()")) {
      const [roomId, orgId, adminId] = params;
      const room = state.rooms.find((r) => r.room_id === roomId);
      const o = state.orgs.find((x) => x.org_id === orgId);
      if (!room || !o || room.org_id) return [];
      const isAdmin = state.orgMembers.some((m) => m.org_id === orgId && m.owner_user_id === adminId && m.role === "admin");
      const creatorMember = state.orgMembers.some((m) => m.org_id === orgId && m.owner_user_id === room.owner_user_id && m.role === "creator");
      const seatsUsed = state.rooms.filter((r) => r.org_id === orgId).length;
      const cap = effectiveSeatCap(orgId, state);
      if (!isAdmin || !creatorMember || cap == null || seatsUsed >= cap) return [];
      room.org_id = orgId;
      room.org_attached_at = new Date().toISOString();
      return [{ room_id: room.room_id, org_id: room.org_id, slug: room.room_id }];
    }
    // ── attachRoom's diagnostic select ──
    if (has("is_admin") && has("creator_member") && has("seats_used")) {
      const [roomId, orgId, adminId] = params;
      const room = state.rooms.find((r) => r.room_id === roomId);
      const o = state.orgs.find((x) => x.org_id === orgId);
      return [{
        room_exists: room ? true : false,
        current_org_id: room ? room.org_id : null,
        is_admin: state.orgMembers.some((m) => m.org_id === orgId && m.owner_user_id === adminId && m.role === "admin"),
        creator_member: room ? state.orgMembers.some((m) => m.org_id === orgId && m.owner_user_id === room.owner_user_id && m.role === "creator") : false,
        seats_used: state.rooms.filter((r) => r.org_id === orgId).length,
        seat_limit: o ? effectiveSeatCap(orgId, state) : null,
      }];
    }

    // ── applyWebhook: follower ctx (never seeded in this suite) ──
    if (has("left join vy_room_price p on p.room_id = s.room_id")) return [];
    // ── applyWebhook: org ctx ──
    if (has("from vy_org_subscription where provider")) {
      const [provider, ref] = params;
      const row = state.orgSubscriptions.find((s) => s.provider === provider && s.provider_subscription_ref === ref);
      return row ? [{ subscription_id: row.subscription_id, org_id: row.org_id }] : [];
    }
    // ── applyWebhook: creator ctx ──
    if (has("from vy_creator_subscription where provider")) {
      const [provider, ref] = params;
      const row = state.creatorSubscriptions.find((s) => s.provider === provider && s.provider_subscription_ref === ref);
      return row ? [{ subscription_id: row.subscription_id }] : [];
    }
    // ── applyWebhook: the creator lane's plain state flip ──
    if (has("update vy_creator_subscription s") && has("set state = case")) {
      const [subId, nextState, periodStart, periodEnd] = params;
      const row = state.creatorSubscriptions.find((s) => s.subscription_id === subId);
      if (!row) return [];
      if (nextState !== "") row.state = nextState;
      if (periodStart) row.current_period_start = periodStart;
      if (periodEnd) row.current_period_end = periodEnd;
      return [{ subscription_id: row.subscription_id, state: row.state }];
    }
    // ── applyWebhook: the org lane's ledger write ──
    if (has("with candidate as") && has("insert into vy_payment_event") && has("org_subscription_id")) {
      const [provider, ref, orgId, orgSubscriptionId, kind, amountInr, payloadHash, nextState, periodStart, periodEnd] = params;
      const dup = state.paymentEvents.find((e) => e.provider === provider && e.provider_event_ref === ref);
      if (dup) return [];
      const event = {
        event_id: `pe${state.paymentEvents.length + 1}`, provider, provider_event_ref: ref, org_id: orgId,
        org_subscription_id: orgSubscriptionId, kind, amount_inr: amountInr, platform_take_inr: amountInr,
        creator_share_inr: 0, signature_verified: true, payload_hash: payloadHash,
        received_at: new Date(NOW + state.paymentEvents.length).toISOString(),
      };
      state.paymentEvents.push(event);
      const sub = state.orgSubscriptions.find((s) => s.subscription_id === orgSubscriptionId);
      if (sub && nextState !== "") sub.state = nextState;
      if (sub && periodStart) sub.current_period_start = periodStart;
      if (sub && periodEnd) sub.current_period_end = periodEnd;
      return [{ event_id: event.event_id, subscription_id: orgSubscriptionId, state: sub ? sub.state : null }];
    }

    throw new Error(`org-billing: unmodelled statement: ${sql.slice(0, 140)}`);
  };
  db.calls = calls;
  return db;
}

const RAZORPAY_EVENT = (kind, ref, amountPaise = 0) => JSON.stringify({
  event: kind,
  payload: {
    subscription: { entity: { id: ref, status: kind, current_start: 1690000000, current_end: 1692600000 } },
    payment: { entity: { id: "pay_1", amount: amountPaise, currency: "INR", status: "captured" } },
  },
});

// ═════════════════════════════════════════════════════════════════════════
console.log("§1 THE SEAM TWINS — org and creator subscriptions mint through the fake provider");
// ═════════════════════════════════════════════════════════════════════════
{
  const state = freshState();
  seedOrg(state, { seatLimit: 1 });
  const db = makeDb(state);

  const started = await startOrgSubscription(db, { ownerUserId: ADMIN, orgId: ORG, plan: "starter", seats: 3 }, { env: ENV });
  ok("startOrgSubscription mints a real subscription row", state.orgSubscriptions.length === 1);
  ok("the provider ref is the fake provider's deterministic id", /^fake_sub_[0-9a-f]{24}$/.test(started.provider_subscription_ref));
  ok("seats on the row match what was requested", started.seats === 3);

  const again = await startOrgSubscription(db, { ownerUserId: ADMIN, orgId: ORG, plan: "starter", seats: 3 }, { env: ENV });
  ok("idempotent on the org: the SAME ref, no second row", again.provider_subscription_ref === started.provider_subscription_ref && state.orgSubscriptions.length === 1);

  const notAdmin = await startOrgSubscription(db, { ownerUserId: CREATOR, orgId: ORG, plan: "starter", seats: 1 }, { env: ENV }).then(() => null, (e) => e);
  ok("a non-admin caller is refused, named", notAdmin instanceof PaymentsError && notAdmin.code === "org_not_found");

  const noneEnv = { ...ENV, PAYMENTS_PROVIDER: "none" };
  const state2 = freshState();
  seedOrg(state2, { seatLimit: 1 });
  const db2 = makeDb(state2);
  const refused = await startOrgSubscription(db2, { ownerUserId: ADMIN, orgId: ORG, plan: "starter", seats: 1 }, { env: noneEnv }).then(() => null, (e) => e);
  ok("PAYMENTS_PROVIDER=none refuses before any row is written", refused instanceof PaymentsError && refused.code === "payments_not_configured" && state2.orgSubscriptions.length === 0);
}

{
  const state = freshState();
  seedOrg(state, { seatLimit: 1 });
  const db = makeDb(state);
  const started = await startCreatorSubscription(db, { ownerUserId: CREATOR, replicaId: `${REPLICA_PREFIX}000000000099`, plan: "room" }, { env: ENV });
  ok("startCreatorSubscription mints a real subscription row", state.creatorSubscriptions.length === 1);
  ok("the provider ref is the fake provider's deterministic id", /^fake_sub_[0-9a-f]{24}$/.test(started.provider_subscription_ref));
  ok("the room plan's price is 4,999", state.creatorSubscriptions[0].price_inr === 4999);

  const studio = await startCreatorSubscription(db, { ownerUserId: CREATOR, replicaId: `${REPLICA_PREFIX}000000000098`, plan: "studio" }, { env: ENV });
  ok("the studio plan's price is 19,999", state.creatorSubscriptions.find((s) => s.subscription_id === studio.subscription_id).price_inr === 19999);

  const badPlan = await startCreatorSubscription(db, { ownerUserId: CREATOR, replicaId: `${REPLICA_PREFIX}000000000097`, plan: "institute" }, { env: ENV }).then(() => null, (e) => e);
  ok("'institute' has no self-serve price and is refused, named", badPlan instanceof PaymentsError && badPlan.code === "creator_tier_plan_invalid");
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n§2 THE COALESCED SEAT CAP — attachRoom reads it, never a static seat_limit alone");
// ═════════════════════════════════════════════════════════════════════════
{
  // An ACTIVE subscription RAISES the cap above the static seat_limit: 1.
  const state = freshState();
  seedOrg(state, { seatLimit: 1 });
  seedCreatorMember(state, CREATOR);
  state.orgSubscriptions.push({
    subscription_id: "sub-active-1", org_id: ORG, plan: "starter", seats: 3, price_per_seat_inr: 2999,
    currency: "INR", state: "active", provider: "fake", provider_subscription_ref: "fake_sub_active",
    created_at: "2026-09-04T00:00:00.000Z", updated_at: "2026-09-04T00:00:00.000Z",
  });
  const rooms = [makeRoom(1, CREATOR), makeRoom(2, CREATOR), makeRoom(3, CREATOR), makeRoom(4, CREATOR)];
  state.rooms.push(...rooms);
  const db = makeDb(state);

  await attachRoom(db, ADMIN, ORG, rooms[0].room_id);
  await attachRoom(db, ADMIN, ORG, rooms[1].room_id);
  const third = await attachRoom(db, ADMIN, ORG, rooms[2].room_id);
  ok("paid 3 seats, all three attach despite seat_limit's own static value of 1", third.org_id === ORG && state.rooms.filter((r) => r.org_id === ORG).length === 3);

  let refused = null;
  try { await attachRoom(db, ADMIN, ORG, rooms[3].room_id); } catch (e) { refused = e; }
  ok("attaching the 4th (paid 3) is refused by name at the exact boundary", refused instanceof OrgError && refused.code === "no_seat" && refused.details.seats_used === 3 && refused.details.seat_limit === 3);
  ok("the refused 4th room's org_id is still null", state.rooms.find((r) => r.room_id === rooms[3].room_id).org_id === null);
}

{
  // NEGATIVE CONTROL (b): a subscription in state 'created' (never
  // authenticated) does NOT raise the cap - it falls through to seat_limit
  // exactly as if no subscription existed.
  const state = freshState();
  seedOrg(state, { seatLimit: 1 });
  seedCreatorMember(state, CREATOR);
  state.orgSubscriptions.push({
    subscription_id: "sub-created-1", org_id: ORG, plan: "starter", seats: 5, price_per_seat_inr: 2999,
    currency: "INR", state: "created", provider: "fake", provider_subscription_ref: null,
    created_at: "2026-09-04T00:00:00.000Z", updated_at: "2026-09-04T00:00:00.000Z",
  });
  const rooms = [makeRoom(11, CREATOR), makeRoom(12, CREATOR)];
  state.rooms.push(...rooms);
  const db = makeDb(state);

  const first = await attachRoom(db, ADMIN, ORG, rooms[0].room_id);
  ok("the first room attaches (seat_limit's own static value of 1)", first.org_id === ORG);

  let refused = null;
  try { await attachRoom(db, ADMIN, ORG, rooms[1].room_id); } catch (e) { refused = e; }
  ok("NEGATIVE CONTROL (b): a 'created' subscription's seats=5 never raises the cap - the 2nd room is refused at seat_limit=1, not 5",
    refused instanceof OrgError && refused.code === "no_seat" && refused.details.seat_limit === 1);
}

{
  // THE LAPSE BEHAVIOUR: Rooms stay attached; the predicate stops admitting
  // new ones (seats coalesce to 0).
  const state = freshState();
  seedOrg(state, { seatLimit: 5 });
  seedCreatorMember(state, CREATOR);
  state.orgSubscriptions.push({
    subscription_id: "sub-active-2", org_id: ORG, plan: "starter", seats: 3, price_per_seat_inr: 2999,
    currency: "INR", state: "active", provider: "fake", provider_subscription_ref: "fake_sub_lapsing",
    created_at: "2026-09-04T00:00:00.000Z", updated_at: "2026-09-04T00:00:00.000Z",
  });
  const rooms = [makeRoom(21, CREATOR), makeRoom(22, CREATOR), makeRoom(23, CREATOR), makeRoom(24, CREATOR)];
  state.rooms.push(...rooms);
  const db = makeDb(state);
  await attachRoom(db, ADMIN, ORG, rooms[0].room_id);
  await attachRoom(db, ADMIN, ORG, rooms[1].room_id);
  await attachRoom(db, ADMIN, ORG, rooms[2].room_id);
  ok("three Rooms attached while the subscription was active", state.rooms.filter((r) => r.org_id === ORG).length === 3);

  // Lapse it (simulating what a webhook's own state flip would do - the
  // webhook path itself is proven separately in §4).
  state.orgSubscriptions.find((s) => s.subscription_id === "sub-active-2").state = "cancelled";

  ok("the three already-attached Rooms are UNTOUCHED by the lapse", state.rooms.filter((r) => r.org_id === ORG).length === 3);
  let refused = null;
  try { await attachRoom(db, ADMIN, ORG, rooms[3].room_id); } catch (e) { refused = e; }
  ok("LAPSE BEHAVIOUR: a 4th attach is refused with seat_limit coalesced to 0, not the static seat_limit=5",
    refused instanceof OrgError && refused.code === "no_seat" && refused.details.seat_limit === 0);
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n§3 THE EXEMPTION — a Suite seat refuses a creator tier charge, before any provider call");
// ═════════════════════════════════════════════════════════════════════════
{
  const state = freshState();
  seedOrg(state, { seatLimit: 5 });
  seedCreatorMember(state, CREATOR);
  const room = makeRoom(31, CREATOR);
  state.rooms.push(room);
  state.orgSubscriptions.push({
    subscription_id: "sub-active-3", org_id: ORG, plan: "starter", seats: 5, price_per_seat_inr: 2999,
    currency: "INR", state: "active", provider: "fake", provider_subscription_ref: "fake_sub_exempt",
    created_at: "2026-09-04T00:00:00.000Z", updated_at: "2026-09-04T00:00:00.000Z",
  });
  const db = makeDb(state);
  await attachRoom(db, ADMIN, ORG, room.room_id);

  const covered = await seatCoversCreatorTier(db, CREATOR, room.replica_id);
  ok("the seat exemption predicate reports covered once the Room is attached to an active Suite", covered === true);

  const before = state.creatorSubscriptions.length;
  const callsBefore = db.calls.length;
  const refused = await startCreatorSubscription(db, { ownerUserId: CREATOR, replicaId: room.replica_id, plan: "room" }, { env: ENV }).then(() => null, (e) => e);
  ok("NEGATIVE CONTROL (c): a creator charge started while a seat covers them is refused, named", refused instanceof PaymentsError && refused.code === "creator_tier_covered_by_suite");
  ok("NEGATIVE CONTROL (c): nothing was inserted into vy_creator_subscription", state.creatorSubscriptions.length === before);
  // The fake provider never exposes a call counter of its own (it is a pure
  // function, byte-identical to what a real request would hit) - what is
  // provable here is that NO write past the exemption check ever ran, which
  // is the necessary precondition for "the provider was never called": the
  // provider is only ever reached AFTER the insert-or-reuse block below the
  // exemption check in api/_payments.js's own source.
  const newCallsAfterExemption = db.calls.slice(callsBefore).map((c) => c.sql);
  // WS-R51 (evals/room-doors, the door-battery class-c fix) added ONE more
  // read before the exemption check even runs — `ownedReplicaHandle`'s own
  // new ownership verification (`select replica_id from vy_replica...`) —
  // so this control now allows exactly TWO reads, still zero writes; the
  // property under test (no insert/update reaches vy_creator_subscription)
  // is unchanged.
  ok("NEGATIVE CONTROL (c): only READS were made before the refusal (the new ownership check, then the exemption's own read), no insert/update at all",
    newCallsAfterExemption.length === 2 &&
      /select replica_id from vy_replica/i.test(newCallsAfterExemption[0]) &&
      /select exists/i.test(newCallsAfterExemption[1]));

  const src = readFileSync(join(REPO, "api/_payments.js"), "utf8");
  const exemptionIdx = src.indexOf("if (covered) throw new PaymentsError(\"creator_tier_covered_by_suite\"");
  const providerCallIdx = src.indexOf("provider.createSubscription({ priceInr, label: `creator-tier:");
  ok("the exemption check appears in the source BEFORE the provider is ever called",
    exemptionIdx > -1 && providerCallIdx > -1 && exemptionIdx < providerCallIdx);
}

{
  // Not covered: no Suite at all.
  const state = freshState();
  const db = makeDb(state);
  const covered = await seatCoversCreatorTier(db, CREATOR, `${REPLICA_PREFIX}000000000096`);
  ok("no Suite, no exemption", covered === false);
  const started = await startCreatorSubscription(db, { ownerUserId: CREATOR, replicaId: `${REPLICA_PREFIX}000000000096`, plan: "room" }, { env: ENV });
  ok("an uncovered creator's own charge starts normally", state.creatorSubscriptions.length === 1 && started.state === "created");
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n§4 THE WEBHOOK — three lanes, one door, verify then apply");
// ═════════════════════════════════════════════════════════════════════════
{
  // The Suite lane.
  const state = freshState();
  seedOrg(state, { seatLimit: 5 });
  const db = makeDb(state);
  const started = await startOrgSubscription(db, { ownerUserId: ADMIN, orgId: ORG, plan: "starter", seats: 3 }, { env: ENV });
  const ref = started.provider_subscription_ref;

  const body = RAZORPAY_EVENT("subscription.activated", ref, 3 * 2999 * 100);
  const sig = fake.signWebhookForTest(body, WEBHOOK_SECRET);
  const applied = await applyWebhook(db, { rawBody: body, signatureHeader: sig, eventRef: "evt_org_1" }, { env: ENV });
  ok("the org lane resolves and applies", applied.applied === true && applied.lane === "org");
  ok("the subscription flips to active", state.orgSubscriptions[0].state === "active");
  ok("a ledger row lands with org_id set", state.paymentEvents.length === 1 && state.paymentEvents[0].org_id === ORG);
  ok("THE TAKE ARITHMETIC: 100% of a Suite's seat charge is platform take in v0 (see migration 095's own header)",
    state.paymentEvents[0].platform_take_inr === state.paymentEvents[0].amount_inr && state.paymentEvents[0].creator_share_inr === 0);

  const replay = await applyWebhook(db, { rawBody: body, signatureHeader: sig, eventRef: "evt_org_1" }, { env: ENV });
  ok("a replayed (provider, event) pair is a no-op, never a second split", replay.applied === false && replay.replay === true && state.paymentEvents.length === 1);
}

{
  // The creator tier lane.
  const state = freshState();
  const db = makeDb(state);
  const started = await startCreatorSubscription(db, { ownerUserId: CREATOR, replicaId: `${REPLICA_PREFIX}000000000095`, plan: "studio" }, { env: ENV });
  const ref = started.provider_subscription_ref;

  const body = RAZORPAY_EVENT("subscription.activated", ref, 1999900);
  const sig = fake.signWebhookForTest(body, WEBHOOK_SECRET);
  const applied = await applyWebhook(db, { rawBody: body, signatureHeader: sig, eventRef: "evt_creator_1" }, { env: ENV });
  ok("the creator lane resolves and applies", applied.applied === true && applied.lane === "creator");
  ok("the creator's own subscription flips to active", state.creatorSubscriptions[0].state === "active");
  ok("NO ledger row lands for a creator-tier charge (see migration 095's own scope decision)", state.paymentEvents.length === 0);
}

{
  // NEGATIVE CONTROL (a): an unsigned webhook writes nothing to ANY billing
  // table, regardless of which lane it would have resolved to.
  const state = freshState();
  seedOrg(state, { seatLimit: 5 });
  const db = makeDb(state);
  const started = await startOrgSubscription(db, { ownerUserId: ADMIN, orgId: ORG, plan: "starter", seats: 3 }, { env: ENV });
  const ref = started.provider_subscription_ref;
  const before = JSON.stringify({ orgSubscriptions: state.orgSubscriptions, creatorSubscriptions: state.creatorSubscriptions, paymentEvents: state.paymentEvents });

  const body = RAZORPAY_EVENT("subscription.activated", ref, 39900);
  const badSig = "0".repeat(64);
  const refused = await applyWebhook(db, { rawBody: body, signatureHeader: badSig, eventRef: "evt_unsigned" }, { env: ENV }).then(() => null, (e) => e);
  ok("NEGATIVE CONTROL (a): an unsigned webhook is refused, named", refused instanceof PaymentsError && refused.code === "payment_webhook_signature_invalid");
  const after = JSON.stringify({ orgSubscriptions: state.orgSubscriptions, creatorSubscriptions: state.creatorSubscriptions, paymentEvents: state.paymentEvents });
  ok("NEGATIVE CONTROL (a): every billing table is byte-for-byte unchanged", before === after);
}

{
  // An unknown ref falls through all three lanes cleanly.
  const state = freshState();
  const db = makeDb(state);
  const body = RAZORPAY_EVENT("subscription.activated", "sub_never_created", 0);
  const sig = fake.signWebhookForTest(body, WEBHOOK_SECRET);
  const refused = await applyWebhook(db, { rawBody: body, signatureHeader: sig, eventRef: "evt_unknown" }, { env: ENV }).then(() => null, (e) => e);
  ok("a ref this database has never seen in ANY of the three lanes is refused, named", refused instanceof PaymentsError && refused.code === "payments_subscription_unknown");
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n§5 updateOrgSeats — a provider-mediated proration, never invented locally");
// ═════════════════════════════════════════════════════════════════════════
{
  const state = freshState();
  seedOrg(state, { seatLimit: 5 });
  const db = makeDb(state);
  const notStarted = await updateOrgSeats(db, { ownerUserId: ADMIN, orgId: ORG, seats: 5 }, { env: ENV }).then(() => null, (e) => e);
  ok("adding seats before any subscription was started is refused, named", notStarted instanceof PaymentsError && notStarted.code === "org_subscription_not_started");

  const started = await startOrgSubscription(db, { ownerUserId: ADMIN, orgId: ORG, plan: "starter", seats: 3 }, { env: ENV });
  const updated = await updateOrgSeats(db, { ownerUserId: ADMIN, orgId: ORG, seats: 5 }, { env: ENV });
  ok("seats update to the new count", updated.seats === 5 && state.orgSubscriptions[0].seats === 5);

  seedCreatorMember(state, CREATOR);
  const rooms = [makeRoom(41, CREATOR), makeRoom(42, CREATOR), makeRoom(43, CREATOR)];
  state.rooms.push(...rooms);
  state.orgSubscriptions[0].state = "active";
  for (const r of rooms) await attachRoom(db, ADMIN, ORG, r.room_id);
  const belowUsage = await updateOrgSeats(db, { ownerUserId: ADMIN, orgId: ORG, seats: 2 }, { env: ENV }).then(() => null, (e) => e);
  ok("reducing seats below the count already in use is refused, named", belowUsage instanceof PaymentsError && belowUsage.code === "org_seats_below_usage" && belowUsage.details.seats_used === 3);
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n§6 WS-R73: SUITES ON UPI — a locked mandate refuses BY NAME, never a raw provider error");
// ═════════════════════════════════════════════════════════════════════════
{
  // A UPI-authorised Suite subscription: the provider read says 'upi', and
  // updateOrgSeats must refuse BEFORE the PATCH, never send it, and never
  // touch the local seat count.
  const state = freshState();
  seedOrg(state, { seatLimit: 5 });
  const db = makeDb(state);
  const started = await startOrgSubscription(db, { ownerUserId: ADMIN, orgId: ORG, plan: "starter", seats: 3 }, { env: ENV });
  const ref = started.provider_subscription_ref;
  fake.setFakeSubscriptionMethod(ref, "upi");
  fake.resetUpdateSubscriptionQuantityCallCountForTest();

  const seatsBefore = state.orgSubscriptions[0].seats;
  const refused = await updateOrgSeats(db, { ownerUserId: ADMIN, orgId: ORG, seats: 7 }, { env: ENV }).then(() => null, (e) => e);
  ok("a UPI-authorised Suite's seat update is refused, named org_seats_locked_by_mandate",
    refused instanceof PaymentsError && refused.code === "org_seats_locked_by_mandate");
  ok("the refusal names the payment method it read", refused?.details?.payment_method === "upi");
  ok("the refusal names the path that works (cancel and create a new Subscription, Razorpay's own documented alternative)",
    refused?.details?.path === "cancel_and_create_new_subscription");
  ok("NEGATIVE CONTROL: a quantity update on a UPI mandate never reaches the provider - updateSubscriptionQuantity's own call count is still zero",
    fake.updateSubscriptionQuantityCallCountForTest() === 0);
  ok("NEGATIVE CONTROL: the refusal leaves the seat cap UNCHANGED in the database, never prorated locally while the provider itself refused",
    state.orgSubscriptions[0].seats === seatsBefore && state.orgSubscriptions[0].seats === 3);
}

{
  // Emandate: the SAME refusal, the SAME two negative controls, a different
  // method string - proving the check is not accidentally UPI-only.
  const state = freshState();
  seedOrg(state, { seatLimit: 5 });
  const db = makeDb(state);
  const started = await startOrgSubscription(db, { ownerUserId: ADMIN, orgId: ORG, plan: "starter", seats: 3 }, { env: ENV });
  const ref = started.provider_subscription_ref;
  fake.setFakeSubscriptionMethod(ref, "emandate");
  fake.resetUpdateSubscriptionQuantityCallCountForTest();

  const refused = await updateOrgSeats(db, { ownerUserId: ADMIN, orgId: ORG, seats: 9 }, { env: ENV }).then(() => null, (e) => e);
  ok("an Emandate-authorised Suite's seat update is refused, named the SAME reason as UPI (Razorpay's own faqs page states both together)",
    refused instanceof PaymentsError && refused.code === "org_seats_locked_by_mandate" && refused.details.payment_method === "emandate");
  ok("NEGATIVE CONTROL: zero provider calls for Emandate either",
    fake.updateSubscriptionQuantityCallCountForTest() === 0);
  ok("NEGATIVE CONTROL: the seat cap is unchanged", state.orgSubscriptions[0].seats === 3);
}

{
  // Card, explicitly set rather than relied on as the default (this section's
  // own positive control): the SAME function, on the ONE method Razorpay's
  // own PATCH actually accepts, still succeeds and still reaches the
  // provider exactly once.
  const state = freshState();
  seedOrg(state, { seatLimit: 5 });
  const db = makeDb(state);
  const started = await startOrgSubscription(db, { ownerUserId: ADMIN, orgId: ORG, plan: "starter", seats: 3 }, { env: ENV });
  const ref = started.provider_subscription_ref;
  fake.setFakeSubscriptionMethod(ref, "card");
  fake.resetUpdateSubscriptionQuantityCallCountForTest();

  const updated = await updateOrgSeats(db, { ownerUserId: ADMIN, orgId: ORG, seats: 6 }, { env: ENV });
  ok("a card-authorised Suite's seat update still succeeds", updated.seats === 6 && state.orgSubscriptions[0].seats === 6);
  ok("POSITIVE CONTROL: the provider WAS reached exactly once for the card lane, proving §6's zero counts above are a real refusal, not a broken counter",
    fake.updateSubscriptionQuantityCallCountForTest() === 1);
}

console.log(`\norg-billing: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
