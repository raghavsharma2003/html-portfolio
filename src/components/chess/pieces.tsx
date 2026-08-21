// Chess piece glyphs — hand-drawn inline SVG, one shared 45x45 coordinate
// space, no external asset of any kind.
//
// WHY SVG AND NOT THE UNICODE CHESS CHARACTERS (U+2654–265F):
//
//   1. The Unicode glyphs come from whatever font the device happens to
//      have. This app ships as an APK, and Android's symbol coverage is
//      supplied by Noto Sans Symbols 2 — where the WHITE pieces are drawn
//      as outlines and the BLACK pieces as solid fills of a *different*
//      optical weight. A white knight and a black knight then do not look
//      like the same piece in two colours, which is the one thing a chess
//      set has to do. On some OEM builds the black set falls through to an
//      emoji font and arrives coloured.
//   2. Glyph metrics differ per face, so the pieces do not sit centred on a
//      square without per-character nudges that break on the next device.
//   3. Text glyphs cannot be re-coloured independently of their outline, so
//      a white piece on a light square has no rim and vanishes.
//
// Inline SVG fixes all three: identical geometry everywhere, fill and rim
// are separate and both come from tokens (so the set re-inks itself for the
// dark call ground), crisp at any size, zero bytes over the network and
// nothing for a CSP to block.
//
// The paths are original — deliberately not the Cburnett set, whose licence
// would put an attribution obligation into an APK. What IS taken from
// Cburnett (and from every good Staunton set since 1849) is *proportion*,
// because proportion is not copyrightable and is the whole reason those
// sets read at a glance:
//
//   - one 45x45 space, art living inside x∈[8,37], y∈[4,40]
//   - a confident constant rim (stroke-width 1.4 here) rather than a hairline
//   - height ranks the pieces: king tallest, then queen, bishop, knight,
//     rook, pawn. You identify a piece by its skyline before you see detail.
//   - foot width ranks them the same way, which is what stops the set
//     looking like six unrelated drawings sharing a board.
//
// THREE LAYERS PER PIECE, and the order is the design:
//
//   1. a cast shadow (soft radial ellipse) so the piece sits ON the board
//      rather than floating over it. It is a gradient, not a `filter` —
//      32 drop-shadows is a per-frame paint cost, 32 flat ellipses is not.
//   2. the body: filled with a shared vertical gradient (light at the
//      shoulder, dark at the foot) and rimmed in the edge colour. The
//      gradient is what makes a piece read as turned wood instead of a
//      sticker, and it costs one <defs> for the whole board.
//   3. the detail lines, drawn in a THIRD colour that contrasts with the
//      fill rather than with the board: dark lines on a white piece, light
//      lines on a black one. This is the single biggest legibility win at
//      44px — a black piece with no interior lines is a blob, and a blob is
//      the same blob whether it is a bishop or a pawn.

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

/* ── the shared plinth ──────────────────────────────────────────────────
   Every piece stands on the same two-tier foot, generated from ONE number:
   the half-width of the bottom slab. Generated rather than copy-pasted
   because six hand-written feet drift, and a set whose feet drift looks
   like a set someone assembled rather than drew. */

const CX = 22.5;

/** Bottom slab: y 35.5 → 39.3, rounded like a turned base. */
function slab(w: number) {
  return { x: CX - w, y: 35.5, w: w * 2, h: 3.8, r: 1.5 };
}

/** The flare above the slab, from a narrower stem out to the slab's width. */
function flare(w: number): string {
  const s = Math.max(2.2, w - 2.6); // half-width where the flare starts
  const spread = (w - 0.4 - s).toFixed(2);
  return `M${(CX - s).toFixed(2)} 31.9h${(s * 2).toFixed(2)}l${spread} 3.7h-${((w - 0.4) * 2).toFixed(2)}z`;
}

/* ── the six drawings ───────────────────────────────────────────────────
   `body` is filled and rimmed; `line` is stroked in the detail colour and
   never filled. Feet widen with rank, which is the silhouette cue that
   works even when the top of the piece is under a finger. */

