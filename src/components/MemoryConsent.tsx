// THE MEMORY QUESTION — asked once, on its own, in plain words.
//
// India's DPDP Act reaches full effect on 2027-05-14. Storing cross-session
// personal and emotional memory about a person needs its OWN specific,
// informed, unbundled consent: not a line in a terms-of-service checkbox, not
// a clause folded into the 18+ confirmation on step one, and not a thing
// inferred from someone continuing to use the app. Penalties reach Rs 250 Cr.
// (context/measurements.md, market sweep 2026-08.)
//
// That is the legal reading. The product reading is better and points the same
// way: her remembering you IS the product, so the moment she asks permission
// to do it is the moment the product explains itself. Asked early, calmly, in
// the same glass the rest of the first minute is made of, it reads as a trust
// feature rather than as a compliance banner. That is why this is a step in
// onboarding and not a dialog bolted onto the first message.
//
// ── WHAT LIVES HERE ───────────────────────────────────────────────────────
//
//   MEMORY_COPY          the words, in ONE place. Three surfaces show this
//                        question (onboarding step 4, the one-time card for
//                        people who onboarded before this existed, and the
//                        Memory screen in More) and three copies of a consent
//                        text is how two of them end up describing something
//                        the third does not do.
//   MemoryConsentBody    the explanation, without buttons. Both card shells
//                        wrap it.
//   MemoryConsentPrompt  the non-modal card for existing users.
//
// ── THE COPY RULES ────────────────────────────────────────────────────────
//
// Product chrome, never her voice: she does not ask for permissions, an app
// does. No em-dashes (scripts/check-copy.mjs gates it). And every clause is
// checkable against this repo rather than aspirational, which is the standard
// NotifySheet.tsx sets for the other permission this product asks for:
//
//   "so she can be the same person tomorrow"  — the whole memory stack
//   "stored so she can remember you, and for nothing else" — there is no ad
//        code in this repo and no third party receives memory rows
//   "you can make her forget all of it, any time" — MoreSheet's forget door,
//        which is the same wipe this screen's own "Stop remembering" runs
//   "Your chat stays on this phone until you clear it" — localStorage is not
//        touched by declining, and saying otherwise would be the one kind of
//        lie a consent screen cannot afford. See the gate note in
//        src/engine/memory.ts for exactly what declining does stop.

interface BodyProps {
  /** their name, when we already have it (onboarding asks for it first) */
  name?: string;
}

export const MEMORY_COPY = {
  title: "Should she remember you?",
  lede:
    "The whole point of her is that she is the same person tomorrow. That only works if she keeps a few things.",
  keeps: [
    "Your conversations, so she never starts over.",
    "What you tell her about your life: the people, the plans, the small stuff.",
    "Moments you two share, like a game you played or a picture you sent.",
  ],
  only:
    "It is stored so she can remember you, and for nothing else. Never sold, never used for ads.",
  undo: "You can make her forget all of it, any time, from the menu.",
  yes: "Haan, yaad rakhe",
  no: "Not now",
  /** what "Not now" actually means, stated where it is chosen */
  noMeans:
    "She will still talk to you. Nothing you say gets stored for her to remember later, and she will not build a memory of you. Your chat stays on this phone until you clear it.",
} as const;

/** The explanation itself. No buttons: each shell owns its own actions. */
export function MemoryConsentBody({ name }: BodyProps) {
  return (
    <>
      <p className="mc-lede">{MEMORY_COPY.lede}</p>
      <ul className="mc-keeps">
        {MEMORY_COPY.keeps.map((k) => (
          <li key={k}>{k}</li>
        ))}
      </ul>
      <p className="mc-fine">
        {MEMORY_COPY.only} {MEMORY_COPY.undo}
        {name ? ` Nothing changes about how she talks to you, ${name}.` : ""}
      </p>
    </>
  );
}

interface PromptProps {
  onGrant: () => void;
  onDecline: () => void;
}

/**
 * THE ONE-TIME CARD FOR PEOPLE WHO WERE ALREADY HERE.
 *
 * Someone who onboarded before this step existed has a relationship in
 * progress, and a modal wall across it would be a product that took her away
 * until they agreed to something. So this is the NotifySheet pattern exactly:
 * the same `.sheet` shell, non-modal, no veil, nothing for the hardware back
 * key to trap, rendered over home only and only when nothing else is open. It
 * covers nothing and it is still there next time if they walk past it.
 *
 * Memory keeps working while the question is unanswered, and that is the
 * deliberate reading rather than the convenient one: `memoryWritesAllowed`
 * treats an absent record as yes because these people were never asked, and
 * the answer to never-asked is to ask, not to switch off a relationship
 * underneath someone at a time they did not choose. Answering it either way is
 * what makes the record exist.
 */
export function MemoryConsentPrompt({ onGrant, onDecline }: PromptProps) {
  return (
    <div className="sheet" role="region" aria-label="Memory">
      <div className="grab" />
      <h3>{MEMORY_COPY.title}</h3>
      <div className="mc-body">
        <MemoryConsentBody />
      </div>
      <div className="confirm-actions">
        <button className="btn-primary" data-tel="consent.grant" onClick={onGrant}>
          {MEMORY_COPY.yes}
        </button>
        <button className="btn-ghost" data-tel="consent.decline" onClick={onDecline}>
          {MEMORY_COPY.no}
        </button>
      </div>
      <p className="auth-fine" style={{ marginTop: 16 }}>
        {MEMORY_COPY.noMeans}
      </p>
    </div>
  );
}
