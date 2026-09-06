// LAYOUT READABILITY GATE.
//
// Why this exists, stated plainly so nobody deletes it as redundant: the end to
// end journey passed 12 of 15 while the studio was rendering an 83 character
// paragraph 46 pixels wide, one word per line, on a 1355 pixel desktop. It
// passed because the checks asked the wrong question. "No horizontal overflow"
// was TRUE. "Primary action above the fold" was TRUE. Neither can see a column
// that has collapsed, because a collapsed column overflows nothing.
//
// The cause was a grid reserving a rail for a `.panel-index` child that a copy
// purge had correctly deleted. CSS kept a memory of a DOM that no longer
// existed. That is a class of bug, not an incident: any rule whose track list
// counts children breaks silently the moment a child is removed.
//
// So this gate asks the question a person asks: CAN I READ THIS. It renders the
// built studio in a real browser at real viewport widths and fails when a block
// of prose is too narrow to be prose, too small to read, too long to track
// across, sitting in a sliver, or wearing a label that does not contrast with
// its own button.
//
// It is deliberately NOT a screenshot diff. A screenshot test tells you
// something changed; it cannot tell you whether the change was good, and it
// fails on every legitimate edit until someone stops reading its output.
//
// WHAT IT LOOKS AT, AND WHY THAT IS THE WHOLE POINT
// ---------------------------------------------------------------------------
// The first version of this gate pointed at `/studio` and it could not see a
// single one of the panels it existed to judge, because signed out they do not
// render. It measured an empty screen and reported OK against the reintroduced
// bug. That is the same defect class it was written to catch.
//
// Signing in for real needs a Supabase service key, and a gate that needs a
// secret cannot run in CI. So the target is `studio-layout-fixture.html`: the
// REAL `StudioApp`, imported from source, with a replica in state and `/api/*`
// stubbed from fixtures. No secret, no network, deterministic, and every panel
// on screen. See `src/studio/layoutFixture.tsx`.
//
// THE NEGATIVE CONTROL IS PART OF THE GATE'S CLAIM. Reintroduce the 58px rail
// on `.processing-review` and this must fail; restore it and this must pass. If
// you change the checks, re-run that. A gate whose negative control does not
// fire is not a gate.

import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, win32 } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

function rootFromModuleUrl(moduleUrl, options) {
  return fileURLToPath(new URL("..", moduleUrl), options);
}

// Keep the exact Windows failure as a negative control. URL.pathname yields
// `/C:/...`; feeding that string to path.resolve on Windows produces
// `C:\\C:\\...`, so a successful build is mistaken for an absent dist/. This
// runs on every host by asking Node for Windows file-URL semantics explicitly.
function assertPortableRootResolution() {
  const fixture = "file:///C:/repo/scripts/check-layout.mjs";
  const expected = "C:\\repo\\";
  const actual = rootFromModuleUrl(fixture, { windows: true });
  const legacy = win32.resolve("C:\\gate-worktree", new URL("..", fixture).pathname);
  if (actual !== expected || legacy === expected) {
    throw new Error(`layout root portability regression: actual=${actual}, legacy=${legacy}`);
  }
}

assertPortableRootResolution();
const ROOT = rootFromModuleUrl(import.meta.url);
const DIST = join(ROOT, "dist");
const PORT = 8931;
// WS-R43. Screenshots of every room:*/room-hi:* screen, so the main loop can
// look at what the browser actually rendered rather than trust a pass/fail
// line. Gitignored (see .gitignore) and NEVER committed — this directory is
// evidence for a human reading the report, not a build artifact.
const SHOTS_DIR = join(ROOT, "evals", "room-browser", "shots");

// WS-R43. `--only room` runs the Room's own battery alone (matches any
// target name STARTING WITH the given prefix, so it also picks up
// `room-hi`, `room:more` and `room-hi:more` below) — useful while iterating
// on just this surface without paying for the studio/creators/suites
// targets' own page loads every time.
const CLI_ARGS = process.argv.slice(2);
const ONLY = CLI_ARGS.includes("--only") ? CLI_ARGS[CLI_ARGS.indexOf("--only") + 1] : null;

// Prose is judged in CHARACTERS PER LINE rather than pixels. An absolute pixel
// floor cannot be right at two viewport widths at once: 219px is a cramped
// column on a 1355px desktop and a perfectly ordinary one on a 390px phone.
// Characters per line asks the question directly, and it is the number the
// catastrophes fail by a mile: the collapsed panels measured 2 to 6 cpl.
const MIN_CPL = 20;
// Headings are the same question with a different answer, because tracking and
// wrapping are size-specific (DESIGN-LAW section 2). A 39px display heading
// three words to a line is a heading; 20 cpl would fail it for being large.
// Kept well above the catastrophes, which run 2 to 6 cpl at ANY size.
const MIN_CPL_DISPLAY = 12;
// The size at which text stops being prose and starts being a heading.
const DISPLAY_FROM_PX = 19;
// The other end. Past this a line is hard to track back to the next one; the
// studio measured 216 cpl on an 8px boundary statement before `--measure`.
const MAX_CPL = 115;
// `tokens.css` declares 11px the readable floor and says why: below it a
// teacher on a phone cannot read a consent label. One pixel of tolerance for
// rounding on a scaled viewport.
const MIN_FONT_PX = 10.5;
// Only judge blocks with enough text that a verdict is meaningful. A short
// label may legitimately sit in a narrow cell.
const MIN_CHARS_TO_JUDGE = 60;
// Below these, the page under test is not the page we meant to test. This pair
// is the assertion that stops the gate passing on an empty screen, which it
// once did: per screen the studio must have mounted and rendered panels, and
// across the whole run there must be a real amount of prose to have judged.
// Per-target now (TARGETS above), because a Room screen is one shell with one
// card in it and the studio's two would fail a page that is correct.
const MIN_TOTAL_BLOCKS = 150;
// WCAG AA for body-sized text. Disabled controls are exempt by the standard and
// are skipped, but they still have to clear the readability checks above.
const MIN_CONTRAST = 4.5;

// WS-R43. WCAG 2.5.8 (Target Size, Minimum): 24x24 CSS px is the SPEC floor,
// but the brief's own law 2 asks for 44 — the older 2.5.5 AAA figure, and the
// one a thumb on a real phone actually needs. Native, author-unmodified
// controls (a bare checkbox/radio) are exempt by the standard itself and are
// skipped below, never counted toward this floor.
const MIN_TAP_PX = 44;
// A figure this test measures as "the same number of glyphs" against tofu
// boxes of the same length has to differ by more than random advance-width
// noise before it means anything. The measured catastrophes this gate's own
// history describes were never marginal (a tofu run is EXACTLY uniform), so
// 10 is a floor with real margin under it, not a threshold tuned to the data.
// The width diff alone is NOT the whole test any more: a three-letter Hindi
// word with no matras ("गलत", "वजह") has letters whose advances happen to
// average out to a box's width (3.9% and 7.2% off, measured 2026-09-05 on
// WS-R61's strings, deterministic across runs), so `glyphAudit` also asks
// whether the letters are UNIFORM in width the way a tofu run is exactly
// uniform. A real run of Devanagari letters is never uniform; a run of
// .notdef boxes always is. See context/rejected.md#glyph-probe-width-diff-alone-flags-three-letter-matra-less-hindi-words.
const MIN_GLYPH_DIFF_PCT = 10;
// Letters closer than this (css px at GLYPH_PROBE_PX) count as "the same
// width" for the uniformity half of the test. A .notdef run differs by 0.
const GLYPH_UNIFORM_PX = 0.25;
// The font size the glyph probe renders at. Not "the real size on screen" for
// every one of 180 strings (this file's own strings render from 12 to 20px
// across the product) - one representative body size, applied identically to
// every string and to its own tofu control, so the comparison is apples to
// apples rather than a claim about any one screen's exact type scale.
const GLYPH_PROBE_PX = 16;

