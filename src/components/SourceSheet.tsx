// WHERE THE PICTURE COMES FROM — camera, or the photos already on the phone.
//
// ── why a sheet ────────────────────────────────────────────────────────────
//
// The composer's camera button used to open a file dialog, which is the answer
// to "pick a file" and not to "send a picture". Every messaging product the
// owner uses asks the source question first, and asks it as a sheet from the
// bottom edge, because the question has exactly two answers and a sheet is the
// cheapest control that can hold two answers with their own icons and their own
// subtitles.
//
// IT IS THE SETTINGS SHEET'S OWN IDIOM, not a new one. `.sheet-veil`, `.sheet`,
// `.sheet-rows` and `.srow` are MoreSheet.tsx's classes, so the blur, the
// radius, the drawer curve, the 380ms rise, the scroll shadows, the grab
// handle, the press scale and the row geometry are all inherited rather than
// restated. A second sheet that looked 4px different from the first is the kind
// of thing nobody can name and everybody feels.
//
// ── NEVER SHOW A DEAD OPTION ───────────────────────────────────────────────
//
// `cameraAvailable()` below decides whether the camera row exists at all. A row
// that opens a file dialog when it says Camera is worse than no row: it teaches
// the user that this app's words are approximate.

import { useEffect, useRef } from "react";
import { Capacitor } from "@capacitor/core";
import { CameraIcon, ChevronIcon, CloseIcon } from "./icons";
import { MAX_ATTACHMENTS, MAX_DOCS } from "./attachments";

/**
 * A picture-shaped icon for the gallery row.
 *
 * Drawn here rather than in `icons.tsx` for the reason MoreSheet's SoundIcon
 * gives for its own: it is the only icon in the app that exists for one sheet,
 * and moving it into the shared set would imply a second caller that does not
 * exist. Same 24 grid, same 1.8 stroke as everything in that file.
 */
const StackIcon = ({ size = 19 }: { size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.8}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <rect x="7.5" y="3.5" width="13" height="13" rx="3" />
    <path d="M16.5 20.5h-9a4 4 0 0 1-4-4v-9" />
    <circle cx="11.6" cy="7.6" r="1.5" />
    <path d="M20.5 12.8 17 9.6l-6.4 6.9" />
  </svg>
);

/** A page with a folded corner. Same grid and stroke as the set above. */
export const DocIcon = ({ size = 19 }: { size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.8}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M14 3.5H7.5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V8l-4.5-4.5Z" />
    <path d="M13.8 3.7V8.2h4.4" />
    <path d="M9 13h6M9 16.5h4" />
  </svg>
);

/**
 * Can this device actually take a photo right now?
 *
 * Native is unconditional: Capacitor's own `BridgeWebChromeClient` answers a
 * `capture`-flagged file input with a real `ACTION_IMAGE_CAPTURE` intent and
 * requests CAMERA itself, so the platform path IS the camera path.
 *
 * On the web the mechanism is HTML Media Capture, and the honest question to
 * ask about it is "is this a phone". Every touch browser that matters
 * implements it; every desktop browser either does not have it or exposes the
 * attribute and ignores it, opening an ordinary file dialog underneath a row
 * that says Camera. That dead option is the whole thing this function exists to
 * prevent.
 *
 * ASKED THROUGH THE POINTER, NOT THROUGH THE ATTRIBUTE, and that is measured
 * rather than assumed. `"capture" in HTMLInputElement.prototype` reads FALSE in
 * desktop Chromium 141 (checked in evals/composer-browser.mjs's own probe), so
 * an attribute test looks like it works, agrees with this function on a laptop,
 * and cannot be trusted to agree with it on a phone. A coarse primary pointer
 * plus a digitiser is the same question with a stable answer.
 */
export function cameraAvailable(): boolean {
  try {
    if (Capacitor.isNativePlatform()) return true;
    if (typeof window === "undefined" || typeof navigator === "undefined") return false;
    const coarse = window.matchMedia?.("(pointer: coarse)").matches === true;
    return coarse && (navigator.maxTouchPoints ?? 0) > 0;
  } catch {
    return false;
  }
}

/** The gallery is every device that can open a file at all. */
export const galleryAvailable = () =>
  typeof document !== "undefined" && "files" in document.createElement("input");

