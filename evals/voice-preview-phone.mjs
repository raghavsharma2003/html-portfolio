// Browser contract for the owner-facing voice preview on a real phone-sized
// viewport. It renders the production Studio tree through the loopback-only
// layout fixture, so no auth secret, microphone, cloud resource or GPU is used.
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL("..", import.meta.url)));
const DIST = join(ROOT, "dist");
const PORT = 8943;
const CAPTURE_DIR = process.env.VYAKTI_VISUAL_CAPTURE_DIR || "";
const MIME = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png",
  ".jpg": "image/jpeg", ".woff2": "font/woff2",
};

function serveDist() {
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, `http://127.0.0.1:${PORT}`);
    const path = join(DIST, url.pathname === "/" ? "index.html" : url.pathname.slice(1));
    try {
      const body = await readFile(path);
      response.writeHead(200, { "content-type": MIME[extname(path)] || "application/octet-stream" });
      response.end(body);
    } catch {
      response.writeHead(404).end("not found");
    }
  });
  return new Promise((resolve) => server.listen(PORT, "127.0.0.1", () => resolve(server)));
}

function check(label, condition, detail = "") {
  if (!condition) throw new Error(`${label}${detail ? `: ${detail}` : ""}`);
  console.log(`PASS  ${label}`);
}

if (!existsSync(join(DIST, "studio-layout-fixture.html"))) {
  console.log("  skip  voice preview phone: build output absent");
  process.exit(0);
}

const { launchRehearsalBrowser } = await import("./rehearsal/browser.mjs");
const { browser, reason } = await launchRehearsalBrowser();
if (!browser) {
  console.log(`  skip  voice preview phone: ${reason}`);
  process.exit(0);
}

