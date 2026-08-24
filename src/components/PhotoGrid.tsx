// THE COLLAGE — a message that carries more than one picture.
//
// The arrangement is decided in `attachments.ts` (`collageFor`) and drawn here,
// so the shape a count resolves to is testable without a browser and the CSS
// only has to know four words. See that file's own header for why five
// pictures are four tiles and a veil.
//
// EVERY TILE IS A SQUARE except the single-picture case, which keeps its own
// aspect ratio. That asymmetry is deliberate and it is what every messaging app
// does: one photo IS the message and cropping it is destroying what was sent,
// whereas a grid of mismatched rectangles is not a grid.
//
// The reserved height is declared through `aspect-ratio` in CSS rather than
// waiting for decode, for the reason `.msg.photo:not(.me) img` states in
// global.css: a box with no height until decode shifts the whole thread under
// the reader's thumb as each picture lands.

import { collageFor } from "./attachments";

interface Props {
  urls: string[];
  /** open the viewer on this index */
  onOpen: (index: number) => void;
}

export default function PhotoGrid({ urls, onOpen }: Props) {
  const c = collageFor(urls.length);
  if (!c) return null;

  return (
    <div className="pgrid" data-shape={c.shape} data-tel="chat.collage">
      {urls.slice(0, c.tiles).map((u, i) => {
        const veiled = c.overflow > 0 && i === c.tiles - 1;
        return (
          <button
            className="pgrid-tile"
            key={`${i}-${u.slice(-24)}`}
            data-tel="chat.photo_open"
            onClick={(e) => {
              // the bubble's own tap opens the reaction bar; a picture is a
              // different target with a different meaning
              e.stopPropagation();
              onOpen(i);
            }}
            aria-label={
              veiled
                ? `Open all ${urls.length} photos`
                : `Open photo ${i + 1} of ${urls.length}`
            }
          >
            <img src={u} alt="" draggable={false} loading="lazy" />
            {veiled && (
              <span className="pgrid-more" aria-hidden="true">
                +{c.overflow}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
