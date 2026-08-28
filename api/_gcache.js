// ── WS-COST Phase C: explicit Google `cachedContents` over the byte-stable core
//
// WHY THIS FILE EXISTS. `context/measurements.md#cache-plateau` measured the
// whole cost surface of the billed Google lane on 2026-08-25:
//
//   - the client already splits the prompt: the byte-stable persona CORE rides
//     as `system` (48,730 B ≈ 12,097 tokens ≈ 90.0% of input) and the volatile
//     part as `system_tail`. Same-session consecutive turns are byte-identical
//     through the entire core; cross-user prompts diverge at byte 68 (the name).
//   - IMPLICIT caching is automatic, needs no request field, and PLATEAUS at
//     8,165 of ~13,400 tokens (60.7%) on every hit — worth −45.7% EV and no
//     more. `cache_control{ephemeral}` does nothing here at all (n=4, measured
//     NO-OP — see rejected.md#cache-control-on-google).
//   - EXPLICIT cachedContents over the core alone hit 12,097 tokens 4/4,
//     deterministically, no plateau: −79.2% per turn including storage.
//
// So the deterministic path is this one, and it is only reachable on Google's
// NATIVE surface — `cachedContents` does not exist on the OpenAI-compatible
// endpoint the free and paid lanes already speak. This module owns the cache
// objects; `api/_gnative.js` owns the request/response bridge; `api/chat.js`
// wires them into the paid lane and NOWHERE else.
//
// THE CACHE KEY IS THE BYTES. SHA-256 of the exact core string as sent (after
// the SYSTEM_MAX slice), scoped by model. Per-user and per-persona separation
// is then free rather than assumed: two users diverge at byte 68, so they
// cannot collide, and a persona edit changes every byte after it, so a stale
// personality cannot be served from a cache that outlives its own text.
//
// THE MAP IS AN OPTIMISATION, NEVER A SOURCE OF TRUTH. A serverless instance
// is ephemeral: it can be cold on any turn, and there can be many at once. So
// a miss creates a duplicate cachedContent for bytes that are already cached
// somewhere else — wasted storage, bounded by TTL, and cheaper than either a
// shared store on the reply path or a turn that fails. Symmetrically, a NAME
// THAT NO LONGER EXISTS (expired between two turns, or created by an instance
// that has since died) must never cost a turn: the caller drops it and
// re-creates, and if that fails too it falls back to the plain paid call.
//
// TTL ARITHMETIC, because "cheap" is not a number. Storage is $0.50 per 1M
// tokens per hour. At 12,097 tokens that is 12,097/1e6 × $0.50 = $0.006048 per
// HOUR, i.e. $0.001008 for a 10-minute TTL — against ~$0.0101 for one uncached
// turn, so one cache pays for itself on its first reuse. The reason the TTL is
// short anyway is not the per-cache price, it is the FLEET: every orphaned
// cache bills for its full remaining life whether or not any turn ever reads
// it, and nothing else in this system deletes them. TTL is the garbage
// collector. 10 minutes to create, extended only by a turn that actually
// reuses it, never above CACHE_TTL_MAX_MS (15 min).
import { createHash } from "node:crypto";

const BASE = "https://generativelanguage.googleapis.com/v1beta";

/** Created with this, and extended by this on reuse. */
export const CACHE_TTL_S = 600;
const CACHE_TTL_MS = CACHE_TTL_S * 1000;
/** A hard ceiling on any expiry this module will believe or ask for. */
export const CACHE_TTL_MAX_MS = 15 * 60 * 1000;
/** At most one PATCH per cache per minute — a refresh on every turn of a busy
 *  session is a request per turn that buys nothing over the one before it. */
const REFRESH_MIN_GAP_MS = 60_000;
/** Below this, a cache is not worth an object: Google enforces its own minimum
 *  token count for cachedContents, and a small prompt saves nothing anyway.
 *  ~8 KB is far under the real core (48.7 KB) and far over any test stub. */
const MIN_CORE_BYTES = 8_000;
/** The map is per-instance and bounded; expiry does the rest. */
const MAX_ENTRIES = 64;
/** Creating a cache sits IN FRONT of the reply. It gets its own short leash —
 *  a slow create must degrade to an uncached paid turn, not to a slow turn. */
const CREATE_TIMEOUT_MS = 12_000;

/** `${model}:${sha256(core)}` → { name, expiresAt, tokens, patchedAt } */
const entries = new Map();
/** Same key → in-flight create, so two concurrent turns on one instance make
 *  one cache rather than two. (Two INSTANCES still make two; see the header.) */
const inflight = new Map();

/** SHA-256 of the exact core bytes. The key, and the only identity that matters. */
export function coreHash(core) {
  return createHash("sha256").update(String(core), "utf8").digest("hex");
}

export function cacheKey(model, hash) {
  return `${model}:${hash}`;
}

/** Is this core big enough to be worth a cache object at all? */
export function cacheableCore(core) {
  return typeof core === "string" && core.length >= MIN_CORE_BYTES;
}

function liveEntry(k, now = Date.now()) {
  const e = entries.get(k);
  if (!e) return null;
  // 5s of slack: a name that expires while the generate call is in flight is a
  // not-found we would then have to recover from, for no gain.
  if (!(e.expiresAt > now + 5_000)) {
    entries.delete(k);
    return null;
  }
  return e;
}

function remember(k, e) {
  entries.set(k, e);
  if (entries.size <= MAX_ENTRIES) return;
  const now = Date.now();
  for (const [kk, ee] of entries) if (ee.expiresAt <= now) entries.delete(kk);
  // insertion order = oldest first
  while (entries.size > MAX_ENTRIES) entries.delete(entries.keys().next().value);
}

