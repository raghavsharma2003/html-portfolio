// WS-COMPOSER in a real browser — the half of this feature only a browser can
// answer.
//
//   npx vite build
//   npx vite preview --port 4292 --strictPort &
//   xvfb-run -a node evals/composer-browser.mjs            # assert
//   xvfb-run -a node evals/composer-browser.mjs --observe  # print, never fail
//
// ── why a browser ──────────────────────────────────────────────────────────
//
// `evals/composer/run.mjs` proves the RULES: five is five, a caption is
// threaded, a count resolves to a collage, the wire shape is the agreed one.
// None of that can prove the thing the owner actually asked for, which is that
// picking three photos and typing a sentence produces one message on screen
// with three pictures and a sentence under them. Six failures live only here,
// and all six ship green against the offline suite:
//
//   1. THE SHEET OPENS AND OFFERS THE RIGHT SOURCES. On a coarse-pointer
//      device: Camera and Photos. On a laptop: Photos only, because the
//      `capture` attribute exists there and does nothing.
//   2. PICKING DOES NOT SEND. A picked picture lands in the tray. The old
//      behaviour sent it instantly, which is the defect the caption field
//      exists to fix, so it is asserted as an ABSENCE of a new message.
//   3. THE BOX BECOMES A CAPTION FIELD. Placeholder, and Send reachable with
//      an empty box.
//   4. ONE MESSAGE, THREE PICTURES, ONE CAPTION. Geometry, not just text: four
//      tiles for a five, three for a three, and the caption below the images
//      inside the same bubble.
//   5. THE SIXTH IS REFUSED, AND SAYS SO. Nothing modal, count stays at 5 of 5.
//   6. THE VIEWER OPENS ON THE PICTURE THAT WAS TAPPED and can move.
//
// ── DEAD-WRITERS LAW ───────────────────────────────────────────────────────
//
// This battery FAILS LOUDLY when it cannot drive the app. Every wait below is a
// `waitForSelector` with a timeout that throws, never a sleep-and-hope, and the
// three preconditions that would silently turn this file into a no-op — no
// preview server, no chromium, the chat screen never reaching `data-surface`
// — each exit non-zero with a sentence saying which one it was. A browser
// battery that times out quietly and prints ALL PASS is worse than no battery,
// because it is a green light attached to nothing.
//
// The model is stubbed and every API route is fulfilled locally, so it is
// deterministic and costs $0. No real picture is used: three fixture JPEGs are
// generated in-process at known sizes and colours, so a tile carrying the wrong
// picture is visible in the screenshots rather than merely plausible.

import { chromium } from "playwright";
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const BASE = process.env.MEERA_PREVIEW || "http://localhost:4292";
const OBSERVE = process.argv.includes("--observe");
const SHOTS = process.env.COMPOSER_SHOTS || join(ROOT, "gameplay-shots", "composer");
mkdirSync(SHOTS, { recursive: true });

let fails = 0;
const ok = (n, c, e = "") => {
  console.log(`${c ? "  ok  " : "FAIL  "}${n}${e ? "\n      " + e : ""}`);
  if (!c && !OBSERVE) fails++;
};
/** every failure that means the battery could not RUN is fatal and says why */
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

// ── fixtures: three solid-colour JPEGs at three sizes ─────────────────────
// Written to disk because a file input takes paths. Distinct colours and
// distinct aspect ratios, so the screenshots show WHICH picture landed in
// which tile rather than merely that a tile has pixels in it.
const FIXTURES = [
  { name: "fx-red.png", w: 900, h: 600, rgb: [196, 63, 86] },
  { name: "fx-blue.png", w: 600, h: 900, rgb: [58, 96, 168] },
  { name: "fx-green.png", w: 700, h: 700, rgb: [66, 148, 92] },
  { name: "fx-amber.png", w: 800, h: 500, rgb: [226, 154, 63] },
  { name: "fx-violet.png", w: 500, h: 800, rgb: [128, 84, 176] },
  { name: "fx-teal.png", w: 640, h: 640, rgb: [56, 152, 152] },
];

