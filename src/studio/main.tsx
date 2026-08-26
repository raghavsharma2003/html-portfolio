import React from "react";
import ReactDOM from "react-dom/client";
import StudioApp from "./StudioApp";
// Design tokens FIRST, studio.css second. Both write into the `tokens` cascade
// layer, so on any name declared in both, studio.css wins by source order —
// tokens.css adds the scale (type, space, motion, status, focus) without
// overruling the palette studio.css already owns. See its header comment and
// docs/gurukul/DESIGN-SYSTEM.md.
import "./design/tokens.css";
import "./studio.css";
import { restoreStudioMode } from "./studioAuth";

// BEFORE render, never after. `StudioApp.readStudioMode()` reads `?mode=` once
// at mount and never again, so the URL has to be correct by the time the first
// component function runs. This reapplies the teacher/generic choice that a
// Google sign-in round trip or a bookmark of bare `/studio` would otherwise
// have dropped, silently landing a teacher in the generic replica lab. See
// `restoreStudioMode`'s own comment for why the fix is here and not in the
// OAuth redirect. The hash is preserved, so the OAuth token still reaches
// `consumeStudioOAuthCallback()` afterwards.
restoreStudioMode();

ReactDOM.createRoot(document.getElementById("studio-root")!).render(
  <React.StrictMode>
    <StudioApp />
  </React.StrictMode>,
);
