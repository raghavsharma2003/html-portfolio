// WS-SKYFELT — the two owner defects from real-device testing, in a browser.
//
//   npx vite build
//   npx vite preview --port 4291 --strictPort &
//   node evals/skyfelt-browser.mjs             # assert (exit 1 on failure)
//   node evals/skyfelt-browser.mjs --observe   # print, never fail
//
// ── why a browser, again ──────────────────────────────────────────────────
//
// `scripts/check-contrast.mjs` owns the NUMBERS: it composites both veil
// families over the shipped paintings' decoded pixels and holds the floors,
// and it now also pins the three laws that keep the sky veil apart from the
// plain one. Not one of those rows can see the defect that was reported.
//
// The defect was: "I selected Sky and no change." Every ratio passed while it
// was true, and every ratio would pass again if the sky alphas were quietly
// set back to the plain ones. What was wrong was a screen looking identical to
// another screen, which is a question about pixels on a page and can only be
// answered by putting two pages side by side.
//
// So this suite asserts the DIFFERENCE, at every state, as a measured
// luminance standard deviation on the ground between the bubbles — the same
// metric evals/world-thread-browser.mjs uses for the owner's earlier
// void/flat-paper screenshots, because it is the same kind of complaint about
// the same strip of pixels.
//
// The model is stubbed, so it is deterministic and costs $0. Runtime ~70s.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const B = process.env.MEERA_PREVIEW || "http://localhost:4291";
const OBSERVE = process.argv.includes("--observe");
const SHOTS = process.env.SKYFELT_SHOTS || join(process.cwd(), "skyfelt-shots");
mkdirSync(SHOTS, { recursive: true });

let fails = 0;
const ok = (n, c, e = "") => {
  console.log(`${c ? "ok  " : "FAIL"} ${n}${e ? " — " + e : ""}`);
  if (!c && !OBSERVE) fails++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });

const BASE_STATE = {
  onboarded: true,
  deviceId: "00000000-0000-4000-8000-0000000000f7",
  user: { name: "Raghav", vibe: ["late-night company"] },
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

const msg = (i, from, text) => ({
  id: `m${i}`,
  from,
  text,
  at: Date.now() - (40 - i) * 60_000,
  status: from === "me" ? "read" : undefined,
});

// The owner's own thread, as state — his screenshot at 11:27, four of hers and
// two of his, so the wine bubble is on screen next to hers in every shot.
const THREAD = [
  msg(1, "her", "heyyy"),
  msg(2, "her", "utha ki nhi abhi tak?"),
  msg(3, "me", "Just utha"),
  msg(4, "her", "soye soye 11 baj gaye nice"),
  msg(5, "her", "itne late Sunday ko? ki kal raat late the?"),
  msg(6, "me", "haan yaar so gaya tha"),
];

async function open({ sky = null, theme = undefined, state = {}, reduced = false, width = 390, height = 844 } = {}) {
  const ctx = await browser.newContext({
    viewport: { width, height },
    reducedMotion: reduced ? "reduce" : "no-preference",
    deviceScaleFactor: 2,
  });
  const page = await ctx.newPage();
  await page.route("**/api/chat", (r) =>
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ text: "haan bolo" }) }),
  );
  for (const p of [
    "**/api/memory", "**/api/telemetry", "**/api/consolidate", "**/api/account",
    "**/api/clock", "**/api/life", "**/api/search", "**/api/trace", "**/api/route",
    "**/api/gif", "**/api/speech",
  ]) {
    await page.route(p, (r) => r.fulfill({ status: 200, contentType: "application/json", body: "{}" }));
  }
  // `?sky=` is the ONE clock's seam. It has to be on the URL of the RELOAD as
  // well as of the first visit, or the state written to localStorage would be
  // read back on a page whose clock is the real one, and every screenshot
  // below would be of the wrong hour.
  const q = sky ? `?sky=${sky}` : "";
  await page.goto(`${B}/chat${q}`, { waitUntil: "domcontentloaded" });
  await page.evaluate(
    (s) => localStorage.setItem("meera.state.v1", JSON.stringify(s)),
    { ...BASE_STATE, ...(theme ? { theme } : {}), ...state },
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  await sleep(900);
  await page.click('[data-tel="home.open_chat"]');
  await page.waitForFunction(
    () => document.querySelector(".chat-wrap")?.getAttribute("data-surface") === "chat",
    null,
    { timeout: 8000 },
  );
  await sleep(600);
  await page.evaluate(() =>
    Promise.all(
      Array.from(document.images).filter((im) => !im.complete).map(
        (im) => new Promise((r) => { im.onload = im.onerror = r; }),
      ),
    ),
  );
  await sleep(450);
  return { page, ctx };
}

const shot = (page, name) => page.screenshot({ path: join(SHOTS, `${name}.png`) });

