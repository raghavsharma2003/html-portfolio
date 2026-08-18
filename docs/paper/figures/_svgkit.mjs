// docs/paper/figures/_svgkit.mjs — WS-PAPER-W.
//
// Minimal, dependency-free SVG emitters shared by fig-f1/f2/f3. No layout
// engine, no path soup: every figure is built from rects, lines, circles and
// text placed by an explicit linear scale, so a reviewer can read the numbers
// straight out of the source and check them against derive-tables.mjs.
//
// GRAYSCALE-SAFE BY CONSTRUCTION. Nothing in this kit emits a hue. Series are
// distinguished by (a) ink value, (b) fill vs outline, (c) solid vs dashed vs
// dotted stroke, and (d) a diagonal hatch pattern — all of which survive a
// black-and-white print and a colour-blind reader.

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

/** Run one of the committed analysis scripts and return its --json output.
 *  This is the citation law made mechanical: a figure cannot state a number
 *  the analysis scripts do not print. */
export function analysis(relPath) {
  const out = execFileSync("node", [resolve(ROOT, relPath), "--json"], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return JSON.parse(out);
}

export const INK = "#111111";       // primary rule / text
export const MID = "#5b5b5b";       // secondary series
export const SOFT = "#9a9a9a";      // tertiary / reference lines
export const HAIR = "#d4d4d4";      // gridlines
export const FILL_DARK = "#2b2b2b";
export const FILL_MID = "#8f8f8f";
export const FILL_LIGHT = "#dcdcdc";
export const PAPER = "#ffffff";
export const FONT = "'Helvetica Neue', Helvetica, Arial, sans-serif";

export const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export const pct = (x, d = 1) => (x == null ? "n/a" : `${(x * 100).toFixed(d)}%`);
export const pp = (x, d = 1) => `${x >= 0 ? "+" : "−"}${Math.abs(x).toFixed(d)}pp`;

/** linear scale factory: domain [d0,d1] -> range [r0,r1] */
export const scale = (d0, d1, r0, r1) => (v) => r0 + ((v - d0) / (d1 - d0)) * (r1 - r0);

export function text(x, y, s, o = {}) {
  const {
    size = 11, weight = 400, anchor = "start", fill = INK,
    style = "", dy = 0, opacity = 1,
  } = o;
  return `<text x="${x.toFixed(1)}" y="${(y + dy).toFixed(1)}" font-family="${FONT}" font-size="${size}" font-weight="${weight}" text-anchor="${anchor}" fill="${fill}"${opacity !== 1 ? ` opacity="${opacity}"` : ""}${style ? ` style="${style}"` : ""}>${esc(s)}</text>`;
}

export function line(x1, y1, x2, y2, o = {}) {
  const { stroke = INK, width = 1, dash = null, cap = "butt", opacity = 1 } = o;
  return `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${stroke}" stroke-width="${width}" stroke-linecap="${cap}"${dash ? ` stroke-dasharray="${dash}"` : ""}${opacity !== 1 ? ` opacity="${opacity}"` : ""}/>`;
}

export function rect(x, y, w, h, o = {}) {
  const { fill = "none", stroke = "none", width = 1, opacity = 1, dash = null } = o;
  return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${Math.max(0, w).toFixed(1)}" height="${Math.max(0, h).toFixed(1)}" fill="${fill}" stroke="${stroke}" stroke-width="${width}"${dash ? ` stroke-dasharray="${dash}"` : ""}${opacity !== 1 ? ` opacity="${opacity}"` : ""}/>`;
}

export function circle(cx, cy, r, o = {}) {
  const { fill = INK, stroke = "none", width = 1 } = o;
  return `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r}" fill="${fill}" stroke="${stroke}" stroke-width="${width}"/>`;
}

/** Horizontal interval with end caps — the forest-plot primitive. */
export function interval(x1, x2, y, o = {}) {
  const { stroke = INK, width = 2, cap = 4, dash = null, opacity = 1 } = o;
  return [
    line(x1, y, x2, y, { stroke, width, dash, opacity }),
    line(x1, y - cap, x1, y + cap, { stroke, width, opacity }),
    line(x2, y - cap, x2, y + cap, { stroke, width, opacity }),
  ].join("");
}

/** Diagonal hatch pattern definition — the one non-solid fill in the kit.
 *  Used for "evacuated" mass and for the noise band, so those read as
 *  "not a real quantity of interest" even in print. */
export function defs() {
  return `<defs>
  <pattern id="hatch" width="5" height="5" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
    <rect width="5" height="5" fill="${PAPER}"/>
    <line x1="0" y1="0" x2="0" y2="5" stroke="${FILL_MID}" stroke-width="2"/>
  </pattern>
  <pattern id="hatchLight" width="6" height="6" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
    <rect width="6" height="6" fill="${PAPER}"/>
    <line x1="0" y1="0" x2="0" y2="6" stroke="${HAIR}" stroke-width="2.5"/>
  </pattern>
</defs>`;
}

export function svg(w, h, body, title, desc) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-labelledby="ttl dsc">
<title id="ttl">${esc(title)}</title>
<desc id="dsc">${esc(desc)}</desc>
${defs()}
${rect(0, 0, w, h, { fill: PAPER })}
${body}
</svg>
`;
}

/** x-axis with ticks at the given domain values (0..1 proportions). */
export function xAxis(x, y, w, ticks, sc, o = {}) {
  const { label = "", tickLen = 4, size = 10 } = o;
  const parts = [line(x, y, x + w, y, { stroke: INK, width: 1 })];
  for (const t of ticks) {
    const px = sc(t);
    parts.push(line(px, y, px, y + tickLen, { stroke: INK, width: 1 }));
    parts.push(text(px, y + tickLen + 10, `${Math.round(t * 100)}%`, { size, anchor: "middle", fill: MID }));
  }
  if (label) parts.push(text(x + w / 2, y + tickLen + 26, label, { size: 10.5, anchor: "middle", fill: MID }));
  return parts.join("");
}
