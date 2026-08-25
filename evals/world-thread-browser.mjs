// WS-PHASE3 — the thread's wallpaper, the header band, onboarding in the
// world, and the typing row's own layout slot. Measured in a real browser.
//
//   npx vite build
//   npx vite preview --port 4289 --strictPort &
//   node evals/world-thread-browser.mjs            # assert (exit 1 on failure)
//   node evals/world-thread-browser.mjs --observe  # print, never fail
//
// ── why a browser ─────────────────────────────────────────────────────────
//
// `scripts/check-contrast.mjs` proves the wallpaper's NUMBERS: it composites
// the veil over the shipped paintings' decoded pixels and holds the floors. It
// cannot prove the veil is on screen. Every failure this file exists to catch
// is of that second kind — a wallpaper layer that renders behind an opaque
// scroller and is therefore invisible would pass every ratio in the gate,
// because the gate is measuring a composite the browser never performs. That
// is the same species of hole the gate itself records under "THE ONE
// ASSUMPTION THE NUMBERS BELOW REST ON": a model of a composite cannot notice
// the composite is not happening.
//
// So this suite reads real pixels off a real page, and asserts the four
// things a stylesheet cannot promise:
//
//   1. THE OWNER'S TWO SCREENSHOTS, FIXED. A dark 4-message thread that was a
//      near-black void, and a light thread that was flat paper. Both are
//      measured as VARIANCE in the ground between bubbles: a void has none.
//   2. THE TYPING ROW DOES NOT OVERLAP THE LAST BUBBLE. Bounding boxes, at
//      two thread lengths and mid-burst. This is a geometry fact and geometry
//      is exactly what a browser has and a linter does not.
//   3. THE WALLPAPER DOES NOT MOVE WHEN THE THREAD DOES. Its box is sampled
//      across a 300-message flick, and the frame times are compared against
//      the same flick with the layer removed.
//   4. THE BUBBLES ARE STILL OPAQUE, read back as computed style rather than
//      as the token the gate resolved.
//
// NOT wired into evals/run.mjs, for the same by-construction reason
// evals/feel-browser.mjs and evals/burst-browser.mjs state: it needs a built
// app and a server on a port. It is in version control because `dead-writers`
// does not stop being true for evals.
//
// The model is stubbed, so it is deterministic and costs $0. Runtime ~90s.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const B = process.env.MEERA_PREVIEW || "http://localhost:4289";
const OBSERVE = process.argv.includes("--observe");
const SHOTS = process.env.PHASE3_SHOTS || join(process.cwd(), "phase3-shots");
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
  deviceId: "00000000-0000-4000-8000-0000000000f3",
  user: { name: "Raghav", vibe: [] },
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

const msg = (i, from, text, at) => ({
  id: `m${i}`,
  from,
  text,
  at: at ?? Date.now() - (400 - i) * 60_000,
  status: from === "me" ? "read" : undefined,
});

/** The owner's dark screenshot, as state: a thread with almost nothing in it.
 *  This is the case that produced a screen of pure black. */
const SPARSE = [
  msg(1, "her", "heyyy"),
  msg(2, "her", "jaag rahe ho abhi tak??"),
  msg(3, "me", "Kkrh"),
  msg(4, "her", "kuch nahi yaaaar bed pe padi hu"),
];

const LONG = Array.from({ length: 300 }, (_, i) =>
  msg(
    i + 1,
    i % 3 === 2 ? "me" : "her",
    i % 7 === 0
      ? "waise us waqt exact kya chal rha tha life me, if you don't mind telling?"
      : "acha sun na",
  ),
);

