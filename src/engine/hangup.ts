// "Cut the call" — recognising that HE wants the call to end.
//
// The owner's ask 6: "Call cut from her side, she can cut call from her side
// when she wants to maybe because she is angry or whatever or let's say I tell
// her to cut."
//
// ── why this reads HIS words and not hers ─────────────────────────────────
//
// The obvious build was a `[bye]` marker she emits, like `[gif:]` and
// `[photo:]`. The persona invariants rejected it, and they were right on a
// point that is easy to miss: on the VOICE lane, bracket-shaped text is not
// inert. `ack-bracket-direction` measured "[laughs softly]" coming back as
// laughter PLUS the spoken word "Softly", and the live lane emits the
// characters it speaks, so a hangup marker is a marker she can say out loud.
// The invariant that caps voice-lane bracket exemplars exists for exactly
// that, and CLAUDE.md's rule applies: if a change trips an invariant, the
// change is wrong.
//
// So this takes the half of the ask that IS structurally decidable. He says to
// cut; the client cuts. It needs no prompt text, it cannot be recited, and it
// works identically on the realtime lane (where there is no text of hers at
// all) and the cascade lane.
//
// Her SELF-initiated hangup — the angry half — is deliberately not here. It
// needs her intent, the live lane has no safe channel to express it, and a
// guess would end calls she meant to keep. Named in the register rather than
// approximated.
//
// ── the false-positive posture, which is the whole design ─────────────────
//
// Ending a call he wanted to keep is far worse than missing one he wanted
// ended: the miss costs him one tap on a button that is already on screen,
// while a false fire drops him mid-sentence and there is no undo. So every
// pattern below is an EXPLICIT request. "bye" alone is not here, and neither
// is "ok" — people say both constantly in the middle of calls.

/** Phrases that are a request to end the call, not a turn of conversation. */
const CUT_PATTERNS: readonly RegExp[] = [
  // English
  /\b(?:cut|end|drop|disconnect)\s+(?:the\s+)?call\b/i,
  /\bhang\s*up\b/i,
  /\b(?:let'?s|lets)\s+(?:talk|catch\s*up)\s+later\b/i,
  // Hinglish — "rakh de/do/dijiye", "phone rakh", "call kaat"
  // The imperative particle is REQUIRED, and the eval is why. Without it
  // "tera call kaat gaya tha kal" — past tense, about a call that already
  // ended yesterday — reads as a request to end THIS one. "kaat de" is an
  // instruction; "kaat gaya" is a story.
  /\b(?:phone|call)\s+(?:rakh|kaat|kat)\s*(?:de|do|dena|dijiye|dijiyega)\b/i,
  /\brakh\s+(?:de|do|dijiye|dena)\b/i,
  /\bcall\s+(?:cut|disconnect)\s*kar\w*\b/i,
  /\b(?:baad\s+me[ni]?|later)\s+baat\s+kar\w*\b/i,
  /\bmain\s+rakh\w*\s+hu\b/i,
  /\bchal\s+(?:rakh\w*|bye)\b/i,
];

/**
 * Did he just ask to end the call?
 *
 * Deliberately not fuzzy. A transcript is noisy and this is a destructive
 * action, so the bar is a phrase that has essentially one meaning.
 */
export function asksToHangUp(text: string): boolean {
  const t = (text || "").trim();
  if (t.length < 3) return false;
  return CUT_PATTERNS.some((re) => re.test(t));
}
