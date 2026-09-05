// WS-R28. Suites v0's offline suite: `api/_org.js` (createOrg, inviteMember,
// acceptMembership, attachRoom, detachRoom, orgBoard, orgSubscriptionStatus,
// listMyOrgs, listOrgMembers, roomSuiteStatus, seatCoversCreatorTier) plus
// the erasure job's own membership-only delete (`api/_replica-full-
// erasure.js`, migration 091).
//
//   node evals/org/run.mjs
//
// Offline, deterministic, $0, no network, no real Postgres. A dedicated fake
// db, `evals/funnel/run.mjs`'s own precedent restated: this file's tables
// (vy_org, vy_org_member, vy_org_subscription, plus the handful of vy_room
// columns attachRoom/detachRoom/orgBoard touch) are small enough to model
// directly, and `orgBoard`'s own per-Room read calls the REAL, unmodified
// `api/_ops.js` `roomOverview` - so this fixture also answers roomOverview's
// six follower/thread/subscription/payment/drift sub-queries, with plain
// zero-shaped rows: their own arithmetic is already proven by
// `evals/ops/run.mjs`, so this file exists to prove orgBoard's OWN plumbing
// (the right Rooms, the right org, never a Room that belongs to someone
// else's Suite) rather than re-derive every WHERE clause a second time.
import fs from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");

let pass = 0;
let fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) pass++;
  else fail++;
  console.log(`${cond ? "  ok  " : "FAIL  "}${name}${extra ? `   ${extra}` : ""}`);
};

const {
  OrgError,
  createOrg,
  inviteMember,
  acceptMembership,
  attachRoom,
  detachRoom,
  orgBoard,
  orgSubscriptionStatus,
  listMyOrgs,
  listOrgMembers,
  roomSuiteStatus,
  seatCoversCreatorTier,
} = await import(pathToFileURL(join(REPO, "api/_org.js")).href);

// ═════════════════════════════════════════════════════════════════════════
// THE FIXTURE
// ═════════════════════════════════════════════════════════════════════════
const ADMIN_A = "a0000000-0000-4000-8000-00000000000a";
const CREATOR_A = "c0000000-0000-4000-8000-00000000000a";
const CREATOR_B = "c0000000-0000-4000-8000-00000000000b";
const STRANGER = "50000000-0000-4000-8000-000000000005";
const ORG_A = "e0000000-0000-4000-8000-00000000000a";
const ORG_B = "e0000000-0000-4000-8000-00000000000b";
const REPLICA_A = "c1000000-0000-4000-8000-00000000000a";
const REPLICA_B = "c1000000-0000-4000-8000-00000000000b";
const ROOM_A = "d1000000-0000-4000-8000-00000000000a";
const ROOM_B = "d1000000-0000-4000-8000-00000000000b";

function freshState() {
  return {
    orgs: [],
    orgMembers: [],
    orgSubscriptions: [],
    rooms: [],
    // WS-R54, migration 108: one row per attachment INTERVAL. `detached_at
    // === null` means still open - the same "one open row per room_id"
    // invariant the real partial unique index enforces.
    orgAttachments: [],
    // WS-R127, migration 132: the content-free weekly-note send ledger.
    orgWeeklyNotes: [],
  };
}

function seedTwoOrgsTwoRooms(state) {
  state.orgs.push(
    { org_id: ORG_A, name: "North Coaching", slug: "north-coaching", plan: "starter", seat_limit: 2, created_at: "2026-09-01T00:00:00.000Z" },
    { org_id: ORG_B, name: "South Clinic", slug: "south-clinic", plan: "starter", seat_limit: 2, created_at: "2026-09-01T00:00:00.000Z" },
  );
  state.orgMembers.push(
    { org_id: ORG_A, owner_user_id: ADMIN_A, role: "admin", added_at: "2026-09-01T00:00:00.000Z" },
    { org_id: ORG_A, owner_user_id: CREATOR_A, role: "creator", added_at: "2026-09-01T00:01:00.000Z" },
    { org_id: ORG_B, owner_user_id: CREATOR_B, role: "admin", added_at: "2026-09-01T00:00:00.000Z" },
  );
  state.rooms.push(
    {
      room_id: ROOM_A, slug: "room-a", display_name: "Room A", replica_id: REPLICA_A, owner_user_id: CREATOR_A,
      org_id: null, free_monthly_messages: 20, paid_monthly_messages: 500, published_at: "2026-09-01T00:05:00.000Z",
      paused_at: null, created_at: "2026-09-01T00:02:00.000Z",
    },
    {
      room_id: ROOM_B, slug: "room-b", display_name: "Room B", replica_id: REPLICA_B, owner_user_id: CREATOR_B,
      org_id: ORG_B, free_monthly_messages: 20, paid_monthly_messages: 500, published_at: "2026-09-01T00:05:00.000Z",
      paused_at: null, created_at: "2026-09-01T00:02:00.000Z",
    },
  );
}

// WS-R33: mirrors api/_org.js's `seatCapSql` exactly (an active
// subscription's own seats; 0 once one has lapsed; `seat_limit` when none
// was ever started or the only one is still pending) so this suite's
// existing fixtures - none of which seed `orgSubscriptions` - keep behaving
// exactly as before (fall through to `seat_limit`), while staying
// consistent with the coalesce logic evals/org-billing/run.mjs proves in
// depth.
function effectiveSeatCap(org, state) {
  if (!org) return null;
  const subs = state.orgSubscriptions
    .filter((s) => s.org_id === org.org_id)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const latest = subs[0];
  if (latest) {
    if (latest.state === "active") return Number(latest.seats);
    if (["paused", "cancelled", "expired"].includes(latest.state)) return 0;
  }
  return Number(org.seat_limit);
}