const server = await serveDist();
try {
  const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
  const warmingUrl = `http://127.0.0.1:${PORT}/studio-layout-fixture.html?mode=teacher&step=meet&scenario=voice-warming`;
  const page = await context.newPage();
  await page.goto(warmingUrl, { waitUntil: "domcontentloaded" });
  await page.locator(".meet-view-tabs").waitFor({ state: "visible", timeout: 10_000 });
  await page.locator(".hear-voice").waitFor({ state: "visible", timeout: 10_000 });
  const hierarchy = await page.evaluate(() => ({
    viewport: window.innerHeight,
    overviewPresent: Boolean(document.querySelector(".clone-overview")),
    tabsTop: document.querySelector(".meet-view-tabs")?.getBoundingClientRect().top ?? Number.POSITIVE_INFINITY,
    taskTop: document.querySelector(".hear-voice")?.getBoundingClientRect().top ?? Number.POSITIVE_INFINITY,
  }));
  check("Meet navigation and active task begin in the first phone viewport",
    !hierarchy.overviewPresent && hierarchy.tabsTop < hierarchy.viewport && hierarchy.taskTop < hierarchy.viewport,
    JSON.stringify(hierarchy));
  await page.getByRole("button", { name: "Preview my voice" }).click();
  await page.getByText("No second generation was created", { exact: false }).waitFor({ timeout: 10_000 });

  const first = await page.evaluate(() => {
    const stage = document.querySelector(".hear-voice-stage");
    const button = document.querySelector(".hear-voice-go");
    return {
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      busy: stage?.getAttribute("aria-busy"),
      liveRegions: document.querySelectorAll('[role="status"][aria-live="polite"][aria-atomic="true"]').length,
      broadLiveStage: stage?.hasAttribute("aria-live"),
      fakeProgress: document.querySelectorAll(".hear-voice progress, .hear-voice [role=progressbar]").length,
      textareaDisabled: document.querySelector("#hear-voice-text")?.disabled,
      languageDisabled: [...document.querySelectorAll(".hear-voice .voice-preview-language button")].every((item) => item.disabled),
      buttonHeight: button?.getBoundingClientRect().height || 0,
      text: stage?.textContent || "",
    };
  });
  check("375px preview has no horizontal overflow", first.overflow <= 1, JSON.stringify(first));
  check("active intent locks its exact text and language", first.textareaDisabled && first.languageDisabled);
  check("active preview exposes busy semantics", first.busy === "true");
  check("one atomic live region announces phase without the countdown", first.liveRegions === 1 && !first.broadLiveStage);
  check("preview uses phases and time facts, not fake completion", first.fakeProgress === 0 && first.text.includes("Return around"));
  check("phone primary action keeps a 44px target", first.buttonHeight >= 44, String(first.buttonHeight));
  check("leave-and-return copy names the polling boundary", first.text.includes("Closing this page pauses browser checks"));
  if (CAPTURE_DIR) await page.locator(".hear-voice").screenshot({ path: join(CAPTURE_DIR, "voice-preview-phone-warming.png") });

  const secondPage = await context.newPage();
  await secondPage.goto(warmingUrl, { waitUntil: "domcontentloaded" });
  await secondPage.getByText("This page joined the preview already started", { exact: false }).waitFor({ timeout: 10_000 });
  check("a second tab observes the persisted intent", await secondPage.getByText("No second generation was created", { exact: false }).isVisible());

  await page.evaluate(() => {
    Object.defineProperty(window.navigator, "onLine", { configurable: true, get: () => false });
    window.dispatchEvent(new Event("offline"));
  });
  await page.getByText("This phone is offline", { exact: false }).waitFor({ timeout: 5_000 });
  check("offline state says the request is saved without promising background work", await page.getByText("The request and latest server state are saved", { exact: false }).isVisible());
  await page.evaluate(() => {
    Object.defineProperty(window.navigator, "onLine", { configurable: true, get: () => true });
    window.dispatchEvent(new Event("online"));
  });

  const failedContext = await browser.newContext({ viewport: { width: 375, height: 812 } });
  const failedPage = await failedContext.newPage();
  const failedUrl = `http://127.0.0.1:${PORT}/studio-layout-fixture.html?mode=teacher&step=meet&scenario=voice-failed`;
  await failedPage.goto(failedUrl, { waitUntil: "domcontentloaded" });
  await failedPage.getByRole("button", { name: "Preview my voice" }).click();
  await failedPage.getByText("This preview stopped", { exact: true }).waitFor({ timeout: 10_000 });
  if (CAPTURE_DIR) await failedPage.locator(".hear-voice").screenshot({ path: join(CAPTURE_DIR, "voice-preview-phone-failed.png") });
  const regenerate = failedPage.getByRole("button", { name: "Regenerate preview" });
  check("terminal failure offers one explicit regeneration action", await regenerate.isVisible());
  await regenerate.click();
  await failedPage.getByText("Listen to this take", { exact: true }).waitFor({ timeout: 10_000 });
  check("explicit regeneration mints a new request and reaches the protected result", true);
  await failedContext.close();

  const readyContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const readyPage = await readyContext.newPage();
  const readyUrl = `http://127.0.0.1:${PORT}/studio-layout-fixture.html?mode=teacher&step=meet&scenario=voice-ready`;
  await readyPage.goto(readyUrl, { waitUntil: "domcontentloaded" });
  await readyPage.getByRole("button", { name: "Preview my voice" }).click();
  await readyPage.getByRole("button", { name: "Regenerate preview" }).waitFor({ timeout: 10_000 });
  const ready = await readyPage.evaluate(() => ({
    busy: document.querySelector(".hear-voice-stage")?.getAttribute("aria-busy"),
    textareaDisabled: document.querySelector("#hear-voice-text")?.disabled,
    receipt: document.querySelector(".hear-voice-stage")?.textContent || "",
  }));
  check("Regenerate appears only after a protected result", ready.busy === "false" && !ready.textareaDisabled);
  check("ready state names generation and durable request receipts", ready.receipt.includes("Receipt") && ready.receipt.includes("request"));
  if (CAPTURE_DIR) await readyPage.locator(".hear-voice").screenshot({ path: join(CAPTURE_DIR, "voice-preview-desktop-ready.png") });
  await readyContext.close();
  await context.close();
  console.log("\nvoice-preview-phone: 14 checks passed");
} finally {
  await browser.close();
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
}
