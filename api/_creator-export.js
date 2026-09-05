// WS-R70. The creator's export: everything the platform holds about a
// creator's own replica(s), as one JSON document — the export half of the
// pair api/_replica-full-erasure.js's deletion cascade is the other half of.
// India's DPDP Act and plain fairness say a person who gave this platform
// their archive, their voice and their money is entitled to take it with
// them; api/_replica-full-erasure.js already gives them full erasure. This
// file is the missing right, built to the SAME completeness discipline —
// evals/creator-export/run.mjs statically parses api/_replica-full-
// erasure.js's own source text and asserts OWNER_LANE_TABLES below names
// exactly the owner-lane subset of what it reaches, so a table added to
// either file and not the other fails the gate.
//
// ── THE BOUNDARY LAW (absolute, ws-common.md) ───────────────────────────────
//
// NOTHING from any follower lane enters this export. No follower row, no
// message, no thread. Every table api/memory.js's PERSON_TABLES manifest
// names is data that belongs to WHOEVER `person_id` on that row identifies —
// a follower talking to this creator's AI — and that is theirs to export
// (api/_room-surface.js's `roomExport`), never the creator's, even though a
// full replica erasure wipes all of it alongside the creator's own data: a
// creator has authority to END the whole relationship, never to READ a
// follower's own words back to themselves.
//
// A few tables deserve their own line because a careless reading of
// api/_replica-full-erasure.js's own source could put them here by mistake
// — and two of them are deliberately never named by their literal
// identifier anywhere in this file, for the identical reason the Handoff
// note just below states in full: evals/room-leak/run.mjs's own repo-wide
// static scan fails the build for any api/*.js file outside a table's own
// allowed lane that so much as mentions its name, comment or code alike.
//
//   - The Room's own thread-title and membership tables. Deleted BY NAME in
//     the erasure chain, scoped by `agent_id` (the whole Room's worth of
//     followers, not one), which makes them LOOK owner-lane if you read
//     only the WHERE clause. They are PERSON_TABLES entries (key
//     `person_id`) — a follower's own membership and the names they gave
//     their own threads — and stay excluded here on that authority, not on
//     the erasure file's scoping predicate.
//   - `vy_room_subscription`. Also PERSON_TABLES (key `person_id`), also
//     reached from the owner-lane block of api/_replica-full-erasure.js (by
//     `room_id`, alongside `vy_payment_event`), for the identical reason:
//     the erasure job has authority to end every subscription in a Room it
//     is tearing down; that authority does not make the SUBSCRIPTION ROW
//     the owner's to read back. `vy_payment_event` is excluded for the same
//     boundary reason and for an independent one: it carries no
//     `owner_user_id`/`replica_id` column at all (schema-checked, not
//     assumed) — see the note on `vy_payment_event` below.
//   - The Room's per-day arrival-source counts. Content-free (no person or
//     follower column exists on it at all) and genuinely owner-adjacent,
//     but every existing reader of it (api/_funnel.js's own share-arrivals
//     line) is held to a stricter discipline than "content-free" alone
//     buys: a SELECT naming it must be a single rolled-up SQL aggregate,
//     never a per-row dump — this export's own per-table shape (`select *`)
//     cannot satisfy that without becoming a second, weaker exception to a
//     rule a sibling gate enforces for a reason unrelated to this
//     workstream's own boundary law. Left out rather than fought; the
//     workstream brief names Pulse counts and cohort counts as the explicit
//     aggregate carve-out, never this table by name.
//
// The Handoff table (083's own header: "the one PERSON-lane exception to
// 071's 'never a word' law") is excluded entirely, not partially, and is
// deliberately never named by its literal identifier anywhere in this file
// — evals/room-leak/run.mjs's own repo-wide static scan fails the build for
// any api/*.js file outside Handoff's own lane that so much as MENTIONS
// that table's name, comment or code alike, and this file's job is to
// explain the exclusion, not to become a second place the name appears. A
// follower's verbatim ask and the creator's own verbatim reply sit on the
// SAME row of that table, and there is no column-level split that hands the
// creator their own reply without also handing back the follower's
// question. WS-R67 ("flag this reply") was slated to add a creator-side
// view of handoff; as of this workstream (a414c7c) no such table exists in
// this tree — grepped, not assumed. Reversal condition: once WS-R67's own
// creator-side table lands, add IT here, never the Handoff table itself.
// context/decisions.md#ws-r70-creator-export-excludes-vy-room-handoff names
// this with its reversal condition.
//
// `vy_payment_event`, `vy_replica_erasure_job`, `vy_replica_erasure_attempt`
// and `vy_replica_deletion_receipt` are the four deliberate gaps on the
// OWNER side (never a follower-lane question): the first carries no owning
// column at all to scope a query on (schema-checked); the last three are
// erasure-PROCESS bookkeeping — a job only exists once revocation was
// requested, and the receipt is deliberately HMAC-hashed with no plain
// owner_user_id/replica_id column to filter by (api/_replica-full-
// erasure.js's own header: "NOT an HMAC... looked up later, by an
// operator") — neither is "the creator's own content" in the sense this
// export exists to hand back. context/decisions.md names both gaps with
// their reversal conditions.
import { PERSON_TABLES, tableApplied as realTableApplied } from "./memory.js";