/** The strip of ground above the first message, as mean + sd of luminance.
 *  A flat wash has almost no sd; a painting coming through has one. Same
 *  measurement, same strip, as world-thread-browser.mjs. */
async function groundVariance(page) {
  const box = await page.evaluate(() => {
    const s = document.querySelector(".chat-scroll");
    const first = s.querySelector(".msg, .day-sep, .chat-empty");
    const r = s.getBoundingClientRect();
    const f = first ? first.getBoundingClientRect() : null;
    const top = r.top + 4;
    const bottom = f ? Math.min(f.top - 4, r.bottom) : r.bottom;
    return { x: r.x + 6, y: top, width: Math.max(8, r.width - 12), height: Math.max(8, bottom - top) };
  });
  const buf = await page.screenshot({ clip: box });
  const sharp = (await import("sharp")).default;
  const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
  const lums = [];
  for (let i = 0; i < data.length; i += info.channels) {
    lums.push(0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]);
  }
  const mean = lums.reduce((a, b) => a + b, 0) / lums.length;
  const sd = Math.sqrt(lums.reduce((a, b) => a + (b - mean) ** 2, 0) / lums.length);
  return { mean, sd, n: lums.length };
}

// ── 1. DEFECT 1: "I SELECTED SKY AND NO CHANGE" ───────────────────────────
//
// Two arms per state, same hour, same thread, same width: the CHOICE is `sky`
// in one and the palette sky resolves to in the other. Under the shipped
// build those two arms were byte-identical screens on morning and golden, and
// the assertion below is exactly the sentence that was false.
//
// The floor is stated as a RATIO of standard deviations rather than an
// absolute, because the absolute is a property of the painting: the night
// picture has a moon and a lit city in it and the morning one is mostly haze,
// so a single number would be met by one and unmeetable by another. 1.25x is
// under every measured value and well over measurement noise (two loads of the
// same arm differ by ~1%).
{
  console.log("\n── 1. sky mode is visible, at every hour ──");
  const table = [];
  for (const [sky, palette] of [
    ["night", "dark"],
    ["predawn", "dark"],
    ["morning", "light"],
    ["golden", "light"],
    ["dusk", "dark"],
  ]) {
    const arms = {};
    for (const [arm, theme] of [["plain", palette], ["sky", "sky"]]) {
      const { page, ctx } = await open({ sky, theme, state: { messages: THREAD } });
      // The palette must be the same in both arms or this is not an A/B, it
      // is two different themes. This is the sky-is-not-a-third-palette law,
      // read off the live DOM rather than trusted.
      const attrs = await page.evaluate(() => ({
        theme: document.documentElement.getAttribute("data-theme"),
        choice: document.documentElement.getAttribute("data-sky-choice"),
      }));
      ok(
        `${sky}/${arm}: resolves to the ${palette} palette`,
        attrs.theme === palette,
        `data-theme=${attrs.theme}`,
      );
      ok(
        `${sky}/${arm}: data-sky-choice is ${arm === "sky" ? "stamped" : "absent"}`,
        arm === "sky" ? attrs.choice === "on" : attrs.choice === null,
        String(attrs.choice),
      );
      await shot(page, `01-thread-${sky}-${arm}`);
      arms[arm] = await groundVariance(page);
      await ctx.close();
    }
    const r = arms.sky.sd / arms.plain.sd;
    table.push([sky, arms.plain.sd, arms.sky.sd, r]);
    ok(
      `${sky}: sky mode shows more of the painting than the plain palette`,
      r >= 1.25,
      `ground sd ${arms.plain.sd.toFixed(2)} -> ${arms.sky.sd.toFixed(2)} (${r.toFixed(2)}x), ` +
        `mean ${arms.plain.mean.toFixed(1)} -> ${arms.sky.mean.toFixed(1)}`,
    );
    // …and the palette's identity survives being shown more of the sky. The
    // inverse failure of the one above, and the one someone tuning for
    // presence reaches first: a light thread that became a photograph.
    ok(
      `${sky}: the ${palette} identity holds in sky mode`,
      palette === "light" ? arms.sky.mean >= 195 : arms.sky.mean <= 80,
      `mean ${arms.sky.mean.toFixed(1)}/255`,
    );
  }
  console.log("\n  ..  ground sd, plain -> sky:");
  for (const [s, a, b, r] of table) {
    console.log(`  ..    ${s.padEnd(8)} ${a.toFixed(2)} -> ${b.toFixed(2)}  (${r.toFixed(2)}x)`);
  }
}

