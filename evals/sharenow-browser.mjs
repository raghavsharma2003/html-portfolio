// ── THE SHARE MIRROR, IN A REAL BROWSER, ACROSS A RELOAD ──────────────────
//
// `evals/sharenow/run.mjs` proves the flow: her lines over a screen share ->
// the mirror -> the just-happened block -> the live prompt. It proves it in
// Node, over pure functions, which is where every part of that chain except
// ONE actually lives.
//
// The exception is the part the owner's report is really about: SIXTY SECONDS
// AND A HANGUP happen between the write and the read. On the web that is a
// state update, a screen teardown, and — often enough to matter — a reload, a
// backgrounded tab reaped by the OS, or the app opened fresh from the home
// screen to place the call back. Everything in between is `localStorage`, the
// hydrate guard in `loadState`, and `saveState`'s degradation ladder. None of
// those is a pure function and none of them can be proven in Node.
//
// So this is the browser half, and it asserts exactly the property Node
// cannot: a share recorded before the page went away is still there when the
// page comes back, and the REAL renderer still renders it.
//
//   npx vite build
//   npx vite preview --port 4292 --strictPort &
//   node evals/sharenow-browser.mjs
//
// NOT in evals/run.mjs, and deliberately: it needs a built app and a server on
// a port, the same by-construction exclusion evals/sync-browser.mjs and
// evals/burst-browser.mjs carry.
import { chromium } from "playwright";
import { execSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const B = process.env.MEERA_PREVIEW || "http://localhost:4292";

let fails = 0;
const ok = (n, c, e = "") => {
  console.log(`${c ? "  ok  " : "FAIL  "}${n}${e ? " — " + e : ""}`);
  if (!c) fails++;
};

// The REAL renderer, bundled from source — the browser holds the state, this
// holds the function that reads it, and neither is re-modelled here.
const tmp = mkdtempSync(join(tmpdir(), "sharenow-b-"));
const BUNDLE = join(tmp, "b.mjs");
execSync(
  `npx esbuild ${join(HERE, "sharenow/.entry.ts")} --bundle --format=esm --platform=node ` +
    `--outfile=${BUNDLE} --log-level=error --alias:@capacitor/core=${join(ROOT, "evals/stubs/capacitor.mjs")}`,
  { stdio: "inherit", cwd: ROOT },
);
const E = await import(BUNDLE);

const HER_LINES = [
  "arre ye toh pura dashboard red hai",
  "us graph me dusra spike bada weird hai",
  "haha wo popup band kar pehle",
];

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const ctx = await browser.newContext();
const page = await ctx.newPage();
await page.goto(B, { waitUntil: "domcontentloaded" });

// ── write the mirror the way a share end writes it ────────────────────────
// Through the REAL stored blob under the REAL key, at the REAL clock, so what
// is read back below has been through `JSON.stringify` -> localStorage ->
// `loadState`'s guard, which is the whole point of doing this in a browser.
const written = await page.evaluate(
  ({ lines }) => {
    const KEY = "meera.state.v1";
    const now = Date.now();
    const raw = localStorage.getItem(KEY);
    const s = raw ? JSON.parse(raw) : { messages: [] };
    s.shares = [
      { startedAt: now - 12 * 60_000, endedAt: now - 8 * 60_000, lane: "web", said: lines },
    ];
    localStorage.setItem(KEY, JSON.stringify(s));
    return { now, bytes: localStorage.getItem(KEY).length };
  },
  { lines: HER_LINES },
);
ok("the mirror was written to the real storage key", written.bytes > 0);

// ── the page goes away, exactly as it does between a hangup and a call back ─
await page.reload({ waitUntil: "domcontentloaded" });
// give the app a beat to hydrate and write its own state back
await page.waitForTimeout(1500);

const after = await page.evaluate(() => {
  const raw = localStorage.getItem("meera.state.v1");
  if (!raw) return null;
  try {
    return JSON.parse(raw).shares ?? null;
  } catch {
    return null;
  }
});

ok("the share mirror survives a reload", Array.isArray(after) && after.length === 1, JSON.stringify(after));
ok(
  "…with every line she said over the screen intact",
  Array.isArray(after) && HER_LINES.every((l) => after[0].said.includes(l)),
  JSON.stringify(after?.[0]?.said),
);
ok(
  "…and the app's own hydrate + save cycle did not drop the field",
  Array.isArray(after) && Number.isFinite(after[0].startedAt) && Number.isFinite(after[0].endedAt),
);

// ── and the REAL renderer, on the state that came back ────────────────────
if (Array.isArray(after)) {
  const block = E.formatJustHappened(after, [], [], Date.now());
  ok("the just-happened block renders from the reloaded mirror", block.length > 0);
  ok("…and carries what they watched", HER_LINES.every((l) => block.includes(l)));
  ok("…and never a word about what was on the screen", /add nothing to it/.test(block));
  ok(`…within budget (${block.length} <= ${E.JUST_HAPPENED_BUDGET})`, block.length <= E.JUST_HAPPENED_BUDGET);
}

// ── the guard: a malformed blob must not brick the app ────────────────────
// `loadState`'s container guard is the reason `shares` cannot be the field
// that produces a white screen surviving every reload — the class store.ts
// already records for `game` and `activities`. Asserted by handing it the
// malformed shape and checking the app still comes up.
await page.evaluate(() => {
  const KEY = "meera.state.v1";
  const s = JSON.parse(localStorage.getItem(KEY) || "{}");
  s.shares = 42; // a number where an array belongs
  localStorage.setItem(KEY, JSON.stringify(s));
});
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForTimeout(1500);
const alive = await page.evaluate(() => document.body.innerText.length > 0);
ok("a malformed `shares` does not brick the app (the container guard holds)", alive);
const dropped = await page.evaluate(() => {
  const raw = localStorage.getItem("meera.state.v1");
  const v = raw ? JSON.parse(raw).shares : undefined;
  return v === undefined || Array.isArray(v);
});
ok("…and the malformed value is gone rather than persisted", dropped);

await browser.close();
console.log(fails ? `\n${fails} FAILED` : "\nsharenow-browser ok");
process.exit(fails ? 1 : 0);
