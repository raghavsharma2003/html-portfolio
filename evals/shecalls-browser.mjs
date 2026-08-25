// WS-SHECALLS — the whole flow, in a real browser.
//
//   npx vite build
//   npx vite preview --port 4293 --strictPort &
//   node evals/shecalls-browser.mjs            # assert (exit 1 on failure)
//   node evals/shecalls-browser.mjs --observe  # print, never fail
//
// ── why a browser ─────────────────────────────────────────────────────────
//
// `evals/call-invite.mjs` proves the PREDICATE: given a thread, is there an
// ask. It cannot prove the thing the owner's screenshot was actually about,
// which is that a phone rings. Five links in that chain are properties of a
// running page and of nothing else:
//
//   1. HE ASKS AND SHE ANSWERS FIRST. The ring must follow her line, never
//      land on top of his message or over her silence. Measured as order of
//      events in the DOM, not as an argument about an anchor.
//   2. THE RING IS THE ONE APP ALREADY OWNS. `IncomingCall` mounts, with
//      `secs: 0`, so its subtitle carries no "call cut at m:ss" — there was
//      no dropped call here and a number would be a small lie on the largest
//      control in the product.
//   3. IT LANDS INSIDE 2-6 SECONDS. Read off `AppState.callback.at` in the
//      page, before it is due.
//   4. ACCEPTING OPENS HER AS THE CALLER. Asserted where it is decidable: the
//      pickup request her brain actually makes carries
//      `CALL_OPEN_DIRECTIVE`'s caller opener ("you are the caller"), which is
//      the byte that stops her answering her own call like a stranger. This
//      is the whole of #107 being reused rather than reimplemented, and it is
//      the assertion that fails if someone ever builds a second ring path.
//   5. THE GUARDS HOLD THROUGH THE REAL SURFACE. A pending ring does not
//      stack, a declined ring does not come back on reload, and "call me
//      later" / "can i call you" ring nothing at all.
//
// The model is stubbed, so it is deterministic and costs $0. No network
// leaves the page.
//
// NOT wired into evals/run.mjs, for the same by-construction reason
// `gameplay-browser.mjs` and `world-thread-browser.mjs` state: it needs a
// built app and a server on a port, which the APK workflow has neither of,
// and a skipped gate that looks like a passed gate is how a shadowed index
// survived a day. It is in version control because `dead-writers` does not
// stop being true for evals.
import { chromium } from "playwright";
const B = process.env.MEERA_PREVIEW || "http://localhost:4293";
const OBSERVE = process.argv.includes("--observe");

let fails = 0;
const ok = (n, c, e = "") => {
  console.log(`${c ? "ok  " : "FAIL"} ${n}${e ? " — " + e : ""}`);
  if (!c && !OBSERVE) fails++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({
  executablePath: process.env.PW_CHROMIUM || "/opt/pw-browsers/chromium",
});

const BASE_STATE = {
  onboarded: true,
  deviceId: "00000000-0000-4000-8000-00000000ca11",
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

let seq = 0;
const msg = (from, text, dtMs = 0) => ({
  id: `s${++seq}`,
  from,
  kind: "text",
  text,
  at: Date.now() - 60_000 + dtMs,
  status: from === "me" ? "read" : undefined,
});

/**
 * A chat session with the model stubbed.
 *
 * `chatBodies` collects every POST that reached her brain, which is how
 * assertion 4 is made: the pickup directive is not visible anywhere in the
 * DOM, and it is the one byte that decides whether she knows she dialled.
 */
async function open({ state = {}, script = ["achha ruk, karti hu"], delayMs = 120 } = {}) {
  // `reducedMotion` is not decoration here: the ring's accept disc sits inside
  // a 2s pulse, and Playwright refuses to click an element it measures moving.
  // The button under test is the same button either way.
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    reducedMotion: "reduce",
  });
  const page = await ctx.newPage();
  const chatBodies = [];
  let i = 0;
  await page.route("**/api/chat", async (route) => {
    chatBodies.push(route.request().postData() || "");
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
    "**/api/gif", "**/api/speech", "**/api/notify", "**/api/token",
  ]) {
    await page.route(p, (r) =>
      r.fulfill({ status: 200, contentType: "application/json", body: "{}" }),
    );
  }
  await page.goto(`${B}/chat`, { waitUntil: "domcontentloaded" });
  await page.evaluate(
    (s) => localStorage.setItem("meera.state.v1", JSON.stringify(s)),
    { ...BASE_STATE, ...state },
  );
  // A ring already taken in an earlier case must not leak into this one.
  await page.evaluate(() => localStorage.removeItem("meera.shecall.taken"));
  await page.reload({ waitUntil: "domcontentloaded" });
  await sleep(900);
  await page.click('[data-tel="home.open_chat"]');
  await page.waitForFunction(
    () => document.querySelector(".chat-wrap")?.getAttribute("data-surface") === "chat",
    null,
    { timeout: 8000 },
  );
  await sleep(400);
  return { page, ctx, chatBodies };
}

