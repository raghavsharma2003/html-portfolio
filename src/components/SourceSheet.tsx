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

interface Props {
  /** how many more pictures this message can still take */
  room: number;
  onCamera: () => void;
  onGallery: () => void;
  onClose: () => void;
}

export default function SourceSheet({ room, onCamera, onGallery, onClose }: Props) {
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
        aria-label="Send a photo"
      >
        <div className="grab" />
        <button className="sheet-x" data-tel="attach.close" onClick={onClose} aria-label="Close">
          <CloseIcon />
        </button>

        {/* APPLE-TERSE, the standing instruction on every sheet in this app.
            The title is the verb, and the only line under it is the one fact
            the rows cannot state themselves: how much room is left. When the
            tray is empty that fact is uninteresting, so it is not said. */}
        <h3>Send a photo</h3>
        {room < 5 && (
          <p className="hint" data-tel="attach.room">
            {room === 1 ? "one more fits" : `${room} more fit`}
          </p>
        )}

        <div className="sheet-rows">
          {camera && (
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
        </div>
      </div>
    </>
  );
}
