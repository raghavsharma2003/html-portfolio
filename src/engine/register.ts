// The register read — EmotionOS half two (WS-R153, migration 164). Pure,
// deterministic, LLM-free, no I/O — the same shape moment.ts already proved
// out for T4/T6 (this file's own sibling, read first per the brief).
//
// ── WHAT THIS IS, AND WHAT IT IS NOT ────────────────────────────────────
// `moment.ts` reads WHAT a turn is ABOUT (conflict, celebration, silence...)
// from content keywords. This file reads HOW a turn was DELIVERED — surface
// shape only: length, punctuation, letter-repeats, capitalisation, laughter
// tokens, Hindi/Hinglish marker density — never a content keyword, never a
// claim about what the other person feels. `readRegister` returns one of a
// CLOSED set (rushed, upset, excited, flat, neutral) plus a confidence band,
// and the caller (compiler.ts) renders a hint from it ONLY when confidence
// is "high" — an instruction about how to respond to THIS turn's delivery,
// never a sentence that names an emotion as a fact. "neutral" NEVER renders,
// at any confidence: it is the "nothing distinctive here" answer, restated
// so a future reader does not have to infer it from the render-site gate
// alone (evals/emotionos/run.mjs's own negative control pins this).
//
// PULL-ONLY, restated from moment.ts's own law: every call here reads ONLY
// the current turn (+ its own gap/time-of-day) — never history, never a
// stored label. Nothing this file returns is ever written to a table; the
// brief's own words are "pull-only and never a stored label".
//
// ── WHY NO CONTENT KEYWORDS ──────────────────────────────────────────────
// moment.ts already owns "what happened" from keywords; a second keyword
// table here answering a similar-sounding question would drift from it the
// first time someone edited one and not the other. Register answers a
// DIFFERENT, narrower question — not "are they upset" (a claim this file is
// not allowed to make) but "did they write like someone in a hurry, someone
// clipped and cold, someone with energy, or someone checked out" — and every
// one of those is legible from the shape of the text alone, in any of the
// three languages this product ships, because punctuation, letter-repeats,
// capitalisation and terse endings are not English-specific.
//
// ── THE ONE REAL-WORLD SIGNAL WORTH NAMING: THE "PERIOD TEXT" ────────────
// A short reply that ends on a bare terminal period ("Fine.", "Okay.", "thik
// hai.") reads as clipped/cold in ordinary texting register — the period
// does work a full stop never did in a chat medium, where the DEFAULT is no
// terminal punctuation at all. That asymmetry (short + a lone final period
// = "upset"; short + no ending punctuation at all = "flat", low energy
// rather than cold) is what separates the two lowest-energy buckets below;
// without it "upset" would have no surface feature to stand on at all,
// since this file may not reach for a content keyword to tell the two apart.
export type Register = "rushed" | "upset" | "excited" | "flat" | "neutral";
export type RegisterConfidence = "high" | "low";

export const REGISTERS: readonly Register[] = ["rushed", "upset", "excited", "flat", "neutral"];

export interface RegisterInput {
  /** ms since the OTHER person's own previous turn (never her own reply
   *  latency) — a fast follow-up supports "rushed" the same way moment.ts's
   *  own gap feature supports "silence": a cheap, content-free timing fact
   *  about THIS turn, never a usage metric fed back as personality (inner.ts
   *  G1's boundary does not apply here — this is per-turn routing, nothing
   *  persisted). */
  gapSinceLastMs?: number;
  /** 0-23, local hour this turn arrived. Used only as a soft confidence
   *  nudge for "flat" (late-night terse replies are ordinary, not a weaker
   *  signal), never as a standalone trigger — a person is not "flat" merely
   *  for texting at 2am. */
  timeOfDay?: number;
}

export interface RegisterResult {
  register: Register;
  confidence: RegisterConfidence;
}

/** Verbatim port of relstate.ts's `HINDI_MARKER_WORDS` (function words only,
 *  the same category culture.ts's COMMON list uses) — the identical list
 *  api/consolidate.js:1192 already ports under the comment "mirrors
 *  relstate.ts's HINDI_MARKER_WORDS", restated here for the SAME reason that
 *  comment gives: this file is pure and standalone (transcriptStats.ts's own
 *  law, quoted at its own top: "it imports NOTHING... not relstate.ts... the
 *  cost of a port is drift; the cost of the import would be a [module] that
 *  cannot run offline"), so a third port is this repo's established shape
 *  for the same problem, not a new one. */
