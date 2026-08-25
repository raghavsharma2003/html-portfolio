// WS-ASSETWIRE in a real browser — the half of this work only a browser can
// answer.
//
//   npx vite build
//   npx vite preview --port 4292 --strictPort &
//   xvfb-run -a node evals/assetwire-browser.mjs            # assert
//   xvfb-run -a node evals/assetwire-browser.mjs --observe  # print, never fail
//
// ── why a browser ──────────────────────────────────────────────────────────
//
// `evals/assetwire/run.mjs` proves the RULES: the path the module produces is a
// file on disk, the reduce branch chooses the still half, the stored value is
// the character. None of that can prove the one thing this workstream is
// actually about, which is that the artwork ARRIVES ON SCREEN. Six failures
// live only here, and every one of them ships green against the offline suite:
//
//   1. A REQUESTED IMAGE THAT NEVER DECODES. `naturalWidth === 0` is what a
//      404, a wrong base path, a corrupt file and a blocked request all look
//      like, and all four render as an empty box that reads as spacing.
//   2. AN INLINE SVG WITH NO SIZE. `currentColor` marks are inlined precisely
//      so they take the tile's ink; an <svg> with only a viewBox and no CSS
//      reaching it lays out at the browser's default 300x150 or at zero.
//   3. THE STORED VALUE. The offline suite reads the CALL SITE; this reads
//      what actually landed in localStorage after a real tap on a real picker.
//   4. THE REDUCE BRANCH, DECIDED BY THE BROWSER rather than by a stub — a
//      real `prefers-reduced-motion` emulation on a real matchMedia.
//   5. BOTH GROUNDS. The illustrations are painted to sit on light and on
//      dark; only a browser composites them against the real wallpaper.
//   6. THE LANDING WORDMARK. A mask that paints nothing, or paints a solid
//      rectangle because the mask URL 404s, is invisible to every other gate
//      in this repo.
//
// ── DEAD-WRITERS LAW ───────────────────────────────────────────────────────
//
// This battery FAILS LOUDLY when it cannot drive the app, exactly as
// `evals/composer-browser.mjs` does. Every wait is a `waitForSelector` with a
// timeout that throws, never a sleep-and-hope, and the three preconditions
// that would silently turn this file into a no-op — no preview server, no
// chromium, the chat screen never reaching `data-surface` — each exit non-zero
// with a sentence saying which one it was. A browser battery that times out
// quietly and prints ALL PASS is a green light attached to nothing.
//
// The model is stubbed and every API route is fulfilled locally, so it is
// deterministic and costs $0.

import { chromium } from "playwright";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const BASE = process.env.MEERA_PREVIEW || "http://localhost:4292";
const OBSERVE = process.argv.includes("--observe");
const SHOTS = process.env.ASSETWIRE_SHOTS || join(ROOT, "gameplay-shots", "assetwire");
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

// ── fixtures ───────────────────────────────────────────────────────────────
const t0 = Date.UTC(2026, 6, 1, 9, 0, 0);
const msg = (i, from, kind, text, extra = {}) => ({
  id: `m${i}`,
  from,
  kind,
  text,
  at: t0 + i * 60_000,
  ...extra,
});

/** A thread with something of every kind the record counts. */
const THREAD = [
  msg(1, "her", "text", "arre finally, kahan the tum"),
  msg(2, "me", "text", "kaam mein phasa tha yaar"),
  msg(3, "her", "text", "hmm. chalo ab batao"),
  msg(4, "me", "text", "kal wali baat yaad hai?"),
  { ...msg(5, "her", "callmark", "4:12"), at: t0 + 5 * 60_000 },
  { ...msg(6, "her", "photo", "terrace se, aaj"), photoSeed: "terrace sunset" },
  {
    ...msg(7, "me", "text", "yeh dono dekh lo"),
    docs: [
      { name: "rent-agreement.pdf", mime: "application/pdf", size: 184_320 },
      { name: "spend.csv", mime: "text/csv", size: 2_048 },
      { name: "readme.md", mime: "text/markdown", size: 912 },
    ],
  },
  msg(8, "her", "text", "padh ke batati hu"),
];

