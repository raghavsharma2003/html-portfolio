import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { chromium } from "playwright";

const base = process.env.VYAKTI_VISUAL_BASE || "http://127.0.0.1:5173";
const SOURCE = "20000000-0000-4000-8000-000000000002";
const systemChrome = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || (existsSync(systemChrome) ? systemChrome : undefined);
const browser = await chromium.launch({ headless: true, executablePath });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 1 });
  const errors = [];
  await page.route("**/favicon.ico", (route) => route.fulfill({ status: 204, body: "" }));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto(`${base}/evals/identity-proofing/harness.html?state=none`, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "Bind one real person to this replica" }).waitFor();
  assert.equal(await page.getByRole("checkbox").count(), 5);
  const submit = page.getByRole("button", { name: "Submit for independent verification" });
  assert.equal(await submit.isDisabled(), true);
  await page.getByLabel("Private ID source").selectOption(SOURCE);
  for (const checkbox of await page.getByRole("checkbox").all()) await checkbox.check();
  assert.equal(await submit.isEnabled(), true);
  const desktop = join(tmpdir(), "vyakti-identity-proofing-desktop.png");
  await page.screenshot({ path: desktop, fullPage: true });

  const pendingPage = await browser.newPage({ viewport: { width: 1000, height: 700 } });
  await pendingPage.route("**/favicon.ico", (route) => route.fulfill({ status: 204, body: "" }));
  pendingPage.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  pendingPage.on("pageerror", (error) => errors.push(error.message));
  await pendingPage.goto(`${base}/evals/identity-proofing/harness.html?state=submitted`, { waitUntil: "networkidle" });
  await pendingPage.getByRole("heading", { name: "Authenticity and age review in progress" }).waitFor();
  assert.match(await pendingPage.locator(".identity-pending").innerText(), /No name, date of birth, document number/i);
  await pendingPage.close();

  const readyPage = await browser.newPage({ viewport: { width: 1000, height: 700 } });
  await readyPage.route("**/favicon.ico", (route) => route.fulfill({ status: 204, body: "" }));
  readyPage.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  readyPage.on("pageerror", (error) => errors.push(error.message));
  await readyPage.goto(`${base}/evals/identity-proofing/harness.html?state=evidence_ready`, { waitUntil: "networkidle" });
  await readyPage.getByRole("heading", { name: "Adult ID evidence is ready for live comparison" }).waitFor();
  assert.match(await readyPage.locator(".identity-ready").innerText(), /Identity is not complete yet/i);
  await readyPage.close();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${base}/evals/identity-proofing/harness.html?state=none`, { waitUntil: "networkidle" });
  assert.equal(await page.locator("body").evaluate((body) => body.scrollWidth <= window.innerWidth), true);
  assert.equal(await page.getByRole("checkbox").count(), 5);
  const mobile = join(tmpdir(), "vyakti-identity-proofing-mobile.png");
  await page.screenshot({ path: mobile, fullPage: true });

  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto(`${base}/evals/identity-proofing/enrollment-harness.html`, { waitUntil: "networkidle" });
  await page.getByLabel("Source type").selectOption("identity_document");
  await page.getByText("Identity-only mode bypasses memory extraction", { exact: false }).waitFor();
  assert.equal(await page.getByText("Other people appear", { exact: true }).count(), 0);
  const intake = join(tmpdir(), "vyakti-identity-only-intake-desktop.png");
  await page.screenshot({ path: intake, fullPage: true });
  assert.equal(errors.length, 0, `browser errors: ${errors.join(" | ")}`);
  console.log(JSON.stringify({ desktop, mobile, intake }));
} finally {
  await browser.close();
}