const HINDI_MARKER_WORDS = [
  "hai", "hain", "tha", "thi", "the", "kya", "kyun", "kyu", "nahi", "nhi",
  "haan", "haa", "mera", "meri", "mere", "tera", "teri", "tere", "tum",
  "tumhara", "tumhari", "aap", "aapka", "hum", "humara", "yaar", "bhai",
  "kar", "karo", "karna", "raha", "rahi", "rahe", "gaya", "gayi", "gaye",
  "acha", "accha", "theek", "matlab", "bas", "abhi", "kal", "aaj",
];

/** " lowercase words only, space padded " — the same whole-word convention
 *  moment.ts's own `padT` uses, restated rather than imported: this file
 *  stays as free-standing as moment.ts and transcriptStats.ts already are.
 *  ONE deliberate difference from moment.ts's copy: `\p{M}` (combining
 *  marks) is kept, exactly as `transcriptStats.ts`'s own `normalizeText`
 *  keeps it, and for the identical, measured reason that file's header
 *  states in full — a Devanagari vowel SIGN (a matra: the ा in हाहा, गया)
 *  is Mark_Nonspacing, not Letter, so stripping it does not lose an
 *  accent, it SHATTERS the word into bare consonants. moment.ts's own copy
 *  of this function never needed `\p{M}` because its own keyword tables are
 *  every one of them romanised (`"jhagda"`, `"dar lag raha"`); this file's
 *  own laughter-token table is the first table in this shape that carries a
 *  Devanagari entry at all (`हाहा`), and the eval's own Hindi fixtures are
 *  what caught the gap — see `LAUGHTER_TOKENS`'s own note. */
function padT(s: string): string {
  return (
    " " +
    s
      .toLowerCase()
      .replace(/[^\p{L}\p{M}\p{N}]+/gu, " ")
      .replace(/\s+/g, " ")
      .trim() +
    " "
  );
}

const HINDI_MARKER_PADDED = HINDI_MARKER_WORDS.map((w) => ` ${w} `);

function hasHindiMarker(padded: string): boolean {
  return HINDI_MARKER_PADDED.some((w) => padded.includes(w));
}

/** Verbatim port of `ingest/transcriptStats.ts`'s own `LAUGHTER_TOKENS`
 *  ("laughter as it is WRITTEN by an ASR"), for the identical reason
 *  `HINDI_MARKER_WORDS` above is a port and not an import: that file's own
 *  header states its purity law in as many words ("it imports NOTHING"),
 *  and importing FROM it here would make this file's own purity depend on
 *  a sibling module never changing that law later. Extended with the
 *  Devanagari-script renderings of the same laughter (`हाहा`/`हेहे`), which
 *  the ported list never needed for its own job (catchphrase mining over a
 *  transliterated transcript) but this file does — the eval's own Hindi
 *  fixtures are the reason this gap was caught rather than shipped quiet.
 */
const LAUGHTER_TOKENS = [
  "haha", "hahaha", "hahahaha", "heh", "hehe", "hehehe", "hah", "ha ha",
  "हाहा", "हाहाहा", "हेहे",
];

function hasLaughterToken(padded: string): boolean {
  return LAUGHTER_TOKENS.some((t) => padded.includes(` ${t} `));
}

/** A run of the SAME letter three or more times in a row — "sooo", "yessss",
 *  "nooo", "haaan". Unicode-aware (`\p{L}`) so a Devanagari vowel stretch
 *  counts identically to a Latin one; this is the one feature this file
 *  shares in spirit with moment.ts's own digit-free/script-agnostic
 *  discipline. */
const REPEAT_RUN_RE = /(\p{L})\1{2,}/u;

/** Danda "।" is Devanagari's own sentence-final mark, doing the same job a
 *  Latin full stop does — treating only "." as terminal would make the
 *  "period text" signal (below) invisible for a third of this product's own
 *  languages, which is exactly the kind of asymmetry `culture.ts` and
 *  `transcriptStats.ts` both warn about for Hindi/Hinglish text. */
const TERMINAL_PERIOD_RE = /[.।]$/;
const ELLIPSIS_OR_MULTI_STOP_RE = /(\.\s*){2,}$|…$/;

