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

// ── document fixtures ─────────────────────────────────────────────────────
//
// TWO FORMATS, because the client takes two different routes through them and
// only a browser can tell which one it actually took. A `.md` is read as text
// on the device and goes up as `text`; a `.pdf` cannot be, and goes up as
// `data` for `api/_docs.js` to extract. A battery that only attached a .txt
// would pass against a build that had lost the PDF branch entirely.
//
// The PDF is a REAL one, hand-assembled with correct xref offsets, so it is a
// file a picker accepts and an extractor can be pointed at rather than a blob
// with a .pdf name on it.
function minimalPdf(line) {
  const enc = (s) => Buffer.from(s, "latin1");
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    null, // the content stream, built below
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  const stream = `BT /F1 12 Tf 20 150 Td (${line.replace(/([()\\])/g, "\\$1")}) Tj ET`;
  objs[3] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  let out = "%PDF-1.4\n";
  const offsets = [];
  objs.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return enc(out);
}

const DOC_TEXT = "quarterly notes\n\nthe roof leaked in july and the landlord paid for it.";
const PDF_LINE = "rent agreement clause four";
const docPaths = {
  md: join(FIXDIR, "notes.md"),
  pdf: join(FIXDIR, "rent-agreement.pdf"),
  csv: join(FIXDIR, "spend.csv"),
  extra: join(FIXDIR, "extra.txt"),
};
writeFileSync(docPaths.md, DOC_TEXT);
writeFileSync(docPaths.pdf, minimalPdf(PDF_LINE));
writeFileSync(docPaths.csv, "month,amount\njuly,1200\naugust,1400\n");
writeFileSync(docPaths.extra, "a fourth file that must not fit");

// The server's own extractor, run over the fixture PDF right here. If this
// cannot read it, the fixture is the thing that is broken and every assertion
// downstream about "the PDF went up as data" would be measuring a file nobody
// could ever have used.
const { normalizeDocs } = await import(join(ROOT, "api/_docs.js"));
{
  const probe = normalizeDocs([
    { name: "rent-agreement.pdf", mime: "application/pdf", data: minimalPdf(PDF_LINE).toString("base64") },
  ]);
  ok(
    "the fixture PDF is a file the real extractor can read",
    probe.ok && probe.stats.extracted === 1 && probe.blocks[0].includes("rent agreement"),
    JSON.stringify(probe.blocks?.[0] ?? probe).slice(0, 200),
  );
}

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
  // RECORDED, not just stubbed. The document contract is a property of the
  // request body, so the only place it can be observed is here — the offline
  // suite can prove `buildDocPayload` returns a shape, and only this can prove
  // the shape reached the wire.
  await page.route("**/api/chat", (route) => {
    try {
      posted.push({ op: "chat", ...JSON.parse(route.request().postData() || "{}") });
    } catch {
      posted.push({ op: "chat", unparseable: true });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ text: "arre wah" }),
    });
  });
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

// THE TWO INPUTS ARE ADDRESSED BY WHAT THEY ACCEPT, not by "the one with
// `multiple`" — both of them carry it now, and a selector that matched either
// would have started driving whichever happened to be first in the DOM.
const GALLERY_INPUT = 'input[accept="image/*"][multiple]';
const DOC_INPUT = 'input[accept*=".pdf"]';

/** pick N fixtures through the gallery input, and wait for the tray to grow */
async function pick(page, n, from = 0) {
  const before = await page.locator(".tray-thumb").count();
  await page.click('[data-tel="chat.attach"]');
  await page.waitForSelector('[data-tel="attach.gallery"]', { timeout: 6000 });
  await page.click('[data-tel="attach.gallery"]');
  await page.setInputFiles(GALLERY_INPUT, paths.slice(from, from + n));
  return before;
}

/** pick documents through the Document row, exactly as a person would */
async function pickDocs(page, files) {
  await page.click('[data-tel="chat.attach"]');
  await page.waitForSelector('[data-tel="attach.document"]', { timeout: 6000 });
  await page.click('[data-tel="attach.document"]');
  await page.setInputFiles(DOC_INPUT, files);
}

/**
 * Wait for a request the page has not made yet, and FAIL LOUDLY when it never
 * comes.
 *
 * Documents do not upload, so nothing about a document send is observable until
 * the reply cycle runs — and that is behind the burst clock, which deliberately
 * waits to see whether he is still typing. A fixed sleep here would be a test
 * that passes on a fast machine and reports ALL PASS on a slow one after
 * observing nothing at all, which is the dead-writers failure with extra steps.
 */