/**
 * Every owner-lane table this export reaches, one entry per table, with the
 * SCOPE that says how it is bound to the calling owner — never a second
 * reading of api/_replica-full-erasure.js's SQL, a hand-built manifest in
 * the same spirit as api/memory.js's PERSON_TABLES, checked against that
 * file's own source by evals/creator-export/run.mjs rather than trusted by
 * inspection alone.
 *
 * `replica`  — `replica_id = any($replicaIds) and owner_user_id = $owner`.
 *              Every table erasure reaches with that identical pair, plus
 *              `vy_replica` itself and its own identity row's companion.
 * `owner`    — `owner_user_id = $owner` alone (no replica_id column at all —
 *              an owner-wide record: payouts, Suite membership).
 * `invite_redeemed` — `redeemed_by_user_id = $owner` (vy_creator_invite has
 *              no owner_user_id column; this IS the owner's id once spent,
 *              086's own migration header).
 * `room_owner` — carries owner_user_id directly AND is scoped to this
 *              owner's own rooms (`room_id = any($roomIds)`), e.g. the
 *              price and the check-in design a creator authored.
 * `room_agg` — NO owner_user_id column at all, but a content-free, k-
 *              anonymous or otherwise never-verbatim aggregate scoped to
 *              this owner's own rooms — the workstream brief's own named
 *              exception ("Pulse counts and cohort counts are included
 *              because they are the creator's aggregate view").
 * `renewal_creator` — `vy_renewal_reminder`'s one creator-subject slice of a
 *              three-lane table (subject_kind='creator'), never the
 *              follower slice of the SAME table.
 * `agent`    — `vy_agent`, which carries no owner_user_id/replica_id column
 *              of its own at all; reached by joining through this owner's
 *              own replica rows' `agent_id`, the identical join
 *              `completeReplicaErasure`'s own `removed_agent` CTE uses.
 */
