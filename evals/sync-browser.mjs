// ── THE PULL, IN A REAL BROWSER, ACROSS TWO DEVICES ───────────────────────
//
// The claim: a second device left open is no longer stale forever. Nothing
// pure can prove it — the whole defect lived in an effect's trigger list, in a
// real tab, against a real server row with a real revision.
//
//   npx vite build
//   npx vite preview --port 4291 --strictPort &
//   node evals/sync-browser.mjs
//
// NOT in evals/run.mjs, and deliberately: it needs a built app and a server on
// a port, the same by-construction exclusion evals/burst-browser.mjs carries.
//
// The two pages are two BROWSER CONTEXTS, not two tabs of one — separate
// localStorage, separate deviceId. That makes them two DEVICES, which is the
// harder case: no `storage` event exists between them, so the only route from
// one to the other is the account row. (The cross-TAB route has its own
// coverage in evals/teardown.mjs and store.ts's own merge.)
//
// /api/account is a real (tiny) server here rather than a stub returning {}:
// it holds one state row with one revision, rejects a stale write with the 409
// the client's merge path is built around, and hands back exactly what a
// client sent. A stub that always says ok would make every assertion below
// vacuous.
import { chromium } from "playwright";

const B = process.env.MEERA_PREVIEW || "http://localhost:4291";
let fails = 0;
const ok = (n, c, e = "") => {
  console.log(`${c ? "ok  " : "FAIL"} ${n}${e ? " — " + e : ""}`);
  if (!c) fails++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });

// ── the account server ────────────────────────────────────────────────────
const server = { state: null, updated_at: null, saves: 0, loads: 0, conflicts: 0 };
const rev = () => new Date().toISOString() + ":" + server.saves;

function handleAccount(body) {
  if (body.op === "save_state") {
    server.saves++;
    if (server.updated_at && body.base_updated_at !== server.updated_at) {
      server.conflicts++;
      return { status: 409, body: { state: server.state, updated_at: server.updated_at } };
    }
    server.state = body.state;
    server.updated_at = rev();
    return { status: 200, body: { ok: true, updated_at: server.updated_at } };
  }
  if (body.op === "load_state") {
    server.loads++;
    return { status: 200, body: { state: server.state, updated_at: server.updated_at } };
  }
  return { status: 200, body: {} };
}

const AUTH = {
  userId: "u1",
  email: "two@devices.test",
  accessToken: "tok",
  refreshToken: "ref",
  expiresAt: Date.now() + 24 * 3600_000, // far future → ensureFresh never refreshes
};

const baseState = (deviceId, extra = {}) => ({
  onboarded: true,
  deviceId,
  user: { name: "R", vibe: [], facts: {} },
  messages: [],
  openrouterKey: "", openrouterModel: "", apiKey: "",
  elevenKey: "", elevenVoiceId: "", sarvamKey: "", deviceVoice: "",
  lastSeen: Date.now(),
  auth: AUTH,
  lastAccountId: "u1",
  ...extra,
});

/** The app lands on Home; the thread is one tap away and that tap is the
 *  product's own route into it. Idempotent — a reload lands on Home again. */
async function openChat(page) {
  const toChat = page.locator('[data-tel="home.chat"]');
  if (await toChat.count()) {
    await toChat.first().click();
    await sleep(800);
  }
}

/** One device: its own context, its own storage, its own device id. */
async function device(name, deviceId, state = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.route("**/api/account", async (route) => {
    const body = JSON.parse(route.request().postData() || "{}");
    const res = handleAccount(body);
    await route.fulfill({ status: res.status, contentType: "application/json", body: JSON.stringify(res.body) });
  });
  await page.route("**/api/chat", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ text: "haan bolo" }) });
  });
  for (const p of ["**/api/memory", "**/api/telemetry", "**/api/consolidate", "**/api/clock", "**/api/life", "**/api/search", "**/api/trace", "**/api/route", "**/api/diag"])
    await page.route(p, (r) => r.fulfill({ status: 200, contentType: "application/json", body: "{}" }));
  await page.goto(`${B}/chat`, { waitUntil: "domcontentloaded" });
  await page.evaluate((s) => localStorage.setItem("meera.state.v1", JSON.stringify(s)), baseState(deviceId, state));
  await page.reload({ waitUntil: "domcontentloaded" });
  await sleep(1200);
  await openChat(page);
  return { name, ctx, page };
}

