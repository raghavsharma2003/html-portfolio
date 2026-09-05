// The Room — the creator's side (WS-R7).
//
// WS-R1 built /r/<slug> and the three tables it reads (`vy_room`,
// `vy_room_follower`, `vy_room_thread`, migration 071) but nothing anywhere
// INSERTS a `vy_room` row. Until this file existed, no Room could ever be
// opened by anyone — `dead-writers`, in its purest form: a fully wired reader
// with no writer is a fully wired reader of nothing.
//
// Every decision lives here rather than in `api/room-publish.js`, so a fake
// `db` can reach it — `api/_clonechannel.js` is the shape this copies, and it
// is copied deliberately rather than merged with it: a channel is an address
// on someone ELSE's platform (Telegram, WhatsApp) that this product connects
// TO, and a Room is an address ON this platform that this product PUBLISHES.
// The two share a gate (the readiness lock) and nothing else about their
// shape, so a shared file would be two products' worth of branching wearing
// one name.
//
// ── THE PUBLISH LOCK IS A WRITE PREDICATE, NEVER A BRANCH ABOVE IT ─────────
//
// `published_at` is set ONLY inside the UPDATE's own CASE, exactly the way
// `api/_clonechannel.js`'s `status` column is — 051's argument, restated
// there and binding here for the identical reason: "a sentence in a brief is
// a preference; a predicate on the write is a guarantee." A JS `if` above the
// statement is the third place a status would be decided, and the two
// existing ones (the CHECK constraint, the WHERE clause a reader trusts)
// would then disagree with it the day someone edits the branch and forgets
// the query, or the query and forgets the branch.
//
// Three conditions, all three evaluated by Postgres, none of them by this
// file:
//
//   1. an ACTIVE runtime capability exists for this replica (the same state
//      `api/_replica-runtime.js`'s `runtimeBlockers` reads as `cap.state`);
//   2. the READINESS LOCK — `overallFloor`/`partFloor`, nothing unmeasured, on
//      the LATEST snapshot — imported verbatim from `api/_clonechannel.js`'s
//      `readinessPasses`, so "same three conditions" is true by construction;
//   3. an APPROVED DISCLOSURE — the agent's `vy_teacher_sheet` is
//      `status = 'published'` with a `consent_artifact_id`, api/_teachersheet.js's
//      own gate, which `resolveRoom` already requires before any follower can
//      reach a word of this AI. Room publish would be a green switch over a
//      dark room without this: `published_at` would say "open" while
//      `resolveRoom` answered `room_unavailable` to every single visitor.
//
// ── FAIL CLOSED ──────────────────────────────────────────────────────────
//
// `publishRoom` never throws on a locked gate. It writes the fail-closed
// value (the row's existing `published_at`, which is `null` on a first
// attempt), reads back which of the three conditions is still open, and
// returns a named, CLASSED reason — never a bare 409. `plausible-return-hides-a-dead-pipeline`
// and `a-step-is-never-silently-blocked` (context/rejected.md) both point the
// same way: a publish button that goes gray with no reason attached is a dead
// end that reads as a bug, and the owner's only recovery is to guess.
import { randomUUID } from "node:crypto";
import { readinessPasses } from "./_clonechannel.js";
import { READINESS_OVERALL_FLOOR, READINESS_PART_FLOOR } from "./_readiness.js";
import { ownedRuntimeStatus } from "./_replica-runtime.js";
import { monthKeyOf } from "./_room-surface.js";
// WS-R86 (migration 123). `ownerRoomStats` below is the one caller — the
// Room Studio's own "Friends brought this week" card, `api/_funnel.js`'s
// own per-room aggregate read, imported rather than re-derived.
import { friendsBroughtThisWeek } from "./_funnel.js";
// WS-R45. `setRoomBio` reuses the REAL copy gate rather than a second,
// hand-rolled regex that could drift from it — the identical reason
// `readinessPasses` above is imported rather than restated. See
// `assertBioClean` below for why a plain string is wrapped as a JS literal
// before it is handed to `scanSource`.
import { scanSource } from "../scripts/check-copy.mjs";
// WS-R85, migration 122. `buildShareKit`/`ShareKitError` — a pure builder,
// this file's own `ownerRoomShareKit` below is the one caller that hands it
// a real owned Room row.
import { buildShareKit, ShareKitError } from "./_share-kit.js";
// WS-R126 (join from WhatsApp, migration 131). `whatsappJoinLink` is the ONE
// place that reads an env var for this feature (`_share-kit.js` stays pure,
// per this file's own header on why) — a NEW import edge between two `api/`
// files, run against the full `node evals/run.mjs` registry per this
// workstream's own brief before it shipped (no cycle: `_room-whatsapp-chat.js`
// and everything it imports were grepped for a back-reference to this file
// and none exists).
import { whatsappJoinLink } from "./_room-whatsapp-chat.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The free-cap bound. Mirrors migration 071's own CHECK
 *  (`free_monthly_messages >= 0 and <= 100000`) — validated here too so a bad
 *  value returns a NAMED reason rather than a raw constraint-violation 500,
 *  the same courtesy `api/_clonechannel.js`'s two-layer gate gives a bad
 *  channel kind. */
export const ROOM_FREE_CAP_MIN = 0;
export const ROOM_FREE_CAP_MAX = 100_000;

/** The paid tier's editable bounds (WS-R19), mirroring migration 081's own
 *  CHECKs (`paid_monthly_messages` 100-2000, `paid_monthly_voice_seconds`
 *  0-3600) for the identical reason the free bound above is mirrored here:
 *  a bad value returns a NAMED reason rather than a raw constraint-violation
 *  500. */
export const ROOM_PAID_MESSAGES_MIN = 100;
export const ROOM_PAID_MESSAGES_MAX = 2000;
export const ROOM_PAID_VOICE_SECONDS_MIN = 0;
export const ROOM_PAID_VOICE_SECONDS_MAX = 3600;

/** The directory bio's bound (WS-R45), mirroring migration 105's own CHECK
 *  (`vy_room_one_line_bio_len`) for the same reason every other bound in this
 *  file is mirrored: a bad value returns a NAMED reason, not a raw 500. */
export const ROOM_BIO_MAX = 140;

/** The dormancy floor (WS-R75), mirroring migration 119's own CHECK
 *  (`vy_room_dormancy_days_floor`) for the same reason every other bound in
 *  this file is mirrored: a bad value returns a NAMED reason, not a raw 500.
 *  `null` (off) is always valid regardless of this floor - it is the ON
 *  value's own lower bound, never a requirement to be on at all. */
export const ROOM_DORMANCY_DAYS_MIN = 180;

export class RoomPublishError extends Error {
  constructor(code, status = 400, details) {
    super(code);
    this.code = code;
    this.status = status;
    if (details) this.details = details;
  }
}

