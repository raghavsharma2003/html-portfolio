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

/** `{ browser }` on success; `{ browser: null, reason }` when no Chromium
 *  can be launched here. Never throws for a missing binary. */
export async function launchRehearsalBrowser(extraArgs = []) {
  let chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    return { browser: null, reason: "playwright not installed" };
  }
  const executablePath = rehearsalChromiumPath();
  const args = ["--no-sandbox", ...extraArgs];
  const opts = executablePath ? { executablePath, args } : { channel: "chromium", args };
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
