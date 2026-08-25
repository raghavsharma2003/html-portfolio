// task #134 — `.home-back` painting OVER every bottom sheet and over
// StoryView, in a real browser.
//
//   npx vite build
//   npx vite preview --port 4292 --strictPort &
//   xvfb-run -a node evals/zorder-browser.mjs            # assert
//   xvfb-run -a node evals/zorder-browser.mjs --observe  # print, never fail
//
// ── the defect, and why it needs a browser ──────────────────────────────
//
// `.chat` carries `isolation: isolate` (global.css — load-bearing for its own
// wallpaper's `z-index: -1` trick, NOT touched by this fix). `.home-back` is a
// SIBLING of `.chat` at z-index 6 (home.css). A descendant's declared z-index
// is capped at its isolated ancestor's own stacking level no matter the
// number, so anything mounted as a CHILD of `.chat` painted under
// `.home-back` regardless of its own z-index — first measured on
// PhotoViewer.tsx (z-index 62, still covered). Nothing that reads CSS source
// can see this: it is a fact about computed paint order, so only a live
// DOM can prove it moved.
//
// MoreSheet, SourceSheet and AuthSheet share the `.sheet` idiom (they were
// fixed TOGETHER, see bodyPortal.tsx) and StoryView has two call sites (App.tsx,
// never trapped; Chat.tsx, trapped) — both are asserted here so a future call
// site cannot reintroduce the bug silently.
//
// ── the method ───────────────────────────────────────────────────────────
//
// Same technique composer-browser.mjs's PhotoViewer check already uses:
// `elementFromPoint` at `.home-back`'s own screen coordinates, because a
// screenshot diff can miss this — StoryView's own header ring happens to sit
// in the exact same corner, so the PIXELS can look identical while the
// HIT-TEST underneath is wrong (a tap there would silently go home instead of
// reaching the story's own controls). A baseline case (nothing open) is
// asserted too, as the negative control dead-writers requires: a check that
// can never fail because it never looks at the right pixel is not a check.
//
// The model is stubbed and every API route is fulfilled locally: deterministic,
// $0. NOT wired into evals/run.mjs, for the reason every other *-browser.mjs
// states: it needs a built app and a server on a port.

import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const BASE = process.env.MEERA_PREVIEW || "http://localhost:4292";
const OBSERVE = process.argv.includes("--observe");
const SHOTS = process.env.ZORDER_SHOTS || join(ROOT, "gameplay-shots", "zorder");
mkdirSync(SHOTS, { recursive: true });

