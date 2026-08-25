// THE BURST BATTERY, in a real browser, against the REAL built app.
//
// Nine rows of docs/BURSTS.md that no pure test can reach, because every one
// of them is about TIME and about the surface: the hold across a live draft,
// a supersede that happens mid-generation, a message landing between two of
// her bubbles, and the interjection ceiling actually firing.
//
//   npx vite build
//   npx vite preview --port 4287 --strictPort &
//   node evals/burst-browser.mjs
//
// NOT in evals/run.mjs, and deliberately: it needs a built app and a server on
// a port, which is not a thing CI does on every build — the same
// by-construction exclusion the `--live` suites carry. It is still in version
// control because `dead-writers` does not stop being true for evals, and a
// suite that lives only in a session scratchpad protects nothing.
//
// The model is stubbed at /api/chat, so it is deterministic and costs $0. The
// stub also RECORDS every request body, which is how "the burst reaches the
// model as ONE user turn" is proven rather than asserted.
//
// Runtime ~2 minutes, most of it the 24s adversarial typing run.
import { chromium } from "playwright";

const B = process.env.MEERA_PREVIEW || "http://localhost:4287";
let fails = 0;
const ok = (n, c, e = "") => { console.log(`${c ? "ok  " : "FAIL"} ${n}${e ? " — " + e : ""}`); if (!c) fails++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });

const BASE_STATE = {
  onboarded: true,
  deviceId: "00000000-0000-4000-8000-0000000000b1",
  user: { name: "R", vibe: [] },
  messages: [],
  openrouterKey: "", openrouterModel: "", apiKey: "",
  elevenKey: "", elevenVoiceId: "", sarvamKey: "", deviceVoice: "",
  lastSeen: Date.now(),
};

/** a fresh page with the model stubbed and every other network call silenced */
async function open(script, { delayMs = 250, state = {} } = {}) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const calls = [];
  let i = 0;
  await page.route("**/api/chat", async (route) => {
    const body = JSON.parse(route.request().postData() || "{}");
    calls.push({ at: Date.now(), messages: body.messages });
    const text = typeof script === "function" ? script(i++, body) : script[Math.min(i++, script.length - 1)];
    await sleep(delayMs);
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ text }) });
  });
  for (const p of ["**/api/memory", "**/api/telemetry", "**/api/consolidate", "**/api/account", "**/api/clock", "**/api/life", "**/api/search", "**/api/trace", "**/api/route"]) {
    await page.route(p, (r) => r.fulfill({ status: 200, contentType: "application/json", body: "{}" }));
  }
  // `#chat`, NOT `/chat`. THE SUITE WAS DEAD AND SAID NOTHING. App.tsx picks
  // its surface from `location.hash + location.search` only, so after the
  // home-surface wave landed this file navigated to a page whose thread is
  // rendered but `inert` behind the home screen — every `send()` timed out on
  // `home.chat` intercepting the click, and because this battery is
  // deliberately outside verify-release, nothing anywhere went red. That is
  // most of the answer to "why does it keep happening": the only instrument in
  // the repo that measures FELT burst timing had stopped being able to reach
  // the composer, so the third recurrence shipped unmeasured.
  await page.goto(`${B}/#chat`, { waitUntil: "domcontentloaded" });
  await page.evaluate((s) => localStorage.setItem("meera.state.v1", JSON.stringify(s)), { ...BASE_STATE, ...state });
  await page.reload({ waitUntil: "domcontentloaded" });
  await sleep(900);
  return { page, calls };
}

const bubbles = (page) =>
  page.$$eval(".msg", (els) =>
    els.map((e) => ({ who: e.className.includes(" her") ? "her" : "me", text: (e.textContent || "").trim() })),
  );
const hers = async (page) => (await bubbles(page)).filter((b) => b.who === "her").map((b) => b.text);

/** type into the composer one keystroke at a time, like a person */
async function typeSlowly(page, text, perKey = 60) {
  await page.locator('[data-tel="chat.composer"]').click();
  await page.locator('[data-tel="chat.composer"]').type(text, { delay: perKey });
}
async function send(page, text, perKey = 40) {
  await typeSlowly(page, text, perKey);
  await page.keyboard.press("Enter");
}
/** keep the draft alive without sending — the "typing…" signal */
async function keepTyping(page, ms, chunk = "abcde ") {
  const end = Date.now() + ms;
  await page.locator('[data-tel="chat.composer"]').click();
  while (Date.now() < end) {
    await page.keyboard.type(chunk[Math.floor(Math.random() * chunk.length)], { delay: 0 });
    await sleep(300);
  }
}
/**
 * Poll for her next message and return how long it actually took.
 *
 * Deliberately a poll rather than `waitForFunction` + a later `await`: the
 * first version of this file awaited the watcher AFTER a fixed sleep, so every
 * "felt timing" it printed was the sleep, not the product. A measurement whose
 * value cannot be wrong is not a measurement.
 */
