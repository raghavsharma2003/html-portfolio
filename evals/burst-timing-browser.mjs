// THE BREATH, MEASURED — the felt timing of the reported defect, in a real
// browser, against the REAL built app.
//
//   npx vite build
//   npx vite preview --port 4291 --strictPort &
//   node evals/burst-timing-browser.mjs
//
// WHY THIS EXISTS SEPARATELY FROM burst-browser.mjs. That file proves the
// STRUCTURE of a burst — one reply, one model call, both messages in one turn.
// This one proves the NUMBER, which is the thing the owner has now reported
// three times and the thing no structural assertion can see. Every row prints
// the measured milliseconds, because "she replies too fast" is a measurement
// and answering it with prose is how it came back twice.
//
// The pure grid (evals/burstgrid.mjs, ~480 cells) is the model. This is the
// small set of cells where the surface could disagree with the model — the
// clock, the composer's real events, the Android event shape, and the delivery
// beats that sit between the decision and the bubble. Six scenarios, ~90s.
//
// NOT in evals/run.mjs, for the same by-construction reason as its neighbour:
// it needs a built app on a port. It IS in version control, and its entry URL
// is `#chat` — see the note in burst-browser.mjs about the two days this
// battery spent unable to reach the composer.
import { chromium } from "playwright";

const B = process.env.MEERA_PREVIEW || "http://localhost:4291";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (n, c, e = "") => { console.log(`${c ? "ok  " : "FAIL"} ${n}${e ? " — " + e : ""}`); if (!c) fails++; };

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });

const BASE_STATE = {
  onboarded: true,
  deviceId: "00000000-0000-4000-8000-0000000000b7",
  user: { name: "R", vibe: [] },
  messages: [],
  openrouterKey: "", openrouterModel: "", apiKey: "",
  elevenKey: "", elevenVoiceId: "", sarvamKey: "", deviceVoice: "",
  lastSeen: Date.now(),
};

/**
 * A seeded thread, so there is no proactive opener in the way and the burst
 * clock is the only thing being measured.
 */
const seeded = () => ({
  messages: [
    { id: "s1", from: "her", kind: "text", text: "arre haan bolo", at: Date.now() - 400_000 },
    { id: "s2", from: "me", kind: "text", text: "kuch nahi", at: Date.now() - 390_000, status: "read" },
    { id: "s3", from: "her", kind: "text", text: "achha", at: Date.now() - 380_000 },
  ],
});

async function open({ state = {} } = {}) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const calls = [];
  await page.route("**/api/chat", async (route) => {
    calls.push({ at: Date.now(), messages: JSON.parse(route.request().postData() || "{}").messages });
    await sleep(120);
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ text: "haan bolo" }) });
  });
  for (const p of ["**/api/memory", "**/api/telemetry", "**/api/consolidate", "**/api/account", "**/api/clock", "**/api/life", "**/api/search", "**/api/trace", "**/api/route", "**/api/diag"])
    await page.route(p, (r) => r.fulfill({ status: 200, contentType: "application/json", body: "{}" }));
  await page.goto(`${B}/#chat`, { waitUntil: "domcontentloaded" });
  await page.evaluate((s) => localStorage.setItem("meera.state.v1", JSON.stringify(s)), { ...BASE_STATE, ...seeded(), ...state });
  await page.reload({ waitUntil: "domcontentloaded" });
  await sleep(900);
  return { page, calls };
}

const herCount = (page) => page.$$eval(".msg.her", (e) => e.length);
const composer = '[data-tel="chat.composer"]';

async function sendNow(page, text) {
  await page.locator(composer).click();
  await page.locator(composer).type(text, { delay: 25 });
  await page.keyboard.press("Enter");
}

/** poll for her next bubble; returns ms, or -1 */
async function waitForHer(page, before, timeoutMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if ((await herCount(page)) > before) return Date.now() - t0;
    await sleep(50);
  }
  return -1;
}

/**
 * The soft keyboard, as an Android WebView reports it: the visual viewport
 * shrinks. Nothing else about it is observable from the page, which is exactly
 * why the policy had to be taught to read this one.
 */
async function fakeKeyboard(page, open) {
  await page.evaluate((isOpen) => {
    const vv = window.visualViewport;
    if (!vv) return;
    // shadow the height, then fire the event the app already listens to
    Object.defineProperty(vv, "height", { configurable: true, get: () => (isOpen ? 500 : 844) });
    vv.dispatchEvent(new Event("resize"));
  }, open);
}

