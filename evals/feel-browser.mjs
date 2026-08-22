// WS-FEEL — the thread's micro-interactions, measured in a real browser.
//
//   npx vite build
//   npx vite preview --port 4288 --strictPort &
//   node evals/feel-browser.mjs            # assert (exit 1 on failure)
//   node evals/feel-browser.mjs --observe  # print the tables, never fail
//
// ── why a browser, and why per-frame ──────────────────────────────────────
//
// Everything this suite covers is a PROPERTY OF FRAMES: whether his bubble
// leaves the composer or teleports into place, whether hers lands with weight
// or blinks on, whether a reaction arrives or pops. None of it is reachable
// from a unit test, and none of it is reachable from a screenshot either — a
// still frame cannot tell a 220ms flight from a 0ms cut. So the measurement is
// a rAF sampler INSIDE the page reading `getComputedStyle(el).transform` every
// frame and handing back the series. That is the only artefact that can be
// compared against a future one, which is the only thing numbers are for.
//
// The second half is structural rather than perceptual: `document
// .getAnimations()` is walked and every property each animation actually
// touches is read out of `effect.getKeyframes()` / `transitionProperty`. An
// animation of `width` or `box-shadow` in the thread fails the suite outright.
// This is the half check-motion.mjs cannot do — the lint reads CSS text, so a
// WAAPI animation built in JS is invisible to it, and the send flight IS one.
//
// NOT wired into evals/run.mjs, deliberately, and for the same by-construction
// reason evals/burst-browser.mjs states: it needs a built app and a server on a
// port. It is in version control because `dead-writers` does not stop being
// true for evals — a suite living in a session scratchpad protects nothing.
//
// The model is stubbed at /api/chat, so it is deterministic and costs $0.
// Runtime ~50s.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const B = process.env.MEERA_PREVIEW || "http://localhost:4288";
const OBSERVE = process.argv.includes("--observe");
const SHOTS = process.env.FEEL_SHOTS || join(process.cwd(), "feel-shots");
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
  deviceId: "00000000-0000-4000-8000-0000000000f1",
  user: { name: "R", vibe: [] },
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
 * A fresh page with the model stubbed and every other network call silenced.
 * `reduced` flips the OS-level preference, which is the only way to test the
 * reduced-motion contract honestly: a class the app sets itself would be
 * testing the app's opinion of the setting rather than the setting.
 */
