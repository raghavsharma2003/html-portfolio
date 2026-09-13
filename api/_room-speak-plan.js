// The Room's voice reply, split into an ORDERED PLAN of sentences (WS-R156).
//
// ═════════════════════════════════════════════════════════════════════════
// WHY THIS FILE EXISTS AND WHAT IT DOES NOT DO
// ═════════════════════════════════════════════════════════════════════════
//
// `docs/gurukul/AZURE-DEPLOY-STATE.md` §8: the runtime returns COMPLETE,
// signed synthesis results under a GPU lock. It is not streaming TTS, and a
// benchmark of this deployment must include the whole path — there is no
// partial-result event this file could subscribe to even if it wanted one.
// The one thing the product controls WITHOUT a new model is how much text one
// synthesis call has to wait on: a five-sentence reply synthesised as five
// short clips lets a follower hear the first sentence while the rest are
// still being generated, rather than waiting on the whole reply once. This
// file is the PURE, offline half of that: a deterministic function from full
// reply text to an ordered array of sentence strings. It calls no provider,
// touches no database, and knows nothing about the cap, the watermark, the
// session or the wire — `api/_room-surface.js`'s `roomSpeak` is the only
// caller, and it is the one that turns "sentence 2 of 5" into a synthesised,
// protected, capped clip. Kept in its own file for the same reason
// `api/_room-voice.js` is its own file rather than folded into
// `_room-surface.js`: a pure function a fixture can drive with no `db` at all
// deserves a boundary a future edit cannot quietly widen.
//
// ═════════════════════════════════════════════════════════════════════════
// THE SPLIT RULE
// ═════════════════════════════════════════════════════════════════════════
//
// A sentence ends at a run of one or more terminal marks — `.`, `!`, `?`, the
// Devanagari danda `।` (U+0964) or double danda `॥` (U+0965) — UNLESS that
// run is a single `.` that is one of three things a plain reader would never
// hear as a pause:
//
//   1. A DECIMAL POINT: a digit immediately before AND immediately after the
//      dot ("₹49.99", "3.14") — no space on either side is the whole signal;
//      a real sentence boundary never sits between two digits with nothing
//      between them and the dot.
//   2. An ABBREVIATION from the fixed list below ("Dr.", "vs.", "etc.") — the
//      word immediately before the dot, case-insensitively, is in the list.
//   3. An INITIAL: a single letter immediately before the dot, itself
//      preceded by the start of the sentence, whitespace, or another dot
//      ("A. K. Verma", "e.g."). Chained initials each see the PREVIOUS one's
//      trailing dot in the "preceded by" check, so a run of them ("A.P.J.")
//      never splits internally.
//   4. A ONE- OR TWO-DIGIT LIST MARKER at the very start of the sentence
//      ("1. Preheat the oven") — the digits run from the sentence's own
//      start to the dot, with nothing else before them.
//
// A closing quote or bracket immediately after a real boundary (`"`, `'`,
// `)`, `]`, the curly variants) is absorbed into the SAME sentence, never
// left to start an empty next one. Everything left over at the end of the
// text — with or without trailing punctuation — becomes the final sentence,
// so a reply missing its terminal punctuation (common in casual chat) still
// gets exactly one final clip rather than being silently dropped.
//
// Known, accepted false negative (documented rather than "fixed" — see
// `context/rejected.md#ws-r156-abbreviation-list-cannot-see-the-next-word`):
// a dangling "Dr." with no name after it ("I met the Dr. He seemed kind.")
// is read as ONE sentence, because the abbreviation check has no way to know
// there is no name coming — it only ever looks BACKWARD from the dot. This
// splitter is a plain reader's shape, not a parser with a dictionary of
// every English or Hindi name; the fixture below tests the shapes that
// actually occur in a Room reply, not this one.

const TERMINATOR = new Set([".", "!", "?", "।", "॥"]);
const CLOSER = new Set(["\"", "'", ")", "]", "”", "’"]);

/** Plain, common English abbreviations that end in a dot mid-sentence.
 *  Lowercased before lookup — the check is case-insensitive so "Mr." and
 *  "mr." both match. Kept short and deliberate rather than exhaustive: every
 *  addition is one more way a REAL sentence boundary could be swallowed, so
 *  this list holds only forms actually plausible in a Room's own voice — a
 *  warm, conversational reply, not a legal document. */
