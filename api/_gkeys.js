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

// Namespace import, not named: GOOGLE_PAID_KEY is optional, and a named import
// of an export that does not exist is a link-time SyntaxError that would take
// the whole function down rather than degrade.
import * as CFG from "./_config.js";

// Environment first, mirroring GOOGLE_PAID_KEY below — and for one more
// reason: the eval batteries pin a FAKE pool here so the same assertions gate
// the same code on a laptop (real _config.js) and in CI (stubbed one). The
// 2026-08-24 CI red was exactly this seam missing: the resilience battery
// passed against the developer's nine real keys and failed against the stub's
// zero. Comma-separated; each entry still has to pass the length filter below.
const ENV_POOL = (process.env.GOOGLE_KEYS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const POOL = (ENV_POOL.length
  ? ENV_POOL
  : Array.isArray(CFG.GOOGLE_KEYS) && CFG.GOOGLE_KEYS.length
    ? CFG.GOOGLE_KEYS
    : [CFG.GOOGLE_KEY])
  .filter((k) => typeof k === "string" && k.length > 20)
  // a key pasted twice would otherwise be tried twice before moving on
  .filter((k, i, a) => a.indexOf(k) === i);

/**
 * A BILLED Google key, if one is configured. Optional, and everything works
 * without it — but it is the difference between 600 ms and 2 s once free quota
 * runs out, which on a real day is most of the day.
 *
 * Measured 2026-08-11: all 9 free keys returned 429 "exceeded your current
 * quota" together, and the only remaining fallback (OpenRouter) CANNOT stream —
 * chunked encoding, but the first byte lands at 1742-2267 ms with the whole
 * clip arriving ~20 ms later, i.e. it buffers the synthesis. Google direct
 * streams a first frame at 615-1051 ms. A billed key is the same fast streaming
 * path that simply never 429s.
 *
 * Read from the environment first so it can be set in the Vercel dashboard
 * without touching the gitignored config file.
 */
const PAID_KEY = [process.env.GOOGLE_PAID_KEY, CFG.GOOGLE_PAID_KEY].find(
  (k) => typeof k === "string" && k.length > 20 && !POOL.includes(k),
);

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
  // The billed key goes LAST, always, and is never cooled: free capacity is
  // still spent first, and the tier below (OpenRouter) is still there if this
  // fails too. Appending it here rather than giving it its own lane is
  // deliberate — it is the same Google streaming endpoint, so it inherits the
  // caller's streaming path, its frame parsing and its splice protection for
  // free. A separate lane would be a second audio path to keep in sync.
  if (PAID_KEY) keys.push(PAID_KEY);
  return walkKeys(keys, fn, PAID_KEY);
}

/**
 * The rotation itself, over an EXPLICIT key list.
 *
 * Split out of `withGeminiKey` so `evals/resilience/run.mjs` can gate the
 * rotation behaviour — "two keys both 502, the third answers" — against the
 * REAL walk, with three fake key strings and no secrets anywhere. Every
 * previous attempt at this in the repo would have needed either nine
 * production keys in CI or a second copy of this loop, and a second copy of a
 * loop is `age-tier-never-realtime`: the rule added after the fork lands in one
 * of them silently. There is exactly one loop, and the gate drives it.
 *
 * `paidKey` is the one member of the list that is never cooled.
 */
export async function walkKeys(keys, fn, paidKey = PAID_KEY) {
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
      if (key !== paidKey) markExhausted(key); // a billed key is never "spent"
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

/**
 * How many keys are believed usable RIGHT NOW, plus whether a billed key is
 * configured. `poolSize` is a constant, which is why the diagnostic header it
 * fed read "pool=9" while all nine keys were sitting on a 429 — a number that
 * looked like health and carried none. Per-instance, so it reflects what this
 * function has actually seen, which is the honest scope of the answer.
 */
export const poolHealth = () => {
  const now = Date.now();
  const live = POOL.filter((k) => (cooled.get(k) ?? 0) <= now).length;
  return `${live}/${POOL.length}${PAID_KEY ? "+p" : ""}`;
};
