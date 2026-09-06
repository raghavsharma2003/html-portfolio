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
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHmac } from "node:crypto";
import { startHarness, setNetworkRemap } from "./harness.mjs";
import { launchRehearsalBrowser } from "./browser.mjs";
import { startFakeWaCloudApiServer } from "./stubs/fake-wa-cloud-api-server.mjs";
import { startFakeTgBotApiServer } from "./stubs/fake-tg-bot-api-server.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");

// WS-R109. The receipts step's own three real modules — `api/_payments.js`
// (`setRoomPrice`/`startFollowerSubscription`/`applyWebhook`, every one
// function-level DI, `db` passed as an explicit first argument rather than
// through the `./_db.js` redirect, `evals/room-doors/run.mjs`'s own §4
// precedent for this exact call shape), the fake payments provider
// (`signWebhookForTest`, the SAME fixture twin that suite's own webhook
// cases sign against — never a real Razorpay call), and `OWNER`/`REPLICA_ID`
// (the fixture's own owner identity, needed to set a price on the Room this
// walk's follower already joined).
const paymentsModule = await import(pathToFileURL(join(ROOT, "api/_payments.js")).href);
const { setRoomPrice, startFollowerSubscription, applyWebhook } = paymentsModule;
const FAKE_PROVIDER = await import(pathToFileURL(join(ROOT, "api/_payments/providers/fake.js")).href);
const { OWNER, REPLICA_ID } = await import(pathToFileURL(join(ROOT, "evals/room-doors/fixtures.mjs")).href);

// WS-R119. The readable export's own manifest completeness — the SAME REAL
// `roomExportManifest` `api/room.js`'s own `format: "html"` branch calls
// before ever building the page, driven here OFFLINE (no `db`) with
// `evals/room-export/run.mjs`'s own `FULL_DEPS` shape so this walk knows,
// independent of the DOM, exactly how many `<h2>` sections the popup MUST
// carry.
const roomSurfaceModule = await import(pathToFileURL(join(ROOT, "api/_room-surface.js")).href);
const { roomExportManifest } = roomSurfaceModule;
const { PERSON_TABLES } = await import(pathToFileURL(join(ROOT, "api/memory.js")).href);
const EXPORT_MANIFEST = await roomExportManifest({ personTables: async () => PERSON_TABLES, tableApplied: async () => true });

// WS-R119. The WhatsApp join rehearsal's own Meta-shaped signer —
// `api/whatsapp.js::signatureOk`'s own algorithm restated (never imported:
// that file's own module-level `APP_SECRET` const is baked in at import
// time, `harness.mjs`'s own header on why, so this walk signs against the
// SAME fixture secret `harness.mjs` sets there, `WHATSAPP_APP_SECRET`).
function signMetaWebhook(rawBody, secret) {
  return `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
}
const WHATSAPP_APP_SECRET = "w".repeat(40); // harness.mjs's own fixture default, restated

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
    aboutHeading: "What this AI knows about you",
    pushEnable: "Allow check-ins on this phone",
    openReadable: "Open a readable copy",
    forgetHeadingReadable: "Asking to be forgotten",
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
    aboutHeading: "यह AI आपके बारे में क्या जानता है",
    pushEnable: "इस फ़ोन पर चेक-इन की अनुमति दें",
    openReadable: "पढ़ने लायक कॉपी खोलें",
    forgetHeadingReadable: "भुला देने के लिए कहना",
  },
};

/**
 * WS-R109. A page-level fake `PushManager`, installed BEFORE any script on
 * the page runs (`context.addInitScript`). A real `pushManager.subscribe()`
 * call in Chromium reaches a real push service over the real internet — a
 * network call this harness's own guard (`evals/rehearsal/harness.mjs`) and
 * `ws-common.md`'s own "no network beyond 127.0.0.1" law both forbid, and
 * the reason `AccountPage.tsx`'s own push-enable control cannot be rehearsed
 * against the REAL browser Push API at all. This fake replaces
 * `navigator.serviceWorker.register`/`getRegistration`/`ready` entirely
 * (never the real `/room-sw.js` mechanics — the point is that nothing here
 * reaches a real service, not that the fake is layered under a real
 * registration), so `togglePush()`'s own call shape —
 * `register("/room-sw.js")` -> `ready` -> `pushManager.getSubscription()` /
 * `.subscribe(...)` / `.getKey(...)` -> `pushSubscribe(session, endpoint,
 * p256dh, auth256)` (the REAL `api/room.js` `push_subscribe` op, unfaked) —
 * runs unmodified against a fake service worker registration and a real
 * server-side write.
 */
function fakePushInitScript() {
  window.__rehearsalPushState = { subscription: null, counter: 0 };
  const state = window.__rehearsalPushState;
  const fakeRegistration = {
    pushManager: {
      getSubscription: async () => state.subscription,
      subscribe: async () => {
        state.counter += 1;
        state.subscription = {
          endpoint: `https://fake-push.rehearsal.internal/ep/${state.counter}`,
          getKey: (name) => {
            const bytes = new Uint8Array(name === "p256dh" ? 65 : 16).fill(name === "p256dh" ? 4 : 9);
            return bytes.buffer;
          },
          unsubscribe: async () => { state.subscription = null; return true; },
        };
        return state.subscription;
      },
    },
  };
  navigator.serviceWorker.register = async () => fakeRegistration;
  navigator.serviceWorker.getRegistration = async () => fakeRegistration;
  Object.defineProperty(navigator.serviceWorker, "ready", {
    configurable: true,
    get: () => Promise.resolve(fakeRegistration),
  });
  if (window.Notification) window.Notification.requestPermission = async () => "granted";
}