const BASE_STATE = {
  onboarded: true,
  deviceId: "00000000-0000-4000-8000-0000000a55e7",
  user: { name: "Raghav", vibe: [], facts: {} },
  messages: THREAD,
  // every one of the six record rows renders only when its count is above
  // zero, so the fixture has to give all six something to count
  tally: { chessGames: 4, chessWinsHim: 1, chessWinsHer: 3, tttGames: 9, wyrCards: 17 },
  momentsFired: ["days-7", "msgs-100"],
  openrouterKey: "",
  openrouterModel: "",
  apiKey: "",
  elevenKey: "",
  elevenVoiceId: "",
  sarvamKey: "",
  deviceVoice: "",
  lastSeen: t0 + 9 * 60_000,
};

// ── the app ────────────────────────────────────────────────────────────────
let browser;
try {
  browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
} catch (e) {
  dead(`chromium would not start (${String(e.message).slice(0, 160)})`);
}

const API = [
  "**/api/chat", "**/api/memory", "**/api/telemetry", "**/api/consolidate",
  "**/api/account", "**/api/clock", "**/api/life", "**/api/search", "**/api/trace",
  "**/api/route", "**/api/gif", "**/api/speech", "**/api/episodes", "**/api/diag",
  "**/api/push-token", "**/api/relstate",
];