const VIEWPORTS = [
  { name: "phone", width: 390, height: 844 },
  { name: "tablet", width: 834, height: 1112 },
  { name: "desktop", width: 1355, height: 800 },
];
// WS-R1: the gate now measures TWO products, because the Room is a second
// surface with its own layout and the first version of this gate proved that a
// surface nobody points the gate at is a surface where the collapsed column
// lives. Each target names its fixture, the query it varies, and the selector
// that says "this page actually mounted" — everything else (the prose limits,
// the contrast floor, the overflow check) is shared, deliberately: two products
// of one company that disagree about what readable means is the failure this
// file exists to make visible.
//
// The Room fixture is required for the same reason the studio's is: every Room
// screen worth measuring is signed in, and pointed at the real page the gate
// would render "this room is not open" three times and report OK.
const TARGETS = [
  {
    name: "studio",
    fixture: "studio-layout-fixture.html",
    // WS-R65: "feed-mid" is not a real wizard step, `room:more`'s own
    // pattern of folding a scenario name into `steps` restated here -- it
    // is `?step=feed` again, but with `scenario=processing` layered on top
    // (`layoutFixture.tsx`'s own SCENARIOS table) so the Feed tab's new
    // path card (`CreatorPath.tsx`) renders with one source uploaded and
    // processing still running: some steps done, one current with its own
    // control, the rest still grey. `feed` alone (no scenario) already
    // covers the card's OTHER required fixture state, the first step,
    // nothing added yet -- this is the "middle step" the brief's law 4
    // asks this target to also render.
    //
    // WS-R72: "deploy-picker" is the SAME "feed-mid" pattern one step over --
    // `?step=deploy` again, `scenario=showcase-picker` layered on top so the
    // Share tab's Room is published (the base fixture's `room: null` never
    // mounts `ShowcaseCard` at all). Its picker is opened by a REAL CLICK on
    // `[data-picker-open="1"]` in the per-step loop below, `room:checkins`/
    // `room:handoff`'s own WS-R43 law ("never a fixture prop pre-opening
    // it"), never a second scenario flag.
    query: (step) => (
      step === "feed-mid" ? "mode=teacher&step=feed&scenario=processing"
        : step === "deploy-picker" ? "mode=teacher&step=deploy&scenario=showcase-picker"
        : `mode=teacher&step=${step}`
    ),
    steps: ["feed", "feed-mid", "meet", "deploy", "deploy-picker"],
    mounted: ".studio-shell, .studio-layout",
    panels: ".wizard-band, .consent-panel, .processing-review, .mirror-call, .hear-voice",
    minPanels: 2,
  },
  // WS-R31: the same fixture, now measuring the NEW top of the studio rather
  // than the panels underneath it. `studio` above already exercises this
  // page (the shell is `VITE_STUDIO_SHELL` unset = on, so it is what
  // `studio-layout-fixture.html` renders by default), but its own selectors
  // (`.wizard-band` and friends) match the OLD rail's panel tree and would
  // stay green even if the tab bar or the headline sentence collapsed to a
  // sliver. This target's selectors are scoped to the shell's own elements
  // so a narrow tab, a truncated headline sentence or a low-contrast primary
  // control fails here specifically, on all three tabs at every viewport
  // this gate already covers (390 / 834 / 1355 - the shared `VIEWPORTS`
  // array every target in this file uses).
  {
    name: "studio:shell",
    fixture: "studio-layout-fixture.html",
    query: (step) => `mode=teacher&step=${step}`,
    steps: ["feed", "meet", "deploy"],
    mounted: ".studio-tabshell",
    panels: ".studio-tabbar, .studio-shell-headline, .studio-tab",
    minPanels: 2,
  },
  // WS-R52: the SAME two studio targets above, with the chrome in Hindi
  // (Devanagari, Noto Sans Devanagari) instead of English -- `room-hi`'s own
  // reason two targets up, restated for the creator's own studio: a
  // creator's chrome is now bilingual (src/studio/copy.ts, migration 112)
  // and a collapsed Devanagari column is exactly the defect class this gate
  // exists to catch, so it needs its own measured target rather than
  // trusting the English one to stand in for it.
  {
    name: "studio-hi",
    fixture: "studio-layout-fixture.html",
    // WS-R65: `studio`'s own "feed-mid" restated in Hindi, `studio-hi`'s
    // own reason for existing at all -- a collapsed Devanagari column in
    // the path card's step list or its current-step sentence needs its own
    // measured target, not the English one standing in for it.
    // WS-R72: "deploy-picker" restated in Hindi, `studio`'s own reason above.
    query: (step) => (
      step === "feed-mid" ? "mode=teacher&step=feed&scenario=processing&lang=hi"
        : step === "deploy-picker" ? "mode=teacher&step=deploy&scenario=showcase-picker&lang=hi"
        : `mode=teacher&step=${step}&lang=hi`
    ),
    steps: ["feed", "feed-mid", "meet", "deploy", "deploy-picker"],
    mounted: ".studio-shell, .studio-layout",
    panels: ".wizard-band, .consent-panel, .processing-review, .mirror-call, .hear-voice",
    minPanels: 2,
  },
  {
    name: "studio:shell-hi",
    fixture: "studio-layout-fixture.html",
    query: (step) => `mode=teacher&step=${step}&lang=hi`,
    steps: ["feed", "meet", "deploy"],
    mounted: ".studio-tabshell",
    panels: ".studio-tabbar, .studio-shell-headline, .studio-tab",
    minPanels: 2,
  },
  // WS-R91. The one studio screen no fixture reached before: signed OUT, in
  // Hindi (`?lang=hi&signedOut=1` -- `layoutFixture.tsx`'s own `SIGNED_OUT`
  // branch, which now clears any session an earlier target in this same
  // viewport's context already seeded rather than merely skipping seeding
  // it). Phone only, `room:more`/`room:taste`'s own reason: a NEW screen
  // state gets its own measured target rather than folding into `studio-hi`
  // above, whose `steps` are all signed-in wizard steps this screen has
  // none of. `AuthGate.tsx`'s own header states why this screen exists to
  // measure at all: WS-R82 found it painted zero Hindi; this workstream
  // fixed that and this target is what proves it stays fixed.
  {
    name: "studio-hi:signed-out",
    fixture: "studio-layout-fixture.html",
    query: () => "lang=hi&signedOut=1",
    steps: ["signin"],
    mounted: ".auth-page",
    panels: ".auth-intro, .auth-card",
    minPanels: 2,
    onlyViewport: "phone",
  },
  // WS-R135. The ops board is Hindi now (`context/decisions.md#ws-r135-ops-
  // board-gains-its-own-locale-resolution`), so it needs its own measured
  // target the same way every other Hindi-bearing screen in this file does
  // -- a NEW screen state no earlier target reached (`layoutFixture.tsx`'s
  // own `/api/ops` fixture route, counts only). `?mode=ops` mounts `OpsBoard`
  // instead of `StudioApp` in the SAME fixture (`layoutFixture.tsx`'s own
  // `OPS_MODE` branch) so this gate needs no second HTML entry to keep in
  // sync with the studio's stub-fetch/auth-seed plumbing.
  {
    name: "studio:ops",
    fixture: "studio-layout-fixture.html",
    query: () => "mode=ops",
    steps: ["ops"],
    mounted: ".ops-board",
    panels: ".ops-board__panel, .ops-board__room",
    minPanels: 2,
  },
  {
    name: "studio-hi:ops",
    fixture: "studio-layout-fixture.html",
    query: () => "mode=ops&lang=hi",
    steps: ["ops"],
    mounted: ".ops-board",
    panels: ".ops-board__panel, .ops-board__room",
    minPanels: 2,
  },
  {
    name: "room",
    fixture: "room-layout-fixture.html",
    query: (screen) => `screen=${screen}`,
    // The three screens with completely different layouts. `join` carries the
    // longest prose in the product (the disclosure card plus the whole memory
    // question); `talk` is the conversation, whose bubbles are the one block
    // here that is allowed to be narrow and must still clear the floor;
    // `account` (WS-R39) is the follower's own settings page, an overlay
    // stacked over `talk` with the most SECTIONS of any screen in the product
    // - the one place a narrow column would most easily go unnoticed among
    // several short blocks rather than one long one.
    steps: ["join", "talk", "account"],
    mounted: ".room-shell",
    panels: ".room-card, .room-join, .room-thread, .room-cap, .room-menu, .room-gone",
    // A Room screen is one shell with one card in it; two is the studio's
    // number and would fail a page that is correct.
    minPanels: 1,
  },
  // WS-R24: the SAME screens, with the chrome in Hindi (Devanagari, Noto Sans
  // Devanagari) instead of English. A separate target rather than a third
  // `step` on `room` above, because `MIN_CPL`/`MAX_CPL`/`MIN_FONT_PX` are
  // typeface-and-script-sensitive and a collapsed Devanagari column is
  // exactly the defect class this whole gate exists to catch - measuring only
  // the English chrome would leave the follower-facing screen most likely to
  // actually be read in Hindi unmeasured by this gate entirely.
  {
    name: "room-hi",
    fixture: "room-layout-fixture.html",
    query: (screen) => `screen=${screen}&lang=hi`,
    steps: ["join", "talk", "account"],
    mounted: ".room-shell",
    panels: ".room-card, .room-join, .room-thread, .room-cap, .room-menu, .room-gone",
    minPanels: 1,
  },
  // WS-R43. Four screens no fixture reached before ("Hindi glyphs
  // unverified" open since WS-R24 for a mechanical reason: three of the
  // Room's seven screens had no fixture path at all). A SEPARATE target
  // from `room` above, restricted to the phone viewport only via
  // `onlyViewport` (the brief's own law 2 scopes tap-target/overflow/clip
  // checks to 390x844 specifically) — folding these into `room`'s `steps`
  // would run all four at every one of the three shared VIEWPORTS for
  // coverage the brief never asked for, tripling their cost against the
  // two-minute runtime budget for no assertion this file makes anywhere.
  // `--only room` still reaches this target (name STARTS WITH "room").
  {
    name: "room:more",
    fixture: "room-layout-fixture.html",
    query: (screen) => `screen=${screen}`,
    // WS-R59 adds "install" (the card, `fixtureInstallPrompt`) and "offline"
    // (the shell's own honest offline card, `fixturePhase: "offline"`) —
    // same `room:more`/`onlyViewport: "phone"` target the brief's own law 4
    // points at ("wire it inside the existing... gate as one more target"),
    // never a new named gate. WS-R63: "checkins" and "handoff" load CLOSED
    // now (`layoutFixture.tsx`'s own header) — the per-step loop below
    // clicks the real opener before `audit()` runs, the law-2 assertion
    // that catches a dialog opening off screen or unfocused.
    steps: ["checkins", "handoff", "capped", "receipt", "install", "offline"],
    mounted: ".room-shell",
    panels: ".room-card, .room-join, .room-thread, .room-cap, .room-menu, .room-gone",
    minPanels: 1,
    onlyViewport: "phone",
  },
  {
    name: "room-hi:more",
    fixture: "room-layout-fixture.html",
    query: (screen) => `screen=${screen}&lang=hi`,
    steps: ["checkins", "handoff", "capped", "receipt", "install", "offline"],
    mounted: ".room-shell",
    panels: ".room-card, .room-join, .room-thread, .room-cap, .room-menu, .room-gone",
    minPanels: 1,
    onlyViewport: "phone",
  },
  // WS-R53: the taste, a stranger's own first screen ahead of `join` above -
  // its own target rather than a fifth `room:more` step, because the
  // workstream's own law 4 asks for it by name and this screen's panel
  // class (`.room-taste`) is not one `room`/`room:more`'s shared selector
  // already names. Phone only, `room:more`'s own reason: the brief's law 2
  // scopes tap-target/overflow/clip checks to 390x844.
  {
    name: "room:taste",
    fixture: "room-layout-fixture.html",
    query: (screen) => `screen=${screen}`,
    steps: ["taste"],
    mounted: ".room-shell",
    panels: ".room-taste",
    minPanels: 1,
    onlyViewport: "phone",
  },
  {
    name: "room-hi:taste",
    fixture: "room-layout-fixture.html",
    query: (screen) => `screen=${screen}&lang=hi`,
    steps: ["taste"],
    mounted: ".room-shell",
    panels: ".room-taste",
    minPanels: 1,
    onlyViewport: "phone",
  },
  // WS-R45: the creator directory, `site/creators.html`. Unlike `studio` and
  // `room` this page needs no signed-in fixture at all - it is PUBLIC and
  // unauthenticated by construction, so the real static file (see
  // vite.config.ts's own comment on why it emits to `dist/site/creators.html`
  // under this gate's plain `vite build` rather than `dist/creators.html`) is
  // both the production page and its own fixture. `minPanels: 2` because the
  // hero heading and at least one list card (a real creator, or the honest
  // loading/empty/error status card the page always renders instead of
  // nothing) are the floor for "this page actually rendered something",
  // `room`'s own "one shell, one card" reasoning at one panel more since the
  // directory's hero and its list are two structurally different regions.
  {
    name: "creators",
    fixture: "site/creators.html",
    query: () => "",
    steps: ["directory"],
    mounted: ".creators-shell",
    panels: ".creators-hero, .creators-card",
    minPanels: 2,
  },
  // WS-R24's own reason, restated one surface over: `MIN_CPL`/`MAX_CPL`/
  // `MIN_FONT_PX` are typeface-and-script-sensitive, so the Hindi chrome
  // needs its own measured target rather than trusting the English one to
  // stand in for it.
  {
    name: "creators-hi",
    fixture: "site/creators.html",
    query: () => "lang=hi",
    steps: ["directory"],
    mounted: ".creators-shell",
    panels: ".creators-hero, .creators-card",
    minPanels: 2,
  },
  // WS-R48. Suites' own B2B front door. Unlike every target above, this page
  // needs no signed-in fixture at all: it is a public, static page (no
  // React, no /api stub) that only redirects to /studio, which is already
  // measured elsewhere in this file. So its fixture is served straight from
  // `site/`, not `dist/` — the ONE target in this file with `dir: "site"` —
  // rather than adding it as a vite build entry for a page that ships no
  // build step by design (site/suites.html's own header names that rule).
  // `steps` is the locale, not a screen: "en" and "hi" are the SAME page at
  // `?lang=hi`, site/suites.html's own toggle, `room-hi`'s own pattern one
  // target up.
  {
    name: "suites",
    dir: "site",
    fixture: "suites.html",
    query: (locale) => (locale === "hi" ? "lang=hi" : ""),
    steps: ["en", "hi"],
    // Scoped to the ACTIVE locale wrapper only (`.locale:not([hidden])`),
    // never the bare `.hero, section` selector: both locale blocks sit in
    // the DOM at once (the toggle sets `[hidden]`, never removes a node),
    // so an unscoped count would read the same total on `en` and `hi`
    // regardless of whether the Hindi block actually un-hid — exactly the
    // "a check that saw nothing must not report OK" failure this gate's own
    // header names, one layer down from a collapsed column.
    mounted: ".locale:not([hidden])",
    panels: ".locale:not([hidden]) .hero, .locale:not([hidden]) section",
    minPanels: 2,
  },
];