const texts = (page) =>
  page.$$eval(".msg", (els) => els.map((e) => (e.textContent || "").trim()));
const stored = (page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem("meera.state.v1") || "{}"));

/** What a tab switch really is: the page becomes visible and the window takes
 *  focus. `bringToFront` gives the first; the focus event is dispatched only
 *  if the browser did not already fire one, and the run says which happened. */
async function bringToFront(page) {
  await page.bringToFront();
  const vis = await page.evaluate(() => document.visibilityState);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  return vis;
}

async function send(page, text) {
  await page.locator('[data-tel="chat.composer"]').click();
  await page.locator('[data-tel="chat.composer"]').type(text, { delay: 20 });
  await page.keyboard.press("Enter");
}

// ══ 1. A MESSAGE APPEARS ON THE OTHER DEVICE, ON FOCUS, WITHOUT A RELOAD ═══
const A = await device("laptop", "00000000-0000-4000-8000-0000000000a1");
const C = await device("phone", "00000000-0000-4000-8000-0000000000c1");

ok("both devices booted signed in", server.loads >= 2, `loads=${server.loads}`);

// he texts from the phone; the laptop is open, in the background, and quiet
await send(C.page, "phone se bhej raha hu");
await sleep(16_000); // past her stubbed reply (burst wait) AND the 4s push debounce it restarts
ok("the phone pushed the message to the account",
  Boolean(server.state?.messages?.some((m) => m.text === "phone se bhej raha hu")),
  JSON.stringify(server.state?.messages?.map((m) => m.text) ?? []));

const laptopBefore = await texts(A.page);
ok("the laptop does NOT have it yet (this is the defect being fixed)",
  !laptopBefore.some((t) => t.includes("phone se bhej raha hu")), JSON.stringify(laptopBefore));

// the pull's own min-gap is 20s from the last read, and boot was a read — so
// a focus inside it is correctly suppressed. This is the wait, not a hack.
await sleep(21_000);
const visA = await bringToFront(A.page);
await sleep(4000);
const laptopAfter = await texts(A.page);
ok("ON FOCUS the laptop has it, with no reload",
  laptopAfter.some((t) => t.includes("phone se bhej raha hu")),
  `visibilityState was "${visA}"; ${JSON.stringify(laptopAfter)}`);

// and the laptop's OWN unsent work is not what it paid for it
await send(A.page, "laptop se likha");
await sleep(500);
const bothLocal = await texts(A.page);
ok("the laptop's own message survives alongside the pulled one",
  bothLocal.some((t) => t.includes("laptop se likha")) &&
    bothLocal.some((t) => t.includes("phone se bhej raha hu")), JSON.stringify(bothLocal));
await sleep(6000);
ok("…and both are on the account afterwards",
  Boolean(server.state?.messages?.some((m) => m.text === "laptop se likha")) &&
    Boolean(server.state?.messages?.some((m) => m.text === "phone se bhej raha hu")),
  JSON.stringify(server.state?.messages?.map((m) => m.text) ?? []));

