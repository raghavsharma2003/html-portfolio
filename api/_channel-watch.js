// The attestation artifact and the watch it authorizes (Gurukul WS-S).
//
// WS-M found the gap this file closes: nothing in `api/` ever INSERTed into
// `vy_channel_watch`, so the stays-current loop had a worker, a cron, a
// schema and a review UI and no way to be STARTED. A loop nobody can start is
// `dead-writers` with the arrow reversed — code that runs and can never have
// anything to do.
//
// It is closed here rather than in a general "create a watch" endpoint,
// because the same commit that makes the loop startable also makes in-house
// audio extraction possible, and those two must never ship apart. The gate:
//
//   a watch cannot be created without a LIVE ATTESTATION for that exact
//   channel URL, and extraction cannot happen without a watch.
//
// Both halves are SQL predicates, not branches. `gate0-structural` is the
// measurement (`context/rejected.md`: prompt instructions leaked 57-98%, the
// SQL predicate leaked 0 of 31,122), and the thing being prevented here is a
// service that extracts audio from a channel nobody attested owning — which
// is the difference between this platform and a downloader.
//
// ── the receipt is built the way every other consent artifact is ──────────
// `api/_replica-consent.js` was read first, as the brief requires, and the
// receipt construction below is deliberately the SAME shape as
// `makeConsentReceipt` / `makeVerifiedModelConsentReceipt`: a canonical-JSON
// payload with `receipt_format`, `canonicalization`, `hash_algorithm`, a
// named `statement_set`, the principal, the policy version, a nonce and the
// attested statements, hashed with sha256. Migration 057's header says why
// the STORAGE is a new table and not a new scope on `vy_replica_consent`:
// that table is keyed by scope — a verb — and this permission needs the
// OBJECT of the verb (`channel_url`) to be a column a WHERE clause can name.
//
// ── what the teacher is actually attesting ────────────────────────────────
// The statements below are the honest ones, including the uncomfortable one.
// `understands_tos_exposure_is_not_copyright_permission` exists because the
// teacher CAN grant us copyright permission for their own lectures and CANNOT
// grant us YouTube's permission to download them, and a consent artifact that
// let a teacher believe otherwise would be a consent artifact that misinforms
// the person it protects. services/media-extract/README.md §"The legal
// posture" is the long form; this list is the part the teacher signs.
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { REPLICA_POLICY_VERSION, replicaId } from "./_replica.js";
import { canonicalJson } from "./_provenance/contracts.js";
import { channelRef } from "./_channel/contracts.js";

export const CHANNEL_ATTESTATION_STATEMENT_SET = "channel-ownership-attestation/v1";

export const CHANNEL_ATTESTATIONS = Object.freeze([
  "owns_or_controls_channel",
  "is_rights_holder_of_uploads",
  "authorizes_audio_extraction_for_own_replica",
  "understands_tos_exposure_is_not_copyright_permission",
  "understands_revocation_stops_extraction",
]);

/** A year, matching `grantAccountConsent`'s term. Bounded because migration
 *  057 makes `expires_at` NOT NULL, and bounded HERE too so the only writer
 *  cannot supply an unbounded one. */
export const CHANNEL_ATTESTATION_TERM_MS = 365 * 24 * 60 * 60 * 1000;

export const WATCH_STATUSES = Object.freeze(["active", "paused", "revoked"]);

export class ChannelWatchError extends Error {
  constructor(code, status = 400, details) {
    super(code);
    this.code = code;
    this.status = status;
    if (details) this.details = details;
  }
}

function fail(code, status = 400, details) {
  throw new ChannelWatchError(code, status, details);
}

export function channelAttestations(value) {
  const input = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  if (Object.keys(input).length !== CHANNEL_ATTESTATIONS.length ||
      CHANNEL_ATTESTATIONS.some((key) => input[key] !== true)) {
    fail("all channel ownership attestations are required", 409);
  }
  return Object.freeze(Object.fromEntries(CHANNEL_ATTESTATIONS.map((key) => [key, true])));
}