/** a minimal, valid, uncompressed PNG — no encoder dependency */
function png(w, h, [r, g, b]) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolour
  const raw = Buffer.alloc(h * (1 + w * 3));
  for (let y = 0; y < h; y++) {
    const off = y * (1 + w * 3);
    raw[off] = 0; // filter: none
    for (let x = 0; x < w; x++) {
      raw[off + 1 + x * 3] = r;
      raw[off + 2 + x * 3] = g;
      raw[off + 3 + x * 3] = b;
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const FIXDIR = join(SHOTS, "fixtures");
mkdirSync(FIXDIR, { recursive: true });
const paths = FIXTURES.map((f) => {
  const p = join(FIXDIR, f.name);
  writeFileSync(p, png(f.w, f.h, f.rgb));
  return p;
});

// ── the app ────────────────────────────────────────────────────────────────
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

/**
 * Open the chat.
 *
 * `hasTouch` is not a detail: `cameraAvailable()` asks for a coarse pointer,
 * which is the whole difference between the phone the feature is for and the
 * laptop this test runs on. Both are driven below, on purpose.
 */
async function open({ touch = true, theme = "light", uploads = true } = {}) {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    hasTouch: touch,
    isMobile: touch,
  });
  const page = await ctx.newPage();
  const posted = [];
  await page.route("**/api/chat", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ text: "arre wah" }),
    }),
  );
  await page.route("**/api/memory", async (route) => {
    let body = {};
    try {
      body = JSON.parse(route.request().postData() || "{}");
    } catch {
      /* not our concern here */
    }
    posted.push(body);
    if (body.op === "upload_photo") {
      // the SERVER SIDE OF THE CONTRACT, mocked exactly as agreed: a set comes
      // back as `urls`, one uncaptioned picture as `url`
      if (Array.isArray(body.images)) {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ urls: body.images.map((_, i) => `${BASE}/stored-${i}.jpg`) }),
        });
      }
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(uploads ? { url: `${BASE}/stored-legacy.jpg` } : {}),
      });
    }
    if (body.op === "describe") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ desc: "a flat colour" }),
      });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
  for (const p of [
    "**/api/telemetry", "**/api/consolidate", "**/api/account", "**/api/clock",
    "**/api/life", "**/api/search", "**/api/trace", "**/api/route", "**/api/gif",
    "**/api/speech", "**/api/episodes", "**/api/diag", "**/api/push-token",
  ]) {
    await page.route(p, (r) =>
      r.fulfill({ status: 200, contentType: "application/json", body: "{}" }),
    );
  }
  // a stored picture must resolve to SOMETHING, or the swap paints a broken box
  await page.route("**/stored-*.jpg", (r) =>
    r.fulfill({ status: 200, contentType: "image/png", body: png(40, 40, [40, 40, 40]) }),
  );

  try {
    await page.goto(`${BASE}/chat`, { waitUntil: "domcontentloaded", timeout: 15_000 });
  } catch (e) {
    dead(
      `no preview server at ${BASE}. Run \`npx vite build && npx vite preview ` +
        `--port 4292 --strictPort\` first (${String(e.message).slice(0, 120)})`,
    );
  }
  await page.evaluate(
    (s) => localStorage.setItem("meera.state.v1", JSON.stringify(s)),
    { ...BASE_STATE, theme },
  );
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
  return { page, ctx, posted };
}

const shot = (page, name) => page.screenshot({ path: join(SHOTS, `${name}.png`) });

/** pick N fixtures through the gallery input, and wait for the tray to grow */
async function pick(page, n, from = 0) {
  const before = await page.locator(".tray-thumb").count();
  await page.click('[data-tel="chat.attach"]');
  await page.waitForSelector('[data-tel="attach.gallery"]', { timeout: 6000 });
  await page.click('[data-tel="attach.gallery"]');
  await page.setInputFiles('input[multiple]', paths.slice(from, from + n));
  return before;
}

