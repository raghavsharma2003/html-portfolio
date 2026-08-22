// GREET ONCE PER SITTING — a predicate, not a prompt line.
//
// The owner's report, verbatim shape: she opened with "heyyy", he answered
// "Hello", she came back "hey ...", he said "Esse hi timepass", and she came
// back "heyy ..." — THREE hellos inside one conversation that never paused.
// Nobody does that. It is the single loudest "this is a machine" tell in the
// product, because a greeting is the one utterance whose entire meaning is
// "we are starting", and starting twice is not a thing a person can do.
//
// WHY A PREDICATE. `gate0-structural` is this repo's law on exactly this
// choice: the prompt arm of a rule leaked 57–98%, the predicate on the bytes
// leaked 0 of 31,122. A brief line ("don't say hi twice") is a preference the
// model weighs against mirroring his "Hello", and mirroring wins — that is
// what the transcript above IS. `prompt-position` is the second reason: the
// place such a line would go is mid-brief, where a rule measured 0 fires in 8.
// So the brief stays byte-unchanged and the bytes get checked on the way out.
//
// WHAT A SITTING IS. Gap-defined, for the same reason `away.ts` defines its
// facts off the clock rather than off a guess about him: it is the only thing
// that is knowable. Under SITTING_GAP_MS the conversation never stopped and a
// second hello is a defect; over it he genuinely came back and a hello is the
// right and warm thing (persona's come-back beat depends on it, so this module
// must never suppress that one).
//
// Pure and import-free, like `burst.ts` and for the same reason: it has to be
// callable from every surface's output path — the web gate in `brain.ts`, and
// `api/_surface.js`'s `gateReply` for Telegram/WhatsApp/Discord — without
// dragging a dependency into a bundle that cannot take one.

/**
 * Over this much silence, he came back and a fresh hello is correct.
 *
 * Four hours, and the reasoning is `away.ts`'s, one size up. That file treats
 * ten minutes as the smallest gap worth REMARKING on; a hello is a much larger
 * act than a remark, so its threshold has to be much larger than ten minutes.
 * Four hours is the smallest gap that reliably means he left and came back
 * (a workday afternoon, an evening out, a night) rather than that he put the
 * phone down. Every overnight gap clears it comfortably, so "a new day greets
 * fresh" falls out of this constant instead of needing a calendar rule — which
 * matters, because a calendar rule would make 23:58 → 00:05 a new sitting.
 *
 * REVERSAL: if she is measured failing to greet on a genuine return (he is
 * back after 2–3 hours and gets no hello), this is too high. If a second hello
 * survives inside one continuous evening, it is too low.
 */
export const SITTING_GAP_MS = 4 * 60 * 60_000;

/** The shape this needs from a message, so it need not import the UI's type. */
export type GreetTurn = {
  from: "her" | "me";
  at: number;
  text?: string;
  kind?: string;
  channel?: "chat" | "call";
};