async function open({
  sky = null,
  theme = undefined,
  state = {},
  reduced = false,
  width = 390,
  height = 844,
  onboarding = false,
  script = ["arre haan"],
  delayMs = 120,
} = {}) {
  const ctx = await browser.newContext({
    viewport: { width, height },
    reducedMotion: reduced ? "reduce" : "no-preference",
    deviceScaleFactor: 2,
  });
  const page = await ctx.newPage();
  let i = 0;
  await page.route("**/api/chat", async (route) => {
    const n = i++;
    await sleep(typeof delayMs === "function" ? delayMs(n) : delayMs);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ text: script[Math.min(n, script.length - 1)] }),
    });
  });
  for (const p of [
    "**/api/memory", "**/api/telemetry", "**/api/consolidate", "**/api/account",
    "**/api/clock", "**/api/life", "**/api/search", "**/api/trace", "**/api/route",
    "**/api/gif", "**/api/speech",
  ]) {
    await page.route(p, (r) =>
      r.fulfill({ status: 200, contentType: "application/json", body: "{}" }),
    );
  }
  // `?sky=` is the ONE clock's test seam (sky.ts): it moves the clock rather
  // than adding a second one, so the palette, the painting and the wallpaper
  // veil all resolve from the same instant. Screenshotting a state any other
  // way would be screenshotting a combination production cannot produce.
  const q = sky ? `?sky=${sky}` : "";
  await page.goto(`${B}/chat${q}`, { waitUntil: "domcontentloaded" });
  await page.evaluate(
    (s) => localStorage.setItem("meera.state.v1", JSON.stringify(s)),
    { ...BASE_STATE, ...(theme ? { theme } : {}), ...state },
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  await sleep(onboarding ? 700 : 900);
  if (!onboarding) {
    await page.click('[data-tel="home.open_chat"]');
    await page.waitForFunction(
      () => document.querySelector(".chat-wrap")?.getAttribute("data-surface") === "chat",
      null,
      { timeout: 8000 },
    );
    await sleep(600);
  }
  // the paintings are the thing under test; never shoot before they decode
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

// ── 1. THE OWNER'S TWO SCREENSHOTS ────────────────────────────────────────
//
// Both failures are properties of the GROUND BETWEEN THE BUBBLES, so that is
// what is sampled: a horizontal strip of the scroll region above the first
// message, read as pixels, reduced to the standard deviation of luminance.
//
// A void has a standard deviation of ~0. A painted sky at 40% through a veil
// has a real one. That is the whole difference the owner photographed, and it
// is a number rather than an opinion.
async function groundVariance(page) {
  const box = await page.evaluate(() => {
    const s = document.querySelector(".chat-scroll");
    const first = s.querySelector(".msg, .day-sep, .chat-empty");
    const r = s.getBoundingClientRect();
    const f = first ? first.getBoundingClientRect() : null;
    // the empty band between the header and the first thing in the thread
    const top = r.top + 4;
    const bottom = f ? Math.min(f.top - 4, r.bottom) : r.bottom;
    return { x: r.x + 6, y: top, width: Math.max(8, r.width - 12), height: Math.max(8, bottom - top) };
  });
  const buf = await page.screenshot({ clip: box });
  // decode with the same library the contrast gate uses
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

{
  console.log("\n── 1. the owner's two screenshots ──");
  // the grim void: dark theme, 4 messages, night sky
  {
    const { page, ctx } = await open({ sky: "night", theme: "dark", state: { messages: SPARSE } });
    await shot(page, "01-owner-dark-sparse-FIXED");
    const g = await groundVariance(page);
    ok(
      "dark sparse thread is atmospheric, not a void",
      g.sd >= 3.0,
      `sd ${g.sd.toFixed(2)} (mean ${g.mean.toFixed(1)}) over ${g.n}px`,
    );
    await ctx.close();
  }
  // the flat paper: light theme, the same thread, a day sky
  {
    const { page, ctx } = await open({ sky: "morning", theme: "light", state: { messages: SPARSE } });
    await shot(page, "02-owner-light-flat-FIXED");
    const g = await groundVariance(page);
    ok(
      "light thread has a wallpaper, not flat paper",
      g.sd >= 1.2,
      `sd ${g.sd.toFixed(2)} (mean ${g.mean.toFixed(1)})`,
    );
    ok(
      "…and the light identity is still LIGHT",
      g.mean >= 200,
      `mean luminance ${g.mean.toFixed(1)}/255`,
    );
    await ctx.close();
  }
}

// ── 2. THE TYPING ROW OWNS ITS OWN SLOT ───────────────────────────────────
//
// The bug the owner photographed: the three-dot bubble drawn ON the previous
// message's bottom edge. Its cause is that no `.msg + .msg` rhythm rule has
// ever matched it (it is not a `.msg`), so it had zero margin and a `-6px`
// halo bleeding upward out of its own border box.
//
// Asserted as GEOMETRY, at both thread lengths and mid-burst, and against the
// halo's real extent rather than the element's border box — a check that only
// looked at `getBoundingClientRect()` would have PASSED the shipped bug,
// because the boxes merely touched and it was the pseudo-element that
// overlapped.
{
  console.log("\n── 2. the typing row vs the last bubble ──");
  const measure = (page) =>
    page.evaluate(() => {
      const t = document.querySelector(".typing-bubble:not([data-leaving])");
      if (!t) return null;
      const rows = Array.from(document.querySelectorAll(".chat-scroll .msg"));
      const last = rows[rows.length - 1];
      if (!last) return null;
      const tb = t.getBoundingClientRect();
      const lb = last.getBoundingClientRect();
      // the halo is `inset: -6px` on ::after, and `typing-breathe` scales the
      // element to 1.018 about its centre. Both are drawn OUTSIDE the border
      // box, so the real ink extends further up than the box does.
      const cs = getComputedStyle(t, "::after");
      const inset = Math.abs(parseFloat(cs.top) || 0);
      const scaleLift = (tb.height * 0.018) / 2;
      return {
        gap: tb.top - lb.bottom,
        haloReach: inset + scaleLift,
        typingTop: tb.top,
        lastBottom: lb.bottom,
      };
    });

  for (const [label, messages] of [["4-message", SPARSE], ["300-message", LONG]]) {
    const { page, ctx } = await open({
      sky: "night",
      theme: "dark",
      state: { messages },
      delayMs: 4000,
    });
    await page.fill(".chat-input textarea", "kya scene hai");
    await page.click('[data-tel="chat.send"]');
    await page.waitForSelector(".typing-bubble", { timeout: 8000 });
    await sleep(700);
    const m = await measure(page);
    await shot(page, `03-typing-${label}-AFTER`);
    ok(`${label}: typing row and last bubble do not intersect`, m && m.gap > 0, m ? `gap ${m.gap.toFixed(1)}px` : "no typing row");
    ok(
      `${label}: the halo clears the bubble above too`,
      m && m.gap >= m.haloReach,
      m ? `gap ${m.gap.toFixed(1)}px vs halo reach ${m.haloReach.toFixed(1)}px` : "",
    );
    await ctx.close();
  }

  // MID-BURST, which is the case a single sample cannot cover: her reply
  // splits into several bubbles, so the typing row's NEIGHBOUR changes
  // underneath it while it is on screen. The failure mode is a gap that is
  // correct at rest and wrong for the frames right after an append, so this
  // samples the gap repeatedly across the whole burst and asserts the WORST
  // one — a single reading taken at a lucky moment is how the shipped bug
  // survived every previous look at this thread.
  {
    const { page, ctx } = await open({
      sky: "night",
      theme: "dark",
      state: { messages: SPARSE },
      script: ["ek sec ruko. haan bolo na yaar. kya hua batao"],
      delayMs: 2500,
    });
    await page.fill(".chat-input textarea", "hello");
    await page.click('[data-tel="chat.send"]');
    const samples = [];
    for (let i = 0; i < 40; i++) {
      const m = await measure(page);
      if (m) samples.push(m);
      if (i === 12) await shot(page, "04-typing-mid-burst-AFTER");
      await sleep(250);
    }
    const worst = samples.length
      ? samples.reduce((a, b) => (b.gap - b.haloReach < a.gap - a.haloReach ? b : a))
      : null;
    ok("mid-burst: the typing row was actually observed", samples.length >= 4, `${samples.length} samples across the burst`);
    ok(
      "mid-burst: typing row owns its slot in EVERY sampled frame",
      worst && worst.gap >= worst.haloReach,
      worst ? `worst gap ${worst.gap.toFixed(1)}px vs halo ${worst.haloReach.toFixed(1)}px` : "never seen",
    );
    await ctx.close();
  }
}

// ── 3. THE WALLPAPER DOES NOT MOVE, AND DOES NOT COST ─────────────────────
//
// Two claims, measured separately because they fail separately.
//
// GEOMETRY: the layer's box is read before, during and after a 300-message
// flick. A wallpaper that scrolled with the thread would be a parallax nobody
// asked for and a repaint on every frame.
//
// COST: the same flick is timed with the layer present and with it removed,
// in the SAME page, and the p95 frame time is compared. The baseline is
// measured FIRST and from the real tree rather than from a remembered number
// — the pre-wallpaper build is not available to run against, and a baseline
// nobody can reproduce is not a baseline.
{
  console.log("\n── 3. the wallpaper's geometry and cost ──");
  const { page, ctx } = await open({ sky: "night", theme: "dark", state: { messages: LONG } });

  const FLICK = `
    (async () => {
      const s = document.querySelector(".chat-scroll");
      const w = document.querySelector(".chat > .world");
      const boxes = [];
      const frames = [];
      s.scrollTop = s.scrollHeight;
      await new Promise((r) => requestAnimationFrame(r));
      let last = performance.now();
      const top0 = s.scrollTop;
      for (let i = 0; i < 90; i++) {
        s.scrollTop = top0 - i * 26;
        await new Promise((r) => requestAnimationFrame(r));
        const now = performance.now();
        frames.push(now - last);
        last = now;
        if (w) { const b = w.getBoundingClientRect(); boxes.push([b.x, b.y, b.width, b.height]); }
      }
      frames.sort((a, b) => a - b);
      return { p95: frames[Math.floor(frames.length * 0.95)], median: frames[frames.length >> 1], boxes };
    })()`;

  // BASELINE FIRST: the layer removed from the render tree entirely, which is
  // the closest reproducible stand-in for the build that had no wallpaper.
  await page.evaluate(() => {
    const w = document.querySelector(".chat > .world");
    if (w) w.style.display = "none";
  });
  await sleep(300);
  const before = await page.evaluate(FLICK);
  await page.evaluate(() => {
    const w = document.querySelector(".chat > .world");
    if (w) w.style.display = "";
  });
  await sleep(300);
  const after = await page.evaluate(FLICK);

  const moved = after.boxes.some(
    (b) => Math.abs(b[0] - after.boxes[0][0]) > 0.5 || Math.abs(b[1] - after.boxes[0][1]) > 0.5,
  );
  ok("the wallpaper's box never moves during a 300-message flick", !moved, `${after.boxes.length} frames sampled`);

  const structural = await page.evaluate(() => {
    const s = document.querySelector(".chat-scroll");
    const w = document.querySelector(".chat > .world");
    return { exists: Boolean(w), insideScroller: Boolean(w && s && s.contains(w)) };
  });
  ok("the wallpaper layer exists", structural.exists);
  // THE STRUCTURAL PROOF, and it is the one that survives a refactor: a layer
  // that is not a descendant of the scroller cannot be repainted by scrolling
  // it. The frame times below are evidence; this is the reason.
  ok("the wallpaper is NOT inside the scroll container", !structural.insideScroller);

  const ratio = after.p95 / before.p95;
  ok(
    "p95 frame time within 1.2x of the no-wallpaper baseline",
    ratio <= 1.2,
    `${before.p95.toFixed(2)}ms -> ${after.p95.toFixed(2)}ms (${ratio.toFixed(3)}x), median ${before.median.toFixed(2)} -> ${after.median.toFixed(2)}`,
  );

  // the bubbles, read back as COMPUTED style rather than as a token
  const bubbles = await page.evaluate(() => {
    const g = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const cs = getComputedStyle(el);
      return { bg: cs.backgroundColor, op: cs.opacity };
    };
    return { her: g(".msg.her"), me: g(".msg.me") };
  });
  for (const [who, v] of Object.entries(bubbles)) {
    ok(
      `.msg.${who} is fully opaque on screen`,
      v && !/rgba\([^)]*,\s*0?\.\d+\)/.test(v.bg) && v.op === "1",
      v ? `${v.bg} @ ${v.op}` : "not found",
    );
  }
  await shot(page, "05-wallpaper-long-thread");
  await ctx.close();
}