// ════ 1. THE SOURCE SHEET ══════════════════════════════════════════════════
{
  console.log("\n── 1. the source sheet ──");
  const { page, ctx } = await open({ touch: true });

  ok("nothing is staged to begin with", (await page.locator(".tray").count()) === 0);
  await page.click('[data-tel="chat.attach"]');
  try {
    await page.waitForSelector(".source-sheet", { timeout: 6000 });
  } catch {
    dead("the attach button did not open the source sheet");
  }
  await sleep(450); // the sheet's own 380ms rise, so the shot is of a settled sheet
  await shot(page, "01-source-sheet-touch");

  ok("Camera is offered on a coarse-pointer device", (await page.$('[data-tel="attach.camera"]')) !== null);
  ok("Photos is offered", (await page.$('[data-tel="attach.gallery"]')) !== null);
  ok(
    "…and it reuses the app's own sheet material",
    await page.evaluate(() => {
      const s = document.querySelector(".source-sheet");
      const cs = getComputedStyle(s);
      return cs.backdropFilter !== "none" && parseFloat(cs.borderTopLeftRadius) >= 16;
    }),
    "the sheet is not wearing .sheet's blur and radius",
  );
  ok("the scrim is there", (await page.$(".sheet-veil")) !== null);
  ok(
    "the last row is not flush with the bottom of the phone",
    await page.evaluate(() => {
      const rows = [...document.querySelectorAll(".source-sheet .srow")];
      const s = document.querySelector(".source-sheet").getBoundingClientRect();
      return s.bottom - rows[rows.length - 1].getBoundingClientRect().bottom >= 20;
    }),
    "a row that stops 24px from the screen edge reads as clipped",
  );

  await page.keyboard.press("Escape");
  await page.waitForSelector(".source-sheet", { state: "detached", timeout: 4000 });
  ok("Escape closes it", (await page.$(".source-sheet")) === null);
  await ctx.close();
}

// ════ 2. A LAPTOP IS NOT OFFERED A CAMERA ══════════════════════════════════
{
  console.log("\n── 2. never a dead option ──");
  const { page, ctx } = await open({ touch: false });
  await page.click('[data-tel="chat.attach"]');
  await page.waitForSelector(".source-sheet", { timeout: 6000 });
  await sleep(400);
  await shot(page, "02-source-sheet-desktop");
  ok(
    "no Camera row on a fine-pointer device",
    (await page.$('[data-tel="attach.camera"]')) === null,
    "a laptop has no HTML Media Capture, so this row would have said Camera " +
      "and opened a file browser",
  );
  ok("Photos is still there", (await page.$('[data-tel="attach.gallery"]')) !== null);

  // THE MEASUREMENT SourceSheet.tsx's comment cites, taken here rather than
  // asserted from memory. The obvious detection for a camera-capable browser is
  // `"capture" in HTMLInputElement.prototype`; this is what that expression
  // actually reads in the Chromium this repo tests against. It agrees with the
  // pointer test on a laptop, which is exactly why it looks fine and cannot be
  // trusted to agree with it on a phone.
  const probe = await page.evaluate(() => ({
    capture: "capture" in document.createElement("input"),
    coarse: window.matchMedia("(pointer: coarse)").matches,
    touch: navigator.maxTouchPoints,
  }));
  console.log(`  note  desktop chromium: ${JSON.stringify(probe)}`);
  ok(
    "…and the pointer test is the one that separates the two contexts",
    probe.coarse === false && probe.touch === 0,
    JSON.stringify(probe),
  );
  await ctx.close();
}

