/*
 * ─── PIECE ART: THE "CBURNETT" SET ──────────────────────────────────────────
 *
 * Author:   Colin M.L. Burnett
 * Source:   https://github.com/lichess-org/lila/tree/master/public/piece/cburnett
 *           (the twelve files wK wQ wR wB wN wP bK bQ bR bB bN bP, fetched from
 *            https://raw.githubusercontent.com/lichess-org/lila/master/public/piece/cburnett/<name>.svg)
 *           originally https://commons.wikimedia.org/wiki/Category:SVG_chess_pieces
 * Licence:  CC BY-SA 3.0 <https://creativecommons.org/licenses/by-sa/3.0/>,
 *           dual-licensed GPLv2-or-later. Used here under CC BY-SA 3.0.
 * Credited also in docs/PHOTO-CREDITS.md, which is the file this repo keeps
 * its third-party asset trail in.
 *
 * MODIFICATIONS made to the originals, as CC BY-SA requires be stated:
 *   1. Transcribed from twelve standalone SVG documents into one React
 *      component over a shared 45x45 viewBox. The path data is unchanged.
 *   2. RECOLOURED VIA CSS CUSTOM PROPERTIES. Upstream hardcodes `#fff` / `#000`
 *      fills, `#000` strokes and `#ececec` detail strokes. Every one of those
 *      is now a class that resolves to a `--cb-*` token in src/styles/chess.css
 *      (see "the token re-plumbing" below). Nothing in this file states a
 *      colour, which is the standing rule for this repo.
 *   3. The five jewels of the BLACK queen, which upstream draws `stroke="none"`,
 *      are given the same rim as every other part. Upstream can leave them
 *      unrimmed because a black piece is only ever shown on a light board; this
 *      app also renders the set on a night board, where the black rim token
 *      goes LIGHT and an unrimmed jewel would be a hole in the crown.
 *   4. A soft contact shadow (one radial-gradient ellipse per piece) is drawn
 *      under each piece. It is this repo's layer, not Burnett's, and is sized
 *      per role from where that drawing actually meets the ground.
 *
 * ─── WHY THIS SET, AND NOT THE HAND-DRAWN ONE THAT WAS HERE ─────────────────
 *
 * The previous glyphs were original drawings, chosen partly to avoid an
 * attribution obligation. They were tested on a real phone and failed the only
 * test that matters: the owner could not tell knight from bishop from king at
 * a glance. Legibility beats a licence header — the header is four lines and
 * one row in a credits file, and it buys a set whose silhouettes have been
 * refined against millions of games on lichess.
 *
 * chess.com's set has the same legibility and is proprietary; cburnett is the
 * one with equal reading distance that is actually licensed for reuse.
 *
 * WHY SVG AND NOT THE UNICODE CHESS CHARACTERS (U+2654–265F) — unchanged, and
 * still the reason a font is not an option here:
 *
 *   1. The Unicode glyphs come from whatever font the device happens to have.
 *      This app ships as an APK, and Android's symbol coverage is supplied by
 *      Noto Sans Symbols 2 — where the WHITE pieces are drawn as outlines and
 *      the BLACK pieces as solid fills of a *different* optical weight. A white
 *      knight and a black knight then do not look like the same piece in two
 *      colours, which is the one thing a chess set has to do. On some OEM
 *      builds the black set falls through to an emoji font and arrives
 *      coloured.
 *   2. Glyph metrics differ per face, so the pieces do not sit centred on a
 *      square without per-character nudges that break on the next device.
 *   3. Text glyphs cannot be re-coloured independently of their outline, so a
 *      white piece on a light square has no rim and vanishes.
 *
 * ─── THE TOKEN RE-PLUMBING ──────────────────────────────────────────────────
 *
 * Upstream paints with three literal colours. Each maps to one class, and each
 * class resolves to one token in chess.css:
 *
 *   upstream                     class        resolves to
 *   ──────────────────────────   ──────────   ──────────────────────────────
 *   fill #fff / #000 (a body)    .cb-part     fill --gp (the shared gradient),
 *                                             stroke --gs (the rim)
 *   stroke #000, fill none,      .cb-rim      stroke --gs — a STRUCTURAL line
 *     kept #000 on black too                  (the rook's cornice, the black
 *                                             queen's base). It must ink with
 *                                             the rim, because it is part of
 *                                             the silhouette rather than
 *                                             detail inside it.
 *   the same, but drawn OUTSIDE  .cb-halo +   the king's cross, and only that:
 *     the body                   .cb-rim      a wide --gp under-stroke, then
 *                                             the --gs line on top. See
 *                                             STEM_HALO below for why.
 *   stroke #000 on white /       .cb-line     stroke --gd — INTERIOR DETAIL.
 *     stroke #ececec on black                 It contrasts with the FILL, not
 *                                             with the board, which is what
 *                                             stops a black knight at 44px
 *                                             being the same blob as a black
 *                                             bishop.
 *   fill+stroke #000 / #ececec   .cb-dot      the knight's eye and nostril:
 *                                             tiny, and they keep their stroke
 *                                             because upstream's stroke IS
 *                                             most of their area
 *   fill #ececec, stroke none    .cb-mark     the black knight's mane highlight
 *
 * `--gp` / `--gs` / `--gd` are set from `data-color` in chess.css, so the same
 * geometry re-inks itself for the paper board, the night board and the call
 * ground with no second stylesheet. Every one keeps a var() fallback there,
 * because a `var()` that resolves to nothing invalidates the declaration and
 * an invalid `fill` computes to BLACK — a white king silently inking itself
 * black is not a failure mode worth saving four characters over.
 *
 * Stroke geometry (width 1.5, round caps and joins, evenodd fill rule) is
 * declared as presentation attributes on the root <svg> rather than in CSS, on
 * purpose: CSS beats a presentation attribute, so a rule in the stylesheet
 * would silently override the handful of per-path `butt` / `miter` / width-1
 * overrides that cburnett needs. Colour comes from CSS, form comes from the
 * markup, and neither reaches into the other.
 */

