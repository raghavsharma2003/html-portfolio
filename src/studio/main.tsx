import React from "react";
import ReactDOM from "react-dom/client";
import StudioApp from "./StudioApp";
import OpsBoard from "./OpsBoard";
// Design tokens FIRST, studio.css second. Both write into the `tokens` cascade
// layer, so on any name declared in both, studio.css wins by source order —
// tokens.css adds the scale (type, space, motion, status, focus) without
// overruling the palette studio.css already owns. See its header comment and
// docs/gurukul/DESIGN-SYSTEM.md.
import "./design/tokens.css";
import "./studio.css";
// AFTER studio.css, both of them, and the order is the point. Both write into
// cascade layers studio.css already declared, so within a layer the later
// source wins on equal specificity, which is how these two say the final word
// without having to out-specify 3 300 lines of panel CSS.
//
//   honesty.css   how the two blocker classes look, at every width
//   mobile.css    the phone layout, stated positively rather than subtracted
//
// Separate files for the mechanical reason `design/tokens.css` gives in its own
// header: `studio.css` is the most contended file in this repo, and a layout
// that only exists as a diff inside a contended file is a layout that loses a
// merge. See each file's header for what it owns and why.
import "./design/honesty.css";
import "./design/mobile.css";
// WS-R4. The review queue's one card and its three buttons, in its own file for
// the reason the two above are in theirs: `studio.css` is contended, and a
// layout that only exists as a diff inside it loses a merge.
import "./design/review-queue.css";
import { restoreStudioMode } from "./studioAuth";

// WS-R21. `?mode=ops` is the platform-operator ops board, a SEPARATE
// product from the teacher/generic studio `StudioApp` renders - checked
// BEFORE `restoreStudioMode()` (which only knows "teacher"/"replica" and
// would otherwise overwrite the remembered mode) and BEFORE `StudioApp`
// mounts at all, so `scripts/check-layout.mjs`'s real signed-in render of
// `StudioApp` (a separate harness that imports it directly, not through
// this file) is entirely unaffected by this branch.
const opsMode = (() => {
  try {
    return new URLSearchParams(window.location.search).get("mode") === "ops";
  } catch {
    return false;
  }
})();

if (opsMode) {
  ReactDOM.createRoot(document.getElementById("studio-root")!).render(
    <React.StrictMode>
      <OpsBoard />
    </React.StrictMode>,
  );
} else {
  // BEFORE render, never after. `StudioApp.readStudioMode()` reads `?mode=`
  // once at mount and never again, so the URL has to be correct by the time
  // the first component function runs. This reapplies the teacher/generic
  // choice that a Google sign-in round trip or a bookmark of bare `/studio`
  // would otherwise have dropped, silently landing a teacher in the generic
  // replica lab. See `restoreStudioMode`'s own comment for why the fix is
  // here and not in the OAuth redirect. The hash is preserved, so the OAuth
  // token still reaches `consumeStudioOAuthCallback()` afterwards.
  restoreStudioMode();

  ReactDOM.createRoot(document.getElementById("studio-root")!).render(
    <React.StrictMode>
      <StudioApp />
    </React.StrictMode>,
  );
}
