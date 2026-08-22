// How long to wait after their last message before replying, in case more is
// coming — and, since this file grew, whether more is coming at all.
//
// The owner's first report: "when I send multiple messages before her reply …
// human dont handle this hardcoded way it's depends on the Convo and etc etc."
// He is right, and the shipped value was a hardcoded 1300 ms.
//
// THIS REPO HAS ALREADY SOLVED THIS SHAPE ONCE, on the watch lane, and the
// measurement is the reason this file exists rather than a tuned constant.
// `scene-hold-800` bounds the landing hold at `HOLD_MULTIPLIER × that person's
// own rhythm`, and what it found is the trap here too: with a fixed ceiling,
// **the slower someone moved the longer she made them wait**, which is
// backwards. A constant cannot be right for both a person who fires six
// fragments in four seconds and a person who thinks between each one.
//
// So the wait is derived from HIS OWN recent gaps, bounded at both ends.
//
// The owner's SECOND report is why the rest of this file exists: he sends
// several messages and "she replies after the FIRST one". A clock alone cannot
// fix that, because the clock is not what a person uses. A person uses three
// things, and all three are here:
//
//   1. HIS RHYTHM      — `burstWaitMs`, the original policy.
//   2. HIS TYPING      — `burstDecide`'s composing hold. The composer's draft
//                        is the "typing…" indicator a real correspondent
//                        would see, and it was sitting unused in local state.
//   3. WHAT HE SAID    — `likelyMore`. "hello" alone, a sentence that ends on
//                        "aur", a list that has reached "1)" — these are not
//                        finished turns and no amount of timing knows that.
//
// And one thing a person also does that a naive "wait for the end" would never
// do: INTERJECT. Waiting for someone to finish is only human up to a point;
// past it, answering what you already have while they keep typing is the human
// move, and holding forever is just a different robot. `BURST_INTERJECT_MS` is
// that point, and it doubles as this file's liveness bound (see below).
//
// WHY THIS IS ENGINE AND NOT SURFACE. Every surface — web, Telegram, Discord,
// WhatsApp — has to decide this, and `surface-bypasses-parse` is what happens
// when a surface owns a decision the engine should have made: it drifts, and it
// drifts silently. The POLICY (how long, given a rhythm, a draft and his words)
// lives here as pure functions. Only the TIMER (actually waiting) belongs to
// the surface, because only the surface knows what a timer is.
//
// IMPORTS. This module was import-free on purpose, so it is testable offline
// and cannot become a reason it can no longer be bundled somewhere. It now
// imports exactly one thing — `./greeting`, which is itself pure and
// import-free — because a greeting-only fragment ("Hello") is the single
// strongest "more is coming" signal there is, and two independent notions of
// what a greeting looks like is exactly how one of them drifts. Same narrow
// allowlist discipline `liveCall.ts` is held to.

import { isGreetingOnly, leadingGreeting } from "./greeting";

/** Below this, more may still be coming. Above it, they are done talking. */
export const BURST_SAMPLE_CEILING_MS = 25_000;

/**
 * Waiting exactly one gap would catch the median follow-up and miss half of
 * them, so the wait is longer than the rhythm it is derived from. 1.6 is a
 * judgment, not a measurement — the honest label is that it is the smallest
 * multiplier that clears a typical gap with margin, and the thing to tune first
 * if bursts are still being split.
 */
export const BURST_MULTIPLIER = 1.6;

/** Never so short that a fast typist gets answered mid-thought. */
export const BURST_MIN_MS = 700;

/**
 * Never so long the reply reads as dead air. Above roughly this, a person
 * assumes they have been left on read — which is the failure the wait exists to
 * avoid, arriving by the other door.
 */
export const BURST_MAX_MS = 3_200;

/** What shipped before this file, and what is used until a rhythm exists. */
export const BURST_DEFAULT_MS = 1_300;

/** Enough samples to have a rhythm at all. One gap is an anecdote. */
export const BURST_MIN_SAMPLES = 2;

// ── the composing hold ─────────────────────────────────────────────────────
//
// THE FAILURE THIS FIXES, BOTH WAYS. Too eager and she answers "Hello" before
// he has typed the thing he actually opened the app to say — which is the
// reported bug, and the reason he then has to repeat himself. Too patient and
// she sits silent while a draft he abandoned rots in the box — which reads as
// being ignored, and is worse, because he cannot see why. So there are two
// thresholds, not one, and they mean different things.

