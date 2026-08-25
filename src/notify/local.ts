// The local-notification lane. NO KEYS, NO SERVER, NO FIREBASE.
//
// `@capacitor/local-notifications` posts to the Android notification shade from
// inside the app process, and its web implementation posts through the browser's
// own `Notification`. Both are free, both need nothing configured, and between
// them they cover every case in this workstream's scope: she replied while you
// were in another app, she called and you missed it, she posted her story.
//
// What this lane structurally CANNOT do is reach a phone whose app has been
// killed. That is push, that is `./push.ts`, and it is a slot rather than a
// feature (see `./config.ts`).
//
// ── THE FOUR IDS, AND WHY THEY ARE FIXED ──────────────────────────────────
//
// Every notification this app can post has a constant id, so a second post
// REPLACES the first instead of stacking, and so cancelling is exact. Two
// replies of hers while he is away is one line on the lock screen that got
// newer, which is what a person's messages look like — not two rows.
//
// It is also the only way `clearReplyArrived()` can be honest: the promise
// "she stops buzzing you the moment you come back" needs a handle on the thing
// already delivered, and `removeDeliveredNotificationsById` takes ids.
//
// ── WHAT THIS FILE MAY NOT IMPORT ─────────────────────────────────────────
//
// Nothing from `src/engine/`. The copy layer (`./copy.ts`) is pure and the
// store field is passed in. That keeps this module bundleable by an eval in
// about a second and keeps the notification path off the reply path's critical
// imports.

import { Capacitor } from "@capacitor/core";
import { LocalNotifications } from "@capacitor/local-notifications";
import type { NotifyCopy } from "./copy";

/** One id per KIND of thing she can interrupt you about. Never dynamic. */
export const NOTIFY_ID = {
  /** She said something while you were not looking. */
  reply: 1001,
  /** She called and you did not pick up. */
  missedCall: 1002,
  /** Her story for the day went up. */
  story: 1003,
} as const;

export type NotifyKind = keyof typeof NOTIFY_ID;

/**
 * The Android channel. One channel, named for what it is, so the system
 * settings screen offers exactly one honest switch rather than a taxonomy the
 * user has to decode. `IMPORTANCE_DEFAULT` (3) and not HIGH: her messages do
 * not deserve to shove themselves in front of what someone is doing, and a
 * heads-up popup for a text is the app raising its voice.
 */
const CHANNEL_ID = "meera-messages";

/** The minimum surface this module uses, so a test can supply a fake. */
export interface NotifierPlugin {
  checkPermissions(): Promise<{ display: string }>;
  requestPermissions(): Promise<{ display: string }>;
  schedule(opts: { notifications: ScheduledNotification[] }): Promise<unknown>;
  cancel(opts: { notifications: { id: number }[] }): Promise<void>;
  removeDeliveredNotificationsById?(opts: { ids: number[] }): Promise<void>;
  createChannel?(ch: Record<string, unknown>): Promise<void>;
}

export interface ScheduledNotification {
  id: number;
  title: string;
  body: string;
  largeBody?: string;
  channelId?: string;
  schedule?: { at: Date; allowWhileIdle?: boolean };
  isExactNotification?: boolean;
  extra?: Record<string, unknown>;
  smallIcon?: string;
}

// ── the test seam ─────────────────────────────────────────────────────────
//
// The same shape `configureSky()` and `configureClock()` use, and for the same
// reason those exist: the thing worth asserting (WHAT gets scheduled, and WHEN)
// is decided here, and a battery that had to install a real Android to see it
// is a battery nobody runs. `evals/notify.mjs` drives this with a recorder.
let plugin: NotifierPlugin = LocalNotifications as unknown as NotifierPlugin;
let native = () => Capacitor.isNativePlatform();

export function configureNotifier(seam: { plugin?: NotifierPlugin; native?: () => boolean }) {
  if (seam.plugin) plugin = seam.plugin;
  if (seam.native) native = seam.native;
}

/**
 * Can this device post a notification at all?
 *
 * On native, always. On web, only where the browser has the API — which
 * excludes iOS Safari outside an installed PWA, and every embedded WebView.
 * A capability question, never a permission one: `permissionState()` answers
 * the other half and the two are deliberately not merged, because "the browser
 * cannot" and "the user said no" call for completely different UI.
 */
export function notifyAvailable(): boolean {
  if (native()) return true;
  return typeof window !== "undefined" && "Notification" in window;
}

export type NotifyPermission = "granted" | "denied" | "prompt";

/** What the OS currently thinks, asked fresh. Never cached: a user can revoke
 *  this in system settings while the app is open, and a cached "granted" turns
 *  that into notifications that silently never arrive. */
