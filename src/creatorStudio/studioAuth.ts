import type { StudioSession } from "./types";

export class StudioAuthError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export const isStudioAuthDead = (cause: unknown) =>
  cause instanceof StudioAuthError && (cause.status === 400 || cause.status === 401 || cause.status === 403);

async function accountPost(body: unknown): Promise<any> {
  const response = await fetch("/api/account", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new StudioAuthError(
      data?.error || data?.msg || data?.error_description || `Sign-in failed (${response.status})`,
      response.status,
    );
  }
  return data;
}

function toSession(data: any): StudioSession {
  const user = data?.user ?? {};
  return {
    userId: String(user.id || ""),
    email: typeof user.email === "string" ? user.email : undefined,
    phone: typeof user.phone === "string" ? user.phone : undefined,
    accessToken: String(data?.access_token || ""),
    refreshToken: String(data?.refresh_token || ""),
    expiresAt: Date.now() + (Number(data?.expires_in) || 3600) * 1000,
  };
}

export function sendEmailOtp(email: string) {
  return accountPost({ op: "send_otp", email });
}

export async function verifyEmailOtp(email: string, token: string) {
  return toSession(await accountPost({ op: "verify_otp", email, token }));
}

/* ───────────────────────────────────────────────────────────────────────────
 * PHONE, added by the Room (WS-R1) and added HERE rather than beside it.
 *
 * `api/account.js` has carried `send_sms` / `verify_sms` since it was written;
 * nothing called them, which is `dead-writers` in its mildest form. The Room
 * is the first surface whose audience signs in on a phone by default, so this
 * is where they get a caller.
 *
 * They live in this module and not in a `src/room/roomAuth.ts` because a
 * second sign-in module is a second place where a session shape, a refresh
 * rule and an error taxonomy can drift, and the two products would then
 * disagree about what being signed in means. One module, two callers.
 *
 * The phone is normalised to digits and a leading plus before it leaves, the
 * same shape `api/account.js` normalises to on arrival, so a number typed with
 * spaces is not a different rate-limit bucket than the same number typed
 * without them.
 */
const phoneDigits = (phone: string) => phone.replace(/[^\d+]/g, "");

export function sendPhoneOtp(phone: string) {
  return accountPost({ op: "send_sms", phone: phoneDigits(phone) });
}

export async function verifyPhoneOtp(phone: string, token: string) {
  return toSession(await accountPost({ op: "verify_sms", phone: phoneDigits(phone), token }));
}

/* ───────────────────────────────────────────────────────────────────────────
 * THE PRODUCT A PERSON COMES BACK TO MUST BE THE PRODUCT THEY LEFT.
 *
 * `StudioApp.readStudioMode()` reads `?mode=teacher` ONCE at mount and nowhere
 * else, and that single query parameter decides which PRODUCT is on screen:
 * the brand tag, the intro copy, the quick-start path, the teacher sheet, the
 * disclosure preview and the channels step all hang off it. Without it a
 * teacher gets the generic self-replica lab.
 *
 * Two ordinary journeys dropped it, silently, with no error and nothing on
 * screen to explain where the page they were just looking at went:
 *
 *   1. GOOGLE SIGN-IN. `googleSignIn()` sends the provider to a bare
 *      `/studio`, so the fastest way in was also the way that changed product
 *      underneath you. Email OTP never had the bug because it never leaves the
 *      page — so the failure reached only the users who took the quick path.
 *   2. COMING BACK TOMORROW. `/` redirects to `/studio?mode=teacher`, but a
 *      teacher who bookmarks the page they actually work in bookmarks
 *      `/studio`, and the mode is gone on the next visit.
 *
 * The fix is deliberately NOT "add the query to the OAuth redirect". That
 * would work only if the value survives the provider's redirect allow list,
 * which is configured outside this repo — a fix whose correctness lives in
 * someone else's dashboard is not a fix. Instead the choice is remembered
 * locally and reapplied to the URL BEFORE React mounts, so `readStudioMode()`
 * reads the same thing it would have read had the query never been lost, and
 * nothing about the sign-in round trip has to cooperate.
 *
 * Precedence, in order:
 *   - an explicit `?mode=` in the URL always wins, and is remembered
 *     (including `?mode=replica`, which is how a person deliberately returns
 *     to the generic lab and makes that stick)
 *   - no `?mode=` at all: the remembered choice is reapplied
 *   - nothing remembered: generic, exactly as today
 *
 * The URL is rewritten with `replaceState`, so the address bar tells the truth
 * about which product is on screen and the page stays copy-pasteable. Storage
 * is a convenience: every failure path here falls back to today's behaviour.
 */
const STUDIO_MODE_KEY = "vyakti.studio.mode.v1";

/**
 * Reapply the remembered studio mode to the URL. Call ONCE, before render.
 * Returns the mode string now present in the URL, for logging or tests.
 */
export function restoreStudioMode(): string {
  try {
    const params = new URLSearchParams(window.location.search);
    const explicit = params.get("mode");
    if (explicit !== null) {
      // An explicit choice is authoritative and becomes the memory. Store the
      // normalised value, never the raw one: this string is read back and put
      // into a URL, so the set of values it can hold is closed here.
      localStorage.setItem(STUDIO_MODE_KEY, explicit === "teacher" ? "teacher" : "replica");
      return explicit;
    }
    const remembered = localStorage.getItem(STUDIO_MODE_KEY);
    if (remembered !== "teacher" && remembered !== "replica") return "";
    params.set("mode", remembered);
    history.replaceState(null, "", `${window.location.pathname}?${params}${window.location.hash}`);
    return remembered;
  } catch {
    // Storage denied, or an unparseable URL. Today's behaviour, unchanged.
    return "";
  }
}

/**
 * @param returnPath where the provider sends the browser back to. Defaults to
 *   `/studio`, so every existing caller is byte-identical. The Room passes its
 *   own address, because a follower who signs in from `/r/anjali` and lands in
 *   a creator's studio has been handed somebody else's product.
 *
 *   THE DEPENDENCY, STATED RATHER THAN ASSUMED: this value must be on the
 *   Supabase project's redirect allow list, which is configured outside this
 *   repo. `/r/*` needs adding there before Google sign-in works in a Room.
 *   Until it is, the provider refuses the redirect and the follower gets
 *   Supabase's own error, not ours. Phone sign-in has no such dependency and
 *   is the reason it is offered first.
 */
export async function googleSignIn(returnPath = "/studio") {
  const path = returnPath.startsWith("/") ? returnPath : "/studio";
  const redirect = window.location.origin + path;
  const { url } = await accountPost({ op: "google_url", redirect });
  if (typeof url !== "string" || !url.startsWith("https://")) throw new Error("Google sign-in is unavailable");
  window.location.assign(url);
}

export function consumeStudioOAuthCallback(): StudioSession | null {
  if (!window.location.hash.includes("access_token=")) return null;
  const params = new URLSearchParams(window.location.hash.slice(1));
  const accessToken = params.get("access_token");
  const refreshToken = params.get("refresh_token");
  if (!accessToken || !refreshToken) return null;
  history.replaceState(null, "", window.location.pathname + window.location.search);
  return {
    userId: "",
    accessToken,
    refreshToken,
    expiresAt: Date.now() + (Number(params.get("expires_in")) || 3600) * 1000,
  };
}

export async function ensureStudioSession(session: StudioSession) {
  if (Date.now() < session.expiresAt - 120_000 && session.userId) return session;
  return toSession(await accountPost({ op: "refresh", refresh_token: session.refreshToken }));
}
