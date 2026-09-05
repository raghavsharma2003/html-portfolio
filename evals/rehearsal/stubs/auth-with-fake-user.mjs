// WS-R94. The auth seam. `api/room.js` imports `AuthError, bearerToken,
// userFromToken` from `./_auth.js`; the real `userFromToken` is a `fetch()`
// to Supabase (`api/_auth.js`), which the stub config's empty
// `SUPABASE_URL`/`SUPABASE_KEY` would make return `null` unconditionally
// even if network were allowed — so `join`/`export`/`forget` (every op
// requiring `requiredUser`) would be unreachable through the real handler
// without this seam, offline or on. `../loader.mjs` redirects every relative
// `./_auth.js` import here; the real file is loaded by an absolute
// `file://` URL for the same self-redirection reason
// `surface-with-fake-model.mjs`'s header explains.
//
// The fixture "bearer token" IS the fixture person's own auth-user uuid
// (`USER_A`/`USER_B` from `evals/room/fixtures.mjs`, the same constants
// `evals/room-doors/fixtures.mjs` and every Room suite in this repo already
// share) — no separate token-to-user table to keep in sync, and a token
// that is not one of the two known uuids is refused exactly as a real
// invalid session is (`null`, landing the caller in the signed-out branch).
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { USER_A, USER_B } from "../../room/fixtures.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REAL_URL = pathToFileURL(join(HERE, "..", "..", "..", "api", "_auth.js")).href;
const REAL = await import(REAL_URL);

export const { AuthError, bearerToken, SB_URL, SB_KEY, authFetch, requireUser } = REAL;

const KNOWN = new Set([USER_A, USER_B]);

export async function userFromToken(accessToken) {
  return KNOWN.has(String(accessToken)) ? { id: String(accessToken) } : null;
}
