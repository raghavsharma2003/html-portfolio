import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { chromium } from "playwright";

const base = process.env.VYAKTI_VISUAL_BASE || "http://127.0.0.1:5173";
const systemChrome = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || (existsSync(systemChrome) ? systemChrome : undefined);
const browser = await chromium.launch({ headless: true, executablePath });

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 1 });
  const errors = [];
  await page.route("**/favicon.ico", (route) => route.fulfill({ status: 204, body: "" }));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto(`${base}/evals/liveness-verification/harness.html?state=issued`, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "Prove this recording was made now" }).waitFor();
  await page.getByText("Voice + live face", { exact: true }).waitFor();
  assert.equal(await page.getByRole("radio", { name: /Voice \+ live face/ }).isChecked(), true);
  assert.equal(await page.getByRole("button", { name: "Allow camera and microphone" }).isVisible(), true);
  assert.match(await page.locator(".challenge-card").innerText(), /Code 482 731/);
  const desktop = join(tmpdir(), "vyakti-liveness-issued-desktop.png");
  await page.screenshot({ path: desktop, fullPage: true });

  await page.goto(`${base}/evals/liveness-verification/harness.html?state=uploaded`, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "Waiting for an independent verifier" }).waitFor();
  assert.match(await page.locator(".verification-pending").innerText(), /has not granted biometric, training, inference/i);

  await page.goto(`${base}/evals/liveness-verification/harness.html?state=passed`, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "Live challenge passed" }).waitFor();
  assert.match(await page.locator(".verification-passed").innerText(), /Training and inference permission remain separate/i);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${base}/evals/liveness-verification/harness.html?state=issued`, { waitUntil: "networkidle" });
  assert.equal(await page.locator("body").evaluate((body) => body.scrollWidth <= window.innerWidth), true);
  assert.equal(await page.getByRole("button", { name: "Allow camera and microphone" }).isVisible(), true);
  const mobile = join(tmpdir(), "vyakti-liveness-issued-mobile.png");
  await page.screenshot({ path: mobile, fullPage: true });
  assert.equal(errors.length, 0, `browser errors: ${errors.join(" | ")}`);
  console.log(JSON.stringify({ desktop, mobile }));
} finally {
  await browser.close();
}
