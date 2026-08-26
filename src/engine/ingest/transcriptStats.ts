// transcriptStats — the STATISTICAL half of Gurukul ingestion (WS-F).
//
// SPEC-GURUKUL.md §2 item 2: "statistical pass (filler/laughter/code-switch
// ratios, catchphrase candidates with the ≥5-occurrences phrase-bank rule) +
// LLM extraction pass through the existing claim-extraction machinery". This
// file is the first half and NOTHING of the second — the split is the whole
// design, and `ingestion-research.md` §4 is why: there is no product prior art
// for structured-persona extraction from a long real-person transcript, and
// the one thing that survey found MISSING everywhere was exactly this — filler
// distributions and catchphrase frequency as a *computational* stage rather
// than as an LLM's impression of the transcript. The recommendation there is a
// hybrid, and a hybrid is only a hybrid if the countable half is actually
// counted. A model asked "what are this teacher's catchphrases?" returns
// plausible ones; a counter returns the ones he said.
//
// ── why this module is PURE and standalone ────────────────────────────────
// It imports NOTHING. Not `relstate.ts` (whose `computeCsRatio` is a SQL
// query against `meera_log`, so importing it would drag a QueryFn, an agent
// id and a live database into a function that takes an array of strings), not
// `honesty.ts`, not the agent types. The marker-word list below is a VERBATIM
// PORT with its source named, which is this repo's established shape for the
// same problem: `api/consolidate.js:1192` carries the identical list under the
// comment "mirrors relstate.ts's HINDI_MARKER_WORDS", because a serverless
// function may not import from `src/`. The cost of a port is drift; the cost
// of the import here would be a statistics module that cannot run offline, and
// the eval suite that gates it is offline by contract.
//
// ── the authoring law, restated where a pipeline will read it ─────────────
// characters/types.ts: fragments are SHAPES AND FACTS, never sentence-shaped
// lines the clone could recite. NOTHING in this file returns prose. Every
// output is a COUNT, a RATIO, or a ≤3-word fragment that was measured. The
// closest this module comes to writing content is `catchphrases`, and that is
// precisely the field `teacher-sheet-spec.md` §4.3 calls "the highest
// recitation risk in the sheet" — which is why the verifier below exists and
// why it rejects rather than truncates.

/** One turn of a diarized transcript. `speaker` is a diarization label, not a
 *  name — the ASR gives "SPEAKER_00", the studio maps it later. */
export interface TranscriptTurn {
  speaker: string;
  text: string;
}

/** A counted token or fragment. The shape every distribution below returns,
 *  so a caller renders one table rather than five. */
export interface CountedFragment {
  /** the fragment exactly as counted — lowercased, whitespace-collapsed */
  fragment: string;
  /** how many times it occurred in the measured turns */
  count: number;
  /** occurrences per 1000 measured tokens, rounded to 2dp — the comparable
   *  number. A raw count off a 10-hour corpus and a raw count off a 40-minute
   *  one are not the same measurement and must never be compared as if. */
  per1k: number;
}

export interface CodeSwitchSignal {
  /** teacher tokens measured */
  tokens: number;
  /** tokens matching the Hindi marker list */
  hindiMarkerTokens: number;
  /** hindiMarkerTokens / tokens, 3dp — comparable to relstate's cs_ratio in
   *  KIND but not in VALUE: relstate measures the fraction of ROWS carrying at
   *  least one marker, this measures the fraction of TOKENS. Both are
   *  reported, and they are named differently on purpose. */
  tokenRatio: number;
  /** turns carrying at least one marker */
  turnsWithMarker: number;
  /** turnsWithMarker / turns, 3dp — this one IS relstate's shape. */
  turnRatio: number;
}

