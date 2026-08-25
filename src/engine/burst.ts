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

// THE OWNER'S THIRD REPORT, and why the second fix did not cover it:
// "she replies too fast. She won't let me type one, two messages… doesn't give
// me room to breathe" — and "this feedback I have given some time back also".
//
// Everything above shipped and works, and none of it touches the shape he is
// describing, because all three of its signals need EVIDENCE and the shape he
// is describing has none. He sends a complete-looking sentence — "U can call
// me" — so `likelyMore` says nothing is coming; the box is empty because he
// just sent it, so the composing hold has nothing to hold; and the wait is the
// rhythm, 1300 ms for someone with no history. Measured in a real browser
// against the built app: she fired at 2.05 s whether he started typing at 2 s,
// 4 s or 8 s. There was never a race to lose. The reply was already committed.
//
// The repair is not a fourth signal. It is a POLARITY change, and it is the
// fourth idea in this file:
//
//   4. GRACE IS THE DEFAULT — `burstWaitMs` + `followUpRate`. Every message of
//      his gets a breath, floored at something already patient, extended by how
//      often HE actually doubles, and shortened ONLY by `handedOver` — a
//      question aimed at her, an explicit "tum batao". Continuation is now the
//      accelerator, not the engine.
//
// And one more thing a person can see that this file could not: whether he is
// AT the keyboard. Focus and an open keyboard hold exactly as typing does, and
// the hold decays through the states a person actually passes through instead
// of ending at one cliff.
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
 *
 * RAISED 3200 → 4500 by WS-BREATH. The old number priced only "looking
 * left-on-read", which is the right price for a wait bought on NO evidence. It
 * is the wrong price for a wait bought on the evidence that THIS person sends
 * doubles most of the time: he is not being left on read at 4.5s, he is
 * mid-second-message, and answering him there is the defect the owner reported
 * twice. Still under the ~6s where a person starts checking whether the app
 * broke, which is the ceiling that actually bounds this.
 */
export const BURST_MAX_MS = 4_500;

/**
 * GRACE IS THE DEFAULT — the single idea WS-BREATH is built on.
 *
 * The shipped system had this backwards. It waited 1300 ms and bought MORE
 * time only when his words said more was coming (`likelyMore`). So a
 * complete-LOOKING sentence — "U can call me": no comma, no hinge, no cue —
 * got 1300 ms and nothing else, and the ordinary human habit of following a
 * finished sentence with another one lost the race every time. Measured in the
 * browser against the built app: she fired at 2.05 s whether he started typing
 * at 2 s, 4 s or 8 s, and at 2.17 s when he never typed at all. The reply was
 * committed before his hand reached the keyboard.
 *
 * So the polarity is inverted. The base is a BREATH — floored here for someone
 * she knows nothing about, extended by how often HE actually doubles, and cut
 * DOWN only by a strong completion signal (a question aimed at her, a handoff).
 *
 * WHY 2600. It must clear the window in which a person who has just sent a
 * message REACHES for the keyboard: read what he sent, decide there is more,
 * tap the box. The measured cut-offs start at 1.3 s and the report is "one,
 * two messages", so the floor has to sit above that reach rather than inside
 * it. It also has to stay well under the ~6 s app-broke line, because it is
 * charged on EVERY message, including the ones with no follow-up at all. 2600
 * is the top of the reach band with margin — biased patient, which is the
 * direction the owner has now asked for twice.
 *
 * The floor is not the whole answer and is not meant to be. It only has to
 * survive until he TOUCHES the composer; from there the engagement hold below
 * takes over and this number stops mattering.
 */
export const BURST_GRACE_FLOOR_MS = 2_600;

/**
 * The grace when he has clearly handed the floor to her — a question aimed at
 * her, an explicit "tum batao". This is the ONE direction the wait is allowed
 * to shrink, and it is deliberately the shipped pre-WS-BREATH number: the old
 * behaviour was not wrong here, it was wrong everywhere else.
 */