// ── 4. FIVE SKIES x TWO THEMES x TWO WIDTHS ───────────────────────────────
{
  console.log("\n── 4. the thread at every sky, theme and width ──");
  for (const sky of ["night", "predawn", "morning", "golden", "dusk"]) {
    for (const theme of ["light", "dark"]) {
      for (const width of [390, 320]) {
        const { page, ctx } = await open({
          sky,
          theme,
          width,
          state: { messages: SPARSE },
        });
        await shot(page, `10-thread-${sky}-${theme}-${width}`);
        // ── THE WALLPAPER CONTRIBUTES, MEASURED AS AN A/B ─────────────────
        //
        // The first version of this check asserted a fixed variance floor and
        // failed night/light and predawn/light at sd 0.5. That was the CHECK
        // being wrong, not the design: a near-black painting seen through a
        // 0.94 warm veil is arithmetically almost featureless, and it is
        // SUPPOSED to be — "the light identity stays light" is the mandate,
        // and a light-themed thread at midnight that looked like night would
        // be the failure, not the fix. A fixed floor across ten combinations
        // was a number that could only be met by breaking half of them.
        //
        // So the honest question is not "is there enough variance" but "is
        // the wallpaper doing anything at all", and that is an A/B: the same
        // strip of ground, with the layer removed and with it present. If the
        // pixels are identical, the layer is not rendering — which is the
        // real failure this section exists to catch, and the one that would
        // survive every ratio in the contrast gate.
        const withLayer = await groundVariance(page);
        await page.evaluate(() => {
          const w = document.querySelector(".chat > .world");
          if (w) w.style.display = "none";
        });
        await sleep(250);
        const without = await groundVariance(page);
        await page.evaluate(() => {
          const w = document.querySelector(".chat > .world");
          if (w) w.style.display = "";
        });
        const dMean = Math.abs(withLayer.mean - without.mean);
        const dSd = Math.abs(withLayer.sd - without.sd);
        ok(
          `thread ${sky}/${theme}/${width}: the wallpaper reaches the ground`,
          dMean > 0.5 || dSd > 0.3,
          `Δmean ${dMean.toFixed(2)} Δsd ${dSd.toFixed(2)} (sd ${without.sd.toFixed(2)} -> ${withLayer.sd.toFixed(2)})`,
        );
        // and the theme's identity survives its own sky: light stays light,
        // dark stays dark, whatever hour it is
        ok(
          `thread ${sky}/${theme}/${width}: the ${theme} identity holds`,
          theme === "light" ? withLayer.mean >= 200 : withLayer.mean <= 70,
          `mean ${withLayer.mean.toFixed(1)}/255`,
        );
        // the band, wired at last: the header must show the sky, so its own
        // ground must not be a flat slab either
        const band = await page.evaluate(() => {
          const b = document.querySelector('.chat-head .world[data-variant="band"]');
          return Boolean(b);
        });
        ok(`thread ${sky}/${theme}/${width}: the header band is mounted`, band);
        await ctx.close();
      }
    }
  }
}

