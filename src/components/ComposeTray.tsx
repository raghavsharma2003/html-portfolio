// THE TRAY — what this message is going to carry, before it carries it.
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
// TWO CAPS, ONE LINE. Pictures and documents are counted separately (five and
// three) and the line says whichever is in play. When both are, it stops
// counting and names them instead: "3 photos, 1 file" is what a person would
// say, and "3 of 5 and 1 of 3" is arithmetic homework. The cap is still
// reachable in words the moment either one refuses, which is the only moment it
// matters.
//
// ── THE ADD TILE ───────────────────────────────────────────────────────────
//
// The trailing `+` reopens the source sheet, so the next thing can come from a
// different source than the last. It disappears when NOTHING more can be added
// rather than going disabled: a control that is present and inert is the dead
// option rule again, one level down.

import type { Attachment, DocAttachment } from "./attachments";
import { MAX_ATTACHMENTS, MAX_DOCS, docExt, docSize, trayCount } from "./attachments";
import { CloseIcon } from "./icons";

interface Props {
  items: readonly Attachment[];
  docs: readonly DocAttachment[];
  /** true for one beat after something was turned away, to nudge the count */
  refused: boolean;
  onRemove: (id: string) => void;
  onRemoveDoc: (id: string) => void;
  onAddMore: () => void;
}

export default function ComposeTray({
  items,
  docs,
  refused,
  onRemove,
  onRemoveDoc,
  onAddMore,
}: Props) {
  if (!items.length && !docs.length) return null;
  const full = items.length >= MAX_ATTACHMENTS && docs.length >= MAX_DOCS;

  return (
    <div className="tray" aria-label="Attached to this message">
      <div className="tray-count" data-tel="compose.count" {...(refused ? { "data-refused": "" } : {})}>
        {trayCount(items.length, docs.length)}
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
        {/* THE FILE CHIP. Wider than a thumbnail and shaped like a row rather
            than a tile, because a document has no picture of itself and the
            only things worth showing are what it is called and how big it is.
            The extension is a badge rather than part of the name: it is the
            single most recognisable thing about a file, and a name that is too
            long to fit would otherwise take the format with it when it
            ellipsises. */}
        {docs.map((d, i) => (
          <div
            className="tray-doc"
            key={d.id}
            style={{ animationDelay: `${Math.min(items.length + i, 4) * 40}ms` }}
          >
            <span className="tray-doc-ext" aria-hidden="true">
              {docExt(d.name)}
            </span>
            <span className="tray-doc-text">
              <span className="tray-doc-name" title={d.name}>
                {d.name}
              </span>
              <span className="tray-doc-size">{docSize(d.size)}</span>
            </span>
            <button
              className="tray-x doc"
              data-tel="compose.remove_doc"
              onClick={() => onRemoveDoc(d.id)}
              aria-label={`Remove ${d.name}`}
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
            aria-label="Attach something else"
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