export function makeChannelAttestationReceipt({ ownerUserId, replica, channel, attestations, now = new Date(), nonce } = {}) {
  const at = now instanceof Date ? now.toISOString() : new Date(now).toISOString();
  const payload = Object.freeze({
    receipt_format: "vyakti-consent-v1",
    canonicalization: "vyakti-canonical-json/v1",
    hash_algorithm: "sha256",
    statement_set: CHANNEL_ATTESTATION_STATEMENT_SET,
    owner_user_id: String(ownerUserId),
    replica_id: replicaId(replica),
    // The object of the permission is IN the receipt, so the hash covers it.
    // A receipt that did not name the channel would be a receipt that could
    // be presented for a different channel.
    channel_url: channel.url,
    channel_key: channel.key,
    provider: channel.provider,
    method: "account_attestation",
    policy_version: REPLICA_POLICY_VERSION,
    granted_at: at,
    expires_at: new Date(new Date(at).getTime() + CHANNEL_ATTESTATION_TERM_MS).toISOString(),
    nonce: nonce || randomBytes(24).toString("hex"),
    attestations,
  });
  if (!/^[0-9a-f]{48}$/.test(payload.nonce)) fail("channel attestation nonce invalid", 500);
  return Object.freeze({
    hash: createHash("sha256").update(canonicalJson(payload)).digest("hex"),
    grantedAt: payload.granted_at,
    expiresAt: payload.expires_at,
    payload,
  });
}

/** What leaves the server. The receipt HASH is included (a teacher may want to
 *  keep it), the receipt PAYLOAD is not — it carries the owner id and a nonce
 *  and there is nothing a studio does with either. */
export function clientAttestation(row) {
  return {
    attestation_id: row.attestation_id,
    channel_url: row.channel_url,
    provider: row.provider,
    statement_set: row.statement_set,
    receipt_hash: row.receipt_hash,
    granted_at: row.granted_at,
    expires_at: row.expires_at,
    revoked_at: row.revoked_at,
    live: !row.revoked_at && Date.parse(row.expires_at) > Date.now(),
  };
}

export function clientWatch(row) {
  return {
    watch_id: row.watch_id,
    channel_url: row.channel_url,
    provider: row.provider,
    status: row.status,
    last_seen_video_id: row.last_seen_video_id,
    last_checked_at: row.last_checked_at,
    // PRESENCE, never a value — api/_clonechannel.js's `clientChannel` rule.
    // A studio needs to render a gate, not to hold a uuid in a network log.
    attested: Boolean(row.attestation_id),
    backfill_state: row.backfill_state || "idle",
    backfill_after_video_id: row.backfill_after_video_id || "",
    oauth_grant: row.oauth_grant_ref ? "present" : null,
    created_at: row.created_at,
  };
}

const ATTESTATION_COLUMNS = `attestation_id, replica_id, channel_url, provider, statement_set,
  receipt_hash, granted_at, expires_at, revoked_at`;

const WATCH_COLUMNS = `watch_id, replica_id, channel_url, provider, status,
  last_seen_video_id, last_checked_at, attestation_id, oauth_grant_ref,
  backfill_state, backfill_after_video_id, created_at`;

/** Records the attestation. Owner-scoped and replica-scoped in the SELECT that
 *  feeds the INSERT, so a caller naming somebody else's replica inserts zero
 *  rows rather than being rejected by a branch that could later be edited.
 *
 *  A previous LIVE attestation for the same channel is revoked in the same
 *  request, not deleted — 051's "revoked rows are kept": the row is the record
 *  of what was permitted and when. The partial unique index makes the order
 *  load-bearing, so the revoke CTE runs before the insert. */
export async function attestChannelOwnership(db, ownerUserId, id, input, options = {}) {
  const rid = replicaId(id);
  const channel = channelRef(input?.channel_url);
  const attestations = channelAttestations(input?.attestations);
  const receipt = makeChannelAttestationReceipt({
    ownerUserId,
    replica: rid,
    channel,
    attestations,
    now: options.now,
    nonce: options.nonce,
  });
  // TWO statements, not one, and the order is the failure direction.
  //
  // The obvious single statement — a `superseded` CTE that revokes the live
  // row and a `granted` CTE that inserts the new one — races its own partial
  // unique index: both CTEs see the same snapshot, and the index is
  // maintained as the insert happens, so the not-yet-committed revoke may not
  // have cleared the way. `grantAccountConsent` can write it as one statement
  // because its index is not partial; this one's is.
  //
  // Split, a crash between the two leaves the previous attestation REVOKED
  // and the new one absent — permission withdrawn and not yet re-granted,
  // which is the direction a consent artifact must fail in. The teacher
  // clicks again. The other order would leave two live attestations or a
  // grant with nothing revoked.
  await db(
    `update vy_channel_attestation
        set revoked_at = coalesce(revoked_at, ($4)::timestamptz)
      where replica_id = ($1)::uuid and owner_user_id = ($2)::uuid
        and channel_url = $3 and revoked_at is null`,
    [rid, ownerUserId, channel.url, receipt.grantedAt],
  );
  const rows = await db(
    `with owned as (
       select replica_id from vy_replica
        where replica_id = ($1)::uuid and owner_user_id = ($2)::uuid
          and subject_mode = 'self'
          and lifecycle not in ('revoked','purging')
     )
     insert into vy_channel_attestation
       (attestation_id, replica_id, owner_user_id, channel_url, provider, statement_set,
        policy_version, receipt_hash, attestations, granted_at, expires_at)
     select ($7)::uuid, owned.replica_id, ($2)::uuid, $3, 'youtube', $8,
            $9, $4, ($10)::jsonb, ($5)::timestamptz, ($6)::timestamptz
       from owned
     returning ${ATTESTATION_COLUMNS}`,
    [rid, ownerUserId, channel.url, receipt.hash, receipt.grantedAt, receipt.expiresAt,
      randomUUID(), CHANNEL_ATTESTATION_STATEMENT_SET, REPLICA_POLICY_VERSION,
      JSON.stringify(receipt.payload.attestations)],
  );
  if (!rows.length) fail("replica_not_found", 404);
  return clientAttestation(rows[0]);
}

