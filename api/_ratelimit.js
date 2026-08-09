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
  if (buckets.size > 5000) buckets.clear(); // memory guard
  return true;
}

export function ipOf(req) {
  return (
    String(req.headers["x-forwarded-for"] || "")
      .split(",")[0]
      .trim() || "unknown"
  );
}
