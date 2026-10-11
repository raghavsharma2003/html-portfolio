// Shared Supabase authentication boundary.
//
// Replica endpoints accept credentials only in the Authorization header and
// derive ownership from Supabase's verified user response. A device UUID or a
// user id in JSON is never identity proof. account.js keeps its legacy body
// token calls through userFromToken while sharing the same verifier.
import { SUPABASE_URL, SUPABASE_KEY } from "./_config.js";
import { AuthError, bearerToken } from "./_auth-core.js";

export { AuthError, bearerToken } from "./_auth-core.js";

export const SB_URL = process.env.SUPABASE_URL || SUPABASE_URL;
export const SB_KEY = process.env.SUPABASE_KEY || SUPABASE_KEY;

export const authFetch = (path, body, headers = {}, fetchImpl = fetch) =>
  fetchImpl(`${SB_URL}/auth/v1/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      apikey: SB_KEY,
      "Content-Type": "application/json",
      ...headers,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

export async function userFromToken(accessToken, fetchImpl = fetch) {
  if (!SB_URL || !SB_KEY || typeof accessToken !== "string" || accessToken.length < 20) return null;
  const res = await authFetch("user", undefined, { Authorization: `Bearer ${accessToken}` }, fetchImpl);
  if (!res.ok) return null;
  const user = await res.json().catch(() => null);
  return user?.id ? user : null;
}

export async function requireUser(req, options = {}) {
  const token = bearerToken(req);
  if (!token) throw new AuthError("bearer_token_required");
  const user = await userFromToken(token, options.fetchImpl ?? fetch);
  if (!user) throw new AuthError("invalid_session");
  return user;
}