async function open({ theme = "light", reduce = false, state = BASE_STATE } = {}) {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    hasTouch: true,
    isMobile: true,
    // THE REAL PREFERENCE, not a stub. This is what makes the reduce section
    // below a browser test rather than a second copy of the offline one.
    reducedMotion: reduce ? "reduce" : "no-preference",
    colorScheme: theme === "dark" ? "dark" : "light",
  });
  const page = await ctx.newPage();
  for (const p of API) {
    await page.route(p, (r) =>
      r.fulfill({ status: 200, contentType: "application/json", body: "{}" }),
    );
  }
  try {
    await page.goto(`${BASE}/chat`, { waitUntil: "domcontentloaded", timeout: 15_000 });
  } catch (e) {
    dead(
      `no preview server at ${BASE}. Run \`npx vite build && npx vite preview ` +
        `--port 4292 --strictPort\` first (${String(e.message).slice(0, 120)})`,
    );
  }
  await page.evaluate((s) => localStorage.setItem("meera.state.v1", JSON.stringify(s)), {
    ...state,
    theme,
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  return { page, ctx };
}

async function intoChat(page) {
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
}

const shot = (page, name) => page.screenshot({ path: join(SHOTS, `${name}.png`) });

/**
 * Open one of the home cards.
 *
 * `force`, and the reason is a feature rather than a workaround: the cards
 * DRIFT (HomeScreen.tsx, a per-index transform animation that never settles),
 * so playwright's actionability check waits forever for an element that is
 * never going to hold still. Forcing the click is what a finger does. The
 * `waitForSelector` above it is still the real precondition, so a card that
 * genuinely is not there still fails loudly.
 */
async function openCard(page, id) {
  try {
    await page.waitForSelector(`[data-tel="home.card.${id}"]`, { timeout: 12_000 });
    await page.click(`[data-tel="home.card.${id}"]`, { force: true, timeout: 8000 });
  } catch (e) {
    dead(`the home card "${id}" would not open (${String(e.message).slice(0, 160)})`);
  }
}

/**
 * THE 404 CHECK, and the only honest form of it.
 *
 * A request that fails paints nothing and reports nothing; the symptom is
 * `naturalWidth === 0` on an <img> that has finished loading. This walks every
 * image currently in the document and returns the broken ones by src, so a
 * mistyped path anywhere on the screen under test is named rather than merely
 * absent.
 */
const brokenImages = (page) =>
  page.evaluate(async () => {
    const imgs = [...document.images];
    await Promise.all(
      imgs.map((i) =>
        i.complete ? null : new Promise((r) => i.addEventListener("load", r, { once: true }) || setTimeout(r, 3000)),
      ),
    );
    return [...document.images].filter((i) => i.naturalWidth === 0).map((i) => i.currentSrc || i.src);
  });

/** Every inline <svg> that laid out at nothing, or at the browser's default. */
const unsizedSvgs = (page, sel) =>
  page.$$eval(sel, (nodes) =>
    nodes
      .map((n) => {
        const svg = n.querySelector("svg") ?? (n.tagName === "svg" ? n : null);
        if (!svg) return { where: n.className, box: null };
        const r = svg.getBoundingClientRect();
        return { where: String(n.className), box: [Math.round(r.width), Math.round(r.height)] };
      })
      .filter((x) => !x.box || x.box[0] < 4 || x.box[1] < 4 || (x.box[0] === 300 && x.box[1] === 150)),
  );

// ════ 1. THE REACTION PICKER ═══════════════════════════════════════════════
{
  console.log("\n── 1. the reaction picker, and what a tap stores ──");
  const { page, ctx } = await open();
  await intoChat(page);

  await page.waitForSelector(".msg", { timeout: 8000 });
  await page.click('[data-mid="m1"]');
  try {
    await page.waitForSelector(".react-bar", { timeout: 6000 });
  } catch {
    dead("tapping a bubble did not open the reaction bar");
  }
  await sleep(400); // the bar's own 160ms rise, settled
  await shot(page, "01-reaction-picker-open");

  const picks = await page.$$eval(".react-pick", (bs) =>
    bs.map((b) => {
      const img = b.querySelector("img");
      return {
        label: b.getAttribute("aria-label"),
        src: img ? img.currentSrc || img.src : null,
        w: img ? img.naturalWidth : 0,
        box: img ? Math.round(img.getBoundingClientRect().width) : 0,
      };
    }),
  );
  ok("the picker still offers six", picks.length === 6, JSON.stringify(picks.map((p) => p.label)));
  ok(
    "every one of them is our own artwork, animated",
    picks.every((p) => p.src && /\/anim\/react-[a-z]+\.webp$/.test(p.src)),
    picks.map((p) => p.src).join("\n      "),
  );
  ok(
    "…and every one of them actually decoded",
    picks.every((p) => p.w > 0),
    picks.filter((p) => !p.w).map((p) => p.src).join(", "),
  );
  ok(
    "…at the size the emoji occupied before it",
    picks.every((p) => p.box === 21),
    picks.map((p) => p.box).join(", "),
  );
  // The accessible name is still the EMOJI, because that is what the action
  // does and a screen reader announcing "react react-heart" would be reading
  // a filename to somebody.
  ok(
    "the accessible names still name emoji, not files",
    picks.every((p) => p.label && !/anim|webp|svg/.test(p.label)),
    picks.map((p) => p.label).join(" | "),
  );

  const chipSvg = await page.$$eval(".reply-chip svg", (n) =>
    n.map((s) => {
      const r = s.getBoundingClientRect();
      return [Math.round(r.width), Math.round(r.height)];
    }),
  );
  ok("the reply chip carries an inline, sized mark", chipSvg.length === 1 && chipSvg[0][0] === 16, JSON.stringify(chipSvg));

  // ── THE STORED VALUE ─────────────────────────────────────────────────────
  await page.click(".react-pick"); // the first: ❤️
  await page.waitForSelector(".react-pill", { timeout: 6000 });
  await sleep(400);
  await shot(page, "02-reaction-pill-landed");

  const stored = await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem("meera.state.v1") || "{}");
    return (s.messages || []).filter((m) => m.reaction).map((m) => m.reaction);
  });
  ok("one reaction was stored", stored.length === 1, JSON.stringify(stored));
  ok(
    "what is stored is the EMOJI CHARACTER, not a path",
    stored[0] === "❤️",
    JSON.stringify(stored[0]),
  );
  ok(
    "…and nothing anywhere in the persisted state names an asset",
    await page.evaluate(() => !/\/anim\/|\.webp/.test(localStorage.getItem("meera.state.v1") || "")),
  );

  const pill = await page.$eval(".react-pill", (p) => {
    const img = p.querySelector("img");
    return {
      label: p.getAttribute("aria-label"),
      src: img ? img.currentSrc || img.src : null,
      w: img ? img.naturalWidth : 0,
      box: img ? Math.round(img.getBoundingClientRect().width) : 0,
    };
  });
  ok("the pill paints the same artwork", /\/anim\/react-heart\.webp$/.test(String(pill.src)), String(pill.src));
  ok("…decoded, at pill size", pill.w > 0 && pill.box === 15, JSON.stringify(pill));
  ok("…and still announces the emoji", /❤️/.test(String(pill.label)), String(pill.label));

  // ── THE FILE BADGES, in the thread ───────────────────────────────────────
  await page.waitForSelector(".docchip", { timeout: 6000 });
  const badges = await page.$$eval(".docchip-ext", (ns) =>
    ns.map((n) => {
      const svg = n.querySelector("svg");
      const r = svg?.getBoundingClientRect();
      return {
        ext: n.getAttribute("data-ext"),
        drawn: n.hasAttribute("data-art"),
        box: r ? [Math.round(r.width), Math.round(r.height)] : null,
        text: n.textContent.trim(),
      };
    }),
  );
  ok("the thread shows three file badges", badges.length === 3, JSON.stringify(badges));
  const pdf = badges.find((b) => b.ext === "PDF");
  const csv = badges.find((b) => b.ext === "CSV");
  const md = badges.find((b) => b.ext === "MD");
  ok("the PDF badge is the drawn mark, at tile size", Boolean(pdf?.drawn) && pdf.box?.[0] === 38, JSON.stringify(pdf));
  ok("so is the CSV", Boolean(csv?.drawn) && csv.box?.[0] === 38, JSON.stringify(csv));
  ok(
    "an unknown extension keeps the letters it always had",
    md && !md.drawn && md.text === "MD",
    JSON.stringify(md),
  );
  await page.locator(".docchip").first().scrollIntoViewIfNeeded();
  await sleep(200);
  await shot(page, "03-file-badges");

  ok("no image on the thread failed to decode", (await brokenImages(page)).length === 0, (await brokenImages(page)).join(", "));
  await ctx.close();
}