async function waitForPosted(posted, pred, ms, why) {
  const t0 = Date.now();
  for (;;) {
    const hit = posted.find(pred);
    if (hit) return hit;
    if (Date.now() - t0 > ms) dead(why);
    await sleep(150);
  }
}
const isDocRequest = (b) => Array.isArray(b?.docs) && b.docs.length > 0;

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
    "the add tile SURVIVES the picture cap, because a document still fits",
    (await page.$(".tray-add")) !== null,
    "two independent caps: the `+` is inert only when NOTHING more can be " +
      "added, and hiding it at the picture cap would hide the route to the " +
      "one thing that is still possible",
  );

  // THE SIXTH PICTURE, asked for exactly as a person would ask. The refusal is
  // not a dialog and it is not an error: the two picture rows are simply not
  // there any more, and the sheet says which cap that is.
  await page.click('[data-tel="chat.attach"]');
  try {
    await page.waitForSelector(".source-sheet", { timeout: 6000 });
  } catch {
    dead("the attach button opened nothing at the picture cap");
  }
  await sleep(450);
  await shot(page, "04-sixth-refused");
  ok(
    "at the picture cap there is no Photos row to press",
    (await page.$('[data-tel="attach.gallery"]')) === null,
    "a Photos row that opens a picker and then silently drops the file is the " +
      "dead-option rule broken at the worst possible moment",
  );
  ok("…and no Camera row either", (await page.$('[data-tel="attach.camera"]')) === null);
  ok(
    "…the sheet says WHICH cap it was",
    /5 photos/.test((await page.textContent('[data-tel="attach.room"]')) || ""),
    String(await page.textContent('[data-tel="attach.room"]')),
  );
  ok(
    "…and the Document row is still there, because documents still fit",
    (await page.$('[data-tel="attach.document"]')) !== null,
  );
  ok(
    "NOTHING MODAL happened",
    (await page.$("dialog[open]")) === null,
    "the owner's bar: a refusal is a cue, never a dialog to dismiss",
  );
  await page.keyboard.press("Escape");
  await page.waitForSelector(".source-sheet", { state: "detached", timeout: 4000 });
  ok(
    "still five, never six",
    (await page.locator(".tray-thumb").count()) === 5,
    `${await page.locator(".tray-thumb").count()} thumbs`,
  );
  ok("the count still reads 5 of 5", (await page.textContent(".tray-count"))?.includes("5 of 5"));

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

