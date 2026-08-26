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

import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";

const ROOT = resolve(new URL("..", import.meta.url).pathname);
const DIST = join(ROOT, "dist");
const PORT = 8931;
const FIXTURE = "studio-layout-fixture.html";

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
const MIN_PANELS_RENDERED = 2;
const MIN_TOTAL_BLOCKS = 150;
// WCAG AA for body-sized text. Disabled controls are exempt by the standard and
// are skipped, but they still have to clear the readability checks above.
const MIN_CONTRAST = 4.5;

const VIEWPORTS = [
  { name: "phone", width: 390, height: 844 },
  { name: "tablet", width: 834, height: 1112 },
  { name: "desktop", width: 1355, height: 800 },
];
const STEPS = ["feed", "meet", "deploy"];

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
  const parseColor = (s) => { const m = s.match(/[\d.]+/g); return m ? m.slice(0, 4).map(Number) : null; };
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

  // COVERAGE, asked structurally rather than by counting paragraphs. A phone
  // screen legitimately carries less prose than a desktop one, because the
  // bands start collapsed there, so a prose-count floor per screen either
  // fails on a healthy phone or is set so low it would pass on a broken one.
  // What is NOT negotiable is that the studio actually mounted and this is the
  // step we asked for. If that is true and the prose is thin, the screen is
  // thin; if it is false, the gate is blind and must say so.
  const mounted = Boolean(document.querySelector(".studio-shell, .studio-layout"));
  const stepTitle = document.querySelector(".wizard-step-title, h1, h2");
  const panels = document.querySelectorAll(".wizard-band, .consent-panel, .processing-review, .mirror-call, .hear-voice").length;

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
};

async function main() {
  if (!existsSync(DIST)) {
    console.log("  skip  layout readability: dist/ absent, run `npx vite build` first");
    return 0;
  }
  if (!existsSync(join(DIST, FIXTURE))) {
    // Not a skip. The fixture is a build input; if it is missing, the gate has
    // been silently disabled, and silently disabled is how the first one failed.
    console.log(`FAIL  layout readability: dist/${FIXTURE} is missing.`);
    console.log("        It is a vite input in vite.config.ts and the only way this gate can");
    console.log("        see the signed-in panels. Restore it rather than skipping the check.");
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
    minFont: MIN_FONT_PX, minContrast: MIN_CONTRAST,
  };
  const findings = [];
  let totalJudged = 0;

  for (const vp of VIEWPORTS) {
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
    const page = await ctx.newPage();
    const crashed = [];
    page.on("pageerror", (e) => crashed.push(e.message.slice(0, 120)));

    for (const step of STEPS) {
      const where = `${vp.name}/${step}`;
      await page.goto(`http://127.0.0.1:${PORT}/${FIXTURE}?mode=teacher&step=${step}`,
        { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(1800);

      const { findings: got, judged, mounted, panels, overflow } = await page.evaluate(audit, limits);
      totalJudged += judged;

      // A CHECK THAT SAW NOTHING MUST NOT REPORT OK.
      if (!mounted || panels < MIN_PANELS_RENDERED) {
        findings.push({ where, kind: "coverage", el: "document", n: panels, unit: " panels",
          text: crashed[0] ? `page threw: ${crashed[0]}`
            : mounted ? "the studio mounted but rendered almost no panels"
              : "the studio did not mount at all" });
      }
      if (overflow > 2) {
        findings.push({ where, kind: "overflow", el: "document", n: overflow, unit: "px", text: "sideways scroll" });
      }
      for (const f of got) findings.push({ where, ...f });
    }
    await ctx.close();
  }

  await browser.close();
  server.close();

  // The run-wide half of the coverage assertion.
  if (totalJudged < MIN_TOTAL_BLOCKS) {
    findings.push({ where: "whole run", kind: "coverage", el: "document",
      n: totalJudged, unit: " blocks",
      text: `only ${totalJudged} prose blocks across all ${VIEWPORTS.length * STEPS.length} screens` });
  }

  if (findings.length) {
    // Group by kind so the output is a list of PROBLEMS, not a list of elements.
    const byKind = new Map();
    for (const f of findings) {
      if (!byKind.has(f.kind)) byKind.set(f.kind, []);
      byKind.get(f.kind).push(f);
    }
    console.log(`FAIL  layout readability: ${findings.length} finding(s) across ${VIEWPORTS.length} widths x ${STEPS.length} steps`);
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
  console.log(`  ok    layout readability: ${totalJudged} prose blocks judged across ${VIEWPORTS.map((v) => v.width).join(", ")}px x ${STEPS.join(", ")}`);
  return 0;
}

process.exit(await main());
