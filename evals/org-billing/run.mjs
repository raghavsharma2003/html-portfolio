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
  MANDATE_KIND_TO_STATE,
} = payments;
const org = await import(pathToFileURL(join(REPO, "api/_org.js")).href);
const { OrgError, attachRoom, seatCoversCreatorTier } = org;
const { readCreatorTier } = await import(pathToFileURL(join(REPO, "api/_creator-tier.js")).href);
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

    // ── startCreatorSubscription's existing-live lookup. WS-R132 (migration
    // 135): the widened predicate excludes a halted or cancelled MANDATE
    // too, mirroring the real widened index. ──
    if (has("from vy_creator_subscription") && has("where replica_id = ($1)::uuid")) {
      const [replicaId] = params;
      const row = state.creatorSubscriptions
        .filter((s) => s.replica_id === replicaId
          && ["created", "authenticated", "active", "paused"].includes(s.state)
          && !["halted", "cancelled"].includes(s.mandate_state))
        .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
      return row ? [{ ...row }] : [];
    }
    // ── startCreatorSubscription: WS-R132's own "close halted/cancelled
    // row, then insert" statement family - checked BEFORE the plain insert
    // branch below, since it also contains the substring "insert into
    // vy_creator_subscription", with params in a DIFFERENT order
    // (`[replicaId, ownerUserId, plan, priceInr, currency, provider]`). ──
    if (has("with closed as (") && has("insert into vy_creator_subscription")) {
      const [replicaId, ownerId, plan, priceInr, currency, provider] = params;
      for (const s of state.creatorSubscriptions) {
        if (s.replica_id === replicaId
          && ["created", "authenticated", "active", "paused"].includes(s.state)
          && ["halted", "cancelled"].includes(s.mandate_state)) {
          s.state = "cancelled";
        }
      }
      const live = state.creatorSubscriptions.some((s) => s.replica_id === replicaId
        && ["created", "authenticated", "active", "paused"].includes(s.state)
        && !["halted", "cancelled"].includes(s.mandate_state));
      if (live) throw Object.assign(new Error("duplicate key value violates unique constraint \"vy_creator_subscription_replica_live_ix\""), { code: "23505" });
      const row = {
        subscription_id: nextSubId("f2"), owner_user_id: ownerId, replica_id: replicaId, plan, price_inr: priceInr,
        currency, provider, provider_subscription_ref: null, state: "created",
        created_at: new Date(NOW + state.creatorSubscriptions.length).toISOString(), updated_at: new Date(NOW).toISOString(),
        mandate_state: "none", mandate_state_at: null,
      };
      state.creatorSubscriptions.push(row);
      return [{ subscription_id: row.subscription_id, state: row.state }];
    }
    // ── startCreatorSubscription's plain insert. Dead for
    // `startCreatorSubscription` since WS-R132 (that function now always
    // issues the combined statement above), kept only in case a future
    // caller inserts a row directly with no close-old-row step of its own. ──
    if (has("insert into vy_creator_subscription")) {
      const [ownerId, replicaId, plan, priceInr, currency, provider] = params;
      const row = {
        subscription_id: nextSubId("f2"), owner_user_id: ownerId, replica_id: replicaId, plan, price_inr: priceInr,
        currency, provider, provider_subscription_ref: null, state: "created",
        created_at: new Date(NOW + state.creatorSubscriptions.length).toISOString(), updated_at: new Date(NOW).toISOString(),
        // WS-R125 (migration 130): the column's own default.
        mandate_state: "none", mandate_state_at: null,
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
    // ── readCreatorTier (api/_creator-tier.js) — the studio's own read,
    //    WS-R125's own `mandate_state` addition included. ──
    if (has("from vy_creator_subscription") && has("owner_user_id = ($1)::uuid and replica_id = ($2)::uuid")) {
      const [ownerUserId, replicaId] = params.map(String);
      const row = state.creatorSubscriptions
        .filter((s) => s.owner_user_id === ownerUserId && s.replica_id === replicaId)
        .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
      return row ? [{ ...row }] : [];
    }
    // ── applyWebhook: the creator lane's plain state flip ──
    if (has("update vy_creator_subscription s") && has("set state = case")) {
      const [subId, nextState, periodStart, periodEnd, , , , , , nextMandateState] = params;
      const row = state.creatorSubscriptions.find((s) => s.subscription_id === subId);
      if (!row) return [];
      if (nextState !== "") row.state = nextState;
      if (periodStart) row.current_period_start = periodStart;
      if (periodEnd) row.current_period_end = periodEnd;
      // WS-R125 (migration 130): the SAME "leaving state" guard the real
      // UPDATE's CASE expression carries - `mandate_state_at` only advances
      // when the row is actually leaving a DIFFERENT stored value, since
      // (unlike the follower/org lanes) nothing dedupes a non-charge event
      // on `(provider, provider_event_ref)` for this lane at all.
      if (nextMandateState && row.mandate_state !== nextMandateState) {
        row.mandate_state = nextMandateState;
        row.mandate_state_at = new Date(NOW + state.creatorSubscriptions.length).toISOString();
      }
      return [{ subscription_id: row.subscription_id, state: row.state, mandate_state: row.mandate_state ?? null }];
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

// ═════════════════════════════════════════════════════════════════════════
console.log("\n§4b WS-R125 (migration 130): the CREATOR'S OWN mandate lifecycle, told apart honestly");
// ═════════════════════════════════════════════════════════════════════════
{
  // `readCreatorTier` never told a customer-paused creator mandate apart
  // from a bank-halted one - WS-R69 only ever built that distinction for a
  // FOLLOWER (`api/_payments.js`'s `pausedOrHalted`). This is the first
  // offline proof the creator side gets it too, straight off the stored
  // column, no ledger re-derivation needed.
  const state = freshState();
  const db = makeDb(state);
  const replicaId = `${REPLICA_PREFIX}000000000097`;
  const started = await startCreatorSubscription(db, { ownerUserId: CREATOR, replicaId, plan: "room" }, { env: ENV });
  const ref = started.provider_subscription_ref;

  const fire = (kind, tag, amountPaise = 0) => {
    const body = RAZORPAY_EVENT(kind, ref, amountPaise);
    const sig = fake.signWebhookForTest(body, WEBHOOK_SECRET);
    return applyWebhook(db, { rawBody: body, signatureHeader: sig, eventRef: `evt_${tag}` }, { env: ENV });
  };

  ok("brand new: mandate_state defaults to 'none'", state.creatorSubscriptions[0].mandate_state === "none");

  await fire("subscription.activated", "m5_activate", 499900);
  const tierActive = await readCreatorTier(db, CREATOR, replicaId);
  ok("readCreatorTier: active, mandate_state 'none' (never touched by a plain activation)",
    tierActive.tier === "room" && tierActive.subscription.mandate_state === "none");

  const paused = await fire("subscription.paused", "m5_pause");
  ok("applyWebhook's own return carries the creator lane's mandate_state too", paused.mandate_state === "paused");
  const tierPaused = await readCreatorTier(db, CREATOR, replicaId);
  ok("readCreatorTier: state 'paused' AND mandate_state 'paused' - a customer-paused mandate",
    tierPaused.subscription.state === "paused" && tierPaused.subscription.mandate_state === "paused");
  ok("the tier flip demotes to 'free' the SAME as any non-active state (§/api/_creator-tier.js's own predicate, unmodified)",
    tierPaused.tier === "free");

  // A SECOND creator, halted instead of paused - same `state`, different
  // `mandate_state`, `context/decisions.md#ws-r69-halted-is-a-derived-read-
  // never-a-stored-value`'s own reversal condition exercised for the
  // creator lane instead of the follower one.
  const state2 = freshState();
  const db2 = makeDb(state2);
  const replicaId2 = `${REPLICA_PREFIX}000000000098`;
  const started2 = await startCreatorSubscription(db2, { ownerUserId: CREATOR, replicaId: replicaId2, plan: "studio" }, { env: ENV });
  const ref2 = started2.provider_subscription_ref;
  const fire2 = (kind, tag, amountPaise = 0) => {
    const body = RAZORPAY_EVENT(kind, ref2, amountPaise);
    const sig = fake.signWebhookForTest(body, WEBHOOK_SECRET);
    return applyWebhook(db2, { rawBody: body, signatureHeader: sig, eventRef: `evt_${tag}` }, { env: ENV });
  };
  await fire2("subscription.activated", "m5b_activate", 1999900);
  await fire2("subscription.halted", "m5b_halt");
  const tierHalted = await readCreatorTier(db2, CREATOR, replicaId2);
  ok("readCreatorTier: the SAME stored `state` ('paused') as the customer-paused creator above, but mandate_state 'halted'",
    tierHalted.subscription.state === "paused" && tierHalted.subscription.mandate_state === "halted");
  ok("NEGATIVE CONTROL: the stored `state` column never becomes the literal string 'halted' for the creator lane either",
    state2.creatorSubscriptions[0].state !== "halted");

  // A DUPLICATE delivery under a fresh event id is a no-op for mandate_state_at.
  const at1 = state2.creatorSubscriptions[0].mandate_state_at;
  await fire2("subscription.halted", "m5b_halt_dup");
  ok("a duplicate halted delivery never advances mandate_state_at - the creator lane has NO ledger dedup for non-charge events, so this guard is load-bearing here",
    state2.creatorSubscriptions[0].mandate_state_at === at1);

  ok("MANDATE_KIND_TO_STATE agrees with both fixtures above: 'halted' -> 'halted', not 'paused'",
    MANDATE_KIND_TO_STATE["subscription.halted"] === "halted");
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

console.log("\n§7 WS-R132 (migration 135): STARTING A NEW CREATOR MANDATE AFTER A HALT");
// ═════════════════════════════════════════════════════════════════════════
{
  // §4b's own halted creator, restated: this time asking whether the
  // creator can ever get a WORKING second mandate rather than the SAME
  // dead reference back forever -
  // `context/rejected.md#ws-r125-halted-mandate-start-new-button-would-
  // have-been-a-silent-no-op`'s own gap, closed by this migration, for the
  // creator-tier lane rather than the follower one.
  const state = freshState();
  const db = makeDb(state);
  const replicaId = `${REPLICA_PREFIX}0000000000c1`;
  const started = await startCreatorSubscription(db, { ownerUserId: CREATOR, replicaId, plan: "room" }, { env: ENV });
  const oldRef = started.provider_subscription_ref;
  ok("§7 the first start mints a real provider ref", typeof oldRef === "string" && oldRef.length > 0);

  const fire = (kind, tag, amountPaise = 0) => {
    const body = RAZORPAY_EVENT(kind, oldRef, amountPaise);
    const sig = fake.signWebhookForTest(body, WEBHOOK_SECRET);
    return applyWebhook(db, { rawBody: body, signatureHeader: sig, eventRef: `evt_r132_${tag}` }, { env: ENV });
  };
  await fire("subscription.activated", "activate", 499900);
  await fire("subscription.halted", "halt");
  ok("§7 the mandate is genuinely halted before the restart", state.creatorSubscriptions[0].mandate_state === "halted");

  // NEGATIVE CONTROL: the OLD, unwidened predicate - `evals/payments/run.mjs`'s
  // own §19 "strike the clause" technique, restated for the creator lane -
  // still calls the halted row 'live' and hands back its dead reference.
  const staleRows = state.creatorSubscriptions.filter((s) => s.replica_id === replicaId
    && ["created", "authenticated", "active", "paused"].includes(s.state));
  ok("NEGATIVE CONTROL: the OLD predicate (no mandate_state clause) still calls the halted creator row 'live' and would hand back its dead reference",
    staleRows.length === 1 && staleRows[0].provider_subscription_ref === oldRef);

  // THE RESTART, through the REAL function.
  const restarted = await startCreatorSubscription(db, { ownerUserId: CREATOR, replicaId, plan: "room" }, { env: ENV });
  ok("§7 restarting after a halt returns a NEW local subscription row, never the halted one",
    restarted.subscription_id !== started.subscription_id);
  ok("§7 the OLD row is closed (state 'cancelled'), never left dangling forever",
    state.creatorSubscriptions.find((s) => s.subscription_id === started.subscription_id).state === "cancelled");
  ok("§7 the NEW row starts with a clean mandate slate ('none')",
    state.creatorSubscriptions.find((s) => s.subscription_id === restarted.subscription_id).mandate_state === "none");
  ok("§7 exactly two subscription rows exist for this replica - the close and the insert landed as ONE statement family",
    state.creatorSubscriptions.filter((s) => s.replica_id === replicaId).length === 2);
  ok("§7 the restart hands back a checkout link - a REAL second provider call happened, not a silent no-op",
    typeof restarted.checkout_url === "string" && restarted.checkout_url.length > 0);
  // `evals/payments/run.mjs`'s own §19 NAMED FAKE-PROVIDER ARTIFACT,
  // restated for the creator lane: `createSubscription`'s ref is
  // deterministic on (label, ref, priceInr), so a restart with the SAME
  // plan on the SAME replica mints the SAME string back from the fake
  // provider - a real Razorpay account never would, since its own ids are
  // server-minted and non-deterministic.
  ok("NAMED FAKE-PROVIDER ARTIFACT: with identical (label, ref, priceInr) inputs, the fake mints the SAME ref the restart got before - the real provider never would",
    restarted.provider_subscription_ref === oldRef);

  // Suite coverage still refuses BEFORE any provider call even for a
  // halted-then-restarting creator - law 4 is unconditional, not scoped to
  // a creator's FIRST ever subscription attempt.
  const state2 = freshState();
  seedOrg(state2, { seatLimit: 5 });
  const db2 = makeDb(state2);
  const replicaId2 = `${REPLICA_PREFIX}0000000000c2`;
  // The room exists and is ALREADY attached to the Suite from the start -
  // `attachRoom`'s own mechanics are `evals/org/run.mjs`'s own subject, not
  // this one; here only the coverage predicate `seatCoversCreatorTier`
  // reads (`room.org_id`, and later an active `vy_org_subscription` for
  // that org) needs to be true by the time the SECOND `startCreatorSubscription`
  // call below runs.
  state2.rooms.push({ room_id: `${ROOM_PREFIX}0000000000c2`, replica_id: replicaId2, owner_user_id: CREATOR, org_id: ORG });
  const started2 = await startCreatorSubscription(db2, { ownerUserId: CREATOR, replicaId: replicaId2, plan: "room" }, { env: ENV });
  const fireRef = (ref, kind, tag, amountPaise = 0) => {
    const body = RAZORPAY_EVENT(kind, ref, amountPaise);
    const sig = fake.signWebhookForTest(body, WEBHOOK_SECRET);
    return applyWebhook(db2, { rawBody: body, signatureHeader: sig, eventRef: `evt_r132b_${tag}` }, { env: ENV });
  };
  await fireRef(started2.provider_subscription_ref, "subscription.activated", "activate", 499900);
  await fireRef(started2.provider_subscription_ref, "subscription.halted", "halt");
  const orgStarted2 = await startOrgSubscription(db2, { ownerUserId: ADMIN, orgId: ORG, plan: "starter", seats: 3 }, { env: ENV });
  // The ORG's own ref, never the creator's - a mistake here would silently
  // re-fire against the creator lane instead (both webhooks resolve by
  // provider_subscription_ref alone) and never actually activate the Suite
  // subscription this test's own refusal depends on.
  await fireRef(orgStarted2.provider_subscription_ref, "subscription.activated", "org_activate", 2999300);
  const refused = await startCreatorSubscription(db2, { ownerUserId: CREATOR, replicaId: replicaId2, plan: "room" }, { env: ENV }).then(() => null, (e) => e);
  ok("§7 a Suite seat that now covers this creator still refuses a restart BEFORE any provider call, exactly as it would a first attempt",
    refused instanceof PaymentsError && refused.code === "creator_tier_covered_by_suite");
}

console.log(`\norg-billing: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
