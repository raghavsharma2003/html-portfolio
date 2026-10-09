import assert from "node:assert/strict";
import { createServer } from "node:http";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { launchSuiteBrowser } from "../rehearsal/browser.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const roomStub = "\0deploy-profile-room-stub.tsx";
let server;
let browser;

try {
  const built = await build({
    root,
    configFile: false,
    logLevel: "silent",
    build: { write: false, minify: true, rolldownOptions: { input: join(root, "evals/deploy-profile-routing/host.html") } },
    plugins: [{
      name: "deploy-profile-room-stub",
      enforce: "pre",
      resolveId(id) { if (id === "../creatorStudio/RoomStudio") return roomStub; },
      load(id) {
        if (id !== roomStub) return;
        return `
          import { useEffect, useState } from "react";
          export default function RoomStub({ onGoStep, onRoomState }) {
            const [ready, setReady] = useState(false);
            const kind = new URLSearchParams(location.search).get("blocker") || "none";
            const anchor = kind === "profile" ? "#teacher-sheet-studio" : kind === "readiness" ? "#readiness-title" : kind === "unknown" ? "#future-blocker" : null;
            useEffect(() => {
              onRoomState(null, null, anchor ? { label: kind, anchor, cls: "you" } : null);
              setReady(true);
            }, [anchor, kind, onRoomState]);
            return <button type="button" disabled={!ready} onClick={() => onGoStep("meet")}>Open blocker</button>;
          }
        `;
      },
    }],
  });
  const assets = new Map(built.output.map(file => ["/" + file.fileName, file.type === "chunk" ? file.code : file.source]));
  server = createServer((req, res) => {
    const url = new URL(req.url, "http://fixture");
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
  browser = await launchSuiteBrowser("deploy-profile-routing");
  const context = await browser.newContext({ viewport: { width: 1200, height: 900 }, reducedMotion: "reduce" });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);

  const events = () => page.evaluate(() => window.routeEvents);
  const reset = () => page.evaluate(() => { window.routeEvents = []; });
  const banner = () => page.getByRole("button", { name: "Review profile", exact: true });

  await page.goto(`${origin}/evals/deploy-profile-routing/host.html?blocker=none`);
  await banner().click();
  assert.deepEqual(await events(), ["profile"]);
  console.log("ok pointer click opens Personality");

  await reset();
  await banner().focus();
  await page.keyboard.press("Enter");
  assert.deepEqual(await events(), ["profile"]);
  console.log("ok Enter opens Personality");

  await reset();
  await banner().focus();
  await page.keyboard.press("Space");
  assert.deepEqual(await events(), ["profile"]);
  console.log("ok Space opens Personality");

  for (const [kind, expected] of [["profile", "profile"], ["readiness", "corrections"], ["unknown", "corrections"]]) {
    await page.goto(`${origin}/evals/deploy-profile-routing/host.html?blocker=${kind}`);
    const blocker = page.getByRole("button", { name: "Open blocker", exact: true });
    await blocker.waitFor();
    await page.waitForFunction(() => !(document.querySelector("button:last-of-type")?.disabled));
    await blocker.click();
    assert.deepEqual(await events(), [expected]);
    console.log(`ok ${kind} blocker opens ${expected}`);
  }

  await context.close();
  console.log("PASS 6 mounted routing cases");
} finally {
  await browser?.close();
  server?.closeAllConnections();
  if (server) await new Promise(resolve => server.close(resolve));
}