function orgDb(state) {
  const db = async (sql, params = []) => {
    const has = (s) => sql.includes(s);

    // ── createOrg's own CTE ──────────────────────────────────────────────
    if (has("with new_org as") && has("insert into vy_org (org_id, name, slug, created_by_user_id, plan, seat_limit)")) {
      const [orgId, name, slug, createdBy, plan, seatLimit] = params;
      if (state.orgs.some((o) => o.slug.toLowerCase() === String(slug).toLowerCase())) {
        throw Object.assign(new Error('duplicate key value violates unique constraint "vy_org_slug_ix"'), { code: "23505" });
      }
      const row = { org_id: orgId, name, slug, plan, seat_limit: seatLimit, created_by_user_id: createdBy, created_at: new Date().toISOString() };
      state.orgs.push(row);
      state.orgMembers.push({ org_id: orgId, owner_user_id: createdBy, role: "admin", added_at: new Date().toISOString() });
      return [{ org_id: row.org_id, name: row.name, slug: row.slug, plan: row.plan, seat_limit: row.seat_limit, created_at: row.created_at }];
    }

    // ── acceptMembership's own CTE (checked before orgBoard's admin-check
    //    below, whose text this one does not overlap with, but kept ahead
    //    for readability of the ladder) ──────────────────────────────────
    if (has("with target as") && has("'creator' from target")) {
      const [orgId, ownerId] = params;
      const org = state.orgs.find((o) => o.org_id === orgId);
      if (!org) return [{ org_exists: 0, role: null, added_at: null }];
      const already = state.orgMembers.find((m) => m.org_id === orgId && m.owner_user_id === ownerId);
      if (!already) state.orgMembers.push({ org_id: orgId, owner_user_id: ownerId, role: "creator", added_at: new Date().toISOString() });
      const row = state.orgMembers.find((m) => m.org_id === orgId && m.owner_user_id === ownerId);
      return [{ org_exists: 1, role: row.role, added_at: row.added_at }];
    }

    // ── orgBoard's admin-check select (selects plan/seat_limit/created_at,
    //    inviteMember's below does not) ─────────────────────────────────
    if (has("o.plan, o.seat_limit, o.created_at") && has("join vy_org_member m")) {
      const [orgId, adminId] = params;
      const isAdmin = state.orgMembers.some((m) => m.org_id === orgId && m.owner_user_id === adminId && m.role === "admin");
      if (!isAdmin) return [];
      const org = state.orgs.find((o) => o.org_id === orgId);
      return org ? [{ ...org, seats_paid: effectiveSeatCap(org, state) }] : [];
    }

    // ── inviteMember's admin-check select ───────────────────────────────
    if (has("from vy_org o") && has("join vy_org_member m") && !has("o.plan")) {
      const [orgId, adminId] = params;
      const isAdmin = state.orgMembers.some((m) => m.org_id === orgId && m.owner_user_id === adminId && m.role === "admin");
      if (!isAdmin) return [];
      const org = state.orgs.find((o) => o.org_id === orgId);
      return org ? [{ org_id: org.org_id, name: org.name, slug: org.slug }] : [];
    }

    // ── attachRoom's own CTE (the UPDATE, checked before the generic
    //    vy_room select below - both substrings still identify it verbatim
    //    inside the WITH clause). WS-R48 (migration 107): the same
    //    statement stamps org_attached_at. WS-R54 (migration 108): the SAME
    //    statement now ALSO opens a vy_room_org_attachment row in the same
    //    CTE - modelled here as one atomic fake-db effect, `createOrg`'s own
    //    two-table-one-statement precedent restated. A stray already-open
    //    row for this room_id (a state this WHERE's own `room.org_id` check
    //    should make impossible in real use) is modelled as the real
    //    partial unique index would refuse it: a thrown 23505, never a
    //    silent second open row. ───────────────────────────────────────
    if (has("update vy_room r") && has("set org_id = ($2)::uuid, org_attached_at = now(), updated_at = now()")) {
      const [roomId, orgId, adminId] = params;
      const room = state.rooms.find((r) => r.room_id === roomId);
      const org = state.orgs.find((o) => o.org_id === orgId);
      if (!room || !org || room.org_id) return [];
      const isAdmin = state.orgMembers.some((m) => m.org_id === orgId && m.owner_user_id === adminId && m.role === "admin");
      const creatorMember = state.orgMembers.some((m) => m.org_id === orgId && m.owner_user_id === room.owner_user_id && m.role === "creator");
      const seatsUsed = state.rooms.filter((r) => r.org_id === orgId).length;
      if (!isAdmin || !creatorMember || seatsUsed >= Number(effectiveSeatCap(org, state))) return [];
      if (state.orgAttachments.some((a) => a.room_id === roomId && a.detached_at === null)) {
        throw Object.assign(
          new Error('duplicate key value violates unique constraint "vy_room_org_attachment_open_ix"'),
          { code: "23505" },
        );
      }
      const attachedAt = new Date().toISOString();
      room.org_id = orgId;
      room.org_attached_at = attachedAt;
      state.orgAttachments.push({ room_id: roomId, org_id: orgId, attached_at: attachedAt, detached_at: null });
      return [{ room_id: room.room_id, org_id: room.org_id, slug: room.slug }];
    }

    // ── attachRoom's diagnostic select ──────────────────────────────────
    if (has("is_admin") && has("creator_member") && has("seats_used")) {
      const [roomId, orgId, adminId] = params;
      const room = state.rooms.find((r) => r.room_id === roomId);
      const org = state.orgs.find((o) => o.org_id === orgId);
      return [{
        room_exists: room ? true : false,
        current_org_id: room ? room.org_id : null,
        is_admin: state.orgMembers.some((m) => m.org_id === orgId && m.owner_user_id === adminId && m.role === "admin"),
        creator_member: room ? state.orgMembers.some((m) => m.org_id === orgId && m.owner_user_id === room.owner_user_id && m.role === "creator") : false,
        seats_used: state.rooms.filter((r) => r.org_id === orgId).length,
        seat_limit: org ? effectiveSeatCap(org, state) : null,
      }];
    }

    // ── detachRoom's own CTE. WS-R48: clears org_attached_at back to null
    //    in the SAME statement, so a re-attach always carries the date of
    //    its CURRENT membership. WS-R54 (migration 108): the SAME statement
    //    now ALSO closes this room's open vy_room_org_attachment row
    //    (detached_at = now()) - modelled as one atomic fake-db effect,
    //    attachRoom's own precedent restated for the closing half. ───────
    if (has("update vy_room r") && has("set org_id = null, org_attached_at = null, updated_at = now()")) {
      const [roomId, callerId] = params;
      const room = state.rooms.find((r) => r.room_id === roomId);
      if (!room || !room.org_id) return [];
      const isOwner = room.owner_user_id === callerId;
      const isAdmin = state.orgMembers.some((m) => m.org_id === room.org_id && m.owner_user_id === callerId && m.role === "admin");
      if (!isOwner && !isAdmin) return [];
      room.org_id = null;
      room.org_attached_at = null;
      const detachedAt = new Date().toISOString();
      const open = state.orgAttachments.find((a) => a.room_id === roomId && a.detached_at === null);
      if (open) open.detached_at = detachedAt;
      return [{ room_id: room.room_id }];
    }

    // ── orgBoard's own attachment-history read (WS-R54) ─────────────────
    if (has("select room_id, org_id, attached_at, detached_at") && has("from vy_room_org_attachment")) {
      const [orgId] = params;
      return state.orgAttachments
        .filter((a) => a.org_id === orgId)
        .sort((a, b) => b.attached_at.localeCompare(a.attached_at));
    }

    // ── detachRoom's first diagnostic select (room_exists/current_org_id/
    //    room_owner) ──────────────────────────────────────────────────────
    if (has("room_owner")) {
      const [roomId] = params;
      const room = state.rooms.find((r) => r.room_id === roomId);
      return [{ room_exists: room ? true : false, current_org_id: room ? room.org_id : null, room_owner: room ? room.owner_user_id : null }];
    }

    // ── the shared "is this owner an admin of this org" check - detachRoom's
    //    second diagnostic, orgSubscriptionStatus's and listOrgMembers's own
    //    member-row checks all share this identical text ──────────────────
    if (has("where org_id = ($1)::uuid and owner_user_id = ($2)::uuid and role = 'admin' limit 1")) {
      const [orgId, ownerId] = params;
      const isAdmin = state.orgMembers.some((m) => m.org_id === orgId && m.owner_user_id === ownerId && m.role === "admin");
      return isAdmin ? [{ ["?column?"]: 1 }] : [];
    }

    // ── orgBoard's own Room list (scoped by org_id, never a follower
    //    column) ───────────────────────────────────────────────────────────
    if (has("from vy_room") && has("where org_id = ($1)::uuid") && has("order by created_at asc")) {
      const [orgId] = params;
      return state.rooms.filter((r) => r.org_id === orgId).sort((a, b) => a.created_at.localeCompare(b.created_at));
    }

    // ── roomOverview's (api/_ops.js) six sub-queries. Zero-shaped rows -
    //    their own arithmetic is proven by evals/ops/run.mjs, not re-proven
    //    here. Checked in this order because "vy_room_checkin_delivery" is a
    //    superstring of "vy_room_checkin" and must be matched FIRST. ───────
    if (has("from vy_room_checkin_delivery")) return [];
    if (has("from vy_room_follower_day")) return [{ last_24h: 0 }];
    if (has("as total") && has("from vy_room_follower")) {
      return [{ total: 0, paid: 0, joined_7d: 0, at_cap: 0, voice_seconds: 0 }];
    }
    if (has("from vy_room_checkin")) return [{ active: 0 }];
    if (has("from vy_room_subscription") && has("count(*) filter (where state = 'created')")) {
      return [{ created: 0, authenticated: 0, active: 0, paused: 0, cancelled: 0, expired: 0 }];
    }
    if (has("from vy_payment_event")) return [{ this_month_inr: 0 }];
    if (has("from vy_replica_drift_report")) return [];
    // readPulse's own `ownedRoomHandle` lookup (`select room_id, created_at,
    // published_at from vy_room where owner_user_id = $1 and replica_id =
    // $2`) is deliberately NOT modelled: it falls through to this function's
    // final "unhandled statement" throw below, and roomOverview wraps the
    // WHOLE readPulse call in `.catch(() => null)` - so that throw is not a
    // gap in this fixture, it exercises the real fallback path rather than
    // sidestepping it with three more Pulse queries this suite does not need
    // to re-prove (evals/pulse/run.mjs already does).

    // ── orgSubscriptionStatus's own subscription select ─────────────────
    if (has("from vy_org_subscription") && has("order by created_at desc")) {
      const [orgId] = params;
      return state.orgSubscriptions.filter((s) => s.org_id === orgId).sort((a, b) => b.created_at.localeCompare(a.created_at));
    }

    // ── listMyOrgs ───────────────────────────────────────────────────────
    if (has("join vy_org o on o.org_id = m.org_id") && has("where m.owner_user_id")) {
      const [ownerId] = params;
      return state.orgMembers
        .filter((m) => m.owner_user_id === ownerId)
        .map((m) => {
          const org = state.orgs.find((o) => o.org_id === m.org_id);
          // WS-R127 (migration 132): the SAME statement's own correlated
          // `max(sent_at)` subquery, modelled here exactly as the real SQL
          // reads it - most recent send across every channel.
          const sent = state.orgWeeklyNotes.filter((n) => n.org_id === m.org_id).map((n) => n.sent_at).sort().pop() || null;
          return {
            ...org, role: m.role, seats_used: state.rooms.filter((r) => r.org_id === m.org_id).length,
            seats_paid: effectiveSeatCap(org, state), weekly_note_last_sent_at: sent,
          };
        });
    }

    // ── listOrgMembers's own list select ─────────────────────────────────
    if (has("select owner_user_id, role, added_at from vy_org_member where org_id")) {
      const [orgId] = params;
      return state.orgMembers.filter((m) => m.org_id === orgId).sort((a, b) => a.added_at.localeCompare(b.added_at));
    }

    // ── roomSuiteStatus ──────────────────────────────────────────────────
    if (has("join vy_org o on o.org_id = r.org_id") && has("from vy_room r")) {
      const [ownerId, replicaId] = params;
      const room = state.rooms.find((r) => r.owner_user_id === ownerId && r.replica_id === replicaId);
      if (!room || !room.org_id) return [];
      const org = state.orgs.find((o) => o.org_id === room.org_id);
      return org ? [{ org_id: org.org_id, name: org.name, slug: org.slug }] : [];
    }

    // ── seatCoversCreatorTier ────────────────────────────────────────────
    if (has("select exists (") && has("vy_org_subscription s on s.org_id = r.org_id")) {
      const [ownerId, replicaId] = params;
      const room = state.rooms.find((r) => r.owner_user_id === ownerId && r.replica_id === replicaId);
      const covered = Boolean(room?.org_id) && state.orgSubscriptions.some((s) => s.org_id === room.org_id && s.state === "active");
      return [{ covered }];
    }

    throw new Error("orgDb: unhandled statement: " + sql.slice(0, 160));
  };
  return db;
}

