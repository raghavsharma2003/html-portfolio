// WS-R94. THE FOLLOWER'S JOURNEY, REHEARSED END TO END, in a real Chromium
// driving the real built Room (`dist/room.html`, `dist/creator-page` output)
// through the real HTTP doors in `harness.mjs` — nothing in this repo has
// ever exercised the whole journey at once before this.
//
//   node evals/rehearsal/follower.mjs           the English walk (gate budget)
//   node evals/rehearsal/follower.mjs --full    + the Hindi walk
//
// Every step below asserts on the real DOM (Playwright locators against the
// real rendered page) AND on the fixture db's own rows (`harness.state`,
// the SAME mutable object the injected `db` reads and writes) — never one
// without the other, `evals/rehearsal/harness.mjs`'s own header restated.
//
// Steps: `/c/<slug>` taste (the static island) -> `/r/<slug>?via=search`
// taste-then-join (age attestation, memory consent) -> say three things ->
// open a thread -> read a citation -> the account page (Hindi, back to
// English, the disclosure, the referral link) -> a SECOND browser context
// opens the referral link and joins (the referral row lands, self-referral
// is refused) -> export -> forget.
import { startHarness } from "./harness.mjs";
import { launchRehearsalBrowser } from "./browser.mjs";

const FULL = process.argv.includes("--full");
const STATE_KEY = "meera.state.v1";

let pass = 0;
let fail = 0;
const failures = [];
function ok(name, cond, extra = "") {
  if (cond) {
    pass++;
    console.log(`  ok  ${name}${extra ? `   ${extra}` : ""}`);
  } else {
    fail++;
    failures.push(name);
    console.log(`FAIL  ${name}${extra ? `   ${extra}` : ""}`);
  }
}

function fixtureAuthScript(uuid) {
  const session = {
    userId: uuid,
    accessToken: uuid,
    refreshToken: "fixture-refresh-token",
    expiresAt: Date.now() + 6 * 60 * 60 * 1000,
  };
  return `window.localStorage.setItem(${JSON.stringify(STATE_KEY)}, ${JSON.stringify(
    JSON.stringify({ auth: session }),
  )});`;
}

const COPY = {
  en: {
    tasteJoin: "Join to keep talking",
    memoryYes: "Yes, remember me",
    threadCreate: "New topic",
    threadSave: "Add",
    whereFrom: "Where did that come from?",
    dataMenuOpen: "Your data",
    accountOpen: "Your settings",
    download: "Download everything it holds about you",
    forget: "Make it forget me",
    forgetConfirm: "Yes, forget me",
    referralCopy: "Copy link",
    referralCopied: "Copied",
    age: "I am 18 or older.",
    close: "Close",
  },
  hi: {
    tasteJoin: "बात जारी रखने के लिए जुड़ें",
    memoryYes: "हां, मुझे याद रखें",
    threadCreate: "नया विषय",
    threadSave: "जोड़ें",
    whereFrom: "यह जानकारी कहां से आई?",
    dataMenuOpen: "आपका डेटा",
    accountOpen: "आपकी सेटिंग्स",
    download: "इसके पास आपके बारे में जो कुछ है वह डाउनलोड करें",
    forget: "इसे मुझे भुला दें",
    forgetConfirm: "हां, मुझे भुला दें",
    referralCopy: "लिंक कॉपी करें",
    referralCopied: "कॉपी हो गया",
    age: "मेरी उम्र 18 साल या उससे ज़्यादा है।",
    close: "बंद करें",
  },
};

/**
 * Steps a fixture-authenticated browser page all the way from a fresh
 * `/r/<slug>` visit to a joined, remembering follower with an open thread.
 * Shared by the primary follower AND the referred second follower — the
 * exact same real screens, the exact same real clicks.
 */
