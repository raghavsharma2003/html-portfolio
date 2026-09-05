// The abuse-limit predicate for the public doors (WS-R26, migration 089).
//
// api/_ratelimit.js (no dash before "limit") already sits in front of most of
// these doors, but by its own header it is "in-memory per warm lambda" - a
// cold start or a second region resets every bucket it holds, and a
// determined caller only has to arrive on a fresh instance to reset their own
// budget. This module gives the SAME shape of check ("has this caller used up
// their allowance this window") a persistent home in `vy_public_rate`, for
// the doors named in the workstream: `open`/`join` on api/room.js (before a
// follower ROW exists), `say` (a burst limit above the monthly cap), the
// push-subscribe op, api/apply.js's `submit`, the Telegram webhook and the
// payments webhook.
//
// ── the mechanism, restated from migration 089's own header ────────────────
//
// One upsert IS the check. `consume()` never reads the count and then
// decides; it writes, and the WHERE clause on the UPDATE arm of the upsert is
// the entire predicate - a caller at the limit gets ZERO ROWS BACK, not a
// count to compare. That is what makes this race-safe under concurrent
// callers hitting the same key in the same window: two requests racing for
// the last slot cannot both see "count < limit" as true, because the second
// one's UPDATE is serialized against the first one's already-committed row by
// Postgres itself.
import { createHash } from "node:crypto";

