// api/_creators.js — the public creator directory's one read (WS-R45).
//
// A Room today is reachable only by its link. This is the platform's own
// page of the Rooms a creator chose to be found on: name, one-line bio,
// language, nothing else — never a number that describes a person. The
// directory's ONE predicate, restated wherever it is needed rather than
// imported from a decision module that also knows how to write it
// (`api/_room-publish.js`'s `listRoom`/`unlistRoom`, migration 105):
//
//   listed_at is not null and published_at is not null
//
// Both conditions, in the SAME where clause, every time — never one checked
// without the other. A Room that is published but never opted in stays off
// the directory; a Room that opted in and was since un-published (or never
// finished publishing) stays off it too, because `listed_at` alone was never
// meant to outrun the publish gate that makes the Room answerable at all.
//
// ── WHY THIS FILE NEVER NAMES A FOLLOWER TABLE ─────────────────────────────
//
// The leak battery (`evals/room-leak/run.mjs`) proves the three Rooms scopes
// hold by exhaustively attacking every module that ever reads a follower row.
// This module is not one of them, on purpose: a directory is a PUBLIC page a
// stranger reads before they are a follower of anyone, so admitting this file
// to that battery would be testing a scope it structurally cannot leak,
// because it never opens a connection to it. `evals/creator-directory/run.mjs`
// asserts this statically over this file's own source — no aggregate over any
// per-person table, no join to one, ever — so the guarantee is provable by
// reading the query rather than by trusting a comment.
//
// No import of `./_db.js` here on purpose: this module takes `db` as a
// parameter, `api/_room-publish.js`'s own shape, so a fake `db` in an
// offline eval can reach every line below it.

const PAGE_SIZE_DEFAULT = 24;
const PAGE_SIZE_MAX = 60;

/** Lowercase base64 of `<listed_at ISO>|<room_id>`, the directory's own
 *  keyset-pagination cursor. Opaque to a caller by construction (nothing
 *  about a Room's identity is legible in it beyond what the page already
 *  shows), and unambiguous to decode because `|` never appears in either
 *  half — an ISO timestamp and a UUID are both closed alphabets. */
export function encodeCreatorsCursor(listedAtIso, roomId) {
  return Buffer.from(`${listedAtIso}|${roomId}`, "utf8").toString("base64url");
}

/** Returns `{ listedAtIso, roomId }` or `null` for anything that does not
 *  decode to the two-part shape above — a malformed cursor is treated as no
 *  cursor (the first page), never a 500: a stale or hand-edited query string
 *  is not this reader's problem to refuse. */
export function decodeCreatorsCursor(cursor) {
  if (!cursor) return null;
  try {
    const raw = Buffer.from(String(cursor), "base64url").toString("utf8");
    const i = raw.indexOf("|");
    if (i < 0) return null;
    const listedAtIso = raw.slice(0, i);
    const roomId = raw.slice(i + 1);
    if (!listedAtIso || !roomId || Number.isNaN(Date.parse(listedAtIso))) return null;
    return { listedAtIso, roomId };
  } catch {
    return null;
  }
}

function clampLimit(limit) {
  const n = Number(limit);
  if (!Number.isFinite(n) || n <= 0) return PAGE_SIZE_DEFAULT;
  return Math.min(Math.floor(n), PAGE_SIZE_MAX);
}

/** The client shape. Exactly the five fields the brief names, and nothing a
 *  caller could grow into a sixth without a diff on this line: no follower
 *  count, no message count, no revenue, nothing per person — `readiness`-
 *  shaped fields, funnel marks, none of it belongs on a page a stranger
 *  reads before choosing whether to become anyone's follower at all. */
function clientCreator(row) {
  return {
    display_name: row.display_name || "",
    slug: row.slug,
    one_line_bio: row.one_line_bio || "",
    locale: row.default_locale === "hi" ? "hi" : "en",
    listed_at: row.listed_at,
  };
}

/**
 * One page of the directory, newest listing first. `db` is `api/_db.js`'s
 * `q` in production and a fake in every offline eval — this function never
 * imports `_db.js`'s connection, only its region constant, so a fake `db`
 * can reach every line below it.
 */
export async function readCreatorsPage(db, { cursor, limit } = {}) {
  const n = clampLimit(limit);
  const decoded = decodeCreatorsCursor(cursor);

  const rows = await db(
    `select room_id, display_name, slug, one_line_bio, default_locale, listed_at
       from vy_room
      where listed_at is not null
        and published_at is not null
        and (
          ($2)::timestamptz is null
          or (listed_at, room_id) < (($2)::timestamptz, ($3)::uuid)
        )
      order by listed_at desc, room_id desc
      limit ($1)::int`,
    [n, decoded ? decoded.listedAtIso : null, decoded ? decoded.roomId : null],
  );

  const creators = rows.map(clientCreator);
  const last = rows[rows.length - 1];
  const next_cursor = rows.length === n && last ? encodeCreatorsCursor(String(last.listed_at), String(last.room_id)) : null;
  return { creators, next_cursor };
}
