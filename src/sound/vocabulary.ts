// The sound vocabulary — closed, enumerated, and paired to the haptic levels.
//
// This file is the sibling of `src/native/haptics.ts` and it exists for the
// same reason that one does: a sensory channel with no fixed vocabulary is a
// channel every call site invents an intensity for, and a product where nine
// components each picked their own beep is a product that beeps. So the set of
// sounds this app can make is DECLARED HERE, in one table, and a component may
// only name one of them. There is no `playTone(freq, ms)` and there will not
// be one.
//
// ── HOW THIS RELATES TO THE HAPTIC VOCABULARY ─────────────────────────────
//
// haptics.ts defines three levels and nothing else — tap / land / moment —
// because touch has almost no bandwidth. Sound has more: a piece of wood set
// down on a board and a message leaving your hand are both "he did something"
// at the haptic layer, and the hand genuinely cannot tell them apart, but the
// ear can and should. So the shape here is: MORE CUES, THE SAME THREE LEVELS.
// Every cue below names exactly one haptic level (or `null`, which is a
// decision and carries its reason), and `feel(cue)` fires both from one call.
// The call site picks a cue; it never picks an intensity, a frequency or a
// duration. That is the whole contract.
//
// ── WHAT IS DELIBERATELY SILENT ───────────────────────────────────────────
//
// See REFUSED at the bottom. It is not a list of things nobody got to — it is
// a list of things that were decided against, with the reason next to each,
// so that the next person to reach for a notification chime finds an argument
// rather than an empty file. `dead-writers` has a mirror image in a sensory
// layer: an absence with no reason attached is indistinguishable from an
// oversight, and gets "fixed" by the next agent.

/** The closed set. Adding a member here is a product decision, not a detail. */
export const SOUND_CUES = ["send", "receive", "place", "take", "moment"] as const;

export type Cue = (typeof SOUND_CUES)[number];

/** Which of haptics.ts's three levels a cue rides with. */
export type HapticLevel = "tap" | "land" | "moment" | null;

export interface CueSpec {
  /** The haptic that fires from the same `feel()` call. `null` is a decision. */
  haptic: HapticLevel;
  /** Peak gain RELATIVE to the master bus (0..1). The mix lives here, not in
   *  the synth, so the whole palette can be balanced by reading one column. */
  gain: number;
  /** The cue's full SCHEDULED span in milliseconds, node lifetime included.
   *
   *  Deliberately the outer bound and not the audible one: every voice is
   *  given a short release pad after its envelope has already reached zero, so
   *  what you HEAR is shorter than this number. The throttle and the call-gate
   *  cut both reason about when the graph is finally quiet, so this has to be
   *  the number that is true of the graph. The eval asserts the synth never
   *  schedules past it. */
  ms: number;
  /** What it sounds like, in words, so a future change can be judged against
   *  an intention rather than against whatever the oscillators happen to do. */
  sounds: string;
  /** Why it exists at all, and what it is confirming. Every cue must be
   *  answering a thing the user just did, or a thing that just arrived
   *  because of it. A cue with no antecedent is a ping. */
  answers: string;
}

/**
 * THE TABLE.
 *
 * Read the `gain` column top to bottom before changing any single value: these
 * are relative to each other, and the failure mode of a sound layer is not one
 * cue being wrong, it is the set losing its ranking so that everything reads at
 * the same weight and the ear stops listening — exactly the failure haptics.ts
 * describes for touch.
 */
