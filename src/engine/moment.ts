// The moment/deixis gates — SPEC §6.3, §0.4 graft. WS-RELSTATE, M4.
// Ownership (SPEC §13): this file belongs to WS-RELSTATE exclusively.
//
// Two deterministic, LLM-free classifiers, mirroring the one proven
// portability shape in this repo (inner.ts's TASTE table: authored keys,
// whole-word matching, pure function, no network, no state):
//
//   1. `detectMomentShape` — the T4 gate. A cheap feature classifier that
//      picks ONE of eight named shapes (or "none") from the user's turn, so
//      `dyadic.active` can select ≤3 prompt_eligible patterns whose `moment`
//      matches. A miss here drops one pattern note — SPEC's own words for
//      the blast-radius argument this file records below, quoted rather
//      than paraphrased so the ban it distinguishes itself from stays
//      legible next to it.
//   2. `hasDeixis` — the T6 gate. Fires ONLY on shared-reference deixis in
//      THIS turn (explicit callback language), never on topic similarity or
//      recency. This is the entire mechanism behind "0 unprompted raises":
//      WE content may still render (§6.3 — "Absent a pull signal, WE ranks
//      like everything else under STANDING-BACKGROUND labels"), but the
//      RANK BOOST and the "they're recalling this now" framing are gated
//      behind this function returning true, and nothing else.
//
// PULL-ONLY DISCIPLINE (owner's standing gate, restated as code law): every
// exported function in this file answers "does THIS turn ask for it" — none
// of them may be called speculatively to decide what to volunteer. A caller
// that runs `hasDeixis` against anything other than the live user turn has
// broken the guarantee this file exists to provide.

// ─────────────────────────────────────────────────────────────────────────
// Recorded argument — SPEC §6.3, quoted at the point of use, not just here,
// so a future reader auditing T4's call site sees why a misclassification
// is tolerable here specifically (this is NOT a general license; beat-
// routing misclassification is still rejected, unrelated, and unchanged).
// ─────────────────────────────────────────────────────────────────────────
export const BLAST_RADIUS_ARGUMENT =
  "moment-shape gate (T4): a misclassification costs one absent pattern " +
  "note — a dropped garnish, not a wrong brain. Contrast with the REJECTED " +
  "beat-routing proposal, where a misclassification lands reasoning effort " +
  "on a crisis turn — that ban stands, unrelated to this gate, and this " +
  "gate's low blast radius is the reason it was accepted where beat-routing " +
  "was not.";

export type MomentShape =
  | "conflict"
  | "vulnerable"
  | "silence"
  | "teasing"
  | "stress"
  | "planning"
  | "celebration"
  | "boredom"
  | "none";

export const MOMENT_SHAPES: readonly MomentShape[] = [
  "conflict",
  "vulnerable",
  "silence",
  "teasing",
  "stress",
  "planning",
  "celebration",
  "boredom",
];

/** " lowercase words only, space padded " — matches inner.ts/culture.ts's
 *  own padding convention so whole-word matching behaves identically across
 *  the repo's three keyword classifiers. */
const padT = (s: string) =>
  " " +
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim() +
  " ";

/** Authored, reviewed keys — never distilled at runtime (same rationale as
 *  inner.ts's TASTE table: authored+deterministic is the one measured
 *  portability win in this repo). Each entry padded once, at module load. */
const MOMENT_KEYS: Record<Exclude<MomentShape, "none">, string[]> = {
  conflict: [
    "fight", "fought", "ladai", "jhagda", "jhagra", "argument", "argue",
    "gussa", "naraz", "naraaz", "angry", "upset with you", "upset with me",
    "you never", "you always", "not fair", "galti teri", "galti meri",
  ],
  vulnerable: [
    "scared", "dar lag raha", "dar raha", "akela", "akeli", "lonely",
    "cry", "roya", "royi", "rona aa raha", "ro rahi", "ro raha",
    "insecure", "anxious", "anxiety", "overthink", "overthinking",
    "hurt", "dukh", "dard", "vulnerable", "breakdown",
  ],
  silence: [
    "nothing to say", "kuch nahi", "chup", "quiet", "silent", "no words",
    "khaali khaali", "numb", "blank feel", "kuch samajh nahi aa raha",
  ],
  teasing: [
    "lol", "haha", "hehe", "joke", "mazak", "chill kar", "chhed", "tease",
    "roast", "savage", "🙄", "😏", "lmao", "just kidding", "obviously not",
  ],
  stress: [
    "stress", "stressed", "tension", "deadline", "overwhelmed", "exhausted",
    "thak gayi", "thak gaya", "burnt out", "burnout", "so much work",
    "boss", "manager", "office pressure", "pressure mein",
  ],
  planning: [
    "plan", "planning", "schedule", "kab milte", "kab chale", "book kar",
    "tickets", "trip plan", "let's plan", "planning to", "should we go",
  ],
  celebration: [
    "yay", "excited", "so happy", "khushi", "party", "celebrate",
    "congrats", "congratulations", "we did it", "finally happened",
    "promotion", "selected", "cleared the", "🎉", "yesss",
  ],
  boredom: [
    "bored", "boring", "bore ho rahi", "bore ho raha", "nothing to do",
    "so bored", "bore horaha", "kuch karne ka mann nahi",
  ],
};