// WS-R43: `--only <prefix>` runs just the targets whose name starts with
// that prefix (`room` reaches `room`, `room-hi`, `room:more` and
// `room-hi:more` — every one of this workstream's targets, none of the
// studio/creators/suites ones) — everything below reads ACTIVE_TARGETS, not
// TARGETS, so a filtered run is not just faster but reports its own true
// coverage rather than a count that still names pages it never opened.
const ACTIVE_TARGETS = ONLY ? TARGETS.filter((t) => t.name.startsWith(ONLY)) : TARGETS;

/** Every (viewport, target, screen) the run covers. Derived rather than
 *  written down, so adding a target cannot leave the coverage line lying.
 *  `onlyViewport` (WS-R43) targets run at ONE viewport, not every one. */
const SCREEN_COUNT = ACTIVE_TARGETS.reduce(
  (n, t) => n + t.steps.length * (t.onlyViewport ? 1 : VIEWPORTS.length),
  0,
);
const SCREEN_NAMES = ACTIVE_TARGETS.map((t) => `${t.name}:${t.steps.join("/")}`).join(", ");

const MIME = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png",
  ".woff2": "font/woff2", ".ico": "image/x-icon",
};

function serveDist() {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
    let path = join(DIST, url.pathname === "/" ? "index.html" : url.pathname.slice(1));
    if (url.pathname === "/studio") path = join(DIST, "studio.html");
    try {
      const body = await readFile(path);
      res.writeHead(200, { "content-type": MIME[extname(path)] || "application/octet-stream" });
      res.end(body);
      return;
    } catch {
      // fall through to the `site/` fallback below
    }
    // WS-R48: `site/suites.html` (and, by the same rule, any future page in
    // this file's `dir: "site"` shape) is a plain static file `npx vite
    // build` never writes to `dist/` — it is copied there only by
    // `scripts/vercel-build.sh`, which this gate does not run. Serving it
    // straight from `site/` on a `dist/` miss lets the ONE static-page
    // target in this file work without adding a fake vite entry for a page
    // that ships no build step on purpose.
    try {
      const sitePath = join(ROOT, "site", url.pathname === "/" ? "index.html" : url.pathname.slice(1));
      const body = await readFile(sitePath);
      res.writeHead(200, { "content-type": MIME[extname(sitePath)] || "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404).end("not found");
    }
  });
  return new Promise((ok) => server.listen(PORT, "127.0.0.1", () => ok(server)));
}