// ═════════════════════════════════════════════════════════════════════════
// §1 - createOrg: the creating admin's own membership row lands atomically.
// ═════════════════════════════════════════════════════════════════════════
console.log("── §1: createOrg ──");
{
  const state = freshState();
  const db = orgDb(state);
  const org = await createOrg(db, ADMIN_A, { name: "West Studio", plan: "starter", seatLimit: 3 });
  ok("createOrg returns the new org with the right seat limit", org.seat_limit === 3 && org.plan === "starter");
  ok("createOrg wrote exactly one membership row, and it is the creator as admin",
    state.orgMembers.filter((m) => m.org_id === org.org_id).length === 1 &&
    state.orgMembers[0].owner_user_id === ADMIN_A && state.orgMembers[0].role === "admin");

  let threw = null;
  try { await createOrg(db, ADMIN_A, { name: "West Studio", plan: "starter", seatLimit: 3, slug: "west-studio" }); } catch (e) { threw = e; }
  ok("a duplicate slug is refused by name (org_slug_taken), never a raw constraint error",
    threw instanceof OrgError && threw.code === "org_slug_taken");

  let badLimit = null;
  try { await createOrg(db, ADMIN_A, { name: "Bad", seatLimit: 0 }); } catch (e) { badLimit = e; }
  ok("a seat limit outside 1..500 is refused before any write", badLimit?.code === "org_seat_limit_invalid");
}