const MOMENT_KEY_ENTRIES: Array<{ shape: Exclude<MomentShape, "none">; keys: string[] }> = (
  Object.entries(MOMENT_KEYS) as Array<[Exclude<MomentShape, "none">, string[]]>
).map(([shape, keys]) => ({ shape, keys: keys.map(padT) }));

// Evaluation order — first match wins when a turn's text hits more than one
// shape's keys. Conflict/vulnerable outrank the lighter shapes deliberately:
// a message that reads as both "stressed" and "hurt" should route pattern
// guidance toward the heavier shape, never the reverse (a silent-failure
// direction the M4 gate does not need to accept "either" to reject).
const SHAPE_PRIORITY: Array<Exclude<MomentShape, "none">> = [
  "conflict",
  "vulnerable",
  "stress",
  "silence",
  "celebration",
  "planning",
  "teasing",
  "boredom",
];

/** A long silence between turns is itself evidence of the "silence" shape
 *  even with no matching words — SPEC lists "gap length" among the moment-
 *  shape's own cheap features alongside lexical cues, affect markers, and
 *  question/conflict shape. 6h chosen as comfortably past a normal reply
 *  gap and comfortably short of "next day" (which carries no moment signal
 *  at all — a fresh topic, not a silence). */
const SILENCE_GAP_MS = 6 * 3600_000;

/**
 * T4's gate. Deterministic, no LLM, pure. Reads ONLY the current user turn
 * (+ the gap since their last message) — never history, never her own
 * output, so it cannot be gamed into a self-fulfilling moment.
 */
export function detectMomentShape(userText: string, gapSinceLastMs = 0): MomentShape {
  const hay = padT(String(userText || ""));
  if (hay.length > 1) {
    for (const shape of SHAPE_PRIORITY) {
      const entry = MOMENT_KEY_ENTRIES.find((e) => e.shape === shape)!;
      if (entry.keys.some((k) => hay.includes(k))) return shape;
    }
  }
  if (gapSinceLastMs >= SILENCE_GAP_MS && hay.trim().length < 3) return "silence";
  return "none";
}

// ─────────────────────────────────────────────────────────────────────────
// Deixis — T6's gate.
// ─────────────────────────────────────────────────────────────────────────

/** Authored shared-reference deixis cues (SPEC §6.3's own examples, kept
 *  verbatim, plus the Hinglish equivalents that carry the same function).
 *  This is NOT a topic-similarity check — every one of these phrases only
 *  means anything as a callback, which is exactly why matching them is safe
 *  as a pull signal and matching topic overlap would not be. */
const DEIXIS_PHRASES = [
  "remember when", "remember that", "remember how",
  "woh wala", "wo wala", "us din", "uss din", "wahi wala",
  "yaad hai", "yaad hai na", "yaad kar", "yaad dila",
  "jaisa humne", "jaise humne", "jab hum", "jab humne",
  "wahi baat", "wahi cheez", "usi din", "us baar", "uss baar",
  "like last time", "like that time", "back when we",
].map(padT);

/** An explicit ask to reminisce — a superset of pure deixis, still a pull
 *  signal, still authored+matched rather than inferred. */
const REMINISCE_ASK = [
  "tell me about that time", "tell me about us", "kuch purani baat bata",
  "old memories", "purani yaadein", "throwback", "flashback",
].map(padT);

/**
 * T6's gate: fires ONLY on shared-reference deixis in the CURRENT turn, or
 * an explicit reminisce ask, or a phrase-ledger hit (their own coined
 * phrase said back — SPEC §6.3 "phrase-ledger hit"). `phraseLedger` is the
 * caller's already-resolved `vy_phrase.phrase` list for this person; this
 * function does no DB I/O itself (kept pure, like everything else here).
 *
 * This is the entire mechanism behind the 0-unprompted-raises guarantee:
 * nothing downstream may treat WE content as an active callback unless
 * this returns true for the live turn.
 */
export function hasDeixis(userText: string, phraseLedger: readonly string[] = []): boolean {
  const hay = padT(String(userText || ""));
  if (hay.length <= 1) return false;
  if (DEIXIS_PHRASES.some((k) => hay.includes(k))) return true;
  if (REMINISCE_ASK.some((k) => hay.includes(k))) return true;
  for (const phrase of phraseLedger) {
    const padded = padT(phrase);
    if (padded.length > 2 && hay.includes(padded)) return true;
  }
  return false;
}

export interface MomentGateResult {
  moment: MomentShape;
  pulled: boolean;
}

/**
 * The single entry point both T4 and T6 render functions are expected to be
 * driven from (relstate.ts imports this rather than re-deriving either
 * signal) — one gate, read once per turn, so the two TAIL slots can never
 * disagree about what the turn asked for.
 */
export function momentGate(
  userText: string,
  gapSinceLastMs = 0,
  phraseLedger: readonly string[] = [],
): MomentGateResult {
  return {
    moment: detectMomentShape(userText, gapSinceLastMs),
    pulled: hasDeixis(userText, phraseLedger),
  };
}
