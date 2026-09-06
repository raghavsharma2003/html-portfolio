// THE ACCESSIBILITY GATE.
//
// Why this exists, stated plainly: a Room is a relationship a follower may
// keep for years. Some of those followers use a screen reader, or a switch,
// or a keyboard alone, because they cannot use a mouse — and nothing in this
// repo checked that before WS-R50. `scripts/check-layout.mjs` asks "can I
// read this"; this file asks "can I OPERATE this without eyes or a pointer",
// which is a different question with different failure shapes: a control
// with no accessible name, a dialog a keyboard user cannot escape, a focus
// ring that vanishes into the background it sits on.
//
// TWO INDEPENDENT CHECKS, BOTH REQUIRED
// ---------------------------------------------------------------------------
//   1. AXE. `axe-core` runs INSIDE the real page, against the real rendered
//      DOM, scored against the WCAG 2.1 A and AA rule tags. It catches the
//      class of defect a static read cannot: a missing accessible name, a
//      contrast ratio computed from the actual painted colours, a landmark
//      that does not nest the way the spec requires.
//   2. THE KEYBOARD WALK, hand-written, because axe cannot drive a keyboard.
//      It presses real Tab/Enter/Space/Escape keys against the real page and
//      asserts what a keyboard-only person actually needs: every interactive
//      control is reached, the primary control activates, an open panel
//      closes on Escape, and focus is visibly marked at every stop.
//
// WHAT IT LOOKS AT, AND WHY THAT IS THE WHOLE POINT (`check-layout.mjs`'s own
// law, restated): the fixtures are REUSED, never duplicated. Pointing this at
// `/r/anjali` would render "this room is not open" and pass against nothing,
// the exact defect class `check-layout.mjs`'s own header describes. So this
// file drives `studio-layout-fixture.html` and `room-layout-fixture.html` —
// the same two harnesses, the same query shapes — plus the two static
// landing pages that need no fixture at all (`/`, `/vyakti`).
//
// PORTS. The layout gate owns 8931, the performance-budget gate owns 8932
// (WS-R49). This file owns 8933 and answers to nothing else, so three gates
// can run at once on one machine without a bind collision.
//
// THE THRESHOLD. Zero `serious` or `critical` violations, summed across every
// target, fails the build. `moderate` and `minor` are reported with counts
// but do not fail it. See `context/decisions.md#ws-r50-accessibility-impact-threshold`
// for the reversal condition — this is a decision, not an oversight.
//
// NEGATIVE CONTROL. `selfTest()` runs first, against an inline fixture with a
// known violation (a button with no accessible name) and a clean fixture with
// none. If axe stops seeing the planted defect, this file fails before it
// ever reaches the tree — the same posture `check-copy.mjs`'s own self-test
// takes, for the same reason: a gate nobody has watched fail is a gate nobody
// knows is wired.

import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

function rootFromModuleUrl(moduleUrl, options) {
  return fileURLToPath(new URL("..", moduleUrl), options);
}

const ROOT = rootFromModuleUrl(import.meta.url);
const DIST = join(ROOT, "dist");
const PORT = 8933;
const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

const args = process.argv.slice(2);
const targetFilter = args.includes("--target") ? args[args.indexOf("--target") + 1] : null;
const jsonOut = args.includes("--json") ? args[args.indexOf("--json") + 1] : null;

/* ── every page this gate judges, and how to reach it ─────────────────────
 *
 * Reused from `check-layout.mjs`'s own `TARGETS`, not duplicated: the room
 * and room-hi fixture query shapes, the studio shell fixture query shape and
 * its three tab steps, are copied verbatim from that file's header comment
 * rather than re-derived, so the two gates cannot silently disagree about
 * what "the same fixture" means. Two entries have no fixture at all — `/` and
 * `/vyakti` are static pages, not signed-in surfaces, so there is nothing to
 * fake sign-in for.
 */
const TARGETS = [
  {
    name: "room",
    fixture: "room-layout-fixture.html",
    query: (screen) => `screen=${screen}`,
    screens: ["join", "talk", "account"],
    mounted: ".room-shell",
  },
  {
    name: "room-hi",
    fixture: "room-layout-fixture.html",
    query: (screen) => `screen=${screen}&lang=hi`,
    screens: ["join", "talk", "account"],
    mounted: ".room-shell",
  },
  {
    name: "studio:shell",
    fixture: "studio-layout-fixture.html",
    query: (step) => `mode=teacher&step=${step}`,
    screens: ["feed", "meet", "deploy"],
    mounted: ".studio-tabshell",
  },
  // WS-R52. The studio's own chrome in Hindi -- `room-hi`'s own reason one
  // surface over: an accessibility gate that only ever renders the English
  // studio would never catch a Devanagari-specific defect (a language switch
  // with no accessible name, a focus ring lost against a Hindi label's own
  // wrapping), and the studio now has a real Hindi chrome to check
  // (src/studio/copy.ts, migration 112).
  {
    name: "studio:shell-hi",
    fixture: "studio-layout-fixture.html",
    query: (step) => `mode=teacher&step=${step}&lang=hi`,
    screens: ["feed", "meet", "deploy"],
    mounted: ".studio-tabshell",
  },
  // WS-R91. The sign-in screen, signed OUT, in Hindi -- `check-layout.mjs`'s
  // own `studio-hi:signed-out` target, the same fixture query
  // (`layoutFixture.tsx`'s `SIGNED_OUT` branch clears any session an
  // earlier target already seeded in this run's shared browser context).
  // Its own language switch (`AuthLanguageSwitch`, `AuthGate.tsx`) is
  // exactly the control class this gate exists to catch a missing
  // accessible name or lost focus ring on.
  {
    name: "studio-hi:signed-out",
    fixture: "studio-layout-fixture.html",
    query: () => "lang=hi&signedOut=1",
    screens: ["signin"],
    mounted: ".auth-page",
  },
  {
    name: "site",
    // Served straight off the dist root by `serveDist` below — no query,
    // one screen each.
    fixture: null,
    query: () => "",
    screens: ["/"],
    mounted: "#root",
  },
  {
    name: "vyakti",
    // `site/vyakti.html` is self-contained (inline CSS, no build step —
    // `scripts/vercel-build.sh`'s own comment says why) and is not one of
    // `vite.config.ts`'s build inputs, so it is served straight from source
    // rather than through `dist/`. Real production reaches this page only on
    // the platform-branch build (see that script); this gate reaches it
    // directly so the page is judged on every branch, not only that one.
    fixture: null,
    query: () => "",
    screens: ["/vyakti"],
    mounted: "main h1",
  },
];

const MIME = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png",
  ".woff2": "font/woff2", ".ico": "image/x-icon",
};

function serveDist() {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
    let path;
    if (url.pathname === "/vyakti") {
      // Source, not dist — see the `vyakti` target's own comment above.
      path = join(ROOT, "site", "vyakti.html");
    } else {
      path = join(DIST, url.pathname === "/" ? "index.html" : url.pathname.slice(1));
    }
    try {
      const body = await readFile(path);
      res.writeHead(200, { "content-type": MIME[extname(path)] || "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404).end("not found");
    }
  });
  return new Promise((ok) => server.listen(PORT, "127.0.0.1", () => ok(server)));
}