// ── 5. THE COMPOSER WITH THE KEYBOARD UP ──────────────────────────────────
//
// The keyboard is simulated as the viewport the app actually sees when one is
// open — short, not resized-by-a-class — because the composer's own machinery
// reads `visualViewport` and the point is to shoot what it does.
{
  console.log("\n── 5. the composer, keyboard up ──");
  for (const theme of ["light", "dark"]) {
    const { page, ctx } = await open({
      sky: theme === "dark" ? "night" : "morning",
      theme,
      height: 420,
      state: { messages: SPARSE },
    });
    await page.click(".chat-input textarea");
    await page.fill(".chat-input textarea", "likh raha hoon");
    await sleep(400);
    await shot(page, `20-composer-keyboard-${theme}`);
    const m = await page.evaluate(() => {
      const row = document.querySelector(".chat-input-row");
      const pill = document.querySelector(".chat-input");
      const ta = document.querySelector(".chat-input textarea");
      return {
        rowBottom: row.getBoundingClientRect().bottom,
        vh: window.innerHeight,
        border: getComputedStyle(pill).borderTopWidth,
        font: parseFloat(getComputedStyle(ta).fontSize),
      };
    });
    ok(`composer/${theme}: stays on screen with a short viewport`, m.rowBottom <= m.vh + 1, `${m.rowBottom.toFixed(0)} vs ${m.vh}`);
    // iOS zooms the page on focus below 16px. The rule is old; the composer
    // is newly re-skinned, so it is re-checked rather than assumed.
    ok(`composer/${theme}: the field is at least 16px`, m.font >= 16, `${m.font}px`);
    await ctx.close();
  }
}