export interface TranscriptStats {
  /** which speaker label was measured, and how it was chosen. Named in the
   *  output rather than assumed, because "the teacher is the speaker who
   *  talks most" is a heuristic and a heuristic that hides is a bug. */
  speaker: { label: string; chosenBy: "given" | "most-tokens"; turns: number };
  /** total turns in the transcript, all speakers */
  totalTurns: number;
  /** tokens in the measured speaker's turns */
  tokens: number;
  codeSwitch: CodeSwitchSignal;
  /** filler distribution against FILLER_LEXICON, descending by count. Only
   *  fillers that actually occurred appear — a zero row is not a measurement. */
  fillers: readonly CountedFragment[];
  /** laughter tokens (`haha`, `heh`…), descending by count */
  laughter: readonly CountedFragment[];
  /** stretched tokens (`haaan`, `arreee`) — the elongation signal, descending */
  stretch: readonly CountedFragment[];
  /** candidate catchphrases: 1–3-word n-grams over the measured speaker's
   *  turns, function words trimmed from both ends, at or above
   *  `minCatchphraseCount`. CANDIDATES — not verbalisms. A candidate becomes a
   *  verbalism only through `verifyPhraseBank` against a HELD-OUT half. */
  catchphrases: readonly CountedFragment[];
}

export interface TranscriptStatsOptions {
  /** the speaker label to measure. Omit and the most-talkative one is chosen. */
  teacherSpeaker?: string;
  /** frequency floor for a catchphrase CANDIDATE. Deliberately lower than the
   *  publish rule's 5: this is the mining stage, the gate is `verifyPhraseBank`,
   *  and a miner that pre-applies the gate's threshold to its own half of the
   *  corpus has quietly turned a held-out check into an in-sample one. */
  minCatchphraseCount?: number;
}

// ── lexicons, authored as DATA ────────────────────────────────────────────

/**
 * VERBATIM PORT of `src/engine/relstate.ts:774-780` (and of the second copy at
 * `api/consolidate.js:1196`, which names the same source). Kept identical
 * token-for-token so a diff between the three is a one-line diff rather than a
 * judgement call about whether two lists mean the same thing.
 *
 * It is a MARKER list, not a vocabulary: it is short, high-frequency and
 * romanised, and it answers "was there Hindi in this span", never "how much
 * Hindi". That distinction is why the ratios above are named `tokenRatio` and
 * `turnRatio` rather than "hindi percentage" — a 70/30 English/Hindi lecture
 * does not produce a 0.30 marker ratio, and a sheet that rendered one as the
 * other would state a measured-looking number that was never measured.
 */
export const HINDI_MARKER_WORDS: readonly string[] = [
  "hai", "hain", "tha", "thi", "the", "kya", "kyun", "kyu", "nahi", "nhi",
  "haan", "haa", "mera", "meri", "mere", "tera", "teri", "tere", "tum",
  "tumhara", "tumhari", "aap", "aapka", "hum", "humara", "yaar", "bhai",
  "kar", "karo", "karna", "raha", "rahi", "rahe", "gaya", "gayi", "gaye",
  "acha", "accha", "theek", "matlab", "bas", "abhi", "kal", "aaj",
];

/**
 * The Hinglish filler lexicon, authored here as data because
 * `ingestion-research.md` §4 found no published one: "No papers or products
 * found that specifically address extracting filler-word distributions
 * (statistical/computational, not LLM-vibes) from a transcript as a distinct
 * pipeline stage." Its examples ("matlab", "toh", "basically", "like",
 * "achha") are the seed; the rest are the classroom-hesitation forms
 * `teacher-sheet-spec.md` row 15 asks for ("the real ones: board-work
 * hesitations").
 *
 * Multi-word entries are matched as phrases, which is why this is a list of
 * strings and not a Set of tokens — "you know" and "okay so" are single
 * fillers and counting their halves separately would report two signals where
 * there is one.
 *
 * NOT a stopword list. `dekho` is a filler AND, in the demo teacher's sheet,
 * a real `boardVerbalism`. Excluding fillers from catchphrase mining would
 * delete the single most reliable extraction in the table, so the two lexicons
 * are independent by design.
 */
export const FILLER_LEXICON: readonly string[] = [
  // Hindi/Hinglish discourse fillers
  "matlab", "toh", "achha", "acha", "arre", "arey", "dekho", "dekhiye",
  "socho", "samjhe", "yaani", "bas", "chalo", "haan toh", "theek hai",
  "ek minute", "ek second", "ab dekho",
  // English fillers that survive code-switching intact
  "basically", "actually", "you know", "i mean", "okay so", "so basically",
  "right", "essentially", "obviously",
  // hesitation vocalizations as ASR usually renders them
  "hmm", "umm", "um", "uh", "err", "er", "ah",
];