/** Forget a name. Called when Google says it does not exist. */
export function dropCache(model, hash) {
  entries.delete(cacheKey(model, hash));
}

/** Test seam: the battery drives this module directly and must start clean. */
export function resetCacheStore() {
  entries.clear();
  inflight.clear();
}

export function cacheStoreSize() {
  return entries.size;
}

/** The short id, never the object. `cachedContents/abc123` → `abc123`.
 *  docs/TELEMETRY.md's law is counts-and-labels: the id names WHICH cache, and
 *  carries none of the text inside it. */
export function cacheId(name) {
  return String(name || "").split("/").pop() || null;
}

function expiryFrom(json, now = Date.now()) {
  const parsed = Date.parse(json?.expireTime || "");
  const at = Number.isFinite(parsed) ? parsed : now + CACHE_TTL_MS;
  return Math.min(at, now + CACHE_TTL_MAX_MS);
}

/** Google's answer when a name is gone (expired, or made by a dead instance).
 *  403 and 404 are both observed for this; a 400 that names the field is the
 *  third shape. Anything else is a real error and is NOT retried as a miss. */
export function isCacheMissStatus(status, bodyText = "") {
  const s = Number(status) || 0;
  if (s === 403 || s === 404) return true;
  return s === 400 && /cachedcontent|cached_content/i.test(String(bodyText));
}

/** Create the cache object for these exact bytes. Returns null on ANY failure —
 *  a caching outage costs an uncached turn, never a turn. */
async function createCache({ key, model, core, signal }) {
  const timer = AbortSignal.timeout ? AbortSignal.timeout(CREATE_TIMEOUT_MS) : null;
  const sig = timer && signal && AbortSignal.any ? AbortSignal.any([signal, timer]) : (timer ?? signal);
  const r = await fetch(`${BASE}/cachedContents`, {
    method: "POST",
    // The key rides a HEADER, not the query string, so it cannot land in a URL
    // that some log, trace or test harness records by default.
    headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: `models/${model}`,
      // The core is the SYSTEM half and goes in as systemInstruction, which is
      // exactly where the compat lane puts it. The volatile tail deliberately
      // stays OUT: it changes every turn (measured: every first-diff is inside
      // the RIGHT NOW block, 106/106), so caching it would rebuild the object
      // every turn and cache 99.9% of a prompt that is never reused.
      systemInstruction: { parts: [{ text: core }] },
      ttl: `${CACHE_TTL_S}s`,
    }),
    signal: sig ?? undefined,
  });
  if (!r.ok) return null;
  const j = await r.json();
  const name = typeof j?.name === "string" && j.name ? j.name : null;
  if (!name) return null;
  const tokens = Number(j?.usageMetadata?.totalTokenCount);
  return {
    name,
    expiresAt: expiryFrom(j),
    tokens: Number.isFinite(tokens) ? tokens : null,
    // 0 = never refreshed, so the FIRST turn that reuses this cache extends it
    // and the throttle below only suppresses the ones after that. A creation
    // timestamp here would mean a session's first follow-up — the turn that
    // proves the cache is worth keeping — is the one refresh that never fires.
    patchedAt: 0,
  };
}

/** The cache for these bytes: the one this instance already knows about, or a
 *  fresh one. `{ name, tokens, reused }`, or null if it could not be had. */
export async function getCache({ key, model, core, hash, signal }) {
  if (!key || !model || !cacheableCore(core)) return null;
  const h = hash || coreHash(core);
  const k = cacheKey(model, h);
  const hit = liveEntry(k);
  if (hit) return { name: hit.name, tokens: hit.tokens, reused: true };

  const pending = inflight.get(k);
  if (pending) {
    const e = await pending;
    return e ? { name: e.name, tokens: e.tokens, reused: true } : null;
  }
  const p = (async () => {
    try {
      const e = await createCache({ key, model, core, signal });
      if (e) remember(k, e);
      return e;
    } catch {
      return null;
    } finally {
      inflight.delete(k);
    }
  })();
  inflight.set(k, p);
  const e = await p;
  return e ? { name: e.name, tokens: e.tokens, reused: false } : null;
}

/** Extend the TTL of a cache a turn is ACTUALLY reusing.
 *
 *  Deliberately fire-and-forget and deliberately issued BEFORE the generate
 *  call rather than after it: a floating promise started after the response
 *  goes out can be frozen by the platform mid-flight (api/telemetry.js's
 *  measured lesson), while one started before a multi-second generate resolves
 *  inside it for free. The failure mode if it is lost anyway is the cheapest
 *  one available: the cache expires on schedule and the next turn re-creates.
 *
 *  Returns a promise for the battery to await; production must not. */
export function refreshCache({ key, model, hash, name, signal }) {
  const k = cacheKey(model, hash);
  const e = entries.get(k);
  const now = Date.now();
  if (e && now - e.patchedAt < REFRESH_MIN_GAP_MS) return Promise.resolve(false);
  if (e) {
    e.patchedAt = now;
    // Optimistic, and clamped: believing our own PATCH is what keeps a busy
    // session from re-reading the same expiry a hundred times. If the PATCH
    // actually failed, the generate call answers not-found and the caller
    // re-creates — the ladder below this is the one that decides.
    e.expiresAt = Math.min(now + CACHE_TTL_MS, now + CACHE_TTL_MAX_MS);
  }
  return fetch(`${BASE}/${name}?updateMask=ttl`, {
    method: "PATCH",
    headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
    body: JSON.stringify({ ttl: `${CACHE_TTL_S}s` }),
    signal: signal ?? undefined,
  })
    .then((r) => Boolean(r?.ok))
    .catch(() => false);
}