/** Runtime blocker codes `api/_replica-runtime.js`'s own `BLOCKER_META`
 *  (`src/studio/wizardModel.ts`) classes as the PLATFORM's — running the
 *  automated suite, waiting on the voice provider to stop being a test
 *  fixture. Duplicated here as a short, closed list rather than imported,
 *  because the canonical table lives in a `.ts` file under `src/studio/` that
 *  is bundled for the browser and is not something a Vercel serverless
 *  function can import at runtime. Kept in sync BY HAND on purpose, and kept
 *  SHORT on purpose: a list that enumerated every code would be the
 *  `coverage-lists-that-enumerate-a-subset` defect one axis over. If this
 *  list and `wizardModel.ts`'s `BLOCKER_META` ever disagree, that file wins —
 *  it is the one a person actually reads.
 */
const RUNTIME_BLOCKER_OWNED_BY_PLATFORM = new Set([
  "voice_not_ready",
  "production_voice_required",
  "qualification_incomplete",
  "replica_not_ready",
]);

function assertOwnerScope(ownerUserId, replicaId) {
  if (!UUID.test(String(ownerUserId || "")) || !UUID.test(String(replicaId || ""))) {
    throw new RoomPublishError("room_publish_identity_invalid", 400);
  }
}

/** The owner-scoped replica handle. `api/_clonechannel.js`'s `ownedReplica`
 *  one table over: a replica with no agent has nothing for a Room to name. */
async function ownedReplica(db, ownerUserId, replicaId) {
  const rows = await db(
    `select r.replica_id, r.agent_id, r.owner_user_id, r.display_name
       from vy_replica r
      where r.replica_id = ($1)::uuid and r.owner_user_id = ($2)::uuid
      limit 1`,
    [String(replicaId).toLowerCase(), String(ownerUserId).toLowerCase()],
  );
  return rows[0] || null;
}

/** The owner's own Room row for one replica, or null. Scoped by
 *  `owner_user_id` INSIDE the predicate — `api/_clonechannel.js`'s rule for
 *  the identical reason: "not yours" and "does not exist" must be the same
 *  answer, or a 403 on someone else's uuid becomes an existence oracle. */
async function ownedRoomRow(db, ownerUserId, replicaId) {
  const rows = await db(
    `select room_id, slug, replica_id, agent_id, owner_user_id, display_name,
            free_monthly_messages, paid_monthly_messages, paid_monthly_voice_seconds, default_locale,
                dormancy_days,
                listed_at, one_line_bio, taste_enabled,
                published_at, paused_at, created_at, updated_at
       from vy_room
      where owner_user_id = ($1)::uuid and replica_id = ($2)::uuid
      limit 1`,
    [String(ownerUserId).toLowerCase(), String(replicaId).toLowerCase()],
  );
  return rows[0] || null;
}

// ─────────────────────────────────────────────────────────────────────────
// THE PROPOSED SLUG
// ─────────────────────────────────────────────────────────────────────────

/** Lowercase, dashes, 3 to 40 characters. The same shape `vy_room_slug_ix`
 *  enforces (`lower(slug)`), applied before the row is ever attempted so a
 *  malformed slug returns a named reason instead of a constraint 500. */
export function normalizeSlug(value) {
  const dashed = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return dashed;
}

/** Propose a slug from a display name. Short names are padded with a fixed
 *  suffix rather than left under the 3-character floor, and every proposal
 *  is clamped to 40 — the two edges `vy_room.slug`'s own consumer
 *  (`api/_room-surface.js`'s `slugOf`, `^[a-z0-9][a-z0-9-]{0,62}$`) already
 *  allows, kept tighter here because a public address a creator prints on a
 *  card should read as a name, not fill the whole limit. */
export function proposeSlug(displayName) {
  const base = normalizeSlug(displayName);
  const padded = base.length >= 3 ? base : (base ? `${base}-ai` : "your-ai");
  return padded.slice(0, 40);
}

/** `normalizeSlug` already collapses every run of non `[a-z0-9]` bytes to one
 *  dash and trims a leading or trailing one, so what is left to check is only
 *  the length `vy_room.slug`'s product contract promises: 3 to 40. */
function assertSlugShape(slug) {
  const s = normalizeSlug(slug);
  if (s.length < 3 || s.length > 40) {
    throw new RoomPublishError("room_slug_invalid", 400, { slug: s, min: 3, max: 40 });
  }
  return s;
}

/** Postgres's own name for "this unique index refused the row" — 23505,
 *  `api/_clonechannel.js`'s `gate()` reads the same code for the identical
 *  reason: a fake `db` in an offline eval can throw exactly this shape, so
 *  the branch below is real code, not aspirational error handling. */
function isUniqueViolation(error, indexName) {
  return error && error.code === "23505" && (!indexName || String(error.message || "").includes(indexName));
}

// ─────────────────────────────────────────────────────────────────────────
// THE TELEGRAM DEEP LINK (WS-R18) — honest "not connected" over a guess
// ─────────────────────────────────────────────────────────────────────────
//
// ONE bot serves every creator's Room (`ROOM_TELEGRAM_BOT_USERNAME`, not a
// per-creator credential — see `api/_room-telegram.js`'s own header on why),
// so the link a creator's card shows is the SAME bot for everyone, addressed
// by THIS room's own slug (`t.me/<bot>?start=<slug>`, `api/tg.js`'s
// `startLink` shape one surface over). `null` when the env var is unset — the
// server telling the client honestly rather than the client guessing a URL
// that would 404 — `context/rejected.md`'s no-fake-numbers law applied to a
// link instead of a metric.
export function telegramDeepLink(slug, env = process.env) {
  const bot = String(env.ROOM_TELEGRAM_BOT_USERNAME || "").trim();
  if (!bot || !slug) return null;
  return `https://t.me/${bot}?start=${slug}`;
}

// ─────────────────────────────────────────────────────────────────────────
// THE CLIENT SHAPE
// ─────────────────────────────────────────────────────────────────────────

