// roomsVocabAllowlist.mjs — the ONLY exceptions to the Rooms vocabulary rule
// in scripts/check-copy.mjs (WS-R10). Every entry here is LEGAL text: a
// disclosure a person already heard, or a consent statement a person already
// affirmatively checked. Renaming the words under a live consent artifact is
// the exact failure `safety-floor-teacher.md` §2.1 names and
// `context/decisions.md`'s `demo-teacher-is-not-a-placeholder` law generalizes:
// a fixture (or a rewrite) may never stand in on a consent surface.
//
// This file is checked by an exact substring match against the file's
// relative path and the extracted visible text, so a new offending string
// cannot silently ride in on an entry meant for something else. Add an entry
// ONLY for text that is genuinely part of a disclosure a listener/reader
// already received or a statement a person already consented to. Everything
// else gets the words changed, not exempted.
export const ROOMS_VOCAB_ALLOWLIST = [
  {
    file: "src/studio/DisclosurePreview.tsx",
    match: "You're talking with an AI clone of",
    reason:
      "the session-open disclosure card, copied verbatim from safety-floor-teacher.md §1.1; a teacher already approved these exact words as what a student sees, and safety-floor-teacher.md §2.1 forbids moving a consent artifact's words under it",
  },
  {
    file: "src/studio/DisclosurePreview.tsx",
    match: "I'm an AI clone of",
    reason:
      "the spoken-opening disclosure, copied verbatim from safety-floor-teacher.md §1.2; same reasoning as the card above, and it is also literally what a synthesized voice already says on a live call",
  },
  {
    file: "src/studio/ModelConsentGate.tsx",
    match: "I am creating only my own private replica",
    reason:
      "a consent-ceremony statement the teacher affirmatively checks before any replica is built; the wording is what was consented to and cannot move under an existing receipt",
  },
  {
    file: "src/studio/ModelConsentGate.tsx",
    match: "I authorize creation of revocable voice embeddings",
    reason: "consent-ceremony legal statement, same reasoning",
  },
  {
    file: "src/studio/ModelConsentGate.tsx",
    match: "I authorize private training or adaptation of a voice model",
    reason: "consent-ceremony legal statement, same reasoning",
  },
  {
    file: "src/studio/ModelConsentGate.tsx",
    match: "queues derived models and provider copies for verified deletion",
    reason: "consent-ceremony legal statement, same reasoning",
  },
];

/** True when `(rel, text)` is a documented legal exception to rooms-vocabulary. */
export function isRoomsVocabAllowed(rel, text) {
  return ROOMS_VOCAB_ALLOWLIST.some((e) => rel === e.file && text.includes(e.match));
}