// ── limits, named per scope, in one place ───────────────────────────────────
//
// Every number below has a reason. Three (`room_tg_ip`, `payments_webhook_ip`,
// close to `apply_submit_ip`) intentionally mirror the numbers already chosen
// for api/_ratelimit.js's in-memory limiter at the same door - this module is
// a second, persistent LAYER over the same judgment call, not a fresh opinion
// about what the right number is. The rest are new doors this workstream is
// the first to guard.
export const DEFAULT_LIMITS = {
  // `open` is the op a bio link points at - wholly anonymous, and the door
  // most likely to be hit by a slug-guessing script. Generous enough that a
  // real visitor refreshing a flaky connection never notices; 40/min.
  room_open_ip: { limit: 40, windowMs: 60_000 },
  // `join` is the moment a follower ROW gets created (a person + a follower
  // write). api/room.js's existing `room_join_user` (in-memory, 10/min) is
  // per AUTHENTICATED user; this is per IP, so it also bounds how many
  // follower rows one connection can mint by rotating accounts.
  room_join_ip: { limit: 15, windowMs: 60_000 },
  // `say` already has a real ceiling - the monthly free/paid cap
  // (api/_room-surface.js's own predicate UPDATE, migration 077). This is a
  // BURST limit above it: nothing stops a follower who is nowhere near their
  // monthly count from firing turns faster than a human reads a reply. The
  // workstream brief's own number.
  room_say_follower: { limit: 30, windowMs: 60_000 },
  // Subscribing a push endpoint is cheap to call and not cheap to abuse (a
  // flood of subscribe/unsubscribe churns migration 085's own table). A
  // follower toggling a real switch never approaches 10/min.
  room_push_follower: { limit: 10, windowMs: 60_000 },
  // api/apply.js's existing in-memory `apply_ip` is 10/min; migration 086's
  // own daily-per-contact unique index is the REAL ceiling on volume. This
  // layer is the same order of magnitude, restated so a cold start cannot
  // reset it: 8/min.
  apply_submit_ip: { limit: 8, windowMs: 60_000 },
  // Mirrors api/room-tg.js's existing in-memory `room_tg` limit exactly
  // (120/min) - Telegram's own retry policy on a non-2xx makes this safe to
  // restate rather than tighten.
  room_tg_ip: { limit: 120, windowMs: 60_000 },
  // WS-R29. Meta's own webhook, the identical class of caller and the
  // identical retry-on-non-2xx safety `room_tg_ip` already relies on -
  // restated under its own name rather than borrowed, so a future change to
  // one door's limit cannot silently retune the other's.
  room_wa_ip: { limit: 120, windowMs: 60_000 },
  // Mirrors api/payments-webhook.js's existing in-memory `payments_webhook`
  // limit exactly (240/min) - the provider's own delivery IPs, not a person,
  // and a throttled webhook is retried later per the provider's own policy.
  payments_webhook_ip: { limit: 240, windowMs: 60_000 },
  // ── WS-R32: the OTP doors (api/account.js's send_sms/verify_sms - the
  // sign-in the Room uses), closing ws-r26-otp-doors-not-behind-vy-
  // public-rate. api/_ratelimit.js's in-memory `otp_dest` throttle stays IN
  // FRONT of these as a fast first layer with no database round trip, and it
  // is exactly why it is not enough ALONE: it is per WARM LAMBDA INSTANCE, so
  // it resets on every cold start and is invisible to every other instance or
  // region a determined caller can land on next. These four scopes are the
  // persistent second layer that survives both.
  //
  // send_sms, by destination: the in-memory layer already catches a burst
  // (3/min, api/account.js's own comment); this is the ceiling that survives
  // a cold start - the ceiling a slow, distributed attacker who paces
  // requests specifically to dodge the per-minute bucket cannot get under.
  otp_send_dest: { limit: 10, windowMs: 60 * 60_000 },
  // send_sms, by IP: one connection has no legitimate reason to request OTP
  // codes for more different phone numbers than this in an hour.
  otp_send_ip: { limit: 30, windowMs: 60 * 60_000 },
  // verify_sms, by destination: THE real defence against brute-forcing a
  // 6-digit code (1,000,000 possible values) - api/account.js's verify_sms
  // has NO existing in-memory throttle at all today, so this is the WHOLE
  // story for this scope, not a second layer over one. At 10 guesses a
  // minute, exhausting even the low end of that space takes on the order of
  // 100,000 minutes (about 69 days) against ONE destination, and every fresh
  // code Supabase issues supersedes the one before it, so a slow attacker's
  // partial coverage of an old code buys nothing against the next one.
  otp_verify_dest: { limit: 10, windowMs: 60_000 },
  // verify_sms, by IP: the per-destination ceiling above is the real
  // brute-force floor; this bounds how many DIFFERENT destinations one
  // connection can probe verification codes for in an hour - same order of
  // magnitude as the send-side IP ceiling, for the same reason.
  otp_verify_ip: { limit: 30, windowMs: 60 * 60_000 },
  // WS-R53: the taste - three questions a stranger may ask a creator's AI
  // before the sign-in wall, enforced WITHOUT a person (`api/_room-taste.js`).
  // Keyed by (room slug, caller IP), never a person or device id - there is
  // no follower row yet for a taste turn to belong to, by construction
  // (`context/decisions.md#ws-r53-taste-is-stateless-across-turns`). One day,
  // not one minute: the product number is "three a day", not "three a
  // burst", so the window is the workstream brief's own unit rather than
  // this file's usual per-minute shape - `room_say_follower`'s burst limit is
  // a DIFFERENT ceiling (above an already-metered monthly cap) and this is
  // the WHOLE story for a stranger, not a second layer over one.
  room_taste: { limit: 3, windowMs: 24 * 60 * 60_000 },
  // WS-R67. "At most 20 a day" (the workstream brief's own number), keyed on
  // the follower's own `follower_id` - the SAME scope `room_flag_follower`
  // the brief names by name. A day rather than a minute: flagging is a
  // deliberate, occasional act, not a chat burst, so the window this file's
  // other follower-keyed scopes use (60s) would be the wrong shape entirely.
  // The real per-reply ceiling is the unique index on
  // (follower_id, reply_sha256) in migration 116 - this is the SEPARATE
  // volume ceiling across DIFFERENT replies in one day, `room_say_follower`'s
  // own "a burst limit above a real cap" restated for a count of flags
  // instead of a count of messages.
  room_flag_follower: { limit: 20, windowMs: 24 * 60 * 60_000 },
  // WS-R70. The creator's own export (api/replica.js's `export` op, over
  // api/_creator-export.js) walks dozens of owner-lane tables per call — one
  // a day per owner is the workstream brief's own number, generous for a
  // real request ("I am leaving, give me my data") and firm against a
  // stolen bearer token turning this door into a database-wide scrape
  // engine. Keyed on the owner's own id, never an IP: the export always
  // returns the CALLER's own data (api/_creator-export.js's own header), so
  // the abuse shape this bounds is one account hammering its OWN export,
  // never a cross-account concern the way `room_open_ip` guards against.
  creator_export_owner: { limit: 1, windowMs: 24 * 60 * 60_000 },
  // WS-R89 (the second door battery, class d): a Telegram redelivery of the
  // SAME `update_id` — real, correctly-signed, Telegram's OWN retry policy
  // on a slow or non-2xx response, never a third party (the shared secret
  // already refuses anyone else) — would otherwise double-spend a
  // follower's monthly cap and send a second reply
  // (`handleOrdinaryMessage` -> `roomSay`, metered exactly as the web door
  // is). Keyed on `update_id` with limit 1: the FIRST delivery consumes the
  // slot, every later one this window is a no-op. THIS IS A BOUNDED
  // MITIGATION, NOT A PERMANENT LEDGER — `purgeStalePublicRateWindows`'s own
  // default retention is 24 hours regardless of a scope's own `windowMs`
  // (`api/_checkins.js`'s sweep calls it with no override), so the window
  // below is set well under that ceiling rather than claiming a longer one
  // the retention sweep would silently undercut —
  // `context/decisions.md#ws-r89-telegram-update-dedup-is-a-bounded-window-
  // not-a-permanent-ledger` states the honest limit and what would close it
  // for good (a real per-update_id table, which needs a migration this
  // workstream does not have).
  room_tg_update_seen: { limit: 1, windowMs: 3 * 60 * 60_000 },
};