// ═════════════════════════════════════════════════════════════════════════
// §2 - inviteMember writes nothing; acceptMembership is the creator's own act.
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── §2: inviteMember (no write) and acceptMembership (self-consent) ──");
{
  const state = freshState();
  seedTwoOrgsTwoRooms(state);
  const db = orgDb(state);
  const before = state.orgMembers.length;

  const invite = await inviteMember(db, ADMIN_A, ORG_A);
  ok("inviteMember returns the Suite's own name/slug", invite.name === "North Coaching" && invite.slug === "north-coaching");
  ok("inviteMember writes NOTHING - the membership table is byte-for-byte unchanged",
    state.orgMembers.length === before);

  let threw = null;
  try { await inviteMember(db, STRANGER, ORG_A); } catch (e) { threw = e; }
  ok("inviteMember refuses a non-admin caller with org_not_found (404 by name, existence never disclosed)",
    threw instanceof OrgError && threw.code === "org_not_found" && threw.status === 404);

  const membership = await acceptMembership(db, STRANGER, ORG_A);
  ok("acceptMembership writes the CALLER's own row as 'creator'",
    membership.role === "creator" && membership.owner_user_id === STRANGER);
  ok("the row exists in the fixture, written by the caller's own action",
    state.orgMembers.some((m) => m.org_id === ORG_A && m.owner_user_id === STRANGER && m.role === "creator"));

  const stamp1 = state.orgMembers.find((m) => m.org_id === ORG_A && m.owner_user_id === STRANGER).added_at;
  await new Promise((r) => setTimeout(r, 2));
  const again = await acceptMembership(db, STRANGER, ORG_A);
  ok("calling acceptMembership twice does not move the timestamp (first write wins)", again.added_at === stamp1);

  let missing = null;
  try { await acceptMembership(db, STRANGER, "99999999-0000-4000-8000-000000000099"); } catch (e) { missing = e; }
  ok("accepting membership in a Suite that does not exist is refused by name", missing?.code === "org_not_found");
}

