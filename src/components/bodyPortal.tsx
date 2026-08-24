// Where a full-screen or bottom-sheet surface belongs: outside every app
// stacking context.
//
// task #134 — `.chat` (and `.chat-wrap`) carry `isolation: isolate` for
// reasons that are load-bearing elsewhere and NOT to be touched by this fix:
// `.chat`'s isolation is what stops its wallpaper's `z-index: -1` child from
// escaping into the header or the app shell (see the wallpaper-layer comment
// in global.css), and `.chat-wrap`'s isolation is what stops `.chat-head`'s
// z-index competing with home's in the root context (home.css). Both are
// measured fixes for other bugs and out of scope here.
//
// The cost of that containment: a descendant's declared z-index is capped at
// its isolated ancestor's own stacking level, no matter how large the number
// is. `.home-back` is a SIBLING of `.chat` at z-index 6 (home.css); anything
// mounted as a CHILD of `.chat` — MoreSheet, SourceSheet, AuthSheet (when
// reached through Chat.tsx), StoryView's in-thread instance — is capped at
// `.chat`'s own level and paints under `.home-back` regardless of its own
// z-index. Measured first on PhotoViewer.tsx (z-index 62, still painted
// under a z-index-6 sibling); this is the same defect, same fix, wherever it
// recurs.
//
// The fix is not a bigger number, it is not being inside that subtree. This
// portals to `document.body`, where `position: fixed` (and `position:
// absolute`, since global.css already pins `body` itself to `position:
// fixed; inset: 0`) means what it says, and where the z-index each surface
// already declares (30/31 for `.sheet`, 60 for `.story-view`, 62 for
// `.pview`, 32 for the notify sheet — see their own rules) finally competes
// in the one flat order those numbers were always written for.
//
// A FUNCTION, not a wrapper component: `return toBody(<div>…</div>)` is the
// same shape PhotoViewer.tsx already uses (`return createPortal(<div>…, root)`),
// so a surface that adopts this touches one line at its return and nothing
// about its own JSX's indentation. ONE HELPER rather than four hand-rolled
// `document.body` checks, so the next surface that needs this reaches for it
// instead of re-deriving PhotoViewer's `host()` a fifth time.
import type { ReactNode, ReactPortal } from "react";
import { createPortal } from "react-dom";

export default function toBody(node: ReactNode): ReactPortal | null {
  if (typeof document === "undefined") return null;
  return createPortal(node, document.body);
}