/**
 * Steps a fixture-authenticated browser page all the way from a fresh
 * `/r/<slug>` visit to a joined, remembering follower with an open thread.
 * Shared by the primary follower AND the referred second follower — the
 * exact same real screens, the exact same real clicks.
 */
/**
 * WS-R109. Opens whatever `/r/<slug>/about` link `linkSelector` names, in a
 * SEPARATE page of the SAME context (never navigating `page` itself away —
 * the caller's own screen state, mid-join or mid-account-page, must survive
 * this check untouched), and returns its `<h1>` text. Closes the tab before
 * returning, `follower.mjs`'s own `refPage`/`selfRefPage` precedent for a
 * scratch tab that exists only to prove one thing.
 */
async function checkAboutLink(page, context, baseUrl, linkSelector) {
  const href = await page.locator(linkSelector).getAttribute("href");
  const aboutPage = await context.newPage();
  await aboutPage.goto(`${baseUrl}${href}`, { waitUntil: "networkidle" });
  const heading = await aboutPage.locator("h1").first().innerText().catch(() => "");
  await aboutPage.close();
  return { href, heading };
}

async function joinFresh(page, baseUrl, slug, { qs = "?via=search", locale = "en", checkAbout = false } = {}) {
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
  // WS-R109 law 2: `/r/<slug>/about`, opened from the join screen — the
  // taste screen's own "Join to keep talking" transitions to `.room-join`
  // (the disclosure, the age checkbox, the memory question), which is where
  // the about link actually lives (`RoomApp.tsx`'s own `.room-about-link`,
  // WS-R97) — not on the taste screen itself, found the hard way (a 30s
  // timeout against the wrong screen) rather than assumed. Checked before
  // ever answering the memory question below. A SEPARATE tab, never `page`
  // itself, so the join screen's own state is untouched.
  if (checkAbout) {
    await page.waitForSelector(".room-join", { timeout: 10_000 });
    const about = await checkAboutLink(page, page.context(), baseUrl, ".room-about-link");
    ok(`joinFresh(${locale}): the about link from the join screen opens a real /r/<slug>/about page in ${locale}`,
      about.heading === c.aboutHeading, JSON.stringify(about));
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
  const { url: baseUrl, state, db, followerBearer, followerPerson } = harness;
  const c = COPY[locale];
  const qs = "?via=search";

  // WS-R122. `api/room.js`'s own `op === "export"`/`"forget"` key their
  // 3-per-minute bucket (`allow(authUserId, "room_<op>_user", 3)`) on the
  // resolved AUTH USER ID — and both locale gates of one `--full` run share
  // the SAME Node process, so the SAME `api/_ratelimit.js` module singleton
  // (`context/rejected.md#ws-r119-whatsapp-chat-export-rate-bucket-shared-
  // across-full-locale-gates`: 2 export calls per gate x 2 gates = 4 against
  // a cap of 3, all landing on `followerBearer.A`'s bucket because this
  // function always used `.A` as "the" primary follower regardless of
  // locale). WS-R109 already solved the identical shape for the IP-keyed
  // doors with a distinct `x-real-ip` per gate; there is no header for an
  // auth-user-keyed door, so this is the auth-identity equivalent — which of
  // the two known fixture identities plays "the primary follower" (the one
  // whose export/forget bucket this walk actually spends) SWAPS between
  // gates, so `en`'s two export calls land on A's bucket and `hi`'s land on
  // B's: two buckets, three-per-minute EACH, the real limit never widened.
  const primaryBearer = gate === "hi" ? followerBearer.B : followerBearer.A;
  const primaryPerson = gate === "hi" ? followerPerson.B : followerPerson.A;
  const referredBearer = gate === "hi" ? followerBearer.A : followerBearer.B;
  const referredPerson = gate === "hi" ? followerPerson.A : followerPerson.B;

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
  await context.addInitScript(fixtureAuthScript(primaryBearer));
  await context.addInitScript(fakePushInitScript);
  await context.grantPermissions(["clipboard-read", "clipboard-write", "notifications"], { origin: baseUrl });
  const page = await context.newPage();
  const primarySession = await joinFresh(page, baseUrl, "anjali", { qs, locale, checkAbout: true });
  ok(`${gate}: the join op returned a real session token`, primarySession.length > 20);
  const followerRow = () => state.followers.find((f) => f.person_id === primaryPerson);
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
  const threadExists = state.threads.some((t) => t.title === "physics" && t.person_id === primaryPerson);
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
      (other === "hi" ? /[ऀ-ॿ]/.test(disclosureOther) : !/[ऀ-ॿ]/.test(disclosureOther)),
    JSON.stringify({ disclosureBefore, disclosureOther }));

  await page.locator(`.room-account .room-lang-switch button[lang="${locale}"]`).click();
  await page.waitForFunction(
    (prev) => (document.querySelector(".room-account .room-card") || {}).innerText?.trim() === prev,
    disclosureBefore,
    { timeout: 10_000 },
  );
  ok(`${gate}: switching back to ${locale} restores the original disclosure`, true);

  // WS-R109 law 2: `/r/<slug>/about`, opened a SECOND time from the account
  // page itself (`AccountPage.tsx`'s own `.room-about-link`, WS-R97) — the
  // same real page a stranger read before joining, still reachable once a
  // follower has settled in.
  const aboutFromAccount = await checkAboutLink(page, context, baseUrl, ".room-account .room-about-link");
  ok(`${gate}: the about link from the account page opens the same real /r/<slug>/about page in ${locale}`,
    aboutFromAccount.heading === c.aboutHeading, JSON.stringify(aboutFromAccount));

  // WS-R109 law 2: a push subscription through the account page's own real
  // control (`togglePush()`), over the page-level fake `PushManager`
  // (`fakePushInitScript`, this file's own header) — no real network, a
  // real `push_subscribe` write through the real `/api/room` door.
  const pushToggle = page.locator(".room-checkins-push:not(.room-checkins-wa):not(.room-checkins-tg)");
  ok(`${gate}: the push-enable control renders (ROOM_PUSH_VAPID_PUBLIC is set on this harness)`,
    await pushToggle.count() === 1);
  const [pushSubscribeResponse] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().endsWith("/api/room") && r.request().postDataJSON()?.op === "push_subscribe",
      { timeout: 10_000 },
    ),
    pushToggle.getByRole("button", { name: c.pushEnable }).click(),
  ]);
  const pushSubscribeBody = await pushSubscribeResponse.json().catch(() => ({}));
  ok(`${gate}: the real push_subscribe op returns 200 with a subscription id`,
    pushSubscribeResponse.status() === 200 && typeof pushSubscribeBody.subscription_id === "string",
    JSON.stringify(pushSubscribeBody));
  ok(`${gate}: the fixture's own vy_room_push_sub row was written by the real op`,
    state.roomPushSubs.some((s) => s.person_id === primaryPerson
      && s.endpoint === "https://fake-push.rehearsal.internal/ep/1"));

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
  await page.locator(".room-account .room-actions").last().getByRole("button", { name: c.close, exact: true }).click();
  await page.waitForSelector(".room-account", { state: "detached", timeout: 10_000 });

  // ── a second browser context opens the referral link and joins ─────────
  const refContext = await browser.newContext({ extraHTTPHeaders: { "x-real-ip": `10.94.${gateOffset + 3}.1` } });
  await refContext.addInitScript(fixtureAuthScript(referredBearer));
  const refPage = await refContext.newPage();
  const referralsBefore = state.referrals.length;
  await joinFresh(refPage, baseUrl, "anjali", { qs: referralPath.slice(referralPath.indexOf("?")), locale: "en" });
  ok(`${gate}: the referred follower's own row was written`,
    state.followers.some((f) => f.person_id === referredPerson));
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
  // must fail. The primary follower's OWN session, presented with the
  // REFERRED follower's OWN bearer — the second, independent layer
  // `export`/`forget` require (`api/room.js`'s own header: "a stolen session
  // alone cannot download or destroy a follower's history"). This call
  // itself still spends one hit of the REFERRED identity's own
  // `room_export_user` bucket (the rate-limit check runs before the mismatch
  // check in `api/room.js`) — accounted for in this file's own header on
  // `primaryBearer`/`referredBearer` above: across both gates every identity
  // makes at most 3 `op:"export"` calls total (2 real + this one negative
  // control, or vice versa), never 4.
  const crossRead = await page.evaluate(
    async ({ session, otherBearer }) => {
      const r = await fetch("/api/room", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${otherBearer}` },
        body: JSON.stringify({ op: "export", session }),
      });
      return { status: r.status, body: await r.json().catch(() => ({})) };
    },
    { session: primarySession, otherBearer: referredBearer },
  );
  ok(`${gate}: exporting the primary follower's session with the referred follower's bearer is refused (403 room_session_mismatch)`,
    crossRead.status === 403 && crossRead.body.error === "room_session_mismatch", JSON.stringify(crossRead));

  // ── the sessionWorked offer state, after a session that worked (WS-R109
  //    law 3, driven here since it rides on a real `roomSay` turn — the
  //    creator walk's own header states it never drives one) — fixture
  //    rows for the two clauses a real conversation cannot reach in this
  //    gate's own 30-second budget (a thread genuinely continued from an
  //    earlier CALENDAR day, and a near-cap month), the real THIRD clause
  //    (four-plus messages in one 30-minute session) driven for real by
  //    the messages already sent this walk plus one more. BEFORE the
  //    receipts step below on purpose: `sessionWorked`'s own first clause
  //    is `tier = 'free'`, and the receipts step's own webhook flips this
  //    follower to paid. ────────────────────────────────────────────────
  // `roomThreadDevice(roomId, personId, threadId)` folds the thread id into
  // the memory device id (`api/_room-surface.js`'s own derivation), so the
  // THREE turns `sayThree` already sent (to the general thread, before
  // "physics" existed) sit in a DIFFERENT session lane entirely — found by
  // running this walk for real and reading `sessionWorked`'s own `null`
  // offer, not assumed. Four fresh turns on the "physics" thread itself is
  // what a real >=4-message session on THIS thread actually takes.
  const physicsThread = state.threads.find((t) => t.title === "physics" && t.person_id === primaryPerson);
  physicsThread.created_at = new Date(Date.now() - 2 * 86_400_000).toISOString();
  followerRow().month_message_count = Math.max(followerRow().month_message_count, 16);
  await page.locator(".room-rail button", { hasText: "physics" }).click();
  let sayBody = {};
  for (const text of ["does this apply to inclined planes too?", "and what about friction there?", "one more example, please", "got it, thank you"]) {
    const [sayResponse] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().endsWith("/api/room") && r.request().postDataJSON()?.op === "say",
        { timeout: 15_000 },
      ),
      (async () => {
        await page.locator(".room-composer textarea").fill(text);
        await page.locator(".room-send").click();
      })(),
    ]);
    sayBody = await sayResponse.json().catch(() => ({}));
  }
  ok(`${gate}: a session that worked carries the real offer on the reply`,
    sayBody?.offer?.reason === "session_worked", JSON.stringify(sayBody?.offer));
  await page.waitForFunction(
    () => document.body.innerText.includes("That felt like a real conversation")
      || document.body.innerText.includes("असली बातचीत"),
    null,
    { timeout: 10_000 },
  ).catch(() => {});
  ok(`${gate}: the Room's own offer card renders on screen after the offer-bearing reply`,
    await page.getByText(/felt like a real conversation|असली बातचीत/).count() > 0);

  // ── receipts, after a fake landed charge (WS-R109 law 2) ──────────────────
  // A real charge, landed through the REAL webhook-apply function and the
  // fake payments provider's own signing twin — never a seeded
  // `state.receipts` row, `evals/room-doors/run.mjs`'s own §4 precedent for
  // the call shape, driven here for the first time against a follower who
  // ALREADY exists through the real join above rather than a fresh fixture
  // follower built just for this suite.
  await setRoomPrice(db, OWNER, REPLICA_ID, 349);
  // `env` REPLACES `process.env` for this call (`readRoomSession`'s own
  // `deps.env` seam, `_room-surface.js#sessionSecret`), never merges with
  // it — found the hard way (a `room_unconfigured` throw, `ROOM_SESSION_
  // SECRET` missing from a hand-built env object) — so `...process.env` is
  // spread first and `PAYMENTS_PROVIDER` only overrides the one key this
  // call actually needs to change.
  const started = await startFollowerSubscription(db, { session: primarySession }, {
    env: { ...process.env, PAYMENTS_PROVIDER: "fake" }, secrets: { webhookSecret: "rehearsal-wh-secret" },
  });
  const chargeBody = Buffer.from(JSON.stringify({
    event: "subscription.charged",
    payload: {
      subscription: { entity: { id: started.provider_subscription_ref, current_start: Math.floor(Date.now() / 1000), current_end: Math.floor(Date.now() / 1000) + 30 * 86_400 } },
      payment: { entity: { amount: 34900 } },
    },
  }));
  const chargeSig = FAKE_PROVIDER.signWebhookForTest(chargeBody, "rehearsal-wh-secret");
  const applied = await applyWebhook(db, { rawBody: chargeBody, signatureHeader: chargeSig, eventRef: `evt_rehearsal_${gate}_1` }, {
    env: { ...process.env, PAYMENTS_PROVIDER: "fake", PAYMENTS_FAKE_WEBHOOK_SECRET: "rehearsal-wh-secret" },
  });
  ok(`${gate}: the fake landed charge applies for real (a NEW split, not a replay)`,
    applied.applied === true && applied.replay === false, JSON.stringify(applied));
  ok(`${gate}: the real webhook apply issued a real receipt`, typeof applied.receipt_id === "string" && applied.receipt_id.length > 0);

  // Read the receipts list and open one receipt's own print HTML, through
  // the account page's real controls — the follower is now a PAID tier
  // (the webhook's own tier flip), so the account page is re-opened to see
  // the section render with a real row rather than the empty state.
  await page.getByRole("button", { name: c.accountOpen }).click();
  await page.waitForSelector(".room-account", { timeout: 10_000 });
  const receiptRow = page.locator(".room-checkins-list .room-checkins-row").first();
  await receiptRow.waitFor({ timeout: 10_000 });
  ok(`${gate}: the receipts list shows a real row after the fake landed charge`, await receiptRow.count() === 1);
  const [printPopup] = await Promise.all([
    context.waitForEvent("page", { timeout: 10_000 }),
    receiptRow.getByRole("button").click(),
  ]);
  // `printReceipt()` (AccountPage.tsx) opens the popup with `window.open("",
  // "_blank")` (no URL, so `waitForLoadState` alone can resolve before the
  // fetched HTML is actually `document.write()`-ten into it) THEN writes
  // the fetched HTML in — polling the popup's own body text is what makes
  // this wait honest rather than a race.
  await printPopup.waitForLoadState("load");
  await printPopup.waitForFunction(() => document.body && document.body.innerText.trim().length > 0, null, { timeout: 10_000 }).catch(() => {});
  const printText = await printPopup.locator("body").innerText().catch(() => "");
  ok(`${gate}: the receipt's own print HTML opened in a real new window and names a real amount`,
    /349|₹349/.test(printText), printText.slice(0, 200));
  await printPopup.close();
  await page.locator(".room-account .room-actions").last().getByRole("button", { name: c.close, exact: true }).click();
  await page.waitForSelector(".room-account", { state: "detached", timeout: 10_000 });

  // ── readable export (WS-R108, now driven for real) — "Open a readable
  //    copy" clicked on the real account page; the popup's own document
  //    (`window.open("","_blank")` then `document.write`, `printReceipt`'s
  //    own shape one control over) read for real: one `<h2>` per table this
  //    follower's own export actually carries. `roomExportManifest()` names
  //    every table `roomExport` can EVER reach (47) but `roomExport` itself
  //    omits a table with zero rows entirely (`if (rows.length) tables[t
  //    .table] = rows`, `api/_room-surface.js`'s own code) — so the real
  //    expected count is read straight off the SAME real response's own
  //    bytes (`readableResponse.text()`, below), never the full manifest
  //    length or a second, separately-timed call (found the hard way: the
  //    first version of this walk asserted against `EXPORT_MANIFEST.length`
  //    and failed honestly against the real door, 3 real tables against 47
  //    possible).
  //
  //    FIXED for `--full` (WS-R122, `context/rejected.md#ws-r119-whatsapp-
  //    chat-export-rate-bucket-shared-across-full-locale-gates`): `api/
  //    room.js`'s own `op === "export"` shares ONE rate bucket
  //    (`room_export_user`, `allow(authUserId, ...,3)`) with the "Download
  //    everything" step further down, keyed on the AUTH USER ID — this
  //    function's own `primaryBearer` (this file's header) now differs
  //    between gates, so the en gate's two export calls land on one
  //    identity's bucket and the hi gate's land on the OTHER's, never
  //    sharing one bucket across 4 calls against a 3-per-minute cap. ───────
  await page.getByRole("button", { name: c.accountOpen }).click();
  await page.waitForSelector(".room-account", { timeout: 10_000 });
  const [readablePopup, readableResponse] = await Promise.all([
    context.waitForEvent("page", { timeout: 10_000 }),
    page.waitForResponse(
      (r) => r.url().endsWith("/api/room") && r.request().postDataJSON()?.op === "export"
        && r.request().postDataJSON()?.format === "html",
      { timeout: 10_000 },
    ),
    page.getByRole("button", { name: c.openReadable }).click(),
  ]);
  ok(`${gate}: the readable export's own real request returns 200`, readableResponse.status() === 200);
  const readableResponseText = await readableResponse.text();
  const serverH2Count = (readableResponseText.match(/<h2>/g) || []).length;
  await readablePopup.waitForLoadState("load");
  await readablePopup.waitForFunction(
    () => document.body && document.body.innerText.trim().length > 0, null, { timeout: 10_000 },
  ).catch(() => {});
  ok(`${gate}: the readable export's own document lang matches the follower's chosen locale`,
    await readablePopup.evaluate(() => document.documentElement.lang) === locale);
  const h1Text = await readablePopup.locator("h1").first().innerText().catch(() => "");
  ok(`${gate}: the readable export's own heading names the AI`, h1Text.includes("AI"), h1Text);
  const h2Count = await readablePopup.locator("h2").count();
  // Compared against the SAME real response's own bytes (`readableResponse.text()`,
  // captured off the wire before the popup ever parsed it), never a second,
  // separately-timed `roomExport` call: two independent reads of live state
  // a few hundred milliseconds apart could legitimately disagree (a push
  // subscription or a session touch landing in between), which is exactly
  // what the first version of this check tripped over — found by running it
  // for real, not assumed. This instead proves the popup renders EXACTLY
  // what the server sent, and that the server sent a non-trivial, bounded
  // count of the possible ${EXPORT_MANIFEST.length} manifest tables.
  ok(`${gate}: the readable export carries one heading per table the real response actually holds (server sent ${serverH2Count}, popup rendered ${h2Count})`,
    h2Count === serverH2Count && h2Count > 0 && h2Count <= EXPORT_MANIFEST.length);
  const readableBodyText = await readablePopup.locator("body").innerText().catch(() => "");
  ok(`${gate}: the readable export's own "asking to be forgotten" section renders in ${locale}`,
    readableBodyText.includes(c.forgetHeadingReadable));
  await readablePopup.close();
  await page.locator(".room-account .room-actions").last().getByRole("button", { name: c.close, exact: true }).click();
  await page.waitForSelector(".room-account", { state: "detached", timeout: 10_000 });

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
    assertFollowerFullyForgotten(state, primaryPerson, "real forget"));

  // NEGATIVE CONTROL (law 3, restated for forget): the completeness check
  // itself must be load-bearing, not vacuous — proven by mutating a COPY of
  // the (already-forgotten) state to reinsert a stray row and confirming
  // the SAME check now reports failure.
  const mutated = { ...state, followers: [...state.followers, { person_id: primaryPerson, stray: true }] };
  ok(`${gate}: NEGATIVE CONTROL — the forget-completeness check fails when a row is deliberately left behind`,
    assertFollowerFullyForgotten(mutated, primaryPerson, "mutated") === false);

  await context.close();
}

