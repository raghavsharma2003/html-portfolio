// THE DOOR. A shared-password gate in front of the endpoints that cost money or
// touch a person's memory. Underscore prefix = not deployed as a function.
//
// WHAT THIS IS, HONESTLY. It keeps casual visitors from registering and then
// spending the quota or testing her limits. It is a SHARED password, so anyone
// who is told it can pass it on; that is the design, not a hole. It is not a
// substitute for accounts.
//
// WHY THE SERVER ENFORCES. A gate that lives only in the browser is a CSS
// problem: anyone can call /api/chat directly. So the page asks for the
// password, the server turns it into a token, and the cost-bearing endpoints
// refuse any request that does not carry that token.
//
// THE TOKEN. HMAC-SHA256 keyed by the password over a fixed label. Three
// consequences, all intended:
//   - the password never rides a request after the first one, and the token
//     does not reveal it;
//   - no table, no session store, nothing to keep warm across lambdas;
//   - changing the password changes the token, so rotating the password signs
//     everyone out. That is the revoke button.
//
// OFF BY DEFAULT. With no ACCESS_PASSWORD configured the gate is open, so an
// unconfigured deploy (CI, a preview, a local run, the eval batteries that call
// handlers directly) behaves exactly as it did before this file existed. The
// cost of that choice is that a forgotten env var means no gate; the status
// endpoint reports it, and the release checklist reads it back.
//
// The config is imported DYNAMICALLY and tolerantly on purpose. A named import
// of a constant that an older generated _config.js does not export is a
// link-time SyntaxError that takes down every function importing this file, and
// a fresh checkout has no _config.js at all. Here a missing file or a missing
// member is just "not set there", and the environment variable is the real
// source anyway.
import crypto from "node:crypto";
const CFG = await import("./_config.js").catch(() => ({}));

export const GATE_HEADER = "x-maya-gate";
const LABEL = "maya-gate:v1";

// Mobile keyboards capitalise the first letter and add a trailing space; the
// password is a word, not a secret key, so both are forgiven.
const norm = (s) => String(s ?? "").trim().toLowerCase();

const password = () => norm(process.env.ACCESS_PASSWORD || CFG.ACCESS_PASSWORD || "");

export const gateEnabled = () => password().length > 0;

const sha = (s) => crypto.createHash("sha256").update(s).digest();

/** The token a correct password earns. Empty when the gate is off. */
export function gateToken() {
  const pw = password();
  if (!pw) return "";
  return crypto.createHmac("sha256", pw).update(LABEL).digest("hex");
}

/** Constant-time password check. Always true when the gate is off. */
export function passwordOk(candidate) {
  const pw = password();
  if (!pw) return true;
  return crypto.timingSafeEqual(sha(norm(candidate)), sha(pw));
}

function tokenOk(presented) {
  const want = gateToken();
  if (!want) return true;
  const got = String(presented ?? "");
  if (got.length !== want.length) return false;
  return crypto.timingSafeEqual(Buffer.from(got), Buffer.from(want));
}

/**
 * Call right after the OPTIONS short-circuit. Returns true when the request may
 * proceed; otherwise it has already answered 401 and the handler must return.
 * The 401 carries a header the client keys on, so it never has to read a body
 * to learn that the door closed.
 */
export function gateOk(req, res) {
  if (!gateEnabled()) return true;
  if (tokenOk(req.headers?.[GATE_HEADER])) return true;
  res.setHeader("X-Maya-Gate", "required");
  res.setHeader("Access-Control-Expose-Headers", "X-Maya-Gate");
  res.status(401).json({ error: "gate" });
  return false;
}
