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
  // ── WS-SWEEP: THE CELL IS READ FROM THE BOARD, NOT FROM THE PALETTE ──────
  // This was `token(root, "--surface")`, and it was a floor measured over a
  // colour the board no longer used the moment `--tt-cell` stopped being
  // `var(--surface)` — the check would have gone on printing 2.5:1 forever
  // while the real cell drifted anywhere at all. It is the same species of
  // hole as the frozen-copy gates in `evals/archive/`: a model of the thing
  // instead of the thing. `.tt`'s own light block is the source now, and the
  // resolution follows one `var()` hop so writing `var(--surface)` back in
  // still measures correctly rather than throwing.
  const ttLight = ttt.slice(ttt.indexOf("\n.tt {"), ttt.indexOf('.tt[data-tone="dark"]'));
  const cellDecl = token(ttLight, "--tt-cell");
  const cellLight = hex(
    /^var\(--[\w-]+\)$/.test(cellDecl) ? token(root, /^var\((--[\w-]+)\)$/.exec(cellDecl)[1]) : cellDecl,
  );
  // …and it is TINTED. A neutral cell is the pure-white slab the board was,
  // and on a painted ground that is a hole rather than a surface — the one
  // anti-pattern (`impeccable`: no pure black or gray, always tinted) that a
  // ratio can never catch, because #ffffff passes every contrast floor it is
  // ever put in front of.
  {
    const spread = Math.max(...cellLight) - Math.min(...cellLight);
    check(
      "ttt light: the cell is tinted, not neutral",
      spread >= 0.015,
      `${cellDecl} (channel spread ${(spread * 255).toFixed(1)}/255)`,
    );
  }
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
  let SKY_TOKENS, SKY_STATES, SKY_MOD;
  try {
    execFileSync(
      "npx",
      ["esbuild", "src/engine/sky.ts", "--bundle", "--format=esm", "--platform=node",
        `--outfile=${out}`, "--log-level=error"],
      { cwd: ROOT, stdio: "pipe" },
    );
    // the whole module, not two names: the painted half below needs
    // `imgPath`, `scrimEmphasisAt` and the band fractions, and every one of
    // them is a fact about the shipped stylesheet or the shipped table that
    // this file must not keep its own copy of
    SKY_MOD = await import(out);
    ({ SKY_TOKENS, SKY_STATES } = SKY_MOD);
  } finally {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* temp dir */ }
  }

  check("world: the sky table bundles and exports five states", SKY_STATES?.length === 5);

  // ── THE ONE ASSUMPTION THE NUMBERS BELOW REST ON ─────────────────────────
  //
  // Every painted ratio in the second half composites `scrimEmphasisAt` on top
  // of the uniform veil. That is only true if the emphasis RENDERS, and for
  // months it did not: `.world-scrim` painted an OPAQUE background and thinned
  // it with element `opacity`, which groups the element WITH its own
  // `::after` — so a pseudo painting the same colour over an already-opaque
  // parent added exactly zero coverage. Deleting it measured a zero pixel
  // delta. The gate went on printing 4.68:1 for a morning truth line that
  // rendered at ~3.5:1, and nothing could see the gap, because a gate that
  // models a composite cannot notice the composite is not happening.
  //
  // So the model is pinned to the stylesheet here. Two properties, both cheap,
  // both of which the broken version fails:
  //
  //   1. `.world-scrim` carries NO fractional `opacity` — its alpha is in the
  //      colour, so the pseudo has a real parent to composite over.
  //   2. `.world-scrim::after` still has an emphasis pass of its own, at the
  //      opacity `scrimEmphasisAt` multiplies by.
  //
  // A text lint, same species as the ttt keyframe check above and for the same
  // reason: this is a property of a file the code never reads.
  {
    const worldCss = read("src/styles/world.css");
    const blockOf = (sel) => {
      const i = worldCss.indexOf(`\n${sel} {`);
      if (i === -1) return null;
      const open = worldCss.indexOf("{", i);
      const close = worldCss.indexOf("\n}", open);
      return close === -1 ? null : worldCss.slice(open + 1, close);
    };

    const scrimBlock = blockOf(".world-scrim");
    check("world/scrim: the .world-scrim rule is still findable", Boolean(scrimBlock));
    if (scrimBlock) {
      // `opacity: 1` is fine and is the point. Anything else — a number below
      // one, or a var() that resolves to the alpha — re-groups the pseudo.
      const op = /(?:^|[\s;])opacity:\s*([^;]+);/.exec(scrimBlock);
      const opValue = op ? op[1].trim() : "(absent)";
      check(
        "world/scrim: the veil's alpha is in the COLOUR, not in element opacity",
        !op || opValue === "1",
        `opacity: ${opValue}`,
      );
      check(
        "world/scrim: the veil's alpha reads --world-scrim-a",
        /--world-scrim-a-eff|--world-scrim-a\b/.test(scrimBlock) &&
          /color-mix\(|rgba?\(/.test(scrimBlock),
      );
    }

    const afterBlock = blockOf(".world-scrim::after");
    check("world/scrim: the ::after emphasis pass is still there", Boolean(afterBlock));
    if (afterBlock) {
      const op = /(?:^|[\s;])opacity:\s*([\d.]+);/.exec(afterBlock);
      const declared = op ? Number(op[1]) : NaN;
      // sky.ts's SCRIM_EMPHASIS_OPACITY is the SAME number, and the gate
      // multiplies the gradient ramp by it. Two copies of one fact is how the
      // gate ends up measuring a screen nobody ships.
      check(
        "world/scrim: ::after opacity == sky.ts SCRIM_EMPHASIS_OPACITY",
        declared === SKY_MOD.SCRIM_EMPHASIS_OPACITY,
        `css ${op ? op[1] : "(absent)"} vs sky.ts ${SKY_MOD.SCRIM_EMPHASIS_OPACITY}`,
      );
    }
  }

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
    let minAccent = Infinity;
    let whereText = "";
    let wherePanel = "";
    for (let i = 0; i < t.stops.length; i++) {
      const ground = over(scrim, hex(t.stops[i]), t.scrimAlpha);
      // 0. ACCENT text floating directly on the world (the hero <em>). The
      //    theme's --accent measured 2.26:1 on morning's blue top stop
      //    (2026-08-25); each state now carries a sky-solved `accent` and
      //    this holds it to the same body floor as ink, on the same ground.
      minAccent = Math.min(minAccent, ratio(hex(t.accent), ground));
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
      `world/${state}: accent over scrimmed sky >= ${TEXT_FLOOR}`,
      minAccent >= TEXT_FLOOR,
      `min ${minAccent.toFixed(2)}`,
    );
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

  // ══ THE SAME FLOORS, AGAINST THE REAL PIXELS ═════════════════════════════
  //
  // Everything above composites the scrim over a GRADIENT STOP — a flat colour
  // this app chose. The ground is a photograph of a painting now, and a
  // painting has things in it the token table has never heard of. The morning
  // sky's fourth stop is #f3e6d8, a warm haze; the morning PAINTING's bottom
  // fifth is an Indian city at 10am whose darkest tenth sits at #2a302e. Those
  // are not the same ground and a gate that measured only the first would go
  // on printing 5.82:1 while the truth line was unreadable at 2.06:1.
  //
  // So this half decodes the shipped jpg — the actual bytes in public/world,
  // not the staged source, not a re-encode — and measures the two bands where
  // text actually lives:
  //
  //   TOP    the first TEXT_BAND_TOP of the frame: her name, the header, the
  //          call's state line.
  //   BOTTOM the last TEXT_BAND_BOTTOM: the controls and the truth line.
  //
  // Three samples per band, because an average is a colour that exists nowhere
  // on screen and the failures are always at the ends:
  //
  //   avg        the band's mean — what it mostly looks like.
  //   brightest  the mean of the brightest tenth — the sample that hurts LIGHT
  //              ink (a sodium-lit window under white text).
  //   darkest    the mean of the darkest tenth — the sample that hurts DARK
  //              ink (a roof slab under the day palette's near-black).
  //
  // The brief asked for average + brightest-decile. Darkest is here as well
  // because on the two LIGHT states brightest is the easy direction, and a
  // gate that only measures the direction that passes is decoration. Both
  // deciles, every state, both bands.
  //
  // ── WHAT THE GROUND IS, exactly ──────────────────────────────────────────
  //
  // uniform veil at `scrimAlphaPainted`, THEN world.css's `.world-scrim::after`
  // top/bottom emphasis, evaluated at the INNER edge of each band — the
  // weakest point the band has, so every pixel of it is at least this dark.
  // The emphasis curve is `scrimEmphasisAt` in sky.ts rather than a number
  // copied here: it is a fact about the stylesheet, and a gate holding its own
  // copy of a stylesheet fact is a gate that passes after the stylesheet
  // changes.
  //
  // Modelling the emphasis is what keeps this honest in the other direction
  // too. Without it the light states need a UNIFORM veil near 0.62 to hold the
  // bottom band, which would fog the middle of a painting where no text has
  // ever been in order to pay for text at its edges.
  //
  // `sharp` arrives with `@capacitor/assets` (a direct devDependency, pinned
  // to 0.32.6 in the lockfile) rather than being declared here. Its absence
  // FAILS rather than skipping: a gate that quietly stops measuring when its
  // decoder goes missing is the shape of guard this repo has already been
  // burned by, and the failure it would hide is the one the whole second half
  // exists for.
  console.log("");
  const sharp = await import("sharp").then((m) => m.default, () => null);
  if (!sharp) {
    check("world/paintings: sharp is available to decode them", false, "sharp not installed");
  } else {
    const { existsSync } = await import("fs");

    // `full` is the wallpaper's band and only the wallpaper's: the world
    // surfaces put text in two bands, a THREAD puts text at every vertical
    // position, so the wallpaper is measured over the whole frame as well.
    const bandSamples = async (file, which) => {
      const meta = await sharp(file).metadata();
      const frac =
        which === "full" ? 1 : which === "top" ? SKY_MOD.TEXT_BAND_TOP : SKY_MOD.TEXT_BAND_BOTTOM;
      const h = Math.max(1, Math.round(meta.height * frac));
      const top = which === "bottom" ? meta.height - h : 0;
      // Downsampled to 240 wide first: the samples are decile MEANS, which a
      // box filter preserves and which reading 1.5M raw pixels five times over
      // would only make slower.
      const { data, info } = await sharp(file)
        .extract({ left: 0, top, width: meta.width, height: h })
        .resize({ width: 240 })
        .raw()
        .toBuffer({ resolveWithObject: true });
      const px = [];
      for (let i = 0; i < data.length; i += info.channels) {
        px.push([data[i] / 255, data[i + 1] / 255, data[i + 2] / 255]);
      }
      px.sort((a, b) => lum(a) - lum(b));
      const mean = (arr) => [0, 1, 2].map((k) => arr.reduce((s, p) => s + p[k], 0) / arr.length);
      const d = Math.max(1, Math.round(px.length * 0.1));
      return {
        avg: mean(px),
        darkest: mean(px.slice(0, d)),
        brightest: mean(px.slice(px.length - d)),
      };
    };

    let pWorstText = Infinity;
    let pWorstPanel = Infinity;
    let pWorstEdge = Infinity;

    for (const state of SKY_STATES ?? []) {
      const t = SKY_TOKENS[state];
      const scrim = hex(t.scrim);
      const ink = hex(t.ink);
      const inkDim = hex(t.inkDim);
      const control = hex(t.control);
      const edge = hex(t.edge);

      // A missing file is the worst failure this gate has, because the app
      // FALLS BACK on it silently and beautifully: the procedural sky returns,
      // every ratio above still passes, and nobody finds out the painting
      // stopped shipping until a screenshot.
      const paths = [
        ["portrait", SKY_MOD.imgPath(t.img)],
        ["wide", SKY_MOD.imgPath(t.imgWide)],
      ];
      let ok = true;
      for (const [crop, rel] of paths) {
        const abs = ROOT + "public" + rel;
        if (!rel || !existsSync(abs)) {
          check(`world/${state}: the ${crop} painting ships`, false, rel || "(no url in the table)");
          ok = false;
        }
      }
      if (!ok) continue;
      check(`world/${state}: both crops ship`, true, SKY_MOD.imgPath(t.img));

      check(
        `world/${state}: the painted veil is never thinner than the gradient's`,
        t.scrimAlphaPainted >= t.scrimAlpha,
        `${t.scrimAlpha} -> ${t.scrimAlphaPainted}`,
      );

      let minText = Infinity;
      let minPanel = Infinity;
      let minEdge = Infinity;
      let where = "";
      for (const which of ["top", "bottom"]) {
        // the inner edge of the band: 0.18 down for the top band, 0.78 down
        // for the bottom one — the point inside it with the least emphasis
        const inner = which === "top" ? SKY_MOD.TEXT_BAND_TOP : 1 - SKY_MOD.TEXT_BAND_BOTTOM;
        const emphasis = SKY_MOD.scrimEmphasisAt(inner);
        // two veils, one after the other, is one veil at this alpha
        const eff = 1 - (1 - t.scrimAlphaPainted) * (1 - emphasis);
        const samples = await bandSamples(ROOT + "public" + SKY_MOD.imgPath(t.img), which);
        for (const [name, colour] of Object.entries(samples)) {
          const ground = over(scrim, colour, eff);
          const panel = over(control, ground, t.controlAlpha);
          const rText = Math.min(ratio(ink, ground), ratio(inkDim, ground));
          const rPanel = Math.min(ratio(ink, panel), ratio(inkDim, panel));
          const rEdge = ratio(over(edge, panel, t.edgeAlpha), ground);
          if (rText < minText) {
            minText = rText;
            where = `${which}/${name}`;
          }
          minPanel = Math.min(minPanel, rPanel);
          minEdge = Math.min(minEdge, rEdge);
        }
      }
      pWorstText = Math.min(pWorstText, minText);
      pWorstPanel = Math.min(pWorstPanel, minPanel);
      pWorstEdge = Math.min(pWorstEdge, minEdge);

      check(
        `world/${state}: text over the PAINTING >= ${TEXT_FLOOR}`,
        minText >= TEXT_FLOOR,
        `${minText.toFixed(2)} worst at ${where} (veil ${t.scrimAlphaPainted})`,
      );
      check(
        `world/${state}: text in a panel over the PAINTING >= ${TEXT_FLOOR}`,
        minPanel >= TEXT_FLOOR,
        minPanel.toFixed(2),
      );
      check(
        `world/${state}: panel edge over the PAINTING >= ${EDGE_FLOOR}`,
        minEdge >= EDGE_FLOOR,
        minEdge.toFixed(2),
      );
    }

    // The plates are the only thing that still draws itself over a painting,
    // so they are the only thing that can still put ink on top of ink. WebP
    // now, at 2x their drawn width — 237 KB of oversampled PNG on every cold
    // home load became 58 KB. `evals/sky.mjs` holds the byte ceiling and the
    // no-stale-url check; this one keeps its own eye on them existing at all,
    // because a missing plate here means a painting nothing moves over.
    for (const c of ["cloud_a.webp", "cloud_b.webp"]) {
      check(`world/plates: ${c} ships`, existsSync(`${ROOT}public/world/${c}`));
    }

    console.log(
      `  ..  world worst case OVER THE PAINTINGS: text ${pWorstText.toFixed(2)}:1, ` +
        `text-in-panel ${pWorstPanel.toFixed(2)}:1, panel edge ${pWorstEdge.toFixed(2)}:1`,
    );

    // ══ THE THREAD'S WALLPAPER ═════════════════════════════════════════════
    //
    // docs/DESIGN-WORLD.md §Phase 3.1. The thread's ground is a painting now,
    // and the thing that makes that survivable is a heavy veil whose alpha was
    // SOLVED against these same decoded pixels rather than chosen by eye.
    //
    // ── WHY THIS IS A SEPARATE HALF AND NOT MORE ROWS ABOVE ────────────────
    //
    // Everything above measures `--world-ink`/`--world-ink-dim`: tokens that
    // belong to the SKY and flip with it, so a night sky is measured under
    // light ink and a noon sky under dark ink, always in agreement.
    //
    // The thread's ground text does not work that way. A day separator, a
    // timestamp, the read-earlier pill and every `--ink-dim` metadata line are
    // painted in the THEME's ink, and `data-theme` beats the sky — that is a
    // law in the direction doc. So the combination this half exists to catch
    // is the one the world half cannot produce: THE LIGHT THEME AT MIDNIGHT.
    // Near-black ink, over the night painting, veiled by a light scrim. Ten
    // combinations (5 skies x 2 themes), and eight of them are not on screen
    // while you are looking at the ninth.
    //
    // ── WHAT IS COMPUTED ───────────────────────────────────────────────────
    //
    //   ground = wallScrim{Light,Dark} over the painting's decoded pixels at
    //            wallAlpha{Light,Dark}. UNIFORM — the wallpaper variant turns
    //            off `.world-scrim::after`'s emphasis on purpose (a vignette
    //            over a thread is a vignette over messages), so unlike the
    //            world half there is no additive pass to model and the number
    //            here is the number that renders.
    //   text   = the THEME's --ink and --ink-dim, straight onto that ground.
    //   chip   = --glass-chip over that ground; text is read ON it, so both
    //            inks are measured against the chip as well.
    //   edge   = --glass-edge-strong over the chip, against the ground.
    //
    // Three regions rather than two: top and bottom as above (the header band
    // reads the top through the same veil), PLUS the whole frame, because a
    // thread puts text at every vertical position and a gate that only looked
    // at the ends would be measuring a screen nobody scrolls.
    //
    // Floors: 4.5 for every piece of text, 3.0 for a CONTROL's boundary. The
    // two label chips (day separator, call record) are deliberately NOT held
    // to 3.0 — see the --glass-edge note in global.css; they are text in a
    // container, not components, and a 3:1 ring around every date would be a
    // floor invented rather than applied.
    console.log("");

    const g = read("src/styles/global.css");
    // brace-balanced, because these blocks are long and a fixed slice is a
    // gate that silently stops covering a token someone appends
    const cssBlock = (src, sel) => {
      const i = src.indexOf(sel);
      if (i === -1) throw new Error(`selector not found: ${sel}`);
      const open = src.indexOf("{", i);
      let depth = 0;
      for (let j = open; j < src.length; j++) {
        if (src[j] === "{") depth++;
        else if (src[j] === "}" && --depth === 0) return src.slice(open + 1, j);
      }
      throw new Error(`unbalanced block: ${sel}`);
    };
    const LIGHT = cssBlock(g, ":root {");
    const DARK = cssBlock(g, ':root[data-theme="dark"] {');

    // `--bubble-me: var(--accent-solid)` -> `var(--accent)` -> `#c23f56`, and
    // in the dark theme the SAME chain lands on `#bc4557` because only its
    // middle link is overridden. Resolved rather than assumed: the
    // bubble-opacity assertion below is worth nothing if it stops at the first
    // `var()` and calls it opaque.
    //
    // The dark block is an OVERRIDE LIST, not a complete palette — most tokens
    // (`--bubble-me` among them) are declared once in `:root` and inherited.
    // So resolution walks a cascade: the theme's own block first, `:root`
    // behind it, which is exactly what the browser does.
    const resolveIn = (blocks, name, depth = 0) => {
      if (depth > 8) throw new Error(`--${name}: var() chain too deep`);
      let v = null;
      for (const b of blocks) {
        try {
          v = token(b, name);
          break;
        } catch {
          /* not overridden at this level — fall through to :root */
        }
      }
      if (v === null) throw new Error(`token ${name} not found in any block`);
      const m = /^var\((--[\w-]+)\)$/.exec(v);
      return m ? resolveIn(blocks, m[1], depth + 1) : v;
    };
    const rgba = (v) => {
      const m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(v.trim());
      if (!m) throw new Error(`not an rgba(): ${v}`);
      return { c: [+m[1] / 255, +m[2] / 255, +m[3] / 255], a: m[4] === undefined ? 1 : +m[4] };
    };

    // ── the bubbles are opaque, and that is the whole safety argument ──────
    //
    // "Bubble contrast is untouched by construction (opaque surfaces)" is what
    // the direction doc promises for this phase, and it is the reason not one
    // ratio inside a bubble had to be re-measured when the ground became a
    // picture. A promise that rests on construction has to be pinned to the
    // construction, or the next person to make her bubbles "sit in the world"
    // with a 0.9 alpha silently puts every message in the product on a
    // painting — and it would look fine on the four states they checked.
    const CASCADE = { light: [LIGHT], dark: [DARK, LIGHT] };
    for (const [themeName, chain] of Object.entries(CASCADE)) {
      for (const [what, tok] of [["her", "--surface-2"], ["me", "--bubble-me"]]) {
        const v = resolveIn(chain, tok);
        check(
          `wallpaper/${themeName}: .msg.${what} background is fully opaque`,
          /^#[0-9a-f]{6}$/i.test(v.trim()),
          `${tok} -> ${v}`,
        );
      }
    }
    // …and the declarations themselves carry no alpha and no opacity, which is
    // the other way the same promise breaks: an opaque TOKEN under a
    // translucent RULE is still a translucent bubble.
    // EVERY rule with this selector, not the first one: `.msg.her` is declared
    // twice in global.css (once for its transform-origin and transition, once
    // for its ground), and a check that read only the first would be reading a
    // block with no `background` in it at all — passing, forever, by looking
    // at the wrong rule. This is the same species of hole as the frozen-copy
    // gates in `evals/archive/`, at the scale of one selector.
    const allBlocks = (src, sel) => {
      const out = [];
      let i = 0;
      while ((i = src.indexOf(`\n${sel} {`, i)) !== -1) {
        const open = src.indexOf("{", i);
        let depth = 0;
        for (let j = open; j < src.length; j++) {
          if (src[j] === "{") depth++;
          else if (src[j] === "}" && --depth === 0) {
            out.push(src.slice(open + 1, j));
            i = j;
            break;
          }
        }
        if (i < open) break;
      }
      return out;
    };
    for (const sel of [".msg.her", ".msg.me"]) {
      const blocks = allBlocks(g, sel);
      check(`wallpaper: ${sel} rules found`, blocks.length > 0, `${blocks.length}`);
      const bgs = blocks
        .map((b) => /(?:^|[\s;])background:\s*([^;]+);/.exec(b)?.[1]?.trim())
        .filter(Boolean);
      check(
        `wallpaper: every ${sel} background is an opaque token, no alpha`,
        bgs.length > 0 && bgs.every((v) => /^var\(--[\w-]+\)$/.test(v)),
        bgs.join(" | ") || "(none declared)",
      );
      const ops = blocks
        .map((b) => /(?:^|[\s;])opacity:\s*([^;]+);/.exec(b)?.[1]?.trim())
        .filter(Boolean);
      check(
        `wallpaper: no ${sel} rule thins the bubble with opacity`,
        ops.every((v) => v === "1"),
        ops.join(" | ") || "(none)",
      );
    }

    // ── HIS BUBBLE CARRIES FIVE PIECES OF INK, AND NONE OF THEM WERE GATED ──
    //
    // The owner's second defect: "the red and black not going together in dark
    // theme." The dark fill moves to a wine (`--bubble-me: #8e4054`, see the
    // long note in global.css), and the moment a fill can be retuned for taste
    // it needs a floor, because everything on it is a WASH — white at 92%, a
    // pale cyan tick, a 16% quote panel — and a wash's ratio is a function of
    // the fill it is washing. Deepening the fill made all five better; the
    // next tune might not, and nothing in this file could have said so.
    //
    // Both themes, because the light bubble is untouched and "untouched" is a
    // claim worth pinning: if a future change collapses the two back into one
    // token, the row that fails should be the one that names which theme lost.
    //
    // Floors: 4.5 for the three that are TEXT (the label, the timestamp, the
    // quoted line). The read tick and the quote's own bar are non-text marks
    // and take 3.0 — the tick is held at 4.0 anyway rather than 3.0, because
    // global.css's own note calls it "the smallest and most-watched piece of
    // state in the product" and that is not a 3:1 job.
    {
      const bubbleInk = [
        // [name, colour, alpha over the fill, floor]
        ["--bubble-me-ink (the message)", "--bubble-me-ink", TEXT_FLOOR],
        ["--bubble-me-dim (the timestamp)", "--bubble-me-dim", TEXT_FLOOR],
        ["--tick-read (the read tick)", "--tick-read", 4.0],
      ];
      for (const [themeName, chain] of Object.entries(CASCADE)) {
        const fillV = resolveIn(chain, "--bubble-me");
        const fill = hex(fillV);
        for (const [label, tok, floor] of bubbleInk) {
          const v = resolveIn(chain, tok);
          const c = /^rgba?\(/.test(v) ? over(rgba(v).c, fill, rgba(v).a) : hex(v);
          const r = ratio(c, fill);
          check(
            `bubble-me/${themeName}: ${label} >= ${floor}`,
            r >= floor,
            `${r.toFixed(2)} (${tok} -> ${v} on ${fillV})`,
          );
        }
        // The quoted reply lives INSIDE the bubble and is three washes on the
        // same fill, stated as raw rgba() at the call site (`.msg.me .quote`)
        // because "all three are washes on the rose FILL" — which was true of
        // one fill and is now true of two. Read from the stylesheet rather
        // than copied here, for the reason every other number in this file is.
        const q = allBlocks(g, ".msg.me .quote")[0] ?? "";
        const qBg = rgba(/background:\s*([^;]+);/.exec(q)?.[1] ?? "rgba(255,255,255,0.16)");
        const qTxt = rgba(/(?:^|[\s;])color:\s*([^;]+);/.exec(q)?.[1] ?? "rgba(255,255,255,0.88)");
        const qBar = rgba(/border-left-color:\s*([^;]+);/.exec(q)?.[1] ?? "rgba(255,255,255,0.85)");
        const panel = over(qBg.c, fill, qBg.a);
        // ── A RATCHET, NOT A FLOOR, AND THE NUMBER IS SAID OUT LOUD ────────
        //
        // This one does NOT get 4.5, and pretending otherwise by quietly
        // omitting it would be worse than the gap. As it renders today:
        // light 3.38:1, dark 4.15:1 (it was 3.36:1 before the wine).
        //
        // The cause is structural rather than a bad alpha. `.msg.me .quote` is
        // a 16% white wash on the bubble's own fill, so the panel sits 1.05:1
        // above the thing it is drawn on, and text washed on THAT is capped by
        // arithmetic: even opaque white reaches only 3.90:1 on the light
        // bubble. No alpha on the text can fix it — the panel would have to
        // stop being a wash, which is a change to the LIGHT bubble and this
        // workstream's brief says that one is untouched.
        //
        // So it is pinned where it renders, and the pin is what makes the debt
        // real: the wine may not make it worse, a future fill tune may not
        // make it worse, and the day the quote panel is redesigned this number
        // goes up and the floor should follow it. 3.3 is today's light value
        // with a hair of room, not a standard anyone should quote.
        const QUOTE_RATCHET = 3.3;
        check(
          `bubble-me/${themeName}: the quoted line inside his bubble >= ${QUOTE_RATCHET} (known: not AA, see note)`,
          ratio(over(qTxt.c, panel, qTxt.a), panel) >= QUOTE_RATCHET,
          ratio(over(qTxt.c, panel, qTxt.a), panel).toFixed(2),
        );
        check(
          `bubble-me/${themeName}: the quoted-reply bar >= ${EDGE_FLOOR}`,
          ratio(over(qBar.c, panel, qBar.a), panel) >= EDGE_FLOOR,
          ratio(over(qBar.c, panel, qBar.a), panel).toFixed(2),
        );
      }
      // THE LIGHT BUBBLE IS THE ACCENT AND THE NIGHT BUBBLE IS NOT, which is
      // the split the owner's verdict bought and the thing a "simplification"
      // would undo first. Pinned as a structural fact rather than a ratio,
      // because collapsing them back would pass every ratio above.
      check(
        "bubble-me: the day bubble is still the accent fill",
        resolveIn(CASCADE.light, "--bubble-me") === resolveIn(CASCADE.light, "--accent-solid"),
        resolveIn(CASCADE.light, "--bubble-me"),
      );
      check(
        "bubble-me: the night bubble is its own wine, not the accent fill",
        resolveIn(CASCADE.dark, "--bubble-me") !== resolveIn(CASCADE.dark, "--accent-solid"),
        `${resolveIn(CASCADE.dark, "--bubble-me")} vs accent ${resolveIn(CASCADE.dark, "--accent-solid")}`,
      );
    }

    // ── THE NIGHT ROOM'S TWO BLOCKS STAY BYTE-IDENTICAL ────────────────────
    // Same law and same failure mode as the palette's own two dark blocks: the
    // dark palette is reachable two ways, and if these drift then one of the
    // two ways keeps the day painting and only one kind of user ever sees the
    // mud the owner photographed. `darkBlocks` is the helper the board files
    // already use.
    {
      const w = read("src/styles/world.css");
      // The marker carries BOTH selector lines, because the `band` selector on
      // its own also opens the `.world-sky` fallback rule below the veil pair
      // and the helper would return four blocks instead of two.
      const veilMarker = (root) =>
        `${root} .world[data-variant="band"],\n${root} .world[data-variant="wallpaper"] {`;
      const veils = darkBlocks(w, veilMarker(':root:not([data-theme="light"]):not([data-sky-choice])')).concat(
        darkBlocks(w, veilMarker(':root[data-theme="dark"]:not([data-sky-choice])')),
      );
      check(
        "night-room: the two dark-veil blocks are byte-identical",
        veils.length === 2 && veils[0] === veils[1],
        veils.length === 2 ? "" : `found ${veils.length}`,
      );
      // …and Sky must be excluded from both, or Sky at dusk paints a night and
      // the one mode whose promise is the real hour stops keeping it.
      check(
        "night-room: it does not capture the sky choice",
        (w.match(/:not\(\[data-sky-choice\]\) \.world\[data-variant="wallpaper"\] \{/g) ?? []).length === 2,
      );
      // The curve model below is only true of a stylesheet that paints a
      // gradient on these three alphas. Same species as the `.world-scrim`
      // opacity lint above: a refactor back to one `color-mix` would leave
      // every band number here describing a screen nobody ships.
      const wallScrim = (() => {
        const k = w.indexOf('.world[data-variant="wallpaper"] .world-scrim {');
        return k === -1 ? "" : w.slice(w.indexOf("{", k), w.indexOf("\n}", k));
      })();
      check(
        "wallpaper: the veil is a CURVE, not one number",
        /linear-gradient/.test(wallScrim) &&
          ["--wall-a-top", "--wall-a-mid", "--wall-a-bot", "--wall-s", "--wall-e"].every((n) =>
            wallScrim.includes(n),
          ),
        wallScrim.trim().replace(/\s+/g, " ").slice(0, 70),
      );
      // The band is the curve's TOP, flat — the strip shows the top of the
      // painting, so it takes the alpha the top of the painting takes. Pinned
      // because the tempting "simplification" is to give it the gradient too,
      // which compresses the city's alpha into a 38px header.
      const bandScrim = (() => {
        const k = w.indexOf('.world[data-variant="band"] .world-scrim {');
        return k === -1 ? "" : w.slice(w.indexOf("{", k), w.indexOf("\n}", k));
      })();
      check(
        "band: takes the curve's top alpha, flat",
        bandScrim.includes("--wall-a-top") && !bandScrim.includes("linear-gradient"),
        bandScrim.trim().replace(/\s+/g, " ").slice(0, 60),
      );
      // …AND IT HAS TO ACTUALLY SHOW THE TOP. The band wears an alpha solved
      // against the painting's top band; `.world-paint` anchors 50% 100%,
      // which crops a 38px strip to the painting's BOTTOM — so for months the
      // header showed roof slabs under a veil measured on open sky. The check
      // is structural because there is no ratio that can express "the gate and
      // the browser are looking at different thirds of the same picture".
      const bandPaint = (() => {
        const k = w.indexOf('.world[data-variant="band"] .world-paint {');
        return k === -1 ? "" : w.slice(w.indexOf("{", k), w.indexOf("\n}", k));
      })();
      check(
        "band: it shows the TOP of the painting, which is what its alpha was solved on",
        /background-position:\s*50%\s*0\s*;/.test(bandPaint),
        bandPaint.trim().replace(/\s+/g, " ").slice(0, 60),
      );
    }

    // ══ THE VEIL CURVE, WALKED BAND BY BAND ════════════════════════════════
    //
    // ROUND TWO, AND THE FIRST ROUND IS THE REASON THIS EXISTS. Round one made
    // the sky-choice veil a thinner FLAT number, proved a 1.65x on the ground's
    // measured luminance spread, and shipped. The owner's verdict on the APK:
    // "I see no sky." The measurement was real and it was not what a person
    // feels on a phone, which is the most expensive kind of correct.
    //
    // One number is the worst number in the frame applied to the whole frame.
    // These paintings are a sky above and a CITY below, so a flat veil pays the
    // city's price over the sky — and the sky is the entire subject of the
    // mode. The veil is a three-alpha curve now (`wallCurveAt` in sky.ts, and
    // the gradient in world.css that it describes), which is the same mechanism
    // the LANDING already ships and states its reasons for.
    //
    // ── WHAT IS WALKED ─────────────────────────────────────────────────────
    //
    // The landing's own prefix walk, adapted to a surface whose picture does
    // NOT scroll. `N` horizontal bands of both crops; for each band the alpha
    // is the curve at its weakest point (the min of its two edges — the curve
    // rises to `mid` and falls to `bot`, so a band's minimum is always at an
    // edge), composited over the band's avg, darkest decile and brightest
    // decile. Every band, every flavour, every floor:
    //
    //   bare  --ink / --ink-dim, and the two activity rooms' derived text
    //         palettes, straight on the ground.        4.5
    //   chip  both inks on --glass-chip over the ground.  4.5
    //   edge  --glass-edge-strong over the chip, vs the ground.  3.0
    //   shape her bubble's fill vs the ground, or a lift with an inset edge.
    //
    // BARE TEXT IS HELD IN EVERY BAND rather than only where the thread puts
    // it, and that is a deliberate choice with a cost. The brief allowed the
    // looser reading — the thread's own ground furniture (day separator, call
    // record, read-earlier pill, jump-to-latest) all sit on `--glass-chip`, so
    // the thread alone could have taken a top alpha of 0.65 on morning instead
    // of 0.78. It does not, because `.as` and `.us` stand on this same veil and
    // paint `--ga-*`/`--u-*` text at every vertical position, and because a
    // floor that depends on nobody ever putting a bare label on the ground is a
    // floor that fails silently the first time somebody does. The frames were
    // shot both ways and 0.78 already reads as a sky.
    //
    // ── THE THREE FLAVOURS ─────────────────────────────────────────────────
    //
    //   light        explicit Light, or a light OS with no choice. The wash
    //                that shipped, unchanged, expressed as three equal alphas.
    //   night-room   the DARK palette, however reached, minus Sky. Always the
    //                night painting at night's curve (owner decision, 2026-08-23
    //                — the reasoning is in sky.ts and world.css). One flavour,
    //                not five, because the picture no longer depends on the
    //                hour.
    //   sky/<state>  the sky choice. The real painting for the hour, on that
    //                state's own curve, under the palette that state resolves
    //                to.
    //
    // The old per-state DARK FLAT rows are gone, and their absence is the
    // point: that combination — dark palette, day painting, one heavy veil — is
    // exactly the frame the owner rejected and the app can no longer produce.
    // `wallScrimDark`/`wallAlphaDark` survive in the table because the LANDING
    // still uses them for its past-the-fold ground (it has no theme switch, so
    // its dark states are the only place that veil is still painted), and the
    // landing half of this file goes on measuring them there.
    const N_BANDS = 16;
    const bandCache = new Map();
    const bandStrip = async (file, i) => {
      const key = `${file}|${i}`;
      if (bandCache.has(key)) return bandCache.get(key);
      const meta = await sharp(file).metadata();
      const top = Math.floor((meta.height * i) / N_BANDS);
      const h = Math.max(1, Math.floor((meta.height * (i + 1)) / N_BANDS) - top);
      const { data, info } = await sharp(file)
        .extract({ left: 0, top, width: meta.width, height: h })
        .resize({ width: 200 })
        .raw()
        .toBuffer({ resolveWithObject: true });
      const px = [];
      for (let k = 0; k < data.length; k += info.channels) {
        px.push([data[k] / 255, data[k + 1] / 255, data[k + 2] / 255]);
      }
      px.sort((a, c) => lum(a) - lum(c));
      const mean = (arr) => [0, 1, 2].map((k) => arr.reduce((sum, q) => sum + q[k], 0) / arr.length);
      const d = Math.max(1, Math.round(px.length * 0.1));
      const out = [
        ["avg", mean(px)],
        ["darkest", mean(px.slice(0, d))],
        ["brightest", mean(px.slice(px.length - d))],
      ];
      bandCache.set(key, out);
      return out;
    };

    const roomTextTokens = (themeName, chain) => {
      const out = [];
      for (const [room, file, baseSel, darkSel, tokens] of [
        ["as", "src/styles/games.css", ".as", '\n.as[data-tone="dark"] {', ["--ga-ink", "--ga-dim", "--ga-faint"]],
        ["us", "src/styles/us.css", ".us", null, ["--u-ink", "--u-dim"]],
      ]) {
        const src = read(file);
        // EVERY BLOCK WITH THIS SELECTOR, REVERSED — reversed document order is
        // what the cascade does at equal specificity, and the first version of
        // this read `.as`'s FIRST block and resolved `--ga-faint` to a value
        // the second block overrides and the browser never renders.
        const roomBlocks = allBlocks(src, baseSel).reverse();
        if (themeName === "dark" && darkSel) roomBlocks.unshift(cssBlock(src, darkSel));
        for (const tk of tokens) out.push([`${room}${tk}`, resolveIn([...roomBlocks, ...chain], tk)]);
      }
      return out;
    };

    const NIGHT = SKY_TOKENS[SKY_MOD.NIGHT_ROOM_STATE];
    const FLAVOURS = [
      // [label, palette, painting-state, scrim, top, mid, bot, s, e]
      ...(SKY_STATES ?? []).map((st) => [
        `light/${st}`, "light", st,
        SKY_TOKENS[st].wallScrimLight,
        SKY_TOKENS[st].wallAlphaLight, SKY_TOKENS[st].wallAlphaLight, SKY_TOKENS[st].wallAlphaLight,
        0.5, 0.8,
      ]),
      [
        "night-room", "dark", SKY_MOD.NIGHT_ROOM_STATE,
        NIGHT.wallScrimSky,
        NIGHT.wallSkyTop, NIGHT.wallSkyMid, NIGHT.wallSkyBot, NIGHT.wallSkyS, NIGHT.wallSkyE,
      ],
      ...(SKY_STATES ?? []).map((st) => [
        `sky/${st}`, SKY_TOKENS[st].mode, st,
        SKY_TOKENS[st].wallScrimSky,
        SKY_TOKENS[st].wallSkyTop, SKY_TOKENS[st].wallSkyMid, SKY_TOKENS[st].wallSkyBot,
        SKY_TOKENS[st].wallSkyS, SKY_TOKENS[st].wallSkyE,
      ]),
    ];

    let wWorstText = Infinity;
    let wWorstChip = Infinity;
    let wWorstEdge = Infinity;

    for (const [label, themeName, state, scrimHex, aTop, aMid, aBot, cs, ce] of FLAVOURS) {
      const t = SKY_TOKENS[state];
      const files = [SKY_MOD.imgPath(t.img), SKY_MOD.imgPath(t.imgWide)]
        .map((rel) => ROOT + "public" + rel)
        .filter((f) => existsSync(f));
      if (!files.length) continue; // already failed loudly above
      const chain = CASCADE[themeName];
      const scrim = hex(scrimHex);
      const ink = hex(resolveIn(chain, "--ink"));
      const inkDim = hex(resolveIn(chain, "--ink-dim"));
      const chipFill = rgba(resolveIn(chain, "--glass-chip"));
      const edgeStrong = rgba(resolveIn(chain, "--glass-edge-strong"));
      const herFill = hex(resolveIn(chain, "--surface-2"));
      const rooms = roomTextTokens(themeName, chain);
      const lift = (() => {
        try { return resolveIn(chain, "--bubble-her-lift"); } catch { return ""; }
      })();

      let minText = Infinity, whereText = "";
      let minChip = Infinity;
      let minEdge = Infinity;
      let minShape = Infinity;
      for (let i = 0; i < N_BANDS; i++) {
        // the curve at the band's WEAKEST point. It rises to `mid` and falls to
        // `bot`, so within any band the minimum is at one of its two edges.
        const alpha = Math.min(
          SKY_MOD.wallCurveAt(i / N_BANDS, aTop, aMid, aBot, cs, ce),
          SKY_MOD.wallCurveAt((i + 1) / N_BANDS, aTop, aMid, aBot, cs, ce),
        );
        const samples = [];
        for (const f of files) samples.push(...(await bandStrip(f, i)));
        for (const [sName, colour] of samples) {
          const ground = over(scrim, colour, alpha);
          const chip = over(chipFill.c, ground, chipFill.a);
          for (const [tName, c] of [["--ink", ink], ["--ink-dim", inkDim]]) {
            const r = ratio(c, ground);
            if (r < minText) { minText = r; whereText = `${tName} band ${i} ${sName} (veil ${alpha.toFixed(2)})`; }
          }
          for (const [tName, decl] of rooms) {
            const c = /^rgba?\(/.test(decl) ? over(rgba(decl).c, ground, rgba(decl).a) : hex(decl);
            const r = ratio(c, ground);
            if (r < minText) { minText = r; whereText = `${tName} band ${i} ${sName} (veil ${alpha.toFixed(2)})`; }
          }
          minChip = Math.min(minChip, ratio(ink, chip), ratio(inkDim, chip));
          minEdge = Math.min(minEdge, ratio(over(edgeStrong.c, chip, edgeStrong.a), ground));
          minShape = Math.min(minShape, ratio(herFill, ground));
        }
      }
      wWorstText = Math.min(wWorstText, minText);
      wWorstChip = Math.min(wWorstChip, minChip);
      wWorstEdge = Math.min(wWorstEdge, minEdge);

      check(`wallpaper/${label}: ground text >= ${TEXT_FLOOR}`, minText >= TEXT_FLOOR,
        `${minText.toFixed(2)} worst at ${whereText}`);
      check(`wallpaper/${label}: text on a glass chip >= ${TEXT_FLOOR}`, minChip >= TEXT_FLOOR,
        minChip.toFixed(2));
      check(`wallpaper/${label}: a CONTROL's edge >= ${EDGE_FLOOR}`, minEdge >= EDGE_FLOOR,
        minEdge.toFixed(2));
      // HER BUBBLE HAS TO BE A SHAPE, NOT ONLY A LEGIBLE ONE — the hole the
      // first version of this section shipped with. A gate that measures only
      // TEXT passes a design in which the container the text sits in has
      // vanished; the browser battery caught it on the light morning thread,
      // third bubble, at 1.02:1 where the city passes under `--surface-2`.
      // Only the inset ring made it a shape again, which is why the lift has to
      // carry an edge and a drop shadow alone was measured invisible.
      const hasLift = Boolean(lift) && lift !== "none";
      const hasEdge = /\binset\b/.test(lift);
      check(
        `wallpaper/${label}: her bubble is findable (fill ${minShape.toFixed(2)}:1, or a lift)`,
        minShape >= 1.25 || (hasLift && hasEdge),
        hasLift ? (hasEdge ? "carries --bubble-her-lift with an inset edge" : "lift has no inset edge") : "no lift",
      );
    }

    // ══ THE FELT ASSERTION ═════════════════════════════════════════════════
    //
    // Every ratio above would have passed the frame the owner rejected, and so
    // would the round-one presence laws. This is the check with teeth, and its
    // threshold is calibrated against the two real frames rather than picked:
    // the BEFORE (morning under one flat 0.88 white veil) must FAIL it and the
    // AFTER must pass, or it is decoration.
    //
    // What it measures is the thing a person actually sees: in the UPPER THIRD
    // of the surface — the open sky, the part of the thread that is mostly
    // empty and therefore mostly picture — how far does the composited ground
    // sit from the theme's own FLAT ground? A tint is a few units away from
    // `--bg`. A sky is not. Mean absolute deviation across R, G and B, in 0-255
    // units, over every band of the upper third at avg/darkest/brightest.
    //
    // MEASURED, and both controls are recomputed on every run rather than
    // quoted: the shipped day wash (0.93 flat) reads 3.7, the REJECTED round-one
    // frame (0.88 flat, the one captioned "I see no sky") reads 4.2, and the
    // curve gives morning 7.1, golden 10.7, dusk 17.2, night and predawn 18.9
    // and 20.4.
    //
    // The floor is 6.0 and the gap on each side is the calibration: 1.8 above
    // the frame that was rejected, 1.1 below the tightest frame that ships.
    // Morning is the tightest by a long way and that is physics rather than
    // timidity — its ceiling is dark dim ink read on a veiled blue sky, and
    // #ffffff is already the brightest veil there is. If this row ever fails on
    // morning, the answer is not a lower floor.
    {
      const FELT_FLOOR = 6.0;
      const feltOf = async (themeName, state, scrimHex, aTop, aMid, aBot, cs, ce) => {
        const t = SKY_TOKENS[state];
        const files = [SKY_MOD.imgPath(t.img)].map((r) => ROOT + "public" + r).filter((f) => existsSync(f));
        const flat = hex(resolveIn(CASCADE[themeName], "--bg"));
        const scrim = hex(scrimHex);
        let sum = 0;
        let n = 0;
        for (let i = 0; i < Math.ceil(N_BANDS / 3); i++) {
          const alpha = Math.min(
            SKY_MOD.wallCurveAt(i / N_BANDS, aTop, aMid, aBot, cs, ce),
            SKY_MOD.wallCurveAt((i + 1) / N_BANDS, aTop, aMid, aBot, cs, ce),
          );
          for (const f of files) {
            for (const [, colour] of await bandStrip(f, i)) {
              const ground = over(scrim, colour, alpha);
              for (let k = 0; k < 3; k++) { sum += Math.abs(ground[k] - flat[k]) * 255; n++; }
            }
          }
        }
        return sum / n;
      };

      // THE NEGATIVE CONTROL, RUN EVERY TIME. The frame the owner rejected is
      // computed here and asserted to FAIL, so the floor can never be quietly
      // lowered to whatever the current design happens to produce.
      const before = await feltOf("light", "morning", "#ffffff", 0.88, 0.88, 0.88, 0.5, 0.8);
      check(
        "felt/control: the REJECTED flat 0.88 morning frame fails the floor",
        before < FELT_FLOOR,
        `${before.toFixed(1)} vs floor ${FELT_FLOOR}`,
      );
      const shipped = await feltOf("light", "morning", SKY_TOKENS.morning.wallScrimLight,
        SKY_TOKENS.morning.wallAlphaLight, SKY_TOKENS.morning.wallAlphaLight, SKY_TOKENS.morning.wallAlphaLight, 0.5, 0.8);
      check(
        "felt/control: the day wash is a wash and is not claimed otherwise",
        shipped < FELT_FLOOR,
        `${shipped.toFixed(1)} (explicit Light is deliberately quiet)`,
      );

      // …and every ALIVE flavour has to clear it. That is the whole set of
      // surfaces the owner is entitled to see a painting on: the night room,
      // and Sky at all five hours.
      for (const [label, themeName, state, scrimHex, aTop, aMid, aBot, cs, ce] of FLAVOURS) {
        if (label.startsWith("light/")) continue; // the quiet wash, by design
        const felt = await feltOf(themeName, state, scrimHex, aTop, aMid, aBot, cs, ce);
        check(
          `felt/${label}: the upper third is a PAINTING, not a tint (>= ${FELT_FLOOR})`,
          felt >= FELT_FLOOR,
          `${felt.toFixed(1)}`,
        );
      }
    }

    // ── THE CURVE MUST STAY A CURVE ────────────────────────────────────────
    // Flatten it and every ratio above still passes — one number CAN clear the
    // floors, it just cannot be the right number twice. This is the property
    // that has no ratio, and it is the one the owner photographed.
    for (const st of SKY_STATES ?? []) {
      const t = SKY_TOKENS[st];
      check(
        `wallpaper/${st}: the sky-choice veil is a curve, not one number`,
        t.wallSkyMid - t.wallSkyTop >= 0.05,
        `top ${t.wallSkyTop} -> mid ${t.wallSkyMid} -> bot ${t.wallSkyBot}`,
      );
      check(
        `wallpaper/${st}: the sky-choice top is thinner than the flat veil it replaced`,
        t.wallSkyTop <= (t.mode === "light" ? t.wallAlphaLight : t.wallAlphaDark) - 0.05,
        `${t.wallSkyTop} vs flat ${t.mode === "light" ? t.wallAlphaLight : t.wallAlphaDark}`,
      );
      check(
        `wallpaper/${st}: the sky-choice veil is the palette's own extreme`,
        t.wallScrimSky === (t.mode === "light" ? SKY_MOD.WALL_SCRIM_LIGHT_SKY : SKY_MOD.WALL_SCRIM_DARK_SKY),
        t.wallScrimSky,
      );
      check(
        `wallpaper/${st}: the light theme stays a wash, not a photo`,
        t.wallAlphaLight >= 0.9,
        String(t.wallAlphaLight),
      );
    }
    // The night room IS the sky's night rather than a second table — one
    // painting, one curve, one veil colour. Pinned, because a copy is what
    // would drift, and the drift would be a dark thread that no longer matches
    // the dark thread Sky paints at 2am.
    check(
      "night-room: it is the sky's own night, not a second table",
      SKY_MOD.NIGHT_ROOM_STATE === "night",
      String(SKY_MOD.NIGHT_ROOM_STATE),
    );

    // ── THE ATTRIBUTE THE WHOLE SWAP RESTS ON ──────────────────────────────
    //
    // Every sky row above describes a screen that only exists if two things
    // are true of files no test here runs: `applyTheme` stamps the attribute
    // world.css keys off, and it writes `data-theme` BEFORE stamping it.
    // Reorder the two and there is a frame with a sky choice and no theme.
    {
      const themeTs = read("src/engine/theme.ts");
      const iTheme = themeTs.indexOf('root.setAttribute("data-theme", skyMode(nowMs))');
      const iSky = themeTs.indexOf('root.setAttribute("data-sky-choice"');
      check("sky-choice: applyTheme stamps the presence attribute", iSky > -1);
      check(
        "sky-choice: it is removed for every other choice",
        /root\.removeAttribute\("data-sky-choice"\)/.test(themeTs),
      );
      check(
        "sky-choice: data-theme is written BEFORE it",
        iTheme > -1 && iSky > iTheme,
        `theme at ${iTheme}, sky-choice at ${iSky}`,
      );
      const w2 = read("src/styles/world.css");
      const skySel = ':root[data-sky-choice] .world[data-variant="wallpaper"]';
      const kk = w2.indexOf(skySel);
      const body = kk > -1 ? w2.slice(w2.indexOf("{", kk), w2.indexOf("}", kk)) : "";
      check(
        "sky-choice: world.css swaps the wallpaper veil for the state's curve",
        kk > -1 &&
          ["--wall-scrim-sky", "--wall-a-sky-top", "--wall-a-sky-mid", "--wall-a-sky-bot"].every((n) =>
            body.includes(`var(${n})`),
          ),
        body.trim().replace(/\s+/g, " ").slice(0, 70),
      );
      check(
        "sky-choice: the header band takes the same veil",
        w2.includes(':root[data-sky-choice] .world[data-variant="band"]'),
      );
      // The FULL variant is deliberately absent from every selector in this
      // family. Home and both call screens already show the whole world in
      // every mode — that is stated in applyTheme's own note, and it is the
      // half of the honest-clock promise that the night room does not touch.
      check(
        "sky-choice: it does NOT touch the full world (home and calls show it already)",
        !/\[data-sky-choice\][^{]*data-variant="full"/.test(w2),
      );
      check(
        "night-room: it does NOT touch the full world either",
        !/:not\(\[data-sky-choice\]\)[^{]*data-variant="full"/.test(w2),
      );
    }

    console.log(
      `  ..  wallpaper worst case: ground text ${wWorstText.toFixed(2)}:1, ` +
        `chip text ${wWorstChip.toFixed(2)}:1, control edge ${wWorstEdge.toFixed(2)}:1`,
    );

    // ── WS-SWEEP: THE ROOMS DO NOT PAINT OVER THEIR OWN WORLD ──────────────
    //
    // Every ratio above is a claim about text sitting on a PAINTING, and each
    // one is worth nothing if the painting is not on screen. On the thread that
    // cannot happen by accident — the wallpaper was the whole point of the
    // change. On the four surfaces that joined it, it can: `.as` and `.us` both
    // carry a full derived palette including a GROUND, and a ground colour on
    // the root paints ON TOP of a `z-index: -1` child. Set one and the world
    // vanishes while every number in this file goes on passing, because the
    // numbers model a composite the browser has stopped performing.
    //
    // That is the same species of hole `evals/world-thread-browser.mjs` was
    // written for and states in its own header: "a model of a composite cannot
    // notice the composite is not happening." The browser battery is still the
    // real proof; this is the cheap one that runs on every build, and it is a
    // STRUCTURAL check because there is no ratio that can express it.
    for (const [room, file, sel, tok] of [
      ["as", "src/styles/games.css", ".as", "--ga-ground"],
      ["us", "src/styles/us.css", ".us", "--u-ground"],
    ]) {
      const src = read(file);
      // Reversed, for the cascade reason the room-text block states, and with
      // the app palette behind it — a room that re-points its ground at
      // `var(--bg)` has to RESOLVE to `#faf7f4` and be reported as that, not
      // throw a stack trace at whoever did it.
      const v = resolveIn([...allBlocks(src, sel).reverse(), ...CASCADE.light], tok);
      check(
        `${room}: the room's ground is transparent, so the world is visible`,
        v.trim() === "transparent",
        `${tok} -> ${v}`,
      );
      // …and the layer is actually mounted behind it. A transparent ground over
      // nothing is a transparent ground: the `> .world` rule is what puts the
      // picture there and holds it out of the scroller.
      check(
        `${room}: the world layer is a sibling at a negative z-index`,
        /\n\.(as|us) > \.world \{[^}]*z-index:\s*-1/.test(src),
        "",
      );
    }

    // ══ A SHEET IS GLASS TOO ═══════════════════════════════════════════════
    //
    // Settings, the profile editor and both destroy-confirmations are one
    // sheet, and that sheet now floats over a thread whose ground is a
    // PAINTING. Everything above works by decoding the exact pixels a surface
    // sits on; this one cannot, because a sheet can be dragged up over any
    // scroll position of any conversation, so the set of grounds is the set of
    // things anyone has ever said plus five skies.
    //
    // So it is bounded instead of sampled, and that is a STRONGER proof rather
    // than a weaker one. The fill is opaque enough that the ground contributes
    // a fixed fraction, contrast is monotonic in the ground's luminance, and
    // therefore the two extremes bracket every possible case: if the sheet's
    // text clears 4.5:1 over PURE BLACK and over PURE WHITE, it clears it over
    // everything. There is no third case. A sampled version of this check
    // would be measuring a few of the conversations someone might have.
    console.log("");
    {
      const BLACK = [0, 0, 0];
      const WHITE = [1, 1, 1];
      for (const [themeName, chain] of Object.entries(CASCADE)) {
        const glass = rgba(resolveIn(chain, "--sheet-glass"));
        const ink = hex(resolveIn(chain, "--ink"));
        const inkDim = hex(resolveIn(chain, "--ink-dim"));
        let worst = Infinity;
        let where = "";
        for (const [gName, ground] of [["black", BLACK], ["white", WHITE]]) {
          const surface = over(glass.c, ground, glass.a);
          for (const [iName, colour] of [["ink", ink], ["ink-dim", inkDim]]) {
            const r = ratio(colour, surface);
            if (r < worst) {
              worst = r;
              where = `${iName} over ${gName}`;
            }
          }
        }
        // NOTE ON WHAT IS *NOT* CHECKED HERE, because the first version of
        // this block checked it and was wrong. `--ink-faint` on the sheet was
        // held to 3:1 over both extremes, which the light theme failed at
        // 2.69:1 — a real finding — but the FLOOR was mis-specified: the token
        // block defines `--ink-faint` as a non-text role sitting at 2.9:1 on
        // its own ground, so 3:1 is a bar it exists below by design and can
        // only meet by ceasing to be itself. The finding was real and the
        // check was not; the finding's actual subject was WHICH TOKEN the
        // AI-disclosure footer used, and that is pinned below as a token
        // choice rather than as a ratio it could never satisfy.
        check(
          `sheet/${themeName}: body text on the glass sheet >= ${TEXT_FLOOR} over ANY ground`,
          worst >= TEXT_FLOOR,
          `${worst.toFixed(2)} worst at ${where} (fill ${glass.a})`,
        );
        // The bound only exists because the fill is heavy. State the premise
        // as a check, or the next person to make the sheet "more glassy" at
        // 0.7 quietly turns a proof into an estimate.
        check(
          `sheet/${themeName}: the fill is opaque enough for the bound to hold`,
          glass.a >= 0.9,
          String(glass.a),
        );
      }
      // …and the honesty line actually takes that text role. A property of a
      // stylesheet the code never reads, same species as the ttt keyframe.
      const footBlock = cssBlock(g, "\n.sheet-foot {");
      const footColour = /(?:^|[\s;])color:\s*([^;]+);/.exec(footBlock)?.[1]?.trim();
      check(
        "sheet: the AI-disclosure footer is inked in a TEXT role",
        footColour === "var(--ink-dim)" || footColour === "var(--ink)",
        String(footColour),
      );
    }

    // ══ THE LANDING PAGE IS THE SAME WORLD, AND HAS THE SAME FLOORS ════════
    //
    // `site/` is a hand-written static page with no build step, so nothing
    // that compiles the app has ever looked at it. It now paints the same five
    // paintings under the same five veils, which means every failure mode this
    // whole file exists for is available to it — with one that the app does
    // not have.
    //
    // THE ONE THE APP DOES NOT HAVE: the landing's text SCROLLS across a sky
    // that does not. In the app a surface's text sits in a known band of a
    // known picture; here a paragraph starts life at 80% of the painting and
    // ends it at 5%, and the veil it carries travels with it. So the model is
    // a PREFIX walk rather than a band lookup: content at depth q carries the
    // veil authored at q, and over its life it passes every part of the
    // painting from q upward, so that veil is measured against the worst
    // ground in bands 0..q rather than against band q alone. Scrolling only
    // moves content up the picture, never down, which is what makes the prefix
    // the complete set rather than a sample of it.
    //
    // The rest is the same composite the world half computes, over the same
    // decoded pixels of the same shipped files.
    console.log("");
    {
      const site = read("site/styles.css");
      const index = read("site/index.html");

      const blockOf = (sel) => {
        const i = site.indexOf(`\n${sel} {`);
        if (i === -1) return null;
        const open = site.indexOf("{", i);
        const close = site.indexOf("\n}", open);
        return close === -1 ? null : site.slice(open + 1, close);
      };
      const tok = (block, name) => {
        const m = new RegExp(`(?:^|[\\s;])${name}:\\s*([^;]+);`).exec(block);
        return m ? m[1].trim() : null;
      };
      const asRgba = (c, a) => {
        const [r, g2, b] = hex(c).map((v) => Math.round(v * 255));
        return `rgba(${r}, ${g2}, ${b}, ${a})`;
      };

      // The two mode palettes are multi-selector blocks, so they are found by
      // the FIRST selector in the list rather than by the whole list.
      const paletteBlock = (mode) => {
        const first = mode === "dark" ? ":root,\n[data-sky=\"night\"]" : '[data-sky="morning"],';
        const i = site.indexOf(first);
        const open = site.indexOf("{", i);
        const close = site.indexOf("\n}", open);
        return i === -1 || close === -1 ? "" : site.slice(open + 1, close);
      };

      const SEL = {
        night: ":root",
        predawn: '[data-sky="predawn"]',
        morning: '[data-sky="morning"]',
        golden: '[data-sky="golden"]',
        dusk: '[data-sky="dusk"]',
      };

      // ── 1. THE PICKER MUST NOT DRIFT FROM sky.ts ─────────────────────────
      //
      // The landing cannot import `stateAtMinute`; it ships verbatim to a
      // browser with no bundler in front of it, so it carries a HAND COPY of
      // the boundary table. A hand copy is fine and a hand copy that nothing
      // compares is a second clock waiting to happen: move a boundary in
      // sky.ts and the app changes sky at 19:40 while the page a visitor came
      // in through changes at the old minute, and both look right alone.
      {
        const src = index.slice(index.indexOf("var BOUNDS = ["), index.indexOf("];", index.indexOf("var BOUNDS = [")));
        const mine = [...src.matchAll(/\[\s*(\d+)\s*,\s*"(\w+)"\s*\]/g)].map((m) => [+m[1], m[2]]);
        const theirs = (SKY_MOD.SKY_BOUNDARIES ?? []).map((b) => [b.at, b.state]);
        check(
          "landing/picker: the boundary table matches src/engine/sky.ts",
          JSON.stringify(mine) === JSON.stringify(theirs),
          `landing ${JSON.stringify(mine)} vs sky.ts ${JSON.stringify(theirs)}`,
        );
      }

      // ── 2. THE STATE TABLE IS sky.ts's TABLE ─────────────────────────────
      //
      // Same argument one level down. The stylesheet's header claims these
      // values are copied "to the byte"; a claim in a comment is worth exactly
      // what checks it.
      for (const state of SKY_STATES ?? []) {
        const b = blockOf(SEL[state]);
        if (!b) {
          check(`landing/${state}: the state block exists`, false, SEL[state]);
          continue;
        }
        const t = SKY_TOKENS[state];
        const same = [
          ["--ink", tok(b, "--ink"), t.ink],
          ["--ink-dim", tok(b, "--ink-dim"), t.inkDim],
          ["--sky-flat", tok(b, "--sky-flat"), t.stops[0]],
          ["--glass", tok(b, "--glass"), asRgba(t.control, t.controlAlpha)],
          ["--edge", tok(b, "--edge"), asRgba(t.edge, t.edgeAlpha)],
          ["--scrim-mid", tok(b, "--scrim-mid"), asRgba(t.scrim, 0.55)],
          ["--paint", tok(b, "--paint"), t.img],
          ["--paint-wide", tok(b, "--paint-wide"), t.imgWide],
        ];
        const bad = same.filter(([, got, want]) => got !== want);
        check(
          `landing/${state}: sky tokens are sky.ts's, to the value`,
          bad.length === 0,
          bad.map(([n, got, want]) => `${n} is ${got}, sky.ts says ${want}`).join("; "),
        );

        // the two veils are the state's OWN scrims, not a colour of their own
        const wallScrim = t.mode === "dark" ? t.wallScrimDark : t.wallScrimLight;
        const veilA = rgba(tok(b, "--veil-a"));
        const veilB = rgba(tok(b, "--veil-b"));
        const veilG = rgba(tok(b, "--veil-ground"));
        const sameColour = (x, y) => x.c.every((v, i) => Math.abs(v - hex(y)[i]) < 0.004);
        check(
          `landing/${state}: the hero veil is the sky's own scrim`,
          sameColour(veilA, t.scrim) && sameColour(veilB, t.scrim),
          t.scrim,
        );
        check(
          `landing/${state}: the ground veil is the thread wallpaper's own scrim`,
          sameColour(veilG, wallScrim),
          wallScrim,
        );
        // a curve, not a number. If someone flattens it back to one value the
        // painting goes with it (see the stylesheet's note), and every ratio
        // below would still pass.
        check(
          `landing/${state}: the hero veil is still a curve`,
          veilB.a - veilA.a > 0.05,
          `${veilA.a} -> ${veilB.a}`,
        );
      }

      // ── 3. THE MODEL IS PINNED TO THE STYLESHEET ─────────────────────────
      // Same species as the `.world-scrim` opacity check above: the maths
      // below is only true of a page whose .veil rule actually uses these four
      // stops. A refactor to a background-image or an element `opacity` would
      // leave every number here describing a page nobody ships.
      {
        const v = blockOf(".veil");
        const bg = v ? tok(v, "background") : null;
        check(
          "landing/veil: .veil is a four-stop linear-gradient on the veil tokens",
          Boolean(bg) &&
            bg.includes("linear-gradient") &&
            ["--veil-a", "--veil-b", "--veil-s", "--veil-e", "--veil-ground"].every((n) => bg.includes(n)),
          String(bg).slice(0, 60),
        );
        const op = v ? tok(v, "opacity") : null;
        check("landing/veil: .veil declares no fractional opacity", op === null, String(op));
      }

      // ── 4. THE FLOORS ────────────────────────────────────────────────────
      const N = 20;
      const stripSamples = async (file, i) => {
        const meta = await sharp(file).metadata();
        const top = Math.floor((meta.height * i) / N);
        const h = Math.max(1, Math.floor((meta.height * (i + 1)) / N) - top);
        const { data, info } = await sharp(file)
          .extract({ left: 0, top, width: meta.width, height: h })
          .resize({ width: 200 })
          .raw()
          .toBuffer({ resolveWithObject: true });
        const px = [];
        for (let k = 0; k < data.length; k += info.channels) {
          px.push([data[k] / 255, data[k + 1] / 255, data[k + 2] / 255]);
        }
        px.sort((a, c) => lum(a) - lum(c));
        const mean = (arr) => [0, 1, 2].map((k) => arr.reduce((s, q) => s + q[k], 0) / arr.length);
        const d = Math.max(1, Math.round(px.length * 0.1));
        return [mean(px), mean(px.slice(0, d)), mean(px.slice(px.length - d))];
      };

      let lWorstText = Infinity;
      let lWorstPanel = Infinity;
      let lWorstEdge = Infinity;
      let lWorstGround = Infinity;

      for (const state of SKY_STATES ?? []) {
        const b = blockOf(SEL[state]);
        if (!b) continue;
        const t = SKY_TOKENS[state];
        const scrim = hex(t.scrim);
        const ink = hex(t.ink);
        const inkDim = hex(t.inkDim);
        const control = hex(t.control);
        const edge = hex(t.edge);

        const a0 = rgba(tok(b, "--veil-a")).a;
        const a1 = rgba(tok(b, "--veil-b")).a;
        const s0 = parseFloat(tok(b, "--veil-s")) / 100;
        const s1 = parseFloat(tok(b, "--veil-e")) / 100;
        // The authored curve, in numbers. Past `--veil-e` the real gradient
        // keeps climbing toward the ground alpha; holding it at a1 here is the
        // conservative reading, so the page is always at least this legible.
        const alphaAt = (x) => (x <= s0 ? a0 : x >= s1 ? a1 : a0 + ((a1 - a0) * (x - s0)) / (s1 - s0));

        const files = [SKY_MOD.imgPath(t.img), SKY_MOD.imgPath(t.imgWide)]
          .map((rel) => ROOT + "public" + rel)
          .filter((f) => existsSync(f));

        const pool = [];
        let minText = Infinity;
        let minPanel = Infinity;
        let minEdge = Infinity;
        let where = "";
        for (let i = 0; i < N; i++) {
          for (const f of files) pool.push(...(await stripSamples(f, i)));
          const A = alphaAt(i / N);
          for (const g0 of pool) {
            const ground = over(scrim, g0, A);
            const panel = over(control, ground, t.controlAlpha);
            const rText = Math.min(ratio(ink, ground), ratio(inkDim, ground));
            if (rText < minText) {
              minText = rText;
              where = `${((i * 100) / N) | 0}% at veil ${A.toFixed(2)}`;
            }
            minPanel = Math.min(minPanel, ratio(ink, panel), ratio(inkDim, panel));
            minEdge = Math.min(minEdge, ratio(over(edge, panel, t.edgeAlpha), ground));
          }
        }
        lWorstText = Math.min(lWorstText, minText);
        lWorstPanel = Math.min(lWorstPanel, minPanel);
        lWorstEdge = Math.min(lWorstEdge, minEdge);
        check(
          `landing/${state}: hero text over the painting >= ${TEXT_FLOOR}`,
          minText >= TEXT_FLOOR,
          `${minText.toFixed(2)} worst at ${where}`,
        );
        check(
          `landing/${state}: text on the glass over the painting >= ${TEXT_FLOOR}`,
          minPanel >= TEXT_FLOOR,
          minPanel.toFixed(2),
        );
        check(
          `landing/${state}: the glass edge over the painting >= ${EDGE_FLOOR}`,
          minEdge >= EDGE_FLOOR,
          minEdge.toFixed(2),
        );

        // Past the fold the veil is the wallpaper's and the ink is the THEME's
        // — the app's own palette for this state's mode, because the landing
        // has no theme switch: the sky is the theme (DESIGN-WORLD §4). Content
        // down here has crossed the whole painting, so the whole frame is the
        // ground.
        {
          const chain = t.mode === "dark" ? CASCADE.dark : CASCADE.light;
          const pal = paletteBlock(t.mode);
          const gInkV = tok(pal, "--ground-ink");
          const gDimV = tok(pal, "--ground-dim");
          const gInk = hex(gInkV ?? "#000000");
          const gDim = hex(gDimV ?? "#000000");
          // and they must BE the app's, not a near miss
          check(
            `landing/${state}: the ground palette is global.css's ${t.mode} ink`,
            gInkV === resolveIn(chain, "--ink") && gDimV === resolveIn(chain, "--ink-dim"),
            `${resolveIn(chain, "--ink")} / ${resolveIn(chain, "--ink-dim")}`,
          );

          const veilG = rgba(tok(b, "--veil-ground"));
          let worst = Infinity;
          for (const f of files) {
            const s = await bandSamples(f, "full");
            for (const colour of [s.avg, s.darkest, s.brightest]) {
              const ground = over(veilG.c, colour, veilG.a);
              worst = Math.min(worst, ratio(gInk, ground), ratio(gDim, ground));
            }
          }
          lWorstGround = Math.min(lWorstGround, worst);
          check(
            `landing/${state}: body copy on the wallpapered ground >= ${TEXT_FLOOR}`,
            worst >= TEXT_FLOOR,
            `${worst.toFixed(2)} (veil ${veilG.a})`,
          );
          // …and the ground must not become a solid colour either. The whole
          // reason the world keeps going past the fold is that you can still
          // see it.
          check(
            `landing/${state}: the ground still lets the painting through`,
            veilG.a <= 0.95,
            `${veilG.a} (painting at ${((1 - veilG.a) * 100) | 0}%)`,
          );
        }
      }

      // ── the reading variant ──────────────────────────────────────────────
      // privacy.html swaps the hero curve for the ground veil across the whole
      // page (`body.reading`), which puts the nav's wordmark and its glass
      // pill on the wallpapered ground instead of on open sky. Different
      // ground, different ink, so a different check: the numbers above prove
      // nothing about a surface they never composited.
      {
        const readingSwap = site.includes("body.reading .veil") && site.includes("var(--veil-ground)");
        check("landing/reading: privacy.html takes the wallpaper veil", readingSwap);
        check(
          "landing/reading: privacy.html is marked as the reading variant",
          read("site/privacy.html").includes('<body class="reading">'),
        );
        let rWorst = Infinity;
        for (const state of SKY_STATES ?? []) {
          const b2 = blockOf(SEL[state]);
          if (!b2) continue;
          const t = SKY_TOKENS[state];
          const pal = paletteBlock(t.mode);
          const gInk = hex(tok(pal, "--ground-ink"));
          const gDim = hex(tok(pal, "--ground-dim"));
          const veilG = rgba(tok(b2, "--veil-ground"));
          const control = hex(t.control);
          const edge = hex(t.edge);
          let minText = Infinity;
          let minEdge = Infinity;
          for (const rel of [SKY_MOD.imgPath(t.img), SKY_MOD.imgPath(t.imgWide)]) {
            const f = ROOT + "public" + rel;
            if (!existsSync(f)) continue;
            const s2 = await bandSamples(f, "full");
            for (const colour of [s2.avg, s2.darkest, s2.brightest]) {
              const ground = over(veilG.c, colour, veilG.a);
              const panel = over(control, ground, t.controlAlpha);
              minText = Math.min(minText, ratio(gInk, ground), ratio(gDim, ground), ratio(gInk, panel));
              minEdge = Math.min(minEdge, ratio(over(edge, panel, t.edgeAlpha), ground));
            }
          }
          rWorst = Math.min(rWorst, minText);
          check(
            `landing/reading/${state}: nav and copy on the ground >= ${TEXT_FLOOR}`,
            minText >= TEXT_FLOOR,
            minText.toFixed(2),
          );
          check(
            `landing/reading/${state}: the nav pill's edge >= ${EDGE_FLOOR}`,
            minEdge >= EDGE_FLOOR,
            minEdge.toFixed(2),
          );
        }
        console.log(`  ..  landing reading variant worst case: ${rWorst.toFixed(2)}:1`);
      }

      console.log(
        `  ..  landing worst case: hero text ${lWorstText.toFixed(2)}:1, on glass ` +
          `${lWorstPanel.toFixed(2)}:1, glass edge ${lWorstEdge.toFixed(2)}:1, ` +
          `body copy ${lWorstGround.toFixed(2)}:1`,
      );
    }
  }
}

// ── WS-KNOWS: the memory surface is a CALL SITE, never a new material ──────
//
// src/styles/knows.css paints nothing of its own. Every colour on it resolves
// to an app token, so the floors that already cover this exact situation — ink
// and the glass family over the wallpapered sky, measured in five skies and
// two themes by the world block above — cover it too, with no second set of
// numbers to keep in step.
//
// That is a claim about the FILE, and a claim about a file is what this script
// exists to make enforceable. Three things can quietly break it: a hard-coded
// colour ("just this one row"), a `data-theme` block (a second palette, which
// drifts the moment either copy is touched, and which is the failure the two
// board files carry byte-identical dark blocks to avoid), and a control drawn
// with a LABEL's edge instead of a CONTROL's. The last one is a real contrast
// bug rather than a stylistic one: global.css gates `--glass-edge-strong` to
// >= 3:1 because a control has to be findable, and `--glass-edge` is a whisper
// designed for a day separator.
{
  const k = read("src/styles/knows.css");

  check(
    "knows: no second palette (no data-theme block, no media palette)",
    !/\[data-theme/.test(k) && !/prefers-color-scheme/.test(k),
  );

  // every --k-* token derives, with the two stated exceptions: the ground is
  // deliberately `transparent` (the world is a real element behind it, so a
  // ground painted here would hide the painting while every ratio went on
  // passing), and the blur is a filter, not a colour.
  const decls = [...k.matchAll(/(--k-[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]);
  check("knows: the derived token set is still there", decls.length >= 8, `${decls.length} tokens`);
  const literal = decls.filter(
    ([name, value]) =>
      name !== "--k-ground" && name !== "--k-blur" && !/var\(--/.test(value),
  );
  check(
    "knows: every colour derives from an app token",
    literal.length === 0,
    literal.map(([n, v]) => `${n}: ${v}`).join(", "),
  );
  check(
    "knows: the ground is the world's, not a colour of its own",
    /--k-ground:\s*transparent/.test(k),
  );

  // the fact card is the measured glass, and the two controls on it wear the
  // gated CONTROL edge rather than the label one
  const block = (sel) => {
    const i = k.indexOf(`\n${sel} {`);
    return i < 0 ? "" : k.slice(i, k.indexOf("\n}", i));
  };
  check(
    "knows: the fact card is --glass-chip over the sky, the measured material",
    /background:\s*var\(--k-card\)/.test(block(".knows-fact")) &&
      decls.some(([n, v]) => n === "--k-card" && v.includes("--glass-chip")),
  );
  check(
    "knows: the correction control takes the gated control edge (>= 3:1)",
    /border:[^;]*var\(--k-line-strong\)/.test(block(".knows-fix")),
    block(".knows-fix").split("\n").find((l) => /border:/.test(l)) ?? "(no border decl)",
  );
  check(
    "knows: the timeline thread takes the control edge, not the label one",
    /border-left:[^;]*var\(--k-line-strong\)/.test(block(".knows-time")),
  );
  // and the tokens those two names point at are the gated pair themselves
  check(
    "knows: --k-line-strong IS --glass-edge-strong",
    decls.some(([n, v]) => n === "--k-line-strong" && v.includes("--glass-edge-strong")),
  );
}

console.log(failed ? `\n${failed} contrast/legibility checks FAILED` : "\nboard legibility ok");
process.exit(failed ? 1 : 0);