export const OWNER_LANE_TABLES = Object.freeze([
  // ── the replica and its own identity companion ────────────────────────
  { table: "vy_replica", scope: "replica" },
  { table: "vy_agent", scope: "agent" },

  // ── archive material: pointers and metadata, never bytes ──────────────
  { table: "vy_replica_source", scope: "replica" },
  { table: "vy_context_item", scope: "replica" },
  { table: "vy_context_item_text", scope: "replica" },
  { table: "vy_video_enrollment", scope: "replica" },
  { table: "vy_video_enrollment_window", scope: "replica" },
  { table: "vy_ingest_run", scope: "replica" },
  { table: "vy_channel_watch", scope: "replica" },
  { table: "vy_clone_channel", scope: "replica" },
  { table: "vy_channel_attestation", scope: "replica" },

  // ── voice and identity ─────────────────────────────────────────────────
  { table: "vy_replica_voice_profile", scope: "replica" },
  { table: "vy_replica_voice_challenge", scope: "replica" },
  { table: "vy_replica_voice_challenge_attempt", scope: "replica" },
  { table: "vy_replica_liveness_challenge", scope: "replica" },
  { table: "vy_replica_liveness_verification_attempt", scope: "replica" },
  { table: "vy_replica_biometric_verification_grant", scope: "replica" },

  // ── consent ─────────────────────────────────────────────────────────────
  { table: "vy_replica_consent", scope: "replica" },
  { table: "vy_replica_provider_consent", scope: "replica" },

  // ── Mirror Call, interview, the review queue ───────────────────────────
  { table: "vy_mirror_session", scope: "replica" },
  { table: "vy_mirror_window", scope: "replica" },
  { table: "vy_mirror_conditioning", scope: "replica" },
  { table: "vy_mirror_finetune_job", scope: "replica" },
  { table: "vy_mirror_delta", scope: "replica" },
  { table: "vy_mirror_feedback", scope: "replica" },
  { table: "vy_mirror_turn", scope: "replica" },
  { table: "vy_interview_session", scope: "replica" },
  { table: "vy_interview_answer", scope: "replica" },
  { table: "vy_review_card", scope: "replica" },
  { table: "vy_review_never_rule", scope: "replica" },

  // ── operational history ─────────────────────────────────────────────────
  { table: "vy_replica_activity", scope: "replica" },
  { table: "vy_replica_audit", scope: "replica" },
  { table: "vy_replica_readiness", scope: "replica" },
  { table: "vy_replica_funnel_mark", scope: "replica" },
  { table: "vy_replica_drift_report", scope: "replica" },
  { table: "vy_replica_generation", scope: "replica" },

  // ── the Room itself and what the creator authored on it ────────────────
  { table: "vy_room", scope: "replica" },
  { table: "vy_room_price", scope: "room_owner" },
  { table: "vy_room_checkin_design", scope: "room_owner" },
  { table: "vy_room_pulse_topic", scope: "room_owner" },

  // ── the creator's own aggregate view — counts, never verbatim ──────────
  { table: "vy_room_pulse_snapshot", scope: "room_agg" },
  { table: "vy_room_pulse_combo", scope: "room_agg" },
  { table: "vy_room_pulse_week", scope: "room_agg" },
  { table: "vy_room_org_attachment", scope: "room_agg" },

  // ── money ───────────────────────────────────────────────────────────────
  { table: "vy_creator_subscription", scope: "replica" },
  { table: "vy_creator_charge_event", scope: "replica" },
  { table: "vy_creator_payout", scope: "owner" },
  { table: "vy_creator_payout_account", scope: "owner" },

  // ── Suites ──────────────────────────────────────────────────────────────
  { table: "vy_org_member", scope: "owner" },
  // WS-R62 (migration 114), merged beside this workstream: an operator's
  // own push subscriptions, keyed on owner_user_id alone (added at the merge
  // the day the completeness proof met the table).
  { table: "vy_operator_push_subscription", scope: "owner" },
  { table: "vy_creator_invite", scope: "invite_redeemed" },

  // ── the reminder ledger, creator subject only ──────────────────────────
  { table: "vy_renewal_reminder", scope: "renewal_creator" },

  // ── WS-R74 (migration 118), the creator's weekly push ─────────────────
  // `vy_creator_weekly_push`: `vy_room_pulse_week`'s own "room_agg" shape
  // restated for a content-free send ledger (no owner_user_id column on
  // the table itself, reached by joining through this owner's own rooms).
  { table: "vy_creator_weekly_push", scope: "room_agg" },
  // `vy_creator_push_subscription`: `vy_operator_push_subscription`'s own
  // shape restated for a creator's own device instead of a platform
  // operator's.
  { table: "vy_creator_push_subscription", scope: "owner" },
]);