/** Every (target, screen) pair, with its real URL, flattened once so the run
 *  loop and the coverage count agree by construction rather than by two
 *  people keeping two lists in sync. */
function urlsFor(target) {
  return target.screens.map((screen) => {
    const page =
      target.fixture === null
        ? screen // "/" or "/vyakti" — the screen IS the path
        : `/${target.fixture}?${target.query(screen)}`;
    return { screen, url: `http://127.0.0.1:${PORT}${page}` };
  });
}

/* ═══ THE SELF-TEST — a gate nobody has watched fail is a gate nobody knows
 * is wired (`check-copy.mjs`'s own posture, restated). Runs against two
 * inline fixtures, no server, no navigation: one with a planted violation
 * (a button with no accessible name — `button-name`, a `serious`-impact rule
 * in the wcag2a tag set) that MUST be caught, one clean that MUST NOT flag
 * anything. If axe-core is ever swapped, pinned to a version that changed
 * this rule's impact, or misconfigured (wrong tags, wrong root), this fails
 * before it ever reaches a real target and says exactly which half broke. */
async function selfTest(chromium, executablePath, axeSource) {
  const browser = await chromium.launch(
    executablePath ? { executablePath, args: ["--no-sandbox"] } : { args: ["--no-sandbox"] },
  );
  const page = await browser.newPage();
  try {
    await page.setContent(
      `<!doctype html><html lang="en"><body><button></button><img src="x.png"></body></html>`,
    );
    await page.addScriptTag({ content: axeSource });
    const dirty = await page.evaluate(
      (tags) => window.axe.run(document, { runOnly: { type: "tag", values: tags } }),
      AXE_TAGS,
    );
    const dirtyIds = dirty.violations.map((v) => v.id);
    if (!dirtyIds.includes("button-name")) {
      throw new Error(
        `self-test: planted violation not caught. Expected "button-name" among [${dirtyIds.join(", ")}]. ` +
          "The negative control did not fire — do not trust a green run until it does.",
      );
    }

    await page.setContent(
      `<!doctype html><html lang="en"><head><title>Self-test</title></head><body><button aria-label="Close">×</button></body></html>`,
    );
    const clean = await page.evaluate(
      (tags) => window.axe.run(document, { runOnly: { type: "tag", values: tags } }),
      AXE_TAGS,
    );
    if (clean.violations.length > 0) {
      throw new Error(
        `self-test: clean fixture flagged ${clean.violations.length} violation(s): ` +
          `${clean.violations.map((v) => v.id).join(", ")}. The rule set is over-firing.`,
      );
    }
  } finally {
    await browser.close();
  }
}

/* ═══ THE KEYBOARD WALK ═══════════════════════════════════════════════════
 *
 * axe cannot drive a keyboard — every one of its rules reads the DOM and
 * computed styles, never a key event. So this is hand-written, against the
 * two screens the brief names: the Room's talk screen and the account page.
 * Both are read from the SAME fixture this file already serves for axe,
 * never a third page.
 */

/** Runs INSIDE the page. The exact interactivity test a browser's own
 *  default tab order uses: visible, not disabled, no `tabindex="-1"`. */
function collectFocusable() {
  const vis = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return false;
    const cs = getComputedStyle(el);
    return cs.display !== "none" && cs.visibility !== "hidden" && Number(cs.opacity) !== 0;
  };
  const name = (el) => {
    const cls = typeof el.className === "string" && el.className.trim()
      ? "." + el.className.trim().split(/\s+/).slice(0, 2).join(".")
      : "";
    return el.tagName.toLowerCase() + cls + (el.textContent ? ` "${el.textContent.trim().slice(0, 24)}"` : "");
  };
  const nodes = [
    ...document.querySelectorAll(
      'button:not([disabled]), a[href], input:not([disabled]):not([type="hidden"]), ' +
        'textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ].filter(vis);
  return nodes.map((el, i) => {
    el.setAttribute("data-a11y-walk-index", String(i));
    const r = el.getBoundingClientRect();
    return { index: i, label: name(el), top: Math.round(r.top), left: Math.round(r.left) };
  });
}

/** Runs INSIDE the page, once per Tab press. Reads `document.activeElement`
 *  and whether it carries a VISIBLE focus indicator — an outline that is
 *  neither "none" nor zero width, or a non-"none" box-shadow. Either one
 *  satisfies SC 2.4.7; `check-layout.mjs`'s own `parseColor`/`luminance`
 *  pair is not reused here because the law only asks for PRESENCE, not a
 *  contrast ratio — this file states the ratio it measured for the one real
 *  defect it found in its own commit and context entries instead. */
function readFocusState() {
  const el = document.activeElement;
  if (!el || el === document.body) return { index: -1, visible: false, tag: "body" };
  const cs = getComputedStyle(el);
  const hasOutline = cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth || "0") > 0;
  const hasShadow = cs.boxShadow && cs.boxShadow !== "none";
  const idx = el.getAttribute("data-a11y-walk-index");
  return {
    index: idx === null ? -1 : Number(idx),
    visible: hasOutline || hasShadow,
    tag: el.tagName.toLowerCase(),
  };
}

/** Tabs through the whole page and asserts every focusable control is
 *  reached at least once, in non-decreasing DOM order (this codebase places
 *  no positive `tabindex` anywhere — `grep -rn tabIndex src/room src/studio`
 *  found none outside one `tabIndex={-1}` error banner — so the browser's
 *  default tab order IS DOM order, and DOM order IS visual order on every
 *  screen this gate walks: a single flex column, mobile-first, no floated or
 *  absolutely-positioned control reordering the page), and that focus is
 *  visibly marked at every stop. Returns the findings; throws on nothing —
 *  the caller decides pass/fail so one page's problem does not abort the run. */