// ═════════════════════════════════════════════════════════════════════════
// §3 - attachRoom: law 2. Every named refusal, and the boundary.
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── §3: attachRoom (law 2, one predicate write) ──");
{
  const state = freshState();
  seedTwoOrgsTwoRooms(state);
  const db = orgDb(state);

  const attached = await attachRoom(db, ADMIN_A, ORG_A, ROOM_A);
  ok("a legitimate attach (admin + seat + accepted creator) succeeds", attached.org_id === ORG_A);
  ok("the room row itself now carries the org_id", state.rooms.find((r) => r.room_id === ROOM_A).org_id === ORG_A);
}

{
  // not_admin: CREATOR_B is a member of ORG_B, not an admin of ORG_A.
  const state = freshState();
  seedTwoOrgsTwoRooms(state);
  const db = orgDb(state);
  let threw = null;
  try { await attachRoom(db, CREATOR_B, ORG_A, ROOM_A); } catch (e) { threw = e; }
  ok("not_admin: a caller who is not an admin of the target org is refused by name",
    threw instanceof OrgError && threw.code === "not_admin");
  ok("NEGATIVE CONTROL (a): the refused attach wrote NOTHING - the room's org_id is still null",
    state.rooms.find((r) => r.room_id === ROOM_A).org_id === null);
}

{
  // creator_not_member: ROOM_A's owner (CREATOR_A) is a creator of ORG_A
  // already in the base fixture, so use a THIRD room whose owner never
  // accepted anything.
  const state = freshState();
  seedTwoOrgsTwoRooms(state);
  const db = orgDb(state);
  const ROOM_C = "d1000000-0000-4000-8000-00000000000c";
  state.rooms.push({
    room_id: ROOM_C, slug: "room-c", display_name: "Room C", replica_id: "c1000000-0000-4000-8000-00000000000c",
    owner_user_id: STRANGER, org_id: null, free_monthly_messages: 20, paid_monthly_messages: 500,
    published_at: null, paused_at: null, created_at: "2026-09-01T00:03:00.000Z",
  });
  let threw = null;
  try { await attachRoom(db, ADMIN_A, ORG_A, ROOM_C); } catch (e) { threw = e; }
  ok("creator_not_member: the room's own owner never accepted membership in this org",
    threw instanceof OrgError && threw.code === "creator_not_member");
}

{
  // no_seat: at the exact boundary (seats_used === seat_limit refuses;
  // seats_used === seat_limit - 1 succeeds).
  const state = freshState();
  seedTwoOrgsTwoRooms(state);
  state.orgs.find((o) => o.org_id === ORG_A).seat_limit = 1;
  const db = orgDb(state);
  await attachRoom(db, ADMIN_A, ORG_A, ROOM_A);
  ok("at seat_limit 1, the first attach (0 used -> 1) succeeds", state.rooms.find((r) => r.room_id === ROOM_A).org_id === ORG_A);

  const ROOM_D = "d1000000-0000-4000-8000-00000000000d";
  state.rooms.push({
    room_id: ROOM_D, slug: "room-d", display_name: "Room D", replica_id: "c1000000-0000-4000-8000-00000000000d",
    owner_user_id: CREATOR_A, org_id: null, free_monthly_messages: 20, paid_monthly_messages: 500,
    published_at: null, paused_at: null, created_at: "2026-09-01T00:04:00.000Z",
  });
  let threw = null;
  try { await attachRoom(db, ADMIN_A, ORG_A, ROOM_D); } catch (e) { threw = e; }
  ok("no_seat: at the exact boundary (1 used, limit 1) the SECOND attach is refused by name",
    threw instanceof OrgError && threw.code === "no_seat" && threw.details.seats_used === 1 && threw.details.seat_limit === 1);
  ok("the refused room's org_id is still null", state.rooms.find((r) => r.room_id === ROOM_D).org_id === null);
}

{
  // room_already_attached and room_not_found - the two structural refusals
  // beyond the three named ones.
  const state = freshState();
  seedTwoOrgsTwoRooms(state);
  const db = orgDb(state);
  let already = null;
  try { await attachRoom(db, CREATOR_B, ORG_B, ROOM_B); } catch (e) { already = e; }
  ok("room_already_attached: ROOM_B is already in ORG_B", already?.code === "room_already_attached");

  let notFound = null;
  try { await attachRoom(db, ADMIN_A, ORG_A, "99999999-0000-4000-8000-000000000099"); } catch (e) { notFound = e; }
  ok("room_not_found: attaching a room id that does not exist", notFound?.code === "room_not_found");
}

// ═════════════════════════════════════════════════════════════════════════
// §3b - migration 108: attachRoom opens a vy_room_org_attachment row in the
// SAME statement, and two open rows for one Room are refused by the index.
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── §3b: migration 108, attachRoom opens history ──");
{
  const state = freshState();
  seedTwoOrgsTwoRooms(state);
  const db = orgDb(state);
  await attachRoom(db, ADMIN_A, ORG_A, ROOM_A);
  ok("attachRoom opened exactly one vy_room_org_attachment row",
    state.orgAttachments.filter((a) => a.room_id === ROOM_A).length === 1);
  const row = state.orgAttachments.find((a) => a.room_id === ROOM_A);
  ok("the opened row names the right org and is still open (detached_at null)",
    row.org_id === ORG_A && row.detached_at === null);
  ok("the opened row's attached_at matches the room's own org_attached_at (same statement, same value)",
    row.attached_at === state.rooms.find((r) => r.room_id === ROOM_A).org_attached_at);
}
{
  // NEGATIVE CONTROL: two open rows for one Room refused by the index. A
  // room whose OWN org_id is null (so attachRoom's write predicate is
  // satisfiable) but whose attachment HISTORY already carries an open row -
  // a state the real schema should never reach through this file's own
  // write path, modelled directly to prove the partial unique index's own
  // refusal, not merely trusted to exist.
  const state = freshState();
  seedTwoOrgsTwoRooms(state);
  const db = orgDb(state);
  state.orgAttachments.push({ room_id: ROOM_A, org_id: ORG_B, attached_at: "2026-08-01T00:00:00.000Z", detached_at: null });
  let threw = null;
  try { await attachRoom(db, ADMIN_A, ORG_A, ROOM_A); } catch (e) { threw = e; }
  ok("NEGATIVE CONTROL: a second open attachment row for the same Room is refused (unique violation, code 23505)",
    threw?.code === "23505");
  ok("the refused attach left the room's own org_id untouched",
    state.rooms.find((r) => r.room_id === ROOM_A).org_id === null);
  ok("still exactly one open row for the Room (the stray one, untouched)",
    state.orgAttachments.filter((a) => a.room_id === ROOM_A && a.detached_at === null).length === 1);
}

