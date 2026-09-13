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

export const { AuthError, bearerToken } = REAL;
// WS-R158. `api/account.js`'s handler refuses every op with `no_backend_
// configured` (500) unless BOTH are truthy — real values normally come from
// the gitignored `api/_config.js`, empty in the `write-config.mjs --stub`
// build this rehearsal (and every gate) runs under. Fixture-truthy strings,
// never read for real since `authFetch` below is a pure in-memory fake that
// never reaches a network.
export const SB_URL = "https://rehearsal-account.invalid";
export const SB_KEY = "rehearsal-anon-key";

// WS-R109 (folded from `evals/rehearsal/harness-creator.mjs`, now retired —
// see `evals/rehearsal/harness.mjs`'s own header). Kept as the exact same
// values that file used, so nothing about the creator rehearsal's own
// fixture identity changes across the fold.
export const REHEARSAL_OWNER_TOKEN = "fixture-owner-bearer-token-0000000000";
export const REHEARSAL_OWNER = "f1000000-0000-4000-8000-000000000001";

// WS-R158 (wave twenty-one). The personal journey rehearsal is the first
// caller in this repo that walks `api/account.js`'s real OTP door
// (`send_otp`/`verify_otp`) through a real signed-in AuthGate — every other
// rehearsal skips it (`creator.mjs`'s own header: "sign-in (localStorage
// seed, never a real OTP)"). `authFetch` used to be re-exported REAL here,
// unused by any existing rehearsal (confirmed by grep before this change:
// no `.mjs` under `evals/rehearsal` calls `send_otp`/`verify_otp`/`send_sms`/
// `verify_sms`), so overriding it cannot regress `follower.mjs`/`creator.mjs`.
// A real fetch to Supabase's GoTrue API is replaced with an in-memory OTP
// simulator — no fake HTTP server, no loopback port, and critically no
// second use of `process.env.SUPABASE_URL` alongside `stubs/replica-storage-
// with-fake-object.mjs`'s own hard-coded `https://rehearsal-storage.invalid`
// value for the SAME env var but a DIFFERENT purpose (Storage, not Auth) —
// two stubs racing to own one env var was the first real collision this
// workstream found; see context/rejected.md#ws-r158-supabase-url-double-
// booked-by-auth-and-storage-stubs.
export const REHEARSAL_PERSONAL_TOKEN = "fixture-personal-bearer-token-00000";
export const REHEARSAL_PERSONAL = "a9000000-0000-4000-8000-00000000a001";
const REHEARSAL_PERSONAL_EMAIL = "personal-rehearsal@example.test";
const REHEARSAL_PERSONAL_OTP = "424242";
let otpSent = false;

export async function authFetch(path, body) {
  if (path === "otp") {
    if (String(body?.email || "").trim().toLowerCase() !== REHEARSAL_PERSONAL_EMAIL) {
      return new Response(JSON.stringify({ error: "unmodelled rehearsal OTP destination" }), { status: 400 });
    }
    otpSent = true;
    return new Response(JSON.stringify({}), { status: 200 });
  }
  if (path === "verify") {
    if (!otpSent || body?.type !== "email"
      || String(body?.email || "").trim().toLowerCase() !== REHEARSAL_PERSONAL_EMAIL
      || String(body?.token || "") !== REHEARSAL_PERSONAL_OTP) {
      return new Response(JSON.stringify({ error: "Token has expired or is invalid" }), { status: 403 });
    }
    return new Response(JSON.stringify({
      access_token: REHEARSAL_PERSONAL_TOKEN,
      refresh_token: "fixture-personal-refresh-token-0000000",
      expires_in: 3600,
      user: { id: REHEARSAL_PERSONAL, email: REHEARSAL_PERSONAL_EMAIL },
    }), { status: 200 });
  }
  throw new Error(`rehearsal auth stub: unmodelled authFetch path ${path}`);
}

const KNOWN = new Map([
  [USER_A, USER_A],
  [USER_B, USER_B],
  [REHEARSAL_OWNER_TOKEN, REHEARSAL_OWNER],
  [REHEARSAL_PERSONAL_TOKEN, REHEARSAL_PERSONAL],
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