/** an Android IME commit: an `input` event, and no keydown anywhere */
async function imeType(page, value) {
  await page.evaluate((val) => {
    const el = document.querySelector('[data-tel="chat.composer"]');
    const set = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
    set.call(el, val);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
}

// ══ 1. THE REPORT ══════════════════════════════════════════════════════════
// One complete-looking message, then he reaches for the keyboard a moment
// later. Before WS-BREATH: she fired at 2.05s regardless of whether he started
// typing at 2s, 4s or 8s — there was never a race to lose.
//
// INSIDE the breath she must not speak. OUTSIDE it she may, and should: a
// person who has heard nothing for four seconds answers, and the second
// message then gets the ordinary follow-up she would give it in life. Both
// halves are asserted, because a fix that made her wait for a follow-up that
// might never come would be the same defect wearing the other coat.
{
  const { page } = await open();
  await sleep(600);
  const before = await herCount(page);
  await sendNow(page, "U can call me");
  const t0 = Date.now();
  let fired = -1;
  const watch = waitForHer(page, before, 20_000).then((ms) => { fired = ms; });
  await sleep(2_000);
  ok("report: he reaches the keyboard at 2.0s and she has NOT spoken", fired === -1,
    fired === -1 ? "" : `she fired at ${(fired / 1000).toFixed(2)}s`);
  await page.locator(composer).click();
  for (let k = 0; k < 10; k++) { await page.keyboard.type("a", { delay: 0 }); await sleep(180); }
  ok("report: and she is STILL silent through the whole message he types", fired === -1,
    fired === -1 ? "" : `she fired at ${(fired / 1000).toFixed(2)}s`);
  await page.locator(composer).fill("");
  await sendNow(page, "kal ke liye");
  await watch;
  await sleep(4_000);
  const after = await herCount(page);
  ok("report: exactly one reply to the whole pair", after === before + 1, `${after - before} replies`);
  console.log(`      FELT: complete sentence, keyboard reached at 2.0s → silent through ${((Date.now() - t0) / 1000).toFixed(1)}s, then ONE reply`);
  await page.close();
}
// The far side of the floor. She speaks, and his next message is not lost — it
// gets its own reply, which is what a person does when the room went quiet and
// then someone said something else.
{
  const { page } = await open();
  await sleep(600);
  const before = await herCount(page);
  await sendNow(page, "U can call me");
  const first = await waitForHer(page, before, 15_000);
  ok("report: after four seconds of nothing she does answer", first > 0 && first < 5_000, `${(first / 1000).toFixed(2)}s`);
  await sleep(1_500);
  await sendNow(page, "kal ke liye");
  const second = await waitForHer(page, before + 1, 15_000);
  ok("report: and the message he sends afterwards is answered too, not dropped", second > 0, `${(second / 1000).toFixed(2)}s`);
  console.log(`      FELT: unattended → ${(first / 1000).toFixed(2)}s, then his next message → ${(second / 1000).toFixed(2)}s`);
  await page.close();
}

// ══ 2. THE MIRROR — patience must not become dead air ══════════════════════
{
  const { page } = await open();
  await sleep(600);
  const before = await herCount(page);
  await sendNow(page, "U can call me");
  await page.evaluate(() => document.querySelector('[data-tel="chat.composer"]').blur());
  const ms = await waitForHer(page, before, 15_000);
  ok("mirror: an unattended message is still answered promptly", ms > 0 && ms < 6_000, `${(ms / 1000).toFixed(2)}s`);
  console.log(`      FELT: nobody at the keyboard → ${(ms / 1000).toFixed(2)}s (was 2.17s; the floor plus her read/type beats)`);
  await page.close();
}

// ══ 3. THE FOCUS HOLE — keyboard up, box empty, not one key ════════════════
// Measured before WS-BREATH at 2.13s, byte-identical to a phone face-down.
{
  const { page } = await open();
  await sleep(600);
  const before = await herCount(page);
  await sendNow(page, "U can call me");
  await page.evaluate(() => document.querySelector('[data-tel="chat.composer"]').blur());
  await sleep(1_200);
  await page.locator(composer).click(); // he comes back to the box and stops
  const ms = await waitForHer(page, before, 20_000);
  ok("focus: sitting in the box is a hold", ms > 3_000, `${(ms / 1000).toFixed(2)}s`);
  ok("focus: and it ends — she is never stuck behind a keyboard", ms > 0 && ms < 12_000, `${(ms / 1000).toFixed(2)}s`);
  console.log(`      FELT: focused at 1.2s, zero keystrokes → ${(ms / 1000).toFixed(2)}s (was 2.13s)`);
  await page.close();
}

// ══ 4. THE ANDROID SHAPE — a keyboard that only resizes, and no keydown ════
// Two claims at once: the viewport collapse alone holds her, and an IME that
// commits through `input` events with no keydown anywhere still counts as him
// working on the message. If either failed, the APK would carry a different
// Meera than the web, which is the failure `surface-bypasses-parse` names.
{
  const { page } = await open();
  await sleep(600);
  const before = await herCount(page);
  await sendNow(page, "U can call me");
  await page.evaluate(() => document.querySelector('[data-tel="chat.composer"]').blur());
  await sleep(900);
  await fakeKeyboard(page, true); // he taps the box; only the viewport says so
  const kbOnly = await waitForHer(page, before, 20_000);
  ok("android: a viewport collapse alone holds her", kbOnly > 3_000, `${(kbOnly / 1000).toFixed(2)}s`);
  ok("android: and releases", kbOnly > 0 && kbOnly < 12_000, `${(kbOnly / 1000).toFixed(2)}s`);
  console.log(`      FELT: keyboard-open event only, no focus, no keys → ${(kbOnly / 1000).toFixed(2)}s`);
  await page.close();
}
{
  const { page } = await open();
  await sleep(600);
  const before = await herCount(page);
  await sendNow(page, "U can call me");
  let fired = -1;
  const t0 = Date.now();
  const watch = waitForHer(page, before, 14_000).then((ms) => { fired = ms; });
  await sleep(500);
  let s = "";
  for (let k = 0; k < 16; k++) { s += "a"; await imeType(page, s); await sleep(180); }
  const typedFor = Date.now() - t0;
  ok("android: an IME with NO keydown at all still holds her", fired === -1, `she fired at ${fired}ms`);
  console.log(`      FELT: ${(typedFor / 1000).toFixed(1)}s of keydown-free IME input, still silent`);
  await watch;
  await page.close();
}

// ══ 5. THE CLIFF — a short draft must not buy a paragraph's patience ═══════
// Measured before WS-BREATH: six characters typed and left produced 13.31s of
// silence, against 2.17s for the same message with the box empty. Two settings
// and nothing between them is not a person.
{
  const { page } = await open();
  await sleep(600);
  const before = await herCount(page);
  await sendNow(page, "U can call me");
  await sleep(400);
  await page.locator(composer).click();
  for (let k = 0; k < 6; k++) { await page.keyboard.type("a", { delay: 0 }); await sleep(180); }
  const ms = await waitForHer(page, before, 20_000);
  ok("cliff: a six-character draft is not a paragraph", ms > 0 && ms < 11_000, `${(ms / 1000).toFixed(2)}s`);
  ok("cliff: and she still waits out the pause", ms > 4_000, `${(ms / 1000).toFixed(2)}s`);
  console.log(`      FELT: six characters, then he stops → ${(ms / 1000).toFixed(2)}s (was 13.31s)`);
  await page.close();
}

// ══ 6. THE HANDOFF — patience is charged on the shapes that asked for it ═══
{
  const { page } = await open();
  await sleep(600);
  const before = await herCount(page);
  await sendNow(page, "kya kar rahi ho?");
  await page.evaluate(() => document.querySelector('[data-tel="chat.composer"]').blur());
  const ms = await waitForHer(page, before, 15_000);
  ok("handoff: a question aimed at her is answered fast", ms > 0 && ms < 4_500, `${(ms / 1000).toFixed(2)}s`);
  console.log(`      FELT: a question aimed at her → ${(ms / 1000).toFixed(2)}s`);
  await page.close();
}

// ══ 7. THE LIVENESS BOUND, in the browser ═════════════════════════════════
// He types forever with the keyboard up and the box full. The permanent-stall
// ceiling is unchanged by WS-BREATH and must stay unchanged: she interjects.
{
  const { page } = await open();
  await sleep(600);
  const before = await herCount(page);
  await sendNow(page, "hello");
  await fakeKeyboard(page, true);
  let held = -1;
  const watcher = waitForHer(page, before, 30_000).then((ms) => { held = ms; });
  await page.locator(composer).click();
  const end = Date.now() + 24_000;
  while (Date.now() < end) { await page.keyboard.type("a", { delay: 0 }); await sleep(300); }
  await watcher;
  ok("liveness: she interjects while he is still typing", held > 0 && held < 25_000, `${(held / 1000).toFixed(2)}s`);
  ok("liveness: at the ceiling plus her delivery beats, not before the breath", held > 5_000 && held < 19_000, `${(held / 1000).toFixed(2)}s`);
  console.log(`      FELT: interjected at ${(held / 1000).toFixed(2)}s with focus, keyboard and a live draft all held open (ceiling 15.0s)`);
  await page.close();
}

await browser.close();
console.log(fails ? `\n${fails} FAILURES` : "\nALL PASS");
process.exit(fails ? 1 : 0);