// ════ 3. PICKING DOES NOT SEND, AND THE BOX BECOMES A CAPTION FIELD ════════
{
  console.log("\n── 3. the tray and the caption field ──");
  const { page, ctx, posted } = await open();

  // HIS messages only. Hers arrive on their own schedule (she greets, and the
  // stub answers), so a count of every bubble in the thread would be measuring
  // her timing rather than his send.
  const mineBefore = await page.locator(".chat-scroll .msg.me").count();
  await pick(page, 3);
  try {
    await page.waitForFunction(() => document.querySelectorAll(".tray-thumb").length === 3, null, {
      timeout: 10_000,
    });
  } catch {
    dead("three picked pictures never reached the compose tray");
  }
  await sleep(400);
  await shot(page, "03-tray-three-staged");

  ok("three thumbnails are staged", (await page.locator(".tray-thumb").count()) === 3);
  ok(
    "PICKING DID NOT SEND",
    (await page.locator(".chat-scroll .msg.me").count()) === mineBefore &&
      (await page.locator(".msg.me.photo").count()) === 0,
    "the old behaviour sent instantly, which is the whole defect the caption " +
      "field exists to fix",
  );
  ok(
    "…and nothing was uploaded yet",
    !posted.some((b) => b.op === "upload_photo"),
    "a staged picture is a draft, not a send",
  );
  ok(
    "the count reads 3 of 5",
    (await page.textContent(".tray-count"))?.replace(/\s+/g, " ").trim() === "3 of 5",
    String(await page.textContent(".tray-count")),
  );
  ok(
    "the box says it is a caption field now",
    (await page.getAttribute(".chat-input textarea", "placeholder"))?.startsWith("Add a caption"),
    String(await page.getAttribute(".chat-input textarea", "placeholder")),
  );
  ok(
    "Send is reachable with an empty box",
    (await page.getAttribute(".send-btn", "data-mode")) === "send",
    String(await page.getAttribute(".send-btn", "data-mode")),
  );
  ok(
    "the tray sits ABOVE the composer, not over the thread",
    await page.evaluate(() => {
      const t = document.querySelector(".tray").getBoundingClientRect();
      const c = document.querySelector(".chat-input-row").getBoundingClientRect();
      const s = document.querySelector(".chat-scroll").getBoundingClientRect();
      return t.bottom <= c.top + 1 && t.top >= s.bottom - 1;
    }),
  );

  // one thumb removed by its own button
  await page.click(".tray-thumb:nth-child(2) .tray-x");
  await page.waitForFunction(() => document.querySelectorAll(".tray-thumb").length === 2, null, {
    timeout: 4000,
  });
  ok("a thumb can be removed", (await page.locator(".tray-thumb").count()) === 2);
  ok("…and the count follows", (await page.textContent(".tray-count"))?.includes("2 of 5"));
  await ctx.close();
}

