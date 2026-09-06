import { syntheticPcmWav } from "./synthetic-wav.mjs";
import assert from "node:assert/strict";
import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";

const base = process.env.VYAKTI_VISUAL_BASE || "http://127.0.0.1:5173";
const reviewDir = resolve(import.meta.dirname, "../../.impeccable/review");
const systemChrome = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
mkdirSync(reviewDir, { recursive: true });

const browser = await chromium.launch({ headless: true, executablePath: existsSync(systemChrome) ? systemChrome : undefined });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, reducedMotion: "reduce" });
  const errors = [];
  await page.route("**/favicon.ico", (route) => route.fulfill({ status: 204, body: "" }));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", (error) => errors.push(error.message));

  for (const viewport of [
    { name: "phone", width: 390, height: 844 },
    { name: "landscape", width: 844, height: 390 },
    { name: "desktop", width: 1440, height: 900 },
  ]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto(`${base}/evals/clone-experience-qa/harness.html?scenario=recorder`, { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "Say something only you would say." }).waitFor();
    const metrics = await page.evaluate(() => {
      const field = document.querySelector(".vx-voice-field");
      const record = document.querySelector(".vx-record-button");
      const marks = document.querySelector(".vx-aperture-marks");
      return {
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        fieldWidth: field?.getBoundingClientRect().width ?? 0,
        recordWidth: record?.getBoundingClientRect().width ?? 0,
        recordHeight: record?.getBoundingClientRect().height ?? 0,
        rayCount: document.querySelectorAll(".vx-voice-field__rays line").length,
        markText: document.querySelector(".vx-wordmark")?.textContent?.replace(/\s+/gu, " ").trim() ?? "",
        marksVisible: marks ? getComputedStyle(marks).display !== "none" : false,
        runtimeError: document.documentElement.dataset.qaRuntimeError || "",
      };
    });
    assert.ok(metrics.overflow <= 1, `${viewport.name}: ${JSON.stringify(metrics)}`);
    assert.ok(metrics.fieldWidth >= 260, `${viewport.name}: ${JSON.stringify(metrics)}`);
    assert.ok(metrics.recordWidth >= 96 && metrics.recordHeight >= 96, `${viewport.name}: ${JSON.stringify(metrics)}`);
    assert.equal(metrics.rayCount, 96, `${viewport.name}: ${JSON.stringify(metrics)}`);
    assert.match(metrics.markText, /व्य\s*vyakti\.ai/u, `${viewport.name}: ${JSON.stringify(metrics)}`);
    assert.equal(metrics.marksVisible, true, `${viewport.name}: ${JSON.stringify(metrics)}`);
    assert.equal(metrics.runtimeError, "", `${viewport.name}: ${JSON.stringify(metrics)}`);
    await page.screenshot({ path: resolve(reviewDir, `clone-experience-voice-field-${viewport.name}.png`), fullPage: true });
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${base}/evals/clone-experience-qa/harness.html?scenario=recorder`, { waitUntil: "networkidle" });
  // Valid browser-decodable synthetic PCM, not an owner recording or quality test.
  const wav = syntheticPcmWav();
  assert.equal(wav.toString("ascii", 0, 4), "RIFF");
  assert.equal(wav.toString("ascii", 8, 12), "WAVE");
  assert.equal(wav.readUInt16LE(22), 1);
  assert.equal(wav.readUInt32LE(24), 24000);
  assert.equal(wav.readUInt16LE(34), 16);
  await page.locator(".vx-visually-hidden[type=file]").setInputFiles({ name: "synthetic-layout-tone.wav", mimeType: "audio/wav", buffer: wav });
  const decoded = await page.locator(".vx-sample audio").evaluate(async (audio) => {
    if (audio.readyState < 1) await new Promise((resolve, reject) => {
      audio.addEventListener("loadedmetadata", resolve, { once: true });
      audio.addEventListener("error", reject, { once: true });
    });
    return audio.duration;
  });
  assert.equal(decoded, 13, "browser decodes thirteen seconds of synthetic PCM");
  await page.getByRole("heading", { name: "Your voice is ready to become." }).waitFor();
  const review = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    cardOverflow: document.querySelector(".vx-sample")?.scrollWidth - document.querySelector(".vx-sample")?.clientWidth,
    minAction: Math.min(...[...document.querySelectorAll(".vx-sample button")].map((node) => node.getBoundingClientRect().height)),
    headerBottom: document.querySelector(".vx-header")?.getBoundingClientRect().bottom ?? 0,
    titleTop: document.querySelector(".vx-stage-title")?.getBoundingClientRect().top ?? 0,
    wordmark: (() => { const node = document.querySelector(".vx-wordmark"); return node ? { rect: node.getBoundingClientRect().toJSON(), display: getComputedStyle(node).display, opacity: getComputedStyle(node).opacity, text: node.textContent } : null; })(),
    account: (() => { const node = document.querySelector(".vx-account"); return node ? { rect: node.getBoundingClientRect().toJSON(), display: getComputedStyle(node).display, opacity: getComputedStyle(node).opacity } : null; })(),
  }));
  assert.ok(review.overflow <= 1 && review.cardOverflow <= 1, JSON.stringify(review));
  assert.ok(review.minAction >= 44, JSON.stringify(review));
  assert.ok(review.titleTop >= review.headerBottom + 8, JSON.stringify(review));
  assert.ok(review.wordmark?.rect?.width >= 90 && review.account?.rect?.width >= 44, JSON.stringify(review));
  await page.screenshot({ path: resolve(reviewDir, "clone-experience-voice-field-review-phone.png"), fullPage: true });

  await page.setViewportSize({ width: 720, height: 450 });
  await page.goto(`${base}/evals/clone-experience-qa/harness.html?scenario=recorder`, { waitUntil: "networkidle" });
  await page.evaluate(() => { document.documentElement.style.zoom = "2"; });
  const reflow = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    recordHeight: document.querySelector(".vx-record-button")?.getBoundingClientRect().height ?? 0,
  }));
  assert.ok(reflow.overflow <= 1, JSON.stringify(reflow));
  assert.ok(reflow.recordHeight >= 44, JSON.stringify(reflow));
  assert.equal(errors.length, 0, errors.join(" | "));
  console.log("3 premium recorder viewports and 200% reflow passed");
} finally {
  await browser.close();
}