// ═════════════════════════════════════════════════════════════════════════
// §4 - detachRoom: the room's own owner OR an org admin, self-service exit.
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── §4: detachRoom ──");
{
  const state = freshState();
  seedTwoOrgsTwoRooms(state);
  const db = orgDb(state);
  const detached = await detachRoom(db, CREATOR_B, ROOM_B);
  ok("the room's own owner can detach it", detached.org_id === null);
  ok("the room row itself is cleared", state.rooms.find((r) => r.room_id === ROOM_B).org_id === null);
}
{
  // A distinct member's room, so this proves the ADMIN path rather than
  // reusing the owner path the previous block already covers.
  const state = freshState();
  seedTwoOrgsTwoRooms(state);
  const db = orgDb(state);
  const OTHER_CREATOR = "c0000000-0000-4000-8000-00000000000e";
  const ROOM_E = "d1000000-0000-4000-8000-00000000000e";
  state.orgMembers.push({ org_id: ORG_B, owner_user_id: OTHER_CREATOR, role: "creator", added_at: "2026-09-01T00:02:00.000Z" });
  state.rooms.push({
    room_id: ROOM_E, slug: "room-e", display_name: "Room E", replica_id: "c1000000-0000-4000-8000-00000000000e",
    owner_user_id: OTHER_CREATOR, org_id: ORG_B, free_monthly_messages: 20, paid_monthly_messages: 500,
    published_at: null, paused_at: null, created_at: "2026-09-01T00:03:00.000Z",
  });
  const detached = await detachRoom(db, CREATOR_B, ROOM_E); // CREATOR_B is ORG_B's admin, not ROOM_E's owner
  ok("an org admin can detach a DIFFERENT member's room (not merely their own)", detached.org_id === null);
  ok("the member's own room row is cleared", state.rooms.find((r) => r.room_id === ROOM_E).org_id === null);
}
{
  const state = freshState();
  seedTwoOrgsTwoRooms(state);
  const db = orgDb(state);
  let threw = null;
  try { await detachRoom(db, ADMIN_A, ROOM_B); } catch (e) { threw = e; } // ADMIN_A has no standing over ORG_B
  ok("a stranger to the org (neither the room's owner nor its admin) is refused",
    threw instanceof OrgError && threw.code === "not_authorized");
  ok("the refused detach wrote nothing", state.rooms.find((r) => r.room_id === ROOM_B).org_id === ORG_B);
}

// ═════════════════════════════════════════════════════════════════════════
// §4b - migration 108: detachRoom closes the open history row in the SAME
// statement; a detach that does not close it is a bug this control catches.
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── §4b: migration 108, detachRoom closes history ──");
{
  const state = freshState();
  seedTwoOrgsTwoRooms(state);
  const db = orgDb(state);
  await attachRoom(db, ADMIN_A, ORG_A, ROOM_A);
  await new Promise((r) => setTimeout(r, 2));
  await detachRoom(db, CREATOR_A, ROOM_A);
  const rows = state.orgAttachments.filter((a) => a.room_id === ROOM_A);
  ok("exactly one attachment row exists for the Room (never a second one opened by the detach)", rows.length === 1);
  ok("A DETACH THAT DOES NOT CLOSE THE ROW FAILS THIS: the row's detached_at is set, not null",
    rows[0].detached_at !== null);
  ok("the close happened AFTER the open (a real interval, not a same-instant no-op)",
    rows[0].detached_at > rows[0].attached_at);
  ok("no open row remains for the Room, so a fresh attach afterwards would not collide",
    !state.orgAttachments.some((a) => a.room_id === ROOM_A && a.detached_at === null));
}

