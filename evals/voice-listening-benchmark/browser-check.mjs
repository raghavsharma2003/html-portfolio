import assert from "node:assert/strict";
import { existsSync } from "node:fs";

import { chromium } from "playwright";

const url = process.argv[2] || "http://127.0.0.1:8792/";
const knownChrome = [
  process.env.VYAKTI_CHROME_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
].find((candidate) => candidate && existsSync(candidate));
const launchOptions = knownChrome ? { headless: true, executablePath: knownChrome } : { headless: true };
const browser = await chromium.launch(launchOptions);
const results = [];

try {
  for (const viewport of [
    { width: 390, height: 844, name: "mobile" },
    { width: 1440, height: 1_000, name: "desktop" },
  ]) {
    const page = await browser.newPage({ viewport });
    const issues = [];
    page.on("console", (message) => {
      if (["warning", "error"].includes(message.type())) issues.push(`${message.type()}:${message.text()}`);
    });
    page.on("pageerror", (error) => issues.push(`pageerror:${error.message}`));

    await page.goto(url, { waitUntil: "networkidle" });
    const intro = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
    }));
    assert.equal(intro.scrollWidth, intro.clientWidth, `${viewport.name} intro has horizontal overflow`);

    await page.getByRole("button", { name: "Play the real owner", exact: true }).click();
    await page.getByPlaceholder("Your name or a short session label").fill(`${viewport.name}-layout-check`);
    await page.getByRole("button", { name: "Start blind check" }).click();
    await page.getByRole("button", { name: "Play this clip", exact: true }).click();
    const firstRating = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
      nextDisabled: [...document.querySelectorAll("button")].find((button) => button.textContent === "Next")?.disabled,
    }));
    assert.equal(firstRating.scrollWidth, firstRating.clientWidth, `${viewport.name} rating screen has horizontal overflow`);
    assert.equal(firstRating.nextDisabled, true, `${viewport.name} rating screen did not fail closed`);
    assert.deepEqual(issues, [], `${viewport.name} emitted browser issues`);
    results.push({ viewport: viewport.name, intro, firstRating, issues: issues.length });
    await page.close();
  }
} finally {
  await browser.close();
}

console.log(JSON.stringify({ ok: true, url, results }, null, 2));
