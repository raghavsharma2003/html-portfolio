// WS-SOUND — the sound layer, in a real browser, with a real audio graph.
//
//   npx vite build
//   npx vite preview --port 4291 --strictPort &
//   node evals/sound-browser.mjs             # assert (exit 1 on failure)
//   node evals/sound-browser.mjs --observe   # print the tables, never fail
//
// ── WHY THIS EXISTS ON TOP OF evals/sound.mjs ─────────────────────────────
//
// The offline gate drives the module directly against a fake AudioContext. It
// can prove the gates, the mix and the vocabulary, and it proves them cheaply
// enough to run on every build. What it CANNOT prove is the part that is a
// property of the browser rather than of the code:
//
//   - that no AudioContext exists before the user's first gesture. That is the
//     one claim in this layer that is browser LAW, and the whole reason the
//     app uses Web Audio rather than an <audio> element. It is unfalsifiable
//     against a fake context, because a fake context has no autoplay policy.
//   - that a real `send` click actually reaches the graph through React's own
//     handler ordering, rather than through a unit call.
//   - that a three-bubble reply produces ONE arrival, which is a property of
//     the delivery loop in Chat.tsx and not of src/sound/ at all.
//   - that the toggle in Settings, tapped as a person taps it, silences it.
//
// `the-slide-that-never-ran` is the entry that makes this a suite instead of a
// note: a documented behaviour can be true of the CODE and false of the
// BROWSER for months. An audio claim is only real once an audio node has been
// observed starting.
//
// NOT wired into evals/run.mjs, deliberately, and for the same by-construction
// reason evals/feel-browser.mjs states: it needs a built app and a server on a
// port. It is in version control because `dead-writers` does not stop being
// true for evals.
//
// The model is stubbed at /api/chat, so it is deterministic and costs $0.
// Runtime ~45s.
import { chromium } from "playwright";

const B = process.env.MEERA_PREVIEW || "http://localhost:4291";
const OBSERVE = process.argv.includes("--observe");

let fails = 0;
const ok = (n, c, e = "") => {
  console.log(`${c ? "ok  " : "FAIL"} ${n}${e ? " — " + e : ""}`);
  if (!c && !OBSERVE) fails++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * The probe. Installed before ANY app script runs, which is the only ordering
 * that can answer "was a context built before the gesture" — a probe installed
 * after page load can only report the answer it was too late to observe.
 *
 * It records every AudioContext constructed and every source node started, and
 * tags each by which context it came from. The sound layer's context is the one
 * built with `latencyHint: "interactive"`; src/voice/speech.ts and
 * src/voice/liveCall.ts build theirs bare. That is not test scaffolding bolted
 * on for this file — it is the correct hint for cues that answer a finger, and
 * it is what makes the two audio subsystems in this app distinguishable from
 * outside without either of them knowing a test exists.
 */
const PROBE = `
(() => {
  const S = { ctxs: [], starts: [] };
  window.__snd = S;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  const Patched = function (opts) {
    const c = new AC(opts);
    const id = S.ctxs.length;
    S.ctxs.push({ id, hint: (opts && opts.latencyHint) || "", at: performance.now() });
    for (const m of ["createOscillator", "createBufferSource"]) {
      const orig = c[m].bind(c);
      c[m] = function () {
        const n = orig();
        const start = n.start.bind(n);
        n.start = function (...a) {
          S.starts.push({ ctx: id, kind: m, at: performance.now() });
          return start(...a);
        };
        return n;
      };
    }
    return c;
  };
  Patched.prototype = AC.prototype;
  window.AudioContext = Patched;
  window.webkitAudioContext = Patched;
  // Cue counting. Every cue schedules its voices inside one synchronous block,
  // so starts cluster far tighter than any two cues can (the module's own
  // throttle floor is 70ms). Grouping by a 25ms gap turns "how many nodes" —
  // which is an implementation detail nobody should assert on — into "how many
  // SOUNDS", which is the thing the product cares about.
  S.cues = (sinceAt) => {
    const hint = S.ctxs.find((c) => c.hint === "interactive");
    if (!hint) return 0;
    const ts = S.starts.filter((s) => s.ctx === hint.id && s.at >= (sinceAt || 0)).map((s) => s.at).sort((a, b) => a - b);
    let n = 0;
    let last = -1e9;
    for (const t of ts) {
      if (t - last > 25) n++;
      last = t;
    }
    return n;
  };
  S.mark = () => performance.now();
  S.soundCtx = () => S.ctxs.filter((c) => c.hint === "interactive").length;
})();
`;

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });

