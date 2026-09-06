import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { chromium } from "playwright";

const base = process.env.VYAKTI_VISUAL_BASE || "http://127.0.0.1:5173";
const systemChrome = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const browser = await chromium.launch({ headless: true, executablePath: existsSync(systemChrome) ? systemChrome : undefined });
try {
  const page = await browser.newPage({ viewport: { width: 360, height: 640 }, deviceScaleFactor: 1, reducedMotion: "reduce" });
  const errors = [];
  await page.route("**/favicon.ico", (route) => route.fulfill({ status: 204, body: "" }));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${base}/evals/clone-verification-journey/harness.html`, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "Add one private ID." }).waitFor();
  const result = await page.evaluate(() => {
    const shell = document.querySelector(".cvj-shell");
    const stage = document.querySelector(".cvj-stage");
    const header = document.querySelector(".cvj-header");
    const picker = document.querySelector(".cvj-file-picker");
    const buttons = [...document.querySelectorAll(".cvj-shell button")].filter((node) => getComputedStyle(node).display !== "none");
    return {
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      shellHeight: shell?.getBoundingClientRect().height ?? 0,
      stageCount: document.querySelectorAll(".cvj-stage").length,
      stageOverflow: stage ? getComputedStyle(stage).overflowY : "",
      headerTop: header?.getBoundingClientRect().top ?? -1,
      pickerHeight: picker?.getBoundingClientRect().height ?? 0,
      minButtonHeight: Math.min(...buttons.map((node) => node.getBoundingClientRect().height)),
      progressLabel: document.querySelector(".cvj-progress")?.getAttribute("aria-label") ?? "",
    };
  });
  assert.ok(result.overflow <= 1, JSON.stringify(result));
  assert.equal(result.stageCount, 1);
  assert.equal(result.stageOverflow, "auto");
  assert.equal(result.headerTop, 0);
  assert.ok(result.shellHeight >= 640, JSON.stringify(result));
  assert.ok(result.pickerHeight >= 44, JSON.stringify(result));
  assert.ok(result.minButtonHeight >= 44, JSON.stringify(result));
  assert.equal(result.progressLabel, "Verification step 1 of 5");

  await page.setViewportSize({ width: 375, height: 812 });
  await page.reload({ waitUntil: "networkidle" });
  const portrait = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    animationDuration: getComputedStyle(document.querySelector(".cvj-document")).animationDuration,
    pickerHeight: document.querySelector(".cvj-file-picker")?.getBoundingClientRect().height ?? 0,
  }));
  assert.ok(portrait.overflow <= 1, JSON.stringify(portrait));
  assert.ok(portrait.pickerHeight >= 44, JSON.stringify(portrait));
  assert.ok(Number.parseFloat(portrait.animationDuration) <= 0.001, JSON.stringify(portrait));

  await page.setViewportSize({ width: 844, height: 390 });
  await page.reload({ waitUntil: "networkidle" });
  const landscape = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    stageScrollable: document.querySelector(".cvj-stage")?.scrollHeight >= document.querySelector(".cvj-stage")?.clientHeight,
    pickerHeight: document.querySelector(".cvj-file-picker")?.getBoundingClientRect().height ?? 0,
  }));
  assert.ok(landscape.overflow <= 1, JSON.stringify(landscape));
  assert.ok(landscape.pickerHeight >= 44, JSON.stringify(landscape));

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${base}/evals/clone-verification-journey/harness.html?legacy=1`, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "This test clone cannot continue." }).waitFor();
  await page.getByRole("button", { name: "Start clean" }).click();
  await page.getByRole("group", { name: "Confirm test clone erasure" }).waitFor();
  const legacy = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    resetRequested: document.body.dataset.resetRequested || "",
    destructiveHeight: document.querySelector(".cvj-primary--danger")?.getBoundingClientRect().height ?? 0,
  }));
  assert.ok(legacy.overflow <= 1, JSON.stringify(legacy));
  assert.equal(legacy.resetRequested, "");
  assert.ok(legacy.destructiveHeight >= 44, JSON.stringify(legacy));
  await page.getByRole("button", { name: "Erase and start again" }).click();
  await page.waitForFunction(() => document.body.dataset.resetRequested === "true");
  assert.equal(errors.length, 0, errors.join(" | "));
  console.log("3 mobile clone verification viewports and the confirmed legacy reset passed");
} finally {
  await browser.close();
}
