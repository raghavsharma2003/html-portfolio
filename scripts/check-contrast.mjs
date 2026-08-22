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

    // ── the two wallpaper veil blocks stay byte-identical ──────────────────
    // Same law and same failure as the palette's own two dark blocks: if they
    // drift, one of the two ways into the dark theme keeps the LIGHT veil, and
    // only the users who got there that way ever see a white wash over a night
    // sky. `darkBlocks` is the same helper the board files use.
    {
      const w = read("src/styles/world.css");
      const veils = darkBlocks(w, ':root:not([data-theme="light"]) .world[data-variant="band"]')
        .concat(darkBlocks(w, ':root[data-theme="dark"] .world[data-variant="band"]'));
      check(
        "wallpaper: the two dark-veil blocks are byte-identical",
        veils.length === 2 && veils[0] === veils[1],
        veils.length === 2 ? "" : `found ${veils.length}`,
      );
    }

    const THEME_INK = {
      light: { chain: CASCADE.light, scrimKey: "wallScrimLight", alphaKey: "wallAlphaLight" },
      dark: { chain: CASCADE.dark, scrimKey: "wallScrimDark", alphaKey: "wallAlphaDark" },
    };

    let wWorstText = Infinity;
    let wWorstChip = Infinity;
    let wWorstEdge = Infinity;

    for (const state of SKY_STATES ?? []) {
      const t = SKY_TOKENS[state];
      const painting = ROOT + "public" + SKY_MOD.imgPath(t.img);
      if (!existsSync(painting)) continue; // already failed loudly above
      const regions = [];
      for (const which of ["top", "bottom", "full"]) {
        const s = await bandSamples(painting, which);
        for (const [name, colour] of Object.entries(s)) regions.push([`${which}/${name}`, colour]);
      }

      for (const [themeName, cfg] of Object.entries(THEME_INK)) {
        const chain = cfg.chain;
        const scrim = hex(t[cfg.scrimKey]);
        const alpha = t[cfg.alphaKey];
        const ink = hex(resolveIn(chain, "--ink"));
        const inkDim = hex(resolveIn(chain, "--ink-dim"));
        const chipFill = rgba(resolveIn(chain, "--glass-chip"));
        const edgeStrong = rgba(resolveIn(chain, "--glass-edge-strong"));

        check(
          `wallpaper/${state}/${themeName}: the veil is a real veil`,
          alpha >= 0.35 && alpha <= 0.97,
          String(alpha),
        );

        let minText = Infinity;
        let minChip = Infinity;
        let minEdge = Infinity;
        let whereText = "";
        for (const [name, colour] of regions) {
          const ground = over(scrim, colour, alpha);
          const chip = over(chipFill.c, ground, chipFill.a);
          const rText = Math.min(ratio(ink, ground), ratio(inkDim, ground));
          if (rText < minText) {
            minText = rText;
            whereText = name;
          }
          minChip = Math.min(minChip, ratio(ink, chip), ratio(inkDim, chip));
          minEdge = Math.min(minEdge, ratio(over(edgeStrong.c, chip, edgeStrong.a), ground));
        }
        wWorstText = Math.min(wWorstText, minText);
        wWorstChip = Math.min(wWorstChip, minChip);
        wWorstEdge = Math.min(wWorstEdge, minEdge);

        check(
          `wallpaper/${state}/${themeName}: ground text >= ${TEXT_FLOOR}`,
          minText >= TEXT_FLOOR,
          `${minText.toFixed(2)} worst at ${whereText} (veil ${alpha})`,
        );
        check(
          `wallpaper/${state}/${themeName}: text on a glass chip >= ${TEXT_FLOOR}`,
          minChip >= TEXT_FLOOR,
          minChip.toFixed(2),
        );
        check(
          `wallpaper/${state}/${themeName}: a CONTROL's edge >= ${EDGE_FLOOR}`,
          minEdge >= EDGE_FLOOR,
          minEdge.toFixed(2),
        );

        // ── HER BUBBLE HAS TO BE A SHAPE, NOT ONLY A LEGIBLE ONE ────────────
        //
        // THIS IS THE HOLE THE FIRST VERSION OF THIS SECTION SHIPPED WITH, and
        // it is worth the space because it is the same hole the world half
        // already records one floor above: a gate that measures only TEXT
        // contrast passes a design in which the container the text sits in has
        // vanished. The browser battery caught it in a screenshot — the light
        // morning thread, third bubble, where the wallpaper's city passes under
        // `--surface-2` and the two meet at 1.02:1. The first two bubbles sat
        // over open sky and looked perfect, which is exactly why nothing else
        // would have found it.
        //
        // Text contrast was never the problem: `--ink` on `--surface-2` is
        // unchanged and still 15:1, because the bubble is still opaque. What was
        // lost is the BUBBLE — the grouping, who said what, where one message
        // ends. So the check is on the fill against the ground it now floats on,
        // and where that is too close to read as a shape, the bubble must carry
        // a lift (a shadow in the day, an inset hairline at night — the app's
        // own elevation rule, see --bubble-her-lift).
        {
          const herFill = hex(resolveIn(cfg.chain, "--surface-2"));
          const scrimC = hex(t[cfg.scrimKey]);
          let minShape = Infinity;
          for (const [, colour] of regions) {
            minShape = Math.min(minShape, ratio(herFill, over(scrimC, colour, t[cfg.alphaKey])));
          }
          const lift = (() => {
            try {
              return resolveIn(cfg.chain, "--bubble-her-lift");
            } catch {
              return "";
            }
          })();
          // THE LIFT MUST CONTAIN AN EDGE, and that is a measured requirement
          // rather than a stylistic one. The first fix for this was a drop
          // shadow alone — the app's own light-theme elevation idiom, and the
          // obvious answer. It did not work: a 7-13% shadow offset 1-2px is
          // invisible when the ground under it is the SAME COLOUR as the
          // thing casting it, which is exactly the condition that created the
          // bug. Re-shot, still gone. Only the inset ring made the bubble a
          // shape again. So the token has to carry one in both themes.
          const hasLift = Boolean(lift) && lift !== "none";
          const hasEdge = /\binset\b/.test(lift);
          check(
            `wallpaper/${state}/${themeName}: her bubble is findable (fill ${minShape.toFixed(2)}:1, or a lift)`,
            minShape >= 1.25 || (hasLift && hasEdge),
            hasLift
              ? hasEdge
                ? "carries --bubble-her-lift with an inset edge"
                : "lift has no inset edge — a shadow alone was measured invisible here"
              : `no lift and only ${minShape.toFixed(2)}:1`,
          );
        }
      }

      // The two families must not converge. If a "simplification" ever gives
      // both themes one alpha, the light theme goes dim or the dark theme goes
      // back to being the void the owner photographed — and every ratio above
      // would still pass, because one number CAN clear the floors. It just
      // cannot be the right number twice.
      check(
        `wallpaper/${state}: the light and dark veils are different numbers`,
        Math.abs(t.wallAlphaLight - t.wallAlphaDark) > 0.005,
        `light ${t.wallAlphaLight} vs dark ${t.wallAlphaDark}`,
      );
    }

    // The owner's grim-void screenshot, as a number. A dark thread whose veil
    // is so heavy the painting cannot be seen through it is exactly what was
    // photographed, and it passes every contrast floor there is — "too dark to
    // read" and "too dark to be anything" are different failures and only the
    // first one has a ratio. So the night sky's dark veil is held BELOW a
    // ceiling as well as above the floor: at 0.60 the painting comes through
    // at 40%, and the thread is a night rather than a black rectangle.
    check(
      "wallpaper/night: the dark theme lets the night painting through",
      SKY_TOKENS.night.wallAlphaDark <= 0.72,
      `${SKY_TOKENS.night.wallAlphaDark} (painting at ${((1 - SKY_TOKENS.night.wallAlphaDark) * 100) | 0}%)`,
    );
    // …and the light theme stays LIGHT. The inverse failure: a light thread
    // that turned into a photograph would be a different product's identity.
    for (const state of SKY_STATES ?? []) {
      check(
        `wallpaper/${state}: the light theme stays a wash, not a photo`,
        SKY_TOKENS[state].wallAlphaLight >= 0.9,
        String(SKY_TOKENS[state].wallAlphaLight),
      );
    }

    console.log(
      `  ..  wallpaper worst case: ground text ${wWorstText.toFixed(2)}:1, ` +
        `chip text ${wWorstChip.toFixed(2)}:1, control edge ${wWorstEdge.toFixed(2)}:1`,
    );

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

console.log(failed ? `\n${failed} contrast/legibility checks FAILED` : "\nboard legibility ok");
process.exit(failed ? 1 : 0);
