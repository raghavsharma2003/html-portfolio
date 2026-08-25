// THE PUSH LANE — scaffolded, inert, and one paste from working.
//
// Everything in this file is behind `pushConfigured()`, which is false in the
// shipping tree (see `./config.ts` for the six strings that flip it). With it
// false, no function here does anything at all: no service worker registers,
// no permission is consulted, no network call is made, and nothing is stored.
//
// ── WHY NO firebase npm PACKAGE ───────────────────────────────────────────
//
// The Firebase JS SDK is ~200 KB gzipped for one job: turn a browser
// PushSubscription into an FCM registration token. That job is a single
// documented REST call (`fcmregistrations.googleapis.com`), and the browser
// APIs on either side of it are standard — `navigator.serviceWorker` and
// `PushManager.subscribe`. So the whole web lane is written against platform
// APIs plus one fetch, and the app's bundle carries ZERO bytes of push
// machinery until the config is filled in.
//
// This is not cleverness for its own sake. A dependency that ships in every
// build for a feature that is switched off is a cost paid on every cold load
// by every user, forever, for nothing — and this repo already measures its
// first-paint budget. The named cost of the choice: if Google changes the
// registration endpoint we notice at the moment the owner turns push on,
// rather than at an SDK bump. That is an acceptable trade for a slot.
//
// ── THE ANDROID HALF ──────────────────────────────────────────────────────
//
// The APK's token comes from FCM through `@capacitor/push-notifications`,
// which is deliberately NOT installed: its Android side needs
// `google-services.json` and the Google Services gradle plugin, neither of
// which exists in a repo with no Firebase project, and a plugin whose native
// half cannot build is a broken APK rather than a disabled feature. The steps
// are written out in `./config.ts` (step 6). `registerForPush()` reports
// `"native-not-wired"` on a device so the state is legible rather than silent.

import { Capacitor } from "@capacitor/core";
import { PUSH_SW_PATH, WEB_PUSH, pushConfigured } from "./config";

export type PushResult =
  | { ok: true; token: string }
  | { ok: false; reason: "unconfigured" | "unsupported" | "denied" | "native-not-wired" | "failed" };

/** base64url (what `applicationServerKey` wants) → the Uint8Array it wants. */
function urlB64ToBytes(b64: string): ArrayBuffer {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  // An ArrayBuffer and not a Uint8Array view: `applicationServerKey` is typed
  // as `BufferSource`, and a `Uint8Array` over `ArrayBufferLike` (which is what
  // the DOM lib now infers) is not assignable to it because a SharedArrayBuffer
  // could in principle back it. Returning the buffer itself sidesteps a cast.
  const out = new ArrayBuffer(raw.length);
  const view = new Uint8Array(out);
  for (let i = 0; i < raw.length; i++) view[i] = raw.charCodeAt(i);
  return out;
}

function b64url(buf: ArrayBuffer | null): string {
  if (!buf) return "";
  const bytes = new Uint8Array(buf);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Get a push token for this device, registering the service worker if needed.
 *
 * Returns a REASON rather than throwing, for the same argument `post()` makes:
 * every caller is on a path where push is the least important thing happening.
 */
export async function registerForPush(): Promise<PushResult> {
  if (!pushConfigured()) return { ok: false, reason: "unconfigured" };
  if (Capacitor.isNativePlatform()) return { ok: false, reason: "native-not-wired" };
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator) || !("PushManager" in window)) {
    return { ok: false, reason: "unsupported" };
  }
  if (typeof Notification !== "undefined" && Notification.permission !== "granted") {
    // Push permission IS notification permission. It is never requested here:
    // the one prompt this product spends goes through the explainer sheet in
    // `./NotifySheet.tsx`, and a second code path that could raise it would
    // make that guarantee a comment rather than a fact.
    return { ok: false, reason: "denied" };
  }
  try {
    const reg = await navigator.serviceWorker.register(PUSH_SW_PATH, { scope: "/" });
    await navigator.serviceWorker.ready;
    const sub =
      (await reg.pushManager.getSubscription()) ??
      (await reg.pushManager.subscribe({
        // Non-negotiable and correct: every push this app can ever send is a
        // thing she said or did. There is no silent push, so there is no
        // background wake-up to justify, so `false` here would be a lie to the
        // browser about what the subscription is for.
        userVisibleOnly: true,
        applicationServerKey: urlB64ToBytes(WEB_PUSH.vapidKey),
      }));

    // The one REST call the SDK would have made. It exchanges a standard Web
    // Push subscription for an FCM registration token, which is what the
    // server-side HTTP v1 send takes.
    const res = await fetch(
      `https://fcmregistrations.googleapis.com/v1/projects/${WEB_PUSH.projectId}/registrations`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": WEB_PUSH.apiKey,
        },
        body: JSON.stringify({
          web: {
            endpoint: sub.endpoint,
            p256dh: b64url(sub.getKey("p256dh")),
            auth: b64url(sub.getKey("auth")),
            applicationPubKey: WEB_PUSH.vapidKey,
          },
        }),
      },
    );
    if (!res.ok) return { ok: false, reason: "failed" };
    const body = (await res.json()) as { token?: string };
    return body.token ? { ok: true, token: body.token } : { ok: false, reason: "failed" };
  } catch {
    return { ok: false, reason: "failed" };
  }
}

/**
 * Hand the token to the server, keyed by the SAME deviceId every other row in
 * this product is keyed by (`api/push-token.js` writes it agent-scoped).
 *
 * `platform` is sent because a token's shape is not enough to tell a web
 * subscription from an APK's FCM registration, and the send path has to know:
 * a web token that is answered with an Android notification payload silently
 * delivers nothing.
 */
export async function submitPushToken(base: string, deviceId: string, token: string): Promise<boolean> {
  if (!pushConfigured()) return false;
  try {
    const r = await fetch(`${base}/api/push-token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        device: deviceId,
        token,
        platform: Capacitor.isNativePlatform() ? "android" : "web",
      }),
    });
    const j = (await r.json().catch(() => ({}))) as { stored?: boolean };
    return Boolean(j.stored);
  } catch {
    return false;
  }
}

/**
 * Stop being reachable. Called by the teardown — a push token is REACHABILITY,
 * and reachability outliving "make her forget you" means a lock screen can
 * still light up with the name of someone who has been told she never met you.
 *
 * Both halves, in this order: the server row first (that is the one that can
 * still be sent to), then the local subscription. If the network call fails the
 * local unsubscribe still happens, because a browser with no subscription
 * cannot receive a push no matter what row survives.
 */
export async function revokePushToken(base: string, deviceId: string): Promise<void> {
  if (!pushConfigured()) return;
  try {
    await fetch(`${base}/api/push-token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ device: deviceId, revoke: true }),
    });
  } catch {
    /* the local unsubscribe below is the half that always works */
  }
  try {
    const reg = await navigator.serviceWorker?.getRegistration(PUSH_SW_PATH);
    const sub = await reg?.pushManager.getSubscription();
    await sub?.unsubscribe();
  } catch {
    /* nothing subscribed */
  }
}
