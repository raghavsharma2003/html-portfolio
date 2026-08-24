// THE TRAY — the pictures this message is going to carry, before it carries
// them.
//
// It sits directly above the composer, inside the same glass, because it is
// part of the message being written and not a thing that happened to the app.
// The reply-quote bar (`.reply-bar`) already establishes that position and that
// material for "something is attached to what you are about to send", so this
// takes the same seat.
//
// ── WHAT THE COUNT LINE IS FOR ─────────────────────────────────────────────
//
// "3 of 5" is not decoration and it is not a progress bar. It is the ONLY place
// the cap is stated before it is hit, and a cap a person meets for the first
// time as a refusal is a cap the app never mentioned. Once the tray is full the
// same line is what the refusal nudges, so the answer to "why did nothing
// happen" is already on screen and simply moves.
//
// ── THE ADD TILE ───────────────────────────────────────────────────────────
//
// The trailing `+` reopens the source sheet, so a second picture can come from
// the OTHER source than the first. It disappears at the cap rather than going
// disabled: a control that is present and inert is the dead option rule again,
// one level down.

import type { Attachment } from "./attachments";
import { MAX_ATTACHMENTS } from "./attachments";
import { CloseIcon } from "./icons";

interface Props {
  items: readonly Attachment[];
  /** true for one beat after a picture was turned away, to nudge the count */
  refused: boolean;
  onRemove: (id: string) => void;
  onAddMore: () => void;
}

export default function ComposeTray({ items, refused, onRemove, onAddMore }: Props) {
  if (!items.length) return null;
  const full = items.length >= MAX_ATTACHMENTS;

  return (
    <div className="tray" aria-label="Photos on this message">
      <div className="tray-count" data-tel="compose.count" {...(refused ? { "data-refused": "" } : {})}>
        {items.length} of {MAX_ATTACHMENTS}
      </div>
      <div className="tray-scroll">
        {items.map((a, i) => (
          <div
            className="tray-thumb"
            key={a.id}
            // Grouped entrances stagger rather than firing together
            // (docs/DESIGN-STANDARDS.md). A gallery multi-select lands three at
            // once; without this they pop as one block, which reads as a
            // repaint instead of as three pictures arriving.
            style={{ animationDelay: `${Math.min(i, 4) * 40}ms` }}
          >
            <img src={a.dataUrl} alt="" draggable={false} />
            <button
              className="tray-x"
              data-tel="compose.remove"
              onClick={() => onRemove(a.id)}
              aria-label={`Remove photo ${i + 1}`}
            >
              <CloseIcon size={12} />
            </button>
          </div>
        ))}
        {!full && (
          <button
            className="tray-add"
            data-tel="compose.add_more"
            onClick={onAddMore}
            aria-label="Add another photo"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" aria-hidden="true">
              <path d="M12 6v12M6 12h12" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