/**
 * Laughter as it is WRITTEN by an ASR. `*laughs*` is deliberately absent: the
 * sheet's own validation bans a labelled laugh (`teacher-sheet-spec.md` row
 * 11, "token list + ban clause; no `*laughs*`"), so counting one would feed a
 * field that must reject it.
 */
export const LAUGHTER_TOKENS: readonly string[] = [
  "haha", "hahaha", "hahahaha", "heh", "hehe", "hehehe", "hah", "ha ha",
];

/**
 * Function words trimmed from the ENDS of an n-gram before it is counted. A
 * phrase that starts or ends on a connective is a fragment of a SENTENCE
 * rather than a fragment anyone repeats.
 *
 * ── what is deliberately NOT in here, and why it matters ──────────────────
 * The copula (`hai`, `hain`) and the tag particles (`na`, `bhi`) are absent on
 * purpose, and the absence is load-bearing rather than an oversight. This
 * list's whole job is to make catchphrase candidates good, and the catchphrases
 * this product mines are Hinglish: "theek hai", "ho gaya", "samajh aaya",
 * "theek hai na". Every one of those ENDS on the copula or a tag — that is what
 * makes it a Hinglish fragment rather than an English one — so a stopword list
 * carrying `hai` deletes the field it was built to fill. The demo teacher's own
 * `boardVerbalisms` contains "theek hai", which is how this was caught.
 *
 * So: English function words, and the Hindi POSTPOSITIONS (`ke`, `ka`, `ki`,
 * `ko`, `se`, `mein`, `par`), which genuinely cannot end a repeated fragment.
 * Nothing else. A large stopword list silently deletes the code-switched half
 * of every phrase.
 */
export const EDGE_STOPWORDS: ReadonlySet<string> = new Set([
  "the", "a", "an", "and", "or", "but", "of", "to", "in", "on", "at", "is",
  "are", "was", "were", "be", "this", "that", "it", "we", "you", "i", "will",
  "can", "if", "as", "for", "with", "from", "by", "then", "so", "aur", "ke",
  "ka", "ki", "ko", "se", "me", "mein", "par", "hi", "ye", "yeh", "wo",
  "woh", "jo",
]);

/**
 * Grammatical words that are never a catchphrase ON THEIR OWN, though they are
 * exactly what a real catchphrase ends on. `EDGE_STOPWORDS` plus the copula,
 * the tense auxiliaries and the tag particles.
 *
 * The two lists exist because the same word plays two roles. "theek hai" is a
 * fragment and "hai" is not, so `hai` must be legal at the END of a bigram and
 * illegal as a unigram — one list cannot say both, and collapsing them gives
 * you either a candidate list led by the copula (25 occurrences, top of the
 * table, meaningless) or no Hinglish bigrams at all.
 */
export const BARE_STOPWORDS: ReadonlySet<string> = new Set([
  ...EDGE_STOPWORDS,
  "hai", "hain", "tha", "thi", "na", "bhi", "kar", "ho", "hota", "hoti",
  "raha", "rahi", "rahe", "koi", "kuch", "phir", "abhi", "jab", "tab",
]);

// ── the publish rule's two numbers, in one place ──────────────────────────

/** `teacher-sheet-spec.md` §4.3: "each item ≤3 words". Mirrors
 *  `fromSheet.ts`'s VERBALISM_MAX_WORDS — the SHAPE half of the rule, which
 *  that file already enforces without a corpus. Restated here because this
 *  module enforces the OTHER half and a verifier that checked only its own
 *  half would report a pass on a fragment the sheet validator rejects. */
export const PHRASE_BANK_MAX_WORDS = 3;

/** "must appear ≥5 times in the held-out half of the teacher's own transcript
 *  corpus (proves it is habitual slang, not a memorable line)". */
export const PHRASE_BANK_MIN_OCCURRENCES = 5;

/** "any item appearing ≤2 times is a LINE, not a verbalism → reject". Both
 *  bands fail; they are reported with DIFFERENT codes because they are
 *  different facts about the fragment, and a studio telling a teacher "this is
 *  a line you said once, not something you say" is saying something more
 *  useful than "below threshold". */
export const PHRASE_BANK_LINE_CEILING = 2;

// ── tokenization ──────────────────────────────────────────────────────────