/**
 * A keystroke this recent means he is mid-word. This is also the recheck
 * granularity — the hold re-arms to expire exactly when the last keystroke
 * goes stale, rather than polling.
 *
 * 3s is chosen off the typing indicator every messaging app has trained him
 * on: WhatsApp drops "typing…" after a few seconds of stillness, so a pause
 * longer than that already reads to HIM as having stopped typing.
 */
export const COMPOSE_ACTIVE_MS = 3_000;

/**
 * A draft with no keystroke for this long is abandoned, and the hold releases
 * whatever is still sitting in the box. Between ACTIVE and ABANDON he is
 * paused mid-thought — hunting for the word — and a person waits through that.
 * Past it he has put the phone down, and she must not go quiet on a typed-but-
 * never-sent thought she was never going to see anyway.
 */
export const COMPOSE_ABANDON_MS = 10_000;

// ── content-aware continuation ─────────────────────────────────────────────

/** A soft signal: trailing "aur", a comma, a filler after a real question. */
export const CONTINUATION_WEAK_MS = 1_100;

/** A hard signal: a bare "hello", "wait", "1 sec", "1)" — nothing else fits. */
export const CONTINUATION_STRONG_MS = 1_800;

/**
 * The ceiling when there IS evidence more is coming.
 *
 * It is allowed to sit above `BURST_MAX_MS` because the two ceilings price
 * different risks. BURST_MAX_MS bounds a wait taken on NO evidence, where the
 * only thing a longer wait buys is the chance of looking left-on-read. Here
 * the wait is bought against a near-certainty that answering now splits the
 * burst — the exact defect being fixed — so it can be longer. Not much longer:
 * past about six seconds of silence a person starts checking whether the app
 * broke, and that is the failure this ceiling exists to stay underneath.
 */
export const BURST_CONT_MAX_MS = 5_000;

// ── the interjection ceiling, and this file's liveness bound ───────────────

/**
 * The longest she will hold ANY unanswered message of his, for any reason.
 *
 * When this fires she replies to the burst SO FAR, which is not a compromise —
 * it is the human move. Someone who keeps typing for fifteen seconds gets
 * answered on what they have already said, and the rest is handled by the
 * ordinary follow-up path exactly as if it had arrived while she was typing.
 * There is no separate "interim acknowledgement" lane and there must never be:
 * the interjection is a normal reply to a partial burst, so it is still true
 * that she never speaks without something of his to answer.
 *
 * WHY 15s, derived rather than picked. It must sit BELOW
 * BURST_SAMPLE_CEILING_MS (25s) — above that this file's own definition says
 * they are done talking, so a ceiling up there could only ever fire after the
 * burst was already over, which is dead code. It must sit ABOVE the worst
 * legitimate wait plus one more fragment's worth: BURST_CONT_MAX_MS twice over
 * is 10s. That leaves the band [10s, 25s], and 15s is its lower-middle —
 * biased short, because being answered early is a smaller insult than being
 * left in silence.
 *
 * THIS CONSTANT IS THE LIVENESS BOUND. See the property on `burstDecide`.
 */
export const BURST_INTERJECT_MS = 15_000;

/** The shape this needs from a message, so it need not import the UI's type. */
export type BurstTurn = {
  from: "her" | "me";
  at: number;
  channel?: "chat" | "call";
  /** what was said — only read by the content-aware half of this file */
  text?: string;
  /** "text" | "photo" | "voice" | "gif" | … — non-text never reads as a cue */
  kind?: string;
};

/**
 * Gaps between CONSECUTIVE messages of theirs, newest last.
 *
 * Consecutive matters: a gap that spans one of her replies is a conversational
 * turn, not a burst, and folding those in would inflate the rhythm with exactly
 * the pauses this is meant to distinguish from it. Call turns are excluded for
 * the same reason — spoken timing is a different clock.
 */