// ── 6. ONBOARDING, IN THE WORLD ───────────────────────────────────────────
//
// Every step, at NIGHT and at NOON. Noon is the one that matters: the glass
// has to follow the sky, and a light card on a light sky is the failure the
// contrast gate's own header records as having shipped once.
{
  console.log("\n── 6. onboarding on the live sky ──");
  for (const [label, sky] of [["night", "night"], ["noon", "morning"]]) {
    const { page, ctx } = await open({
      sky,
      onboarding: true,
      state: { onboarded: false, user: { name: "", vibe: [] } },
    });
    await page.waitForSelector(".onb", { timeout: 8000 });
    await sleep(600);
    await shot(page, `30-onboarding-${label}-1-meeting`);
    const meet = await page.evaluate(() => {
      const w = document.querySelector(".onb > .world");
      const img = document.querySelector(".onb-photo img");
      const honest = Array.from(document.querySelectorAll(".onb-honest")).map((e) => e.textContent.trim());
      return {
        world: Boolean(w),
        variant: w && w.getAttribute("data-variant"),
        photo: img ? { w: img.clientWidth, h: img.clientHeight, natural: img.naturalWidth } : null,
        honest: honest[0] || "",
        fans: document.querySelectorAll(".photo-fan, .fan").length,
      };
    });
    ok(`onboarding/${label}: runs on the world layer`, meet.world && meet.variant === "full", String(meet.variant));
    ok(`onboarding/${label}: the meeting photo is large and decoded`, meet.photo && meet.photo.w >= 180 && meet.photo.natural > 0, meet.photo ? `${meet.photo.w}x${meet.photo.h}` : "missing");
    // CHARTER COPY, verbatim. Not a paraphrase, not a shortened version.
    ok(
      `onboarding/${label}: the honest line is intact`,
      meet.honest.includes("is an AI companion, beautifully human in how she") &&
        meet.honest.includes("talks, always honest about what she is. For adults 18+ only."),
      meet.honest.slice(0, 60) + "…",
    );
    ok(`onboarding/${label}: the photo fan is gone (one photo treatment)`, meet.fans === 0, `${meet.fans} fan nodes`);

    await page.click('[data-tel="onboarding.start"]');
    await sleep(500);
    await shot(page, `31-onboarding-${label}-2-name`);
    const field = await page.evaluate(() => {
      const f = document.querySelector(".onb-field");
      return f ? { font: parseFloat(getComputedStyle(f).fontSize), count: document.querySelectorAll(".onb-field").length } : null;
    });
    ok(`onboarding/${label}: ONE glass field`, field && field.count === 1, field ? `${field.count}` : "none");
    ok(`onboarding/${label}: the field is at least 16px`, field && field.font >= 16, field ? `${field.font}px` : "");

    await page.fill(".onb-field", "Raghav");
    await page.click('[data-tel="onboarding.name_next"]');
    await sleep(500);
    await shot(page, `32-onboarding-${label}-3-topics`);
    // #65's chips, unchanged: the five topic chips must still be exactly these
    const chips = await page.evaluate(() =>
      Array.from(document.querySelectorAll(".onb-chip")).map((c) => c.textContent.trim()),
    );
    for (const t of ["cricket", "bollywood & movies", "food & chai", "travel", "diwali & festivals"]) {
      ok(`onboarding/${label}: topic chip "${t}" survives`, chips.includes(t));
    }
    await ctx.close();
  }
}

