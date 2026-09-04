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
 *  `code_hash` never leaves this function, in either direction. */
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
