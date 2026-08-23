// "if you say bye she should hang up on her own" — the tester's own words.
//
// ── why this is a SECOND detector and not a widened `asksToHangUp` ────────
//
// `src/engine/hangup.ts` answers a different question, and its header says so
// in the sentence that matters: *"'bye' alone is not here, and neither is
// 'ok' — people say both constantly in the middle of calls."* That is right,
// and it must stay right: `asksToHangUp` fires on an EXPLICIT instruction
// ("rakh de", "cut the call"), at ANY point in a call, from a single
// utterance, and it ends the line after a fixed 9-second grace.
//
// A farewell is not an instruction. It is a social close, and whether it is
// one cannot be decided from the words alone:
//
//   • "bye" said at second 4 of a call is a joke or a misdial.
//   • "bye bolna galat laga" is a sentence ABOUT the word, mid-topic.
//   • "acha chalo bye, good night" after eleven minutes is a goodbye.
//
// So the two live apart on purpose. This one is conservative in a way
// `asksToHangUp` does not need to be (a closed vocabulary, below), and it is
// paired in `useCallEngine.ts` with conditions it cannot see from here — how
// long the call has been up, and whether SHE has since said her own goodbye.
// Widening `asksToHangUp` instead would have made a mid-call "bye" cut the
// line, which is the one failure `hangup.ts` was written to prevent.
//
// ── the posture, restated because it is the whole design ─────────────────
//
// Ending a call he wanted to keep is far worse than missing one he wanted
// ended: the miss costs him one tap on a button already on screen, a false
// fire drops him mid-sentence and there is no undo. So this predicate is a
// CLOSED VOCABULARY: every token of his utterance must be either a farewell
// token or a small set of fillers that can never be sufficient on their own.
// One unrecognised word and the answer is no.
//
// That deliberately misses real goodbyes — "chal so ja, late ho gaya" passes,
// "chal so ja, mummy bula rahi hai" does not — and the misses are the safe
// direction. `evals/callmem/run.mjs` pins both halves, including every
// false-positive case in this header.

/** Above this many words it is a sentence, not a goodbye. */
export const FAREWELL_MAX_WORDS = 7;
/** Above this many characters, likewise. Cheap pre-filter before any regex. */
export const FAREWELL_MAX_CHARS = 52;

// Multi-word farewells, collapsed to one token BEFORE the vocabulary check so
// "good night" is one farewell rather than the filler "good" plus the filler
// "night" — which would let "good" and "night" pass inside a sentence that
// was never a goodbye.
const PHRASES: readonly [RegExp, string][] = [
  [/\bgood\s*night\b/g, "«bye»"],
  [/\bgud\s*(?:night|nyt|n8)\b/g, "«bye»"],
  [/\bgood\s*nyt\b/g, "«bye»"],
  [/\bnight\s*night\b/g, "«bye»"],
  [/\bshubh\s*ratri\b/g, "«bye»"],
  [/\bshab+a?\s*ba?\s*khair\b/g, "«bye»"],
  [/\b(?:khuda|allah)\s*hafiz\b/g, "«bye»"],
  [/\bso\s*jaa?(?:o|na)?\b/g, "«bye»"],
  [/\bsone?\s*ja\b/g, "«bye»"],
  [/\bsleep\s*well\b/g, "«bye»"],
  [/\bsweet\s*dreams\b/g, "«bye»"],
  [/\btake\s*care\b/g, "«bye»"],
  [/\bmilte\s*(?:hai|hain|h)\b/g, "«bye»"],
  [/\bphir\s*mil(?:te|enge|ta|ke)\w*\b/g, "«bye»"],
  [/\bchal(?:ta|ti)\s*(?:hu|hun|hoon)\b/g, "«bye»"],
  [/\bchalte\s*(?:hai|hain|h)\b/g, "«bye»"],
  [/\brakh(?:ta|ti)\s*(?:hu|hun|hoon)\b/g, "«bye»"],
  [/\bnikal(?:ta|ti)\s*(?:hu|hun|hoon)\b/g, "«bye»"],
  [/\bsee\s*(?:ya|you)\b/g, "«bye»"],
  [/\bgood\s*bye\b/g, "«bye»"],
  [/\bta\s*ta\b/g, "«bye»"],
];