export function clientRoom(row, { now = Date.now(), env = process.env } = {}) {
  if (!row) return null;
  return {
    room_id: row.room_id,
    slug: row.slug,
    display_name: row.display_name || "",
    free_monthly_messages: Number(row.free_monthly_messages ?? 20),
    paid_monthly_messages: Number(row.paid_monthly_messages ?? 500),
    paid_monthly_voice_seconds: Number(row.paid_monthly_voice_seconds ?? 1800),
    // WS-R24: the creator's own fallback for a follower whose browser
    // reports no usable language and who has no row of their own yet -
    // `api/_room-surface.js`'s `openRoom` fallback chain, migration 087.
    default_locale: row.default_locale === "hi" ? "hi" : "en",
    // WS-R45. The directory's own third field, alongside the name and the
    // language above - never rendered on this card as anything but plain
    // text the creator wrote about themselves.
    one_line_bio: row.one_line_bio || "",
    // WS-R53. Defaults true when the column is absent from a narrower
    // RETURNING list (never false-by-omission) - `_room-taste.js`'s own
    // read of this column is the enforcement; this is only the studio's
    // display of the same switch.
    taste_enabled: row.taste_enabled !== false,
    // WS-R75 (migration 119). `null` means off - the default, and the same
    // meaning the database column itself carries, never coerced to a number
    // here (a coerced 0 would read as "forget everyone instantly").
    dormancy_days: row.dormancy_days != null ? Number(row.dormancy_days) : null,
    listed: row.listed_at != null,
    listed_at: row.listed_at ?? null,
    published: row.published_at != null,
    paused: row.paused_at != null,
    published_at: row.published_at ?? null,
    paused_at: row.paused_at ?? null,
    created_at: row.created_at ?? null,
    updated_at: row.updated_at ?? null,
    // null means "not connected" — the studio renders that honestly rather
    // than printing a link nobody registered a bot to answer.
    telegram_deep_link: telegramDeepLink(row.slug, env),
    _now: now,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// THE PUBLIC READ — a stranger's own view, no owner scope (WS-R40)
// ─────────────────────────────────────────────────────────────────────────

/**
 * slug -> the Room's PUBLIC fields, or null for anything not currently
 * reachable — unpublished, paused, or unknown. `api/_room-page.js`'s crawler
 * unfurl is the one caller.
 *
 * Same predicate `api/_room-surface.js`'s `roomBySlug` already enforces
 * (`published_at is not null and paused_at is null`), restated here rather
 * than imported — `api/_disclosure.js`'s own standing rule, both gate
 * clauses IN the WHERE, never applied after a row is already in hand.
 * Deliberately WITHOUT `api/_creators.js`'s `listed_at` condition: the
 * directory is an opt-in feed a creator chooses to appear on, but a
 * follower can share a Room's own link — and that link should unfurl —
 * whether or not its creator ever opted into being listed.
 *
 * Deliberately NOT `resolveRoom`: that function also loads the agent's
 * published sheet (`loadTeacherAgent`), a read this endpoint's own cost
 * budget does not need — a crawler wants a name and a sentence, nothing an
 * agent module knows that the Room row does not already carry. Returns only
 * the four columns a card can be built from, never anything from the sheet,
 * a follower table, or a count.
 */
export async function publicRoomBySlug(db, slug) {
  if (typeof db !== "function") throw new RoomPublishError("room_publish_db_required", 500);
  const s = String(slug || "").trim().toLowerCase();
  if (!s) return null;
  const rows = await db(
    `select slug, display_name, one_line_bio, default_locale
       from vy_room
      where lower(slug) = $1
        and published_at is not null
        and paused_at is null
      limit 1`,
    [s],
  );
  return rows[0] || null;
}

// ─────────────────────────────────────────────────────────────────────────
// OP: get
// ─────────────────────────────────────────────────────────────────────────

/**
 * The owner's Room for one replica, or a named "not yet" — never a 500 and
 * never a silent null a caller has to guess the reason for.
 *
 * Always carries `can_publish` and the classed blocker list, computed the
 * SAME way `publish` computes it on a refusal, so the button can name its
 * reason on the FIRST render rather than only after a failed click —
 * `context/rejected.md#a-step-is-never-silently-blocked`.
 */
export async function getOwnedRoom(db, ownerUserId, replicaId) {
  assertOwnerScope(ownerUserId, replicaId);
  const replica = await ownedReplica(db, ownerUserId, replicaId);
  if (!replica) return null;
  const room = await ownedRoomRow(db, ownerUserId, replicaId);
  if (!room) return { room: null, reason: "not_created" };
  const [blockers, showcase] = await Promise.all([
    publishBlockers(db, ownerUserId, replicaId, room.agent_id),
    // WS-R66. Fed alongside the room on the SAME read the Share tab already
    // makes for `blockers` — no second round trip the studio has to remember
    // to fire, `onRoomState`'s existing "fed up, never fetched twice" law one
    // field over.
    readRoomShowcase(db, room.room_id),
  ]);
  return {
    room: clientRoom(room),
    reason: null,
    can_publish: blockers.waiting_on_you.length === 0 && blockers.waiting_on_us.length === 0,
    blockers,
    showcase,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// OP: create
// ─────────────────────────────────────────────────────────────────────────

/**
 * Create the owner's Room, or hand back the one that already exists.
 *
 * IDEMPOTENT on the replica side by construction: a second `create` for a
 * replica that already has one is not an error, it is the same answer `get`
 * would give, because a client racing its own "set up my Room" button must
 * not 500 on the second tap.
 *
 * A TAKEN SLUG IS A NAMED REFUSAL. `vy_room_slug_ix` is the enforcement;
 * this catches its violation and reports `room_slug_taken` rather than
 * letting the constraint's own error text — which names neither the address
 * nor the fact that it is fixable — reach a browser as a raw 500.
 */
export async function createRoom(db, ownerUserId, replicaId, { slug } = {}) {
  assertOwnerScope(ownerUserId, replicaId);
  const replica = await ownedReplica(db, ownerUserId, replicaId);
  if (!replica) return null;
  if (!replica.agent_id) throw new RoomPublishError("room_replica_has_no_agent", 409);

  const existing = await ownedRoomRow(db, ownerUserId, replicaId);
  if (existing) return clientRoom(existing);

  const proposed = assertSlugShape(slug || proposeSlug(replica.display_name));
  try {
    const rows = await db(
      `insert into vy_room
         (room_id, slug, replica_id, agent_id, owner_user_id, display_name)
       values (($1)::uuid, $2, ($3)::uuid, ($4)::uuid, ($5)::uuid, $6)
       returning room_id, slug, replica_id, agent_id, owner_user_id, display_name,
                 free_monthly_messages, paid_monthly_messages, paid_monthly_voice_seconds, default_locale,
                dormancy_days,
                listed_at, one_line_bio, taste_enabled,
                published_at, paused_at, created_at, updated_at`,
      [
        randomUUID(),
        proposed,
        String(replicaId).toLowerCase(),
        String(replica.agent_id).toLowerCase(),
        String(ownerUserId).toLowerCase(),
        String(replica.display_name || "").slice(0, 200),
      ],
    );
    if (!rows[0]) throw new RoomPublishError("room_create_failed", 503);
    return clientRoom(rows[0]);
  } catch (error) {
    if (isUniqueViolation(error, "vy_room_slug_ix")) {
      throw new RoomPublishError("room_slug_taken", 409, { slug: proposed });
    }
    if (isUniqueViolation(error, "vy_room_replica_ix")) {
      // Two requests raced the idempotent check above. The second loses the
      // insert and wins by reading what the first just wrote — the correct
      // outcome is still "here is your Room", never an error.
      const raced = await ownedRoomRow(db, ownerUserId, replicaId);
      if (raced) return clientRoom(raced);
    }
    throw error;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// OP: rename
// ─────────────────────────────────────────────────────────────────────────

export async function renameRoom(db, ownerUserId, replicaId, slug) {
  assertOwnerScope(ownerUserId, replicaId);
  const normalized = assertSlugShape(slug);
  try {
    const rows = await db(
      `update vy_room
          set slug = $3, updated_at = now()
        where owner_user_id = ($1)::uuid and replica_id = ($2)::uuid
        returning room_id, slug, replica_id, agent_id, owner_user_id, display_name,
                  free_monthly_messages, paid_monthly_messages, paid_monthly_voice_seconds, default_locale,
                dormancy_days,
                listed_at, one_line_bio, taste_enabled,
                published_at, paused_at, created_at, updated_at`,
      [String(ownerUserId).toLowerCase(), String(replicaId).toLowerCase(), normalized],
    );
    if (!rows[0]) return null;
    return clientRoom(rows[0]);
  } catch (error) {
    if (isUniqueViolation(error, "vy_room_slug_ix")) {
      throw new RoomPublishError("room_slug_taken", 409, { slug: normalized });
    }
    throw error;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// THE PUBLISH LOCK'S THREE FRAGMENTS
// ─────────────────────────────────────────────────────────────────────────

/** An ACTIVE runtime capability — `cap.state='active'` in
 *  `api/_replica-runtime.js`'s own `RUNTIME_STATUS_SQL`, read directly here
 *  rather than through that module's twenty-CTE status query, because this
 *  write only needs the one boolean the CASE below tests. */
const runtimeActive = (owner, replica) => `exists (
      select 1 from vy_replica_runtime_capability c
       where c.replica_id = (${replica})::uuid
         and c.owner_user_id = (${owner})::uuid
         and c.state = 'active'
    )`;

/** An APPROVED DISCLOSURE — `api/_teachersheet.js`'s own publish gate,
 *  restated as a predicate: `status='published'` AND a consent artifact on
 *  file. This is not a second opinion about whether the AI may speak;
 *  `resolveRoom` already refuses everyone if this is false. It exists here
 *  so `published_at` cannot say "open" while every visitor is refused. */
const disclosureApproved = (agent) => `exists (
      select 1 from vy_teacher_sheet s
       where s.agent_id = (${agent})::uuid
         and s.status = 'published'
         and s.consent_artifact_id is not null
    )`;

// ─────────────────────────────────────────────────────────────────────────
// OP: publish
// ─────────────────────────────────────────────────────────────────────────

/**
 * Set `published_at`, or don't, entirely inside the write.
 *
 * `coalesce(r.published_at, now())` rather than `now()` unconditionally: a
 * republish (the owner fixed the thing that had regressed and is trying
 * again) must not move the room's original publish date forward, since
 * "published since" is a fact a follower may reasonably read as a claim
 * about how long this AI has existed.
 */
export async function publishRoom(db, ownerUserId, replicaId) {
  assertOwnerScope(ownerUserId, replicaId);
  const room = await ownedRoomRow(db, ownerUserId, replicaId);
  if (!room) return null;

  const rows = await db(
    `update vy_room r
        set published_at = case
              when ${runtimeActive("r.owner_user_id", "r.replica_id")}
               and ${readinessPasses("r.owner_user_id", "r.replica_id", "$3", "$4")}
               and ${disclosureApproved("r.agent_id")}
              then coalesce(r.published_at, now())
              else r.published_at
            end,
            updated_at = now()
      where r.owner_user_id = ($1)::uuid and r.replica_id = ($2)::uuid
      returning r.room_id, r.slug, r.replica_id, r.agent_id, r.owner_user_id, r.display_name,
                r.free_monthly_messages, r.paid_monthly_messages, r.paid_monthly_voice_seconds, r.default_locale,
                r.dormancy_days,
                r.listed_at, r.one_line_bio, r.taste_enabled,
                r.published_at, r.paused_at, r.created_at, r.updated_at`,
    [String(ownerUserId).toLowerCase(), String(replicaId).toLowerCase(), READINESS_OVERALL_FLOOR, READINESS_PART_FLOOR],
  );
  const next = rows[0];
  if (!next) return null;

  if (!next.published_at) {
    const blockers = await publishBlockers(db, ownerUserId, replicaId, room.agent_id);
    throw new RoomPublishError("room_publish_locked", 409, blockers);
  }
  return clientRoom(next);
}

/**
 * The courtesy layer: WHY is the write refusing. Never the enforcement —
 * the CASE above is that — so this can be wrong in only one direction, the
 * safe one: worst case it over- or under-explains a lock the write already
 * held regardless.
 *
 * Runs all three checks even after the first one fails, on purpose: an
 * owner fixing one thing at a time deserves the WHOLE list on one screen,
 * not a wizard that reveals its next demand only after the last one clears.
 */
async function publishBlockers(db, ownerUserId, replicaId, agentId) {
  const owner = String(ownerUserId).toLowerCase();
  const replica = String(replicaId).toLowerCase();
  const agent = String(agentId || "").toLowerCase();

  const [runtimeRow, readinessRow, disclosureRow] = await Promise.all([
    db(`select ${runtimeActive("$1", "$2")} as ok`, [owner, replica]),
    db(`select ${readinessPasses("$1", "$2", "$3", "$4")} as ok`, [owner, replica, READINESS_OVERALL_FLOOR, READINESS_PART_FLOOR]),
    db(`select ${disclosureApproved("$1")} as ok`, [agent]),
  ]);
  const truthy = (rows) => rows?.[0]?.ok === true || rows?.[0]?.ok === "t" || rows?.[0]?.ok === "true";

  const waiting_on_you = [];
  const waiting_on_us = [];

  if (!truthy(runtimeRow)) {
    // The DEEP reason. `ownedRuntimeStatus` is the same status the Deploy
    // step's own "RuntimeGate" already renders, so this is a second READ of
    // an existing truth, never a second DEFINITION of it. Its blockers are
    // classed against `RUNTIME_BLOCKER_OWNED_BY_PLATFORM` above — the
    // header explains why that list is short and hand-kept rather than
    // imported.
    const status = await ownedRuntimeStatus(db, ownerUserId, replicaId);
    const runtimeBlockers = status?.blockers ?? [];
    const heldByPlatform = runtimeBlockers.length > 0
      && runtimeBlockers.every((code) => RUNTIME_BLOCKER_OWNED_BY_PLATFORM.has(code));
    if (heldByPlatform) {
      waiting_on_us.push({
        code: "room_runtime_not_active",
        headline: "We are still finishing your clone's own checks above.",
        next: "Nothing to do here until they clear on their own.",
        anchor: "#runtime-gate",
      });
    } else {
      waiting_on_you.push({
        code: "room_runtime_not_active",
        headline: "Your runtime is not active yet.",
        next: "Activate it under \"The gates, then the switch\" above, then come back and publish.",
        anchor: "#runtime-gate",
      });
    }
  }

  if (!truthy(readinessRow)) {
    waiting_on_you.push({
      code: "room_readiness_locked",
      headline: `Readiness has not cleared ${READINESS_OVERALL_FLOOR} overall and ${READINESS_PART_FLOOR} on every part yet.`,
      next: "Open the Readiness panel on Meet it to see what to fix.",
      anchor: "#readiness-title",
    });
  }

  if (!truthy(disclosureRow)) {
    waiting_on_you.push({
      code: "room_disclosure_not_approved",
      headline: "Your sheet is not published, so there is no approved disclosure to show a follower.",
      next: "Publish your sheet on Meet it, then come back and publish your Room.",
      anchor: "#teacher-sheet-studio",
    });
  }

  return { waiting_on_you, waiting_on_us };
}

// ─────────────────────────────────────────────────────────────────────────
// OP: pause / resume
// ─────────────────────────────────────────────────────────────────────────

/**
 * Pause is UNCONDITIONAL — `api/_clonechannel.js`'s rule restated: "taking a
 * clone DOWN is never gated." Resume carries the SAME lock as publish, for
 * the same reason `setCloneChannelStatus`'s resume does: a Room paused while
 * ready and since regressed must not walk back through an unlocked door.
 */
export async function pauseRoom(db, ownerUserId, replicaId) {
  assertOwnerScope(ownerUserId, replicaId);
  const rows = await db(
    `update vy_room
        set paused_at = now(), updated_at = now()
      where owner_user_id = ($1)::uuid and replica_id = ($2)::uuid
      returning room_id, slug, replica_id, agent_id, owner_user_id, display_name,
                free_monthly_messages, paid_monthly_messages, paid_monthly_voice_seconds, default_locale,
                dormancy_days,
                listed_at, one_line_bio, taste_enabled,
                published_at, paused_at, created_at, updated_at`,
    [String(ownerUserId).toLowerCase(), String(replicaId).toLowerCase()],
  );
  return rows[0] ? clientRoom(rows[0]) : null;
}

export async function resumeRoom(db, ownerUserId, replicaId) {
  assertOwnerScope(ownerUserId, replicaId);
  const room = await ownedRoomRow(db, ownerUserId, replicaId);
  if (!room) return null;

  const rows = await db(
    `update vy_room r
        set paused_at = case
              when ${runtimeActive("r.owner_user_id", "r.replica_id")}
               and ${readinessPasses("r.owner_user_id", "r.replica_id", "$3", "$4")}
               and ${disclosureApproved("r.agent_id")}
              then null
              else r.paused_at
            end,
            updated_at = now()
      where r.owner_user_id = ($1)::uuid and r.replica_id = ($2)::uuid
      returning r.room_id, r.slug, r.replica_id, r.agent_id, r.owner_user_id, r.display_name,
                r.free_monthly_messages, r.paid_monthly_messages, r.paid_monthly_voice_seconds, r.default_locale,
                r.dormancy_days,
                r.listed_at, r.one_line_bio, r.taste_enabled,
                r.published_at, r.paused_at, r.created_at, r.updated_at`,
    [String(ownerUserId).toLowerCase(), String(replicaId).toLowerCase(), READINESS_OVERALL_FLOOR, READINESS_PART_FLOOR],
  );
  const next = rows[0];
  if (!next) return null;
  if (next.paused_at) {
    const blockers = await publishBlockers(db, ownerUserId, replicaId, room.agent_id);
    throw new RoomPublishError("room_publish_locked", 409, blockers);
  }
  return clientRoom(next);
}

// ─────────────────────────────────────────────────────────────────────────
// OP: set_free_cap
// ─────────────────────────────────────────────────────────────────────────

export async function setRoomFreeCap(db, ownerUserId, replicaId, cap) {
  assertOwnerScope(ownerUserId, replicaId);
  const n = Number(cap);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < ROOM_FREE_CAP_MIN || n > ROOM_FREE_CAP_MAX) {
    throw new RoomPublishError("room_free_cap_invalid", 400, { min: ROOM_FREE_CAP_MIN, max: ROOM_FREE_CAP_MAX });
  }
  const rows = await db(
    `update vy_room
        set free_monthly_messages = ($3)::int4, updated_at = now()
      where owner_user_id = ($1)::uuid and replica_id = ($2)::uuid
      returning room_id, slug, replica_id, agent_id, owner_user_id, display_name,
                free_monthly_messages, paid_monthly_messages, paid_monthly_voice_seconds, default_locale,
                dormancy_days,
                listed_at, one_line_bio, taste_enabled,
                published_at, paused_at, created_at, updated_at`,
    [String(ownerUserId).toLowerCase(), String(replicaId).toLowerCase(), n],
  );
  return rows[0] ? clientRoom(rows[0]) : null;
}

// ─────────────────────────────────────────────────────────────────────────
// OP: set_paid_ceilings (WS-R19) — the paid tier's editable fair-use numbers
// ─────────────────────────────────────────────────────────────────────────

/** Both ceilings in ONE statement, `setRoomFreeCap`'s own shape: a single
 *  UPDATE, both bounds validated here first for a named 400 rather than a
 *  raw constraint-violation 500, migration 081's CHECKs as the backstop
 *  rather than the first line of defence. */
export async function setRoomPaidCeilings(db, ownerUserId, replicaId, { messages, voiceSeconds }) {
  assertOwnerScope(ownerUserId, replicaId);
  const m = Number(messages);
  if (!Number.isFinite(m) || !Number.isInteger(m) || m < ROOM_PAID_MESSAGES_MIN || m > ROOM_PAID_MESSAGES_MAX) {
    throw new RoomPublishError("room_paid_messages_invalid", 400, {
      min: ROOM_PAID_MESSAGES_MIN, max: ROOM_PAID_MESSAGES_MAX,
    });
  }
  const v = Number(voiceSeconds);
  if (!Number.isFinite(v) || !Number.isInteger(v) || v < ROOM_PAID_VOICE_SECONDS_MIN || v > ROOM_PAID_VOICE_SECONDS_MAX) {
    throw new RoomPublishError("room_paid_voice_seconds_invalid", 400, {
      min: ROOM_PAID_VOICE_SECONDS_MIN, max: ROOM_PAID_VOICE_SECONDS_MAX,
    });
  }
  const rows = await db(
    `update vy_room
        set paid_monthly_messages = ($3)::int4,
            paid_monthly_voice_seconds = ($4)::int4,
            updated_at = now()
      where owner_user_id = ($1)::uuid and replica_id = ($2)::uuid
      returning room_id, slug, replica_id, agent_id, owner_user_id, display_name,
                free_monthly_messages, paid_monthly_messages, paid_monthly_voice_seconds, default_locale,
                dormancy_days,
                listed_at, one_line_bio, taste_enabled,
                published_at, paused_at, created_at, updated_at`,
    [String(ownerUserId).toLowerCase(), String(replicaId).toLowerCase(), m, v],
  );
  return rows[0] ? clientRoom(rows[0]) : null;
}

// ─────────────────────────────────────────────────────────────────────────
// OP: set_default_locale (WS-R24, migration 087)
// ─────────────────────────────────────────────────────────────────────────

/** The creator's own default for the Room's CHROME language - never the
 *  AI's own reply language, which this file has no opinion about.
 *  `setRoomFreeCap`'s exact shape: validated here for a named 400 rather
 *  than a raw constraint-violation 500, migration 087's CHECK as the
 *  backstop rather than the first line of defence. */
export async function setRoomDefaultLocale(db, ownerUserId, replicaId, locale) {
  assertOwnerScope(ownerUserId, replicaId);
  const loc = String(locale || "").trim().toLowerCase();
  if (loc !== "en" && loc !== "hi") {
    throw new RoomPublishError("room_default_locale_invalid", 400, { allowed: ["en", "hi"] });
  }
  const rows = await db(
    `update vy_room
        set default_locale = $3, updated_at = now()
      where owner_user_id = ($1)::uuid and replica_id = ($2)::uuid
      returning room_id, slug, replica_id, agent_id, owner_user_id, display_name,
                free_monthly_messages, paid_monthly_messages, paid_monthly_voice_seconds, default_locale,
                dormancy_days,
                listed_at, one_line_bio, taste_enabled,
                published_at, paused_at, created_at, updated_at`,
    [String(ownerUserId).toLowerCase(), String(replicaId).toLowerCase(), loc],
  );
  return rows[0] ? clientRoom(rows[0]) : null;
}

// ─────────────────────────────────────────────────────────────────────────
// OP: set_bio (WS-R45, migration 105)
// ─────────────────────────────────────────────────────────────────────────

/** The bio is the one piece of free text a CREATOR writes that a STRANGER
 *  reads before choosing to become anyone's follower — the directory card,
 *  never a private message a creator only shows people who already trust
 *  them. So it is held to the same copy law every other user-visible string
 *  in this product is: no em-dash or en-dash, never "clone"/"model"/
 *  "replica"/etc. Wrapped as `const label = <bio>;` so `scanSource` — the
 *  REAL function `scripts/check-copy.mjs` runs over the whole repo, not a
 *  reimplementation of its rules — reads it exactly as it reads any other
 *  visible string keyed by a name on `VISIBLE_KEY`'s own list ("label" is
 *  the first entry on it). A 400 here, never a silent strip or a
 *  best-effort clean: the creator's own words are not this file's to
 *  rewrite, only to refuse and ask for again. */
function assertBioClean(text) {
  if (!text) return;
  const fixture = `const label = ${JSON.stringify(text)};`;
  const offences = scanSource("room-bio-input.tsx", fixture, { rules: "full", codename: true, roomsVocab: true });
  if (offences.length) {
    throw new RoomPublishError("room_bio_copy_violation", 400, {
      rules: [...new Set(offences.map((o) => o.rule))],
    });
  }
}

/** The directory's one-line description of the creator. `setRoomFreeCap`'s
 *  exact shape: bounded here for a named 400 rather than a raw
 *  constraint-violation 500, migration 105's CHECK as the backstop. Never
 *  trims trailing/leading whitespace away silently beyond a plain `.trim()`
 *  — a creator's own words, not this file's to reformat. */
export async function setRoomBio(db, ownerUserId, replicaId, bio) {
  assertOwnerScope(ownerUserId, replicaId);
  const text = String(bio ?? "").trim();
  if (text.length > ROOM_BIO_MAX) {
    throw new RoomPublishError("room_bio_invalid", 400, { max: ROOM_BIO_MAX });
  }
  assertBioClean(text);
  const rows = await db(
    `update vy_room
        set one_line_bio = $3, updated_at = now()
      where owner_user_id = ($1)::uuid and replica_id = ($2)::uuid
      returning room_id, slug, replica_id, agent_id, owner_user_id, display_name,
                free_monthly_messages, paid_monthly_messages, paid_monthly_voice_seconds, default_locale,
                dormancy_days,
                listed_at, one_line_bio, taste_enabled,
                published_at, paused_at, created_at, updated_at`,
    [String(ownerUserId).toLowerCase(), String(replicaId).toLowerCase(), text],
  );
  return rows[0] ? clientRoom(rows[0]) : null;
}

// ─────────────────────────────────────────────────────────────────────────
// OP: set_taste_enabled (WS-R53, migration 110) — the taste switch
// ─────────────────────────────────────────────────────────────────────────

/** The creator's own on/off for the three-question taste a stranger gets
 *  before the sign-in wall (`api/_room-taste.js`). `setRoomFreeCap`'s exact
 *  shape: one UPDATE, one bounds check for a named 400 rather than a raw
 *  constraint-violation 500. Defaults `true` (migration 110's own column
 *  default) — a creator who never touches this switch gets the taste
 *  turned ON, because the whole feature exists to give every Room a free
 *  thirty seconds before the wall, not an opt-in nobody finds. */
export async function setRoomTasteEnabled(db, ownerUserId, replicaId, enabled) {
  assertOwnerScope(ownerUserId, replicaId);
  if (typeof enabled !== "boolean") {
    throw new RoomPublishError("room_taste_enabled_invalid", 400);
  }
  const rows = await db(
    `update vy_room
        set taste_enabled = ($3)::boolean, updated_at = now()
      where owner_user_id = ($1)::uuid and replica_id = ($2)::uuid
      returning room_id, slug, replica_id, agent_id, owner_user_id, display_name,
                free_monthly_messages, paid_monthly_messages, paid_monthly_voice_seconds, default_locale,
                dormancy_days,
                listed_at, one_line_bio, taste_enabled,
                published_at, paused_at, created_at, updated_at`,
    [String(ownerUserId).toLowerCase(), String(replicaId).toLowerCase(), enabled],
  );
  return rows[0] ? clientRoom(rows[0]) : null;
}

// ─────────────────────────────────────────────────────────────────────────
// OP: set_dormancy_days (WS-R75, migration 119) — the retention policy
// ─────────────────────────────────────────────────────────────────────────

/**
 * `null` turns the policy off (the default - kept forever, exactly as every
 * Room already behaves today); an integer >= `ROOM_DORMANCY_DAYS_MIN` turns
 * it on. `setRoomFreeCap`'s exact shape one column over, with one addition
 * that column does not need: a named 400 for a value BELOW the floor,
 * because migration 119's own CHECK would otherwise surface as a raw
 * constraint-violation 500 the first time a creator tried "30 days" and
 * meant it.
 */
export async function setRoomDormancyDays(db, ownerUserId, replicaId, days) {
  assertOwnerScope(ownerUserId, replicaId);
  let n = null;
  if (days !== null && days !== undefined && days !== "") {
    n = Number(days);
    if (!Number.isFinite(n) || !Number.isInteger(n) || n < ROOM_DORMANCY_DAYS_MIN) {
      throw new RoomPublishError("room_dormancy_days_invalid", 400, { min: ROOM_DORMANCY_DAYS_MIN });
    }
  }
  const rows = await db(
    `update vy_room
        set dormancy_days = ($3)::int4, updated_at = now()
      where owner_user_id = ($1)::uuid and replica_id = ($2)::uuid
      returning room_id, slug, replica_id, agent_id, owner_user_id, display_name,
                free_monthly_messages, paid_monthly_messages, paid_monthly_voice_seconds, default_locale,
                dormancy_days,
                listed_at, one_line_bio, taste_enabled,
                published_at, paused_at, created_at, updated_at`,
    [String(ownerUserId).toLowerCase(), String(replicaId).toLowerCase(), n],
  );
  return rows[0] ? clientRoom(rows[0]) : null;
}

// ─────────────────────────────────────────────────────────────────────────
// OP: list / unlist (WS-R45, migration 105) — the directory opt-in
// ─────────────────────────────────────────────────────────────────────────
//
// `listed_at` is a SECOND, independent switch from `published_at` (071) —
// this file's own "the publish lock is a write predicate" law, restated one
// column over. `list` is refused unless the Room is ALREADY published, and
// that refusal is the write predicate's own CASE, never a JS `if` above it
// — the identical reason `publishRoom`'s three-fragment CASE gives for why a
// status may never be decided twice. `unlist` is UNCONDITIONAL — the same
// "taking something down is never gated" law `pauseRoom`'s own comment
// states, because a creator changing their mind about being found is not a
// decision this product second-guesses.
//
// `coalesce(listed_at, now())` mirrors `publishRoom`'s own
// `coalesce(published_at, now())`: a creator who unlists and relists must
// not have their listing's own "on the directory since" date read as new
// again — the identical reasoning, restated because the identical bug would
// otherwise ship twice.

export async function listRoom(db, ownerUserId, replicaId) {
  assertOwnerScope(ownerUserId, replicaId);
  const room = await ownedRoomRow(db, ownerUserId, replicaId);
  if (!room) return null;

  const rows = await db(
    `update vy_room r
        set listed_at = case
              when r.published_at is not null then coalesce(r.listed_at, now())
              else r.listed_at
            end,
            updated_at = now()
      where r.owner_user_id = ($1)::uuid and r.replica_id = ($2)::uuid
      returning r.room_id, r.slug, r.replica_id, r.agent_id, r.owner_user_id, r.display_name,
                r.free_monthly_messages, r.paid_monthly_messages, r.paid_monthly_voice_seconds, r.default_locale,
                r.dormancy_days,
                r.listed_at, r.one_line_bio, r.taste_enabled,
                r.published_at, r.paused_at, r.created_at, r.updated_at`,
    [String(ownerUserId).toLowerCase(), String(replicaId).toLowerCase()],
  );
  const next = rows[0];
  if (!next) return null;
  if (!next.listed_at) {
    throw new RoomPublishError("room_list_requires_published", 409);
  }
  return clientRoom(next);
}

export async function unlistRoom(db, ownerUserId, replicaId) {
  assertOwnerScope(ownerUserId, replicaId);
  const rows = await db(
    `update vy_room
        set listed_at = null, updated_at = now()
      where owner_user_id = ($1)::uuid and replica_id = ($2)::uuid
      returning room_id, slug, replica_id, agent_id, owner_user_id, display_name,
                free_monthly_messages, paid_monthly_messages, paid_monthly_voice_seconds, default_locale,
                dormancy_days,
                listed_at, one_line_bio, taste_enabled,
                published_at, paused_at, created_at, updated_at`,
    [String(ownerUserId).toLowerCase(), String(replicaId).toLowerCase()],
  );
  return rows[0] ? clientRoom(rows[0]) : null;
}

// ─────────────────────────────────────────────────────────────────────────
// OP: stats — real counts only, never invented
// ─────────────────────────────────────────────────────────────────────────

/**
 * "followers total, followers active 24h, messages this month" and nothing
 * else, ever. `count`/`sum` over an EMPTY set return 0 in SQL, never null and
 * never an error, so a Room with no followers yet gets three real zeros
 * rather than a placeholder dash — `context/rejected.md`'s no-fake-numbers
 * law, applied to the one screen a creator checks the most.
 */
export async function ownerRoomStats(db, ownerUserId, replicaId, { now = Date.now(), tableApplied } = {}) {
  assertOwnerScope(ownerUserId, replicaId);
  const room = await ownedRoomRow(db, ownerUserId, replicaId);
  if (!room) return null;

  const rows = await db(
    `select
        count(*)::int as followers_total,
        count(*) filter (where f.last_seen_at >= now() - interval '24 hours')::int as followers_active_24h,
        coalesce(sum(case when f.month_key = $2 then f.month_message_count else 0 end), 0)::int as messages_this_month
       from vy_room_follower f
      where f.room_id = ($1)::uuid`,
    [String(room.room_id), monthKeyOf(now)],
  );
  const row = rows[0] || {};
  return {
    followers_total: Number(row.followers_total || 0),
    followers_active_24h: Number(row.followers_active_24h || 0),
    messages_this_month: Number(row.messages_this_month || 0),
    // WS-R86 (migration 123). n>=5 floored — `friendsBroughtThisWeek`'s own
    // header explains why this is a SEPARATE table/read from the three
    // counts above rather than a fourth column in the same statement.
    friends_brought_this_week: await friendsBroughtThisWeek(db, room.room_id, now, { tableApplied }),
  };
}

// ─────────────────────────────────────────────────────────────────────────
// OP: share_kit (WS-R85, migration 122) — the exact text and picture for
// WhatsApp, Instagram, YouTube and Telegram, one tap
// ─────────────────────────────────────────────────────────────────────────

/**
 * The owner's own Room, run through `buildShareKit` (`api/_share-kit.js`, a
 * pure function — every real decision already lives there). `origin` and
 * `now` are the two inputs this op adds beyond the room row itself:
 * `origin` because the kit's per-channel `?via=` links must point at
 * WHICHEVER deployment is asking (`api/room-card.js`'s own
 * `originFromRequest` reasoning, one file over), `now` only so
 * `evals/share-kit/run.mjs` can drive this at a fixed instant rather than
 * racing a real clock (this file's `ownerRoomStats` above takes the
 * identical parameter for the identical reason).
 *
 * Returns `{ room_id, kit: [...] | null }` — `kit` is `null` for a Room
 * that has never published, `buildShareKit`'s own "nothing honest to share
 * yet" rule, never a 404 or an error: an owner opening the Share tab before
 * they publish should see an honest empty state, not a broken card.
 *
 * A `ShareKitError` from the builder (the defensive over-limit throw,
 * `api/_share-kit.js`'s own header on why it should never actually fire) is
 * caught and re-thrown as a `RoomPublishError` carrying the SAME
 * `.code`/`.status`/`.details` — `api/room-publish.js`'s own catch block
 * only instanceof-checks `RoomPublishError`, so a builder-native error class
 * would otherwise fall through to a generic 500 that named nothing.
 */
export async function ownerRoomShareKit(db, ownerUserId, replicaId, { origin = "", now = Date.now() } = {}) {
  assertOwnerScope(ownerUserId, replicaId);
  const room = await ownedRoomRow(db, ownerUserId, replicaId);
  if (!room) return null;
  try {
    const kit = buildShareKit({
      name: room.display_name,
      slug: room.slug,
      locale: room.default_locale,
      origin,
      publishedAt: room.published_at,
      // WS-R126: structurally absent (`null`) unless the WhatsApp chat lane
      // itself is on AND a business number is configured — `whatsappJoinLink`'s
      // own header states why a half-configured deploy must never hand out a
      // link that opens nothing useful.
      whatsappJoinUrl: whatsappJoinLink(room.slug, process.env),
    });
    return { room_id: room.room_id, kit };
  } catch (error) {
    if (error instanceof ShareKitError) {
      throw new RoomPublishError(error.code, error.status, error.details);
    }
    throw error;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// OP: showcase_set / showcase_remove (WS-R66, migration 115) — the public
// page's up-to-five Q&A pairs
// ─────────────────────────────────────────────────────────────────────────
//
// CREATOR MATERIAL ONLY, never a follower's words. `question`/`answer` are
// either typed or edited by the owner directly, or copied from a
// `vy_review_card` the owner already marked "Sounds right" — and the read
// below that does the copying is the ONE place this law is enforced, in the
// WHERE clause, never applied after the row is already in hand
// (`api/_disclosure.js`'s standing rule, restated for a write's source read).
//
// THE COLUMN THAT TELLS THEM APART: `kind`. Migration 074's own comment
// names it — `'follower_declined'` is "a real follower question the AI
// declined or answered with low confidence"; `'question'` is the pre-launch
// synthetic set drawn from the replica's OWN sources, and `'claim'`/`'delta'`
// are mined from the replica's own material or a Mirror Call the OWNER
// themselves ran. So the eligible read below is
// `kind <> 'follower_declined' and state = 'sounds_right'` — a card the
// owner approved as-is, of a kind that was never a follower's own words in
// the first place. A card does exist to tell the two apart; the fallback
// this law's own phrasing names ("if none does, allow only typed text and
// log why") does not apply here, and is not exercised.
export const ROOM_SHOWCASE_SLOTS = 5;
export const ROOM_SHOWCASE_QUESTION_MAX = 200;
export const ROOM_SHOWCASE_ANSWER_MAX = 1200;

function assertShowcasePosition(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > ROOM_SHOWCASE_SLOTS) {
    throw new RoomPublishError("room_showcase_position_invalid", 400, { min: 1, max: ROOM_SHOWCASE_SLOTS });
  }
  return n;
}

/** `assertBioClean`'s exact shape, one field at a time: a stranger reads this
 *  text on the public page before ever becoming anyone's follower, so it is
 *  held to the same em-dash and Rooms-vocabulary law every other
 *  stranger-facing string in this product is, via the REAL scanner rather
 *  than a second, drifting reimplementation of its rules. */
function assertShowcaseTextClean(text) {
  if (!text) return;
  const fixture = `const label = ${JSON.stringify(text)};`;
  const offences = scanSource("room-showcase-input.tsx", fixture, { rules: "full", codename: true, roomsVocab: true });
  if (offences.length) {
    throw new RoomPublishError("room_showcase_copy_violation", 400, {
      rules: [...new Set(offences.map((o) => o.rule))],
    });
  }
}

/** Every ACTIVE showcase row for one Room, in position order — the public
 *  page's own read (`api/_creator-page.js`) and the studio Share tab's own
 *  read (`getOwnedRoom` above) both call this rather than each holding a copy
 *  of the predicate, `_creators.js`'s "one query, not a shared abstraction
 *  worth a third file" reasoning applied the other way: here the query IS
 *  worth sharing, because both callers need the identical five-in-
 *  position-order shape and a hand-copied second version is exactly how one
 *  of them silently stops matching migration 115's own partial index. */
export async function readRoomShowcase(db, roomId) {
  if (typeof db !== "function") throw new RoomPublishError("room_publish_db_required", 500);
  const rows = await db(
    `select id, question, answer, position, created_at
       from vy_room_showcase
      where room_id = ($1)::uuid and removed_at is null
      order by position asc
      limit ($2)::int`,
    [String(roomId), ROOM_SHOWCASE_SLOTS],
  );
  return rows.map((r) => ({
    id: String(r.id),
    question: r.question,
    answer: r.answer,
    position: Number(r.position),
  }));
}

/**
 * Set one showcase slot (1..5), typed text or a source review card, and hand
 * back the Room's full showcase afterward.
 *
 * `sourceCardId` is looked up SCOPED TO THIS OWNER AND REPLICA, and only a
 * card that is `state = 'sounds_right'` and `kind <> 'follower_declined'`
 * ever answers — the eligibility predicate is entirely inside this one SELECT,
 * never a JS branch after a card is already in hand. An ineligible or
 * missing card id is a NAMED refusal (`room_showcase_card_ineligible`), never
 * a silent fallback to whatever typed text happened to be in the body.
 *
 * Retire-then-insert rather than one UPSERT: two plain statements Neon's
 * SQL-over-HTTP endpoint can each run on their own, `009`'s "one statement
 * per request" law applied to an application write exactly as it is to a
 * migration. The retiring UPDATE is UNCONDITIONAL on whatever already held
 * this position (soft delete, `removed_at = now()`) — a creator replacing
 * slot 3 is not asked to first remove the old answer, `pauseRoom`'s "taking
 * something down is never gated" restated for an overwrite instead of a
 * take-down.
 */
export async function setRoomShowcase(db, ownerUserId, replicaId, { position, question, answer, sourceCardId } = {}) {
  assertOwnerScope(ownerUserId, replicaId);
  const pos = assertShowcasePosition(position);
  const room = await ownedRoomRow(db, ownerUserId, replicaId);
  if (!room) return null;

  let q = String(question ?? "").trim();
  let a = String(answer ?? "").trim();

  if (sourceCardId) {
    const cardId = String(sourceCardId || "").trim().toLowerCase();
    if (!UUID.test(cardId)) throw new RoomPublishError("room_showcase_card_invalid", 400);
    const cardRows = await db(
      `select prompt_text, answer_text
         from vy_review_card
        where card_id = ($1)::uuid and owner_user_id = ($2)::uuid and replica_id = ($3)::uuid
          and state = 'sounds_right' and kind <> 'follower_declined'
        limit 1`,
      [cardId, String(ownerUserId).toLowerCase(), String(replicaId).toLowerCase()],
    );
    if (!cardRows[0]) throw new RoomPublishError("room_showcase_card_ineligible", 409);
    q = String(cardRows[0].prompt_text || "").trim();
    a = String(cardRows[0].answer_text || "").trim();
  }

  if (!q || q.length > ROOM_SHOWCASE_QUESTION_MAX) {
    throw new RoomPublishError("room_showcase_question_invalid", 400, { max: ROOM_SHOWCASE_QUESTION_MAX });
  }
  if (!a || a.length > ROOM_SHOWCASE_ANSWER_MAX) {
    throw new RoomPublishError("room_showcase_answer_invalid", 400, { max: ROOM_SHOWCASE_ANSWER_MAX });
  }
  assertShowcaseTextClean(q);
  assertShowcaseTextClean(a);

  await db(
    `update vy_room_showcase
        set removed_at = now()
      where room_id = ($1)::uuid and position = ($2)::int and removed_at is null`,
    [String(room.room_id), pos],
  );
  await db(
    `insert into vy_room_showcase (id, room_id, question, answer, position)
     values (($1)::uuid, ($2)::uuid, $3, $4, ($5)::int)`,
    [randomUUID(), String(room.room_id), q, a, pos],
  );
  return { room_id: String(room.room_id), showcase: await readRoomShowcase(db, room.room_id) };
}

/**
 * Take one showcase item down. UNCONDITIONAL, `unlistRoom`'s own law: a
 * creator changing their mind about showing an answer is not a decision this
 * product second-guesses. Owner-scoped in the WRITE's own WHERE, via the same
 * join-through-vy_room shape `_replica-full-erasure.js`'s room-scoped deletes
 * use, never a separate ownership SELECT before the write.
 */
export async function removeRoomShowcase(db, ownerUserId, replicaId, showcaseId) {
  assertOwnerScope(ownerUserId, replicaId);
  const id = String(showcaseId || "").trim().toLowerCase();
  if (!UUID.test(id)) throw new RoomPublishError("room_showcase_item_invalid", 400);

  const rows = await db(
    `update vy_room_showcase s
        set removed_at = now()
       from vy_room r
      where s.room_id = r.room_id
        and r.owner_user_id = ($1)::uuid and r.replica_id = ($2)::uuid
        and s.id = ($3)::uuid and s.removed_at is null
      returning s.room_id`,
    [String(ownerUserId).toLowerCase(), String(replicaId).toLowerCase(), id],
  );
  if (!rows[0]) return null;
  return { room_id: String(rows[0].room_id), showcase: await readRoomShowcase(db, rows[0].room_id) };
}