async function walkTabOrder(page, where) {
  const findings = [];
  const focusable = await page.evaluate(collectFocusable);
  if (focusable.length === 0) {
    findings.push({ where, kind: "keyboard-coverage", detail: "no focusable elements found — the gate is blind here" });
    return findings;
  }
  // WS-R63: `document.body.focus()` alone used to be enough to start every
  // walk from a clean slate, because nothing in this app ever put focus
  // anywhere on mount. Now that a Room dialog moves focus to its own first
  // control the moment it opens (`useDialogInView.ts`), `room:account`'s own
  // fixture opens the account page pre-focused, and two things had to be
  // fixed, both found by measuring the actual sequence rather than guessing:
  // (1) `<body>` carries no tabindex, so `.focus()` on it is a no-op per
  // spec — the PREVIOUS real target stays `document.activeElement`, so
  // `.blur()` on THAT (not body) is what is needed to actually drop focus;
  // (2) blurring alone still was not enough — Chromium keeps its own
  // "sequential focus navigation" position separate from `activeElement`,
  // and the first Tab after a bare blur resumed from just past the
  // PREVIOUSLY focused control rather than the top of the document (measured
  // directly: it landed on a mid-list "Turn off" button, not the page's
  // first control). Giving `<body>` a real, indexed focus target — a
  // temporary `tabindex="-1"` for exactly the one `.focus()` call — is what
  // actually resets that internal position; the attribute is removed
  // immediately after so `<body>` never joins anyone's real Tab order.
  await page.evaluate(() => {
    document.activeElement?.blur();
    document.body.setAttribute("tabindex", "-1");
    document.body.focus();
    document.body.removeAttribute("tabindex");
  });
  const seen = new Set();
  let highestSeen = -1;
  let outOfOrder = 0;
  const invisible = [];
  // A small buffer over the count: a control that grows a sibling on focus
  // (none currently do) would otherwise strand the walk one press short.
  const budget = focusable.length + 4;
  for (let i = 0; i < budget && seen.size < focusable.length; i++) {
    await page.keyboard.press("Tab");
    const state = await page.evaluate(readFocusState);
    if (state.index < 0) continue;
    seen.add(state.index);
    if (state.index < highestSeen) outOfOrder++;
    highestSeen = Math.max(highestSeen, state.index);
    if (!state.visible) {
      const el = focusable[state.index];
      if (!invisible.some((x) => x.label === el.label)) invisible.push(el);
    }
  }
  const missed = focusable.filter((f) => !seen.has(f.index));
  if (missed.length > 0) {
    findings.push({
      where, kind: "keyboard-unreachable",
      detail: `${missed.length} of ${focusable.length} focusable control(s) never received Tab focus: ` +
        missed.slice(0, 6).map((m) => m.label).join(", "),
    });
  }
  if (outOfOrder > 0) {
    findings.push({
      where, kind: "keyboard-order",
      detail: `${outOfOrder} Tab press(es) moved focus BACKWARD in DOM/visual order`,
    });
  }
  if (invisible.length > 0) {
    findings.push({
      where, kind: "keyboard-focus-invisible",
      detail: `${invisible.length} control(s) show no outline/box-shadow on :focus-visible: ` +
        invisible.slice(0, 6).map((m) => m.label).join(", "),
    });
  }
  return findings;
}

/** Room talk screen: opens "Your data" with Enter, asserts the panel opened,
 *  closes it with Escape, asserts it is gone — a pure client-state control,
 *  so the round trip is provable end to end with no network at all.
 *
 *  Then Space on the pulse toggle. This one does NOT check `aria-pressed`:
 *  `.room-pulse-toggle`'s own action (`setPulseOptIn`) is a real fetch to
 *  `/api/room-pulse`, and `room-layout-fixture.html` stubs no `/api/*` route
 *  at all (unlike the studio's own fixture) — a plain Playwright MOUSE
 *  CLICK on this exact button in this exact fixture 404s and leaves
 *  `aria-pressed` unchanged too (proven directly: see
 *  `context/rejected.md#ws-r50-pulse-toggle-aria-pressed-false-positive`),
 *  so asserting on it would fail identically for a fully keyboard-operable
 *  button and a keyboard-DEAD one — not a rule that discriminates the thing
 *  it exists to catch. What IS provable without a network is whether the
 *  key event actually REACHES this control's handler: a button wired only
 *  to `onPointerDown` never sees a `keydown` call `preventDefault` on
 *  Space, because the browser has nothing listening for it; one also wired
 *  to `onKeyDown` (this workstream's fix) does. */
async function walkTalkActivation(page) {
  const findings = [];
  const dataBtnHandle = await page.$$eval(".room-menu-open", (els, label) => {
    const target = els.find((e) => e.textContent.trim() === label);
    if (!target) return -1;
    target.setAttribute("data-a11y-target", "data-menu-open");
    return 0;
  }, "Your data");
  if (dataBtnHandle !== 0) {
    findings.push({ where: "room:talk", kind: "keyboard-activation", detail: '"Your data" button not found by label' });
    return findings;
  }
  await page.focus('[data-a11y-target="data-menu-open"]');
  await page.keyboard.press("Enter");
  await page.waitForTimeout(150);
  const openedDialog = await page.evaluate(() => Boolean(document.querySelector('.room-menu[role="dialog"]')));
  if (!openedDialog) {
    findings.push({ where: "room:talk", kind: "keyboard-activation", detail: "Enter on the data-menu opener did not open the dialog" });
  } else {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(150);
    const closedDialog = await page.evaluate(() => Boolean(document.querySelector('.room-menu[role="dialog"]')));
    if (closedDialog) {
      findings.push({ where: "room:talk", kind: "keyboard-escape", detail: "Escape did not close the data-menu dialog" });
    }
  }

  const pulseOk = await page.$$eval(".room-pulse-toggle", (els) => els.length > 0);
  if (pulseOk) {
    // The listener goes on `document`, in the BUBBLE phase, not on the
    // button itself. React 18/19 delegates its own synthetic listener to
    // the root container, which sits BETWEEN the button and `document` in
    // the bubble path — a listener attached directly to the button (the
    // AT_TARGET phase) would run and read `defaultPrevented` BEFORE the
    // event has even reached React's own handler, always seeing `false`
    // regardless of whether the app's `onKeyDown` fires. Reading it from
    // `document` reads it after every ancestor, React's root included, has
    // had its turn.
    await page.evaluate(() => {
      window.__a11yPreventedOnSpace = false;
      document.addEventListener(
        "keydown",
        (e) => {
          if (e.key === " " && e.defaultPrevented) window.__a11yPreventedOnSpace = true;
        },
        { once: true },
      );
    });
    await page.focus(".room-pulse-toggle");
    await page.keyboard.press("Space");
    await page.waitForTimeout(50);
    const reached = await page.evaluate(() => window.__a11yPreventedOnSpace === true);
    if (!reached) {
      findings.push({ where: "room:talk", kind: "keyboard-activation", detail: "Space on the pulse toggle never reached a keydown handler (button is pointer/mouse-only)" });
    }
  }
  return findings;
}

/** The account page's own controls were the wider instance of the pulse
 *  toggle's defect — WS-R39 built all eleven of this screen's buttons on
 *  `onPointerDown` alone, not just one. `walkTalkActivation`'s own
 *  `document`-listener technique, aimed at this screen's "Close" button
 *  (chosen because it is the one control on this page that changes nothing
 *  the fixture's stubbed `/api/*` needs to answer, so the proof needs no
 *  live backend at all — `roomSettings.account.close` in English is
 *  literally the string "Close"). */
