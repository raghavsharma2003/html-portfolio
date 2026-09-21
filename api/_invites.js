// Creator invites - the operator side of WS-R23 (migration 086).
//
// The first Rooms are built one creator at a time, by hand, by invitation. An
// operator (an account listed in `OPS_OWNER_USER_IDS`, a comma-separated env
// var - the same allowlist name WS-R21 uses, coordinated by reading only the
// env var's NAME per this workstream's own brief, never R21's code, since
// that tree is not merged here) issues a code, and the code is shown back to
// them exactly once, in the issue response. It is never stored: only its
// sha256 (`code_hash`) is, so a leaked database dump cannot be redeemed by
// anyone who reads it.
//
// Every decision lives here, never in api/invites.js, so a fake `db` can
// reach it - api/_checkins.js is this module's own pattern for a
// small, self-contained decision file behind a thin HTTP handler.
import { randomUUID, randomBytes, createHash } from "node:crypto";

export class InvitesError extends Error {
  constructor(code, status = 400, details) {
    super(code);
    this.code = code;
    this.status = status;
    if (details) this.details = details;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Excludes 0/O/1/I/L: a code is read aloud or typed by hand as often as it is
// pasted, and this alphabet has no character a person could mistake for
// another one in either direction.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_GROUP_LEN = 4;
const CODE_GROUPS = 3;
const DEFAULT_TTL_DAYS = 14;
const MAX_TTL_DAYS = 60;

/** `OPS_OWNER_USER_IDS`: comma-separated Supabase auth ids, lowercased and
 *  trimmed on read so a trailing space or mixed case in the env var does not
 *  silently exclude someone. */
export function operatorAllowlist(env = process.env) {
  return new Set(
    String(env.OPS_OWNER_USER_IDS || "")
      .split(",")
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean),
  );
}

/** Throws `operator_only` unless `userId` is on the allowlist. Called from the
 *  HTTP layer (api/apply.js, api/invites.js) after `requireUser`, never
 *  trusted from anything in the request body - identity comes only from the
 *  verified bearer token, `_auth.js`'s own law restated here. */
export function requireOperator(userId, env = process.env) {
  const id = String(userId || "").trim().toLowerCase();
  if (!id || !operatorAllowlist(env).has(id)) throw new InvitesError("operator_only", 403);
}

/** The canonical form a code is hashed and compared in: uppercased, every
 *  character that is not A-Z0-9 stripped. So "ab3d-9f2k-qr7t", "AB3D 9F2K
 *  QR7T" and "ab3d9f2kqr7t" all redeem the SAME invite - a person typing a
 *  code back rarely reproduces the punctuation it was shown with. */
export function canonicalizeInviteCode(raw) {
  return String(raw || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** sha256 of the canonical form, hex-encoded. The ONLY form of a code this
 *  system ever persists or compares in SQL - `api/_replica.js`'s create path
 *  imports this so a raw code is hashed before it ever reaches a bound
 *  parameter. */
export function hashInviteCode(raw) {
  return createHash("sha256").update(canonicalizeInviteCode(raw)).digest("hex");
}

function generateCode() {
  const bytes = randomBytes(CODE_GROUP_LEN * CODE_GROUPS);
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
    if ((i + 1) % CODE_GROUP_LEN === 0 && i + 1 < bytes.length) out += "-";
  }
  return out;
}

/** Whitelist by construction, `_replica.js`'s `clientReplica` own pattern:
 *  `code_hash` never leaves this function, in either direction.
 *  `issued_kind` is included whenever the caller's own SELECT/RETURNING
 *  fetched it (`row.issued_kind` is `undefined` on the older operator
 *  queries below that never asked for it, and stays `undefined` here rather
 *  than being defaulted, so this whitelist function never itself asserts a
 *  fact its caller did not actually read). */
function clientInvite(row) {
  if (!row) return null;
  return {
    invite_id: row.invite_id,
    issued_to_contact: row.issued_to_contact,
    issued_by_user_id: row.issued_by_user_id,
    application_id: row.application_id,
    expires_at: row.expires_at,
    redeemed_at: row.redeemed_at,
    redeemed_by_user_id: row.redeemed_by_user_id,
    created_at: row.created_at,
    ...(row.issued_kind !== undefined ? { issued_kind: row.issued_kind } : {}),
  };
}

export async function issueInvite(db, operatorUserId, options = {}) {
  const contact = String(options.contact || "").trim().slice(0, 320);
  const applicationId = options.applicationId ? String(options.applicationId).trim() : null;
  if (applicationId && !UUID.test(applicationId)) throw new InvitesError("invite_application_id_invalid", 400);
  const ttlDays = Math.min(MAX_TTL_DAYS, Math.max(1, Math.trunc(Number(options.ttlDays)) || DEFAULT_TTL_DAYS));
  const code = generateCode();
  const codeHash = hashInviteCode(code);
  const inviteId = randomUUID();
  const expiresAt = new Date(Date.now() + ttlDays * 86_400_000).toISOString();
  const rows = await db(
    `insert into vy_creator_invite
       (invite_id, code_hash, issued_to_contact, issued_by_user_id, application_id, expires_at)
     values ($1::uuid, $2::text, $3::text, $4::uuid, $5::uuid, $6::timestamptz)
     returning invite_id, issued_to_contact, issued_by_user_id, application_id,
       expires_at, redeemed_at, redeemed_by_user_id, created_at`,
    [inviteId, codeHash, contact, operatorUserId, applicationId, expiresAt],
  );
  // The one moment this code exists outside whatever the operator pastes it
  // into next. Nothing about this response is ever reconstructable later -
  // there is no "resend the code" op, by construction, because there is
  // nothing left to resend.
  return { invite: clientInvite(rows[0]), code };
}

export async function listInvites(db, options = {}) {
  const cap = Math.min(200, Math.max(1, Math.trunc(Number(options.limit)) || 50));
  const status = String(options.status || "").trim();
  const clause =
    status === "redeemed" ? "redeemed_at is not null" :
    status === "pending" ? "redeemed_at is null and expires_at > now()" :
    status === "expired" ? "redeemed_at is null and expires_at <= now()" :
    "true";
  const rows = await db(
    `select invite_id, issued_to_contact, issued_by_user_id, application_id,
       expires_at, redeemed_at, redeemed_by_user_id, created_at
       from vy_creator_invite
      where ${clause}
      order by created_at desc
      limit $1::int`,
    [cap],
  );
  return rows.map(clientInvite);
}

/** Disables an unredeemed invite by setting `expires_at` to now (or leaving
 *  it earlier if it already was) rather than deleting the row - an operator
 *  revoking a code they handed out still wants the audit trail of having
 *  issued it. Refuses a redeemed invite by name: it already did its one job,
 *  and "revoke" reads as undoing a replica that already exists, which this
 *  op does not touch. */
export async function revokeInvite(db, inviteId) {
  const id = String(inviteId || "").trim();
  if (!UUID.test(id)) throw new InvitesError("invite_id_invalid", 400);
  const rows = await db(
    `update vy_creator_invite
        set expires_at = least(expires_at, now())
      where invite_id = $1::uuid
        and redeemed_at is null
      returning invite_id, issued_to_contact, issued_by_user_id, application_id,
        expires_at, redeemed_at, redeemed_by_user_id, created_at`,
    [id],
  );
  if (!rows[0]) throw new InvitesError("invite_not_found_or_redeemed", 404);
  return clientInvite(rows[0]);
}

/** Deletes an UNREDEEMED invite outright, by id. A redeemed invite is
 *  deliberately refused here (`invite_redeemed_erase_via_owner`): once a code
 *  names a real owner_user_id in `redeemed_by_user_id`, that row is on the
 *  OWNER lane (086's own migration header) and has exactly one deletion path
 *  - the owner's full erasure job (api/_replica-full-erasure.js) - so this
 *  operator op and that job can never race to delete, or disagree about
 *  having deleted, the same row. */
export async function eraseInvite(db, inviteId) {
  const id = String(inviteId || "").trim();
  if (!UUID.test(id)) throw new InvitesError("invite_id_invalid", 400);
  const rows = await db(
    `delete from vy_creator_invite
      where invite_id = $1::uuid
        and redeemed_at is null
      returning invite_id`,
    [id],
  );
  if (!rows[0]) {
    const stillThere = await db(
      `select 1 from vy_creator_invite where invite_id = $1::uuid and redeemed_at is not null limit 1`,
      [id],
    );
    if (stillThere.length) throw new InvitesError("invite_redeemed_erase_via_owner", 409);
    throw new InvitesError("invite_not_found", 404);
  }
  return { deleted: true };
}

// ── WS-R47: creators invite creators (migration 106) ───────────────────────
//
// Everything below is the CREATOR's own front door, never an operator's. An
// operator issues on behalf of the platform, from an allowlist, with no cap;
// a creator issues on behalf of themselves, capped, and only once they have
// something real to show for it - a published Room. `requireOperator` is
// never called on this path: the caller's OWN bearer id is both who is
// asking and who the quota is checked against, so a body-supplied id can
// never substitute for it (api/invites.js's own two new ops pass
// `user.id`, never `body.issued_by_user_id`, into both functions below).

/** Three, named, with the reason: a peer invite is a warm arrival, not a
 *  growth channel to farm, and three is enough for a creator to reach the
 *  two or three peers they actually know without this becoming a second
 *  operator queue. Exported so the quota INSERT below, `myInvites`'s own
 *  remaining-count arithmetic, and the studio card's copy read the SAME
 *  number rather than three that could drift.
 *  REVERSAL CONDITION: if a published creator's real peer network in Phase 0
 *  turns out to routinely exceed three names, raise this constant (and the
 *  studio copy that states it) rather than adding a second, larger cap
 *  next to it - one number, one place, unchanged from 086's own reasoning
 *  for `code_hash` being the only stored form of a code. */
export const CREATOR_INVITE_QUOTA = 3;

/**
 * The quota INSERT. Both the count and the standing check live in the SAME
 * statement's own WHERE (`quota_ok`, a CTE with nothing but a filtered
 * `select 1`), gating the INSERT's own row source - the identical shape
 * `api/_replica.js`'s `invite_redeem`/`gate` CTEs and `api/_funnel.js`'s
 * `markStep` already use for "refused before any write, never after one".
 * A fourth code, or a code from an account with no published Room, is
 * therefore zero rows returned from a single round trip - never a prior
 * `select count(*)` read followed by a JS `if`, which is exactly the shape
 * two concurrent issues could race through to produce a fourth row.
 *
 * `application_id` is always null here: a creator-issued code has no
 * operator application behind it by construction, so this path never takes
 * the parameter 086's operator `issueInvite` does for one.
 */
export async function issueCreatorInvite(db, ownerUserId, options = {}) {
  const contact = String(options.contact || "").trim().slice(0, 320);
  const ttlDays = Math.min(MAX_TTL_DAYS, Math.max(1, Math.trunc(Number(options.ttlDays)) || DEFAULT_TTL_DAYS));
  const code = generateCode();
  const codeHash = hashInviteCode(code);
  const inviteId = randomUUID();
  const expiresAt = new Date(Date.now() + ttlDays * 86_400_000).toISOString();
  const rows = await db(
    `with quota_ok as (
       select 1
        where (
          select count(*)::int from vy_creator_invite
           where issued_by_user_id = $1::uuid and issued_kind = 'creator'
        ) < $6::int
          and exists (
            select 1 from vy_room where owner_user_id = $1::uuid and published_at is not null
          )
     )
     insert into vy_creator_invite
       (invite_id, code_hash, issued_to_contact, issued_by_user_id, application_id, expires_at, issued_kind)
     select $2::uuid, $3::text, $4::text, $1::uuid, null::uuid, $5::timestamptz, 'creator'::text
       from quota_ok
     returning invite_id, issued_to_contact, issued_by_user_id, application_id,
       expires_at, redeemed_at, redeemed_by_user_id, created_at, issued_kind`,
    [ownerUserId, inviteId, codeHash, contact, expiresAt, CREATOR_INVITE_QUOTA],
  );
  if (!rows[0]) {
    // The SQL above does not, and by design cannot, say WHICH of the two
    // predicates refused - `invite_invalid`'s own precedent (api/_replica.js)
    // for not disclosing more than a front door should. Both reasons resolve
    // to the same fix from the creator's own side: publish a Room, or wait
    // for a redemption to free a slot back up (it does not - the quota counts
    // every code ever issued, not just live ones, so the honest fix is
    // "you have used your three").
    throw new InvitesError("creator_invite_unavailable", 403);
  }
  return { invite: clientInvite(rows[0]), code };
}

/** unused | redeemed | expired - the brief's own three states, and the ONLY
 *  three a card may show (never "pending", operator `listInvites`'s word for
 *  the same condition - a creator reads their own three states in their own
 *  vocabulary, not the operator console's). */
export const CREATOR_INVITE_STATES = Object.freeze(["unused", "redeemed", "expired"]);

function creatorInviteState(row, now) {
  if (row.redeemed_at) return "redeemed";
  if (new Date(row.expires_at).getTime() <= now) return "expired";
  return "unused";
}

/**
 * Owner-scoped list: every code THIS creator has issued, by state, with no
 * code text - the SELECT below never names `code_hash` at all, so there is
 * no column to accidentally whitelist back out (086's own "shown once"
 * law, one query over). `used`/`remaining` are read off the SAME rows this
 * call already fetched (a code once issued always counts toward the quota,
 * per `issueCreatorInvite`'s own WHERE clause, whatever state it is in now),
 * never a second query, so the two numbers can never disagree with each
 * other inside one response.
 */
export async function myInvites(db, ownerUserId, { now = Date.now() } = {}) {
  const rows = await db(
    `select invite_id, issued_to_contact, expires_at, redeemed_at, created_at
       from vy_creator_invite
      where issued_by_user_id = $1::uuid and issued_kind = 'creator'
      order by created_at desc
      limit 50`,
    [ownerUserId],
  );
  const invites = rows.map((row) => ({
    invite_id: row.invite_id,
    issued_to_contact: row.issued_to_contact,
    state: creatorInviteState(row, now),
    expires_at: row.expires_at,
    redeemed_at: row.redeemed_at,
    created_at: row.created_at,
  }));
  const used = invites.length;
  return {
    invites,
    quota: {
      max: CREATOR_INVITE_QUOTA,
      used,
      remaining: Math.max(0, CREATOR_INVITE_QUOTA - used),
    },
  };
}