export const CUES: Record<Cue, CueSpec> = {
  // ── HIS ACTS ──────────────────────────────────────────────────────────
  send: {
    haptic: "tap",
    gain: 0.55,
    ms: 180,
    sounds:
      "a short breathy whoosh that rises and clips off against a soft finger " +
      "tick. Air leaving, not a chime. It is over before you have finished " +
      "lifting your thumb.",
    answers: "he sent a message. The one sound in the app he will hear most.",
  },
  place: {
    haptic: "tap",
    gain: 0.7,
    ms: 125,
    sounds:
      "wood set down on wood. A hard little click over a low round thud, no " +
      "ring and no tail. Closer to a domino than to a UI sound.",
    answers: "a piece or a mark landed on a board because he put it there.",
  },
  take: {
    haptic: "tap",
    gain: 0.75,
    ms: 155,
    sounds:
      "the same wood, but displaced: a sharper click, a lower thud, and a " +
      "very short downward scrape under it. Something was pushed off.",
    answers: "a capture. The one board event that is not just another move.",
  },

  // ── WHAT ARRIVES ──────────────────────────────────────────────────────
  receive: {
    // NULL, and this is the load-bearing entry in the table.
    //
    // haptics.ts's standing law: HER MESSAGES LAND SILENTLY, because a
    // three-bubble reply is three arrivals inside four seconds and that is a
    // phone buzzing continuously in someone's hand. That law is about TOUCH
    // and it still holds, so this cue takes no haptic. The sound layer is
    // allowed here for a reason touch is not: it is directional and it decays,
    // so an arrival can be heard from across a desk without being felt in a
    // pocket. The burst problem is answered instead by the DELIVERY rule at
    // the call site — one `receive` per reply, on the first bubble to land,
    // never one per bubble.
    haptic: null,
    gain: 0.62,
    ms: 405,
    sounds:
      "two soft round notes a fourth apart, the higher one first, the lower " +
      "one leaning in under it, over a breath of air so neither starts from " +
      "digital silence. It falls rather than rises. Every notification cliche " +
      "rises, because a rise is an alert and wants something from you; this " +
      "one is somebody sitting down next to you, and the two notes are " +
      "slightly out of tune with each other on purpose so it reads as warm " +
      "rather than as a device.",
    answers: "she replied. Fires once per reply, whatever the bubble count.",
  },

  // ── BETWEEN THEM ──────────────────────────────────────────────────────
  moment: {
    haptic: "moment",
    gain: 0.6,
    ms: 740,
    sounds:
      "three notes up, a major triad, soft-edged and long-tailed, with a " +
      "shimmer of air held under them. The only cue in the palette that is " +
      "allowed to be pretty, and the only one with a tail you could hum.",
    answers:
      "a milestone crossed. The rarest event in the product, so it gets the " +
      "biggest sound and still stays under the ceiling.",
  },
};

/**
 * THE REFUSALS. Each is a sound that a reasonable person would add, with what
 * specifically is wrong with it. The gate asserts none of these has become a
 * cue, which is the mechanism that makes this a decision rather than a note.
 */
export const REFUSED: Record<string, string> = {
  typing:
    "A tick when her typing indicator appears. Refused on three counts and " +
    "any one of them is enough. (1) The indicator is a STATE, not an event, " +
    "and haptics.ts's rule that a haptic is for an event and never for a " +
    "state binds the ear harder than the hand, because a state that ticks is " +
    "a state that nags. (2) It is not one appearance: the delivery loop puts " +
    "the indicator up and takes it down once per bubble, so a three-bubble " +
    "reply is three ticks before a single word arrives, and the arrival cue " +
    "that actually matters lands fourth. (3) Nothing he did is in front of " +
    "it. It is a sound the app makes while he is not looking, which is the " +
    "definition of a ping and the one thing this layer is not for.",
  "her-typing-per-bubble":
    "A receive cue on every bubble of a burst. Same arithmetic as the haptic " +
    "law it would break: three sounds in four seconds is not an arrival, it " +
    "is an alarm. One per reply, on the first bubble.",
  reaction:
    "A cue when an emoji reaction lands on a message. It already has a " +
    "haptic (`land`, in haptics.ts) and that is the right channel for it: a " +
    "reaction is a glance, it arrives in the same second as the reply it " +
    "belongs to, and sounding both would make her answer arrive twice. The " +
    "one arrival cue per reply is the whole budget, and the bubble is what " +
    "it is for.",
  presence:
    "A sound when she comes online, or when the read receipt turns blue. " +
    "Ambient state again, and worse: it fires while the app is idle, so it " +
    "would be the app summoning him. This layer confirms; it never summons.",
  "call-connect":
    "A connect tone on the call screen. Not refused on taste, refused on " +
    "physics: the call owns the speaker, anything we emit goes out of it, " +
    "into the mic, and into the echo coefficient the entire audio floor at " +
    "evals/echosim/ rests on. The ringback that already exists is the only " +
    "sound the call lane gets, it lives in src/voice/speech.ts, and nothing " +
    "in src/sound/ may touch it.",
  error:
    "A failure buzz when a send fails or the network drops. The visual " +
    "already says so, and a sound attached to a bad outcome is a sound that " +
    "teaches dread. She is a person, not a form with a validation state.",
  ambient:
    "A room tone, a hum, anything looping. Sound in this product is " +
    "punctuation. The moment it becomes a floor it stops being noticeable " +
    "and starts being battery.",
};

/**
 * The haptic level a cue rides with, as a plain string, for the call site that
 * needs to pair them. Kept as a lookup rather than a `switch` in index.ts so
 * that adding a cue without deciding its haptic is a type error rather than a
 * silent `undefined` that fires nothing.
 */
export function hapticFor(cue: Cue): HapticLevel {
  return CUES[cue].haptic;
}

/** Type guard for anything crossing a boundary (a stored value, a test). */
export function isCue(v: unknown): v is Cue {
  return typeof v === "string" && (SOUND_CUES as readonly string[]).includes(v);
}