async function waitForHer(page, before, timeoutMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const c = await page.$$eval(".msg.her", (e) => e.length);
    if (c > before) return Date.now() - t0;
    await sleep(100);
  }
  return -1;
}

const lastUserTurn = (call) => {
  const t = call.messages[call.messages.length - 1];
  return typeof t.content === "string" ? t.content : JSON.stringify(t.content);
};

// ══ 1. THE OWNER'S SEQUENCE ════════════════════════════════════════════════
// she opens "heyyy" → he says "Hello" → she must NOT greet back → he says
// "Esse hi timepass" → she must NOT greet a third time.
{
  const script = ["heyyy", "hey! kya kar rahe ho", "heyy bas main bhi free hu"];
  const { page } = await open(script);
  await page.waitForSelector(".msg.her", { timeout: 15_000 });
  await sleep(1500);
  ok("owner-1: she opens with a greeting", (await hers(page))[0].toLowerCase().startsWith("hey"), (await hers(page)).join(" | "));

  await send(page, "Hello");
  await sleep(6000);
  const after1 = await hers(page);
  ok("owner-2: she replies", after1.length >= 2, after1.join(" | "));
  ok(
    "owner-2: NO second greeting — the model wrote 'hey! kya kar rahe ho', she said only the content",
    !/^(hey|hi|hello|heyy)\b/i.test(after1[1] || ""),
    after1[1],
  );

  await send(page, "Esse hi timepass");
  await sleep(6000);
  const after2 = await hers(page);
  ok("owner-3: she replies again", after2.length >= 3, after2.join(" | "));
  ok(
    "owner-3: NO third greeting — 'heyy bas main bhi free hu' arrives without the heyy",
    !/^(hey|hi|hello|heyy)\b/i.test(after2[2] || ""),
    after2[2],
  );
  ok("owner: exactly three of her messages, none of them a bare hello", after2.length === 3, after2.join(" | "));
  console.log("      her side:", JSON.stringify(after2));
  await page.close();
}

// ══ 2. THE TYPING HOLD ═════════════════════════════════════════════════════
// He sends "hello", then keeps typing for six seconds without sending, then
// sends the real message. She must not answer the fragment.
{
  const { page, calls } = await open(["heyyy", "arre kya hua plan ka"]);
  await page.waitForSelector(".msg.her", { timeout: 15_000 });
  await sleep(1500);
  const before = (await hers(page)).length;
  const t0 = Date.now();
  await send(page, "hello");
  const tHello = Date.now();
  await keepTyping(page, 6000);
  const mid = (await hers(page)).length;
  ok("hold: she said NOTHING while he was typing", mid === before, `${mid - before} messages during the hold`);
  // finish the thought and send it
  await page.locator('[data-tel="chat.composer"]').fill("");
  await send(page, "kal ka plan cancel ho gaya");
  const replyMs = await waitForHer(page, before, 15_000);
  await sleep(2500); // let any second reply that should not exist show up
  const after = await hers(page);
  ok("hold: she replies exactly once to the whole burst", after.length === before + 1, JSON.stringify(after.slice(before)));
  const burstCalls = calls.slice(1);
  ok("hold: ONE model call for the burst", burstCalls.length === 1, `${burstCalls.length} calls`);
  const turn = lastUserTurn(burstCalls[0]);
  ok("hold: the model saw BOTH messages in one user turn", turn.includes("hello") && turn.includes("plan cancel"), turn.replace(/\n/g, " ⏎ "));
  ok("hold: the reply is prompt once the draft is gone", replyMs > 0 && replyMs < 6000, `${(replyMs / 1000).toFixed(2)}s`);
  console.log(`      FELT: held ${((Date.now() - tHello) / 1000).toFixed(1)}s of silence across his 6s draft, then replied ${(replyMs / 1000).toFixed(2)}s after the real message landed`);
  console.log(`      the merged turn: ${JSON.stringify(turn)}`);
  await page.close();
}