/** Runs INSIDE the page. Returns every layout complaint it can measure. */
function audit(limits) {
  const vis = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return false;
    const cs = getComputedStyle(el);
    return cs.display !== "none" && cs.visibility !== "hidden" && Number(cs.opacity) !== 0;
  };
  // The element's OWN text, not its descendants'. A wrapper div is not a
  // paragraph, and judging it as one produces noise that gets the gate ignored.
  const ownText = (el) => {
    let t = "";
    for (const n of el.childNodes) if (n.nodeType === 3) t += n.textContent;
    return t.trim();
  };
  const name = (el) => {
    const cls = typeof el.className === "string" && el.className.trim()
      ? "." + el.className.trim().split(/\s+/).slice(0, 2).join(".")
      : "";
    return el.tagName.toLowerCase() + cls;
  };
  const out = [];
  const add = (kind, detail) => out.push({ kind, ...detail });

  // ── 1. prose: readable width, readable size, trackable line length ───────
  let judged = 0;
  for (const el of document.querySelectorAll("p, h1, h2, h3, h4, li, dd, span, div, label, figcaption")) {
    if (!vis(el)) continue;
    const text = ownText(el);
    if (text.length < limits.chars) continue;
    judged++;
    const r = el.getBoundingClientRect();
    if (r.width <= 0) continue;
    const fs = parseFloat(getComputedStyle(el).fontSize);
    // Half the font size is a decent mean glyph advance for this type at these
    // sizes. It is an estimate and it only needs to be right to about 15% for
    // thresholds this far apart.
    const cpl = r.width / (fs * 0.5);
    const floor = fs >= limits.displayFrom ? limits.minCplDisplay : limits.minCpl;
    if (cpl < floor) {
      add("narrow", { el: name(el), n: Math.round(cpl), unit: "cpl", px: Math.round(r.width), text: text.slice(0, 44) });
    } else if (cpl > limits.maxCpl) {
      add("long", { el: name(el), n: Math.round(cpl), unit: "cpl", px: Math.round(r.width), text: text.slice(0, 44) });
    }
    if (fs < limits.minFont) {
      add("small", { el: name(el), n: fs.toFixed(1), unit: "px", px: Math.round(r.width), text: text.slice(0, 44) });
    }
  }

  // ── 2. THE CLASS, half one: a track reserved for a child that is not there.
  // A pseudo-element does not appear in `children` but DOES occupy a track, so
  // it is counted or every chevron row reads as a false positive.
  for (const g of document.querySelectorAll("*")) {
    if (!vis(g)) continue;
    const cs = getComputedStyle(g);
    if (!cs.display.includes("grid")) continue;
    const tracks = cs.gridTemplateColumns.split(/\s+/).filter(Boolean).map(parseFloat);
    if (tracks.length < 2 || tracks.some(Number.isNaN)) continue;
    const kids = [...g.children].filter((k) => {
      if (!vis(k)) return false;
      const kcs = getComputedStyle(k);
      return kcs.position !== "absolute" && kcs.position !== "fixed";
    });
    let pseudo = 0;
    for (const which of ["::before", "::after"]) {
      const pcs = getComputedStyle(g, which);
      if (pcs && pcs.content && pcs.content !== "none" && pcs.content !== "normal") pseudo++;
    }
    const filled = kids.length + pseudo;
    if (kids.length === 0 || filled >= tracks.length) continue;
    const wasted = tracks.slice(filled).reduce((s, w) => s + w, 0);
    if (wasted > 8) {
      add("track", { el: name(g), n: Math.round(wasted), unit: "px wasted",
        px: tracks.length, text: `${tracks.length} tracks, ${filled} filled: ${cs.gridTemplateColumns}` });
    }
  }

  // ── 3. THE CLASS, half two: a real text child auto-flowed into a track that
  // was reserved for a pseudo-element. Track count and child count AGREE here,
  // so the check above is blind to it, and the symptom is a paragraph rendered
  // a chevron wide. This is what put a 128 character sentence in 16px.
  for (const g of document.querySelectorAll("*")) {
    if (!vis(g)) continue;
    const cs = getComputedStyle(g);
    if (!cs.display.includes("grid")) continue;
    if (cs.gridTemplateColumns.split(/\s+/).filter(Boolean).length < 2) continue;
    for (const k of g.children) {
      if (!vis(k)) continue;
      const kcs = getComputedStyle(k);
      if (kcs.position === "absolute" || kcs.position === "fixed") continue;
      const t = (k.textContent || "").trim();
      const r = k.getBoundingClientRect();
      if (t.length >= 40 && r.width > 0 && r.width < 60) {
        add("sliver", { el: `${name(g)} > ${name(k)}`, n: Math.round(r.width), unit: "px",
          px: Math.round(r.width), text: t.slice(0, 44) });
      }
    }
  }

  // ── 4. a control whose label does not read against its own background ────
  // WS-R1: `color(srgb 0.96 0.95 0.91 / 0.92)` is how Chrome serializes a
  // `color-mix()` background, and its components are 0..1 rather than 0..255.
  // Read as 0..255 they are all essentially ZERO, so the walker below accepted
  // a paper-coloured header as near-black and reported a 14:1 label at 1.18:1.
  // A gate that fails a correct page is as expensive as one that passes a
  // broken one: it teaches people to stop reading its output. So the two
  // serializations are parsed as the two different things they are.
  const parseColor = (s) => {
    const m = String(s).match(/[\d.]+(?:e-?\d+)?/g);
    if (!m) return null;
    const n = m.slice(0, 4).map(Number);
    if (/^color\(/.test(String(s).trim())) {
      return [n[0] * 255, n[1] * 255, n[2] * 255, n[3] ?? 1];
    }
    return n;
  };
  const luminance = ([r, g, b]) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const backdrop = (el) => {
    let cur = el;
    while (cur) {
      const c = parseColor(getComputedStyle(cur).backgroundColor);
      if (c && (c[3] ?? 1) > 0.85) return c.slice(0, 3);
      cur = cur.parentElement;
    }
    return [255, 255, 255];
  };
  for (const el of document.querySelectorAll("button, .button, a.button")) {
    const label = (el.textContent || "").trim();
    if (!label || !vis(el)) continue;
    // Disabled controls are exempt from the contrast floor by WCAG.
    if (el.disabled === true || el.getAttribute("aria-disabled") === "true") continue;
    const r = el.getBoundingClientRect();
    if (r.width < 10 || r.height < 10) continue;
    const cs = getComputedStyle(el);
    const fg = parseColor(cs.color);
    if (!fg) continue;
    const bg = backdrop(el);
    const alpha = (fg[3] ?? 1) * Number(cs.opacity);
    const eff = [0, 1, 2].map((i) => fg[i] * alpha + bg[i] * (1 - alpha));
    const l1 = luminance(eff), l2 = luminance(bg);
    const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    if (ratio < limits.minContrast) {
      add("contrast", { el: name(el), n: ratio.toFixed(2), unit: ":1", px: 0, text: label.slice(0, 44) });
    }
  }

  // ── 5. THE STICKY PAGER MUST NEVER COME BACK (WS-AP, owner directive) ────
  // A fixed bar used to sit at the foot of every step with a "Next:" button
  // that pointed at a step it simultaneously called refused. Owner, verbatim:
  // "Remove it. Not shrink it, not reword it, not make it conditional. Delete
  // it." This is the negative control staying ARMED rather than a one-time
  // fix: `.wizard-pager` returning, or ANY button labelled "Next: " anywhere
  // on the page, fails here, on every step, at every width. Reintroduce
  // `StepPager`'s old JSX and this must fail; the run that proved it is in
  // `context/rejected.md#the-sticky-pager-was-deleted-not-shrunk`.
  for (const el of document.querySelectorAll(".wizard-pager")) {
    if (!vis(el)) continue;
    add("pager-returned", { el: name(el), n: 1, unit: "", text: "a .wizard-pager element rendered" });
  }
  for (const el of document.querySelectorAll("button, .button, a.button")) {
    if (!vis(el)) continue;
    const label = (el.textContent || "").trim();
    if (label.startsWith("Next: ")) {
      add("pager-returned", { el: name(el), n: 1, unit: "", text: label.slice(0, 44) });
    }
  }

  // ── 6. WS-R43 law 2: tap target size, clipped text, tabular figures ──────
  // Scoped by `limits.roomChecks` (Node passes it true only for a `room*`
  // target at the 390px viewport) rather than by a selector, because the
  // brief's own law names 390x844 specifically and this file already has a
  // clean seam for "only at this one viewport" in the per-target loop below
  // - repeating the width test in-page would be the same rule stated twice,
  // which is how the two disagree the day only one of them is edited.
  if (limits.roomChecks) {
    // WCAG 2.5.8 (Target Size, Minimum) exempts a control at its native,
    // author-unmodified size (a bare checkbox or radio) and an inline link
    // inside a run of text - both are skipped rather than flagged, because
    // neither is a defect this product introduced.
    for (const el of document.querySelectorAll(
      'a[href], button, input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]), select, textarea, [role="button"], [tabindex]:not([tabindex="-1"])',
    )) {
      if (!vis(el)) continue;
      if (el.disabled === true || el.getAttribute("aria-disabled") === "true") continue;
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0 && (r.width < limits.minTap || r.height < limits.minTap)) {
        add("tap-target", {
          el: name(el),
          n: `${Math.round(r.width)}x${Math.round(r.height)}`,
          unit: "px",
          px: Math.round(Math.min(r.width, r.height)),
          text: (el.textContent || el.getAttribute("aria-label") || el.placeholder || "").trim().slice(0, 44),
        });
      }
    }

    // Text never clipped: the element's own scrollable content must fit its
    // own box. A container the author deliberately made horizontally
    // scrollable (`.room-rail`'s thread list) is excluded - that is a
    // feature, not the defect this check exists to catch.
    for (const el of document.querySelectorAll("p, h1, h2, h3, h4, span, div, label, li, dd, button, a")) {
      if (!vis(el)) continue;
      if (!ownText(el)) continue;
      const cs = getComputedStyle(el);
      if (cs.overflowX === "auto" || cs.overflowX === "scroll") continue;
      if (el.scrollWidth > el.clientWidth + 1) {
        add("clipped", {
          el: name(el),
          n: el.scrollWidth - el.clientWidth,
          unit: "px overflow",
          px: el.clientWidth,
          text: ownText(el).slice(0, 44),
        });
      }
    }

    // Every figure `room.css`'s `.room-num` marks as a number a follower
    // actually reads (a price, a date, a count) renders with tabular digits.
    for (const el of document.querySelectorAll(".room-num")) {
      if (!vis(el)) continue;
      const fv = getComputedStyle(el).fontVariantNumeric;
      if (!fv.includes("tabular-nums")) {
        add("not-tabular", { el: name(el), n: fv || "(none)", unit: "", text: ownText(el).slice(0, 44) });
      }
    }
  }

  // COVERAGE, asked structurally rather than by counting paragraphs. A phone
  // screen legitimately carries less prose than a desktop one, because the
  // bands start collapsed there, so a prose-count floor per screen either
  // fails on a healthy phone or is set so low it would pass on a broken one.
  // What is NOT negotiable is that the studio actually mounted and this is the
  // step we asked for. If that is true and the prose is thin, the screen is
  // thin; if it is false, the gate is blind and must say so.
  // The two selectors are passed IN rather than hardcoded, because this gate
  // now measures two surfaces and a hardcoded studio selector would make the
  // Room's coverage assertion vacuously false (or, worse, vacuously true).
  const mounted = Boolean(document.querySelector(limits.mountedSelector));
  const stepTitle = document.querySelector(".wizard-step-title, h1, h2");
  const panels = document.querySelectorAll(limits.panelSelector).length;

  return {
    findings: out,
    judged,
    mounted,
    panels,
    heading: stepTitle ? (stepTitle.textContent || "").trim().slice(0, 40) : "",
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  };
}