/**
 * `DEFAULT_LIMITS`, merged with an operator's `RATE_LIMITS_JSON` override
 * (`{"scope": {"limit": N, "windowMs": N}}`, either field optional). A
 * malformed or partial override never throws - it is read once per call,
 * off `env`, so a bad value degrades to "use the default" rather than taking
 * every public door down with it.
 */
export function limitsFor(env = process.env) {
  let overrides = {};
  const raw = String(env.RATE_LIMITS_JSON || "").trim();
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) overrides = parsed;
    } catch {
      // A syntax error in an operator's override must never turn "the doors
      // are guarded" into "every request 500s" - fall back to the defaults.
    }
  }
  const merged = {};
  for (const [scope, config] of Object.entries(DEFAULT_LIMITS)) {
    const over = overrides[scope] && typeof overrides[scope] === "object" ? overrides[scope] : {};
    const limit = Number.isInteger(over.limit) && over.limit > 0 ? over.limit : config.limit;
    const windowMs = Number.isInteger(over.windowMs) && over.windowMs > 0 ? over.windowMs : config.windowMs;
    merged[scope] = { limit, windowMs };
  }
  return merged;
}

// UNSET STILL WORKS - a fixed per-deploy constant, never a thrown "no salt
// configured" at a follower's request. A real deploy sets `RATE_SALT` so the
// salt cannot be guessed from this source file; the fallback exists only so a
// database with no env configured yet still enforces limits, just without the
// extra guarantee an unguessable salt buys against a targeted collision.
const FALLBACK_SALT = "vy-public-rate-fallback-salt-089";

function daySalt(env) {
  const configured = String(env.RATE_SALT || "").trim();
  return configured || FALLBACK_SALT;
}

// UTC day, matching migration 086's own `dayKeyOf` convention (api/_room-
// surface.js) - a plain calendar day, not a rolling 24h window, so the salt
// (and therefore every hash) rotates once a day rather than continuously.
function dayKeyOf(now) {
  return new Date(now).toISOString().slice(0, 10);
}

/**
 * sha256 of (scope, the caller's own key, the day's salt, the day itself),
 * hex-encoded. NEVER the raw key: this is the one property
 * evals/rate-limit/run.mjs's negative control (c) exists to prove, alongside
 * "two different IPs never share a counter under the same salt".
 */
