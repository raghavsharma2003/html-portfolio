// api/_email-seam.js - the platform's ONE email seam (WS-R127).
//
// Nothing in this codebase sends an email today: no `owner_user_id`/`vy_org`
// row anywhere carries an email address (grepped, not assumed - Supabase
// Auth holds a creator's email outside this database, and nothing here
// reads it back), and this workstream's own brief is explicit: "no new env
// var". So there is, structurally, no address to send to and no provider
// configured to send with - `emailSeamConfigured` below returns `false`
// unconditionally, honestly, the same "unset config: nothing runs" posture
// `api/_creator-push.js#creatorPushConfig`/`api/_operator-digest.js#operatorDigestConfig`
// already take for an unset VAPID key, restated for a channel that has no
// config to check at all yet.
//
// This file exists anyway, now, so a future workstream that DOES have an
// address and a provider has a seam to fill in rather than a channel
// literal (`'email'` in migration 132's own CHECK) with nothing behind it.
// `recordWouldSendOrgWeeklyNoteEmail` below is the whole seam: it takes the
// SAME already-built, already-floored note object `api/_org-weekly-note.js#
// buildOrgWeeklyNote` returns, and DOES NOTHING WITH IT beyond a log line -
// no `fetch`, no SMTP client, no import of any transport library, checked
// by this file's own header being the true and complete list of what it
// imports (`node:crypto` for nothing more than a stable log tag). A
// caller's own `deps.log` lets an eval capture the line without touching
// stdout, `api/_operator-telegram.js`'s own injectable-fetch precedent
// restated for console output instead of a network call.
//
// Reversal condition (`context/decisions.md#ws-r127-email-seam-hardcoded-false`):
// the day a real address source and a real provider both exist, replace the
// `false` below with the real predicate and replace this function's body
// with a real send - the CALLER (`api/_org-weekly-note.js#sendOrgWeeklyNotes`)
// does not change at all, since it already treats `emailSeamConfigured`
// as a boolean and `recordWouldSendOrgWeeklyNoteEmail` as "the one write for
// this channel", exactly the seam shape `api/_operator-telegram.js` itself
// grew into a real channel from.

/** Whether the email channel can send a real message today. Always `false`
 *  - see this file's header. Takes `env` for the SAME reason every other
 *  `*Configured`/`*Config` function in this repo does (a future flag reads
 *  it), even though nothing here reads `env` yet. */
export function emailSeamConfigured(_env = process.env) {
  return false;
}

/**
 * The one write for this channel. NEVER a network call - no `fetch`, no
 * transport import, anywhere in this file. Logs a would-send line naming
 * only the org id, the week and the rooms-published/rooms-total counts
 * already public inside `note` (never a follower id, never a room's own
 * slug or display name reads them back to anyone this note was not already
 * for) so an operator reading server logs can see the seam firing without
 * this function becoming a second place follower content could leak
 * through - `note.rooms[].display_name` is a Room's own PUBLIC name
 * (already shown to anyone who opens `/r/<slug>`, `api/_creator-push.js#
 * creatorWeeklyPushPayload`'s own precedent for the identical field), so it
 * is not itself follower content, but this function does not read the
 * per-room list at all - the org-level counts are enough for a would-send
 * log line, and reading less here is one less thing a future edit could
 * widen by mistake.
 */
export async function recordWouldSendOrgWeeklyNoteEmail(note, deps = {}) {
  const log = typeof deps.log === "function" ? deps.log : console.log;
  const orgId = String(note?.org_id || "");
  const weekStart = String(note?.week_start || "");
  const roomsPublished = Number(note?.rooms_published) || 0;
  const roomsTotal = Number(note?.rooms_total) || 0;
  log(`[email-seam] would send org weekly note: org=${orgId} week=${weekStart} rooms=${roomsPublished}/${roomsTotal} (no sender configured, no network call made)`);
  return { would_send: true, sent: false };
}