const EXPLAIN = {
  narrow: "prose too narrow to hold a line. Usually a grid or flex track reserving\n        space for a child that no longer exists, or a two-column grid splitting a\n        container that is already narrow.",
  long: "lines too long to track back to the next one. Cap prose with --measure.",
  small: "text below the readable floor. tokens.css sets --text-micro (11px) as the\n        minimum and says why: a teacher on a phone reads consent labels at this size.",
  track: "a grid reserves a column for a child that is not in the DOM. This is the\n        exact bug that shipped: remove a child, and CSS keeps its column.",
  sliver: "a real text child auto-flowed into a track reserved for a pseudo-element\n        (usually a chevron). Pin the text children to their column explicitly.",
  contrast: "a control's label does not read against its own background. DESIGN-LAW\n        section 3: that is a shipping defect, not a preference.",
  coverage: "the gate could not see the panels it exists to judge. Do not 'fix' this by\n        lowering the threshold; fix what stopped the fixture rendering.",
  overflow: "the document scrolls sideways.",
  "pager-returned": "the sticky forward-nav pager is back. Owner directive, 2026-08-26: delete it,\n        do not shrink or reword it. See context/rejected.md#the-sticky-pager-was-deleted-not-shrunk.",
  "tap-target": "an interactive control is smaller than 44x44 css px (WCAG 2.5.8) at 390x844.\n        A thumb, not a mouse, is this product's real pointer.",
  clipped: "an element's own text does not fit its own box (scrollWidth > clientWidth).\n        Usually a fixed width or a missing wrap set against real copy, not the short\n        placeholder a component was built against.",
  "not-tabular": "a `.room-num` figure does not render with tabular digits (room.css). A count\n        or a price whose digits are proportional reflows its own neighbours as it changes.",
  "motion-not-reduced": "with prefers-reduced-motion: reduce active, an element still has a\n        transition-duration or animation-duration above 0s. tokens.css's own\n        reduced-motion block should have zeroed every --motion-* token; something\n        here is not reading from it.",
  "pointerdown-feedback": "DESIGN-LAW's press feedback did not fire: a real mouse down/up over an\n        enabled control produced no visible transform change, or it did not clear on release.",
  glyph: "a Hindi string measured no differently from the same number of tofu boxes\n        (U+25A1) in the page's own font stack AND its letters measured uniform in\n        width the way only a run of .notdef boxes is - the glyph rendered as boxes,\n        not letters. Names the copy.ts key that failed.",
  "glyph-control": "the glyph probe's own control failed: three Unicode noncharacters, which\n        no font has a glyph for, did not measure uniform in width, so the probe could\n        not tell real tofu from letters on this machine. Fix the probe or the font\n        stack, never the threshold.",
  "dialog-in-view": "a Room dialog opened by a real click on its header button is not fully on\n        screen, or did not open at all - see the finding's own text. Every in-flow dialog\n        must scroll itself into view on open (`useDialogInView.ts`); it must never rely on\n        the opener already being scrolled to the right place.\n        See context/rejected.md#ws-r43-room-dialogs-render-in-flow-not-scrolled-into-view.",
  "dialog-focus": "a Room dialog opened by a real click never received focus (`document.activeElement`\n        stayed outside it after the click). A keyboard or screen reader user gets no signal\n        the dialog opened at all - `useDialogInView.ts`'s own job.",
  "room-card": "the Room's og.png/story.png (WS-R55, api/_room-card.js): either the\n        rasterised PNG's own dimensions or non-blank-pixel test failed, or the\n        bundled Devanagari face measured no differently from tofu boxes when the\n        card's own Hindi disclosure sentence was rendered through it - the\n        bundled font is missing, unreadable, or not the one actually shipping.",
};

/** WS-R43 law 3, the reduced-motion half. Runs INSIDE the page, after
 *  `page.emulateMedia({ reducedMotion: "reduce" })` has been set on the
 *  ALREADY-LOADED page — a media query change repaints the existing DOM with
 *  no navigation needed, which is what keeps this whole extra pass cheap. A
 *  tiny standalone `name()` rather than sharing `audit()`'s: `page.evaluate`
 *  serialises each function independently, so nothing here can import a
 *  helper defined in another one. */
function motionAudit() {
  const name = (el) => {
    const cls = typeof el.className === "string" && el.className.trim()
      ? "." + el.className.trim().split(/\s+/).slice(0, 2).join(".")
      : "";
    return el.tagName.toLowerCase() + cls;
  };
  const parseDur = (s) => {
    let max = 0;
    for (const part of String(s).split(",")) {
      const m = part.trim().match(/^([\d.]+)(ms|s)$/);
      if (!m) continue;
      const ms = m[2] === "s" ? parseFloat(m[1]) * 1000 : parseFloat(m[1]);
      if (ms > max) max = ms;
    }
    return max;
  };
  const bad = [];
  for (const el of document.querySelectorAll("*")) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    const cs = getComputedStyle(el);
    const td = parseDur(cs.transitionDuration);
    const ad = parseDur(cs.animationDuration);
    // A one-frame tolerance (16ms): some engines report a rounded 0.001s
    // rather than an exact 0s for a token that DID collapse.
    if (td > 16 || ad > 16) bad.push({ el: name(el), td: Math.round(td), ad: Math.round(ad) });
    if (bad.length >= 12) break;
  }
  return bad;
}

/** WS-R43 law 1, run inside the page against the REAL, live copy table
 *  (`window.__ROOM_HI_STRINGS__` or, WS-R52, `window.__STUDIO_HI_STRINGS__`
 *  — `stringsGlobal` names which; both are set by their own `layoutFixture.tsx`
 *  from the actual import, never a list re-typed in this file, which is
 *  exactly the kind of copy that goes stale the day a string is added to one
 *  side and not the other). `fontStack` is read from the page's own computed
 *  style, not hardcoded, so this cannot silently stop meaning anything the
 *  day a `:lang(hi)` rule changes. WS-R52 generalised the ONE hardcoded
 *  global into a parameter rather than copying this function a second time
 *  — the brief's own instruction — so both callers share every future fix
 *  to the measurement itself. */