const BASE_STATE = {
  onboarded: true,
  deviceId: "00000000-0000-4000-8000-0000000000f7",
  user: { name: "R", vibe: [], facts: {} },
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
 * A page with the model stubbed, the probe installed before the first byte of
 * app code, and NO gesture yet delivered. Entering the thread is a separate
 * step on purpose: the first test in this file is about what is true before
 * anybody has touched anything.
 */
async function open({ script = ["hi"], delayMs = 120, state = {} } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.addInitScript(PROBE);
  const page = await ctx.newPage();
  let i = 0;
  await page.route("**/api/chat", async (route) => {
    const n = i++;
    const text = typeof script === "function" ? script(n) : script[Math.min(n, script.length - 1)];
    await sleep(typeof delayMs === "function" ? delayMs(n) : delayMs);
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ text }) });
  });
  for (const p of [
    "**/api/memory", "**/api/telemetry", "**/api/consolidate", "**/api/account",
    "**/api/clock", "**/api/life", "**/api/search", "**/api/trace", "**/api/route",
    "**/api/gif", "**/api/speech", "**/api/diag",
  ]) {
    await page.route(p, (r) => r.fulfill({ status: 200, contentType: "application/json", body: "{}" }));
  }
  await page.goto(`${B}/chat`, { waitUntil: "domcontentloaded" });
  await page.evaluate((s) => localStorage.setItem("meera.state.v1", JSON.stringify(s)), { ...BASE_STATE, ...state });
  await page.reload({ waitUntil: "domcontentloaded" });
  await sleep(1100);
  return { page, ctx };
}

/** Walk from home into the thread. This is also the app's FIRST gesture. */
async function enterChat(page) {
  await page.click('[data-tel="home.open_chat"]');
  await page.waitForFunction(
    () => document.querySelector(".chat-wrap")?.getAttribute("data-surface") === "chat",
    null,
    { timeout: 8000 },
  );
  await sleep(500);
}

/** A thread that already has history. She does not greet a sitting that is
 *  already open (engine/greeting.ts), so nothing is in flight and the only
 *  thing that could make a sound is the layer itself. */
const HISTORY = {
  messages: [
    { id: "a1", from: "me", kind: "text", text: "hey", at: Date.now() - 60000, status: "read" },
    { id: "a2", from: "her", kind: "text", text: "hi", at: Date.now() - 59000 },
    { id: "a3", from: "her", kind: "text", text: "kaise ho", at: Date.now() - 58000 },
  ],
};

/* ── 1. nothing exists before the first gesture ───────────────────────── */
{
  const { page, ctx } = await open({ state: HISTORY });
  const before = await page.evaluate(() => ({ ctxs: window.__snd.ctxs.length, sound: window.__snd.soundCtx() }));
  // The app has mounted, painted home, restored the thread and armed the
  // layer. Not one AudioContext belongs to the sound layer, because not one
  // gesture has happened. This is gate 1, and it is the only one a fake
  // context cannot test at all.
  ok("no sound context before any gesture", before.sound === 0, JSON.stringify(before));
  await enterChat(page);
  await sleep(900);
  const after = await page.evaluate(() => ({ sound: window.__snd.soundCtx(), cues: window.__snd.cues(0) }));
  ok("the first gesture builds exactly one sound context", after.sound === 1, JSON.stringify(after));
  // ...and it built it SILENTLY, with a thread full of her messages already on
  // screen. Two claims in one number: unlocking is not an event worth
  // announcing, and RESTORED history is not an arrival. The second is
  // `activity-forgot-the-teardown`'s shape one layer over — the mount case is
  // where a sensory layer sounds with nobody's finger in front of it, and the
  // only way to be sure is to load a thread that already has a past.
  ok("unlock and a restored thread are both silent", after.cues === 0, `${after.cues} cues`);
  await ctx.close();
}

