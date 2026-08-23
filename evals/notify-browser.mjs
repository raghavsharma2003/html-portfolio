// WS-NOTIFY in a real browser — the half of this lane that only a browser can
// answer.
//
//   xvfb-run -a node evals/notify-browser.mjs             # assert
//   xvfb-run -a node evals/notify-browser.mjs --observe   # print, never fail
//
// IT MUST RUN HEADED, and the reason is the thing it is here to measure:
// headless Chromium reports `Notification.permission === "denied"` from the
// start and `grantPermissions` cannot move it, so a headless run would assert
// the permission path against a browser that has no permission path. Measured
// here, both ways: headless "denied" -> "denied"; headed "default" ->
// "granted". `xvfb-run` supplies the display; that is the whole difference.
//
// `evals/notify.mjs` drives the policy and the plumbing against a recorder,
// which is the right shape for a gate: fast, offline, deterministic. What a
// recorder structurally cannot prove is that the REAL plugin, on a REAL
// permission model, in a REAL secure context, does what the recorder was
// standing in for. Four things live only here:
//
//   1. THE PERMISSION MODEL IS THE BROWSER'S. `permissionState()` reads
//      "prompt" before a grant and "granted" after one, through
//      @capacitor/local-notifications' own web implementation rather than
//      through anything this repo wrote. The seam in `local.ts` exists to make
//      the gate fast; if that seam and the real plugin disagreed, every
//      assertion in the gate would be about a fiction.
//   2. A NOTIFICATION IS ACTUALLY CONSTRUCTED, with her name as the title and
//      her own sentence as the body — observed on the `Notification`
//      constructor, which is the last thing before the operating system.
//   3. THE REFUSAL HOLDS AGAINST THE REAL PLUGIN. A bubble carrying nothing she
//      said (a gif's search query) constructs NOTHING. This is the one that
//      would rot silently: a future "helpful" fallback body would pass every
//      offline test that only checks the happy path.
//   4. COMING BACK CLOSES IT. `close()` on the live notification, not just a
//      cancel of something pending.
//
// It is NOT a gate. It needs a browser binary, which the APK workflow does not
// have, and this repo's rule is that a skipped gate looking like a passed gate
// is how a shadowed index survived a day. Run it when this lane changes.
//
// No network leaves the page (the origin is served from memory by a route
// handler), no model is called, $0.

import { chromium } from "playwright";
import { execSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const OBSERVE = process.argv.includes("--observe");
const ORIGIN = "https://meera.test";

let fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) console.log(`  ok  ${name}`);
  else {
    if (!OBSERVE) fail++;
    console.log(`${OBSERVE ? " note " : "FAIL  "}${name}${extra ? "\n      " + extra : ""}`);
  }
};

// ── the REAL module, bundled for a browser, plugin and all ────────────────
const tmp = mkdtempSync(join(tmpdir(), "notify-b-"));
const ENTRY = join(tmp, "entry.ts");
const OUT = join(tmp, "notify.js");
writeFileSync(
  ENTRY,
  `import * as copy from "${join(ROOT, "src/notify/copy")}";
import * as local from "${join(ROOT, "src/notify/local")}";
import * as api from "${join(ROOT, "src/notify/index")}";
(window as any).N = { ...copy, ...local, ...api };
`,
);
// No aliases: @capacitor/core resolves its own web implementation in a browser,
// which is the entire point of running this here.
execSync(
  `npx esbuild ${ENTRY} --bundle --format=iife --outfile=${OUT} --log-level=error --platform=browser`,
  { stdio: "inherit", cwd: ROOT },
);
const BUNDLE = readFileSync(OUT, "utf8");

// Headed, under a virtual display. See the header: this is not a preference.
let browser;
try {
  browser = await chromium.launch({ headless: false });
} catch (e) {
  console.log(
    "FAIL  a headed browser could not start. Run this as `xvfb-run -a node " +
      "evals/notify-browser.mjs`; headless Chromium denies notifications " +
      "outright, so a headless run would measure nothing.\n      " +
      String(e.message).slice(0, 200),
  );
  process.exit(1);
}
const ctx = await browser.newContext();

