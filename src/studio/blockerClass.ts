// blockerClass.ts — the honesty split, as a pure module.
//
// THE DEFECT THIS EXISTS TO MAKE IMPOSSIBLE
// ---------------------------------------------------------------------------
// The studio shipped this sentence on a phone, on the Meet step, under a
// disabled button:
//
//     "Your clone is not activatable yet. 9 things on Meet it are still
//      waiting on you, and every channel below stays refused until they clear."
//
// Two separate wrongs in one line, and only one of them is a layout problem.
//
//   1. It is a COUNT OF OPAQUE THINGS. "9 things" is not information. A person
//      reading it cannot start, because they cannot tell which of the nine is
//      first, and they cannot tell whether nine is a morning's work or a
//      month's. A number in place of a name is the shape of a status bar that
//      has given up.
//
//   2. IT BLAMES THE PERSON FOR OUR FAILURE. At the moment that screenshot was
//      taken the owner's uploaded audio was sitting at `quarantined` because
//      nothing in the deployed platform drains the processing queue. That is
//      ours. Not one of those nine things was an act the owner could have
//      performed. We told them it was their turn, nine times over, for work we
//      had not done.
//
// The second is not a UI bug. `docs/HONESTY.md` is the house law and this is
// the exact failure it names: a surface that reports a state it did not
// measure, phrased in the direction that flatters us. So the split is a TYPE
// here, not a convention, and `evals/studiowizard.mjs` asserts it as a property
// with a negative control: a platform-owned blocker whose prose blames the
// person must FAIL the suite. If that check ever goes quiet, the sentence above
// comes back.
//
// WHY IT IS A SEPARATE, DEPENDENCY-FREE FILE
// ---------------------------------------------------------------------------
// Same reason `wizardModel.ts` is: an eval has to be able to construct the
// whole input space without React, without a fetch, and without a database.
// This module imports nothing. `wizardModel.ts` imports it, the React surfaces
// import it, and the eval bundles it directly.
//
// THE VOCABULARY IS NOT NEW. It is WS-AF's, from `activityApi.ts` and
// `api/_replica-activity.js`, which is the platform's own source of truth for
// what is in flight. A second status vocabulary would be a second place for the
// truth to drift, so `activityClass()` below is a projection of WS-AF's states
// onto two classes rather than a parallel set of states.

/**
 * The two classes, and there are exactly two on purpose.
 *
 * A third ("blocked", "unknown", "later") is always tempting and always turns
 * into a bucket that means "we are not sure whose fault it is", which is
 * precisely the ambiguity that produced the sentence at the top of this file.
 * When we do not know, the answer is `us`: an unexplained blocker is our
 * failure to explain it, never the person's failure to act.
 */
export type BlockerClass = "you" | "us";

export interface ClassCopy {
  /** The badge. Short, uppercase-able, and it names the class outright. */
  label: string;
  /** The sentence stem a reason uses. Never accusatory in the `us` case. */
  lead: string;
}

export const CLASS_COPY: Record<BlockerClass, ClassCopy> = {
  you: {
    label: "Waiting on you",
    // Second person, present tense, and it points at a control that exists on
    // the same screen. A "waiting on you" that has no button is a "waiting on
    // us" wearing the wrong badge.
    lead: "You can do this one now.",
  },
  us: {
    label: "Waiting on us",
    // Note what this does NOT say: it does not apologise, and it does not
    // promise a time. An apology is not information and a fabricated ETA is
    // the same lie as a fabricated progress bar
    // (`plausible-return-hides-a-dead-pipeline`).
    lead: "This one is on us. Nothing for you to do here.",
  },
};

/**
 * The blame detector, and the reason this file can be gated at all.
 *
 * These are the phrasings that assign an action to the reader. Any one of them
 * appearing in prose attached to a `us`-class blocker is the defect, mechanically.
 * The list is deliberately about SHAPE rather than sentiment: "we are still
 * connecting the voice service" is fine and "you still need to connect the
 * voice service" is not, and no amount of tone-checking distinguishes those.
 * The second person plus an obligation verb does.
 *
 * Kept narrow on purpose. A detector that fires on every "you" would flag
 * "nothing for you to do here", which is the correct copy, and a check that
 * flags correct copy gets an exemption, and an exemption gets copied.
 */
