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
import { obsBestEffort } from "./_obs.js";
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
  .split(/[,\n\r]+/)
  .map((s) => s.trim())
  // A PASTE IS A HOSTILE FORMAT. The 2026-08-24 outage: the owner pasted the
  // env value into Vercel and entry #1 arrived malformed — Google answered
  // 400 API_KEY_INVALID, and the pool's own (correct) 400-is-deterministic
  // rule aborted all 48 keys on the strength of one bad paste, dropping every
  // production chat onto the Azure fallback and speech to 502. That rule is
  // written for a malformed REQUEST (identical on every key); a malformed
  // ENTRY is a per-key defect and must never reach the wire. So the paste is
  // sanitised here: an accidental `GOOGLE_KEYS=` prefix, wrapping quotes and
  // stray whitespace are stripped per-entry before the shape check below.
  .map((s) => s.replace(/^GOOGLE_KEYS=/i, "").replace(/^["']+|["']+$/g, "").trim())
  .filter(Boolean);

// Paste damage is defined by CHARSET, not by Google's prefixes: every real
// key (AIza…, AQ.…) and every eval fixture key is [A-Za-z0-9._-] only, so an
// entry carrying a quote, space, equals or anything else is a damaged paste
// and is dropped at parse — counted in poolHealth() as `!N` so a silent
// shrink is visible in every speech header. Prefix-based validation was
// tried first and rejected: it also killed the hermetic batteries' fake
// keys, collapsing every eval pool to zero.
const KEY_SHAPE = /^[A-Za-z0-9._-]{21,}$/;

// EACH POOL ENTRY MAY CARRY A LABEL, for RCA. Format: `label~key` (or a bare
// `key`). The label is the owner/account tag the owner supplies — "gaurav-3",
// "team@carbonsettle.world" — and it is NOT a secret: it names WHOSE key, never
// the key. When a key 429s or 503s at 11am, the trace records its label so
// "which account is the one dying at noon" is a query, not a guess. `~` is a
// safe separator: base64url keys use only [A-Za-z0-9-_.] and never contain it.
// A gitignored `label~key` mapping also lets the same env string carry the
// labels straight into Vercel with no second store to keep in sync.
// Local `_config.js` may provide the same shape via GOOGLE_KEYRING [{label,key}].
const rawEntries = ENV_POOL.length
  ? ENV_POOL.map((e) => {
      const i = e.indexOf("~");
      return i > 0 ? { label: e.slice(0, i), key: e.slice(i + 1) } : { label: null, key: e };
    })
  : Array.isArray(CFG.GOOGLE_KEYRING) && CFG.GOOGLE_KEYRING.length
    ? CFG.GOOGLE_KEYRING.map((r) => ({ label: r.label ?? null, key: r.key }))
    : (Array.isArray(CFG.GOOGLE_KEYS) && CFG.GOOGLE_KEYS.length ? CFG.GOOGLE_KEYS : [CFG.GOOGLE_KEY]).map((k) => {
        // the baked-array path parses label~key too — one entry format at
        // every seam, or the label rides into the wire as part of the "key"
        // (the 2026-08-24 400 API_KEY_INVALID outage, via write-config)
        const s = typeof k === "string" ? k : "";
        const i = s.indexOf("~");
        return i > 0 ? { label: s.slice(0, i), key: s.slice(i + 1) } : { label: null, key: s };
      });

const seen = new Set();
let DROPPED_MALFORMED = 0;
const KEYRING = rawEntries.filter((e) => {
  if (typeof e.key !== "string") return false;
  if (!KEY_SHAPE.test(e.key)) {
    // paste damage — never send it upstream, where Google's 400 would
    // (correctly, for real request errors) abort the whole pool
    DROPPED_MALFORMED++;
    return false;
  }
  if (seen.has(e.key)) return false; // a key pasted twice is tried once
  seen.add(e.key);
  return true;
});
const POOL = KEYRING.map((e) => e.key);
// key -> label, for the trace. Never the reverse: nothing maps a label back to
// its key, so a leaked label can never reconstruct a secret.
const LABEL_OF = new Map(KEYRING.map((e, i) => [e.key, e.label || `key-${i}`]));

// KEYS IN ONE BILLING FAMILY FAIL TOGETHER. Measured 2026-08-24: the
// carbonsettle org accounts (one prepay billing) went 429 "prepayment
// credits depleted" as a family, with their remaining siblings slow-walked
// past the first-frame fuse — a ~20-key sick block at the head of the ring
// that a 3-try budget could never cross. So a quota hit cools not just the
// key but every sibling sharing the label's @domain: the walk leaps a dead
// family in ONE fast attempt instead of grinding through it. Wrong grouping
// costs nothing worse than idling siblings for one COOL_MS window.
const FAMILY_OF = new Map(); // key -> domain (labels with an @), else null
for (const e of KEYRING) {
  const at = (e.label || "").indexOf("@");
  FAMILY_OF.set(e.key, at > 0 ? e.label.slice(at + 1).toLowerCase() : null);
}

/** The owner/account label for a key, for RCA in the trace. Never the key. */
export const labelFor = (key) => LABEL_OF.get(key) || "unknown";

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

function coolFamily(key, until) {
  cooled.set(key, until);
  const fam = FAMILY_OF.get(key);
  if (fam) for (const [k, f] of FAMILY_OF) if (f === fam) cooled.set(k, until);
  // WS-OBS: every cooling decision becomes a durable row — label + family +
  // how long, never the key. This is the "we know automatically when a key
  // is exhausted" stream.
  obsBestEffort("key_cooled", {
    label: labelFor(key) || null,
    family: fam || null,
    cool_ms: Math.max(0, until - Date.now()),
    pool: poolHealth(),
  });
}

export function markExhausted(key) {
  coolFamily(key, Date.now() + COOL_MS);
}

// PER-LABEL RCA COUNTERS — process-lifetime, labels only, never a key. This is
// the answer to "which account keeps dying": a running tally by owner-tag of
// how often each key hit quota or a transient. Per-instance like `cooled` (the
// same measured tradeoff — a Neon write per 429 to centralise it is not worth
// it), read via poolRca() by a diagnostics endpoint. A number, not a secret.
const rca = new Map(); // label -> { quota, transient }
function bumpRca(key, kind) {
  const label = labelFor(key);
  const row = rca.get(label) || { quota: 0, transient: 0 };
  row[kind] = (row[kind] || 0) + 1;
  rca.set(label, row);
}
/** RCA snapshot: per-owner-label quota/transient counts since this instance woke. */
export const poolRca = () => Object.fromEntries(rca);

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

// Round-robin start: a static order concentrated every request on the ring's
// first keys — so when the leading billing family's prepay hit zero on
// 2026-08-24, every fresh instance burned its whole try budget on the same
// three depleted keys and speech 502'd with 45 healthy keys behind them.
// Rotating the start spreads quota across the pool AND decorrelates failures.
export async function withGeminiKey(fn, slowBudget = MAX_TRIES) {
  // ALL healthy keys are eligible (healthyKeys already rotates its start) —
  // the walk below stops early only when the SLOW-failure budget is spent.
  // A fast 429 costs ~150ms and must never count against the tries that
  // exist to bound slow, sick upstreams: MAX_TRIES was written for a 9-key
  // pool where 3 tries usually reached a healthy key; at 48 keys a depleted
  // leading block of 3 starved the lane.
  const keys = healthyKeys();
  // The billed key goes LAST, always, and is never cooled: free capacity is
  // still spent first, and the tier below (OpenRouter) is still there if this
  // fails too. Appending it here rather than giving it its own lane is
  // deliberate — it is the same Google streaming endpoint, so it inherits the
  // caller's streaming path, its frame parsing and its splice protection for
  // free. A separate lane would be a second audio path to keep in sync.
  if (PAID_KEY) keys.push(PAID_KEY);
  return walkKeys(keys, fn, PAID_KEY, slowBudget);
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
export async function walkKeys(keys, fn, paidKey = PAID_KEY, slowBudget = MAX_TRIES) {
  let lastErr = null;
  // The try budget bounds SLOW failures only (a throw, a transient, a
  // first-frame abort — each costs real wall-clock). A quota 429 is a fast
  // ~150ms bounce and walks on without spending a try: the budget exists to
  // stop a sick upstream eating the turn, not to stop the walk finding the
  // healthy tail of a big pool behind a depleted block.
  let slowTries = 0;
  // Families this walk has already seen fail (one billing family fails
  // together — measured 2026-08-24). Walk-LOCAL on purpose: keys returned by
  // healthyKeys' everything-cooled fallback must still be walkable, so the
  // skip may only react to failures seen inside THIS walk.
  const deadFamilies = new Set();
  for (const key of keys) {
    if (slowTries >= slowBudget) break;
    const fam = FAMILY_OF.get(key);
    if (fam && deadFamilies.has(fam) && key !== paidKey) continue;
    let r;
    try {
      r = await fn(key);
    } catch (e) {
      lastErr = e?.message || "threw";
      slowTries++;
      continue; // network flake — the next key is a free retry
    }
    if (r?.ok) return { value: r.value, key, label: labelFor(key) };
    if (r?.exhausted) {
      if (fam) deadFamilies.add(fam);
      if (key !== paidKey) markExhausted(key); // a billed key is never "spent"
      bumpRca(key, "quota");
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
      if (fam) deadFamilies.add(fam);
      // A slow-walked key's billing family is almost always slow with it
      // (measured 2026-08-24: the .in trio each burned a try back to back) —
      // cool the family for the short sick window so the walk leaps it after
      // ONE slow attempt instead of spending the whole budget inside it.
      coolFamily(key, Date.now() + SICK_MS);
      bumpRca(key, "transient");
      lastErr = r.error || "transient";
      slowTries++;
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
  const bad = DROPPED_MALFORMED ? `!${DROPPED_MALFORMED}` : "";
  return `${live}/${POOL.length}${bad}${PAID_KEY ? "+p" : ""}`;
};
