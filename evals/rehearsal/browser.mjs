// evals/rehearsal/browser.mjs — the ONE Chromium launch both rehearsals use.
//
// Three environments run these suites and they differ in exactly one way,
// which browser exists:
//   - the build container: Playwright's full build under /opt/pw-browsers
//     (never `playwright install`, ws-common.md's own law);
//   - the release-gate workflow: `npx playwright install --with-deps
//     chromium`, so Playwright's OWN full build resolves by channel;
//   - the build workflow (build-apk.yml): NO browser at all — it runs the
//     eval suite for the offline batteries and never installs one.
// So the order is: a named binary if one exists, else Playwright's full
// build by channel (never its headless shell, which has no notification
// or permission service — `context/rejected.md#room-push-chromium-headless-
// shell-shows-no-notification`), else a SKIP by name and exit 0, exactly
// `evals/room-push/run.mjs` §8's and `scripts/check-install.mjs`'s posture.
// The skip is honest because the release gate, which does carry a browser,
// runs the identical registry: a rehearsal that cannot run on the build
// workflow still runs on every push.
import { existsSync } from "node:fs";

export const REHEARSAL_CHROMIUM_CANDIDATES = Object.freeze([
  process.env.CHROMIUM_PATH,
  "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  "/opt/pw-browsers/chromium/chrome-linux/chrome",
]);

export function rehearsalChromiumPath() {
  return REHEARSAL_CHROMIUM_CANDIDATES.find((p) => p && existsSync(p)) || null;
}

/** The same launch for a suite that cannot run at all without a browser:
 *  the browser on success, else a `SKIP <suite>: <reason>` line and exit 0.
 *  Codex's mounted-component suites (2026-09-08/09) called
 *  `chromium.launch()` directly and crashed by the dozen on the build
 *  workflow, which carries no browser (`context/rejected.md#direct-chromium-
 *  launches-crashed-the-browserless-build-job`). The skip is honest for the
 *  reason the header gives: the release gate runs the identical registry
 *  with a browser on every push.
 *
 *  `launchOptions` (WS-R165) carries Playwright `launch()` options this
 *  suite needs BEYOND the shared `executablePath`/`channel`/`args` shape —
 *  today, only `notify-browser.mjs`'s `{ headless: false }` (headless
 *  Chromium reports the notification permission as permanently "denied", so
 *  the suite this exists to prove cannot run any other way; see that file's
 *  own header) and `performance-hindi-interface-browser.mjs`'s launch
 *  `timeout`. It is spread LAST, after the shared `executablePath`/`channel`
 *  and `args`, so a caller can override either — `args` included, by passing
 *  its own complete `args` array — but never has to re-derive the binary
 *  resolution this file already owns. */
export async function launchSuiteBrowser(suite, extraArgs = [], launchOptions = {}) {
  const { browser, reason } = await launchRehearsalBrowser(extraArgs, launchOptions);
  if (browser) return browser;
  console.log(`SKIP ${suite}: ${reason}`);
  process.exit(0);
}

/** `{ browser }` on success; `{ browser: null, reason }` when no Chromium
 *  can be launched here. Never throws for a missing binary. */
export async function launchRehearsalBrowser(extraArgs = [], launchOptions = {}) {
  let chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    return { browser: null, reason: "playwright not installed" };
  }
  const executablePath = rehearsalChromiumPath();
  const args = ["--no-sandbox", ...extraArgs];
  const opts = { ...(executablePath ? { executablePath } : { channel: "chromium" }), args, ...launchOptions };
  try {
    const browser = await chromium.launch(opts);
    return { browser, executablePath, channel: executablePath ? null : "chromium" };
  } catch (err) {
    const first = String(err?.message || err).split("\n")[0];
    return {
      browser: null,
      reason: executablePath
        ? `chromium at ${executablePath} failed to launch: ${first}`
        : `no Chromium binary here (no CHROMIUM_PATH, none under /opt/pw-browsers, and Playwright's own chromium channel is not installed): ${first}`,
    };
  }
}
