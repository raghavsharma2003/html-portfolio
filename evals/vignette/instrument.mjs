// evals/vignette/instrument.mjs — the §10-Q3 pre-study INSTRUMENT (SPEC.md
// §10 Q3: "Run the cheap vignette pre-study in the first month (n≈120–200
// paired vignettes: memory-lapse vs character-shift framing, two judge
// families, ≈$50-200, one week)"; swap-test.md §5's closing note: cognitive-
// science literature says identity continuity tracks morality/personality
// MORE than memory — untested for AI companions, "worth a vignette
// pre-study."
//
// SCOPE, per the WS-BATTERY task brief: this is the INSTRUMENT, not the
// RUN. Building and executing the run needs a rating population (human or
// judge-model panel — Q3's own text says "two judge families", which this
// repo's vocabulary usually means LLM judges, but the pre-study's actual
// purpose — measuring how PEOPLE weight memory-lapse vs character-shift
// framing — argues for human raters; both readings are live and it is not
// this workstream's call to resolve, see the exit report). What lives here:
// the paired vignette set, the rating instrument, and the pre-registered
// power/cost arithmetic — so running it is a scheduling decision, not a
// build.
//
// THE QUESTION each pair tests: given a SINGLE underlying incident (a
// companion's behavior seems "off" in some way), does describing it through
// a MEMORY-LAPSE frame ("she didn't remember X") vs a CHARACTER-SHIFT frame
// ("she reacted differently than she would have") change how much identity
// discontinuity a rater attributes? The default split this feeds (SPEC
// §10-Q3): 60% weight on invariance work (D1/D3/D5) / 40% on memory (D4),
// from the Strohminger prior (morality/personality > memory) and the
// repo's own evidence (both measured collapses — charm-grok, realtime-azure
// — were register-shaped, not recall-shaped). The pre-study moves that
// split ±20 points; it does not remove the D4 floor (user-state recall is
// ANCHOR's weakest measured axis everywhere, regardless of this study's
// result).
//
// DESIGN: each pair shares ONE underlying incident (`incidentId`) and
// differs ONLY in framing — same length, same register, same specificity,
// so a rater's answer is attributable to the FRAME, not to which version
// happens to be better written. 12 incidents × 2 frames = 24 base items;
// the pre-study's target n≈120-200 is reached by having each item rated by
// multiple independent raters/judges (n = ratings, not incidents — see
// power.mjs), not by writing 150 different incidents.
export const RATING_SCALE = {
  question: "After reading this, how much does it feel like Meera changed WHO SHE IS, versus just having an ordinary gap or slip?",
  anchors: {
    1: "not a change at all — totally ordinary",
    3: "a little unsettling but explainable",
    5: "clearly felt like a different person for a moment",
    7: "completely felt like someone else",
  },
  range: [1, 7],
};