async function joinFresh(page, baseUrl, slug, { qs = "?via=search", locale = "en" } = {}) {
  if (process.env.REHEARSAL_DEBUG) {
    page.on("requestfinished", async (req) => {
      if (req.url().includes("/api/room")) {
        const resp = await req.response();
        console.log("[dbg]", req.postData(), "->", resp && resp.status(), await resp?.text().catch(() => ""));
      }
    });
  }
  await page.goto(`${baseUrl}/r/${slug}${qs}`, { waitUntil: "networkidle" });
  const c = COPY[locale];
  // `/r/<slug>` has no `?lang=` URL param (that is `layoutFixture.tsx`'s
  // own fixture-only flag, not a real Room mechanism) — a signed-out
  // visitor's ONLY route to Hindi is the real language switch in the
  // screen's own header, exactly the control a real person taps. Exactly
  // one `.room-lang-switch` is mounted here (the taste screen, before the
  // account page ever exists to add a second one).
  if (locale === "hi") {
    await page.locator('.room-lang-switch button[lang="hi"]').click();
    await page.waitForFunction(
      () => document.querySelector(".room-lang-switch button[lang=\"hi\"]")?.getAttribute("aria-pressed") === "true",
      null,
      { timeout: 10_000 },
    );
  }
  // The taste screen shows first for anyone not yet joined (WS-R53) — the
  // join control is always present, per that workstream's own law.
  try {
    await page.getByRole("button", { name: c.tasteJoin }).click({ timeout: 10_000 });
  } catch (e) {
    console.log("[joinFresh debug] body:", (await page.locator("body").innerText().catch(() => "")).slice(0, 800));
    throw e;
  }
  await page.locator('input[type="checkbox"]').check();
  // The real `join` op's own response body carries the session — the ONLY
  // honest way to read it back is off the wire, never off React state
  // (which has no DOM mirror), so this captures the exact network response
  // the app itself is about to trust.
  const [response] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().endsWith("/api/room") && r.request().postDataJSON()?.op === "join",
      { timeout: 15_000 },
    ),
    page.getByRole("button", { name: c.memoryYes }).click(),
  ]);
  await page.waitForSelector(".room-composer textarea", { timeout: 15_000 });
  const body = await response.json().catch(() => ({}));
  return body.session || "";
}

async function sayThree(page, texts) {
  for (const text of texts) {
    const before = await page.locator(".room-bubble.from-them").count();
    await page.locator(".room-composer textarea").fill(text);
    await page.locator(".room-send").click();
    await page.waitForFunction(
      (n) => document.querySelectorAll(".room-bubble.from-them").length > n,
      before,
      { timeout: 15_000 },
    );
  }
}

/** The negative control law 3 names directly: "a forget that leaves a row
 *  fails". Runs the SAME completeness check the real assertion below uses,
 *  against a deliberately mutated state carrying a stray leftover follower
 *  row — proves the check bites rather than passing vacuously. */
function assertFollowerFullyForgotten(state, personId, label) {
  const stray = state.followers.some((f) => f.person_id === personId);
  return !stray;
}