export function hashKey(scope, key, { env = process.env, now = Date.now() } = {}) {
  return createHash("sha256")
    .update(`${scope} ${String(key)} ${daySalt(env)} ${dayKeyOf(now)}`)
    .digest("hex");
}

// The start of the fixed window containing `now`, as an ISO string ready for
// an `::timestamptz` bind - never a sliding "now() minus N seconds" window,
// so the table stays bounded (migration 089's own reasoning) and every
// caller in the same window shares exactly one row.
function windowStartOf(now, windowMs) {
  return new Date(Math.floor(now / windowMs) * windowMs).toISOString();
}

/**
 * The one door every public-facing handler calls through.
 *
 *   const gate = await consume(db, { scope: "room_open_ip", key: ipOf(req) });
 *   if (!gate.ok) return res.status(429)
 *     .setHeader("Retry-After", String(gate.retryAfterSeconds))
 *     .json({ error: gate.code, retry_after_seconds: gate.retryAfterSeconds });
 *
 * Returns `{ ok, remaining, retryAfterSeconds, code }`. `code` is only ever
 * meaningful when `ok` is false: `"rate_limit_unknown_scope"` for a scope this
 * module has no configured limit for (FAIL CLOSED - a misnamed door gets NO
 * allowance, never an implicit unlimited one), `"rate_limited"` otherwise.
 *
 * The whole check is ONE write (see this file's header) - never a read then
 * a separate write, which is the race a naive rate limiter has.
 */
export async function consume(db, { scope, key, now = Date.now(), env = process.env } = {}) {
  if (typeof db !== "function") throw new Error("consume: db required");
  const limits = limitsFor(env);
  const config = limits[scope];
  if (!config) {
    // Fails closed and LOUDLY named, exactly as the workstream requires -
    // evals/rate-limit/run.mjs's negative control (a) asserts this branch,
    // never a thrown error that would turn a misnamed scope into a 500
    // instead of an honest, if maximally strict, refusal.
    return { ok: false, remaining: 0, retryAfterSeconds: 60, code: "rate_limit_unknown_scope" };
  }
  const { limit, windowMs } = config;
  const start = windowStartOf(now, windowMs);
  const keyHash = hashKey(scope, key, { env, now });
  const rows = await db(
    `insert into vy_public_rate (scope, key_hash, window_start, count, updated_at)
     values ($1, $2, $3::timestamptz, 1, now())
     on conflict (scope, key_hash, window_start) do update
        set count = vy_public_rate.count + 1, updated_at = now()
      where vy_public_rate.count < $4
     returning count`,
    [scope, keyHash, start, limit],
  );
  const windowEndMs = Math.floor(now / windowMs) * windowMs + windowMs;
  const retryAfterSeconds = Math.max(1, Math.ceil((windowEndMs - now) / 1000));
  if (!rows[0]) {
    return { ok: false, remaining: 0, retryAfterSeconds, code: "rate_limited" };
  }
  const used = Number(rows[0].count || 0);
  return { ok: true, remaining: Math.max(0, limit - used), retryAfterSeconds };
}

/**
 * The retention half of migration 089's own header: delete every window row
 * older than `olderThanMs` (default one day - generous headroom over this
 * module's longest window, one hour). Run inside whichever sweep is
 * cheapest (api/checkins-sweep.js, the 15-minute cron, through
 * `withSweepRun`'s own heartbeat - api/_sweep-run.js) so the table stays
 * bounded without a dedicated cron of its own. Best-effort by the CALLER's
 * choice, not this function's: a purge failure returns a rejected promise
 * like any other query, and api/_checkins.js's own `sweep()` is what decides
 * to catch it rather than fail the whole sweep over housekeeping.
 */
export async function purgeStalePublicRateWindows(db, now = Date.now(), { olderThanMs = 24 * 60 * 60 * 1000 } = {}) {
  if (typeof db !== "function") throw new Error("purgeStalePublicRateWindows: db required");
  const cutoff = new Date(now - olderThanMs).toISOString();
  const rows = await db(`delete from vy_public_rate where window_start < $1::timestamptz returning scope`, [cutoff]);
  return rows.length;
}
