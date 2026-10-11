// T14 `rel.raised` — what she has already brought up, how often, and how he
// answered.
//
// The owner reported it twice, as points 2 and 9: "Move on from topic she keep
// repeating same thing again n again (we need to keep this but tone it down and
// it should dynamically change basis on the topic and user behaviour while
// discussing it)" and "just keep repeating the things … not interesting at all".
//
// Note what he did NOT ask for. Returning to a thing is human and he says to
// keep it. The ask is MODULATION, and specifically modulation on his own
// behaviour while discussing it — a topic he engages with is one she may raise
// again; a topic he answers in two words is one a real person drops. So this
// carries both numbers and lets her decide, rather than a threshold that
// silently bans a subject.
//
// ── three design constraints, each from a logged failure ──────────────────
//
// 1. NO TABLE, NO WRITER. This is a pure function of the transcript, exactly
//    like `openCommitments` in honesty.ts and for the reason recorded in
//    `receipt-ledger-from-transcript`: a table needs a writer, this repo has
//    five logged `dead-writers` instances, and a pure function cannot have a
//    missing producer.
//
// 2. NO HARDCODED STOPLIST. `observation.ts` already refused to duplicate
//    api/memory.js's RECALL_STOP, on the grounds that a second copy silently
//    drifts — and it solved that by injection, which is not available here
//    because this runs in the client bundle where RECALL_STOP is not in scope.
//    So the common words are MEASURED FROM THIS CONVERSATION instead — which is
//    self-calibrating across Hinglish, English and one person's verbal tics,
//    and has no list to go stale.
//
//    Frequency alone was the first attempt and it was WRONG, caught by the eval
//    rather than by review: a topic she raises three times in eight messages
//    trips any sensible frequency threshold, so a pure-df filter deletes exactly
//    the signal this module exists to find. The discriminator is WHO USES IT.
//    Structural words are used by BOTH people — that is what makes them grammar
//    for this pair — while a topic she over-raises is frequent in hers and
//    largely absent from his. See `raisedRecently`.
//
// 3. TERMS, NEVER PHRASES. `recited-prompt` is the law that costs the most
//    here: echoing her repeated SENTENCES back into her own brief would hand
//    her the exact phrase bank that produced 4-of-5 verbatim recitation. A
//    bare lowercase token is the shape `affect-recitation` measured safe
//    (structured tags, 0/42 hard leaks at n=84), so only single tokens travel.

/** The shape this needs from a message, so it need not import the UI's type. */
export type RepeatTurn = { from: "her" | "me"; text: string; channel?: "chat" | "call" };

export interface RaisedTerm {
  /** a single lowercase token — never a phrase, see constraint 3 */
  term: string;
  /** how many of HER distinct recent messages carried it */
  times: number;
  /** mean words in HIS next message, across those occurrences */
  theirWords: number;
}

/** How far back to look. Beyond this it is not "again", it is "still". */
export const REPEAT_WINDOW = 30;

/**
 * A term in more than this share of ALL recent messages is a function word for
 * this pair, whoever they are. Measured rather than listed — see constraint 2.
 */
export const COMMON_DF = 0.35;

/**
 * How many of HIS messages must carry a term before it counts as shared
 * grammar rather than her topic. Two, because one is a reply echoing her word
 * back — which is what a person does when answering, not what they do when the
 * word is part of how they both talk.
 */
export const SHARED_BY_BOTH = 2;

/** Below this it has been raised once, which is not repetition. */
export const MIN_TIMES = 2;

/** Shorter tokens are almost all grammar in both languages here. */
export const MIN_TERM_LEN = 3;

/** At or under this many words, a reply is an acknowledgement, not engagement. */
export const SHORT_REPLY_WORDS = 3;

/** Most she will ever be told about at once. Three is a nudge; ten is a script. */
export const MAX_TERMS = 3;

/** T14's manifest budget. */
export const RAISED_BUDGET = 400;

function tokens(text: string): string[] {
  return (text.toLowerCase().match(/[a-zऀ-ॿ]+/g) || []).filter(
    (t) => t.length >= MIN_TERM_LEN,
  );
}

const words = (s: string) => (s.trim().match(/\S+/g) || []).length;