export function recentUserGaps(turns: readonly BurstTurn[], sample = 12): number[] {
  const gaps: number[] = [];
  for (let i = turns.length - 1; i > 0 && gaps.length < sample; i--) {
    const cur = turns[i];
    const prev = turns[i - 1];
    if (cur.channel === "call" || prev.channel === "call") continue;
    if (cur.from !== "me" || prev.from !== "me") continue;
    const d = cur.at - prev.at;
    if (d > 0 && d <= BURST_SAMPLE_CEILING_MS) gaps.push(d);
  }
  return gaps.reverse();
}

/** Median, not mean: one 20-second pause should not redefine a fast typist. */
function median(xs: readonly number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

/**
 * The wait, in ms, for someone whose recent within-burst gaps are `gaps`.
 *
 * Returns the shipped default when there is not yet a rhythm, so a new
 * conversation behaves exactly as it did before this file existed — a person
 * with no history must not be a person with a new bug.
 */
export function burstWaitMs(gaps: readonly number[]): number {
  if (gaps.length < BURST_MIN_SAMPLES) return BURST_DEFAULT_MS;
  const scaled = Math.round(median(gaps) * BURST_MULTIPLIER);
  return Math.min(BURST_MAX_MS, Math.max(BURST_MIN_MS, scaled));
}

// ── what he said ───────────────────────────────────────────────────────────
//
// Every lexicon below is Hinglish AND English, because he writes in both
// inside one message, and a signal that only fires on one of them fires on
// about half his sentences.

/** The whole message is one of these: a summons, not a statement. */
const SUMMONS = new Set([
  "bol",
  "bolo",
  "bol na",
  "bolo na",
  "haan bol",
  "haan bolo",
  "haan boliye",
  "sun na",
  "suno na",
  "sunn",
  "oye",
]);

/**
 * The whole message is one of these: he has announced that something follows
 * and has not said it yet. The strongest content signal there is, because
 * these words have no meaning except as a preface.
 */
const OPENERS = new Set([
  "wait",
  "waitt",
  "hold on",
  "holdon",
  "listen",
  "ruk",
  "ruko",
  "rukk",
  "ruk ja",
  "suno",
  "sun",
  "dekh",
  "dekho",
  "btw",
  "brb",
  "ek baat",
  "ek baat bolu",
  "ek min",
  "ek minute",
  "ek sec",
  "ek second",
  "one sec",
  "one min",
  "guess what",
  "achha sun",
  "acha sun",
  "arre sun",
  "abhi batata hu",
  "abhi batati hu",
]);

/** "1 sec", "2 min", "30 seconds" — the same announcement, with a number. */
const HOLD_UNIT = /^\d{1,3}\s*(?:sec|secs|second|seconds|min|mins|minute|minutes)\b/i;

/**
 * The LAST word is one of these: the sentence stopped on a hinge. A person
 * reading "kal office gaya aur" waits, because the sentence is not over — the
 * word is a promise of the next clause.
 *
 * Deliberately excludes words that also END sentences in Hinglish: "bhi"
 * ("main bhi" is a complete reply), "abhi" ("aa raha hu abhi"), "waise"
 * ("theek h waise"). A trailing-word test only works on words that cannot be
 * final, and getting that list wrong makes every second message look unfinished.
 */
const HINGES = new Set([
  "so",
  "and",
  "but",
  "because",
  "coz",
  "cuz",
  "cause",
  "then",
  "like",
  "aur",
  "par",
  "lekin",
  "kyunki",
  "kyoki",
  "kyunk",
  "matlab",
  "toh",
  "to",
  "phir",
  "fir",
  "jaise",
  "agar",
  "warna",
]);

/** Punctuation that is a held breath rather than a full stop. */
const TRAILING_HOLD = /[,;:\-–—]$|\.{2,}$|…$/;

/**
 * A list has started and has one item in it. "1)", "2.", "a)", "pehli baat".
 * Anchored so a price ("1000 rupay lag gaye") and a time ("8:30 pe milte") are
 * not mistaken for enumeration — the delimiter is what makes it a list.
 */
const ENUMERATION =
  /^\s*(?:\(?\d{1,2}\s*[).\]]|[a-c]\s*[).])\s*\S|^\s*(?:pehli baat|pehla point|ek toh|ek to|first(?:ly)?|sabse pehle|point 1)\b/i;

