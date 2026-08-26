// Meera's data layer: Neon Postgres over its SQL-over-HTTP endpoint.
// Zero dependencies — a parameterized query is one fetch. The connection
// string (gitignored config / env) never reaches the client.
import { NEON_URL } from "./_config.js";

const URL_ = process.env.NEON_URL || NEON_URL;
const HOST = URL_ ? URL_.split("@")[1]?.split("/")[0] : "";

/**
 * Run one parameterized SQL statement; returns rows (or [] on failure-tolerant
 * paths — callers decide). `timeoutMs` matters on latency-critical callers: a
 * slow Neon must never add ten seconds to something the user is waiting on.
 */
export async function q(query, params = [], timeoutMs = 10_000) {
  const res = await fetch(`https://${HOST}/sql`, {
    method: "POST",
    headers: {
      "Neon-Connection-String": URL_,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, params }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`neon ${res.status}${await pgDetail(res)}`);
  const data = await res.json();
  return data.rows ?? [];
}

/**
 * The Postgres `code` and `message` off a non-ok Neon response, as a suffix.
 *
 * This used to be dropped on the floor: every failure collapsed to
 * `neon 400`, and the body carrying `42883 operator does not exist: uuid =
 * text` was never read. That is a bad trade on a SQL-over-HTTP driver, because
 * a type error is indistinguishable from a wrong password, a dropped column or
 * a syntax error at the call site — the studio's first live "create replica"
 * click 500'd and the log said `neon 400` and nothing else. A whole class of
 * bug is invisible while the one line that names it is discarded.
 *
 * Deliberately message + code ONLY. Not the connection string, not the query,
 * not the bound parameters — the reason the body was dropped in the first place
 * was that it is attacker-adjacent, and the fix for that is to take the two
 * fields that name the defect rather than to take nothing.
 *
 * The `neon ${status}` PREFIX is load-bearing: evals/self/observation.mjs
 * matches /neon 4\d\d/ on the message. Suffixing keeps that true.
 */
async function pgDetail(res) {
  try {
    const body = await res.text();
    if (!body) return "";
    let code, message;
    try {
      ({ code, message } = JSON.parse(body));
    } catch {
      return "";
    }
    const parts = [code, message].filter((v) => typeof v === "string" && v);
    return parts.length ? `: ${parts.join(" ")}` : "";
  } catch {
    return ""; // a body we cannot read must never mask the status we have
  }
}