async function walkAccountActivation(page) {
  const findings = [];
  const found = await page.$$eval(".room-account .room-btn", (els, label) => {
    const target = els.find((e) => e.textContent.trim() === label);
    if (!target) return false;
    target.setAttribute("data-a11y-target", "account-close");
    return true;
  }, "Close");
  if (!found) {
    findings.push({ where: "room:account", kind: "keyboard-activation", detail: '"Close" button not found by label' });
    return findings;
  }
  await page.evaluate(() => {
    window.__a11yPreventedOnSpace = false;
    document.addEventListener(
      "keydown",
      (e) => {
        if (e.key === " " && e.defaultPrevented) window.__a11yPreventedOnSpace = true;
      },
      { once: true },
    );
  });
  await page.focus('[data-a11y-target="account-close"]');
  await page.keyboard.press("Space");
  await page.waitForTimeout(50);
  const reached = await page.evaluate(() => window.__a11yPreventedOnSpace === true);
  if (!reached) {
    findings.push({ where: "room:account", kind: "keyboard-activation", detail: 'Space on the "Close" button never reached a keydown handler' });
  }
  return findings;
}

/** The account page: Escape closes the whole panel (it is already open — the
 *  fixture's `?screen=account`), falling back to the Room's talk screen
 *  underneath. */
async function walkAccountEscape(page) {
  const findings = [];
  const openBefore = await page.evaluate(() => Boolean(document.querySelector(".room-account")));
  if (!openBefore) {
    findings.push({ where: "room:account", kind: "keyboard-coverage", detail: "account page did not mount — the gate is blind here" });
    return findings;
  }
  await page.evaluate(() => document.body.focus());
  await page.keyboard.press("Escape");
  await page.waitForTimeout(150);
  const openAfter = await page.evaluate(() => Boolean(document.querySelector(".room-account")));
  if (openAfter) {
    findings.push({ where: "room:account", kind: "keyboard-escape", detail: "Escape did not close the account page" });
  }
  return findings;
}

/* ═══ LANGUAGE TAGGING (WS-R79) ════════════════════════════════════════════
 *
 * TalkBack and VoiceOver read `lang` off the DOM, not off which locale a
 * request happened to be for — a screen reader reads Devanagari in an
 * English voice unless the node that carries it says `lang="hi"`, and it
 * mispronounces an untranslated English word the same way if that word
 * sits under an element WE ourselves wrongly tagged `lang="hi"`. Two
 * questions, both run INSIDE the page against the real rendered DOM, exactly
 * axe's own posture above:
 *
 *   1. COVERAGE. Every text node containing a Devanagari codepoint must sit
 *      under an element whose COMPUTED `lang` (the nearest ancestor that
 *      carries the attribute, or `document.documentElement.lang` when none
 *      does — the same resolution rule a screen reader itself uses) is
 *      `hi`/`hi-*`.
 *   2. NO FALSE TAGGING. No element that ITSELF carries `lang="hi"` — never
 *      one that merely inherits it — may contain only ASCII letters and no
 *      Devanagari at all. Scoped to elements CARRYING the attribute, not
 *      elements merely under one: a plain English loanword ("AI", "UPI")
 *      sitting in prose this workstream never touched, inheriting `hi` from
 *      `<main lang="hi">` the way every Hindi screen in this app already
 *      does, is not a defect this rule exists to catch — only a node THIS
 *      REPO explicitly tagged wrong is.
 */
function langTagAudit() {
  const DEVANAGARI_RE = /[ऀ-ॿ]/;
  const ASCII_LETTER_RE = /[A-Za-z]/;

  function computedLang(el) {
    let cur = el;
    while (cur && cur.nodeType === 1) {
      const l = cur.getAttribute && cur.getAttribute("lang");
      if (l) return l.toLowerCase();
      cur = cur.parentElement;
    }
    return (document.documentElement.lang || "en").toLowerCase();
  }
  const isHi = (l) => l === "hi" || l.startsWith("hi-");

  // `<script>`/`<style>` carry text nodes too (a JSON-LD block's own payload,
  // not prose) — never read by a screen reader, so never in scope for either
  // question this audit asks.
  const NEVER_READ = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE"]);
  const findings = [];
  let devanagariNodes = 0;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) =>
      n.parentElement && NEVER_READ.has(n.parentElement.tagName)
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT,
  });
  let node;
  while ((node = walker.nextNode())) {
    const text = node.textContent || "";
    if (!DEVANAGARI_RE.test(text)) continue;
    devanagariNodes++;
    const parent = node.parentElement;
    if (!parent) continue;
    const lang = computedLang(parent);
    if (!isHi(lang)) {
      findings.push({ kind: "lang-devanagari-untagged", lang, text: text.trim().slice(0, 44) });
    }
  }

  // `document.body`, not `document`: `<html lang="hi">` itself carries the
  // attribute too, and its own accidental "ASCII-only" reading (whatever
  // text happens to sit under it) is not a node THIS workstream tagged —
  // law 2 is about nodes we deliberately marked, `<body>` down.
  let taggedHiElements = 0;
  const hiElements = document.body.querySelectorAll('[lang="hi"], [lang^="hi-"]');
  for (const el of hiElements) {
    const text = (el.textContent || "").trim();
    if (!text) continue;
    // `hi-Latn` (`VoicePreviewPanel.tsx`'s own Hinglish input, romanized
    // Hindi written on purpose in Latin letters) is a real, more specific
    // BCP-47 tag: Hindi language, Latin SCRIPT — ASCII-only text under it is
    // not a mistake, it is the whole point of the tag. Only a bare `hi`/
    // `hi-IN`-shaped tag (Devanagari implied, no script subtag saying
    // otherwise) is checked for this.
    if ((el.getAttribute("lang") || "").toLowerCase().includes("latn")) continue;
    taggedHiElements++;
    if (!DEVANAGARI_RE.test(text) && ASCII_LETTER_RE.test(text)) {
      findings.push({ kind: "lang-hi-ascii-only", text: text.slice(0, 44) });
    }
  }

  return { findings, devanagariNodes, taggedHiElements };
}

/* THE SELF-TEST — `selfTest()`'s own posture above, restated: a control that
 * runs first, against inline fixtures with a known planted violation of
 * EACH kind this audit exists to catch, and a clean fixture that must not
 * flag anything. If this stops catching either planted defect, the audit
 * itself is blind and nothing downstream of it can be trusted. */