function glyphAudit({ fontStack, px, minDiffPct, uniformPx, stringsGlobal }) {
  const pairs = window[stringsGlobal || "__ROOM_HI_STRINGS__"] || [];
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  // Devanagari block, U+0900-U+097F. The width-diff test's whole premise is
  // "a run of REAL glyphs is not uniform width the way a run of identical
  // tofu boxes is" - a premise that needs a real RUN to say anything. A
  // string like "+91" or "+91XXXXXXXXXX" (both ASCII, zero Devanagari
  // codepoints) or "तक" (two) is either not a Devanagari-rendering risk at
  // all, or too short for "percent different from uniform" to mean more than
  // sampling noise. Three is the floor: enough that a genuine tofu run (which
  // is EXACTLY uniform, this file's own measured catastrophes) still clears
  // the 10% bar with margin, low enough that it excludes only the numeral-
  // and-placeholder strings this repo's own copy actually contains.
  const MIN_DEVANAGARI_CHARS = 3;
  const devanagariCount = (s) => (s.match(/[ऀ-ॿ]/g) || []).length;
  // The second half of the test (2026-09-05): a run of REAL letters is not
  // uniform in width; a run of .notdef boxes is EXACTLY uniform. Only base
  // letters are measured one at a time - a matra or a sign (U+093A-U+094F,
  // U+0951-U+0957, U+0962-U+0963) measures as zero or as its base's width
  // and would make a real word look uniform or a tofu run look varied.
  const BASE_LETTER = /[\u0904-\u0939\u0958-\u0961\u0972-\u097F]/;
  const uniformWidths = (s, fontSpec) => {
    ctx.font = fontSpec;
    const widths = [...s].filter((ch) => BASE_LETTER.test(ch)).map((ch) => ctx.measureText(ch).width);
    if (widths.length < MIN_DEVANAGARI_CHARS) return null;
    return Math.max(...widths) - Math.min(...widths) < (uniformPx ?? 0.25);
  };
  const out = [];
  for (const [key, s] of pairs) {
    if (!s) continue;
    const fontSpec = `${px}px ${fontStack}`;
    const fontsCheck = document.fonts.check(fontSpec, s);
    ctx.font = fontSpec;
    const real = ctx.measureText(s).width;
    const boxes = "□".repeat(s.length);
    ctx.font = fontSpec;
    const tofu = ctx.measureText(boxes).width;
    const diffPct = tofu > 0 ? (Math.abs(real - tofu) / tofu) * 100 : 0;
    const testable = devanagariCount(s) >= MIN_DEVANAGARI_CHARS;
    // null when the string has fewer than three base letters (matras and
    // signs made up the count): the width diff alone decides, as before.
    const uniform = testable ? uniformWidths(s, fontSpec) : null;
    out.push({
      key, s, fontsCheck, testable, uniform,
      real: Math.round(real), tofu: Math.round(tofu), diffPct: Math.round(diffPct * 10) / 10,
    });
  }
  // The uniformity detector's own control, run every time: three Unicode
  // noncharacters (U+FDD0..U+FDD2) have no glyph in any font and render as
  // the same .notdef box, so they MUST measure uniform. If they do not, the
  // detector is blind to real tofu and the whole probe reports that instead
  // of a pass. Measured directly rather than through BASE_LETTER's filter,
  // which would drop them.
  const fontSpecCtl = `${px}px ${fontStack}`;
  ctx.font = fontSpecCtl;
  const ctlWidths = ["\uFDD0", "\uFDD1", "\uFDD2"].map((ch) => ctx.measureText(ch).width);
  const controlUniform = Math.max(...ctlWidths) - Math.min(...ctlWidths) < (uniformPx ?? 0.25);
  return {
    n: pairs.length,
    testableN: out.filter((r) => r.testable).length,
    controlUniform,
    // `r.uniform === true`, not `!== false`. `testable` (this function's
    // entry gate, above) counts every Devanagari codepoint including
    // matras, because a full word needs three of THOSE to make the width-
    // diff percentage meaningful; `uniformWidths` counts only BASE letters,
    // because a matra "measures as zero or as its base's width" and would
    // make a real word look uniform. Those two counts read the same string
    // differently on purpose, and a word with exactly two base consonants
    // plus one matra (three Devanagari codepoints, so testable; two base
    // letters, so uniformWidths returns null, neither confirmed uniform nor
    // confirmed varied) used to fall through `!== false` as still
    // flag-eligible on width-diff alone — treating "the second signal
    // could not be measured" as though it had said "yes, tofu". Real
    // Hindi "सभी" (2026-09-06, WS-R77's own CI font-install run, the first
    // time this repo's own detector ran against the CSS's actual first-
    // choice font rather than a system substitute) measured 9.6% width diff
    // against three boxes with `uniform: null`, and used to be flagged
    // outright. Requiring the uniformity test to have POSITIVELY said
    // "uniform" closes the gap without moving `MIN_GLYPH_DIFF_PCT` (rejected
    // once already, `context/rejected.md#glyph-probe-width-diff-alone-flags-
    // three-letter-matra-less-hindi-words`, and not touched here either) and
    // without changing anything for the three-or-more-base-letter case the
    // WS-R61 fix was built for: `true === true` and `false === true` are
    // exactly the outcomes `!== false` already gave them. See
    // `context/rejected.md#ws-r77-glyph-uniform-null-treated-as-not-disproven-instead-of-not-confirmed`.
    results: out.filter((r) => !r.fontsCheck
      || (r.testable && r.diffPct <= minDiffPct && r.uniform === true)),
  };
}