/** Lowercase, strip everything that is not a letter/digit/apostrophe, collapse
 *  whitespace. Deterministic and locale-free: `toLowerCase()` rather than
 *  `toLocaleLowerCase()`, because a statistic that changes with the server's
 *  locale is a statistic that cannot be compared across two runs. Devanagari
 *  survives (`\p{L}` is Unicode-aware) — a mixed-script transcript is the
 *  normal case for this product, not the exception. */
// `\p{M}` (combining marks) is kept, and that is not a detail. Devanagari
// vowel signs — the matras in मेरा, नहीं, क्या — are Mark_Nonspacing, not
// Letter. Stripping them does not merely lose accents: it shatters every word
// into its bare consonants and inserts a space where each mark was, so a real
// Sarvam transcript of a real teacher measured as 74 "tokens" of single
// glyphs, code-switch ratio 0.000, zero fillers, and a phrase-bank candidate
// list of "म" ×10. Measured 2026-08-26 on the first live Hinglish transcript.
// Every abugida this product targets has the same shape.
export function normalizeText(text: string): string {
  return String(text ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}'\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokenize(text: string): string[] {
  const normalized = normalizeText(text);
  return normalized ? normalized.split(" ") : [];
}

/** Occurrences of a (possibly multi-word) fragment in normalized text, counted
 *  on WORD BOUNDARIES and without overlap. Written as a token-window scan
 *  rather than a RegExp so a fragment containing regex metacharacters cannot
 *  change the meaning of the count — the fragments here come from a jsonb
 *  column a teacher edits. */
export function countFragment(tokens: readonly string[], fragment: string): number {
  const needle = tokenize(fragment);
  if (!needle.length || needle.length > tokens.length) return 0;
  let count = 0;
  for (let i = 0; i + needle.length <= tokens.length; i++) {
    let hit = true;
    for (let j = 0; j < needle.length; j++) {
      if (tokens[i + j] !== needle[j]) { hit = false; break; }
    }
    if (hit) { count++; i += needle.length - 1; }
  }
  return count;
}

const round = (value: number, places: number) => {
  const f = 10 ** places;
  return Math.round(value * f) / f;
};

/** Descending by count, then ASCENDING by fragment. The tiebreak is not
 *  cosmetic: without it two fragments with equal counts come back in hash
 *  order, the determinism assertion in `evals/ingest.mjs` fails intermittently,
 *  and an intermittent gate is worse than none. */
const byCountThenFragment = (a: CountedFragment, b: CountedFragment) =>
  b.count - a.count || (a.fragment < b.fragment ? -1 : a.fragment > b.fragment ? 1 : 0);

const counted = (fragment: string, count: number, tokens: number): CountedFragment => ({
  fragment,
  count,
  per1k: tokens ? round((count / tokens) * 1000, 2) : 0,
});

/** A token stretched by elongation: any character repeated three or more times
 *  in a row (`haaan`, `arreee`, `nooo`). Three rather than two because English
 *  and romanised Hindi both carry real doubles ("bill", "acchha") and a
 *  threshold of two would report the vocabulary as the signal. */
const STRETCH_RE = /(.)\1{2,}/u;

/**
 * Drop an n-gram that is fully ABSORBED by a longer one — a shorter window
 * that never occurs outside some longer window containing it.
 *
 * Not a frequency heuristic and not a tuning knob. If "socho zara" occurs 8
 * times and "socho" occurs 8 times, then "socho" never occurred alone: it is a
 * PREFIX of the fragment, not a fragment. Offering both to a teacher as
 * separate catchphrase candidates asks them to confirm the same habit twice
 * and, worse, invites the truncated half into `boardVerbalisms` — which is the
 * field that ends up in a prompt, said aloud, by a clone of them.
 *
 * The condition is strict absorption (`count(longer) >= count(shorter)`), so a
 * word that also appears on its own survives: "ab" occurring 8 times with "ab
 * batao" at 5 means three bare "ab"s, and both are real.
 */
