// WS-R38 (the door battery). Shared fixture world for evals/room-doors/run.mjs.
//
// This is deliberately a THIN LAYER over evals/room/fixtures.mjs's own
// `fakeDb`/`freshState` (WS-R1/WS-R8's shared Room fixture) rather than a
// second hand-rolled copy of the same Room SQL — `evals/room/fixtures.mjs`'s
// own header states the reason ("two fakes that quietly stop agreeing about
// what the real SQL text says") and it applies here exactly as it does to
// WS-R8's leak battery. What this file ADDS is the tables the Room's OWNER
// side and the platform's money/admin doors touch, none of which the follower
// fixture had any reason to carry: `vy_replica`, `vy_org`/`vy_org_member`,
// `vy_creator_invite`/`vy_creator_application`, and payments'
// `vy_room_subscription`/`vy_room_price`/`vy_payment_event`.
//
// `doorsDb(state)` tries every NEW pattern first, then falls through to the
// base Room fixture's own `fakeDb(state)` for anything it does not recognise
// — so a single `db` function serves both a follower session and an owner
// bearer in the same test file without the two fixtures drifting apart.
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");

const ROOM_FIXTURES = await import(pathToFileURL(join(ROOT, "evals/room/fixtures.mjs")).href);
export const {
  SLUG, ROOM_ID, AGENT_ID, REPLICA_ID, OWNER, USER_A, USER_B, PERSON_A, PERSON_B,
  loadFixtureAgent, fakeMemory,
} = ROOM_FIXTURES;
const baseFreshState = ROOM_FIXTURES.freshState;
const baseFakeDb = ROOM_FIXTURES.fakeDb;

/** A second owner, for every "another owner's X" case — never present in the
 *  base Room fixture, which only ever needed one creator. */
export const OWNER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
export const REPLICA_B = "c2000000-0000-4000-8000-000000000002";
export const ROOM_B = "d0000000-0000-4000-8000-000000000002";
export const ORG_A = "e1000000-0000-4000-8000-000000000001";

export function freshDoorsState() {
  const state = baseFreshState();
  // `rooms` already carries the base fixture's one published room, owned by
  // `OWNER`, replica `REPLICA_ID`. Every owner-door case below either reads
  // that room as its rightful owner or reads it (and is refused) as `OWNER_B`
  // — this file still never inserts a SECOND real room (WS-R38's own scope
  // note, restated), but WS-R51 adds `state.orgs` and the join-shaped
  // `vy_org`/`vy_org_member` patterns below so `orgBoard`/`inviteMember`/
  // `startOrgSubscription`/`updateOrgSeats`/`roomSuiteStatus` — four of the
  // ten `org.js` ops this workstream's own brief names — can be driven for
  // real rather than left "preexisting-uncased" (see
  // `context/rejected.md#ws-r44-new-payout-and-directory-cases-needed-fixture-sql-this-workstream-had-not-yet-added`,
  // the exact gap this workstream closes).
  state.rooms[0].handoff_enabled = false;
  state.rooms[0].handoff_monthly_cap = 5;
  state.replicas = [
    {
      // WS-R51: `agent_id` — room-publish.js's `createRoom` reads it BEFORE
      // its own idempotent existing-room check (`if (!replica.agent_id)
      // throw...` precedes `ownedRoomRow`), so a replica fixture with no
      // agent at all refused every `create` case this workstream added
      // before this field was here, real owner and stranger alike.
      replica_id: REPLICA_ID, owner_user_id: OWNER, agent_id: AGENT_ID, display_name: "Anjali",
      subject_mode: "self", lifecycle: "consent_pending", policy_version: "replica-self-v1",
      age_verified_at: null, identity_verified_at: null, liveness_verified_at: null,
      identity_expires_at: null, created_at: "2026-08-01T00:00:00.000Z", updated_at: "2026-08-01T00:00:00.000Z",
    },
  ];
  state.orgMembers = [];
  state.invites = [];
  state.applications = [];
  state.prices = [];
  state.subscriptions = [];
  state.orgSubscriptions = [];
  state.creatorSubscriptions = [];
  state.events = [];
  // WS-R100 (migration 126). One landed charge and its own receipt, seeded
  // directly (never through the webhook - this battery's own job is the
  // READ side's cross-identity refusal, not the write path
  // `evals/payments/run.mjs`/`evals/room-receipt/run.mjs` already prove).
  // Belongs to PERSON_A on the base fixture's one Room.
  state.events.push({
    event_id: "e9000000-0000-4000-8000-000000000001",
    provider: "fake", provider_event_ref: "evt_r100_seed", room_id: ROOM_ID,
    subscription_id: "s9000000-0000-4000-8000-000000000001", kind: "subscription.charged",
    amount_inr: 399, platform_take_inr: 100, creator_share_inr: 299,
    signature_verified: true, payload_hash: "0".repeat(64),
    received_at: "2026-09-01T00:00:00.000Z",
  });
  state.receipts = [{
    receipt_id: "f9000000-0000-4000-8000-000000000001",
    receipt_no: 1, payment_event_id: "e9000000-0000-4000-8000-000000000001",
    room_id: ROOM_ID, person_id: PERSON_A, issued_at: "2026-09-01T00:05:00.000Z",
  }];
  state.receiptCounters = [{ fy: "2026-27", next: 2 }];
  // WS-R109. `vy_room_upgrade_offer` (migration 093, `api/_phase-gate.js`)
  // — no case sharing this fixture had a reason to drive `sessionWorked`/
  // `recordOffer` for real before `evals/rehearsal/follower.mjs`'s own
  // "the sessionWorked offer state after a session that worked" step.
  // Starts empty: nothing has been offered to anyone yet.
  state.offers = [];
  state.publicRate = new Map();
  state.checkinDesigns = [];
  state.checkins = [];
  state.handoffs = [];
  // WS-R44: WS-R36's own payout ledger and fund-account table — neither the
  // base Room fixture nor this file's own `freshDoorsState` had any reason to
  // carry before this workstream's `payout_statements`/`payout_statement`/
  // `register_fund_account`/`retry_failed_payout` cases needed them.
  // `state.creatorSubscriptions`/`state.orgSubscriptions` above already exist
  // for `_org.js`'s own reads; WS-R37's cancel lane (`cancel_creator_
  // subscription`/`cancel_subscription`) reuses them.
  state.payouts = [];
  state.payoutAccounts = [];
  // WS-R51: `vy_org` rows (createOrg/orgBoard/inviteMember/roomSuiteStatus),
  // the replica erasure job ledger (`getReplicaErasureStatus`) and the
  // creator funnel mark table (`markStep`) — none of the seven doors this
  // battery originally cased needed them; three of the five doors §16 widens
  // to now do.
  state.orgs = [];
  state.erasureJobs = [];
  state.funnelMarks = [];
  // WS-R66: the public-page showcase (`vy_room_showcase`) and the review
  // cards it may copy text from (`vy_review_card`) — neither the base Room
  // fixture nor this file's own `freshDoorsState` had any reason to carry
  // before this workstream's `showcase_set`/`showcase_remove` cases needed
  // them. One eligible card (kind 'question', state 'sounds_right') and one
  // INELIGIBLE one (kind 'follower_declined', state 'sounds_right') so the
  // door battery's own case can prove the WHERE clause, not just this
  // workstream's own `evals/creator-page/run.mjs`, refuses the second.
  state.roomShowcase = [];
  // WS-R89: the follower's own web push subscription table
  // (`api/_room-push.js`) — no case in this battery had a reason to drive
  // it before this workstream's class-d (replay) cases.
  state.roomPushSubs = [];
  state.reviewCards = [
    {
      card_id: "e1000000-0000-4000-8000-000000000001",
      replica_id: REPLICA_ID, owner_user_id: OWNER,
      kind: "question", state: "sounds_right",
      prompt_text: "How do you explain projectile motion to a beginner?",
      answer_text: "Split it into horizontal and vertical motion and treat them separately.",
    },
    {
      card_id: "e2000000-0000-4000-8000-000000000002",
      replica_id: REPLICA_ID, owner_user_id: OWNER,
      kind: "follower_declined", state: "sounds_right",
      prompt_text: "A real follower's own question, never showcase material",
      answer_text: "A real follower's own words in this AI's reply to them",
    },
  ];
  // WS-R72: one creator-lane flag row (migration 116, `vy_room_reply_flag`)
  // on OWNER's own Room, for `dismissFlaggedReply`'s owner-bearer case
  // below — no follower/person/thread column, migration 116's own law,
  // restated by this fixture carrying none.
  state.roomReplyFlags = [
    {
      id: "f1000000-0000-4000-8000-000000000001", room_id: ROOM_ID,
      reply_sha256: "9".repeat(64),
      reply_text: "The exam is on the 14th, not the 12th.",
      reason: "wrong", created_at: "2026-09-01T09:00:00.000Z",
    },
  ];
  // WS-R94: `meera_log` — the REAL `DEFAULT_MEMORY` (`api/_room-surface.js`,
  // backed by `api/_surface.js`'s `logDmTurn`/`dmHistory`) is what runs when
  // a caller passes no `deps.memory` at all, which is exactly the shape of
  // the real `api/room.js` HTTP door with no deps overrides — every OTHER
  // suite sharing this fixture always injects `fakeMemory([])`
  // (`evals/room/fixtures.mjs`'s own in-memory stand-in) instead, so this
  // table had never been reached through this fixture before.
  state.meeraLog = [];
  // WS-R94: `vy_teacher_sheet` — empty by default (no case in THIS battery
  // ever needed it; every existing suite that calls `resolveRoom`/`roomSay`/
  // `roomTaste` through this fixture passes its own `deps.loadAgent`,
  // bypassing `api/_teachersheet.js`'s real DB-backed loader entirely). Only
  // `evals/rehearsal/harness.mjs` populates a row here, because it is the
  // one caller in this repo that drives the REAL `api/room.js` HTTP handler
  // with NO deps overrides at all — see that file's own header.
  state.teacherSheets = [];
  return state;
}

/**
 * The doors-only patterns. Every one of these is read off the REAL shipping
 * SQL text (grepped from the source, not invented) the same way
 * evals/room/fixtures.mjs's own header describes for the Room fixture.
 */
