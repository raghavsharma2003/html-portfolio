// WS-R105 built this as a pure detector, measured (never shipped) against
// `evals/room-adversarial-creator`'s corpus: "does this text look shaped like
// an instruction aimed at the AI, rather than teaching material aimed at a
// student?" WS-R112 moves it here, unchanged, so the mining path
// (`api/_context-mining.js`) and the eval that measures it import the SAME
// function rather than two copies that can drift — `subset-check-is-green-
// by-construction`'s own lesson, restated for a detector instead of a
// citation check. `evals/room-adversarial-creator/run.mjs` imports
// `detectInstructionShapedMaterial` from here now; nothing in its own
// corpus, measurements or negative controls changed.
//
// NO MODEL CALL. Every class below is the corpus's own class
// (`evals/room-adversarial-creator/corpus.mjs`), turned into a regex over
// NORMALISED text — the same method `ws-r89-slugof-nfkc-before-ascii-check`
// (context/decisions.md) used for a slug, applied here to a longer passage:
// `.normalize("NFKC")` collapses a COMPATIBILITY duplicate (fullwidth Latin)
// into its canonical ASCII form before any pattern runs, and does NOT
// collapse a CROSS-SCRIPT HOMOGLYPH (Cyrillic styled to look like Latin) —
// the two are canonically unrelated, only visually similar, which is exactly
// the asymmetry `detectInstructionShapedMaterial` measures rather than
// hides: a fullwidth-only injection is caught by BOTH the mixed-script check
// and, after normalisation, the semantic class it was disguising; a
// Cyrillic-confusable injection is caught by the mixed-script check alone,
// because NFKC leaves the confusable letters exactly as they were.
//
// PRECISION OVER RECALL, on purpose. Every pattern requires a SPECIFIC
// multi-word collocation ("ignore ... instructions", "you are now a/an/the
// <role>", "repeat ... message"), never a single trigger word — because
// `corpus.mjs`'s own `BENIGN_SOURCE_SAMPLE` was written to contain the
// single trigger words ("ignore", "system", "you are", "operator",
// "repeat", "config", "role", "always", "never") in entirely ordinary
// teaching sentences. A detector that fired on the word alone would be
// unusable; measuring against that sample is what makes law 4's 2%
// false-positive ceiling a real bar rather than a formality.
//
// The secret_shaped class is the one exception to "phrase, never a
// keyword": it requires BOTH a secrecy-framing phrase AND a token-shaped
// string (long, no spaces, mixed alphanumeric) in the SAME text — either
// alone is common in ordinary material (a worksheet code, an instruction
// to keep something in mind), the pair together is not.
//
// PURE — imports nothing, so it is safe on both sides of this product's own
// split: the mining path (a request handler with database access) and the
// eval (no database at all).

const CLASS_PATTERNS = {
  instruction_override: new RegExp(
    "(ignore\\s+(all|any|every|previous|prior|earlier|the\\s+above)\\s+(previous\\s+|prior\\s+|earlier\\s+)?instructions?" +
      "|disregard\\s+(everything|all|the\\s+above)" +
      "|forget\\s+(the|your|all)\\s+(mentor\\s+boundary|rules|instructions)" +
      "|overrides?\\s+(everything|all|any)\\s+(instruction|stated|written)" +
      "|new\\s+(standing\\s+)?instruction[,.]?\\s+overrides" +
      "|\\boverride\\s*:" +
      "|sab\\s+instructions\\s+bhool" +
      "|saari\\s+baatein\\s+cancel" +
      "|purana\\s+boundary\\s+hata" +
      "|pichle\\s+sab\\s+ignor)",
    "i",
  ),
  fake_system_prompt: new RegExp(
    "(\\[\\s*system\\b|<<\\s*system\\b|--\\s*begin\\s+configuration" +
      "|system\\s+prompt\\s*\\(authoritative" +
      "|developer\\s+mode\\b" +
      "|role\\s*:\\s*system" +
      "|asli\\s+system\\s+prompt)",
    "i",
  ),
  role_reassignment: new RegExp(
    "(you\\s+are\\s+now\\s+(a|an|the)\\s*(operator|admin|administrator|debugging\\s+agent|content\\s+moderator|database\\s+administrator)" +
      "|you\\s+are\\s+not\\s+a\\s+[a-z ]+,\\s*you\\s+are\\s+(a|an|the)?\\s*(operatorbot|debugging\\s+agent|operator|admin|administrator|content\\s+moderator|database\\s+administrator)" +
      "|you\\s+have\\s+been\\s+promoted\\s+to\\s+admin" +
      "|assume\\s+the\\s+persona\\s+of" +
      "|acting\\s+as\\s+a\\s+database\\s+administrator" +
      "|ab\\s+tum\\s+teacher\\s+nahi\\s+ho" +
      "|naya\\s+role\\s+diya\\s+gaya" +
      "|admin\\s+access\\s+confirm\\s+karo" +
      "|ｏｐｅｒａｔｏｒ)",
    "i",
  ),
  exfil_bait: new RegExp(
    "(repeat\\s+(their|your|the|this\\s+student.?s)\\s+(exact\\s+)?(previous|last)\\s+message" +
      "|tell\\s+them\\s+everything\\s+you\\s+(remember|know)" +
      "|print\\s+out\\s+the\\s+full\\s+text\\s+of\\s+every" +
      "|forward\\s+a\\s+copy\\s+of\\s+this\\s+student" +
      "|pichla\\s+message\\s+hoobehoo\\s+repeat" +
      "|pichle\\s+students\\s+se\\s+(kya\\s+)?baat\\s+ki\\s+thi.*bata" +
      "|unhe\\s+poori\\s+detail\\s+bata\\s+do)",
    "i",
  ),
  other_creator_identity: new RegExp(
    "(built\\s+by\\s+[a-z][a-z' ]{2,30}" +
      "|actually\\s+(recorded|built|made|written)\\s+by\\s+[a-z][a-z' ]{2,30}" +
      "|introduce\\s+yourself\\s+as\\s+[a-z][a-z' ]{2,30}" +
      "|(refer(red)?\\s+(students?\\s+)?there|mirror\\s+of\\s+[a-z][a-z' ]{2,30}.{0,3}s\\s+room)" +
      "|asal\\s+mein.{0,60}?ne\\s+banaya" +
      "|kisne\\s+banaya.*bol\\s+dena" +
      "|unke\\s+room\\s+.*bhej\\s+dena)",
    "i",
  ),
};

