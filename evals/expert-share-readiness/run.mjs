// Mounted real ExpertSharePanel -> DeployStudio -> RoomStudio integration.
// Synthetic localhost HTTP only; no database, provider, publication, or cloud writes.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { launchSuiteBrowser } from "../rehearsal/browser.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const first = "33333333-3333-4333-8333-333333333333";
const roomReads = [];
const pending = [];
let roomMode = "normal";
let server;
let browser;

const readiness = replicaId => ({
  readiness: {
    replica_id: replicaId,
    state: "needs_input",
    blockers: [],
    drafts: [],
    context_items: [],
    selected: null,
    statement_set: "text-publication-owner-v1",
    statements: [],
    can_publish: false,
    publications: [],
  },
});

try {
  const built = await build({
    root,
    configFile: false,
    logLevel: "silent",
    build: { write: false, minify: true, rolldownOptions: { input: join(root, "evals/expert-share-readiness/host.html") } },
  });
  const assets = new Map(built.output.map(item => ["/" + item.fileName, item.type === "chunk" ? item.code : item.source]));
  server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://fixture");
    const send = (status, data) => {
      if (res.destroyed) return;
      res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify(data));
    };
    if (url.pathname === "/api/replica-text-publication") {
      assert.equal(req.method, "GET");
      const replicaId = url.searchParams.get("replica_id");
      assert.match(req.headers.authorization || "", /^Bearer token-[ab]$/);
      send(200, readiness(replicaId));
      return;
    }
    if (url.pathname === "/api/room-publish") {
      assert.equal(req.method, "GET", "opening readiness performs no Room mutation");
      const read = { replicaId: url.searchParams.get("replica_id"), authorization: req.headers.authorization };
      roomReads.push(read);
      const finish = () => send(200, { room: null, reason: "not_created", blockers: { waiting_on_you: [], waiting_on_us: [] } });
      if (roomMode === "pending") pending.push(finish); else finish();
      return;
    }
    const asset = assets.get(url.pathname);
    if (asset !== undefined) {
      res.writeHead(200, { "content-type": extname(url.pathname) === ".html" ? "text/html" : extname(url.pathname) === ".css" ? "text/css" : "text/javascript" });
      res.end(asset);
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await launchSuiteBrowser("expert-share-readiness-ui");
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", route => route.request().url().startsWith(origin) ? route.continue() : route.abort());
  await page.goto(origin + "/evals/expert-share-readiness/host.html");
  await page.getByRole("heading", { name: "Share your knowledge" }).waitFor();

  await page.getByText("Voice and other channels", { exact: true }).click();
  const readinessButton = page.getByRole("button", { name: "Review readiness", exact: true });
  await readinessButton.waitFor();
  assert.equal(await readinessButton.evaluate(node => node.tagName), "BUTTON");
  assert.equal(await page.getByRole("link", { name: "Review readiness", exact: true }).count(), 0);
  await readinessButton.click();
  await page.getByRole("heading", { name: "Deploy your AI." }).waitFor();
  await page.locator("#room-studio").waitFor();
  // The panel mounts before its asynchronous readiness response is rendered.
  // Wait for the actual usable control, not just the loading container.
  await page.getByRole("button", { name: "Set up your Room", exact: true }).waitFor();
  assert.deepEqual(roomReads, [{ replicaId: first, authorization: "Bearer token-a" }]);
  assert.equal(await page.getByRole("button", { name: "Set up your Room", exact: true }).count(), 1);
  assert.equal(await page.locator('a[href*="mode=teacher"]').count(), 0);
  console.log("PASS readiness button mounts actual local DeployStudio and RoomStudio without an external URL or mutation");

  await page.getByRole("button", { name: "Back to sharing", exact: true }).click();
  await page.getByRole("heading", { name: "Share your knowledge" }).waitFor();
  assert.equal(await page.locator("#room-studio").count(), 0);
  console.log("PASS Back to sharing restores the existing material-publication surface");

  roomMode = "pending";
  await page.getByText("Voice and other channels", { exact: true }).click();
  await page.getByRole("button", { name: "Review readiness", exact: true }).click();
  await page.getByRole("heading", { name: "Deploy your AI." }).waitFor();
  while (!pending.length) await new Promise(resolve => setTimeout(resolve, 10));
  await page.evaluate(() => window.shareProbe.scope());
  await page.getByRole("heading", { name: "Share your knowledge" }).waitFor();
  pending.shift()();
  await page.waitForTimeout(50);
  assert.equal(await page.locator("#room-studio").count(), 0);
  assert.equal(await page.getByRole("heading", { name: "Deploy your AI." }).count(), 0);
  console.log("PASS account/replica scope change drops the local readiness view before the old read settles");

  await page.getByText("Voice and other channels", { exact: true }).click();
  await page.getByRole("button", { name: "Review readiness", exact: true }).click();
  while (!pending.length) await new Promise(resolve => setTimeout(resolve, 10));
  await page.evaluate(() => window.shareProbe.hide());
  pending.shift()();
  await page.waitForTimeout(50);
  assert.equal(await page.locator(".vx-expert-share").count(), 0);
  assert.deepEqual(errors, []);
  console.log("PASS unmount during the Room readiness read leaves no visible resurrection or runtime error");
  console.log("4/4 mounted expert-share readiness checks passed");
} finally {
  for (const finish of pending) finish();
  await browser?.close();
  server?.closeAllConnections();
  if (server) await new Promise(resolve => server.close(resolve));
}