// ════ 2. REDUCED MOTION, DECIDED BY THE BROWSER ════════════════════════════
{
  console.log("\n── 2. reduced motion ──");
  const { page, ctx } = await open({ reduce: true });
  await intoChat(page);
  await page.waitForSelector(".msg", { timeout: 8000 });
  await page.click('[data-mid="m1"]');
  await page.waitForSelector(".react-bar", { timeout: 6000 });
  await sleep(300);

  const srcs = await page.$$eval(".react-pick img", (is) => is.map((i) => i.currentSrc || i.src));
  ok("with reduce set, every pick is the still half", srcs.every((s) => s.endsWith(".svg")), srcs.join("\n      "));
  ok("…and not one .webp was requested", !srcs.some((s) => s.includes(".webp")));
  ok("…and every still half decoded", (await brokenImages(page)).length === 0, (await brokenImages(page)).join(", "));

  await page.click(".react-pick");
  await page.waitForSelector(".react-pill img", { timeout: 6000 });
  const pillSrc = await page.$eval(".react-pill img", (i) => i.currentSrc || i.src);
  ok("the pill takes the same branch", pillSrc.endsWith(".svg"), pillSrc);
  await sleep(300);
  await shot(page, "04-reduced-motion-picker");
  await ctx.close();
}

// ════ 3. THE EMPTY STATES, ON BOTH GROUNDS ═════════════════════════════════
for (const theme of ["light", "dark"]) {
  console.log(`\n── 3. the empty states (${theme}) ──`);
  const { page, ctx } = await open({
    theme,
    state: { ...BASE_STATE, messages: [], tally: null, momentsFired: [] },
  });
  await intoChat(page);
  try {
    await page.waitForSelector(".chat-empty", { timeout: 8000 });
  } catch {
    dead("the empty thread never rendered its furnished state");
  }
  const art = await page.$eval(".chat-empty .ce-art", (i) => ({
    src: i.currentSrc || i.src,
    w: i.naturalWidth,
    box: Math.round(i.getBoundingClientRect().width),
  }));
  ok(`${theme}: the empty thread carries its drawing`, art.w > 0 && art.box > 100, JSON.stringify(art));
  // THE ART NEVER REPLACES THE COPY. Both lines are still there, under it.
  const copy = await page.$eval(".chat-empty", (n) => n.textContent.trim());
  ok(`${theme}: the copy is untouched under it`, /Say hi to|is writing to you/.test(copy) && /Hinglish/.test(copy), copy.slice(0, 80));
  await sleep(500);
  await shot(page, `05-empty-thread-${theme}`);

  // …and the board that has not been played on yet, which is the other empty
  // state with a picture and the one that is deterministic to reach.
  //
  // WS-ASSETWIRE FINDING, recorded here because a test is where it will be
  // read: the `what she remembers` empty branch is NOT reachable from a
  // running app, so it is not asserted here. `Chat.tsx` improvises her opening
  // message the moment `messages.length === 0` and falls back to a stored
  // "heyy" when the network is dead, so the thread has one message within a
  // beat of any mount — which puts a "she texted you first" row in the
  // timeline and takes the screen out of `empty` forever. The scrapbook is
  // wired and its path is gated by `evals/assetwire/run.mjs`; what cannot be
  // gated is a screenshot of a state the product leaves before anyone can see
  // it. This paragraph is the honest version of "not covered".
  await page.reload({ waitUntil: "domcontentloaded" });
  await openCard(page, "chess");
  try {
    await page.waitForSelector(".cx-mv-empty", { timeout: 10_000 });
  } catch (e) {
    dead(`the chess board never opened (${String(e.message).slice(0, 160)})`);
  }
  const board = await page.$eval(".cx-mv-empty", (n) => {
    const img = n.querySelector("img");
    return {
      src: img ? img.currentSrc || img.src : null,
      w: img ? img.naturalWidth : 0,
      box: img ? Math.round(img.getBoundingClientRect().width) : 0,
      text: n.textContent.trim(),
    };
  });
  ok(`${theme}: the empty move list carries its drawing`, board.w > 0 && board.box > 80, JSON.stringify({ ...board, src: String(board.src).slice(0, 40) }));
  ok(`${theme}: and the line it always had, under it`, board.text === "no moves yet", board.text);
  await page.locator(".cx-mv-empty").scrollIntoViewIfNeeded();
  await sleep(400);
  await shot(page, `06-empty-moves-${theme}`);
  ok(`${theme}: nothing on either screen failed to decode`, (await brokenImages(page)).length === 0, (await brokenImages(page)).join(", "));
  await ctx.close();
}