import { Fragment } from "react";

export type Role = "k" | "q" | "r" | "b" | "n" | "p";
export type PromotionRole = "q" | "r" | "b" | "n";
export type Color = "white" | "black";

export const ROLE_NAME: Record<Role, string> = {
  k: "king",
  q: "queen",
  r: "rook",
  b: "bishop",
  n: "knight",
  p: "pawn",
};

// Standard relative worth, used only to render the material count under the
// captured trays. This is presentation, not evaluation — no position is ever
// judged here.
export const ROLE_VALUE: Record<Role, number> = { k: 0, q: 9, r: 5, b: 3, n: 3, p: 1 };

/* ── the shape table ────────────────────────────────────────────────────── */

/** Which paint a shape takes. The mapping to tokens is in the header. */
type Paint = "part" | "rim" | "stem" | "line" | "dot" | "mark";

interface Shape {
  /** path data, verbatim from the upstream file */
  d: string;
  /** paint layer; omitted means "part" (a filled, rimmed body) */
  p?: Paint;
  /** upstream `stroke-linecap="butt"` */
  cap?: "butt";
  /** upstream `stroke-linejoin="miter"` */
  join?: "miter";
  /** upstream per-path `stroke-width`, where it is not 1.5 */
  w?: number;
}

const CLASS: Record<Paint, string> = {
  part: "cb-part",
  rim: "cb-rim",
  stem: "cb-rim",
  line: "cb-line",
  dot: "cb-dot",
  mark: "cb-mark",
};

/**
 * A `stem` is a rim line drawn OUTSIDE the body — in this set, only the king's
 * cross. It gets a halo first: the same path stroked wider in the piece's own
 * FILL colour, so the rim line has something to be a rim OF.
 *
 * THE PROBLEM IT SOLVES, measured. On the night board the white rim token is a
 * near-black (#2a1c1f). The white king's cross — the one mark that separates
 * him from the queen at a glance — is drawn in it, in mid-air above the crown,
 * so it lands on the bare square: WCAG contrast 1.96:1 on the light square
 * (#5d4a45) and 1.14:1 on the dark one (#33272a). 1.14:1 is not "low", it is
 * gone. With the halo the cross reads as its own fill instead, which is
 * #eee3dd against the same dark square: 11.3:1. (Method: WCAG 2.x relative
 * luminance computed on the token values themselves — the flat mid-stop, not
 * the gradient — so treat it as a floor, not a photometer reading.)
 *
 * Every other rim line in the set is drawn on top of its own body, so none of
 * them ever had the problem — which is why this is one constant and not a
 * policy.
 *
 * It costs nothing on the paper board, which is the test of a fix like this: a
 * light halo on a light square is invisible, so the white king there is exactly
 * Burnett's cross and nothing else.
 */
