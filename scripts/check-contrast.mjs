// Board-legibility floors, mechanised — the sibling check-motion.mjs promised.
//
// Exists because of a measured failure, not taste: the dark chess board
// shipped with black pieces at 1.27:1 against the dark squares (a hole in the
// board carried by a 1px rim), the ttt cells sat on their frame at 1.18:1 (a
// featureless white slab), and the ttt draw keyframe animated
// stroke-dashoffset 1 -> 1, so every fresh mark and 100% of winning lines
// rendered INVISIBLE (audit 2026-08-22, docs/audit/2026-08-22-ui-perf.md).
// None of that is catchable by anything that runs the code — these are
// properties of files the code never reads — and the two dark token blocks in
// each board file are hand-duplicated (selector limits, see chess.css), so
// they can drift apart silently. This pins all of it.
//
// It has no taste and claims none: WCAG relative-luminance ratios on the
// specific token pairs that failed, plus the byte-identical-dark-blocks
// invariant both files state in prose, plus the keyframe's explicit `to`.
import { readFileSync } from "fs";

const ROOT = new URL("..", import.meta.url).pathname;
const read = (p) => readFileSync(ROOT + p, "utf8");

let failed = 0;
const check = (name, ok, detail) => {
  console.log(`${ok ? "  ok  " : "FAIL  "}${name} ${detail ?? ""}`);
  if (!ok) failed++;
};

// ── colour maths ───────────────────────────────────────────────────────────
const hex = (h) => {
  const m = /^#([0-9a-f]{6})$/i.exec(h.trim());
  if (!m) throw new Error(`not a 6-digit hex: ${h}`);
  return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255);
};
const lum = ([r, g, b]) => {
  const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};
const ratio = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const mix = (a, b, pctA) => a.map((c, i) => c * pctA + b[i] * (1 - pctA));

// pull `--token: value;` out of a css block
const token = (block, name) => {
  const m = new RegExp(`${name}:\\s*([^;]+);`).exec(block);
  if (!m) throw new Error(`token ${name} not found`);
  return m[1].trim();
};

// ── the byte-identical dark blocks ─────────────────────────────────────────
// Each board file carries its night inking twice (data-tone/theme selector +
// prefers-color-scheme) and states in prose that the blocks are identical.
// Make the prose enforceable.
const darkBlocks = (css, marker) => {
  const out = [];
  let i = 0;
  while ((i = css.indexOf(marker, i)) !== -1) {
    const open = css.indexOf("{", i);
    const close = css.indexOf("\n}", open);
    out.push(css.slice(open + 1, close).trim());
    i = close;
  }
  return out;
};

const chess = read("src/styles/chess.css");
const ttt = read("src/styles/ttt.css");

const cbDark = darkBlocks(chess, '.cb[data-tone="dark"]').concat(
  darkBlocks(chess, ':root:not([data-theme="light"]) .cb'),
);
check("chess: two dark blocks, byte-identical", cbDark.length === 2 && cbDark[0] === cbDark[1]);

const ttDark = darkBlocks(ttt, '.tt[data-tone="dark"]').concat(
  darkBlocks(ttt, ':root:not([data-theme="light"]) .tt'),
);
check("ttt: two dark blocks, byte-identical", ttDark.length === 2 && ttDark[0] === ttDark[1]);

// ── chess night board floors ───────────────────────────────────────────────
{
  const b = cbDark[0];
  const light = hex(token(b, "--cb-light"));
  const dark = hex(token(b, "--cb-dark"));
  const black = hex(token(b, "--cb-black"));
  const rBlackOnDark = ratio(black, dark);
  const rSquares = ratio(light, dark);
  check("chess dark: black piece on dark square >= 3.0", rBlackOnDark >= 3.0, rBlackOnDark.toFixed(2));
  check("chess dark: square-to-square >= 2.4", rSquares >= 2.4, rSquares.toFixed(2));
}