function doorsPatterns(state) {
  return (sql, params, has) => {
    // ── the owner-scoped room handle, ONE shape reused verbatim by
    //    api/_handoff.js, api/_checkins.js, api/_room-cohorts.js,
    //    api/_room-publish.js's `ownedRoomRow`, api/_payments.js's
    //    `ownedRoomForPayments` — confirmed identical substring in all five
    //    by grep before this fixture was written. ─────────────────────────
    if (has("from vy_room") && has("where owner_user_id = ($1)::uuid and replica_id = ($2)::uuid")) {
      const [owner, replica] = params.map(String);
      const row = state.rooms.find((r) => r.owner_user_id === owner && r.replica_id === replica);
      return row ? [{ ...row }] : [];
    }

    // ── vy_room_checkin_design / vy_room_checkin (api/_checkins.js) ────────
    if (has("insert into vy_room_checkin_design")) {
      const [designId, roomId, ownerUserId, title, promptShape, cadenceHint] = params;
      const row = {
        design_id: designId, room_id: String(roomId), owner_user_id: String(ownerUserId),
        title, prompt_shape: promptShape, cadence_hint: cadenceHint, state: "active",
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      };
      state.checkinDesigns.push(row);
      return [{ ...row }];
    }
    if (has("select design_id, title, prompt_shape, cadence_hint, state, created_at, updated_at") && has("from vy_room_checkin_design")) {
      const [roomId, ownerUserId] = params.map(String);
      return state.checkinDesigns
        .filter((d) => d.room_id === roomId && d.owner_user_id === ownerUserId)
        .map((d) => ({ ...d }));
    }
    if (has("select design_id, title, cadence_hint") && has("from vy_room_checkin_design")) {
      const [roomId] = params.map(String);
      return state.checkinDesigns
        .filter((d) => d.room_id === roomId && d.state === "active")
        .map((d) => ({ design_id: d.design_id, title: d.title, cadence_hint: d.cadence_hint }));
    }
    if (has("update vy_room_checkin_design") && has("set state = $4")) {
      const [designId, roomId, ownerUserId, next] = params.map(String);
      const d = state.checkinDesigns.find((x) => x.design_id === designId && x.room_id === roomId && x.owner_user_id === ownerUserId);
      if (!d) return [];
      d.state = next;
      d.updated_at = new Date().toISOString();
      return [{ ...d }];
    }
    if (has("insert into vy_room_checkin") && has("from vy_room_checkin_design d")) {
      const [checkinId, roomId, personId, followerId, designId, daysOfWeek, localTime, timezone, nextDueAt, quietFrom, quietTo] = params;
      const design = state.checkinDesigns.find((d) => d.design_id === String(designId) && d.room_id === String(roomId) && d.state === "active");
      if (!design) return [];
      let row = state.checkins.find((c) => c.follower_id === String(followerId) && c.design_id === String(designId) && c.state === "active");
      if (row) {
        Object.assign(row, { days_of_week: daysOfWeek, local_time: localTime, timezone, quiet_from: quietFrom, quiet_to: quietTo, next_due_at: nextDueAt });
      } else {
        row = {
          checkin_id: checkinId, room_id: String(roomId), person_id: String(personId), follower_id: String(followerId),
          design_id: String(designId), days_of_week: daysOfWeek, local_time: localTime, timezone,
          quiet_from: quietFrom, quiet_to: quietTo, next_due_at: nextDueAt, state: "active", created_at: new Date().toISOString(),
        };
        state.checkins.push(row);
      }
      return [{ ...row }];
    }
    if (has("from vy_room_checkin c") && has("join vy_room_checkin_design d")) {
      const [roomId, personId, followerId] = params.map(String);
      return state.checkins
        .filter((c) => c.room_id === roomId && c.person_id === personId && c.follower_id === followerId)
        .map((c) => {
          const d = state.checkinDesigns.find((x) => x.design_id === c.design_id);
          return {
            checkin_id: c.checkin_id, design_id: c.design_id, title: d?.title ?? "",
            days_of_week: c.days_of_week, local_time: c.local_time, timezone: c.timezone,
            quiet_from: c.quiet_from, quiet_to: c.quiet_to, next_due_at: c.next_due_at, state: c.state,
          };
        });
    }
    if (has("update vy_room_checkin") && has("set state = 'stopped'")) {
      const [checkinId, roomId, personId, followerId] = params.map(String);
      const c = state.checkins.find((x) => x.checkin_id === checkinId && x.room_id === roomId && x.person_id === personId && x.follower_id === followerId);
      if (!c) return [];
      c.state = "stopped";
      return [{ checkin_id: c.checkin_id, state: c.state }];
    }

    // ── vy_room_handoff (api/_handoff.js) ───────────────────────────────────
    if (has("insert into vy_room_handoff") && has("from vy_room r")) {
      const [id, roomId, personId, followerId, threadId, text, hash, policyVersion, monthKey] = params;
      const room = state.rooms.find((r) => r.room_id === String(roomId));
      if (!room || room.handoff_enabled !== true) return [];
      const usedThisMonth = state.handoffs.filter(
        (h) => h.follower_id === String(followerId) && h.month_key === monthKey && h.state !== "withdrawn",
      ).length;
      if (usedThisMonth >= Number(room.handoff_monthly_cap)) return [];
      const row = {
        handoff_id: id, room_id: String(roomId), person_id: String(personId), follower_id: String(followerId),
        thread_id: threadId, payload_text: text, payload_sha256: hash, policy_version: policyVersion,
        state: "sent", month_key: monthKey, sent_at: new Date().toISOString(), answered_at: null, reply_text: null,
        created_at: new Date().toISOString(),
      };
      state.handoffs.push(row);
      return [{ handoff_id: row.handoff_id, state: row.state, sent_at: row.sent_at }];
    }
    if (has("select count(*)::int as n from vy_room_handoff")) {
      const [followerId, monthKey] = params.map(String);
      return [{ n: state.handoffs.filter((h) => h.follower_id === followerId && h.month_key === monthKey && h.state !== "withdrawn").length }];
    }
    // WS-R51: handoff.js's "config_set" (setHandoffConfig) — the owner
    // switch and cap, one row over the follower-scoped patterns above.
    if (has("set handoff_enabled = ($3)::boolean")) {
      const [roomId, ownerUserId, enabled, cap] = params;
      const r = state.rooms.find((x) => x.room_id === String(roomId) && x.owner_user_id === String(ownerUserId));
      if (!r) return [];
      r.handoff_enabled = enabled;
      r.handoff_monthly_cap = cap;
      return [{ room_id: r.room_id, handoff_enabled: r.handoff_enabled, handoff_monthly_cap: r.handoff_monthly_cap }];
    }
    if (has("update vy_room_handoff") && has("set state = 'withdrawn'")) {
      const [handoffId, roomId, personId, followerId] = params.map(String);
      const h = state.handoffs.find(
        (x) => x.handoff_id === handoffId && x.room_id === roomId && x.person_id === personId &&
          x.follower_id === followerId && ["drafted", "sent"].includes(x.state),
      );
      if (!h) return [];
      h.state = "withdrawn";
      return [{ handoff_id: h.handoff_id, state: h.state }];
    }
    if (has("select handoff_id, thread_id, state, payload_text, sent_at, answered_at, reply_text, created_at")) {
      const [roomId, personId, followerId] = params.map(String);
      return state.handoffs
        .filter((h) => h.room_id === roomId && h.person_id === personId && h.follower_id === followerId)
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .map((h) => ({ ...h }));
    }

    // ── vy_replica.locale (api/_replica.js's `setOwnedReplicaLocale`, WS-R52,
    //    cased by the main loop at the WS-R51 merge): the SAME owner-scoped
    //    WHERE the reads below carry, as an UPDATE. Placed before them because
    //    the UPDATE's own text contains the reads' `where` fragment. ──
    if (has("update vy_replica") && has("set locale = $3")) {
      const [replica, owner, locale] = params.map(String);
      const row = state.replicas.find((r) => r.replica_id === replica && r.owner_user_id === owner);
      if (!row) return [];
      row.locale = locale;
      return [{ ...row }];
    }
    // ── vy_replica (api/_replica.js, api/_room-publish.js's `ownedReplica`) ──
    if (has("from vy_replica") && has("where replica_id = $1::uuid and owner_user_id = $2::uuid")) {
      const [replica, owner] = params.map(String);
      const row = state.replicas.find((r) => r.replica_id === replica && r.owner_user_id === owner);
      return row ? [{ ...row }] : [];
    }
    if (has("from vy_replica r") && has("where r.replica_id = ($1)::uuid and r.owner_user_id = ($2)::uuid")) {
      const [replica, owner] = params.map(String);
      const row = state.replicas.find((r) => r.replica_id === replica && r.owner_user_id === owner);
      return row ? [{ ...row }] : [];
    }
    if (has("from vy_replica") && has("where owner_user_id = $1::uuid") && has("order by created_at desc")) {
      const [owner] = params.map(String);
      return state.replicas.filter((r) => r.owner_user_id === owner).map((r) => ({ ...r }));
    }

    // ── vy_org_member: the admin-of-org check, reused verbatim by
    //    attachRoom/detachRoom/orgBoard/orgSubscriptionStatus/
    //    listOrgMembers/`_payments.js`'s `orgAdminOrThrow`. ────────────────
    if (has("from vy_org_member") && has("role = 'admin'") && has("limit 1") && !has("select owner_user_id, role")) {
      const [orgId, owner] = params.map(String);
      const row = state.orgMembers.find(
        (m) => m.org_id === orgId && m.owner_user_id === owner && m.role === "admin",
      );
      return row ? [{ x: 1 }] : [];
    }
    if (has("select owner_user_id, role, added_at from vy_org_member")) {
      const [orgId] = params.map(String);
      return state.orgMembers
        .filter((m) => m.org_id === orgId)
        .sort((a, b) => a.added_at.localeCompare(b.added_at))
        .map((m) => ({ ...m }));
    }

    // ── vy_creator_invite / vy_replica: the redeem-and-create predicate
    //    (api/_replica.js's createSelfReplica), evals/invites/run.mjs's own
    //    fake reused verbatim (same statement, same shape). ───────────────
    if (has("select 1 from vy_replica where owner_user_id = $1::uuid limit 1")) {
      const [owner] = params.map(String);
      return state.replicas.some((r) => r.owner_user_id === owner) ? [{ x: 1 }] : [];
    }
    if (has("invite_redeem as (") && has("insert into vy_replica")) {
      const [ownerUserId, name, policyVersion, codeHash, invitesRequired] = params;
      const alreadyOwns = state.replicas.some((r) => r.owner_user_id === ownerUserId);
      let gateOk = true;
      if (invitesRequired) {
        if (alreadyOwns) {
          gateOk = true;
        } else {
          const invite = state.invites.find(
            (i) => i.code_hash === codeHash && i.redeemed_at == null && new Date(i.expires_at) > new Date(),
          );
          if (invite) {
            invite.redeemed_at = new Date().toISOString();
            invite.redeemed_by_user_id = ownerUserId;
            gateOk = true;
          } else {
            gateOk = false;
          }
        }
      }
      if (!gateOk) return [];
      const row = {
        replica_id: randomUUID(), owner_user_id: ownerUserId, display_name: name,
        subject_mode: "self", lifecycle: "consent_pending", policy_version: policyVersion,
        age_verified_at: null, identity_verified_at: null, liveness_verified_at: null,
        identity_expires_at: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      };
      state.replicas.push(row);
      return [row];
    }
    // WS-R44: excludes issueCreatorInvite's own INSERT (below, "quota_ok as
    // (" — a different SQL text this generic operator-issue shape must never
    // swallow, since the two functions bind their positional params in a
    // different order).
    if (has("insert into vy_creator_invite") && !has("quota_ok as (")) {
      const [inviteId, codeHash, contact, issuedBy, applicationId, expiresAt] = params;
      const row = {
        invite_id: inviteId, code_hash: codeHash, issued_to_contact: contact,
        issued_by_user_id: issuedBy, application_id: applicationId, expires_at: expiresAt,
        redeemed_at: null, redeemed_by_user_id: null, created_at: new Date().toISOString(),
      };
      state.invites.push(row);
      return [row];
    }
    // WS-R51: invites.js's operator ops beyond "issue" — list/revoke/erase.
    if (has("from vy_creator_invite") && has("order by created_at desc") && has("limit $1::int") && !has("issued_kind")) {
      const [cap] = params;
      return state.invites
        .slice()
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .slice(0, Number(cap) || 50);
    }
    if (has("update vy_creator_invite") && has("set expires_at = least(expires_at, now())")) {
      const [inviteId] = params.map(String);
      const row = state.invites.find((i) => i.invite_id === inviteId && i.redeemed_at == null);
      if (!row) return [];
      row.expires_at = new Date(0).toISOString();
      return [{ ...row }];
    }
    if (has("delete from vy_creator_invite") && has("where invite_id = $1::uuid") && has("redeemed_at is null")) {
      const [inviteId] = params.map(String);
      const idx = state.invites.findIndex((i) => i.invite_id === inviteId && i.redeemed_at == null);
      if (idx === -1) return [];
      state.invites.splice(idx, 1);
      return [{ invite_id: inviteId }];
    }
    if (has("select 1 from vy_creator_invite where invite_id = $1::uuid and redeemed_at is not null")) {
      const [inviteId] = params.map(String);
      const still = state.invites.some((i) => i.invite_id === inviteId && i.redeemed_at != null);
      return still ? [{ x: 1 }] : [];
    }

    // ── vy_creator_application (api/_apply.js) — only the happy-path insert
    //    and the daily-per-contact refusal are needed here; every OTHER
    //    application read this battery cares about is the operator-bearer
    //    boundary, which never reaches SQL at all (`requireOperator` throws
    //    first). ──────────────────────────────────────────────────────────
    if (has("insert into vy_creator_application")) {
      const [id, name, archiveLink, audience, contact, key, day, intent] = params;
      if (state.applications.some((a) => a.contact_key === key && a.applied_on === day)) return [];
      const row = {
        application_id: id, name, archive_link: archiveLink, audience, contact,
        contact_key: key, applied_on: day, status: "new", intent: intent || "creator", created_at: new Date().toISOString(),
      };
      state.applications.push(row);
      return [row];
    }
    // WS-R51: apply.js's operator ops — list/erase.
    if (has("select application_id, name, archive_link, audience, contact, status, intent, created_at") && has("from vy_creator_application")) {
      return state.applications.slice().sort((a, b) => b.created_at.localeCompare(a.created_at));
    }
    if (has("delete from vy_creator_application where contact_key = $1::text")) {
      const [key] = params.map(String);
      const before = state.applications.length;
      state.applications = state.applications.filter((a) => a.contact_key !== key);
      return Array.from({ length: before - state.applications.length }, () => ({ application_id: "x" }));
    }

    // ── PAYMENTS: vy_room_price / vy_room_subscription / vy_payment_event —
    //    the subset evals/payments/run.mjs's own fake already proves against
    //    the real SQL; reused here at the same fidelity for the replay and
    //    signature attack classes this battery adds on top. ───────────────
    if (has("insert into vy_room_price")) {
      const [roomId, ownerUserId, priceInr, currency, takeBp] = params;
      let row = state.prices.find((p) => p.room_id === String(roomId));
      if (row) {
        row.follower_price_inr = priceInr;
        row.updated_at = new Date().toISOString();
      } else {
        row = {
          room_id: String(roomId), owner_user_id: String(ownerUserId), follower_price_inr: priceInr,
          currency, platform_take_bp: takeBp, updated_at: new Date().toISOString(),
        };
        state.prices.push(row);
      }
      return [{ ...row }];
    }
    if (has("select follower_price_inr from vy_room_price")) {
      const row = state.prices.find((p) => p.room_id === String(params[0]));
      return row ? [{ follower_price_inr: row.follower_price_inr }] : [];
    }
    if (has("from vy_room_subscription") && has("state in ('created','authenticated','active','paused')")) {
      const followerId = String(params[0]);
      const row = state.subscriptions
        .filter((s) => s.follower_id === followerId && ["created", "authenticated", "active", "paused"].includes(s.state))
        .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
      return row ? [{ ...row }] : [];
    }
    if (has("insert into vy_room_subscription")) {
      const [roomId, personId, followerId, provider] = params;
      const row = {
        subscription_id: `s${state.subscriptions.length + 1}`.padEnd(36, "0"),
        room_id: String(roomId), person_id: String(personId), follower_id: String(followerId),
        provider, provider_subscription_ref: null, state: "created",
        current_period_start: null, current_period_end: null,
        created_at: new Date(Date.now() + state.subscriptions.length).toISOString(),
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
    if (has("left join vy_room_price p on p.room_id = s.room_id")) {
      const [provider, ref] = params;
      const row = state.subscriptions.find((s) => s.provider === provider && s.provider_subscription_ref === ref);
      if (!row) return [];
      const price = state.prices.find((p) => p.room_id === row.room_id);
      return [{ subscription_id: row.subscription_id, room_id: row.room_id, platform_take_bp: price ? price.platform_take_bp : params[2] }];
    }
    if (has("from vy_org_subscription where provider")) return [];
    if (has("from vy_creator_subscription where provider")) return [];
    if (has("with candidate as") && has("insert into vy_payment_event")) {
      const [provider, ref, roomId, subId, kind, amountInr, takeInr, shareInr, payloadHash, nextState, periodStart, periodEnd] = params;
      const dup = state.events.find((e) => e.provider === provider && e.provider_event_ref === ref);
      if (dup) return []; // ON CONFLICT DO NOTHING — the replay case this battery is about
      // WS-R109: was `` `e${state.events.length + 1}` `` — fine for every
      // existing reader of `event_id` (relational equality only, never
      // format-checked, confirmed by grep before this change), but a real
      // gap once `api/_room-surface.js`'s own `roomReceipt` reads it: that
      // function's own `UUID.test(paymentEventId)` guard (a real, correct
      // 400/404-refusing check against a garbage id) rejects a non-UUID
      // event id before its WHERE clause ever runs, which
      // `evals/rehearsal/follower.mjs`'s own receipts step found by driving
      // a REAL landed charge through `applyWebhook` end to end for the
      // first time — no suite sharing this fixture had a reason to read a
      // generated event's own id back through that particular door before.
      const event = {
        event_id: randomUUID(), provider, provider_event_ref: ref, room_id: roomId,
        subscription_id: subId, kind, amount_inr: amountInr, platform_take_inr: takeInr,
        creator_share_inr: shareInr, signature_verified: true, payload_hash: payloadHash,
        received_at: new Date(Date.now() + state.events.length).toISOString(),
      };
      state.events.push(event);
      const sub = state.subscriptions.find((s) => s.subscription_id === String(subId));
      if (sub && nextState !== "") sub.state = nextState;
      let tier = null;
      if (sub && ["active", "cancelled", "expired"].includes(nextState)) {
        const follower = state.followers.find((f) => f.follower_id === sub.follower_id);
        if (follower) {
          follower.tier = nextState === "active" ? "paid" : "free";
          tier = follower.tier;
        }
      }
      // WS-R109: `person_id` — missing until this workstream, a real gap
      // that blocked `issueFollowerReceipt`'s own `personId` argument (the
      // real SQL's own `su.person_id` column, read off the subscription
      // this event just updated) from ever being anything but `undefined`.
      // No suite sharing this fixture had driven a REAL landed charge
      // through `applyWebhook` before `evals/rehearsal/follower.mjs`'s own
      // receipts step — every existing receipt case seeds `state.receipts`
      // directly instead (this file's own WS-R100 comment, further down).
      return [{ event_id: event.event_id, subscription_id: subId, state: sub ? sub.state : null, tier, person_id: sub ? sub.person_id : null }];
    }

    // ── WS-R100 (migration 126): the follower's own receipt reads
    //    (`roomReceipt`/`roomReceipts`, api/_room-surface.js). Both are
    //    session-scoped joins against `state.receipts`/`state.events` seeded
    //    above - this battery's own job is proving the WHERE clause itself
    //    refuses a mismatched room/person, never the write path. ──────────
    // ORDER MATTERS: the LIST query's own distinguishing feature ("order
    // by") must be checked BEFORE the single-row check, since both query
    // texts contain the substring "r.payment_event_id" - see
    // evals/room-receipt/run.mjs's own identical fixture for the failure
    // this ordering fixes.
    if (has("from vy_receipt r") && has("join vy_payment_event e") && has("order by r.issued_at desc")) {
      const [roomId, personId] = params.map(String);
      const rows = state.receipts.filter((r) => r.room_id === roomId && r.person_id === personId);
      return rows
        .sort((a, b) => b.issued_at.localeCompare(a.issued_at))
        .map((r) => {
          const ev = state.events.find((e) => e.event_id === r.payment_event_id);
          return { receipt_id: r.receipt_id, receipt_no: r.receipt_no, payment_event_id: r.payment_event_id, issued_at: r.issued_at, amount_inr: ev?.amount_inr };
        });
    }
    if (has("from vy_receipt r") && has("join vy_payment_event e") && has("r.payment_event_id")) {
      const [paymentEventId, roomId, personId] = params.map(String);
      const row = state.receipts.find((r) => r.payment_event_id === paymentEventId
        && r.room_id === roomId && r.person_id === personId);
      if (!row) return [];
      const ev = state.events.find((e) => e.event_id === row.payment_event_id);
      return [{ receipt_no: row.receipt_no, issued_at: row.issued_at, event_id: ev?.event_id, amount_inr: ev?.amount_inr, kind: ev?.kind }];
    }

    // ── WS-R44: WS-R45's list / unlist / set_bio (api/_room-publish.js) ────
    // Read off the REAL SQL text `evals/creator-directory/run.mjs`'s own
    // fixture already proves against — reused, never re-derived. The
    // owner-scoped READ these three writes all open with (`ownedRoomRow`) is
    // already the generic "from vy_room" + "where owner_user_id = ($1)::uuid
    // and replica_id = ($2)::uuid" pattern above; this is their own WRITE.
    if (has("set listed_at = case")) {
      const [ownerUserId, replicaId] = params.map(String);
      const r = state.rooms.find((x) => x.owner_user_id === ownerUserId && x.replica_id === replicaId);
      if (!r) return [];
      if (r.published_at != null && !r.listed_at) r.listed_at = new Date().toISOString();
      return [{ ...r }];
    }
    if (has("set listed_at = null")) {
      const [ownerUserId, replicaId] = params.map(String);
      const r = state.rooms.find((x) => x.owner_user_id === ownerUserId && x.replica_id === replicaId);
      if (!r) return [];
      r.listed_at = null;
      return [{ ...r }];
    }
    if (has("set one_line_bio = $3")) {
      const [ownerUserId, replicaId, bio] = params.map(String);
      const r = state.rooms.find((x) => x.owner_user_id === ownerUserId && x.replica_id === replicaId);
      if (!r) return [];
      r.one_line_bio = bio;
      return [{ ...r }];
    }

    // ── WS-R66: api/_room-publish.js's showcase_set / showcase_remove ──────
    // Read off the REAL SQL text those two functions send. The owner-scoped
    // room handle they open with is already the generic "from vy_room" +
    // "where owner_user_id = ($1)::uuid and replica_id = ($2)::uuid" pattern
    // above; these four are their OWN statements, in the exact order
    // `setRoomShowcase`/`removeRoomShowcase`/`readRoomShowcase` send them.
    // WS-R72: `has("card_id = ($1)::uuid")` narrows this to setRoomShowcase's
    // OWN one-card lookup specifically - readEligibleShowcaseCards' LIST read
    // (matched separately, below) shares the "from vy_review_card" +
    // "kind <> 'follower_declined'" substrings but takes no card id param at
    // all, and without this narrowing this branch shadowed that one (found
    // running this exact fixture against the real SQL the first time).
    if (has("from vy_review_card") && has("kind <> 'follower_declined'") && has("card_id = ($1)::uuid")) {
      const [cardId, ownerUserId, replicaId] = params.map(String);
      const row = state.reviewCards.find(
        (c) => c.card_id === cardId && c.owner_user_id === ownerUserId && c.replica_id === replicaId
          && c.state === "sounds_right" && c.kind !== "follower_declined",
      );
      return row ? [{ prompt_text: row.prompt_text, answer_text: row.answer_text }] : [];
    }
    if (has("update vy_room_showcase") && has("set removed_at = now()") && has("position = ($2)::int")) {
      const [roomId, position] = params;
      for (const s of state.roomShowcase) {
        if (s.room_id === String(roomId) && s.position === Number(position) && !s.removed_at) {
          s.removed_at = new Date().toISOString();
        }
      }
      return [];
    }
    if (has("insert into vy_room_showcase")) {
      const [id, roomId, question, answer, position] = params;
      state.roomShowcase.push({
        id: String(id), room_id: String(roomId), question, answer,
        position: Number(position), removed_at: null, created_at: new Date().toISOString(),
      });
      return [];
    }
    if (has("from vy_room_showcase") && has("order by position asc")) {
      const [roomId] = params.map(String);
      return state.roomShowcase
        .filter((s) => s.room_id === roomId && !s.removed_at)
        .sort((a, b) => a.position - b.position)
        .map((s) => ({ id: s.id, question: s.question, answer: s.answer, position: s.position, created_at: s.created_at }));
    }
    if (has("update vy_room_showcase s") && has("from vy_room r")) {
      const [ownerUserId, replicaId, id] = params.map(String);
      const r = state.rooms.find((x) => x.owner_user_id === ownerUserId && x.replica_id === replicaId);
      if (!r) return [];
      const s = state.roomShowcase.find((x) => x.id === id && x.room_id === r.room_id && !x.removed_at);
      if (!s) return [];
      s.removed_at = new Date().toISOString();
      return [{ room_id: s.room_id }];
    }

    // ── WS-R72: api/_review-queue.js's readEligibleShowcaseCards ───────────
    // Owner-scoped in its OWN select, no `vy_room` join at all (unlike
    // showcase_set/remove above) — matched here off the same params-scoped
    // shape `state.reviewCards` already carries.
    if (has("select card_id, kind, prompt_text, answer_text")) {
      const [replicaId, ownerUserId] = params.map(String);
      return state.reviewCards
        .filter((c) => c.replica_id === replicaId && c.owner_user_id === ownerUserId
          && c.state === "sounds_right" && c.kind !== "follower_declined")
        .map((c) => ({ card_id: c.card_id, kind: c.kind, prompt_text: c.prompt_text, answer_text: c.answer_text }));
    }

    // ── WS-R72: api/_review-queue.js's dismissFlaggedReply ──────────────────
    // The creator lane's own DELETE, owner-scoped through the SAME
    // "from vy_room" + owner/replica WHERE shape every other owner-scoped
    // handle in this fixture uses, restated for a delete against a
    // migration-116 table rather than a select.
    if (has("delete from vy_room_reply_flag f") && has("using vy_room r")) {
      const [replicaId, ownerUserId, hash] = params.map(String);
      const r = state.rooms.find((x) => x.owner_user_id === ownerUserId && x.replica_id === replicaId);
      if (!r) return [];
      const before = state.roomReplyFlags.length;
      state.roomReplyFlags = state.roomReplyFlags.filter(
        (f) => !(f.room_id === r.room_id && f.reply_sha256 === hash),
      );
      const removed = before - state.roomReplyFlags.length;
      return Array.from({ length: removed }, (_, i) => ({ id: `deleted-${i}` }));
    }

    // ── WS-R44: WS-R37's cancel lane (api/_renewals.js) ────────────────────
    // `cancelFollowerRenewal`'s own SELECT already matches the pattern above
    // ("from vy_room_subscription" + the same state-in clause
    // `followerSubscriptionStatus` uses); this is its own UPDATE, and the
    // creator/org twins one level up — all three read off the REAL SQL text
    // `evals/renewals/run.mjs`'s own fixture already proves against, reused
    // here at the same fidelity rather than re-derived.
    if (has("update vy_room_subscription") && has("set cancel_at_period_end = true")) {
      const [subId] = params.map(String);
      const row = state.subscriptions.find((s) => s.subscription_id === subId);
      if (!row) return [];
      row.cancel_at_period_end = true;
      return [{ subscription_id: row.subscription_id, state: row.state, current_period_end: row.current_period_end ?? null, cancel_at_period_end: true }];
    }
    if (has("from vy_creator_subscription") && has("owner_user_id = ($1)::uuid and replica_id = ($2)::uuid") && has("state in (")) {
      const [ownerUserId, replicaId] = params.map(String);
      const row = state.creatorSubscriptions.find(
        (s) => s.owner_user_id === ownerUserId && s.replica_id === replicaId &&
          ["created", "authenticated", "active", "paused"].includes(s.state),
      );
      return row ? [{ ...row }] : [];
    }
    if (has("update vy_creator_subscription") && has("set cancel_at_period_end = true")) {
      const [subId] = params.map(String);
      const row = state.creatorSubscriptions.find((s) => s.subscription_id === subId);
      if (!row) return [];
      row.cancel_at_period_end = true;
      return [{ subscription_id: row.subscription_id, state: row.state, current_period_end: row.current_period_end ?? null, cancel_at_period_end: true }];
    }
    // WS-R51: narrowed with `!has("vy_org_member")` — `seatCapSql`'s own
    // fragment (embedded in `orgBoard`/`startOrgSubscription`/`updateOrgSeats`/
    // `listMyOrgs`'s SELECT lists below) ALSO contains "from
    // vy_org_subscription", "org_id = ($1)::uuid" and "state in (" as plain
    // substrings — this pattern's original three-substring test alone
    // silently matched those four queries too and returned an empty
    // `orgSubscriptions` lookup for every one of them, which is exactly how
    // this workstream's first `orgBoard` case failed before this line was
    // narrowed (`context/rejected.md#ws-r51-loose-substring-pattern-matched-
    // seatcapsqls-own-embedded-fragment`). The real `cancelOrgRenewal` status
    // read this pattern exists for never mentions `vy_org_member` at all.
    if (has("from vy_org_subscription") && has("org_id = ($1)::uuid") && has("state in (") && !has("vy_org_member")) {
      const [orgId] = params.map(String);
      const row = state.orgSubscriptions.find(
        (s) => s.org_id === orgId && ["created", "authenticated", "active", "paused"].includes(s.state),
      );
      return row ? [{ ...row }] : [];
    }
    if (has("update vy_org_subscription") && has("set cancel_at_period_end = true")) {
      const [subId] = params.map(String);
      const row = state.orgSubscriptions.find((s) => s.subscription_id === subId);
      if (!row) return [];
      row.cancel_at_period_end = true;
      return [{ subscription_id: row.subscription_id, state: row.state, current_period_end: row.current_period_end ?? null, cancel_at_period_end: true }];
    }
    // `orgAdminOrThrow` (api/_payments.js) — `cancelOrgRenewal`'s own admin
    // check, byte-identical to the join `api/_org.js`'s own admin gate
    // uses one query shape over (that one is matched by the "from
    // vy_org_member" pattern above, which this query's own text does NOT
    // contain — it says "join vy_org_member m", not "from vy_org_member").
    if (has("from vy_org o") && has("join vy_org_member m")) {
      const [orgId, ownerUserId] = params.map(String);
      const org = state.orgs?.find((o) => o.org_id === orgId);
      const isAdmin = state.orgMembers.some(
        (m) => m.org_id === orgId && m.owner_user_id === ownerUserId && m.role === "admin",
      );
      if (!isAdmin) return [];
      return [{ org_id: orgId, slug: org?.slug ?? null, plan: org?.plan ?? null, seat_limit: org?.seat_limit ?? null }];
    }
    // WS-R51: org.js's "list_mine" (listMyOrgs) — every Suite the CALLING
    // bearer belongs to, admin or creator, no admin restriction and no
    // org_id in the body at all.
    if (has("from vy_org_member m") && has("join vy_org o on o.org_id = m.org_id")) {
      const [owner] = params.map(String);
      const mine = state.orgMembers
        .filter((m) => m.owner_user_id === owner)
        .map((m) => {
          const org = state.orgs.find((o) => o.org_id === m.org_id);
          if (!org) return null;
          const seatsUsed = state.rooms.filter((r) => r.org_id === org.org_id).length;
          return { org_id: org.org_id, name: org.name, slug: org.slug, plan: org.plan, seat_limit: org.seat_limit, created_at: org.created_at, role: m.role, seats_used: seatsUsed, seats_paid: org.seat_limit };
        })
        .filter(Boolean)
        .sort((a, b) => a.created_at.localeCompare(b.created_at));
      return mine;
    }

    // ── WS-R44: WS-R36's payout ledger and fund account (api/_payments.js) ─
    // Read off the REAL SQL text `evals/payouts/run.mjs`'s own fixture
    // already proves against — reused, never re-derived, so the two fakes
    // cannot quietly stop agreeing about what the real statement says.
    if (has("select payout_id, owner_user_id, net_inr, state") && has("state in ('built','pending_account')")) {
      const [payoutId, ownerUserId] = params.map(String);
      const row = state.payouts.find(
        (p) => p.payout_id === payoutId && p.owner_user_id === ownerUserId && ["built", "pending_account"].includes(p.state),
      );
      return row ? [{ ...row }] : [];
    }
    // ── WS-R56: the payout status webhook's own lookup+transition
    //    (api/_payments.js's `applyPayoutWebhook`, migration 111) — keyed
    //    by `provider_payout_ref`, never `payout_id`, so these MUST be
    //    checked before the generic `set state = 'failed'`/payout_id-keyed
    //    patterns below (a substring collision on "set state = 'failed'"
    //    otherwise, since `sendPayout`'s own failure path shares that
    //    text). ─────────────────────────────────────────────────────────
    if (has("where provider_payout_ref = $1") && has("set state = 'settled'")) {
      const [providerRef] = params.map(String);
      const row = state.payouts.find(
        (p) => p.provider_payout_ref === providerRef && ["queued", "sent"].includes(p.state),
      );
      if (!row) return [];
      row.state = "settled";
      row.settled_at = new Date().toISOString();
      return [{ payout_id: row.payout_id, owner_user_id: row.owner_user_id, state: row.state }];
    }
    if (has("where provider_payout_ref = $1") && has("state = 'failed', failure_reason")) {
      const [providerRef, reason] = params;
      const row = state.payouts.find(
        (p) => p.provider_payout_ref === String(providerRef) && ["queued", "sent"].includes(p.state),
      );
      if (!row) return [];
      row.state = "failed";
      row.failure_reason = reason ?? null;
      return [{ payout_id: row.payout_id, owner_user_id: row.owner_user_id, state: row.state }];
    }
    if (has("select payout_id from vy_creator_payout where provider_payout_ref = $1")) {
      const [providerRef] = params.map(String);
      const row = state.payouts.find((p) => p.provider_payout_ref === providerRef);
      return row ? [{ payout_id: row.payout_id }] : [];
    }

    if (has("select fund_account_ref from vy_creator_payout_account")) {
      const [ownerUserId, provider] = params.map(String);
      const row = state.payoutAccounts.find((a) => a.owner_user_id === ownerUserId && a.provider === provider && a.verified_at);
      return row ? [{ fund_account_ref: row.fund_account_ref }] : [];
    }
    if (has("set state = 'pending_account'")) {
      const [payoutId] = params.map(String);
      const row = state.payouts.find((p) => p.payout_id === payoutId && ["built", "pending_account"].includes(p.state));
      if (!row) return [];
      row.state = "pending_account";
      return [{ state: row.state }];
    }
    if (has("set state = 'failed'")) {
      const [payoutId] = params.map(String);
      const row = state.payouts.find((p) => p.payout_id === payoutId && ["built", "pending_account"].includes(p.state));
      if (row) row.state = "failed";
      return [];
    }
    if (has("set state = 'queued'")) {
      const [payoutId, providerRef] = params;
      const row = state.payouts.find((p) => p.payout_id === String(payoutId) && ["built", "pending_account"].includes(p.state));
      if (!row) return [];
      row.state = "queued";
      row.provider_payout_ref = providerRef;
      return [{ state: row.state, provider_payout_ref: row.provider_payout_ref }];
    }
    if (has("insert into vy_creator_payout_account")) {
      const [ownerUserId, provider, ref] = params;
      let row = state.payoutAccounts.find((a) => a.owner_user_id === ownerUserId && a.provider === provider);
      if (!row) {
        row = { owner_user_id: ownerUserId, provider, fund_account_ref: ref, verified_at: new Date().toISOString() };
        state.payoutAccounts.push(row);
      } else {
        row.fund_account_ref = ref;
        row.verified_at = new Date().toISOString();
      }
      return [{ ...row }];
    }
    if (has("set state = 'built'")) {
      const [payoutId] = params.map(String);
      const row = state.payouts.find((p) => p.payout_id === payoutId && p.state === "failed");
      if (!row) return [];
      row.state = "built";
      return [{ owner_user_id: row.owner_user_id, state: row.state }];
    }
    if (has("suite_share_inr, state, provider_payout_ref, created_at")) {
      const [payoutId, ownerUserId] = params.map(String);
      const row = state.payouts.find((p) => p.payout_id === payoutId && p.owner_user_id === ownerUserId);
      return row ? [{ ...row }] : [];
    }
    if (has("count(distinct e.subscription_id)")) {
      return [{ follower_subscriptions: 0 }];
    }
    if (has("select o.name") && has("join vy_org o on o.org_id = r.org_id")) {
      return [];
    }
    if (has("gross_inr, net_inr, state, created_at") && has("order by period_start desc")) {
      const [ownerUserId] = params.map(String);
      return state.payouts
        .filter((p) => p.owner_user_id === ownerUserId)
        .sort((a, b) => b.period_start.localeCompare(a.period_start))
        .map((p) => ({ ...p }));
    }

    // ── WS-R44: WS-R47's creator-issued invites (api/_invites.js) ──────────
    if (has("quota_ok as (") && has("insert into vy_creator_invite")) {
      const [ownerUserId, inviteId, codeHash, contact, expiresAt, quota] = params;
      const alreadyIssued = state.invites.filter(
        (i) => i.issued_by_user_id === String(ownerUserId) && i.issued_kind === "creator",
      ).length;
      const hasPublishedRoom = state.rooms.some(
        (r) => r.owner_user_id === String(ownerUserId) && r.published_at != null,
      );
      if (alreadyIssued >= Number(quota) || !hasPublishedRoom) return [];
      const row = {
        invite_id: inviteId, code_hash: codeHash, issued_to_contact: contact,
        issued_by_user_id: String(ownerUserId), application_id: null, expires_at: expiresAt,
        redeemed_at: null, redeemed_by_user_id: null, created_at: new Date().toISOString(), issued_kind: "creator",
      };
      state.invites.push(row);
      return [row];
    }
    if (has("from vy_creator_invite") && has("issued_by_user_id = $1::uuid and issued_kind")) {
      const [ownerUserId] = params.map(String);
      return state.invites
        .filter((i) => i.issued_by_user_id === ownerUserId && i.issued_kind === "creator")
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .map((i) => ({
          invite_id: i.invite_id, issued_to_contact: i.issued_to_contact,
          expires_at: i.expires_at, redeemed_at: i.redeemed_at, created_at: i.created_at,
        }));
    }

    // ── vy_public_rate (api/_rate-limit.js) — the SAME real upsert semantics
    //    evals/rate-limit/run.mjs's own fake implements, reused here so the
    //    door battery's rate-key-malformation cases (law f) drive the REAL
    //    consume() rather than a re-derived stand-in. ──────────────────────
    if (has("insert into vy_public_rate")) {
      const [scope, keyHash, windowStart, limit] = params;
      const k = `${scope}\0${keyHash}\0${windowStart}`;
      const row = state.publicRate.get(k);
      if (!row) {
        state.publicRate.set(k, { scope, key_hash: keyHash, window_start: windowStart, count: 1 });
        return [{ count: 1 }];
      }
      if (row.count < Number(limit)) {
        row.count += 1;
        return [{ count: row.count }];
      }
      return [];
    }

    // ── WS-R51: room-publish.js's create/rename/publish/pause/resume/
    //    set_free_cap/set_paid_ceilings/set_default_locale — the eight of
    //    the workstream's own 27 "preexisting-uncased" ops that live in
    //    `api/_room-publish.js`. Every one of these is `assertOwnerScope`
    //    then a plain `where owner_user_id = ($1)::uuid and replica_id =
    //    ($2)::uuid` UPDATE — the SAME owner-scoped shape `set listed_at`/
    //    `set one_line_bio` already prove above; this is the remaining six
    //    columns those two never touched. `publish`/`resume`'s own THREE-
    //    FRAGMENT readiness lock (runtime capability, readiness floor,
    //    disclosure approval) is deliberately NOT reproduced here — that
    //    lock is `api/_room-publish.js`'s own subject, already proven by its
    //    dedicated suite; this fixture only needs to prove the OWNER
    //    boundary the write's WHERE clause enforces, so it always takes the
    //    `then` branch of the CASE once the owner matches, exactly the way
    //    `coalesce(r.published_at, now())` already behaves once every real
    //    gate is open. ─────────────────────────────────────────────────────
    if (has("insert into vy_room\n")) {
      // createRoom's own INSERT never fires in this battery — `ownedReplica`
      // and the idempotent `ownedRoomRow` re-read both resolve through
      // patterns already above, and the fixture's one room already exists
      // for REPLICA_ID/OWNER — but a caller that reaches this far with a
      // truly new replica gets an honest new row rather than a silent [].
      const [, proposed, replicaIdP, agentIdP, ownerIdP, displayName] = params;
      const row = {
        room_id: `f${state.rooms.length}${"0".repeat(30)}`, slug: proposed, replica_id: String(replicaIdP),
        agent_id: String(agentIdP), owner_user_id: String(ownerIdP), display_name: displayName,
        free_monthly_messages: 20, paid_monthly_messages: 500, paid_monthly_voice_seconds: 1800,
        listed_at: null, one_line_bio: null, published_at: null, paused_at: null,
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      };
      state.rooms.push(row);
      return [{ ...row }];
    }
    if (has("set slug = $3, updated_at = now()")) {
      const [ownerUserId, replicaId, slug] = params.map(String);
      const r = state.rooms.find((x) => x.owner_user_id === ownerUserId && x.replica_id === replicaId);
      if (!r) return [];
      r.slug = slug;
      return [{ ...r }];
    }
    if (has("published_at = case")) {
      const [ownerUserId, replicaId] = params.map(String);
      const r = state.rooms.find((x) => x.owner_user_id === ownerUserId && x.replica_id === replicaId);
      if (!r) return [];
      r.published_at = r.published_at || new Date().toISOString();
      return [{ ...r }];
    }
    if (has("set paused_at = now(), updated_at = now()")) {
      const [ownerUserId, replicaId] = params.map(String);
      const r = state.rooms.find((x) => x.owner_user_id === ownerUserId && x.replica_id === replicaId);
      if (!r) return [];
      r.paused_at = new Date().toISOString();
      return [{ ...r }];
    }
    if (has("paused_at = case")) {
      const [ownerUserId, replicaId] = params.map(String);
      const r = state.rooms.find((x) => x.owner_user_id === ownerUserId && x.replica_id === replicaId);
      if (!r) return [];
      r.paused_at = null;
      return [{ ...r }];
    }
    if (has("set free_monthly_messages = ($3)::int4")) {
      const [ownerUserId, replicaId, n] = params;
      const r = state.rooms.find((x) => x.owner_user_id === String(ownerUserId) && x.replica_id === String(replicaId));
      if (!r) return [];
      r.free_monthly_messages = n;
      return [{ ...r }];
    }
    if (has("set paid_monthly_messages = ($3)::int4")) {
      const [ownerUserId, replicaId, m, v] = params;
      const r = state.rooms.find((x) => x.owner_user_id === String(ownerUserId) && x.replica_id === String(replicaId));
      if (!r) return [];
      r.paid_monthly_messages = m;
      r.paid_monthly_voice_seconds = v;
      return [{ ...r }];
    }
    if (has("set default_locale = $3, updated_at = now()")) {
      const [ownerUserId, replicaId, loc] = params.map(String);
      const r = state.rooms.find((x) => x.owner_user_id === ownerUserId && x.replica_id === replicaId);
      if (!r) return [];
      r.default_locale = loc;
      return [{ ...r }];
    }
    // WS-R75 (migration 119). `setRoomFreeCap`'s own shape one column over.
    if (has("set dormancy_days = ($3)::int4")) {
      const [ownerUserId, replicaId, days] = params;
      const r = state.rooms.find((x) => x.owner_user_id === String(ownerUserId) && x.replica_id === String(replicaId));
      if (!r) return [];
      r.dormancy_days = days == null ? null : Number(days);
      return [{ ...r }];
    }

    // ── WS-R51: org.js's create/invite/accept/detach_room/board/
    //    start_subscription/update_seats/room_status — the remaining
    //    `api/_org.js`/`api/_payments.js` "preexisting-uncased" ops. ───────
    if (has("with new_org as (") && has("insert into vy_org ")) {
      const [orgId, name, slug, owner, plan, seatLimit] = params;
      if (state.orgs.some((o) => o.slug === slug)) {
        throw Object.assign(new Error('duplicate key value violates unique constraint "vy_org_slug_ix"'), { code: "23505" });
      }
      const row = { org_id: orgId, name, slug, plan, seat_limit: seatLimit, created_at: new Date().toISOString() };
      state.orgs.push(row);
      state.orgMembers.push({ org_id: orgId, owner_user_id: String(owner), role: "admin", added_at: new Date().toISOString() });
      return [{ ...row }];
    }
    if (has("join vy_org_member m on m.org_id = o.org_id and m.owner_user_id = ($2)::uuid and m.role = 'admin'")) {
      const [orgId, adminId] = params.map(String);
      const isAdmin = state.orgMembers.some((m) => m.org_id === orgId && m.owner_user_id === adminId && m.role === "admin");
      if (!isAdmin) return [];
      const org = state.orgs.find((o) => o.org_id === orgId);
      if (!org) return [];
      if (has("o.plan, o.seat_limit, o.created_at")) {
        // orgBoard's own header select — `seats_paid` is the coalesced cap;
        // this fixture takes the un-subscribed fallback (`seat_limit`)
        // rather than reproducing `seatCapSql`'s own subscription lookup,
        // the same "prove the owner boundary, not the whole write" scope
        // this block's own header states.
        return [{ org_id: org.org_id, name: org.name, slug: org.slug, plan: org.plan, seat_limit: org.seat_limit, created_at: org.created_at, seats_paid: org.seat_limit }];
      }
      if (has("o.slug, o.plan, o.seat_limit")) {
        // orgAdminOrThrow's own shape (startOrgSubscription/updateOrgSeats).
        return [{ org_id: org.org_id, slug: org.slug, plan: org.plan, seat_limit: org.seat_limit }];
      }
      // inviteMember's own shape.
      return [{ org_id: org.org_id, name: org.name, slug: org.slug }];
    }
    if (has("with target as (") && has("insert into vy_org_member") && has("on conflict (org_id, owner_user_id) do nothing")) {
      const [orgId, owner] = params.map(String);
      const org = state.orgs.find((o) => o.org_id === orgId);
      if (!org) return [{ org_exists: 0, role: null, added_at: null }];
      let member = state.orgMembers.find((m) => m.org_id === orgId && m.owner_user_id === owner);
      if (!member) {
        member = { org_id: orgId, owner_user_id: owner, role: "creator", added_at: new Date().toISOString() };
        state.orgMembers.push(member);
      }
      return [{ org_exists: 1, role: member.role, added_at: member.added_at }];
    }
    if (has("set org_id = null, org_attached_at = null")) {
      const [room, caller] = params.map(String);
      const r = state.rooms.find((x) => x.room_id === room);
      if (!r || r.org_id == null) return [];
      const isAdmin = state.orgMembers.some((m) => m.org_id === r.org_id && m.owner_user_id === caller && m.role === "admin");
      if (r.owner_user_id !== caller && !isAdmin) return [];
      r.org_id = null;
      r.org_attached_at = null;
      return [{ room_id: r.room_id }];
    }
    if (has("as current_org_id") && has("as room_owner")) {
      const [room] = params.map(String);
      const r = state.rooms.find((x) => x.room_id === room);
      return [{ room_exists: r ? 1 : null, current_org_id: r?.org_id ?? null, room_owner: r?.owner_user_id ?? null }];
    }
    if (has("from vy_room r") && has("join vy_org o on o.org_id = r.org_id")) {
      const [owner, rid] = params.map(String);
      const r = state.rooms.find((x) => x.owner_user_id === owner && x.replica_id === rid);
      if (!r || r.org_id == null) return [];
      const org = state.orgs.find((o) => o.org_id === r.org_id);
      return org ? [{ org_id: org.org_id, name: org.name, slug: org.slug }] : [];
    }

    // ── WS-R51: replica.js's revoke/erasure_status/funnel_mark. ───────────
    if (has("into vy_replica_erasure_job")) {
      const [rid, owner] = params.map(String);
      const r = state.replicas.find((x) => x.replica_id === rid && x.owner_user_id === owner);
      if (!r) return [];
      r.lifecycle = "revoked";
      r.revoked_at = new Date().toISOString();
      // getReplicaErasureStatus's own `replicaErasureRequestHash` requires a
      // real UUID shape (400s on anything else) — a real one, not a plain
      // string, so the erasure_status test one function over can drive it.
      const jobId = randomUUID();
      state.erasureJobs.push({ job_id: jobId, replica_id: rid, owner_user_id: owner, requested_at: new Date().toISOString(), updated_at: new Date().toISOString(), attempts: 0 });
      return [{ ...r, erasure_request_id: jobId }];
    }
    if (has("from vy_replica_erasure_job j where j.job_id=$1::uuid and j.owner_user_id=$2::uuid")) {
      const [jobId, owner] = params.map(String);
      const job = state.erasureJobs.find((j) => j.job_id === jobId && j.owner_user_id === owner);
      if (!job) return [];
      return [{
        state: "pending", requested_at: job.requested_at, updated_at: job.updated_at, completed_at: null,
        backup_expires_at: null, attempts: job.attempts, provider_state: "confirmed", storage_state: "confirmed",
        deleted_classes: [],
      }];
    }
    if (has("with owned as (") && has("into vy_replica_funnel_mark")) {
      const [rid, owner, step] = params.map(String);
      const r = state.replicas.find((x) => x.replica_id === rid && x.owner_user_id === owner);
      if (!r) return [{ owned: 0, at: null }];
      let mark = state.funnelMarks.find((m) => m.replica_id === rid && m.owner_user_id === owner && m.step === step);
      if (!mark) {
        mark = { replica_id: rid, owner_user_id: owner, step, at: new Date().toISOString() };
        state.funnelMarks.push(mark);
      }
      return [{ owned: 1, at: mark.at }];
    }
    // WS-R51: api/_payments.js's `startCreatorSubscription` fix — a
    // body-supplied `replicaId` is now verified against the bearer's OWN
    // `vy_replica` row before a subscription can ever be created for it
    // (this workstream's own class-c finding). Byte-identical SQL shape to
    // the existing `getOwnedReplica` pattern above, reused rather than
    // duplicated with a different WHERE text.
    if (has("select replica_id from vy_replica where replica_id = $1::uuid and owner_user_id = $2::uuid")) {
      const [replica, owner] = params.map(String);
      const row = state.replicas.find((r) => r.replica_id === replica && r.owner_user_id === owner);
      return row ? [{ replica_id: row.replica_id }] : [];
    }

    // WS-R89 (class d, replay/reuse): `api/_room-push.js`'s `setSubscription`
    // — a follower's own web push subscription, upserted by `endpoint`
    // ALONE (the migration's own unique index; unlike creator push, this
    // reassignment is BY DESIGN — one physical browser can hold only one
    // Push subscription per origin, so the SAME endpoint legitimately moves
    // when the same person follows a second Room in the same browser —
    // `context/decisions.md#ws-r89-follower-push-endpoint-reassignment-stays-
    // as-is`).
    if (has("insert into vy_room_push_subscription")) {
      const [subscriptionId, roomId, personId, followerId, endpoint, p256dh, auth, uaHash] = params;
      let row = state.roomPushSubs.find((r) => r.endpoint === endpoint);
      if (row) {
        Object.assign(row, {
          room_id: String(roomId), person_id: String(personId), follower_id: String(followerId),
          p256dh, auth, user_agent_hash: uaHash, revoked_at: null,
        });
      } else {
        row = {
          subscription_id: subscriptionId, room_id: String(roomId), person_id: String(personId),
          follower_id: String(followerId), endpoint, p256dh, auth, user_agent_hash: uaHash,
          created_at: new Date().toISOString(), revoked_at: null,
        };
        state.roomPushSubs.push(row);
      }
      return [{ subscription_id: row.subscription_id, created_at: row.created_at }];
    }

    // WS-R94: `api/_creator-page.js`'s `publicCreatorPageRoomBySlug` — a
    // DIFFERENT SELECT from `resolveRoom`'s own `vy_room r ... join vy_agent
    // a` above (different column list, gated on `listed_at is not null`
    // rather than a join), needed for the first time by `evals/rehearsal/
    // follower.mjs`'s `/c/<slug>` step — no suite sharing this fixture had
    // ever rendered the public creator page against it before.
    if (has("select room_id, slug, display_name, one_line_bio, default_locale, listed_at, taste_enabled")) {
      const s = String(params[0]);
      const room = state.rooms.find(
        (r) =>
          r.slug.toLowerCase() === s &&
          r.published_at != null &&
          r.paused_at == null &&
          r.listed_at != null,
      );
      return room
        ? [{
            room_id: room.room_id, slug: room.slug, display_name: room.display_name,
            one_line_bio: room.one_line_bio ?? "", default_locale: room.default_locale ?? "en",
            listed_at: room.listed_at, taste_enabled: room.taste_enabled !== false,
          }]
        : [];
    }

    // WS-R94: `api/_surface.js`'s `logDmTurn` (the REAL `DEFAULT_MEMORY.
    // logTurn`, `api/_room-surface.js`) — one row per turn, `t()` an
    // identity function here so the table name is the literal `meera_log`.
    if (has("insert into meera_log")) {
      const [device, role, content, person, agentId] = params;
      state.meeraLog.push({
        id: state.meeraLog.length + 1, agent_id: String(agentId), device_id: String(device),
        role: String(role), channel: "chat", kind: "text", content: String(content ?? ""),
        speaker_person_id: person == null ? null : String(person), group_id: null,
        at: new Date().toISOString(),
      });
      return [];
    }
    // WS-R94: `api/_surface.js`'s `dmHistory` (the REAL `DEFAULT_MEMORY.
    // history`) — `group_id is null` is the DM/Room-thread guard
    // (`dmHistory`'s own header: never sweep up a group turn sharing a
    // device), matched here even though this fixture's own rows never set
    // `group_id` at all, so the guard is honoured by construction rather
    // than by coincidence.
    if (has("select role, content from meera_log") && has("group_id is null")) {
      const [device, agentId] = params.map(String);
      const rows = state.meeraLog
        .filter((r) => r.device_id === device && r.agent_id === agentId && r.group_id == null)
        .slice()
        .reverse();
      return rows.map((r) => ({ role: r.role, content: r.content }));
    }

    // WS-R94: `api/_room-surface.js`'s `roomSay` — the cohort day-counter
    // (`insert into vy_room_follower_day ...`), reached only when a caller
    // passes no `deps.tableApplied` at all (every existing suite sharing
    // this fixture stubs that seam directly, so this INSERT had never
    // actually executed against `evals/room/fixtures.mjs`'s own `fakeDb`
    // before `evals/rehearsal/harness.mjs` — the real, deps-free
    // `api/room.js` HTTP door — made `to_regclass` answer true above). Found
    // the hard way: without this block first, `evals/room/fixtures.mjs`'s
    // own `has("insert into vy_room_follower")` check (further down, in the
    // base fixture this file falls through to) matches `"insert into
    // vy_room_follower_day"` too — the string `"vy_room_follower_day"`
    // literally CONTAINS `"vy_room_follower"` — and silently mis-writes the
    // day-counter's four positional params into the FOLLOWER row's own
    // `(follower_id, room_id, person_id, agent_id)` shape, corrupting a real
    // follower on the very next `say`. Same defect CLASS this repo's own
    // `context/rejected.md` already names for a different table pair
    // (`router-matched-a-table-instead-of-a-statement`); a fifth instance,
    // logged as its own entry (`ws-r94-fixture-insert-substring-collision-
    // corrupted-a-follower-row`) because the collision is real and was
    // latent, not hypothetical — reproduced once, fixed by matching the
    // MORE SPECIFIC statement FIRST, `doorsPatterns`'s own position (checked
    // before the base fixture) making that possible without editing the
    // shared file at all.
    if (has("insert into vy_room_follower_day")) {
      const [roomId, personId, day] = params;
      state.followerDayCounts = state.followerDayCounts || [];
      const key = `${roomId}:${personId}:${day}`;
      const row = state.followerDayCounts.find((r) => r.key === key);
      if (row) row.turns += 1;
      else state.followerDayCounts.push({ key, room_id: String(roomId), person_id: String(personId), day: String(day), turns: 1 });
      return [];
    }

    // WS-R94: `api/memory.js`'s `tableApplied(name)` — `select to_regclass($1)
    // is not null as present`, the migration-landed guard `isTableAppliedFor`
    // falls back to whenever a caller passes no `deps.tableApplied` (every
    // OTHER suite sharing this fixture always does, `deps.tableApplied =
    // async () => true`'s own established shape, so this pattern was never
    // needed until a caller with NO deps at all — `evals/rehearsal/harness.mjs`
    // driving the real `api/room.js` HTTP door — existed). Always answers
    // "present": this fixture represents a database with every migration
    // applied, the harness's own honest simulation of production.
    if (has("select to_regclass(")) {
      return [{ present: true }];
    }

    // WS-R94: `api/_teachersheet.js`'s `publishedRow` — the ONE query
    // `api/_room-surface.js`'s `resolveRoom` needs when a caller passes NO
    // `deps.loadAgent` at all, which is exactly the shape of the real
    // `api/room.js` HTTP handler `evals/rehearsal/harness.mjs` drives with
    // zero deps overrides. Read off the real SQL text (`api/_teachersheet.js`):
    // joined on `a.slug = $1`, gated on `status = 'published'` and
    // `consent_artifact_id is not null`, ordered by `published_at desc`. No
    // other suite in this repo needs this pattern — every one of them
    // supplies its own `deps.loadAgent`/`deps.engine` and never reaches this
    // module at all (confirmed by grep before this was added).
    if (has("from vy_teacher_sheet s") && has("join vy_agent a")) {
      const slug = String(params[0]);
      const rows = state.teacherSheets
        .filter((r) => r.slug === slug && r.status === "published" && r.consent_artifact_id != null)
        .sort((a, b) => (a.published_at < b.published_at ? 1 : -1));
      return rows.length
        ? [{
            sheet_id: rows[0].sheet_id, agent_id: rows[0].agent_id, version: rows[0].version,
            sheet: rows[0].sheet, status: rows[0].status,
            consent_artifact_id: rows[0].consent_artifact_id, published_at: rows[0].published_at,
            slug: rows[0].slug,
          }]
        : [];
    }

    // WS-R109: `api/_room-about.js`'s own `publicRoomAboutBySlug` — a THIRD
    // select off `vy_room` by slug, distinct from both `resolveRoom`'s own
    // `join vy_agent` shape and `publicCreatorPageRoomBySlug`'s own column
    // list above, needed for the first time by `evals/rehearsal/follower.mjs`'s
    // own "/r/<slug>/about" step. Unlike the creator-page read, NOT gated on
    // `listed_at is not null` — that file's own header explains why: a
    // follower who already holds the link must be able to read this page
    // whether or not the creator opted into the public directory.
    if (has("select slug, display_name, default_locale, dormancy_days")) {
      const s = String(params[0]);
      const room = state.rooms.find(
        (r) => r.slug.toLowerCase() === s && r.published_at != null && r.paused_at == null,
      );
      return room
        ? [{
            slug: room.slug, display_name: room.display_name, default_locale: room.default_locale ?? "en",
            dormancy_days: room.dormancy_days ?? null, free_monthly_messages: room.free_monthly_messages,
            paid_monthly_messages: room.paid_monthly_messages, paid_monthly_voice_seconds: room.paid_monthly_voice_seconds,
          }]
        : [];
    }

    // WS-R109: `api/_payments.js`'s `applyWebhook`'s own price read
    // (`select follower_price_inr, currency from vy_room_price...`) — a
    // DIFFERENT column list from the single-column read above (`select
    // follower_price_inr from vy_room_price`, no `currency`), reached for
    // the first time by a REAL landed charge driven through `applyWebhook`
    // rather than a seeded `state.receipts` row.
    if (has("select follower_price_inr, currency from vy_room_price")) {
      const row = state.prices.find((p) => p.room_id === String(params[0]));
      return row ? [{ follower_price_inr: row.follower_price_inr, currency: row.currency }] : [];
    }

    // WS-R109: `api/_payments.js`'s `issueFollowerReceipt` — the WRITE side
    // of the WS-R100 receipt (`insert into vy_receipt_counter` ... `insert
    // into vy_receipt`), reached for the first time by any suite sharing
    // this fixture: every existing receipt case (this file's own WS-R100
    // seed above, `evals/room-receipt/run.mjs`) seeds `state.receipts`
    // directly and proves only the READ side's cross-identity refusal;
    // `evals/rehearsal/follower.mjs`'s own "receipts list after a fake
    // landed charge" step is the first caller to drive a receipt into
    // existence through the real webhook-apply function, so the counter's
    // own per-FY claim and the receipt row's own insert need a real write
    // pattern for the first time. Params, read off the real SQL text:
    // `[fy, eventId, roomId, personId, issuedAt]`.
    if (has("insert into vy_receipt_counter")) {
      const [fy, eventId, roomId, personId, issuedAt] = params;
      state.receiptCounters = state.receiptCounters || [];
      let counter = state.receiptCounters.find((c) => c.fy === String(fy));
      if (!counter) {
        counter = { fy: String(fy), next: 1 };
        state.receiptCounters.push(counter);
      }
      // `bump`'s own "not exists" guard: a SECOND call for the SAME payment
      // event burns no counter number and inserts nothing — the real SQL's
      // own idempotence, restated here rather than assumed.
      const already = state.receipts.some((r) => r.payment_event_id === String(eventId));
      if (already) return [];
      const claimedNo = counter.next;
      counter.next += 1;
      const row = {
        receipt_id: randomUUID(), receipt_no: claimedNo, payment_event_id: String(eventId),
        room_id: String(roomId), person_id: String(personId), issued_at: issuedAt || new Date().toISOString(),
      };
      state.receipts.push(row);
      return [{ receipt_id: row.receipt_id, receipt_no: row.receipt_no, issued_at: row.issued_at }];
    }

    // WS-R109: `api/_phase-gate.js`'s `sessionWorked` (migration 093) — one
    // statement, matched by its own three-CTE join list, the same
    // distinguishing substring `evals/phase-gate/run.mjs`'s own fixture
    // uses. `sessionWorkedRow` below mirrors that suite's own
    // `sessionWorkedRow` BY HAND over this fixture's own state shape
    // (`state.followers`/`state.threads`/`state.followerDayCounts`/
    // `state.meeraLog`, not a shared import — `evals/phase-gate/run.mjs`'s
    // own copy is local to that file by the same design choice), never
    // asserted equal to the real predicate — the assertions in
    // `evals/rehearsal/follower.mjs` check the real, computed `worked`
    // field, not this function's own agreement with itself.
    if (has("from follower_scope fs, thread_scope ts, cap_history ch")) {
      const [roomId, personId, threadId, deviceId, agentId, nowIso] = params;
      const follower = state.followers.find((f) => f.room_id === String(roomId) && f.person_id === String(personId));
      const roomRow = state.rooms.find((r) => r.room_id === String(roomId));
      const thread = state.threads.find(
        (t) => t.thread_id === String(threadId) && t.room_id === String(roomId) && t.person_id === String(personId),
      );
      const now = new Date(nowIso).getTime();
      const included = follower
        ? (follower.tier === "paid" ? roomRow.paid_monthly_messages : roomRow.free_monthly_messages)
        : null;
      const used = follower ? follower.month_message_count : null;
      const remaining = Math.max((included ?? 0) - (used ?? 0), 0);
      const monthOf = (ms) => new Date(ms).toISOString().slice(0, 7);
      const thisMonth = monthOf(now);
      const byMonth = {};
      for (const d of state.followerDayCounts || []) {
        if (d.room_id !== String(roomId) || d.person_id !== String(personId)) continue;
        const m = d.day.slice(0, 7);
        if (m === thisMonth) continue;
        byMonth[m] = (byMonth[m] || 0) + d.turns;
      }
      const hitCapBefore = Object.values(byMonth).some((sum) => sum >= (included ?? Infinity));
      const threadCreated = thread ? thread.created_at : null;
      const today = new Date(now).toISOString().slice(0, 10);
      const continuedFromEarlierDay = threadCreated != null && threadCreated.slice(0, 10) < today;
      const lane = (state.meeraLog || [])
        .filter((m) => m.speaker_person_id === String(personId) && m.agent_id === String(agentId)
          && m.device_id === String(deviceId) && m.role === "me")
        .map((m) => new Date(m.at).getTime())
        .sort((a, b) => a - b);
      const SESSION_GAP_MINUTES = 30;
      const SESSION_MIN_MESSAGES = 4;
      let sessionStart = -Infinity;
      for (let i = 1; i < lane.length; i++) {
        if (lane[i] - lane[i - 1] > SESSION_GAP_MINUTES * 60_000) sessionStart = lane[i];
      }
      const sessionMsgs = lane.filter((t) => t >= sessionStart);
      const worked =
        follower?.tier === "free" &&
        sessionMsgs.length >= SESSION_MIN_MESSAGES &&
        continuedFromEarlierDay &&
        (remaining < 5 || hitCapBefore);
      return [{
        tier: follower?.tier ?? null, messages_used: used, messages_included: included, messages_remaining: remaining,
        hit_cap_before: hitCapBefore, thread_continued_from_earlier_day: continuedFromEarlierDay,
        session_message_count: sessionMsgs.length,
        session_last_at: sessionMsgs.length ? new Date(Math.max(...sessionMsgs)).toISOString() : null,
        worked,
      }];
    }

    // WS-R109: `api/_phase-gate.js`'s `recordOffer` — the 14-day cooldown
    // IS the write (INSERT ... WHERE NOT EXISTS), `evals/phase-gate/run.mjs`'s
    // own fixture pattern restated over `state.offers`.
    if (has("insert into vy_room_upgrade_offer")) {
      const [offerId, roomId, personId, followerId, reason, nowIso, cooldownDays] = params;
      const now = new Date(nowIso).getTime();
      state.offers = state.offers || [];
      const withinWindow = state.offers.some(
        (o) => o.follower_id === String(followerId) && now - new Date(o.shown_at).getTime() < Number(cooldownDays) * 86_400_000,
      );
      if (withinWindow) return [];
      const row = {
        offer_id: String(offerId), room_id: String(roomId), person_id: String(personId), follower_id: String(followerId),
        shown_at: nowIso, reason, outcome: null, outcome_at: null,
      };
      state.offers.push(row);
      return [{ offer_id: row.offer_id, reason: row.reason, shown_at: row.shown_at }];
    }

    return undefined; // not a doors pattern — fall through to the base Room fixture
  };
}

/**
 * ONE db function for the whole battery: doors patterns first, then the base
 * Room fixture's own `fakeDb(state)` for the follower-session SQL neither
 * this file nor the door under test needed to know about.
 */
export function doorsDb(state) {
  const calls = [];
  const base = baseFakeDb(state);
  const match = doorsPatterns(state);
  const db = async (sql, params = []) => {
    calls.push(sql);
    const has = (s) => sql.includes(s);
    const hit = match(sql, params, has);
    if (hit !== undefined) return hit;
    return base(sql, params);
  };
  db.calls = calls;
  return db;
}

// ═════════════════════════════════════════════════════════════════════════
// WS-R95 (the creator journey rehearsal, evals/rehearsal/creator.mjs, over
// evals/rehearsal/harness.mjs since WS-R109 folded the two rehearsal
// harnesses onto one contract — the separate harness-creator.mjs this
// comment used to name is retired). APPEND-ONLY, per the wave-fifteen brief.
//
// The rehearsal drives the REAL HTTP doors over a REAL local server, which
// means it reaches decision modules `doorsDb` above was never asked to know
// about: `api/_context-locker.js` (the Context Locker's "add one text
// source"), `api/_readiness.js` (the six raw inputs Readiness reads AND the
// snapshot it writes), `api/_review-queue.js` (fill the queue, decide a
// card), and `api/_room-publish.js`'s own READINESS-AWARE half of its
// publish/resume CASE — which the comment on the "insert into vy_room\n"
// block above (WS-R51) says on purpose is "deliberately NOT reproduced" by
// the generic matchers above, because publish/resume's own lock is that
// suite's subject (`evals/room-publish/run.mjs`), not the door battery's.
// This rehearsal is the one caller that DOES need the lock to bite for
// real, so `rehearsalPatterns` below reimplements the same three-fragment
// check `evals/room-publish/run.mjs`'s own `makeDb` proved correct
// (`runtimeOk`/`readinessOk`/`disclosureOk`), simplified to hold ONLY
// Readiness open to the walk's own control — runtime activation and
// disclosure approval are pre-seeded already-passing, named in the
// workstream's report as out of THIS rehearsal's scope (they are each
// their own multi-stage pipeline with dedicated suites of their own).
//
// `rehearsalCreatorDb` tries these NEW patterns FIRST, then falls through to
// `doorsDb` — the inverse order from `doorsDb`'s own "doors, then base"
// composition, and deliberately so: the whole point of adding a matcher
// here is that it must be able to OVERRIDE `doorsDb`'s existing permissive
// "always takes the CASE's `then` branch" publish/resume matcher, which
// would otherwise answer FIRST and hide the lock this rehearsal exists to
// exercise. A "try, catch, fall through" composition (mirroring `doorsDb`'s
// own order) cannot do this, because `doorsDb`'s publish matcher never
// throws — it always returns an answer, just not a readiness-aware one.
function rehearsalPatterns(state, sql, params, has) {
  // ── Readiness's OWNED check (api/_readiness.js's own `readReadinessInputs`,
  //    distinct from every other "owns this replica" shape in this file by
  //    its trailing "and r.lifecycle <> 'purging'"). ───────────────────────
  if (has("from vy_replica r") && has("r.lifecycle <> 'purging'") && has("limit 1")) {
    const [rid, owner] = params.map(String);
    const row = state.replicas.find((r) => r.replica_id === rid && r.owner_user_id === owner);
    return row ? [{ replica_id: row.replica_id }] : [];
  }
  // ── CLAIM_LEDGER_SQL — the only statement in this file whose select list
  //    carries "as mined". ──────────────────────────────────────────────────
  if (has("as mined") && has("as reviewed") && has("as never_say_rules")) {
    const [rid, owner] = params.map(String);
    const claims = state.rehearsalClaims.filter((c) => c.replica_id === rid && c.owner_user_id === owner);
    const mined = claims.filter((c) => c.status === "proposed" || c.status === "approved").length;
    const reviewed = claims.filter((c) => ["approved", "rejected", "superseded"].includes(c.status)).length;
    const approved = claims.filter((c) => c.status === "approved").length;
    const never_say_rules = claims.filter((c) => c.status === "approved" && c.domain === "boundary").length;
    const claims_valid = approved;
    return [{ mined, reviewed, approved, never_say_rules, claims_valid }];
  }
  // ── FIDELITY_SQL ─────────────────────────────────────────────────────────
  if (has("from vy_voice_fidelity")) {
    // `readReadinessInputs` reads a JSON `score` column, not a flat row —
    // `state.rehearsalFidelity` is `{mean, windows, status, computed_at}`,
    // nested here into the shape the real column carries.
    const f = state.rehearsalFidelity;
    return f ? [{ score: { mean: f.mean, windows: f.windows }, status: f.status, computed_at: f.computed_at }] : [];
  }
  // ── CEILING_SQL ──────────────────────────────────────────────────────────
  if (has("from vy_replica_voice_genome")) {
    return state.rehearsalGenome ? [{ ...state.rehearsalGenome }] : [];
  }
  // ── MIRROR_SQL — an aggregate, always one row. ──────────────────────────
  if (has("as sounds_right") && has("from vy_mirror_feedback")) {
    const m = state.rehearsalMirror || { sounds_right: 0, fix_it: 0, latest_at: null };
    return [{ ...m }];
  }
  // ── SAFETY_SQL — the only statement whose select list carries
  //    "as person_model_approved_at". ─────────────────────────────────────
  if (has("as person_model_approved_at")) {
    const sheet = state.rehearsalTeacherSheet;
    return [{
      person_model_approved_at: sheet?.person_model_approved_at ?? null,
      person_model_approved: Boolean(sheet?.person_model_approved),
      escalation_route: Boolean(sheet?.escalation_route),
    }];
  }
  // ── FRESHNESS_SQL — the only statement whose select list carries
  //    "as newest_source_at"; reads the SAME context-item rows the walk's
  //    own "add one text source" step wrote, so a freshly-added source makes
  //    this part genuinely current rather than a second, disconnected mock. ─
  if (has("as newest_source_at")) {
    const [rid, owner] = params.map(String);
    const items = state.contextItems.filter((i) => i.replica_id === rid && i.owner_user_id === owner);
    const newest = items.length ? items.map((i) => i.created_at).sort().at(-1) : null;
    return [{ newest_source_at: newest }];
  }
  // ── snapshotReadiness's own INSERT. Always accepted; nothing this
  //    rehearsal reads depends on the `inputs_hash` idempotency guard the
  //    real WHERE NOT EXISTS clause enforces, so this fixture does not
  //    reproduce that guard — named here rather than silently assumed. The
  //    write STORES `overall`/`min_part`/`unmeasured_count` into
  //    `state.rehearsalReadinessLast`, the SAME row the room-publish
  //    matchers above read: a GET /api/readiness that genuinely computes a
  //    passing screen from the six raw inputs is what crosses the publish
  //    floor, never a second, disconnected flag. ─────────────────────────
  if (has("insert into vy_replica_readiness")) {
    const [, , , overall, minPart, unmeasuredCount] = params;
    state.rehearsalReadinessLast = {
      overall: Number(overall), min_part: Number(minPart), unmeasured_count: Number(unmeasuredCount),
    };
    return [{ readiness_id: randomUUID(), computed_at: new Date().toISOString() }];
  }

  // ── api/_room-publish.js's publish/resume CASE, and the three standalone
  //    "as ok" blocker probes — see this block's own header for why these
  //    are matched HERE rather than left to doorsDb's permissive default.
  //    Runtime and disclosure are pre-seeded passing (out of this
  //    rehearsal's scope); Readiness is the one live gate. ─────────────────
  const runtimeOk = () => state.rehearsalRuntimeActive !== false;
  const readinessOk = (overallFloor, partFloor) => {
    const snap = state.rehearsalReadinessLast;
    if (!snap) return false;
    return snap.unmeasured_count === 0 && snap.overall >= overallFloor && snap.min_part >= partFloor;
  };
  const disclosureOk = () => state.rehearsalDisclosureApproved !== false;

  if (has("set published_at = case") || has("set paused_at = case")) {
    const [ownerId, replicaId, overallFloor, partFloor] = params;
    const row = state.rooms.find((r) => r.owner_user_id === String(ownerId) && r.replica_id === String(replicaId));
    if (!row) return [];
    const pass = runtimeOk() && readinessOk(Number(overallFloor), Number(partFloor)) && disclosureOk();
    if (has("set published_at = case")) {
      if (pass && !row.published_at) row.published_at = new Date().toISOString();
    } else if (pass) {
      row.paused_at = null;
    }
    return [{ ...row }];
  }
  if (has("as ok") && has("vy_replica_runtime_capability")) return [{ ok: runtimeOk() }];
  if (has("as ok") && has("vy_replica_readiness")) {
    const [, , overallFloor, partFloor] = params;
    return [{ ok: readinessOk(Number(overallFloor), Number(partFloor)) }];
  }
  if (has("as ok") && has("vy_teacher_sheet")) return [{ ok: disclosureOk() }];

  // ── api/_context-locker.js ───────────────────────────────────────────────
  if (has("from vy_replica r") && has("r.replica_id = $1::uuid and r.owner_user_id = $2::uuid") && has("limit 1")) {
    const [rid, owner] = params.map(String);
    const row = state.replicas.find((r) => r.replica_id === rid && r.owner_user_id === owner);
    return row ? [{ replica_id: row.replica_id }] : [];
  }
  // The INSERT's own `quota` CTE text also contains "count(*)::int as items"
  // etc — matched here FIRST, before the standalone quotaOf() read below,
  // per the WS-R72 lesson this file's header cites (a later, more specific
  // statement sharing a substring with an earlier, more generic one must be
  // checked before it, never after). ─────────────────────────────────────
  if (has("insert into vy_context_item")) {
    const [
      itemId, replicaId, ownerUserId, kind, format, sourceName, sourceUrl, contentSha256, byteSize,
      extractedChars, extractor, status, refusalReason, routedTo, mineSkipReason, authorship,
      ownerSpeaker, consentScope, maxItems, maxBytes,
    ] = params;
    const owns = state.replicas.some((r) => r.replica_id === String(replicaId) && r.owner_user_id === String(ownerUserId));
    if (!owns) return [];
    const dup = state.contextItems.some(
      (i) => i.replica_id === String(replicaId) && i.content_sha256 === contentSha256,
    );
    if (dup) return [];
    const items = state.contextItems.filter((i) => i.owner_user_id === String(ownerUserId));
    const bytes = items.reduce((n, i) => n + (i.byte_size || 0), 0);
    if (items.length >= Number(maxItems) || bytes + Number(byteSize) > Number(maxBytes)) return [];
    const row = {
      item_id: String(itemId), replica_id: String(replicaId), owner_user_id: String(ownerUserId), kind, format,
      source_name: sourceName, source_url: sourceUrl, content_sha256: contentSha256, byte_size: Number(byteSize),
      extracted_chars: Number(extractedChars) || 0, extractor, status, refusal_reason: refusalReason, routed_to: routedTo,
      mine_skip_reason: mineSkipReason, authorship, owner_speaker: ownerSpeaker, consent_scope: consentScope,
      run_id: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    };
    state.contextItems.push(row);
    return [{ ...row }];
  }
  if (has("update vy_context_item") && has("set status = $3")) {
    const [itemId, ownerUserId, status, mineSkipReason, runId] = params;
    const row = state.contextItems.find((i) => i.item_id === String(itemId) && i.owner_user_id === String(ownerUserId));
    if (!row) return [];
    row.status = status;
    row.mine_skip_reason = mineSkipReason || "";
    row.run_id = runId ?? row.run_id;
    row.updated_at = new Date().toISOString();
    return [{ ...row }];
  }
  if (has("from vy_context_item") && has("content_sha256 = $3")) {
    const [rid, owner, hash] = params.map(String);
    const row = state.contextItems.find((i) => i.replica_id === rid && i.owner_user_id === owner && i.content_sha256 === hash);
    return row ? [{ ...row }] : [];
  }
  // The STANDALONE quotaOf() read (`addContextFile`'s own quota check,
  // before it ever attempts the insert above). Checked AFTER the insert
  // branch on purpose — see that branch's own comment. ────────────────────
  if (has("count(*)::int as items") && has("coalesce(sum(byte_size), 0)::bigint as bytes") && has("vy_context_item")) {
    const [owner] = params.map(String);
    const items = state.contextItems.filter((i) => i.owner_user_id === owner);
    return [{ items: items.length, bytes: items.reduce((n, i) => n + (i.byte_size || 0), 0) }];
  }
  if (has("from vy_context_item") && has("order by created_at desc") && has("limit $3")) {
    const [rid, owner] = params.map(String);
    return state.contextItems
      .filter((i) => i.replica_id === rid && i.owner_user_id === owner)
      .slice().sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  // ── api/_review-queue.js ─────────────────────────────────────────────────
  //
  // `persistReviewCards` and `decideReviewCard` both embed the file's own
  // `OWNED` constant VERBATIM inside a `with authorized as (${OWNED})` CTE
  // (`_review-queue.js`'s own source), so both statements' text contains
  // the exact substring the standalone OWNED read below matches on. Per
  // this file's WS-R72 lesson (a later, more specific statement sharing a
  // substring with an earlier, more generic one must be checked BEFORE it),
  // the insert and the decide are matched here, ahead of the generic OWNED
  // check that follows them. ─────────────────────────────────────────────
  if (has("insert into vy_review_card")) {
    const [rid, owner, payloadJson, cap] = params;
    const owns = state.replicas.some((r) => r.replica_id === String(rid) && r.owner_user_id === String(owner));
    if (!owns) return [];
    const drafts = JSON.parse(payloadJson);
    const openCount = state.reviewCards.filter((c) => c.replica_id === String(rid) && c.owner_user_id === String(owner) && c.state === "open").length;
    const slots = Math.max(0, Number(cap) - openCount);
    const existingHashes = new Set(state.reviewCards.filter((c) => c.replica_id === String(rid)).map((c) => c.dedupe_hash));
    const inserted = [];
    drafts.slice(0, slots).forEach((d) => {
      if (existingHashes.has(d.dedupe_hash)) return;
      const row = {
        card_id: randomUUID(), replica_id: String(rid), owner_user_id: String(owner),
        kind: d.kind, prompt_text: d.prompt_text, answer_text: d.answer_text,
        source_refs: d.source_refs || [], origin_ref: d.origin_ref || "", dedupe_hash: d.dedupe_hash,
        state: "open", decided_at: null, correction_source_id: null, created_at: new Date().toISOString(),
      };
      state.reviewCards.push(row);
      existingHashes.add(d.dedupe_hash);
      inserted.push(row);
    });
    return inserted;
  }
  // decideReviewCard's own CTE — matched on "landed_rule", a name unique to
  // this one statement in the whole file, and (per this block's own header)
  // checked ahead of the generic OWNED read below since it too embeds OWNED
  // verbatim. ────────────────────────────────────────────────────────────
  if (has("landed_rule")) {
    const [rid, owner, cardId, decision, correctionSourceId, pattern, reason] = params;
    const card = state.reviewCards.find(
      (c) => c.card_id === String(cardId) && c.owner_user_id === String(owner) && c.state === "open",
    );
    if (!card) return [];
    if (decision === "fixed" && !correctionSourceId) return [];
    card.state = decision;
    card.decided_at = new Date().toISOString();
    card.correction_source_id = decision === "fixed" ? correctionSourceId : null;
    if (decision === "never") {
      state.rehearsalNeverRules ??= [];
      state.rehearsalNeverRules.push({
        rule_id: randomUUID(), replica_id: String(rid), owner_user_id: String(owner),
        pattern: String(pattern), reason: String(reason || ""), card_id: card.card_id,
        revoked_at: null, created_at: new Date().toISOString(),
      });
    }
    return [{ ...card }];
  }
  // The generic OWNED read (`collectReviewInputs`'s own standalone call),
  // checked AFTER the insert and the decide above for the reason this
  // block's header gives. ───────────────────────────────────────────────
  if (has("from vy_replica r") && has("r.lifecycle not in ('revoked','purging')")) {
    const [rid, owner] = params.map(String);
    const row = state.replicas.find((r) => r.replica_id === rid && r.owner_user_id === owner);
    return row ? [{ replica_id: row.replica_id }] : [];
  }
  if (has("c.claim_id, c.body, c.source_ids")) return []; // no proposed claims fixtured
  if (has("from vy_mirror_delta")) return []; // no deltas fixtured
  if (has("select c.dedupe_hash from vy_review_card")) {
    const [rid, owner] = params.map(String);
    return state.reviewCards
      .filter((c) => c.replica_id === rid && c.owner_user_id === owner)
      .map((c) => ({ dedupe_hash: c.dedupe_hash }));
  }
  if (has("count(*) filter (where c.state = 'open')::int4 as open_count from vy_review_card")) {
    const [rid, owner] = params.map(String);
    const open = state.reviewCards.filter((c) => c.replica_id === rid && c.owner_user_id === owner && c.state === "open").length;
    return [{ open_count: open }];
  }
  if (has("c.card_id, c.kind, c.prompt_text, c.answer_text, c.source_refs, c.state,")) {
    const [rid, owner] = params.map(String);
    return state.reviewCards
      .filter((c) => c.replica_id === rid && c.owner_user_id === owner && c.state === "open")
      .slice().sort((a, b) => a.created_at.localeCompare(b.created_at));
  }
  if (has("count(*) filter (where c.state = 'open')::int4 as open_count,") && has("decided_count")) {
    const [rid, owner] = params.map(String);
    const cards = state.reviewCards.filter((c) => c.replica_id === rid && c.owner_user_id === owner);
    return [{
      open_count: cards.filter((c) => c.state === "open").length,
      decided_count: cards.filter((c) => c.state !== "open").length,
      fixed_count: cards.filter((c) => c.state === "fixed").length,
      never_count: cards.filter((c) => c.state === "never").length,
    }];
  }
  if (has("from vy_review_never_rule n") && has("active_rules")) {
    const [rid, owner] = params.map(String);
    return [{ active_rules: (state.rehearsalNeverRules || []).filter((n) => n.replica_id === rid && n.owner_user_id === owner && !n.revoked_at).length }];
  }
  if (has("select c.state from vy_review_card c") && has("card_id = $3::uuid")) {
    const [rid, owner, cardId] = params.map(String);
    const card = state.reviewCards.find((c) => c.replica_id === rid && c.owner_user_id === owner && c.card_id === cardId);
    return card ? [{ state: card.state }] : [];
  }

  // ── api/memory.js's `tableApplied` — creatorExport's per-table gate calls
  //    this for EVERY OWNER_LANE_TABLES entry before its own scopedQuery.
  //    Answering `present: true` for all of them is safe: every scopedQuery
  //    below is already `.catch(() => [])`-wrapped by `creatorExport` itself,
  //    so a table this rehearsal has no matcher for still resolves to a
  //    real, honest zero rather than being skipped from the manifest
  //    entirely (which is what a `present: false` answer would do). ──────
  if (has("select to_regclass($1) is not null as present")) return [{ present: true }];

  // ── api/_creator-export.js — the two ownership-scoping prefix reads
  //    (`creatorExport`'s own opening two statements, NOT inside the
  //    per-table loop that already `.catch(() => [])`s on its own). ───────
  if (has("select replica_id, agent_id from vy_replica where owner_user_id = $1::uuid")) {
    const [owner] = params.map(String);
    return state.replicas.filter((r) => r.owner_user_id === owner).map((r) => ({ replica_id: r.replica_id, agent_id: r.agent_id }));
  }
  if (has("select room_id from vy_room where owner_user_id = $1::uuid")) {
    const [owner] = params.map(String);
    return state.rooms.filter((r) => r.owner_user_id === owner).map((r) => ({ room_id: r.room_id }));
  }
  // Two OWNER_LANE_TABLES entries this rehearsal actually populates, so the
  // export's own manifest carries a real, non-zero count for at least one
  // row this walk itself wrote, rather than every entry reading as zero
  // because `creatorExport`'s per-table loop caught an unmodelled statement.
  // Every OTHER OWNER_LANE_TABLES entry is intentionally left unmodelled —
  // named in the workstream's report, not silently skipped — because
  // reproducing all of them is `evals/creator-export/run.mjs`'s own subject.
  if (has("select * from vy_context_item") && has("replica_id = any($1::uuid[])")) {
    const [replicaIds, owner] = params;
    return state.contextItems.filter((i) => replicaIds.includes(i.replica_id) && i.owner_user_id === String(owner));
  }
  if (has("select * from vy_review_card") && has("replica_id = any($1::uuid[])")) {
    const [replicaIds, owner] = params;
    return state.reviewCards.filter((c) => replicaIds.includes(c.replica_id) && c.owner_user_id === String(owner));
  }

  return undefined; // not a rehearsal pattern — fall through to doorsDb
}

/**
 * The creator-journey rehearsal's own fixture world: a brand-new owner with
 * NOTHING yet — no replica, no room, no review cards — since this rehearsal
 * drives the creation of every one of those for real, unlike `freshDoorsState`
 * (WS-R38's world), which pre-seeds one owned replica and room because ITS
 * cases are about attacking an EXISTING Room's doors, not building one.
 */
export function freshRehearsalCreatorState() {
  const state = freshDoorsState();
  state.replicas = [];
  state.rooms = [];
  state.reviewCards = [];
  state.roomShowcase = [];
  state.invites = [];
  state.contextItems = [];
  state.rehearsalClaims = [];
  state.rehearsalFidelity = null;
  state.rehearsalGenome = null;
  state.rehearsalMirror = null;
  state.rehearsalTeacherSheet = null;
  state.rehearsalNeverRules = [];
  // Readiness's OWN publish-lock snapshot, read by the room-publish
  // matchers above. Starts unmeasured (every part absent), which is the
  // real shape a brand-new replica's Readiness reads as — no seeding
  // required to reach "locked below the floor", it is the default.
  state.rehearsalReadinessLast = { unmeasured_count: 5, overall: 0, min_part: 0 };
  // Out of this rehearsal's scope (its own multi-stage pipelines): runtime
  // activation and disclosure approval are pre-seeded already-passing so
  // Readiness is the one gate this walk's own steps move.
  state.rehearsalRuntimeActive = true;
  state.rehearsalDisclosureApproved = true;
  return state;
}

/**
 * ONE db function for the rehearsal: the NEW patterns above first (so they
 * can override `doorsDb`'s existing permissive publish/resume matcher — see
 * this block's own header), `doorsDb` for everything else (replica creation,
 * room create/showcase/share-kit, and every follower-lane statement the base
 * Room fixture already answers).
 */
export function rehearsalCreatorDb(state) {
  const calls = [];
  const doors = doorsDb(state);
  const db = async (sql, params = []) => {
    calls.push(sql);
    const has = (s) => sql.includes(s);
    const hit = rehearsalPatterns(state, sql, params, has);
    if (hit !== undefined) return hit;
    return doors(sql, params);
  };
  db.calls = calls;
  return db;
}

// ═════════════════════════════════════════════════════════════════════════
// WS-R119 (wave seventeen, third pass). Fixture support neither `doorsDb`
// nor `rehearsalCreatorDb` already carries, for `evals/rehearsal/creator.mjs`'s
// real "Measure now" recall run and `evals/rehearsal/follower.mjs`'s real
// WhatsApp-chat join. Composed the SAME way `rehearsalCreatorDb` composes
// over `doorsDb` — new patterns tried FIRST, the existing db for everything
// else — rather than editing either existing function's body, so this stays
// a pure append (this file's own header law).
//
// Every match condition below was checked against a REPO-WIDE grep before
// being written, per this file's own WS-R72 lesson (a substring shared by
// two different real statements must be matched on something narrower, or
// checked in the more-specific-first order): `t.body as body` and
// `insert into vy_recall_run`/`from vy_recall_run r` are each unique to
// `api/_recall-run.js`/`api/_readiness.js`; `s.published_at desc nulls last`
// (mirrorReplyAgent's own ORDER BY) is unique among the THREE statements in
// `api/_mirrorcall-store.js` sharing the substring `r.subject_mode = 'self'`
// this file's original attempt matched on first, found the hard way and
// corrected before it shipped.
function ws119Patterns(state, sql, params, has) {
  // ── api/_recall-run.js's CONTEXT_ITEM_SQL — the held-out question set's
  //    own source read. `state.rehearsalRecallPassages`, never
  //    `state.contextItems`: the passages this suite seeds stand in for
  //    already-mined material, not a second copy of the ONE real file the
  //    creator walk's own Context Locker step adds (`evals/rehearsal/
  //    creator.mjs`'s own export-manifest negative control counts THAT one
  //    real row, `rows === 1` — polluting `state.contextItems` here would
  //    silently break it). ────────────────────────────────────────────────
  if (has("t.body as body")) {
    const [rid, owner] = params.map(String);
    return (state.rehearsalRecallPassages || [])
      .filter((p) => p.replica_id === rid && p.owner_user_id === owner)
      .slice()
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .map((p) => ({ source_id: p.source_id, body: p.body }));
  }
  // ── api/_recall-run.js's RECALL_RUN_INSERT_SQL (storeRecallRun) — the
  //    guard/supersede/insert CTE, simplified to the same "no idempotency
  //    guard reproduced" posture `rehearsalPatterns`' own readiness insert
  //    above already takes, PLUS the real one-run-per-hour rate predicate
  //    (this suite's own reason to keep it: proving the SAME "Measure now"
  //    click twice in one run must not silently double-count). ───────────
  if (has("insert into vy_recall_run")) {
    const [rid, owner, score, n, method, setHash] = params.map((v, i) => (i < 2 ? String(v) : v));
    state.recallRuns ??= [];
    const withinHour = state.recallRuns.some((r) => r.replica_id === rid && r.owner_user_id === owner
      && !r.superseded_at && (Date.now() - new Date(r.created_at).getTime()) < 3_600_000);
    if (withinHour) return [];
    for (const r of state.recallRuns) {
      if (r.replica_id === rid && r.owner_user_id === owner && !r.superseded_at) r.superseded_at = new Date().toISOString();
    }
    const row = {
      run_id: randomUUID(), replica_id: rid, owner_user_id: owner,
      score: Number(score), n: Number(n), method: String(method || ""), set_hash: String(setHash || ""),
      superseded_at: null, created_at: new Date().toISOString(),
    };
    state.recallRuns.push(row);
    return [{ run_id: row.run_id, created_at: row.created_at }];
  }
  // ── api/_readiness.js's RECALL_RUN_SQL (readRecallRun) — the latest
  //    unsuperseded row, real superseding included. ─────────────────────
  if (has("from vy_recall_run r") && has("superseded_at is null")) {
    const [rid, owner] = params.map(String);
    const rows = (state.recallRuns || [])
      .filter((r) => r.replica_id === rid && r.owner_user_id === owner && !r.superseded_at)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
    const row = rows[0];
    return row ? [{ score: row.score, n: row.n, method: row.method, created_at: row.created_at }] : [];
  }
  // ── api/_mirrorcall-store.js's mirrorReplyAgent — the recall run's own
  //    "which compiled agent answers" read. Keyed on (replica_id,
  //    owner_user_id), unlike the EXISTING `from vy_teacher_sheet s`/
  //    `join vy_agent a` matcher in `doorsPatterns` above (WS-R94's
  //    `publishedRow`, keyed on a SLUG param) — checked here, ahead of that
  //    one, so this rehearsal's own call (which passes a replica_id as its
  //    first param, never a slug) is never silently answered `[]` by the
  //    slug-keyed matcher misreading it as an unknown slug. ───────────────
  if (has("s.published_at desc nulls last")) {
    const [rid, owner] = params.map(String);
    const replica = (state.replicas || []).find((r) => r.replica_id === rid && r.owner_user_id === owner);
    if (!replica) return [];
    const rows = (state.teacherSheets || [])
      .filter((s) => s.agent_id === replica.agent_id && s.status !== "revoked")
      .slice()
      .sort((a, b) => {
        const aPub = a.status === "published" && a.consent_artifact_id != null ? 1 : 0;
        const bPub = b.status === "published" && b.consent_artifact_id != null ? 1 : 0;
        if (aPub !== bPub) return bPub - aPub;
        return String(b.published_at || b.created_at || "").localeCompare(String(a.published_at || a.created_at || ""));
      });
    const row = rows[0];
    return row
      ? [{
          sheet_id: row.sheet_id, agent_id: row.agent_id, version: row.version, sheet: row.sheet, status: row.status,
          consent_artifact_id: row.consent_artifact_id, published_at: row.published_at, created_at: row.created_at,
          slug: row.slug || "",
        }]
      : [];
  }

  // ── api/_room-voice.js's LATEST_DRAFT_GENOME_SQL — `authorizeRoomVoice`'s
  //    OWN first read (never redirected: only `_replica-voice-preview.js`'s
  //    exports are faked this wave, `_room-voice.js` itself is real and
  //    unmodified), reached by the Telegram voice rehearsal's real
  //    `roomSpeak` call. Absent from every existing fixture (`doorsDb`
  //    included — confirmed by grep: no suite sharing this fixture reaches
  //    `authorizeRoomVoice` through the real HTTP door before this one).
  //    Answers "a draft genome exists" unconditionally for any replica —
  //    this rehearsal has exactly one Room/replica, so there is no second
  //    replica for a real caller to confuse this with. ───────────────────
  if (has("max(g.version)::int4 as version")) {
    return [{ version: 1 }];
  }

  // ── api/_room-whatsapp-chat.js — migration 128's own pointer table, NOT
  //    modelled in `doorsDb`/`fakeDb` (confirmed by grep before this was
  //    added: `evals/room-whatsapp-chat/run.mjs`'s own `withWhatsappChat`
  //    wrapper is a LOCAL function in that suite, never exported, so this is
  //    a restatement over `state.waChatPointers` rather than a second,
  //    divergent shape). `bindWhatsappChatPointer`'s own upsert. ─────────
  if (has("insert into vy_room_follower_whatsapp_chat")) {
    const [hash, roomId, personId, followerId, locale] = params.map(String);
    state.waChatPointers ??= [];
    const existing = state.waChatPointers.find((c) => c.phone_hash === hash);
    if (existing) {
      Object.assign(existing, { room_id: roomId, person_id: personId, follower_id: followerId, locale, stopped_at: null, stopped_code: null });
    } else {
      state.waChatPointers.push({
        phone_hash: hash, room_id: roomId, person_id: personId, follower_id: followerId, locale,
        joined_at: new Date().toISOString(), stopped_at: null, stopped_code: null,
      });
    }
    return [];
  }
  // `whatsappChatPointerRoom` — which slug this phone's ACTIVE pointer means.
  if (has("from vy_room_follower_whatsapp_chat c") && has("join vy_room r")) {
    const [hash] = params.map(String);
    const row = (state.waChatPointers || []).find((c) => c.phone_hash === hash && !c.stopped_at);
    if (!row) return [];
    const r = (state.rooms || []).find((x) => x.room_id === row.room_id);
    return r ? [{ slug: r.slug }] : [];
  }
  // `stopWhatsappChatPointer` — `stop`, never a delete.
  if (has("update vy_room_follower_whatsapp_chat") && has("set stopped_at = now()")) {
    const [hash, code] = params.map(String);
    const row = (state.waChatPointers || []).find((c) => c.phone_hash === hash && !c.stopped_at);
    if (row) { row.stopped_at = new Date().toISOString(); row.stopped_code = code; }
    return [];
  }

  return undefined; // not a WS-R119 pattern — fall through to doorsDb/rehearsalCreatorDb
}

/** WS-R119. The follower rehearsal's own db, ahead of `doorsDb`. */
export function ws119FollowerDb(state) {
  state.rehearsalRecallPassages ??= [];
  state.recallRuns ??= [];
  state.waChatPointers ??= [];
  const doors = doorsDb(state);
  const db = async (sql, params = []) => {
    const has = (s) => sql.includes(s);
    const hit = ws119Patterns(state, sql, params, has);
    if (hit !== undefined) return hit;
    return doors(sql, params);
  };
  return db;
}

/** WS-R119. The creator rehearsal's own db, ahead of `rehearsalCreatorDb`
 *  (which is itself ahead of `doorsDb`) — the recall run's own reads/writes
 *  need to win over `rehearsalCreatorDb`'s existing patterns exactly as that
 *  file's own patterns need to win over `doorsDb`'s, for the identical
 *  reason (a more specific matcher added later must be tried first). */
export function ws119CreatorDb(state) {
  state.rehearsalRecallPassages ??= [];
  state.recallRuns ??= [];
  const rehearsal = rehearsalCreatorDb(state);
  const db = async (sql, params = []) => {
    const has = (s) => sql.includes(s);
    const hit = ws119Patterns(state, sql, params, has);
    if (hit !== undefined) return hit;
    return rehearsal(sql, params);
  };
  return db;
}
