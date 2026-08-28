// api/_ratelimit.js's surface, always-allow.
//
// The real limiter is a per-IP per-minute counter. A fifty-question sweep from
// one process would trip it, and what it would then be measuring is the
// limiter — so it is replaced rather than worked around with sleeps. Nothing
// in the recall path reads it beyond the one gate in `handler`.
export function allow() {
  return true;
}
export function ipOf() {
  return "recallbench";
}
