// WS-R94 (base), folded WS-R109: the auth seam. `api/room.js` imports
// `AuthError, bearerToken, userFromToken` from `./_auth.js` and calls
// `userFromToken` itself — that path already worked under the base stub.
// The FIVE creator doors this fold now also routes through the SAME server
// (`api/replica.js`, `api/context-items.js`, `api/review-queue.js`,
// `api/readiness.js`, `api/room-publish.js`) instead call `requireUser`,
// which — in the REAL `_auth.js` — calls its OWN module-scoped
// `userFromToken` by a lexical reference this stub's own exported
// `userFromToken` override can never reach (re-exporting a function does
// not change which OTHER function it calls internally, `evals/rehearsal/
// harness-creator.mjs`'s own now-retired fetch-intercept existed for
// exactly this reason). So `requireUser` is its own small reimplementation
// here, over the SAME stub `userFromToken` below, rather than a re-export
// of the real one — the real one's `userFromToken` is a `fetch()` to
// Supabase, which this harness never sets `SUPABASE_URL` for at all, so it
// would return `null` unconditionally and refuse every one of those five
// doors before `stubs/db.mjs` is ever reached
// (`context/decisions.md#ws-r109-auth-stub-reimplements-requireuser-rather-than-reexporting`).
// `AuthError`/`bearerToken` ARE re-exported unchanged: both come from
// `./_auth-core.js`, a THIRD file `../loader.mjs`'s redirect never touches,
// so they are already the exact real implementation with nothing to fake.
//
// The fixture "bearer token" IS the fixture person's own auth-user uuid for
// the follower lane (`USER_A`/`USER_B` from `evals/room/fixtures.mjs`, the
// same constants `evals/room-doors/fixtures.mjs` and every Room suite in
// this repo already share) — no separate token-to-user table to keep in
// sync. The creator lane's own fixture owner (`REHEARSAL_OWNER_TOKEN` ->
// `REHEARSAL_OWNER`, this file's own new export, folded in from the now-
// retired `evals/rehearsal/harness-creator.mjs`) works the same way, a
// second entry in the same map rather than a second mechanism. A token that
// matches none of the known entries is refused exactly as a real invalid
// session is (`null`, landing the caller in the signed-out/401 branch).
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { USER_A, USER_B } from "../../room/fixtures.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REAL_URL = pathToFileURL(join(HERE, "..", "..", "..", "api", "_auth.js")).href;
const REAL = await import(REAL_URL);

export const { AuthError, bearerToken, SB_URL, SB_KEY, authFetch } = REAL;

// WS-R109 (folded from `evals/rehearsal/harness-creator.mjs`, now retired —
// see `evals/rehearsal/harness.mjs`'s own header). Kept as the exact same
// values that file used, so nothing about the creator rehearsal's own
// fixture identity changes across the fold.
export const REHEARSAL_OWNER_TOKEN = "fixture-owner-bearer-token-0000000000";
export const REHEARSAL_OWNER = "f1000000-0000-4000-8000-000000000001";

const KNOWN = new Map([
  [USER_A, USER_A],
  [USER_B, USER_B],
  [REHEARSAL_OWNER_TOKEN, REHEARSAL_OWNER],
]);

export async function userFromToken(accessToken) {
  const id = KNOWN.get(String(accessToken));
  return id ? { id } : null;
}

export async function requireUser(req) {
  const token = bearerToken(req);
  if (!token) throw new AuthError("bearer_token_required");
  const user = await userFromToken(token);
  if (!user) throw new AuthError("invalid_session");
  return user;
}
