import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { launchSuiteBrowser } from "./rehearsal/browser.mjs";

const root = join(fileURLToPath(new URL("..", import.meta.url)));
const dist = join(root, "dist");
const port = 8963;
const replica = "fixture-replica-0001";
const screenshotPath = join(root, "scratchpad", "internal-voice-ui", "internal-voice-owner-390.png");
const wav = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(40)]);
const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2" };

const server = createServer(async (request, response) => {
  const url = new URL(request.url, `http://127.0.0.1:${port}`);
  const path = join(dist, url.pathname === "/" ? "index.html" : url.pathname.slice(1));
  try {
    const body = await readFile(path);
    response.writeHead(200, { "content-type": mime[extname(path)] || "application/octet-stream" });
    response.end(body);
  } catch {
    response.writeHead(404).end("not found");
  }
});
await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));

const browser = await launchSuiteBrowser("internal-voice-ui-browser");
try {
  console.log("internal voice browser: opened Chromium");
  const activeUrl = `http://127.0.0.1:${port}/studio-layout-fixture.html?mode=teacher&step=meet&scenario=active-runtime&view=voice&sample=1&internalVoice=browser`;
  const fixtureUrl = activeUrl.replace("scenario=active-runtime", "scenario=voice-ready");
  const disabled = await browser.newPage({ viewport: { width: 390, height: 900 } });
  let disabledRead;
  const disabledHit = new Promise((resolve) => { disabledRead = resolve; });
  await disabled.route("**/api/internal-voice**", async (route) => {
    disabledRead();
    return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ enabled: false }) });
  });
  await disabled.goto(activeUrl, { waitUntil: "domcontentloaded" });
  await disabledHit;
  console.log("internal voice browser: disabled response observed");
  await disabled.getByRole("button", { name: "Preview my voice" }).waitFor();
  assert.equal(await disabled.locator("[data-internal-voice]").count(), 0, "disabled 404 must leave no panel shell");
  await disabled.close();

  let phase = "idle";
  let runId = null;
  let polls = 0;
  let posts = 0;
  const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
  await page.route("**/api/internal-voice**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    assert.match(request.headers().authorization || "", /^Bearer(?:\s|$)/);
    if (url.searchParams.get("action")) {
      assert.equal(url.searchParams.get("replica_id"), replica);
      assert.equal(url.searchParams.get("run_id"), runId);
      return route.fulfill({ status: 200, contentType: "audio/wav", body: wav });
    }
    if (request.method() === "POST") {
      posts += 1;
      const body = request.postDataJSON();
      assert.equal(body.replica_id, replica);
      if (body.action === "generate") {
        runId = body.run_id;
        phase = "queued";
      } else if (body.action === "rate") {
        assert.deepEqual(body.ratings, { owner_likeness: 4, naturalness: 4, indian_accent: 4, pronunciation: 4 });
        phase = "rated";
      } else if (body.action === "revoke") {
        phase = "revoked";
      }
    } else if (runId) {
      assert.equal(url.searchParams.get("run_id"), runId);
      polls += 1;
      if (phase === "queued") phase = "ready";
    }
    const state = phase === "rated" ? "ready" : phase;
    const ratings = phase === "rated" ? { owner_likeness: 4, naturalness: 4, indian_accent: 4, pronunciation: 4 } : null;
    const run = runId ? {
      run_id: runId, state, text: "आज हम इस सवाल को धीरे धीरे समझेंगे, फिर सही उत्तर निकालेंगे।", language_id: "hi",
      playback_url: state === "ready" ? `/api/internal-voice?action=audio&replica_id=${replica}&run_id=${runId}` : null,
      reference_url: `/api/internal-voice?action=reference&replica_id=${replica}&run_id=${runId}`,
      ratings, metrics: state === "ready" ? { total_ms: 12000, model_elapsed_ms: 10000, duration_ms: 4200, real_time_factor: 2.38, first_audible_ms: null } : null,
      error_code: null, cleanup_pending: false,
    } : null;
    return route.fulfill({ status: request.method() === "POST" && request.postDataJSON().action === "generate" ? 202 : 200,
      contentType: "application/json", body: JSON.stringify({ enabled: true, scope: "internal_owner_voice",
        reference: { label: "Your saved voice recording", duration_ms: 25000, available: true }, run,
        can_generate: !run }) });
  });
  await page.goto(fixtureUrl, { waitUntil: "domcontentloaded" });
  console.log("internal voice browser: configured page opened");
  const panel = page.locator("[data-internal-voice]");
  await panel.waitFor();
  await page.getByRole("heading", { name: "Your voice, in Hindi" }).waitFor();
  assert.equal(await panel.evaluate((node) => node.scrollWidth <= node.clientWidth), true);
  const generate = page.getByRole("button", { name: "Generate Hindi sample" });
  assert.ok((await generate.boundingBox()).height >= 44);
  assert.match(await panel.innerText(), /Listen beside your recording\. Tell us what feels like you\./);
  await generate.click();
  await page.getByRole("heading", { name: "Sample ready" }).waitFor({ timeout: 8000 });
  console.log("internal voice browser: same request reached ready");
  assert.equal(posts, 1, "polling must not create another synthesis");
  assert.ok(polls >= 1, "same run UUID was not polled");
  assert.equal(await panel.locator('audio[src^="blob:"]').count(), 2);
  await mkdir(join(root, "scratchpad", "internal-voice-ui"), { recursive: true });
  await page.screenshot({ path: screenshotPath, fullPage: true });
  for (const fieldset of await panel.locator("fieldset").all()) await fieldset.getByRole("button", { name: /4 of 5$/ }).click();
  await page.getByRole("button", { name: "Save ratings" }).click();
  await page.getByRole("heading", { name: "Ratings saved" }).waitFor();
  assert.equal(await panel.locator("fieldset").count(), 0, "saved ratings must be read-only");
  await page.setViewportSize({ width: 1440, height: 1000 });
  assert.equal(await page.locator("body").evaluate((body) => body.scrollWidth <= window.innerWidth), true);
  assert.equal(await panel.locator("dl dd").filter({ hasText: "4 / 5" }).count(), 4);
  await page.getByRole("button", { name: "Remove sample" }).click();
  await page.getByRole("heading", { name: "Sample removed" }).waitFor();
  assert.equal(await panel.locator("audio").count(), 0);
  const voiceTab = page.getByRole("button", { name: "Voice", exact: true });
  assert.equal(await voiceTab.getAttribute("aria-pressed"), "true");
  await page.getByRole("button", { name: "Talk", exact: true }).click();
  await panel.waitFor({ state: "detached" });
  assert.equal(new URL(page.url()).searchParams.get("step"), "meet", "Talk must remain in Meet");

  phase = "unknown";
  runId = "33333333-3333-4333-8333-333333333333";
  polls = 0;
  const hindi = await browser.newPage({ viewport: { width: 390, height: 900 } });
  await hindi.route("**/api/internal-voice**", async (route) => {
    const request = route.request();
    const target = new URL(request.url());
    assert.equal(request.method(), "GET");
    if (target.searchParams.get("action") === "reference") {
      return route.fulfill({ status: 200, contentType: "audio/wav", body: wav });
    }
    if (target.searchParams.get("run_id")) polls += 1;
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ enabled: true, scope: "internal_owner_voice",
      reference: { label: "Your saved voice recording", duration_ms: 25000, available: true }, can_generate: false,
      run: { run_id: runId, state: "unknown", text: "हिंदी", language_id: "hi", playback_url: null,
        reference_url: `/api/internal-voice?action=reference&replica_id=${replica}&run_id=${runId}`, ratings: null,
        metrics: null, error_code: "internal_voice_operation_failed", cleanup_pending: true } }) });
  });
  await hindi.goto(`${fixtureUrl}&lang=hi`, { waitUntil: "domcontentloaded" });
  console.log("internal voice browser: Hindi unknown page opened");
  const hindiPanel = hindi.locator("[data-internal-voice]");
  await hindiPanel.waitFor();
  await hindi.getByRole("heading", { name: "हम इस नमूने की पुष्टि नहीं कर सके" }).waitFor();
  assert.match(await hindiPanel.innerText(), /फिर जाँचें/);
  await hindi.getByRole("button", { name: "फिर जाँचें" }).click();
  assert.equal(polls, 1);
  assert.equal(posts, 3, "read-only retry must not POST");
  assert.equal(await hindi.locator("body").evaluate((body) => body.scrollWidth <= window.innerWidth), true);
  console.log("internal-voice-ui-browser: 16 checks passed at 390px and 1440px");
} finally {
  await browser.close();
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
}