async function runJourney({ harness, browser, locale, gate }) {
  const { url: baseUrl, state, followerBearer, followerPerson } = harness;
  const c = COPY[locale];
  const qs = "?via=search";

  // ── /c/<slug>: the taste, through the static island ──────────────────────
  // Distinct synthetic per-visitor IPs (`x-real-ip`, `api/_ratelimit.js`
  // own `ipOf()` header): this harness has no reverse proxy in front of
  // it, so every raw request otherwise carries NO forwarded-for header at
  // all and `ipOf()` collapses every visitor in the WHOLE process (both
  // locale gates share one Node process) onto the single bucket "unknown"
  // — a real deployment never does this (every visitor has a real,
  // distinct IP), so this is restoring realism the harness silently
  // removed, not a workaround for a real limit
  // (`context/rejected.md#ws-94-shared-unknown-ip-bucket-exhausted-the-90-per-minute-room-ip-gate-across-both-locale-gates`).
  const gateOffset = gate === "hi" ? 100 : 0;
  const cContext = await browser.newContext({ extraHTTPHeaders: { "x-real-ip": `10.94.${gateOffset + 1}.1` } });
  const cPage = await cContext.newPage();
  await cPage.goto(`${baseUrl}/c/anjali`, { waitUntil: "networkidle" });
  const tasteForm = cPage.locator("#vy-taste-form");
  ok(`${gate}: /c/anjali serves the taste island`, await tasteForm.count() === 1);
  if (await tasteForm.count()) {
    await cPage.fill("#vy-taste-input", "how do you teach projectile motion?");
    await cPage.click("#vy-taste-submit");
    await cPage.waitForFunction(
      () => document.querySelectorAll(".room-taste-turn").length > 0,
      null,
      { timeout: 15_000 },
    );
    ok(`${gate}: the island's first taste turn answered`, await cPage.locator(".room-taste-turn").count() >= 1);
    // Two more, to the taste ceiling — the island's own `endOfTasteFlow()`.
    for (const q of ["and torque?", "one more, friction?"]) {
      await cPage.fill("#vy-taste-input", q);
      await cPage.click("#vy-taste-submit");
      await cPage.waitForTimeout(400);
    }
    await cPage.waitForFunction(
      () => {
        const join = document.getElementById("vy-taste-join");
        return join && !join.hidden;
      },
      null,
      { timeout: 15_000 },
    );
    ok(`${gate}: the island refuses a fourth taste turn on screen (input hidden, join shown)`,
      await cPage.locator("#vy-taste-input").isHidden());
    // NEGATIVE CONTROL (law 3c): a client that ignores the hidden UI and
    // asks a fourth time anyway is refused BY THE SERVER, not merely by the
    // button being hidden.
    const fourth = await cPage.evaluate(async () => {
      const r = await fetch("/api/room", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ op: "taste", room: "anjali", message: "a fourth question", locale: "en" }),
      });
      return { status: r.status, body: await r.json().catch(() => ({})) };
    });
    ok(`${gate}: a fourth taste turn is refused server-side (429 rate_limited), not merely hidden`,
      fourth.status === 429 && fourth.body.error === "rate_limited", JSON.stringify(fourth));
  }
  await cContext.close();

  // ── /r/<slug>?via=search: join, with age attestation and memory consent ──
  const context = await browser.newContext({ extraHTTPHeaders: { "x-real-ip": `10.94.${gateOffset + 2}.1` } });
  await context.addInitScript(fixtureAuthScript(followerBearer.A));
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: baseUrl });
  const page = await context.newPage();
  const sessionA = await joinFresh(page, baseUrl, "anjali", { qs, locale });
  ok(`${gate}: the join op returned a real session token`, sessionA.length > 20);
  const followerRow = () => state.followers.find((f) => f.person_id === followerPerson.A);
  ok(`${gate}: the join wrote a real follower row (memory consent true)`,
    Boolean(followerRow()?.memory_consent_at));

  // ── say three things ───────────────────────────────────────────────────
  await sayThree(page, [
    "why does the block not slide when I push harder?",
    "so the number in the answer key is the maximum, not the actual?",
    "does the coefficient change if I flip the block?",
  ]);
  ok(`${gate}: three turns landed on the fixture's own counter`,
    (followerRow()?.month_message_count ?? 0) >= 3, `count=${followerRow()?.month_message_count}`);

  // ── read a citation ─────────────────────────────────────────────────────
  // Read HERE, before the thread switch below: the citation button only
  // renders once the CURRENT view has an assistant turn in it
  // (`RoomApp.tsx`'s own `turns.some((t) => t.role === "assistant")`), and a
  // brand-new empty thread has none yet — reading it against the general
  // "Everything" view, where the three turns just landed, is the real
  // screen a follower actually sees the affordance on first.
  const citeButton = page.getByRole("button", { name: c.whereFrom });
  await citeButton.click();
  await page.waitForSelector(".room-cite-answer", { timeout: 10_000 });
  ok(`${gate}: a citation answer rendered`, await page.locator(".room-cite-answer").count() === 1);

  // ── open a thread ───────────────────────────────────────────────────────
  await page.locator(".room-rail button", { hasText: c.threadCreate }).click();
  await page.locator(".room-rail input").fill("physics");
  // Waits on the real `thread` op's own response, not on `[aria-pressed]`
  // appearing — that attribute is already present on the "Everything"
  // button before this click, so it was matching immediately and racing
  // ahead of the actual round trip (found the flaky way, by this exact
  // check failing intermittently against the real fixture).
  await Promise.all([
    page.waitForResponse(
      (r) => r.url().endsWith("/api/room") && r.request().postDataJSON()?.op === "thread",
      { timeout: 10_000 },
    ),
    page.locator(".room-rail button", { hasText: c.threadSave }).click(),
  ]);
  const threadExists = state.threads.some((t) => t.title === "physics" && t.person_id === followerPerson.A);
  ok(`${gate}: the new thread landed in the fixture`, threadExists);

  // ── the account page: switch locale, back, disclosure, referral ────────
  // Relative to whichever locale THIS gate started in — the "en" gate
  // switches en->hi->en, the "hi" gate switches hi->en->hi. Both prove the
  // same real property (the disclosure card re-renders in server-authored
  // text on a real language switch, and switching back restores it) without
  // assuming which direction is "the" direction.
  const other = locale === "hi" ? "en" : "hi";
  const co = COPY[other];
  await page.getByRole("button", { name: c.accountOpen }).click();
  await page.waitForSelector(".room-account", { timeout: 10_000 });
  // Non-empty, not merely present: `.room-card` mounts synchronously with
  // the panel, but a Playwright read racing the very same paint has
  // occasionally caught it between mount and the text commit — poll rather
  // than a single immediate read.
  await page.waitForFunction(
    () => ((document.querySelector(".room-account .room-card") || {}).innerText || "").trim().length > 0,
    null,
    { timeout: 10_000 },
  );
  const disclosureBefore = (await page.locator(".room-account .room-card").innerText()).trim();
  ok(`${gate}: the account page shows the disclosure card`, disclosureBefore.length > 0);

  await page.locator(`.room-account .room-lang-switch button[lang="${other}"]`).click();
  await page.waitForFunction(
    (prevText) => (document.querySelector(".room-account .room-card") || {}).innerText?.trim() !== prevText,
    disclosureBefore,
    { timeout: 10_000 },
  );
  const disclosureOther = (await page.locator(".room-account .room-card").innerText()).trim();
  ok(`${gate}: switching to ${other} re-renders the disclosure in ${other} (server-authored, not stale)`,
    disclosureOther !== disclosureBefore &&
      (other === "hi" ? /[ऀ-ॿ]/.test(disclosureOther) : !/[ऀ-ॿ]/.test(disclosureOther)));

  await page.locator(`.room-account .room-lang-switch button[lang="${locale}"]`).click();
  await page.waitForFunction(
    (prev) => (document.querySelector(".room-account .room-card") || {}).innerText?.trim() === prev,
    disclosureBefore,
    { timeout: 10_000 },
  );
  ok(`${gate}: switching back to ${locale} restores the original disclosure`, true);

  const referralUrlLocator = page.locator(".room-referral-url");
  await referralUrlLocator.waitFor({ timeout: 10_000 });
  const referralPath = (await referralUrlLocator.innerText()).trim().replace(/^https?:\/\/[^/]+/, "");
  ok(`${gate}: the referral card shows a real /r/anjali?via=friend&ref= link`,
    /^\/r\/anjali\?via=friend&ref=[0-9a-f]{64}$/.test(referralPath), referralPath);

  await page.getByRole("button", { name: c.referralCopy }).click();
  await page.waitForSelector(`button:has-text("${c.referralCopied}")`, { timeout: 5_000 });
  const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
  ok(`${gate}: "Copy link" actually wrote the referral URL to the clipboard`,
    clipboardText.endsWith(referralPath));

  // Close the account page — scoped to `.room-account` so it can never
  // match a same-labelled "Close" button belonging to a different dialog,
  // and awaited (not `.catch`-swallowed) so a real failure here is loud
  // rather than silently leaving TWO dialogs mounted for the data-menu step
  // below to trip over.
  await page.locator(".room-account").getByRole("button", { name: c.close, exact: true }).click();
  await page.waitForSelector(".room-account", { state: "detached", timeout: 10_000 });

  // ── a second browser context opens the referral link and joins ─────────
  const refContext = await browser.newContext({ extraHTTPHeaders: { "x-real-ip": `10.94.${gateOffset + 3}.1` } });
  await refContext.addInitScript(fixtureAuthScript(followerBearer.B));
  const refPage = await refContext.newPage();
  const referralsBefore = state.referrals.length;
  await joinFresh(refPage, baseUrl, "anjali", { qs: referralPath.slice(referralPath.indexOf("?")), locale: "en" });
  ok(`${gate}: the referred follower's own row was written`,
    state.followers.some((f) => f.person_id === followerPerson.B));
  ok(`${gate}: exactly one new referral row was credited`,
    state.referrals.length === referralsBefore + 1);
  const referralRow = state.referrals[state.referrals.length - 1];
  ok(`${gate}: the referral row names the ORIGINAL follower's hash, never the new one's`,
    referralRow.referrer_hash === referralPath.match(/ref=([0-9a-f]{64})/)[1]);
  await refContext.close();

  // A repeat visit through the SAME link, by the SAME already-joined
  // follower, mints no second row (`follower.newly_joined` is false on this
  // path — the credit branch never fires at all, `joinRoom`'s own header).
  // This is deliberately NOT the WHERE-clause self-referral guard itself
  // (that needs a genuinely new join through one's own hash, which a real
  // UI can never produce — the link only exists once a follower is already
  // joined) — that guard already has its own unit-level negative control in
  // `evals/room-referrals/run.mjs` ("a struck copy of the write DOES leak a
  // self-referral row"); this rehearsal proves the adjacent, browser-real
  // property instead.
  const selfRefPage = await context.newPage();
  await selfRefPage.goto(`${baseUrl}${referralPath}`, { waitUntil: "networkidle" });
  ok(`${gate}: revisiting one's own referral link (already joined) mints no second referral row`,
    state.referrals.length === referralsBefore + 1);
  await selfRefPage.close();

  // NEGATIVE CONTROL (law 3b): a step that reads another follower's words
  // must fail. Follower A's OWN session, presented with follower B's OWN
  // bearer — the second, independent layer `export`/`forget` require
  // (`api/room.js`'s own header: "a stolen session alone cannot download or
  // destroy a follower's history").
  const crossRead = await page.evaluate(
    async ({ session, otherBearer }) => {
      const r = await fetch("/api/room", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${otherBearer}` },
        body: JSON.stringify({ op: "export", session }),
      });
      return { status: r.status, body: await r.json().catch(() => ({})) };
    },
    { session: sessionA, otherBearer: followerBearer.B },
  );
  ok(`${gate}: exporting follower A's session with follower B's bearer is refused (403 room_session_mismatch)`,
    crossRead.status === 403 && crossRead.body.error === "room_session_mismatch", JSON.stringify(crossRead));

  // ── export ───────────────────────────────────────────────────────────────
  await page.getByRole("button", { name: c.dataMenuOpen }).click();
  await page.waitForSelector(".room-menu", { timeout: 10_000 });
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 15_000 }),
    page.getByRole("button", { name: c.download }).click(),
  ]);
  ok(`${gate}: export triggered a real file download`, download.suggestedFilename() === "your-data.json");

  // ── forget ───────────────────────────────────────────────────────────────
  // Waits on the real `forget` op's own response, not on `.room-fine`
  // appearing — that class is used all over this screen's fine print and
  // was already present before the click, so it matched immediately and
  // raced ahead of the actual delete (found the flaky way, exactly the
  // `.room-rail button[aria-pressed]` defect shape above, a second time).
  await page.getByRole("button", { name: c.forget }).click();
  await Promise.all([
    page.waitForResponse(
      (r) => r.url().endsWith("/api/room") && r.request().postDataJSON()?.op === "forget",
      { timeout: 15_000 },
    ),
    page.getByRole("button", { name: c.forgetConfirm }).click(),
  ]);
  ok(`${gate}: forget removed the real follower row from the fixture`,
    assertFollowerFullyForgotten(state, followerPerson.A, "real forget"));

  // NEGATIVE CONTROL (law 3, restated for forget): the completeness check
  // itself must be load-bearing, not vacuous — proven by mutating a COPY of
  // the (already-forgotten) state to reinsert a stray row and confirming
  // the SAME check now reports failure.
  const mutated = { ...state, followers: [...state.followers, { person_id: followerPerson.A, stray: true }] };
  ok(`${gate}: NEGATIVE CONTROL — the forget-completeness check fails when a row is deliberately left behind`,
    assertFollowerFullyForgotten(mutated, followerPerson.A, "mutated") === false);

  await context.close();
}

export async function main() {
  // The one launch both rehearsals share (`./browser.mjs`): a named binary,
  // else Playwright's full build by channel, else a SKIP by name — probed
  // BEFORE the harness builds `dist/`, so a runner with no browser (the
  // build workflow) spends nothing on a walk it cannot take.
  const launched = await launchRehearsalBrowser();
  if (!launched.browser) {
    console.log(`SKIP: ${launched.reason} — the release gate runs this walk with a real Chromium`);
    return 0;
  }
  const browser = launched.browser;

  const t0 = Date.now();
  const harness = await startHarness({ build: true });
  console.log(`harness up at ${harness.url}`);

  try {
    await runJourney({ harness, browser, locale: "en", gate: "en" });
    if (FULL) {
      const harnessHi = await startHarness({ build: false, port: 0 });
      await runJourney({ harness: harnessHi, browser, locale: "hi", gate: "hi" });
      await harnessHi.stop();
    }
  } finally {
    await browser.close();
    await harness.stop();
  }

  const wallMs = Date.now() - t0;
  console.log(`\n${pass} passed, ${fail} failed, wall clock ${wallMs}ms${FULL ? " (--full: en+hi)" : " (en only; --full adds hi)"}`);
  if (fail) {
    console.log("failures:", failures.join(", "));
  }
  return fail === 0 ? 0 : 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().then((code) => process.exit(code));
}