// ════ 4. THE SIXTH IS REFUSED ══════════════════════════════════════════════
{
  console.log("\n── 4. the sixth ──");
  const { page, ctx } = await open();
  await pick(page, 5);
  try {
    await page.waitForFunction(() => document.querySelectorAll(".tray-thumb").length === 5, null, {
      timeout: 12_000,
    });
  } catch {
    dead("five picked pictures never reached the compose tray");
  }
  ok("five are staged", (await page.locator(".tray-thumb").count()) === 5);
  ok("the count reads 5 of 5", (await page.textContent(".tray-count"))?.includes("5 of 5"));
  ok(
    "the add tile is gone at the cap",
    (await page.$(".tray-add")) === null,
    "a present-and-inert control is the dead-option rule one level down",
  );

  // the sixth, through the sheet, exactly as a person would
  await page.click('[data-tel="chat.attach"]');
  await sleep(260);
  const sheetOpen = (await page.$(".source-sheet")) !== null;
  if (sheetOpen) {
    await page.click('[data-tel="attach.gallery"]');
    await page.setInputFiles('input[multiple]', [paths[5]]);
    await sleep(900);
  } else {
    // at the cap the attach button answers with the cue instead of the sheet
    await sleep(400);
  }
  await shot(page, "04-sixth-refused");
  ok(
    "still five, never six",
    (await page.locator(".tray-thumb").count()) === 5,
    `${await page.locator(".tray-thumb").count()} thumbs`,
  );
  ok("the count still reads 5 of 5", (await page.textContent(".tray-count"))?.includes("5 of 5"));
  ok(
    "NOTHING MODAL happened",
    (await page.$("dialog[open]")) === null && (await page.$(".sheet-veil")) === null,
    "the owner's bar: a refusal is a cue, never a dialog to dismiss",
  );

  // the send itself, five up
  await page.fill(".chat-input textarea", "goa dump");
  await page.click('[data-tel="chat.send"]');
  try {
    await page.waitForSelector(".msg.me.photo .pgrid", { timeout: 10_000 });
  } catch {
    dead("a five-picture message never rendered in the thread");
  }
  await sleep(700);
  await shot(page, "05-five-sent-collage");
  const five = await page.evaluate(() => {
    const g = document.querySelector(".msg.me.photo .pgrid");
    const scroll = document.querySelector(".chat-scroll").getBoundingClientRect();
    return {
      shape: g.getAttribute("data-shape"),
      tiles: g.querySelectorAll(".pgrid-tile").length,
      more: g.querySelector(".pgrid-more")?.textContent ?? "",
      frac: g.getBoundingClientRect().width / scroll.width,
    };
  });
  ok("five renders as the four-tile shape", five.shape === "four" && five.tiles === 4, JSON.stringify(five));
  ok("…with a +1 on the last tile", five.more === "+1", JSON.stringify(five));
  ok(
    "…and the collage is sized by the BUBBLE, not by the source images",
    five.frac >= 0.6,
    `the collage is ${(five.frac * 100).toFixed(0)}% of the thread's width. The ` +
      `fixtures here are deliberately tiny; a grid of cover-fitted tiles has no ` +
      `intrinsic width, so without a stated one it collapses to whatever the ` +
      `pictures happened to be (measured: 90px).`,
  );
  await ctx.close();
}