// ═════════════════════════════════════════════════════════════════════════
// WS-R119 (wave seventeen, third pass). THE WHATSAPP JOIN — Meta-shaped
// webhook payloads, signed with `WHATSAPP_APP_SECRET` exactly as Meta signs
// a real delivery, POSTed to the REAL `api/room-wa.js` door
// (`ROOM_WHATSAPP_CHAT=1`, `harness.mjs`'s own env default). Outbound calls
// (`sendSessionMessage`'s own `fetch` to `graph.facebook.com`) are captured
// by a fake Cloud API server on 127.0.0.1, reached through `harness.mjs`'s
// own `setNetworkRemap` — never a real Meta call. Run once, on the "en"
// gate only: the real flow is locale-invariant server-side (`handleJoin`'s
// own header: "every card here is 'en'", the same limitation
// `joinInstructionCard` states), so a second run under `--full` would only
// repeat the same assertions against the SAME hard-coded locale, not add
// coverage — named here rather than silently doubled.
// ═════════════════════════════════════════════════════════════════════════
async function runWhatsappRehearsal(harness, gate) {
  const { url: baseUrl, state } = harness;
  const cloudApi = await startFakeWaCloudApiServer();
  setNetworkRemap({ "https://graph.facebook.com": cloudApi.url });
  const phone = "+919876500001";
  const bareFrom = phone.replace(/^\+/, "");
  let seq = 0;
  const nextId = () => `wa-rehearsal-${gate}-${++seq}`;
  const messagePayload = (message) => ({ entry: [{ changes: [{ value: { messages: [message] } }] }] });
  const textPayload = (text) => messagePayload({ from: bareFrom, id: nextId(), type: "text", text: { body: text } });
  const buttonPayload = (buttonId) => messagePayload({
    from: bareFrom, id: nextId(), type: "interactive",
    interactive: { type: "button_reply", button_reply: { id: buttonId } },
  });
  async function postWebhook(payload, { signed = true } = {}) {
    const raw = JSON.stringify(payload);
    const headers = { "content-type": "application/json" };
    if (signed) headers["x-hub-signature-256"] = signMetaWebhook(raw, WHATSAPP_APP_SECRET);
    const r = await fetch(`${baseUrl}/api/room-wa`, { method: "POST", headers, body: raw });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  }

  try {
    console.log(`\n── follower journey (${gate}): WhatsApp join, over a fake Cloud API ──`);
    const joined = await postWebhook(textPayload("join anjali"));
    ok(`${gate}: WhatsApp "join anjali", signed with WHATSAPP_APP_SECRET, is authenticated and handled by the real door`,
      joined.status === 200 && joined.body?.ok === true, JSON.stringify(joined.body));
    const ageCard = cloudApi.sent.find((s) => s.body?.type === "interactive"
      && s.body?.interactive?.action?.buttons?.some((b) => b.reply?.id === "a1:anjali"));
    ok(`${gate}: the real join sent a real age-gate button card through the fake Cloud API`, Boolean(ageCard));

    const agedYes = await postWebhook(buttonPayload("a1:anjali"));
    ok(`${gate}: the age button reply is handled`, agedYes.status === 200 && agedYes.body?.ok === true);
    const memoryCard = cloudApi.sent.find((s) => s.body?.type === "interactive"
      && s.body?.interactive?.action?.buttons?.some((b) => b.reply?.id === "m1:anjali"));
    ok(`${gate}: the age answer sent a real memory-gate button card`, Boolean(memoryCard));

    const joinCallStart = cloudApi.sent.length;
    const memoryYes = await postWebhook(buttonPayload("m1:anjali"));
    ok(`${gate}: the memory button reply completes the join through the real lane`,
      memoryYes.status === 200 && memoryYes.body?.ok === true);
    ok(`${gate}: the real join wrote a real vy_room_follower_whatsapp_chat pointer`,
      (state.waChatPointers || []).some((p) => p.phone_hash && !p.stopped_at));
    const joinedCard = cloudApi.sent.slice(joinCallStart).find((s) => s.body?.type === "text");
    ok(`${gate}: joining sent a real "joined" text card`, Boolean(joinedCard?.body?.text?.body), JSON.stringify(joinedCard?.body));

    // ── one turn through the real lane ─────────────────────────────────
    const turnStart = cloudApi.sent.length;
    const said = await postWebhook(textPayload("why does the block not slide when I push it?"));
    ok(`${gate}: one ordinary WhatsApp message reaches the real roomSay lane`, said.status === 200 && said.body?.ok === true);
    const reply = cloudApi.sent.slice(turnStart).find((s) => s.body?.type === "text");
    ok(`${gate}: the real lane's reply was sent through the fake Cloud API, a real bubble of text`,
      Boolean(reply?.body?.text?.body), JSON.stringify(reply?.body));

    // ── stop ────────────────────────────────────────────────────────────
    const stopStart = cloudApi.sent.length;
    const stopped = await postWebhook(textPayload("stop"));
    ok(`${gate}: "stop" is handled`, stopped.status === 200 && stopped.body?.ok === true);
    const pointerAfterStop = (state.waChatPointers || [])[0];
    ok(`${gate}: "stop" leaves the pointer stopped, never deleted`, Boolean(pointerAfterStop?.stopped_at));
    const stopCard = cloudApi.sent.slice(stopStart).find((s) => s.body?.type === "text");
    ok(`${gate}: "stop" sent a real stopped card`, Boolean(stopCard?.body?.text?.body));

    // NEGATIVE CONTROL: an unsigned payload never reaches the real lane.
    const unsigned = await postWebhook(textPayload("join anjali"), { signed: false });
    ok(`${gate}: NEGATIVE CONTROL — an unsigned WhatsApp webhook is refused before the real door ever dispatches it`,
      unsigned.status === 401 && unsigned.body?.error === "bad signature header", JSON.stringify(unsigned));
  } finally {
    setNetworkRemap({});
    await cloudApi.stop();
  }
}