// ═════════════════════════════════════════════════════════════════════════
// §5 - orgBoard: law 3. 404 by name for a non-member; a Suite's board never
// shows a Room that belongs to a DIFFERENT Suite.
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── §5: orgBoard (law 3, aggregate-only, per-Suite isolation) ──");
{
  const state = freshState();
  seedTwoOrgsTwoRooms(state);
  const db = orgDb(state);
  await attachRoom(db, ADMIN_A, ORG_A, ROOM_A);

  const board = await orgBoard(db, ORG_A, ADMIN_A);
  ok("orgBoard returns exactly the Suite's own room(s)", board.rooms.length === 1 && board.rooms[0].room_id === ROOM_A);
  ok("seats_used/seats_free arithmetic is real, not guessed", board.seats_used === 1 && board.seats_free === 1);
  ok("every per-room field is a count/state, never a follower row",
    Object.keys(board.rooms[0]).every((k) => !["thread", "person_id", "message_text"].includes(k)));

  // WS-R54 (migration 108): attachment_history is counts and dates, never a
  // follower, and OUTLIVES a detach - it names a Room even after the Room
  // has left `rooms` above, which `orgBoard`'s room list (scoped by the
  // Room's own LIVE org_id) cannot do.
  ok("attachment_history carries exactly the one open interval just created",
    board.attachment_history.count === 1 && board.attachment_history.currently_attached === 1);
  ok("attachment_history's one item names the room and dates, no follower field",
    board.attachment_history.items[0].room_id === ROOM_A &&
    board.attachment_history.items[0].detached_at === null &&
    typeof board.attachment_history.items[0].attached_at === "string" &&
    Object.keys(board.attachment_history.items[0]).every((k) => !["person_id", "thread_id", "message_text"].includes(k)));

  await detachRoom(db, CREATOR_A, ROOM_A);
  const boardAfterDetach = await orgBoard(db, ORG_A, ADMIN_A);
  ok("after a detach, the Room leaves the live rooms list", boardAfterDetach.rooms.length === 0);
  ok("but attachment_history still remembers it, now closed",
    boardAfterDetach.attachment_history.count === 1 &&
    boardAfterDetach.attachment_history.currently_attached === 0 &&
    boardAfterDetach.attachment_history.items[0].detached_at !== null);

  // NEGATIVE CONTROL (c): ORG_B's own board never shows ORG_A's room, and
  // ORG_A's board never shows ROOM_B (still attached to ORG_B throughout).
  const boardB = await orgBoard(db, ORG_B, CREATOR_B);
  ok("NEGATIVE CONTROL (c): a Room attached to org A is invisible to org B's board",
    !boardB.rooms.some((r) => r.room_id === ROOM_A) && boardB.rooms.some((r) => r.room_id === ROOM_B));
  ok("NEGATIVE CONTROL (c), other direction: org A's board never shows org B's room",
    !board.rooms.some((r) => r.room_id === ROOM_B));

  let threw = null;
  try { await orgBoard(db, ORG_A, STRANGER); } catch (e) { threw = e; }
  ok("an admin who is not a member of that org gets 404 by name (existence never disclosed)",
    threw instanceof OrgError && threw.code === "org_not_found" && threw.status === 404);
}

