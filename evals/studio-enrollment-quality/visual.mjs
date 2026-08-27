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
  await page.goto(`${base}/evals/studio-enrollment-quality/harness.html`, { waitUntil: "networkidle" });

  await page.getByRole("heading", { name: "Voice reference coverage" }).waitFor();
  assert.match(await page.locator(".language-readiness-list").innerText(), /English[\s\S]*Reference ready/);
  assert.match(await page.locator(".language-readiness-list").innerText(), /Hindi[\s\S]*In private processing/);
  assert.match(await page.locator(".language-gap").innerText(), /Hinglish is not confirmed yet/);
  await page.getByRole("button", { name: "Add Hinglish calibration" }).click();

  await page.locator('input[type="file"]').setInputFiles([
    { name: "lesson-one.wav", mimeType: "audio/wav", buffer: Buffer.alloc(4096) },
    { name: "lesson-two.wav", mimeType: "audio/wav", buffer: Buffer.alloc(4096) },
    { name: "code-switch.wav", mimeType: "audio/wav", buffer: Buffer.alloc(4096) },
  ]);
  const queueLanguages = page.locator(".queue-language select");
  await queueLanguages.nth(0).selectOption("english");
  await queueLanguages.nth(1).selectOption("hindi");
  await queueLanguages.nth(2).selectOption("hinglish");
  assert.equal(await page.locator(".intake-queue li").count(), 3);
  assert.equal(await page.locator("body").evaluate((body) => body.scrollWidth <= window.innerWidth), true);

  const desktop = join(tmpdir(), "vyakti-studio-enrollment-quality-desktop.png");
  await page.screenshot({ path: desktop, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.locator("body").evaluate((body) => body.scrollWidth <= window.innerWidth), true);
  const mobile = join(tmpdir(), "vyakti-studio-enrollment-quality-mobile.png");
  await page.screenshot({ path: mobile, fullPage: true });
  assert.equal(errors.length, 0, `browser errors: ${errors.join(" | ")}`);
  console.log(JSON.stringify({ desktop, mobile }));
} finally {
  await browser.close();
}
