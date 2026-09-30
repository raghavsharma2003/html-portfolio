import type { StudioSession } from "./types";
import { consumeStudioOAuthCallback, ensureStudioSession } from "./studioAuth";

const STATE_KEY = "meera.state.v1";

function isSession(value: unknown): value is StudioSession {
  if (!value || typeof value !== "object") return false;
  const session = value as Partial<StudioSession>;
  return (
    typeof session.accessToken === "string" &&
    session.accessToken.length >= 20 &&
    typeof session.refreshToken === "string" &&
    typeof session.expiresAt === "number"
  );
}

function storedState(): Record<string, unknown> {
  try {
    const value = JSON.parse(localStorage.getItem(STATE_KEY) || "{}");
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

export function readStoredSession(): StudioSession | null {
  const auth = storedState().auth;
  return isSession(auth) ? auth : null;
}

export function writeStoredSession(session: StudioSession | null) {
  try {
    const state = storedState();
    if (session) state.auth = session;
    else delete state.auth;
    localStorage.setItem(STATE_KEY, JSON.stringify(state));
  } catch {
    // The in-memory session still works. A fresh tab will ask the user to sign in.
  }
}

export async function restoreSession(): Promise<StudioSession | null> {
  const callback = consumeStudioOAuthCallback();
  const candidate = callback ?? readStoredSession();
  if (!candidate) return null;
  try {
    const fresh = await ensureStudioSession(candidate);
    writeStoredSession(fresh);
    return fresh;
  } catch {
    writeStoredSession(null);
    return null;
  }
}