const STEM_HALO = 3;

/**
 * Where each drawing meets the ground: [centre x, half-width] of the contact
 * shadow. Read off the base of the path rather than assumed, which is why the
 * knight's is off-centre — cburnett's knight stands on x 15→38 with its muzzle
 * cantilevered out to the left, and a shadow centred at 22.5 under it reads as
 * a piece leaning over.
 */
const FOOT: Record<Role, [number, number]> = {
  k: [22, 11.8],
  q: [22.5, 13.6],
  r: [22.5, 14.4],
  b: [22.5, 14.6],
  n: [26, 12.4],
  p: [22.5, 12.4],
};

/* The twelve drawings. White and black are NOT the same geometry recoloured —
   Burnett drew each colour, and the black pieces carry interior light-lines
   (the king's shoulder tracing, the knight's mane) that only exist because a
   solid black body needs them. Vendoring both is the point. */

const ART: Record<Color, Record<Role, Shape[]>> = {
  white: {
    k: [
      { d: "M22.5 11.63V6M20 8h5", p: "stem", join: "miter" },
      {
        d: "M22.5 25s4.5-7.5 3-10.5c0 0-1-2.5-3-2.5s-3 2.5-3 2.5c-1.5 3 3 10.5 3 10.5",
        cap: "butt",
        join: "miter",
      },
      {
        d: "M11.5 37c5.5 3.5 15.5 3.5 21 0v-7s9-4.5 6-10.5c-4-6.5-13.5-3.5-16 4V27v-3.5c-3.5-7.5-13-10.5-16-4-3 6 5 10 5 10z",
      },
      {
        d: "M11.5 30c5.5-3 15.5-3 21 0m-21 3.5c5.5-3 15.5-3 21 0m-21 3.5c5.5-3 15.5-3 21 0",
        p: "line",
      },
    ],
    q: [
      {
        d: "M8 12a2 2 0 1 1-4 0 2 2 0 1 1 4 0m16.5-4.5a2 2 0 1 1-4 0 2 2 0 1 1 4 0M41 12a2 2 0 1 1-4 0 2 2 0 1 1 4 0M16 8.5a2 2 0 1 1-4 0 2 2 0 1 1 4 0M33 9a2 2 0 1 1-4 0 2 2 0 1 1 4 0",
      },
      {
        d: "M9 26c8.5-1.5 21-1.5 27 0l2-12-7 11V11l-5.5 13.5-3-15-3 15-5.5-14V25L7 14z",
        cap: "butt",
      },
      {
        d: "M9 26c0 2 1.5 2 2.5 4 1 1.5 1 1 .5 3.5-1.5 1-1.5 2.5-1.5 2.5-1.5 1.5.5 2.5.5 2.5 6.5 1 16.5 1 23 0 0 0 1.5-1 0-2.5 0 0 .5-1.5-1-2.5-.5-2.5-.5-2 .5-3.5 1-2 2.5-2 2.5-4-8.5-1.5-18.5-1.5-27 0z",
        cap: "butt",
      },
      { d: "M11.5 30c3.5-1 18.5-1 22 0M12 33.5c6-1 15-1 21 0", p: "line" },
    ],
    r: [
      { d: "M9 39h27v-3H9zm3-3v-4h21v4zm-1-22V9h4v2h5V9h5v2h5V9h4v5", cap: "butt" },
      { d: "m34 14-3 3H14l-3-3" },
      { d: "M31 17v12.5H14V17", cap: "butt", join: "miter" },
      { d: "m31 29.5 1.5 2.5h-20l1.5-2.5" },
      { d: "M11 14h23", p: "rim", join: "miter" },
    ],
    b: [
      {
        d: "M9 36c3.39-.97 10.11.43 13.5-2 3.39 2.43 10.11 1.03 13.5 2 0 0 1.65.54 3 2-.68.97-1.65.99-3 .5-3.39-.97-10.11.46-13.5-1-3.39 1.46-10.11.03-13.5 1-1.35.49-2.32.47-3-.5 1.35-1.94 3-2 3-2z",
        cap: "butt",
      },
      {
        d: "M15 32c2.5 2.5 12.5 2.5 15 0 .5-1.5 0-2 0-2 0-2.5-2.5-4-2.5-4 5.5-1.5 6-11.5-5-15.5-11 4-10.5 14-5 15.5 0 0-2.5 1.5-2.5 4 0 0-.5.5 0 2z",
        cap: "butt",
      },
      { d: "M25 8a2.5 2.5 0 1 1-5 0 2.5 2.5 0 1 1 5 0z", cap: "butt" },
      { d: "M17.5 26h10M15 30h15m-7.5-14.5v5M20 18h5", p: "line", join: "miter" },
    ],
    n: [
      { d: "M22 10c10.5 1 16.5 8 16 29H15c0-9 10-6.5 8-21" },
      {
        d: "M24 18c.38 2.91-5.55 7.37-8 9-3 2-2.82 4.34-5 4-1.042-.94 1.41-3.04 0-3-1 0 .19 1.23-1 2-1 0-4.003 1-4-4 0-2 6-12 6-12s1.89-1.9 2-3.5c-.73-.994-.5-2-.5-3 1-1 3 2.5 3 2.5h2s.78-1.992 2.5-3c1 0 1 3 1 3",
      },
      {
        d: "M9.5 25.5a.5.5 0 1 1-1 0 .5.5 0 1 1 1 0m5.433-9.75a.5 1.5 30 1 1-.866-.5.5 1.5 30 1 1 .866.5",
        p: "dot",
      },
    ],
    p: [
      {
        d: "M22.5 9c-2.21 0-4 1.79-4 4 0 .89.29 1.71.78 2.38C17.33 16.5 16 18.59 16 21c0 2.03.94 3.84 2.41 5.03-3 1.06-7.41 5.55-7.41 13.47h23c0-7.92-4.41-12.41-7.41-13.47 1.47-1.19 2.41-3 2.41-5.03 0-2.41-1.33-4.5-3.28-5.62.49-.67.78-1.49.78-2.38 0-2.21-1.79-4-4-4z",
        join: "miter",
      },
    ],
  },

  black: {
    k: [
      { d: "M22.5 11.6V6", p: "stem", join: "miter" },
      {
        d: "M22.5 25s4.5-7.5 3-10.5c0 0-1-2.5-3-2.5s-3 2.5-3 2.5c-1.5 3 3 10.5 3 10.5",
        cap: "butt",
        join: "miter",
      },
      {
        d: "M11.5 37a22.3 22.3 0 0 0 21 0v-7s9-4.5 6-10.5c-4-6.5-13.5-3.5-16 4V27v-3.5c-3.5-7.5-13-10.5-16-4-3 6 5 10 5 10z",
      },
      { d: "M20 8h5", p: "stem", join: "miter" },
      {
        d: "M32 29.5s8.5-4 6-9.7C34.1 14 25 18 22.5 24.6v2.1-2.1C20 18 9.9 14 7 19.9c-2.5 5.6 4.8 9 4.8 9",
        p: "line",
      },
      {
        d: "M11.5 30c5.5-3 15.5-3 21 0m-21 3.5c5.5-3 15.5-3 21 0m-21 3.5c5.5-3 15.5-3 21 0",
        p: "line",
      },
    ],
    q: [
      // the five jewels — upstream <circle> elements, transcribed to arcs so
      // every shape in this file is one path with one paint. See modification
      // (3) in the header for why they gain a rim.
      {
        d: "M3.25 12a2.75 2.75 0 1 0 5.5 0 2.75 2.75 0 1 0-5.5 0zM11.25 9a2.75 2.75 0 1 0 5.5 0 2.75 2.75 0 1 0-5.5 0zM19.75 8a2.75 2.75 0 1 0 5.5 0 2.75 2.75 0 1 0-5.5 0zM28.25 9a2.75 2.75 0 1 0 5.5 0 2.75 2.75 0 1 0-5.5 0zM36.25 12a2.75 2.75 0 1 0 5.5 0 2.75 2.75 0 1 0-5.5 0z",
      },
      {
        d: "M9 26c8.5-1.5 21-1.5 27 0l2.5-12.5L31 25l-.3-14.1-5.2 13.6-3-14.5-3 14.5-5.2-13.6L14 25 6.5 13.5z",
        cap: "butt",
      },
      {
        d: "M9 26c0 2 1.5 2 2.5 4 1 1.5 1 1 .5 3.5-1.5 1-1.5 2.5-1.5 2.5-1.5 1.5.5 2.5.5 2.5 6.5 1 16.5 1 23 0 0 0 1.5-1 0-2.5 0 0 .5-1.5-1-2.5-.5-2.5-.5-2 .5-3.5 1-2 2.5-2 2.5-4-8.5-1.5-18.5-1.5-27 0z",
        cap: "butt",
      },
      { d: "M11 38.5a35 35 1 0 0 23 0", p: "rim", cap: "butt" },
      {
        d: "M11 29a35 35 1 0 1 23 0m-21.5 2.5h20m-21 3a35 35 1 0 0 22 0m-23 3a35 35 1 0 0 24 0",
        p: "line",
      },
    ],
    r: [
      { d: "M9 39h27v-3H9zm3.5-7 1.5-2.5h17l1.5 2.5zm-.5 4v-4h21v4z", cap: "butt" },
      { d: "M14 29.5v-13h17v13z", cap: "butt", join: "miter" },
      { d: "M14 16.5 11 14h23l-3 2.5zM11 14V9h4v2h5V9h5v2h5V9h4v5z", cap: "butt" },
      {
        d: "M12 35.5h21m-20-4h19m-18-2h17m-17-13h17M11 14h23",
        p: "line",
        join: "miter",
        w: 1,
      },
    ],
    b: [
      {
        d: "M9 36c3.4-1 10.1.4 13.5-2 3.4 2.4 10.1 1 13.5 2 0 0 1.6.5 3 2-.7 1-1.6 1-3 .5-3.4-1-10.1.5-13.5-1-3.4 1.5-10.1 0-13.5 1-1.4.5-2.3.5-3-.5 1.4-2 3-2 3-2z",
        cap: "butt",
      },
      {
        d: "M15 32c2.5 2.5 12.5 2.5 15 0 .5-1.5 0-2 0-2 0-2.5-2.5-4-2.5-4 5.5-1.5 6-11.5-5-15.5-11 4-10.5 14-5 15.5 0 0-2.5 1.5-2.5 4 0 0-.5.5 0 2z",
        cap: "butt",
      },
      { d: "M25 8a2.5 2.5 0 1 1-5 0 2.5 2.5 0 1 1 5 0z", cap: "butt" },
      { d: "M17.5 26h10M15 30h15m-7.5-14.5v5M20 18h5", p: "line", join: "miter" },
    ],
    n: [
      { d: "M22 10c10.5 1 16.5 8 16 29H15c0-9 10-6.5 8-21" },
      {
        d: "M24 18c.38 2.91-5.55 7.37-8 9-3 2-2.82 4.34-5 4-1.04-.94 1.41-3.04 0-3-1 0 .19 1.23-1 2-1 0-4 1-4-4 0-2 6-12 6-12s1.89-1.9 2-3.5c-.73-1-.5-2-.5-3 1-1 3 2.5 3 2.5h2s.78-2 2.5-3c1 0 1 3 1 3",
      },
      {
        d: "M9.5 25.5a.5.5 0 1 1-1 0 .5.5 0 1 1 1 0m5.43-9.75a.5 1.5 30 1 1-.86-.5.5 1.5 30 1 1 .86.5",
        p: "dot",
      },
      {
        d: "m24.55 10.4-.45 1.45.5.15c3.15 1 5.65 2.49 7.9 6.75S35.75 29.06 35.25 39l-.05.5h2.25l.05-.5c.5-10.06-.88-16.85-3.25-21.34s-5.79-6.64-9.19-7.16z",
        p: "mark",
      },
    ],
    p: [
      {
        d: "M22.5 9a4 4 0 0 0-3.22 6.38 6.48 6.48 0 0 0-.87 10.65c-3 1.06-7.41 5.55-7.41 13.47h23c0-7.92-4.41-12.41-7.41-13.47a6.46 6.46 0 0 0-.87-10.65A4.01 4.01 0 0 0 22.5 9z",
        join: "miter",
      },
    ],
  },
};