async function selfTestLangTag(chromium, executablePath) {
  const browser = await chromium.launch(
    executablePath ? { executablePath, args: ["--no-sandbox"] } : { args: ["--no-sandbox"] },
  );
  const page = await browser.newPage();
  try {
    // Coverage: a Devanagari name on an English page, with no `hi` ancestor
    // anywhere — `RoomApp.tsx`'s own h1 shape before this workstream's fix.
    await page.setContent(`<!doctype html><html lang="en"><body><h1>प्रिया AI</h1></body></html>`);
    const dirtyCoverage = await page.evaluate(langTagAudit);
    if (!dirtyCoverage.findings.some((f) => f.kind === "lang-devanagari-untagged")) {
      throw new Error(
        "self-test: planted lang-devanagari-untagged violation not caught. The negative control did not fire.",
      );
    }

    // The same name, tagged at the node — must be clean. " AI" stays
    // outside the span (an untranslated loanword, ASCII, no Devanagari) —
    // exactly `Localized`'s own real output for `<h1>{name} AI</h1>`.
    await page.setContent(
      `<!doctype html><html lang="en"><body><h1><span lang="hi">प्रिया</span> AI</h1></body></html>`,
    );
    const cleanCoverage = await page.evaluate(langTagAudit);
    if (cleanCoverage.findings.length > 0) {
      throw new Error(
        `self-test: clean lang-tag fixture flagged ${cleanCoverage.findings.length} finding(s). The rule set is over-firing.`,
      );
    }

    // False tagging: an ASCII-only word wrongly given lang="hi" directly.
    await page.setContent(`<!doctype html><html lang="hi"><body><p lang="hi">AI</p></body></html>`);
    const dirtyAscii = await page.evaluate(langTagAudit);
    if (!dirtyAscii.findings.some((f) => f.kind === "lang-hi-ascii-only")) {
      throw new Error(
        "self-test: planted lang-hi-ascii-only violation not caught. The negative control did not fire.",
      );
    }

    // The same word, correctly INHERITING `hi` from an ancestor rather than
    // carrying the attribute itself — must be clean, the exact distinction
    // "no false tagging" above draws.
    await page.setContent(`<!doctype html><html lang="hi"><body><p>AI</p></body></html>`);
    const cleanAscii = await page.evaluate(langTagAudit);
    if (cleanAscii.findings.length > 0) {
      throw new Error(
        `self-test: an inherited (not own-attribute) lang="hi" ASCII word was flagged. ` +
          `${cleanAscii.findings.length} finding(s) — the own-attribute scoping is broken.`,
      );
    }
  } finally {
    await browser.close();
  }
}

