import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource-variable/geist";
import "@fontsource-variable/instrument-sans";
import "@fontsource/noto-sans-devanagari/devanagari-600.css";
import PersonalStudioEntry from "./PersonalStudioEntry";
// Tokens first, then the original studio's sign-in/base declarations. The
// entry subset preserves layer order and the studio palette overrides.
import "./design/tokens.css";
import "./studio-entry.css";
// The complete studio/honesty/mobile cascade loads inside the authenticated
// Suspense boundary. Sign-in needs only the exact entry subset above.
import "./auth-entry.css";
import "./vyakti-mark.css";
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
    <PersonalStudioEntry />
  </React.StrictMode>,
);