export async function listChannelAttestations(db, ownerUserId, id) {
  const rows = await db(
    `select ${ATTESTATION_COLUMNS} from vy_channel_attestation
      where replica_id = ($1)::uuid and owner_user_id = ($2)::uuid
      order by granted_at desc limit 50`,
    [replicaId(id), ownerUserId],
  );
  return rows.map(clientAttestation);
}

export async function revokeChannelAttestation(db, ownerUserId, id, attestationId) {
  if (!/^[0-9a-f-]{36}$/i.test(String(attestationId || ""))) fail("attestation_id_invalid", 400);
  const rows = await db(
    `with revoked as (
       update vy_channel_attestation
          set revoked_at = coalesce(revoked_at, now())
        where attestation_id = ($1)::uuid and replica_id = ($2)::uuid and owner_user_id = ($3)::uuid
       returning ${ATTESTATION_COLUMNS}
     ), stopped as (
       -- Revoking the attestation stops the loop in the same statement. The
       -- alternative — a live watch pointing at a dead attestation — would
       -- keep listing the channel and fail every extraction, which is a
       -- teacher who withdrew permission and still sees weekly activity
       -- against their channel.
       update vy_channel_watch
          set status = 'revoked'
        where attestation_id = ($1)::uuid and owner_user_id = ($3)::uuid
          and status <> 'revoked'
          and exists (select 1 from revoked)
       returning watch_id
     )
     select * from revoked`,
    [String(attestationId), replicaId(id), ownerUserId],
  );
  if (!rows.length) fail("attestation_not_found", 404);
  return clientAttestation(rows[0]);
}

/** THE GAP WS-M FOUND, CLOSED — and closed behind the gate.
 *
 *  The insert's rows come from `attested`, so there is no code path, no flag
 *  and no argument by which a watch is created for a channel with no live
 *  attestation. A caller that supplies a channel the teacher never attested
 *  gets zero rows and a 409 that says which condition failed. */
export async function createChannelWatch(db, ownerUserId, id, input) {
  const rid = replicaId(id);
  const channel = channelRef(input?.channel_url);
  const rows = await db(
    `with attested as (
       select a.attestation_id, a.channel_url
         from vy_channel_attestation a
         join vy_replica r
           on r.replica_id = a.replica_id and r.owner_user_id = a.owner_user_id
        where a.replica_id = ($1)::uuid and a.owner_user_id = ($2)::uuid
          and a.channel_url = $3
          and a.revoked_at is null and a.expires_at > now()
          and r.lifecycle not in ('revoked','purging')
        limit 1
     )
     insert into vy_channel_watch
       (watch_id, replica_id, owner_user_id, channel_url, provider, attestation_id, status)
     select ($4)::uuid, ($1)::uuid, ($2)::uuid, attested.channel_url, 'youtube',
            attested.attestation_id, 'active'
       from attested
     on conflict do nothing
     returning ${WATCH_COLUMNS}`,
    [rid, ownerUserId, channel.url, randomUUID()],
  );
  if (rows.length) return clientWatch(rows[0]);
  // Zero rows has exactly two causes and they need different human answers:
  // "you have not attested this channel" is a thing the teacher can fix in
  // the next click, "this clone already watches a channel" is not an error at
  // all. Distinguished by a read, never by an assumption.
  const existing = await db(
    `select ${WATCH_COLUMNS} from vy_channel_watch
      where replica_id = ($1)::uuid and owner_user_id = ($2)::uuid and status = 'active'
      limit 1`,
    [rid, ownerUserId],
  );
  if (existing.length) fail("channel_watch_already_active", 409, { watch_id: existing[0].watch_id });
  return fail("channel_attestation_required", 409);
}

