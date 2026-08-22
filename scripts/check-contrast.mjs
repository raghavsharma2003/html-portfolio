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

console.log(failed ? `\n${failed} contrast/legibility checks FAILED` : "\nboard legibility ok");
process.exit(failed ? 1 : 0);