// ══ 3. MID-GENERATION SUPERSEDE ════════════════════════════════════════════
// The first generation is 3s long. He sends a second message while it runs;
// the answer that comes back is for a question he has moved past and must be
// thrown away unread.
{
  const { page, calls } = await open(
    (i) => (i === 0 ? "heyyy" : i === 1 ? "STALE-ANSWER-MUST-NOT-APPEAR" : "arre dono baatein sun li"),
    { delayMs: 3000 },
  );
  await page.waitForSelector(".msg.her", { timeout: 20_000 });
  await sleep(1200);
  const before = (await hers(page)).length;
  const callsBefore = calls.length;
  await send(page, "kal ka plan cancel ho gaya");
  // WAIT FOR THE GENERATION TO ACTUALLY BE IN FLIGHT, rather than sleeping a
  // number chosen against whatever the burst wait happened to be. This used to
  // be `sleep(2200)`, and when WS-BREATH raised the breath past it the test
  // stopped exercising supersede at all: both messages merged into one burst,
  // the "stale" answer became the legitimate first answer, and the row went red
  // for a reason that had nothing to do with the property it names. The stub
  // records every request, so the honest trigger is the request itself.
  for (let i = 0; i < 200 && calls.length === callsBefore; i++) await sleep(100);
  ok("supersede: her generation is genuinely in flight before he interrupts", calls.length > callsBefore);
  await send(page, "ab kya karein");
  await sleep(9000);
  const after = await hers(page);
  ok("supersede: the stale answer never reached the screen", !after.some((t) => t.includes("STALE")), JSON.stringify(after));
  ok("supersede: she replies exactly once", after.length === before + 1, JSON.stringify(after.slice(before)));
  const last = lastUserTurn(calls[calls.length - 1]);
  ok("supersede: the re-read covers both messages", last.includes("plan cancel") && last.includes("ab kya karein"), last.replace(/\n/g, " ⏎ "));
  await page.close();
}

// ══ 4. MID-DELIVERY DIRTY ══════════════════════════════════════════════════
// Three bubbles take several seconds to type out. He sends something while
// she is mid-burst; she finishes, notices, and follows up.
{
  const { page, calls } = await open(
    (i) => (i === 0 ? "heyyy" : i === 1 ? "arre haan\nwo wala plan\nbahut bekar tha honestly" : "haan aur wo doosri baat bhi sun li"),
    { delayMs: 200 },
  );
  await page.waitForSelector(".msg.her", { timeout: 15_000 });
  await sleep(1200);
  const before = (await hers(page)).length;
  await send(page, "kal ka plan cancel ho gaya");
  // wait for her first bubble of the burst, then interrupt
  await page.waitForFunction((b) => document.querySelectorAll(".msg.her").length > b, before, { timeout: 15_000 });
  await send(page, "aur ek aur baat");
  await sleep(12_000);
  const after = await hers(page);
  ok("mid-delivery: her whole burst survived", after.length >= before + 3, JSON.stringify(after.slice(before)));
  ok("mid-delivery: she followed up on what landed", after.some((t) => t.includes("doosri baat")), JSON.stringify(after.slice(before)));
  ok("mid-delivery: two model calls, not one and not three", calls.length === 3, `${calls.length} total incl. opener`);
  await page.close();
}

// ══ 5. THE INTERJECTION CEILING ════════════════════════════════════════════
// He sends "hello" and then types without stopping. She must not wait forever:
// past the ceiling she answers what she has.
{
  const { page } = await open(["heyyy", "haan bol na"]);
  await page.waitForSelector(".msg.her", { timeout: 15_000 });
  await sleep(1200);
  const before = (await hers(page)).length;
  await send(page, "hello");
  const t0 = Date.now();
  let held = -1;
  const watcher = waitForHer(page, before, 30_000).then((ms) => { held = ms; });
  await keepTyping(page, 24_000);
  await watcher;
  ok("interject: she does eventually answer while he is still typing", held < 25_000, `${(held / 1000).toFixed(1)}s`);
  ok("interject: and does it near the 15s ceiling, not before the burst wait", held > 3_000, `${(held / 1000).toFixed(1)}s`);
  ok("interject: within the ceiling plus her delivery beats", held > 0 && held < 19_000, `${(held / 1000).toFixed(2)}s`);
  console.log(`      FELT: interjected ${(held / 1000).toFixed(2)}s after his fragment, while he was still typing (ceiling 15.0s + read/type beats)`);
  await page.close();
}

// ══ 6. RAPID FRAGMENTS — the reported defect, in its plainest form ═════════
// Four messages in a few seconds. The old behaviour answered the first one.
{
  const { page, calls } = await open(["heyyy", "arre ruk ek ek karke bata 😭"]);
  await page.waitForSelector(".msg.her", { timeout: 15_000 });
  await sleep(1200);
  const before = (await hers(page)).length;
  const t0 = Date.now();
  for (const f of ["oye", "sun na", "kal ka plan", "cancel ho gaya yaar"]) {
    await send(page, f, 15);
    await sleep(350);
  }
  const replyMs = await waitForHer(page, before, 15_000);
  await sleep(2500);
  const after = await hers(page);
  ok("rapid: ONE reply to four fragments", after.length === before + 1, JSON.stringify(after.slice(before)));
  ok("rapid: ONE model call", calls.length === 2, `${calls.length} incl. opener`);
  const turn = lastUserTurn(calls[1]);
  ok("rapid: all four fragments in one user turn",
    ["oye", "sun na", "kal ka plan", "cancel ho gaya"].every((f) => turn.includes(f)), turn.replace(/\n/g, " ⏎ "));
  console.log(`      FELT: four fragments over ${((Date.now() - t0 - replyMs) / 1000).toFixed(1)}s, one reply ${(replyMs / 1000).toFixed(2)}s after the last`);
  await page.close();
}

