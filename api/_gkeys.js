// Free-tier Google key pool.
//
// The owner supplies a growing set of AI Studio keys, each with its own free
// quota. The rule is simple: exhaust free capacity before spending money, and
// never let one key's quota being gone look like the product being broken.
//
// WHAT EACH TIER CAN ACTUALLY SERVE — measured across all 7 keys, not assumed:
//
//   chat / vision   200  ✓  free tier serves it
//   TTS             200  ✓  audio/L16 pcm 24kHz
//   live tokens     200  ✓
//   search grounding 429  ✗  every key, every time — this is a hard free-tier
//                            limit, so search stays on OpenRouter permanently.
//
// That last row is why this file is a helper and not a global switch: the lanes
// the free tier cannot serve must go straight to the paid provider rather than
// burning a retry against every key first.
//
// STATE IS PER-INSTANCE AND THAT IS FINE. Vercel functions are ephemeral, so a
// cooled key is only remembered by the instance that saw the 429. A cold
// instance may spend one wasted call rediscovering it, which costs a few
// hundred milliseconds once, against a Neon round-trip on EVERY call to share
// the state. The cheap failure is the right one here.

import { GOOGLE_KEY, GOOGLE_KEYS } from "./_config.js";

const POOL = (Array.isArray(GOOGLE_KEYS) && GOOGLE_KEYS.length ? GOOGLE_KEYS : [GOOGLE_KEY])
  .filter((k) => typeof k === "string" && k.length > 20)
  // a key pasted twice would otherwise be tried twice before moving on
  .filter((k, i, a) => a.indexOf(k) === i);

// Free-tier quotas are mostly per-minute, so a key that 429s is usually fine
// again shortly. Five minutes is long enough to stop hammering it and short
// enough that a key never sits idle for a whole conversation.
const COOL_MS = 5 * 60_000;
const cooled = new Map(); // key -> epoch ms when it may be tried again

let cursor = 0; // round-robin start, so key #1 is not the only one that ever runs

/** Keys worth trying right now, healthiest-first, rotated. */
export function healthyKeys() {
  const now = Date.now();
  const live = POOL.filter((k) => (cooled.get(k) ?? 0) <= now);
  // Everything is cooled: rather than fail, try them all again — a stale
  // cooldown must never be the reason she goes silent.
  const ring = live.length ? live : POOL;
  const start = cursor++ % ring.length;
  return [...ring.slice(start), ...ring.slice(0, start)];
}

export function markExhausted(key) {
  cooled.set(key, Date.now() + COOL_MS);
}

/**
 * Run `fn(key)` against each healthy key until one succeeds.
 *
 * `fn` must return `{ ok: true, value }` on success, or `{ ok: false, exhausted }`
 * where `exhausted` marks the key as out of quota rather than the request being
 * bad. A 400 is our fault and will fail identically on every key — retrying it
 * seven times just makes the user wait seven times longer for the same error.
 *
 * Returns `{ value }` on success or `{ error, triedAll: true }` when the whole
 * pool is spent, which is the caller's cue to fall back to the paid provider.
 */
// How many keys one request may burn before giving up on free capacity.
//
// The pool will keep growing, and "try them all" does not scale: a request that
// walks eight exhausted keys pays eight round trips before it even starts the
// paid call, and the user feels every one of them as dead air. Two is enough to
// ride out a single key hitting its per-minute cap — which is the common case —
// while capping the worst case at roughly one extra second before falling back.
// Quality and speed are never traded for saving money; this is the line that
// keeps that true as the pool grows.
// Raised from 2 after measuring the pool directly: of 9 keys, 6 answered in
// 615-1051ms and THREE were unhealthy (one 429, two 503). At 2 tries the chance
// of drawing two duds is ~8%, and — before the retry fix below — a single dud
// killed the free lane outright. The reason 2 was safe-looking, "each extra try
// costs a round trip of dead air", is answered by FREE_FIRST_FRAME_MS in
// speech.js: an attempt is now bounded, so a try costs at most that, not the
// 6518ms one 503 actually took.
const MAX_TRIES = 3;

// A key that just 5xx'd is sick, not spent. Cooling it for the full quota
// window would take a healthy key out of the pool for five minutes over a blip;
// not cooling it at all invites picking it again on the next request.
const SICK_MS = 30_000;

export async function withGeminiKey(fn) {
  const keys = healthyKeys().slice(0, MAX_TRIES);
  let lastErr = null;
  for (const key of keys) {
    let r;
    try {
      r = await fn(key);
    } catch (e) {
      lastErr = e?.message || "threw";
      continue; // network flake — the next key is a free retry
    }
    if (r?.ok) return { value: r.value, key };
    if (r?.exhausted) {
      markExhausted(key);
      lastErr = "quota";
      continue;
    }
    // UPSTREAM IS SICK, NOT SPENT — try another key. This case used to fall
    // into the "stop here" below, and it is why the free lane was losing:
    // measured against the live pool, 2 of 9 keys were returning 503, and one
    // 503 ended the whole free attempt even though six other keys were
    // answering in under a second. 9 of 12 production requests were being
    // served by the slower paid lane as a result.
    if (r?.retry) {
      cooled.set(key, Date.now() + SICK_MS);
      lastErr = r.error || "transient";
      continue;
    }
    // A genuine request error (a 400 is our fault) fails identically on every
    // key — retrying it just makes the user wait longer for the same error.
    return { error: r?.error || "request rejected", triedAll: false };
  }
  return { error: lastErr || "no keys", triedAll: true };
}

/** True when an upstream status means "this key is out", not "this request is bad". */
export const isQuota = (status) => status === 429 || status === 403;

/**
 * The key is fine, the server is having a moment. Measured on the live pool:
 * two of nine keys were returning 503 while six others answered in under a
 * second, so this must move to the NEXT key rather than end the free lane.
 * Distinct from `isQuota` because it must not cool the key for the full quota
 * window — see SICK_MS.
 */
export const isTransient = (status) =>
  status === 500 || status === 502 || status === 503 || status === 504 || status === 408;

export const poolSize = () => POOL.length;