// ════ 4. THE RECORD, WITH ITS MARKS ════════════════════════════════════════
{
  console.log("\n── 4. the us screen's stat marks ──");
  const { page, ctx } = await open();
  await openCard(page, "us");
  try {
    await page.waitForSelector(".us-line", { timeout: 8000 });
  } catch (e) {
    dead(`the us screen never opened (${String(e.message).slice(0, 160)})`);
  }
  const lines = await page.$$eval(".us-line", (ns) =>
    ns.map((n) => {
      const svg = n.querySelector(".us-glyph svg");
      const r = svg?.getBoundingClientRect();
      return {
        what: n.querySelector(".us-what")?.textContent.trim(),
        box: r ? [Math.round(r.width), Math.round(r.height)] : null,
      };
    }),
  );
  ok("all six rows of the record rendered", lines.length === 6, JSON.stringify(lines.map((l) => l.what)));
  ok(
    "every row carries an inline mark at 19px",
    lines.every((l) => l.box && l.box[0] === 19 && l.box[1] === 19),
    JSON.stringify(lines),
  );
  ok(
    "the phrase is still the phrase",
    lines.every((l) => l.what && l.what.length > 3),
    JSON.stringify(lines.map((l) => l.what)),
  );
  ok("no mark laid out at the default 300x150", (await unsizedSvgs(page, ".us-glyph")).length === 0);
  await page.locator(".us-line").first().scrollIntoViewIfNeeded();
  await sleep(700); // the rows' own staggered rise
  await shot(page, "07-us-stat-marks");
  await ctx.close();
}