interface Features {
  charLen: number;
  wordCount: number;
  exclaimCount: number;
  questionCount: number;
  hasRepeatRun: boolean;
  /** A whole WORD of two-plus letters, all capitals — "FINE", "WHAT", "STOP".
   *  Deliberately NOT a caps-to-letters ratio: a ratio penalises ordinary
   *  sentence-initial capitalisation ("Fine." scores 0.25, "K." scores 1.0
   *  on a single letter), which would make this feature fire on completely
   *  normal English and never on Hindi/Hinglish at all (Devanagari has no
   *  case, so a ratio computed over it is always zero regardless of tone).
   *  A whole shouted WORD is the actual "yelling" signal in every one of
   *  this product's three languages: absent from ordinary capitalisation,
   *  present in "STOP", "WHAT", "NO" the same way in all of them. */
  hasShoutWord: boolean;
  hasLaughter: boolean;
  hasHindi: boolean;
  endsWithLoneSinglePeriod: boolean;
  endsWithNoTerminalPunct: boolean;
}

function featuresOf(text: string): Features {
  const trimmed = String(text ?? "").trim();
  const padded = padT(trimmed);
  const words = trimmed.split(/\s+/).filter(Boolean);
  const exclaimCount = (trimmed.match(/!/g) || []).length;
  const questionCount = (trimmed.match(/\?/g) || []).length;
  const endsWithLoneSinglePeriod =
    TERMINAL_PERIOD_RE.test(trimmed) && !ELLIPSIS_OR_MULTI_STOP_RE.test(trimmed);
  const endsWithNoTerminalPunct = trimmed.length > 0 && !/[.!?।…]$/.test(trimmed);
  const hasShoutWord = words.some((w) => {
    const letters = w.match(/\p{L}/gu) || [];
    return letters.length >= 2 && letters.every((ch) => ch === ch.toUpperCase() && ch !== ch.toLowerCase());
  });
  return {
    charLen: trimmed.length,
    wordCount: words.length,
    exclaimCount,
    questionCount,
    hasRepeatRun: REPEAT_RUN_RE.test(trimmed),
    hasShoutWord,
    hasLaughter: hasLaughterToken(padded),
    hasHindi: hasHindiMarker(padded),
    endsWithLoneSinglePeriod,
    endsWithNoTerminalPunct,
  };
}

/** Replying inside this window of the OTHER side's own previous turn is
 *  unusually fast for a person composing a fresh reply — support evidence
 *  for "rushed", never the sole trigger for it (see the "rushed" case
 *  below, which also requires the run-on/no-punctuation shape). */
const RUSHED_GAP_MS = 4_000;

/** Local hours where a short, flat-shaped reply is ordinary rather than a
 *  weaker signal of it (used only to raise "flat" from low to high
 *  confidence at the margin — never to trigger it on its own). */
function isLateNight(hour: number | undefined): boolean {
  return typeof hour === "number" && (hour >= 23 || hour < 5);
}

/**
 * T-shaped like moment.ts's `detectMomentShape`: a priority-ordered cascade
 * over authored surface features, first match wins, closed output set.
 * Reads ONLY `userText` (+ the two cheap timing features passed alongside
 * it) — never history, never a stored label, per the pull-only law restated
 * at this file's own top.
 */
