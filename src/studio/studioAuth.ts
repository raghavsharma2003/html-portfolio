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

export async function googleSignIn() {
  const redirect = window.location.origin + "/studio";
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
