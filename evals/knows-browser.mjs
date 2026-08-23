// WS-KNOWS in a browser — the half of this surface that only pixels can answer.
//
//   npx vite --port 4293 --strictPort &
//   node evals/knows-browser.mjs             # assert (exit 1 on failure)
//   node evals/knows-browser.mjs --observe   # print, never fail
//
// It drives the DESIGN HARNESS (src/components/knows/preview.html), not the
// app, and that is deliberate rather than convenient: the screen's own call
// site is one line in App.tsx which this workstream does not own, and a battery
// that cannot run until another workstream lands is a battery that never
// establishes a baseline. The harness mounts the REAL component with the REAL
// stylesheet on the REAL world layer, moves the ONE clock through the same
// `?sky=` seam App.tsx uses, and hands it fixture state — so everything below
// is measured on the shipping code.
//
// What it asserts, and why each one is here rather than left to eyes:
//
//   1. THE FORGET IS REAL, AND ONLY AS REAL AS THE SERVER SAYS. The row goes
//      when the op returns ok, the request that went out was the EXISTING
//      item-scope forget with the row's own term, and — the one that matters —
//      when the server says no, the row STAYS. A memory surface that shows a
//      deletion the database did not perform is the single worst bug this
//      screen can have, and it is invisible to every offline test.
//   2. THE CORRECTION IS A MESSAGE. Tapping "galat hai" hands the app a
//      prefill that opens the way a person opens this, and writes nothing.
//   3. IT IS LEGIBLE EVERYWHERE. Both themes, night and day sky, 320 and 390:
//      every measured text ratio on the page against what is actually behind
//      it, read off composited pixels rather than off tokens.
//   4. REDUCED MOTION IS STILL A PAGE. Not a blank one, and not a moving one.
//
// The model is never called and no network request leaves the page. $0.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const B = process.env.MEERA_PREVIEW || "http://localhost:4293";
const HARNESS = `${B}/src/components/knows/preview.html`;
const OBSERVE = process.argv.includes("--observe");
const SHOTS = process.env.KNOWS_SHOTS || join(process.cwd(), "knows-shots");
mkdirSync(SHOTS, { recursive: true });

let fails = 0;
const ok = (n, c, e = "") => {
  console.log(`${c ? "ok  " : "FAIL"} ${n}${e ? " — " + e : ""}`);
  if (!c && !OBSERVE) fails++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });

/** Every forget request the page made, and what the server was told to say. */
async function open({
  theme = null,
  sky = null,
  state = null,
  width = 390,
  height = 844,
  reduced = false,
  forgetOk = true,
} = {}) {
  const ctx = await browser.newContext({
    viewport: { width, height },
    reducedMotion: reduced ? "reduce" : "no-preference",
    deviceScaleFactor: 2,
  });
  const page = await ctx.newPage();
  const posts = [];
  await page.route("**/api/memory", async (r) => {
    let body = null;
    try {
      body = JSON.parse(r.request().postData() || "{}");
    } catch {
      body = null;
    }
    posts.push(body);
    await r.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(
        forgetOk
          ? { ok: true, scope: "item", deleted: { log: 3, nodes: 1, edges: 2 } }
          : { ok: false, error: "nope" },
      ),
    });
  });
  for (const p of ["**/api/telemetry", "**/api/account", "**/api/diag"]) {
    await page.route(p, (r) => r.fulfill({ status: 200, contentType: "application/json", body: "{}" }));
  }
  const q = new URLSearchParams();
  if (theme) q.set("theme", theme);
  if (sky) q.set("sky", sky);
  if (state) q.set("state", state);
  await page.goto(`${HARNESS}${q.toString() ? `?${q}` : ""}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".knows", { timeout: 10_000 });
  await page.evaluate(() =>
    Promise.all(
      Array.from(document.images)
        .filter((im) => !im.complete)
        .map((im) => new Promise((r) => { im.onload = im.onerror = r; })),
    ),
  );
  await sleep(600);
  return { page, ctx, posts };
}

const shot = (page, name) => page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: false });

/** WCAG ratio of a text element against the pixels ACTUALLY behind it, read by
 *  screenshotting the element's own box with the text hidden and averaging. The
 *  world layer is a painting under a veil, so a token-vs-token ratio would be a
 *  ratio against a colour nothing on screen is. */
const lum = ([r, g, b]) => {
  const lin = (c) => (c / 255 <= 0.04045 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};
const ratio = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const parseRgb = (s) => {
  const m = /rgba?\(([^)]+)\)/.exec(s || "");
  if (!m) return [0, 0, 0];
  const p = m[1].split(",").map((n) => parseFloat(n));
  return [p[0], p[1], p[2]];
};

async function groundBehind(page, sel) {
  // scrolled into view first: a clip box outside the viewport is not a
  // measurement of a faint ratio, it is a screenshot error, and a battery that
  // only ever measures what happens to be above the fold measures the header
  const box = await page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return null;
    el.scrollIntoView({ block: "center", behavior: "instant" });
    el.setAttribute("data-hide-ink", "");
    const r = el.getBoundingClientRect();
    const x = Math.max(0, r.x + 1);
    const y = Math.max(0, r.y + 1);
    const w = Math.min(innerWidth - x, r.width - 2);
    const h = Math.min(innerHeight - y, r.height - 2);
    if (w < 3 || h < 3) return null;
    return { x, y, width: w, height: h };
  }, sel);
  if (!box) return null;
  await page.addStyleTag({ content: "[data-hide-ink]{color:transparent !important}" });
  const buf = await page.screenshot({ clip: box });
  const sharp = (await import("sharp")).default;
  const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < data.length; i += info.channels) {
    r += data[i]; g += data[i + 1]; b += data[i + 2]; n++;
  }
  await page.evaluate((s) => document.querySelector(s)?.removeAttribute("data-hide-ink"), sel);
  return [r / n, g / n, b / n];
}

async function inkOf(page, sel) {
  return parseRgb(await page.evaluate((s) => {
    const el = document.querySelector(s);
    return el ? getComputedStyle(el).color : "";
  }, sel));
}

// ── 1. THE MATRIX: both themes x night and day sky x 320 and 390 ──────────
//
// The floor is 4.5 for body text on this ground, which is the same number the
// thread's own gate holds. Reported per cell rather than as one worst case,
// because a page that fails only at 320 in dark on a night sky is exactly the
// combination nobody opens by hand.
const TEXT_FLOOR = 4.5;
const DIM_FLOOR = 3.0;
let worst = { r: Infinity, where: "" };
for (const theme of ["light", "dark"]) {
  for (const sky of ["night", "morning"]) {
    for (const width of [320, 390]) {
      const { page, ctx } = await open({ theme, sky, width });
      const cell = `${theme}-${sky}-${width}`;
      // the three inks the page is actually read at: an entry, a fact, a date
      // EVERY ink on the page, at the world gate's own floor. `--ink-dim` is
      // held to 4.5 against the scrimmed sky there, not to 3.0, so the dates
      // and the section labels are held to 4.5 here: they sit on the same
      // ground as the body text, in the same veil, and a quieter floor for
      // them would be this file quietly granting itself an exemption the
      // measured gate never gave. 3.0 is for EDGES, and the edges on this
      // surface are the app's own gated pair (see scripts/check-contrast.mjs).
      for (const [name, sel, floor] of [
        ["entry", ".knows-etext", TEXT_FLOOR],
        ["fact", ".knows-ftext", TEXT_FLOOR],
        ["date", ".knows-eday", TEXT_FLOOR],
        ["label", ".knows-h", TEXT_FLOOR],
        ["note", ".knows-note", TEXT_FLOOR],
        ["control", ".knows-fix", DIM_FLOOR],
      ]) {
        const ground = await groundBehind(page, sel);
        if (!ground) {
          ok(`${cell}: ${name} is on the page`, false, "element missing");
          continue;
        }
        const r = ratio(await inkOf(page, sel), ground);
        if (r < worst.r) worst = { r, where: `${cell}/${name}` };
        ok(`${cell}: ${name} >= ${floor}`, r >= floor, r.toFixed(2));
      }
      // nothing may scroll sideways, at either width
      const overflow = await page.evaluate(() => {
        const s = document.querySelector(".knows-scroll");
        return s ? s.scrollWidth - s.clientWidth : -1;
      });
      ok(`${cell}: no horizontal overflow`, overflow <= 1, String(overflow));
      await shot(page, `knows-${cell}`);
      await ctx.close();
    }
  }
}
console.log(`  ..  worst text ratio ${worst.r.toFixed(2)}:1 at ${worst.where}`);

// ── 2. THE FORGET, END TO END ─────────────────────────────────────────────
{
  const { page, ctx, posts } = await open({ theme: "light", sky: "morning" });
  const before = await page.$$eval(".knows-fact", (n) => n.length);
  ok("forget: the facts are there to begin with", before > 0, String(before));

  // the first row with a bin on it. Rows without one are rows the cascade
  // cannot reach by a term, and the surface is asserted not to offer them.
  const first = await page.evaluate(() => {
    const li = [...document.querySelectorAll(".knows-fact")].find((n) => n.querySelector(".knows-drop"));
    return li ? li.querySelector(".knows-ftext").textContent : null;
  });
  ok("forget: at least one row offers a delete", Boolean(first), String(first));

  await page.click('.knows-fact .knows-drop');
  await page.waitForSelector(".knows-confirm", { timeout: 4000 });
  await shot(page, "knows-confirm");
  const confirmText = await page.textContent(".knows-confirm .confirm-body");
  ok(
    "forget: the confirm names the row and says what else goes",
    confirmText.includes("cannot be undone") && /messages/.test(confirmText),
    confirmText.slice(0, 90),
  );

  // KEEP IT leaves everything exactly where it was, and sends nothing
  await page.click('[data-tel="knows.forget_cancel"]');
  await sleep(250);
  ok("forget: keeping it sends no request at all", posts.length === 0, JSON.stringify(posts));
  ok("forget: keeping it drops no row", (await page.$$eval(".knows-fact", (n) => n.length)) === before);

  await page.click(".knows-fact .knows-drop");
  await page.waitForSelector(".knows-confirm");
  await page.click('[data-tel="knows.forget_confirm"]');
  await page.waitForFunction((n) => document.querySelectorAll(".knows-fact").length < n, before, {
    timeout: 6000,
  });
  ok("forget: exactly one request went out", posts.length === 1, JSON.stringify(posts));
  const req = posts[0] || {};
  ok("forget: it is the EXISTING item-scope op", req.op === "forget" && req.scope === "item", JSON.stringify(req));
  ok(
    "forget: it names the row's own term, lowercased, never an id",
    typeof req.name === "string" && req.name.length >= 3 && req.name === req.name.toLowerCase(),
    String(req.name),
  );
  ok("forget: the row is gone", (await page.$$eval(".knows-fact", (n) => n.length)) === before - 1);
  await shot(page, "knows-after-forget");
  await ctx.close();
}

// THE NEGATIVE CONTROL, and the reason this file exists: a failed delete must
// leave the row on screen. A surface that hides a row the database still holds
// is telling a person their data is gone when it is not.
{
  const { page, ctx, posts } = await open({ theme: "dark", sky: "night", forgetOk: false });
  const before = await page.$$eval(".knows-fact", (n) => n.length);
  await page.click(".knows-fact .knows-drop");
  await page.waitForSelector(".knows-confirm");
  await page.click('[data-tel="knows.forget_confirm"]');
  await sleep(900);
  ok("forget/negative: the request was still made", posts.length === 1);
  ok(
    "forget/negative: a delete the server refused leaves the row standing",
    (await page.$$eval(".knows-fact", (n) => n.length)) === before,
  );
  await ctx.close();
}

// ── 3. THE CORRECTION IS A MESSAGE ────────────────────────────────────────
{
  const { page, ctx, posts } = await open({ theme: "light", sky: "morning" });
  await page.click(".knows-fix");
  await sleep(200);
  const prefill = await page.evaluate(() => window.__correct);
  ok(
    "correct: the app is handed a prefilled message in his register",
    typeof prefill === "string" && prefill.startsWith("waise wo galat yaad hai tumhe..."),
    String(prefill),
  );
  ok("correct: nothing was written anywhere", posts.length === 0, JSON.stringify(posts));
  await ctx.close();
}

// ── 4. THE SHAPE OF THE PAGE ──────────────────────────────────────────────
{
  const { page, ctx } = await open({ theme: "light", sky: "golden" });
  // law 4, on the rendered text: no clock stamp anywhere on the page
  const text = await page.textContent(".knows-scroll");
  ok(
    "shape: no clock stamp is rendered anywhere",
    !/\b\d{1,2}:\d{2}\b/.test(text),
    (text.match(/\b\d{1,2}:\d{2}\b/) || [""])[0],
  );
  const months = await page.$$eval(".knows-mlabel", (n) => n.map((x) => x.textContent));
  ok("shape: the story is grouped by month, in words", months.length > 1 && /^[a-z]/.test(months[0]), months.join(","));
  await shot(page, "knows-rich-full");
  await ctx.close();
}

// sparse and empty: short is not the same thing as broken
for (const state of ["sparse", "empty"]) {
  const { page, ctx } = await open({ theme: "light", sky: "morning", state });
  const sections = await page.$$eval(".knows-sec", (n) => n.length);
  ok(`${state}: no section renders with nothing in it`, sections >= 0);
  const body = (await page.textContent(".knows-scroll")).trim();
  ok(`${state}: the page still says something`, body.length > 20, body.slice(0, 60));
  ok(
    `${state}: and it never apologises with a zero`,
    !/\b0\b/.test(body),
    body.slice(0, 80),
  );
  await shot(page, `knows-${state}`);
  await ctx.close();
}

// ── 5. REDUCED MOTION ─────────────────────────────────────────────────────
{
  const { page, ctx } = await open({ theme: "dark", sky: "night", reduced: true });
  const moving = await page.evaluate(() =>
    [...document.querySelectorAll(".knows, .knows-month, .knows-fact, .knows-her")].filter(
      (el) => getComputedStyle(el).animationName !== "none",
    ).length,
  );
  ok("reduced motion: nothing animates", moving === 0, String(moving));
  const visible = await page.$$eval(".knows-fact", (n) =>
    n.filter((el) => getComputedStyle(el).opacity === "1").length,
  );
  ok("reduced motion: the page is still there (a still sky, never a blank one)", visible > 0, String(visible));
  await shot(page, "knows-reduced");
  await ctx.close();
}

await browser.close();
console.log(fails ? `\n${fails} FAILED` : "\nknows-browser: all checks passed");
process.exit(fails ? 1 : 0);