// ════ 8. DOCUMENTS ════════════════════════════════════════════════════════
//
// The half of the document slice that only a browser can answer. `packDoc`'s
// branch (text on the client for a .md, bytes for a .pdf) runs against a REAL
// FileReader over REAL files here; offline it is asserted against hand-built
// objects, which cannot tell you that a `.md` picked through a real file input
// actually arrives as text.
{
  console.log("\n── 8. documents ──");
  const { page, ctx, posted } = await open();

  // the third row exists and is reachable
  await page.click('[data-tel="chat.attach"]');
  await page.waitForSelector(".source-sheet", { timeout: 6000 });
  await sleep(450);
  await shot(page, "15-source-sheet-with-document");
  ok("the sheet offers a Document row", (await page.$('[data-tel="attach.document"]')) !== null);
  ok("…alongside the two picture rows", (await page.locator(".source-sheet .srow").count()) === 3);
  await page.keyboard.press("Escape");
  await page.waitForSelector(".source-sheet", { state: "detached", timeout: 4000 });

  // a text file and a PDF, through the real picker
  await pickDocs(page, [docPaths.md, docPaths.pdf]);
  try {
    await page.waitForFunction(() => document.querySelectorAll(".tray-doc").length === 2, null, {
      timeout: 10_000,
    });
  } catch {
    dead("two picked documents never reached the compose tray");
  }
  await sleep(400);
  await shot(page, "16-tray-two-documents");

  ok("two file chips are staged", (await page.locator(".tray-doc").count()) === 2);
  ok(
    "PICKING DID NOT SEND",
    (await page.locator(".msg.me").count()) === 0,
    "a staged document is a draft, exactly like a staged picture",
  );
  const chips = await page.evaluate(() =>
    [...document.querySelectorAll(".tray-doc")].map((c) => ({
      ext: c.querySelector(".tray-doc-ext").textContent,
      name: c.querySelector(".tray-doc-name").textContent,
      size: c.querySelector(".tray-doc-size").textContent,
      hasX: Boolean(c.querySelector(".tray-x")),
    })),
  );
  ok("…each with an extension badge", chips.map((c) => c.ext).join(",") === "MD,PDF", JSON.stringify(chips));
  ok("…the file's own name", chips[0].name === "notes.md" && chips[1].name === "rent-agreement.pdf");
  ok("…a size", chips.every((c) => /\d/.test(c.size)), JSON.stringify(chips.map((c) => c.size)));
  ok("…and a remove button", chips.every((c) => c.hasX));
  ok(
    "the count line counts documents against THEIR cap",
    (await page.textContent(".tray-count"))?.includes("2 of 3"),
    String(await page.textContent(".tray-count")),
  );
  ok(
    "the box is a caption field for a document too",
    (await page.getAttribute(".chat-input textarea", "placeholder"))?.startsWith("Add a caption"),
  );
  ok(
    "Send is reachable with only documents staged",
    (await page.getAttribute(".send-btn", "data-mode")) === "send",
  );

  // the fourth is refused
  await pickDocs(page, [docPaths.csv]);
  await page.waitForFunction(() => document.querySelectorAll(".tray-doc").length === 3, null, {
    timeout: 8000,
  });
  await page.click('[data-tel="chat.attach"]');
  await sleep(260);
  if ((await page.$('[data-tel="attach.document"]')) !== null) {
    await page.click('[data-tel="attach.document"]');
    await page.setInputFiles(DOC_INPUT, [docPaths.extra]);
    await sleep(900);
  } else {
    // at the cap the Document row is not rendered at all, which IS the answer
    await sleep(300);
    await page.keyboard.press("Escape");
    await sleep(300);
  }
  await shot(page, "17-fourth-document-refused");
  ok(
    "still three, never four",
    (await page.locator(".tray-doc").count()) === 3,
    `${await page.locator(".tray-doc").count()} chips`,
  );
  ok("the count still reads 3 of 3", (await page.textContent(".tray-count"))?.includes("3 of 3"));
  ok("NOTHING MODAL happened", (await page.$("dialog[open]")) === null);

  // one back off, then send with a caption
  await page.click(".tray-doc:nth-of-type(3) .tray-x");
  await page.waitForFunction(() => document.querySelectorAll(".tray-doc").length === 2, null, {
    timeout: 4000,
  });
  await page.fill(".chat-input textarea", "ye padh lena");
  await sleep(150);
  await page.click('[data-tel="chat.send"]');
  try {
    await page.waitForSelector(".msg.me .docchip", { timeout: 10_000 });
  } catch {
    dead("a document message never rendered in the thread");
  }
  await sleep(800);
  await shot(page, "18-documents-sent");

  const sent = await page.evaluate(() => {
    const mine = [...document.querySelectorAll(".chat-scroll .msg.me")];
    const b = mine[mine.length - 1];
    const chipsIn = [...b.querySelectorAll(".docchip")];
    return {
      mine: mine.length,
      chips: chipsIn.length,
      names: chipsIn.map((c) => c.querySelector(".docchip-name").textContent),
      text: b.textContent,
      isPhoto: b.classList.contains("photo"),
      hasTick: Boolean(b.querySelector(".tickicon")),
      hasTime: Boolean(b.querySelector(".t")),
      tappable: chipsIn.some((c) => c.tagName === "BUTTON" || c.querySelector("button")),
    };
  });
  ok("ONE message, not two", sent.mine === 1, JSON.stringify(sent));
  ok("…carrying both file chips", sent.chips === 2 && sent.names.join(",") === "notes.md,rent-agreement.pdf", JSON.stringify(sent.names));
  ok("…and the caption", sent.text.includes("ye padh lena"));
  ok("…as a TEXT bubble, not a photo one", !sent.isPhoto);
  ok("…with the existing tick and timestamp idiom", sent.hasTick && sent.hasTime);
  ok(
    "…and the chip is not a button",
    !sent.tappable,
    "the bytes were never kept, so a tap has nothing to open; a chip that " +
      "invited one would be a control that lies (DocChips.tsx)",
  );
  ok("the tray is empty again", (await page.locator(".tray-doc").count()) === 0);

  // ── THE WIRE ──
  //
  // Behind the burst clock: a document never uploads, so the first observable
  // moment is the reply pass that carries it. Waited for explicitly, and fatal
  // if it never comes, because "no doc request was seen" is exactly what a
  // broken seam looks like AND exactly what an impatient test looks like.
  const chat = await waitForPosted(
    posted,
    isDocRequest,
    20_000,
    "no request to /api/chat ever carried `docs`. Either the take-once box was " +
      "never filled by the send, or replyPass is not passing it into think().",
  );
  ok("the docs reached /api/chat", Boolean(chat), JSON.stringify(posted.map((p) => p.op ?? "chat")));
  ok("…as two entries", chat?.docs?.length === 2, JSON.stringify(chat?.docs?.length));
  ok("…named", chat?.docs?.[0]?.name === "notes.md" && chat?.docs?.[1]?.name === "rent-agreement.pdf");
  ok(
    "…the .md went up as TEXT the client read itself",
    typeof chat?.docs?.[0]?.text === "string" && chat.docs[0].text.includes("the roof leaked") &&
      chat.docs[0].data === undefined,
    JSON.stringify({ text: typeof chat?.docs?.[0]?.text, data: typeof chat?.docs?.[0]?.data }),
  );
  ok(
    "…the .pdf went up as DATA for the server to extract",
    typeof chat?.docs?.[1]?.data === "string" && chat.docs[1].data.startsWith("data:") &&
      chat.docs[1].text === undefined,
    JSON.stringify({ text: typeof chat?.docs?.[1]?.text, data: String(chat?.docs?.[1]?.data).slice(0, 30) }),
  );
  // THE CAPTION IS ALREADY IN THE TURN, so it is NOT repeated at the top
  // level. `/api/chat` accepts a `caption` field and appends it to the last
  // turn; the caption is also `Message.text`, which `toTurns` has already put
  // in that same turn. Sending both would put the sentence in the prompt twice
  // — the identical mistake the images rule exists to prevent, one field over.
  const lastTurn = JSON.stringify(chat?.messages?.[chat.messages.length - 1] ?? {});
  ok(
    "the caption is in the TURN, where toTurns already put it",
    lastTurn.includes("ye padh lena"),
    lastTurn.slice(0, 220),
  );
  ok(
    "…and the files are named there too, so she still has them in three months",
    /they sent 2 files/.test(lastTurn) && lastTurn.includes("notes.md"),
    lastTurn.slice(0, 260),
  );
  ok(
    "…and it is NOT repeated at the top level",
    chat?.caption === undefined,
    "the server appends `caption` to the last turn, which is the same turn " +
      "toTurns already wrote it into: two copies of one sentence",
  );
  ok(
    "…and NO images were passed through the seam",
    chat?.images === undefined,
    "pictures ride the thread; passing them here too doubles them in the prompt",
  );

  // THE SERVER'S OWN READER, over exactly what the page sent. This is the
  // join: everything above proves the client produced a shape, and this proves
  // the shape is the one api/_docs.js accepts and can read.
  const norm = normalizeDocs(chat?.docs ?? []);
  ok("the server accepts what was sent", norm.ok === true, JSON.stringify(norm).slice(0, 160));
  ok("…and extracts BOTH", norm.stats.extracted === 2, JSON.stringify(norm.stats));
  ok("…the text file's words", norm.blocks[0].includes("the roof leaked"));
  ok(
    "…and the PDF's",
    norm.blocks[1].includes("rent agreement"),
    norm.blocks[1].slice(0, 140),
  );

  // ── WHAT SURVIVES ──
  const stored = await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem("meera.state.v1") || "{}");
    return (s.messages || []).filter((m) => m.docs?.length).pop();
  });
  ok("the message persisted with its documents", stored?.docs?.length === 2, JSON.stringify(stored?.docs));
  ok("…name, mime and size", stored?.docs?.every((d) => d.name && typeof d.size === "number"));
  ok(
    "…and NOT one byte of the files themselves",
    JSON.stringify(stored?.docs ?? []).length < 400 &&
      !JSON.stringify(stored ?? {}).includes("data:application/pdf"),
    `${JSON.stringify(stored?.docs ?? []).length} chars — a 2 MB PDF in localStorage is ` +
      `saveState's whole degradation ladder fired by one attachment`,
  );
  await ctx.close();
}