export const BURST_HANDOFF_MS = 1_300;

/** Enough samples to have a rhythm at all. One gap is an anecdote. */
export const BURST_MIN_SAMPLES = 2;

// ── how often HE doubles ───────────────────────────────────────────────────
//
// `burstWaitMs` knew how FAST his follow-ups arrive and nothing about whether
// they arrive at all. Those are different questions, and only the second one
// prices the wait: time bought above the floor is worth buying in proportion
// to the chance he uses it.

/**
 * What to assume about someone with no history. Deliberately below half: a
 * stranger gets the floor and nothing on top, because the floor is already the
 * patient answer and everything above it is evidence-only.
 *
 * Honest label: a judgment, not a measurement — and the thing to tune first if
 * the wait is still short for people the product has only just met.
 */
export const FOLLOWUP_PRIOR = 0.35;

/** The prior is worth this many observations, so a two-message thread cannot read 1.0. */
export const FOLLOWUP_PRIOR_WEIGHT = 3;

/**
 * How fast the past stops counting, in messages. Someone who used to fire
 * doubles and has settled into whole sentences should be answered like who he
 * is now; recency is half of what "learned from HIS actual rate" means.
 */
export const FOLLOWUP_HALFLIFE = 8;

/** How far back to look at all. */
export const FOLLOWUP_SAMPLE = 24;

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
 * The CEILING on the mid-thought pause, reached by a long draft. Past this he
 * has put the phone down, and she must not go quiet on a typed-but-never-sent
 * thought she was never going to see anyway.
 *
 * It used to be a flat budget for every draft, and that was a cliff in the
 * wrong place in both directions: a four-character "aaaa" bought the same ten
 * seconds as a paragraph. Measured in the browser: twelve characters typed and
 * left produced 13.31 s of total silence, against 2.17 s for the same message
 * with the box left empty. The shipped hold had exactly two settings — 1.3 s
 * and 13.3 s — and nothing in between, which is neither of the two things a
 * person does.
 */
export const COMPOSE_ABANDON_MS = 10_000;

/**
 * The FLOOR on the mid-thought pause, for a draft of one character.
 *
 * Between ACTIVE and the budget he is paused mid-thought — hunting for the
 * word — and a person waits through that. How long a person waits scales with
 * how much of the thought is already on the screen, which is what makes this a
 * decay rather than a cliff.
 */
export const COMPOSE_PAUSE_MIN_MS = 3_500;

/**
 * How much each character of the standing draft is worth. 3500 + 100·len
 * reaches the 10 s ceiling at 65 characters — about one full sentence, which
 * is the point where the thought on the screen is worth waiting out however
 * long he stares at it.
 */
export const COMPOSE_PAUSE_PER_CHAR_MS = 100;

/**
 * FOCUS AND KEYBOARD COUNT. The composer is focused, or the soft keyboard is
 * up, and he has not pressed a key yet: he is at the keyboard, deciding. That
 * is the think-pause BEFORE typing, and the shipped hold could not see it at
 * all — `burstDecide` only ever looked at `draftLength > 0 && lastKeyAt > 0`,
 * so an open keyboard and an empty box were byte-identical to a phone face-down
 * on a table. Measured: focused, keyboard up, zero keystrokes → she fired at
 * 2.13 s, the same as doing nothing.
 *
 * WHY 6000. It is the same act as `COMPOSE_ACTIVE_MS` one step earlier in the
 * sequence, and it should be longer than it, because reaching a decision takes
 * longer than reaching the next word. It must stay under the two continuation
 * ceilings' sum (10 s) so it cannot become the longest thing in the file that
 * is not the interjection bound, and comfortably under BURST_INTERJECT_MS. 6 s
 * is also the app-broke line — the right place for a hold that is bought on
 * presence rather than on content.
 */
export const FOCUS_HOLD_MS = 6_000;