async function main() {
  if (!existsSync(DIST)) {
    console.log("  skip  layout readability: dist/ absent, run `npx vite build` first");
    return 0;
  }
  // Not a skip, for ANY target. A fixture is a build input (or, for a
  // `dir: "site"` target, a plain static file this gate serves straight
  // from `site/` — see serveDist()'s own comment); if one is missing, the
  // gate has been silently disabled for that surface, and silently disabled
  // is how the first version of this gate failed.
  const fixtureRoot = (t) => (t.dir === "site" ? join(ROOT, "site") : DIST);
  const absent = ACTIVE_TARGETS.filter((t) => !existsSync(join(fixtureRoot(t), t.fixture)));
  if (absent.length) {
    console.log(
      `FAIL  layout readability: ${absent.map((t) => `${t.dir === "site" ? "site" : "dist"}/${t.fixture}`).join(", ")} missing.`,
    );
    console.log("        They are vite inputs in vite.config.ts (or, for site/, a checked-in static");
    console.log("        page) and the only way this gate can see these screens. Restore them rather");
    console.log("        than skipping the check.");
    return 1;
  }
  let chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    console.log("  skip  layout readability: playwright not installed");
    return 0;
  }
  const executablePath = [
    process.env.CHROMIUM_PATH,
    "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  ].find((p) => p && existsSync(p));

  const server = await serveDist();
  const browser = await chromium.launch(
    executablePath ? { executablePath, args: ["--no-sandbox"] } : { args: ["--no-sandbox"] },
  ).catch(() => null);
  if (!browser) {
    server.close();
    console.log("  skip  layout readability: no chromium binary available");
    return 0;
  }

  const limits = {
    chars: MIN_CHARS_TO_JUDGE, minCpl: MIN_CPL, maxCpl: MAX_CPL,
    minCplDisplay: MIN_CPL_DISPLAY, displayFrom: DISPLAY_FROM_PX,
    minFont: MIN_FONT_PX, minContrast: MIN_CONTRAST, minTap: MIN_TAP_PX,
  };
  const findings = [];
  let totalJudged = 0;
  // WS-R43: strings measured by the glyph probe, filled in by the dedicated
  // pass after this loop so the summary line can report a real n.
  let glyphN = 0;
  let glyphTestableN = 0;
  let shotsWritten = 0;
  if (ACTIVE_TARGETS.some((t) => t.name.startsWith("room"))) {
    mkdirSync(SHOTS_DIR, { recursive: true });
  }

  for (const vp of VIEWPORTS) {
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
    const page = await ctx.newPage();
    const crashed = [];
    page.on("pageerror", (e) => crashed.push(e.message.slice(0, 120)));

    for (const target of ACTIVE_TARGETS) {
      // WS-R43: `onlyViewport` targets (the four new Room screens) run at ONE
      // viewport, per that target's own comment in TARGETS above.
      if (target.onlyViewport && target.onlyViewport !== vp.name) continue;
      // WS-R43 law 2 is scoped to the Room at 390x844 specifically.
      const roomChecks = target.name.startsWith("room") && vp.name === "phone";
      const perTarget = {
        ...limits,
        mountedSelector: target.mounted,
        panelSelector: target.panels,
        roomChecks,
      };
      for (const step of target.steps) {
        const where = `${vp.name}/${target.name}:${step}`;
        await page.goto(
          `http://127.0.0.1:${PORT}/${target.fixture}?${target.query(step)}`,
          { waitUntil: "domcontentloaded" },
        );
        await page.waitForTimeout(1800);

        // WS-R63 law 2: the "checkins"/"handoff" steps of `room:more`/
        // `room-hi:more` now load CLOSED, on a conversation taller than the
        // viewport (`FIXTURE_TURNS_LONG`, layoutFixture.tsx) — a REAL click
        // on the header opener (`[data-dialog-open]`, locale-independent by
        // design so `room-hi`'s Hindi label never has to be matched) is
        // what opens the dialog every check below then measures, never a
        // fixture prop pre-opening it. This is the assertion
        // `#ws-r43-room-dialogs-render-in-flow-not-scrolled-into-view` asked
        // for and no gate made before it: after the click, the opened
        // dialog's own bounding box must intersect the viewport and
        // `document.activeElement` must be inside it. No extra page load —
        // the same already-open page every other check in this step already
        // shares, per the brief's own runtime-budget law.
        if (roomChecks && (step === "checkins" || step === "handoff")) {
          const opener = page.locator(`[data-dialog-open="${step}"]`);
          if (await opener.count().catch(() => 0)) {
            await opener.click();
            // A generous margin over a smooth scroll's own duration (the
            // hook's default, `prefers-reduced-motion` unset at this point
            // in the run) - the bounding-box check below depends on the
            // scroll having actually finished, unlike the focus check,
            // which is synchronous with the effect that starts it.
            await page.waitForTimeout(700);
            const seen = await page.evaluate((cls) => {
              const el = document.querySelector(`.room-${cls}[role="dialog"]`);
              if (!el) return { opened: false, inView: false, focusInside: false };
              const r = el.getBoundingClientRect();
              const inView = r.bottom > 0 && r.top < window.innerHeight && r.right > 0 && r.left < window.innerWidth;
              const focusInside = document.activeElement ? el.contains(document.activeElement) : false;
              return { opened: true, inView, focusInside };
            }, step);
            if (!seen.opened) {
              findings.push({
                where, kind: "dialog-in-view", el: "dialog", n: 0, unit: "",
                text: `clicking [data-dialog-open="${step}"] did not open .room-${step}[role="dialog"]`,
              });
            } else {
              if (!seen.inView) {
                findings.push({
                  where, kind: "dialog-in-view", el: "dialog", n: 0, unit: "",
                  text: "opened but its bounding box does not intersect the viewport",
                });
              }
              if (!seen.focusInside) {
                findings.push({
                  where, kind: "dialog-focus", el: "dialog", n: 0, unit: "",
                  text: "opened but document.activeElement is not inside it",
                });
              }
            }
          } else {
            findings.push({
              where, kind: "dialog-in-view", el: "opener", n: 0, unit: "",
              text: `[data-dialog-open="${step}"] not found - the button this step depends on is gone`,
            });
          }
        }

        // WS-R72: the SAME "real click, never a fixture prop pre-opening it"
        // law, one step over. `[data-picker-open="1"]` is `ShowcaseCard.tsx`'s
        // own "Pick from your reviews" button on slot 1, locale-independent
        // by the same design as `[data-dialog-open]` above so `studio-hi`'s
        // Hindi label never has to be matched.
        if (step === "deploy-picker") {
          const opener = page.locator('[data-picker-open="1"]');
          if (await opener.count().catch(() => 0)) {
            await opener.click();
            await page.waitForTimeout(300);
            const opened = await page.evaluate(
              () => Boolean(document.querySelector(".vy-room__showcase-picker")),
            );
            if (!opened) {
              findings.push({
                where, kind: "picker-open", el: "picker", n: 0, unit: "",
                text: 'clicking [data-picker-open="1"] did not open .vy-room__showcase-picker',
              });
            }
          } else {
            findings.push({
              where, kind: "picker-open", el: "opener", n: 0, unit: "",
              text: '[data-picker-open="1"] not found - the button this step depends on is gone',
            });
          }
        }

        const { findings: got, judged, mounted, panels, overflow } = await page.evaluate(
          audit,
          perTarget,
        );
        totalJudged += judged;

        // A CHECK THAT SAW NOTHING MUST NOT REPORT OK.
        if (!mounted || panels < target.minPanels) {
          findings.push({ where, kind: "coverage", el: "document", n: panels, unit: " panels",
            text: crashed[0] ? `page threw: ${crashed[0]}`
              : mounted ? `${target.name} mounted but rendered almost nothing`
                : `${target.name} did not mount at all` });
        }
        if (overflow > 2) {
          findings.push({ where, kind: "overflow", el: "document", n: overflow, unit: "px", text: "sideways scroll" });
        }
        for (const f of got) findings.push({ where, ...f });

        // WS-R43 laws 3 and 6: screenshots, reduced motion, pointerdown
        // feedback — all on the SAME already-loaded page, so none of this
        // costs a second navigation. Room only, phone only (law 2's scope).
        if (roomChecks) {
          const shotName = `${target.name.replace(":", "-")}-${step}.png`;
          // `fullPage: true`: `.room-menu`/`.room-cap`/`.room-gone` are plain
          // in-flow blocks (room.css), not a fixed overlay, so a dialog
          // opened from the header renders BELOW the fold on a real phone.
          // A viewport-only screenshot of "checkins" or "handoff" would show
          // the unopened talk screen underneath it and nothing this
          // workstream built. `.room-composer` is `position: sticky` (real,
          // deliberate CSS for normal scrolling) - Playwright's full-page
          // capture stitches the page in viewport-height sections and a
          // sticky element re-pins itself in EACH one, so it can appear
          // baked into the middle of the composite image. A temporary style
          // override for the screenshot ALONE (never touching the page the
          // checks above already measured) avoids that artifact; nothing
          // here changes what law 2's assertions saw.
          await page.addStyleTag({ content: ".room-composer { position: static !important; }" }).catch(() => {});
          await page.screenshot({ path: join(SHOTS_DIR, shotName), fullPage: true }).catch(() => {});
          await page
            .evaluate(() => document.querySelectorAll("style").forEach((s) => {
              if (s.textContent?.includes("room-composer { position: static")) s.remove();
            }))
            .catch(() => {});
          shotsWritten++;

          // Pointerdown feedback, BEFORE emulating reduced motion (the law
          // 3 brief's own two halves: this half needs the transition ON).
          const control = await page
            .locator('.room-send:not([disabled]), .room-btn:not([disabled]), .room-menu-open')
            .first();
          if (await control.count().catch(() => 0)) {
            const box = await control.boundingBox().catch(() => null);
            if (box) {
              // Settle by POLLING, not by a fixed wait: `--motion-instant`
              // (tokens.css) is 90ms, and reading `transform` mid-transition
              // returns a real but MOVING matrix that equals neither endpoint.
              // A fixed 120ms margin was enough on a quiet machine and flaked
              // under load (wave eleven, eight sibling gates on four cores:
              // "transform did not clear on page.mouse.up()" on a control
              // that clears fine), so each read waits up to 1500ms for the
              // expected endpoint and only then reports what it saw. A
              // healthy control settles in one or two polls; only a broken
              // one pays the full bound.
              const readTransform = () => control.evaluate((el) => getComputedStyle(el).transform).catch(() => null);
              const settle = async (reached) => {
                const t0 = Date.now();
                let v = await readTransform();
                while (!reached(v) && Date.now() - t0 < 1500) {
                  await page.waitForTimeout(40);
                  v = await readTransform();
                }
                return v;
              };
              const rest = await readTransform();
              await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
              await page.mouse.down();
              const down = await settle((v) => v !== null && v !== rest);
              await page.mouse.up();
              const up = await settle((v) => v !== null && v === rest);
              if (rest !== null && down !== null && rest === down) {
                findings.push({ where, kind: "pointerdown-feedback", el: "control", n: 0, unit: "",
                  text: "transform did not change on page.mouse.down()" });
              } else if (up !== null && rest !== null && up !== rest) {
                findings.push({ where, kind: "pointerdown-feedback", el: "control", n: 0, unit: "",
                  text: "transform did not clear on page.mouse.up()" });
              }
            }
          }

          // Reduced motion, same loaded DOM, no navigation.
          await page.emulateMedia({ reducedMotion: "reduce" });
          const motionBad = await page.evaluate(motionAudit);
          await page.emulateMedia({ reducedMotion: "no-preference" });
          for (const m of motionBad) {
            findings.push({ where, kind: "motion-not-reduced", el: m.el, n: `t${m.td}/a${m.ad}`, unit: "ms",
              text: "transition/animation duration above 0 under reduced motion" });
          }
        }
      }
    }
    await ctx.close();
  }

  // WS-R43 law 1: the glyph probe, one dedicated pass, only when a room-hi
  // family target is actually in scope for this run. Reuses no page from the
  // loop above (contexts are already closed) — a fresh, cheap phone-viewport
  // context, one navigation, one evaluate call for all ~180 strings at once.
  if (ACTIVE_TARGETS.some((t) => t.name.startsWith("room-hi"))) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    await page.goto(`http://127.0.0.1:${PORT}/room-layout-fixture.html?screen=join&lang=hi`, {
      waitUntil: "domcontentloaded",
    });
    await page.waitForTimeout(800);
    const fontStack = await page
      .locator(".room-shell")
      .first()
      .evaluate((el) => getComputedStyle(el).fontFamily)
      .catch(() => '"Noto Sans Devanagari", "Noto Sans", "Nirmala UI", "Mangal", sans-serif');
    const { n, testableN, controlUniform, results } = await page.evaluate(glyphAudit, {
      fontStack,
      px: GLYPH_PROBE_PX,
      minDiffPct: MIN_GLYPH_DIFF_PCT,
      uniformPx: GLYPH_UNIFORM_PX,
    });
    glyphN = n;
    glyphTestableN = testableN;
    if (!controlUniform) {
      findings.push({ where: "room-hi:glyph", kind: "glyph-control", el: "U+FDD0..U+FDD2", n: "", unit: "",
        text: "three noncharacters did not measure uniform" });
    }
    for (const r of results) {
      findings.push({
        where: "room-hi:glyph",
        kind: "glyph",
        el: r.key,
        n: r.fontsCheck ? `${r.diffPct}%` : "fonts.check=false",
        unit: "",
        text: r.s.slice(0, 44),
      });
    }
    await ctx.close();
  }

  // WS-R55: the Room's pictures. Not an HTML target (there is no page to
  // navigate to - `renderRoomCard`/`rasterizeRoomCard` are pure/near-pure
  // functions, `api/_room-card.js`), so this does not go through the
  // TARGETS/VIEWPORTS loop above. It renders the REAL card through the REAL
  // module and checks the one thing a missing or wrong font would break
  // silently: dimensions, non-blank pixels (via `sharp`, `scripts/check-contrast.mjs`'s
  // own decoder), and - reusing `glyphAudit` exactly as WS-R43 wrote it,
  // fed this card's own Hindi disclosure sentence instead of
  // `window.__ROOM_HI_STRINGS__` - that the BUNDLED face (loaded into a
  // fresh page via a `data:` URI `@font-face`, never a system font) shapes
  // that sentence into something measurably unlike a run of tofu boxes.
  //
  // Gated the same courtesy way the `room-hi` glyph pass above gates
  // itself: a `--only <other-target>` run is an explicit request for a
  // PARTIAL, fast run, and this block (a font decode plus a full page
  // render) is not free.
  if (!ONLY || ONLY === "room-card") {
    const sharp = await import("sharp").then((m) => m.default, () => null);
    const { ROOM_CARD_SIZES, ROOM_CARD_KINDS, cardInputFor, rasterizeRoomCard } = await import(
      pathToFileURL(join(ROOT, "api/_room-card.js")).href
    );
    const rows = {
      en: { display_name: "Anjali Sharma", one_line_bio: "JEE physics, one doubt at a time.", default_locale: "en" },
      hi: { display_name: "प्रिया", one_line_bio: "हिन्दी में बात करें, हर दिन।", default_locale: "hi" },
      platform: null,
    };
    for (const kind of ROOM_CARD_KINDS) {
      const { width, height } = ROOM_CARD_SIZES[kind];
      for (const [label, row] of Object.entries(rows)) {
        const png = await rasterizeRoomCard(cardInputFor(row, kind));
        if (!sharp) {
          findings.push({ where: `room-card:${kind}/${label}`, kind: "room-card", el: "sharp",
            n: 0, unit: "", text: "sharp not installed - cannot decode the PNG to check it" });
          continue;
        }
        const meta = await sharp(png).metadata();
        if (meta.width !== width || meta.height !== height) {
          findings.push({ where: `room-card:${kind}/${label}`, kind: "room-card", el: "dimensions",
            n: `${meta.width}x${meta.height}`, unit: "", text: `expected ${width}x${height}` });
        }
        const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
        let nonPaper = 0;
        for (let i = 0; i < data.length; i += info.channels) {
          // PAPER is #f4f1e9; anything meaningfully off that background
          // (ink, the accent bar, glyph edges) counts as "drawn on".
          if (Math.abs(data[i] - 0xf4) > 8 || Math.abs(data[i + 1] - 0xf1) > 8 || Math.abs(data[i + 2] - 0xe9) > 8) nonPaper++;
        }
        const totalPx = data.length / info.channels;
        if (nonPaper < totalPx * 0.01) {
          findings.push({ where: `room-card:${kind}/${label}`, kind: "room-card", el: "non-blank",
            n: `${((nonPaper / totalPx) * 100).toFixed(2)}%`, unit: " of pixels drawn on", text: "card looks blank" });
        }
      }
    }

    const fontPath = join(
      ROOT,
      "node_modules/@expo-google-fonts/noto-sans-devanagari/400Regular/NotoSansDevanagari_400Regular.ttf",
    );
    const fontBase64 = readFileSync(fontPath).toString("base64");
    const hiDisclosure = "आप प्रिया AI से बात कर रहे हैं। यह प्रिया नहीं है।";
    const ctx = await browser.newContext({ viewport: { width: 600, height: 200 } });
    const page = await ctx.newPage();
    await page.setContent(
      `<!doctype html><html><head><style>
        @font-face { font-family: "Noto Sans Devanagari"; src: url(data:font/ttf;base64,${fontBase64}) format("truetype"); }
        body { font-family: "Noto Sans Devanagari", sans-serif; }
      </style></head><body><p id="probe">${hiDisclosure}</p></body></html>`,
    );
    await page.evaluate(() => document.fonts.ready);
    // This probe only ever measures ONE string, set directly rather than
    // via a real `ROOM_COPY_TABLE` (this fixture has no import of one) -
    // reusing `glyphAudit` unmodified means it still reads
    // `window.__ROOM_HI_STRINGS__`, so it is set here to exactly the one
    // pair this check needs before the SAME function WS-R43 wrote is called.
    await page.evaluate((s) => { window.__ROOM_HI_STRINGS__ = [["room-card-disclosure", s]]; }, hiDisclosure);
    const { results } = await page.evaluate(glyphAudit, {
      fontStack: '"Noto Sans Devanagari"',
      px: GLYPH_PROBE_PX,
      minDiffPct: MIN_GLYPH_DIFF_PCT,
      uniformPx: GLYPH_UNIFORM_PX,
    });
    for (const r of results) {
      findings.push({ where: "room-card:glyph", kind: "room-card", el: r.key,
        n: r.fontsCheck ? `${r.diffPct}%` : "fonts.check=false", unit: "", text: r.s.slice(0, 60) });
    }
    await ctx.close();
  }

  // WS-R52: the SAME probe, called (not copied — `glyphAudit`'s own header),
  // against the studio's own Hindi chrome, only when a studio-hi family
  // target is actually in scope for this run.
  if (ACTIVE_TARGETS.some((t) => t.name.startsWith("studio-hi") || t.name.startsWith("studio:shell-hi"))) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    await page.goto(`http://127.0.0.1:${PORT}/studio-layout-fixture.html?mode=teacher&step=feed&lang=hi`, {
      waitUntil: "domcontentloaded",
    });
    await page.waitForTimeout(800);
    const fontStack = await page
      .locator(".studio-shell")
      .first()
      .evaluate((el) => getComputedStyle(el).fontFamily)
      .catch(() => '"Noto Sans Devanagari", "Noto Sans", "Nirmala UI", "Mangal", sans-serif');
    const { n, testableN, controlUniform, results } = await page.evaluate(glyphAudit, {
      fontStack,
      px: GLYPH_PROBE_PX,
      minDiffPct: MIN_GLYPH_DIFF_PCT,
      uniformPx: GLYPH_UNIFORM_PX,
      stringsGlobal: "__STUDIO_HI_STRINGS__",
    });
    glyphN += n;
    glyphTestableN += testableN;
    if (!controlUniform) {
      findings.push({ where: "studio-hi:glyph", kind: "glyph-control", el: "U+FDD0..U+FDD2", n: "", unit: "",
        text: "three noncharacters did not measure uniform" });
    }
    for (const r of results) {
      findings.push({
        where: "studio-hi:glyph",
        kind: "glyph",
        el: r.key,
        n: r.fontsCheck ? `${r.diffPct}%` : "fonts.check=false",
        unit: "",
        text: r.s.slice(0, 44),
      });
    }
    await ctx.close();
  }

  await browser.close();
  server.close();

  // The run-wide half of the coverage assertion. Skipped under `--only`: a
  // filtered run is an explicit request for a PARTIAL run, and its own
  // summary line already states exactly what it covered - the same
  // "vacuously true" trap this gate's own header warns about, on the other
  // side: a fixed floor tuned for the full run would fail every honest
  // partial one.
  if (!ONLY && totalJudged < MIN_TOTAL_BLOCKS) {
    findings.push({ where: "whole run", kind: "coverage", el: "document",
      n: totalJudged, unit: " blocks",
      text: `only ${totalJudged} prose blocks across all ${SCREEN_COUNT} screens` });
  }

  if (findings.length) {
    // Group by kind so the output is a list of PROBLEMS, not a list of elements.
    const byKind = new Map();
    for (const f of findings) {
      if (!byKind.has(f.kind)) byKind.set(f.kind, []);
      byKind.get(f.kind).push(f);
    }
    console.log(`FAIL  layout readability: ${findings.length} finding(s) across ${SCREEN_COUNT} screen loads (${SCREEN_NAMES})`);
    for (const [kind, list] of byKind) {
      console.log(`\n      ${kind.toUpperCase()} (${list.length})`);
      const seen = new Set();
      for (const f of list) {
        const key = f.el + f.text;
        if (seen.has(key)) continue;
        seen.add(key);
        if (seen.size > 6) { console.log(`        ... and ${list.length - 6} more`); break; }
        console.log(`        ${f.where.padEnd(16)} ${String(f.n).padStart(6)}${f.unit}  <${f.el}>  "${f.text}"`);
      }
      console.log(`        ${EXPLAIN[kind] || ""}`);
    }
    return 1;
  }
  const glyphNote = glyphN
    ? `; ${glyphN} Hindi strings glyph-checked (${glyphTestableN} width-tested, ${glyphN - glyphTestableN} ASCII/too-short for the width test)`
    : "";
  const shotsNote = shotsWritten ? `; ${shotsWritten} screenshots in ${join("evals", "room-browser", "shots")}` : "";
  console.log(
    `  ok    layout readability: ${totalJudged} prose blocks judged across ${VIEWPORTS.map((v) => v.width).join(", ")}px x ${SCREEN_NAMES}${glyphNote}${shotsNote}`,
  );
  return 0;
}

process.exit(await main());