/**
 * Terms she has raised more than once recently, with how he answered each.
 *
 * Call turns are excluded: spoken repetition is a different phenomenon on a
 * different clock, and folding it in would double-count a topic that came up
 * once in each medium.
 */
export function raisedRecently(turns: readonly RepeatTurn[]): RaisedTerm[] {
  const recent = turns.filter((t) => t.channel !== "call").slice(-REPEAT_WINDOW);
  if (recent.length < 4) return [];

  // Document frequency over BOTH sides, and separately over HIS.
  //
  // Frequency alone is NOT enough, and the eval caught this: a topic she raises
  // three times in eight messages trips any sensible frequency threshold, so a
  // pure-df filter deletes exactly the signal this module exists to find.
  //
  // The discriminator is WHO USES IT. A structural word ("yaar", "kya") is used
  // by BOTH people — that is what makes it grammar for this pair. A topic she
  // over-raises is frequent in HER messages and largely absent from his. So a
  // term is filtered only when it is common AND he uses it too.
  const df = new Map<string, number>();
  const dfMe = new Map<string, number>();
  for (const t of recent) {
    for (const tok of new Set(tokens(t.text))) {
      df.set(tok, (df.get(tok) || 0) + 1);
      if (t.from === "me") dfMe.set(tok, (dfMe.get(tok) || 0) + 1);
    }
  }
  const commonAt = recent.length * COMMON_DF;

  // Her occurrences, and the length of his very next message each time.
  const hits = new Map<string, { times: number; reply: number[] }>();
  for (let i = 0; i < recent.length; i++) {
    if (recent[i].from !== "her") continue;
    const next = recent.slice(i + 1).find((t) => t.from === "me");
    for (const tok of new Set(tokens(recent[i].text))) {
      const isShared = (dfMe.get(tok) || 0) >= SHARED_BY_BOTH;
      if ((df.get(tok) || 0) > commonAt && isShared) continue;
      const h = hits.get(tok) || { times: 0, reply: [] };
      h.times += 1;
      if (next) h.reply.push(words(next.text));
      hits.set(tok, h);
    }
  }

  return [...hits.entries()]
    .filter(([, h]) => h.times >= MIN_TIMES)
    .map(([term, h]) => ({
      term,
      times: h.times,
      theirWords: h.reply.length
        ? Math.round(h.reply.reduce((a, b) => a + b, 0) / h.reply.length)
        : 0,
    }))
    // most-repeated first; ties broken by the colder reception, because that is
    // the one she most needs to know about
    .sort((a, b) => b.times - a.times || a.theirWords - b.theirWords)
    .slice(0, MAX_TERMS);
}

/**
 * The T14 block, or "" when nothing has been raised twice.
 *
 * Empty is the common case, which keeps every ordinary turn byte-identical.
 */
export function renderRaised(rows: readonly RaisedTerm[]): string {
  if (!rows.length) return "";
  const lines = rows.map((r) => {
    const how =
      r.theirWords === 0
        ? "they did not answer"
        : r.theirWords <= SHORT_REPLY_WORDS
          ? `they answered short (~${r.theirWords} words)`
          : `they engaged (~${r.theirWords} words)`;
    return `${r.term} · ${r.times}x · ${how}`;
  });
  const text =
    "YOU HAVE ALREADY RAISED THESE — count, and how they answered. Not a ban: a thing they engage with is worth returning to, a thing they answer in two words is one a person would let go. You decide:\n" +
    lines.join("\n");
  return text.length > RAISED_BUDGET ? text.slice(0, RAISED_BUDGET) : text;
}

