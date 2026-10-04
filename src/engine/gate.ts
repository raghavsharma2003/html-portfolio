// THE DOOR, client half (server half: api/_gate.js).
//
// The page that asks for the password is only the polite half. The server is
// what refuses a request without the token, so this module's job is to carry
// the token on every API call and to notice when the server has closed the
// door on a device that used to be let in (password rotated).
//
// ONE WRAPPER, NOT FORTY CALL SITES. The app makes `fetch` calls to /api/* from
// a dozen files, plus the native engines' base-URL variants. Threading a header
// through each one is how one of them gets missed and quietly 401s in
// production, so the token is attached in a single `fetch` wrapper installed
// before React renders. The wrapper only touches requests to this app's own
// /api/ (same-origin on web, the production host from the native shell) and
// never anything third-party, so the token cannot leak to another origin.
//
// The token lives under its OWN storage key, not inside the state blob, for the
// reason deviceId does (store.ts): a corrupt or overflowing state blob must not
// lock someone out of an app they were already let into.
import { Capacitor } from "@capacitor/core";

const KEY = "meera.gate.v1";
const PROD_HOST = "meera-silk.vercel.app";
const HEADER = "X-Maya-Gate";
export const GATE_EVENT = "maya:gate";

export function getGateToken(): string {
  try {
    return localStorage.getItem(KEY) || "";
  } catch {
    return "";
  }
}

function setGateToken(t: string) {
  try {
    if (t) localStorage.setItem(KEY, t);
    else localStorage.removeItem(KEY);
  } catch {
    // storage unavailable: the gate then asks every launch, which is the safe
    // direction to fail in
  }
}

/**
 * Whether this device has EVER been let in. It does not say the token is still
 * valid; only the server knows that, and it says so with a 401 the wrapper
 * turns into GATE_EVENT.
 */
export const hasGateToken = () => getGateToken().length > 0;

const apiBase = () => (Capacitor.isNativePlatform() ? `https://${PROD_HOST}` : "");

/** Is this URL one of OUR API routes, and nobody else's? */
function isOwnApi(url: string): boolean {
  if (url.startsWith("/api/")) return true;
  try {
    const u = new URL(url, typeof location !== "undefined" ? location.href : undefined);
    const own = (typeof location !== "undefined" && u.origin === location.origin) || u.hostname === PROD_HOST;
    return own && u.pathname.startsWith("/api/");
  } catch {
    return false;
  }
}

let installed = false;

/** Call once, before anything renders. Idempotent. */
export function installGateFetch() {
  if (installed || typeof window === "undefined" || typeof window.fetch !== "function") return;
  installed = true;
  const orig = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!isOwnApi(url)) return orig(input, init);
    const token = getGateToken();
    let nextInit = init;
    let nextInput = input;
    if (token) {
      if (typeof input !== "string" && !(input instanceof URL)) {
        // A Request object: copy it with the header added rather than mutate it
        const h = new Headers(input.headers);
        h.set(HEADER, token);
        nextInput = new Request(input, { headers: h });
      } else {
        const h = new Headers(init?.headers);
        h.set(HEADER, token);
        nextInit = { ...init, headers: h };
      }
    }
    const res = await orig(nextInput, nextInit);
    if (res.status === 401 && res.headers.get(HEADER.toLowerCase()) === "required") {
      // The server closed the door: the password was rotated, or the token was
      // never valid. Forget it and let the app put the gate back up.
      setGateToken("");
      window.dispatchEvent(new Event(GATE_EVENT));
    }
    return res;
  };
}

async function post(body: object): Promise<Response> {
  return fetch(`${apiBase()}/api/account`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/**
 * Does the server want a password at all? `null` means we could not find out.
 * The caller treats that as "let the UI in": the server enforces regardless, so
 * a gate screen that failed open costs nothing, whereas one that failed closed
 * would lock someone out of an app that has no password configured.
 */
export async function fetchGateRequired(): Promise<boolean | null> {
  try {
    const r = await post({ op: "gate_status" });
    if (!r.ok) return null;
    const j = await r.json();
    return typeof j?.required === "boolean" ? j.required : null;
  } catch {
    return null;
  }
}

export type GateResult = "ok" | "wrong" | "slow" | "offline";

export async function submitGatePassword(password: string): Promise<GateResult> {
  try {
    const r = await post({ op: "gate", password });
    if (r.status === 429) return "slow";
    if (r.status === 401) return "wrong";
    if (!r.ok) return "offline";
    const j = await r.json();
    // an empty token is the server saying "there is no gate": nothing to store
    setGateToken(typeof j?.token === "string" ? j.token : "");
    return "ok";
  } catch {
    return "offline";
  }
}