// ══ 2. THE CLEAR-CHAT TOMBSTONE SURVIVES A STALE PEER ══════════════════════
//
// The phone clears the chat. The laptop is a stale peer: it still holds every
// message and has never heard of the wipe. When it pulls, the wipe must win —
// a cleared conversation that comes back because another device still had a
// copy is the promise in Settings broken by the sync layer.
{
  // The identities of everything said before the wipe. Ids rather than text,
  // because she greets again the moment the thread reopens and a NEW message
  // is not a resurrected one — "the thread is empty" would be the wrong
  // property to assert and would fail for the right reason.
  const preIds = new Set(((await stored(A.page)).messages ?? []).map((m) => m.id));
  ok("there is a pre-clear thread to lose", preIds.size >= 3, String(preIds.size));
  const survivors = (msgs) => (msgs ?? []).filter((m) => preIds.has(m.id)).map((m) => m.text);

  const now = Date.now();
  // the wipe as the product writes it: a tombstone plus an emptied thread
  await C.page.evaluate((at) => {
    const s = JSON.parse(localStorage.getItem("meera.state.v1"));
    s.clearedAt = at;
    s.messages = [];
    localStorage.setItem("meera.state.v1", JSON.stringify(s));
  }, now);
  await C.page.reload({ waitUntil: "domcontentloaded" });
  await sleep(10_000); // boot pull + the push that carries the tombstone up
  ok("the phone pushed the tombstone", Number(server.state?.clearedAt) === now,
    `${server.state?.clearedAt} vs ${now}`);
  ok("…and no pre-clear message is left on the account",
    survivors(server.state?.messages).length === 0, JSON.stringify(survivors(server.state?.messages)));

  const staleBefore = ((await stored(A.page)).messages ?? []).filter((m) => preIds.has(m.id));
  ok("the laptop is genuinely stale (it still holds the whole pre-clear thread)",
    staleBefore.length === preIds.size, `${staleBefore.length}/${preIds.size}`);

  await sleep(21_000);
  await bringToFront(A.page);
  await sleep(4000);
  const disk = await stored(A.page);
  ok("the pull clears the stale peer's copy rather than resurrecting it",
    survivors(disk.messages).length === 0, JSON.stringify(survivors(disk.messages)));
  ok("the tombstone reached the stale peer's disk", Number(disk.clearedAt) === now, String(disk.clearedAt));
  const shown = await texts(A.page);
  ok("and nothing pre-clear is on screen either",
    !shown.some((t) => t.includes("phone se bhej raha hu") || t.includes("laptop se likha")),
    JSON.stringify(shown));

  // the real hazard: the stale peer pushing its old copy back up afterwards
  await sleep(8000);
  ok("the stale peer never pushes the old thread back up",
    survivors(server.state?.messages).length === 0, JSON.stringify(survivors(server.state?.messages)));
}

// ══ 3. THE DERIVED LEDGER ROWS, IN A LIVE APP ══════════════════════════════
//
// The dyad row is written by an effect that runs on every counted change, so
// the two things worth proving in a real browser are that it runs at all and
// that it does not run FOREVER: a row rewritten on each pass would be a
// rerender per keystroke and a `state.activities` clock ticking with nothing
// behind it.
{
  await bringToFront(C.page);
  await openChat(C.page); // section 2 reloaded this device back onto Home
  await send(C.page, "ek aur message");
  await sleep(6000);
  const disk = await stored(C.page);
  const dyad = (disk.activities ?? []).filter((r) => r.kind === "dyad");
  ok("the dyad row is written into the ledger the lanes already read",
    dyad.length === 1, JSON.stringify(disk.activities ?? []));
  ok("…and it carries counted numbers", /their record: \d+ days/.test(dyad[0]?.summary ?? ""),
    dyad[0]?.summary ?? "");
  const at1 = dyad[0]?.closedAt;
  await sleep(6000);
  const disk2 = await stored(C.page);
  const dyad2 = (disk2.activities ?? []).filter((r) => r.kind === "dyad");
  ok("a settled row is not rewritten while nothing changes",
    dyad2.length === 1 && dyad2[0].closedAt === at1, `${at1} → ${dyad2[0]?.closedAt}`);
  ok("…and it syncs with the rest of the state",
    (server.state?.activities ?? []).some((r) => r.kind === "dyad"),
    JSON.stringify(server.state?.activities ?? []));
}

console.log(`\naccount server: ${server.loads} loads, ${server.saves} saves, ${server.conflicts} conflicts`);
console.log(fails ? `\n${fails} FAILURES` : "\nALL PASS");
await browser.close();
process.exit(fails ? 1 : 0);
