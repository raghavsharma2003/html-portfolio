// WS-R157. Vyakti's own native shell — a SECOND Capacitor app in this same
// project, never a copy of `android/` (the brief's own law 2: one Android
// project, a product flavour named `vyakti` inside it). This file is never
// read by the Capacitor CLI directly: `loadConfig` in the installed
// `@capacitor/cli` (`node_modules/@capacitor/cli/dist/config.js`) always
// reads a FIXED name — `capacitor.config.ts` — from `process.cwd()`, and
// there is no `--config <path>` flag or env var it consults for an
// alternate one (checked against the installed 8.5.0 source; `CAPACITOR_
// CONFIG` inside `common.js` is an OUTPUT the CLI injects INTO the native
// build, not an input this repo can set — see
// `context/decisions.md#ws-r157-capacitor-config-selected-by-a-repo-script-not-a-cli-flag`).
// `scripts/select-capacitor-config.mjs` is what stages this file's content
// onto `capacitor.config.ts` before `cap sync` runs, only ever for the new
// `vyakti-apk` CI job — Meera's own job never calls it and never has, so her
// build's behaviour cannot depend on this file existing.
import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "app.vyakti.studio",
  appName: "Vyakti",
  webDir: "dist",
  // The studio's own `--vx-paper` (`src/studio/auth-entry.css`), matching
  // `studio.html`'s own `<meta name="theme-color">` — the same colour by
  // three independent readers (this splash screen, the browser chrome, and
  // `public/studio.webmanifest`'s `background_color`/`theme_color`) rather
  // than three numbers that could drift apart one edit at a time.
  backgroundColor: "#f8f8f5",
  android: {
    allowMixedContent: false,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1200,
      backgroundColor: "#f8f8f5",
      showSpinner: false,
    },
    StatusBar: {
      style: "LIGHT",
      backgroundColor: "#f8f8f5",
      overlaysWebView: true,
    },
    // No `MeeraUpdater` block. OTA (`docs/AUTOUPDATE.md`) is Meera's own
    // mechanism, named for her (`manifestUrl` points at her domain) and
    // wired to a plugin (`OtaPlugin.java`) this flavour's Java code never
    // registers (`MainActivity.java` is SHARED between flavours — see
    // `context/decisions.md`'s own entry on why that stays true). Vyakti's
    // debug APK reinstalls for now rather than inheriting a half-wired
    // updater that points at Meera's manifest.
  },
};

export default config;