// ── THE HER-SIDE LOOP FENCE ────────────────────────────────────────────────
//
// Everything above is about TOPICS — what she keeps bringing up, and how he
// answers when she does. This is the other repetition, and it is a different
// defect with a different fix: her saying the SAME LINE again.
//
// Tester report, 2026-08-25: *"kya idea hai"* for a whole game, and
// same-question loops on calls generally. The topic detector cannot see it —
// a line repeated three times is three occurrences of terms that are mostly
// under `MIN_TERM_LEN` or shared with him, and the block it renders is advice
// about a subject rather than a fact about a stall. And nothing else in the
// stack looks at her own last turn at all: the call lane compiles a prompt,
// speaks the answer, and forgets it.
//
// So: a cheap runtime check on the cascade turn path, on HER candidate reply,
// against the last two things she actually said. Cheap is the whole design —
// it runs on every turn of every call, it must cost nothing, and it must not
// need a model, a table or a writer (`receipt-ledger-from-transcript`).
//
// WHY JACCARD ON WORD SETS and not string equality: she does not repeat
// herself verbatim, she repeats herself with the filler shuffled — "kya idea
// hai", "toh kya idea hai", "acha kya idea hai yaar". Set overlap catches all
// three and is one pass over a handful of tokens. Order is deliberately
// ignored for the same reason.
//
// WHY BACKCHANNELS ARE EXEMPT: "haan", "hmm", "acha", "sach me" are SUPPOSED
// to repeat. A fence that fires on them would push her into inventing variety
// in the one place where variety is the tell — real people say "hmm" twice in
// a row and nobody notices. Under `LOOP_MIN_WORDS` the check does not run.

/** Word-set overlap above this is "she said that already". 0.8 is high on
 *  purpose: this fires a nudge and a re-generation, and a false positive costs
 *  a turn of latency, so the bar is a line that is substantially the same one
 *  rather than one on the same subject. */
export const LOOP_JACCARD = 0.8;

/** How many of her previous spoken turns to compare against. Two: a loop is
 *  visible by the second repeat, and reaching further back turns a callback
 *  ("like I said —") into a defect. */
export const LOOP_LOOKBACK = 2;

/** Under this many words she is backchannelling and may repeat freely. */
export const LOOP_MIN_WORDS = 4;

/** At most one re-generation per turn. A second would put her latency in the
 *  seconds on a lane where the whole product is that she answers like a
 *  person, and a model that has ignored the nudge once will ignore it twice. */
export const LOOP_MAX_RETRIES = 1;

/**
 * Her line as a comparable word set: lowercase, punctuation and emoji gone,
 * Devanagari kept (she speaks Hinglish in both scripts and "क्या" and "kya"
 * are both hers). Exported for the eval, which drives the normalizer directly
 * rather than inferring it from a verdict.
 */
export function loopWords(text: string): Set<string> {
  return new Set(
    (text || "")
      .toLowerCase()
      // Letters and digits in both scripts survive; everything else — marker
      // brackets, emoji, punctuation, the ZWJ sequences an emoji arrives in —
      // becomes a separator.
      .replace(/[^a-z0-9ऀ-ॿ]+/g, " ")
      .split(/\s+/)
      .filter(Boolean),
  );
}

/** |A ∩ B| / |A ∪ B|. 0 when either side is empty — an empty reply is not a
 *  repeat of anything, it is a different bug. */
export function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const w of a) if (b.has(w)) shared++;
  return shared / (a.size + b.size - shared);
}

/**
 * Is this candidate reply a near-duplicate of something she just said?
 *
 * Pure, total and O(words). `prev` is her previous spoken turns, newest first;
 * only the first `LOOP_LOOKBACK` are considered.
 */
export function isLoopingLine(candidate: string, prev: readonly string[]): boolean {
  const words = loopWords(candidate);
  if (words.size < LOOP_MIN_WORDS) return false;
  for (const p of (prev ?? []).slice(0, LOOP_LOOKBACK)) {
    const before = loopWords(p);
    if (before.size < LOOP_MIN_WORDS) continue;
    if (jaccard(words, before) > LOOP_JACCARD) return true;
  }
  return false;
}

/**
 * The nudge appended to the next `think()` when the fence fires.
 *
 * ANGLE BRACKETS and the `<context: …>` lemma, exactly like `activityNote` and
 * for its reason: square-bracket text on a voice lane gets SPOKEN
 * (`ack-bracket-direction` — "[laughs softly]" came back as laughter plus the
 * spoken word "Softly").
 *
 * It says WHAT to do, not what to say. A nudge carrying an example line would
 * be a phrase bank, which is `recited-prompt`, which is the most expensive law
 * in this repo — and it would be a phrase bank installed at exactly the moment
 * she has already demonstrated she will repeat whatever is in front of her.
 */
export const LOOP_NUDGE =
  "<context: you already said that, almost word for word, a moment ago. saying it again is a stall, not a style. say something NEW about what is actually happening right now — move the conversation, react to the last thing they said, or ask about something else entirely. never repeat the line you just used, and never reference this note>";
