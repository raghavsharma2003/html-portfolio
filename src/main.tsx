import React from "react";
import ReactDOM from "react-dom/client";
// Static, deliberately. This was `await import("@capacitor/core")` inside
// confirmBundleWorks, which bought nothing: fourteen other modules in the
// initial graph import it statically, so rollup kept it in the entry chunk
// and only printed INEFFECTIVE_DYNAMIC_IMPORT for the trouble. One style,
// and it is the one the rest of the app already uses.
import { Capacitor, registerPlugin } from "@capacitor/core";
import "./styles/global.css";
import App from "./App";
import { applyTheme, isThemeChoice } from "./engine/theme";
import { loadState } from "./state/store";

// BEFORE React renders anything.
//
// App also applies the theme in an effect, and that effect is what keeps it
// correct as the setting changes — but an effect runs after the first paint,
// so a dark-mode user would watch the app flash paper-white on every single
// launch. This is the same call, one frame earlier, reading the persisted
// choice straight off disk. Cheap, and it makes the flash structurally
// impossible rather than usually-absent.
try {
  const t = loadState().theme;
  applyTheme(isThemeChoice(t) ? t : "system");
} catch {
  // storage unavailable (private mode, wiped profile) — the media query still
  // decides, which is exactly the "system" default
}
import { installTelemetry, tel, telFlush } from "./engine/telemetry";
import { installTrace } from "./engine/trace";

// Before anything else renders. The global listeners have to exist for the
// FIRST tap and the first error — a capture library installed after boot
// misses precisely the boot problems it is there to explain. Records buffer
// without a device id and are attributed the moment App identifies one.
installTelemetry("app");
// The turn trace (docs/TRACE.md) — installs a tap on tel() and derives one
// per-turn record from the events that already flow through it. No new call
// sites, no new events, no network traffic on any reply path. AFTER
// installTelemetry so the tap is set on a live buffer rather than a cold one.
installTrace();

// Mobile keyboard fix (WhatsApp behavior): Chromium resizes the layout
// viewport via the interactive-widget meta; iOS Safari never does, so we
// track the VISUAL viewport ourselves — height into --vvh, and Safari's
// forced layout-viewport offset into --vvt (translate the shell to follow,
// or the header slides off-screen). rAF-throttled; inert during pinch-zoom.
const vv = window.visualViewport;
let raf = 0;
function sync() {
  raf = 0;
  if (vv && vv.scale !== 1) return; // don't fight pinch-zoom
  const h = vv?.height ?? window.innerHeight;
  document.documentElement.style.setProperty("--vvh", `${Math.round(h)}px`);
  document.documentElement.style.setProperty("--vvt", `${Math.round(vv?.offsetTop ?? 0)}px`);
  if (window.scrollY !== 0) window.scrollTo(0, 0);
}
function schedule() {
  if (!raf) raf = requestAnimationFrame(sync);
}
if (vv) {
  vv.addEventListener("resize", schedule);
  vv.addEventListener("scroll", schedule);
} else {
  // no VisualViewport (older WebViews): plain resize keeps --vvh honest
  // through rotations and window resizes
  window.addEventListener("resize", schedule);
  window.addEventListener("orientationchange", schedule);
}
window.addEventListener("focusin", schedule);
// iOS 26.0 bug: offsetTop/height stay stale after keyboard dismiss — resync late
window.addEventListener("focusout", () => setTimeout(schedule, 300));
sync();

// err.render via React 19's root error hooks rather than an error boundary:
// a boundary would have to render a fallback, which changes what the user
// sees in order to observe it. These report and leave React's own behaviour
// exactly as it was.
let renderFailed = false;

const onRenderError = (caught: boolean) => (err: unknown, info: { componentStack?: string }) => {
  // An UNCAUGHT render error means this bundle does not work. Recording that
  // here is what stops it being confirmed as good below.
  if (!caught) renderFailed = true;
  tel("err.render", {
    caught,
    msg: String((err as Error)?.message ?? err).slice(0, 200),
    stack: String((err as Error)?.stack ?? "").slice(0, 600),
    where: String(info?.componentStack ?? "").slice(0, 400),
  });
  telFlush();
};

/**
 * Tell the updater this bundle actually works. Until this runs, an OTA bundle
 * is on trial and two silent launches roll it back — so this call is the only
 * thing standing between a good update and an automatic revert.
 *
 * Native has a fallback probe ("#root has children after 3.5s"), and this
 * exists because that probe is weak: a bundle that throws during render can
 * still leave children behind from a partial commit, and would confirm itself.
 * Waiting for two frames means React committed and the browser painted, and
 * `renderFailed` means it painted something that was not an error.
 *
 * Deliberately NOT awaited and never rethrown: on the web, and on any build
 * without the plugin, this is a no-op. A bundle must never fail to confirm
 * itself because the confirmation path threw.
 */
function confirmBundleWorks() {
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      // one more beat so a throw during the first effects still counts against us
      setTimeout(() => {
        if (renderFailed) return;
        if (!document.getElementById("root")?.childElementCount) return;
        void (async () => {
          try {
            if (!Capacitor.isNativePlatform()) return;
            const Updater = registerPlugin<{ markLaunchOk(): Promise<void> }>("MeeraUpdater");
            await Updater.markLaunchOk();
            tel("app.update_confirmed", {});
          } catch {
            /* no plugin in this build, or the web — nothing to confirm */
          }
        })();
      }, 800);
    }),
  );
}

ReactDOM.createRoot(document.getElementById("root")!, {
  onUncaughtError: onRenderError(false),
  onCaughtError: onRenderError(true),
}).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

confirmBundleWorks();