// ── 2. THE CHOICE CONFIRMS ITSELF IN WORDS ────────────────────────────────
//
// The other half of the same defect. A person who taps Sky at 11:27 gets a
// picture that changed AND a line that says which hour it is and which of the
// two palettes that resolves to. Read at two states, so the "live" claim is
// proved by the line being DIFFERENT rather than by it merely existing.
{
  console.log("\n── 2. the settings line is live ──");
  const seen = {};
  for (const [sky, want] of [["morning", "light"], ["night", "dark"]]) {
    const { page, ctx } = await open({ sky, theme: "sky", state: { messages: THREAD } });
    await page.click('[data-tel="chat.settings"]');
    await page.waitForSelector('[data-tel="more.theme_hint"]', { timeout: 8000 });
    await sleep(500);
    await shot(page, `02-settings-sky-${sky}`);
    const line = (await page.textContent('[data-tel="more.theme_hint"]')).trim();
    seen[sky] = line;
    ok(`settings/${sky}: the line names the hour`, line.includes(sky === "morning" ? "morning" : "night"), line);
    ok(`settings/${sky}: the line names the palette it resolved to`, line.includes(want), line);
    ok(`settings/${sky}: no em-dash in the live line`, !line.includes("—"), line);
    await ctx.close();
  }
  ok("the settings line actually changes with the sky", seen.morning !== seen.night);

  // …and the STATIC line is still there for the other three choices, which is
  // the half a "make it live" change deletes by accident.
  {
    const { page, ctx } = await open({ sky: "morning", theme: "light", state: { messages: THREAD } });
    await page.click('[data-tel="chat.settings"]');
    await page.waitForSelector('[data-tel="more.theme_hint"]', { timeout: 8000 });
    await sleep(500);
    await shot(page, "02-settings-light-static");
    const line = (await page.textContent('[data-tel="more.theme_hint"]')).trim();
    ok("settings/light: the static explanation survives", /Sky follows/.test(line) && /Auto follows/.test(line), line);
    await ctx.close();
  }
}

// ── 3. DEFECT 2: "THE RED AND BLACK NOT GOING TOGETHER" ───────────────────
//
// The fill is read back as COMPUTED style rather than as the token the gate
// resolved — the same discipline the phase-3 battery states for bubble
// opacity, and for the same reason: a token is what the stylesheet meant and a
// computed style is what the browser did.
//
// Screenshots over the night AND dusk wallpapers, in both the plain and the
// sky-choice veil, which is the full set of grounds this bubble can float on
// at night. Those four images are the before/after the taste call was made
// from and they are what the owner looks at.
{
  console.log("\n── 3. his bubble at night ──");
  const WINE = "rgb(142, 64, 84)"; // #8e4054
  const DAY = "rgb(194, 63, 86)"; // #c23f56 — untouched
  for (const [sky, theme, label, want] of [
    ["night", "dark", "night-dark", WINE],
    ["night", "sky", "night-sky", WINE],
    ["dusk", "dark", "dusk-dark", WINE],
    ["dusk", "sky", "dusk-sky", WINE],
    ["morning", "light", "morning-light", DAY],
  ]) {
    const { page, ctx } = await open({ sky, theme, state: { messages: THREAD } });
    await shot(page, `03-bubble-${label}`);
    const seen = await page.evaluate(() => {
      const el = document.querySelector(".msg.me");
      const cs = getComputedStyle(el);
      const t = el.querySelector(".t");
      return {
        bg: cs.backgroundColor,
        op: cs.opacity,
        meta: t ? getComputedStyle(t).color : null,
      };
    });
    ok(`bubble/${label}: the fill on screen is ${want}`, seen.bg === want, seen.bg);
    ok(`bubble/${label}: still fully opaque`, seen.op === "1", seen.op);
    ok(`bubble/${label}: the timestamp is still painted`, Boolean(seen.meta), String(seen.meta));
    await ctx.close();
  }
}

// ── 4. REDUCED MOTION IS UNAFFECTED ───────────────────────────────────────
//
// Nothing in this workstream touches an animation, which is exactly why it is
// checked: "I did not touch it" is the belief every regression is filed
// against. A wallpaper is still by construction (WorldLayer renders no
// celestials into the variant), so the assertion is that the reduced-motion
// thread is the SAME thread — same veil, same bubble, same picture — not a
// stiller one.
{
  console.log("\n── 4. reduced motion ──");
  for (const [sky, theme, label] of [["morning", "sky", "morning-sky"], ["night", "sky", "night-sky"]]) {
    const a = await open({ sky, theme, state: { messages: THREAD } });
    const normal = await groundVariance(a.page);
    await a.ctx.close();
    const b = await open({ sky, theme, state: { messages: THREAD }, reduced: true });
    await shot(b.page, `04-reduced-${label}`);
    const reduced = await groundVariance(b.page);
    const anim = await b.page.evaluate(() =>
      Array.from(document.querySelectorAll(".chat > .world *")).filter(
        (e) => getComputedStyle(e).animationName !== "none",
      ).length,
    );
    await b.ctx.close();
    ok(
      `reduced/${label}: the same ground, not a different one`,
      Math.abs(normal.sd - reduced.sd) < 0.6 && Math.abs(normal.mean - reduced.mean) < 2,
      `sd ${normal.sd.toFixed(2)} vs ${reduced.sd.toFixed(2)}, mean ${normal.mean.toFixed(1)} vs ${reduced.mean.toFixed(1)}`,
    );
    ok(`reduced/${label}: nothing in the wallpaper animates`, anim === 0, `${anim} animated nodes`);
  }
}