// ════ 9. ONE MESSAGE, PICTURES AND FILES TOGETHER, IN DARK ════════════════
{
  console.log("\n── 9. both at once ──");
  const { page, ctx, posted } = await open({ theme: "dark" });
  await pick(page, 2);
  await page.waitForFunction(() => document.querySelectorAll(".tray-thumb").length === 2, null, {
    timeout: 12_000,
  });
  await pickDocs(page, [docPaths.pdf]);
  await page.waitForFunction(() => document.querySelectorAll(".tray-doc").length === 1, null, {
    timeout: 10_000,
  });
  await sleep(400);
  await shot(page, "19-tray-mixed-dark");
  ok(
    "the count line names both rather than counting one",
    (await page.textContent(".tray-count"))?.replace(/\s+/g, " ").trim() === "2 photos, 1 file",
    String(await page.textContent(".tray-count")),
  );
  ok("both kinds sit in the same tray", (await page.locator(".tray-thumb").count()) === 2 &&
    (await page.locator(".tray-doc").count()) === 1);

  await page.fill(".chat-input textarea", "ghar ke papers");
  await page.click('[data-tel="chat.send"]');
  try {
    await page.waitForSelector(".msg.me.photo .docchip", { timeout: 10_000 });
  } catch {
    dead("a mixed picture-and-document message never rendered");
  }
  await sleep(800);
  await shot(page, "20-mixed-sent-dark");
  const mixed = await page.evaluate(() => {
    const mine = [...document.querySelectorAll(".chat-scroll .msg.me")];
    const b = mine[mine.length - 1];
    const g = b.querySelector(".pgrid");
    const chip = b.querySelector(".docchip");
    const cap = b.querySelector(".cap");
    return {
      mine: mine.length,
      shape: g?.getAttribute("data-shape"),
      chips: b.querySelectorAll(".docchip").length,
      capBelowChip: chip && cap ? cap.getBoundingClientRect().top >= chip.getBoundingClientRect().bottom - 1 : false,
      cap: cap?.textContent,
    };
  });
  ok("ONE message carries both", mixed.mine === 1 && mixed.shape === "two" && mixed.chips === 1, JSON.stringify(mixed));
  ok("…the caption sits under everything", mixed.capBelowChip, JSON.stringify(mixed));
  ok("…and is the sentence typed", mixed.cap === "ghar ke papers");

  // ── THE INK, MEASURED, IN BOTH THEMES ──
  //
  // A chip inside a PHOTO bubble is on a white card in the light theme and a
  // dark one in dark, while a chip in his ordinary bubble is on rose in both.
  // A `.msg.me` rule reaches all three, and for one build of composer.css it
  // did: `--bubble-me-ink` (white) painted onto the white card, which is a
  // filename nobody can read. Ratios rather than eyes, because this is exactly
  // the failure a screenshot review slides past.
  const inkOf = async (p) =>
    p.evaluate(() => {
      const lum = (c) => {
        const [r, g, b] = c.match(/\d+(\.\d+)?/g).slice(0, 3).map((n) => {
          const v = Number(n) / 255;
          return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      // the chip paints over the bubble, so the real ground is the composite
      const chip = document.querySelector(".msg.me .docchip");
      const name = chip.querySelector(".docchip-name");
      let bgEl = chip;
      let bg = getComputedStyle(chip).backgroundColor;
      while (bgEl && /rgba\(0, 0, 0, 0\)|transparent/.test(bg)) {
        bgEl = bgEl.parentElement;
        bg = getComputedStyle(bgEl).backgroundColor;
      }
      // an alpha fill composites onto its parent; resolve that before measuring
      const a = Number((bg.match(/rgba?\([^)]*?([\d.]+)\)/) || [])[1] ?? 1);
      let ground = bg;
      if (a < 1) {
        let p = bgEl.parentElement;
        let under = getComputedStyle(p).backgroundColor;
        while (p && /rgba\(0, 0, 0, 0\)/.test(under)) {
          p = p.parentElement;
          under = getComputedStyle(p).backgroundColor;
        }
        const mix = (i) => {
          const f = Number(bg.match(/\d+(\.\d+)?/g)[i]);
          const u = Number(under.match(/\d+(\.\d+)?/g)[i]);
          return f * a + u * (1 - a);
        };
        ground = `rgb(${mix(0)}, ${mix(1)}, ${mix(2)})`;
      }
      const [hi, lo] = [lum(getComputedStyle(name).color), lum(ground)].sort((x, y) => y - x);
      return { ratio: (hi + 0.05) / (lo + 0.05), ink: getComputedStyle(name).color, ground };
    });
  const darkInk = await inkOf(page);
  ok(
    "the filename is readable on a photo bubble in DARK",
    darkInk.ratio >= 4.5,
    `${darkInk.ratio.toFixed(2)}:1 — ${darkInk.ink} on ${darkInk.ground}`,
  );

  const chat = await waitForPosted(
    posted,
    isDocRequest,
    20_000,
    "a mixed picture-and-document send never put `docs` on the wire",
  );
  ok("the file went through the seam", chat?.docs?.length === 1);
  ok(
    "…and the pictures did NOT",
    chat?.images === undefined,
    "they are already in the thread as image_url parts; sending them here as " +
      "well is the same picture twice in one prompt",
  );

  // ── SINGLE CONSUMPTION, END TO END ──
  //
  // The browser half of the offline take-once assertions, and the one that
  // would catch a wiring mistake the pure tests cannot see: a box that is
  // filled correctly and then never emptied, or emptied by the wrong pass.
  // He sends a plain text message right after, which starts a whole new reply
  // cycle on a thread whose history still contains the document message. That
  // cycle must carry NO docs.
  const docReqsBefore = posted.filter(isDocRequest).length;
  const chatReqsBefore = posted.filter((b) => b.op === "chat").length;
  await page.fill(".chat-input textarea", "aur ek baat");
  await page.click('[data-tel="chat.send"]');
  await page.waitForFunction(
    (n) => document.querySelectorAll(".chat-scroll .msg.me").length > n,
    mixed.mine,
    { timeout: 10_000 },
  );
  // wait for the NEXT reply pass to actually happen rather than sleeping and
  // hoping: an assertion that nothing was sent is worthless if nothing ran
  await waitForPosted(
    posted,
    (b, i, arr) => b.op === "chat" && arr.filter((x) => x.op === "chat").length > chatReqsBefore,
    20_000,
    "the follow-up text message never produced a reply pass, so the " +
      "single-consumption assertion below would have been measuring silence",
  );
  ok(
    "A SECOND PASS SENDS NO DOCS",
    posted.filter(isDocRequest).length === docReqsBefore,
    `${posted.filter(isDocRequest).length} doc-bearing requests, expected ${docReqsBefore}. ` +
      `The same file reaching her twice is her reacting to it twice.`,
  );
  ok(
    "…and a pass really did run",
    posted.filter((b) => b.op === "chat").length > chatReqsBefore,
    "the assertion above must be about a pass that happened, not about silence",
  );
  await ctx.close();
}

// ════ 10. THE SAME MESSAGE, IN LIGHT ══════════════════════════════════════
//
// The theme that had the bug. `.msg.me` reaches the photo bubble too, and the
// photo bubble is a WHITE card in this theme, so a rule written for the rose
// bubble painted white on white here and nowhere else.
{
  console.log("\n── 10. the same message, in light ──");
  const { page, ctx } = await open({ theme: "light" });
  await pick(page, 2);
  await page.waitForFunction(() => document.querySelectorAll(".tray-thumb").length === 2, null, {
    timeout: 12_000,
  });
  await pickDocs(page, [docPaths.pdf]);
  await page.waitForFunction(() => document.querySelectorAll(".tray-doc").length === 1, null, {
    timeout: 10_000,
  });
  await page.fill(".chat-input textarea", "ghar ke papers");
  await page.click('[data-tel="chat.send"]');
  try {
    await page.waitForSelector(".msg.me.photo .docchip", { timeout: 10_000 });
  } catch {
    dead("the mixed message never rendered in the light theme");
  }
  await sleep(800);
  await shot(page, "21-mixed-sent-light");
  const light = await page.evaluate(() => {
    const lum = (c) => {
      const [r, g, b] = c.match(/\d+(\.\d+)?/g).slice(0, 3).map((n) => {
        const v = Number(n) / 255;
        return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const chip = document.querySelector(".msg.me.photo .docchip");
    const name = chip.querySelector(".docchip-name");
    const ext = chip.querySelector(".docchip-ext");
    const ground = getComputedStyle(chip).backgroundColor;
    const ratio = (a, b) => {
      const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
      return (hi + 0.05) / (lo + 0.05);
    };
    return {
      name: ratio(getComputedStyle(name).color, ground),
      ext: ratio(getComputedStyle(ext).color, getComputedStyle(ext).backgroundColor),
      ink: getComputedStyle(name).color,
      ground,
    };
  });
  ok(
    "the filename is readable on a photo bubble in LIGHT",
    light.name >= 4.5,
    `${light.name.toFixed(2)}:1 — ${light.ink} on ${light.ground}. This is the ` +
      `white-on-white case: a .msg.me rule written for the rose bubble also ` +
      `reaches the white photo card.`,
  );
  ok(
    "…and so is the format badge",
    light.ext >= 4.5,
    `${light.ext.toFixed(2)}:1`,
  );

  // and a document-ONLY bubble in light, which is the rose one
  await pickDocs(page, [docPaths.md]);
  await page.waitForFunction(() => document.querySelectorAll(".tray-doc").length === 1, null, {
    timeout: 10_000,
  });
  await page.click('[data-tel="chat.send"]');
  await page.waitForSelector(".msg.me:not(.photo) .docchip", { timeout: 10_000 });
  await sleep(700);
  await shot(page, "22-document-only-light");
  const rose = await page.evaluate(() => {
    const lum = (c) => {
      const [r, g, b] = c.match(/\d+(\.\d+)?/g).slice(0, 3).map((n) => {
        const v = Number(n) / 255;
        return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const b = document.querySelector(".msg.me:not(.photo).hasdocs");
    const name = b.querySelector(".docchip-name");
    // the chip fill is a white alpha over the rose bubble: composite it
    const chip = b.querySelector(".docchip");
    const f = getComputedStyle(chip).backgroundColor.match(/\d+(\.\d+)?/g).map(Number);
    const u = getComputedStyle(b).backgroundColor.match(/\d+(\.\d+)?/g).map(Number);
    const a = f[3] ?? 1;
    const ground = `rgb(${f[0] * a + u[0] * (1 - a)}, ${f[1] * a + u[1] * (1 - a)}, ${f[2] * a + u[2] * (1 - a)})`;
    const [hi, lo] = [lum(getComputedStyle(name).color), lum(ground)].sort((x, y) => y - x);
    // the badge sits on the chip, so ITS ground is the chip's composite plus
    // its own fill: two alphas deep, and both of them have to be resolved or
    // the number is about a colour nothing paints
    const ext = b.querySelector(".docchip-ext");
    const ef = getComputedStyle(ext).backgroundColor.match(/\d+(\.\d+)?/g).map(Number);
    const ea = ef[3] ?? 1;
    const gnums = ground.match(/\d+(\.\d+)?/g).map(Number);
    const extBg = `rgb(${ef[0] * ea + gnums[0] * (1 - ea)}, ${ef[1] * ea + gnums[1] * (1 - ea)}, ${ef[2] * ea + gnums[2] * (1 - ea)})`;
    const [ehi, elo] = [lum(getComputedStyle(ext).color), lum(extBg)].sort((x, y) => y - x);
    return {
      ratio: (hi + 0.05) / (lo + 0.05),
      ink: getComputedStyle(name).color,
      ground,
      ext: (ehi + 0.05) / (elo + 0.05),
      extInk: getComputedStyle(ext).color,
      extBg,
    };
  });
  ok(
    "a document-only bubble is his ROSE one, and readable on it",
    rose.ratio >= 4.5,
    `${rose.ratio.toFixed(2)}:1 — ${rose.ink} on ${rose.ground}`,
  );
  ok(
    "…and its format badge is readable too",
    rose.ext >= 4.5,
    `${rose.ext.toFixed(2)}:1 — ${rose.extInk} on ${rose.extBg}. Eleven-pixel ` +
      `bold type is small TEXT, so it takes the 4.5 floor, not the 3.0 one a ` +
      `glyph gets.`,
  );
  await ctx.close();
}

await browser.close();
console.log(`\nscreenshots: ${SHOTS}`);
console.log(fails ? `\n${fails} FAILURES` : "\nALL PASS");
process.exit(fails ? 1 : 0);
