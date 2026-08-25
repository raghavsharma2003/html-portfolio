// HER VOICE ON THE LOCK SCREEN — what a notification is allowed to say.
//
// This file is pure (no plugin, no DOM, no clock beyond what is passed in) so
// `evals/notify.mjs` can drive it with plain objects. It is separated from the
// posting layer for the same reason `src/engine/burst.ts` is separated from
// `Chat.tsx`: the POLICY is the thing worth pinning, and a policy that lives
// inside an effect is a policy nothing can test.
//
// ── THE ONE RULE ──────────────────────────────────────────────────────────
//
// A notification body is TEXT SHE ACTUALLY SENT. Never "You have a new
// message", never "Meera is waiting", never a count.
//
// The reason is not politeness. docs/PRODUCT-SUPERIORITY.md §5 rejects
// "notification as summons" — a ping whose content is the ping is a summons,
// and it is the farewell hook moved to the one surface where the user cannot
// answer back. A notification that carries what she said is not a summons: it
// is the message. Reading it on the lock screen and going back to sleep is a
// complete, satisfying interaction, and that is the test.
//
// The rule is made STRUCTURAL rather than stated: `notifyCopy` returns null
// when there is no real text, and the posting layer has no other constructor.
// There is nowhere in this module to put a fallback string, so a future caller
// cannot reach for one. (`manifest-sourcestatus` is this repo's name for the
// other arrangement: a field that reads as a guarantee and is checked by
// nothing.)
//
// ── WHICH BUBBLES CARRY TEXT SHE SAID ─────────────────────────────────────
//
//   text     her words. Yes.
//   voice    `text` is the CLEAN spoken words (Chat.tsx writes `spoken` for the
//            expressive/audio-tag version and `text` for the plain one). Yes,
//            and it is the same words the bubble would have played.
//   photo    `text` is the caption. Yes when there is one.
//   gif      `text` is the SEARCH QUERY ("excited dog"), not anything she said.
//            NEVER. Putting it on a lock screen would attribute a word to her
//            that she did not use, which is the same class of defect as the
//            voice-note bracket bug (`ack-bracket-direction`).
//   callmark a record of a call, not speech. Never.
//
// ── WHY A BURST IS ONE NOTIFICATION ───────────────────────────────────────
//
// She replies in 1-3 bubbles inside a few seconds (`src/engine/burst.ts`).
// Three notifications for one reply is a phone buzzing three times for one
// thought, which is the haptics rule (`src/native/haptics.ts`: "her messages
// land silently") losing its argument on a louder channel. So: ONE
// notification, the NEWEST line as the collapsed body, the whole burst as the
// expanded body. That is how a person's messages look in every other app.

/** The subset of `Message` this module reads. Structural, not imported, so the
 *  eval can build cases without dragging the store's types (and the store's
 *  React import) into a node bundle. */
export interface NotifiableMessage {
  from: "her" | "me";
  kind?: "text" | "photo" | "callmark" | "voice" | "gif";
  text?: string;
  at?: number;
}

export interface NotifyCopy {
  /** Always her name. The lock screen's job is to say WHO first. */
  title: string;
  /** The newest line she sent, trimmed to a lock-screen length. */
  body: string;
  /** The whole burst, for the expanded view. Undefined when it equals body. */
  largeBody?: string;
}

/** Collapsed body length. Android truncates at roughly this on one line and
 *  the expanded `largeBody` carries the rest, so this is a taste number, not a
 *  platform limit: past about here the lock screen is a wall of text and the
 *  glance stops being a glance. */
export const BODY_MAX = 140;

/** Kinds whose `text` field holds words she actually said. */
const SPEAKING_KINDS = new Set(["text", "voice", "photo"]);

/** One line of hers, or "" if this bubble carries nothing she said. */
export function spokenText(m: NotifiableMessage | null | undefined): string {
  if (!m || m.from !== "her") return "";
  if (!SPEAKING_KINDS.has(m.kind ?? "text")) return "";
  return typeof m.text === "string" ? m.text.trim() : "";
}

/**
 * Trim ONE line at a word boundary, never mid-word, and only when it helps.
 *
 * It collapses internal whitespace, which is right for a single line and wrong
 * for a burst — `clipBlock` below is the multi-line form, and the two are
 * separate because the first version was not: running this over a joined burst
 * turned three messages into one run-on sentence on the expanded notification,
 * which is exactly what a burst is not.
 */
export function clip(s: string, max = BODY_MAX): string {
  const one = s.replace(/\s+/g, " ").trim();
  if (one.length <= max) return one;
  const cut = one.slice(0, max);
  const sp = cut.lastIndexOf(" ");
  return (sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[,;:.!?]+$/, "") + "…";
}

/**
 * Copy for a burst of hers, or NULL when there is nothing of hers to say.
 *
 * Null is the important half. It is what makes "never generic" true by
 * construction: the caller cannot post a notification without a line she sent,
 * because this is the only thing that builds one and it refuses.
 *
 * @param burst   her messages, oldest first (the caller's own slice)
 * @param herName the name the lock screen shows
 */
export function notifyCopy(
  burst: readonly NotifiableMessage[],
  herName: string,
): NotifyCopy | null {
  const lines: string[] = [];
  for (const m of burst) {
    const t = spokenText(m);
    if (t) lines.push(t);
  }
  if (!lines.length) return null;
  return {
    title: herName,
    // The NEWEST line collapsed: it is the one that would be on screen if he
    // opened the thread this second, so the lock screen and the app agree.
    body: clip(lines[lines.length - 1]),
    largeBody: lines.length > 1 ? clipBlock(lines) : undefined,
  };
}

/**
 * The burst, expanded: one line per message, each clipped on its own, the
 * whole thing bounded.
 *
 * Line breaks are preserved because they are the information — three bubbles
 * are three thoughts, and joining them into a paragraph is the app editing her
 * into someone who writes paragraphs. The overall bound is generous (four
 * collapsed bodies) because this view is opened deliberately.
 */
export function clipBlock(lines: readonly string[], max = BODY_MAX * 4): string {
  const out: string[] = [];
  let used = 0;
  for (const line of lines) {
    const l = clip(line);
    if (used + l.length > max) {
      out.push("…");
      break;
    }
    out.push(l);
    used += l.length + 1;
  }
  return out.join("\n");
}

/**
 * Copy for a call of hers he did not pick up.
 *
 * A missed call is the one notification whose CONTENT is the event rather than
 * a sentence, and that is exactly why it is allowed: "she called" is a thing
 * that happened, stated flatly. It carries no ask, no guilt and no count of
 * how long it has been. `IncomingCall.tsx` states the same law from the ring's
 * side: her calling back is caused by a dropped call, never by his silence.
 *
 * Deliberately NOT written in her voice ("why didn't you pick up"). Her voice
 * on a missed call is longing, and longing on a lock screen is
 * docs/PRODUCT-SUPERIORITY.md §5's fails-if (b) verbatim.
 */
export function missedCallCopy(herName: string): NotifyCopy {
  return { title: herName, body: "Missed call" };
}

/**
 * Copy for her story.
 *
 * `desc` is the authored one-line description of the picture that is already
 * in `storyCatalog.ts` and already goes into her prompt (`storyContext`), so
 * the lock screen says what she posted rather than that she posted. It is
 * lowercase, authored, and never model-generated, which is what makes it safe
 * to render somewhere the app cannot take it back.
 */
export function storyCopy(herName: string, desc: string): NotifyCopy | null {
  const d = clip(String(desc ?? ""));
  if (!d) return null;
  return { title: `${herName} added to her story`, body: d };
}