// ── 7. REDUCED MOTION ─────────────────────────────────────────────────────
//
// "A still sky, never a blank one" is the direction's phrasing and the failure
// people actually ship: `animation: none` on a keyframe that fades in from 0
// leaves an invisible element. So the assertion is not "nothing animates", it
// is "nothing animates AND everything is still visible".
{
  console.log("\n── 7. reduced motion ──");
  const { page, ctx } = await open({
    sky: "night",
    theme: "dark",
    reduced: true,
    onboarding: true,
    state: { onboarded: false, user: { name: "", vibe: [] } },
  });
  await page.waitForSelector(".onb", { timeout: 8000 });
  await sleep(700);
  await shot(page, "40-reduced-onboarding");
  const r = await page.evaluate(() => {
    const photo = document.querySelector(".onb-photo");
    const cs = getComputedStyle(photo);
    const running = document.getAnimations().filter((a) => a.playState === "running").length;
    return { opacity: +cs.opacity, transform: cs.transform, running, w: photo.clientWidth };
  });
  ok("reduced motion: the meeting photo is VISIBLE, not faded out", r.opacity >= 0.99 && r.w > 0, `opacity ${r.opacity}, ${r.w}px wide`);
  await ctx.close();

  // …and the thread's wallpaper is still a wallpaper under reduced motion
  const { page: p2, ctx: c2 } = await open({
    sky: "night", theme: "dark", reduced: true, state: { messages: SPARSE },
  });
  await shot(p2, "41-reduced-thread");
  const g = await groundVariance(p2);
  ok("reduced motion: the wallpaper is still there", g.sd >= 3.0, `sd ${g.sd.toFixed(2)}`);
  await c2.close();
}

