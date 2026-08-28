import assert from "node:assert/strict";
import { chromium } from "playwright";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { existsSync } from "node:fs";

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
  await page.goto(`${base}/evals/studio-voice-enrollment/harness.html`, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "Create a voice only Microsoft can verify" }).waitFor();
  assert.equal(await page.locator(".voice-enrollment-grid").evaluate((node) => getComputedStyle(node).gridTemplateColumns.split(" ").length), 2);
  assert.match(await page.locator(".voice-provider-state").innerText(), /ready/i);
  assert.equal(errors.length, 0, `browser errors: ${errors.join(" | ")}`);
  const desktop = join(tmpdir(), "vyakti-voice-enrollment-desktop.png");
  await page.screenshot({ path: desktop, fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload({ waitUntil: "networkidle" });
  assert.equal(await page.locator(".voice-enrollment-grid").evaluate((node) => getComputedStyle(node).gridTemplateColumns.split(" ").length), 1);
  assert.equal((await page.locator("body").evaluate((body) => body.scrollWidth <= window.innerWidth)), true);
  const mobile = join(tmpdir(), "vyakti-voice-enrollment-mobile.png");
  await page.screenshot({ path: mobile, fullPage: true });
  console.log(JSON.stringify({ desktop, mobile }));
} finally {
  await browser.close();
}
