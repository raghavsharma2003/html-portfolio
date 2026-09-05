// api/_incidents.js — the incident ledger (WS-R58, migration 109).
//
// The ops board (WS-R21) knows a sweep ran. It has never known that a door
// threw, that Telegram answered 5xx twelve times, or that the payments
// provider timed out, unless someone opened Vercel's own logs. This file
// makes failure a row: one content-free daily count per (kind, door,
// status), upserted so a thousand identical failures in an afternoon cost
// one write's worth of rows, never a thousand.
//
// ── WHAT THIS FILE OWNS ──────────────────────────────────────────────────
//
//   1. `recordIncident(db, {kind, door, status})` — the one write. NEVER
//      throws (a broken incident write must never break the request it is
//      recording), NEVER carries a message/stack/id — `kind` is checked
//      against the SAME closed list migration 109's CHECK enforces (belt
//      and suspenders: even a caller that bypassed the CHECK could not get
//      free text into this table's own INSERT statement, which names
//      exactly six columns and no others — `evals/incidents/run.mjs`
//      statically scans this file's own source for that column list).
//   2. `withDoor(db, door, handler)` — the smallest shared wrapper a thin
//      door needs to get an incident row for free. It changes NOTHING about
//      a door's own response: it patches `res.status` to remember the LAST
//      status code the door's own (already-existing) catch block sends, and
//      after the door settles, records one incident if that status was
//      >=500. A door that already hand-rolls `console.error(...);
//      res.status(500).json(...)` needs no other change — `export default
//      withDoor(q, "room.js", handler)` in place of `export default
//      handler` is the whole adoption.
//   3. `claimNewKindNotification` / `notifyNewIncidentKinds` — the
//      check-ins sweep's own new-kind alert (workstream law #4): ONE web
//      push to OPS_OWNER_USER_IDS, at most once per kind per day, the
//      UPDATE's own WHERE clause the whole idempotency mechanism (see that
//      function's header for the exact guarantee).
//   4. `pruneOldIncidents` — rows older than 90 days, `api/_sweep-run.js`'s
//      `pruneOldRuns` own best-effort, bounded-delete posture restated for
//      this table.
//
// ── THE GAP THIS FILE ONCE NAMED, NOW CLOSED (WS-R62, migration 114) ────
//
// `notifyNewIncidentKinds` sends through the SAME `api/_push/webpush.js`
// module every follower notification already uses. Until WS-R62 this repo
// had NO operator push-subscription store — `vy_room_push_subscription`
// (migration 085) is scoped to a follower's own (room_id, person_id,
// follower_id), not to a platform operator's Supabase auth id —
// `deps.operatorSubscriptionsFor` resolved to an empty list for every
// operator, so a claim was made correctly but nobody was ever pushed to.
// `vy_operator_push_subscription` (migration 114, `api/_ops.js`'s
// `operatorPushSubscriptionsFor`/`revokeOperatorPushById`) is that store;
// `api/_checkins.js` wires the real functions in as `deps.
// operatorSubscriptionsFor`/`deps.revokeOperatorSubscription` in
// production. This file still takes both as INJECTED deps, never an
// import of `api/_ops.js` directly — that file already imports THIS one
// (`INCIDENT_KINDS`, `incidentsOverview`'s own read), so an import the
// other way would make a cycle, `opsOwnerIdsLocal`'s own precedent one
// function up restated for a second seam. See
// context/decisions.md#ws-r58-operator-push-subscription-store-does-not-exist
// for the decision this closes.
import { randomUUID } from "node:crypto";
import { send as webPushSend } from "./_push/webpush.js";