function maximalOnly(counts: ReadonlyMap<string, number>): Map<string, number> {
  const out = new Map<string, number>();
  const entries = [...counts.entries()];
  for (const [fragment, count] of entries) {
    const words = fragment.split(" ");
    const absorbed = entries.some(([other, otherCount]) => {
      if (other === fragment || otherCount < count) return false;
      const otherWords = other.split(" ");
      if (otherWords.length <= words.length) return false;
      for (let i = 0; i + words.length <= otherWords.length; i++) {
        let hit = true;
        for (let j = 0; j < words.length; j++) {
          if (otherWords[i + j] !== words[j]) { hit = false; break; }
        }
        if (hit) return true;
      }
      return false;
    });
    if (!absorbed) out.set(fragment, count);
  }
  return out;
}

// ── the measurement ───────────────────────────────────────────────────────

function chooseSpeaker(
  turns: readonly TranscriptTurn[],
  given: string | undefined,
): { label: string; chosenBy: "given" | "most-tokens" } {
  if (given) return { label: given, chosenBy: "given" };
  const totals = new Map<string, number>();
  for (const turn of turns) {
    const label = String(turn?.speaker ?? "");
    totals.set(label, (totals.get(label) ?? 0) + tokenize(turn?.text ?? "").length);
  }
  let best = "";
  let bestTokens = -1;
  // Sorted keys, not insertion order: the most-talkative speaker must be the
  // same speaker when the same transcript arrives with its turns reordered.
  for (const label of [...totals.keys()].sort()) {
    const value = totals.get(label) ?? 0;
    if (value > bestTokens) { best = label; bestTokens = value; }
  }
  return { label: best, chosenBy: "most-tokens" };
}

/**
 * The measurable ING signals off one transcript. Pure, deterministic, and
 * total: an empty transcript returns zeroes rather than throwing, because the
 * caller of this is a studio screen and a screen that 500s on a teacher's
 * first upload is a worse answer than a screen showing "nothing measurable
 * yet".
 */
export function transcriptStats(
  turns: readonly TranscriptTurn[],
  options: TranscriptStatsOptions = {},
): TranscriptStats {
  const all = Array.isArray(turns) ? turns : [];
  const speaker = chooseSpeaker(all, options.teacherSpeaker);
  const mine = all.filter((t) => String(t?.speaker ?? "") === speaker.label);
  const perTurnTokens = mine.map((t) => tokenize(t?.text ?? ""));
  const tokens = perTurnTokens.flat();
  const total = tokens.length;

  // ── code-switch ──
  const markers = new Set(HINDI_MARKER_WORDS);
  let hindiMarkerTokens = 0;
  let turnsWithMarker = 0;
  for (const turnTokens of perTurnTokens) {
    let hitsHere = 0;
    for (const token of turnTokens) if (markers.has(token)) hitsHere++;
    hindiMarkerTokens += hitsHere;
    if (hitsHere) turnsWithMarker++;
  }

  // ── fillers: phrase-aware, so "you know" is one signal and not two ──
  const fillers: CountedFragment[] = [];
  for (const filler of FILLER_LEXICON) {
    const count = countFragment(tokens, filler);
    if (count > 0) fillers.push(counted(filler, count, total));
  }

  // ── laughter and stretch ──
  const laughter: CountedFragment[] = [];
  for (const token of LAUGHTER_TOKENS) {
    const count = countFragment(tokens, token);
    if (count > 0) laughter.push(counted(token, count, total));
  }
  const stretchCounts = new Map<string, number>();
  for (const token of tokens) {
    if (STRETCH_RE.test(token)) stretchCounts.set(token, (stretchCounts.get(token) ?? 0) + 1);
  }
  const stretch = [...stretchCounts.entries()].map(([f, c]) => counted(f, c, total));

  // ── catchphrase candidates: 1–3-gram frequency, edges trimmed ──
  const minCount = Math.max(1, options.minCatchphraseCount ?? 3);
  const ngramCounts = new Map<string, number>();
  for (const turnTokens of perTurnTokens) {
    for (let n = 1; n <= PHRASE_BANK_MAX_WORDS; n++) {
      for (let i = 0; i + n <= turnTokens.length; i++) {
        const window = turnTokens.slice(i, i + n);
        // Unigrams answer to the stricter list; multi-word windows are trimmed
        // at the ENDS only, so interior function words survive.
        if (n === 1) {
          if (BARE_STOPWORDS.has(window[0])) continue;
        } else if (EDGE_STOPWORDS.has(window[0]) || EDGE_STOPWORDS.has(window[window.length - 1])) {
          continue;
        }
        const key = window.join(" ");
        ngramCounts.set(key, (ngramCounts.get(key) ?? 0) + 1);
      }
    }
  }
  const catchphrases: CountedFragment[] = [];
  for (const [fragment, count] of maximalOnly(ngramCounts)) {
    if (count >= minCount) catchphrases.push(counted(fragment, count, total));
  }

  return {
    speaker: { ...speaker, turns: mine.length },
    totalTurns: all.length,
    tokens: total,
    codeSwitch: {
      tokens: total,
      hindiMarkerTokens,
      tokenRatio: total ? round(hindiMarkerTokens / total, 3) : 0,
      turnsWithMarker,
      turnRatio: mine.length ? round(turnsWithMarker / mine.length, 3) : 0,
    },
    fillers: fillers.sort(byCountThenFragment),
    laughter: laughter.sort(byCountThenFragment),
    stretch: stretch.sort(byCountThenFragment),
    catchphrases: catchphrases.sort(byCountThenFragment),
  };
}