// ══ 7. CORRECTION MID-BURST ════════════════════════════════════════════════
// "wait no i meant" — she must answer the CORRECTED version, which means she
// has to have both, in order, in one turn.
{
  const { page, calls } = await open(["heyyy", "parso theek h, kal main free bhi nahi thi"]);
  await page.waitForSelector(".msg.her", { timeout: 15_000 });
  await sleep(1200);
  const before = (await hers(page)).length;
  await send(page, "chalo kal milte hai", 15);
  await sleep(300);
  await send(page, "wait no", 15);
  await sleep(300);
  await send(page, "parso, kal shoot h mera", 15);
  const replyMs = await waitForHer(page, before, 15_000);
  await sleep(2000);
  ok("correction: ONE reply to the corrected burst", (await hers(page)).length === before + 1);
  ok("correction: ONE model call", calls.length === 2, `${calls.length} incl. opener`);
  const turn = lastUserTurn(calls[1]);
  ok("correction: the retraction and the correction are both present, in order",
    turn.indexOf("kal milte hai") < turn.indexOf("wait no") && turn.indexOf("wait no") < turn.indexOf("parso"),
    turn.replace(/\n/g, " ⏎ "));
  console.log(`      FELT: replied ${(replyMs / 1000).toFixed(2)}s after the correction`);
  await page.close();
}

// ══ 8. A BURST LANDING DURING HER PROACTIVE OPENER ═════════════════════════
// The chat is brand new and she is mid-opener. He does not wait.
{
  const { page, calls } = await open(
    (i) => (i === 0 ? "heyyy kaisa chal raha h sab" : "arre haan dono padh liye"),
    { delayMs: 2500 },
  );
  await sleep(600);
  await send(page, "hi", 15);
  await sleep(400);
  await send(page, "kaam se bore ho gaya hu", 15);
  await sleep(12_000);
  const after = await hers(page);
  ok("opener-burst: the opener still arrived", after.some((t) => t.includes("kaisa chal raha")), JSON.stringify(after));
  ok("opener-burst: and she answered the burst, once", after.length === 2, JSON.stringify(after));
  ok("opener-burst: two model calls", calls.length === 2, `${calls.length}`);
  // his two messages CROSSED her opener, so the record is me/me/her and the
  // merged user turn sits before her opener rather than after it — the model
  // still gets both, in one turn, which is the claim that matters.
  const whole = JSON.stringify(calls[1].messages);
  ok("opener-burst: both his messages reach the model", whole.includes("hi") && whole.includes("bore ho gaya"), whole.slice(-300));
  ok("opener-burst: his two messages are ONE merged user turn",
    calls[1].messages.some((t) => t.role === "user" && /hi\n\[[^\]]*\] kaam se bore/.test(String(t.content))),
    whole.slice(0, 300));
  await page.close();
}

// ══ 9. A BURST RIGHT AFTER RELOAD ══════════════════════════════════════════
// No rhythm in memory beyond what is persisted; the first thing that happens
// on the fresh screen is two messages.
{
  const seeded = {
    messages: [
      { id: "s1", from: "her", kind: "text", text: "heyy", at: Date.now() - 300_000 },
      { id: "s2", from: "me", kind: "text", text: "hi", at: Date.now() - 290_000, status: "read" },
    ],
  };
  const { page, calls } = await open(["arre dono cheezein sun li"], { state: seeded });
  await sleep(1200);
  const before = (await hers(page)).length;
  await send(page, "wapas aa gaya", 15);
  await sleep(400);
  await send(page, "aur kaam khatam", 15);
  const replyMs = await waitForHer(page, before, 15_000);
  await sleep(2000);
  ok("reload-burst: ONE reply", (await hers(page)).length === before + 1);
  ok("reload-burst: ONE model call, no opener (the thread is not empty)", calls.length === 1, `${calls.length}`);
  ok("reload-burst: no re-greeting after reload",
    !/^(hey|hi|hello)\b/i.test((await hers(page))[before]), (await hers(page))[before]);
  console.log(`      FELT: replied ${(replyMs / 1000).toFixed(2)}s after the second message`);
  await page.close();
}

await browser.close();
console.log(fails ? `\n${fails} FAILURES` : "\nALL PASS");
process.exit(fails ? 1 : 0);