// A local re-derivation of `api/_ops.js`'s own `opsOwnerIds`, not an import
// of it - `api/_ops.js` imports THIS file (`incidentsOverview`, below) for
// the board's own Incidents card, and an import the other way would make a
// cycle. Same three-step parse (split, trim, lowercase, drop empties) as
// the original, kept in sync by `evals/incidents/run.mjs` asserting both
// parse the SAME `OPS_OWNER_USER_IDS` string identically rather than by
// sharing a function.
function opsOwnerIdsLocal(env) {
  return String(env.OPS_OWNER_USER_IDS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

// Mirrors migration 109's `vy_incident_kind_check` exactly. Widening this
// list means widening that CHECK in the SAME commit — `evals/incidents/
// run.mjs` asserts the two stay equal in spirit by exercising every member
// against the real INSERT text, the same "two fakes for the same shape
// silently drifting apart" risk this repo names everywhere else.
//
// WS-R76 (migration 120) added `self_check`: `api/self-check.js` records one
// incident per failing check (an env var missing by name, the database not
// answering, a migration family absent from the live catalog, a sibling
// sweep gone stale) through this SAME `recordIncident`, never a bespoke
// write path — a self-check that cannot report a finding through the one
// table every other door already reports through would be a second,
// untested incident pipeline.
export const INCIDENT_KINDS = Object.freeze([
  "door_5xx",
  "provider_payments",
  "provider_telegram",
  "provider_whatsapp",
  "provider_webpush",
  "self_check",
]);
const INCIDENT_KIND_SET = new Set(INCIDENT_KINDS);

function validDoor(door) {
  const d = String(door || "");
  return d.length > 0 && d.length <= 100;
}

function validStatus(status) {
  const n = Number(status);
  return Number.isInteger(n) && n >= 0 && n < 1000;
}

/**
 * The one write. Upserts `(day, kind, door, status)` — migration 109's own
 * unique index — incrementing `count` on conflict. NEVER throws and NEVER
 * carries anything beyond the four scalar inputs: an invalid `kind` (not on
 * `INCIDENT_KINDS`), an invalid `door` (empty or over 100 chars) or an
 * invalid `status` (not a 0-999 integer) is silently dropped rather than
 * attempted — the same "a malformed subscription... short-circuits before
 * any network call" posture `_push/webpush.js`'s own `send` takes for its
 * own inputs, restated for a database write instead of an HTTP one.
 *
 * Callers do not need to await this — it resolves whether or not the write
 * succeeded — but MAY await it if they want the write ordered before their
 * own next statement (`withDoor` does, since a door's response has already
 * gone out by the time this runs and there is nothing left to order against).
 */
export async function recordIncident(db, { kind, door, status } = {}) {
  try {
    if (typeof db !== "function") return { ok: false, reason: "db_required" };
    if (!INCIDENT_KIND_SET.has(kind)) return { ok: false, reason: "kind_invalid" };
    if (!validDoor(door)) return { ok: false, reason: "door_invalid" };
    if (!validStatus(status)) return { ok: false, reason: "status_invalid" };
    await db(
      `insert into vy_incident (incident_id, day, kind, door, status, count, created_at, updated_at)
       values (($1)::uuid, current_date, $2, $3, $4, 1, now(), now())
       on conflict (day, kind, door, status)
       do update set count = vy_incident.count + 1, updated_at = now()`,
      [randomUUID(), kind, String(door), Number(status)],
    );
    return { ok: true };
  } catch (error) {
    console.error("[incidents] recordIncident failure:", error?.message || "unknown");
    return { ok: false, reason: "write_failed" };
  }
}

/**
 * The smallest shared wrapper a thin door needs (workstream law #2): no
 * door in `room.js`/`room-pay.js`/`room-publish.js`/`payments.js`/`org.js`/
 * `invites.js`/`tg.js`/`whatsapp.js`/`checkins.js`/`handoff.js`/`apply.js`
 * shares a `sendError`/`fail` helper — each hand-rolls its own catch-all
 * `console.error(...); res.status(5xx).json(...)`. Rather than touch every
 * one of those catch blocks, this wraps the WHOLE handler and watches the
 * response object from the outside: it remembers the LAST status code the
 * door's own `res.status(...)` call used (Vercel's `res.status` returns
 * `res` itself for chaining, so patching it changes nothing observable —
 * the same `.status(code).json(body)` call still runs, unchanged, this
 * function only additionally records which code it was) and, once the
 * handler settles, records one incident if that code was >=500.
 *
 * `tg.js`/`whatsapp.js` are adopted for the same reason every other door
 * is, even though both deliberately MASK an internal failure as a 200 (so
 * Telegram/Meta do not retry-storm a transient bug forever — see each
 * file's own handler) — this wrapper is a pure observer of whatever status
 * the door decides to send, never a second opinion on what that status
 * should be, so it correctly records NOTHING for those two today (their own
 * catch never sends >=500) and would start recording the moment either
 * door's own posture changed, with no further change here.
 *
 * `db` is passed explicitly (never imported) so `evals/incidents/run.mjs`
 * can drive this with a fake db and a fake `res`, offline — the same seam
 * every door already takes for its own `q`.
 */
export function withDoor(db, door, handler) {
  return async function wrapped(req, res) {
    let lastStatus = 0;
    const originalStatus = typeof res.status === "function" ? res.status.bind(res) : null;
    if (originalStatus) {
      res.status = (code) => {
        lastStatus = Number(code) || lastStatus;
        return originalStatus(code);
      };
    }
    try {
      return await handler(req, res);
    } finally {
      if (lastStatus >= 500) {
        recordIncident(db, { kind: "door_5xx", door, status: lastStatus });
      }
    }
  };
}

// Content-free by construction — the only two facts that ever reach the
// wire are `kind` (one of the five closed values) and `count` (today's
// total for that kind, across every door and status) — never a door name
// and never a person id, `evals/incidents/run.mjs`'s own static scan
// asserts this function's own source names neither, `_push/webpush.js`'s
// `checkinPushPayload` own "the payload builder's own parameter list IS the
// enforcement" precedent restated for a fifth notification shape.
//
// WS-R62: shaped as `{title, body, kind, route}` — `public/push-sw.js`'s
// OWN payload contract (its header: "a data-only push … `{title, body,
// kind, route}`") — so the operator's real browser notification is drawn by
// the SAME already-committed, already-reviewed display worker every other
// account-wide push in this repo uses, rather than a second display path
// this workstream would have to write and review from scratch. `title`/
// `body` are fixed English sentences built from the closed `kind` vocabulary
// and a count, never a template that could carry a door name or an id —
// `kind: "opsIncident"` here is `push-sw.js`'s own notification GROUPING
// key (its `TAGS` map), unrelated to `vy_incident.kind`, and `route` always
// points at the ops board itself, never a specific incident row (there is
// no per-incident route to point at — the board's own Incidents card is
// where the real detail lives, behind the operator's own bearer).
function incidentPushPayload(kind, count) {
  const n = Number.isFinite(count) ? count : 0;
  return JSON.stringify({
    title: "Vyakti ops alert",
    body: `${String(kind || "")}: ${n} today`,
    kind: "opsIncident",
    route: "/studio?mode=ops",
  });
}

/**
 * ONE representative row for (day, kind) is claimed with ONE UPDATE whose
 * WHERE clause does three things at once, so no second statement and no
 * transaction is needed for the whole guarantee (Neon SQL-over-HTTP's own
 * one-statement law, `_sweep-run.js`'s heartbeat writes restated for a
 * conditional claim instead of an unconditional one):
 *
 *   1. picks the lowest (door, status) row for today's `kind` — which exact
 *      row carries the flag does not matter, only that exactly one does;
 *   2. `not exists (... notified_at is not null ...)` — refuses if ANY row
 *      for this (day, kind) has already been claimed, so a kind spread
 *      across three doors still gets notified at most once;
 *   3. `not exists (... day between today-7 and yesterday ...)` — refuses
 *      unless this kind is genuinely new against the previous 7 days,
 *      workstream law #4's own words.
 *
 * Returns `true` iff this call is the one that won the claim — the caller's
 * cue to actually attempt a push. THE UPDATE'S WHERE IS THE IDEMPOTENCY: two
 * overlapping sweep ticks racing this same statement cannot both get a
 * non-empty `returning`, because the second one's own `not exists` sees the
 * first one's already-committed `notified_at`.
 */
export async function claimNewKindNotification(db, kind) {
  if (typeof db !== "function" || !INCIDENT_KIND_SET.has(kind)) return false;
  try {
    const rows = await db(
      `update vy_incident
          set notified_at = now()
        where incident_id = (
          select incident_id from vy_incident
           where day = current_date and kind = $1
           order by door, status
           limit 1
        )
          and not exists (
            select 1 from vy_incident where day = current_date and kind = $1 and notified_at is not null
          )
          and not exists (
            select 1 from vy_incident where kind = $1 and day >= (current_date - 7) and day < current_date
          )
        returning incident_id`,
      [kind],
    );
    return rows.length > 0;
  } catch (error) {
    console.error("[incidents] claimNewKindNotification failure:", error?.message || "unknown");
    return false;
  }
}

/**
 * The check-ins sweep's own step (workstream law #4). For every kind that
 * has at least one row today, attempts the claim above; on a win, attempts
 * one web push per subscription `deps.operatorSubscriptionsFor` resolves
 * for each `OPS_OWNER_USER_IDS` entry — `api/_checkins.js` wires this to the
 * real `vy_operator_push_subscription` reader in production (WS-R62); the
 * default here (an empty list) is only ever exercised by an eval that does
 * not inject one. Unset VAPID or an empty operator allowlist is
 * `_checkins.js`'s own `webPush`'s posture restated: no claim is even
 * attempted, so the day it gets configured mid-day this can still fire for
 * a kind that first appeared before the config existed.
 *
 * A 404/410 from the push service revokes that ONE subscription via
 * `deps.revokeOperatorSubscription` (default: a no-op — again, only an
 * eval that omits it ever sees that) — `_checkins.js`'s own `webPush`
 * deliverer's 404/410 handling for a follower, restated for the owner lane
 * (workstream law #3).
 *
 * NEVER throws — every step inside is best-effort, the same posture
 * `_checkins.js`'s `deliverers.webPush` already takes for a single
 * subscription's own failure, restated for the whole sweep step.
 */
export async function notifyNewIncidentKinds(db, deps = {}) {
  const summary = { checked: 0, claimed: 0, pushed: 0 };
  if (typeof db !== "function") return summary;
  const env = deps.env || process.env;
  const vapidPublic = String(env.ROOM_PUSH_VAPID_PUBLIC || "");
  const vapidPrivate = String(env.ROOM_PUSH_VAPID_PRIVATE || "");
  const vapidSubject = String(env.ROOM_PUSH_VAPID_SUBJECT || "");
  if (!vapidPublic || !vapidPrivate || !vapidSubject) return summary;
  const ownerIds = opsOwnerIdsLocal(env);
  if (!ownerIds.length) return summary;

  let kindsToday;
  try {
    kindsToday = await db(`select distinct kind from vy_incident where day = current_date`, []);
  } catch (error) {
    console.error("[incidents] notify kind scan failure:", error?.message || "unknown");
    return summary;
  }
  summary.checked = kindsToday.length;

  const resolveSubs = typeof deps.operatorSubscriptionsFor === "function"
    ? deps.operatorSubscriptionsFor
    : async () => [];
  const sendPush = deps.sendPush || webPushSend;
  const revoke = typeof deps.revokeOperatorSubscription === "function"
    ? deps.revokeOperatorSubscription
    : async () => {};

  for (const row of kindsToday) {
    const kind = row?.kind;
    if (!INCIDENT_KIND_SET.has(kind)) continue;
    const claimed = await claimNewKindNotification(db, kind);
    if (!claimed) continue;
    summary.claimed++;
    // Today's total for this kind, across every door and status — the
    // ONLY other fact (besides `kind` itself) `incidentPushPayload` may
    // ever put on the wire, its own header's law.
    let countToday = 0;
    try {
      const [countRow] = await db(
        `select coalesce(sum(count), 0)::int as n from vy_incident where day = current_date and kind = $1`,
        [kind],
      );
      countToday = Number(countRow?.n || 0);
    } catch (error) {
      console.error("[incidents] notify count read failure:", error?.message || "unknown");
    }
    const payload = incidentPushPayload(kind, countToday);
    for (const ownerId of ownerIds) {
      let subs = [];
      try {
        subs = (await resolveSubs(ownerId)) || [];
      } catch {
        subs = [];
      }
      for (const sub of subs) {
        try {
          const result = await sendPush(sub, payload, {
            fetch: deps.fetch,
            vapidPublic,
            vapidPrivate,
            vapidSubject,
            now: deps.now,
          });
          if (result?.ok) {
            summary.pushed++;
          } else if (result?.status === 404 || result?.status === 410) {
            // Workstream law #3 — `_checkins.js`'s own `webPush` deliverer's
            // 404/410 handling for a follower's subscription, restated for
            // the operator's own.
            await revoke(sub.id).catch(() => {});
          }
        } catch (error) {
          console.error("[incidents] notify push send failure:", error?.message || "unknown");
        }
      }
    }
  }
  return summary;
}

// 90 days — `api/_sweep-run.js`'s `pruneOldRuns` own posture: best-effort,
// bounded by an age cutoff alone (this table carries no per-sweep name to
// scope by, unlike `vy_sweep_run` — every row is already the platform's
// own aggregate, never one sweep's private history), never turns a sweep
// that otherwise succeeded into a failure.
export const INCIDENT_RETENTION_DAYS = 90;

export async function pruneOldIncidents(db) {
  if (typeof db !== "function") return 0;
  try {
    const rows = await db(
      `delete from vy_incident where day < (current_date - ($1)::int) returning incident_id`,
      [INCIDENT_RETENTION_DAYS],
    );
    return rows.length;
  } catch (error) {
    console.error("[incidents] pruneOldIncidents failure:", error?.message || "unknown");
    return 0;
  }
}