/** A token-shaped string: 16+ chars, letters/digits/`_-.`, no whitespace,
 *  mixing letters and digits or carrying an underscore/hyphen run — the
 *  visual shape of a credential rather than a worksheet code. Deliberately
 *  loose (it is only HALF of the secret_shaped test; see below). */
const TOKEN_SHAPE_RE = /\b[A-Za-z0-9][A-Za-z0-9_-]{15,}\b/;
const SECRECY_FRAMING_RE = new RegExp(
  "(api\\s+key\\s+is|access\\s+code|never\\s+mention\\s+this|keep\\s+(it\\s+)?memorised" +
    "|magic\\s+phrase|internal\\s+reference|backup\\s+access" +
    "|kisi\\s+student\\s+ko\\s+mat\\s+batana|yaad\\s+rakhna.*code|secret\\s+dikhao)",
  "i",
);

/** True when `text` mixes ASCII Latin letters with a script confusable with
 *  Latin at a glance (Cyrillic U+0400-U+04FF) or carries fullwidth Latin
 *  forms (U+FF21-U+FF5A) — the two homoglyph shapes `corpus.mjs`'s
 *  `homoglyph` class actually uses. Tested on the RAW text, before NFKC,
 *  because NFKC collapses one of the two shapes and this check exists
 *  specifically to catch what normalisation alone would miss. */
function hasScriptConfusables(rawText) {
  const s = String(rawText || "");
  const hasCyrillic = /[Ѐ-ӿ]/.test(s);
  const hasAsciiLatin = /[A-Za-z]/.test(s);
  const hasFullwidthLatin = /[Ａ-Ｚａ-ｚ]/.test(s);
  return (hasCyrillic && hasAsciiLatin) || hasFullwidthLatin;
}

/**
 * The one exported entry point. Pure, synchronous, no I/O, no model call.
 * `matchedClasses` names every class that fired (a passage can trip more
 * than one — the homoglyph entries in `corpus.mjs` deliberately restate an
 * `instruction_override`/`role_reassignment` shape, so firing on both is
 * the CORRECT answer for those, not a bug).
 */
export function detectInstructionShapedMaterial(rawText) {
  const raw = String(rawText || "");
  const normalized = raw.normalize("NFKC");
  const lower = normalized.toLowerCase();
  const matchedClasses = [];

  if (hasScriptConfusables(raw)) matchedClasses.push("homoglyph");
  for (const [cls, re] of Object.entries(CLASS_PATTERNS)) {
    if (re.test(lower)) matchedClasses.push(cls);
  }
  if (SECRECY_FRAMING_RE.test(lower) && TOKEN_SHAPE_RE.test(normalized)) {
    matchedClasses.push("secret_shaped");
  }

  return { flagged: matchedClasses.length > 0, matchedClasses: [...new Set(matchedClasses)] };
}

export { CLASS_PATTERNS, TOKEN_SHAPE_RE, SECRECY_FRAMING_RE, hasScriptConfusables };