export async function listChannelWatches(db, ownerUserId, id) {
  const rows = await db(
    `select ${WATCH_COLUMNS} from vy_channel_watch
      where replica_id = ($1)::uuid and owner_user_id = ($2)::uuid
      order by created_at desc limit 50`,
    [replicaId(id), ownerUserId],
  );
  return rows.map(clientWatch);
}

export async function setChannelWatchStatus(db, ownerUserId, id, watchId, next) {
  if (!WATCH_STATUSES.includes(String(next || ""))) fail("watch_status_invalid", 400);
  if (!/^[0-9a-f-]{36}$/i.test(String(watchId || ""))) fail("watch_id_invalid", 400);
  const rows = await db(
    `update vy_channel_watch
        set status = $4
      where watch_id = ($1)::uuid and replica_id = ($2)::uuid and owner_user_id = ($3)::uuid
        and status <> 'revoked'
      returning ${WATCH_COLUMNS}`,
    [String(watchId), replicaId(id), ownerUserId, String(next)],
  );
  if (!rows.length) fail("watch_not_found", 404);
  return clientWatch(rows[0]);
}

/** Start or stop the back-catalogue import.
 *
 *  A separate op from `status` because they answer different questions: a
 *  paused WATCH stops everything including new videos, while a stopped
 *  BACKFILL leaves the forward loop running. Collapsing them into one control
 *  would make "stop importing my old lectures" also mean "stop noticing my
 *  new ones", which is not what a teacher who clicks it means.
 *
 *  'done' is not settable. It is a fact the sweep establishes by draining the
 *  catalogue, and a client that could assert it could strand every remaining
 *  video permanently. */
export async function setBackfillState(db, ownerUserId, id, watchId, next) {
  if (!["idle", "running"].includes(String(next || ""))) fail("backfill_state_invalid", 400);
  if (!/^[0-9a-f-]{36}$/i.test(String(watchId || ""))) fail("watch_id_invalid", 400);
  const rows = await db(
    `update vy_channel_watch
        set backfill_state = $4
      where watch_id = ($1)::uuid and replica_id = ($2)::uuid and owner_user_id = ($3)::uuid
        and status = 'active'
        and attestation_id is not null
        and backfill_state <> 'done'
      returning ${WATCH_COLUMNS}`,
    [String(watchId), replicaId(id), ownerUserId, String(next)],
  );
  if (!rows.length) fail("watch_not_found", 404);
  return clientWatch(rows[0]);
}

// ── the extraction predicate ─────────────────────────────────────────────
//
// This is the function the media-extract lane cannot proceed without, and it
// is one statement with no branches. The join is the gate:
//
//   * on `attestation_id`  — a watch whose column is NULL (a row created
//     before migration 057) matches nothing, so old rows FAIL CLOSED rather
//     than being grandfathered;
//   * on `channel_url`     — an attestation for a different channel matches
//     nothing, so a revoked-then-re-granted attestation for another channel
//     cannot authorize this one;
//   * on `owner_user_id`   — one teacher's attestation cannot authorize
//     another teacher's watch;
//   * `revoked_at is null and expires_at > now()` — a lapsed or withdrawn
//     attestation stops extraction with no sweep and no cleanup job.
//
// It returns the ATTESTATION ENVELOPE the service is sent: a receipt hash, a
// channel key and an expiry. Never the owner, never the replica, never the
// receipt payload. The service is told what was permitted, not who permitted
// it — services/voice-evidence's rule, and the reason it can be a service at
// all rather than a privileged part of the app.
export async function attestationForWatch(db, watch) {
  const rows = await db(
    `select a.attestation_id, a.receipt_hash, a.channel_url, a.expires_at, a.granted_at
       from vy_channel_watch w
       join vy_channel_attestation a
         on a.attestation_id = w.attestation_id
        and a.replica_id = w.replica_id
        and a.owner_user_id = w.owner_user_id
        and a.channel_url = w.channel_url
      where w.watch_id = ($1)::uuid
        and w.owner_user_id = ($2)::uuid
        and w.status = 'active'
        and a.revoked_at is null
        and a.expires_at > now()
      limit 1`,
    [watch.watchId, watch.ownerUserId],
  );
  const row = rows[0];
  if (!row) return null;
  return Object.freeze({
    attestationId: String(row.attestation_id),
    receiptHash: String(row.receipt_hash),
    channelUrl: String(row.channel_url),
    expiresAt: new Date(row.expires_at).toISOString(),
    grantedAt: new Date(row.granted_at).toISOString(),
  });
}