// ─────────────────────────────────────────────────────────────────────────
// The phrase-bank verifier — the half `fromSheet.ts` deferred to WS-F
// ─────────────────────────────────────────────────────────────────────────
//
// `fromSheet.ts`'s validator says it in full: the ≥5-occurrences rule "needs a
// transcript, this function takes a sheet, and a corpus-free approximation of
// it would be a check that passes against a corpus it cannot see — the exact
// shape `dead-writers` warns about. It belongs to WS-F's ingestion pipeline,
// where the corpus lives." This is that function, and the corpus is its
// argument rather than its assumption.
//
// ── the one rule that must not be softened ────────────────────────────────
// A fragment with no evidence is UNVERIFIED. It is not "provisionally fine",
// it is not "assumed habitual", and the return type has no boolean that could
// be read as either. `verified: false` plus a reason is the answer, and the
// caller decides what a missing corpus means for ITS gate — which is the
// distinction `silent-truncation` is about: absent and NAMED, never faked.

export type PhraseBankCode =
  /** >3 words. The shape half — `fromSheet.ts` catches this too, and both
   *  should, because they run at different moments and one of them is the only
   *  one running when the other is skipped. */
  | "phrase-bank-too-long"
  /** ≤2 occurrences in the held-out half: this is a LINE, not a verbalism */
  | "phrase-bank-is-a-line"
  /** 3–4 occurrences: real, but not yet habitual at the spec's threshold */
  | "phrase-bank-below-threshold";

export interface PhraseBankFinding {
  fragment: string;
  words: number;
  /** occurrences in the held-out transcript, on word boundaries */
  occurrences: number;
  ok: boolean;
  /** absent when ok */
  code?: PhraseBankCode;
}

export interface PhraseBankVerification {
  /** true ONLY when a held-out corpus was supplied AND every fragment cleared
   *  both halves of the rule. Never true because there was nothing to check. */
  verified: boolean;
  /** why verification did not happen. Present iff no usable held-out corpus
   *  was supplied — the "unverified: no transcript evidence" marker. */
  unverifiedReason?: "no-transcript-evidence";
  /** tokens of held-out evidence the verdict rests on. 0 when unverified. */
  heldOutTokens: number;
  findings: readonly PhraseBankFinding[];
  /** the failing findings, for a caller that only wants the errors */
  failures: readonly PhraseBankFinding[];
}

/**
 * `teacher-sheet-spec.md` §4.3, in full and against a real corpus.
 *
 * @param fragments the candidate verbalisms (`boardVerbalisms`, and the
 *   `exSlangRepeat` tokens once unwrapped from their parenthesised list).
 * @param heldOutTranscript the HELD-OUT half. Held-out is load-bearing: an
 *   item mined from a corpus will always clear a threshold measured on that
 *   same corpus, so checking in-sample is a check that cannot fail. Pass the
 *   half `splitHeldOut()` did not derive from.
 */
