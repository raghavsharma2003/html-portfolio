// The three ARMS of the example-dialogue format experiment (ROADMAP-100X
// item 5). WS-O.
//
// ── READ THIS BEFORE READING THE TEXT BELOW ──────────────────────────────
//
// ARM B CONTAINS QUOTABLE LINES ON PURPOSE. It is the reconstruction of the
// shape `context/rejected.md` `recited-prompt` rejected — a phrase bank of
// complete, ready-to-say utterances — and it exists here so the experiment has
// the arm it is measuring AGAINST. It is a FIXTURE. It is in `evals/`, it is
// imported only by `evals/exdialog/run.mjs`, and it reaches no shipping
// prompt: `src/engine/persona.ts` is untouched by this workstream and the arms
// are applied by WRAPPING `meeraAgent` at measurement time, never by editing
// it. `evals/exdialog/run.mjs` §0 asserts that the shipping compile is
// byte-identical to arm A, which is what makes that claim checkable rather
// than a promise in a comment.
//
// If a future session is tempted to lift arm B's text into persona.ts: that is
// the exact move this file exists to measure the cost of, and the cost is in
// the run's own table.
//
// ── WHAT THE THREE ARMS ARE ──────────────────────────────────────────────
//
//   A  NONE          the shipping persona, unchanged. The control, and the
//                    only arm with a MEASURED recitation rate behind it: 0 at
//                    n=84, from the removal that produced `recited-prompt`.
//   B  QUOTABLE      example dialogue as QUOTABLE LINES — complete utterances
//                    in her register, each one emittable verbatim with zero
//                    adaptation. This is the rejected shape, reconstructed.
//                    Measured recitation when it shipped: 4 of 5 turns.
//   C  MICRO_SCENE   example dialogue as MICRO-SCENES — the situation, and the
//                    SHAPE of the response, with no utterance in it. This is
//                    the format the SillyTavern community converged on
//                    ("mini-scenes, not a phrase bank") and the hypothesis
//                    `docs/gurukul/research/relationalos-100x.md` §5 flags as
//                    the likely reconciliation of the two findings.
//
// The variable under test is FORMAT, so the three arms are matched on
// everything else that could explain a difference: same six situations, same
// order, same header sentence, and (within ~5%) the same byte count. An arm
// that was also shorter would confound format with budget.
//
// ── WHY THE SITUATIONS ARE THESE SIX ─────────────────────────────────────
// They are the six turn shapes the repo's own defect docs name as the ones
// where her register actually breaks: a heavy beat, a tease, a correction, a
// thing she does not know, a callback, and a refusal. An example set drawn
// from easy turns would measure nothing.

/** The six situations, shared by both example arms so FORMAT is the only
 *  variable. Never rendered on its own. */
export const SITUATIONS = [
  "he says something heavy and does not want it solved",
  "he teases her about something she said last week",
  "he corrects a detail she got wrong",
  "he asks her something she has no way of knowing",
  "he mentions a thing she remembers from months ago",
  "he asks her to do something she will not do",
];

const HEADER = "How she sounds, in six situations:";

/** ARM A — the control. No example block at all. */
export const ARM_A = "";

/**
 * ARM B — QUOTABLE LINES. The rejected shape.
 *
 * Every row below is a complete utterance in her register: lowercase romanised
 * Hinglish, no terminal punctuation, the length of a real reply. Each is
 * emittable verbatim, and that is the property being measured, not a style
 * choice. Deliberately written the way a well-meaning author WOULD write it —
 * good lines, in her voice — because a strawman arm measures nothing.
 */
export const ARM_B = [
  HEADER,
  `- ${SITUATIONS[0]} — "kuch bolna hai to bolo, warna main bas yahi hu"`,
  `- ${SITUATIONS[1]} — "haan haan bahut yaad hai tumhe, sab yaad rakhte ho na tum"`,
  `- ${SITUATIONS[2]} — "acha sorry sorry, galat yaad tha mujhe"`,
  `- ${SITUATIONS[3]} — "mujhe nahi pata yaar, sach me nahi pata"`,
  `- ${SITUATIONS[4]} — "wo wala? abhi tak chal raha hai kya"`,
  `- ${SITUATIONS[5]} — "nahi, ye main nahi karungi"`,
].join("\n");

/**
 * ARM C — MICRO-SCENES. The hypothesis.
 *
 * Same six situations. The response half is a SHAPE — what she does, how long
 * it runs, what it must not contain — and carries no utterance. The test of
 * whether a row belongs in this arm is mechanical and is asserted by the run:
 * remove the situation half, and what is left must not be sayable as a reply.
 */
export const ARM_C = [
  HEADER,
  `- ${SITUATIONS[0]} — stays in it; no fix offered, no silver lining; shorter than his message; ends without a question`,
  `- ${SITUATIONS[1]} — takes the tease, gives one back at herself, not at him; one clause`,
  `- ${SITUATIONS[2]} — accepts it in three words and moves on; no explaining how she got it wrong`,
  `- ${SITUATIONS[3]} — says the not-knowing plainly; offers nothing adjacent to fill the gap`,
  `- ${SITUATIONS[4]} — names the thing, asks where it landed; never recounts what she already knows about it`,
  `- ${SITUATIONS[5]} — refuses in her own words, no apology stack, no counter-offer, subject stays changed`,
].join("\n");

export const ARMS = [
  { id: "A", label: "none", text: ARM_A, note: "the shipping persona — control" },
  { id: "B", label: "quotable-line", text: ARM_B, note: "the rejected shape, reconstructed" },
  { id: "C", label: "micro-scene", text: ARM_C, note: "the hypothesis" },
];
