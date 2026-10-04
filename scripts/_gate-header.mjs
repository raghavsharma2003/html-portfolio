// The gate token for scripts that probe a LIVE deploy (api/_gate.js).
//
// Same derivation as the server, restated here rather than imported: the
// server module pulls in api/_config.js, which does not exist on a fresh
// checkout, and a probe script must run on one. evals/gate.mjs pins the two
// derivations together so they cannot drift apart.
//
// With no ACCESS_PASSWORD in the environment this returns no header, and a
// gated endpoint answers 401 + `X-Maya-Gate: required`. Callers treat that as
// SKIPPED, loudly, never as a pass: a check that could not run proves nothing.
import crypto from "node:crypto";

export function gateHeaders() {
  const pw = String(process.env.ACCESS_PASSWORD ?? "").trim().toLowerCase();
  if (!pw) return {};
  return { "X-Maya-Gate": crypto.createHmac("sha256", pw).update("maya-gate:v1").digest("hex") };
}

/** True when a response is the gate closing the door, not a product failure. */
export const isGated = (r) => r.status === 401 && r.headers.get("x-maya-gate") === "required";