/* ── the shared paint ───────────────────────────────────────────────────
   ONE <defs> for the whole board rather than one per piece: 32 pieces each
   carrying their own gradient is 32 gradients the compositor has to keep
   apart, and they would all be identical. The ids are per-mount (`useId`),
   so two boards on one page cannot steal each other's paint.

   The stop colours are set in chess.css off the same tokens as everything
   else — this file states no colour at all. */

export function PieceDefs({ id }: { id: string }) {
  return (
    <svg className="cb-defs" aria-hidden="true" focusable="false" width="0" height="0">
      <defs>
        <linearGradient
          className="cb-grad-w"
          id={`${id}w`}
          gradientUnits="userSpaceOnUse"
          x1="0"
          y1="6"
          x2="0"
          y2="40"
        >
          <stop className="cb-s0" offset="0" />
          <stop className="cb-s1" offset="0.55" />
          <stop className="cb-s2" offset="1" />
        </linearGradient>
        <linearGradient
          className="cb-grad-b"
          id={`${id}b`}
          gradientUnits="userSpaceOnUse"
          x1="0"
          y1="6"
          x2="0"
          y2="40"
        >
          <stop className="cb-s0" offset="0" />
          <stop className="cb-s1" offset="0.55" />
          <stop className="cb-s2" offset="1" />
        </linearGradient>
        <radialGradient
          className="cb-grad-c"
          id={`${id}c`}
          gradientUnits="objectBoundingBox"
          cx="0.5"
          cy="0.5"
          r="0.5"
        >
          <stop className="cb-c0" offset="0" />
          <stop className="cb-c1" offset="0.6" />
          <stop className="cb-c2" offset="1" />
        </radialGradient>
      </defs>
    </svg>
  );
}