// ════ 4b. THE "OR" COIN ════════════════════════════════════════════════════
{
  console.log("\n── 4b. the would-you-rather coin ──");
  const { page, ctx } = await open();
  await openCard(page, "would-you-rather");
  try {
    await page.waitForSelector(".wyr-or", { timeout: 10_000 });
  } catch (e) {
    dead(`would-you-rather never opened (${String(e.message).slice(0, 160)})`);
  }
  const coin = await page.$eval(".wyr-or", (n) => {
    const svg = n.querySelector("svg");
    const r = svg?.getBoundingClientRect();
    const cs = getComputedStyle(n);
    return {
      hasSvg: Boolean(svg),
      box: r ? [Math.round(r.width), Math.round(r.height)] : null,
      // the word is ENGRAVED in the artwork, so the element must have no text
      // of its own left over next to it
      text: n.textContent.trim(),
      // and it must not have kept its own ring on top of the drawn one
      border: cs.borderTopWidth,
      colour: cs.color,
    };
  });
  ok("the divider is the drawn coin", coin.hasSvg && coin.box?.[0] === 34, JSON.stringify(coin));
  ok("…with no leftover text beside the engraving", coin.text === "", JSON.stringify(coin.text));
  ok("…and only one ring, the artwork's", coin.border === "0px", coin.border);
  ok("no inline mark laid out at the browser default", (await unsizedSvgs(page, ".wyr-or")).length === 0);
  await sleep(500);
  await shot(page, "08-wyr-or-coin");
  ok("nothing on the wyr screen failed to decode", (await brokenImages(page)).length === 0, (await brokenImages(page)).join(", "));
  await ctx.close();
}

// ════ 5. THE ONBOARDING BLOOM ══════════════════════════════════════════════
{
  console.log("\n── 5. the onboarding bloom ──");
  const { page, ctx } = await open({ state: { ...BASE_STATE, onboarded: false, messages: [] } });
  try {
    await page.waitForSelector('[data-tel="onboarding.start"]', { timeout: 12_000 });
    await page.click('[data-tel="onboarding.start"]');
    await page.waitForSelector(".onb-bloom", { timeout: 6000 });
  } catch (e) {
    dead(`onboarding never reached the name step (${String(e.message).slice(0, 160)})`);
  }
  const bloom = await page.$eval(".onb-bloom", (i) => ({
    src: i.currentSrc || i.src,
    w: i.naturalWidth,
    box: Math.round(i.getBoundingClientRect().width),
    alt: i.getAttribute("alt"),
  }));
  ok("the bloom is our own file", /\/anim\/bloom\.webp$/.test(String(bloom.src)), String(bloom.src));
  ok("…decoded, at the 30px the glyph was", bloom.w > 0 && bloom.box === 30, JSON.stringify(bloom));
  ok("…and it still announces itself in the heading", Boolean(bloom.alt), String(bloom.alt));
  const heading = await page.$eval(".onb-q", (n) => n.textContent.replace(/\s+/g, " ").trim());
  ok("the greeting is otherwise untouched", /Hi, main/.test(heading) && /bulaun/.test(heading), heading);
  await sleep(600);
  await shot(page, "09-onboarding-bloom");
  ok("nothing on the onboarding screen failed to decode", (await brokenImages(page)).length === 0, (await brokenImages(page)).join(", "));
  await ctx.close();
}