// ── 5. THE APPLE-TERSE SHEETS ─────────────────────────────────────────────
//
// The owner's third verdict: "many places there is too much text we don't want
// that. we want apple like design." Shot for the eye, and asserted on the two
// things a copy edit can silently take: a LENGTH ceiling (so the paragraphs
// cannot creep back) and the honesty floor underneath the forget sheet, which
// is the one place compression is allowed to remove words and not facts.
{
  console.log("\n── 5. the sheets, trimmed ──");
  const { page, ctx } = await open({ sky: "morning", theme: "sky", state: { messages: THREAD } });
  await page.click('[data-tel="chat.settings"]');
  await page.waitForSelector(".sheet", { timeout: 8000 });
  await sleep(500);
  await shot(page, "05-sheet-settings");

  const settings = await page.evaluate(() => ({
    hint: document.querySelector('[data-tel="more.theme_hint"]')?.textContent.trim() ?? "",
    subs: Array.from(document.querySelectorAll(".ssub")).map((e) => e.textContent.trim()),
    foot: document.querySelector(".sheet-foot span")?.textContent.trim() ?? "",
  }));
  ok("settings: the appearance line is one line", settings.hint.length <= 80, `${settings.hint.length} chars`);
  for (const s of settings.subs) ok(`settings: row subtitle is short (${s.slice(0, 28)}…)`, s.length <= 46, `${s.length} chars`);
  // VERBATIM, and it is the one string in this sheet a copy pass may not
  // touch: it is the product's standing promise about what she is.
  ok(
    "settings: the AI-disclosure footer is verbatim",
    settings.foot === "Meera is an AI. She'll tell you so if you ask.",
    settings.foot,
  );

  await page.click('[data-tel="more.clear_chat"]');
  await sleep(400);
  await shot(page, "05-sheet-clear");
  const clear = await page.evaluate(() => ({
    body: document.querySelector(".confirm-body")?.textContent.trim() ?? "",
    fine: document.querySelector(".auth-fine")?.textContent.trim() ?? "",
  }));
  ok("clear: the body is one line", clear.body.length <= 100, `${clear.body.length}: ${clear.body}`);
  ok("clear: it still names the message count", /\d+ message/.test(clear.body), clear.body);
  // The undo promise is the TOAST's job now, not the sheet's. Pinned so the
  // paragraph cannot come back as "just one clarifying sentence".
  ok("clear: the sheet does not pre-narrate the undo", !/ten seconds/i.test(clear.body + clear.fine), clear.body);
  ok("clear: the footer shrank", clear.fine.length <= 40, `${clear.fine.length}: ${clear.fine}`);

  await page.goBack().catch(() => {});
  await ctx.close();
}
{
  const { page, ctx } = await open({ sky: "morning", theme: "sky", state: { messages: THREAD } });
  await page.click('[data-tel="chat.settings"]');
  await page.waitForSelector(".sheet", { timeout: 8000 });
  await sleep(400);
  await page.click('[data-tel="more.forget_all"]');
  await sleep(400);
  await shot(page, "05-sheet-forget");
  const forget = await page.evaluate(() => ({
    body: document.querySelector(".confirm-body")?.textContent.trim() ?? "",
    fine: document.querySelector(".auth-fine")?.textContent.trim() ?? "",
  }));
  ok("forget: the body is two short lines", forget.body.length <= 150, `${forget.body.length}: ${forget.body}`);
  // ── THE HONESTY FLOOR ───────────────────────────────────────────────────
  // Compression may take the enumeration. It may not take a fact. These three
  // are the facts a person would be owed in a deposition, and they are checked
  // as SUBSTRINGS of the rendered text rather than of the source, because what
  // was shipped is what is on the screen.
  ok("forget: it still says her knowledge of your life goes", /knows about your life/i.test(forget.body), forget.body);
  ok("forget: it still says every message and call goes", /every message and call/i.test(forget.body), forget.body);
  ok("forget: it still says it cannot be undone", /cannot be undone/i.test(forget.body), forget.body);
  ok("forget: the alternative survives in one line", /yeh bhool ja/.test(forget.fine) && forget.fine.length <= 70, `${forget.fine.length}: ${forget.fine}`);
  await ctx.close();
}

await browser.close();
console.log(fails ? `\n${fails} FAILURES` : "\nALL PASS");
process.exit(fails && !OBSERVE ? 1 : 0);