/**
 * The CSS custom properties that point the set at the paint above. Set on
 * the board root as an inline style: an `url(#…)` is an identifier, not a
 * colour, so this does not break the rule that colours live in the token
 * block.
 */
export function piecePaintVars(id: string): Record<string, string> {
  return {
    "--cb-paint-white": `url(#${id}w)`,
    "--cb-paint-black": `url(#${id}b)`,
    "--cb-paint-cast": `url(#${id}c)`,
  };
}

export function PieceGlyph({ role, color }: { role: Role; color: Color }) {
  const shapes = ART[color][role];
  const [fx, frx] = FOOT[role];
  return (
    <svg
      className="cb-glyph"
      data-color={color}
      data-role={role}
      viewBox="0 0 45 45"
      aria-hidden="true"
      focusable="false"
      /* Form lives in the markup, colour lives in CSS — see the header. */
      fillRule="evenodd"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {/* contact shadow — the piece stands on the board rather than over it */}
      <ellipse className="cb-cast" cx={fx} cy="39.8" rx={frx} ry="2.7" />
      {shapes.map((s, i) => (
        <Fragment key={i}>
          {s.p === "stem" && (
            <path className="cb-halo" d={s.d} strokeWidth={STEM_HALO} strokeLinejoin={s.join} />
          )}
          <path
            className={CLASS[s.p ?? "part"]}
            d={s.d}
            strokeLinecap={s.cap}
            strokeLinejoin={s.join}
            strokeWidth={s.w}
          />
        </Fragment>
      ))}
    </svg>
  );
}