async function main() {
  if (!existsSync(DIST)) {
    console.log("  skip  accessibility: dist/ absent, run `npx vite build` first");
    return 0;
  }
  const fixtureFiles = ["studio-layout-fixture.html", "room-layout-fixture.html"];
  const absent = fixtureFiles.filter((f) => !existsSync(join(DIST, f)));
  if (absent.length) {
    console.log(`FAIL  accessibility: ${absent.map((f) => `dist/${f}`).join(", ")} missing — vite inputs the gate needs to see the signed-in screens.`);
    return 1;
  }
  if (!existsSync(join(ROOT, "site", "vyakti.html"))) {
    console.log("FAIL  accessibility: site/vyakti.html missing — the /vyakti target has nothing to serve.");
    return 1;
  }

  let chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    console.log("  skip  accessibility: playwright not installed");
    return 0;
  }
  const executablePath = [
    process.env.CHROMIUM_PATH,
    "/opt/pw-browsers/chromium",
  ].find((p) => p && existsSync(p));

  let axeSource;
  try {
    axeSource = readFileSync(new URL("../node_modules/axe-core/axe.min.js", import.meta.url), "utf8");
  } catch {
    console.log("  skip  accessibility: axe-core not installed (npm install --save-dev axe-core)");
    return 0;
  }

  const t0 = Date.now();
  await selfTest(chromium, executablePath, axeSource);
  await selfTestLangTag(chromium, executablePath);

  const server = await serveDist();
  const browser = await chromium.launch(
    executablePath ? { executablePath, args: ["--no-sandbox"] } : { args: ["--no-sandbox"] },
  ).catch(() => null);
  if (!browser) {
    server.close();
    console.log("  skip  accessibility: no chromium binary available");
    return 0;
  }

  const axeFindings = []; // { where, impact, id, help, nodes }
  const kbFindings = [];
  const langFindings = []; // WS-R79: { where, kind, lang?, text }
  const counts = { critical: 0, serious: 0, moderate: 0, minor: 0 };
  let pagesScanned = 0;
  let devanagariNodesTotal = 0;
  let taggedHiElementsTotal = 0;

  async function scanOne(where, url, mountedSelector, mediaEmulation) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    if (mediaEmulation) await page.emulateMedia(mediaEmulation);
    const crashed = [];
    page.on("pageerror", (e) => crashed.push(e.message.slice(0, 160)));
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1200);

    const mounted = await page.evaluate((sel) => Boolean(document.querySelector(sel)), mountedSelector);
    if (!mounted) {
      axeFindings.push({
        where, impact: "critical", id: "coverage", help: crashed[0] ? `page threw: ${crashed[0]}` : `${where} did not mount at all — the gate is blind here`,
        nodes: [],
      });
      counts.critical++;
      await ctx.close();
      return;
    }

    await page.addScriptTag({ content: axeSource });
    const result = await page.evaluate(
      (tags) => window.axe.run(document, { runOnly: { type: "tag", values: tags } }),
      AXE_TAGS,
    );
    pagesScanned++;
    for (const v of result.violations) {
      counts[v.impact] = (counts[v.impact] || 0) + 1;
      // WS-R50: `nodes` used to cap at 3 with nothing recording how many
      // MORE matched the same rule, which is why three separate `--ink-faint`
      // fixes each turned up a fresh trio of elements the prior run's own
      // report never showed at all — the same rule, the same root cause, one
      // truncated report at a time. `nodesTotal` makes a truncated list
      // visible AS truncated; the console print below shows up to 12, and
      // `--json` carries the full list so a real finding never has an
      // element silently missing from what fixed it.
      axeFindings.push({
        where, impact: v.impact, id: v.id, help: v.help,
        nodesTotal: v.nodes.length,
        nodes: v.nodes.map((n) => n.target.join(" ")),
        detail: v.nodes.map((n) => n.failureSummary || "").filter(Boolean),
      });
    }

    // WS-R79: same page, same load, no extra navigation — folded in here on
    // `check-layout.mjs`'s own runtime-budget law ("no extra page load").
    const langResult = await page.evaluate(langTagAudit);
    devanagariNodesTotal += langResult.devanagariNodes;
    taggedHiElementsTotal += langResult.taggedHiElements;
    for (const f of langResult.findings) langFindings.push({ where, ...f });

    await ctx.close();
  }

  for (const target of TARGETS) {
    if (targetFilter && target.name !== targetFilter) continue;
    for (const { screen, url } of urlsFor(target)) {
      await scanOne(`${target.name}:${screen}`, url, target.mounted, null);
    }
  }

  // Reduced motion and forced-colors, each run once on the Room's talk
  // screen in English — the one screen a follower actually lives in.
  if (!targetFilter || targetFilter === "room") {
    const talkUrl = `http://127.0.0.1:${PORT}/room-layout-fixture.html?screen=talk`;
    await scanOne("room:talk(reduced-motion)", talkUrl, ".room-shell", { reducedMotion: "reduce" });
    await scanOne("room:talk(forced-colors)", talkUrl, ".room-shell", { forcedColors: "active" });
  }

  // ── the keyboard walk: room:talk and room:account, per the brief's law 2 ──
  if (!targetFilter || targetFilter === "room") {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const talkPage = await ctx.newPage();
    await talkPage.goto(`http://127.0.0.1:${PORT}/room-layout-fixture.html?screen=talk`, { waitUntil: "domcontentloaded" });
    await talkPage.waitForTimeout(1200);
    kbFindings.push(...(await walkTabOrder(talkPage, "room:talk")));
    kbFindings.push(...(await walkTalkActivation(talkPage)));

    const acctPage = await ctx.newPage();
    const gotoAccount = () =>
      acctPage
        .goto(`http://127.0.0.1:${PORT}/room-layout-fixture.html?screen=account`, { waitUntil: "domcontentloaded" })
        .then(() => acctPage.waitForTimeout(1200));
    await gotoAccount();
    kbFindings.push(...(await walkTabOrder(acctPage, "room:account")));
    // A successful Space press on "Close" below closes the page as a real
    // side effect (that IS the proof), so each of the next two checks reopens
    // it fresh rather than assuming what the previous one left behind.
    kbFindings.push(...(await walkAccountActivation(acctPage)));
    await gotoAccount();
    kbFindings.push(...(await walkAccountEscape(acctPage)));
    await ctx.close();
  }

  // ── WS-R84: a REAL locale switch, mid-session — the second proof named by
  // the workstream brief, alongside `evals/room-locale/run.mjs`'s own
  // server-side switch scenario. `?live=1` is the ONE fixture screen where
  // `switchLocale` is allowed to run for real (`RoomApp.tsx`'s own
  // `fixtureLiveLocaleSwitch` prop, `layoutFixture.tsx`'s own `op: "locale"`
  // stub) — every other target on this page still has that function
  // structurally blocked, unchanged. This clicks the real "हिन्दी" button and
  // re-checks the real resulting DOM.
  //
  // `langTagAudit` alone CANNOT prove this: a stale ENGLISH disclosure left
  // over from before the switch still tags itself `lang="en"` correctly
  // (WS-R79's own node-level detection does not care whether a string is
  // FRESH, only whether it is TAGGED for the script it is actually in), so a
  // regression that brings back `context/rejected.md#ws-r84-disclosure-
  // left-out-of-roomsetlocales-response` would sail through the language-tag
  // audit with zero findings. So this reads the disclosure card's own text
  // directly, before and after, and asserts it actually changed AND now
  // contains Devanagari — the freshness check `langTagAudit` structurally
  // cannot perform — and THEN runs `langTagAudit` on the same DOM as the
  // usual second layer, so a tagging regression introduced by the switch
  // itself (rather than by staleness) is still caught.
  if (!targetFilter || targetFilter === "room") {
    const where = "room:talk(locale-switch)";
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    await page.goto(`http://127.0.0.1:${PORT}/room-layout-fixture.html?screen=talk&live=1`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1200);
    const before = await page.evaluate(() => document.querySelector(".room-card")?.textContent || "");
    const clicked = await page.evaluate(() => {
      const btn = document.querySelector('.room-lang-btn[lang="hi"]');
      if (!(btn instanceof HTMLElement)) return false;
      btn.click();
      return true;
    });
    if (!clicked) {
      kbFindings.push({
        where, kind: "keyboard-coverage",
        detail: "the Hindi language button was not found — the live switch could not be exercised at all",
      });
    } else {
      // Poll rather than a fixed sleep: the switch is a real (stubbed)
      // network round trip, and a fixed wait is either flaky under load or
      // slower than it needs to be on a fast one.
      // `.room-shell`'s own `lang` attribute (`<main lang={locale}>`,
      // `RoomApp.tsx`), NOT `document.documentElement.lang` — the fixture
      // deliberately never sets the latter (`RoomApp.tsx`'s own `if
      // (fixtureOpen) return;` inside that effect, so every OTHER fixture
      // screen's `document.documentElement.lang` stays empty too); the
      // per-render JSX attribute is what actually carries the locale here,
      // and it is exactly what `langTagAudit`'s own `computedLang` walk
      // falls back to reading.
      let switched = false;
      for (let i = 0; i < 20; i++) {
        const lang = await page.evaluate(() => document.querySelector(".room-shell")?.getAttribute("lang"));
        if (lang === "hi") { switched = true; break; }
        await page.waitForTimeout(150);
      }
      if (!switched) {
        kbFindings.push({
          where, kind: "keyboard-activation",
          detail: 'clicking the Hindi language button never flipped .room-shell\'s own lang attribute to "hi" within 3s',
        });
      } else {
        const after = await page.evaluate(() => document.querySelector(".room-card")?.textContent || "");
        const DEVANAGARI_RE = /[ऀ-ॿ]/;
        if (after === before) {
          langFindings.push({
            where, kind: "lang-stale-disclosure-after-switch",
            text: "disclosure card text is byte-identical before and after the switch",
          });
        } else if (!DEVANAGARI_RE.test(after)) {
          langFindings.push({ where, kind: "lang-stale-disclosure-after-switch", text: after.slice(0, 60) });
        }
        const langResult = await page.evaluate(langTagAudit);
        devanagariNodesTotal += langResult.devanagariNodes;
        taggedHiElementsTotal += langResult.taggedHiElements;
        for (const f of langResult.findings) langFindings.push({ where, ...f });
        pagesScanned++;
      }
    }
    await ctx.close();
  }

  // ── the creator page, WS-R79's own target: `/c/<slug>` (`api/_creator-page.js`)
  // has no client app to navigate to — "this page's whole job is to BE the
  // content" (that file's own header) — so this calls the REAL, shipping
  // `buildCreatorPageHtml` directly, the same move `scripts/build-creator-
  // page-fixture.mjs` already makes for the performance/headers gates, fed a
  // Room whose OWN words (name, bio, showcase) are written in the locale
  // OTHER than the one requested: a Hindi-default-locale creator's page
  // opened via `?lang=en` — a search engine, or a shared link with the
  // "wrong" query string attached, the exact shape this workstream's brief
  // names ("an English page with the Hindi disclosure"). Not the SAME
  // fixture `check-headers.mjs`/`check-performance.mjs` build from
  // `dist/creator-page-fixture.html`: that one is deliberately all-English
  // (a realistic byte-size stand-in for THOSE gates' own budgets, untouched
  // here so neither gate's numbers move) — this one is deliberately
  // mismatched, because a fixture with nothing to mismatch could not prove
  // anything about tagging one way or the other.
  if (!targetFilter || targetFilter === "creator-page") {
    const { buildCreatorPageHtml } = await import(
      pathToFileURL(join(ROOT, "api/_creator-page.js")).href
    );
    const mismatchedRoom = {
      display_name: "प्रिया",
      one_line_bio: "भौतिकी हर दिन, सरल भाषा में।",
      default_locale: "hi",
    };
    const mismatchedShowcase = [
      {
        question: "Do you also help with chemistry?",
        answer: "Only physics for now, but I can point you to good resources.",
      },
      { question: "क्या आप रोज़ जवाब देते हैं?", answer: "हां, जब भी उपलब्ध होऊं।" },
    ];
    const html = buildCreatorPageHtml(
      { room: mismatchedRoom, showcase: mismatchedShowcase },
      { origin: "https://vyakti.app", slug: "priya", lang: "en" },
    );
    const where = "creator-page:mismatched-locale";
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    await page.setContent(html, { waitUntil: "domcontentloaded" });
    await page.addScriptTag({ content: axeSource });
    const result = await page.evaluate(
      (tags) => window.axe.run(document, { runOnly: { type: "tag", values: tags } }),
      AXE_TAGS,
    );
    pagesScanned++;
    for (const v of result.violations) {
      counts[v.impact] = (counts[v.impact] || 0) + 1;
      axeFindings.push({
        where, impact: v.impact, id: v.id, help: v.help,
        nodesTotal: v.nodes.length,
        nodes: v.nodes.map((n) => n.target.join(" ")),
        detail: v.nodes.map((n) => n.failureSummary || "").filter(Boolean),
      });
    }
    const langResult = await page.evaluate(langTagAudit);
    devanagariNodesTotal += langResult.devanagariNodes;
    taggedHiElementsTotal += langResult.taggedHiElements;
    for (const f of langResult.findings) langFindings.push({ where, ...f });
    await ctx.close();
  }

  // ── the follower transparency page, WS-R97's own target: `/r/<slug>/about`
  // (`api/_room-about.js`) has no client app to navigate to either -- the
  // creator-page block above's own reason, restated -- so this calls the
  // REAL, shipping `buildRoomAboutHtml` directly, fed a Room whose OWN
  // default locale is Hindi, requested via `?lang=en` -- the creator-page
  // block's own mismatched-locale shape, one surface over: the only
  // creator-authored free text this page ever shows is the creator's own
  // NAME, and a mismatch is the only fixture that can prove it is tagged
  // correctly rather than merely never wrong by accident.
  if (!targetFilter || targetFilter === "room-about") {
    const { buildRoomAboutHtml } = await import(
      pathToFileURL(join(ROOT, "api/_room-about.js")).href
    );
    const mismatchedRoom = {
      slug: "priya",
      display_name: "प्रिया",
      default_locale: "hi",
      dormancy_days: 365,
      free_monthly_messages: 20,
      paid_monthly_messages: 500,
      paid_monthly_voice_seconds: 1800,
    };
    const html = buildRoomAboutHtml(mismatchedRoom, { origin: "https://vyakti.app", slug: "priya", lang: "en" });
    const where = "room-about:mismatched-locale";
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    await page.setContent(html, { waitUntil: "domcontentloaded" });
    await page.addScriptTag({ content: axeSource });
    const result = await page.evaluate(
      (tags) => window.axe.run(document, { runOnly: { type: "tag", values: tags } }),
      AXE_TAGS,
    );
    pagesScanned++;
    for (const v of result.violations) {
      counts[v.impact] = (counts[v.impact] || 0) + 1;
      axeFindings.push({
        where, impact: v.impact, id: v.id, help: v.help,
        nodesTotal: v.nodes.length,
        nodes: v.nodes.map((n) => n.target.join(" ")),
        detail: v.nodes.map((n) => n.failureSummary || "").filter(Boolean),
      });
    }
    const langResult = await page.evaluate(langTagAudit);
    devanagariNodesTotal += langResult.devanagariNodes;
    taggedHiElementsTotal += langResult.taggedHiElements;
    for (const f of langResult.findings) langFindings.push({ where, ...f });
    await ctx.close();
  }

  // ── the Suite admin's transparency page, WS-R117's own target: `/suites/
  // about` (`api/_suites-about.js`) has no client app to navigate to either
  // -- the room-about block's own reason above, restated. Unlike that page,
  // this one carries no creator-authored free text at all (it is not
  // slug-scoped, `api/_suites-about.js`'s own header), so there is no
  // name-mismatch scenario to construct -- both locales are scanned
  // directly instead, the only way to catch a Devanagari-specific defect on
  // a page whose Hindi render is chosen entirely by its OWN copy table.
  if (!targetFilter || targetFilter === "suites-about") {
    const { buildSuitesAboutHtml } = await import(
      pathToFileURL(join(ROOT, "api/_suites-about.js")).href
    );
    for (const lang of ["en", "hi"]) {
      const html = buildSuitesAboutHtml({ origin: "https://vyakti.app", lang });
      const where = `suites-about:${lang}`;
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
      const page = await ctx.newPage();
      await page.setContent(html, { waitUntil: "domcontentloaded" });
      await page.addScriptTag({ content: axeSource });
      const result = await page.evaluate(
        (tags) => window.axe.run(document, { runOnly: { type: "tag", values: tags } }),
        AXE_TAGS,
      );
      pagesScanned++;
      for (const v of result.violations) {
        counts[v.impact] = (counts[v.impact] || 0) + 1;
        axeFindings.push({
          where, impact: v.impact, id: v.id, help: v.help,
          nodesTotal: v.nodes.length,
          nodes: v.nodes.map((n) => n.target.join(" ")),
          detail: v.nodes.map((n) => n.failureSummary || "").filter(Boolean),
        });
      }
      const langResult = await page.evaluate(langTagAudit);
      devanagariNodesTotal += langResult.devanagariNodes;
      taggedHiElementsTotal += langResult.taggedHiElements;
      for (const f of langResult.findings) langFindings.push({ where, ...f });
      await ctx.close();
    }
  }

  // ── the follower's READABLE export (WS-R108): `format:"html"` on the
  // session-scoped `export` op has no client app to navigate to either -
  // the creator-page/room-about blocks' own reason, restated a third time -
  // so this calls the REAL, shipping `buildRoomExportReadableHtml`
  // (`api/_room-export-readable.js`) directly, fed a representative export
  // object covering every one of `roomExport`'s three row/count/masked-phone
  // shapes plus a follower-typed handoff message, requested in Hindi - the
  // language walk below is the entire reason this target exists: every
  // column header is a raw, Latin-script DB identifier and every data cell
  // is arbitrary content, both tagged per-node rather than trusted from the
  // document's own `lang`, `api/_room-export-readable.js`'s own header names
  // why.
  if (!targetFilter || targetFilter === "room-export-readable") {
    const { buildRoomExportReadableHtml } = await import(
      pathToFileURL(join(ROOT, "api/_room-export-readable.js")).href
    );
    const fixtureExport = {
      room: "anjali",
      exported_at: "2026-09-05T10:00:00.000Z",
      tables: {
        vy_room_thread: [{ thread_id: "11111111-0000-4000-a000-000000000001", title: "getting started", created_at: "2026-09-01T00:00:00.000Z" }],
        vy_room_handoff: [{ handoff_id: "11111111-0000-4000-a000-000000000002", payload_text: "please can a human reply", state: "sent" }],
        vy_room_follower_day: { count: 3 },
        vy_room_follower_whatsapp: { count: 1, state: "active", phone_masked: "+91 ••••••56" },
      },
    };
    const html = buildRoomExportReadableHtml(fixtureExport, "hi");
    const where = "room-export-readable:hi";
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    await page.setContent(html, { waitUntil: "domcontentloaded" });
    await page.addScriptTag({ content: axeSource });
    const result = await page.evaluate(
      (tags) => window.axe.run(document, { runOnly: { type: "tag", values: tags } }),
      AXE_TAGS,
    );
    pagesScanned++;
    for (const v of result.violations) {
      counts[v.impact] = (counts[v.impact] || 0) + 1;
      axeFindings.push({
        where, impact: v.impact, id: v.id, help: v.help,
        nodesTotal: v.nodes.length,
        nodes: v.nodes.map((n) => n.target.join(" ")),
        detail: v.nodes.map((n) => n.failureSummary || "").filter(Boolean),
      });
    }
    const langResult = await page.evaluate(langTagAudit);
    devanagariNodesTotal += langResult.devanagariNodes;
    taggedHiElementsTotal += langResult.taggedHiElements;
    for (const f of langResult.findings) langFindings.push({ where, ...f });
    await ctx.close();
  }

  // ── the creator's printable payout statement (WS-R138): `format:"html"`
  // on the `payout_statement` op has no client app to navigate to either -
  // `room-export-readable`'s own reason one block up, restated for the
  // creator's own money instead of a follower's memory export. A
  // representative statement fixture covering every optional line the real
  // builder branches on (a Suite share WITH a name, referral rewards
  // funded, a provider reference, and both the settled date and a failure
  // reason at once - the accessibility walk cares about every node that can
  // exist, not about which real payout state combination produced it), in
  // both locales - the TDS disclosure sentence stays `lang="en"` in the
  // Hindi render (`api/_payout-statement-readable.js`'s own header names
  // why), so the Hindi pass is what actually proves that tag is there.
  if (!targetFilter || targetFilter === "payout-statement-readable") {
    const { buildPayoutStatementReadableHtml } = await import(
      pathToFileURL(join(ROOT, "api/_payout-statement-readable.js")).href
    );
    const fixtureStatement = {
      payout_id: "11111111-0000-4000-a000-000000000003",
      period_start: "2026-08-01T00:00:00.000Z",
      period_end: "2026-09-01T00:00:00.000Z",
      currency: "INR",
      rooms: [{ room_id: "11111111-0000-4000-a000-000000000004", slug: "anjali", display_name: "Anjali" }],
      gross_inr: 5000,
      take_inr: 1250,
      tds_inr: 0,
      net_inr: 3750,
      suite_share_inr: 1500,
      suite_name: "Acme Creators",
      referral_rewards: { count: 2, forgone_inr: 798 },
      follower_subscriptions: 12,
      state: "failed",
      provider_payout_ref: "fake_payout_0000000000000000000001",
      created_at: "2026-09-01T00:05:00.000Z",
      settled_at: null,
      failure_reason: "account_closed",
      tds_note:
        "TDS reflects the rate the platform operator has configured. Right now that rate is 0%, so nothing is withheld. " +
        "The operator believes Section 194J of India's Income Tax Act applies to a creator's Room earnings, but an accountant has not confirmed this, and the rate may change before any real payout is sent.",
    };
    for (const lang of ["en", "hi"]) {
      const html = buildPayoutStatementReadableHtml(fixtureStatement, lang);
      const where = `payout-statement-readable:${lang}`;
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
      const page = await ctx.newPage();
      await page.setContent(html, { waitUntil: "domcontentloaded" });
      await page.addScriptTag({ content: axeSource });
      const result = await page.evaluate(
        (tags) => window.axe.run(document, { runOnly: { type: "tag", values: tags } }),
        AXE_TAGS,
      );
      pagesScanned++;
      for (const v of result.violations) {
        counts[v.impact] = (counts[v.impact] || 0) + 1;
        axeFindings.push({
          where, impact: v.impact, id: v.id, help: v.help,
          nodesTotal: v.nodes.length,
          nodes: v.nodes.map((n) => n.target.join(" ")),
          detail: v.nodes.map((n) => n.failureSummary || "").filter(Boolean),
        });
      }
      const langResult = await page.evaluate(langTagAudit);
      devanagariNodesTotal += langResult.devanagariNodes;
      taggedHiElementsTotal += langResult.taggedHiElements;
      for (const f of langResult.findings) langFindings.push({ where, ...f });
      await ctx.close();
    }
  }

  await browser.close();
  server.close();
  const runtimeMs = Date.now() - t0;

  const serious = counts.critical + counts.serious;
  const failedByKeyboard = kbFindings.length > 0;
  const failedByLangTag = langFindings.length > 0;

  if (jsonOut) {
    const { writeFileSync } = await import("node:fs");
    writeFileSync(
      jsonOut,
      JSON.stringify(
        { counts, axeFindings, kbFindings, langFindings, devanagariNodesTotal, taggedHiElementsTotal, pagesScanned, runtimeMs },
        null,
        2,
      ),
    );
  }

  if (serious > 0 || failedByKeyboard || failedByLangTag) {
    console.log(
      `FAIL  accessibility: ${counts.critical} critical, ${counts.serious} serious, ` +
        `${counts.moderate} moderate, ${counts.minor} minor axe violation(s) across ${pagesScanned} page(s); ` +
        `${kbFindings.length} keyboard finding(s); ${langFindings.length} language-tag finding(s). ${runtimeMs}ms.`,
    );
    for (const f of axeFindings) {
      if (f.impact !== "critical" && f.impact !== "serious") continue;
      console.log(`\n      [${f.impact}] ${f.id} — ${f.where} (${f.nodesTotal} element(s))`);
      console.log(`        ${f.help}`);
      for (const n of f.nodes.slice(0, 12)) console.log(`        <${n}>`);
      if (f.nodesTotal > 12) console.log(`        ... and ${f.nodesTotal - 12} more (see --json)`);
      for (const d of (f.detail || []).slice(0, 12)) console.log(`        ${d.replace(/\n/g, "\n        ")}`);
    }
    for (const f of kbFindings) {
      console.log(`\n      [keyboard:${f.kind}] ${f.where}`);
      console.log(`        ${f.detail}`);
    }
    for (const f of langFindings) {
      console.log(`\n      [lang:${f.kind}] ${f.where}${f.lang ? ` (computed lang="${f.lang}")` : ""}`);
      console.log(`        "${f.text}"`);
    }
    if (counts.moderate || counts.minor) {
      console.log(`\n      (${counts.moderate} moderate, ${counts.minor} minor — reported, not blocking; see --json for detail)`);
    }
    return 1;
  }

  console.log(
    `  ok    accessibility: 0 critical/serious across ${pagesScanned} page(s) ` +
      `(${counts.moderate} moderate, ${counts.minor} minor reported), 0 keyboard findings, ` +
      `0 language-tag findings (${devanagariNodesTotal} Devanagari text node(s) checked, ` +
      `${taggedHiElementsTotal} own-attribute lang="hi" element(s) checked). ${runtimeMs}ms.`,
  );
  return 0;
}

process.exit(await main());
