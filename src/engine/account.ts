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

export class AccountError extends Error {
  status: number;
  data: any;
  constructor(message: string, status: number, data?: any) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

// an auth-layer rejection (revoked/expired token) — NOT a network blip.
// Callers must surface these instead of silently retrying forever.
export const isAuthDead = (e: unknown) =>
  e instanceof AccountError && (e.status === 400 || e.status === 401 || e.status === 403);

async function post(body: unknown): Promise<any> {
  const res = await fetch(`${BASE}/api/account`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok)
    throw new AccountError(
      data?.error || data?.msg || data?.error_description || `error ${res.status}`,
      res.status,
      data,
    );
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

/**
 * How many messages ride the wire. It is a PAYLOAD number, not a memory
 * number, and the distinction is the whole justification:
 *
 * - The real reader is the 90-turn window `toTurns` sends (plus the chat tail
 *   and shared-history blocks, all far shorter). 400 is 4.4x that horizon, so
 *   raising it to `mergeStates`' 500 buys nothing any lane can render. The
 *   memory-horizon audit is what makes this checkable rather than an opinion.
 * - What it does buy is bytes, and they are measured, on the REAL function
 *   with a realistic message mix (quote-replies, callmarks, voice notes,
 *   photos with vision descs, reactions, call turns), 2026-08-23:
 *       400 messages          63.5 KB body   (99.8 KB with an 80-ply chess game)
 *       +100 messages         +14.1 KB       (144 B/message)
 *   That body goes up on every 4s debounce AND comes back down on every pull
 *   (see App.tsx's pull effect), so the cap is now paid twice per exchange.
 *
 * The 400/500 mismatch with `mergeStates` used to be a real asymmetry, but it
 * was never this number's fault: the merge cap was a scythe over the LOCAL
 * half (a 2,000-message device merging down to 500). That is fixed where it
 * lives — `MERGE_MESSAGE_CAP` is a floor now — which leaves this free to be
 * chosen on payload alone.
 *
 * **Reverses if:** a reader appears that wants more than 90 turns (a real
 * long-window recall, a local search over the whole history), or the measured
 * body stops being the binding cost — then raise it to 500 to match the merge
 * floor and re-measure, in that order.
 */
export const SYNC_MESSAGE_CAP = 400;

// which slices of AppState are worth syncing (keys stay on-device only).
// data: photo URLs are stripped — a failed upload must never turn each 4s
// sync into a multi-MB POST (the desc/caption keeps the memory).
export function syncableState(s: AppState) {
  return {
    onboarded: s.onboarded,
    deviceId: s.deviceId,
    user: s.user,
    messages: s.messages.slice(-SYNC_MESSAGE_CAP).map((m) =>
      m.photoUrl && m.photoUrl.startsWith("data:") ? { ...m, photoUrl: undefined } : m,
    ),
    lastSeen: s.lastSeen,
    clearedAt: s.clearedAt,
    // The relationship's own state. This list lagging behind AppState is how
    // half of mergeStates was dead for a release — herLife/inner were merged
    // on receive but never sent. The rule now: a new AppState field decides
    // sync-or-not HERE, on the day it is added (same discipline as the
    // teardown rule in Chat.tsx). `theme` is deliberately absent: a phone on
    // dark and a laptop on light is a feature, not a conflict. Keys never sync.
    herLife: s.herLife,
    inner: s.inner,
    game: s.game,
    // The finished-games ledger. It is the relationship's record of what they
    // have actually done together, so it syncs with the rest of it — a game
    // played on the phone must not be a game the laptop denies.
    activities: s.activities,
    tally: s.tally,
    momentsFired: s.momentsFired,
    followup: s.followup,
  };
}

// baseUpdatedAt: the server revision this client last saw. The server
// rejects the write (409) if someone else saved since — the caller then
// merges and retries instead of clobbering another device's messages.
export const saveStateRemote = (session: AuthSession, state: AppState, baseUpdatedAt?: string | null) =>
  post({
    op: "save_state",
    access_token: session.accessToken,
    state: syncableState(state),
    device: state.deviceId,
    base_updated_at: baseUpdatedAt ?? undefined,
  });

export const loadStateRemote = (session: AuthSession) =>
  post({ op: "load_state", access_token: session.accessToken });

// fire-and-forget analytics — literally everything noteworthy
export function track(device: string, event: string, props: Record<string, unknown> = {}, userId?: string) {
  post({ op: "track", device, event, props, user_id: userId }).catch(() => {});
}
