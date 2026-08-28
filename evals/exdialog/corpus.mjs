// HER OWN OUTPUT CORPUS, for the example-dialogue format experiment. WS-O.
//
// ── WHERE IT COMES FROM, AND WHY THAT MATTERS ────────────────────────────
// The 96 turns marked `her` in `evals/recallbench/fixtures/dyad-{a,b,c}.mjs`.
// They were authored by WS-K as the AGENT SIDE of three dyads for a memory
// benchmark, months of simulated relationship apiece, before this experiment
// existed and with no idea it would exist.
//
// That independence is the whole reason this corpus is usable. A corpus
// written alongside the arms would be a corpus written to make one arm win:
// the metric below is "how much of the example text is drawn from the same
// distribution as her replies", and an author who holds both pens decides that
// number by hand. Here the corpus is fixed, it is in version control, and it
// is load-bearing for a different suite that would fail if it were edited to
// suit this one.
//
// ── WHAT IT IS NOT ───────────────────────────────────────────────────────
// It is not model output. Nobody generated it; a person wrote it as what she
// would say. So it is a corpus of her INTENDED register, which is the right
// reference for "is this example text made of things she says" and the wrong
// reference for "does the model actually recite". The second question needs
// generation and is the provider seam in run.mjs §5.
//
// n = 96 turns. Small, and stated everywhere the number is used.
import { pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = join(HERE, "..", "recallbench", "fixtures");

const dyads = await Promise.all(
  ["dyad-a.mjs", "dyad-b.mjs", "dyad-c.mjs"].map((f) =>
    import(pathToFileURL(join(FIX, f)).href).then((m) => m.default),
  ),
);

/** Every turn she speaks, in fixture order. */
export const HER_TURNS = dyads.flatMap((d) => (d.turns || []).filter((t) => t.from === "her").map((t) => t.text));

/** And his, as the NEGATIVE reference: an n-gram that is common to both sides
 *  is common to Hinglish, not characteristic of her. §3 uses this to keep the
 *  overlap number from being a measure of how Hindi the text is. */
export const HIS_TURNS = dyads.flatMap((d) => (d.turns || []).filter((t) => t.from === "me").map((t) => t.text));

/** Words, lowercased, punctuation stripped — the repo's shared tokenisation
 *  convention (inner.ts / moment.ts / culture.ts all pad-and-strip the same
 *  way). Deterministic and Unicode-aware, so Devanagari survives. */
export function words(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

/** The set of word n-grams in a list of strings. */
export function ngrams(texts, n) {
  const out = new Set();
  for (const t of texts) {
    const w = words(t);
    for (let i = 0; i + n <= w.length; i++) out.add(w.slice(i, i + n).join(" "));
  }
  return out;
}

/** Every n-gram of one text, WITH repeats, so a ratio is over occurrences
 *  rather than over distinct forms — a block that repeats one liftable phrase
 *  six times is six times more liftable, and a set would hide that. */
export function ngramList(text, n) {
  const w = words(text);
  const out = [];
  for (let i = 0; i + n <= w.length; i++) out.push(w.slice(i, i + n).join(" "));
  return out;
}