// ═════════════════════════════════════════════════════════════════════════
// WS-R119 (wave seventeen, third pass). THE TELEGRAM VOICE REPLY — a real
// `/start`, age/memory callbacks and one ordinary message, POSTed to the
// REAL `api/room-tg.js` door (`ROOM_TELEGRAM_WEBHOOK_SECRET`, `harness.mjs`'s
// own env default), outbound calls captured by a fake Bot API server on
// 127.0.0.1 through the SAME `setNetworkRemap` seam. `ROOM_VOICE=1`
// (`harness.mjs`'s own default) and a paid tier (seeded directly on the
// fixture follower row this join just wrote — no in-scope door drives a real
// charge for a SECOND, Telegram-only follower when the web follower's own
// receipts step already proves the real payments lane end to end once per
// gate) are what make `attemptRoomVoiceDelivery` actually attempt a clip.
//
// The voice deps room-tg.js's own `buildRoomVoiceDeps` constructs
// (`createOpenChatterboxPreviewProvider`, `createProductionProtectionAdapters`,
// `readPrivateReplicaObject`) are faked at the module-redirect seam those
// three relative specifiers ARE (`evals/rehearsal/loader.mjs`'s own three
// new entries this wave adds) — never a change to `room-tg.js` itself, and
// never a real Azure call. `authorizeRoomVoice`'s own fifteen-precondition
// CTE (`api/_replica-voice-preview.js::beginOwnedVoicePreview`) is faked the
// same way, for the reason that file's own header states at length: no
// fixture in this repo reproduces those fifteen preconditions, and every
// EXISTING suite that reaches `roomSpeak` injects `deps.authorize` directly
// instead — which the real HTTP door never allows a caller to do.
// ═════════════════════════════════════════════════════════════════════════
async function runTelegramRehearsal(harness, gate) {
  const { url: baseUrl, state } = harness;
  const botApi = await startFakeTgBotApiServer();
  setNetworkRemap({ "https://api.telegram.org": botApi.url });
  const tgUserId = 778800111;
  let seq = 0;
  const nextUpdateId = () => 600000 + (++seq);
  const messageUpdate = (text) => ({
    message: {
      chat: { id: tgUserId, type: "private" },
      from: { id: tgUserId, username: "rehearsal_tg", language_code: "en" },
      text, message_id: seq,
    },
  });
  const callbackUpdate = (data) => ({
    callback_query: {
      id: `cbq-${seq}`,
      from: { id: tgUserId, username: "rehearsal_tg", language_code: "en" },
      message: { chat: { id: tgUserId } },
      data,
    },
  });
  async function postUpdate(update, { secret = "t".repeat(40) } = {}) {
    const headers = { "content-type": "application/json" };
    if (secret) headers["x-telegram-bot-api-secret-token"] = secret;
    const r = await fetch(`${baseUrl}/api/room-tg`, {
      method: "POST", headers, body: JSON.stringify({ update_id: nextUpdateId(), ...update }),
    });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  }
  const replyMarkupOf = (s) => JSON.stringify(s.json?.reply_markup ?? "");

  try {
    console.log(`\n── follower journey (${gate}): Telegram voice reply, over a fake Bot API ──`);
    const started = await postUpdate(messageUpdate("/start anjali"));
    ok(`${gate}: Telegram "/start anjali" is authenticated and handled by the real door`,
      started.status === 200 && started.body?.ok === true, JSON.stringify(started.body));
    const ageMsg = botApi.sent.find((s) => s.method === "sendMessage" && replyMarkupOf(s).includes("a1:anjali"));
    ok(`${gate}: the real /start sent a real age-gate inline keyboard`, Boolean(ageMsg));

    const aged = await postUpdate(callbackUpdate("a1:anjali"));
    ok(`${gate}: the age callback is handled`, aged.status === 200 && aged.body?.ok === true);
    const memMsg = botApi.sent.find((s) => s.method === "sendMessage" && replyMarkupOf(s).includes("m1:anjali"));
    ok(`${gate}: the age answer sent a real memory-gate inline keyboard`, Boolean(memMsg));

    const joinStart = botApi.sent.length;
    const memoried = await postUpdate(callbackUpdate("m1:anjali"));
    ok(`${gate}: the memory callback completes the join through the real lane`,
      memoried.status === 200 && memoried.body?.ok === true);
    ok(`${gate}: the real join wrote a real Telegram channel binding`,
      (state.channelMap || []).some((c) => c.channel === "telegram" && c.channel_ref === String(tgUserId)));
    const joinedMsg = botApi.sent.slice(joinStart).find((s) => s.method === "sendMessage");
    ok(`${gate}: joining sent a real "joined" message`, Boolean(joinedMsg?.json?.text), JSON.stringify(joinedMsg?.json));

    // Paid tier — seeded directly on the row the real join above just wrote,
    // this file's own header states why (out of scope: a second, Telegram-
    // only payments charge). `state.followers` is push-only across this
    // whole suite (`state.referrals[state.referrals.length - 1]`'s own
    // precedent, earlier in this file), so the just-joined row is the last.
    const tgFollower = state.followers[state.followers.length - 1];
    ok(`${gate}: the fixture's own new follower row is this Telegram identity's (sanity, before mutating its tier)`,
      Boolean(tgFollower));
    if (tgFollower) tgFollower.tier = "paid";

    const turnStart = botApi.sent.length;
    const said = await postUpdate(messageUpdate("why does the block not slide when I push it?"));
    ok(`${gate}: one ordinary Telegram message reaches the real roomSay lane`, said.status === 200 && said.body?.ok === true);
    const textReply = botApi.sent.slice(turnStart).find((s) => s.method === "sendMessage");
    ok(`${gate}: the real lane's text reply was sent through the fake Bot API`, Boolean(textReply?.json?.text));
    const voiceReply = botApi.sent.slice(turnStart).find((s) => s.method === "sendVoice");
    ok(`${gate}: the real lane's voice reply (ROOM_VOICE=1, paid tier) called sendVoice with a real multipart body`,
      Boolean(voiceReply) && voiceReply.contentType.startsWith("multipart/form-data")
        && voiceReply.raw.includes('name="chat_id"') && voiceReply.raw.includes('name="voice"')
        && voiceReply.raw.includes("reply.wav"),
      voiceReply ? `content-type=${voiceReply.contentType} bytes=${voiceReply.raw.length}` : "no sendVoice call captured");

    const stopped = await postUpdate(messageUpdate("/stop"));
    ok(`${gate}: "/stop" is handled`, stopped.status === 200 && stopped.body?.ok === true);

    // NEGATIVE CONTROL: a wrong secret never reaches the real lane.
    const wrongSecret = await postUpdate(messageUpdate("hello"), { secret: "wrong-secret" });
    ok(`${gate}: NEGATIVE CONTROL — a wrong Telegram webhook secret is refused before the real door ever dispatches it`,
      wrongSecret.status === 401 && wrongSecret.body?.error === "room_telegram_bad_secret", JSON.stringify(wrongSecret));
  } finally {
    setNetworkRemap({});
    await botApi.stop();
  }
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

  // WS-R119. Wall clocks per step, logged separately: the browser walk (the
  // gate's own 40s budget) is a different cost shape from the two transport
  // rehearsals (plain HTTP, no Chromium page load per step), and folding all
  // three into one number would hide which one grew if a future change made
  // this suite slower.
  const clocks = {};
  try {
    const tBrowser = Date.now();
    await runJourney({ harness, browser, locale: "en", gate: "en" });
    clocks.browserWalkEn = Date.now() - tBrowser;

    const tWa = Date.now();
    await runWhatsappRehearsal(harness, "en");
    clocks.whatsappRehearsal = Date.now() - tWa;

    const tTg = Date.now();
    await runTelegramRehearsal(harness, "en");
    clocks.telegramRehearsal = Date.now() - tTg;

    if (FULL) {
      const harnessHi = await startHarness({ build: false, port: 0 });
      const tBrowserHi = Date.now();
      await runJourney({ harness: harnessHi, browser, locale: "hi", gate: "hi" });
      clocks.browserWalkHi = Date.now() - tBrowserHi;
      await harnessHi.stop();
    }
  } finally {
    await browser.close();
    await harness.stop();
  }

  const wallMs = Date.now() - t0;
  console.log(`\nwall clocks (ms): ${JSON.stringify(clocks)}`);
  console.log(`\n${pass} passed, ${fail} failed, wall clock ${wallMs}ms${FULL ? " (--full: en+hi)" : " (en only; --full adds hi)"}`);
  if (fail) {
    console.log("failures:", failures.join(", "));
  }
  return fail === 0 ? 0 : 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().then((code) => process.exit(code));
}