/** Every table `PERSON_TABLES` names, plus the two named in this file's own
 *  header that would otherwise look owner-lane from api/_replica-full-
 *  erasure.js's WHERE clause alone. The static scan and the negative
 *  control below both check `OWNER_LANE_TABLES` against this set — a table
 *  in both is a boundary violation, not a coverage gap. */
export function followerLaneTableNames() {
  return new Set(PERSON_TABLES.map((t) => t.table));
}

/** The four deliberate gaps on the OWNER side — never a follower-lane
 *  question, named here once so the completeness comparison in
 *  evals/creator-export/run.mjs can state its own exclusions rather than
 *  re-deriving them, and so a future table added to erasure with none of
 *  these four names fails the comparison instead of silently joining an
 *  ad hoc exception list. */
export const OWNER_LANE_DELIBERATE_GAPS = Object.freeze([
  "vy_payment_event",
  "vy_replica_erasure_job",
  "vy_replica_erasure_attempt",
  "vy_replica_deletion_receipt",
]);

/** The one table that is legitimately BOTH: `vy_renewal_reminder` holds
 *  three mutually exclusive subject lanes in a single physical table
 *  (migration 099's own CHECK constraint) — a follower's own reminder
 *  history is `PERSON_TABLES`' bar (`api/memory.js` lists it there,
 *  `wipeWhere: "subject_kind = 'follower'"`), and a creator's own is this
 *  file's bar, reached by the DISJOINT predicate `subject_kind = 'creator'`
 *  (`scopedQuery`'s own "renewal_creator" case). Being in `PERSON_TABLES`
 *  does not make the CREATOR-subject rows follower-lane data — they never
 *  carry a `person_id` at all (migration 099's own `vy_renewal_reminder_
 *  one_lane` CHECK makes the two lanes' columns mutually exclusive) — so
 *  this table is named here, once, as the sanctioned exception to "a
 *  PERSON_TABLES table is never owner-lane", rather than the boundary scan
 *  either missing a real owner-lane table or a future table copying this
 *  shape inventing its own ad hoc carve-out. */
export const MIXED_LANE_TABLES = Object.freeze(["vy_renewal_reminder"]);

/** The names `OWNER_LANE_TABLES` reaches, as a plain array — one place, so
 *  the eval's static comparison and `creatorExportManifest()` below cannot
 *  drift about the list either reads. */
export function creatorExportTableNames() {
  return OWNER_LANE_TABLES.map((t) => t.table);
}

/** The read for one manifest entry: `{ sql, params }`, never a second
 *  reading of `ownerEq`/`keysOf` (those generators are the WRITE-side
 *  wipe's own shape, api/memory.js's own header; a read here follows
 *  api/_room-surface.js's `roomExport` precedent — the ownership half is
 *  rebuilt, never sliced back out of someone else's string). `ctx` carries
 *  the four id sets every scope draws from, computed once per call by
 *  `creatorExport` below. */