const ABBREVIATIONS = new Set([
  "mr", "mrs", "ms", "dr", "prof", "sr", "jr", "st", "vs", "etc", "eg", "ie",
  "no", "fig", "approx", "co", "inc", "ltd", "capt", "gen", "lt", "col",
  "maj", "rev", "hon", "sgt", "cmdr", "adm", "est", "dept", "univ", "misc",
  // Devanagari abbreviations that keep a Roman-style dot in ordinary
  // written Hindi ("डॉ. शर्मा", "श्रीमती Verma" is written out in full and
  // never abbreviated this way, so only the two dotted forms in real use
  // are listed): "डॉ." (doctor) and "कु." (kumari, an unmarried woman's
  // title, still seen in formal address).
  "डॉ", "कु",
]);

/**
 * `text` -> an ordered, non-empty array of sentence strings. Pure: same
 * input, same output, every time, with no I/O of any kind. Never throws on
 * any string input — an empty or whitespace-only reply is `[]`; every other
 * input returns at least one sentence (the whole trimmed text, if nothing in
 * it reads as a boundary).
 */
export function planReplySentences(text) {
  const s = String(text ?? "").trim();
  if (!s) return [];
  const n = s.length;
  const boundaries = [];
  let curStart = 0;
  let i = 0;
  while (i < n) {
    const c = s[i];
    if (!TERMINATOR.has(c)) {
      i += 1;
      continue;
    }
    let j = i;
    while (j < n && TERMINATOR.has(s[j])) j += 1;
    let isBoundary = true;
    // Every exception below applies ONLY to a lone "." — a run of two or
    // more terminators ("?!", "..."), or a single "!"/"?"/danda, is always a
    // real boundary; nothing on this repo's own fixture reads those as
    // anything else.
    if (j - i === 1 && c === ".") {
      const prevChar = i > 0 ? s[i - 1] : "";
      const nextChar = j < n ? s[j] : "";
      if (prevChar >= "0" && prevChar <= "9" && nextChar >= "0" && nextChar <= "9") {
        isBoundary = false; // decimal point
      } else {
        const before = s.slice(curStart, i);
        const wordMatch = /([A-Za-zऀ-ॿ]+)$/.exec(before);
        const word = wordMatch ? wordMatch[1] : "";
        if (word && word.length > 1 && ABBREVIATIONS.has(word.toLowerCase())) {
          isBoundary = false; // "Dr.", "etc.", ...
        } else if (word.length === 1) {
          const beforeWord = before.slice(0, before.length - 1);
          if (beforeWord === "" || /[\s.]$/.test(beforeWord)) {
            isBoundary = false; // initial, e.g. "A." / "e.g."
          }
        } else if (!word) {
          const digitMatch = /([0-9]{1,2})$/.exec(before);
          if (digitMatch && before.slice(0, before.length - digitMatch[1].length).trim() === "") {
            isBoundary = false; // "1. " list marker at the sentence's own start
          }
        }
      }
    }
    if (!isBoundary) {
      i = j;
      continue;
    }
    let end = j;
    while (end < n && CLOSER.has(s[end])) end += 1;
    boundaries.push(end);
    curStart = end;
    i = end;
  }
  if (boundaries.length === 0 || boundaries[boundaries.length - 1] < n) boundaries.push(n);
  const sentences = [];
  let start = 0;
  for (const b of boundaries) {
    const piece = s.slice(start, b).trim();
    if (piece) sentences.push(piece);
    start = b;
  }
  return sentences.length ? sentences : [s];
}

/**
 * The shape `roomSpeak` binds into every clip response — computed here so
 * `_room-surface.js` never re-derives "how many sentences" a second way.
 * `index` is clamped to a valid array index by the CALLER (`roomSpeak`
 * refuses an out-of-range one before this is ever reached); this function
 * itself has no notion of a refusal, only of the plan.
 */
export function roomSpeakPlan(text) {
  const sentences = planReplySentences(text);
  return { sentences, count: sentences.length };
}