/**
 * Documents are the same question as the gallery: can this thing open a file.
 *
 * Stated as its own predicate rather than reusing `galleryAvailable` under a
 * second name, because the two are the same fact today and are not the same
 * QUESTION — a future build could restrict picture sources without touching
 * documents, and a shared alias is how that change silently takes out the wrong
 * row.
 */
export const documentsAvailable = () =>
  typeof document !== "undefined" && "files" in document.createElement("input");

interface Props {
  /** how many more pictures this message can still take */
  room: number;
  /** how many more documents this message can still take */
  docRoom: number;
  onCamera: () => void;
  onGallery: () => void;
  onDocument: () => void;
  onClose: () => void;
}

export default function SourceSheet({
  room,
  docRoom,
  onCamera,
  onGallery,
  onDocument,
  onClose,
}: Props) {
  const sheet = useRef<HTMLDivElement>(null);
  const camera = cameraAvailable();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Focus starts inside the sheet, same as MoreSheet: a sheet you can only
  // leave by finding the scrim above it is a trap on a tall phone.
  useEffect(() => {
    sheet.current?.querySelector<HTMLElement>("button")?.focus({ preventScroll: true });
  }, []);

  return (
    <>
      <div className="sheet-veil" onClick={onClose} />
      <div
        className="sheet source-sheet"
        ref={sheet}
        role="dialog"
        aria-modal="true"
        aria-label="Attach to this message"
      >
        <div className="grab" />
        <button className="sheet-x" data-tel="attach.close" onClick={onClose} aria-label="Close">
          <CloseIcon />
        </button>

        {/* APPLE-TERSE, the standing instruction on every sheet in this app.
            The title is the verb and nothing else.

            EACH ROW STATES ITS OWN ROOM, in its subtitle, rather than a
            paragraph above them restating all of it — there are two independent
            caps now (five pictures, three documents) and a line that tried to
            hold both would be a sentence about arithmetic. A cap that has been
            REACHED is the one thing a row cannot say, because a row at its cap
            is not rendered at all, so that is the only thing the hint says. */}
        <h3>Attach</h3>
        {(room === 0 || docRoom === 0) && (
          <p className="hint" data-tel="attach.room">
            {room === 0 && docRoom === 0
              ? "this message is full"
              : room === 0
                ? `${MAX_ATTACHMENTS} photos is the most she can look at once`
                : `${MAX_DOCS} files is the most for one message`}
          </p>
        )}

        <div className="sheet-rows">
          {/* A ROW AT ITS CAP IS NOT RENDERED. Same rule as the camera row on a
              laptop and the `+` tile in the tray: a control that is present and
              cannot do the thing it names teaches the user that this app's
              words are approximate. */}
          {room > 0 && camera && (
            <button className="srow" data-tel="attach.camera" onClick={onCamera}>
              <span className="sicon">
                <CameraIcon size={19} />
              </span>
              <span className="stext">
                <span className="stitle">Camera</span>
                <span className="ssub">Take one now</span>
              </span>
              <span className="schev">
                <ChevronIcon />
              </span>
            </button>
          )}
          {room > 0 && (
            <button className="srow" data-tel="attach.gallery" onClick={onGallery}>
              <span className="sicon">
                <StackIcon />
              </span>
              <span className="stext">
                <span className="stitle">Photos</span>
                <span className="ssub">
                  {room > 1 ? `Pick up to ${room}` : "Pick one"}
                </span>
              </span>
              <span className="schev">
                <ChevronIcon />
              </span>
            </button>
          )}
          {/* DOCUMENTS. Feature-detected through the same question the gallery
              asks, because it is the same mechanism: a file input. There is no
              device that can open a picture file and not a text one, so this
              row is available wherever that one is and dead nowhere.

              The subtitle names the formats rather than saying "documents",
              because "documents" is the row title and repeating it would be the
              gloss this repo's sheets keep deleting. What a person needs to
              know here is whether the thing in their hand is one of these. */}
          {docRoom > 0 && documentsAvailable() && (
            <button className="srow" data-tel="attach.document" onClick={onDocument}>
              <span className="sicon">
                <DocIcon />
              </span>
              <span className="stext">
                <span className="stitle">Document</span>
                <span className="ssub">PDF, text, csv or json</span>
              </span>
              <span className="schev">
                <ChevronIcon />
              </span>
            </button>
          )}
        </div>
      </div>
    </>
  );
}