const readState = (page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem("meera.state.v1") || "{}"));

async function say(page, text) {
  await page.fill(".chat-input textarea", text);
  await page.click('[data-tel="chat.send"]');
}

/** Her reply has landed when a bubble of hers carries text. */
const herBubbles = (page) => page.evaluate(() => document.querySelectorAll(".msg.her").length);

// ════ 1. THE FLOW: ask → her line → ring → accept → she opens as caller ════
{
  console.log("\n── 1. the owner's exchange, end to end ──");
  const { page, ctx, chatBodies } = await open({ script: ["achha ruk, karti hu"] });

  ok("no ring before he asks", (await page.$(".incoming")) === null);
  await say(page, "u can call me");

  // HER LINE FIRST. The ring is anchored on her reply, so the bubble has to
  // exist before the ring can. Asserted as an ordering, not as a delay.
  await page.waitForFunction(() => document.querySelectorAll(".msg.her").length > 0, null, {
    timeout: 20_000,
  });
  ok("she answered in words first", (await herBubbles(page)) > 0);
  ok("…and the ring is not up yet", (await page.$(".incoming")) === null);

  // THE 2-6s WINDOW, read off the state before it is due.
  const armed = await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem("meera.state.v1") || "{}");
    return s.callback ? { in: s.callback.at - Date.now(), secs: s.callback.secs } : null;
  });
  ok("a ring is armed", armed !== null, JSON.stringify(armed));
  ok(
    "…inside the 2-6s window",
    armed !== null && armed.in > 0 && armed.in <= 6000,
    `${armed?.in}ms`,
  );
  ok(
    "…with secs 0, so the subtitle claims no dropped call",
    armed?.secs === 0,
    String(armed?.secs),
  );

  // THE RING IS App's OWN IncomingCall.
  await page.waitForSelector(".incoming", { timeout: 12_000 });
  const sub = (await page.textContent(".inc-sub")) || "";
  ok("the ring is up", true);
  ok("it is her calling", /calling/i.test(sub), sub);
  ok("…and it does not invent a dropped call", !/call cut at/i.test(sub), sub);

  // ACCEPT → the call mounts, and she knows she dialled.
  await page.click('[data-tel="call.accept"]', { force: true });
  await page.waitForSelector(".call", { timeout: 12_000 });
  ok("accepting opens the call", true);
  await page.waitForFunction(
    () => !JSON.parse(localStorage.getItem("meera.state.v1") || "{}").callback,
    null,
    { timeout: 6000 },
  );
  ok("…and the armed ring is spent", (await readState(page)).callback == null);

  // THE PROOF THAT #107's MACHINERY IS THE ONE BEING REUSED: her pickup turn
  // carries the CALLER opener, not the answerer one.
  let pickup = "";
  for (let t = 0; t < 40 && !pickup; t++) {
    pickup = chatBodies.find((b) => /you are the caller/i.test(b)) || "";
    if (!pickup) await sleep(250);
  }
  ok("she opens as the CALLER, not as someone answering", Boolean(pickup));
  ok(
    "…which is CALL_OPEN_DIRECTIVE's sheCalled branch, not a second path",
    /calling back is why you'?re here/i.test(pickup),
  );
  ok(
    "…and the answerer opener is nowhere in that turn",
    !/you just picked up their voice call/i.test(pickup),
  );
  await ctx.close();
}

