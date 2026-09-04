// Suites v0 - the B2B unit (WS-R28, migration 091). An organisation owns
// seats, never a follower.
//
// Rooms sells to a creator (B2C). This file is the mechanism a later phase
// reuses to sell the same product to an institute, a gym, a clinic: a Suite
// is an organisation that pays for seats, each seat is one creator's Room (a
// coach, a teacher, a doctor), and the organisation sees what a creator sees
// on their own Room, only as COUNTS. The GroupAI kernel (../Vyakti-GroupAI,
// packages/relational-core) is the Phase 3 cross-Room disclosure port and is
// NOT built here - nothing in this file lets one Room see another Room's
// followers, threads or anything a person said. Bridge stays locked.
//
// ── LAW 1: consent is a write, never a grant on someone else's behalf ─────
//
// `vy_org_member` rows are written in exactly two shapes: `createOrg`, which
// writes the CREATING admin's own row (their own action, about themselves),
// and `acceptMembership`, which writes a CREATOR'S own row (their own
// action, about themselves, using their own already-authenticated identity -
// never an admin's). There is no function anywhere in this file that lets an
// admin write a role='creator' row naming somebody else's owner_user_id.
// `inviteMember` therefore never touches the database: v0 has no Supabase
// email lookup (this file's own header restates the workstream brief's own
// words), so the only thing an admin CAN safely hand a prospective member is
// this Suite's own name/slug/id, out of band, for that person to bring back
// through their OWN `acceptMembership` call - "consent is a SQL predicate,
// never a prompt instruction" (AGENTS.md), applied to a membership row
// instead of a disclosure grant.
//
// ── LAW 2: attaching a Room is a predicate on the write, never a branch
//    above it (`api/_room-publish.js`'s publish lock, restated) ──────────
//
// `attachRoom`'s UPDATE carries all three conditions Postgres must agree on
// in its own WHERE clause: the caller is an admin of the target org, the org
// has a free seat (a live count, in the SAME statement, never read
// separately and trusted), and the Room's own owner has already accepted
// membership. Zero rows means refused; the reason is read back from a
// SECOND, cheap, diagnostic select, run ONLY after a zero-row result, never
// before the write and never as the enforcement itself - `publishRoom`'s own
// "the courtesy layer... can be wrong in only one direction, the safe one"
// argument, copied rather than re-argued.
//
// ── LAW 3: the org admin's read is aggregate-only, every statement ────────
//
// `orgBoard` never queries a follower or a thread table itself. It loops
// the Suite's own Rooms and calls `api/_ops.js`'s `roomOverview` for
// each - the SAME per-Room aggregate shape the platform-operator board
// already proves out and that file's own header already admits to
// `evals/room-leak/run.mjs`'s AGGREGATE_ONLY class, imported here rather than
// re-derived so a Suite admin's numbers can never disagree with what the
// platform's own ops board would show for the same Room -
// `api/_funnel.js`'s `opsFunnel` reused-not-rederived precedent, restated for
// a second aggregator reading the first's own leaf function. This file is
// still named in `evals/room-leak/run.mjs`'s AGGREGATE_ONLY set (see that
// file's own comment) as a forward guard: the day a future edit adds a
// direct follower/thread query HERE rather than through `roomOverview`, that
// scanner starts holding this file's own select lists to the same rule.
import { randomUUID } from "node:crypto";
import { normalizeSlug } from "./_room-publish.js";
import { roomOverview } from "./_ops.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class OrgError extends Error {
  constructor(code, status = 400, details) {
    super(code);
    this.code = code;
    this.status = status;
    if (details) this.details = details;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// THE PRICE - named constants, not a table. Nobody has priced a Suite seat
// yet; these are the owner's PLACEHOLDERS, carried the same way
// `api/_payments.js`'s ROOM_PRICE_MIN_INR/MAX are: a real number so the UI
// has something honest to show, never presented as a measured or final
// figure. `context/rejected.md`'s no-fake-numbers law applied to a price
// nobody has set, restated from `api/_payments.js`'s own TDS_RATE_BP_DEFAULT.
// ─────────────────────────────────────────────────────────────────────────
export const SUITE_SEAT_PRICE_STARTER_INR = 2999;
export const SUITE_SEAT_PRICE_INSTITUTE_INR = 1999;
export const SUITE_SEAT_PRICE_INSTITUTE_MIN_SEATS = 10;
export const SUITE_SEAT_LIMIT_MIN = 1;
export const SUITE_SEAT_LIMIT_MAX = 500;

function isUniqueViolation(error, indexName) {
  return error && error.code === "23505" && (!indexName || String(error.message || "").includes(indexName));
}

function assertUuid(value, code) {
  if (!UUID.test(String(value || ""))) throw new OrgError(code, 400);
  return String(value).toLowerCase();
}

function clientOrg(row) {
  if (!row) return null;
  return {
    org_id: row.org_id,
    name: row.name,
    slug: row.slug,
    plan: row.plan,
    seat_limit: Number(row.seat_limit),
    created_at: row.created_at,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// OP: create - the creating admin's own membership row, in the SAME
// statement as the org row, so the two can never disagree about whether a
// brand new Suite has an admin.
// ─────────────────────────────────────────────────────────────────────────
export async function createOrg(db, ownerUserId, { name, plan, seatLimit, slug } = {}) {
  const owner = assertUuid(ownerUserId, "org_owner_identity_invalid");
  const trimmedName = String(name || "").trim().slice(0, 120);
  if (!trimmedName) throw new OrgError("org_name_required", 400);
  const orgPlan = plan === "institute" ? "institute" : "starter";
  const limit = Number.isFinite(Number(seatLimit)) ? Math.trunc(Number(seatLimit)) : 1;
  if (limit < SUITE_SEAT_LIMIT_MIN || limit > SUITE_SEAT_LIMIT_MAX) {
    throw new OrgError("org_seat_limit_invalid", 400, { min: SUITE_SEAT_LIMIT_MIN, max: SUITE_SEAT_LIMIT_MAX });
  }
  const base = normalizeSlug(slug || trimmedName);
  const proposed = (base.length >= 3 ? base : `${base ? `${base}-` : ""}suite`).slice(0, 40);
  if (proposed.length < 3) throw new OrgError("org_slug_invalid", 400);

  try {
    const rows = await db(
      `with new_org as (
         insert into vy_org (org_id, name, slug, created_by_user_id, plan, seat_limit)
         values (($1)::uuid, $2, $3, ($4)::uuid, $5, ($6)::int)
         returning org_id, name, slug, plan, seat_limit, created_at
       ), admin_member as (
         insert into vy_org_member (org_id, owner_user_id, role)
         select org_id, ($4)::uuid, 'admin' from new_org
         returning org_id
       )
       select * from new_org`,
      [randomUUID(), trimmedName, proposed, owner, orgPlan, limit],
    );
    if (!rows[0]) throw new OrgError("org_create_failed", 503);
    return clientOrg(rows[0]);
  } catch (error) {
    if (isUniqueViolation(error, "vy_org_slug_ix")) {
      throw new OrgError("org_slug_taken", 409, { slug: proposed });
    }
    throw error;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// OP: inviteMember - NO write. See this file's header, law 1.
// ─────────────────────────────────────────────────────────────────────────
export async function inviteMember(db, adminOwnerUserId, orgId) {
  const admin = assertUuid(adminOwnerUserId, "org_owner_identity_invalid");
  const org = assertUuid(orgId, "org_identity_invalid");
  const rows = await db(
    `select o.org_id, o.name, o.slug
       from vy_org o
       join vy_org_member m on m.org_id = o.org_id and m.owner_user_id = ($2)::uuid and m.role = 'admin'
      where o.org_id = ($1)::uuid
      limit 1`,
    [org, admin],
  );
  if (!rows[0]) throw new OrgError("org_not_found", 404);
  return {
    org_id: rows[0].org_id,
    name: rows[0].name,
    slug: rows[0].slug,
    // v0 has no email lookup (this file's header). The admin shares the
    // Suite's own id or slug with the creator out of band; the creator
    // brings it back through their OWN acceptMembership call, authenticated
    // as themselves.
    instructions: "Share this Suite's id with the creator. They accept it from their own account; nobody can add them for them.",
  };
}

// ─────────────────────────────────────────────────────────────────────────
// OP: acceptMembership - a creator's own consent act. First write wins:
// on conflict do nothing means calling this twice, or after already being an
// admin of the same org, never overwrites an existing row.
// ─────────────────────────────────────────────────────────────────────────
export async function acceptMembership(db, ownerUserId, orgId) {
  const owner = assertUuid(ownerUserId, "org_owner_identity_invalid");
  const org = assertUuid(orgId, "org_identity_invalid");
  const rows = await db(
    `with target as (
       select org_id from vy_org where org_id = ($1)::uuid
     ), inserted as (
       insert into vy_org_member (org_id, owner_user_id, role)
       select org_id, ($2)::uuid, 'creator' from target
       on conflict (org_id, owner_user_id) do nothing
       returning org_id
     )
     select
       (select count(*) from target)::int as org_exists,
       (select role from vy_org_member where org_id = ($1)::uuid and owner_user_id = ($2)::uuid) as role,
       (select added_at from vy_org_member where org_id = ($1)::uuid and owner_user_id = ($2)::uuid) as added_at`,
    [org, owner],
  );
  const row = rows[0];
  if (!row || !Number(row.org_exists)) throw new OrgError("org_not_found", 404);
  return { org_id: org, owner_user_id: owner, role: row.role, added_at: row.added_at };
}

// ─────────────────────────────────────────────────────────────────────────
// OP: attachRoom - law 2. ONE UPDATE carries every condition; the diagnostic
// read runs only after a zero-row result.
// ─────────────────────────────────────────────────────────────────────────
export async function attachRoom(db, adminOwnerUserId, orgId, roomId) {
  const admin = assertUuid(adminOwnerUserId, "org_owner_identity_invalid");
  const org = assertUuid(orgId, "org_identity_invalid");
  const room = assertUuid(roomId, "room_identity_invalid");

  const rows = await db(
    `update vy_room r
        set org_id = ($2)::uuid, updated_at = now()
      where r.room_id = ($1)::uuid
        and r.org_id is null
        and exists (
          select 1 from vy_org_member m
           where m.org_id = ($2)::uuid and m.owner_user_id = ($3)::uuid and m.role = 'admin'
        )
        and exists (
          select 1 from vy_org_member m2
           where m2.org_id = ($2)::uuid and m2.owner_user_id = r.owner_user_id and m2.role = 'creator'
        )
        and (select count(*) from vy_room r2 where r2.org_id = ($2)::uuid)
          < (select seat_limit from vy_org o where o.org_id = ($2)::uuid)
      returning r.room_id, r.org_id, r.slug`,
    [room, org, admin],
  );
  if (rows[0]) return { room_id: rows[0].room_id, org_id: rows[0].org_id, slug: rows[0].slug };

  // ── the courtesy layer: WHY, never the enforcement (see this file's
  //    header) ─────────────────────────────────────────────────────────
  const diag = await db(
    `select
        (select 1 from vy_room where room_id = ($1)::uuid) is not null as room_exists,
        (select org_id from vy_room where room_id = ($1)::uuid) as current_org_id,
        exists (
          select 1 from vy_org_member where org_id = ($2)::uuid and owner_user_id = ($3)::uuid and role = 'admin'
        ) as is_admin,
        exists (
          select 1 from vy_org_member m2
            join vy_room r on r.room_id = ($1)::uuid
           where m2.org_id = ($2)::uuid and m2.owner_user_id = r.owner_user_id and m2.role = 'creator'
        ) as creator_member,
        (select count(*) from vy_room where org_id = ($2)::uuid)::int as seats_used,
        (select seat_limit from vy_org where org_id = ($2)::uuid) as seat_limit`,
    [room, org, admin],
  );
  const d = diag[0] || {};
  if (!d.room_exists) throw new OrgError("room_not_found", 404);
  if (d.current_org_id) throw new OrgError("room_already_attached", 409, { org_id: d.current_org_id });
  if (!d.is_admin) throw new OrgError("not_admin", 403);
  if (!d.creator_member) throw new OrgError("creator_not_member", 409);
  if (d.seat_limit == null) throw new OrgError("org_not_found", 404);
  if (Number(d.seats_used) >= Number(d.seat_limit)) throw new OrgError("no_seat", 409, { seats_used: Number(d.seats_used), seat_limit: Number(d.seat_limit) });
  // Every named reason above was ruled out and the write still refused - a
  // shape this predicate should be unable to produce. Refuse honestly rather
  // than report a plausible reason that was not the true one.
  throw new OrgError("room_attach_refused", 409);
}

// ─────────────────────────────────────────────────────────────────────────
// OP: detachRoom - the room's own owner, or an admin of the org it is
// attached to, may detach it. Either is a self-service exit, never a lock-in.
// ─────────────────────────────────────────────────────────────────────────
export async function detachRoom(db, callerOwnerUserId, roomId) {
  const caller = assertUuid(callerOwnerUserId, "org_owner_identity_invalid");
  const room = assertUuid(roomId, "room_identity_invalid");

  const rows = await db(
    `update vy_room r
        set org_id = null, updated_at = now()
      where r.room_id = ($1)::uuid
        and r.org_id is not null
        and (
          r.owner_user_id = ($2)::uuid
          or exists (select 1 from vy_org_member m where m.org_id = r.org_id and m.owner_user_id = ($2)::uuid and m.role = 'admin')
        )
      returning r.room_id`,
    [room, caller],
  );
  if (rows[0]) return { room_id: rows[0].room_id, org_id: null };

  const diag = await db(
    `select
        (select 1 from vy_room where room_id = ($1)::uuid) is not null as room_exists,
        (select org_id from vy_room where room_id = ($1)::uuid) as current_org_id,
        (select owner_user_id from vy_room where room_id = ($1)::uuid) as room_owner`,
    [room],
  );
  const d = diag[0] || {};
  if (!d.room_exists) throw new OrgError("room_not_found", 404);
  if (!d.current_org_id) throw new OrgError("room_not_attached", 409);
  if (String(d.room_owner) === caller) throw new OrgError("room_detach_refused", 409);
  const admin = await db(
    `select 1 from vy_org_member where org_id = ($1)::uuid and owner_user_id = ($2)::uuid and role = 'admin' limit 1`,
    [d.current_org_id, caller],
  );
  if (!admin[0]) throw new OrgError("not_authorized", 403);
  throw new OrgError("room_detach_refused", 409);
}

// ─────────────────────────────────────────────────────────────────────────
// OP: orgBoard - law 3. Admin-only; a non-member gets 404 by name, never a
// 403 - the existence of a Suite is not disclosed to someone who is not on
// its own roster, `api/_ops.js`'s own "404, never 403" rule restated.
// ─────────────────────────────────────────────────────────────────────────
export async function orgBoard(db, orgId, adminUserId, now = Date.now()) {
  const org = assertUuid(orgId, "org_identity_invalid");
  const admin = assertUuid(adminUserId, "org_owner_identity_invalid");

  const orgRows = await db(
    `select o.org_id, o.name, o.slug, o.plan, o.seat_limit, o.created_at
       from vy_org o
       join vy_org_member m on m.org_id = o.org_id and m.owner_user_id = ($2)::uuid and m.role = 'admin'
      where o.org_id = ($1)::uuid
      limit 1`,
    [org, admin],
  );
  if (!orgRows[0]) throw new OrgError("org_not_found", 404);

  // The Suite's own Rooms - no follower/thread column anywhere in this
  // select, law 3's own text restated as code.
  const rooms = await db(
    `select room_id, slug, display_name, replica_id, owner_user_id,
            free_monthly_messages, paid_monthly_messages, published_at, paused_at, created_at
       from vy_room
      where org_id = ($1)::uuid
      order by created_at asc`,
    [org],
  );

  const monthKey = `${new Date(now).toISOString().slice(0, 7)}-01T00:00:00.000Z`;
  const roomsOut = [];
  for (const room of rooms) {
    roomsOut.push(await roomOverview(db, room, monthKey, now));
  }

  const org2 = orgRows[0];
  return {
    generated_at: new Date(now).toISOString(),
    org: clientOrg(org2),
    seats_used: rooms.length,
    seats_free: Math.max(0, Number(org2.seat_limit) - rooms.length),
    rooms: roomsOut,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// OP: orgSubscriptionStatus - admin-only read. Real zeros when nothing has
// ever been started, `api/_payments.js`'s `ownerRevenue` precedent exactly.
// ─────────────────────────────────────────────────────────────────────────
export async function orgSubscriptionStatus(db, adminOwnerUserId, orgId) {
  const admin = assertUuid(adminOwnerUserId, "org_owner_identity_invalid");
  const org = assertUuid(orgId, "org_identity_invalid");

  const memberRows = await db(
    `select 1 from vy_org_member where org_id = ($1)::uuid and owner_user_id = ($2)::uuid and role = 'admin' limit 1`,
    [org, admin],
  );
  if (!memberRows[0]) throw new OrgError("org_not_found", 404);

  const rows = await db(
    `select subscription_id, plan, seats, price_per_seat_inr, currency, state,
            provider, current_period_start, current_period_end
       from vy_org_subscription
      where org_id = ($1)::uuid
      order by created_at desc
      limit 1`,
    [org],
  );
  const row = rows[0] || null;
  return {
    org_id: org,
    subscription: row && {
      subscription_id: row.subscription_id,
      plan: row.plan,
      seats: Number(row.seats),
      price_per_seat_inr: Number(row.price_per_seat_inr),
      currency: row.currency,
      state: row.state,
      provider: row.provider,
      current_period_start: row.current_period_start ?? null,
      current_period_end: row.current_period_end ?? null,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────
// OP: listMyOrgs - every Suite this owner belongs to, admin or creator, with
// the cheap seat-usage count the account card shows. No follower table.
// ─────────────────────────────────────────────────────────────────────────
export async function listMyOrgs(db, ownerUserId) {
  const owner = assertUuid(ownerUserId, "org_owner_identity_invalid");
  const rows = await db(
    `select o.org_id, o.name, o.slug, o.plan, o.seat_limit, o.created_at, m.role,
            (select count(*)::int from vy_room r2 where r2.org_id = o.org_id) as seats_used
       from vy_org_member m
       join vy_org o on o.org_id = m.org_id
      where m.owner_user_id = ($1)::uuid
      order by o.created_at asc`,
    [owner],
  );
  return rows.map((r) => ({ ...clientOrg(r), role: r.role, seats_used: Number(r.seats_used) }));
}

// ─────────────────────────────────────────────────────────────────────────
// OP: listOrgMembers - admin-only. Owner-lane ids and roles only, never a
// follower's anything.
// ─────────────────────────────────────────────────────────────────────────
export async function listOrgMembers(db, adminOwnerUserId, orgId) {
  const admin = assertUuid(adminOwnerUserId, "org_owner_identity_invalid");
  const org = assertUuid(orgId, "org_identity_invalid");
  const memberRows = await db(
    `select 1 from vy_org_member where org_id = ($1)::uuid and owner_user_id = ($2)::uuid and role = 'admin' limit 1`,
    [org, admin],
  );
  if (!memberRows[0]) throw new OrgError("org_not_found", 404);
  const rows = await db(
    `select owner_user_id, role, added_at from vy_org_member where org_id = ($1)::uuid order by added_at asc`,
    [org],
  );
  return rows.map((r) => ({ owner_user_id: r.owner_user_id, role: r.role, added_at: r.added_at }));
}

// ─────────────────────────────────────────────────────────────────────────
// OP: roomSuiteStatus - the Room card's own "Part of <Suite name>" line. Any
// owner of the room may read which Suite (if any) it belongs to; this is not
// an admin-only read because it is the creator's OWN Room being described.
// ─────────────────────────────────────────────────────────────────────────
export async function roomSuiteStatus(db, ownerUserId, replicaId) {
  const owner = assertUuid(ownerUserId, "org_owner_identity_invalid");
  const rid = assertUuid(replicaId, "org_replica_identity_invalid");
  const rows = await db(
    `select o.org_id, o.name, o.slug
       from vy_room r
       join vy_org o on o.org_id = r.org_id
      where r.owner_user_id = ($1)::uuid and r.replica_id = ($2)::uuid
      limit 1`,
    [owner, rid],
  );
  return rows[0] ? { org_id: rows[0].org_id, name: rows[0].name, slug: rows[0].slug } : null;
}

// ─────────────────────────────────────────────────────────────────────────
// LAW 4's PREDICATE - "a creator whose Room is in a paying Suite is exempt
// from the creator tier charge (the seat covers it); write this as a
// predicate the tier read consults, not as a branch in the UI." No creator
// tier charge exists anywhere in this codebase yet
// (`api/_payments.js`'s own header: "creator pays for capacity... a Phase 2
// concern, no table here"), so nothing calls this today. It is built and
// proven now so Phase 2's tier read has a seam to consult rather than a
// branch to invent, `api/_payments.js`'s own "the tier flip is a predicate,
// never a branch above the write" argument applied one product-decision
// earlier, before there is a write for it to gate at all.
// ─────────────────────────────────────────────────────────────────────────
export async function seatCoversCreatorTier(db, ownerUserId, replicaId) {
  const owner = assertUuid(ownerUserId, "org_owner_identity_invalid");
  const rid = assertUuid(replicaId, "org_replica_identity_invalid");
  const rows = await db(
    `select exists (
       select 1 from vy_room r
        join vy_org_subscription s on s.org_id = r.org_id
       where r.owner_user_id = ($1)::uuid and r.replica_id = ($2)::uuid
         and r.org_id is not null and s.state = 'active'
     ) as covered`,
    [owner, rid],
  );
  const value = rows[0]?.covered;
  return value === true || value === "t" || value === "true";
}
