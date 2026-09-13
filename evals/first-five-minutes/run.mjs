// WS-R164 (wave twenty-two) — THE FIRST FIVE MINUTES, TEXT ONLY.
//
//   node evals/first-five-minutes/run.mjs
//
// `evals/rehearsal/personal.mjs` (WS-R158) walks the whole personal journey,
// voice recording included; its own "Describe me" step runs BEFORE
// recording only because a pending voice build blocks every other room
// (that file's own header explains why). This suite asks a narrower
// question: what is the fastest real path to a first TEXT reply, with NO
// recording at all — the brief's own law 2, "remove every step that is not
// required for a first text reply" — and it measures that path's own three
// named transitions honestly: landing to sign-in, sign-in to first source,
// first source to a Meet attempt.
//
// ── WHY THIS FILE REUSES `personal.mjs` RATHER THAN A SECOND FIXTURE WORLD ─
//
// `personalDb`'s own matchers (`personal.mjs`'s own `personalPatterns`) are
// hard-won: the storage-writer chain alone cost WS-158 a real failure and a
// fix (`context/rejected.md
// #ws-r158-missing-storage-writer-fixture-denies-a-real-describe-me-save`).
// Rebuilding a second, narrower copy of that fixture world for this suite
// would either miss one of those matchers (a false pass on a shape this
// suite never actually fixtured) or drift from the real one silently as
// `personal.mjs` keeps changing. So this file imports `startServer`,
// `serveLandingPage`, `EMAIL` and `OTP` from `personal.mjs` directly
// (exported for exactly this reason, guarded so importing it does not also
// run ITS OWN walk — `personal.mjs`'s own header at the bottom) and drives
// the SAME real doors through a DIFFERENT, narrower browser walk.
//
// ── WHAT THIS WALK DOES NOT CLAIM ──────────────────────────────────────────
//
// `text_ready` Meet (WS-R161, migration 167, this same wave) may or may not
// be in this tree depending on merge order — this suite does not assume
// either way. The Meet assertion below accepts EITHER a real, honest
// refusal (a runtime capability blocker, never a crash) OR a real,
// successful text reply with the disclosure prefix (once `text_ready`
// lands), and requires the response be ONE of those two honest shapes, not
// a raw 500 or an empty body. This is deliberate: the same suite keeps
// gating correctly on both sides of that merge, rather than becoming a
// stale pass the moment R161 lands or a false failure until it does.
import { pathToFileURL, fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");

let pass = 0;
let fail = 0;
const failures = [];
function ok(name, cond, extra = "") {
  if (cond) { pass++; console.log(`  ok  ${name}${extra ? `   ${extra}` : ""}`); }
  else { fail++; failures.push(name); console.log(`FAIL  ${name}${extra ? `   ${extra}` : ""}`); }
}

const { launchRehearsalBrowser } = await import(pathToFileURL(join(ROOT, "evals/rehearsal/browser.mjs")).href);
{
  const probe = await launchRehearsalBrowser();
  if (!probe.browser) {
    console.log(`SKIP: ${probe.reason} — the release gate runs this walk with a real Chromium`);
    process.exit(0);
  }
  await probe.browser.close();
}

// Importing `personal.mjs` runs ITS OWN top-level setup (the module
// resolution hook, the fixture db, the fake reply, the auth stub) but NOT
// its own walk — its own `isMain` guard skips `main()` for every importer
// but a direct `node evals/rehearsal/personal.mjs` run.
const { startServer, serveLandingPage, EMAIL, OTP } = await import(
  pathToFileURL(join(ROOT, "evals/rehearsal/personal.mjs")).href
);

async function main() {
  const timings = {};
  const { url, state, stop } = await startServer();
  const launched = await launchRehearsalBrowser();
  if (!launched.browser) { await stop(); throw new Error(`chromium launched for the probe above but not for this walk: ${launched.reason}`); }
  const browser = launched.browser;
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    page.on("pageerror", (error) => console.log(`  page error: ${error.message}`));
    if (process.env.RH_DEBUG === "1") {
      page.on("console", (msg) => console.log(`  console.${msg.type()}: ${msg.text()}`));
    }

    // ── LANDING TO SIGN-IN ──────────────────────────────────────────────
    let tStep = Date.now();
    await page.goto(`${url}/vyakti-landing.html`, { waitUntil: "domcontentloaded" });
    const heroCta = page.locator("#loc-en .hero .btn");
    await heroCta.waitFor({ state: "visible", timeout: 20_000 });
    await heroCta.click();
    await page.locator("#studio-email").waitFor({ state: "visible", timeout: 20_000 });
    ok("landing: the real hero click reaches the real personal sign-in, no mode= param", true);
    timings.landingToSignInMs = Date.now() - tStep;

    // ── SIGN-IN, with the wrong-code negative control ────────────────────
    tStep = Date.now();
    await page.locator("#studio-email").fill(EMAIL);
    await page.locator(".auth-card button.primary-button").first().click();
    await page.locator("#studio-code").waitFor({ state: "visible", timeout: 20_000 });

    // NEGATIVE CONTROL — a wrong OTP is refused with a sentence, never a
    // stack (the brief's own law 5 example, restated here as this suite's
    // own control rather than only trusting `personal.mjs`'s copy of it).
    await page.locator("#studio-code").fill("111111");
    await page.locator(".auth-card button.primary-button").last().click();
    const wrongCodeError = page.locator(".inline-error");
    await wrongCodeError.waitFor({ state: "visible", timeout: 20_000 });
    const wrongCodeText = (await wrongCodeError.textContent()) || "";
    const looksLikeAStack = /error:|\bat\s+\S+:\d+:\d+|stack trace/i.test(wrongCodeText);
    ok("NEGATIVE CONTROL — a wrong code is refused with a real sentence, never a stack", wrongCodeText.trim().length > 0 && !looksLikeAStack, `text=${JSON.stringify(wrongCodeText)}`);

    await page.locator("#studio-code").fill(OTP);
    await page.locator(".auth-card button.primary-button").last().click();
    await page.locator(".vx-agreement, .vx-shell").first().waitFor({ state: "visible", timeout: 20_000 });
    ok("sign-in: verify_otp through the real door signed a real session in", true);
    timings.signInMs = Date.now() - tStep;

    // ── AGREEMENT, then Describe me — the FIRST and ONLY source this walk
    //    ever creates. No microphone, no fake device, no recording at all. ─
    tStep = Date.now();
    const checkAll = page.locator("button.vx-check-all");
    if (await checkAll.count()) {
      await checkAll.click();
      await page.getByRole("button", { name: /continue/i }).first().click();
    }
    await page.locator("#context-locker-title, .vx-record-button").first().waitFor({ state: "visible", timeout: 20_000 });
    ok("agreement: accepting created a real replica and granted enrollment consent", state.replicas.length === 1, `replicas=${state.replicas.length}`);
    const rid = state.replicas[0]?.replica_id || "";

    const backToChoices = page.locator("button.vx-back", { hasText: "Back to choices" });
    if (await backToChoices.count()) await backToChoices.click();
    const describeButton = page.locator("button", { hasText: "Describe me" });
    await describeButton.waitFor({ state: "visible", timeout: 20_000 });
    ok("Describe me: reachable with no recording made yet (never gated behind voice)", true);
    await describeButton.click();
    const describeText = page.locator(".vx-describe textarea");
    await describeText.waitFor({ state: "visible", timeout: 10_000 });
    await describeText.fill("I keep my sentences short, I am direct with close friends, and I switch to Hindi when excited.");
    await page.locator("button.vx-button--primary", { hasText: "Add to my context" }).click();
    await page.locator(".vx-describe [role=status]").waitFor({ state: "visible", timeout: 15_000 });
    ok("Describe me: a real context item was saved through the real door, the walk's own first (and only) source", state.contextItems.some((i) => i.replica_id === rid));
    timings.signInToFirstSourceMs = Date.now() - tStep;
    ok("no recording ran in this walk (text-only, by construction)", (state.personalSources || []).every((s) => s.replica_id !== rid || s.kind !== "audio"));

    // ── FIRST SOURCE TO MEET — one real reload, one real conversation
    //    attempt, honest either way (see this file's own header). ─────────
    tStep = Date.now();
    const token = await page.evaluate(() => {
      try { return JSON.parse(localStorage.getItem("meera.state.v1") || "{}")?.auth?.accessToken || ""; } catch { return ""; }
    });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator(".vx-verification, .vx-conversation-switch, #knowledge-menu-title, #context-locker-title, .vx-record-button").first().waitFor({ state: "visible", timeout: 20_000 });
    ok("reload after describing: the real shell renders honestly, never a blank page or a crash", true);

    const dialogueResponse = await fetch(`${url}/api/replica-dialogue`, {
      method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ replica_id: rid, message: "What is one thing you would tell a new follower?" }),
    });
    const dialogueBody = await dialogueResponse.json().catch(() => ({}));
    const honestRefusal = dialogueResponse.status >= 400 && typeof dialogueBody.error === "string" && dialogueBody.error.length > 0;
    const honestReply = dialogueResponse.status === 200 && typeof dialogueBody.reply === "string" && dialogueBody.reply.length > 0;
    ok(
      "Meet attempt: text-only source, one real conversation turn — either an honest refusal naming why, or a real reply, never a crash or a fabricated silence",
      honestRefusal || honestReply,
      `status=${dialogueResponse.status} shape=${honestReply ? "reply" : honestRefusal ? "refusal:" + dialogueBody.error : "UNRECOGNISED:" + JSON.stringify(dialogueBody).slice(0, 200)}`,
    );
    if (honestReply) console.log(`  FINDING: this tree answers a text-only source in Meet (text_ready is live) — reply=${JSON.stringify(dialogueBody.reply).slice(0, 120)}`);
    else console.log(`  FINDING: this tree still refuses a text-only source in Meet (${dialogueBody.error}) — matches context/STATE.md's own open gap until WS-R161 lands.`);

    // NEGATIVE CONTROL — a signed-out call to the same door is refused
    // before any dialogue logic runs, on both sides of the text_ready
    // merge boundary.
    const signedOut = await fetch(`${url}/api/replica-dialogue`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ replica_id: rid, message: "Should never be answered." }),
    });
    ok("NEGATIVE CONTROL — a signed-out call is refused before any dialogue logic runs", signedOut.status === 401);
    timings.firstSourceToMeetMs = Date.now() - tStep;

    console.log(`\nfirst five minutes, text only (ms): ${JSON.stringify(timings)}`);
  } finally {
    await browser.close();
    await stop();
  }
}

await main();

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.log("failed:", failures.join(", "));
  process.exitCode = 1;
}