interface Art {
  /** half-width of the bottom slab */
  foot: number;
  /** filled + rimmed shapes, drawn bottom-up */
  body: string[];
  /** [cx, cy, r] round parts that keep their own rim (jewels, the pawn head) */
  knobs?: [number, number, number][];
  /** detail strokes, in the contrast colour */
  line?: string[];
  /** [cx, cy, r] solid marks in the contrast colour (the knight's eye) */
  dots?: [number, number, number][];
}

const ART: Record<Role, Art> = {
  /* Pawn — a ball on a flared collar. The narrowest foot on the board and
     the shortest skyline, so eight of them read as a row rather than a wall. */
  p: {
    foot: 7.6,
    body: [
      "M22.5 17.1c-2.1 0-3.8 1-3.8 2.3 0 .9.6 1.6 1.5 2-2.9 2-4.9 5.2-5.6 8.9h15.8c-.7-3.7-2.7-6.9-5.6-8.9.9-.4 1.5-1.1 1.5-2 0-1.3-1.7-2.3-3.8-2.3z",
      "M14.1 29.4h16.8c.8 0 1.4.6 1.4 1.4s-.6 1.4-1.4 1.4H14.1c-.8 0-1.4-.6-1.4-1.4s.6-1.4 1.4-1.4z",
    ],
    knobs: [[22.5, 12.6, 4.6]],
  },

  /* Rook — four merlons over a straight shaft. The only piece with a flat
     top, which is why it survives being two-thirds hidden by a thumb. */
  r: {
    foot: 9,
    body: [
      "M10.6 6.2h4.3v3.2h2.2V6.2h4.3v3.2h2.2V6.2h4.3v3.2h2.2V6.2h4.3v6.4H10.6z",
      "M13.6 12.6h17.8l-1.9 2.9v13.2l2.4 3.1H13.1l2.4-3.1V15.5z",
    ],
    line: ["M15.5 15.5h14M15.5 28.7h14"],
  },

  /* Knight — the one piece identified purely by silhouette, so the outline
     does all the work and there is nowhere to hide. Head large and low,
     muzzle jutting down-left, TWO spikes on top (forelock in front, ear
     behind) with a notch between them, and a crest sweeping from the skull
     down the back of the neck into the chest. The notch is the tell: one
     spike reads as a bird's beak, two read as a horse. */
  n: {
    foot: 8.6,
    body: [
      [
        "M23.4 12.2",
        "C24.1 9.8 25.2 7.6 26.6 6.2", // up the front of the ear
        "C28.1 8.1 28.9 10.2 29.0 12.2", // down its back, onto the skull
        "C31.4 14.2 33.5 17.4 34.4 21.6", // the crest
        "C35.2 25.4 33.6 29.2 31.9 31.9", // down the back of the neck, tucking in
        "L15.1 31.9", // across, where the chest meets the plinth
        "C14.6 29.4 15.2 26.6 17.0 24.8", // up the chest to the throat
        "C15.6 26.6 13.0 28.2 11.0 28.0", // the jaw and chin, jutting down-left
        "C9.2 27.8 8.4 26.2 9.0 24.6", // round the end of the muzzle
        "C10.6 21.6 13.2 18.6 16.1 16.0", // up the bridge of the nose
        "C18.4 13.9 19.8 12.1 20.4 10.0", // the forehead
        "L21.2 8.0", // the forelock spike
        "C22.1 9.1 22.9 10.6 23.4 12.2", // and down into the notch
        "Z",
      ].join(""),
    ],
    line: [
      "M28.8 13.8c2.4 2.4 4 5.6 4.6 9.2",
      "M10.9 27.4c1.7.4 3.3-.1 4.6-1.2",
    ],
    dots: [[13.2, 22.4, 1.15]],
  },

  /* Bishop — mitre, slit, collar. The finial is a separate knob so it keeps
     its own rim and does not melt into the mitre at small sizes. */
  b: {
    foot: 8.4,
    body: [
      "M22.5 8.6c-3.9 3-7.1 7.2-7.1 11.2 0 3.1 1.8 5.8 4.4 7h5.4c2.6-1.2 4.4-3.9 4.4-7 0-4-3.2-8.2-7.1-11.2z",
      "M14.6 25.6h15.8c.8 0 1.5.7 1.5 1.5s-.7 1.5-1.5 1.5H14.6c-.8 0-1.5-.7-1.5-1.5s.7-1.5 1.5-1.5z",
      "M15.4 28.4h14.2c-.3 1.8.5 2.7 1.5 3.5H13.9c1-.8 1.8-1.7 1.5-3.5z",
    ],
    knobs: [[22.5, 6.6, 2]],
    line: ["M20.3 17.2l4.4-4.4"],
  },

  /* Queen — five points, five jewels, one bowl. The centre jewel tops out
     at 6.6 and the king's cross at 4.2, so the king stays the tallest thing
     on the board, which is how you tell them apart at a glance on a phone. */
  q: {
    foot: 9.6,
    body: [
      "M9 12.8l3.5 12h20l3.5-12-5 6.6-2.5-9.2-3 9-3-10.4-3 10.4-3-9-2.5 9.2z",
      "M12.7 24.8h19.6c.9 0 1.6.7 1.6 1.6s-.7 1.6-1.6 1.6H12.7c-.9 0-1.6-.7-1.6-1.6s.7-1.6 1.6-1.6z",
      "M13.4 27.9h18.2c-.4 2 .6 3 1.7 4H11.7c1.1-1 2.1-2 1.7-4z",
    ],
    knobs: [
      [9, 11, 2.2],
      [16.2, 8, 2.2],
      [22.5, 6.6, 2.5],
      [28.8, 8, 2.2],
      [36, 11, 2.2],
    ],
    line: ["M14.2 21.4h16.6"],
  },

  /* King — cross, coronet, shoulders. Widest foot, tallest skyline. */
  k: {
    foot: 9.8,
    body: [
      "M21 4.2h3v3.2h3.2v3h-3.2v3.7h-3v-3.7h-3.2v-3H21z",
      "M22.5 14.5c-2.7 0-4.8 1.9-4.8 4.2 0 1.3.6 2.5 1.6 3.3-2.7-1.1-5.9-1-7.6.7-2.6 2.5-1.4 6.9 1.7 9.4h18.2c3.1-2.5 4.3-6.9 1.7-9.4-1.7-1.7-4.9-1.8-7.6-.7 1-.8 1.6-2 1.6-3.3 0-2.3-2.1-4.2-4.8-4.2z",
    ],
    // One arc across the shoulders, not two swoops meeting at the centre —
    // the pair read as a bird at 44px, which is a thing a king may not do.
    line: ["M12.9 30.9c2.6-2.9 6-4.4 9.6-4.4s7 1.5 9.6 4.4"],
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
          y1="4"
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
          y1="4"
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
  const art = ART[role];
  const s = slab(art.foot);
  return (
    <svg
      className="cb-glyph"
      data-color={color}
      data-role={role}
      viewBox="0 0 45 45"
      aria-hidden="true"
      focusable="false"
    >
      {/* contact shadow — the piece stands on the board rather than over it */}
      <ellipse className="cb-cast" cx={CX} cy="39.6" rx={art.foot + 2.6} ry="3.1" />
      <path className="cb-part" d={flare(art.foot)} />
      <rect className="cb-part" x={s.x} y={s.y} width={s.w} height={s.h} rx={s.r} />
      {art.body.map((d, i) => (
        <path className="cb-part" key={`b${i}`} d={d} />
      ))}
      {art.knobs?.map(([cx, cy, r], i) => (
        <circle className="cb-part" key={`k${i}`} cx={cx} cy={cy} r={r} />
      ))}
      {art.line?.map((d, i) => (
        <path className="cb-line" key={`l${i}`} d={d} />
      ))}
      {art.dots?.map(([cx, cy, r], i) => (
        <circle className="cb-dot" key={`d${i}`} cx={cx} cy={cy} r={r} />
      ))}
    </svg>
  );
}