/** Single tokens that ARE a goodbye. Repeated vowels are normalised first
 *  ("byeee", "byyye"), because a drawn-out bye is the most common one. */
const FAREWELL_TOKEN =
  /^(?:«bye»|bye|bbye|byy|tata|alvida|gn|gnite|gnight|goodnight|goodbye|cya|ciao|adios|khudahafiz|nite)$/;

/** Tokens allowed ALONGSIDE a farewell and never sufficient without one.
 *  Fillers, politeness, and the small tail of excuse words that ride a real
 *  goodbye ("late ho gaya", "kal baat karte hai"). */
const SOFT = new Set([
  "ok", "okay", "okk", "oki", "k", "kk",
  "acha", "achha", "accha", "achcha", "acchha",
  "thik", "theek", "sahi",
  "hai", "hain", "h", "he", "hu", "hun",
  "chal", "chalo", "chaliye",
  "haan", "han", "ha", "hmm", "hm", "hmmm", "yes", "yeah", "yep", "yup",
  "arre", "are", "arey", "yaar", "yr", "bhai", "bro", "dost", "ji",
  "phir", "fir", "ab", "to", "toh", "na", "naa", "bhi", "aur", "and", "then",
  "ye", "yeh", "wo", "woh", "main", "mai", "m", "i", "im", "me", "you", "u", "tu", "tum", "aap",
  "love", "luv", "miss", "muah", "mwah",
  "good", "gud", "night", "nyt", "day", "morning",
  "done", "fine", "cool", "great", "nice",
  "late", "ho", "gaya", "gayi", "gya", "raha", "rahi", "der", "raat", "subah", "kal",
  "baat", "karte", "karenge", "karta", "karti", "milenge", "baad",
  "the", "a", "so",
]);

/** Any of these and it is not a close — it is a sentence that happens to
 *  contain a goodbye word. Checked FIRST, so the cheapest reject wins. */
const BLOCKER =
  /[?]|\b(?:kya|kyu|kyun|kyon|kaise|kaisa|kaisi|kab|kaun|kahan|kahaan|matlab|nahi|nahin|nai|mat|galat|sahi\s+nahi|lekin|but|par|magar|ruk|ruko|rukiye|sun|suno|suniye|wait|hold|ek|minute|min|sec|second|bol|bola|bolna|bolne|kaha|kehna|samajh|sach|jhoot|mazak|mazaak|joke|abhi|pehle|nahiii)\b/i;

/**
 * Does this utterance read as HIM closing the conversation?
 *
 * Pure, local, no network, no persona dependency — it works identically on
 * the realtime lane (where there is no text of hers at all) and the cascade
 * lane, which is the same property `asksToHangUp` was built for.
 *
 * TRUE means "the words are a goodbye and nothing else". It does NOT mean
 * "end the call": the caller adds the conditions this function cannot see —
 * the call is past its opening seconds, no hangup is already counting down,
 * and she gets to finish her own goodbye first.
 */
export function readsAsFarewell(said: string): boolean {
  const raw = String(said || "").trim();
  if (raw.length < 2 || raw.length > FAREWELL_MAX_CHARS) return false;
  if (BLOCKER.test(raw)) return false;

  // normalise: lowercase, strip everything that is not a letter or a space,
  // collapse drawn-out vowels/consonants ("byeeee", "achhhha")
  let s = raw
    .toLowerCase()
    .replace(/[^a-zऀ-ॿ\s]/g, " ")
    .replace(/(.)\1{2,}/g, "$1$1")
    .replace(/\s+/g, " ")
    .trim();
  if (!s) return false;
  if (s.split(" ").length > FAREWELL_MAX_WORDS) return false;

  for (const [re, tok] of PHRASES) s = s.replace(re, tok);

  const tokens = s.split(" ").filter(Boolean);
  if (!tokens.length) return false;

  let farewells = 0;
  for (const t0 of tokens) {
    // "byeee" → "byee" after the run-collapse above; fold any remaining
    // stretched bye back to the canonical token
    const t = t0.replace(/^b+y+e+$/, "bye").replace(/^byee+$/, "bye");
    if (FAREWELL_TOKEN.test(t)) {
      farewells++;
      continue;
    }
    if (SOFT.has(t)) continue;
    return false; // one unrecognised word and this is a sentence, not a close
  }
  return farewells > 0;
}