export async function permissionState(): Promise<NotifyPermission> {
  if (!notifyAvailable()) return "denied";
  try {
    const { display } = await plugin.checkPermissions();
    if (display === "granted") return "granted";
    if (display === "denied") return "denied";
    return "prompt";
  } catch {
    return "denied";
  }
}

/**
 * Show the SYSTEM dialog. Never called except from the explainer sheet's
 * primary button, which is a deliberate constraint rather than a convention:
 * Android 13+ gives an app ONE runtime prompt, and a "don't allow" is
 * permanent from the app's side. Spending it without an explanation in front
 * of it is spending the only chance the product gets.
 */
export async function requestPermission(): Promise<NotifyPermission> {
  if (!notifyAvailable()) return "denied";
  try {
    const { display } = await plugin.requestPermissions();
    if (display === "granted") {
      await ensureChannel();
      return "granted";
    }
    return display === "denied" ? "denied" : "prompt";
  } catch {
    return "denied";
  }
}

let channelReady = false;
async function ensureChannel() {
  if (channelReady || !native() || !plugin.createChannel) return;
  try {
    await plugin.createChannel({
      id: CHANNEL_ID,
      name: "Messages",
      description: "Her messages, her calls and her story.",
      importance: 3,
      visibility: 1,
    });
    channelReady = true;
  } catch {
    /* channels are Android 8+; an older device posts without one */
  }
}

/**
 * Post now, or return false having done nothing.
 *
 * It returns a boolean rather than throwing because EVERY caller is on a path
 * where the notification is the least important thing happening — a reply just
 * arrived, a call just rang — and a rejected promise on that path is a blank
 * screen for a feature nobody would miss.
 */
export async function post(kind: NotifyKind, copy: NotifyCopy): Promise<boolean> {
  if ((await permissionState()) !== "granted") return false;
  await ensureChannel();
  try {
    await plugin.schedule({
      notifications: [
        {
          id: NOTIFY_ID[kind],
          title: copy.title,
          body: copy.body,
          ...(copy.largeBody ? { largeBody: copy.largeBody } : {}),
          channelId: CHANNEL_ID,
          // Tapping it opens the thread, not home. The hash is read by
          // App.tsx's `surface` initialiser, which already understands
          // `#chat` because that is what a home-screen shortcut uses.
          extra: { route: "#chat", kind },
        },
      ],
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Post AT A TIME. The only caller is her story, and the constraint is written
 * into the signature: `at` is a Date, so nothing here can express "in N
 * minutes" or "every N hours". A delay argument is what docs/PRODUCT-
 * SUPERIORITY.md §5's fails-if (c) says a lint must forbid, and the cheapest
 * enforcement is a type that cannot say it.
 *
 * See `./index.ts`'s `scheduleStory` for why the story is the one exception to
 * `never-scheduled`, and what would reverse it.
 */
export async function postAt(kind: NotifyKind, copy: NotifyCopy, at: Date): Promise<boolean> {
  if ((await permissionState()) !== "granted") return false;
  if (!(at instanceof Date) || !Number.isFinite(at.getTime())) return false;
  await ensureChannel();
  try {
    await plugin.schedule({
      notifications: [
        {
          id: NOTIFY_ID[kind],
          title: copy.title,
          body: copy.body,
          ...(copy.largeBody ? { largeBody: copy.largeBody } : {}),
          channelId: CHANNEL_ID,
          schedule: { at, allowWhileIdle: false },
          // INEXACT, deliberately. The plugin defaults `isExactNotification`
          // to true, and on API 31+ that OPENS THE SYSTEM "Alarms & reminders"
          // SETTINGS SCREEN the first time it is used — an app that answers a
          // story with a settings screen is worse than an app with no story
          // notification. It also drags SCHEDULE_EXACT_ALARM into the manifest,
          // which is a Play policy declaration for alarm-clock apps. A story
          // that lands within the OS's own batching window is a story that
          // landed; nothing here needs a second's precision, and
          // `allowWhileIdle: false` says the same thing to Doze.
          isExactNotification: false,
          extra: { route: "#chat", kind },
        },
      ],
    });
    return true;
  } catch {
    return false;
  }
}

/** Take it back — both the pending copy and the one already on screen. */
export async function cancel(kind: NotifyKind): Promise<void> {
  const id = NOTIFY_ID[kind];
  try {
    await plugin.cancel({ notifications: [{ id }] });
  } catch {
    /* nothing pending */
  }
  try {
    await plugin.removeDeliveredNotificationsById?.({ ids: [id] });
  } catch {
    /* nothing delivered, or an older plugin */
  }
}

/** Everything this app has ever posted. The teardown's hand. */
export async function cancelAll(): Promise<void> {
  await Promise.all((Object.keys(NOTIFY_ID) as NotifyKind[]).map((k) => cancel(k)));
}
