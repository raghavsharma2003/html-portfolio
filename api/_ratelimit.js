// Minimal per-IP rate limiting (in-memory per warm lambda). Not bulletproof
// against a determined attacker, but stops casual scripts from draining the
// API budget. Underscore prefix = not deployed as a function.

const buckets = new Map();

export function allow(ip, name, perMinute) {
  const key = `${name}:${ip}`;
  const now = Date.now();
  const recent = (buckets.get(key) || []).filter((t) => now - t < 60_000);
  if (recent.length >= perMinute) {
    buckets.set(key, recent);
    return false;
  }
  recent.push(now);
  buckets.set(key, recent);
  if (buckets.size > 5000) prune(now); // memory guard — evict, never reset all
  return true;
}

// evict only stale buckets: wiping the whole map would hand an attacker a
// periodic "rate limits off" window for everyone
function prune(now) {
  for (const [key, times] of buckets) {
    if (!times.length || now - times[times.length - 1] > 60_000) buckets.delete(key);
  }
  // every bucket somehow live? drop the oldest half rather than all state
  if (buckets.size > 5000) {
    let i = 0;
    const half = buckets.size / 2;
    for (const key of buckets.keys()) {
      buckets.delete(key);
      if (++i >= half) break;
    }
  }
}

export function ipOf(req) {
  // Trust only platform-set headers. x-forwarded-for's FIRST entry is
  // client-controlled (spoofable per request = unlimited fresh buckets);
  // x-real-ip / x-vercel-forwarded-for are set by Vercel itself.
  const real =
    req.headers["x-real-ip"] ||
    req.headers["x-vercel-forwarded-for"] ||
    String(req.headers["x-forwarded-for"] || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .pop(); // last hop = the one the platform appended
  return String(real || "unknown").slice(0, 64);
}