// Record every Notification the page constructs, and every close(). Wrapped
// rather than replaced, so the plugin's own capability probe still sees a real
// constructor and the permission model stays the browser's.
await ctx.addInitScript(() => {
  const Real = window.Notification;
  const seen = [];
  // The plugin's own capability probe constructs `new Notification("")` when
  // permission is not yet granted, to tell "the API exists" from "the API
  // throws". A titleless notification is that probe and never ours — copy.ts
  // cannot produce one — so it is recorded and filtered rather than counted.
  window.__NOTES = seen;
  window.__REAL = () => seen.filter((r) => r.title !== "");
  class Recording extends Real {
    constructor(title, opts) {
      super(title, opts);
      seen.push({ title, body: opts?.body, tag: opts?.tag, closed: false, self: this });
    }
    close() {
      const row = seen.find((r) => r.self === this);
      if (row) row.closed = true;
      return super.close();
    }
  }
  Object.defineProperty(Recording, "permission", { get: () => Real.permission });
  Recording.requestPermission = Real.requestPermission.bind(Real);
  window.Notification = Recording;
});

const page = await ctx.newPage();
await page.route(`${ORIGIN}/`, (route) =>
  route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>n</title>" }),
);
await page.goto(`${ORIGIN}/`);
await page.addScriptTag({ content: BUNDLE });

const her = (text, kind = "text") => ({ from: "her", kind, text, at: Date.now() });

// ── 1. before any grant ───────────────────────────────────────────────────
ok("the browser can notify at all", await page.evaluate(() => window.N.notifyAvailable()));
ok(
  "permission reads 'prompt' before a grant",
  (await page.evaluate(() => window.N.permissionState())) === "prompt",
);
ok(
  "the ask is armed only by a FELT moment",
  await page.evaluate(() => window.N.shouldExplain({ felt: 1 }, "prompt", true) === true &&
    window.N.shouldExplain({}, "prompt", true) === false),
);
ok(
  "with no permission, a reply reports the felt moment and posts nothing",
  await page.evaluate(async (m) => {
    const r = await window.N.postReply([m], {});
    return r === "unpermitted" && window.__REAL().length === 0;
  }, her("uth gaye?")),
);

// ── 2. after the grant ────────────────────────────────────────────────────
await ctx.grantPermissions(["notifications"], { origin: ORIGIN });
ok(
  "permission reads 'granted' after the grant",
  (await page.evaluate(() => window.N.permissionState())) === "granted",
);

const posted = await page.evaluate(async (m) => {
  const r = await window.N.postReply([m], {});
  return { r, notes: window.__REAL().map(({ title, body, tag }) => ({ title, body, tag })) };
}, her("kal chalein? subah nikalte hain"));
ok("a reply posts", posted.r === "posted", JSON.stringify(posted));
ok("…one notification, not several", posted.notes.length === 1, JSON.stringify(posted.notes));
ok("…titled with her name", posted.notes[0]?.title === "Meera");
ok(
  "…and the body is HER SENTENCE, not a template",
  posted.notes[0]?.body === "kal chalein? subah nikalte hain",
  JSON.stringify(posted.notes[0]),
);

// ── 3. the refusal, against the real plugin ───────────────────────────────
const gif = await page.evaluate(async (m) => {
  const before = window.__REAL().length;
  const r = await window.N.postReply([m], {});
  return { r, added: window.__REAL().length - before };
}, her("excited dog", "gif"));
ok("a bare gif posts NOTHING", gif.r === "nothing" && gif.added === 0, JSON.stringify(gif));

const off = await page.evaluate(async (m) => {
  const before = window.__REAL().length;
  const r = await window.N.postReply([m], { enabled: false });
  return { r, added: window.__REAL().length - before };
}, her("hi"));
ok("his own switch off posts NOTHING", off.r === "off" && off.added === 0, JSON.stringify(off));

// ── 4. he came back ───────────────────────────────────────────────────────
ok(
  "clearing closes the notification that is on screen",
  await page.evaluate(async () => {
    await window.N.clearReply();
    return window.__REAL().every((n) => n.closed);
  }),
);

// ── 5. the missed call, end to end ────────────────────────────────────────
const missed = await page.evaluate(async () => {
  const before = window.__REAL().length;
  const r = await window.N.postMissedCall({});
  const all = window.__REAL();
  const n = all[all.length - 1];
  return { r, added: all.length - before, title: n?.title, body: n?.body };
});
ok("a missed call posts", missed.r === "posted" && missed.added === 1, JSON.stringify(missed));
ok("…as her name and a flat statement", missed.title === "Meera" && missed.body === "Missed call");

await browser.close();
console.log(fail ? `\n${fail} FAILURES` : "\nALL PASS");
process.exit(fail ? 1 : 0);
