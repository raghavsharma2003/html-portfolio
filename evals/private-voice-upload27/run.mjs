import assert from "node:assert/strict";
import { createServer } from "vite";
import { launchSuiteBrowser } from "../rehearsal/browser.mjs";
import { syntheticPcmWav } from "../clone-experience-qa/synthetic-wav.mjs";

const hardTimeout = setTimeout(() => {
  console.error("private-voice-upload27 exceeded its 60 second bound");
  process.exit(1);
}, 60_000);
const root = new URL("../../", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const server = await createServer({ root, logLevel: "error", server: { host: "127.0.0.1", port: 0, strictPort: true, open: false } });
let browser;
let checks = 0;
const pass = (name) => console.log(`ok ${++checks} - ${name}`);

try {
  await server.listen();
  const address = server.httpServer.address();
  assert.equal(typeof address, "object");
  const origin = `http://127.0.0.1:${address.port}`;
  browser = await launchSuiteBrowser("private-voice-upload27");
  const context = await browser.newContext({ viewport: { width: 390, height: 900 }, reducedMotion: "reduce" });
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  page.setDefaultNavigationTimeout(30_000);
  const pageErrors = [];
  const externalRequests = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.origin === origin || url.protocol === "blob:" || url.protocol === "data:") return route.continue();
    externalRequests.push(route.request().url());
    return route.abort();
  });
  const wav = syntheticPcmWav();
  const chooseWav = async () => {
    await page.getByLabel("Choose your voice recording", { exact: true }).setInputFiles({
      name: "private-owner-fixture.wav", mimeType: "audio/wav", buffer: wav,
    });
    await page.locator(".vx-sample audio").waitFor();
    await page.locator(".vx-source-declaration input").check();
  };
  const counters = () => page.evaluate(() => window.__cloneQa);

  await page.goto(`${origin}/evals/clone-experience-qa/harness.html?scenario=recorder&view=voice&sample=1&private=1`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "Test your voice privately" }).waitFor();
  await page.getByRole("button", { name: "Add a recording" }).click();
  await page.locator(".vx-record-button").waitFor();
  await chooseWav();
  assert.equal(await page.locator(".workbench-sidebar nav button").evaluateAll((buttons) => buttons.length > 0 && buttons.every((button) => button.disabled)), true);
  assert.equal(await page.locator(".workbench-mobile-nav button").evaluateAll((buttons) => buttons.length > 0 && buttons.every((button) => button.disabled)), true);
  pass("an unsaved private sample locks desktop and mobile workspace navigation");

  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByText("Your recording is being prepared.", { exact: true }).waitFor();
  await page.waitForFunction(() => window.__cloneQa.refreshCalls === 1);
  const privateResult = await counters();
  assert.equal(privateResult.createCalls, 1);
  assert.equal(privateResult.xhrSends, 1);
  assert.equal(privateResult.finalizeCalls, 1);
  assert.equal(privateResult.refreshCalls, 1);
  assert.equal(privateResult.buildCalls, 0);
  assert.equal(privateResult.privateGenerateCalls, 0);
  assert.equal(privateResult.languageHint, "hi-latn");
  assert.ok(privateResult.uploadIntent);
  assert.equal(await page.evaluate(() => localStorage.getItem("vyakti:experience:voice-saga:v1:10000000-0000-4000-8000-000000000001")), null);
  pass("private upload uses one create, signed PUT and finalize receipt, returns to processing, and never requests a public build or sample generation");

  await page.goto(`${origin}/evals/clone-experience-qa/harness.html?scenario=recorder&view=voice&sample=1`, { waitUntil: "domcontentloaded" });
  await page.locator(".vx-record-button").waitFor();
  await chooseWav();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.waitForFunction(() => window.__cloneQa.buildCalls === 1);
  const publicResult = await counters();
  assert.equal(publicResult.createCalls, 1);
  assert.equal(publicResult.buildCalls, 1);
  assert.equal(publicResult.privateGenerateCalls, 0);
  pass("the unchanged public upload path still requests exactly one build");

  await page.goto(`${origin}/evals/clone-experience-qa/harness.html?scenario=candidate-ready&view=voice&sample=1&private=1&privateReload=1`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean(window.__cloneQa));
  await page.waitForTimeout(900);
  const reloadResult = await counters();
  assert.equal(reloadResult.buildCalls, 0);
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("vyakti:experience:voice-saga:v1:10000000-0000-4000-8000-000000000001") || "null")?.privateSample), true);
  pass("a reloaded private saga never polls the public voice builder");

  assert.deepEqual(pageErrors, []);
  assert.deepEqual(externalRequests, []);
  assert.equal(await page.evaluate(() => document.documentElement.dataset.qaRuntimeError || ""), "");
  console.log(`PASS ${checks} mounted private upload groups; synthetic file and exact offline routes only.`);
} finally {
  clearTimeout(hardTimeout);
  if (browser) await Promise.race([browser.close(), new Promise((resolve) => setTimeout(resolve, 3000))]);
  await server.close();
}