// ════ 6. THE LANDING WORDMARK ══════════════════════════════════════════════
//
// The landing page is not in `dist` until `scripts/vercel-build.sh` shuffles it
// there, so this section serves `site/` off the filesystem through the browser's
// own router rather than through a second build. Same bytes that ship.
{
  console.log("\n── 6. the landing wordmark ──");
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  const page = await ctx.newPage();
  const FILES = {
    "/": "site/index.html",
    "/privacy": "site/privacy.html",
    "/styles.css": "site/styles.css",
  };
  const TYPES = {
    ".html": "text/html", ".css": "text/css", ".svg": "image/svg+xml",
    ".jpg": "image/jpeg", ".png": "image/png", ".webmanifest": "application/manifest+json",
  };
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    let rel = FILES[url.pathname];
    if (!rel && url.pathname.startsWith("/assets/")) rel = `site${url.pathname}`;
    if (!rel) rel = `public${url.pathname}`;
    const abs = join(ROOT, rel);
    if (!existsSync(abs)) return route.fulfill({ status: 404, body: "" });
    return route.fulfill({
      status: 200,
      contentType: TYPES[extname(abs)] || "application/octet-stream",
      body: readFileSync(abs),
    });
  });
  try {
    await page.goto("https://landing.test/?sky=night", { waitUntil: "load", timeout: 15_000 });
    await page.waitForSelector(".hero-mark", { timeout: 8000 });
  } catch (e) {
    dead(`the landing page would not load off disk (${String(e.message).slice(0, 160)})`);
  }

  const marks = await page.$$eval(".wordmark, .hero-mark, .foot-mark", (ns) =>
    ns.map((n) => {
      const cs = getComputedStyle(n);
      const r = n.getBoundingClientRect();
      const t = n.querySelector(".mk-t");
      const tr = t?.getBoundingClientRect();
      return {
        cls: n.className,
        mask: cs.maskImage || cs.webkitMaskImage,
        bg: cs.backgroundColor,
        box: [Math.round(r.width), Math.round(r.height)],
        textBox: tr ? [Math.round(tr.width), Math.round(tr.height)] : null,
        text: t?.textContent,
      };
    }),
  );
  ok("all three marks are on the page", marks.length === 3, JSON.stringify(marks.map((m) => m.cls)));
  ok(
    "each is masked with the wordmark file",
    marks.every((m) => /wordmark\.svg/.test(String(m.mask))),
    marks.map((m) => `${m.cls}: ${String(m.mask).slice(0, 60)}`).join("\n      "),
  );
  ok(
    "each is painted in the page's own ink, not black",
    marks.every((m) => m.bg && m.bg !== "rgba(0, 0, 0, 0)" && m.bg !== "rgb(0, 0, 0)"),
    marks.map((m) => `${m.cls}: ${m.bg}`).join(", "),
  );
  ok(
    "each has a real box, in the aspect the artwork is drawn at",
    marks.every((m) => m.box[0] > 30 && Math.abs(m.box[0] / m.box[1] - 368.8 / 150) < 0.06),
    JSON.stringify(marks.map((m) => m.box)),
  );
  ok(
    "the word survives in the DOM at every one of them",
    marks.every((m) => m.text === "maya"),
    JSON.stringify(marks.map((m) => m.text)),
  );
  ok(
    "…and is clipped out of the paint, so it does not double up",
    marks.every((m) => m.textBox && m.textBox[0] <= 2 && m.textBox[1] <= 2),
    JSON.stringify(marks.map((m) => m.textBox)),
  );
  // The mask file has to actually FETCH. A 404 leaves `background: currentColor`
  // painting an unmasked rectangle, which is the ugliest failure available here
  // and the one nothing else in this repo can see.
  const maskLoaded = await page.evaluate(async () => {
    const r = await fetch("/assets/wordmark.svg");
    return r.ok && (await r.text()).includes("<svg");
  });
  ok("the mask file is reachable at the URL the stylesheet names", maskLoaded);
  await sleep(300);
  await shot(page, "10-landing-wordmark");

  // The privacy page shares the shell, and gained its own card.
  await page.goto("https://landing.test/privacy", { waitUntil: "load", timeout: 15_000 });
  await page.waitForSelector(".wordmark", { timeout: 8000 });
  const og = await page.$$eval('meta[property^="og:"]', (ms) =>
    Object.fromEntries(ms.map((m) => [m.getAttribute("property"), m.getAttribute("content")])),
  );
  ok(
    "privacy.html now shares as a card",
    og["og:title"] && og["og:description"] && /og-privacy\.jpg$/.test(String(og["og:image"])),
    JSON.stringify(og),
  );
  const cardOk = await page.evaluate(async () => {
    const r = await fetch("/assets/og-privacy.jpg");
    return r.ok;
  });
  ok("…and the card it names is served", cardOk);
  await shot(page, "11-landing-privacy");
  await ctx.close();
}

await browser.close();
console.log(
  fails
    ? `\nFAIL  ${fails} browser check${fails === 1 ? "" : "s"} failed. Shots in ${SHOTS}`
    : `\n  ok  every wired asset arrived on screen. Shots in ${SHOTS}`,
);
process.exit(fails ? 1 : 0);
