// Client account layer: auth flows, state sync, and event tracking — all via
// /api/account so no database credentials ever live in the app.

import { Capacitor } from "@capacitor/core";
import type { AppState } from "../state/store";

const BASE = Capacitor.isNativePlatform() ? "https://meera-silk.vercel.app" : "";

export interface AuthSession {
  userId: string;
  email?: string;
  phone?: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // epoch ms
}

async function post(body: unknown): Promise<any> {
  const res = await fetch(`${BASE}/api/account`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || data?.msg || data?.error_description || `error ${res.status}`);
  return data;
}

function toSession(data: any): AuthSession {
  const user = data.user ?? {};
  return {
    userId: user.id,
    email: user.email || undefined,
    phone: user.phone || undefined,
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000,
  };
}

export const sendEmailOtp = (email: string) => post({ op: "send_otp", email });
export const verifyEmailOtp = async (email: string, token: string) =>
  toSession(await post({ op: "verify_otp", email, token }));
export const sendSmsOtp = (phone: string) => post({ op: "send_sms", phone });
export const verifySmsOtp = async (phone: string, token: string) =>
  toSession(await post({ op: "verify_sms", phone, token }));

export async function googleSignIn() {
  const redirect = window.location.origin + window.location.pathname;
  const { url } = await post({ op: "google_url", redirect });
  window.location.href = url;
}

// Google/OAuth returns tokens in the URL hash (implicit flow). Call on boot.
export function consumeOAuthCallback(): AuthSession | null {
  const h = window.location.hash;
  if (!h.includes("access_token=")) return null;
  const p = new URLSearchParams(h.slice(1));
  const access = p.get("access_token");
  const refresh = p.get("refresh_token");
  if (!access || !refresh) return null;
  history.replaceState(null, "", window.location.pathname + window.location.search);
  return {
    userId: "", // filled after refresh/user fetch via sync
    accessToken: access,
    refreshToken: refresh,
    expiresAt: Date.now() + (Number(p.get("expires_in")) || 3600) * 1000,
  };
}

export async function refreshSession(s: AuthSession): Promise<AuthSession> {
  return toSession(await post({ op: "refresh", refresh_token: s.refreshToken }));
}

export async function ensureFresh(s: AuthSession): Promise<AuthSession> {
  if (Date.now() < s.expiresAt - 120_000 && s.userId) return s;
  return refreshSession(s);
}

// which slices of AppState are worth syncing (keys stay on-device only)
export function syncableState(s: AppState) {
  return {
    onboarded: s.onboarded,
    deviceId: s.deviceId,
    user: s.user,
    messages: s.messages.slice(-400),
    lastSeen: s.lastSeen,
  };
}

export const saveStateRemote = (session: AuthSession, state: AppState) =>
  post({ op: "save_state", access_token: session.accessToken, state: syncableState(state), device: state.deviceId });

export const loadStateRemote = (session: AuthSession) =>
  post({ op: "load_state", access_token: session.accessToken });

// fire-and-forget analytics — literally everything noteworthy
export function track(device: string, event: string, props: Record<string, unknown> = {}, userId?: string) {
  post({ op: "track", device, event, props, user_id: userId }).catch(() => {});
}