export function verifyPhraseBank(
  fragments: readonly string[],
  heldOutTranscript: readonly TranscriptTurn[] | string | null | undefined,
  options: { teacherSpeaker?: string } = {},
): PhraseBankVerification {
  const items = (Array.isArray(fragments) ? fragments : [])
    .map((f) => String(f ?? "").trim())
    .filter(Boolean);

  const tokens = heldOutTokens(heldOutTranscript, options.teacherSpeaker);

  if (!tokens.length) {
    // No corpus. Every fragment is reported with its SHAPE verdict (which needs
    // no corpus) and an occurrence count of 0 that is explicitly not a
    // measurement — `verified` is false and the reason names why.
    const findings = items.map<PhraseBankFinding>((fragment) => {
      const words = tokenize(fragment).length;
      return words > PHRASE_BANK_MAX_WORDS
        ? { fragment, words, occurrences: 0, ok: false, code: "phrase-bank-too-long" }
        : { fragment, words, occurrences: 0, ok: false };
    });
    return {
      verified: false,
      unverifiedReason: "no-transcript-evidence",
      heldOutTokens: 0,
      findings,
      failures: findings.filter((f) => f.code),
    };
  }

  const findings = items.map<PhraseBankFinding>((fragment) => {
    const words = tokenize(fragment).length;
    const occurrences = countFragment(tokens, fragment);
    if (words > PHRASE_BANK_MAX_WORDS) {
      return { fragment, words, occurrences, ok: false, code: "phrase-bank-too-long" };
    }
    if (occurrences <= PHRASE_BANK_LINE_CEILING) {
      return { fragment, words, occurrences, ok: false, code: "phrase-bank-is-a-line" };
    }
    if (occurrences < PHRASE_BANK_MIN_OCCURRENCES) {
      return { fragment, words, occurrences, ok: false, code: "phrase-bank-below-threshold" };
    }
    return { fragment, words, occurrences, ok: true };
  });

  return {
    verified: findings.every((f) => f.ok),
    heldOutTokens: tokens.length,
    findings,
    failures: findings.filter((f) => !f.ok),
  };
}

function heldOutTokens(
  heldOut: readonly TranscriptTurn[] | string | null | undefined,
  teacherSpeaker?: string,
): string[] {
  if (typeof heldOut === "string") return tokenize(heldOut);
  if (!Array.isArray(heldOut) || !heldOut.length) return [];
  const speaker = chooseSpeaker(heldOut, teacherSpeaker);
  return heldOut
    .filter((t) => String(t?.speaker ?? "") === speaker.label)
    .flatMap((t) => tokenize(t?.text ?? ""));
}

/**
 * Split a corpus into the half a draft is DERIVED from and the half it is
 * VERIFIED against (`teacher-sheet-spec.md` §4.6: "every ING field is derived
 * on half the corpus and checked against the other half").
 *
 * Split by turn PARITY rather than by cutting the corpus in two. A lecture is
 * not stationary — the first half is exposition and the second is worked
 * problems — so a contiguous cut measures two different registers and reports
 * their difference as a corpus-heterogeneity failure. Interleaving gives both
 * halves the same mixture, which is what makes a difference between them mean
 * what §4.6 says it means.
 *
 * ── the parity is PER SPEAKER, and that is not a detail ───────────────────
 * A global index parity looks equivalent and is catastrophic on the most
 * ordinary transcript there is: a doubt session alternates teacher, student,
 * teacher, student, so every even index is the teacher and every odd one is
 * the student. The split would hand `derive` the entire teacher and `heldOut`
 * an entire corpus of somebody else's words, every fragment would score zero
 * occurrences, and the verifier would confidently reject a real teacher's real
 * catchphrases with a code that says they are lines he said once. The failure
 * is silent, total, and looks exactly like a working check — so the counter
 * below runs per speaker label and each speaker's own turns alternate between
 * the halves.
 */
export function splitHeldOut(turns: readonly TranscriptTurn[]): {
  derive: readonly TranscriptTurn[];
  heldOut: readonly TranscriptTurn[];
} {
  const all = Array.isArray(turns) ? turns : [];
  const seen = new Map<string, number>();
  const derive: TranscriptTurn[] = [];
  const heldOut: TranscriptTurn[] = [];
  for (const turn of all) {
    const label = String(turn?.speaker ?? "");
    const n = seen.get(label) ?? 0;
    seen.set(label, n + 1);
    (n % 2 === 0 ? derive : heldOut).push(turn);
  }
  return { derive, heldOut };
}