/* ── 1b. but she DOES sound when she walks in ─────────────────────────── */
//
// The other side of the same coin, and worth pinning because the guard above
// is exactly the kind that gets tightened until it silences the feature it was
// protecting. Opening a fresh chat is a gesture; her opener is a reply to it;
// it gets its arrival.
{
  const { page, ctx } = await open({ script: ["arre hi"], delayMs: 150 });
  await enterChat(page);
  await page.waitForFunction(() => document.querySelectorAll(".msg.her").length >= 1, null, { timeout: 20000 });
  await sleep(700);
  const cues = await page.evaluate(() => window.__snd.cues(0));
  ok("her opener arrives audibly, once", cues === 1, `${cues} cues`);
  await ctx.close();
}

/* ── 2. sending sounds, once ──────────────────────────────────────────── */
{
  const { page, ctx } = await open({ script: ["ok"], delayMs: 4000 });
  await enterChat(page);
  const t0 = await page.evaluate(() => window.__snd.mark());
  await page.fill("textarea", "hi");
  await page.click('[data-tel="chat.send"]');
  await sleep(600);
  const cues = await page.evaluate((t) => window.__snd.cues(t), t0);
  // Exactly one. A send that fires two cues is a send that sounds like a
  // stutter, and it is the single most-heard sound in the product.
  ok("one send makes exactly one sound", cues === 1, `${cues} cues`);
  await ctx.close();
}

/* ── 3. a three-bubble reply is ONE arrival ───────────────────────────── */
//
// The load-bearing test in this file. haptics.ts refuses her messages a haptic
// outright because three arrivals in four seconds is a phone buzzing
// continuously; the sound layer is allowed one, and "one" is a property of the
// delivery loop in Chat.tsx rather than of src/sound/ — which means the offline
// gate cannot see it and only a real delivery can.
{
  const { page, ctx } = await open({ script: ["arre\nkya haal\nbolo na"], delayMs: 200, state: HISTORY });
  await enterChat(page);
  await sleep(600);
  // Marked BEFORE the send rather than after it. The first version of this
  // waited 900ms and then started counting, which put the mark on the wrong
  // side of an arrival that had already happened and reported a clean zero --
  // a window that opens after the event it is measuring reads exactly like a
  // feature that does not work.
  const t0 = await page.evaluate(() => window.__snd.mark());
  await page.fill("textarea", "hi");
  await page.click('[data-tel="chat.send"]');
  await page.waitForFunction(() => document.querySelectorAll(".msg.her").length >= 5, null, { timeout: 30000 });
  await sleep(900);
  const fresh = await page.evaluate(() => document.querySelectorAll(".msg.her").length - 2);
  const cues = await page.evaluate((t) => window.__snd.cues(t), t0);
  ok("three of her bubbles arrived", fresh >= 3, `${fresh}`);
  // Two: his send, and ONE arrival for the whole burst.
  ok("a three-bubble reply is one send plus one arrival", cues === 2, `${cues} cues for ${fresh} bubbles`);
  await ctx.close();
}

/* ── 4. the toggle is sacred ──────────────────────────────────────────── */
{
  const { page, ctx } = await open({ script: ["ok"], delayMs: 4000 });
  await enterChat(page);
  await page.click('[data-tel="chat.settings"]');
  await page.waitForSelector('[data-tel="more.sound"]', { timeout: 8000 });
  const on = await page.getAttribute('[data-tel="more.sound"]', "aria-checked");
  ok("the switch ships ON", on === "true", String(on));
  await page.click('[data-tel="more.sound"]');
  const off = await page.getAttribute('[data-tel="more.sound"]', "aria-checked");
  ok("tapping it turns it off", off === "false", String(off));
  // and it persisted, which is the difference between a switch and a mood
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("meera.state.v1") || "{}").soundOn);
  ok("off is written to state", stored === false, String(stored));
  await page.keyboard.press("Escape").catch(() => {});
  await page.click('[data-tel="more.close"]').catch(() => {});
  await sleep(400);
  const t0 = await page.evaluate(() => window.__snd.mark());
  await page.fill("textarea", "hi");
  await page.click('[data-tel="chat.send"]');
  await sleep(700);
  const cues = await page.evaluate((t) => window.__snd.cues(t), t0);
  ok("off means silent, in a real graph", cues === 0, `${cues} cues`);
  await ctx.close();
}

await browser.close();
console.log(fails ? `\n${fails} FAILED` : "\nall sound-browser checks passed");
process.exit(fails ? 1 : 0);
