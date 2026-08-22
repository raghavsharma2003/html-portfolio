// The opening book — the ONE piece of chess culture she is allowed to name.
//
// The owner, from live play: *"taking the opening name and explaining 'this is
// the opening' can be there, in a good sense."* A person who plays chess says
// "oh, Italian" on move three. It costs nothing, it is the cheapest possible
// signal that she is following rather than narrating, and it is the one chess
// fact a casual player enjoys being told.
//
// ── the law this file lives under ─────────────────────────────────────────
//
// Same as the rest of `src/engine/chess/`: NO ENGLISH SHE COULD SAY. What
// comes out of here is a NAME — a noun phrase, lowercase, with its article —
// and never a sentence. "the italian game" is a name; "you're playing the
// Italian!" is a line she would recite every single game (`recited-prompt`).
// The caller in `chessTalk.ts` builds the fact around it.
//
// ── why a prefix book and not a heuristic ─────────────────────────────────
//
// A wrong opening name is worse than no opening name. Silence reads as her not
// caring; "this is the Caro-Kann" over a French Defence reads as her not
// knowing, and she does not get that back. So this is a literal table of move
// sequences, every line checked against a published source, and anything not in
// the table returns null. There is no fuzzy matching and no "close enough".
//
// Longest prefix wins, so a line names itself as precisely as the moves so far
// allow: `d4 d5 c4` is the queen's gambit, and `d4 d5 c4 e6` is the queen's
// gambit declined, and the same game is both at different moments.
//
// ── what "left book" means here ───────────────────────────────────────────
//
// A prefix match is permanent by construction, and that is correct chess: a
// game that reached the Italian on move three is still the Italian on move
// thirty. What returns null is a game that never matched — either because it
// deviated before reaching a named line (1.e4 e5 2.Nf3 Nc6 3.a3 is nothing;
// "e4 e5 Nf3 Nc6" is deliberately NOT an entry) or because it is a shuffle
// nobody named. Past `MAX_BOOK_PLY` a non-match can never become a match, so
// the scan stops.

/**
 * Book lines, as space-joined SAN prefixes.
 *
 * Every line below was checked against a published source (Wikipedia / 365Chess
 * / chess.com opening pages) rather than written from memory — see the eval,
 * which replays each one through the real board module and asserts the name at
 * every depth. A move order that does not survive that replay is not a book
 * line, it is a typo that would make her confidently wrong out loud.
 */
const BOOK: ReadonlyArray<readonly [string, string]> = [
  // ── 1.e4 e5 ──────────────────────────────────────────────────────────────
  ["e4 e5 Nf3 Nc6 Bc4", "the italian game"],
  // Two Knights → Fried Liver. The fun one, and the reason MAX_BOOK_PLY is 11.
  ["e4 e5 Nf3 Nc6 Bc4 Nf6 Ng5 d5 exd5 Nxd5 Nxf7", "the fried liver attack"],
  ["e4 e5 Nf3 Nc6 Bb5", "the ruy lopez"],
  ["e4 e5 Nf3 Nc6 d4", "the scotch game"],
  // 3.Nc3 alone is the Three Knights; it is the Four Knights only after 3...Nf6.
  ["e4 e5 Nf3 Nc6 Nc3 Nf6", "the four knights game"],
  ["e4 e5 Nc3", "the vienna game"],
  ["e4 e5 f4", "the king's gambit"],
  // ── 1.e4, everything else ────────────────────────────────────────────────
  ["e4 c5", "the sicilian defence"],
  ["e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6", "the sicilian najdorf"],
  ["e4 e6", "the french defence"],
  ["e4 c6", "the caro-kann defence"],
  ["e4 d5", "the scandinavian defence"],
  // ECO calls 1.e4 d6 Pirc (B07) on its own, but 1...d6 transposes to a dozen
  // things; naming it one move later costs nothing and is never wrong.
  ["e4 d6 d4 Nf6", "the pirc defence"],
  ["e4 Nf6", "alekhine's defence"],
  // ── 1.d4 d5 ──────────────────────────────────────────────────────────────
  ["d4 d5 c4", "the queen's gambit"],
  ["d4 d5 c4 dxc4", "the queen's gambit accepted"],
  ["d4 d5 c4 e6", "the queen's gambit declined"],
  ["d4 d5 c4 c6", "the slav defence"],
  ["d4 d5 c4 e6 g3", "the catalan opening"],
  // ── the London, which is a SETUP and therefore several move orders ───────
  ["d4 d5 Bf4", "the london system"],
  ["d4 Nf6 Bf4", "the london system"],
  ["d4 d5 Nf3 Nf6 Bf4", "the london system"],
  ["d4 Nf6 Nf3 e6 Bf4", "the london system"],
  ["d4 Nf6 Nf3 g6 Bf4", "the london system"],
  // ── 1.d4 Nf6 2.c4 ────────────────────────────────────────────────────────
  ["d4 Nf6 c4 g6 Nc3 Bg7", "the king's indian defence"],
  ["d4 Nf6 c4 g6 Nc3 d5", "the grünfeld defence"],
  ["d4 Nf6 c4 e6 Nc3 Bb4", "the nimzo-indian defence"],
  ["d4 Nf6 c4 e6 g3", "the catalan opening"],
  ["d4 f5", "the dutch defence"],
  // ── flank ────────────────────────────────────────────────────────────────
  ["c4", "the english opening"],
  // 1.Nf3 on its own is the Zukertort and can become anything; the Réti proper
  // is the c4 challenge to a black pawn on d5.
  ["Nf3 d5 c4", "the réti opening"],
  ["f4", "bird's opening"],
];