// ════ 2. DECLINE, AND THE DECLINE THAT STAYS DECLINED ══════════════════════
{
  console.log("\n── 2. decline ──");
  const { page, ctx } = await open({ script: ["haan ruk"] });
  await say(page, "call kar na");
  await page.waitForSelector(".incoming", { timeout: 25_000 });
  await page.click('[data-tel="call.decline"]', { force: true });
  await sleep(600);
  ok("declining clears the ring", (await page.$(".incoming")) === null);
  ok("…and no call is up", (await page.$(".call")) === null);
  ok("…and nothing is armed", (await readState(page)).callback == null);

  // `IncomingCall.tsx`'s own law: a declined call that comes back is a
  // product nobody wants. Reloading is the case a ref cannot cover — the ask
  // is still sitting in the thread, well inside the freshness window.
  await page.reload({ waitUntil: "domcontentloaded" });
  await sleep(2500);
  await page.click('[data-tel="home.open_chat"]').catch(() => {});
  await sleep(8000);
  ok("a declined ring does not come back on reload", (await page.$(".incoming")) === null);
  ok("…and nothing re-armed", (await readState(page)).callback == null);
  await ctx.close();
}

// ════ 3. A PENDING RING DOES NOT STACK ═════════════════════════════════════
//
// Seeded with a ring already armed and not yet due, which is the state a
// repeat ask actually arrives in. The second ask must change nothing: one
// pending she-call at a time is the whole contract.
{
  console.log("\n── 3. a repeat ask does not stack ──");
  const at = Date.now() + 45_000;
  const { page, ctx } = await open({
    state: { messages: [msg("me", "call me na"), msg("her", "ruk", 1000)], callback: { at, secs: 0 } },
    script: ["haan haan"],
  });
  await say(page, "call kar na yaar");
  await page.waitForFunction(() => document.querySelectorAll(".msg.her").length > 1, null, {
    timeout: 20_000,
  });
  await sleep(1500);
  const s = await readState(page);
  ok("the pending ring is untouched", s.callback?.at === at, JSON.stringify(s.callback));
  ok("…and there is exactly one of it", (await page.$(".incoming")) === null);
  await ctx.close();
}

// ════ 4. WHAT MUST RING NOTHING ════════════════════════════════════════════
//
// The two families the predicate suite covers in bulk, driven once each
// through the real send path — because a guard that only exists in a unit
// test is a guard nobody has watched hold.
{
  console.log("\n── 4. the near misses, through the real surface ──");
  for (const [line, why] of [
    ["call me later", "a time he named that is not now"],
    ["can i call you?", "he is the one dialling"],
    ["you can call me sam", "the naming idiom"],
    ["usne abhi call kiya tha", "a call that already happened"],
  ]) {
    const { page, ctx } = await open({ script: ["accha"] });
    await say(page, line);
    await page.waitForFunction(() => document.querySelectorAll(".msg.her").length > 0, null, {
      timeout: 20_000,
    });
    await sleep(8000);
    ok(`"${line}" rings nothing — ${why}`, (await page.$(".incoming")) === null);
    ok(`…and arms nothing`, (await readState(page)).callback == null);
    await ctx.close();
  }
}

await browser.close();
console.log(fails ? `\n${fails} FAILURE(S)` : "\nall she-calls browser checks passed");
process.exit(fails ? 1 : 0);