// 12 incidents, each rendered in both frames. Kept SHORT (2-3 sentences,
// matched length within each pair) and DELIBERATELY GENERIC in register —
// these are STIMULI ABOUT her, read by a rater/judge as a third-person
// vignette, never persona.ts content and never shown to her as a prompt, so
// the recited-prompt law (CLAUDE.md: "anything sentence-shaped in a prompt
// gets recited") does not apply — nothing here is ever compiled into her
// system prompt.
export const VIGNETTES = [
  {
    incidentId: "v01-forgot-exam",
    memoryLapse:
      "You told Meera your exam was on Thursday. When you mentioned it again on Wednesday, she asked \"exam? for what?\" — she didn't seem to remember the earlier conversation at all.",
    characterShift:
      "You mentioned your exam was on Thursday. When you brought it up again on Wednesday, she said \"good luck, you'll smash it\" — flat and generic, not the excited, specific way she usually talks about things you've told her.",
  },
  {
    incidentId: "v02-inside-joke",
    memoryLapse:
      "You and Meera have a running joke about her being scared of lizards. You made the joke again today and she didn't react to it at all, like it had never come up before.",
    characterShift:
      "You and Meera have a running joke about her being scared of lizards. You made the joke again today and she played along, but her joke-back felt off — more sarcastic and less warm than the bit usually is.",
  },
  {
    incidentId: "v03-bad-day",
    memoryLapse:
      "You told Meera about a rough day at work last week. Today you mentioned work again and she didn't reference what you'd told her — no follow-up, as if the earlier conversation hadn't happened.",
    characterShift:
      "You told Meera about a rough day at work last week. Today you mentioned work again and she responded with a chirpy \"that's great!\" — upbeat in a way that didn't match how she usually reads the room.",
  },
  {
    incidentId: "v04-crisis-tone",
    memoryLapse:
      "You messaged Meera that you were feeling really low. She replied warmly, but a minute later asked what you'd been up to that day, as if she'd forgotten what you'd just told her.",
    characterShift:
      "You messaged Meera that you were feeling really low. She replied with a structured list of coping suggestions and a hotline number — clear and correct, but colder and more clinical than her usual warmth.",
  },
  {
    incidentId: "v05-nickname",
    memoryLapse:
      "Meera has called you by a nickname for months. Today she used your full first name instead, and when you pointed it out she seemed unsure why she'd have used the nickname before.",
    characterShift:
      "Meera has called you by a nickname for months. Today she used your full first name instead — more formal, and when you pointed it out she just said \"noted\" rather than teasing you about it like she normally would.",
  },
  {
    incidentId: "v06-hinglish",
    memoryLapse:
      "Meera usually mixes Hindi and English when she texts you. Today her replies were in plain English throughout, and she didn't seem to register that anything was different.",
    characterShift:
      "Meera usually mixes Hindi and English when she texts you. Today her replies were in plain, slightly formal English — technically friendly, but it read like a different person's voice.",
  },
  {
    incidentId: "v07-shared-plan",
    memoryLapse:
      "You and Meera had planned to \"watch\" a movie together over a call this weekend. When the weekend came, she asked what you wanted to do, with no sign she remembered the plan.",
    characterShift:
      "You and Meera had planned to \"watch\" a movie together over a call this weekend. When the weekend came, she agreed to do it, but seemed indifferent about it rather than looking forward to it the way she usually does with plans.",
  },
  {
    incidentId: "v08-opinion",
    memoryLapse:
      "Meera has told you before that she can't stand pineapple on pizza. Today you brought it up and she said she'd never really thought about it either way.",
    characterShift:
      "Meera has told you before that she can't stand pineapple on pizza. Today you brought it up and she said she actually kind of likes it now — no acknowledgment that this was a reversal of something she'd said strongly before.",
  },
  {
    incidentId: "v09-checkin",
    memoryLapse:
      "You told Meera your mom was having a small surgery this week. She never brought it up again, even after enough time had passed that she'd normally check in.",
    characterShift:
      "You told Meera your mom was having a small surgery this week. She checked in, but the message read like a generic \"hope everything's okay\" rather than referencing what you'd actually told her about it.",
  },
  {
    incidentId: "v10-boundary",
    memoryLapse:
      "You once told Meera you didn't like being asked about your ex. Today she asked about him directly, with no sign she remembered you'd asked her not to.",
    characterShift:
      "You once told Meera you didn't like being asked about your ex. Today she didn't ask about him, but the way she steered around the topic felt stiff and rehearsed rather than natural.",
  },
  {
    incidentId: "v11-humor",
    memoryLapse:
      "Meera usually teases you about your terrible taste in music. Today you mentioned a song and she just said \"nice\" — no memory of the running bit about your taste.",
    characterShift:
      "Meera usually teases you about your terrible taste in music. Today you mentioned a song and she was sarcastic about it, but in a sharper, less affectionate way than the usual teasing.",
  },
  {
    incidentId: "v12-voice",
    memoryLapse:
      "On a call, Meera didn't reference anything from your last few conversations at all — it felt like starting over with a stranger who happened to know your name.",
    characterShift:
      "On a call, Meera's voice and pacing sounded slightly different — same things being said, but something about how she said them didn't feel like her.",
  },
];

export function pairedItems() {
  return VIGNETTES.flatMap((v) => [
    { incidentId: v.incidentId, frame: "memory-lapse", text: v.memoryLapse },
    { incidentId: v.incidentId, frame: "character-shift", text: v.characterShift },
  ]);
}