/**
 * The beat after he stops. He closed the keyboard, or blurred the box, or his
 * draft aged out — a person does not answer on the same instant that the other
 * one puts their phone down, and a hold that ends in a hard edge is how the
 * think-pause becomes a cliff again at the far end.
 *
 * Small on purpose: this is punctuation, not patience. It is the last thing in
 * the decay and every other hold is longer than it.
 */
export const SETTLE_MS = 1_200;

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
 * How often HE follows one of his own messages with another one, 0..1.
 *
 * READ IT AS A PROBABILITY, because that is exactly what it is: given that he
 * has just sent a message, how likely is another one. That is the quantity a
 * WAIT should be priced on — it is the chance the waiting pays for itself. It
 * is NOT "what fraction of his turns are multi-message", and the difference
 * matters: someone who always sends exactly two messages reads ~0.5, because
 * half of his messages really are last ones. The realistic band is roughly
 * 0.1 (never doubles) to 0.7 (long bursts), and the constants below are set
 * against that band rather than against 0..1.
 *
 * A message of his counts as "doubled" when the very next chat message in the
 * thread is also his and lands within `BURST_SAMPLE_CEILING_MS` — this file's
 * own definition of still-in-the-same-burst. Anything she said in between ends
 * the burst by definition, which is the same rule `recentUserGaps` uses and
 * the reason both live here rather than in two places that can disagree.
 *
 * Two properties this needs and a plain ratio does not have:
 *
 *   RECENCY. Weighted by `0.5^(k/FOLLOWUP_HALFLIFE)`, k counting back from his
 *   most recent OBSERVED message. Who he is this week outranks who he was.
 *
 *   SHRINKAGE. Blended toward `FOLLOWUP_PRIOR` with a weight of
 *   `FOLLOWUP_PRIOR_WEIGHT` observations, so one doubled message in a
 *   three-message thread does not read as a 100% doubler and buy him the
 *   ceiling. A rate this drives a WAIT with has to be wrong quietly.
 *
 * His LAST message is deliberately not counted: its outcome has not happened
 * yet, and counting an unobserved outcome as a zero is exactly the bias that
 * would make her impatient with the person who is mid-burst right now.
 */
export function followUpRate(turns: readonly BurstTurn[], sample = FOLLOWUP_SAMPLE): number {
  const chat = turns.filter((m) => m.channel !== "call");
  let num = FOLLOWUP_PRIOR * FOLLOWUP_PRIOR_WEIGHT;
  let den = FOLLOWUP_PRIOR_WEIGHT;
  let k = 0;
  // `chat.length - 1` on purpose: the final message has no observed outcome.
  for (let i = chat.length - 2; i >= 0 && k < sample; i--) {
    if (chat[i].from !== "me") continue;
    const next = chat[i + 1];
    const doubled =
      next.from === "me" && next.at > chat[i].at && next.at - chat[i].at <= BURST_SAMPLE_CEILING_MS;
    const w = Math.pow(0.5, k / FOLLOWUP_HALFLIFE);
    num += doubled ? w : 0;
    den += w;
    k++;
  }
  // Rounded: this number is compared against constants in fixtures and printed
  // into telemetry, and a float tail is a difference that means nothing.
  return den > 0 ? Math.round((num / den) * 10_000) / 10_000 : FOLLOWUP_PRIOR;
}

/**
 * THE BREATH, in ms, for someone whose within-burst gaps are `gaps` and whose
 * doubling rate is `rate`.
 *
 * Read it as: everyone gets the floor; above the floor you only buy the time
 * his own rhythm says a follow-up needs, in proportion to how likely he is to
 * send one. A stranger gets the floor. A fast doubler's rhythm sits BELOW the
 * floor, so the floor holds and he re-arms it himself with his next fragment.
 * A deliberate doubler is the only shape that buys the top of the range — and
 * he is exactly the shape `scene-hold-800` warned about being punished for
 * moving slowly.
 *
 *   stranger, no rhythm                       → 2600  (the floor)
 *   six fragments in four seconds, r=0.9      → 2600  (rhythm 480 < floor)
 *   a fragment every 2.6s, r=0.5 (a doubler)  → 3380
 *   a fragment every 2.6s, r=0.6              → 3536
 *   a fragment every 2.6s, r=1                → 4160
 *   a fragment every 6s, r=1                  → 4500  (the ceiling)
 *
 * The default `rate` is the prior, so a caller that has not been taught about
 * doubling yet gets the floor rather than a surprise.
 */