export function readRegister(userText: string, input: RegisterInput = {}): RegisterResult {
  const f = featuresOf(userText);
  const gapMs = Number(input.gapSinceLastMs ?? -1);

  // No turn at all (or effectively none) reads exactly like moment.ts's own
  // "no turn, no moment" guard (compiler.ts's WS-CONTINUITY note) — a call
  // pickup or a directive turn has no user turn to read a register FROM.
  if (f.charLen === 0) return { register: "neutral", confidence: "low" };

  // ── EXCITED — energy markers stack: multiple exclamations, a letter-repeat
  // WITH an exclamation, or a laughter token WITH an exclamation. Any two of
  // these together is unambiguous; exactly one alone is a weaker signal.
  const excitedStrong =
    f.exclaimCount >= 2 ||
    (f.hasRepeatRun && f.exclaimCount >= 1) ||
    (f.hasLaughter && f.exclaimCount >= 1) ||
    (f.hasRepeatRun && f.hasLaughter);
  if (excitedStrong) return { register: "excited", confidence: "high" };
  const excitedWeak = f.exclaimCount === 1 || f.hasLaughter || (f.hasRepeatRun && f.hasShoutWord);
  if (excitedWeak) return { register: "excited", confidence: "low" };

  // ── RUSHED — a long run-on with NO terminal punctuation at all (typed and
  // sent without stopping to punctuate), or a very fast, short, unpunctuated
  // follow-up right on the heels of the last turn. Ordinary Hinglish chat
  // routinely drops terminal punctuation regardless of pace (the same fact
  // `transcriptStats.ts` names for why a Devanagari transcript needs its own
  // handling throughout this product), so the SAME shape is weaker evidence
  // once a Hindi/Hinglish marker is present — `hasHindi`'s one, named use in
  // this cascade, demoting confidence rather than the category itself.
  const rushedLongRunOn =
    f.wordCount >= 6 && f.exclaimCount === 0 && f.questionCount === 0 &&
    f.endsWithNoTerminalPunct && !f.hasShoutWord;
  if (rushedLongRunOn) return { register: "rushed", confidence: f.hasHindi ? "low" : "high" };
  const rushedFastShort =
    gapMs >= 0 && gapMs < RUSHED_GAP_MS && f.wordCount <= 4 && f.endsWithNoTerminalPunct &&
    f.exclaimCount === 0 && !f.hasLaughter;
  if (rushedFastShort) return { register: "rushed", confidence: "low" };

  // ── UPSET — the "period text": short, terse, ends on a LONE terminal
  // period/danda, nothing else going on (no question, no laughter, no caps,
  // no repeat) — this file's header names why this is the one keyword-free
  // surface feature standing in for "clipped and cold".
  const upsetPeriodText =
    f.wordCount <= 4 && f.endsWithLoneSinglePeriod && f.exclaimCount === 0 &&
    f.questionCount === 0 && !f.hasLaughter && !f.hasRepeatRun && !f.hasShoutWord;
  if (upsetPeriodText) return { register: "upset", confidence: "high" };

  // ── FLAT — short, nothing going on, and no terminal punctuation at all
  // (the low-energy counterpart to the period text above: "yeah", "k",
  // "thik hai", "hmm" — checked out, not cold). A very short one ("k", "ok")
  // is unambiguous; a slightly longer short reply is flat-shaped but also
  // ordinary daytime brevity, so it only reaches "high" confidence at the
  // hour where a low-energy reply is the expected shape, never on its own —
  // `timeOfDay`'s one, named, narrow use in this file.
  const flatBase =
    f.wordCount <= 3 && f.charLen <= 12 && f.endsWithNoTerminalPunct &&
    f.exclaimCount === 0 && f.questionCount === 0 && !f.hasLaughter && !f.hasRepeatRun && !f.hasShoutWord;
  if (flatBase && f.charLen <= 8) return { register: "flat", confidence: "high" };
  if (flatBase) return { register: "flat", confidence: isLateNight(input.timeOfDay) ? "high" : "low" };

  return { register: "neutral", confidence: "low" };
}

/** One line, telegraphic, an instruction about DELIVERY never a claim about
 *  a feeling — `recited-prompt`'s own law applied to a brand-new render
 *  site: these are authored SHAPES, never sentences the model would have
 *  any reason to recite back, and every one of them is content-free of the
 *  turn's own words (no interpolation), so there is nothing here for a
 *  phrase-bank echo to grab onto. Exported so the eval can assert every
 *  member of `REGISTERS` (bar "neutral", which never renders) maps to
 *  exactly one hint. */
export const REGISTER_HINTS: Readonly<Record<Exclude<Register, "neutral">, string>> = {
  rushed: "they wrote fast and short; keep it short",
  upset: "their reply was short and clipped; do not push, let them lead",
  excited: "they wrote with energy; match it, do not flatten it",
  flat: "their reply was short and low energy; do not perform excitement back",
};

/**
 * The render gate, stated once so compiler.ts (and the eval) apply the
 * identical rule: only "high" confidence renders, and "neutral" never does
 * regardless of confidence — the negative control this file's own header
 * names.
 */
export function renderRegisterHint(result: RegisterResult | null | undefined): string {
  if (!result || result.register === "neutral" || result.confidence !== "high") return "";
  return REGISTER_HINTS[result.register];
}