/** Wh-shaped, in either language: the answer to this is not "haan". */
const OPEN_QUESTION =
  /\b(?:kya\s+(?:hua|kar|karr|khaya|bola|hai\s+scene)|kyu+n?|kaise|kaisa|kaisi|kahan|kaha|kab|kaun|kitna|kitni|kitne|konsa|kaunsa|batao|bata|what|why|how|where|when|who|which|tell me)\b/i;

/**
 * Backchannel: a noise, not an answer. On its own after a real question it
 * means "give me a second, I am getting to it".
 */
const FILLERS = new Set(["hmm", "hm", "hmmm", "umm", "um", "uh", "uhh", "arre", "arey", "oh", "ohh", "ok", "okay", "achha", "acha"]);

const norm = (s: string) =>
  (s || "")
    .toLowerCase()
    .replace(/[\u{1F000}-\u{1FAFF}\u{2190}-\u{21FF}\u{2300}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE00}-\u{FE0F}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Strip only what a full stop would leave behind, keeping "?" — it is a fact. */
const words = (s: string) => norm(s).replace(/[.!,;:…]+$/g, "").split(" ").filter(Boolean);

export type ContinuationStrength = "none" | "weak" | "strong";

export type Continuation = {
  strength: ContinuationStrength;
  /** which rule fired — for telemetry and for reading an eval failure */
  reason: string;
  /** how much longer to wait because of it */
  bonusMs: number;
};

const NO_CONTINUATION: Continuation = { strength: "none", reason: "", bonusMs: 0 };

export type LikelyMoreInput = {
  /** his consecutive unanswered messages, oldest first */
  his: readonly string[];
  /** her most recent message before them — "" if she has not spoken */
  herLast?: string;
};

/**
 * Is more of his turn still coming?
 *
 * Reads the LAST thing he sent, because that is the one a person would be
 * looking at when they decide whether to start typing back.
 *
 * THE ONE RULE THAT MATTERS MOST IS THE NEGATIVE ONE. "haan" as a complete
 * answer to a yes/no question is a finished turn and must not extend, or every
 * agreement in the product gets a second of dead air on top of it. That is why
 * a trailing "?" suppresses the fragment and hinge signals outright: a question
 * is a completed conversational act, whatever it is made of. "hello??" is him
 * checking whether she is there and needs the FASTEST reply in the product,
 * which is the exact opposite of what a naive greeting rule would do to it.
 */
export function likelyMore(input: LikelyMoreInput): Continuation {
  const his = input.his.filter((t) => (t || "").trim().length > 0);
  if (!his.length) return NO_CONTINUATION;
  const raw = his[his.length - 1].trim();
  const n = norm(raw);
  if (!n) return NO_CONTINUATION;
  const isQuestion = /\?\s*$/.test(raw);

  // A list that has reached exactly one item. Survives a "?" — "1) tum aa rahe
  // ho?" is still a list with a second point on the way.
  if (ENUMERATION.test(raw)) return { strength: "strong", reason: "enumeration", bonusMs: CONTINUATION_STRONG_MS };

  // A question is a finished act. Everything below reads unfinished-ness, and
  // a question is never unfinished.
  if (isQuestion) return NO_CONTINUATION;

  const w = words(raw);
  const flat = w.join(" ");

  // "Hello." on its own. The owner's screenshot, exactly: a greeting alone is
  // the opening of a turn, never the whole of one. `leadingGreeting` decides
  // what a greeting is, so this cannot drift from the greet-once predicate.
  if (isGreetingOnly(raw)) return { strength: "strong", reason: "greeting-fragment", bonusMs: CONTINUATION_STRONG_MS };
  if (SUMMONS.has(flat)) return { strength: "strong", reason: "summons", bonusMs: CONTINUATION_STRONG_MS };
  if (OPENERS.has(flat)) return { strength: "strong", reason: "opener", bonusMs: CONTINUATION_STRONG_MS };
  if (HOLD_UNIT.test(flat)) return { strength: "strong", reason: "hold-unit", bonusMs: CONTINUATION_STRONG_MS };

  // The sentence stopped on a hinge word.
  if (w.length >= 1 && HINGES.has(w[w.length - 1])) {
    return { strength: "weak", reason: "hinge", bonusMs: CONTINUATION_WEAK_MS };
  }
  // …or on held-breath punctuation.
  if (TRAILING_HOLD.test(raw)) return { strength: "weak", reason: "trailing-punct", bonusMs: CONTINUATION_WEAK_MS };

  // A noise where an answer was asked for. Only after a question of HERS that
  // cannot be answered with yes or no — "haan" to "khana khaya?" is a complete
  // reply and gets nothing.
  const her = (input.herLast || "").trim();
  if (her && /\?/.test(her) && OPEN_QUESTION.test(her) && w.length <= 2 && FILLERS.has(flat)) {
    return { strength: "weak", reason: "filler-after-open-question", bonusMs: CONTINUATION_WEAK_MS };
  }
  // A bare hello that WAS a check-in ("hello??") deliberately reaches here and
  // gets nothing: he is asking whether she is there, and the answer is speed.
  if (leadingGreeting(raw)?.checkIn) return NO_CONTINUATION;

  return NO_CONTINUATION;
}

// ── the tail the policy reasons over ───────────────────────────────────────

export type UnansweredTail = {
  /** his unanswered messages' texts, oldest first (text-kind only) */
  texts: string[];
  /** when the FIRST unanswered message landed — the liveness clock's zero */
  firstAt: number;
  /** when the most recent one landed — the burst wait's zero */
  lastAt: number;
  /** her most recent chat message before the tail */
  herLast: string;
  /** how many of his messages are waiting */
  count: number;
};

/**
 * His consecutive messages since her last one, bounded to ONE burst.
 *
 * `firstAt` is the single most important field in this file: it is the moment
 * the liveness clock starts, and it does NOT move when he sends again. If it
 * moved, a person who keeps typing could hold her forever, which is the exact
 * property `burstDecide` promises cannot happen.
 *
 * THE BOUND IS NOT TIDINESS, it is a bug this file already shipped once and a
 * browser run caught. A thread can end on a message of his that she never
 * answered — he said "hi" and left, or the tab was closed mid-turn. Days later
 * he sends something new, and an UNBOUNDED walk backwards makes that ancient
 * "hi" the burst's first message. Its deadline is long past, so `burstDecide`
 * interjects on the spot, and the entire hold collapses to zero on exactly the
 * threads where a person is most likely to send a second thought — measured as
 * her answering his first message while his second was still being typed,
 * which is the reported defect arriving through the fix for it.
 *
 * So the walk stops at BURST_SAMPLE_CEILING_MS, using this file's own
 * definition of that constant: below it more may still be coming, above it
 * they were done talking. A gap larger than that is not one burst, whatever
 * she did or did not say across it.
 */
export function unansweredTail(turns: readonly BurstTurn[]): UnansweredTail {
  const out: UnansweredTail = { texts: [], firstAt: 0, lastAt: 0, herLast: "", count: 0 };
  let i = turns.length - 1;
  for (; i >= 0; i--) {
    const m = turns[i];
    if (m.channel === "call") break;
    if (m.from !== "me") break;
    // a gap this big means they had stopped; what came before is another burst
    if (out.firstAt && m.at && out.firstAt - m.at > BURST_SAMPLE_CEILING_MS) break;
    out.count++;
    out.firstAt = m.at || out.firstAt;
    if (!out.lastAt) out.lastAt = m.at || 0;
    if (!m.kind || m.kind === "text") out.texts.unshift(m.text || "");
  }
  for (; i >= 0; i--) {
    const m = turns[i];
    if (m.from === "her" && m.channel !== "call" && (!m.kind || m.kind === "text")) {
      out.herLast = m.text || "";
      break;
    }
  }
  return out;
}

// ── the decision the surface's timer asks for ──────────────────────────────

export type BurstSignals = {
  now: number;
  /** `unansweredTail`'s firstAt — 0 when nothing of his is waiting */
  firstUnansweredAt: number;
  /** `unansweredTail`'s lastAt */
  lastUserAt: number;
  /** `recentUserGaps(turns)` */
  gaps: readonly number[];
  /** `unansweredTail`'s texts */
  his: readonly string[];
  /** `unansweredTail`'s herLast */
  herLast?: string;
  /** characters currently in the composer, trimmed */
  draftLength: number;
  /** when he last touched a key — 0 if never */
  lastKeyAt: number;
};

export type BurstReason =
  | "nothing-waiting"
  | "interject"
  | "due"
  | "waiting"
  | "continuation"
  | "composing"
  | "draft-paused";

export type BurstDecision = {
  /** reply NOW */
  fire: boolean;
  /** when to ask again, if not firing. Never 0, never past the ceiling. */
  recheckMs: number;
  reason: BurstReason;
  /** the wait this decision used, before the ceiling clamped it */
  waitMs: number;
  continuation: Continuation;
  /** how long his oldest unanswered message has been waiting */
  heldMs: number;
};

/**
 * THE POLICY. One function, so no surface can implement half of it.
 *
 * ── LIVENESS, as a provable property ───────────────────────────────────────
 * For any message of his at t0 that she has not answered, this function
 * returns `fire: true` at or before `t0 + BURST_INTERJECT_MS`, for EVERY
 * sequence of draft, keystroke, gap and content signals — including a draft
 * that is never cleared, keystrokes that never stop, and fragments that keep
 * re-firing `likelyMore`.
 *
 * The proof is three lines and they are load-bearing, so do not reorder them:
 *   (a) the ceiling test is FIRST, before the due time and before the hold, so
 *       no later branch can veto it;
 *   (b) `firstUnansweredAt` is the oldest waiting message and never advances
 *       while messages are unanswered, so the deadline is fixed, not sliding;
 *   (c) every non-firing return clamps `recheckMs` to the time left until that
 *       deadline, so the surface's timer is guaranteed to wake at it.
 * `evals/burst.mjs` drives this adversarially rather than trusting the prose.
 *
 * The mirror failure — a flag wedged closed so she never speaks again — is not
 * this function's to prevent (it holds no state at all, on purpose), and is
 * why `Chat.tsx`'s `replyCycle` releases in a `finally`. See
 * `context/rejected.md#busy-held-across-recursion`.
 */
export function burstDecide(s: BurstSignals): BurstDecision {
  const cont = likelyMore({ his: s.his, herLast: s.herLast });
  const base = burstWaitMs(s.gaps);
  const ceiling = cont.strength === "none" ? BURST_MAX_MS : BURST_CONT_MAX_MS;
  const waitMs = Math.min(ceiling, Math.max(BURST_MIN_MS, base + cont.bonusMs));

  const firstAt = s.firstUnansweredAt || s.lastUserAt;
  if (!firstAt) {
    return { fire: false, recheckMs: waitMs, reason: "nothing-waiting", waitMs, continuation: cont, heldMs: 0 };
  }
  const heldMs = Math.max(0, s.now - firstAt);
  const deadline = firstAt + BURST_INTERJECT_MS;
  const left = deadline - s.now;

  // (a) THE CEILING, FIRST. She answers what she has; the rest is a follow-up.
  if (left <= 0) {
    return { fire: true, recheckMs: 0, reason: "interject", waitMs, continuation: cont, heldMs };
  }
  // (c) nothing below may ask to sleep past the deadline.
  const capped = (ms: number) => Math.max(1, Math.min(ms, left));

  const dueAt = (s.lastUserAt || firstAt) + waitMs;
  if (s.now < dueAt) {
    return {
      fire: false,
      recheckMs: capped(dueAt - s.now),
      reason: cont.strength === "none" ? "waiting" : "continuation",
      waitMs,
      continuation: cont,
      heldMs,
    };
  }

  // The typing hold. He is mid-message; a person does not answer over that.
  if (s.draftLength > 0 && s.lastKeyAt > 0) {
    const since = s.now - s.lastKeyAt;
    if (since < COMPOSE_ACTIVE_MS) {
      return {
        fire: false,
        recheckMs: capped(COMPOSE_ACTIVE_MS - since),
        reason: "composing",
        waitMs,
        continuation: cont,
        heldMs,
      };
    }
    if (since < COMPOSE_ABANDON_MS) {
      return {
        fire: false,
        recheckMs: capped(COMPOSE_ABANDON_MS - since),
        reason: "draft-paused",
        waitMs,
        continuation: cont,
        heldMs,
      };
    }
  }

  return { fire: true, recheckMs: 0, reason: "due", waitMs, continuation: cont, heldMs };
}