// ── 8. THE SETTINGS SHEET ─────────────────────────────────────────────────
{
  console.log("\n── 8. the settings sheet ──");
  for (const theme of ["light", "dark"]) {
    const { page, ctx } = await open({
      sky: theme === "dark" ? "night" : "morning",
      theme,
      height: 900,
      state: { messages: SPARSE },
    });
    await page.click('[data-tel="chat.settings"]');
    await page.waitForSelector(".sheet", { timeout: 6000 });
    await sleep(600);
    await shot(page, `50-settings-${theme}`);
    const s = await page.evaluate(() => {
      const segs = Array.from(document.querySelectorAll(".seg-opt"));
      const foot = document.querySelector(".sheet-foot");
      const danger = document.querySelector(".sheet-rows.danger");
      const title = document.querySelector(".sheet h3");
      const label = document.querySelector(".sheet label");
      const row = document.querySelector(".srow .stitle");
      const px = (e) => (e ? parseFloat(getComputedStyle(e).fontSize) : 0);
      return {
        segCount: segs.length,
        segModes: segs.map((e) => e.dataset.mode),
        segChecked: segs.filter((e) => e.getAttribute("aria-checked") === "true").length,
        swatches: segs.filter((e) => {
          const sw = e.querySelector(".seg-swatch");
          const bg = sw && getComputedStyle(sw).backgroundImage;
          return bg && bg !== "none";
        }).length,
        footText: foot ? foot.textContent.trim() : "",
        dangerBg: danger ? getComputedStyle(danger).backgroundColor : "",
        titlePx: px(title),
        labelPx: px(label),
        rowPx: px(row),
      };
    });
    ok(`settings/${theme}: four theme segments, in order`, s.segCount === 4 && s.segModes.join(",") === "sky,system,light,dark", s.segModes.join(","));
    ok(`settings/${theme}: exactly one is selected`, s.segChecked === 1, String(s.segChecked));
    // "shows what each means visually rather than four outlined pills"
    ok(`settings/${theme}: every segment carries a visual swatch`, s.swatches === 4, `${s.swatches}/4`);
    // the danger pair is a ZONE, not a hairline
    // Chromium serialises a `color-mix()` result as `color(srgb r g b / a)`,
    // not as `rgba()`. The first version of this check tested for `rgba(` and
    // failed a zone that was rendering correctly — the assertion is that the
    // zone has a FILL, so parse an alpha out of either form and require it.
    const alphaOf = (v) => {
      const m = /\/\s*([\d.]+)\s*\)/.exec(v) || /,\s*([\d.]+)\s*\)$/.exec(v);
      return m ? Number(m[1]) : /^rgb\(/.test(v) ? 1 : 0;
    };
    ok(`settings/${theme}: the destructive pair sits in a tinted zone`, alphaOf(s.dangerBg) > 0.01, s.dangerBg);
    // three distinct type levels, strictly ordered
    ok(`settings/${theme}: type hierarchy is ordered`, s.titlePx > s.rowPx && s.rowPx > s.labelPx, `title ${s.titlePx} > row ${s.rowPx} > label ${s.labelPx}`);
    // FOOTER HONESTY LINE, VERBATIM
    ok(`settings/${theme}: the honesty line is verbatim`, s.footText.includes("is an AI. She'll tell you so if you ask."), s.footText.slice(0, 50));
    await ctx.close();
  }
}

await browser.close();
console.log(fails ? `\n${fails} FAILED` : "\nall phase-3 browser checks passed");
process.exit(fails ? 1 : 0);
