// Suites v0 - the owner-authenticated door (WS-R28). Same bearer shape as
// api/replica.js; ops by name. Thin by construction: cors, rate limit, auth,
// dispatch, error shape. Every decision lives in api/_org.js, where a fake
// `db` can reach it.
//
//   POST {op:"create",          name, plan, seat_limit, slug}
//   POST {op:"invite",          org_id}
//   POST {op:"accept",          org_id}
//   POST {op:"attach_room",     org_id, room_id}
//   POST {op:"detach_room",     room_id}
//   POST {op:"board",           org_id}
//   POST {op:"subscription",    org_id}
//   POST {op:"start_subscription", org_id, plan, seats}   (WS-R33)
//   POST {op:"update_seats",    org_id, seats}            (WS-R33)
//   POST {op:"cancel_subscription", org_id}               (WS-R37)
//   POST {op:"list_mine"}
//   POST {op:"members",         org_id}
//   POST {op:"room_status",     replica_id}
import { q } from "./_db.js";
import { requireUser, AuthError } from "./_auth.js";
import { allow, ipOf } from "./_ratelimit.js";
import {
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
} from "./_org.js";
import { PaymentsError, startOrgSubscription, updateOrgSeats } from "./_payments.js";
import { cancelOrgRenewal } from "./_renewals.js";
import { withDoor } from "./_incidents.js";
import { bodyTooLarge, ROOM_DOOR_BODY_CAP_BYTES } from "./_room-surface.js";
// WS-R127 (migration 132). The Suite admin's own "Send a test note now".
import { OrgWeeklyNoteError, sendTestOrgWeeklyNote } from "./_org-weekly-note.js";

const cors = (res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.setHeader("Cache-Control", "no-store");
};

async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!allow(ipOf(req), "org", 30)) return res.status(429).json({ error: "slow_down" });

  try {
    const user = await requireUser(req);
    if (!allow(user.id, "org_user", 60)) return res.status(429).json({ error: "slow_down" });

    const body = req.body || {};
    // WS-R89: the one shared cap every POST door checks first.
    if (bodyTooLarge(body, ROOM_DOOR_BODY_CAP_BYTES)) return res.status(413).json({ error: "body_too_large" });
    const op = String(body.op || "");

    if (op === "create") {
      const org = await createOrg(q, user.id, {
        name: body.name,
        plan: body.plan,
        seatLimit: body.seat_limit,
        slug: body.slug,
      });
      return res.status(201).json({ org });
    }
    if (op === "invite") {
      const invite = await inviteMember(q, user.id, body.org_id);
      return res.status(200).json({ invite });
    }
    if (op === "accept") {
      const membership = await acceptMembership(q, user.id, body.org_id);
      return res.status(200).json({ membership });
    }
    if (op === "attach_room") {
      const attached = await attachRoom(q, user.id, body.org_id, body.room_id);
      return res.status(200).json({ room: attached });
    }
    if (op === "detach_room") {
      const detached = await detachRoom(q, user.id, body.room_id);
      return res.status(200).json({ room: detached });
    }
    if (op === "board") {
      const board = await orgBoard(q, body.org_id, user.id);
      return res.status(200).json({ board });
    }
    if (op === "subscription") {
      const subscription = await orgSubscriptionStatus(q, user.id, body.org_id);
      return res.status(200).json(subscription);
    }
    if (op === "start_subscription") {
      const subscription = await startOrgSubscription(q, { ownerUserId: user.id, orgId: body.org_id, plan: body.plan, seats: body.seats });
      return res.status(200).json({ subscription });
    }
    if (op === "update_seats") {
      const subscription = await updateOrgSeats(q, { ownerUserId: user.id, orgId: body.org_id, seats: body.seats });
      return res.status(200).json({ subscription });
    }
    if (op === "cancel_subscription") {
      const subscription = await cancelOrgRenewal(q, { ownerUserId: user.id, orgId: body.org_id });
      return res.status(200).json({ subscription });
    }
    if (op === "list_mine") {
      return res.status(200).json({ orgs: await listMyOrgs(q, user.id) });
    }
    if (op === "members") {
      return res.status(200).json({ members: await listOrgMembers(q, user.id, body.org_id) });
    }
    if (op === "room_status") {
      const status = await roomSuiteStatus(q, user.id, body.replica_id);
      return res.status(200).json({ org: status });
    }
    // WS-R127 (migration 132). Admin-only; writes no ledger row (see
    // api/_org-weekly-note.js's own header on why).
    if (op === "send_test_weekly_note") {
      const result = await sendTestOrgWeeklyNote(q, user.id, body.org_id);
      return res.status(200).json({ result });
    }
    return res.status(400).json({ error: "unknown_op" });
  } catch (error) {
    if (error instanceof OrgError) {
      return res.status(error.status).json({ error: error.code, ...(error.details ? { details: error.details } : {}) });
    }
    if (error instanceof PaymentsError) {
      return res.status(error.status).json({ error: error.code, ...(error.details ? { details: error.details } : {}) });
    }
    if (error instanceof OrgWeeklyNoteError) {
      return res.status(error.status).json({ error: error.code });
    }
    if (error instanceof AuthError) return res.status(error.status).json({ error: error.code });
    console.error("[org] failure:", error?.message || "unknown");
    return res.status(500).json({ error: "org_failure" });
  }
}

// WS-R58 (migration 109). See api/room.js's own comment for what this does.
export default withDoor(q, "org.js", handler);
