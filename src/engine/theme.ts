// Light, dark, or whatever the phone is doing.
//
// The owner asked whether this should be light-only or choosable. Choosable,
// for a reason specific to this product rather than a general preference: the
// hours people actually talk to a companion are late ones, and a paper-white
// screen at 1am is a physical annoyance. "System" is the default because the
// person has usually already made this decision once, at the OS level, and
// asking them to make it again is a worse product than honouring it.
//
// ── how the three states are expressed ───────────────────────────────────
//
//   "light"   -> <html data-theme="light">
//   "dark"    -> <html data-theme="dark">
//   "system"  -> NO attribute at all
//
// The absent attribute is the load-bearing part. It means `system` is not a
// third palette that has to be kept in sync with the other two — it is the
// media query being left alone to decide, which is the only version of
// "follow the system" that keeps following it when the system changes at
// sunset with the app open. The stylesheet pairs this with
// `:root:not([data-theme="light"])` inside the dark media query, so an
// explicit light choice still beats a dark OS.

import { skyMode, skyNow } from "./sky";

// ── the fourth mode: "sky" (docs/DESIGN-WORLD.md §4) ─────────────────────
//
//   "sky"  -> <html data-theme="light"|"dark">, decided by the REAL sky
//
// Note what that means mechanically: `sky` is not a third palette either. It
// RESOLVES to one of the two that already exist, through `skyMode()` and
// nothing else, and then writes the same attribute an explicit pick would.
// So every selector in global.css, every dark-block invariant the theme eval
// pins, and every contrast number in the comments there stay exactly true —
// the only new thing in the system is WHO decides, not WHAT is painted.
//
// ── why undefined still means "system", and sky is set at onboarding ─────
//
// The obvious implementation is `undefined -> sky`, and it is wrong here for
// a reason specific to what `undefined` already MEANS on this AppState: it is
// the value carried by every existing install whose owner never opened
// Settings. Flipping its meaning would move those users off the OS setting
// they had implicitly accepted, and it would move them AT A TIME OF DAY —
// someone with a dark phone opening the app at 10am IST would watch it come
// up paper-white, on a build where nothing they touched had changed. That is
// indistinguishable from the flash bug main.tsx exists to prevent, and
// "the app changed colour and I did not do anything" is the single hardest
// class of bug for a user to report.
//
// So the default is set FORWARD, not retroactively: App.tsx stamps
// `theme: "sky"` when onboarding completes, which is a moment that only
// happens on a fresh install and already writes state. Existing users keep
// `undefined` and keep following their phone, exactly as before, until they
// pick something. The reversal condition is a migration that can tell a
// never-chosen `undefined` from a chosen one — with that, `undefined -> sky`
// becomes safe and is the better default.

export type ThemeChoice = "system" | "light" | "dark" | "sky";

export const THEMES: readonly ThemeChoice[] = ["sky", "system", "light", "dark"];

export function isThemeChoice(v: unknown): v is ThemeChoice {
  return v === "system" || v === "light" || v === "dark" || v === "sky";
}

/** What the browser will actually paint, given the choice, the sky and the OS.
 *  `nowMs` is injectable for the same reason every clock in this repo is:
 *  the five states are verified by simulating time, never by waiting. */