// ── ttt grid floors, both themes ───────────────────────────────────────────
{
  // light: the grid line is a color-mix over global tokens; resolve it here
  // with the same values, read from global.css so a palette change re-tests.
  const g = read("src/styles/global.css");
  const root = g.slice(g.indexOf(":root"), g.indexOf(":root") + 4000);
  const ink = hex(token(root, "--ink"));
  const surface2 = hex(token(root, "--surface-2"));
  const cellLight = hex(token(root, "--surface"));
  const mixM = /--tt-grid-line:\s*color-mix\(in srgb, var\(--ink\)\s*([\d.]+)%/.exec(ttt);
  check("ttt light: grid-line is a --ink mix", Boolean(mixM));
  if (mixM) {
    const line = mix(ink, surface2, Number(mixM[1]) / 100);
    const r = ratio(line, cellLight);
    check("ttt light: grid line vs cell >= 2.2", r >= 2.2, r.toFixed(2));
  }
  const cellDark = hex(token(ttDark[0], "--tt-cell"));
  const lineDark = hex(token(ttDark[0], "--tt-grid-line"));
  const rD = ratio(lineDark, cellDark);
  check("ttt dark: grid line vs cell >= 2.2", rD >= 2.2, rD.toFixed(2));
}

// ── the draw keyframe's explicit end state ─────────────────────────────────
// `forwards` + an implicit `to` that resolves to the underlying value (which
// the animating rule itself sets to 1) = the animation that froze every mark
// hidden. The `to` must exist and must land at 0.
{
  const kf = /@keyframes tt-draw\s*\{([\s\S]*?)\n\}/.exec(ttt);
  const ok = Boolean(kf && /to\s*\{[^}]*stroke-dashoffset:\s*0\b/.test(kf[1]));
  check("ttt: tt-draw keyframe ends at dashoffset 0 explicitly", ok);
}

// ══ THE WORLD LAYER'S FLOORS ═══════════════════════════════════════════════
//
// docs/DESIGN-WORLD.md, "laws that do not bend for beauty": contrast gates
// extend to the world layer, text over sky = scrim tokens, MEASURED.
//
// The same species of check as everything above and for the same reason: a
// sky is a picture, so every failure here is invisible to anything that runs
// the code and visible to exactly one person — the one who happened to open
// the app at 5pm on the day the golden-hour stops were tuned. There are FIVE
// skies and each has FOUR stops, so there are twenty grounds that text has to
// hold against, and nineteen of them are not on screen while you are looking
// at the twentieth.
//
// WHAT IS COMPUTED, precisely, because the honesty of the floor depends on it:
//
//   ground = the sky stop, with the state's scrim composited over it at the
//            state's own alpha — the UNIFORM veil, which is the weakest the
//            scrim ever is anywhere on screen (world.css adds a strictly
//            additive top/bottom emphasis on top of it). So every real pixel
//            is at least as legible as the number proved here.
//   text   = --world-ink and --world-ink-dim, straight onto that ground.
//   panel  = the state's glass fill composited over that same ground. Text
//            also has to be read ON it, so ink is measured against the PANEL
//            as well as against the sky.
//   edge   = the panel's hairline, composited over the panel, measured
//            against the sky — what makes a floating control a findable
//            object rather than a suggestion.
//
// Floors: text 4.5:1 (WCAG AA body), the control's boundary 3:1 (AA non-text
// / UI component). `--world-ink-dim` is held to the BODY floor rather than
// the large-text one on purpose: it carries her presence line and the call
// state line, both of which are 13.5px and both of which are read constantly.
//
// ── THE HOLE THIS FILE SHIPPED WITH FOR ONE AFTERNOON ─────────────────────
//
// The first version measured only ink-over-SKY and fill-over-SKY, and passed
// a design in which the home screen's cards were unreadable at noon. The
// reason is worth keeping: a light-glass panel over a light sky composites to
// a mid-grey slab, the state's own dark ink sits on THAT at 4.2:1, and
// nothing in the gate was looking at that pair — the fill had been chosen to
// contrast with the sky, which is the one surface it does not sit on.
//
// The browser battery's screenshots caught it; this gate did not. So the
// panel-and-edge split above is not a refinement, it is the missing half:
// THE FILL CARRIES THE TEXT, THE EDGE CARRIES THE COMPONENT. Either half
// silently taking on the other's job is exactly what shipped.
//
// The table is read from the REAL `src/engine/sky.ts`, bundled fresh with
// esbuild on every run. Same discipline as `evals/run.mjs`: a frozen copy
// passes forever while the source rots.
{
  console.log("");
  const { execFileSync } = await import("child_process");
  const { mkdtempSync, rmSync } = await import("fs");
  const { tmpdir } = await import("os");
  const { join } = await import("path");

  const dir = mkdtempSync(join(tmpdir(), "skygate-"));
  const out = join(dir, "sky.mjs");
  let SKY_TOKENS, SKY_STATES;
  try {
    execFileSync(
      "npx",
      ["esbuild", "src/engine/sky.ts", "--bundle", "--format=esm", "--platform=node",
        `--outfile=${out}`, "--log-level=error"],
      { cwd: ROOT, stdio: "pipe" },
    );
    ({ SKY_TOKENS, SKY_STATES } = await import(out));
  } finally {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* temp dir */ }
  }

  check("world: the sky table bundles and exports five states", SKY_STATES?.length === 5);

  // alpha-composite `over` onto `base`, both hex, alpha 0..1 — the same maths
  // the browser does, done here so the number is not a guess
  const over = (fg, bg, a) => fg.map((c, i) => c * a + bg[i] * (1 - a));

  const TEXT_FLOOR = 4.5;
  const EDGE_FLOOR = 3.0;
  let worstText = Infinity;
  let worstPanel = Infinity;
  let worstEdge = Infinity;

  for (const state of SKY_STATES ?? []) {
    const t = SKY_TOKENS[state];
    const scrim = hex(t.scrim);
    const ink = hex(t.ink);
    const inkDim = hex(t.inkDim);
    const control = hex(t.control);
    const edge = hex(t.edge);

    let minText = Infinity;
    let minPanel = Infinity;
    let minEdge = Infinity;
    let whereText = "";
    let wherePanel = "";
    for (let i = 0; i < t.stops.length; i++) {
      const ground = over(scrim, hex(t.stops[i]), t.scrimAlpha);
      const panel = over(control, ground, t.controlAlpha);

      // 1. text floating directly on the world: her name, her presence line,
      //    the call's state line, the reassurance line
      const onSky = Math.min(ratio(ink, ground), ratio(inkDim, ground));
      if (onSky < minText) {
        minText = onSky;
        whereText = `stop ${i + 1} (${t.stops[i]})`;
      }
      // 2. text inside a floating panel: every card, every pill, every label
      const onPanel = Math.min(ratio(ink, panel), ratio(inkDim, panel));
      if (onPanel < minPanel) {
        minPanel = onPanel;
        wherePanel = `stop ${i + 1} (${t.stops[i]})`;
      }
      // 3. the panel's boundary against the world it floats in
      minEdge = Math.min(minEdge, ratio(over(edge, panel, t.edgeAlpha), ground));
    }
    worstText = Math.min(worstText, minText);
    worstPanel = Math.min(worstPanel, minPanel);
    worstEdge = Math.min(worstEdge, minEdge);

    check(
      `world/${state}: text over scrimmed sky >= ${TEXT_FLOOR}`,
      minText >= TEXT_FLOOR,
      `${minText.toFixed(2)} worst at ${whereText}`,
    );
    check(
      `world/${state}: text INSIDE a glass panel >= ${TEXT_FLOOR}`,
      minPanel >= TEXT_FLOOR,
      `${minPanel.toFixed(2)} worst at ${wherePanel}`,
    );
    check(
      `world/${state}: panel edge vs its sky >= ${EDGE_FLOOR}`,
      minEdge >= EDGE_FLOOR,
      minEdge.toFixed(2),
    );
    // The panel must go the SAME WAY the sky does — dark glass on a dark sky,
    // light glass on a light one. Stated as a check rather than as a comment
    // because the inverse is exactly what shipped once, and it reads as a
    // reasonable idea right up until it is rendered.
    const skyDark = t.mode === "dark";
    const panelDark = lum(hex(t.control)) < 0.2;
    check(
      `world/${state}: the glass follows the sky (${t.mode})`,
      skyDark === panelDark,
      `control ${t.control}`,
    );
  }

  // The scrim is the ONLY thing standing between text and a picture, so a
  // state that forgot to declare one would sail through every ratio above
  // by accident on a dark sky and fail invisibly on a light one.
  for (const state of SKY_STATES ?? []) {
    const t = SKY_TOKENS[state];
    check(
      `world/${state}: declares a real scrim`,
      t.scrimAlpha >= 0.3 && t.scrimAlpha <= 0.8,
      String(t.scrimAlpha),
    );
  }

  // The painting swap point. `--world-img` is the ONE variable stage 2
  // changes; if a state ever loses the field the swap silently skips it and
  // that sky alone stays procedural forever.
  for (const state of SKY_STATES ?? []) {
    check(
      `world/${state}: carries the --world-img swap point`,
      typeof SKY_TOKENS[state].img === "string",
    );
  }

  console.log(
    `  ..  world worst case: text-on-sky ${worstText.toFixed(2)}:1, ` +
      `text-in-panel ${worstPanel.toFixed(2)}:1, panel edge ${worstEdge.toFixed(2)}:1`,
  );
}

console.log(failed ? `\n${failed} contrast/legibility checks FAILED` : "\nboard legibility ok");
process.exit(failed ? 1 : 0);
