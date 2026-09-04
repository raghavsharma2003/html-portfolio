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
  // — nothing here EVER inserts a second real room, so `attachRoom`/`orgBoard`
  // style multi-room reads are deliberately out of this battery's scope; see
  // this file's own header note in evals/room-doors/run.mjs on why.
  state.rooms[0].handoff_enabled = false;
  state.rooms[0].handoff_monthly_cap = 5;
  state.replicas = [
    {
      replica_id: REPLICA_ID, owner_user_id: OWNER, display_name: "Anjali",
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

    // ── vy_creator_application (api/_apply.js) — only the happy-path insert
    //    and the daily-per-contact refusal are needed here; every OTHER
    //    application read this battery cares about is the operator-bearer
    //    boundary, which never reaches SQL at all (`requireOperator` throws
    //    first). ──────────────────────────────────────────────────────────
    if (has("insert into vy_creator_application")) {
      const [id, name, archiveLink, audience, contact, key, day] = params;
      if (state.applications.some((a) => a.contact_key === key && a.applied_on === day)) return [];
      const row = {
        application_id: id, name, archive_link: archiveLink, audience, contact,
        contact_key: key, applied_on: day, status: "new", created_at: new Date().toISOString(),
      };
      state.applications.push(row);
      return [row];
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
      const event = {
        event_id: `e${state.events.length + 1}`, provider, provider_event_ref: ref, room_id: roomId,
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
      return [{ event_id: event.event_id, subscription_id: subId, state: sub ? sub.state : null, tier }];
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
    if (has("from vy_org_subscription") && has("org_id = ($1)::uuid") && has("state in (")) {
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