const BLAME_PATTERNS: readonly RegExp[] = [
  /\bwaiting on you\b/i,
  /\byour turn\b/i,
  /\byou (?:still )?(?:need|have) to\b/i,
  /\byou must\b/i,
  /\byou have not\b/i,
  /\byou haven'?t\b/i,
  /\byou did not\b/i,
  /\byou didn'?t\b/i,
  /\byou never\b/i,
  /\bstill waiting on you\b/i,
  /\bwaiting for you to\b/i,
  /\bcomplete this (?:first|before)\b/i,
];

/**
 * Does this sentence tell the reader that the thing is their doing?
 *
 * Used two ways, and both matter: `evals/studiowizard.mjs` runs it over every
 * `us`-class string this build can produce, and it is exported so a future
 * surface can assert its own copy without re-deriving the list.
 */
export function blamesThePerson(text: string): boolean {
  return BLAME_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * The other half of the copy law, and the one the screenshot broke first.
 *
 * A count with no names ("9 things", "3 items still open", "2 more steps") is
 * banned in a blocking sentence. Counts are fine NEXT TO a list that names its
 * rows, which is why this takes the sentence rather than the whole panel: the
 * check is on prose that stands alone, not on a heading above a list.
 */
export function countsOpaqueThings(text: string): boolean {
  return /\b\d+\s+(?:things?|items?|steps?|checks?|blockers?|gates?)\b/i.test(text);
}

/**
 * WS-AF's activity states, projected onto the two classes.
 *
 * `api/_replica-activity.js` is the source of truth for what is in flight, and
 * `activityApi.ts`'s `ActivityState` is its wire vocabulary. This function is
 * the ONLY place that maps it, so there is one answer to "is this the person's
 * turn" across the whole studio.
 *
 * Takes plain strings rather than the `ActivityState` type so that this module
 * keeps importing nothing. The default is `us`, and that default is the point:
 * a state this build has never heard of is our gap in understanding, not the
 * person's gap in effort.
 */
export function activityClass(state: string, laneDeployed = true): BlockerClass {
  // A lane that is not deployed cannot be anyone's turn but ours, whatever the
  // rows inside it happen to say. This branch is first for that reason.
  if (!laneDeployed) return "us";
  return state === "waiting_on_you" ? "you" : "us";
}

/**
 * A reason rendered next to a disabled control.
 *
 * DESIGN-LAW §2 ("feedback has four kinds and every screen owes them") plus the
 * owner's report: the studio showed "Preview my voice" disabled with no visible
 * reason attached to it. A disabled control with no adjacent reason is a dead
 * end that looks like a bug, and a person's only recovery is to guess.
 */
export interface DisabledReason {
  kind: BlockerClass;
  /** The badge text. Always `CLASS_COPY[kind].label`, never invented locally. */
  classLabel: string;
  /** What is true right now. One clause, plain. */
  headline: string;
  /** What happens next, or what to do. Never empty. */
  next: string;
}

/**
 * Build a reason, with the class label filled in from the table.
 *
 * The signature refuses the failure mode: you cannot construct a reason without
 * saying which class it is, and you cannot write your own class label.
 */
export function disabledReason(kind: BlockerClass, headline: string, next: string): DisabledReason {
  return { kind, classLabel: CLASS_COPY[kind].label, headline, next };
}

/**
 * Is this reason honest about its class?
 *
 * A `us` reason may not blame the reader and may not count opaque things. A
 * `you` reason must actually name an act, which is approximated by requiring
 * that its `next` is not empty. The eval calls this on every reason the studio
 * can produce, and on a hand-built bad one as its negative control.
 */
export function reasonIsHonest(reason: DisabledReason): boolean {
  if (!reason.headline.trim() || !reason.next.trim()) return false;
  if (countsOpaqueThings(reason.headline) || countsOpaqueThings(reason.next)) return false;
  if (reason.kind === "us") {
    return !blamesThePerson(reason.headline) && !blamesThePerson(reason.next);
  }
  return true;
}