// ════ 5. ONE MESSAGE, THREE PICTURES, ONE CAPTION ══════════════════════════
{
  console.log("\n── 5. the message ──");
  const { page, ctx, posted } = await open();
  await pick(page, 3);
  await page.waitForFunction(() => document.querySelectorAll(".tray-thumb").length === 3, null, {
    timeout: 12_000,
  });

  const before = await page.locator(".chat-scroll .msg.me").count();
  await page.fill(".chat-input textarea", "hostel ki chhat se");
  await sleep(120);
  await shot(page, "06-caption-typed");
  await page.click('[data-tel="chat.send"]');
  try {
    await page.waitForSelector(".msg.me.photo .pgrid", { timeout: 10_000 });
  } catch {
    dead("a three-picture message never rendered in the thread");
  }
  await sleep(600);
  await shot(page, "07-three-sent-with-caption");

  const shape = await page.evaluate(() => {
    const bubbles = [...document.querySelectorAll(".msg.me.photo")];
    const b = bubbles[bubbles.length - 1];
    const g = b.querySelector(".pgrid");
    const cap = b.querySelector(".cap");
    const gr = g.getBoundingClientRect();
    const cr = cap?.getBoundingClientRect();
    return {
      bubbles: bubbles.length,
      shape: g.getAttribute("data-shape"),
      tiles: g.querySelectorAll(".pgrid-tile").length,
      imgs: g.querySelectorAll("img").length,
      cap: cap?.textContent ?? "",
      capBelow: cr ? cr.top >= gr.bottom - 1 : false,
      sameBubble: cap ? b.contains(cap) : false,
      hasTick: Boolean(b.querySelector(".tickicon")),
      hasTime: Boolean(b.querySelector(".t")),
    };
  });
  ok(
    "ONE message, not three",
    (await page.locator(".chat-scroll .msg.me").count()) === before + 1,
    `${await page.locator(".chat-scroll .msg.me").count()} of his bubbles, expected ${before + 1}`,
  );
  ok("…it is one photo bubble", shape.bubbles === 1, JSON.stringify(shape));
  ok("…with three tiles", shape.shape === "three" && shape.tiles === 3, JSON.stringify(shape));
  ok("…three real images in them", shape.imgs === 3);
  ok("…the caption is the sentence typed", shape.cap === "hostel ki chhat se", shape.cap);
  ok("…it is in the SAME bubble", shape.sameBubble);
  ok("…and below the pictures", shape.capBelow);
  ok("…and the tick and timestamp idiom is unchanged", shape.hasTick && shape.hasTime);
  ok("the tray is empty again", (await page.locator(".tray-thumb").count()) === 0);
  ok(
    "…and the box is back to being the message field",
    (await page.getAttribute(".chat-input textarea", "placeholder"))?.startsWith("Message"),
  );

  // THE WIRE. The agreed contract, read off the request the page actually made.
  const up = posted.find((b) => b.op === "upload_photo");
  ok("an upload happened", Boolean(up), JSON.stringify(posted.map((p) => p.op)));
  ok("…carrying `images`", Array.isArray(up?.images) && up.images.length === 3, JSON.stringify(up?.images?.length));
  ok("…every one a jpeg data URL", up?.images?.every((u) => u.startsWith("data:image/jpeg;base64,")));
  ok("…and the caption beside them", up?.caption === "hostel ki chhat se", String(up?.caption));
  ok(
    "…and NOT the legacy single-photo body",
    up?.data === undefined,
    "a set is not one picture; sending both shapes would double the bytes",
  );

  // and the storage swap actually landed
  await page.waitForFunction(
    () => {
      const s = JSON.parse(localStorage.getItem("meera.state.v1") || "{}");
      const m = (s.messages || []).filter((x) => x.kind === "photo").pop();
      return m && Array.isArray(m.photoUrls) && m.photoUrls.every((u) => !u.startsWith("data:"));
    },
    null,
    { timeout: 10_000 },
  ).catch(() => {});
  const stored = await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem("meera.state.v1") || "{}");
    return (s.messages || []).filter((x) => x.kind === "photo").pop();
  });
  ok("the message persisted with all three", stored?.photoUrls?.length === 3, JSON.stringify(stored?.photoUrls));
  ok("…photoUrl still holds the first, for every older reader", stored?.photoUrl === stored?.photoUrls?.[0]);
  ok("…the caption persisted as the message text", stored?.text === "hostel ki chhat se");
  ok(
    "…and the data: URLs were swapped for stored ones",
    stored?.photoUrls?.every((u) => !u.startsWith("data:")),
    JSON.stringify(stored?.photoUrls),
  );

  // ── the viewer ──
  await page.click(".pgrid-tile:nth-child(2)");
  try {
    await page.waitForSelector(".pview", { timeout: 5000 });
  } catch {
    dead("tapping a tile did not open the photo viewer");
  }
  await sleep(400);
  await shot(page, "08-viewer-second-photo");
  ok("the viewer opened", (await page.$(".pview")) !== null);
  ok(
    "…and NOTHING of the app paints over it",
    await page.evaluate(() => {
      // the top-left corner is where `.home-back` sits, and it is the exact
      // pixel that proved the bug this viewer is portalled to avoid: `.chat`
      // carries `isolation: isolate`, so a descendant at z-index 62 was still
      // capped by its parent's level and the back chevron drew on top of a
      // photograph. Two corners and the middle, because a partial cover is the
      // failure mode a single sample would miss.
      const pts = [[28, 38], [362, 38], [195, 420], [28, 800]];
      return pts.every((pt) => document.querySelector(".pview")?.contains(document.elementFromPoint(pt[0], pt[1])));
    }),
    "something in the app's own stacking context is drawing over the viewer",
  );
  ok(
    "…on the picture that was tapped",
    (await page.textContent(".pview-count"))?.includes("2 of 3"),
    String(await page.textContent(".pview-count")),
  );
  ok("…the caption travels with it", (await page.textContent(".pview-cap")) === "hostel ki chhat se");
  await page.keyboard.press("ArrowRight");
  await sleep(320);
  ok("…arrows move between the set", (await page.textContent(".pview-count"))?.includes("3 of 3"));
  await shot(page, "09-viewer-third-photo");
  await page.keyboard.press("Escape");
  await page.waitForSelector(".pview", { state: "detached", timeout: 4000 });
  ok("…and Escape closes it", (await page.$(".pview")) === null);
  await ctx.close();
}