// Anything that is only decoration around a word: emoji, punctuation, the
// stretched-out enthusiasm her own register is built on. Used to decide
// whether what is LEFT of a bubble is actually anything.
const DECOR =
  /[\s.,!~\-–—…*"'`()\u{1F000}-\u{1FAFF}\u{2190}-\u{21FF}\u{2300}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE00}-\u{FE0F}\u{200D}\u{20E3}]/gu;

const bare = (s: string) => s.replace(DECOR, "").trim();

/**
 * The greeting run at the head of a message.
 *
 * Stretchable on purpose ("heyyy", "hiii", "hellooo") because her register is
 * built out of stretched vowels — a fixed token list would catch "hey" and
 * miss the form she actually sends. Anchored at ^ on purpose too: that alone
 * is what makes "chal hey listen" untouchable, without needing a rule for it.
 */
const GREET_RUN =
  /^(?:h+e+y+a?|h+i+|h+e+l+o+|h+a+l+o+|hlo+|hola|y+o+|o+y+e+|oi|namaste|namaskar|sup|gm|good\s+(?:morning|afternoon|evening|noon))\b/i;

// Bare time-of-day words are a greeting ONLY when they are the whole message.
// "morning" is a hello; "morning walk pe gayi thi" is a sentence, and a leading
// strip would eat the subject of it.
const BARE_TIME = /^(?:morning|mornin|evening|afternoon)$/i;

// Vocatives that ride along with the hello and mean nothing without it.
// "hey yaar listen" → the greeting run is "hey yaar", the rest is "listen".
const VOCATIVE = /^(?:yaar|yr|jaan|jaanu|babe|baby|bro|bhai|there|na)\b/i;

// The Hindi emphatic "hi" (as in "aise hi", "wahi hi") and the same trap for
// "to/toh". If a leading hi-family token is followed by one of these, it was
// not a hello and stripping it would delete the sentence's own grammar.
const NOT_AFTER_HI = /^(?:toh?|na|hi|bhi|sahi|wahi|yahi|hai|h)\b/i;

export type GreetMatch = {
  /** the literal greeting run, as she wrote it */
  greet: string;
  /** everything after it, trimmed — "" when the message was only a greeting */
  rest: string;
  /**
   * The run was terminated by a question mark, which changes what it IS.
   * "hello?? tum ho na" is not a greeting, it is her checking whether he is
   * still there, and it must survive untouched — deleting the "hello??" turns
   * a worried nudge into a non sequitur. Callers must never strip a checkIn.
   */
  checkIn: boolean;
};

/** The greeting at the head of `text`, or null if it does not open with one. */
export function leadingGreeting(text: string): GreetMatch | null {
  const t = (text || "").trim();
  if (!t) return null;
  if (BARE_TIME.test(bare(t))) return { greet: t, rest: "", checkIn: false };
  const m = GREET_RUN.exec(t);
  if (!m) return null;
  let greet = m[0];
  let rest = t.slice(greet.length);
  // the hi-family trap: "hi toh maine bola tha" opens with a particle, not a
  // hello. Checked on the RAW remainder, before punctuation is eaten.
  if (/^h+i+$/i.test(greet) && NOT_AFTER_HI.test(rest.trim())) return null;
  // a vocative and a second hello both belong to the run: "hey hi", "hey yaar"
  for (;;) {
    const trimmed = rest.replace(/^[\s,!~.\-–—]+/, "");
    const v = VOCATIVE.exec(trimmed) || GREET_RUN.exec(trimmed);
    if (!v) break;
    // never absorb the whole rest of a sentence through a vocative
    const after = trimmed.slice(v[0].length);
    if (VOCATIVE.test(v[0]) && after.trim() && !/^[\s,!~.?\-–—]/.test(after)) break;
    greet = t.slice(0, t.length - after.length);
    rest = after;
  }
  const checkIn = /^\s*\?/.test(rest);
  return { greet, rest: rest.replace(/^[\s,!~.?\-–—…]+/, "").trim(), checkIn };
}

/**
 * The whole message is a hello and nothing else — "heyy", "hey yaar 🥰", "hi!!".
 * The decoration is not content: a bubble that is a hello plus three hearts is
 * still, entirely, a hello.
 */
export function isGreetingOnly(text: string): boolean {
  const g = leadingGreeting(text);
  return Boolean(g) && !g!.checkIn && bare(g!.rest) === "";
}

/**
 * When the CURRENT sitting began, in ms.
 *
 * Walks back from the newest message to the first gap that clears
 * SITTING_GAP_MS. If the record itself has gone quiet for that long, the
 * sitting starts NOW — which is what makes "he came back, greet him" the
 * default rather than a special case.
 */
export function sittingStartAt(record: readonly GreetTurn[], nowMs: number): number {
  const rec = record.filter((m) => m.at > 0 && m.channel !== "call");
  if (!rec.length) return nowMs;
  const last = rec[rec.length - 1];
  if (nowMs - last.at >= SITTING_GAP_MS) return nowMs;
  for (let i = rec.length - 1; i > 0; i--) {
    if (rec[i].at - rec[i - 1].at >= SITTING_GAP_MS) return rec[i].at;
  }
  return rec[0].at;
}

/**
 * Has SHE already said hello in this sitting?
 *
 * Only her own CHAT text counts. His greetings are irrelevant — he may say
 * hello as often as he likes, and mirroring it is precisely the behaviour
 * being removed. Call turns are excluded because a spoken hello belongs to the
 * call; the text that follows a call is governed by the after-call directive,
 * not by this.
 */
export function sheGreetedThisSitting(record: readonly GreetTurn[], nowMs: number): boolean {
  const start = sittingStartAt(record, nowMs);
  return record.some((m) => {
    if (m.from !== "her" || m.channel === "call") return false;
    if (m.kind && m.kind !== "text") return false;
    if (!m.at || m.at < start) return false;
    const g = leadingGreeting(m.text || "");
    return Boolean(g) && !g!.checkIn;
  });
}

export type GreetOnceResult = {
  bubbles: string[];
  /** a leading hello was cut off the front of a bubble that had more to say */
  stripped: number;
  /** a bubble that was ONLY a hello was removed entirely */
  dropped: number;
  /**
   * Every bubble she wrote was a hello, so there was no ungreeted remainder to
   * fall back to and one bubble was kept as written. Never deliver nothing:
   * a duplicated hello is a blemish, silence is a broken product.
   */
  degraded: boolean;
};

/**
 * Take the second hello out of a reply.
 *
 * Only the FIRST bubble is examined, because that is the only place a greeting
 * can be doing greeting work — a "hey" in bubble three is a discourse particle
 * ("hey wait no") and is hers to keep.
 */
export function greetOnce(
  bubbles: readonly string[],
  record: readonly GreetTurn[],
  nowMs: number,
): GreetOnceResult {
  const out = { bubbles: [...bubbles], stripped: 0, dropped: 0, degraded: false };
  if (!out.bubbles.length) return out;
  // Her FIRST message of a sitting greets. This is the whole negative case and
  // it is checked before anything else is touched.
  if (!sheGreetedThisSitting(record, nowMs)) return out;
  const first = out.bubbles[0];
  const g = leadingGreeting(first);
  if (!g || g.checkIn) return out;
  if (bare(g.rest) === "") {
    out.bubbles = out.bubbles.slice(1);
    out.dropped = 1;
  } else {
    out.bubbles[0] = g.rest;
    out.stripped = 1;
  }
  if (out.bubbles.length) return out;
  // Nothing survived: she had nothing to say but hello. Keep what she wrote —
  // an empty reply is the one outcome this module may never produce.
  out.bubbles = [bubbles[bubbles.length - 1]];
  out.dropped = 0;
  out.degraded = true;
  return out;
}
