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
// would put an attribution obligation into an APK.

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

// Every piece stands on the same plinth, which is what makes six separate
// drawings read as one set.
const BASE =
  "M9.6 33.9h25.8c1.4 0 2.6 1.2 2.6 2.6v1.3c0 .9-.7 1.6-1.6 1.6H8.6c-.9 0-1.6-.7-1.6-1.6v-1.3c0-1.4 1.2-2.6 2.6-2.6z";

const BODY: Record<Role, string[]> = {
  p: [
    "M22.5 18c-3.3 0-5.9 2-5.9 4.3 0 1.5.8 2.7 1.9 3.4-2.7 1.8-4.7 4.5-5.5 8.2h19c-.8-3.7-2.8-6.4-5.5-8.2 1.1-.7 1.9-1.9 1.9-3.4 0-2.3-2.6-4.3-5.9-4.3z",
    BASE,
  ],
  r: [
    // crenellated top
    "M11.4 7.6h5.2v3.4h3.9V7.6h4v3.4h3.9V7.6h5.2v9.1H11.4z",
    // neck and shaft
    "M13.9 16.7h17.2l-1.9 3v10.6l2.8 3.6H13l2.8-3.6V19.7z",
    BASE,
  ],
  n: [
    // one continuous silhouette: muzzle low-left, ear top, neck sweeping right
    "M13.6 33.9c0-4.9 1.3-8.2 3.4-10.9 1.4-1.8 2.7-3 3.4-4.6l-3 1.6c-1.7.9-2.7 2-3.6 3.4-.8 1.2-2.5 1.2-3.2-.1-.6-1.1-.4-2.3.3-3.5 1.6-2.7 3.7-5.1 6.1-7.1 1.2-1 1.9-2 2.2-3.3l.7-2.9 2.5 1.7c.6.4 1.3.6 2 .6 5 0 9.1 3.7 10.2 8.7.6 2.7.9 5.6.9 8.6v7.8z",
    BASE,
  ],
  b: [
    // mitre
    "M22.5 6.4c1.6 0 2.9 1.3 2.9 2.9 0 .9-.4 1.7-1.1 2.3 3.3 2.5 6 6 6 9.6 0 2.5-1.4 4.6-3.4 6H18.1c-2-1.4-3.4-3.5-3.4-6 0-3.6 2.7-7.1 6-9.6-.7-.6-1.1-1.4-1.1-2.3 0-1.6 1.3-2.9 2.9-2.9z",
    // collar
    "M16.4 27.2h12.2c1 0 1.8.8 1.8 1.8s-.8 1.8-1.8 1.8H16.4c-1 0-1.8-.8-1.8-1.8s.8-1.8 1.8-1.8z",
    "M16.8 30.8h11.4c-.3 1.6.4 2.5 1.3 3.1H15.5c.9-.6 1.6-1.5 1.3-3.1z",
    BASE,
  ],
  q: [
    // five points falling into the bowl
    "M9 14.4l3.7 10.9h19.6L36 14.4l-4.8 5.6-2.3-8.9-3.4 8.3-3-9.5-3 9.5-3.4-8.3-2.3 8.9z",
    "M13.6 26.4h17.8c1 0 1.8.8 1.8 1.8s-.8 1.8-1.8 1.8H13.6c-1 0-1.8-.8-1.8-1.8s.8-1.8 1.8-1.8z",
    "M14.2 30.4h16.6c-.4 1.7.3 2.7 1.2 3.5H13c.9-.8 1.6-1.8 1.2-3.5z",
    BASE,
  ],
  k: [
    // cross
    "M21.1 4.6h2.8v3.3h3.3v2.8h-3.3v3.6h-2.8v-3.6h-3.3V7.9h3.3z",
    // crown and shoulders
    "M22.5 14.6c-2.5 0-4.6 1.7-4.6 4 0 1.4.7 2.6 1.7 3.4-2.3-.7-4.9-.9-6.6.4-2.6 1.9-1.9 6.3.9 8.7 1.4 1.2 2.6 2 3.4 2.8h10.2c.8-.8 2-1.6 3.4-2.8 2.8-2.4 3.5-6.8.9-8.7-1.7-1.3-4.3-1.1-6.6-.4 1-.8 1.7-2 1.7-3.4 0-2.3-2.1-4-4.6-4z",
    BASE,
  ],
};

// Round parts, as [cx, cy, r]. Kept as circles rather than folded into the
// path data because an arc written by hand is where a piece silently loses
// its head. Drawn AFTER the body so each keeps its own rim: on the queen that
// reads as five jewels, and on the pawn as a head sitting on a collar.
//
// The queen's centre jewel tops out at 5.5 and the king's cross at 4.6, so the
// king stays the tallest piece on the board — which is how you tell them apart
// at a glance on a phone.
const KNOBS: Partial<Record<Role, [number, number, number][]>> = {
  p: [[22.5, 13.0, 5.0]],
  q: [
    [9.0, 12.8, 2.3],
    [16.1, 9.4, 2.3],
    [22.5, 8.0, 2.5],
    [28.9, 9.4, 2.3],
    [36.0, 12.8, 2.3],
  ],
};

// The two marks that are drawn in the RIM colour rather than the fill, so
// they stay legible whichever way round the piece is inked.
function detail(role: Role) {
  if (role === "n") return <circle className="cb-mark" cx="17.6" cy="16.4" r="1.35" />;
  if (role === "b")
    return <path className="cb-slit" d="M22.5 14.6v7.6M19.2 18.4h6.6" />;
  return null;
}

export function PieceGlyph({ role, color }: { role: Role; color: Color }) {
  return (
    <svg
      className="cb-glyph"
      data-color={color}
      viewBox="0 0 45 45"
      aria-hidden="true"
      focusable="false"
    >
      {BODY[role].map((d, i) => (
        <path key={i} d={d} />
      ))}
      {KNOBS[role]?.map(([cx, cy, r], i) => (
        <circle key={i} cx={cx} cy={cy} r={r} />
      ))}
      {detail(role)}
    </svg>
  );
}