const SCHOLARS = "the four-move checkmate try";

const BY_LINE: ReadonlyMap<string, string> = new Map(BOOK.map(([line, name]) => [line, name]));

/** The longest book line, in plies. Nothing deeper is ever looked up. */
const MAX_BOOK_PLY = Math.max(...BOOK.map(([line]) => line.split(" ").length));

/**
 * Past this many plies an unmatched game is out of book for good, and the
 * scholar's-mate shape has either happened or is no longer what it is.
 */
const OUT_OF_BOOK_PLY = 10;

/** SAN as the book spells it: no check, mate or annotation marks. */
const bare = (san: string | null | undefined): string =>
  (san ?? "").replace(/[+#!?]+$/, "");

/**
 * The four-move checkmate, recognised as an ATTEMPT rather than after the fact.
 *
 * She has to know she is being scholar's-mated at while there is still time for
 * it to be funny, so this fires on the shape — queen and bishop both pointed at
 * f7 (or f2) inside the first three moves — not on the mate itself, which the
 * game status already reports.
 *
 * Both classical move orders are covered: 2.Bc4/3.Qh5 and 2.Qh5/3.Bc4, with
 * Qf3 as the equally common queen square. The sortie is required on move TWO or
 * THREE specifically; that is what keeps it off an Italian Game where the queen
 * wanders to h5 on move four for ordinary reasons.
 */
function scholarsMateTry(sans: readonly string[]): string | null {
  const at = (i: number): string | null => (i < sans.length ? bare(sans[i]) : null);
  const white = [at(2), at(4)];
  if (at(0) === "e4" && white.includes("Bc4") && (white.includes("Qh5") || white.includes("Qf3"))) {
    return SCHOLARS;
  }
  const black = [at(3), at(5)];
  if (at(1) === "e5" && black.includes("Bc5") && (black.includes("Qh4") || black.includes("Qf6"))) {
    return SCHOLARS;
  }
  return null;
}

/**
 * The name of the opening these moves are in, or null.
 *
 * Lowercase and article-included ("the italian game", "alekhine's defence") so
 * it drops straight into a fact without the caller doing grammar. It is a NAME,
 * never a sentence — see this file's header for why that distinction is load
 * bearing.
 *
 * Null is the common answer and is the right one: a name she is not sure of is
 * a name she should not say.
 */
export function openingName(sans: readonly string[]): string | null {
  if (sans.length === 0) return null;
  const moves = sans.map(bare);
  for (let k = Math.min(moves.length, MAX_BOOK_PLY); k >= 1; k--) {
    const hit = BY_LINE.get(moves.slice(0, k).join(" "));
    if (hit) return hit;
  }
  // Not a book line. The one shape still worth naming is the four-move mate,
  // and only while it is still the opening.
  if (moves.length > OUT_OF_BOOK_PLY) return null;
  return scholarsMateTry(moves);
}

/** Every name this book can produce. For the eval, and for nothing else. */
export const OPENING_NAMES: readonly string[] = [
  ...new Set([...BOOK.map(([, name]) => name), SCHOLARS]),
];