export function resolveTheme(
  choice: ThemeChoice | undefined,
  nowMs: number = Date.now(),
): "light" | "dark" {
  if (choice === "light" || choice === "dark") return choice;
  if (choice === "sky") return skyMode(nowMs);
  if (typeof window === "undefined" || !window.matchMedia) return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/**
 * Apply the choice to the document.
 *
 * The browser-chrome colour is READ BACK from the stylesheet rather than
 * duplicated here as a hex. That is deliberate: a colour written in two places
 * is a colour that will disagree with itself the first time one of them is
 * tuned, and the disagreement shows up as a status bar that is subtly the wrong
 * shade — visible, annoying, and very hard to attribute. The stylesheet owns
 * every colour in this app; this function only asks it what it decided.
 */
export function applyTheme(choice: ThemeChoice | undefined, nowMs: number = Date.now()): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (choice === "light" || choice === "dark") root.setAttribute("data-theme", choice);
  // "sky" writes the SAME attribute an explicit pick writes, resolved from
  // the clock. It deliberately does not get a selector of its own: a third
  // value here would be a third palette to keep in sync with the other two,
  // and the theme eval's "both dark blocks agree on every value" invariant
  // exists because that sync is exactly what rots.
  else if (choice === "sky") root.setAttribute("data-theme", skyMode(nowMs));
  else root.removeAttribute("data-theme");
  // NOTE what is deliberately absent: nothing here turns the WORLD off. The
  // direction's "data-theme beats the sky" is about the PALETTE — the chat,
  // the sheets, the surfaces someone picked Light or Dark for. The world
  // layer is the ground of the home and call screens, and it goes on showing
  // the real sky in every mode for the same reason a window does. An explicit
  // Dark at noon is a dark app in front of a morning sky, which is coherent;
  // an explicit Dark that also blanks the home screen is a missing feature.

  // Let the attribute change settle into computed styles before reading --bg
  // back out. Same tick is fine — style resolution is synchronous on read —
  // but the read must come AFTER the attribute write, never before.
  const bg = getComputedStyle(root).getPropertyValue("--bg").trim();
  if (bg) {
    let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (!meta) {
      meta = document.createElement("meta");
      meta.name = "theme-color";
      document.head.appendChild(meta);
    }
    meta.content = bg;
  }
}

/**
 * Watch the OS setting, for `system` only.
 *
 * Returns a teardown. Without this, choosing "system" would mean "whatever the
 * system was when the app started", which is exactly wrong at the moment it
 * matters most — the phone switching to dark at sunset while the app is open.
 * `data-theme` is already absent in this state, so the CSS flips on its own;
 * what the listener is actually for is re-reading --bg into the chrome colour.
 */
export function watchSystemTheme(choice: ThemeChoice | undefined, onChange: () => void): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  // `sky` is not following the OS — it is following the clock, and
  // `watchSky` below is its listener. Subscribing it here too would repaint
  // it for an event that has nothing to do with what it reads.
  if (choice === "light" || choice === "dark" || choice === "sky") return () => {};
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  const fn = () => onChange();
  // Safari below 14 has addListener only; this app ships to real phones.
  if (mq.addEventListener) mq.addEventListener("change", fn);
  else mq.addListener(fn);
  return () => {
    if (mq.removeEventListener) mq.removeEventListener("change", fn);
    else mq.removeListener(fn);
  };
}

/**
 * Watch the CLOCK, for `sky` only.
 *
 * Scheduled, not polled: `skyNow().msToNext` is the exact distance to the
 * next boundary, so this arms one timer and re-arms it on each crossing.
 * Polling every minute would be 1,440 wake-ups a day to catch five events,
 * and on a phone that is a battery line item rather than a rounding error.
 *
 * The timer is capped at 30 minutes per hop for a reason that is not
 * theoretical: a backgrounded WebView's timers are frozen, and a device
 * whose clock is corrected (or that simply resumes six hours later) would
 * otherwise sit on a stale sky until a timer that was scheduled against the
 * old wall clock finally fired. Re-checking at most half an hour out means
 * the worst case is half an hour of a sky one state behind, and it costs 48
 * wake-ups a day instead of 1,440.
 */
export function watchSky(choice: ThemeChoice | undefined, onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  if (choice !== "sky") return () => {};
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  const arm = () => {
    if (stopped) return;
    const wait = Math.min(skyNow().msToNext, 30 * 60_000);
    timer = setTimeout(() => {
      onChange();
      arm();
    }, Math.max(1_000, wait));
  };
  // A phone that was asleep across a boundary comes back to the wrong sky
  // until something re-checks; returning to the app is that something.
  const onVis = () => {
    if (document.visibilityState === "visible") {
      onChange();
      if (timer) clearTimeout(timer);
      arm();
    }
  };
  document.addEventListener("visibilitychange", onVis);
  arm();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    document.removeEventListener("visibilitychange", onVis);
  };
}

export const THEME_LABEL: Record<ThemeChoice, string> = {
  // "Sky" rather than "Auto (sky)": it is the mode that follows the real sky
  // over her city, and naming it after the mechanism is what makes the one
  // line of help text under the chips ("follows the sky where she is") land
  // as a description instead of as a riddle.
  sky: "Sky",
  system: "Auto",
  light: "Light",
  dark: "Dark",
};
