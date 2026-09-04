// Creator applications - the public front door of WS-R23 (migration 086).
//
// Applying is public and free: `site/vyakti.html`'s form posts here without
// signing in, because a prospective creator does not have an account yet.
// Rows land in `vy_creator_application`, the PLATFORM's own lane rather than
// a person lane - migration 086's own header explains why in full: no
// auth_user_id, owner_user_id or person_id column exists on this table, so
// it is correctly invisible to api/memory.js's PERSON_TABLES manifest and to
// scripts/relcheck.mjs's person/owner coverage scan, and is deleted only by
// an operator naming a contact (`eraseApplicationsByContact`), never by a
// person's own erasure request.
//
// Every decision lives here, never in api/apply.js, so a fake `db` can reach
// it - api/_checkins.js is this module's own pattern.
import { randomUUID } from "node:crypto";
import { dayKeyOf } from "./_room-surface.js";

export class ApplyError extends Error {
  constructor(code, status = 400, details) {
    super(code);
    this.code = code;
    this.status = status;
    if (details) this.details = details;
  }
}

const MAX = { name: 200, archive_link: 2000, audience: 2000, contact: 320 };

function field(value, max) {
  return String(value ?? "").trim().slice(0, max);
}

/** Lowercased, trimmed contact - the value the daily rate-limit predicate and
 *  the operator's `erase` op both key on. Deliberately a plain function
 *  rather than a SQL expression: migration 086's header explains why an
 *  index built ON that expression is not an option here (timestamptz-to-date
 *  is not IMMUTABLE), and using the same function on both the write and the
 *  read side is what keeps a stored value and a query value from ever
 *  disagreeing about what "the same contact" means. */
export function contactKey(contact) {
  return String(contact ?? "").trim().toLowerCase();
}

const INTENTS = new Set(["creator", "suite"]);

/** WS-R48 (migration 107): "someone who wants to talk first" from the
 *  Suites landing page uses this SAME form, SAME table, SAME daily rate
 *  limit - never a second endpoint. Unknown or absent collapses to the
 *  table's own long-standing default rather than throwing: every caller of
 *  this function before this workstream sent no `intent` at all, and their
 *  behaviour must stay byte-identical. */
function normalizeIntent(value) {
  const v = String(value ?? "").trim().toLowerCase();
  return INTENTS.has(v) ? v : "creator";
}

export async function submitApplication(db, input = {}, { now = Date.now() } = {}) {
  const name = field(input.name, MAX.name);
  const archiveLink = field(input.archive_link, MAX.archive_link);
  const audience = field(input.audience, MAX.audience);
  const contact = field(input.contact, MAX.contact);
  const intent = normalizeIntent(input.intent);
  if (!name) throw new ApplyError("application_name_required", 400);
  if (!archiveLink) throw new ApplyError("application_archive_link_required", 400);
  if (!contact) throw new ApplyError("application_contact_required", 400);
  const key = contactKey(contact);
  const day = dayKeyOf(now);
  // ON CONFLICT DO NOTHING against the real unique index (migration 086's
  // `vy_creator_application_contact_day_ix`) rather than a check-then-insert:
  // the predicate is atomic under a concurrent double-submit, which a
  // separate SELECT before this INSERT would not be.
  const rows = await db(
    `insert into vy_creator_application
       (application_id, name, archive_link, audience, contact, contact_key, applied_on, intent)
     values ($1::uuid, $2::text, $3::text, $4::text, $5::text, $6::text, $7::date, $8::text)
     on conflict (contact_key, applied_on) do nothing
     returning application_id, name, archive_link, audience, contact, status, intent, created_at`,
    [randomUUID(), name, archiveLink, audience, contact, key, day, intent],
  );
  if (!rows[0]) throw new ApplyError("application_already_submitted_today", 429);
  return rows[0];
}

export async function listApplications(db, options = {}) {
  const cap = Math.min(200, Math.max(1, Math.trunc(Number(options.limit)) || 50));
  const status = String(options.status || "").trim();
  const rows = status
    ? await db(
        `select application_id, name, archive_link, audience, contact, status, intent, created_at
           from vy_creator_application
          where status = $1::text
          order by created_at desc
          limit $2::int`,
        [status, cap],
      )
    : await db(
        `select application_id, name, archive_link, audience, contact, status, intent, created_at
           from vy_creator_application
          order by created_at desc
          limit $1::int`,
        [cap],
      );
  return rows;
}

// ─────────────────────────────────────────────────────────────────────────
// WS-R48. The ops board's own line: how many Suite-intent applications
// landed in the rolling window a person could have applied in. A plain
// count over this file's own application table - it names no follower or
// thread table anywhere, so it never joins `evals/room-leak/run.mjs`'s
// scanned set at all (that scanner's own header explains the rule this
// paraphrase exists to stay clear of - see `context/rejected.md#ws-r28-leak-
// battery-scanner-matches-prose-not-only-sql`). Rolling 7 days,
// `api/_ops.js`'s own `roomOverview.joined_7d` precedent, restated here
// rather than a calendar-week boundary this repo has no other convention
// for.
// ─────────────────────────────────────────────────────────────────────────
export async function suiteIntentApplicationsThisWeek(db, now = Date.now()) {
  if (typeof db !== "function") throw new Error("suite_intent_applications_database_required");
  const since = new Date(now - 7 * 24 * 3_600_000).toISOString();
  const [row] = await db(
    `select count(*)::int as n
       from vy_creator_application
      where intent = 'suite' and created_at >= ($1)::timestamptz`,
    [since],
  );
  return Number(row?.n || 0);
}

/** Deletes every application from one contact - "deletable by name from an
 *  operator endpoint" (the workstream brief's own words). There is no
 *  per-application delete: a contact IS the name this table is minimal
 *  enough to be reached by. */
export async function eraseApplicationsByContact(db, contact) {
  const key = contactKey(contact);
  if (!key) throw new ApplyError("application_contact_required", 400);
  const rows = await db(
    `delete from vy_creator_application where contact_key = $1::text
     returning application_id`,
    [key],
  );
  return { deleted: rows.length };
}