async function open({ script = ["hi"], delayMs = 120, state = {}, reduced = false, video = false } = {}) {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    reducedMotion: reduced ? "reduce" : "no-preference",
    ...(video ? { recordVideo: { dir: SHOTS, size: { width: 390, height: 844 } } } : {}),
  });
  const page = await ctx.newPage();
  let i = 0;
  await page.route("**/api/chat", async (route) => {
    const n = i++;
    const text = typeof script === "function" ? script(n) : script[Math.min(n, script.length - 1)];
    // The FIRST call is her opener, fired on mount before anything under test
    // happens. Slowing that one down only slows the suite (and holds `busy`,
    // which suppresses the reply the test is actually waiting for), so a
    // per-call delay is the honest shape here.
    await sleep(typeof delayMs === "function" ? delayMs(n) : delayMs);
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ text }) });
  });
  for (const p of [
    "**/api/memory", "**/api/telemetry", "**/api/consolidate", "**/api/account",
    "**/api/clock", "**/api/life", "**/api/search", "**/api/trace", "**/api/route",
    "**/api/gif", "**/api/speech",
  ]) {
    await page.route(p, (r) => r.fulfill({ status: 200, contentType: "application/json", body: "{}" }));
  }
  await page.goto(`${B}/chat`, { waitUntil: "domcontentloaded" });
  await page.evaluate((s) => localStorage.setItem("meera.state.v1", JSON.stringify(s)), {
    ...BASE_STATE,
    ...state,
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await sleep(900);
  // The app opens on HOME now (the world layer), with the thread behind it and
  // `inert` — so every gesture below would land on nothing. Enter the chat the
  // way a person does, and wait for the shell to actually hand it over.
  await page.click('[data-tel="home.open_chat"]');
  await page.waitForFunction(
    () => document.querySelector(".chat-wrap")?.getAttribute("data-surface") === "chat",
    null,
    { timeout: 8000 },
  );
  await sleep(500);
  return { page, ctx };
}

// ── the sampler ───────────────────────────────────────────────────────────
//
// Installed once per page. `track(sel, ms)` starts a rAF loop that records
// (t, matrix, opacity) for the element matching `sel` — resolved EVERY frame,
// because the element under test may not exist yet when tracking starts (his
// bubble is created by the click that also starts the flight).
const SAMPLER = `
window.__feel = {
  track(sel, ms) {
    const out = [];
    const t0 = performance.now();
    return new Promise((res) => {
      const step = () => {
        // the LAST match, always: the element under test is the newest bubble,
        // and a :last-of-type selector counts div siblings, not matches
        const list = document.querySelectorAll(sel);
        const el = list[list.length - 1];
        const t = performance.now() - t0;
        if (el) {
          const cs = getComputedStyle(el);
          const m = new DOMMatrixReadOnly(cs.transform === "none" ? "" : cs.transform);
          out.push({ t: +t.toFixed(1), x: +m.m41.toFixed(3), y: +m.m42.toFixed(3),
                     sx: +m.a.toFixed(4), sy: +m.d.toFixed(4), o: +cs.opacity });
        }
        if (t < ms) requestAnimationFrame(step); else res(out);
      };
      requestAnimationFrame(step);
    });
  },
  // every animation currently running on or inside a subtree, with the exact
  // set of properties it touches — the structural half of the proof
  anims(rootSel) {
    const root = document.querySelector(rootSel);
    if (!root) return [];
    return document.getAnimations().map((a) => {
      const el = a.effect && a.effect.target;
      if (!el || !(root === el || root.contains(el))) return null;
      let props = [];
      if (a.transitionProperty) props = [a.transitionProperty];
      else {
        const seen = new Set();
        for (const k of a.effect.getKeyframes()) {
          for (const key of Object.keys(k)) {
            if (key === "offset" || key === "computedOffset" || key === "easing" || key === "composite") continue;
            seen.add(key.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase()));
          }
        }
        props = [...seen];
      }
      const timing = a.effect.getTiming();
      return {
        name: a.animationName || a.transitionProperty || "(waapi)",
        cls: (el.getAttribute("class") || "").slice(0, 48),
        props,
        dur: Math.round(a.effect.getComputedTiming().duration || 0),
        easing: timing.easing,
      };
    }).filter(Boolean);
  },
};
`;

/** Properties that cost layout or paint on every frame. The whole point. */
const CHEAP = new Set(["transform", "opacity"]);

/**
 * Colour is not in the cheap set and is not a failure either. DESIGN-STANDARDS
 * prescribes it outright ("hover and colour `ease`"), and a colour change costs
 * one paint of one element rather than a layout of the page. Blocking it would
 * be this suite disagreeing with the standard it exists to enforce. What stays
 * blocked is everything that costs LAYOUT (width/height/top/margin/…) and the
 * expensive paints that read as smooth and are not (box-shadow, filter,
 * backdrop-filter, clip-path).
 */
const COLOUR = new Set(["color", "background-color", "background", "border-color", "fill", "stroke"]);

/**
 * Two animations in the thread predate this suite, are deliberate, and are
 * documented next to their own code: the delivery tick DRAWS itself
 * (stroke-dashoffset on an SVG path, which is not layout and has no transform
 * equivalent), and the gif skeleton shimmers on background-position behind a
 * `view()` timeline that pauses it off screen. Whitelisted by NAME rather than
 * by property, so a new animation cannot inherit the exemption by accident.
 */
const GRANDFATHERED = new Set(["tick-draw", "gif-shimmer"]);

/** Everything WS-FEEL added. These are held to transform/opacity, no colour. */
const MINE = new Set([
  "her-land", "enter-fade", "react-land", "react-burst", "composer-recoil",
  "thread-settle", "pill-pulse", "typing-second",
]);

/** peak absolute travel, and whether the series ever crosses PAST its end. */
function shape(series) {
  if (!series.length) return { frames: 0 };
  const end = series[series.length - 1];
  const moved = series.filter((s) => Math.abs(s.x) > 0.01 || Math.abs(s.y) > 0.01 || Math.abs(s.sx - 1) > 0.0015);
  const peakY = series.reduce((m, s) => (Math.abs(s.y) > Math.abs(m) ? s.y : m), 0);
  const peakX = series.reduce((m, s) => (Math.abs(s.x) > Math.abs(m) ? s.x : m), 0);
  const peakS = series.reduce((m, s) => (Math.abs(s.sx - 1) > Math.abs(m - 1) ? s.sx : m), 1);
  // overshoot: the transform passes the resting value and comes back
  const over = series.some((s) => s.y * peakY < -1e-4) || series.some((s) => s.sx > 1.0008);
  const first = moved[0];
  const last = moved[moved.length - 1];
  return {
    frames: moved.length,
    ms: first && last ? Math.round(last.t - first.t) : 0,
    peakX: +peakX.toFixed(2),
    peakY: +peakY.toFixed(2),
    peakScale: +peakS.toFixed(4),
    overshoot: over,
    endX: end.x, endY: end.y, endScale: end.sx, endOpacity: end.o,
  };
}

const table = (label, s) =>
  console.log(
    `      ${label.padEnd(22)} frames=${String(s.frames).padStart(3)}  ${String(s.ms).padStart(4)}ms  ` +
      `peak dx=${String(s.peakX).padStart(7)} dy=${String(s.peakY).padStart(6)} scale=${s.peakScale}  ` +
      `overshoot=${s.overshoot ? "yes" : "no "}  end=(${s.endX},${s.endY},${s.endScale},op ${s.endOpacity})`,
  );

function auditAnims(label, list) {
  const bad = list.filter(
    (a) =>
      !GRANDFATHERED.has(a.name) &&
      a.props.some((p) => !CHEAP.has(p) && !(COLOUR.has(p) && !MINE.has(a.name))),
  );
  for (const a of list) console.log(`      ${label} · ${a.name.padEnd(18)} [${a.props.join(",")}] ${a.dur}ms  .${a.cls}`);
  return bad;
}

// ══ 1. SEND PHYSICS ═══════════════════════════════════════════════════════
{
  console.log("\n── 1. send physics: his bubble leaves the composer ──");
  const { page, ctx } = await open({ script: ["arre hi"], video: true });
  await page.addInitScript(SAMPLER);
  await page.evaluate(SAMPLER);

  await page.fill("textarea", "hello you");
  // start sampling the row that does not exist yet, then click
  const run = page.evaluate(() => window.__feel.track(".msg.me", 700));
  await page.click('[data-tel="chat.send"]');
  const series = await run;
  const s = shape(series);
  table("me bubble", s);

  ok("his bubble travels (not a cut)", s.frames >= 6, `${s.frames} moving frames`);
  ok("flight is 150-320ms", s.ms >= 150 && s.ms <= 320, `${s.ms}ms`);
  ok("comes from below the slot", s.peakY > 4, `peak dy ${s.peakY}px`);
  ok("comes from the composer's side", Math.abs(s.peakX) > 2, `peak dx ${s.peakX}px`);
  ok("rests at identity", Math.abs(s.endX) < 0.01 && Math.abs(s.endY) < 0.01 && Math.abs(s.endScale - 1) < 0.001);

  const anims = await page.evaluate(() => window.__feel.anims(".chat-input-row"));
  const bad = auditAnims("composer", anims);
  ok("composer settle is transform/opacity only", bad.length === 0, bad.map((b) => b.props).join());

  await page.screenshot({ path: join(SHOTS, "01-after-send.png") });
  await ctx.close();
}

// ══ 2. HER ARRIVAL ════════════════════════════════════════════════════════
{
  console.log("\n── 2. her arrival: weight, and a three-bubble reply that reads as speech ──");
  const { page, ctx } = await open({ script: ["haan bolo\nkaisa tha din\nbata na"] });
  await page.addInitScript(SAMPLER);
  await page.evaluate(SAMPLER);

  await page.fill("textarea", "hey");
  await page.click('[data-tel="chat.send"]');

  // her first bubble: sample from the moment the typing indicator leaves
  await page.waitForSelector(".typing-bubble", { timeout: 8000 });
  const run = page.evaluate(() => window.__feel.track(".msg.her", 2600));
  const series = await run;
  const s = shape(series);
  table("her bubble", s);
  ok("her bubble rises (not a cut)", s.frames >= 5, `${s.frames} moving frames`);
  ok("rise is 2-6px", Math.abs(s.peakY) >= 1.6 && Math.abs(s.peakY) <= 6.5, `peak dy ${s.peakY}px`);
  ok("lands with a slight overshoot", s.overshoot, `peak scale ${s.peakScale}`);
  ok("rests at identity", Math.abs(s.endY) < 0.01 && Math.abs(s.endScale - 1) < 0.001);

  // the three bubbles must arrive as three separate events, not one paint
  const gaps = await page.evaluate(async () => {
    // only bubbles that arrive from HERE — the thread already holds her opener,
    // and counting rows that were on screen before the clock started reports
    // a zero gap for messages that never arrived together at all
    const seen = new Map();
    for (const el of document.querySelectorAll(".msg.her")) seen.set(el.getAttribute("data-row"), -1);
    const before = seen.size;
    const t0 = performance.now();
    return await new Promise((res) => {
      const io = setInterval(() => {
        for (const el of document.querySelectorAll(".msg.her")) {
          const id = el.getAttribute("data-row");
          if (id && !seen.has(id)) seen.set(id, Math.round(performance.now() - t0));
        }
        if (seen.size - before >= 3 || performance.now() - t0 > 25000) {
          clearInterval(io);
          res([...seen.values()].filter((v) => v >= 0));
        }
      }, 16);
    });
  });
  const deltas = gaps.slice(1).map((t, i) => t - gaps[i]);
  console.log(`      arrival gaps (ms): ${deltas.join(", ")}`);
  ok("consecutive bubbles are separate events", deltas.every((d) => d >= 80), deltas.join(","));

  const anims = await page.evaluate(() => window.__feel.anims(".chat-scroll"));
  const bad = auditAnims("thread", anims.filter((a) => !a.cls.includes("gif-loading")));
  ok("thread animations are transform/opacity only", bad.length === 0, bad.map((b) => `${b.name}:${b.props}`).join());

  await page.screenshot({ path: join(SHOTS, "02-three-bubbles.png") });
  await ctx.close();
}

// ══ 3. TYPING INDICATOR ═══════════════════════════════════════════════════
{
  console.log("\n── 3. typing indicator: her rhythm, and the 4s second beat ──");
  // a long delay on the stub keeps her "thinking" past the 4s threshold
  const { page, ctx } = await open({ script: ["ek min"], delayMs: (n) => (n === 0 ? 120 : 9000) });
  await page.addInitScript(SAMPLER);
  await page.evaluate(SAMPLER);
  await page.fill("textarea", "you there");
  await page.click('[data-tel="chat.send"]');
  await page.waitForSelector(".typing-bubble", { timeout: 8000 });

  const early = await page.evaluate(() => window.__feel.anims(".typing-bubble"));
  const earlyLong = await page.evaluate(() => document.querySelector(".typing-bubble")?.hasAttribute("data-long"));
  ok("no second beat before 4s", earlyLong === false, `data-long=${earlyLong}`);
  console.log(`      running before 4s: ${early.map((a) => a.name).join(", ")}`);
  await page.screenshot({ path: join(SHOTS, "03a-typing-early.png") });

  await sleep(4600);
  const lateLong = await page.evaluate(() => document.querySelector(".typing-bubble")?.hasAttribute("data-long"));
  const late = await page.evaluate(() => window.__feel.anims(".typing-bubble"));
  ok("second beat after 4s", lateLong === true, `data-long=${lateLong}`);
  console.log(`      running after 4s:  ${late.map((a) => a.name).join(", ")}`);
  // by NAME, not by count: the indicator's own entrance transition is still
  // winding down at the "early" read on a slow machine, so a count comparison
  // reports 6 → 6 and fails for a reason that has nothing to do with the beat
  ok(
    "the second beat is a NEW animation",
    !early.some((a) => a.name === "typing-second") && late.some((a) => a.name === "typing-second"),
    `${early.map((a) => a.name).join("/")} → ${late.map((a) => a.name).join("/")}`,
  );
  const bad = auditAnims("typing", late);
  ok("typing animations are transform/opacity only", bad.length === 0, bad.map((b) => `${b.name}:${b.props}`).join());
  // A still of a loop lands wherever the shutter happens to fall, which is a
  // useless artefact: the same effect looks absent or overbearing depending on
  // luck. Park the second beat at its own peak and shoot THAT, so the picture
  // is of the strongest frame the effect ever shows and can be judged.
  await page.evaluate(() => {
    for (const a of document.querySelector(".typing-bubble").getAnimations()) {
      if (a.animationName === "typing-second") { a.pause(); a.currentTime = 1300; }
    }
  });
  await page.screenshot({ path: join(SHOTS, "03b-typing-long.png") });
  await ctx.close();
}

// ══ 4. REACTION ═══════════════════════════════════════════════════════════
{
  console.log("\n── 4. reaction: fly-in and burst ──");
  const { page, ctx } = await open({ script: ["hmm"] });
  await page.addInitScript(SAMPLER);
  await page.evaluate(SAMPLER);
  await page.fill("textarea", "look at this");
  await page.click('[data-tel="chat.send"]');
  await sleep(400);
  await page.click(".msg.me");
  await page.waitForSelector(".react-bar", { timeout: 4000 });
  await page.screenshot({ path: join(SHOTS, "04a-react-bar.png") });

  const run = page.evaluate(() => window.__feel.track(".react-pill", 700));
  await page.click(".react-pick"); // ❤️, the first
  const series = await run;
  const s = shape(series);
  table("react pill", s);
  ok("the pill flies in", s.frames >= 5, `${s.frames} moving frames`);
  ok("it does not grow from nothing", series.every((p) => p.sx > 0.55), `min scale ${Math.min(...series.map((p) => p.sx)).toFixed(3)}`);
  ok("it overshoots on arrival (earned momentum)", s.overshoot, `peak scale ${s.peakScale}`);
  ok("it rests at identity", Math.abs(s.endScale - 1) < 0.002 && Math.abs(s.endY) < 0.02);

  const anims = await page.evaluate(() => window.__feel.anims(".msg.me"));
  const bad = auditAnims("reaction", anims);
  ok("reaction animations are transform/opacity only", bad.length === 0, bad.map((b) => `${b.name}:${b.props}`).join());
  await page.screenshot({ path: join(SHOTS, "04c-react-pill-rested.png") });
  // and the burst caught mid-flight, for the same reason as the typing shot:
  // a 240ms ring is over before any screenshot could find it by accident
  await page.click(".msg.me");
  await page.click(".react-pick:nth-child(2)");
  await page.evaluate(() => {
    const pill = document.querySelector(".react-pill");
    for (const a of pill.getAnimations()) { a.pause(); a.currentTime = 60; }
  });
  await page.screenshot({ path: join(SHOTS, "04b-react-burst.png") });
  await ctx.close();
}

// ══ 5. COMPOSER MORPH ═════════════════════════════════════════════════════
{
  console.log("\n── 5. composer: the mic ↔ send morph ──");
  const { page, ctx } = await open({ script: ["ok"] });
  await page.addInitScript(SAMPLER);
  await page.evaluate(SAMPLER);
  const before = await page.evaluate(() => {
    const b = document.querySelector(".send-btn");
    return { mode: b?.getAttribute("data-mode"), tel: b?.getAttribute("data-tel"), icons: b?.querySelectorAll(".sb-ic").length ?? 0 };
  });
  console.log(`      idle: mode=${before.mode} tel=${before.tel} icons=${before.icons}`);
  ok("one button holds both icons", before.icons === 2, `${before.icons} icon layers`);

  // SAMPLED, not spot-checked. The first version read the opacity once, 30ms
  // after the keystroke, and flaked: on a slow frame React has not committed
  // the mode yet and the reading is 0.00 — which is what a remount would also
  // look like, so the check could not tell its own race from the bug it is
  // for. A crossfade is a claim about a SERIES: some frame between the two
  // ends must be neither end.
  const track = page.evaluate(() => window.__feel.track(".sb-send", 400));
  await page.fill("textarea", "a");
  const series = await track;
  const mid = await page.evaluate(() => ({
    mode: document.querySelector(".send-btn").getAttribute("data-mode"),
    anims: window.__feel.anims(".send-btn"),
  }));
  const between = series.filter((p) => p.o > 0.02 && p.o < 0.98);
  console.log(`      typing: mode=${mid.mode}  send-icon opacity ${series[0]?.o} → ${series.at(-1)?.o}, ${between.length} frames in between`);
  ok("the swap is a crossfade, not a remount", between.length >= 3, `${between.length} intermediate frames`);
  const bad = auditAnims("morph", mid.anims);
  ok("morph is transform/opacity only", bad.length === 0, bad.map((b) => `${b.name}:${b.props}`).join());

  await sleep(300);
  const after = await page.evaluate(() => {
    const b = document.querySelector(".send-btn");
    return { mode: b.getAttribute("data-mode"), tel: b.getAttribute("data-tel"), label: b.getAttribute("aria-label") };
  });
  ok("telemetry + a11y follow the mode", after.mode === "send" && after.tel === "chat.send" && /send/i.test(after.label), JSON.stringify(after));
  await page.screenshot({ path: join(SHOTS, "05-composer-send.png") });
  await ctx.close();
}

// ══ 6. SCROLL FEEL, AND THE ONE COMMIT THAT CARRIES SEVERAL MESSAGES ═══════
//
// Both halves are driven through the cross-tab merge, which is the app's real
// path for "several messages appear at once" and for "a message arrives while
// he is reading forty messages up". A synthetic `storage` event is exactly
// what a second tab emits, so this is the production code path and not a
// simulation of it.
{
  console.log("\n── 6. scroll: the stagger, and the pill that never yanks ──");
  // A THREAD LONG ENOUGH TO SCROLL. With six bubbles the scroller is shorter
  // than its viewport, so "scrolled up" is not a state the app can be in and
  // the pill under test can never appear — the first version of this check
  // failed for that reason and not for the reason it was asserting.
  const history = Array.from({ length: 40 }, (_, k) => ({
    id: `seed-${k}`,
    from: k % 2 ? "her" : "me",
    kind: "text",
    text: `line number ${k} of the conversation so far`,
    at: Date.now() - (40 - k) * 60_000,
    ...(k % 2 ? {} : { status: "read" }),
  }));
  const { page, ctx } = await open({ script: ["ok"], state: { messages: history } });
  await page.addInitScript(SAMPLER);
  await page.evaluate(SAMPLER);
  await page.fill("textarea", "seed");
  await page.click('[data-tel="chat.send"]');
  await page.waitForSelector(".msg.her", { timeout: 12000 });
  await sleep(1500);

  // --- 6a. two messages in ONE commit stagger ---
  const stagger = await page.evaluate(async () => {
    const KEY = "meera.state.v1";
    const s = JSON.parse(localStorage.getItem(KEY));
    const at = Date.now();
    s.messages = [
      ...s.messages,
      { id: "merge-a", from: "her", kind: "text", text: "arre", at },
      { id: "merge-b", from: "her", kind: "text", text: "suno na", at: at + 1 },
    ];
    const blob = JSON.stringify(s);
    localStorage.setItem(KEY, blob);
    window.dispatchEvent(new StorageEvent("storage", { key: KEY, newValue: blob }));
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const read = (id) => {
      const el = document.querySelector(`[data-row="${id}"]`);
      if (!el) return null;
      const a = el.getAnimations().find((x) => x.animationName === "her-land");
      return {
        enter: el.getAttribute("data-enter"),
        i: el.style.getPropertyValue("--enter-i"),
        delay: a ? Math.round(a.effect.getComputedTiming().delay) : null,
      };
    };
    return { a: read("merge-a"), b: read("merge-b") };
  });
  console.log(`      first  ${JSON.stringify(stagger.a)}`);
  console.log(`      second ${JSON.stringify(stagger.b)}`);
  ok("both merged messages get an entrance", stagger.a?.enter === "" && stagger.b?.enter === "");
  ok("the second is held back ~80ms", stagger.b?.delay === 80, `delay ${stagger.b?.delay}ms vs ${stagger.a?.delay}ms`);

  // --- 6b. a message arriving while he reads scrollback ---
  await sleep(600);
  await page.evaluate(() => {
    const el = document.querySelector(".chat-scroll");
    el.scrollTop = 0;
    el.dispatchEvent(new Event("scroll"));
  });
  await sleep(400);
  const yank = await page.evaluate(async () => {
    const sc = document.querySelector(".chat-scroll");
    const before = sc.scrollTop;
    const KEY = "meera.state.v1";
    const s = JSON.parse(localStorage.getItem(KEY));
    s.messages = [...s.messages, { id: "merge-c", from: "her", kind: "text", text: "oyy", at: Date.now() }];
    const blob = JSON.stringify(s);
    localStorage.setItem(KEY, blob);
    window.dispatchEvent(new StorageEvent("storage", { key: KEY, newValue: blob }));
    await new Promise((r) => setTimeout(r, 260));
    const pill = document.querySelector(".jump-latest");
    return {
      before,
      after: sc.scrollTop,
      pulsed: pill ? pill.hasAttribute("data-pulse") : null,
      anim: pill ? pill.getAnimations().map((a) => a.animationName || a.transitionProperty) : [],
      label: pill ? pill.textContent : null,
    };
  });
  console.log(`      scrollTop ${yank.before} → ${yank.after}   pill "${yank.label}"  [${yank.anim.join(", ")}]`);
  ok("the thread is not yanked", Math.abs(yank.after - yank.before) < 2, `moved ${yank.after - yank.before}px`);
  ok("the pill pulses instead", yank.pulsed === true && yank.anim.includes("pill-pulse"), yank.anim.join());
  await page.screenshot({ path: join(SHOTS, "06-jump-pill.png") });
  await ctx.close();
}

// ══ 7. THE SEAM COMING BACK TO THE THREAD ══════════════════════════════════
{
  console.log("\n── 7. returning to the thread is a settle, not a cut ──");
  const { page, ctx } = await open({ script: ["hm"] });
  await page.addInitScript(SAMPLER);
  await page.evaluate(SAMPLER);
  await page.click('[data-tel="chat.settings"]');
  await page.waitForSelector(".sheet", { timeout: 4000 });
  await sleep(500);
  const settle = await page.evaluate(async () => {
    // close the sheet the way the sheet closes itself
    document.querySelector(".sheet-veil, .sheet-x")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const sc = document.querySelector(".chat-scroll");
    const a = sc.getAnimations().map((x) => ({ n: x.animationName, d: Math.round(x.effect.getComputedTiming().duration) }));
    return { attr: sc.hasAttribute("data-settle"), anims: a };
  });
  console.log(`      data-settle=${settle.attr}  ${settle.anims.map((a) => `${a.n} ${a.d}ms`).join(", ")}`);
  ok("the thread settles on return", settle.attr === true);
  ok("the settle is 150-200ms", settle.anims.some((a) => a.n === "thread-settle" && a.d >= 150 && a.d <= 200), JSON.stringify(settle.anims));
  await ctx.close();
}

// ══ 8. THE WINDOW'S OTHER EDGE ═════════════════════════════════════════════
{
  console.log("\n── 8. load-earlier speaks the same vocabulary as the jump pill ──");
  // >80 messages, so the tail window actually has an edge to show
  const long = Array.from({ length: 130 }, (_, k) => ({
    id: `deep-${k}`,
    from: k % 2 ? "her" : "me",
    kind: "text",
    text: `message ${k}`,
    at: Date.now() - (130 - k) * 60_000,
    ...(k % 2 ? {} : { status: "read" }),
  }));
  const { page, ctx } = await open({ script: ["ok"], state: { messages: long } });
  await page.addInitScript(SAMPLER);
  await page.evaluate(SAMPLER);
  await page.waitForSelector(".load-earlier", { timeout: 6000 });
  const style = await page.evaluate(() => {
    const el = document.querySelector(".load-earlier");
    const cs = getComputedStyle(el);
    return { transition: cs.transitionProperty, dur: cs.transitionDuration, label: el.textContent };
  });
  console.log(`      "${style.label}"  transition: ${style.transition} / ${style.dur}`);
  ok("it presses like the rest of the thread", /transform/.test(style.transition), style.transition);

  // and the thread does not move when it opens — the window's whole contract
  const held = await page.evaluate(async () => {
    const sc = document.querySelector(".chat-scroll");
    const bottomBefore = sc.scrollHeight - sc.scrollTop;
    document.querySelector(".load-earlier").click();
    await new Promise((r) => setTimeout(r, 300));
    return { bottomBefore, bottomAfter: sc.scrollHeight - sc.scrollTop };
  });
  ok("loading earlier does not move the thread", Math.abs(held.bottomAfter - held.bottomBefore) < 2,
     `${held.bottomBefore} → ${held.bottomAfter}`);

  // a LONG message still leaves the composer, and still leaves it briskly:
  // the flight is clamped, so a six-line bubble does not swoop across the app
  await page.fill("textarea", "this one is a much longer message\nwith several lines in it\nso the bubble is tall\nand the geometry is different");
  const run = page.evaluate(() => window.__feel.track(".msg.me", 700));
  await page.click('[data-tel="chat.send"]');
  const s2 = shape(await run);
  table("tall me bubble", s2);
  ok("a tall bubble flies too", s2.frames >= 6, `${s2.frames} frames`);
  ok("and its travel is still clamped", Math.abs(s2.peakY) <= 64 && Math.abs(s2.peakX) <= 56, `dx ${s2.peakX} dy ${s2.peakY}`);
  await page.screenshot({ path: join(SHOTS, "08-load-earlier.png") });
  await ctx.close();
}

// ══ 9. REDUCED MOTION ═════════════════════════════════════════════════════
{
  console.log("\n── 9. reduced motion: every end state renders ──");
  const { page, ctx } = await open({ script: ["theek hai\nmilte hain"], reduced: true });
  await page.addInitScript(SAMPLER);
  await page.evaluate(SAMPLER);
  await page.fill("textarea", "quiet please");
  await page.click('[data-tel="chat.send"]');
  await page.waitForSelector(".msg.her", { timeout: 12000 });
  await sleep(1200);
  await page.click(".msg.me");
  await page.waitForSelector(".react-bar", { timeout: 4000 });
  await page.click(".react-pick");
  await sleep(500);

  const end = await page.evaluate(() => {
    const read = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const cs = getComputedStyle(el);
      const m = new DOMMatrixReadOnly(cs.transform === "none" ? "" : cs.transform);
      return { o: +cs.opacity, x: +m.m41.toFixed(2), y: +m.m42.toFixed(2), s: +m.a.toFixed(3), vis: cs.visibility };
    };
    return {
      me: read(".msg.me"),
      her: read(".msg.her"),
      pill: read(".react-pill"),
      typingDots: read(".typing-bubble i"),
      composer: read(".chat-input"),
    };
  });
  for (const [k, v] of Object.entries(end)) console.log(`      ${k.padEnd(12)} ${v ? JSON.stringify(v) : "(absent)"}`);
  const settled = (v) => v && v.o === 1 && Math.abs(v.x) < 0.5 && Math.abs(v.y) < 0.5 && Math.abs(v.s - 1) < 0.01 && v.vis === "visible";
  ok("his bubble renders at its end state", settled(end.me));
  ok("her bubble renders at its end state", settled(end.her));
  ok("the reaction renders at its end state", settled(end.pill));
  ok("the composer renders at its end state", settled(end.composer));

  // The contract is DESIGN-STANDARDS' own: reduced motion is gentler and
  // fewer, never absent. The press squash is explicitly kept ("a tap that does
  // not answer feels broken"), so a transform transition sitting on a press
  // target is CORRECT here and asserting its absence would be asserting the
  // wrong thing. What must not happen is an ARRIVAL that travels.
  const still = await page.evaluate(() => window.__feel.anims(".chat-scroll"));
  console.log(`      running under reduce: ${still.map((a) => `${a.name}[${a.props}]`).join(", ") || "(nothing)"}`);
  const travelling = still.filter((a) => a.props.includes("transform") && a.name !== "transform");
  ok("no arrival travels under reduce", travelling.length === 0, travelling.map((a) => a.name).join());
  ok("the fade still carries the arrival", still.some((a) => a.name === "enter-fade" || a.name === "opacity"));
  await page.screenshot({ path: join(SHOTS, "06-reduced-motion.png") });
  await ctx.close();
}

await browser.close();
console.log(`\n${fails ? `${fails} failing` : "feel battery: all checks passed"}`);
console.log(`frames + screenshots: ${SHOTS}`);
process.exit(fails ? 1 : 0);
