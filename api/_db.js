// Meera's data layer: Neon Postgres over its SQL-over-HTTP endpoint.
// Zero dependencies — a parameterized query is one fetch. The connection
// string (gitignored config / env) never reaches the client.
import { NEON_URL } from "./_config.js";

const URL_ = process.env.NEON_URL || NEON_URL;
const HOST = URL_ ? URL_.split("@")[1]?.split("/")[0] : "";

/** Run one parameterized SQL statement; returns rows (or [] on failure-tolerant paths — callers decide). */
export async function q(query, params = []) {
  const res = await fetch(`https://${HOST}/sql`, {
    method: "POST",
    headers: {
      "Neon-Connection-String": URL_,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, params }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`neon ${res.status}`);
  const data = await res.json();
  return data.rows ?? [];
}