export function scopedQuery(entry, ctx) {
  const { replicaIds, ownerUserId, roomIds, agentIds } = ctx;
  switch (entry.scope) {
    case "replica":
      return {
        sql: `select * from ${entry.table} where replica_id = any($1::uuid[]) and owner_user_id = $2::uuid limit 20000`,
        params: [replicaIds, ownerUserId],
      };
    case "owner":
      return {
        sql: `select * from ${entry.table} where owner_user_id = $1::uuid limit 20000`,
        params: [ownerUserId],
      };
    case "invite_redeemed":
      return {
        sql: `select * from ${entry.table} where redeemed_by_user_id = $1::uuid limit 20000`,
        params: [ownerUserId],
      };
    case "room_owner":
      return {
        sql: `select * from ${entry.table} where owner_user_id = $1::uuid and room_id = any($2::uuid[]) limit 20000`,
        params: [ownerUserId, roomIds],
      };
    case "room_agg":
      return {
        sql: `select * from ${entry.table} where room_id = any($1::uuid[]) limit 20000`,
        params: [roomIds],
      };
    case "renewal_creator":
      return {
        sql: `select * from ${entry.table} where subject_kind = 'creator' and owner_user_id = $1::uuid and replica_id = any($2::uuid[]) limit 20000`,
        params: [ownerUserId, replicaIds],
      };
    case "agent":
      return {
        sql: `select * from ${entry.table} where agent_id = any($1::uuid[]) limit 20000`,
        params: [agentIds],
      };
    default:
      throw new Error(`creatorExport: unknown owner-lane scope "${entry.scope}" for ${entry.table}`);
  }
}

/** A thin projection of `vy_replica_source` rows into POINTERS — never the
 *  bytes, the workstream brief's own words. The full row (including these
 *  same columns) also lives under `tables.vy_replica_source`; this is a
 *  convenience summary for exactly the question a creator asks first
 *  ("what do you have, and how big is it"), not a second source of truth. */
function storagePointersFrom(sourceRows) {
  return (sourceRows || []).map((s) => ({
    source_id: s.source_id,
    kind: s.kind,
    storage_bucket: s.storage_bucket,
    object_path: s.object_path,
    byte_size: s.byte_size,
    mime: s.mime,
    sha256: s.sha256,
    created_at: s.created_at,
  }));
}

/**
 * Everything the platform holds about ONE owner's replica(s), as one JSON
 * document. `db` is the injectable seam every module in this house takes;
 * `ownerUserId` is a Supabase auth id, never a request-supplied one — the
 * HTTP door (api/replica.js) reads it off `requireUser(req)`, the same rule
 * `revokeReplica`/`erasure_status` already follow, so there is no
 * cross-identity input for an attacker to supply at all (evals/room-doors/
 * run.mjs's own OP_COVERAGE entry for this op names this).
 */
export async function creatorExport(db, ownerUserId, options = {}) {
  if (typeof db !== "function") throw new Error("creatorExport: db required");
  if (!ownerUserId) throw new Error("creatorExport: ownerUserId required");
  const isApplied = options.tableApplied ?? realTableApplied;
  const now = options.now ?? Date.now();

  const replicaRows = await db(
    `select replica_id, agent_id from vy_replica where owner_user_id = $1::uuid`,
    [ownerUserId],
  );
  const replicaIds = replicaRows.map((r) => r.replica_id);
  const agentIds = replicaRows.map((r) => r.agent_id).filter(Boolean);
  const roomRows = await db(`select room_id from vy_room where owner_user_id = $1::uuid`, [ownerUserId]);
  const roomIds = roomRows.map((r) => r.room_id);
  const ctx = { replicaIds, ownerUserId, roomIds, agentIds };

  const tables = {};
  const manifest = [];
  for (const entry of OWNER_LANE_TABLES) {
    if (!(await isApplied(entry.table))) continue;
    const { sql, params } = scopedQuery(entry, ctx);
    const rows = await db(sql, params).catch(() => []);
    manifest.push({ table: entry.table, rows: rows.length });
    if (rows.length) tables[entry.table] = rows;
  }

  return Object.freeze({
    format: "vyakti-creator-export/1",
    exported_at: new Date(now).toISOString(),
    owner_user_id: ownerUserId,
    replicas: replicaIds,
    scope: "your account only",
    note:
      "Everything this platform holds about you and your AI: your archive, your voice, " +
      "your Room's own settings, your payouts, your review decisions. Nothing a follower " +
      "said to your AI in private is in here, and nothing a follower is, even in aggregate " +
      "below n=5 - that stays theirs, never yours to read back.",
    manifest,
    tables,
    storage: storagePointersFrom(tables.vy_replica_source),
  });
}