let fails = 0;
const ok = (n, c, e = "") => {
  console.log(`${c ? "  ok  " : "FAIL  "}${n}${e ? "\n      " + e : ""}`);
  if (!c && !OBSERVE) fails++;
};
const dead = (why) => {
  console.log(`FAIL  the battery could not drive the app: ${why}`);
  console.log(
    "      This is the dead-writers case. A browser battery that cannot reach\n" +
      "      the app must exit non-zero: a quiet timeout printing ALL PASS is a\n" +
      "      green light attached to nothing.",
  );
  process.exit(1);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let browser;
try {
  browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
} catch (e) {
  dead(`chromium would not start (${String(e.message).slice(0, 160)})`);
}

const BASE_STATE = {
  onboarded: true,
  deviceId: "00000000-0000-4000-8000-00000000c0de",
  user: { name: "Raghav", vibe: [], facts: {} },
  messages: [],
  openrouterKey: "",
  openrouterModel: "",
  apiKey: "",
  elevenKey: "",
  elevenVoiceId: "",
  sarvamKey: "",
  deviceVoice: "",
  lastSeen: Date.now(),
};

async function open() {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  for (const p of [
    "**/api/telemetry", "**/api/consolidate", "**/api/account", "**/api/clock",
    "**/api/life", "**/api/search", "**/api/trace", "**/api/route", "**/api/gif",
    "**/api/speech", "**/api/episodes", "**/api/diag", "**/api/push-token",
    "**/api/chat", "**/api/memory",
  ]) {
    await page.route(p, (r) => r.fulfill({ status: 200, contentType: "application/json", body: "{}" }));
  }
  try {
    await page.goto(`${BASE}/chat`, { waitUntil: "domcontentloaded", timeout: 15_000 });
  } catch (e) {
    dead(
      `no preview server at ${BASE}. Run \`npx vite build && npx vite preview ` +
        `--port 4292 --strictPort\` first (${String(e.message).slice(0, 120)})`,
    );
  }
  await page.evaluate((s) => localStorage.setItem("meera.state.v1", JSON.stringify(s)), BASE_STATE);
  await page.reload({ waitUntil: "domcontentloaded" });
  try {
    await page.waitForSelector('[data-tel="home.open_chat"]', { timeout: 12_000 });
    await page.click('[data-tel="home.open_chat"]');
    await page.waitForFunction(
      () => document.querySelector(".chat-wrap")?.getAttribute("data-surface") === "chat",
      null,
      { timeout: 12_000 },
    );
  } catch (e) {
    dead(`the chat screen never came up (${String(e.message).slice(0, 160)})`);
  }
  await page.waitForSelector(".chat-input textarea", { timeout: 8000 });
  return { page, ctx };
}

/**
 * `.home-back`'s own centre point, and what's actually painted there.
 * `insideSelector` is a CSS selector for the surface expected to win; `null`
 * means `.home-back` itself is expected to win (the baseline / negative
 * control).
 */
async function hitTest(page, insideSelector) {
  return page.evaluate((sel) => {
    const hb = document.querySelector(".home-back");
    if (!hb) return { error: "no .home-back in the DOM" };
    const r = hb.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    const el = document.elementFromPoint(x, y);
    const hitHomeBack = el === hb || hb.contains(el);
    const surface = sel ? document.querySelector(sel) : null;
    const hitSurface = sel ? Boolean(surface && (el === surface || surface.contains(el))) : false;
    return {
      x, y,
      topElement: el ? el.className || el.tagName : null,
      hitHomeBack,
      hitSurface,
    };
  }, insideSelector);
}

const shot = (page, name) => page.screenshot({ path: join(SHOTS, `${name}.png`) });

// ════ 0. BASELINE — nothing open, `.home-back` IS the top element ═════════
// The negative control. Without this, every assertion below could be passing
// because the point sampled is never actually under `.home-back` at all.
{
  console.log("\n── 0. baseline: nothing open ──");
  const { page, ctx } = await open();
  const hit = await hitTest(page, null);
  ok(
    "`.home-back` is the top element at its own coordinates when nothing is open",
    hit.hitHomeBack === true,
    JSON.stringify(hit),
  );
  await ctx.close();
}

// ════ 1. SOURCE SHEET ═══════════════════════════════════════════════════
{
  console.log("\n── 1. SourceSheet (chat.attach) ──");
  const { page, ctx } = await open();
  await page.click('[data-tel="chat.attach"]');
  try {
    await page.waitForSelector(".source-sheet", { timeout: 6000 });
  } catch {
    dead("the attach button did not open the source sheet");
  }
  await sleep(450);
  await shot(page, "01-source-sheet");
  const hit = await hitTest(page, ".sheet-veil, .source-sheet");
  ok(
    "the sheet (or its veil) wins at `.home-back`'s own spot, not the button",
    hit.hitSurface === true && hit.hitHomeBack === false,
    JSON.stringify(hit),
  );
  await page.keyboard.press("Escape");
  await page.waitForSelector(".source-sheet", { state: "detached", timeout: 4000 });
  await ctx.close();
}

// ════ 2. MORE SHEET (settings) ══════════════════════════════════════════
{
  console.log("\n── 2. MoreSheet (chat.settings) ──");
  const { page, ctx } = await open();
  await page.click('[data-tel="chat.settings"]');
  try {
    await page.waitForSelector(".sheet", { timeout: 6000 });
  } catch {
    dead("the settings button did not open the more sheet");
  }
  await sleep(450);
  await shot(page, "02-more-sheet");
  const hit = await hitTest(page, ".sheet-veil, .sheet");
  ok(
    "the sheet (or its veil) wins at `.home-back`'s own spot, not the button",
    hit.hitSurface === true && hit.hitHomeBack === false,
    JSON.stringify(hit),
  );

  // ════ 3. AUTH SHEET, reached from inside More > Account ════════════════
  //
  // This is the path that matters: AuthSheet is only ever mounted at the
  // App.tsx level today (never trapped by construction), so opening it
  // straight from home would pass even on the buggy tree. Reaching it via
  // More > Account is what actually exercises the shared fix — and the
  // fragile part `.sheet` shares with MoreSheet/SourceSheet: nothing stops a
  // future call site from mounting it inside Chat.tsx instead, the same way
  // MoreSheet and SourceSheet already are.
  console.log("\n── 3. AuthSheet (More > Account) ──");
  const accountBtn = await page.$('[data-tel="more.account"]');
  if (!accountBtn) dead("More > Account row not found");
  await accountBtn.click();
  try {
    await page.waitForSelector(".auth-sheet", { timeout: 6000 });
  } catch {
    dead("More > Account did not open the auth sheet");
  }
  await sleep(450);
  await shot(page, "03-auth-sheet");
  const hitAuth = await hitTest(page, ".sheet-veil, .auth-sheet");
  ok(
    "the auth sheet (or its veil) wins at `.home-back`'s own spot, not the button",
    hitAuth.hitSurface === true && hitAuth.hitHomeBack === false,
    JSON.stringify(hitAuth),
  );
  await page.keyboard.press("Escape");
  await sleep(300);
  await ctx.close();
}

// ════ 4. STORY VIEW — the in-Chat instance (chat header's ring) ═══════════
{
  console.log("\n── 4. StoryView, in-Chat instance (chat.avatar) ──");
  const { page, ctx } = await open();
  await page.click('[data-tel="chat.avatar"]');
  await sleep(500);
  const present = await page.$(".story-view");
  if (!present) {
    dead(
      "tapping the chat header's ring opened neither a story nor the account " +
        "sheet — this fixture assumes at least one story is always live " +
        "(engine/storyCatalog.ts); if that changed, point this at the account " +
        "path instead of skipping it silently",
    );
  }
  await shot(page, "04-story-view-in-chat");
  const hit = await hitTest(page, ".story-view");
  ok(
    "the story (its image, header or bars) wins at `.home-back`'s own spot",
    hit.hitSurface === true && hit.hitHomeBack === false,
    JSON.stringify(hit),
  );
  await page.keyboard.press("Escape");
  await ctx.close();
}

// ════ 5. STORY VIEW — the App-level instance (home's story card) ═════════
//
// Asserted too, not because it was ever broken (App.tsx mounts it as a
// sibling of `.chat-wrap`, never inside `.chat`), but because StoryView.tsx
// is now portalled INSIDE THE COMPONENT — this is the negative-regression
// check that the portal did not change anything for the call site that
// already worked.
{
  console.log("\n── 5. StoryView, App-level instance (home story card) ──");
  const { page, ctx } = await open();
  // back to home, where the story card lives
  await page.click('[data-tel="chat.home"]');
  await sleep(300);
  // HomeScreen.tsx: the avatar ring opens the story when one is live
  // (`onClick={storyLive ? onStory : onOpenChat}`), the same "insta
  // mechanics" Chat.tsx's own header ring uses.
  const card = await page.$('[data-tel="home.avatar"]');
  if (!card) {
    console.log("  note  home.avatar not found; skipping (see #4 for the covered call site)");
  } else {
    await card.click();
    await sleep(500);
    const present = await page.$(".story-view");
    if (present) {
      await shot(page, "05-story-view-home");
      const hit = await hitTest(page, ".story-view");
      ok(
        "the App-level StoryView still opens over the world with nothing painting over it",
        hit.hitSurface === true,
        JSON.stringify(hit),
      );
    } else {
      console.log("  note  the story card did not open a story (no live stories in the fixture); skipping");
    }
  }
  await ctx.close();
}

await browser.close();
console.log(`\nscreenshots: ${SHOTS}`);
console.log(fails ? `\n${fails} FAILURES` : "\nALL PASS");
process.exit(fails ? 1 : 0);