// NEGATIVE CONTROL (b): the SAME aggregate-only parser evals/room-leak/run.mjs
// runs would catch a follower-leaking select list, if one were ever added
// here. `_org.js` itself has none today (it delegates to `api/_ops.js`'s
// proven `roomOverview`); this proves the PARSER, copied inline exactly as
// evals/funnel/run.mjs's own §5 does (that file's own comment: "no exported
// entry point, by design").
console.log("\n── §5b: NEGATIVE CONTROL (b), the aggregate-only parser ──");
{
  function aggregateOnlyVerdict(statementText) {
    const selectList = (statementText.match(/select([\s\S]*?)\sfrom\s/i) || [, ""])[1];
    const items = []; let depth = 0, cur = "";
    for (const ch of selectList) {
      if (ch === "(") depth++; else if (ch === ")") depth--;
      if (ch === "," && depth === 0) { items.push(cur); cur = ""; } else cur += ch;
    }
    if (cur.trim()) items.push(cur);
    const aggregateOnly = items.length > 0 && items.every((c) => /\b(count|sum|min)\s*\(/i.test(c));
    const touchesPerson = /person_id|thread_id|\btitle\b|\bf\.\*|content|message_text/i.test(selectList);
    return { aggregateOnly, touchesPerson, leaks: !aggregateOnly || touchesPerson };
  }
  const cleanStmt = "select count(*)::int as total from vy_room_follower where room_id = ($1)::uuid";
  ok("a real aggregate-only statement passes", !aggregateOnlyVerdict(cleanStmt).leaks);
  const leaking = "select person_id, count(*)::int as total from vy_room_follower where room_id = ($1)::uuid";
  ok("NEGATIVE CONTROL (b): a select list with a bare follower column (person_id) FAILS the parser",
    aggregateOnlyVerdict(leaking).leaks);

  const orgSrc = fs.readFileSync(join(REPO, "api/_org.js"), "utf8");
  ok("api/_org.js's own source names neither vy_room_follower nor vy_room_thread today (it reuses roomOverview)",
    !orgSrc.includes("vy_room_follower") && !orgSrc.includes("vy_room_thread"));
}

// ═════════════════════════════════════════════════════════════════════════
// §6 - orgSubscriptionStatus, listMyOrgs, listOrgMembers, roomSuiteStatus.
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── §6: the remaining reads ──");
{
  const state = freshState();
  seedTwoOrgsTwoRooms(state);
  const db = orgDb(state);

  const empty = await orgSubscriptionStatus(db, ADMIN_A, ORG_A);
  ok("orgSubscriptionStatus reports a real null, never a fake row, when nothing was ever started",
    empty.subscription === null);

  state.orgSubscriptions.push({
    subscription_id: "f0000000-0000-4000-8000-000000000001", org_id: ORG_A, plan: "starter", seats: 2,
    price_per_seat_inr: 2999, currency: "INR", state: "active", provider: "fake",
    current_period_start: "2026-09-01T00:00:00.000Z", current_period_end: "2026-10-01T00:00:00.000Z",
    created_at: "2026-09-01T00:00:00.000Z",
  });
  const withSub = await orgSubscriptionStatus(db, ADMIN_A, ORG_A);
  ok("orgSubscriptionStatus reads back a real subscription row", withSub.subscription.state === "active" && withSub.subscription.seats === 2);

  let threw = null;
  try { await orgSubscriptionStatus(db, STRANGER, ORG_A); } catch (e) { threw = e; }
  ok("orgSubscriptionStatus is admin-only, 404 by name for a non-member", threw?.code === "org_not_found");

  const mine = await listMyOrgs(db, CREATOR_A);
  ok("listMyOrgs returns every Suite this owner belongs to, with their own role", mine.length === 1 && mine[0].role === "creator");
  // WS-R127 (migration 132): the Suite board's own "Your weekly note" line.
  ok("listMyOrgs: a Suite that has never received a weekly note reports null, not a fake date", mine[0].weekly_note.last_sent_at === null);
  state.orgWeeklyNotes.push({ org_id: ORG_A, week_start: "2026-09-07", sent_at: "2026-09-07T00:05:00.000Z", channel: "push" });
  const mineAfter = await listMyOrgs(db, CREATOR_A);
  ok("listMyOrgs: once a send lands, weekly_note.last_sent_at names the real timestamp", mineAfter[0].weekly_note.last_sent_at === "2026-09-07T00:05:00.000Z");
  const otherOrg = await listMyOrgs(db, CREATOR_B);
  ok("listMyOrgs: a DIFFERENT Suite's own weekly note is never mixed into ORG_A's admin's own read", (otherOrg.find((o) => o.org_id === ORG_B)?.weekly_note.last_sent_at ?? null) === null);

  const members = await listOrgMembers(db, ADMIN_A, ORG_A);
  ok("listOrgMembers returns the roster (admin + creator)",
    members.length === 2 && members.some((m) => m.role === "admin") && members.some((m) => m.role === "creator"));

  let membersThrew = null;
  try { await listOrgMembers(db, STRANGER, ORG_A); } catch (e) { membersThrew = e; }
  ok("listOrgMembers is admin-only", membersThrew?.code === "org_not_found");

  const noSuite = await roomSuiteStatus(db, CREATOR_A, REPLICA_A);
  ok("roomSuiteStatus is null for a room that belongs to no Suite", noSuite === null);
  await attachRoom(db, ADMIN_A, ORG_A, ROOM_A);
  const suite = await roomSuiteStatus(db, CREATOR_A, REPLICA_A);
  ok("roomSuiteStatus names the Suite once attached", suite?.name === "North Coaching");
}

// ═════════════════════════════════════════════════════════════════════════
// §7 - the tier exemption predicate (law 4). Nothing calls it yet (no
// creator tier charge exists in this codebase); this proves the seam.
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── §7: seatCoversCreatorTier (law 4's predicate) ──");
{
  const state = freshState();
  seedTwoOrgsTwoRooms(state);
  const db = orgDb(state);

  ok("no Suite, no exemption", (await seatCoversCreatorTier(db, CREATOR_A, REPLICA_A)) === false);

  await attachRoom(db, ADMIN_A, ORG_A, ROOM_A);
  ok("attached to a Suite with no ACTIVE subscription: still not exempt (an unpaid Suite does not cover the seat)",
    (await seatCoversCreatorTier(db, CREATOR_A, REPLICA_A)) === false);

  state.orgSubscriptions.push({
    subscription_id: "f0000000-0000-4000-8000-000000000002", org_id: ORG_A, plan: "starter", seats: 2,
    price_per_seat_inr: 2999, currency: "INR", state: "active", provider: "fake",
    current_period_start: null, current_period_end: null, created_at: "2026-09-01T00:00:00.000Z",
  });
  ok("a Suite with an ACTIVE subscription exempts its creator's tier charge",
    (await seatCoversCreatorTier(db, CREATOR_A, REPLICA_A)) === true);

  ok("a DIFFERENT creator (not in this Suite) is never exempt", (await seatCoversCreatorTier(db, STRANGER, REPLICA_B)) === false);
}

// ═════════════════════════════════════════════════════════════════════════
// §8 - the last-admin rule under erasure (static: the erasure job deletes
// the MEMBERSHIP row by name and never the Suite itself).
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── §8: the erasure job removes membership, never the Suite ──");
{
  const erasureSrc = fs.readFileSync(join(REPO, "api/_replica-full-erasure.js"), "utf8");
  ok("the erasure job deletes vy_org_member by owner_user_id",
    /delete from vy_org_member x using target t\s*\n\s*where x\.owner_user_id=t\.owner_user_id/.test(erasureSrc));
  ok("the erasure job never deletes vy_org itself (an org with no admin is left standing, not removed)",
    !/delete from vy_org\b/.test(erasureSrc));
  ok("the deletion receipt names the membership class",
    erasureSrc.includes('"owner_org_membership"'));

  // scripts/relcheck.mjs's own text-boundary rule, restated: "delete from
  // vy_org_member" must NOT satisfy a bare "delete from vy_org" search - the
  // reason this migration could name the column `owner_user_id` on
  // vy_org_member while never being asked to delete vy_org itself.
  ok("the word-boundary distinction the migration's header relies on actually holds in this JS engine",
    !/delete from vy_org\b/.test("delete from vy_org_member x using target t where x.owner_user_id=t.owner_user_id"));
}

// ═════════════════════════════════════════════════════════════════════════
// §9 - the copy gate's own vocabulary: no "tenant"/"workspace" in this
// file's own exported error codes or the invite instructions string.
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── §9: vocabulary ──");
{
  const orgSrc = fs.readFileSync(join(REPO, "api/_org.js"), "utf8");
  ok('api/_org.js never says "tenant"', !/\btenant\b/i.test(orgSrc));
  ok('api/_org.js never says "workspace"', !/\bworkspace\b/i.test(orgSrc));
}

console.log(`\norg: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