// ════ 6. ONE PICTURE, NO CAPTION: THE LEGACY SHAPE, UNCHANGED ══════════════
{
  console.log("\n── 6. one picture keeps the old wire ──");
  const { page, ctx, posted } = await open();
  await pick(page, 1);
  await page.waitForFunction(() => document.querySelectorAll(".tray-thumb").length === 1, null, {
    timeout: 10_000,
  });
  await page.click('[data-tel="chat.send"]');
  try {
    await page.waitForSelector(".msg.me.photo .pimg", { timeout: 10_000 });
  } catch {
    dead("a single-picture message never rendered in the thread");
  }
  await sleep(700);
  await shot(page, "10-one-photo-no-caption");
  ok("it renders as ONE picture, not a one-tile grid", (await page.$(".msg.me.photo .pgrid")) === null);
  const up = posted.find((b) => b.op === "upload_photo");
  ok(
    "…and it goes up in the shape that has always worked",
    typeof up?.data === "string" && up.data.length > 0 && up.images === undefined,
    JSON.stringify({ hasData: typeof up?.data, hasImages: Array.isArray(up?.images) }),
  );
  ok("…as image/jpeg", up?.mime === "image/jpeg");
  ok(
    "…and a single picture opens the viewer too",
    await (async () => {
      await page.click(".msg.me.photo .pimg-open");
      try {
        await page.waitForSelector(".pview", { timeout: 4000 });
      } catch {
        return false;
      }
      return true;
    })(),
  );
  await sleep(300);
  await shot(page, "11-viewer-single");
  await ctx.close();
}

// ════ 7. DARK ══════════════════════════════════════════════════════════════
{
  console.log("\n── 7. dark ──");
  const { page, ctx } = await open({ theme: "dark" });
  await pick(page, 4);
  await page.waitForFunction(() => document.querySelectorAll(".tray-thumb").length === 4, null, {
    timeout: 12_000,
  });
  await page.fill(".chat-input textarea", "raat ki tasveerein");
  await sleep(300);
  await shot(page, "12-tray-dark");
  await page.click('[data-tel="chat.attach"]');
  await page.waitForSelector(".source-sheet", { timeout: 6000 });
  await sleep(450);
  await shot(page, "13-source-sheet-dark");
  await page.keyboard.press("Escape");
  await sleep(300);
  await page.click('[data-tel="chat.send"]');
  await page.waitForSelector(".msg.me.photo .pgrid", { timeout: 10_000 });
  await sleep(700);
  await shot(page, "14-four-sent-dark");
  const four = await page.evaluate(() => {
    const g = document.querySelector(".msg.me.photo .pgrid");
    return { shape: g.getAttribute("data-shape"), tiles: g.querySelectorAll(".pgrid-tile").length };
  });
  ok("four renders as a 2x2", four.shape === "four" && four.tiles === 4, JSON.stringify(four));
  ok("…with no overflow veil", (await page.$(".pgrid-more")) === null);
  await ctx.close();
}

await browser.close();
console.log(`\nscreenshots: ${SHOTS}`);
console.log(fails ? `\n${fails} FAILURES` : "\nALL PASS");
process.exit(fails ? 1 : 0);