export function burstWaitMs(gaps: readonly number[], rate: number = FOLLOWUP_PRIOR): number {
  const r = Math.min(1, Math.max(0, Number.isFinite(rate) ? rate : FOLLOWUP_PRIOR));
  // With no rhythm there is no duration to buy, so the floor IS the estimate.
  const rhythm =
    gaps.length < BURST_MIN_SAMPLES
      ? BURST_GRACE_FLOOR_MS
      : Math.round(median(gaps) * BURST_MULTIPLIER);
  const grace = BURST_GRACE_FLOOR_MS + r * Math.max(0, rhythm - BURST_GRACE_FLOOR_MS);
  return Math.min(BURST_MAX_MS, Math.max(BURST_MIN_MS, Math.round(grace)));
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

// ── the only thing allowed to SHORTEN the breath ───────────────────────────
//
// Grace is the default, so this file now needs the mirror of `likelyMore`: the
// signals that say he is done and the floor is HERS. Not "the sentence looks
// finished" — most finished sentences are followed by another one, which is the
// whole reason the default moved. Only the acts that actually hand the floor
// over: a question pointed at her, and a spoken "your turn".
//
// The bar is deliberately high. A false positive here re-creates the exact
// defect WS-BREATH exists to fix, so anything ambiguous keeps the full breath.

/** "tum", "you", "aap" — the message is pointed at her, not at the air. */
const SECOND_PERSON =
  /\b(?:tu|tum|tumhe|tumhein|tumhara|tumhari|tumne|tumko|aap|aapka|aapko|aapne|tera|teri|tere|tujhe|tujhko|you|your|yours|u|ur)\b/i;

/** The whole message is a handover: "tum batao", "your turn", "ab tu bol". */
const HANDOFF_PHRASE =
  /^(?:(?:ab|acha|achha|toh|to)\s+)?(?:tu|tum|tumhi|aap|you)?\s*(?:batao|bata|bolo|bol|boliye|tell me|go ahead|your turn|ur turn)\s*(?:na|naa|yaar|please|plz)?[.!?]*$/i;

export type CompletionStrength = "none" | "handoff" | "checkin";

export type Completion = {
  strength: CompletionStrength;
  /** which rule fired — for telemetry and for reading an eval failure */
  reason: string;
};

const NO_COMPLETION: Completion = { strength: "none", reason: "" };

/**
 * Has he handed her the floor?
 *
 * `checkin` is "hello??" — him asking whether she is there. It gets the fastest
 * reply in the product, which was an emergent property of the old wait and is
 * now said out loud, because an emergent property is one refactor from gone.
 *
 * `handoff` is a question aimed at HER, or an explicit "tum batao". A question
 * aimed at nobody in particular ("1000 rupay?", "sach me?") is NOT a handoff:
 * those are the shapes a person mutters and then keeps going, and pricing them
 * as handovers is how the 1.3 s default came back through a side door.
 */
export function handedOver(input: LikelyMoreInput): Completion {
  const his = input.his.filter((t) => (t || "").trim().length > 0);
  if (!his.length) return NO_COMPLETION;
  const raw = his[his.length - 1].trim();
  if (!norm(raw)) return NO_COMPLETION;

  if (leadingGreeting(raw)?.checkIn) return { strength: "checkin", reason: "check-in" };
  if (HANDOFF_PHRASE.test(norm(raw))) return { strength: "handoff", reason: "handoff-phrase" };
  if (!/\?\s*$/.test(raw)) return NO_COMPLETION;
  // An enumeration survives its own "?" in `likelyMore`; it must not be read as
  // a handoff here either, or the two halves of the file would disagree about
  // the same message.
  if (ENUMERATION.test(raw)) return NO_COMPLETION;
  if (OPEN_QUESTION.test(raw)) return { strength: "handoff", reason: "open-question-at-her" };
  if (SECOND_PERSON.test(raw)) return { strength: "handoff", reason: "question-at-her" };
  return NO_COMPLETION;
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
  /** `followUpRate(turns)` — how often he doubles. Omitted → the prior. */
  followUpRate?: number;
  /** the composer has keyboard focus right now */
  composerFocused?: boolean;
  /** the soft keyboard is up (the surface's own viewport sensing) */
  keyboardOpen?: boolean;
  /**
   * The last moment he did ANYTHING at the composer — focused it, opened the
   * keyboard, pressed a key. Never advances while he is idle, which is what
   * keeps every hold below bounded without needing a second clock.
   */
  lastEngagedAt?: number;
};

export type BurstReason =
  | "nothing-waiting"
  | "interject"
  | "due"
  | "waiting"
  | "continuation"
  | "composing"
  | "draft-paused"
  /** focused, or the keyboard is up, and he has not typed yet */
  | "attending"
  /** he just stopped — the beat before she takes the floor */
  | "settling";

export type BurstDecision = {
  /** reply NOW */
  fire: boolean;
  /** when to ask again, if not firing. Never 0, never past the ceiling. */
  recheckMs: number;
  reason: BurstReason;
  /** the wait this decision used, before the ceiling clamped it */
  waitMs: number;
  continuation: Continuation;
  /** what, if anything, handed her the floor */
  completion: Completion;
  /** how long his oldest unanswered message has been waiting */
  heldMs: number;
};

/**
 * How long a standing draft buys, by how much of the thought is on the screen.
 * The decay that replaced the flat ten-second cliff — see COMPOSE_ABANDON_MS.
 */
export function draftPauseMs(draftLength: number): number {
  const len = Math.max(0, draftLength || 0);
  return Math.min(
    COMPOSE_ABANDON_MS,
    Math.max(COMPOSE_PAUSE_MIN_MS, COMPOSE_PAUSE_MIN_MS + len * COMPOSE_PAUSE_PER_CHAR_MS),
  );
}

/**
 * THE POLICY. One function, so no surface can implement half of it.
 *
 * ── LIVENESS, as a provable property ───────────────────────────────────────
 * For any message of his at t0 that she has not answered, this function
 * returns `fire: true` at or before `t0 + BURST_INTERJECT_MS`, for EVERY
 * sequence of draft, keystroke, focus, keyboard, gap and content signals —
 * including a draft that is never cleared, keystrokes that never stop, a
 * composer that is focused forever, a keyboard that never closes, and fragments
 * that keep re-firing `likelyMore`.
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
  const done = handedOver({ his: s.his, herLast: s.herLast });

  // THE BREATH. Grace first, evidence after — the inversion WS-BREATH is.
  const base = burstWaitMs(s.gaps, s.followUpRate);
  const ceiling = cont.strength === "none" ? BURST_MAX_MS : BURST_CONT_MAX_MS;
  const graced = Math.min(ceiling, Math.max(BURST_MIN_MS, base + cont.bonusMs));
  // …and the only two things allowed to shorten it. `checkin` beats `handoff`
  // because "hello??" is both, and the answer to it is speed.
  const waitMs =
    done.strength === "checkin"
      ? BURST_MIN_MS
      : done.strength === "handoff"
        ? Math.min(graced, BURST_HANDOFF_MS)
        : graced;

  const firstAt = s.firstUnansweredAt || s.lastUserAt;
  const out = (fire: boolean, recheckMs: number, reason: BurstReason, heldMs: number): BurstDecision => ({
    fire,
    recheckMs,
    reason,
    waitMs,
    continuation: cont,
    completion: done,
    heldMs,
  });
  if (!firstAt) return out(false, waitMs, "nothing-waiting", 0);

  const heldMs = Math.max(0, s.now - firstAt);
  const deadline = firstAt + BURST_INTERJECT_MS;
  const left = deadline - s.now;

  // (a) THE CEILING, FIRST. She answers what she has; the rest is a follow-up.
  if (left <= 0) return out(true, 0, "interject", heldMs);
  // (c) nothing below may ask to sleep past the deadline.
  const capped = (ms: number) => Math.max(1, Math.min(ms, left));

  const dueAt = (s.lastUserAt || firstAt) + waitMs;
  if (s.now < dueAt) {
    return out(false, capped(dueAt - s.now), cont.strength === "none" ? "waiting" : "continuation", heldMs);
  }

  // ── THE ENGAGEMENT HOLD ──────────────────────────────────────────────────
  //
  // The breath has run out, so the question is no longer "might more be
  // coming" but "is he at the keyboard right now". A person does not start
  // talking over someone who is visibly about to speak, and the shipped
  // version could only see ONE form of visibly-about-to-speak — a non-empty
  // box with a keystroke in it. Focus, an open keyboard and a think-pause
  // before the first letter were all invisible, which is hole (b).
  //
  // Every hold below is an EXPIRY anchored to a timestamp that does not
  // advance while he is idle, so the liveness proof is untouched: the largest
  // expiry wins, `capped()` clamps it to the interjection deadline, and the
  // reason reported is the most specific state he is actually in. The decay is
  // the sequence itself — keystroke (3s) → draft, scaled by its length (3.5s
  // to 10s) → present at the keyboard (6s) → the settle beat (1.2s) — rather
  // than one threshold that dumps her the instant it passes.
  // ENGAGEMENT HAS TO BE FRESH, and this is the subtle half.
  //
  // "The composer is focused" is not evidence on its own: it is ALSO the state
  // every message leaves behind, because the box he just typed into keeps
  // focus and the soft keyboard stays up. Holding on standing focus would put
  // a six-second floor under every single message — the mirror of the bug
  // being fixed, arriving through its own fix, which is the shape
  // `stale-tail` already taught this file once.
  //
  // So only engagement that lands AFTER his last message counts: he came back
  // to the box, the keyboard came up again, he pressed a key. Sitting exactly
  // where he was when he hit send is not an act. Note what this also buys —
  // `lastEngagedAt` cannot be advanced by anything except a real event, so an
  // adversary holding focus open forever gets ONE hold, not an endless one.
  const engagedAt0 = Math.max(s.lastKeyAt || 0, s.lastEngagedAt || 0);
  const engagedAt = engagedAt0 > (s.lastUserAt || 0) ? engagedAt0 : 0;
  const present = Boolean(s.composerFocused || s.keyboardOpen);
  const drafting = s.draftLength > 0 && s.lastKeyAt > 0;

  let until = 0;
  if (drafting) {
    until = Math.max(until, s.lastKeyAt + COMPOSE_ACTIVE_MS, s.lastKeyAt + draftPauseMs(s.draftLength));
  }
  // Presence is the hold for the think-pause BEFORE the first letter. Once
  // there is a draft, the draft's own budget governs and this must not stack on
  // top of it — a standing keyboard behind an abandoned message would otherwise
  // add six seconds to a wait that had already been decided, which is dead air
  // wearing the fix's clothes.
  if (present && engagedAt && !drafting) until = Math.max(until, engagedAt + FOCUS_HOLD_MS);
  if (engagedAt) until = Math.max(until, engagedAt + SETTLE_MS);

  if (until > s.now) {
    const reason: BurstReason = drafting && s.now - s.lastKeyAt < COMPOSE_ACTIVE_MS
      ? "composing"
      : drafting && s.now < s.lastKeyAt + draftPauseMs(s.draftLength)
        ? "draft-paused"
        : present && engagedAt && !drafting && s.now < engagedAt + FOCUS_HOLD_MS
          ? "attending"
          : "settling";
    return out(false, capped(until - s.now), reason, heldMs);
  }

  return out(true, 0, "due", heldMs);
}
