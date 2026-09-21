import assert from "node:assert/strict";
import { createServer } from "node:http";
import { join, resolve } from "node:path";
import { build } from "vite";
import { launchSuiteBrowser } from "../rehearsal/browser.mjs";

const root = resolve(import.meta.dirname, "../..");
const built = await build({ root, configFile: false, logLevel: "silent", build: { write: false, minify: false, rolldownOptions: { input: join(root, "evals/private-first-meet/host.tsx"), output: { entryFileNames: "probe.js", chunkFileNames: "[name].js", assetFileNames: "[name][extname]" } } } });
const outputs = new Map(built.output.map(item => [`/${item.fileName}`, item.type === "chunk" ? item.code : item.source]));
const server = createServer((req, res) => {
  const path = new URL(req.url, "http://localhost").pathname;
  if (outputs.has(path)) { res.setHeader("Content-Type", path.endsWith(".css") ? "text/css" : "text/javascript"); res.end(outputs.get(path)); return; }
  res.setHeader("Content-Type", "text/html");
  res.end('<!doctype html><link rel="icon" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22/>"/><div id="root"></div><script type="module" src="/probe.js"></script>');
});
let browser;
try {
  await new Promise(resolveListen => server.listen(0, "127.0.0.1", resolveListen));
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await launchSuiteBrowser("private-first-meet");
  let page;
  const errors = [];
  const open = async query => {
    await page?.close();
    page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`${origin}/?${query}`);
    await page.locator(".vx-shell").waitFor();
  };

  await open("view=enrich&saved=1&text=1");
  await page.getByRole("button", { name: "Files, images, links" }).click();
  await page.getByText("My notes.txt").waitFor();
  await page.getByRole("button", { name: "Back to choices" }).click();
  await page.getByRole("button", { name: "Back to voice" }).click();
  await page.getByRole("heading", { name: "Voice verification is not available yet." }).waitFor();
  const pending = page.locator('[aria-labelledby="vx-verification-pending-title"]');
  assert.equal(await pending.getByRole("button", { name: "Test a private draft" }).count(), 1);
  await pending.getByRole("button", { name: "Test a private draft" }).click();
  await page.locator(".ptr-panel").waitFor();
  console.log("ok 1 - a saved personal sheet and ready text item open the private first Meet");

  await open("view=enrich&saved=1&text=0");
  assert.equal(await page.evaluate(() => window.privateMeetProbe.hasText), false);
  await page.getByRole("button", { name: "Files, images, links" }).click();
  await page.getByRole("button", { name: "Back to choices" }).click();
  await page.getByRole("button", { name: "Back to voice" }).click();
  const blockedPending = page.locator('[aria-labelledby="vx-verification-pending-title"]');
  assert.equal(await blockedPending.getByRole("button", { name: "Test a private draft" }).count(), 0);
  await blockedPending.getByRole("button", { name: "Back to knowledge" }).click();
  await page.getByRole("heading", { name: "Add more of you." }).waitFor();
  console.log("ok 2 - missing text material exposes an honest, usable knowledge exit");

  await open("view=enrich&enrichView=humanos&saved=0&text=1");
  await page.locator(".humanos-studio").waitFor();
  await page.locator(".person-model-action button").click();
  await page.waitForFunction(() => window.privateMeetProbe.sheet[window.privateMeetProbe.selected] === true);
  console.log("ok 3 - a successful personal-sheet save propagates to the current parent scope");

  await open("view=enrich&enrichView=humanos&saved=0&text=1&delay=1");
  await page.locator(".humanos-studio").waitFor();
  await page.locator(".person-model-action button").click();
  await page.locator("#fixture-switch").click();
  await page.waitForTimeout(350);
  const switched = await page.evaluate(() => window.privateMeetProbe);
  assert.equal(switched.selected, "10000000-0000-4000-8000-000000000002");
  assert.equal(switched.sheet["10000000-0000-4000-8000-000000000001"], false);
  assert.equal(switched.sheet["10000000-0000-4000-8000-000000000002"], false);
  console.log("ok 4 - a late save cannot cross a replica or account scope switch");
  assert.deepEqual(errors, []);
  console.log("4 mounted private-first-Meet checks passed in full Chromium");
} finally {
  await browser?.close();
  await new Promise(resolveClose => server.close(resolveClose));
}
